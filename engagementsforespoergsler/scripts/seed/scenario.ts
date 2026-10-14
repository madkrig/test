import {
  addBankListLine, approveBankList, approveExtraction, assessDeviation, changeRule, conclusionDraft, concludeCase, customerConfirmBankList,
  decideMissingResponse, loadActor, penneoSigned, runDailyJob, sendBatch, sendDeviationsToAuditor, sendForSigning, sendReminder, setToday,
  simulateBankReply, uploadManualFuldmagt, verifyResponseLine, type Actor, type Db, type ReplyVariant,
} from '@/services';

/**
 * Sæsonen afspilles gennem services – præcis som brugerne og den daglige
 * kørsel ville gøre det – så hændelsesloggen, KPI'erne og køerne er ægte.
 * Slutdatoen er demo-datoen: midt i årsskiftesæsonen 2026/27.
 */
export const DEMO_DATE = '2026-12-03';

export async function runScenario(db: Db, opts: { until?: string; log?: (s: string) => void } = {}) {
  const until = opts.until ?? DEMO_DATE;
  const log = opts.log ?? (() => undefined);
  const actors = new Map<string, Actor>();
  const as = async (id: string) => {
    if (!actors.has(id)) actors.set(id, await loadActor(db, id));
    return actors.get(id)!;
  };
  const caseOf = async (customerId: string, T: string) => db.case.findFirstOrThrow({ where: { customerId, balanceDate: T } });
  const inquiryOf = async (customerId: string, T: string, instituteId: string) => {
    const c = await caseOf(customerId, T);
    return db.inquiry.findFirstOrThrow({ where: { caseId: c.id, instituteId, status: { not: 'ANNULLERET' } }, orderBy: { createdAt: 'desc' } });
  };
  const approve = async (by: string, customerId: string, T: string) => approveBankList(db, await as(by), (await caseOf(customerId, T)).id, { acknowledgeWarnings: true });
  const send = async (by: string, instituteId: string, list: [string, string][], key: string) => {
    const ids = [];
    for (const [customerId, T] of list) ids.push((await inquiryOf(customerId, T, instituteId)).id);
    return sendBatch(db, await as(by), { inquiryIds: ids, idempotencyKey: key });
  };
  const reply = async (customerId: string, T: string, instituteId: string, variant: ReplyVariant = 'NORMAL') => simulateBankReply(db, (await inquiryOf(customerId, T, instituteId)).id, variant);
  const verifyAndApprove = async (by: string, customerId: string, T: string, instituteId: string) => {
    const inquiry = await inquiryOf(customerId, T, instituteId);
    const response = await db.response.findFirstOrThrow({ where: { inquiryId: inquiry.id, senderVerified: true }, orderBy: { receivedAt: 'desc' } });
    for (const l of await db.responseLine.findMany({ where: { responseId: response.id, aiConfidence: { lt: 0.95 } } })) await verifyResponseLine(db, await as(by), l.id);
    return approveExtraction(db, await as(by), response.id, { acknowledgeWarnings: true });
  };
  const remind = async (by: string, customerId: string, T: string, instituteId: string) => sendReminder(db, await as(by), (await inquiryOf(customerId, T, instituteId)).id);
  const decide = async (by: string, customerId: string, T: string, instituteId: string, decision: 'KUNDE_KONTAKTER' | 'NY_FRIST' | 'ALTERNATIVE', newDeadline?: string, note?: string) =>
    decideMissingResponse(db, await as(by), (await inquiryOf(customerId, T, instituteId)).id, { decision, newDeadline, note });
  const conclude = async (by: string, customerId: string, T: string) => {
    const c = await caseOf(customerId, T);
    return concludeCase(db, await as(by), c.id, { conclusion: await conclusionDraft(db, c.id) });
  };
  const fuldmagtDraft = async (customerId: string, scope = 'GENEREL') => db.fuldmagt.findFirstOrThrow({ where: { customerId, scope, status: 'UDKAST' }, orderBy: { createdAt: 'desc' } });

  const steps: [string, () => Promise<unknown>][] = [
    // Balancedag 30.06.2026
    ['2026-05-01', async () => undefined],
    ['2026-05-18', async () => undefined],
    ['2026-05-20', () => approve('u-kbrink', 'k-havbryggen', '2026-06-30')],
    ['2026-05-21', () => approve('u-rholm', 'k-moelleaaen', '2026-06-30')],
    ['2026-06-02', () => send('u-aali', 'inst-nordea', [['k-havbryggen', '2026-06-30']], 'seed-0602-nordea')],
    ['2026-06-22', async () => changeRule(db, await as('u-nvang'), 'AR-05', { params: { toleranceKr: 1 }, activeFrom: '2026-07-01', reason: 'Øreafrunding i bankernes svar gav unødige differencer' })],
    ['2026-07-01', async () => {
      await send('u-aali', 'inst-lindholm', [['k-havbryggen', '2026-06-30']], 'seed-0701-lindholm');
      await send('u-mlund', 'inst-danske', [['k-moelleaaen', '2026-06-30']], 'seed-0701-danske');
    }],
    ['2026-07-03', async () => { await reply('k-havbryggen', '2026-06-30', 'inst-lindholm'); await verifyAndApprove('u-aali', 'k-havbryggen', '2026-06-30', 'inst-lindholm'); }],
    ['2026-07-10', async () => { await reply('k-moelleaaen', '2026-06-30', 'inst-danske'); await verifyAndApprove('u-mlund', 'k-moelleaaen', '2026-06-30', 'inst-danske'); }],
    ['2026-07-20', async () => { await reply('k-havbryggen', '2026-06-30', 'inst-nordea'); await verifyAndApprove('u-aali', 'k-havbryggen', '2026-06-30', 'inst-nordea'); }],

    // Balancedag 30.09.2026
    ['2026-08-03', async () => undefined],
    ['2026-08-17', async () => undefined],
    ['2026-08-18', async () => {
      await approve('u-rholm', 'k-nordlys', '2026-09-30');
      await approve('u-rholm', 'k-kildevang', '2026-09-30');
      await approve('u-kbrink', 'k-fjordlys', '2026-09-30');
      await approve('u-kbrink', 'k-vestkyst', '2026-09-30');
      await approve('u-sdahl', 'k-aalund', '2026-09-30');
      await approve('u-sdahl', 'k-nordhavn', '2026-09-30');
    }],
    ['2026-08-31', () => send('u-mlund', 'inst-nordea', [['k-kildevang', '2026-09-30'], ['k-nordhavn', '2026-09-30']], 'seed-0831-nordea')],
    ['2026-09-10', async () => { await conclude('u-kbrink', 'k-havbryggen', '2026-06-30'); await conclude('u-rholm', 'k-moelleaaen', '2026-06-30'); }],
    ['2026-10-01', async () => {
      await send('u-mlund', 'inst-nykredit', [['k-nordlys', '2026-09-30'], ['k-fjordlys', '2026-09-30']], 'seed-1001-nykredit');
      await send('u-mlund', 'inst-danske', [['k-nordlys', '2026-09-30'], ['k-kildevang', '2026-09-30'], ['k-nordhavn', '2026-09-30']], 'seed-1001-danske');
      await send('u-aali', 'inst-al', [['k-nordlys', '2026-09-30'], ['k-vestkyst', '2026-09-30'], ['k-aalund', '2026-09-30']], 'seed-1001-al');
    }],
    ['2026-10-07', async () => {
      await reply('k-nordlys', '2026-09-30', 'inst-nykredit'); await verifyAndApprove('u-mlund', 'k-nordlys', '2026-09-30', 'inst-nykredit');
      await reply('k-kildevang', '2026-09-30', 'inst-nordea'); await verifyAndApprove('u-mlund', 'k-kildevang', '2026-09-30', 'inst-nordea');
      await reply('k-nordhavn', '2026-09-30', 'inst-nordea'); await verifyAndApprove('u-mlund', 'k-nordhavn', '2026-09-30', 'inst-nordea');
    }],
    ['2026-10-12', () => remind('u-aali', 'k-fjordlys', '2026-09-30', 'inst-nykredit')],
    ['2026-10-15', async () => {
      await reply('k-nordhavn', '2026-09-30', 'inst-danske');
      await verifyAndApprove('u-mlund', 'k-nordhavn', '2026-09-30', 'inst-danske');
      await sendDeviationsToAuditor(db, await as('u-mlund'), (await inquiryOf('k-nordhavn', '2026-09-30', 'inst-danske')).id);
    }],
    ['2026-10-16', async () => {
      const d = await db.deviation.findFirstOrThrow({ where: { caseId: (await caseOf('k-nordhavn', '2026-09-30')).id, type: 'TEGNINGSRET' } });
      await assessDeviation(db, await as('u-sdahl'), d.id, { decision: 'FORKLARET', justification: 'Henrik Gammel er udtrådt 31.03.2026. Kunden har bedt banken slette tegningsretten; ingen transaktioner efter udtræden.' });
    }],
    ['2026-10-19', () => remind('u-aali', 'k-fjordlys', '2026-09-30', 'inst-nykredit')],
    ['2026-10-20', async () => { await remind('u-mlund', 'k-nordlys', '2026-09-30', 'inst-danske'); await remind('u-mlund', 'k-kildevang', '2026-09-30', 'inst-danske'); }],
    ['2026-10-26', async () => undefined],
    ['2026-10-27', async () => {
      await decide('u-kbrink', 'k-fjordlys', '2026-09-30', 'inst-nykredit', 'NY_FRIST', '2026-11-24', 'Nykredit har bekræftet modtagelse; svar lovet inden 24.11.');
      await remind('u-mlund', 'k-nordlys', '2026-09-30', 'inst-danske');
      await remind('u-mlund', 'k-kildevang', '2026-09-30', 'inst-danske');
    }],

    // Balancedag 31.12.2026 – sagerne oprettes ved T−60
    ['2026-11-02', async () => undefined],
    ['2026-11-03', async () => {
      await decide('u-rholm', 'k-nordlys', '2026-09-30', 'inst-danske', 'KUNDE_KONTAKTER', '2026-11-27', 'Kunden kontakter sin rådgiver i Danske Bank.');
      await decide('u-rholm', 'k-kildevang', '2026-09-30', 'inst-danske', 'NY_FRIST', '2026-11-27');
      await sendForSigning(db, await as('u-mlund'), (await fuldmagtDraft('k-solbakken')).id);
    }],
    ['2026-11-04', async () => { await reply('k-nordlys', '2026-09-30', 'inst-al'); await verifyAndApprove('u-mlund', 'k-nordlys', '2026-09-30', 'inst-al'); }],
    ['2026-11-05', async () => {
      await remind('u-aali', 'k-vestkyst', '2026-09-30', 'inst-al');
      await remind('u-mlund', 'k-aalund', '2026-09-30', 'inst-al');
      await penneoSigned(db, (await db.fuldmagt.findFirstOrThrow({ where: { customerId: 'k-solbakken', status: 'SENDT_TIL_SIGNERING' } })).id);
    }],
    ['2026-11-12', async () => {
      await remind('u-aali', 'k-vestkyst', '2026-09-30', 'inst-al');
      await remind('u-mlund', 'k-aalund', '2026-09-30', 'inst-al');
      await customerConfirmBankList(db, await as('u-mlund'), (await caseOf('k-solbakken', '2026-12-31')).id, { instituteIds: ['inst-nordea', 'inst-lindholm'], note: 'Kunden har bekræftet via kundeformularen' });
      await addBankListLine(db, await as('u-agent'), (await caseOf('k-solbakken', '2026-12-31')).id, { instituteId: 'inst-danske', note: 'Overførsler fra Danske Bank i kontoudtog for oktober' });
    }],
    ['2026-11-16', async () => undefined],
    ['2026-11-18', () => approve('u-rholm', 'k-saltholm', '2026-12-31')],
    ['2026-11-19', async () => {
      await decide('u-kbrink', 'k-vestkyst', '2026-09-30', 'inst-al', 'KUNDE_KONTAKTER', '2026-11-27', 'Kunden rykker AL Sydbank.');
      await decide('u-sdahl', 'k-aalund', '2026-09-30', 'inst-al', 'NY_FRIST', '2026-11-27');
    }],
    ['2026-11-20', () => approve('u-rholm', 'k-havnegade', '2026-12-31')],
    ['2026-11-23', async () => sendForSigning(db, await as('u-aali'), (await fuldmagtDraft('k-bakkehuset')).id)],
    ['2026-11-24', () => approve('u-sdahl', 'k-groenlund', '2026-12-31')],
    ['2026-11-25', async () => { await approve('u-kbrink', 'k-bakkehuset', '2026-12-31'); await approve('u-kbrink', 'k-padborg', '2026-12-31'); }],
    ['2026-11-26', async () => {
      await approve('u-sdahl', 'k-lysgaard', '2026-09-30');
      await approve('u-sdahl', 'k-soendergaard', '2026-12-31');
      await approve('u-sdahl', 'k-engholm', '2026-12-31');
    }],
    ['2026-11-27', async () => {
      await send('u-mlund', 'inst-nykredit', [['k-lysgaard', '2026-09-30']], 'seed-1127-nykredit');
      await approve('u-kbrink', 'k-rugaardsvej', '2026-12-31');
    }],
    ['2026-11-30', async () => {
      await reply('k-kildevang', '2026-09-30', 'inst-danske');
      await reply('k-aalund', '2026-09-30', 'inst-al', 'FORKERT_DATO');
      await approve('u-kbrink', 'k-kirkegade', '2026-12-31');
    }],
    ['2026-12-01', async () => {
      await verifyAndApprove('u-mlund', 'k-kildevang', '2026-09-30', 'inst-danske');
      await reply('k-vestkyst', '2026-09-30', 'inst-al');
      await sendForSigning(db, await as('u-aali'), (await fuldmagtDraft('k-fyrtaarn')).id);
    }],
    ['2026-12-02', async () => {
      await reply('k-nordlys', '2026-09-30', 'inst-danske');
      await uploadManualFuldmagt(db, await as('u-mlund'), { customerId: 'k-soendergaard', signedDate: '2026-11-28', signerUnits: ['4000001301'], scope: 'GENEREL', fileName: 'Fuldmagt-Soendergaard-underskrevet.pdf' });
      await addBankListLine(db, await as('u-jbach'), (await caseOf('k-havnegade', '2026-12-31')).id, { instituteId: 'inst-lindholm', note: 'Ny erhvervskonto oprettet i november – fundet i kontoudtog' });
    }],
    ['2026-12-03', () => reply('k-lysgaard', '2026-09-30', 'inst-nykredit', 'UIDENTIFICERET')],
  ];

  for (const [date, action] of steps) {
    if (date > until) break;
    await setToday(db, date);
    const summary = await runDailyJob(db);
    await action();
    log(`${date}: daglig kørsel (${summary.casesCreated} nye sager, ${summary.remindersSuggested} rykkerforslag, ${summary.escalations} eskaleringer) + handlinger`);
  }
}
