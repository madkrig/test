import { addDays, formatDanish, type IsoDate } from '@/domain/ef';
import type { Db } from './db';
import { DomainError } from './errors';
import { ingestInbound, type ExtractedLine, type InboundMessage } from './responses';

/**
 * Demo-simulator: pengeinstitutternes side. Danner et svar ud fra bankens
 * (syntetiske) data og lægger det i funktionspostkassen eller på platformen,
 * så hele kæden – match, afsenderkontrol, udtræk og afstemning – kan prøves.
 */
export const REPLY_VARIANTS = {
  NORMAL: 'Svar fra banken',
  UDEN_REFERENCE: 'Svar uden reference (matches på CVR, institut og dato)',
  VIDERESENDT: 'Videresendt af kunden (afvises, AR-02)',
  FORKERT_DATO: 'Forkert opgørelsesdato (AR-03)',
  AFVISNING: 'Afvisning: fuldmagt ikke godkendt',
  UIDENTIFICERET: 'Svar uden reference og CVR (uidentificeret)',
} as const;
export type ReplyVariant = keyof typeof REPLY_VARIANTS;

export function demoEnabled(): boolean {
  return process.env.EF_DEMO !== '0';
}

export async function simulateBankReply(db: Db, inquiryId: string, variant: ReplyVariant = 'NORMAL') {
  if (!demoEnabled()) throw new DomainError('FORBIDDEN', 'Simulatoren er kun slået til i demo.');
  const inquiry = await db.inquiry.findUnique({ where: { id: inquiryId } });
  if (!inquiry) throw new DomainError('NOT_FOUND', 'Forespørgslen findes ikke.');
  if (!inquiry.sentAt) throw new DomainError('INVALID_STATE', 'Forespørgslen er ikke sendt endnu.');
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  const statement = await db.srcBankStatement.findFirst({ where: { customerId: c.customerId, instituteId: inst.id, balanceDate: inquiry.statementDate } });
  const data = statement ? (JSON.parse(statement.lines) as { lines: ExtractedLine[]; missingCategories?: string[] }) : { lines: [], missingCategories: [] };
  const signingRights = statement ? (JSON.parse(statement.signingRights) as string[]) : [];
  const domain = (JSON.parse(inst.senderDomains) as string[])[0] ?? 'bank.example';
  const viaPlatform = inst.channel === 'PLATFORM';
  const wrongDate: IsoDate = addDays(inquiry.statementDate.slice(0, 8) + '01', -1);

  const base: InboundMessage = {
    channel: viaPlatform && variant !== 'VIDERESENDT' ? 'PLATFORM' : 'EMAIL',
    from: viaPlatform ? `platform@${domain}` : `revisorsvar@${domain}`,
    subject: `SV: Engagementsforespørgsel – ${customer.name}, CVR ${customer.cvr} – pr. ${formatDanish(inquiry.statementDate)} – ref. ${inquiry.reference}`,
    body: `Engagementsopgørelse for ${customer.name}, CVR-nr. ${customer.cvr}, pr. ${formatDanish(inquiry.statementDate)}.`,
    attachmentName: 'engagementsopgoerelse.pdf',
    cvr: customer.cvr,
    statementDate: inquiry.statementDate,
    extracted: { lines: data.lines, signingRights, missingCategories: data.missingCategories ?? [] },
  };

  let msg: InboundMessage = base;
  if (variant === 'UDEN_REFERENCE') msg = { ...base, subject: `Engagementsopgørelse ${customer.name}`, body: base.body };
  if (variant === 'VIDERESENDT') msg = { ...base, channel: 'EMAIL', from: customer.contactEmail, subject: `VS: ${base.subject}` };
  if (variant === 'FORKERT_DATO') msg = { ...base, statementDate: wrongDate, body: `Engagementsopgørelse pr. ${formatDanish(wrongDate)}.` };
  if (variant === 'AFVISNING') msg = { ...base, subject: `SV: ${base.subject}`, body: 'Vi kan ikke besvare forespørgslen.', extracted: { lines: [], signingRights: [], missingCategories: [] }, rejection: { reason: 'FULDMAGT', note: 'Fuldmagten er ikke underskrevet i henhold til tegningsreglen.' } };
  if (variant === 'UIDENTIFICERET') msg = { ...base, subject: 'Engagementsoversigt', body: `Oversigt over engagementer pr. ${formatDanish(inquiry.statementDate)}.`, cvr: null };
  return ingestInbound(db, msg);
}
