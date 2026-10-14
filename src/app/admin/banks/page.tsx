import Link from 'next/link';
import { bankRegister } from '@/services';
import { ActionButton } from '@/ui/client/action';
import { MethodForm } from '@/ui/client/kerne-forms';
import { Callout, Card, Denied, Field, PageTitle, Pill } from '@/ui/components';
import { CHANNEL, da, taskRef, type Badge } from '@/ui/labels';
import { load, session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

type Row = Awaited<ReturnType<typeof bankRegister.listBanks>>[number];

function state(b: Row): Badge {
  if (b.incomplete) return { icon: '!', label: 'Mangler metode', tone: 'red' };
  if (b.draft) return { icon: '◊', label: b.draft.approvedBy ? 'Udkast · godkendt' : 'Udkast · afventer fire-øjne', tone: 'purple' };
  if (b.outdated) return { icon: '!', label: 'Forældet', tone: 'red' };
  return { icon: '√', label: 'Gældende', tone: 'green' };
}

/** F13: bankregisteret er den styrende kilde for arbejdsmetoden pr. bank. */
export default async function Banks({ searchParams }: { searchParams: Promise<{ bank?: string }> }) {
  const s = await session(['KERNE', 'SERVICE_OWNER']);
  const res = await load(() => bankRegister.listBanks(s.actor));
  if (!res.ok) return <Shell s={s} active="banks"><Denied error={res.error} /></Shell>;
  const banks = res.data;
  const { bank: selectedId } = await searchParams;
  const selected = banks.find((b) => b.id === selectedId) ?? banks[0];
  const methods = selected ? await bankRegister.listMethods(s.actor, selected.id) : [];
  const isOwner = s.actor.role === 'SERVICE_OWNER';
  const active = selected?.activeMethod;
  const draft = methods.find((m) => m.status === 'DRAFT');
  return (
    <Shell s={s} active="banks">
      <PageTitle title="Bankregister" sub="Den godkendte metode pr. bank. Ændringer kræver fire-øjne-kontrol og begrundelse." />
      <div className="grid-main">
        <Card>
          <table className="table">
            <thead>
              <tr><th>Bank</th><th>Metode</th><th>Version</th><th>Status</th><th>Ejer</th><th>Senest kontrolleret</th><th>Åbne BankTasks</th></tr>
            </thead>
            <tbody>
              {banks.map((b) => {
                const m = b.draft ?? b.activeMethod;
                return (
                  <tr key={b.id} className={b.id === selected?.id ? 'row-hl' : undefined}>
                    <td><Link className="strong" href={`/admin/banks?bank=${b.id}`}>{b.name}</Link></td>
                    <td>{m ? CHANNEL[m.channel] : '–'}</td>
                    <td>{m ? `v${m.version}` : '–'}</td>
                    <td><Pill badge={state(b)} small /></td>
                    <td>{m?.owner ?? '–'}</td>
                    <td>{da(b.activeMethod?.lastReviewed)}</td>
                    <td>{b.openBankTasks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {selected && (
          <aside className="stack">
            <Card title={`${selected.name}${active ? ` · ${CHANNEL[active.channel]?.toLowerCase()}` : ''}`} aside={<Pill badge={state(selected)} small />}>
              {selected.outdated && active && <Callout tone="red">Forældet · kontrol &gt; 12 mdr. (senest {da(active.lastReviewed)})</Callout>}
              {active && (
                <>
                  <Field label="Kanal">{active.urlOrChannel}</Field>
                  <Field label="Autorisation">{active.authorizationRequirement === 'BANK_SPECIFIC' ? 'Bankspecifik fuldmagt' : 'Generel fuldmagt'}</Field>
                  <Field label="Forventet svartid">{active.expectedResponseWorkdays} arbejdsdage</Field>
                  <Field label="Påmindelse">{active.reminderMethod}</Field>
                </>
              )}
              <h3>Versionshistorik</h3>
              <ul className="list">
                {methods.map((m) => (
                  <li key={m.id}>
                    <span><strong>v{m.version}</strong> · {CHANNEL[m.channel]} · {({ ACTIVE: 'gældende', RETIRED: 'udfaset', DRAFT: 'udkast' } as Record<string, string>)[m.status]} fra {da(m.validFrom)}</span>
                    <span className="muted small">Oprettet af {s.name(m.createdBy)}{m.approvedBy ? ` · godkendt af ${s.name(m.approvedBy)}` : ''} · {m.changeReason}</span>
                  </li>
                ))}
              </ul>
              <h3>Påvirkede åbne BankTasks</h3>
              {methods.every((m) => m.openBankTaskIds.length === 0) && <p className="muted small">Ingen.</p>}
              <ul className="list">
                {methods.flatMap((m) => m.openBankTaskIds.map((id) => (
                  <li key={id}><Link href={`/kerne/bank-tasks/${id}`}>{taskRef(id)}</Link><span className="muted small">beholder v{m.version}</span></li>
                )))}
              </ul>
              {isOwner && draft && (
                <Callout tone="purple">
                  Udkast v{draft.version} ({CHANNEL[draft.channel]}) oprettet af {s.name(draft.createdBy)}: {draft.changeReason}
                  <div className="row">
                    {!draft.approvedBy && <ActionButton label="Godkend (fire-øjne)" url={`/api/bank-methods/${draft.id}/approve`} disabled={draft.createdBy === s.actor.id} />}
                    {draft.approvedBy && <ActionButton label="Aktivér metode" url={`/api/bank-methods/${draft.id}/activate`} confirm="Aktivér metoden? Den gældende version udfases; åbne opgaver beholder deres version." />}
                  </div>
                  {!draft.approvedBy && draft.createdBy === s.actor.id && <p className="small">Du oprettede udkastet – en anden Service Owner skal godkende.</p>}
                </Callout>
              )}
              {isOwner && !draft && <MethodForm bankId={selected.id} today={s.today} current={active ?? null} />}
              {!isOwner && <p className="muted small">Kun Service Owner kan ændre bankmetoder.</p>}
            </Card>
          </aside>
        )}
      </div>
    </Shell>
  );
}
