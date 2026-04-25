import { parseBinaryShot } from '../../pages/ShotHistory/parseBinaryShot.js';
import { parseBinaryIndex } from '../../pages/ShotHistory/parseBinaryIndex.js';

// ---------- Constants ----------

export const PHASE = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  ANALYZING: 'analyzing',
  DONE: 'done',
  ERROR: 'error',
});

export const MODE_BREW = 1;
export const SHOT_END_TIMEOUT_MS = 5 * 60 * 1000;
export const POST_MODE_SETTLE_MS = 1500;
export const POST_SHOT_SETTLE_MS = 1500;
export const SLOG_FETCH_RETRIES = 20;
export const SLOG_FETCH_DELAY_MS = 1000;

const SHOT_FLAG_DELETED = 0x02;
const SLOG_HEADER_MIN = 128; // v4 header size; firmware writes header on flush.

// ---------- Pure math ----------

// Filters a parsed shot for samples in a "Measure X bar" phase (target temp
// 25 °C, target pressure = X bar) and computes the calibration factor from
// real flow (delta volume / delta time) vs. estimated flow (integral of
// reported pump flow). Caller multiplies the existing coefficient for that
// pressure point by this factor to get the new coefficient.
export function analyze(samples, targetPressure) {
  const measure = samples.filter(s => s.tt === 25 && s.tp === targetPressure);
  if (measure.length < 2) {
    throw new Error(
      `Not enough samples for tp=${targetPressure} bar (Measure phase). Was the valve closed enough to reach ${targetPressure} bar?`,
    );
  }
  const first = measure[0];
  const last = measure[measure.length - 1];
  const volume = last.v - first.v;
  const time = (last.t - first.t) / 1000;
  let pumped = 0;
  let lastT = 0;
  for (const s of measure) {
    if (lastT !== 0) pumped += (s.fl / 1000) * (s.t - lastT);
    lastT = s.t;
  }
  const actualFlow = volume / time;
  const estimatedFlow = pumped / time;
  return { volume, time, actualFlow, estimatedFlow, factor: actualFlow / estimatedFlow };
}

export function parseCoeffs(raw) {
  const [c1, c9] = (raw || '').split(',').map(parseFloat);
  if (!Number.isFinite(c1) || !Number.isFinite(c9)) {
    throw new Error(`Current coefficients are not numeric: "${raw}"`);
  }
  return [c1, c9];
}

// ---------- HTTP fetchers ----------

export async function fetchShotIndex() {
  const r = await fetch('/api/history/index.bin', { cache: 'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GET index.bin ${r.status}`);
  const buf = await r.arrayBuffer();
  return parseBinaryIndex(buf).entries.filter(e => !(e.flags & SHOT_FLAG_DELETED));
}

// Retries until the firmware has flushed the .slog header to flash.
export async function fetchShotReady(id, onWait) {
  const padded = String(id).padStart(6, '0');
  for (let attempt = 1; attempt <= SLOG_FETCH_RETRIES; attempt++) {
    const r = await fetch(`/api/history/${padded}.slog`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GET slog ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength >= SLOG_HEADER_MIN) return buf;
    if (onWait && (attempt === 1 || attempt % 3 === 0)) {
      onWait(`slog still empty, waiting for flush... (${attempt})`);
    }
    if (attempt === SLOG_FETCH_RETRIES) break;
    await new Promise(res => setTimeout(res, SLOG_FETCH_DELAY_MS));
  }
  throw new Error(
    `Shot file remained empty after ${(SLOG_FETCH_RETRIES * SLOG_FETCH_DELAY_MS) / 1000}s`,
  );
}

export async function fetchAndParseShot(id, onWait) {
  const buf = await fetchShotReady(id, onWait);
  return parseBinaryShot(buf, String(id));
}

export async function postCoefficients(coeffs) {
  const body = new URLSearchParams({ pumpModelCoeffs: coeffs }).toString();
  const r = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`POST /api/settings ${r.status}`);
}
