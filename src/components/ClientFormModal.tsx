import { useState } from "react";
import type { FormEvent } from "react";
import {
  ERKLAERINGER,
  OFFICES,
  REGIONS,
  ROLES,
} from "../data/types";
import type { Client } from "../data/types";

export interface ClientFormValues {
  name: string;
  cvr: string;
  office: Client["office"];
  region: Client["region"];
  erklaering: Client["erklaering"];
  manager: string;
  role: Client["role"];
  iaInvolved: boolean;
  periodEndDate: string;
}

const EMPTY: ClientFormValues = {
  name: "",
  cvr: "",
  office: OFFICES[0],
  region: REGIONS[0],
  erklaering: ERKLAERINGER[0],
  manager: "",
  role: ROLES[0],
  iaInvolved: false,
  periodEndDate: new Date().toISOString().slice(0, 10),
};

export function ClientFormModal({
  initial,
  title,
  onSubmit,
  onClose,
}: {
  initial?: Partial<ClientFormValues>;
  title: string;
  onSubmit: (values: ClientFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<ClientFormValues>({ ...EMPTY, ...initial });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.name.trim() || !values.cvr.trim()) return;
    onSubmit(values);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-cedra-950/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold text-cedra-950">{title}</h2>

        <div className="grid grid-cols-2 gap-4">
          <label className="col-span-2 text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">
              Kundenavn
            </span>
            <input
              required
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cedra-400"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">CVR</span>
            <input
              required
              pattern="[0-9]{8}"
              title="8 cifre"
              value={values.cvr}
              onChange={(e) => setValues({ ...values, cvr: e.target.value })}
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cedra-400"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">
              Balancedag
            </span>
            <input
              type="date"
              required
              value={values.periodEndDate}
              onChange={(e) => setValues({ ...values, periodEndDate: e.target.value })}
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cedra-400"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">Kontor</span>
            <select
              value={values.office}
              onChange={(e) =>
                setValues({ ...values, office: e.target.value as Client["office"] })
              }
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm bg-white"
            >
              {OFFICES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">Region</span>
            <select
              value={values.region}
              onChange={(e) =>
                setValues({ ...values, region: e.target.value as Client["region"] })
              }
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm bg-white"
            >
              {REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">
              Erklæring
            </span>
            <select
              value={values.erklaering}
              onChange={(e) =>
                setValues({
                  ...values,
                  erklaering: e.target.value as Client["erklaering"],
                })
              }
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm bg-white"
            >
              {ERKLAERINGER.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">Rolle</span>
            <select
              value={values.role}
              onChange={(e) =>
                setValues({ ...values, role: e.target.value as Client["role"] })
              }
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm bg-white"
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs font-medium text-cedra-700/70 mb-1">
              Ansvarlig
            </span>
            <input
              required
              value={values.manager}
              onChange={(e) => setValues({ ...values, manager: e.target.value })}
              className="w-full rounded-md border border-cedra-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cedra-400"
            />
          </label>

          <label className="flex items-center gap-2 text-sm pt-5">
            <input
              type="checkbox"
              checked={values.iaInvolved}
              onChange={(e) => setValues({ ...values, iaInvolved: e.target.checked })}
              className="accent-cedra-600"
            />
            Intern audit (IA) involveret
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-full border border-cedra-200 text-cedra-800 hover:bg-cedra-50"
          >
            Annuller
          </button>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm rounded-full bg-cedra-700 text-white hover:bg-cedra-800"
          >
            Gem
          </button>
        </div>
      </form>
    </div>
  );
}
