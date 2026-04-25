import { useCallback } from 'preact/hooks';
import { computed } from '@preact/signals';
import { machine } from '../../services/ApiService.js';
import IdleSection from './IdleSection.jsx';
import LogPanel from './LogPanel.jsx';
import ModalFooter from './ModalFooter.jsx';
import ModalHeader from './ModalHeader.jsx';
import ResultsPanel from './ResultsPanel.jsx';
import { usePumpFlowCalibration } from './usePumpFlowCalibration.js';
import { PHASE } from './utils.js';

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
