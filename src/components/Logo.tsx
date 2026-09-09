export function CedraMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <path
        d="M20 3 L34 11 V29 L20 37 L6 29 V11 Z"
        fill="none"
        stroke="#135b4b"
        strokeWidth="2.5"
      />
      <path d="M20 11 L28 15.5 V24.5 L20 29 L12 24.5 V15.5 Z" fill="#c9992e" />
    </svg>
  );
}

export function CedraLogo({
  tagline,
  className = "",
}: {
  tagline?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <CedraMark className="h-8 w-8 shrink-0" />
      <div className="leading-none">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight text-cedra-950">
            Cedra
          </span>
          {tagline && (
            <span className="text-sm text-cedra-700/70 font-normal">
              {tagline}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
