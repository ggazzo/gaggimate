const LOG_TONE_CLASS = {
  err: 'text-red-400',
  ok: 'text-green-400',
  warn: 'text-yellow-300',
};

const LOG_TONE_PREFIX = { err: '✗', ok: '✓', warn: '!' };

export default function LogPanel({ logs }) {
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
