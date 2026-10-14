import { formatDanish, type IsoDate } from './dates';

/**
 * Skabeloner (bilag A og B) – versioneret tekst, der flettes i systemet i
 * stedet for i Word. Fuldmagtsteksten kræver juridisk review før brug.
 */
export const TEMPLATE_VERSIONS = { fuldmagt: 'A.1-udkast', forespoergsel: 'B.1 v1', rykker: 'B.2 v1' };

export function referenceFor(seasonYear: number, sequence: number): string {
  return `EF-${seasonYear}-${String(sequence).padStart(6, '0')}`;
}

export function fuldmagtText(input: { company: string; cvr: string; holderName: string; holderCvr: string; date: IsoDate; signers: { name: string; role: string }[] }): string {
  return [
    'FULDMAGT',
    `${input.company}, CVR-nr. ${input.cvr} ("Virksomheden"), giver hermed ${input.holderName}, CVR-nr. ${input.holderCvr} ("Revisor"), fuldmagt til at indhente oplysninger om Virksomhedens engagementer hos ethvert pengeinstitut og realkreditinstitut i Danmark, som Virksomheden har eller har haft et kundeforhold til.`,
    'Fuldmagten omfatter oplysninger om indlån, udlån og kreditter, depoter, garantier, sikkerheder stillet af og for Virksomheden, tegningsret og fuldmagter samt øvrige engagementer pr. de datoer, Revisor anmoder om.',
    'Pengeinstituttet bedes sende oplysningerne direkte til Revisor.',
    'Virksomheden er indforstået med, at pengeinstituttet kan opkræve gebyr for besvarelsen efter sin prisliste.',
    'Fuldmagten gælder, indtil den tilbagekaldes skriftligt over for Revisor.',
    `Dato: ${formatDanish(input.date)}`,
    'Underskrift(er) i henhold til Virksomhedens tegningsregel:',
    ...input.signers.map((s) => `Navn: ${s.name}     Rolle: ${s.role}`),
  ].join('\n\n');
}

export interface InquiryLetter {
  subject: string;
  body: string;
}

export function inquiryLetter(input: { company: string; cvr: string; institute: string; statementDate: IsoDate; reference: string; mailbox: string; auditor: string; entity: string }): InquiryLetter {
  return {
    subject: `Engagementsforespørgsel – ${input.company}, CVR ${input.cvr} – pr. ${formatDanish(input.statementDate)} – ref. ${input.reference}`,
    body: [
      `Til ${input.institute}`,
      `Som revisor for ${input.company}, CVR-nr. ${input.cvr}, anmoder vi om en engagementsopgørelse pr. ${formatDanish(input.statementDate)}, der omfatter samtlige engagementer, herunder indlånskonti og saldi, udlån, kreditter og lån, depoter, sikkerheder stillet af og for virksomheden, garantier samt tegningsret og fuldmagter til konti.`,
      'Har virksomheden ingen engagementer inden for en kategori, bedes det angivet.',
      'Vedhæftet er fuldmagt underskrevet i henhold til virksomhedens tegningsregel.',
      `Svaret bedes sendt direkte til ${input.mailbox} med angivelse af referencen ${input.reference}. Svaret må ikke sendes via virksomheden.`,
      `Kontaktperson: ${input.auditor}, ${input.entity}.`,
      'Med venlig hilsen\nKerneteamet, Cedra',
    ].join('\n\n'),
  };
}

export function reminderLetter(input: { number: 1 | 2; company: string; cvr: string; institute: string; statementDate: IsoDate; reference: string; sentDate: IsoDate; replyBy: IsoDate; mailbox: string }): InquiryLetter {
  return {
    subject: `Rykker ${input.number} – Engagementsforespørgsel – ref. ${input.reference}`,
    body: [
      `Til ${input.institute}`,
      `Den ${formatDanish(input.sentDate)} sendte vi en engagementsforespørgsel for ${input.company}, CVR-nr. ${input.cvr}, pr. ${formatDanish(input.statementDate)} med referencen ${input.reference}. Vi har endnu ikke modtaget svar og beder venligst om svar senest ${formatDanish(input.replyBy)}.`,
      `Er der behov for yderligere oplysninger eller en ny fuldmagt, bedes I kontakte os på ${input.mailbox}.`,
      'Med venlig hilsen\nKerneteamet, Cedra',
    ].join('\n\n'),
  };
}
