import { useEffect, useState } from 'preact/hooks';

// Brief reconnect blips in ApiService (evt:status sets connected=true, _onClose
// sets false) would flash this banner otherwise. Only surface it after the
// connection stays down for long enough to be actionable.
const DISCONNECT_GRACE_MS = 1500;

export default function IdleSection({ currentCoeffs, connected }) {
  const [showDisconnected, setShowDisconnected] = useState(false);

  useEffect(() => {
    if (connected) {
      setShowDisconnected(false);
      return undefined;
    }
    const id = setTimeout(() => setShowDisconnected(true), DISCONNECT_GRACE_MS);
    return () => clearTimeout(id);
  }, [connected]);

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
      {showDisconnected && (
        <div className='rounded-md border border-red-500 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200'>
          Not connected to the machine. Wait for the connection to recover before starting.
        </div>
      )}
    </div>
  );
}
