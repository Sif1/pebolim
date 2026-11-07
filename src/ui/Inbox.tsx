// The notification centre: one bell in the top bar listing what needs the manager's attention (bids to answer,
// job offers, the closing window, line-up problems, auctions worth a look, the board…), each a click away from the
// screen that deals with it. It replaces the pop-ups that used to interrupt every round.
// Also the keyboard shortcuts: 1-9 for the menu, Space to continue (or pause your match), N for the bell, ? for help.
import { useEffect } from 'react';
import { lineupIssues } from '../engine/ai/lineup';
import { PRE_CONTRACT_FROM } from '../engine/commands';
import { isDerby } from '../engine/rivals';
import { bidRoundsLeft, deadlineDay } from '../engine/transfers';
import { squadOf } from '../engine/util';
import { useApp, useMe, type Screen } from '../store';
import { openAuctions } from './Auctions';
import { Modal } from './common';
import { nextFixture } from './Shell';

type Level = 'bad' | 'warn' | 'info' | 'good';

interface Item {
  id: string;
  icon: string;
  text: string;
  level: Level;
  screen: Screen;
  tab?: string;
}

/** Everything that needs the manager's attention right now, most urgent first. */
export function useAttention(): Item[] {
  const { state, manager, club } = useMe();
  if (!state || !manager) return [];
  const out: Item[] = [];
  const offers = manager.offers.filter((o) => state.clubs[o.clubId] && !state.clubs[o.clubId].managerId);
  if (offers.length)
    out.push({
      id: 'jobs',
      icon: '💼',
      text: offers.length === 1 ? `Proposta de emprego do ${state.clubs[offers[0].clubId].name}` : `${offers.length} propostas de emprego`,
      level: 'info',
      screen: 'treinador',
    });
  if (!club) return out;
  const season = state.meta.season;
  if (state.meta.seasonOver && state.reviews?.some((r) => r.manager === manager.id && r.season === season - 1))
    out.push({ id: 'review', icon: '📖', text: `A retrospectiva da temporada ${season - 1} está pronta`, level: 'good', screen: 'competicoes', tab: 'temporadas' });
  const issues = lineupIssues(state, club.id);
  if (issues.length) out.push({ id: 'lineup', icon: '⚠', text: `Escalação: ${issues.join('; ')}`, level: 'bad', screen: 'escalacao' });
  if (deadlineDay(state))
    out.push({ id: 'deadline', icon: '⏰', text: 'Último dia da janela de transferências: depois, só jogadores livres', level: 'bad', screen: 'mercado', tab: 'buscar' });
  else if (deadlineDay(state, state.meta.date + 1))
    out.push({ id: 'deadline', icon: '⏳', text: 'A janela de transferências fecha na próxima rodada', level: 'warn', screen: 'mercado', tab: 'buscar' });
  const bids = Object.values(state.bids);
  const toAnswer = bids.filter((b) => b.seller === club.id && b.status === 'pendente' && bidRoundsLeft(state, b) > 0);
  const late = toAnswer.filter((b) => b.late);
  if (late.length)
    out.push({
      id: 'late',
      icon: '⏰',
      text: late.length === 1 ? `Proposta de última hora por ${state.players[late[0].player]?.name}: responda nesta rodada` : `${late.length} propostas de última hora: respondam nesta rodada`,
      level: 'bad',
      screen: 'mercado',
      tab: 'propostas',
    });
  const normal = toAnswer.length - late.length;
  if (normal > 0)
    out.push({
      id: 'bids',
      icon: '💰',
      text: normal === 1 ? `Proposta por ${state.players[toAnswer.find((b) => !b.late)!.player]?.name} esperando resposta` : `${normal} propostas por seus jogadores esperando resposta`,
      level: 'warn',
      screen: 'mercado',
      tab: 'propostas',
    });
  const counters = bids.filter((b) => b.buyer === club.id && b.status === 'contraproposta').length;
  if (counters) out.push({ id: 'counters', icon: '↩', text: counters === 1 ? 'Uma contraproposta para você responder' : `${counters} contrapropostas para você responder`, level: 'warn', screen: 'mercado', tab: 'propostas' });
  const squad = squadOf(state, club.id).filter((p) => !p.junior);
  if (squad.length < 16) out.push({ id: 'short', icon: '👥', text: `Elenco curto: só ${squad.length} jogadores`, level: 'bad', screen: 'mercado', tab: 'buscar' });
  if (club.board.conf < 35) out.push({ id: 'board', icon: '🏛', text: `A diretoria está insatisfeita: confiança de ${Math.round(club.board.conf)}%`, level: 'bad', screen: 'painel' });
  if ((club.fans ?? 60) < 30) out.push({ id: 'fans', icon: '📣', text: 'A torcida está revoltada', level: 'warn', screen: 'painel' });
  if (club.balance < 0) out.push({ id: 'money', icon: '💸', text: 'O caixa está no vermelho', level: 'warn', screen: 'financas' });
  const expiring = squad.filter((p) => !p.loan && p.contractEnd <= season && !p.pre).length;
  if (expiring && !club.autoRenewAll && state.meta.date >= PRE_CONTRACT_FROM)
    out.push({ id: 'contracts', icon: '📝', text: `${expiring} contrato${expiring > 1 ? 's terminam' : ' termina'} no fim da temporada`, level: 'info', screen: 'mercado', tab: 'contratos' });
  // auctions only when someone there would make the squad stronger (better than its 14th best)
  const bar = [...squad].sort((a, b) => b.str - a.str)[13]?.str ?? 0;
  const worth = openAuctions(state).filter((p) => p.clubId !== club.id && p.str > bar).length;
  if (worth) out.push({ id: 'auctions', icon: '🔨', text: `${worth} leilão${worth > 1 ? 'ões' : ''} com jogadores que reforçam seu elenco`, level: 'info', screen: 'mercado', tab: 'leiloes' });
  const nf = nextFixture(state, club.id);
  if (nf && isDerby(state, nf.home, nf.away)) {
    const opp = state.clubs[nf.home === club.id ? nf.away : nf.home];
    out.push({ id: `derby${nf.id}`, icon: '🔥', text: `${nf.date === state.meta.date ? 'Hoje tem' : 'Vem aí'} clássico contra o ${opp.name}`, level: 'info', screen: 'painel' });
  }
  return out;
}

const URGENT: Level[] = ['bad', 'warn'];

/** The bell in the top bar and its list. */
export function InboxButton() {
  const items = useAttention();
  const setScreen = useApp((s) => s.setScreen);
  const open = useApp((s) => s.inboxOpen);
  const setOpen = useApp((s) => s.setInboxOpen);
  const urgent = items.filter((i) => URGENT.includes(i.level)).length;
  return (
    <div className="inbox">
      <button
        className={`btn sm ${urgent ? 'danger' : 'ghost'} inbox-btn`}
        title="Avisos: o que precisa da sua atenção (atalho: N)"
        onClick={() => setOpen(!open)}
      >
        🔔{items.length > 0 && <span className="count">{items.length}</span>}
      </button>
      {open && (
        <>
          <div className="inbox-bg" onClick={() => setOpen(false)} />
          <div className="inbox-panel">
            <div className="inbox-head">Avisos</div>
            {items.length === 0 && <div className="inbox-empty muted">Tudo em ordem. Nada precisa da sua atenção agora.</div>}
            {items.map((it) => (
              <button
                key={it.id}
                className={`inbox-item ${it.level}`}
                onClick={() => {
                  setScreen(it.screen, it.tab);
                  setOpen(false);
                }}
              >
                <span className="inbox-icon">{it.icon}</span>
                <span className="grow">{it.text}</span>
                <span className="faint">›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Menu entries in shortcut order (keys 1-9). */
const KEY_SCREENS: Screen[] = ['painel', 'elenco', 'escalacao', 'mercado', 'financas', 'competicoes', 'noticias', 'treinador', 'opcoes'];

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Keyboard shortcuts, everywhere in the game: Space presses the button marked data-shortcut="space" (Continuar for
 * the host, Pronto for the others, pause/resume during your match), 1-9 open the menu screens, N the notifications
 * and ? the list of shortcuts.
 */
export function useShortcuts() {
  const setScreen = useApp((s) => s.setScreen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const app = useApp.getState();
      if (e.key === 'Escape') {
        if (app.inboxOpen) app.setInboxOpen(false);
        if (app.keysOpen) app.setKeysOpen(false);
        return;
      }
      // a dialog is open: it has the keyboard
      if (document.querySelector('.modal-bg')) return;
      if (e.key === ' ') {
        const btn = [...document.querySelectorAll<HTMLButtonElement>('[data-shortcut="space"]')].find((b) => !b.disabled);
        if (btn) {
          e.preventDefault();
          btn.click();
        }
        return;
      }
      if (e.key === '?') {
        app.setKeysOpen(true);
        return;
      }
      // the rest only between rounds (the club screens)
      if (!document.querySelector('.shell')) return;
      if (e.key === 'n' || e.key === 'N') {
        app.setInboxOpen(!app.inboxOpen);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= KEY_SCREENS.length) {
        const s = KEY_SCREENS[n - 1];
        const hasClub = !!document.querySelector(`.sidebar [data-screen="${s}"]`);
        if (hasClub) setScreen(s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen]);
}

/** The list of shortcuts, when open. */
export function ShortcutsHelp() {
  const open = useApp((s) => s.keysOpen);
  const setOpen = useApp((s) => s.setKeysOpen);
  if (!open) return null;
  const onClose = () => setOpen(false);
  const rows: [string, string][] = [
    ['Espaço', 'Continuar a rodada (anfitrião) ou ficar pronto; no jogo, pausar e voltar'],
    ['1 a 9', 'Painel, Elenco, Escalação, Mercado, Finanças, Competições, Notícias, Treinador, Opções'],
    ['N', 'Abrir os avisos'],
    ['Esc', 'Fechar avisos e janelas'],
    ['?', 'Esta lista'],
  ];
  return (
    <Modal onClose={onClose}>
      <h2>Atalhos do teclado</h2>
      <table className="t">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ width: 90 }}>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
