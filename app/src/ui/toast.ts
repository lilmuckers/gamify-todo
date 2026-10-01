import { h } from './dom';

export type Tone = 'info' | 'warn' | 'alert' | 'win';

let host: HTMLElement | undefined;

function container() {
  return (host ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })));
}

function dismiss(el: HTMLElement) {
  el.classList.add('out');
  setTimeout(() => el.remove(), 400);
}

export function toast(text: string, tone: Tone = 'info', ms = 3500, action?: { label: string; run: () => void }) {
  const el = h('div', { class: `toast ${tone}` }, text);
  if (action)
    el.append(
      h(
        'button',
        {
          class: 'toast-action',
          type: 'button',
          onclick: () => {
            action.run();
            dismiss(el);
          },
        },
        action.label,
      ),
    );
  container().append(el);
  const timer = setTimeout(() => dismiss(el), ms);
  return {
    el,
    close: () => {
      clearTimeout(timer);
      dismiss(el);
    },
  };
}

let pendingUndo: { close: () => void; run: () => void } | undefined;

/** One undo offer at a time: a newer one replaces the last. Ctrl/Cmd+Z runs it. */
export function undoToast(text: string, run: () => void) {
  pendingUndo?.close();
  const t = toast(text, 'info', 6000, {
    label: 'UNDO',
    run: () => {
      pendingUndo = undefined;
      run();
    },
  });
  const offer = {
    close: t.close,
    run: () => {
      t.close();
      pendingUndo = undefined;
      run();
    },
  };
  pendingUndo = offer;
  setTimeout(() => {
    if (pendingUndo === offer) pendingUndo = undefined;
  }, 6000);
}

/** Runs the visible undo, if any. */
export function runPendingUndo(): boolean {
  if (!pendingUndo) return false;
  pendingUndo.run();
  return true;
}
