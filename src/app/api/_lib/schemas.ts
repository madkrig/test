import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato skal være ÅÅÅÅ-MM-DD');
const source = z.enum(['PRIOR_YEAR', 'R75', 'ERP', 'CUSTOMER', 'AUDITOR']);
const change = z.enum(['PROPOSED', 'ADDED', 'CHANGED', 'REMOVED', 'UNCHANGED']);
const channel = z.enum(['PLATFORM', 'UPLOAD_PORTAL', 'EMAIL', 'OTHER']);

export const activateSchema = z.object({ source: z.enum(['AUDITFLOW', 'MONTHLY_CONTROL', 'AD_HOC']).default('AUDITFLOW') });
export const itemSchema = z.object({
  bankId: z.string().min(1),
  relationType: z.string().min(1),
  sources: z.array(source).min(1),
  change: change.optional(),
  priorYearRelation: z.boolean().optional(),
  customerConfirmed: z.boolean().optional(),
});
export const itemPatchSchema = z.object({
  relationType: z.string().min(1).optional(),
  sources: z.array(source).optional(),
  change: change.optional(),
  removalReason: z.string().optional(),
  customerConfirmed: z.boolean().optional(),
  auditorDecision: z.string().optional(),
});
export const versionSchema = z.object({ versionId: z.string().min(1) });
export const rejectSchema = z.object({ versionId: z.string().min(1), reason: z.string().min(1) });
export const deltaSchema = z.object({ items: z.array(itemSchema).min(1) });
export const conclusionSchema = z.object({ conclusion: z.string().min(1) });
export const assignSchema = z.object({ ids: z.array(z.string()).min(1), ownerId: z.string().min(1) });
export const patchTaskSchema = z.object({ kerneOwnerId: z.string().min(1) });
export const fourEyesSchema = z.object({ performerId: z.string().min(1) });
export const receiveSchema = z.object({ channel, originalFileName: z.string().min(1), metadata: z.record(z.string()).optional() });
export const checkSchema = z.object({
  checks: z.object({ entity: z.boolean(), bank: z.boolean(), statusDate: z.boolean(), reference: z.boolean(), readable: z.boolean(), complete: z.boolean() }).optional(),
  deviations: z.array(z.string().min(1)).optional(),
  content: z.string().optional(),
});
export const escalateSchema = z.object({ question: z.string().min(1), evidence: z.record(z.unknown()).optional() });
export const decideSchema = z.object({ option: z.string().min(1), reason: z.string().min(1), followUpOwnerId: z.string().optional(), followUpDeadline: isoDate.optional() });
export const authorizationSchema = z.object({
  customerId: z.string().min(1),
  signer: z.string().min(1),
  validFrom: isoDate,
  validTo: isoDate,
  coveredBankTaskIds: z.array(z.string()).min(1),
  status: z.enum(['REQUESTED', 'RECEIVED', 'VALID', 'UNCERTAIN', 'EXPIRED']),
  bankRequirement: z.string().optional(),
  atypical: z.boolean().optional(),
  validationResult: z.string().optional(),
  kerneDocumentRef: z.string().optional(),
});
export const authorizationPatchSchema = authorizationSchema.omit({ customerId: true }).partial();
export const methodSchema = z.object({
  channel,
  urlOrChannel: z.string().min(1),
  requiredFields: z.array(z.string()),
  authorizationRequirement: z.enum(['GENERAL', 'BANK_SPECIFIC']),
  expectedResponseWorkdays: z.number().int().positive(),
  reminderMethod: z.string().min(1),
  escalationContact: z.string().min(1),
  validFrom: isoDate,
  changeReason: z.string().min(1),
});
export const runSchema = z.object({ runDate: isoDate.optional() });
export const clarificationSchema = z.object({ decision: z.enum(['OPT_IN', 'OPT_OUT']), reason: z.string().optional() });
export const bulkApproveSchema = z.object({ items: z.array(z.object({ subtaskId: z.string(), versionId: z.string() })).min(1), confirmed: z.boolean() });
