import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons/faSpinner';
import { PrimaryButton, SecondaryButton } from './Buttons.jsx';
import { PHASE } from './constants.js';

export default function ModalFooter({
  phase,
  saving,
  saved,
  connected,
  onClose,
  onStart,
  onApply,
}) {
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
