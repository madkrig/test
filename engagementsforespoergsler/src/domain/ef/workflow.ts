import type { WorkflowDefinition } from '@/lib/workflow/types';

/**
 * Forespørgslens forløb (figur 4 og P01–P11) som data. Samme definition
 * tegner diagrammet og trin-tabellen på siden "Proces og modernisering".
 */
export const EF_WORKFLOW: WorkflowDefinition = {
  key: 'engagementsforespoergsel',
  title: 'Engagementsforespørgsel',
  start: 'sag',
  steps: [
    { key: 'sag', title: 'Sag oprettes', kind: 'check', who: 'EF-service', badge: 'start', details: ['T−60 (TR-01, TR-02)', 'Ny kunde: bankliste og fuldmagt straks (TR-03)'], routes: [{ outcome: 'forslag T−45', to: 'bankliste', note: 'Sidste års svar + SAF-T (P02)' }] },
    { key: 'bankliste', title: 'Godkend bankliste', kind: 'task', who: 'Opgaveansvarlig revisor', details: ['Frist T−30 (VR-03)', 'Påmindelse T−35, eskalering T−28 (ER-06)'], routes: [{ outcome: 'godkendt', to: 'fuldmagt' }] },
    { key: 'fuldmagt', title: 'Fuldmagtskontrol', kind: 'check', who: 'EF-service', details: ['FR-01–FR-07 mod CVR'], routes: [{ outcome: 'gyldig', to: 'klar' }, { outcome: 'mangler', to: 'penneo' }] },
    { key: 'penneo', title: 'Underskrift i Penneo', kind: 'integration', who: 'Kunde · kernemedarbejder', details: ['MitID; underskrivere tjekkes mod tegningsreglen (FR-02)', 'Påmindelse dag 5 og 10, revisor dag 15 (ER-05)'], routes: [{ outcome: 'underskrevet', to: 'klar' }, { outcome: 'nægtet', to: 'alternativ', note: 'ISA 505.8–9' }] },
    { key: 'klar', title: 'Klar til afsendelse', kind: 'check', who: 'EF-service', details: ['VR-01–VR-09', 'Tidligst efter TR-10'], routes: [{ outcome: 'batch', to: 'sendt', note: 'Samme institut og kanal' }] },
    { key: 'sendt', title: 'Sendt', kind: 'integration', who: 'Kernemedarbejder', details: ['Funktionspostkasse, webformular, bulkfil eller platform', 'Svarfrist ER-01'], routes: [{ outcome: 'svar', to: 'svar' }, { outcome: 'frist + 3', to: 'rykker' }, { outcome: 'afvist', to: 'afvist' }] },
    { key: 'rykker', title: 'Rykket', kind: 'task', who: 'Kernemedarbejder', details: ['1. rykker frist + 3, 2. rykker frist + 8 (ER-02)'], routes: [{ outcome: 'svar', to: 'svar' }, { outcome: 'frist + 13', to: 'eskalering', note: 'Eller P−15 (ER-03)' }] },
    { key: 'afvist', title: 'Ret afvisning', kind: 'task', who: 'Kernemedarbejder', badge: 'exception', details: ['Inden 2 hverdage (ER-04)', 'Også svar med forkert opgørelsesdato (AR-03)'], routes: [{ outcome: 'genfremsendt', to: 'sendt' }] },
    { key: 'eskalering', title: 'Beslut ved manglende svar', kind: 'decision', who: 'Opgaveansvarlig revisor', badge: 'exception', routes: [{ outcome: 'ny frist', to: 'sendt', note: 'Eller: kunden kontakter banken' }, { outcome: 'alternativt', to: 'alternativ' }] },
    { key: 'svar', title: 'Svar modtaget', kind: 'check', who: 'EF-service', details: ['Match på reference (AR-01)', 'Afsender (AR-02) og dato (AR-03)'], routes: [{ outcome: 'verificeret', to: 'afstemning', note: 'Forkert opgørelsesdato behandles som en afvisning' }] },
    { key: 'afstemning', title: 'Afstem mod bogføring', kind: 'task', who: 'Kernemedarbejder', details: ['AI-udtræk; lav sikkerhed kontrolleres (AR-11)', 'AR-05–AR-10'], routes: [{ outcome: 'ingen afvigelser', to: 'konklusion' }, { outcome: 'afvigelser', to: 'revisor' }] },
    { key: 'revisor', title: 'Vurdér afvigelser', kind: 'task', who: 'Revisionsmedarbejder · revisor', details: ['Kritiske og væsentlige lukkes kun af revisor', 'Påmindelse efter 5 hverdage (ER-07)'], routes: [{ outcome: 'behandlet', to: 'konklusion' }] },
    { key: 'alternativ', title: 'Alternative handlinger', kind: 'task', who: 'Revisionsmedarbejder · revisor', badge: 'exception', row: 2, details: ['ISA 505.12', 'Frist P−10'], routes: [{ outcome: 'dokumenteret', to: 'konklusion' }] },
    { key: 'konklusion', title: 'Konkludér', kind: 'task', who: 'Opgaveansvarlig revisor', details: ['Frist P−5 (ER-08)', 'Låses og arkiveres (P11)'], routes: [{ outcome: 'konkluderet', to: 'laast' }] },
  ],
  ends: [{ key: 'laast', title: 'Låst og arkiveret', tone: 'ok' }],
};
