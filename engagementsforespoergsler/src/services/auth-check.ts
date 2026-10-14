import { evaluateAuthorization, type AuthEvaluation, type AuthRecord, type AuthStatus, type IsoDate, type Person, type RuleParams } from '@/domain/ef';
import type { Db } from './db';

/** Ledelsen i CVR på en dato (FR-02: tegningsreglen gælder på underskriftsdatoen). */
export async function managementAt(db: Db, customerId: string, date: IsoDate): Promise<Person[]> {
  const persons = await db.srcPerson.findMany({ where: { customerId } });
  return persons
    .filter((p) => p.from <= date && (!p.to || p.to >= date))
    .map((p) => ({ unitNumber: p.unitNumber, name: p.name, role: p.role as Person['role'] }));
}

export interface InstituteAuthInfo {
  id: string;
  authRequirement: string;
  authMaxAgeMonths: number | null;
}

/**
 * Fuldmagtskontrollen (P04) for en kunde – generelt eller for ét institut.
 * Resultatet bruges af VR-04, af sagens næste handling og af S05.
 */
export async function authEvaluation(
  db: Db,
  customerId: string,
  institute: InstituteAuthInfo | null,
  date: IsoDate,
  params: RuleParams,
): Promise<AuthEvaluation> {
  const [customer, auths, persons] = await Promise.all([
    db.srcCustomer.findUniqueOrThrow({ where: { id: customerId } }),
    db.fuldmagt.findMany({ where: { customerId } }),
    db.srcPerson.findMany({ where: { customerId } }),
  ]);
  const signers = await db.fuldmagtSigner.findMany({ where: { fuldmagtId: { in: auths.map((a) => a.id) } } });
  const records: AuthRecord[] = auths.map((a) => ({
    id: a.id,
    status: a.status as AuthStatus,
    scope: a.scope as AuthRecord['scope'],
    instituteId: a.instituteId,
    holderCvr: a.holderCvr,
    signedDate: a.signedDate,
    signerUnits: signers.filter((s) => s.fuldmagtId === a.id && s.signedAt).map((s) => s.unitNumber),
  }));
  return evaluateAuthorization(records, {
    today: date,
    signingRuleChangedAt: customer.signingRuleChangedAt,
    management: persons.map((p) => ({ unitNumber: p.unitNumber, from: p.from, to: p.to })),
    institute: institute
      ? { id: institute.id, authRequirement: institute.authRequirement as 'GENEREL' | 'BANKSPECIFIK', authMaxAgeMonths: institute.authMaxAgeMonths }
      : null,
  }, params);
}
