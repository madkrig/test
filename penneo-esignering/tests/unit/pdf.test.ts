import { describe, expect, it } from 'vitest';
import { isPdf, minimalPdf } from '@/services/pdf';

describe('demodokument', () => {
  it('er en gyldig PDF med korrekt xref-offset og Latin-1-tegn', () => {
    const pdf = minimalPdf(['Årsrapport 2025 – Nordhavn (demo)', 'Søren Mikkelsen']);
    expect(isPdf(pdf)).toBe(true);
    const text = pdf.toString('latin1');
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    expect(text).toContain('(Årsrapport 2025 - Nordhavn \\(demo\\)) Tj');
    expect(text).toContain('Søren');
  });

  it('genkender ikke andre filer som PDF', () => {
    expect(isPdf(Buffer.from('hej'))).toBe(false);
  });
});
