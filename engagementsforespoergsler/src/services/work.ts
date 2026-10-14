import { now } from './clock';
import type { Db } from './db';
import { appendEvent } from './event-log';
import { newId } from './ids';

/**
 * Arbejdsopgaver (kap. 7) og notifikationer (8.5). Hver opgave har præcis én
 * ansvarlig og en frist (K3). Regler, der kører flere gange (dagligt job),
 * opretter ikke dubletter: findes en åben opgave af samme type på samme
 * objekt, genbruges den.
 */
export interface TaskInput {
  caseId?: string | null;
  parentId?: string | null;
  type: string;
  title: string;
  role: string;
  assigneeId: string | null;
  dueDate: string;
  createdByRule?: string;
  inquiryId?: string | null;
  deviationId?: string | null;
  fuldmagtId?: string | null;
}

export const OPEN_TASK = ['AABEN', 'I_GANG', 'VENTER'];

export async function ensureTask(db: Db, input: TaskInput) {
  const existing = await db.task.findFirst({
    where: {
      type: input.type,
      status: { in: OPEN_TASK },
      caseId: input.caseId ?? null,
      inquiryId: input.inquiryId ?? null,
      deviationId: input.deviationId ?? null,
      fuldmagtId: input.fuldmagtId ?? null,
    },
  });
  if (existing) return existing;
  const task = await db.task.create({
    data: {
      id: newId('opg'),
      caseId: input.caseId ?? null,
      parentId: input.parentId ?? null,
      type: input.type,
      title: input.title,
      role: input.role,
      assigneeId: input.assigneeId,
      status: 'AABEN',
      dueDate: input.dueDate,
      createdByRule: input.createdByRule ?? null,
      inquiryId: input.inquiryId ?? null,
      deviationId: input.deviationId ?? null,
      fuldmagtId: input.fuldmagtId ?? null,
      createdAt: await now(db),
    },
  });
  await appendEvent(db, { objectType: 'Opgave', objectId: task.id, caseId: task.caseId, action: 'opgave.oprettet', actorId: 'system', after: { type: task.type, title: task.title, assigneeId: task.assigneeId, dueDate: task.dueDate }, reason: input.createdByRule });
  return task;
}

export async function closeTasks(
  db: Db,
  where: { type?: string | string[]; caseId?: string; inquiryId?: string; deviationId?: string; fuldmagtId?: string },
  status: 'LUKKET' | 'ANNULLERET' = 'LUKKET',
) {
  const tasks = await db.task.findMany({
    where: {
      status: { in: OPEN_TASK },
      ...(where.type ? { type: Array.isArray(where.type) ? { in: where.type } : where.type } : {}),
      ...(where.caseId ? { caseId: where.caseId } : {}),
      ...(where.inquiryId ? { inquiryId: where.inquiryId } : {}),
      ...(where.deviationId ? { deviationId: where.deviationId } : {}),
      ...(where.fuldmagtId ? { fuldmagtId: where.fuldmagtId } : {}),
    },
  });
  const at = await now(db);
  for (const t of tasks) {
    await db.task.update({ where: { id: t.id }, data: { status, closedAt: at } });
    await appendEvent(db, { objectType: 'Opgave', objectId: t.id, caseId: t.caseId, action: status === 'LUKKET' ? 'opgave.lukket' : 'opgave.annulleret', actorId: 'system', before: { status: t.status }, after: { status } });
  }
  return tasks.length;
}

export type NotificationChannel = 'BRUGERFLADE' | 'TEAMS' | 'EMAIL' | 'DAGLIG';

/**
 * Notifikation (8.5) – kun når modtageren skal handle. Teams og e-mail er
 * mocks, der logges som integrationskald; alle vises også i brugerfladen.
 */
export async function notify(
  db: Db,
  input: { recipientId: string | null | undefined; type: string; message: string; link: string; channels: NotificationChannel[] },
) {
  if (!input.recipientId) return;
  const at = await now(db);
  // Én notifikation pr. modtager; kanalerne gemmes samlet (fx "TEAMS,BRUGERFLADE").
  await db.notification.create({ data: { id: newId('not'), recipientId: input.recipientId, type: input.type, message: input.message, link: input.link, channel: input.channels.join(','), createdAt: at } });
  for (const channel of input.channels) {
    if (channel === 'TEAMS' || channel === 'EMAIL') {
      await db.integrationCall.create({
        data: { id: newId('int'), system: channel === 'TEAMS' ? 'Teams' : 'Graph (e-mail)', operation: 'notifikation', payload: JSON.stringify({ to: input.recipientId, message: input.message }), ok: true, at },
      });
    }
  }
}

/** Kører en regel højst én gang pr. objekt (fx ER-06-påmindelse) – hændelsesloggen er hukommelsen. */
export async function firstTime(db: Db, objectId: string, action: string): Promise<boolean> {
  return (await db.event.count({ where: { objectId, action } })) === 0;
}
