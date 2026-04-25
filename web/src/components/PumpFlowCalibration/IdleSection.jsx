export default function IdleSection({ currentCoeffs }) {
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
    </div>
  );
}
