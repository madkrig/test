import { RULE_CATALOG } from '@/domain/ef';
import type { Db } from '@/services';

/**
 * Syntetisk verden til demo og test. Alle kunder, personer, CVR-numre,
 * kontonumre og beløb er fiktive. Pengeinstitutternes kanaler følger
 * bilag C (offentlige oplysninger hentet 5.10.2026) og skal verificeres.
 */

export const USERS = [
  { id: 'u-rholm', name: 'Rikke Holm', initials: 'RH', role: 'OR', department: 'Revision Øst' },
  { id: 'u-sdahl', name: 'Søren Dahl', initials: 'SD', role: 'OR', department: 'Revision Øst' },
  { id: 'u-kbrink', name: 'Kasper Brink', initials: 'KB', role: 'OR', department: 'Revision Vest' },
  { id: 'u-jbach', name: 'Julie Bach', initials: 'JB', role: 'RM', department: 'Revision Øst' },
  { id: 'u-tnoer', name: 'Tobias Nør', initials: 'TN', role: 'RM', department: 'Revision Vest' },
  { id: 'u-mlund', name: 'Maja Lund', initials: 'ML', role: 'KM', department: 'Kerneteam Øst' },
  { id: 'u-aali', name: 'Ahmad Ali', initials: 'AA', role: 'KM', department: 'Kerneteam Vest' },
  { id: 'u-lfrost', name: 'Lone Frost', initials: 'LF', role: 'KL', department: 'Kerneteam' },
  { id: 'u-nvang', name: 'Niels Vang', initials: 'NV', role: 'PE', department: 'Procesejer' },
  { id: 'u-drift', name: 'IT-drift', initials: 'IT', role: 'ADMIN', department: 'IT' },
  { id: 'u-agent', name: 'Cedra-agent', initials: 'AI', role: 'AGENT', department: 'Agent' },
] as const;

type Inst = {
  id: string; name: string; cvr: string; channel: string; channelAddress: string; senderDomains: string[]; authRequirement?: string; authMaxAgeMonths?: number;
  responseWorkdays: number; seasonDeadline?: string; earliestSendOffset?: number; latestSendOffset?: number; fee?: string; bulkFileRule?: string; source: string;
  verified: boolean; counterpartyType?: string; mergedIntoId?: string; active?: boolean;
};

const BILAG_C = 'Bilag C – offentlige sider 05.10.2026';
export const INSTITUTES: Inst[] = [
  { id: 'inst-nordea', name: 'Nordea', cvr: '90000101', channel: 'EMAIL', channelAddress: 'revisor@nordea.dk', senderDomains: ['nordea.dk', 'nordea.com'], responseWorkdays: 15, seasonDeadline: '02-26', earliestSendOffset: -30, latestSendOffset: -16, fee: '1.000 kr.', source: BILAG_C, verified: true },
  { id: 'inst-nykredit', name: 'Nykredit', cvr: '90000102', channel: 'BULKFIL', channelAddress: 'engagementsforespoergsel@nykredit.dk', senderDomains: ['nykredit.dk'], responseWorkdays: 4, seasonDeadline: '01-29', fee: 'Efter erhvervsprisliste', bulkFileRule: 'Excel-skabelon; fuldmagter som PDF navngivet "CVR no [nummer]" i zip-filen "Massebesvarelse". Webformular ved ét CVR.', source: BILAG_C, verified: true },
  { id: 'inst-al', name: 'AL Sydbank', cvr: '90000103', channel: 'EMAIL', channelAddress: 'revisorforespoergsel@al-bank.dk', senderDomains: ['al-bank.dk', 'sydbank.dk'], responseWorkdays: 22, fee: 'Efter prisliste', source: BILAG_C, verified: false },
  { id: 'inst-sparnord', name: 'Spar Nord', cvr: '90000104', channel: 'EMAIL', channelAddress: 'Verificeres – overtaget af Nykredit', senderDomains: ['sparnord.dk'], responseWorkdays: 10, source: BILAG_C, verified: false, mergedIntoId: 'inst-nykredit', active: false },
  { id: 'inst-danske', name: 'Danske Bank', cvr: '90000105', channel: 'PLATFORM', channelAddress: 'Circit (digital platform)', senderDomains: ['danskebank.dk', 'circit.io'], responseWorkdays: 10, source: BILAG_C, verified: false },
  { id: 'inst-lindholm', name: 'Lindholm Sparekasse', cvr: '90000106', channel: 'WEBFORM', channelAddress: 'https://lindholm-sparekasse.example/revisor', senderDomains: ['lindholm-sparekasse.example'], responseWorkdays: 5, source: 'Sidste års forespørgsler (fase 0)', verified: true },
  { id: 'inst-boelge', name: 'Bølgebanken', cvr: '90000107', channel: 'EMAIL', channelAddress: 'revision@boelgebanken.example', senderDomains: ['boelgebanken.example'], authRequirement: 'BANKSPECIFIK', authMaxAgeMonths: 24, responseWorkdays: 10, source: 'Sidste års forespørgsler (fase 0)', verified: true },
  { id: 'inst-ostsee', name: 'Ostsee Handelsbank AG (Tyskland)', cvr: 'DE-0000001', channel: 'MANUEL', channelAddress: 'Brev til Kontoführung, Flensburg', senderDomains: ['ostsee-handelsbank.example'], responseWorkdays: 20, source: 'Sidste års forespørgsler (fase 0)', verified: true, counterpartyType: 'UDENLANDSK' },
];

const R1 = 'Selskabet tegnes af en direktør alene eller af to bestyrelsesmedlemmer i forening.';
const R2 = 'Selskabet tegnes af direktionen.';
const R3 = 'Selskabet tegnes af en direktør i forening med et bestyrelsesmedlem eller af den samlede bestyrelse.';
const R4 = 'Selskabet tegnes af bestyrelsesformanden alene eller af to bestyrelsesmedlemmer i forening.';

type PersonSpec = [unit: string, name: string, role: 'DIREKTOER' | 'FORMAND' | 'BESTYRELSESMEDLEM', from?: string, to?: string];
type Line = { category: string; accountRef: string | null; description: string; currency?: string; amountKr: number | null; securityDescription?: string; lowConfidence?: boolean };
type Ledger = { inst: string | null; ref: string; name: string; kr: number };

export interface CustomerSpec {
  id: string; name: string; cvr: string; rule: string; ruleChangedAt?: string; persons: PersonSpec[];
  type?: 'REVISION' | 'REVIEW'; T: string; start: string; P: string; or: string; dep: 'Revision Øst' | 'Revision Vest'; team: string[]; optIn?: boolean;
  history: string[]; ledger: Ledger[]; trivialKr: number;
  /** Afvigende svar fra banken pr. institut; ellers svarer banken med bogføringen. */
  statements?: Record<string, { lines: Line[]; signingRights?: string[]; missingCategories?: string[] }>;
  fuldmagt?: { holderCvr?: string; signedDate: string; signers: string[] } | null;
  confidentialUserIds?: string[];
  conflicts?: string[];
  cvrStatus?: string;
}

const p = (n: number) => `40${String(n).padStart(8, '0')}`;

export const CUSTOMERS: CustomerSpec[] = [
  // --- Balancedag 30.06.2026 – afsluttet i demoen -------------------------------------------
  { id: 'k-havbryggen', name: 'Havbryggen ApS', cvr: '37220115', rule: R2, persons: [[p(101), 'Jens Havmand', 'DIREKTOER', '2015-01-01']], T: '2026-06-30', start: '2025-07-01', P: '2026-09-25', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-nordea', 'inst-lindholm'], trivialKr: 10000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0000210331', name: 'Driftskonto', kr: 845120.5 }, { inst: 'inst-nordea', ref: '1234-0000210332', name: 'Lån', kr: -1200000 }, { inst: 'inst-lindholm', ref: '9070-0001100221', name: 'Opsparing', kr: 150000 }],
    fuldmagt: { signedDate: '2024-09-02', signers: [p(101)] } },
  { id: 'k-moelleaaen', name: 'Mølleåen Consult ApS', cvr: '36550782', rule: R1, persons: [[p(201), 'Line Mølgaard', 'DIREKTOER', '2018-01-01'], [p(202), 'Per Aagaard', 'FORMAND', '2018-01-01'], [p(203), 'Bo Kirk', 'BESTYRELSESMEDLEM', '2018-01-01']], T: '2026-06-30', start: '2025-07-01', P: '2026-09-29', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-danske'], trivialKr: 8000,
    ledger: [{ inst: 'inst-danske', ref: '3001-0004470012', name: 'Driftskonto', kr: 412300 }], fuldmagt: { signedDate: '2024-10-01', signers: [p(201)] } },

  // --- Balancedag 30.09.2026 – svar og afstemning --------------------------------------------
  { id: 'k-nordlys', name: 'Nordlys Tømrer ApS', cvr: '38114471', rule: R1, persons: [[p(301), 'Rasmus Nordahl', 'DIREKTOER', '2016-03-01'], [p(302), 'Hanne Lys', 'FORMAND', '2016-03-01'], [p(303), 'Kim Bøg', 'BESTYRELSESMEDLEM', '2016-03-01']], T: '2026-09-30', start: '2025-10-01', P: '2027-01-29', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-danske', 'inst-nykredit'], trivialKr: 15000,
    ledger: [
      { inst: 'inst-danske', ref: '3001-0000110412', name: 'Indlån', kr: 485230.17 },
      { inst: 'inst-danske', ref: '3001-0000110498', name: 'Indlån (EUR)', kr: 92476.26 },
      { inst: 'inst-danske', ref: '3001-0000115520', name: 'Lån', kr: -3100000 },
      { inst: 'inst-danske', ref: '3001-0000119001', name: 'Depot', kr: 310000 },
      { inst: 'inst-danske', ref: '3001-0000110455', name: 'Indlån', kr: 12600 },
      { inst: 'inst-nykredit', ref: '5470-0000330017', name: 'Realkreditlån', kr: -2450000 },
      { inst: 'inst-al', ref: '7780-0001234567', name: 'Erhvervskonto', kr: 64250 },
    ],
    statements: {
      'inst-danske': {
        lines: [
          { category: 'INDLAAN', accountRef: '3001-0000110412', description: 'Indlån', amountKr: 485230.17 },
          { category: 'INDLAAN', accountRef: '3001-0000110498', description: 'Indlån (EUR)', currency: 'EUR', amountKr: 12396.78 },
          { category: 'KREDIT', accountRef: '3001-0000117731', description: 'Kassekredit', amountKr: -1250000, lowConfidence: true },
          { category: 'UDLAAN', accountRef: '3001-0000115520', description: 'Lån', amountKr: -3120000 },
          { category: 'DEPOT', accountRef: '3001-0000119001', description: 'Depot', amountKr: 310000 },
          { category: 'SIKKERHED_STILLET', accountRef: null, description: 'Virksomhedspant', amountKr: 2000000, securityDescription: 'Virksomhedspant' },
          { category: 'GARANTI', accountRef: null, description: 'Huslejegaranti', amountKr: 150000, securityDescription: 'Huslejegaranti' },
        ],
        signingRights: ['Rasmus Nordahl', 'Hanne Lys'],
      },
    },
    fuldmagt: { signedDate: '2024-11-12', signers: [p(301)] } },
  { id: 'k-fjordlys', name: 'Fjordlys Ejendomme A/S', cvr: '35870214', rule: R3, persons: [[p(401), 'Ole Fjord', 'DIREKTOER', '2012-01-01'], [p(402), 'Ida Strand', 'FORMAND', '2012-01-01'], [p(403), 'Mads Klit', 'BESTYRELSESMEDLEM', '2012-01-01']], T: '2026-09-30', start: '2025-10-01', P: '2026-12-18', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-nykredit'], trivialKr: 50000,
    ledger: [{ inst: 'inst-nykredit', ref: '5470-0000441200', name: 'Realkreditlån', kr: -8900000 }, { inst: 'inst-nykredit', ref: '5470-0000441201', name: 'Driftskonto', kr: 1240000 }],
    fuldmagt: { signedDate: '2025-01-20', signers: [p(401), p(403)] } },
  { id: 'k-vestkyst', name: 'Vestkyst Maskiner ApS', cvr: '39441208', rule: R1, persons: [[p(501), 'Anders Vestergaard', 'DIREKTOER', '2017-05-01'], [p(502), 'Sanne Holt', 'FORMAND', '2017-05-01'], [p(503), 'Erik Dam', 'BESTYRELSESMEDLEM', '2017-05-01']], T: '2026-09-30', start: '2025-10-01', P: '2027-01-15', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-al'], trivialKr: 12000,
    ledger: [{ inst: 'inst-al', ref: '7780-0002201100', name: 'Driftskonto', kr: 230450 }, { inst: 'inst-al', ref: '7780-0002201101', name: 'Kassekredit', kr: -410000 }],
    statements: {
      'inst-al': {
        lines: [
          { category: 'INDLAAN', accountRef: '7780-0002201100', description: 'Driftskonto', amountKr: 230450 },
          { category: 'KREDIT', accountRef: '7780-0002201101', description: 'Kassekredit', amountKr: -410000, lowConfidence: true },
          { category: 'GARANTI', accountRef: null, description: 'Bankgaranti til leverandør', amountKr: 75000, securityDescription: 'Bankgaranti til leverandør' },
        ],
        signingRights: ['Anders Vestergaard'],
      },
    },
    fuldmagt: { signedDate: '2025-02-03', signers: [p(501)] } },
  { id: 'k-aalund', name: 'Aalund & Co. ApS', cvr: '33190876', rule: R2, persons: [[p(601), 'Karen Aalund', 'DIREKTOER', '2010-01-01'], [p(602), 'Peter Aalund', 'DIREKTOER', '2010-01-01']], T: '2026-09-30', start: '2025-10-01', P: '2027-01-20', or: 'u-sdahl', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-al'], trivialKr: 5000,
    ledger: [{ inst: 'inst-al', ref: '7780-0003300450', name: 'Driftskonto', kr: 98200 }], fuldmagt: { signedDate: '2024-12-02', signers: [p(601), p(602)] } },
  { id: 'k-kildevang', name: 'Kildevang Rengøring ApS', cvr: '40227133', rule: R1, persons: [[p(701), 'Mona Kildevang', 'DIREKTOER', '2019-02-01'], [p(702), 'Jens Kilde', 'FORMAND', '2019-02-01'], [p(703), 'Ulla Vang', 'BESTYRELSESMEDLEM', '2019-02-01']], T: '2026-09-30', start: '2025-10-01', P: '2026-12-22', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-danske', 'inst-nordea'], trivialKr: 10000,
    ledger: [{ inst: 'inst-danske', ref: '3001-0000770100', name: 'Driftskonto', kr: 156780.25 }, { inst: 'inst-danske', ref: '3001-0000770101', name: 'Lån', kr: -640000 }, { inst: 'inst-nordea', ref: '1234-0000880011', name: 'Opsparing', kr: 200000 }],
    statements: { 'inst-danske': { lines: [{ category: 'INDLAAN', accountRef: '3001-0000770100', description: 'Driftskonto', amountKr: 156780.25 }, { category: 'UDLAAN', accountRef: '3001-0000770101', description: 'Lån', amountKr: -655000 }], signingRights: ['Mona Kildevang'] } },
    fuldmagt: { signedDate: '2025-03-14', signers: [p(701)] } },
  { id: 'k-lysgaard', name: 'Lysgaard Design ApS', cvr: '41553390', rule: R2, persons: [[p(801), 'Sofie Lysgaard', 'DIREKTOER', '2020-06-01']], T: '2026-09-30', start: '2025-10-01', P: '2027-01-08', or: 'u-sdahl', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-nykredit'], trivialKr: 5000,
    ledger: [{ inst: 'inst-nykredit', ref: '5470-0000559911', name: 'Erhvervskonto', kr: 88400 }], fuldmagt: { signedDate: '2025-04-07', signers: [p(801)] } },
  { id: 'k-nordhavn', name: 'Nordhavn Logistik A/S', cvr: '34009912', rule: R4, persons: [[p(901), 'Jakob Havn', 'DIREKTOER', '2014-01-01'], [p(902), 'Birgit Nord', 'FORMAND', '2014-01-01'], [p(903), 'Leo Kaj', 'BESTYRELSESMEDLEM', '2014-01-01'], [p(904), 'Nina Sø', 'BESTYRELSESMEDLEM', '2014-01-01'], [p(905), 'Henrik Gammel', 'DIREKTOER', '2014-01-01', '2026-03-31']], T: '2026-09-30', start: '2025-10-01', P: '2026-12-30', or: 'u-sdahl', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-nordea', 'inst-danske'], trivialKr: 40000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0000990001', name: 'Driftskonto', kr: 2310400 }, { inst: 'inst-danske', ref: '3001-0000990002', name: 'Valutakonto', kr: 540000 }],
    statements: { 'inst-danske': { lines: [{ category: 'INDLAAN', accountRef: '3001-0000990002', description: 'Valutakonto', amountKr: 540000 }], signingRights: ['Jakob Havn', 'Henrik Gammel'] } },
    fuldmagt: { signedDate: '2025-05-20', signers: [p(902)] } },

  // --- Balancedag 31.12.2026 – sæsonen er i gang -----------------------------------------------
  { id: 'k-havnegade', name: 'Havnegade Holding ApS', cvr: '32448810', rule: R2, persons: [[p(1001), 'Thomas Havgaard', 'DIREKTOER', '2011-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-15', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-nordea', 'inst-danske'], trivialKr: 25000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0001001001', name: 'Driftskonto', kr: 1120000 }, { inst: 'inst-danske', ref: '3001-0001001002', name: 'Investeringskonto', kr: 4300000 }], fuldmagt: { signedDate: '2024-02-12', signers: [p(1001)] } },
  { id: 'k-groenlund', name: 'Grønlund Vognmand A/S', cvr: '31227604', rule: R3, persons: [[p(1101), 'Peter Grønlund', 'DIREKTOER', '2009-01-01'], [p(1102), 'Anne Grønlund', 'FORMAND', '2009-01-01'], [p(1103), 'Jonas Lind', 'BESTYRELSESMEDLEM', '2009-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-26', or: 'u-sdahl', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-nordea'], trivialKr: 20000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0001101001', name: 'Driftskonto', kr: 675000 }, { inst: 'inst-nordea', ref: '1234-0001101002', name: 'Leasingfinansiering', kr: -2200000 }], fuldmagt: { signedDate: '2024-03-04', signers: [p(1101), p(1103)] } },
  { id: 'k-bakkehuset', name: 'Bakkehuset Café ApS', cvr: '42118855', rule: R1, ruleChangedAt: '2026-06-15', persons: [[p(1201), 'Lærke Bakke', 'DIREKTOER', '2026-06-15'], [p(1202), 'Ib Bakke', 'FORMAND', '2019-01-01'], [p(1203), 'Eva Mose', 'BESTYRELSESMEDLEM', '2019-01-01'], [p(1204), 'Ole Bakke', 'DIREKTOER', '2019-01-01', '2026-06-14']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-31', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-danske', 'inst-nordea'], trivialKr: 5000,
    ledger: [{ inst: 'inst-danske', ref: '3001-0001201001', name: 'Driftskonto', kr: 64300 }, { inst: 'inst-nordea', ref: '1234-0001201002', name: 'Billån', kr: -185000 }], fuldmagt: { signedDate: '2024-03-01', signers: [p(1204)] } },
  { id: 'k-soendergaard', name: 'Søndergaard El-service ApS', cvr: '30551920', rule: R2, persons: [[p(1301), 'Kurt Søndergaard', 'DIREKTOER', '2008-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-19', or: 'u-sdahl', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-lindholm'], trivialKr: 5000,
    ledger: [{ inst: 'inst-lindholm', ref: '9070-0001301001', name: 'Driftskonto', kr: 143000 }], fuldmagt: { holderCvr: '29990001', signedDate: '2023-01-10', signers: [p(1301)] } },
  { id: 'k-solbakken', name: 'Solbakken Tandklinik ApS', cvr: '43671209', rule: R1, persons: [[p(1401), 'Signe Solbak', 'DIREKTOER', '2025-08-01'], [p(1402), 'Arne Solbak', 'FORMAND', '2025-08-01'], [p(1403), 'Pia Holm', 'BESTYRELSESMEDLEM', '2025-08-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-04-15', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach', 'u-agent'], history: [], trivialKr: 8000,
    ledger: [{ inst: null, ref: '1234-0001401001', name: 'Bank (ikke mappet i SAF-T)', kr: 212000 }], fuldmagt: null },
  { id: 'k-fyrtaarn', name: 'Fyrtårn Software ApS', cvr: '44120378', rule: R2, persons: [[p(1501), 'Mikkel Fyr', 'DIREKTOER', '2021-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-31', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-danske'], trivialKr: 10000,
    ledger: [{ inst: 'inst-danske', ref: '3001-0001501001', name: 'Driftskonto', kr: 890000 }], fuldmagt: { holderCvr: '29990002', signedDate: '2024-05-15', signers: [p(1501)] } },
  { id: 'k-engholm', name: 'Engholm Invest ApS', cvr: '29874411', rule: R4, persons: [[p(1601), 'Claus Engholm', 'FORMAND', '2005-01-01'], [p(1602), 'Rita Engholm', 'BESTYRELSESMEDLEM', '2005-01-01'], [p(1603), 'Sune Berg', 'DIREKTOER', '2015-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-24', or: 'u-sdahl', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-nordea'], trivialKr: 30000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0001601001', name: 'Depot', kr: 7400000 }], fuldmagt: { holderCvr: '30000002', signedDate: '2023-06-01', signers: [p(1601)] } },
  { id: 'k-rugaardsvej', name: 'Rugårdsvej Transport ApS', cvr: '38660127', rule: R1, persons: [[p(1701), 'Birthe Rugård', 'DIREKTOER', '2013-01-01'], [p(1702), 'Finn Rugård', 'FORMAND', '2013-01-01'], [p(1703), 'Kaj Lund', 'BESTYRELSESMEDLEM', '2013-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-31', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-nordea', 'inst-boelge'], trivialKr: 15000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0001701001', name: 'Driftskonto', kr: 410000 }, { inst: 'inst-boelge', ref: '6610-0001701002', name: 'Lastbilfinansiering', kr: -1650000 }], fuldmagt: { signedDate: '2025-02-20', signers: [p(1701)] } },
  { id: 'k-saltholm', name: 'Saltholm Kapital A/S', cvr: '36998801', rule: R3, persons: [[p(1801), 'Victor Salt', 'DIREKTOER', '2016-01-01'], [p(1802), 'Agnes Holm', 'FORMAND', '2016-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-12', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach'], history: ['inst-danske', 'inst-nordea'], trivialKr: 100000,
    ledger: [{ inst: 'inst-danske', ref: '3001-0001801001', name: 'Depot', kr: 25600000 }, { inst: 'inst-nordea', ref: '1234-0001801002', name: 'Driftskonto', kr: 1900000 }], fuldmagt: { signedDate: '2024-04-18', signers: [p(1801), p(1802)] },
    confidentialUserIds: ['u-rholm', 'u-jbach', 'u-mlund', 'u-lfrost'] },
  { id: 'k-kirkegade', name: 'Kirkegade Bolig A/S', cvr: '35112290', rule: R2, persons: [[p(1901), 'Henriette Kirk', 'DIREKTOER', '2012-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-31', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-sparnord'], trivialKr: 20000,
    ledger: [{ inst: 'inst-sparnord', ref: '9280-0001901001', name: 'Driftskonto', kr: 356000 }], fuldmagt: { signedDate: '2024-06-10', signers: [p(1901)] }, conflicts: ['u-aali'] },
  { id: 'k-padborg', name: 'Grænsehandel Padborg ApS', cvr: '37750093', rule: R2, persons: [[p(2001), 'Jörg Petersen', 'DIREKTOER', '2014-01-01']], T: '2026-12-31', start: '2026-01-01', P: '2027-03-31', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: ['inst-danske', 'inst-ostsee'], trivialKr: 10000,
    ledger: [{ inst: 'inst-danske', ref: '3001-0002001001', name: 'Driftskonto', kr: 230000 }, { inst: 'inst-ostsee', ref: 'DE89-0002001002', name: 'Geschäftskonto (EUR)', kr: 118000 }], fuldmagt: { signedDate: '2025-01-08', signers: [p(2001)] } },
  { id: 'k-strandvejen', name: 'Strandvejens Bageri ApS', cvr: '40998123', rule: R2, persons: [[p(2101), 'Gitte Strand', 'DIREKTOER', '2020-01-01']], type: 'REVIEW', T: '2026-12-31', start: '2026-01-01', P: '2027-04-30', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach'], history: [], trivialKr: 5000,
    ledger: [{ inst: 'inst-danske', ref: '3001-0002101001', name: 'Driftskonto', kr: 51000 }], fuldmagt: { signedDate: '2025-03-01', signers: [p(2101)] } },

  // --- Balancedag 31.03.2027 – kun i kapacitetsprognosen ---------------------------------------
  { id: 'k-elmegaarden', name: 'Elmegården Gartneri ApS', cvr: '39001144', rule: R2, persons: [[p(2201), 'Tove Elm', 'DIREKTOER', '2016-01-01']], T: '2027-03-31', start: '2026-04-01', P: '2027-06-25', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: [], trivialKr: 8000,
    ledger: [{ inst: 'inst-al', ref: '7780-0002201901', name: 'Driftskonto', kr: 120000 }, { inst: 'inst-nykredit', ref: '5470-0002201902', name: 'Realkreditlån', kr: -1900000 }], fuldmagt: { signedDate: '2025-06-01', signers: [p(2201)] } },
  { id: 'k-bredgade', name: 'Bredgade Arkitekter ApS', cvr: '41220988', rule: R2, persons: [[p(2301), 'Anna Bred', 'DIREKTOER', '2018-01-01']], T: '2027-03-31', start: '2026-04-01', P: '2027-06-18', or: 'u-rholm', dep: 'Revision Øst', team: ['u-jbach'], history: [], trivialKr: 8000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0002301001', name: 'Driftskonto', kr: 310000 }, { inst: 'inst-danske', ref: '3001-0002301002', name: 'Opsparing', kr: 500000 }], fuldmagt: { signedDate: '2025-05-05', signers: [p(2301)] } },
  { id: 'k-klitgaard', name: 'Klitgaard Fiskeeksport A/S', cvr: '33887120', rule: R2, persons: [[p(2401), 'Bjarne Klitgaard', 'DIREKTOER', '2001-01-01']], T: '2027-03-31', start: '2026-04-01', P: '2027-06-30', or: 'u-kbrink', dep: 'Revision Vest', team: ['u-tnoer'], history: [], trivialKr: 50000,
    ledger: [{ inst: 'inst-nordea', ref: '1234-0002401001', name: 'Valutakonto (EUR)', kr: 2800000 }, { inst: 'inst-danske', ref: '3001-0002401002', name: 'Kassekredit', kr: -3500000 }, { inst: 'inst-boelge', ref: '6610-0002401003', name: 'Skibslån', kr: -12000000 }], fuldmagt: { signedDate: '2024-11-11', signers: [p(2401)] } },
];

const ore = (kr: number) => Math.round(kr * 100);
const previousBalanceDate = (T: string) => `${Number(T.slice(0, 4)) - 1}${T.slice(4)}`;

/** Sletter alt og indlæser kildedata, bankregister, regler og migreret historik. */
export async function seedWorld(db: Db, opts: { startDate: string }) {
  const tables = [
    'event', 'notification', 'integrationCall', 'idempotencyKey', 'task', 'document', 'deviation', 'reconLine', 'responseLine', 'response', 'batch', 'inquiry',
    'bankListLine', 'fuldmagtSigner', 'fuldmagt', 'case', 'rule', 'instituteChange', 'institute', 'srcBankStatement', 'srcFxRate', 'srcMateriality', 'srcLedgerAccount',
    'srcConflict', 'srcTeamMember', 'srcEngagement', 'srcPerson', 'srcCustomer', 'user', 'setting',
  ] as const;
  for (const t of tables) await (db[t] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();

  await db.setting.create({ data: { key: 'today', value: opts.startDate } });
  for (const [k, v] of [['kerneteam:Revision Øst', 'u-mlund'], ['kerneteam:Revision Vest', 'u-aali'], ['kerneteam:vagt', 'u-mlund']]) await db.setting.create({ data: { key: k!, value: v! } });
  for (const u of USERS) await db.user.create({ data: { ...u } });
  for (const r of RULE_CATALOG) {
    await db.rule.create({ data: { id: `regel-${r.ruleId}-1`, ruleId: r.ruleId, version: 1, type: r.type, title: r.title, description: r.description, params: JSON.stringify(r.params), activeFrom: '2026-01-01', changedById: 'u-nvang', reason: 'Version 1 fra løsningsdesignet v0.95' } });
  }
  for (const i of INSTITUTES) {
    await db.institute.create({
      data: {
        id: i.id, name: i.name, cvr: i.cvr, channel: i.channel, channelAddress: i.channelAddress, senderDomains: JSON.stringify(i.senderDomains), authRequirement: i.authRequirement ?? 'GENEREL',
        authMaxAgeMonths: i.authMaxAgeMonths ?? null, responseWorkdays: i.responseWorkdays, seasonDeadline: i.seasonDeadline ?? null, earliestSendOffset: i.earliestSendOffset ?? 1,
        latestSendOffset: i.latestSendOffset ?? null, fee: i.fee ?? null, bulkFileRule: i.bulkFileRule ?? null, source: i.source, verifiedAt: i.verified ? '2026-10-12' : '',
        verifiedById: i.verified ? 'u-lfrost' : null, counterpartyType: i.counterpartyType ?? 'PENGEINSTITUT', mergedIntoId: i.mergedIntoId ?? null, active: i.active ?? true,
      },
    });
  }
  for (const date of ['2025-06-30', '2025-09-30', '2025-12-31', '2026-06-30', '2026-09-30', '2026-12-31']) {
    await db.srcFxRate.create({ data: { date, currency: 'EUR', rate: 7.4597 } });
    await db.srcFxRate.create({ data: { date, currency: 'USD', rate: 6.4210 } });
  }

  for (const c of CUSTOMERS) {
    await db.srcCustomer.create({
      data: {
        id: c.id, name: c.name, cvr: c.cvr, cvrStatus: c.cvrStatus ?? 'NORMAL', signingRule: c.rule, signingRuleChangedAt: c.ruleChangedAt ?? '2010-01-01',
        confidential: !!c.confidentialUserIds, confidentialUserIds: JSON.stringify(c.confidentialUserIds ?? []), contactEmail: `bogholderi@${c.id.slice(2)}.example`,
      },
    });
    for (const [unit, name, role, from, to] of c.persons) await db.srcPerson.create({ data: { id: `pers-${unit}`, customerId: c.id, unitNumber: unit, name, role, from: from ?? '2010-01-01', to: to ?? null } });
    const engagementId = `opg-${c.id.slice(2)}-${c.T.slice(0, 4)}`;
    await db.srcEngagement.create({ data: { id: engagementId, customerId: c.id, type: c.type ?? 'REVISION', periodStart: c.start, periodEnd: c.T, plannedSignOff: c.P, responsibleId: c.or, department: c.dep, optIn: c.optIn ?? false, createdAt: '2026-01-05' } });
    for (const u of new Set([c.or, ...c.team])) await db.srcTeamMember.create({ data: { engagementId, userId: u } });
    for (const u of c.conflicts ?? []) await db.srcConflict.create({ data: { userId: u, customerId: c.id } });
    await db.srcMateriality.create({ data: { engagementId, trivialThreshold: ore(c.trivialKr) } });
    for (const [n, l] of c.ledger.entries()) {
      await db.srcLedgerAccount.create({ data: { id: `fin-${c.id.slice(2)}-${n}`, customerId: c.id, balanceDate: c.T, accountRef: l.ref, name: l.name, instituteId: l.inst, balanceOre: ore(l.kr) } });
    }
    // Pengeinstituttets data (bruges af simulatoren): som bogføringen, medmindre andet er angivet.
    const byInst = new Map<string, Ledger[]>();
    for (const l of c.ledger.filter((x) => x.inst)) byInst.set(l.inst!, [...(byInst.get(l.inst!) ?? []), l]);
    const mgmtNow = c.persons.filter((x) => !x[4]).map((x) => x[1]);
    for (const instId of new Set([...byInst.keys(), ...Object.keys(c.statements ?? {})])) {
      const custom = c.statements?.[instId];
      const lines = custom
        ? custom.lines.map((l) => ({ category: l.category, accountRef: l.accountRef, description: l.description, currency: l.currency ?? 'DKK', amountOre: l.amountKr === null ? null : ore(l.amountKr), securityDescription: l.securityDescription ?? null, lowConfidence: l.lowConfidence ?? false }))
        : (byInst.get(instId) ?? []).map((l) => ({ category: l.kr < 0 ? 'UDLAAN' : 'INDLAAN', accountRef: l.ref, description: l.name, currency: 'DKK', amountOre: ore(l.kr), securityDescription: null, lowConfidence: false }));
      await db.srcBankStatement.create({ data: { id: `bs-${c.id.slice(2)}-${instId}`, customerId: c.id, instituteId: instId, balanceDate: c.T, lines: JSON.stringify({ lines, missingCategories: custom?.missingCategories ?? [] }), signingRights: JSON.stringify(custom?.signingRights ?? mgmtNow.slice(0, 1)) } });
    }

    // Migreret historik (fase 0): sidste års sag fra Excel-banklisten – låst, kun som grundlag for forslaget.
    if (c.history.length) {
      const prevT = previousBalanceDate(c.T);
      const caseId = `sag-hist-${c.id.slice(2)}`;
      await db.case.create({
        data: {
          id: caseId, engagementId: `${engagementId}-hist`, customerId: c.id, cvr: c.cvr, engagementType: c.type ?? 'REVISION', balanceDate: prevT, plannedSignOff: previousBalanceDate(c.P), responsibleId: c.or,
          department: c.dep, status: 'LAAST', rulesAsOf: '2026-01-01', bankListApprovedById: c.or, bankListApprovedAt: `${prevT}T09:00:00`, conclusion: 'Migreret fra Excel-banklisten og sidste års arbejdspapirer (fase 0).',
          concludedById: c.or, concludedAt: `${previousBalanceDate(c.P)}T12:00:00`, lockedAt: `${previousBalanceDate(c.P)}T12:00:00`, nextAction: 'Ingen – sagen er konkluderet og låst', nextOwner: '–', createdAt: '2026-01-02T08:00:00', updatedAt: '2026-01-02T08:00:00',
        },
      });
      for (const instId of c.history) await db.bankListLine.create({ data: { id: `bl-hist-${c.id.slice(2)}-${instId}`, caseId, instituteId: instId, sources: JSON.stringify(['SIDSTE_AAR']), customerConfirmed: true, createdAt: '2026-01-02T08:00:00' } });
      await db.event.create({ data: { id: `ev-0-hist-${c.id.slice(2)}`, objectType: 'Sag', objectId: caseId, caseId, action: 'sag.migreret', actorId: 'system', source: 'SYSTEM', at: '2026-01-02T08:00:00', reason: 'Fase 0: bankliste og status migreret fra Excel/Access' } });
    }
    if (c.fuldmagt) {
      const id = `fm-hist-${c.id.slice(2)}`;
      await db.fuldmagt.create({
        data: {
          id, customerId: c.id, cvr: c.cvr, holderName: c.fuldmagt.holderCvr === '30000002' ? 'inforevision (tidligere Cedra-enhed)' : c.fuldmagt.holderCvr ? 'Tidligere revisor (carve-out)' : 'Cedra Statsautoriseret Revisionspartnerselskab',
          holderCvr: c.fuldmagt.holderCvr ?? '41000001', scope: 'GENEREL', status: 'GYLDIG', signedDate: c.fuldmagt.signedDate, signingRuleSnapshot: c.rule, signingSource: 'PENNEO',
          penneoCaseId: `penneo-${c.cvr.slice(-6)}`, documentRef: `sharepoint://Engagementsforespoergsler/${c.cvr}/Fuldmagt-${c.fuldmagt.signedDate}.pdf`, verifiedById: 'system', verifiedAt: `${c.fuldmagt.signedDate}T10:00:00`, createdAt: `${c.fuldmagt.signedDate}T09:00:00`,
        },
      });
      for (const unit of c.fuldmagt.signers) {
        const person = c.persons.find((x) => x[0] === unit)!;
        await db.fuldmagtSigner.create({ data: { id: `fs-hist-${unit}`, fuldmagtId: id, unitNumber: unit, name: person[1], role: person[2], mitidVerified: true, signedAt: `${c.fuldmagt.signedDate}T10:00:00` } });
      }
    }
  }
}
