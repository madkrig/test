import Link from 'next/link';
import { notificationsFor } from '@/services';
import { Empty } from '../_components/bits';
import { fmtDateTime } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';

export const dynamic = 'force-dynamic';

const CHANNEL: Record<string, string> = { TEAMS: 'Teams', EMAIL: 'E-mail', BRUGERFLADE: 'Brugerflade', DAGLIG: 'Daglig opsamling' };

/** Notifikationer (8.5) – kun når modtageren skal handle. */
export default async function NotificationsPage() {
  const actor = await currentActor();
  const rows = await notificationsFor(prisma, actor);
  return (
    <>
      <div className="topline"><span>Notifikationer</span><span>{actor.name}</span></div>
      <section className="card">
        <h2>Notifikationer</h2>
        <p>Du får kun besked, når du skal handle. Alt andet kan ses i sagen. Teams og e-mail er simuleret i prototypen.</p>
        {rows.length === 0 ? <Empty>Ingen notifikationer.</Empty> : (
          <ol className="timeline">
            {rows.map((n) => <li key={n.id}><b><Link href={n.link}>{n.message}</Link></b><small className="ev-meta">{fmtDateTime(n.createdAt)} · {n.channels.map((c) => CHANNEL[c] ?? c).join(' + ')}{n.readAt ? '' : ' · ulæst'}</small></li>)}
          </ol>
        )}
      </section>
    </>
  );
}
