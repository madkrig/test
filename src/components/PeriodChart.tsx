import type { PeriodBucket } from "../lib/aggregate";

export function PeriodChart({ buckets }: { buckets: PeriodBucket[] }) {
  const years = Array.from(new Set(buckets.map((b) => b.year))).sort();
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="flex h-56 items-stretch gap-4 overflow-x-auto pb-1">
      {years.map((year) => {
        const yearBuckets = buckets
          .filter((b) => b.year === year)
          .sort((a, b) => a.month - b.month);
        return (
          <div
            key={year}
            className="flex-1 min-w-[140px] flex flex-col border-r last:border-r-0 border-cedra-100 pr-4 last:pr-0"
          >
            <div className="text-xs font-medium text-cedra-700/70 text-center mb-1">
              {year}
            </div>
            <div className="flex-1 flex items-end gap-2 px-1">
              {yearBuckets.map((b) => (
                <div
                  key={b.month}
                  className="flex-1 flex flex-col items-center justify-end h-full group"
                >
                  <span className="text-[10px] text-cedra-800 font-medium mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {b.count.toLocaleString("da-DK")}
                  </span>
                  <div
                    className="w-full rounded-t-sm bg-cedra-600 group-hover:bg-cedra-700 transition-colors"
                    style={{ height: `${Math.max(4, (b.count / max) * 100)}%` }}
                  />
                  <span
                    className="text-[10px] text-cedra-700/60 mt-1 whitespace-nowrap origin-top-left"
                    style={{ transform: "rotate(-45deg) translate(-4px, 2px)" }}
                  >
                    {b.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
