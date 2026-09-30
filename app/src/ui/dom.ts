import { spriteUrl, type ThemeKey } from '../sprites/render';

type Child = Node | string | number | false | null | undefined | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Tiny hyperscript: h('div', { class: 'x', onclick }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'form') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function mount(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
}

export function icon(name: string, theme: ThemeKey = 'grass', cls = 'icon') {
  return h('img', { src: spriteUrl(name, theme), class: `${cls} pixel`, alt: '', draggable: false });
}

export function stars(n: number, max = 3) {
  return h(
    'span',
    { class: 'stars', title: `${n}/${max} stars` },
    Array.from({ length: max }, (_, i) => icon(i < n ? 'star' : 'star-empty', 'grass', 'icon sm')),
  );
}

export function fmtDuration(ms: number): string {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const hrs = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = d ? `${d}d ${hrs}h` : hrs ? `${hrs}h ${m}m` : `${m}m`;
  return neg ? `-${s}` : s;
}

export function relTime(iso?: string): string {
  if (!iso) return 'never';
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return 'just now';
  return `${fmtDuration(diff)} ago`;
}
