import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

function DropdownShell({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <label className="block text-[11px] font-medium text-cedra-700/70 mb-1">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-cedra-200 bg-cedra-50/60 px-3 py-1.5 text-sm text-cedra-950 hover:border-cedra-400 transition-colors"
      >
        <span className="truncate">{summary}</span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M0 0 L5 6 L10 0 Z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-md border border-cedra-200 bg-white shadow-lg py-1">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function SingleSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  allLabel = "(Alle)",
}: {
  label: string;
  options: T[];
  value: T | "Alle";
  onChange: (v: T | "Alle") => void;
  allLabel?: string;
}) {
  const summary = value === "Alle" ? allLabel : value;
  return (
    <DropdownShell label={label} summary={summary}>
      {(close) => (
        <ul className="text-sm">
          <li>
            <button
              type="button"
              onClick={() => {
                onChange("Alle");
                close();
              }}
              className={`w-full text-left px-3 py-1.5 hover:bg-cedra-50 ${
                value === "Alle" ? "font-semibold text-cedra-800" : ""
              }`}
            >
              {allLabel}
            </button>
          </li>
          {options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt);
                  close();
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-cedra-50 ${
                  value === opt ? "font-semibold text-cedra-800" : ""
                }`}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </DropdownShell>
  );
}

export function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: T[];
  selected: T[];
  onChange: (v: T[]) => void;
}) {
  const allSelected = selected.length === options.length;
  const summary = allSelected
    ? "(Alle)"
    : selected.length === 0
      ? "(Ingen valgt)"
      : selected.length === 1
        ? selected[0]
        : `(${selected.length} valgt)`;

  function toggle(opt: T) {
    if (selected.includes(opt)) onChange(selected.filter((o) => o !== opt));
    else onChange([...selected, opt]);
  }

  return (
    <DropdownShell label={label} summary={summary}>
      {() => (
        <ul className="text-sm">
          <li className="border-b border-cedra-100 mb-1 pb-1">
            <button
              type="button"
              onClick={() => onChange(allSelected ? [] : [...options])}
              className="w-full text-left px-3 py-1.5 hover:bg-cedra-50 font-medium text-cedra-700"
            >
              {allSelected ? "Fravælg alle" : "Vælg alle"}
            </button>
          </li>
          {options.map((opt) => (
            <li key={opt}>
              <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-cedra-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-cedra-600"
                />
                {opt}
              </label>
            </li>
          ))}
        </ul>
      )}
    </DropdownShell>
  );
}
