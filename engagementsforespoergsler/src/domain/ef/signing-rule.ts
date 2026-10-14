/**
 * Tegningsregler fra CVR (FR-02, US-K-04). Standardformuleringer fortolkes
 * automatisk; alt andet markeres til manuel vurdering af kernemedarbejderen.
 */
export type ManagementRole = 'DIREKTOER' | 'FORMAND' | 'BESTYRELSESMEDLEM';
type Group = 'DIREKTOER' | 'BESTYRELSE' | 'FORMAND';

export interface Requirement {
  group: Group;
  count: number | 'ALLE';
}
export type Alternative = Requirement[];

const NUMBERS: Record<string, number> = { en: 1, én: 1, et: 1, ét: 1, to: 2, tre: 3, '1': 1, '2': 2, '3': 3 };

function parsePart(part: string): Requirement | null {
  const p = part.replace(/\s+i forening$/, '').replace(/\s+alene$/, '').trim();
  if (/^(direktionen|den samlede direktion)$/.test(p)) return { group: 'DIREKTOER', count: 'ALLE' };
  if (/^(den samlede bestyrelse|bestyrelsen)$/.test(p)) return { group: 'BESTYRELSE', count: 'ALLE' };
  if (/^(bestyrelsens formand|bestyrelsesformanden|formanden for bestyrelsen)$/.test(p)) return { group: 'FORMAND', count: 1 };
  let m = p.match(/^(\S+) (direktør|direktører|direktionsmedlem|direktionsmedlemmer|medlem af direktionen|medlemmer af direktionen)$/);
  if (m && NUMBERS[m[1]!]) return { group: 'DIREKTOER', count: NUMBERS[m[1]!]! };
  m = p.match(/^(\S+) (bestyrelsesmedlem|bestyrelsesmedlemmer|medlem af bestyrelsen|medlemmer af bestyrelsen)$/);
  if (m && NUMBERS[m[1]!]) return { group: 'BESTYRELSE', count: NUMBERS[m[1]!]! };
  return null;
}

/** Fortolker tegningsreglen. Returnerer null, hvis den ikke kan fortolkes automatisk. */
export function parseSigningRule(text: string): Alternative[] | null {
  const body = text
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/^\s*(selskabet|virksomheden|foreningen|fonden)\s+tegnes\s+af\s+/, '')
    .trim();
  if (!body) return null;
  const alternatives: Alternative[] = [];
  for (const alt of body.split(/\s*,?\s+eller\s+(?:af\s+)?/)) {
    const parts = alt.split(/\s+i forening med\s+|\s+og\s+/);
    const reqs = parts.map(parsePart);
    if (reqs.some((r) => r === null)) return null;
    alternatives.push(reqs as Requirement[]);
  }
  return alternatives;
}

export interface Person {
  unitNumber: string;
  name: string;
  role: ManagementRole;
}

const inGroup = (role: ManagementRole, group: Group) =>
  group === 'DIREKTOER' ? role === 'DIREKTOER' : group === 'FORMAND' ? role === 'FORMAND' : role === 'FORMAND' || role === 'BESTYRELSESMEDLEM';

const GROUP_LABEL: Record<Group, [string, string]> = {
  DIREKTOER: ['direktør', 'direktører'],
  BESTYRELSE: ['bestyrelsesmedlem', 'bestyrelsesmedlemmer'],
  FORMAND: ['bestyrelsesformanden', 'bestyrelsesformanden'],
};

export function describeAlternative(alt: Alternative): string {
  return alt.map((r) => (r.count === 'ALLE'
    ? r.group === 'DIREKTOER' ? 'hele direktionen' : 'hele bestyrelsen'
    : r.group === 'FORMAND' ? 'bestyrelsesformanden' : `${r.count} ${GROUP_LABEL[r.group][r.count === 1 ? 0 : 1]}`)).join(' i forening med ');
}

export type SignerCheck =
  | { status: 'OK'; alternative: string }
  | { status: 'MANGLER'; missing: string[]; alternative: string }
  | { status: 'MANUEL'; reason: string };

/**
 * Opfylder underskriverne tegningsreglen på underskriftsdatoen? `management`
 * er ledelsen på den dato; én person kan kun udfylde ét krav pr. alternativ.
 */
export function checkSigners(ruleText: string, signerUnits: string[], management: Person[]): SignerCheck {
  const alternatives = parseSigningRule(ruleText);
  if (!alternatives) return { status: 'MANUEL', reason: 'Tegningsreglen kan ikke fortolkes automatisk og skal vurderes manuelt.' };
  const signers = management.filter((p) => signerUnits.includes(p.unitNumber));
  let best: { missing: string[]; alternative: string; extra: number } | null = null;

  for (const alt of alternatives) {
    const missing: string[] = [];
    let extra = 0; // antal personer, der mangler at skrive under
    const used = new Set<string>();
    // "Alle"-krav først: hver person i gruppen skal have underskrevet.
    for (const req of alt.filter((r) => r.count === 'ALLE')) {
      for (const person of management.filter((p) => inGroup(p.role, req.group))) {
        if (signers.some((s) => s.unitNumber === person.unitNumber)) used.add(person.unitNumber);
        else { missing.push(person.name); extra += 1; }
      }
    }
    // Tællende krav: snævreste gruppe først, så formanden ikke "bruges op" som menigt medlem.
    const counted = alt.filter((r) => r.count !== 'ALLE').sort((a, b) => (a.group === 'FORMAND' ? -1 : b.group === 'FORMAND' ? 1 : 0));
    for (const req of counted) {
      const n = req.count as number;
      const candidates = signers.filter((s) => !used.has(s.unitNumber) && inGroup(s.role, req.group))
        .sort((a, b) => Number(a.role === 'FORMAND') - Number(b.role === 'FORMAND'));
      candidates.slice(0, n).forEach((s) => used.add(s.unitNumber));
      if (candidates.length < n) {
        const lack = n - candidates.length;
        extra += lack;
        missing.push(req.group === 'FORMAND' ? 'bestyrelsesformanden' : `${lack} ${GROUP_LABEL[req.group][lack === 1 ? 0 : 1]}`);
      }
    }
    const description = describeAlternative(alt);
    if (missing.length === 0) return { status: 'OK', alternative: description };
    if (!best || extra < best.extra) best = { missing, alternative: description, extra };
  }
  return { status: 'MANGLER', missing: best!.missing, alternative: best!.alternative };
}

/** Foreslåede underskrivere: den mindste kreds, der opfylder et af alternativerne. */
export function proposeSigners(ruleText: string, management: Person[]): Person[] | null {
  const alternatives = parseSigningRule(ruleText);
  if (!alternatives) return null;
  let best: Person[] | null = null;
  for (const alt of alternatives) {
    const chosen: Person[] = [];
    let feasible = true;
    for (const req of alt) {
      const pool = management.filter((p) => inGroup(p.role, req.group) && !chosen.includes(p));
      const need = req.count === 'ALLE' ? pool.length : req.count;
      if (pool.length < need || need === 0) { feasible = false; break; }
      chosen.push(...pool.sort((a, b) => Number(a.role === 'FORMAND') - Number(b.role === 'FORMAND')).slice(0, need));
    }
    // Ved lige mange personer foretrækkes et alternativ med direktionen – den daglige kontakt.
    const better = !best || chosen.length < best.length
      || (chosen.length === best.length && chosen.some((p) => p.role === 'DIREKTOER') && !best.some((p) => p.role === 'DIREKTOER'));
    if (feasible && better) best = chosen;
  }
  return best;
}
