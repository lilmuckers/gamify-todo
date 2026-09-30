import { h } from './dom';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
  /** Return false to keep the modal open (e.g. validation failed). */
  run?: () => boolean | void | Promise<boolean | void>;
}

export function openModal(title: string, body: Node, actions: ModalAction[] = [{ label: 'Close' }]) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
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
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', null, title),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-actions' }, buttons),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  (dialog.querySelector('input, textarea, select') as HTMLElement | null)?.focus();
  return close;
}

export function confirmDialog(title: string, text: string, confirmLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const close = openModal(title, h('p', null, text), [
      { label: 'Cancel', run: () => void (answered = true, resolve(false)) },
      { label: confirmLabel, kind: danger ? 'danger' : 'primary', run: () => void (answered = true, resolve(true)) },
    ]);
    // Resolve false when dismissed via Escape/backdrop.
    const obs = new MutationObserver(() => {
      if (!document.body.contains(document.querySelector('.overlay')) && !answered) {
        resolve(false);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true });
    void close;
  });
}
