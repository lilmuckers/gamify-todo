import { attachmentsIn, attachmentTargetLabel, type AttachmentSidecar, type AttachmentTarget } from '@quest/shared';
import type { App } from '../app';
import { h } from './dom';

/** Each merged photo's object URL, read once per session (undefined: it couldn't be read). */
const loaded = new Map<string, Promise<string | undefined>>();

function photoUrl(app: App, id: string): Promise<string | undefined> {
  let p = loaded.get(id);
  if (!p) {
    const read = app.store.source.readAttachment;
    p = read
      ? read
          .call(app.store.source, id)
          .then((b) => b && URL.createObjectURL(b))
          .catch(() => (loaded.delete(id), undefined))
      : Promise.resolve(undefined);
    loaded.set(id, p);
  }
  return p;
}

/** How many photos are linked to `target` or anything inside it. */
export const photoCount = (app: App, target: AttachmentTarget) => attachmentsIn(app.workspace?.attachments, target).length;

/**
 * The merged photos linked to `target` or anything inside it (plans G6 follow-up): a row of
 * snapshots, each opening full size, captioned with its title or, for one linked deeper down,
 * where it hangs. Null when there are none.
 */
export function photoStrip(app: App, target: AttachmentTarget): HTMLElement | null {
  const list = attachmentsIn(app.workspace?.attachments, target);
  if (!list.length) return null;
  const depth = (t: AttachmentTarget) => (['world', 'level', 'item'] as const).filter((k) => t[k]).length;
  return h(
    'ul',
    { class: 'photo-strip' },
    list.map((a) => {
      const deeper = depth(a.attachedTo!) > depth(target);
      return h(
        'li',
        { 'data-attachment': a.id },
        snapshot(app, a),
        h('span', { class: 'photo-title' }, a.title ?? a.takenOn ?? 'Photo'),
        deeper && h('small', { class: 'muted' }, attachmentTargetLabel(app.workspace, a.attachedTo!).split(' › ').slice(depth(target) + 1).join(' › ')),
        a.text && h('small', { class: 'photo-text' }, a.text),
        !!(a.takenOn || a.tags?.length) && h('small', { class: 'muted' }, [a.takenOn, a.tags?.map((t) => `#${t}`).join(' ')].filter(Boolean).join(' · ')),
      );
    }),
  );
}

function snapshot(app: App, a: AttachmentSidecar) {
  const img = h('img', { alt: a.title ?? 'Photo', loading: 'lazy' });
  const link = h('a', { class: 'photo-snap', target: '_blank', rel: 'noopener', title: 'Open full size' }, img);
  void photoUrl(app, a.id).then((url) => {
    if (!url) return link.replaceWith(h('div', { class: 'photo-snap missing' }, '📷'));
    img.src = url;
    link.href = url;
  });
  return link;
}
