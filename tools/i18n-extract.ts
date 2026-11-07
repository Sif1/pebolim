// Lists every piece of Portuguese text in the source (JSX text, string literals and template strings, with
// ${…} turned into {0}, {1}…) that has no English translation yet in src/i18n/en.ts.
//   npx tsx tools/i18n-extract.ts [--all]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import { normalize } from '../src/i18n/core';
import { EN } from '../src/i18n/en';

const ALL = process.argv.includes('--all');
const files: string[] = [];
const walkDir = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (!p.includes('i18n')) walkDir(p);
    } else if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) files.push(p);
  }
};
walkDir('src');

const SKIP_ATTR = new Set(['className', 'key', 'type', 'href', 'src', 'id', 'name', 'role', 'inputMode', 'rel', 'target', 'viewBox', 'fill', 'stroke', 'd', 'shapeRendering', 'preserveAspectRatio', 'strokeDasharray', 'vectorEffect']);
const looksLikeText = (t: string) => {
  if (t.length < 2 || !/[A-Za-zÀ-ÿ]{2}/.test(t)) return false;
  if (/^(https?:|#|\.|\/|var\(|rgba?\(|[a-z]+:[a-z])/.test(t)) return false;
  if (/^[a-z][A-Za-z0-9]*$/.test(t) && /[A-Z0-9]/.test(t)) return false; // camelCase identifiers
  if (/^[a-z0-9_.-]+$/.test(t) && /[-_.]/.test(t)) return false; // css classes, keys, file names
  if (/^[A-Z0-9_]+$/.test(t) && t.length <= 5) return false; // codes like BRA1
  if (/=>|\(\)|;$|^\[|^\{/.test(t)) return false;
  return true;
};

const found = new Map<string, string>();
const add = (text: string, where: string) => {
  const k = normalize(text);
  if (!looksLikeText(k)) return;
  if (!ALL && EN[k] !== undefined) return;
  if (!found.has(k)) found.set(k, where);
};

type N = { type: string; start: number; [k: string]: unknown };
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const ast = parseAst(src, { lang: file.endsWith('x') ? 'tsx' : 'ts' }, file) as unknown as N;
  const lineOf = (pos: number) => src.slice(0, pos).split('\n').length;
  const visit = (n: N, parent: N | null, parentKey: string) => {
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type.startsWith('TS') && n.type !== 'TSAsExpression' && n.type !== 'TSNonNullExpression' && n.type !== 'TSSatisfiesExpression') return;
    if (n.type === 'JSXAttribute' && SKIP_ATTR.has(String((n.name as N & { name: string }).name))) return;
    const where = `${file}:${lineOf(n.start)}`;
    if (n.type === 'JSXText') add(String(n.value), where);
    else if (n.type === 'Literal' && typeof n.value === 'string') {
      const isKey = parent?.type === 'Property' && parentKey === 'key';
      const isIndex = parent?.type === 'MemberExpression' && parentKey === 'property';
      const isCompare = parent?.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(String(parent.operator));
      const isCase = parent?.type === 'SwitchCase';
      const isInclude = parent?.type === 'CallExpression' && /includes|startsWith|endsWith|getItem|setItem|querySelector|closest/.test(String((parent.callee as N & { property?: { name?: string } })?.property?.name ?? ''));
      if (!isKey && !isIndex && !isCompare && !isCase && !isInclude) add(n.value, where);
    } else if (n.type === 'TemplateLiteral') {
      const quasis = n.quasis as { value: { cooked: string } }[];
      let s = quasis[0].value.cooked;
      for (let i = 1; i < quasis.length; i++) s += `{${i - 1}}` + quasis[i].value.cooked;
      if (quasis.length === 1) add(s, where);
      else if (/[A-Za-zÀ-ÿ]{3}/.test(s.replace(/\{\d+\}/g, ''))) add(s, where);
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent') continue;
      if (Array.isArray(v)) v.forEach((c) => visit(c as N, n, k));
      else if (v && typeof v === 'object') visit(v as N, n, k);
    }
  };
  visit(ast, null, '');
}
const out = [...found.entries()];
console.log(JSON.stringify(Object.fromEntries(out), null, 1));
console.error(`${out.length} strings${ALL ? '' : ' without a translation'}`);
