import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { ApiServiceContext } from '../services/ApiService.js';
import { parseBinaryShot } from '../pages/ShotHistory/parseBinaryShot.js';
import { parseBinaryIndex } from '../pages/ShotHistory/parseBinaryIndex.js';
import {
  CALIBRATION_PROFILE,
  CALIBRATION_PROFILE_ID,
  analyze,
} from '../utils/pumpFlowCalibration.js';

const SHOT_FLAG_DELETED = 0x02;
const SLOG_HEADER_MIN = 128; // v4 header size; firmware writes header on flush.
const MODE_BREW = 1;
const SHOT_END_TIMEOUT_MS = 5 * 60 * 1000;
const SLOG_FETCH_RETRIES = 20;
const SLOG_FETCH_DELAY_MS = 1000;
const POST_MODE_SETTLE_MS = 1500;
const POST_SHOT_SETTLE_MS = 1500;

export const PHASE = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  ANALYZING: 'analyzing',
  DONE: 'done',
  ERROR: 'error',
});

async function fetchShotIndex() {
  const r = await fetch('/api/history/index.bin', { cache: 'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GET index.bin ${r.status}`);
  const buf = await r.arrayBuffer();
  return parseBinaryIndex(buf).entries.filter(e => !(e.flags & SHOT_FLAG_DELETED));
}

async function fetchShotReady(id, onWait) {
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

function parseCoeffs(raw) {
  const [c1, c9] = (raw || '').split(',').map(parseFloat);
  if (!Number.isFinite(c1) || !Number.isFinite(c9)) {
    throw new Error(`Current coefficients are not numeric: "${raw}"`);
  }
  return [c1, c9];
}

/**
 * usePumpFlowCalibration
 * Drives the pump-flow calibration flow against a connected GaggiMate over
 * the existing ApiService WebSocket. Owns the full state machine
 * (idle → running → analyzing → done | error) plus the eventual save back
 * to /api/settings; the consuming component only needs to render.
 *
 * @param {object} opts
 * @param {string} opts.currentCoeffs - Current `pumpModelCoeffs` value, format "X,Y".
 * @param {(newCoeffs: string) => void} [opts.onApplied] - Called after a successful save.
 *
 * Returns:
 * - phase: PHASE — current state (use the exported PHASE enum to compare)
 * - logs: Array<{ key, msg, tone }> — append-only progress log
 * - results: { oneBar, nineBar, newCoeffs } | null — populated when phase is DONE
 * - saving: boolean — true while POST /api/settings is in flight
 * - saved: boolean — true after a successful save
 * - busy: boolean — convenience: phase === RUNNING || ANALYZING
 * - start: () => Promise<void> — kick off a calibration run
 * - apply: () => Promise<void> — write `results.newCoeffs` to the machine
 * - reset: () => void — return to IDLE and clear logs/results
 */
export function usePumpFlowCalibration({ currentCoeffs, onApplied }) {
  const apiService = useContext(ApiServiceContext);

  const [phase, setPhase] = useState(PHASE.IDLE);
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const statusListenerRef = useRef(null);

  const detachStatusListener = useCallback(() => {
    if (statusListenerRef.current !== null) {
      apiService.off('evt:status', statusListenerRef.current);
      statusListenerRef.current = null;
    }
  }, [apiService]);

  // Always release the WS listener if the consumer unmounts mid-run.
  useEffect(() => detachStatusListener, [detachStatusListener]);

  const pushLog = useCallback((msg, tone = 'info') => {
    setLogs(prev => [...prev, { key: prev.length, msg, tone }]);
  }, []);

  const reset = useCallback(() => {
    detachStatusListener();
    setPhase(PHASE.IDLE);
    setLogs([]);
    setResults(null);
    setSaving(false);
    setSaved(false);
  }, [detachStatusListener]);

  const waitForShotEnd = useCallback(
    () =>
      new Promise((resolve, reject) => {
        let sawActive = false;
        const safetyId = setTimeout(() => {
          detachStatusListener();
          reject(new Error('Timeout waiting for shot to finish (5min).'));
        }, SHOT_END_TIMEOUT_MS);
        statusListenerRef.current = apiService.on('evt:status', m => {
          const active = m.process && m.process.a === 1;
          if (active) sawActive = true;
          if (sawActive && !active) {
            clearTimeout(safetyId);
            detachStatusListener();
            resolve();
          }
        });
      }),
    [apiService, detachStatusListener],
  );

  const start = useCallback(async () => {
    if (!apiService) {
      pushLog('Internal error: ApiService unavailable.', 'err');
      setPhase(PHASE.ERROR);
      return;
    }
    setLogs([]);
    setResults(null);
    setSaved(false);
    setPhase(PHASE.RUNNING);

    try {
      pushLog('Saving calibration profile...');
      await apiService.request({ tp: 'req:profiles:save', profile: CALIBRATION_PROFILE });

      pushLog('Selecting calibration profile...');
      await apiService.request({ tp: 'req:profiles:select', id: CALIBRATION_PROFILE_ID });

      pushLog('Switching to BREW mode...');
      apiService.send({ tp: 'req:change-mode', mode: MODE_BREW });
      await new Promise(r => setTimeout(r, POST_MODE_SETTLE_MS));

      pushLog('Snapshotting shot history...');
      const before = await fetchShotIndex();
      const preIds = new Set(before.map(e => e.id));

      pushLog('Starting shot — adjust the steam valve to reach 1 bar, then 9 bar.', 'ok');
      apiService.send({ tp: 'req:process:activate' });
      await waitForShotEnd();

      pushLog('Shot finished. Fetching history...', 'ok');
      await new Promise(r => setTimeout(r, POST_SHOT_SETTLE_MS));
      const after = await fetchShotIndex();
      const fresh = after.filter(e => !preIds.has(e.id)).sort((a, b) => b.timestamp - a.timestamp);
      if (!fresh.length) {
        throw new Error('New shot did not appear in history — was it cancelled?');
      }

      const shotId = fresh[0].id;
      pushLog(`Downloading shot #${shotId}`);
      setPhase(PHASE.ANALYZING);

      const buf = await fetchShotReady(shotId, msg => pushLog(msg, 'warn'));
      const shot = parseBinaryShot(buf, String(shotId));
      pushLog(`Parsed ${shot.samples.length} samples (v${shot.version}).`);

      const oneBar = analyze(shot.samples, 1);
      const nineBar = analyze(shot.samples, 9);
      const [c1, c9] = parseCoeffs(currentCoeffs);
      const newCoeffs = `${(c1 * oneBar.factor).toFixed(3)},${(c9 * nineBar.factor).toFixed(3)}`;
      setResults({ oneBar, nineBar, newCoeffs });

      pushLog('Analysis complete.', 'ok');
      setPhase(PHASE.DONE);
    } catch (err) {
      detachStatusListener();
      pushLog(`Error: ${err.message}`, 'err');
      setPhase(PHASE.ERROR);
    }
  }, [apiService, currentCoeffs, detachStatusListener, pushLog, waitForShotEnd]);

  const apply = useCallback(async () => {
    if (!results) return;
    setSaving(true);
    try {
      const body = new URLSearchParams({ pumpModelCoeffs: results.newCoeffs }).toString();
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!r.ok) throw new Error(`POST /api/settings ${r.status}`);
      pushLog(`Coefficients saved to machine: ${results.newCoeffs}`, 'ok');
      setSaved(true);
      onApplied?.(results.newCoeffs);
    } catch (err) {
      pushLog(`Save failed: ${err.message}`, 'err');
    } finally {
      setSaving(false);
    }
  }, [results, pushLog, onApplied]);

  const busy = phase === PHASE.RUNNING || phase === PHASE.ANALYZING;

  return { phase, logs, results, saving, saved, busy, start, apply, reset };
}
