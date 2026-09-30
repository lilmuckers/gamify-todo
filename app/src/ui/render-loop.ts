import type { App } from '../app';

/**
 * Re-renders HUD + panel on app changes, batched per frame. Skips the panel
 * while the user is typing in it (re-rendering would wipe the input) and keeps
 * its scroll position; scrolls the selected item into view.
 */
export function scheduler(app: App, panel: HTMLElement, render: () => HTMLElement) {
  let queued = false;
  let deferred = false;
  let lastSel = '';
  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && panel.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'text'));
  };
  const run = () => {
    queued = false;
    if (typing()) {
      deferred = true;
      return;
    }
    const scroll = panel.scrollTop;
    const content = render();
    panel.replaceChildren(content);
    panel.scrollTop = scroll;
    const sel = app.selection?.kind === 'item' ? app.selection.id : app.selection?.kind ?? '';
    if (sel && sel !== lastSel)
      (panel.querySelector(sel === 'criteria' ? '.criteria' : `#item-${CSS.escape(sel)}`) as HTMLElement | null)?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    lastSel = sel;
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
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
  setInterval(schedule, 30_000);
  schedule();
}
