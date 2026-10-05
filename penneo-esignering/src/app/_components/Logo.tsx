export function CedraMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <path d="M20 3 L34 11 V29 L20 37 L6 29 V11 Z" fill="none" stroke="#135b4b" strokeWidth="2.5" />
      <path d="M20 11 L28 15.5 V24.5 L20 29 L12 24.5 V15.5 Z" fill="#c9992e" />
    </svg>
  );
}
