import type { App, Change } from '../app';
import { keepFields } from './dom';

/**
 * Re-renders HUD + panel on app changes, batched per task (not per frame, so
 * hidden tabs still update). Keeps the panel's scroll position and scrolls the
 * selected item into view. Fields marked `data-keep` carry their value, focus
 * and cursor over to the new render; while you type in any other field, the
 * panel waits (re-rendering would wipe what you typed).
 *
 * Updates that only moved sync status (saving, syncing, saved) call
 * `renderSync` instead, which repaints just what shows it: rebuilding
 * everything there restarted hovers and animations several times per edit.
 * It touches no fields, so it runs even while you type.
 */
export function scheduler(app: App, panel: HTMLElement, render: () => HTMLElement, renderSync: () => void) {
  let queued = false;
  let deferred = false;
  /** Something other than sync status changed since the last full render. */
  let full = false;
  let lastSel = '';
  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && panel.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'text'));
  };
  const run = () => {
    queued = false;
    if (!full) return renderSync();
    const kept = keepFields(panel);
    if (typing() && !kept.activeKey) {
      deferred = true;
      return renderSync();
    }
    full = false;
    const scroll = panel.scrollTop;
    const content = render();
    panel.replaceChildren(content);
    panel.scrollTop = scroll;
    kept.restore();
    const sel = app.selection?.kind === 'item' ? app.selection.id : app.selection?.kind ?? '';
    if (sel && sel !== lastSel)
      (panel.querySelector(sel === 'criteria' ? '.criteria' : `#item-${CSS.escape(sel)}`) as HTMLElement | null)?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    lastSel = sel;
  };
  const schedule = (change: Change = 'all') => {
    // The background history build never repaints the HUD or panel.
    if (change === 'history') return;
    if (change === 'all') full = true;
    if (queued) return;
    queued = true;
    setTimeout(run, 0);
  };
  panel.addEventListener('focusout', () => {
    if (deferred) {
      deferred = false;
      setTimeout(schedule, 0);
    }
  });
  app.subscribe(schedule);
  window.addEventListener('hashchange', () => (panel.scrollTop = 0));
  // Keep countdown timers fresh.
  setInterval(() => schedule(), 30_000);
  schedule();
}
