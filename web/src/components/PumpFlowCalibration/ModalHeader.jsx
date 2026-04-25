export default function ModalHeader({ busy, onClose }) {
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
