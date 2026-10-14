import { addMonths, type IsoDate } from './dates';
import type { RuleParams } from './rules';
import type { AuthCheck, AuthStatus } from './statuses';

/**
 * Fuldmagtskontrol (P04, figur 6, FR-01–FR-06). Resultatet er Gyldig,
 * Bør fornyes, Skal fornyes eller Mangler – med reglens ID som årsag.
 */
export interface AuthRecord {
  id: string;
  status: AuthStatus;
  scope: 'GENEREL' | 'BANKSPECIFIK';
  instituteId: string | null;
  holderCvr: string;
  signedDate: string | null;
  signerUnits: string[];
}

export interface AuthContext {
  today: IsoDate;
  signingRuleChangedAt: IsoDate;
  /** Personer i ledelsen med fra/til-datoer (CVR). */
  management: { unitNumber: string; from: IsoDate; to: IsoDate | null }[];
  institute?: { id: string; authRequirement: 'GENEREL' | 'BANKSPECIFIK'; authMaxAgeMonths: number | null } | null;
}

export interface AuthEvaluation {
  result: AuthCheck;
  ruleId: string | null;
  reason: string;
  authId: string | null;
}

const USABLE: AuthStatus[] = ['GYLDIG', 'BOER_FORNYES', 'SKAL_FORNYES'];
const RANK: Record<AuthCheck, number> = { GYLDIG: 0, BOER_FORNYES: 1, SKAL_FORNYES: 2, MANGLER: 3 };

function evaluateOne(auth: AuthRecord, ctx: AuthContext, params: RuleParams): AuthEvaluation {
  const base = { authId: auth.id };
  if (auth.holderCvr !== params.holderCvr) {
    const previous = params.previousHolders.includes(auth.holderCvr);
    return { ...base, result: 'SKAL_FORNYES', ruleId: 'FR-03', reason: previous ? 'Udstedt til en tidligere Cedra-enhed – ugyldig, indtil beslutning D1 siger andet.' : 'Udstedt til en anden revisor (fx carve-out).' };
  }
  if (auth.signedDate && ctx.signingRuleChangedAt > auth.signedDate) {
    return { ...base, result: 'SKAL_FORNYES', ruleId: 'FR-04', reason: 'Tegningsreglen er ændret efter underskrift.' };
  }
  const maxAge = ctx.institute?.authMaxAgeMonths;
  if (maxAge && auth.signedDate && addMonths(auth.signedDate, maxAge) < ctx.today) {
    return { ...base, result: 'SKAL_FORNYES', ruleId: 'FR-06', reason: `Ældre end instituttets maksimum på ${maxAge} måneder.` };
  }
  const resigned = auth.signerUnits.filter((u) => {
    const person = ctx.management.find((p) => p.unitNumber === u);
    return !person || (person.to !== null && person.to < ctx.today);
  });
  if (resigned.length > 0) {
    return { ...base, result: 'BOER_FORNYES', ruleId: 'FR-05', reason: 'En underskriver er udtrådt af ledelsen; tegningsreglen er uændret.' };
  }
  return { ...base, result: 'GYLDIG', ruleId: null, reason: 'Gyldig stående fuldmagt.' };
}

export function evaluateAuthorization(auths: AuthRecord[], ctx: AuthContext, params: RuleParams): AuthEvaluation {
  if (auths.some((a) => a.status === 'TILBAGEKALDT') && !auths.some((a) => USABLE.includes(a.status) && a.status !== 'SKAL_FORNYES')) {
    return { result: 'MANGLER', ruleId: 'FR-07', reason: 'Fuldmagten er tilbagekaldt.', authId: null };
  }
  const specificRequired = ctx.institute?.authRequirement === 'BANKSPECIFIK';
  const candidates = auths.filter((a) => USABLE.includes(a.status)
    && (specificRequired ? a.scope === 'BANKSPECIFIK' && a.instituteId === ctx.institute!.id : a.scope === 'GENEREL' || (ctx.institute ? a.instituteId === ctx.institute.id : false)));
  if (candidates.length === 0) {
    return specificRequired
      ? { result: 'MANGLER', ruleId: 'FR-01', reason: 'Instituttet kræver en bankspecifik fuldmagt.', authId: null }
      : { result: 'MANGLER', ruleId: null, reason: 'Ingen fuldmagt for CVR-nummeret (første gang eller carve-out).', authId: null };
  }
  return candidates.map((a) => evaluateOne(a, ctx, params)).sort((a, b) => RANK[a.result] - RANK[b.result])[0]!;
}

/** Kan fuldmagten bruges til at sende (VR-04)? "Bør fornyes" kan bruges. */
export const authUsable = (r: AuthCheck) => r === 'GYLDIG' || r === 'BOER_FORNYES';
