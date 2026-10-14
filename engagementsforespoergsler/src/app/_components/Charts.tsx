'use client';

import { useState } from 'react';

/**
 * Små diagrammer efter dataviz-metoden: én farvetone (Cedras grønne), tynde
 * søjler (≤ 24 px) med 4 px afrundet top fra én basislinje, 2 px luft mellem
 * søjler, hårfine gitterlinjer, sparsomme direkte etiketter og en tooltip på
 * hover og tastaturfokus. Alle værdier findes også i tabelvisningen.
 */
export interface ColumnDatum { key: string; label: string; value: number; emphasis?: boolean; detail?: string }

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function ColumnChart({ data, unit, title, max, labelEvery = 1 }: { data: ColumnDatum[]; unit: string; title: string; max?: number; labelEvery?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const top = max ?? niceMax(Math.max(1, ...data.map((d) => d.value)));
  const ticks = [0, top / 2, top];
  const current = data.find((d) => d.key === active);
  // Sparsom etikettering: kun den højeste søjle får en værdi; resten ligger i tooltip og tabel.
  const peakKey = data.reduce<ColumnDatum | null>((a, d) => (d.value > 0 && (!a || d.value > a.value) ? d : a), null)?.key;
  return (
    <figure className="viz" aria-label={title}>
      <figcaption className="viz-title">{title}</figcaption>
      <div className="viz-plot">
        <div className="viz-canvas">
          {ticks.map((t) => (
            <div key={t} className="viz-grid" style={{ bottom: `${(t / top) * 100}%` }}><span aria-hidden="true">{t >= 1000 ? `${t / 1000}K` : t}</span></div>
          ))}
          <div className="viz-cols">
            {data.map((d, i) => (
              <div
                key={d.key}
                className={`viz-col${d.emphasis ? ' emph' : ''}${active === d.key ? ' hover' : ''}`}
                tabIndex={0}
                role="img"
                aria-label={`${d.label}: ${d.value} ${unit}${d.detail ? `. ${d.detail}` : ''}`}
                onPointerEnter={() => setActive(d.key)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(d.key)}
                onBlur={() => setActive(null)}
              >
                {d.key === peakKey && <span className="viz-value" style={{ bottom: `${(d.value / top) * 100}%` }}>{d.value}</span>}
                <div className="viz-bar" style={{ height: `${(d.value / top) * 100}%` }} />
                <span className="viz-x" aria-hidden="true">{i % labelEvery === 0 ? d.label : ''}</span>
              </div>
            ))}
          </div>
          {current && (
            <div className="viz-tip" role="status" style={{ left: `${((data.indexOf(current) + 0.5) / data.length) * 100}%`, bottom: `${Math.min(100, (current.value / top) * 100)}%` }}>
              <strong>{current.value} {unit}</strong>
              <span>{current.label}</span>
              {current.detail && <small>{current.detail}</small>}
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}

/** Vandrette søjler, sorteret; værdien står ved søjlens ende. */
export function BarList({ data, unit, title }: { data: { label: string; value: number }[]; unit: string; title: string }) {
  const top = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="viz" aria-label={title}>
      <figcaption className="viz-title">{title}</figcaption>
      {data.length === 0 ? <p className="muted">Ingen i perioden.</p> : (
        <ul className="viz-barlist">
          {[...data].sort((a, b) => b.value - a.value).map((d) => (
            <li key={d.label} tabIndex={0} title={`${d.label}: ${d.value} ${unit}`}>
              <span className="viz-bl-label">{d.label}</span>
              <span className="viz-bl-track"><span className="viz-bl-bar" style={{ width: `${Math.max(2, (d.value / top) * 100)}%` }} /><span className="viz-bl-value">{d.value}</span></span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
