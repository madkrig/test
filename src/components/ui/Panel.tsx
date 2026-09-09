import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-white rounded-xl border border-cedra-100 shadow-sm flex flex-col ${className}`}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div>
            {title && (
              <h2 className="text-[15px] font-semibold text-cedra-950">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-cedra-700/60 mt-0.5">{subtitle}</p>
            )}
          </div>
          {action}
        </div>
      )}
      <div className="px-5 pb-5 flex-1 min-h-0">{children}</div>
    </section>
  );
}
