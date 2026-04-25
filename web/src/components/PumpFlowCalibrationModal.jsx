import { useCallback } from 'preact/hooks';
import { computed } from '@preact/signals';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons/faSpinner';
import { machine } from '../services/ApiService.js';
import { PHASE, usePumpFlowCalibration } from '../hooks/usePumpFlowCalibration.js';

const connected = computed(() => machine.value.connected);

export default function PumpFlowCalibrationModal({ isOpen, onClose, currentCoeffs, onApplied }) {
  const { phase, logs, results, saving, saved, busy, start, apply, reset } = usePumpFlowCalibration(
    { currentCoeffs, onApplied },
  );

  const handleClose = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, reset, onClose]);

  if (!isOpen) return null;

  return (
    <div className='bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black p-4'>
      <div className='max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-800'>
        <div className='p-6'>
          <ModalHeader busy={busy} onClose={handleClose} />

          {phase === PHASE.IDLE && (
            <IdleSection currentCoeffs={currentCoeffs} connected={connected.value} />
          )}

          {logs.length > 0 && <LogPanel logs={logs} />}

          {phase === PHASE.DONE && results && (
            <ResultsPanel results={results} currentCoeffs={currentCoeffs} />
          )}

          <ModalFooter
            phase={phase}
            saving={saving}
            saved={saved}
            connected={connected.value}
            onClose={handleClose}
            onStart={start}
            onApply={apply}
          />
        </div>
      </div>
    </div>
  );
}

function ModalHeader({ busy, onClose }) {
  return (
    <div className='mb-4 flex items-center justify-between'>
      <h3 className='text-lg font-semibold'>Pump Flow Calibration</h3>
      {!busy && (
        <button
          type='button'
          onClick={onClose}
          className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          aria-label='Close'
        >
          ✕
        </button>
      )}
    </div>
  );
}

function ModalFooter({ phase, saving, saved, connected, onClose, onStart, onApply }) {
  return (
    <div className='mt-5 flex justify-end space-x-3'>
      {phase === PHASE.IDLE && (
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onStart} disabled={!connected}>
            Start calibration
          </PrimaryButton>
        </>
      )}
      {(phase === PHASE.RUNNING || phase === PHASE.ANALYZING) && (
        <PrimaryButton disabled className='opacity-60'>
          <FontAwesomeIcon icon={faSpinner} spin />
          <span className='ml-2'>
            {phase === PHASE.RUNNING ? 'Running shot...' : 'Analyzing...'}
          </span>
        </PrimaryButton>
      )}
      {phase === PHASE.DONE && !saved && (
        <>
          <SecondaryButton onClick={onClose}>Discard</SecondaryButton>
          <PrimaryButton onClick={onApply} disabled={saving}>
            {saving && <FontAwesomeIcon icon={faSpinner} spin />}
            <span className={saving ? 'ml-2' : ''}>{saving ? 'Saving...' : 'Save to machine'}</span>
          </PrimaryButton>
        </>
      )}
      {phase === PHASE.DONE && saved && <PrimaryButton onClick={onClose}>Done</PrimaryButton>}
      {phase === PHASE.ERROR && (
        <>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          <PrimaryButton onClick={onStart}>Retry</PrimaryButton>
        </>
      )}
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

const LOG_TONE_CLASS = {
  err: 'text-red-400',
  ok: 'text-green-400',
  warn: 'text-yellow-300',
};
const LOG_TONE_PREFIX = { err: '✗', ok: '✓', warn: '!' };

function LogPanel({ logs }) {
  return (
    <div className='mt-4 max-h-48 overflow-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-100'>
      {logs.map(l => (
        <div key={l.key} className={LOG_TONE_CLASS[l.tone] || ''}>
          {LOG_TONE_PREFIX[l.tone] || '›'} {l.msg}
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

function PrimaryButton({ children, className = '', ...rest }) {
  return (
    <button
      type='button'
      className={`flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, className = '', ...rest }) {
  return (
    <button
      type='button'
      className={`rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
