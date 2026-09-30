import { h } from './dom';

export type Tone = 'info' | 'warn' | 'alert' | 'win';

let host: HTMLElement | undefined;

export function toast(text: string, tone: Tone = 'info', ms = 3500) {
  host ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast ${tone}` }, text);
  host.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}
