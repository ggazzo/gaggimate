import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { computed } from '@preact/signals';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons/faSpinner';
import { ApiServiceContext, machine } from '../services/ApiService.js';
import { parseBinaryShot } from '../pages/ShotHistory/parseBinaryShot.js';
import { parseBinaryIndex } from '../pages/ShotHistory/parseBinaryIndex.js';
import {
  CALIBRATION_PROFILE,
  CALIBRATION_PROFILE_ID,
  analyze,
} from '../utils/pumpFlowCalibration.js';

const SHOT_FLAG_DELETED = 0x02;
const SLOG_HEADER_MIN = 128; // v4 header size; firmware writes header on flush.
const PHASE = {
  IDLE: 'idle',
  RUNNING: 'running',
  ANALYZING: 'analyzing',
  DONE: 'done',
  ERROR: 'error',
};

const connected = computed(() => machine.value.connected);

async function fetchIndex() {
  const r = await fetch('/api/history/index.bin', { cache: 'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GET index.bin ${r.status}`);
  const buf = await r.arrayBuffer();
  return parseBinaryIndex(buf).entries.filter(e => !(e.flags & SHOT_FLAG_DELETED));
}

async function fetchShotReady(id, onWait) {
  const padded = String(id).padStart(6, '0');
  const max = 20;
  const delay = 1000;
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = await fetch(`/api/history/${padded}.slog`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GET slog ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength >= SLOG_HEADER_MIN) return buf;
    if (onWait && (attempt === 1 || attempt % 3 === 0)) {
      onWait(`slog still empty, waiting for flush... (${attempt})`);
    }
    if (attempt === max) break;
    await new Promise(res => setTimeout(res, delay));
  }
  throw new Error(`Shot file remained empty after ${(max * delay) / 1000}s`);
}

export default function PumpFlowCalibrationModal({ isOpen, onClose, currentCoeffs, onApplied }) {
  const apiService = useContext(ApiServiceContext);

  const [phase, setPhase] = useState(PHASE.IDLE);
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState(null); // { oneBar, nineBar, newCoeffs }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const statusListenerRef = useRef(null);

  const detachStatusListener = useCallback(() => {
    if (statusListenerRef.current !== null) {
      apiService.off('evt:status', statusListenerRef.current);
      statusListenerRef.current = null;
    }
  }, [apiService]);

  useEffect(() => detachStatusListener, [detachStatusListener]);

  const pushLog = useCallback((msg, tone = 'info') => {
    setLogs(prev => [...prev, { msg, tone, key: prev.length }]);
  }, []);

  const reset = useCallback(() => {
    detachStatusListener();
    setPhase(PHASE.IDLE);
    setLogs([]);
    setResults(null);
    setSaving(false);
    setSaved(false);
  }, [detachStatusListener]);

  const busy = phase === PHASE.RUNNING || phase === PHASE.ANALYZING;

  const handleClose = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, reset, onClose]);

  const waitForShotEnd = useCallback(
    () =>
      new Promise((resolve, reject) => {
        let sawActive = false;
        const safetyId = setTimeout(
          () => {
            detachStatusListener();
            reject(new Error('Timeout waiting for shot to finish (5min).'));
          },
          5 * 60 * 1000,
        );
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

  const run = useCallback(async () => {
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
      apiService.send({ tp: 'req:change-mode', mode: 1 });
      await new Promise(r => setTimeout(r, 1500));

      pushLog('Snapshotting shot history...');
      const before = await fetchIndex();
      const preIds = new Set(before.map(e => e.id));

      pushLog('Starting shot — adjust the steam valve to reach 1 bar, then 9 bar.', 'ok');
      apiService.send({ tp: 'req:process:activate' });
      await waitForShotEnd();

      pushLog('Shot finished. Fetching history...', 'ok');
      await new Promise(r => setTimeout(r, 1500));
      const after = await fetchIndex();
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

      const [c1, c9] = (currentCoeffs || '').split(',').map(parseFloat);
      if (!Number.isFinite(c1) || !Number.isFinite(c9)) {
        throw new Error(`Current coefficients are not numeric: "${currentCoeffs}"`);
      }
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

  if (!isOpen) return null;

  return (
    <div className='bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black p-4'>
      <div className='max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-800'>
        <div className='p-6'>
          <div className='mb-4 flex items-center justify-between'>
            <h3 className='text-lg font-semibold'>Pump Flow Calibration</h3>
            {!busy && (
              <button
                type='button'
                onClick={handleClose}
                className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                aria-label='Close'
              >
                ✕
              </button>
            )}
          </div>

          {phase === PHASE.IDLE && (
            <IdleSection currentCoeffs={currentCoeffs} connected={connected.value} />
          )}

          {logs.length > 0 && <LogPanel logs={logs} />}

          {phase === PHASE.DONE && results && (
            <ResultsPanel results={results} currentCoeffs={currentCoeffs} />
          )}

          <div className='mt-5 flex justify-end space-x-3'>
            {phase === PHASE.IDLE && (
              <>
                <button
                  type='button'
                  onClick={handleClose}
                  className='rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500'
                >
                  Cancel
                </button>
                <button
                  type='button'
                  onClick={run}
                  disabled={!connected.value}
                  className='rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'
                >
                  Start calibration
                </button>
              </>
            )}
            {busy && (
              <button
                type='button'
                disabled
                className='flex items-center space-x-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-60'
              >
                <FontAwesomeIcon icon={faSpinner} spin />
                <span>{phase === PHASE.RUNNING ? 'Running shot...' : 'Analyzing...'}</span>
              </button>
            )}
            {phase === PHASE.DONE && !saved && (
              <>
                <button
                  type='button'
                  onClick={handleClose}
                  className='rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500'
                >
                  Discard
                </button>
                <button
                  type='button'
                  disabled={saving}
                  onClick={apply}
                  className='flex items-center space-x-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'
                >
                  {saving && <FontAwesomeIcon icon={faSpinner} spin />}
                  <span>{saving ? 'Saving...' : 'Save to machine'}</span>
                </button>
              </>
            )}
            {phase === PHASE.DONE && saved && (
              <button
                type='button'
                onClick={handleClose}
                className='rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700'
              >
                Done
              </button>
            )}
            {phase === PHASE.ERROR && (
              <>
                <button
                  type='button'
                  onClick={handleClose}
                  className='rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500'
                >
                  Close
                </button>
                <button
                  type='button'
                  onClick={run}
                  className='rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700'
                >
                  Retry
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IdleSection({ currentCoeffs, connected }) {
  return (
    <div className='space-y-3'>
      <p className='text-sm opacity-80'>
        Place a scale with a cup under the steam wand. Close the steam valve just enough so the
        machine can reach the target pressure during each <em>Build</em> phase.
      </p>
      <div className='rounded-md border border-yellow-500 bg-yellow-50 p-3 text-sm dark:bg-yellow-900/30'>
        During the shot, adjust the valve so pressure reaches 1 bar, then 9 bar. Keep it stable
        during the <em>Measure</em> phases (10 s each).
      </div>
      <div className='rounded-md bg-gray-100 p-3 text-sm dark:bg-gray-700'>
        <strong>Current coefficients:</strong>{' '}
        <span className='font-mono'>{currentCoeffs || '—'}</span>
      </div>
      {!connected && (
        <div className='rounded-md border border-red-500 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200'>
          Not connected to the machine. Wait for the connection to recover before starting.
        </div>
      )}
    </div>
  );
}

function LogPanel({ logs }) {
  return (
    <div className='mt-4 max-h-48 overflow-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-100'>
      {logs.map(l => (
        <div
          key={l.key}
          className={
            l.tone === 'err'
              ? 'text-red-400'
              : l.tone === 'ok'
                ? 'text-green-400'
                : l.tone === 'warn'
                  ? 'text-yellow-300'
                  : ''
          }
        >
          {l.tone === 'err' ? '✗' : l.tone === 'ok' ? '✓' : l.tone === 'warn' ? '!' : '›'} {l.msg}
        </div>
      ))}
    </div>
  );
}

function ResultsPanel({ results, currentCoeffs }) {
  const { oneBar, nineBar, newCoeffs } = results;
  return (
    <div className='mt-4 space-y-3'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <ResultCard title='1 bar' a={oneBar} />
        <ResultCard title='9 bar' a={nineBar} />
      </div>
      <div className='rounded-md border border-blue-500 bg-blue-50 p-3 dark:bg-blue-900/30'>
        <div className='text-xs uppercase opacity-70'>Coefficients</div>
        <div className='mt-1 flex items-baseline gap-3'>
          <span className='font-mono text-sm opacity-70'>{currentCoeffs || '—'}</span>
          <span className='opacity-70'>→</span>
          <span className='font-mono text-2xl text-blue-700 dark:text-blue-300'>{newCoeffs}</span>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ title, a }) {
  return (
    <div className='rounded-md bg-gray-100 p-3 dark:bg-gray-700'>
      <div className='text-xs uppercase opacity-70'>{title}</div>
      <div className='mt-1 space-y-1 font-mono text-xs'>
        <Row label='actual flow' value={`${a.actualFlow.toFixed(3)} ml/s`} />
        <Row label='estimated flow' value={`${a.estimatedFlow.toFixed(3)} ml/s`} />
        <Row label='factor' value={a.factor.toFixed(4)} />
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className='flex justify-between'>
      <span className='opacity-70'>{label}</span>
      <span>{value}</span>
    </div>
  );
}
