import { redirect } from 'next/navigation';
import { currentActor } from './_lib/server';

/** Rollebaseret startside (8.1): kerneteam → kø, revisor → sager, leder → årshjul, procesejer → regler. */
export default async function Home() {
  const actor = await currentActor();
  const start: Record<string, string> = { KM: '/koe', KL: '/aarshjul', OR: '/sager', RM: '/sager', PE: '/rapporter', AGENT: '/sager', ADMIN: '/proces' };
  redirect(start[actor.role] ?? '/proces');
}
