'use client';

import { useCallback, useState } from 'react';
import { PenneoSigningModal } from '../_components/PenneoSigningModal';

interface Offer {
  id: string;
  title: string;
  category: string;
  description: string;
  available: boolean;
  note?: string;
}

/** Ydelser på markedspladsen. Kun e-signering er en del af denne prototype. */
const OFFERS: Offer[] = [
  {
    id: 'penneo',
    title: 'E-signering via Penneo',
    category: 'Afslutning',
    description: 'Send årsrapport, ledelseserklæring eller revisionsprotokollat til digital underskrift. Følg status i Opgaver – det underskrevne dokument arkiveres automatisk i SharePoint.',
    available: true,
  },
  {
    id: 'bank',
    title: 'Bankbekræftelser',
    category: 'Løbende',
    description: 'Indhent bankbekræftelser via Kerne: population, udsendelse, påmindelser og arkivering.',
    available: false,
    note: 'Separat prototype',
  },
  {
    id: 'advokat',
    title: 'Advokatbrev',
    category: 'Planlægning',
    description: 'Bestil advokatbreve til kundens advokater.',
    available: false,
    note: 'Kommer senere',
  },
  {
    id: 'saldo',
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
  const offers = OFFERS.filter((o) => !q || `${o.title} ${o.description} ${o.category}`.toLowerCase().includes(q));
  const available = OFFERS.filter((o) => o.available).length;

  return (
    <>
      <div className="topline"><span>Markedsplads</span><span>{available} af {OFFERS.length} ydelser tilgængelige</span></div>
      <section className="card">
        <h2>Bestil en ydelse</h2>
        <p>Vælg en ydelse, og bestil den direkte på din kunde. Status følger du under Opgaver.</p>
        <input className="search" type="search" aria-label="Søg i ydelser" placeholder="Søg i ydelser …" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="catalog">
          {offers.map((o) => (
            <article key={o.id} className={`offer ${o.available ? '' : 'muted'}`}>
              <span className="eyebrow">{o.category}</span>
              <h3>{o.title}</h3>
              <p>{o.description}</p>
              <div className="offer-foot">
                {o.available ? (
                  <>
                    <small>Penneo · SharePoint</small>
                    <button onClick={() => setOpen(o.id)}>Start e-signering</button>
                  </>
                ) : (
                  <small>{o.note}</small>
                )}
              </div>
            </article>
          ))}
        </div>
        {offers.length === 0 && <p className="help">Ingen ydelser matcher søgningen.</p>}
      </section>
      {open === 'penneo' && <PenneoSigningModal onClose={close} />}
    </>
  );
}
