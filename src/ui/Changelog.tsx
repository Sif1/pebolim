import { useState } from 'react';
import { useLang } from '../i18n';
import { CHANGELOG } from './releases';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "06/11/2026" in the reader's language (6 Nov 2026 in English, so day and month can't be swapped). */
function dateLabel(date: string, en: boolean) {
  if (!en) return date;
  const [d, m, y] = date.split('/').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** What's new, newest first: the latest release open, the older ones one click away. */
export function Changelog() {
  const en = useLang((s) => s.lang) === 'en';
  const [all, setAll] = useState(false);
  const list = all ? CHANGELOG : CHANGELOG.slice(0, 3);
  return (
    // already written in both languages: the page translator leaves it alone
    <div className="panel col changelog" translate="no">
      <h3>{en ? 'What’s new' : 'Novidades'}</h3>
      {list.map((r, i) => (
        <details key={r.version} open={i === 0}>
          <summary>
            <span className="cl-date">{dateLabel(r.date, en)}</span>
            <span className="cl-ver">v{r.version}</span>
          </summary>
          <ul>
            {(en ? r.en : r.pt).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      ))}
      {CHANGELOG.length > 3 && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>
          {all ? (en ? 'Show less' : 'Mostrar menos') : en ? `Older versions (${CHANGELOG.length - 3})` : `Versões anteriores (${CHANGELOG.length - 3})`}
        </button>
      )}
    </div>
  );
}
