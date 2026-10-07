import { h } from './dom';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
  /** Return false to keep the modal open (e.g. validation failed). */
  run?: () => boolean | void | Promise<boolean | void>;
}

let open = 0;

/** True while any modal is showing; the game ignores input meanwhile. */
export const modalOpen = () => open > 0;

function setOpen(delta: number) {
  open = Math.max(0, open + delta);
  document.dispatchEvent(new CustomEvent('quest:modal', { detail: open > 0 }));
}

export interface ModalOptions {
  /** False: only an action closes it (no Esc, no backdrop click). */
  dismissable?: boolean;
  /** Runs once when the modal closes, however it closes. */
  onClose?: () => void;
  /** A wider dialog, for screens rather than forms (the character select). */
  wide?: boolean;
}

export function openModal(title: string, body: Node, actions: ModalAction[] = [{ label: 'Close' }], opts: ModalOptions = {}) {
  const dismissable = opts.dismissable ?? true;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    setOpen(-1);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => dismissable && e.key === 'Escape' && close();
  const buttons = actions.map((a) =>
    h(
      'button',
      {
        class: `btn ${a.kind ?? 'plain'}`,
        type: a.kind === 'primary' ? 'submit' : 'button',
        onclick: async (e: Event) => {
          e.preventDefault();
          const keep = (await a.run?.()) === false;
          if (!keep) close();
        },
      },
      a.label,
    ),
  );
  const dialog = h(
    'form',
    { class: `modal${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', null, title),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-actions' }, buttons),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => dismissable && e.target === overlay && close() }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  setOpen(1);
  (dialog.querySelector('input, textarea, select') as HTMLElement | null)?.focus();
  return close;
}

export function confirmDialog(title: string, text: string, confirmLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    // Esc or a backdrop click closes it without an answer: that's a no.
    openModal(
      title,
      h('p', null, text),
      [
        { label: 'Cancel', run: () => resolve(false) },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', run: () => resolve(true) },
      ],
      { onClose: () => resolve(false) },
    );
  });
}
