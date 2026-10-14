import type { IsoDate } from './dates';

/**
 * Reglerne er data, ikke kode (afsnit 6.1). Tal i reglerne er parametre, som
 * procesejeren kan ændre med versionering (6.8). Logikken bag hver regel ligger
 * i domænefunktionerne; her står beskrivelse og standardparametre.
 */
export type RuleType = 'TR' | 'VR' | 'AR' | 'ER' | 'FR';

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  TR: 'Udløsning',
  VR: 'Verifikation før afsendelse',
  AR: 'Afstemning og verifikation af svar',
  ER: 'Eskalering og frister',
  FR: 'Fuldmagt',
};

export interface RuleDefinition {
  ruleId: string;
  type: RuleType;
  title: string;
  description: string;
  params: Record<string, number | string | string[] | number[]>;
}

export const PARAM_LABELS: Record<string, string> = {
  pligtTyper: 'Opgavetyper med forespørgselspligt',
  tilvalgTyper: 'Opgavetyper kun ved revisors tilvalg',
  dageFoerT: 'Dage før T',
  forslagDageFoerT: 'Forslag, dage før T',
  godkendelseDageFoerT: 'Godkendelsesfrist, dage før T',
  fristDageFoerT: 'Frist for gyldig fuldmagt, dage før T',
  hverdageEfterT: 'Hverdage efter T (standardafsendelse)',
  toleranceKr: 'Tolerance (kr.)',
  sikkerhedstaerskel: 'Sikkerhedstærskel',
  rykker1Hverdage: '1. rykker, hverdage efter frist',
  rykker2Hverdage: '2. rykker, hverdage efter frist',
  eskaleringHverdage: 'Eskalering, hverdage efter frist',
  dageFoerP: 'Dage før P',
  rettelseHverdage: 'Rettelse, hverdage',
  paamindelseDage: 'Påmindelser, dage efter afsendelse',
  eskaleringDag: 'Eskalering, dag',
  paamindelseDageFoerT: 'Påmindelse, dage før T',
  eskaleringDageFoerT: 'Eskalering, dage før T',
  hverdage: 'Hverdage',
  fuldmagtshaverNavn: 'Fuldmagtshaver (Cedra-enhed)',
  fuldmagtshaverCvr: 'Fuldmagtshavers CVR',
  tidligereEnheder: 'Tidligere enheder (CVR) – behandles som ugyldige',
};

export const RULE_CATALOG: RuleDefinition[] = [
  // 6.2 Udløsningsregler
  { ruleId: 'TR-01', type: 'TR', title: 'Forespørgselspligt', description: 'Revision og udvidet gennemgang har pligt. Review og opstilling kun ved revisors tilvalg.', params: { pligtTyper: ['REVISION', 'UDVIDET_GENNEMGANG'], tilvalgTyper: ['REVIEW', 'OPSTILLING'] } },
  { ruleId: 'TR-02', type: 'TR', title: 'Tidspunkt for oprettelse', description: 'Sag oprettes ved T−60 – eller straks, hvis opgaven oprettes senere.', params: { dageFoerT: 60 } },
  { ruleId: 'TR-03', type: 'TR', title: 'Ny kunde', description: 'Ingen tidligere sag og ingen gyldig fuldmagt: "Indhent bankliste fra kunden" og "Indhent fuldmagt" oprettes straks.', params: {} },
  { ruleId: 'TR-04', type: 'TR', title: 'Fuldmagtskontrol', description: 'Fuldmagtsreglerne køres ved T−60, ved ny tegningsregel og ved afvisning pga. fuldmagt. Gyldig fuldmagt senest T−10.', params: { dageFoerT: 60, fristDageFoerT: 10 } },
  { ruleId: 'TR-05', type: 'TR', title: 'Bankliste', description: 'Forslag til revisor ved T−45; godkendelsesfrist T−30.', params: { forslagDageFoerT: 45, godkendelseDageFoerT: 30 } },
  { ruleId: 'TR-06', type: 'TR', title: 'Nyt institut efter godkendelse', description: 'Tilføjes et institut efter godkendelse, kræves ny godkendelse, og der oprettes en ad hoc-forespørgsel.', params: {} },
  { ruleId: 'TR-07', type: 'TR', title: 'Opgave annulleret / kunde ophørt', description: 'Åbne forespørgsler annulleres; fuldmagten markeres inaktiv.', params: {} },
  { ruleId: 'TR-08', type: 'TR', title: 'Balancedag ændret', description: 'Frister genberegnes; sendte forespørgsler med forkert dato annulleres og genudsendes.', params: {} },
  { ruleId: 'TR-09', type: 'TR', title: 'Førsteårsrevision', description: 'Ny kunde med revision: subopgaven "Primo-forespørgsel" tilbydes revisor (ISA 510).', params: {} },
  { ruleId: 'TR-10', type: 'TR', title: 'Afsendelsestidspunkt', description: 'Tidligst T + instituttets "tidligst afsendelse" (negativ = forudbestilling); ellers første hverdag efter T.', params: { hverdageEfterT: 1 } },
  // 6.3 Verifikation før afsendelse
  { ruleId: 'VR-01', type: 'VR', title: 'CVR aktivt', description: 'Blokerer ved ophør; advarsel ved konkurs eller likvidation.', params: {} },
  { ruleId: 'VR-02', type: 'VR', title: 'Korrekt balancedag', description: 'Balancedagen svarer til periodens slutdato og regnskabsåret i CVR (advarsel).', params: {} },
  { ruleId: 'VR-03', type: 'VR', title: 'Bankliste godkendt', description: 'Opgaveansvarlig revisor (eller delegeret) har godkendt banklisten.', params: {} },
  { ruleId: 'VR-04', type: 'VR', title: 'Gyldig fuldmagt', description: 'Fuldmagten dækker CVR og institut og opfylder FR-01–FR-06.', params: {} },
  { ruleId: 'VR-05', type: 'VR', title: 'Institut kendt', description: 'Instituttet findes i bankregisteret med aktiv kanal.', params: {} },
  { ruleId: 'VR-06', type: 'VR', title: 'Ingen dublet', description: 'Ingen åben forespørgsel for samme CVR, institut og opgørelsesdato.', params: {} },
  { ruleId: 'VR-07', type: 'VR', title: 'Svarmodtager', description: 'Svaret går til Cedras centrale funktionspostkasse (fast værdi).', params: {} },
  { ruleId: 'VR-08', type: 'VR', title: 'Fuldstændig bankliste', description: 'Alle institutter fra sidste års svar og fra SAF-T er med eller har et begrundet fravalg (advarsel ved godkendelse).', params: {} },
  { ruleId: 'VR-09', type: 'VR', title: 'Afsendelsestidspunkt', description: 'Afsendelse sker ikke før instituttets tidligste tidspunkt (TR-10).', params: {} },
  // 6.4 Afstemning og verifikation af svar
  { ruleId: 'AR-01', type: 'AR', title: 'Match', description: 'Svar matches via reference; ellers via CVR, institut og dato. Ellers køen "Uidentificerede svar".', params: {} },
  { ruleId: 'AR-02', type: 'AR', title: 'Afsender', description: 'Svaret kommer fra instituttets registrerede domæne eller kanal – ikke videresendt af kunden (ISA 505, afsnit 10).', params: {} },
  { ruleId: 'AR-03', type: 'AR', title: 'Opgørelsesdato', description: 'Datoen i svaret er den forespurgte balancedag; ellers ny forespørgsel.', params: {} },
  { ruleId: 'AR-04', type: 'AR', title: 'Fuldstændighed', description: 'Alle kategorier er besvaret eller udtrykkeligt angivet som "ingen".', params: {} },
  { ruleId: 'AR-05', type: 'AR', title: 'Saldomatch', description: 'Hver konto matcher bogført saldo efter valutaomregning.', params: { toleranceKr: 0 } },
  { ruleId: 'AR-06', type: 'AR', title: 'Kun i svaret', description: 'Engagement i svaret uden modpost i bogføringen giver en kritisk afvigelse.', params: {} },
  { ruleId: 'AR-07', type: 'AR', title: 'Kun i bogføringen', description: 'Konto i bogføringen, der ikke fremgår af svaret, giver en væsentlig afvigelse.', params: {} },
  { ruleId: 'AR-08', type: 'AR', title: 'Sikkerheder og garantier', description: 'Pant, sikkerhedsstillelser og garantier går altid til revisor som input til noteoplysninger.', params: {} },
  { ruleId: 'AR-09', type: 'AR', title: 'Tegningsret', description: 'Tegningsret i banken, der afviger fra CVR, giver en væsentlig afvigelse (mulig kontrolsvaghed).', params: {} },
  { ruleId: 'AR-10', type: 'AR', title: 'Valuta', description: 'Beløb i fremmed valuta omregnes med Nationalbankens kurs på balancedagen.', params: {} },
  { ruleId: 'AR-11', type: 'AR', title: 'AI-sikkerhed', description: 'Udtrukne linjer under sikkerhedstærsklen kontrolleres manuelt.', params: { sikkerhedstaerskel: 0.95 } },
  // 6.5 Eskalering og frister
  { ruleId: 'ER-01', type: 'ER', title: 'Svarfrist', description: 'Frist = afsendelse + instituttets svartid i hverdage; ved årsskiftet sæsonfristen, hvis den er længere.', params: {} },
  { ruleId: 'ER-02', type: 'ER', title: 'Rykkere', description: '1. og 2. rykker foreslås i køen. Revisor orienteres ved 2. rykker.', params: { rykker1Hverdage: 3, rykker2Hverdage: 8 } },
  { ruleId: 'ER-03', type: 'ER', title: 'Eskalering – manglende svar', description: 'Ved frist + 13 hverdage eller P−15 beslutter revisor: kunden kontakter instituttet, ny frist eller alternative handlinger.', params: { eskaleringHverdage: 13, dageFoerP: 15 } },
  { ruleId: 'ER-04', type: 'ER', title: 'Afvisning', description: 'En afvist forespørgsel rettes og genfremsendes inden 2 hverdage.', params: { rettelseHverdage: 2 } },
  { ruleId: 'ER-05', type: 'ER', title: 'Fuldmagt ikke underskrevet', description: 'Påmindelse dag 5 og 10; eskalering til revisor dag 15.', params: { paamindelseDage: [5, 10], eskaleringDag: 15 } },
  { ruleId: 'ER-06', type: 'ER', title: 'Bankliste ikke godkendt', description: 'Påmindelse til revisor ved T−35; eskalering til kerneteamleder ved T−28.', params: { paamindelseDageFoerT: 35, eskaleringDageFoerT: 28 } },
  { ruleId: 'ER-07', type: 'ER', title: 'Afvigelse ubehandlet', description: 'Påmindelse til revisor og revisionsmedarbejder 5 hverdage efter oprettelse.', params: { hverdage: 5 } },
  { ruleId: 'ER-08', type: 'ER', title: 'Sag ikke konkluderet', description: 'Advarsel til opgaveansvarlig revisor ved P−5.', params: { dageFoerP: 5 } },
  // 6.6 Fuldmagt
  { ruleId: 'FR-01', type: 'FR', title: 'Type', description: 'Generel, stående fuldmagt for alle danske pengeinstitutter; bankspecifik kun, hvor instituttet kræver det.', params: {} },
  { ruleId: 'FR-02', type: 'FR', title: 'Underskrift', description: 'Underskrives af dem, der efter tegningsreglen kan forpligte virksomheden på underskriftsdatoen. Kontrolleres mod CVR.', params: {} },
  { ruleId: 'FR-03', type: 'FR', title: 'Fuldmagtshaver', description: 'Udstedt til den Cedra-enhed, der udfører opgaven. Fuldmagter til tidligere enheder er ugyldige, indtil beslutning D1 siger andet.', params: { fuldmagtshaverNavn: 'Cedra Statsautoriseret Revisionspartnerselskab', fuldmagtshaverCvr: '41000001', tidligereEnheder: ['30000002', '30000003', '30000004'] } },
  { ruleId: 'FR-04', type: 'FR', title: 'Ny tegningsregel', description: 'Ændres tegningsreglen efter underskrift, skal fuldmagten fornyes før næste afsendelse.', params: {} },
  { ruleId: 'FR-05', type: 'FR', title: 'Udtrådt underskriver', description: 'Er en underskriver udtrådt, men tegningsreglen uændret, bør fuldmagten fornyes.', params: {} },
  { ruleId: 'FR-06', type: 'FR', title: 'Alder', description: 'Overskrider fuldmagten instituttets maksimale alder, skal den fornyes. Cedras standard er ingen udløbsdato.', params: {} },
  { ruleId: 'FR-07', type: 'FR', title: 'Tilbagekaldelse', description: 'Tilbagekaldes fuldmagten, stoppes åbne forespørgsler.', params: {} },
  { ruleId: 'FR-08', type: 'FR', title: 'Dokumentation', description: 'Fuldmagten arkiveres i SharePoint med CVR, underskrivere, dato, omfang og Penneo-sags-ID.', params: {} },
  { ruleId: 'FR-09', type: 'FR', title: 'Manuel underskrift', description: 'Fuldmagter underskrevet på papir kræver 4-øjne-kontrol af underskrifterne mod tegningsreglen.', params: {} },
];

export interface RuleVersion {
  ruleId: string;
  version: number;
  params: Record<string, unknown>;
  activeFrom: IsoDate;
  activeTo: IsoDate | null;
}

/**
 * Parametre for en regel pr. dato. Sager evalueres med det regelsæt, der
 * gjaldt, da de blev oprettet (6.8).
 */
export function paramsAt(versions: RuleVersion[], ruleId: string, date: IsoDate): Record<string, unknown> {
  const match = versions
    .filter((v) => v.ruleId === ruleId && v.activeFrom <= date && (!v.activeTo || date < v.activeTo))
    .sort((a, b) => b.version - a.version)[0];
  if (match) return match.params;
  const fallback = RULE_CATALOG.find((r) => r.ruleId === ruleId);
  if (!fallback) throw new Error(`Ukendt regel ${ruleId}`);
  return fallback.params;
}

/** Typede parametre, som domænefunktionerne bruger. */
export interface RuleParams {
  mandatoryTypes: string[];
  optInTypes: string[];
  createDaysBeforeT: number;
  authCheckDaysBeforeT: number;
  authDeadlineDaysBeforeT: number;
  proposalDaysBeforeT: number;
  approvalDaysBeforeT: number;
  sendWorkdaysAfterT: number;
  toleranceOre: number;
  aiThreshold: number;
  reminder1Workdays: number;
  reminder2Workdays: number;
  escalationWorkdays: number;
  escalationDaysBeforeP: number;
  rejectionFixWorkdays: number;
  authReminderDays: number[];
  authEscalationDay: number;
  bankListReminderDaysBeforeT: number;
  bankListEscalationDaysBeforeT: number;
  deviationReminderWorkdays: number;
  concludeWarningDaysBeforeP: number;
  holderName: string;
  holderCvr: string;
  previousHolders: string[];
}

export function resolveParams(versions: RuleVersion[], date: IsoDate): RuleParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parametre er JSON fra regeltabellen
  const p = (id: string) => paramsAt(versions, id, date) as Record<string, any>;
  return {
    mandatoryTypes: p('TR-01').pligtTyper,
    optInTypes: p('TR-01').tilvalgTyper,
    createDaysBeforeT: p('TR-02').dageFoerT,
    authCheckDaysBeforeT: p('TR-04').dageFoerT,
    authDeadlineDaysBeforeT: p('TR-04').fristDageFoerT,
    proposalDaysBeforeT: p('TR-05').forslagDageFoerT,
    approvalDaysBeforeT: p('TR-05').godkendelseDageFoerT,
    sendWorkdaysAfterT: p('TR-10').hverdageEfterT,
    toleranceOre: Math.round(Number(p('AR-05').toleranceKr) * 100),
    aiThreshold: p('AR-11').sikkerhedstaerskel,
    reminder1Workdays: p('ER-02').rykker1Hverdage,
    reminder2Workdays: p('ER-02').rykker2Hverdage,
    escalationWorkdays: p('ER-03').eskaleringHverdage,
    escalationDaysBeforeP: p('ER-03').dageFoerP,
    rejectionFixWorkdays: p('ER-04').rettelseHverdage,
    authReminderDays: p('ER-05').paamindelseDage,
    authEscalationDay: p('ER-05').eskaleringDag,
    bankListReminderDaysBeforeT: p('ER-06').paamindelseDageFoerT,
    bankListEscalationDaysBeforeT: p('ER-06').eskaleringDageFoerT,
    deviationReminderWorkdays: p('ER-07').hverdage,
    concludeWarningDaysBeforeP: p('ER-08').dageFoerP,
    holderName: p('FR-03').fuldmagtshaverNavn,
    holderCvr: p('FR-03').fuldmagtshaverCvr,
    previousHolders: p('FR-03').tidligereEnheder,
  };
}

export const DEFAULT_PARAMS: RuleParams = resolveParams([], '2026-01-01');
