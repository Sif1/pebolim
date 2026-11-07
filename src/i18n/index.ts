// Language switch (Portuguese / English). The game is written in Portuguese; in English, every piece of text
// on the page is translated as it is drawn (screens, dialogs, notifications, news and match commentary), so
// nothing in the game state or the saves depends on the language. Canvas text uses tr() directly.
import { create } from 'zustand';
import { Translator } from './core';
import { EN } from './en';

export type Lang = 'pt' | 'en';
const KEY = 'pebolim.lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'pt' || saved === 'en') return saved;
  } catch {
    /* private mode */
  }
  return typeof navigator !== 'undefined' && navigator.language && !navigator.language.toLowerCase().startsWith('pt') ? 'en' : 'pt';
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: initial() }));

const translator = new Translator(EN);

/** Text in the current language (pass the Portuguese text). */
export function tr(pt: string): string {
  return useLang.getState().lang === 'en' ? translator.tr(pt) : pt;
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  useLang.setState({ lang });
  applyAll();
}

// ---------- the page translator ----------

const ATTRS = ['title', 'placeholder', 'aria-label'];
/** the Portuguese behind each text node / attribute we changed, and what we wrote */
const origText = new WeakMap<Text, string>();
const wroteText = new WeakMap<Text, string>();
const origAttr = new WeakMap<Element, Record<string, string>>();
let observer: MutationObserver | null = null;

const skip = (el: Element | null) => !!el && (el.closest('script,style,textarea,[contenteditable],[translate="no"]') != null);

function doText(node: Text) {
  const v = node.nodeValue ?? '';
  if (wroteText.get(node) === v) return; // our own write
  origText.set(node, v);
  if (useLang.getState().lang !== 'en' || skip(node.parentElement)) {
    wroteText.set(node, v);
    return;
  }
  const en = translator.tr(v);
  wroteText.set(node, en);
  if (en !== v) node.nodeValue = en;
}

function doAttrs(el: Element) {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null) continue;
    const rec = origAttr.get(el) ?? {};
    const wrote = rec[`_${a}`];
    if (wrote === v) continue;
    rec[a] = v;
    const en = useLang.getState().lang === 'en' ? translator.tr(v) : v;
    rec[`_${a}`] = en;
    origAttr.set(el, rec);
    if (en !== v) el.setAttribute(a, en);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  doAttrs(el);
  const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

/** Re-translate (or restore) everything on the page after the language changed. */
function applyAll() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = useLang.getState().lang === 'en' ? 'en' : 'pt-BR';
  const en = useLang.getState().lang === 'en';
  const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      // still showing what we wrote: its Portuguese is what we kept; otherwise the page wrote it (Portuguese)
      const base = origText.has(t) && wroteText.get(t) === t.nodeValue ? origText.get(t)! : (t.nodeValue ?? '');
      origText.set(t, base);
      const out = en && !skip(t.parentElement) ? translator.tr(base) : base;
      wroteText.set(t, out);
      if (t.nodeValue !== out) t.nodeValue = out;
    } else {
      const el = n as Element;
      const rec = origAttr.get(el);
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v == null) continue;
        const base = rec && rec[`_${a}`] === v ? rec[a] : v;
        const out = en && !skip(el) ? translator.tr(base) : base;
        origAttr.set(el, { ...(rec ?? {}), [a]: base, [`_${a}`]: out });
        if (out !== v) el.setAttribute(a, out);
      }
    }
  }
}

/** Start watching the page: anything React draws or changes is translated before it is painted. */
export function startTranslator() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttrs(m.target as Element);
      else m.addedNodes.forEach((n) => walk(n));
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  applyAll();
}
