// Genererer tynde Next.js route handlers ud fra scripts/routes.spec.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const spec = JSON.parse(readFileSync('scripts/routes.spec.json', 'utf8'));
const byPath = new Map();
for (const [path, method, schema, call, doc] of spec) {
  if (!byPath.has(path)) byPath.set(path, []);
  byPath.get(path).push({ method, schema, call, doc });
}
for (const [path, routes] of byPath) {
  const dir = `src/app/api/${path}`;
  mkdirSync(dir, { recursive: true });
  const schemas = [...new Set(routes.map((r) => r.schema).filter(Boolean))];
  const services = ['authorizations', 'bankConfirmations', 'bankRegister', 'bankTasks', 'completeness', 'reviewer', 'listEvents', 'prisma'].filter((s) => routes.some((r) => r.call.includes(s)));
  const usesParams = routes.some((r) => r.call.includes('params.'));
  const lines = ['// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.', "import { handler } from '@/app/api/_lib/handler';"];
  if (schemas.length) lines.push(`import { ${schemas.join(', ')} } from '@/app/api/_lib/schemas';`);
  if (services.length) lines.push(`import { ${services.join(', ')} } from '@/services';`);
  lines.push('');
  for (const r of routes) {
    const parts = ['actor'];
    if (r.schema) parts.push('body');
    if (usesParams && r.call.includes('params.')) parts.push('params');
    if (r.call.includes('query.')) parts.push('query');
    if (r.call.includes('idempotencyKey')) parts.push('idempotencyKey');
    const destructured = parts.filter((p) => r.call.includes(p) || p === 'actor').join(', ');
    lines.push(`/** ${r.method} /api/${path} – ${r.doc} */`);
    lines.push(`export const ${r.method} = handler(${r.schema ?? 'undefined'}, ({ ${destructured} }) => ${r.call});`);
    lines.push('');
  }
  writeFileSync(`${dir}/route.ts`, lines.join('\n'));
}
// API-dokumentation
const doc = ['# API-kontrakt', '', 'Genereret fra `scripts/routes.spec.json`. Alle kald kræver headeren `x-user-id` (prototype-auth).', 'Mutationer returnerer `{ data, nextAction, nextOwner }`. Fejl returnerer `{ error: { code, message, reasons?, owner?, recovery?, existingId? } }`.', 'Udsendelse, påmindelse, modtagelse og upload kræver headeren `Idempotency-Key`.', '', '| Metode | Sti | Beskrivelse | Body |', '|---|---|---|---|'];
for (const [path, method, schema, , d] of spec) doc.push(`| ${method} | \`/api/${path.replace(/\[(\w+)\]/g, ':$1')}\` | ${d} | ${schema ? '`' + schema.replace('Schema', '') + '`' : '–'} |`);
doc.push('', 'Body-skemaer er defineret med Zod i `src/app/api/_lib/schemas.ts`.', '', '## Fejlkoder', '', '| Kode | HTTP | Betydning |', '|---|---|---|', '| VALIDATION | 400 | Ugyldige eller manglende data |', '| FORBIDDEN | 403 | Rollen eller engagementstilknytningen giver ikke adgang (logges) |', '| NOT_FOUND | 404 | Objektet findes ikke |', '| CONFLICT | 409 | Dublet eller allerede udført |', '| INVALID_STATE | 409 | Forudsætning mangler – `reasons` angiver hvilke |', '| INTEGRATION | 502 | Integrationsfejl (fx SharePoint) – tilstanden er gemt med recovery action |');
writeFileSync('docs/api.md', doc.join('\n') + '\n');
console.log(`${byPath.size} route-filer, ${spec.length} endpoints`);
