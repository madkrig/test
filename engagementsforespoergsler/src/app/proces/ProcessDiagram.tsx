'use client';

import { useState } from 'react';
import { EF_WORKFLOW } from '@/domain/ef/workflow';
import { WorkflowDiagram } from '../_components/WorkflowDiagram';
import { WorkflowSteps } from '../_components/WorkflowSteps';

/** Statusmodellen som diagram og trin-tabel. Klik i det ene markerer i det andet. */
export function ProcessDiagram() {
  const [selected, setSelected] = useState<string | null>(null);
  function select(key: string, scroll: boolean) {
    setSelected(key);
    if (scroll) document.getElementById(`step-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return (
    <>
      <WorkflowDiagram workflow={EF_WORKFLOW} selected={selected} onSelect={(k) => select(k, true)} label="Forespørgslens forløb" />
      <h3>Trin og ruter</h3>
      <WorkflowSteps workflow={EF_WORKFLOW} selected={selected} onSelect={(k) => select(k, false)} />
    </>
  );
}
