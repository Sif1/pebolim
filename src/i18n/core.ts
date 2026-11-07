// Translation core (no DOM, no React): Portuguese text in, English text out, using the dictionary in en.ts.
// Keys are the Portuguese text itself; {0}, {1}… stand for names and numbers in the middle of a sentence,
// which are translated too when they are themselves pieces of text (fragments such as " por US$ 2 mi").

/** Collapse whitespace so JSX text and template strings compare equal. */
export function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

interface Pattern {
  re: RegExp;
  en: string;
  /** literal characters: more literal text = more specific, tried first */
  weight: number;
  /** the pattern itself joins clauses with "; " (otherwise a capture may not span one) */
  list: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compile(dict: Record<string, string>) {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [pt, en] of Object.entries(dict)) {
    const k = normalize(pt);
    if (!/\{\d+\}/.test(k)) {
      exact.set(k, en);
      continue;
    }
    const parts = k.split(/(\{\d+\})/);
    let src = '^';
    const order: number[] = [];
    for (const part of parts) {
      const m = part.match(/^\{(\d+)\}$/);
      if (m) {
        src += '(.+?)';
        order.push(Number(m[1]));
      } else src += escape(part);
    }
    // the English template refers to {0}… by the order they appear in the Portuguese one
    let out = en;
    order.forEach((n, i) => (out = out.split(`{${n}}`).join(`\u0000${i}\u0000`)));
    const literal = k.replace(/\{\d+\}/g, '');
    patterns.push({ re: new RegExp(src + '$', 'sd'), en: out, weight: literal.length, list: literal.includes(';') });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  return { exact, patterns };
}

/** Portuguese number and money formats to English ones (US$ 2,5 mi → US$ 2.5M, 78.349 → 78,349, 1º → 1st). */
export function englishNumbers(s: string): string {
  return s
    .replace(/US\$ (-?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))? ?(mi|mil|bi)\b/g, (_, neg, int, dec, unit) => {
      const n = `${int.replace(/\./g, ',')}${dec ? '.' + dec : ''}`;
      return `${neg}US$ ${n}${unit === 'mi' ? 'M' : unit === 'bi' ? 'B' : 'k'}`;
    })
    // one pass, so a converted thousands comma isn't read again as a decimal comma
    .replace(/(^|[^\d/,.])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+)(?![\d/]|[.,]\d)/g, (_, pre: string, num: string) => {
      const [int, dec] = num.split(',');
      return `${pre}${int.replace(/\./g, ',')}${dec !== undefined ? '.' + dec : ''}`;
    })
    .replace(/(\d+)º/g, (_, n) => n + ordinal(Number(n)));
}

/**
 * "a; b; c" lists are translated clause by clause, so the pattern of one clause can't swallow the next ones:
 * a capture may hold such a list only when it is the whole tail of a sentence ("Prêmios…: a; b; c.").
 */
function wholeLists(core: string, m: RegExpMatchArray): boolean {
  const idx = (m as RegExpMatchArray & { indices?: [number, number][] }).indices;
  for (let g = 1; g < m.length; g++) {
    if (!m[g].includes('; ')) continue;
    if (!idx) return false;
    const [a, b] = idx[g];
    const before = core.slice(0, a);
    if (!(before === '' || before.endsWith(': ')) || core.length - b > 1) return false;
  }
  return true;
}

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
}

export class Translator {
  private exact: Map<string, string>;
  private patterns: Pattern[];
  private cache = new Map<string, string>();
  constructor(dict: Record<string, string>) {
    const c = compile(dict);
    this.exact = c.exact;
    this.patterns = c.patterns;
  }

  /** English for a piece of Portuguese text (unknown text comes back unchanged, numbers reformatted). */
  tr(text: string, depth = 0): string {
    if (!text) return text;
    const hit = this.cache.get(text);
    if (hit !== undefined) return hit;
    const lead = text.match(/^\s*/)![0];
    const trail = text.slice(lead.length).match(/\s*$/)![0];
    const core = normalize(text);
    let out = core;
    if (/[A-Za-zÀ-ÿ]/.test(core)) {
      const ex = this.exact.get(core);
      if (ex !== undefined) out = ex;
      else if (depth < 6) {
        let done = false;
        for (const p of this.patterns) {
          const m = core.match(p.re);
          if (!m || (!p.list && !wholeLists(core, m))) continue;
          out = p.en.replace(/\u0000(\d+)\u0000/g, (_, i) => this.tr(m[Number(i) + 1], depth + 1));
          done = true;
          break;
        }
        if (!done && core.includes('; ')) out = core.split('; ').map((s) => this.tr(s, depth + 1)).join('; ');
      }
    }
    out = lead + englishNumbers(out) + trail;
    if (this.cache.size > 30000) this.cache.clear();
    this.cache.set(text, out);
    return out;
  }
}
