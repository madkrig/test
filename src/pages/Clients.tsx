import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../data/store";
import { OFFICES, REGIONS, TASK_TEMPLATES } from "../data/types";
import type { Client } from "../data/types";
import { ClientFormModal } from "../components/ClientFormModal";
import type { ClientFormValues } from "../components/ClientFormModal";
import { StatusPill, overallClientStatus } from "../components/StatusPill";

const PAGE_SIZE = 20;

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export function Clients() {
  const { clients, addClient } = useData();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [office, setOffice] = useState<string>("Alle");
  const [region, setRegion] = useState<string>("Alle");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (office !== "Alle" && c.office !== office) return false;
      if (region !== "Alle" && c.region !== region) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.cvr.includes(q)) return false;
      return true;
    });
  }, [clients, search, office, region]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClients = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleCreate(values: ClientFormValues) {
    const created = addClient({
      ...values,
      tasks: TASK_TEMPLATES.map((t, i) => ({
        id: `${t.phase}-${i}-${Date.now()}`,
        phase: t.phase,
        name: t.name,
        status: "Ej udført" as const,
      })),
    });
    setShowForm(false);
    navigate(`/kunder/${created.id}`);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-cedra-950">
            Kunder
          </h1>
          <p className="text-sm text-cedra-700/60 mt-1">
            {filtered.length.toLocaleString("da-DK")} kunder
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-medium rounded-full bg-cedra-700 text-white hover:bg-cedra-800"
        >
          + Opret ny kunde
        </button>
      </div>

      <div className="bg-white rounded-xl border border-cedra-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-cedra-100">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Søg på navn eller CVR..."
            className="flex-1 min-w-[200px] rounded-md border border-cedra-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cedra-400"
          />
          <select
            value={office}
            onChange={(e) => {
              setOffice(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-cedra-200 px-3 py-1.5 text-sm bg-white"
          >
            <option>Alle</option>
            {OFFICES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <select
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-cedra-200 px-3 py-1.5 text-sm bg-white"
          >
            <option>Alle</option>
            {REGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-cedra-700/60 border-b border-cedra-100">
                <th className="px-4 py-2 font-medium">Kunde</th>
                <th className="px-4 py-2 font-medium">CVR</th>
                <th className="px-4 py-2 font-medium">Kontor</th>
                <th className="px-4 py-2 font-medium">Region</th>
                <th className="px-4 py-2 font-medium">Erklæring</th>
                <th className="px-4 py-2 font-medium">Balancedag</th>
                <th className="px-4 py-2 font-medium">Ansvarlig</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {pageClients.map((c: Client) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/kunder/${c.id}`)}
                  className="border-b border-cedra-50 last:border-none hover:bg-cedra-50/70 cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium text-cedra-950">{c.name}</td>
                  <td className="px-4 py-2 text-cedra-700/70">{c.cvr}</td>
                  <td className="px-4 py-2">{c.office}</td>
                  <td className="px-4 py-2">{c.region}</td>
                  <td className="px-4 py-2">{c.erklaering}</td>
                  <td className="px-4 py-2 tabular-nums">{formatDate(c.periodEndDate)}</td>
                  <td className="px-4 py-2">{c.manager}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={overallClientStatus(c.tasks.map((t) => t.status))} />
                  </td>
                </tr>
              ))}
              {pageClients.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-cedra-700/50">
                    Ingen kunder matcher søgningen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 text-sm text-cedra-700/60">
          <span>
            Side {page} af {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 rounded-full border border-cedra-200 disabled:opacity-40 hover:bg-cedra-50"
            >
              Forrige
            </button>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded-full border border-cedra-200 disabled:opacity-40 hover:bg-cedra-50"
            >
              Næste
            </button>
          </div>
        </div>
      </div>

      {showForm && (
        <ClientFormModal
          title="Opret ny kunde"
          onSubmit={handleCreate}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
