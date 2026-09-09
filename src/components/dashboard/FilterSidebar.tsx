import { ERKLAERINGER, REGIONS, ROLES } from "../../data/types";
import type { Filters } from "../../lib/aggregate";
import { MultiSelect, SingleSelect } from "../ui/Dropdown";
import { Panel } from "../ui/Panel";

export function FilterSidebar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  return (
    <Panel title="Indstillinger" className="lg:row-span-2">
      <p className="text-xs text-cedra-700/60 mb-4 leading-relaxed">
        Nedenfor vælges, hvilke kunder der skal indgå i værktøjet. Dette er
        baseret på dine roller i Cedra Audit.
      </p>
      <div className="space-y-4">
        <MultiSelect
          label="Erklæring"
          options={ERKLAERINGER}
          selected={filters.erklaeringer}
          onChange={(v) => onChange({ ...filters, erklaeringer: v })}
        />
        <SingleSelect
          label="Vis IA"
          options={["Ja", "Nej"]}
          value={filters.ia}
          onChange={(v) => onChange({ ...filters, ia: v as Filters["ia"] })}
        />
        <MultiSelect
          label="Region"
          options={REGIONS}
          selected={filters.regions}
          onChange={(v) => onChange({ ...filters, regions: v })}
        />
        <SingleSelect
          label="Rolle - kontorfordeling"
          options={ROLES}
          value={filters.role}
          onChange={(v) => onChange({ ...filters, role: v as Filters["role"] })}
        />
      </div>
    </Panel>
  );
}
