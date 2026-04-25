export default function ResultsPanel({ results, currentCoeffs }) {
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
