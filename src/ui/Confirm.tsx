// In-game confirmation dialogs (instead of the browser's own confirm box).
import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';

interface Ask {
  title: string;
  text?: ReactNode;
  ok?: string;
  cancel?: string;
  /** red confirm button for things that can't be undone */
  danger?: boolean;
}

const useAsk = create<{ req: (Ask & { resolve: (v: boolean) => void }) | null }>(() => ({ req: null }));

/** Ask the manager to confirm; resolves true on "ok", false on cancel, Esc or a click outside. */
export function ask(opts: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    useAsk.getState().req?.resolve(false);
    useAsk.setState({ req: { ...opts, resolve } });
  });
}

/** Mounted once at the root: shows the pending question. */
export function ConfirmHost() {
  const req = useAsk((s) => s.req);
  const done = (v: boolean) => {
    req?.resolve(v);
    useAsk.setState({ req: null });
  };
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!req) return null;
  return (
    <div className="modal-bg confirm-bg" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div className={`confirm ${req.danger ? 'danger' : ''}`} role="dialog" aria-modal="true">
        <div className="confirm-title">{req.title}</div>
        {req.text && <div className="confirm-text">{req.text}</div>}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={() => done(false)}>
            {req.cancel ?? 'Cancelar'}
          </button>
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => done(true)}>
            {req.ok ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
