import { h } from './dom';

export interface TabSpec<Id extends string = string> {
  id: Id;
  label: string;
  pane: HTMLElement;
}

export interface Tabs<Id extends string> {
  /** The tab buttons, to place above (or beside) the panes. */
  strip: HTMLElement;
  select(id: Id, focus?: boolean): void;
  /** The tab's button, e.g. to mark it as needing attention. */
  button(id: Id): HTMLButtonElement;
}

let seq = 0;

/** A strip of tabs over panes: one pane shows at a time, with tab roles and arrow-key moves. */
export function tabs<Id extends string>(
  list: TabSpec<Id>[],
  opts: { selected?: Id; class?: string; vertical?: boolean; onSelect?: (id: Id) => void } = {},
): Tabs<Id> {
  const base = `tabs-${++seq}`;
  const buttons = new Map<Id, HTMLButtonElement>();
  const show = (id: Id, focus = false) => {
    for (const t of list) {
      const on = t.id === id;
      const btn = buttons.get(t.id)!;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      t.pane.hidden = !on;
      if (on && focus) btn.focus();
    }
  };
  const select = (id: Id, focus = false) => {
    show(id, focus);
    opts.onSelect?.(id);
  };
  for (const t of list) {
    t.pane.id ||= `${base}-${t.id}`;
    t.pane.setAttribute('role', 'tabpanel');
    const btn = h('button', { type: 'button', class: 'btn sm', role: 'tab', 'aria-controls': t.pane.id, onclick: () => select(t.id) }, t.label);
    t.pane.setAttribute('aria-labelledby', (btn.id = `${base}-${t.id}-tab`));
    buttons.set(t.id, btn);
  }
  const strip = h(
    'div',
    {
      class: opts.class,
      role: 'tablist',
      'aria-orientation': opts.vertical ? 'vertical' : 'horizontal',
      onkeydown: (e: KeyboardEvent) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const at = list.findIndex((t) => buttons.get(t.id) === document.activeElement);
        if (!step || at < 0) return;
        // Handled: the arrows mustn't also move the game behind the modal.
        e.preventDefault();
        e.stopPropagation();
        select(list[(at + step + list.length) % list.length].id, true);
      },
    },
    [...buttons.values()],
  );
  show(opts.selected ?? list[0].id);
  return { strip, select, button: (id) => buttons.get(id)! };
}
