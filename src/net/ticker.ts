/**
 * A repeating timer that keeps its pace when the tab is in the background.
 * Browsers slow main-thread timers in hidden tabs to about once a second (or less), which would freeze the
 * host's live matches; timers inside a Worker are not throttled that way. Falls back to setInterval.
 */
export function startTicker(ms: number, fn: () => void): () => void {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    try {
      const src = 'let id=null;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = () => fn();
      w.postMessage(ms);
      return () => {
        w.terminate();
        URL.revokeObjectURL(url);
      };
    } catch {
      /* fall through */
    }
  }
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}
