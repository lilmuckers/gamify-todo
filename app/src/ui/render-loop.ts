import type { App } from '../app';

type Keepable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Re-renders HUD + panel on app changes, batched per task (not per frame, so
 * hidden tabs still update). Keeps the panel's scroll position and scrolls the
 * selected item into view. Fields marked `data-keep` carry their value, focus
 * and cursor over to the new render; while you type in any other field, the
 * panel waits (re-rendering would wipe what you typed).
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
    const active = document.activeElement as Keepable | null;
    const activeKey = active && panel.contains(active) ? active.dataset.keep : undefined;
    if (typing() && !activeKey) {
      deferred = true;
      return;
    }
    const kept = new Map<string, { value: string; start: number | null; end: number | null }>();
    for (const el of panel.querySelectorAll<Keepable>('[data-keep]'))
      kept.set(el.dataset.keep!, {
        value: el.value,
        start: 'selectionStart' in el ? el.selectionStart : null,
        end: 'selectionEnd' in el ? el.selectionEnd : null,
      });
    const scroll = panel.scrollTop;
    const content = render();
    panel.replaceChildren(content);
    panel.scrollTop = scroll;
    for (const el of panel.querySelectorAll<Keepable>('[data-keep]')) {
      const k = kept.get(el.dataset.keep!);
      if (!k) continue;
      el.value = k.value;
      if (el.dataset.keep === activeKey) {
        el.focus({ preventScroll: true });
        if ('setSelectionRange' in el && k.start !== null) el.setSelectionRange(k.start, k.end);
      }
    }
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
  setInterval(schedule, 30_000);
  schedule();
}
