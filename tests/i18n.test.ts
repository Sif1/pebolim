import { describe, expect, it } from 'vitest';
import { englishNumbers, Translator } from '../src/i18n/core';
import { EN } from '../src/i18n/en';

const t = new Translator(EN);

describe('english translation', () => {
  it('every template uses only placeholders its Portuguese has', () => {
    for (const [pt, en] of Object.entries(EN)) {
      const have = new Set(pt.match(/\{\d+\}/g) ?? []);
      for (const ph of en.match(/\{\d+\}/g) ?? []) expect(have.has(ph), `${pt} → ${en}`).toBe(true);
    }
  });

  it('formats numbers, money and ordinals', () => {
    expect(englishNumbers('US$ 2,5 mi')).toBe('US$ 2.5M');
    expect(englishNumbers('US$ 850 mil')).toBe('US$ 850k');
    expect(englishNumbers('78.349 torcedores')).toBe('78,349 torcedores');
    expect(englishNumbers('3º')).toBe('3rd');
    expect(englishNumbers('23/01')).toBe('23/01');
  });

  it('translates news with names and numbers inside', () => {
    expect(t.tr('O Palmeiras fez uma proposta de US$ 4,2 mi por Wesley (vale até 23/01).')).toBe(
      'Palmeiras made a US$ 4.2M offer for Wesley (valid until 23/01).',
    );
    expect(t.tr('Cartão amarelo para Gerson')).toBe('Yellow card for Gerson');
  });

  it('translates "a; b; c" lists clause by clause', () => {
    const s =
      'Prêmios de março no Brasil: craque do mês: Pedro (Flamengo, nota 8.4, 3 gols); revelação: Estêvão (Palmeiras, 19 anos); treinador do mês: o técnico do Bahia (12 pts em 4 jogos).';
    expect(t.tr(s)).toBe(
      'March awards in Brazil: player of the month: Pedro (Flamengo, rating 8.4, 3 goals); young player: Estêvão (Palmeiras, 19); manager of the month: the Bahia coach (12 pts in 4 games).',
    );
  });

  it('keeps surrounding whitespace and leaves unknown text alone', () => {
    expect(t.tr('  Flamengo ')).toBe('  Flamengo ');
    expect(t.tr(' jogos)')).toBe(' matches)');
  });
});

describe('english number edge cases', () => {
  it('keeps dates, versions and decimals with dots', () => {
    expect(englishNumbers('1.234,5 e 12.345.678')).toBe('1,234.5 e 12,345,678');
    expect(englishNumbers('v0.6.0 · nota 8.4 · 06/11/2026')).toBe('v0.6.0 · nota 8.4 · 06/11/2026');
    expect(englishNumbers('vitória por 2,5 gols')).toBe('vitória por 2.5 gols');
  });
});
