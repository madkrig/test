import type { User } from '@/domain/e-signing';
import { prisma } from './db';
import { DomainError } from './errors';
import { newId } from './ids';
import { getSigningRequest, handlePenneoWebhook } from './signing-service';

export function demoEnabled(): boolean {
  return (process.env.PENNEO_MODE ?? 'mock') === 'mock';
}

/**
 * Demo: spiller Penneos rolle, når en underskriver underskriver. Sender de
 * samme webhooks, som Penneo ville sende, gennem den rigtige webhook-handler:
 * signer.signed og – når den sidste har underskrevet – casefile.completed.
 */
export async function simulateSignature(actor: User, requestId: string, signerId: string) {
  if (!demoEnabled()) throw new DomainError('FORBIDDEN', 'Demo-simulatoren er slået fra (PENNEO_MODE).');
  const { data: request } = await getSigningRequest(actor, requestId);
  const signer = await prisma.signingRequestSigner.findFirst({ where: { id: signerId, requestId } });
  if (!signer?.penneoSignerId) throw new DomainError('NOT_FOUND', 'Underskriveren findes ikke på opgaven.');
  if (signer.status !== 'PENDING' || request.status !== 'AWAITING_SIGNATURES') {
    throw new DomainError('INVALID_STATE', 'Underskriveren afventer ikke underskrift.');
  }
  await handlePenneoWebhook({ topic: 'signer', eventType: 'signed', payload: { id: signer.penneoSignerId } }, newId('demo'));
  const pending = await prisma.signingRequestSigner.count({ where: { requestId, status: 'PENDING' } });
  if (pending === 0) {
    await handlePenneoWebhook({ topic: 'casefile', eventType: 'completed', payload: { id: request.penneo.caseFileId!, status: 5 } }, newId('demo'));
  }
  return getSigningRequest(actor, requestId);
}
