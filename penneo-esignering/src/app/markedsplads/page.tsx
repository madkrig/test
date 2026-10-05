'use client';

import { useCallback, useState } from 'react';
import { PenneoSigningModal } from '../_components/PenneoSigningModal';

interface Item {
  id: string;
  icon: string;
  title: string;
  category: string;
  description: string;
  available: boolean;
  note?: string;
}

/** Ydelser på markedspladsen. Kun e-signering er en del af denne prototype. */
const ITEMS: Item[] = [
  {
    id: 'penneo',
    icon: '✍️',
    title: 'E-signering via Penneo',
    category: 'Afslutning',
    description: 'Send årsrapport, ledelseserklæring eller revisionsprotokollat til digital underskrift. Følg status i Opgaver – det underskrevne dokument arkiveres automatisk i SharePoint.',
    available: true,
  },
  {
    id: 'bank',
    icon: '🏦',
    title: 'Bankbekræftelser',
    category: 'Løbende',
    description: 'Indhent bankbekræftelser via Kerne: population, udsendelse, påmindelser og arkivering.',
    available: false,
    note: 'Separat prototype',
  },
  {
    id: 'advokat',
    icon: '⚖️',
    title: 'Advokatbrev',
    category: 'Planlægning',
    description: 'Bestil advokatbreve til kundens advokater.',
    available: false,
    note: 'Kommer senere',
  },
  {
    id: 'saldo',
    icon: '📨',
    title: 'Saldomeddelelser',
    category: 'Løbende',
    description: 'Send saldomeddelelser til kunder og leverandører.',
    available: false,
    note: 'Kommer senere',
  },
];

export default function Markedsplads() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const q = query.trim().toLowerCase();
  const items = ITEMS.filter((i) => !q || `${i.title} ${i.description} ${i.category}`.toLowerCase().includes(q));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Markedsplads</h1>
          <div className="muted">Vælg en ydelse, og bestil den direkte på din kunde.</div>
        </div>
        <input type="search" placeholder="Søg i ydelser …" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 280 }} />
      </div>

      <div className="tiles">
        {items.map((item) => (
          <div key={item.id} className={`tile ${item.available ? 'available' : 'unavailable'}`}>
            <div className="tile-top">
              <div className="tile-icon" aria-hidden="true">{item.icon}</div>
              <div>
                <h2>{item.title}</h2>
                <span className="tag">{item.category}</span>
              </div>
            </div>
            <p>{item.description}</p>
            <div className="tile-foot">
              {item.available ? (
                <>
                  <span className="tag gold">Penneo</span>
                  <button className="btn" onClick={() => setOpen(item.id)}>Start</button>
                </>
              ) : (
                <span className="muted small">{item.note}</span>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="muted">Ingen ydelser matcher søgningen.</div>}
      </div>

      {open === 'penneo' && <PenneoSigningModal onClose={close} />}
    </>
  );
}
