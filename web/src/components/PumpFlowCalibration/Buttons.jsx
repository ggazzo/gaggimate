export function PrimaryButton({ children, className = '', ...rest }) {
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

export function SecondaryButton({ children, className = '', ...rest }) {
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
