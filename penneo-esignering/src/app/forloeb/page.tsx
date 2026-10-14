'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { E_SIGNING_WORKFLOW } from '@/domain/e-signing';
import { WorkflowDiagram } from '../_components/WorkflowDiagram';
import { WorkflowSteps } from '../_components/WorkflowSteps';

const workflow = E_SIGNING_WORKFLOW;

function Forloeb() {
  const initial = useSearchParams().get('step');
  const [selected, setSelected] = useState<string | null>(initial);

  // Et link som /forloeb?step=archive#step-archive åbner med trinnet markeret i både diagram og liste.
  useEffect(() => {
    if (initial) document.getElementById(`step-${initial}`)?.scrollIntoView({ block: 'center' });
  }, [initial]);

  function select(key: string, scrollToRow: boolean) {
    setSelected(key);
    window.history.replaceState(null, '', `?step=${encodeURIComponent(key)}#step-${key}`);
    if (scrollToRow) document.getElementById(`step-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <>
      <div className="topline"><span>Forløb</span><span>{workflow.title} · {workflow.steps.length} trin</span></div>
      <section className="card">
        <h2>Sådan kører et e-signeringsforløb</h2>
        <p>Tegnet ud fra forløbets trin og ruter – samme statusmodel, som Opgaver bruger. Klik på et trin for at finde det i listen.</p>
        <WorkflowDiagram workflow={workflow} selected={selected} onSelect={(key) => select(key, true)} />
      </section>
      <section className="card">
        <h2>Trin og ruter</h2>
        <p>Hvem gør hvad, og hvor forløbet går hen bagefter. Ruter markeret med webhook udløses af Penneo.</p>
        <WorkflowSteps workflow={workflow} selected={selected} onSelect={(key) => select(key, false)} />
      </section>
    </>
  );
}

export default function ForloebPage() {
  return (
    <Suspense fallback={<p className="progress">Henter …</p>}>
      <Forloeb />
    </Suspense>
  );
}
