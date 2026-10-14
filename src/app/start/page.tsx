import { redirect } from 'next/navigation';
import { homeFor, session } from '@/ui/session';

export const dynamic = 'force-dynamic';

export default async function Start() {
  const s = await session();
  redirect(homeFor(s.actor.role));
}
