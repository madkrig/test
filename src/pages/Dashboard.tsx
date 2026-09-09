import { useMemo, useState } from "react";
import { useData } from "../data/store";
import { ERKLAERINGER, OFFICES, REGIONS } from "../data/types";
import type { TaskStatus } from "../data/types";
import {
  aggregateTaskStatus,
  applyFilters,
  periodEndDateBuckets,
  statusPerOffice,
  statusPerPerson,
  statusPerTask,
} from "../lib/aggregate";
import type { Filters } from "../lib/aggregate";
import { FilterSidebar } from "../components/dashboard/FilterSidebar";
import { Panel } from "../components/ui/Panel";
import { PeriodChart } from "../components/PeriodChart";
import { StatusCircles } from "../components/StatusCircles";
import { TaskStatusTable } from "../components/dashboard/TaskStatusTable";
import { GroupStatusTable } from "../components/dashboard/GroupStatusTable";

const DEFAULT_FILTERS: Filters = {
  erklaeringer: [...ERKLAERINGER],
  ia: "Nej",
  regions: [...REGIONS],
  role: "Manager",
};

export function Dashboard() {
  const { clients } = useData();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [activeStatus, setActiveStatus] = useState<TaskStatus | null>(null);
  const [kontorView, setKontorView] = useState<"kontor" | "person">("kontor");

  const filtered = useMemo(() => applyFilters(clients, filters), [clients, filters]);

  const statusCounts = useMemo(() => aggregateTaskStatus(filtered), [filtered]);
  const buckets = useMemo(() => periodEndDateBuckets(filtered), [filtered]);
  const taskRows = useMemo(() => statusPerTask(filtered), [filtered]);
  const groupRows = useMemo(
    () =>
      kontorView === "kontor"
        ? statusPerOffice(filtered, OFFICES)
        : statusPerPerson(filtered),
    [filtered, kontorView],
  );

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight text-cedra-950">
          KUNDEOVERBLIK
        </h1>
        <p className="text-sm text-cedra-700/60 mt-1">
          {filtered.length.toLocaleString("da-DK")} kunder matcher de valgte filtre
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_1fr] gap-4 items-start">
        <FilterSidebar filters={filters} onChange={setFilters} />

        <Panel
          title="Kunder pr. period end date"
          subtitle="Viser antallet af kunder fordelt pr. balancedag. Marker de måneder du gerne vil kigge på."
        >
          <PeriodChart buckets={buckets} />
        </Panel>

        <Panel
          title="Opgaver fordelt pr. status"
          subtitle="Klik på nedenstående cirkler for at se hvilke opgaver og kunder hver status fordeler sig på."
        >
          <div className="h-56 flex items-center justify-center">
            <StatusCircles
              counts={statusCounts}
              active={activeStatus}
              onSelect={setActiveStatus}
            />
          </div>
        </Panel>

        <Panel
          title="Status pr. opgave"
          subtitle="Tryk på et opgavenavn for at se yderligere beskrivelse."
        >
          <TaskStatusTable rows={taskRows} activeStatus={activeStatus} />
        </Panel>

        <Panel
          title="Status pr. kontor"
          subtitle={`Status pr. ${kontorView === "kontor" ? "kontor" : "person"}.`}
          action={
            <button
              type="button"
              onClick={() =>
                setKontorView((v) => (v === "kontor" ? "person" : "kontor"))
              }
              className="text-xs font-medium text-cedra-700 border border-cedra-200 rounded-full px-3 py-1 hover:bg-cedra-50 whitespace-nowrap"
            >
              {kontorView === "kontor" ? "Vis status pr. person" : "Vis status pr. kontor"}
            </button>
          }
        >
          <div className="space-y-5 max-h-[420px] overflow-y-auto pr-1">
            <GroupStatusTable
              title={kontorView === "kontor" ? "Kontor (antal)" : "Person (antal)"}
              rows={groupRows}
              activeStatus={activeStatus}
            />
            <GroupStatusTable
              title={kontorView === "kontor" ? "Kontor (fordeling)" : "Person (fordeling)"}
              rows={groupRows}
              activeStatus={activeStatus}
              mode="percent"
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
