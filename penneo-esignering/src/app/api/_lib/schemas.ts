import { z } from 'zod';
import { SERVICE_TYPES } from '@/domain/e-signing';

export const createSigningRequestSchema = z.object({
  clientId: z.string().min(1),
  serviceType: z.enum(SERVICE_TYPES),
  documentTitle: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  document: z.object({ fileName: z.string().min(1).max(200), contentBase64: z.string().min(1) }).optional(),
});

/** Penneos webhook-format: topic + eventType og et payload med id (og status). */
export const penneoWebhookSchema = z.object({
  topic: z.string().min(1),
  eventType: z.string().min(1),
  eventTime: z.unknown().optional(),
  payload: z.object({ id: z.number().int(), status: z.number().int().optional() }),
});

export const simulateSignSchema = z.object({ requestId: z.string().min(1), signerId: z.string().min(1) });
