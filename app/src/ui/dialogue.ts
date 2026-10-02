import type { HeroId } from '@quest/shared';
import type { JunkLine } from '../game/junk-lines';
import { emoteCanvas, portraitCanvas } from '../sprites/portraits';
import { h } from './dom';

export interface Dialogue {
  /** First press finishes the typing, the next closes the box. */
  advance(): void;
  /** Removes the box at once. */
  close(): void;
  /** Settles when the box has closed (by advancing or `close`). */
  closed: Promise<void>;
}

export interface DialogueOptions {
  hero: HeroId;
  line: JunkLine;
  /** Element the box sits at the bottom of (positioned). */
  host: HTMLElement;
  /** Screen pixels per art pixel, so the portrait matches the scene. */
  px: number;
  /** Show the whole line at once (reduced motion). */
  instant?: boolean;
  /** Milliseconds per letter. */
  speed?: number;
}

const copy = (src: HTMLCanvasElement, cls: string) => {
  const c = h('canvas', { class: cls, width: src.width, height: src.height, 'aria-hidden': 'true' });
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
};

/**
 * An SNES-style dialogue box along the bottom of the game view: the hero's
 * portrait (with a mood emote) on the left, the line typing out letter by
 * letter on the right with its keyword in yellow, and a bouncing ▼ once done.
 * Clicking the box, Enter or Space advances it; the caller handles Esc.
 */
export function showDialogue(o: DialogueOptions): Dialogue {
  const { line } = o;
  const words = h('p', { class: 'dlg-words', 'aria-hidden': 'true' });
  const next = h('span', { class: 'dlg-next', 'aria-hidden': 'true' }, '▼');
  const box = h(
    'div',
    {
      class: 'dlg',
      role: 'dialog',
      'aria-live': 'polite',
      'aria-label': line.text,
      style: `--px:${o.px}px`,
      tabindex: '-1',
    },
    h('div', { class: 'dlg-portrait' }, copy(portraitCanvas(o.hero, line.face), 'dlg-face'), copy(emoteCanvas(line.mood), 'dlg-emote')),
    h('div', { class: 'dlg-text' }, words, next),
  );

  // The keyword wraps in a yellow span as soon as its first letter shows.
  const render = (n: number) => {
    const t = line.text.slice(0, n);
    const k = line.keyword;
    if (!k || n <= k.start) words.replaceChildren(t);
    else words.replaceChildren(t.slice(0, k.start), h('span', { class: 'dlg-hi' }, t.slice(k.start, Math.min(n, k.end))), t.slice(k.end));
    box.classList.toggle('done', n >= line.text.length);
  };

  let shown = o.instant ? line.text.length : 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let done!: () => void;
  const closed = new Promise<void>((r) => (done = r));
  let open = true;

  const finish = () => {
    clearInterval(timer);
    timer = undefined;
    shown = line.text.length;
    render(shown);
  };
  const close = () => {
    if (!open) return;
    open = false;
    clearInterval(timer);
    box.remove();
    done();
  };
  const advance = () => (shown < line.text.length ? finish() : close());

  box.addEventListener('click', (e) => {
    e.stopPropagation();
    advance();
  });
  render(shown);
  if (shown < line.text.length) timer = setInterval(() => (++shown >= line.text.length ? finish() : render(shown)), o.speed ?? 32);
  o.host.append(box);
  return { advance, close, closed };
}
