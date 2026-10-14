import Link from 'next/link';
import { authorizations, bankConfirmations, bankTasks, prisma } from '@/services';
import { timelineFor } from '@/services/state';
import { ActionButton } from '@/ui/client/action';
import { AuthorizationForm, CheckForm, EscalateForm, FourEyesForm, ReceiveForm } from '@/ui/client/kerne-forms';
import { Callout, Card, Denied, EventLog, Field, Mark, Pill } from '@/ui/components';
import { CHANNEL, da, engagementLabel, humanize, primaryFlag, statusBadge, taskRef } from '@/ui/labels';
import { load, session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

/** F05/F06/F08: workbench for én BankTask – metode, autorisation, udsendelse, svar, kontrol og log. */
export default async function Workbench({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await session(['KERNE', 'SERVICE_OWNER']);
  const res = await load(() => bankTasks.getBankTask(s.actor, id));
  if (!res.ok) return <Shell s={s} active="queue"><Denied error={res.error} /></Shell>;
  const w = res.data;
  const t = w.task;
  const [siblings, customerAuths, decisions, subtask] = await Promise.all([
    bankConfirmations.bankTaskViews(prisma, t.subtaskId),
    authorizations.listAuthorizations(s.actor, t.customerId),
    prisma.decision.findMany({ where: { bankTaskId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.subtask.findUniqueOrThrow({ where: { id: t.subtaskId } }),
  ]);
  const timeline = timelineFor(w.engagement);
  const m = w.method;
  const unsent = t.status === 'AWAITING_KERNE' && !t.sentAt;
  const sharePointFailed = w.response?.administrativeCheckStatus === 'PASSED' && !w.response.sharePointDocumentId;
  const reminders = w.events.filter((e) => e.action === 'REMINDER_SENT');
  const sent = w.events.find((e) => e.action === 'REQUEST_SENT');
  const openDecision = decisions.find((d) => d.status === 'OPEN');
  const lastDecision = decisions.filter((d) => d.status === 'DECIDED').at(-1);
  const canComplete = (t.status === 'RECEIVED' && t.administrativeCheckPassed) || (t.status === 'AWAITING_KERNE' && !!t.sentAt);
  const remindBlock = t.reminderCount >= 2 ? 'Maks. to standardpåmindelser er sendt.' : t.nextReminderDate && s.today < t.nextReminderDate ? `Kan sendes fra ${da(t.nextReminderDate)} (bankens forventede svartid).` : null;
  const performers = s.users.filter((u) => (u.role === 'KERNE' || u.role === 'SERVICE_OWNER') && u.id !== s.actor.id);
  const allDone = siblings.every((x) => x.status === 'COMPLETED');
  const flag = primaryFlag(t);
  const fourEyes = w.events.filter((e) => e.action === 'FOUR_EYES_APPROVED').at(-1);

  return (
    <Shell s={s} active="queue">
      <div className="grid-workbench">
        <aside className="card sidebar">
          <h2>Bankopgaver</h2>
          <ul className="nav-list">
            {siblings.map((x) => {
              const f = primaryFlag(x);
              return (
                <li key={x.id} className={x.id === id ? 'active' : undefined}>
                  <Link href={`/kerne/bank-tasks/${x.id}`}>
                    <strong>{x.bankName} · {taskRef(x.id)}</strong>
                    <span className="small">{f ? `${f.icon} ${f.label}` : `${statusBadge(x.status).icon} ${statusBadge(x.status).label}`}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link className="small" href={`/auditflow/${t.engagementId}`}>Se revisionsopgaven ›</Link>
        </aside>

        <div className="stack">
          <div className="page-title">
            <p className="muted small">{w.customer.name} · {engagementLabel(w.engagement)}</p>
            <h1>{w.bank.name} · {taskRef(t.id)}</h1>
            <div className="row">
              <Pill badge={statusBadge(t.status)} />
              {flag && <Pill badge={flag} />}
              {t.fourEyesCompleted && <Pill badge={{ icon: '◆', label: 'Fire-øjne udført', tone: 'purple' }} />}
              <span>Næste handling: {t.nextAction}{unsent ? ` · deadline ${da(t.sendDate)}` : ''}</span>
            </div>
          </div>

          {(t.blockedReason || sharePointFailed) && (
            <Callout tone="red">
              <strong>■ Blokeret: {sharePointFailed ? 'Arkivering i SharePoint fejlede' : t.blockedReason}</strong>
              {sharePointFailed && (
                <div className="row">
                  <span className="small">Kontrollen er gemt. Prøv uploaden igen – ingen data går tabt.</span>
                  <ActionButton label="Prøv upload igen" url={`/api/bank-tasks/${id}/administrative-check`} body={{}} idempotent />
                </div>
              )}
            </Callout>
          )}

          {unsent && m && (
            <Card title={`Instruktion (${w.bank.name} · ${CHANNEL[m.channel]} v${m.version})`}>
              <ol className="steps">
                <li>{m.channel === 'EMAIL' ? `Send e-mail til ${m.urlOrChannel}` : `Brug ${m.urlOrChannel}`}</li>
                <li>Udfyld {m.requiredFields.join(', ')} (statusdato {da(w.engagement.statusDate)})</li>
                <li>Vedhæft autorisation {w.authorizations[0] ? w.authorizations[0].id.toUpperCase() : '(mangler)'}</li>
                <li>Indsend og registrér kvittering i Kerne</li>
              </ol>
            </Card>
          )}

          {unsent && t.flags.missingAuthorization && (
            <Card title="Autorisation mangler" aside={<span className="muted small">Senest {da(timeline.authorizationDeadline.date)} (T-5 uger)</span>}>
              {m?.authorizationRequirement === 'BANK_SPECIFIC' && <Callout tone="amber">{w.bank.name} kræver bankspecifik fuldmagt.</Callout>}
              {customerAuths.filter((a) => !a.coveredBankTaskIds.includes(id) && a.status === 'VALID').map((a) => (
                <div key={a.id} className="row">
                  <span>{a.id.toUpperCase()} · {a.signer} · gyldig til {da(a.validTo)}{a.bankRequirement ? ` · ${a.bankRequirement}` : ''}</span>
                  <ActionButton label="Tilknyt" variant="secondary" method="PATCH" url={`/api/authorizations/${a.id}`} body={{ coveredBankTaskIds: [...a.coveredBankTaskIds, id] }} />
                </div>
              ))}
              <AuthorizationForm
                customerId={t.customerId}
                today={s.today}
                validTo={`${Number(w.engagement.statusDate.slice(0, 4)) + 1}-03-31`}
                defaultTaskId={id}
                tasks={siblings.filter((x) => x.status !== 'COMPLETED').map((x) => ({ id: x.id, label: `${x.bankName} · ${taskRef(x.id)}`, covered: !x.flags.missingAuthorization }))}
                {...(m?.authorizationRequirement === 'BANK_SPECIFIC' ? { bankRequirement: `${w.bank.name}s egen fuldmagtsblanket` } : {})}
              />
            </Card>
          )}

          {w.fourEyesReasons.length > 0 && (unsent || t.fourEyesCompleted) && (
            <Card title={`Fire-øjne-kontrol (${w.fourEyesReasons.join(', ').toLowerCase()})`}>
              {t.fourEyesCompleted ? (
                <ul className="checks"><Mark ok label={`Godkendt af ${s.name(fourEyes?.actorId)} · ${humanize(fourEyes?.change ?? '', s.name)}`} /></ul>
              ) : performers.length === 0 ? (
                <p className="muted">Kræver en anden Kerne-medarbejder.</p>
              ) : (
                <>
                  <p className="muted small">Reviewer må ikke være samme person som den, der udfører udsendelsen. Du er logget ind som {s.actor.name}.</p>
                  <FourEyesForm taskId={id} performers={performers} defaultPerformer={performers.find((p) => p.id === t.kerneOwnerId)?.id ?? performers.find((p) => p.id === 'u-jonas')?.id ?? performers[0]!.id} />
                </>
              )}
            </Card>
          )}

          {unsent && (
            <Card title="Kontrol før udsendelse">
              <ul className="checks">
                <Mark ok={!!m} label={m ? `Metodeversion v${m.version} fastholdt (${CHANNEL[m.channel]})` : 'Bankmetode mangler i bankregisteret'} />
                <Mark ok={!t.flags.missingAuthorization} label={`Autorisation gyldig og dækker ${w.bank.name}`} />
                <Mark ok={w.fourEyesReasons.length === 0 || t.fourEyesCompleted} label={w.fourEyesReasons.length === 0 ? 'Fire-øjne ikke påkrævet' : t.fourEyesCompleted ? 'Fire-øjne udført' : 'Fire-øjne mangler'} />
                {w.sendBlockers.filter((b) => !/autorisation|fire-øjne|metode/i.test(b)).map((b) => <Mark key={b} ok={false} label={b} />)}
              </ul>
              <ActionButton label="Send anmodning" url={`/api/bank-tasks/${id}/send`} idempotent disabled={w.sendBlockers.length > 0} />
              <p className="muted small">Beskyttet mod dobbelt udsendelse.</p>
            </Card>
          )}

          {t.sentAt && (
            <Card title="Forløb">
              <ul className="checks">
                <Mark ok label={<>Anmodning sendt {da(t.sentAt)} <span className="muted small">{humanize(sent?.change ?? '', s.name)}</span></>} />
                {reminders.map((r, i) => <Mark key={r.id} ok label={`Påmindelse ${i + 1} sendt ${da(r.at)}`} />)}
                {t.status === 'AWAITING_BANK' && t.nextReminderDate && <li className="check muted">Næste påmindelse {da(t.nextReminderDate)}</li>}
                {t.status === 'AWAITING_BANK' && <li className="check muted">T-10 faglig eskalation {da(timeline.professionalEscalation.date)}</li>}
                {lastDecision && <Mark ok label={`Revisor besluttede ${da(lastDecision.decidedAt)}: ${(JSON.parse(lastDecision.options) as { id: string; label: string }[]).find((o) => o.id === lastDecision.chosenOption)?.label} – ${lastDecision.reason}`} />}
              </ul>
              {t.status === 'AWAITING_BANK' && (
                <div className="stack">
                  <div className="row">
                    <ActionButton label={`Send påmindelse ${t.reminderCount + 1}`} variant="secondary" url={`/api/bank-tasks/${id}/remind`} idempotent disabled={!!remindBlock} />
                    {remindBlock && <span className="muted small">{remindBlock}</span>}
                  </div>
                  <h3>Registrér banksvar</h3>
                  <ReceiveForm taskId={id} channel={m?.channel ?? 'OTHER'} defaultFile={`${w.bank.name.replace(/ /g, '_')}_${w.customer.name.split(' ')[0]}_${w.engagement.periodEnd.slice(0, 4)}.pdf`} />
                  <EscalateForm taskId={id} />
                </div>
              )}
            </Card>
          )}

          {t.status === 'AWAITING_AUDITOR' && openDecision && (
            <Callout tone="orange">
              <strong>▲ Afventer revisors beslutning</strong>
              <p>{openDecision.question}</p>
              <p className="small">Beslutningsopgave oprettet til {s.name(openDecision.ownerId)} · deadline {da(openDecision.deadline)}. Ingen automatisk partnereskalation.</p>
            </Callout>
          )}

          {w.response && (
            <Card title="Banksvar og administrativ kontrol">
              <p className="small">Svar modtaget {da(w.response.receivedAt)} via {CHANNEL[w.response.channel]} · originalfil {w.response.originalFileName}</p>
              {w.response.administrativeCheckStatus === 'PENDING' && <CheckForm taskId={id} labels={{ entity: w.engagement.legalEntity, bank: w.bank.name, statusDate: da(w.engagement.statusDate) }} />}
              {w.response.administrativeCheckStatus === 'FAILED' && <Callout tone="red">■ Administrativ kontrol fejlede – indhent korrekt svar fra banken.</Callout>}
              {w.response.administrativeCheckStatus === 'PASSED' && (
                <ul className="checks">
                  <Mark ok label={`Juridisk enhed: ${w.engagement.legalEntity}`} />
                  <Mark ok label={`Bank: ${w.bank.name}`} />
                  <Mark ok label={`Statusdato: ${da(w.engagement.statusDate)}`} />
                  <Mark ok label="Reference, læsbar og komplet" />
                  {w.response.deviations.map((d) => <Mark key={d} ok={false} label={`Afvigelse sendt til revisor: ${d}`} />)}
                </ul>
              )}
              {w.response.sharePointDocumentId && (
                <div className="sharepoint">
                  <h3>Arkivering i SharePoint (mock)</h3>
                  <ul className="checks"><Mark ok label={`Banksvar uploadet · dokument-ID ${w.response.sharePointDocumentId}`} /></ul>
                  <p className="small mono">{w.response.sharePointUrl} · sha256 {w.response.integrityHash?.slice(0, 4)}…{w.response.integrityHash?.slice(-4)}</p>
                  <p className="muted small">Kun banksvaret arkiveres i SharePoint. Anmodning, autorisation og log bliver i Kernesystemet.</p>
                </div>
              )}
            </Card>
          )}

          {canComplete && (
            <Card>
              <div className="row between">
                <span>{t.responseId ? 'Svaret er kontrolleret og arkiveret.' : 'Revisor har besluttet den faglige håndtering.'} Afslut den operationelle opgave.</span>
                <ActionButton label="Afslut bankopgave" url={`/api/bank-tasks/${id}/complete`} />
              </div>
            </Card>
          )}
          {t.status === 'COMPLETED' && <Callout tone="green">√ Bankopgaven er afsluttet.</Callout>}
          {allDone && subtask.status !== 'COMPLETED' && (
            <Card title="Subopgave">
              <div className="row between">
                <span>Alle bankopgaver er afsluttet. {subtask.professionalConclusion ? 'Revisors konklusion er registreret.' : 'Afventer revisors faglige konklusion.'}</span>
                <ActionButton label="Fuldfør subopgave" url={`/api/bank-confirmations/${t.subtaskId}/complete`} disabled={!subtask.professionalConclusion} />
              </div>
            </Card>
          )}
        </div>

        <aside className="stack">
          <Card title="Bankmetode">
            {m ? (
              <>
                <p><strong>{w.bank.name} · {CHANNEL[m.channel]}</strong></p>
                <p className="muted small">Version {m.version} · gældende fra {da(m.validFrom)}{m.status !== 'ACTIVE' ? ` · ${m.status === 'RETIRED' ? 'udfaset (opgaven beholder versionen)' : 'udkast'}` : ''}</p>
                <Field label="Forventet svartid">{m.expectedResponseWorkdays} arbejdsdage efter statusdato</Field>
                <Field label="Påmindelse">{m.reminderMethod}, maks. 2 gange</Field>
                <Field label="Autorisation">{m.authorizationRequirement === 'BANK_SPECIFIC' ? 'Bankspecifik fuldmagt' : 'Generel fuldmagt'}</Field>
                {m.channel === 'EMAIL' && <p className="muted small">Fire-øjne obligatorisk ved manuel e-mail.</p>}
              </>
            ) : <Callout tone="red">Bankmetode mangler – kontakt Service Owner.</Callout>}
          </Card>
          <Card title="Autorisation">
            {w.authorizations.length === 0 && <p className="muted">Ingen autorisation tilknyttet.</p>}
            {w.authorizations.map((a) => (
              <div key={a.id} className="stack-sm">
                <strong>{a.id.toUpperCase()} · {a.signer}</strong>
                <span className="muted small">Dækker {a.coveredBankTaskIds.map(taskRef).join(', ')} · gyldig til {da(a.validTo)}</span>
                {a.bankRequirement && <span className="muted small">{a.bankRequirement}</span>}
                <Pill badge={a.status === 'VALID' ? { icon: '√', label: 'Gyldig', tone: 'green' } : { icon: '!', label: a.status === 'UNCERTAIN' ? 'Usikker' : a.status, tone: 'amber' }} small />
              </div>
            ))}
          </Card>
          <Card title="Hændelseslog"><EventLog events={w.events} name={s.name} /></Card>
        </aside>
      </div>
    </Shell>
  );
}
