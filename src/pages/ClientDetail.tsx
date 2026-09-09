import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/store";
import { TASK_STATUSES } from "../data/types";
import type { TaskPhase, TaskStatus } from "../data/types";
import { ClientFormModal } from "../components/ClientFormModal";
import type { ClientFormValues } from "../components/ClientFormModal";
import { StatusPill, overallClientStatus } from "../components/StatusPill";
import { Panel } from "../components/ui/Panel";

const PHASE_ORDER: TaskPhase[] = ["Stamdata", "Planlægning", "Løbende", "Afslutning"];

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { clients, updateClient, updateTaskStatus, deleteClient } = useData();
  const navigate = useNavigate();
  const [showEdit, setShowEdit] = useState(false);

  const client = clients.find((c) => c.id === id);

  if (!client) {
    return (
      <div className="text-center py-16">
        <p className="text-cedra-700/70 mb-4">Kunden blev ikke fundet.</p>
        <Link to="/kunder" className="text-cedra-700 underline">
          Tilbage til kundeliste
        </Link>
      </div>
    );
  }

  const completed = client.tasks.filter((t) => t.status === "Udført").length;
  const progress = client.tasks.length
    ? Math.round((completed / client.tasks.length) * 100)
    : 0;

  function handleEditSubmit(values: ClientFormValues) {
    updateClient(client!.id, values);
    setShowEdit(false);
  }

  function handleDelete() {
    if (confirm(`Slet kunden "${client!.name}"? Dette kan ikke fortrydes.`)) {
      deleteClient(client!.id);
      navigate("/kunder");
    }
  }

  return (
    <div>
      <Link to="/kunder" className="text-sm text-cedra-700 hover:underline">
        ← Tilbage til kundeliste
      </Link>

      <div className="flex items-start justify-between gap-4 mt-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-cedra-950">
            {client.name}
          </h1>
          <p className="text-sm text-cedra-700/60 mt-1">
            CVR {client.cvr} · {client.office} · {client.region}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={overallClientStatus(client.tasks.map((t) => t.status))} />
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="px-4 py-1.5 text-sm rounded-full border border-cedra-200 text-cedra-800 hover:bg-cedra-50"
          >
            Rediger
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="px-4 py-1.5 text-sm rounded-full border border-red-200 text-red-600 hover:bg-red-50"
          >
            Slet kunde
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Sagsoplysninger">
          <dl className="text-sm space-y-2">
            <Row label="Erklæring" value={client.erklaering} />
            <Row label="Balancedag" value={formatDate(client.periodEndDate)} />
            <Row label="Ansvarlig" value={client.manager} />
            <Row label="Rolle" value={client.role} />
            <Row label="Intern audit (IA)" value={client.iaInvolved ? "Ja" : "Nej"} />
            <Row label="Fremdrift" value={`${progress}% udført (${completed}/${client.tasks.length})`} />
          </dl>
        </Panel>

        <Panel title="Opgaver" className="lg:col-span-2">
          <div className="space-y-4">
            {PHASE_ORDER.map((phase) => {
              const tasks = client.tasks.filter((t) => t.phase === phase);
              if (tasks.length === 0) return null;
              return (
                <div key={phase}>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-cedra-700/60 mb-1.5">
                    {phase}
                  </h3>
                  <div className="space-y-1">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between gap-3 py-1 border-b border-cedra-50 last:border-none"
                      >
                        <span className="text-sm text-cedra-950">{task.name}</span>
                        <select
                          value={task.status}
                          onChange={(e) =>
                            updateTaskStatus(client.id, task.id, e.target.value as TaskStatus)
                          }
                          className="text-xs rounded-full border border-cedra-200 px-2 py-1 bg-white"
                        >
                          {TASK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {showEdit && (
        <ClientFormModal
          title="Rediger kunde"
          initial={client}
          onSubmit={handleEditSubmit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-cedra-700/60">{label}</dt>
      <dd className="font-medium text-cedra-950 text-right">{value}</dd>
    </div>
  );
}
