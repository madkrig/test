import { prisma, reviewer } from '@/services';
import { PortfolioTable } from '@/ui/client/portfolio';
import { Card, PageTitle } from '@/ui/components';
import { session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

export default async function Portfolio() {
  const s = await session(['AUDITOR']);
  const rows = await reviewer.portfolio(s.actor);
  const subtasks = await prisma.subtask.findMany({ where: { id: { in: rows.map((r) => r.subtaskId) } }, include: { versions: true } });
  const view = rows.map((r) => {
    const st = subtasks.find((x) => x.id === r.subtaskId)!;
    const changed = r.changes.map((c) => c.split(': ')[1] ?? '');
    const count = (k: string) => changed.filter((c) => c === k).length;
    const parts = [count('ADDED') && `${count('ADDED')} ny bank`, count('CHANGED') && `${count('CHANGED')} ændret`, count('REMOVED') && `${count('REMOVED')} fjernet`].filter(Boolean);
    return {
      ...r,
      engagementId: st.engagementId,
      version: st.versions.find((v) => v.id === r.versionId)?.version ?? 1,
      statusDate: r.statusDate,
      changes: parts.length ? parts.join(', ') : 'Ingen',
    };
  });
  return (
    <Shell s={s} active="portfolio">
      <PageTitle title="Populationer til godkendelse" sub="Kun dine egne revisioner. Kun opgaver uden åbne spørgsmål kan massegodkendes." />
      <Card><PortfolioTable rows={view} /></Card>
    </Shell>
  );
}
