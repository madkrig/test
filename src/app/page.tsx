import { cookies } from 'next/headers';
import { Card } from '@/ui/components';
import { DemoTools, RolePicker } from '@/ui/client/demo';
import { prisma } from '@/services';
import { syncDemoClock } from '@/services/demo-service';
import { ROLE } from '@/ui/labels';
import { USER_COOKIE } from '@/ui/session';

export const dynamic = 'force-dynamic';

const HINTS: Record<string, string> = {
  'u-sofie': 'AuditFlow: godkend population, beslutninger, reviewpakke, portefølje',
  'u-martin': 'AuditFlow: delta-godkendelse for Skovly Foods',
  'u-jonas': 'Kerne: arbejdskø, autorisation, udsendelse, svar og kontrol',
  'u-amalie': 'Kerne: fire-øjne-reviewer på e-mailudsendelse',
  'u-mia': 'Kerne: fuldstændighedskontrol og bankregister',
  'u-lars': 'Kerne: godkender metodeændringer (fire-øjne)',
};

export default async function Home() {
  const today = await syncDemoClock();
  const users = await prisma.user.findMany();
  const loggedIn = !!(await cookies()).get(USER_COOKIE)?.value;
  const pick = Object.keys(HINTS).flatMap((id) => {
    const u = users.find((x) => x.id === id);
    return u ? [{ id: u.id, name: u.name, role: ROLE[u.role] ?? u.role, hint: HINTS[id]! }] : [];
  });
  return (
    <main className="page narrow">
      <div className="page-title">
        <h1>Cedra · Bankbekræftelser</h1>
        <p className="muted">Workflowprototype: AuditFlow (revisor) og Kerne (administrativ udførelse) på samme data, statusser og hændelseslog. Alle data er syntetiske.</p>
      </div>
      {pick.length === 0 ? (
        <Card title="Ingen data">
          <p>Databasen er tom. Kør <code>npm run setup</code>.</p>
        </Card>
      ) : (
        <Card title="Vælg rolle">
          <RolePicker users={pick} />
        </Card>
      )}
      <Card title="Demo">
        {loggedIn ? <DemoTools today={today} /> : <p className="muted">Vælg en rolle for at ændre demodato eller nulstille data.</p>}
        <p className="small muted">Demo-script: <code>docs/demo-script.md</code>. Demodatoen er fælles for alle brugere.</p>
      </Card>
    </main>
  );
}
