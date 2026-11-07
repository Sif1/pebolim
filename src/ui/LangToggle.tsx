import { setLang, useLang, type Lang } from '../i18n';

/** PT | EN switch (the labels are never translated). */
export function LangToggle({ compact = false }: { compact?: boolean }) {
  const lang = useLang((s) => s.lang);
  const opt = (l: Lang, label: string, title: string) => (
    <button className={lang === l ? 'active' : ''} title={title} aria-pressed={lang === l} onClick={() => setLang(l)}>
      {label}
    </button>
  );
  return (
    <div className={`lang-toggle${compact ? ' compact' : ''}`} translate="no">
      {opt('pt', 'PT', 'Português')}
      {opt('en', 'EN', 'English')}
    </div>
  );
}
