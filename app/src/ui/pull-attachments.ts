import { attachmentFileId, isAttachmentFile, sidecarId, type AttachmentSidecar, type PullDetail } from '@quest/shared';
import type { App } from '../app';
import { h, relTime } from './dom';

/** Formats browsers draw in an <img>; HEIC is listed by name only. */
const VIEWABLE = /\.(jpe?g|png|webp)$/i;

/** Object URLs and sidecars already fetched, by head sha and path, so re-renders don't refetch. */
const cache = new Map<string, Promise<Blob | undefined>>();
const urls = new Map<string, string>();

function fetchFile(app: App, detail: PullDetail, path: string): Promise<Blob | undefined> {
  const key = `${detail.headSha}:${path}`;
  let p = cache.get(key);
  if (!p) {
    const read = app.store.source.pulls?.file;
    p = read ? read(detail, path).catch(() => (cache.delete(key), undefined)) : Promise.resolve(undefined);
    cache.set(key, p);
  }
  return p;
}

function objectUrl(key: string, blob: Blob) {
  let url = urls.get(key);
  if (!url) urls.set(key, (url = URL.createObjectURL(blob)));
  return url;
}

/**
 * The photos a pull request attaches, each with its sidecar's words, so a reviewer sees what
 * they're merging (plans G6). Images load from the PR's head; a click opens one full size.
 */
export function pullAttachments(app: App, detail: PullDetail): HTMLElement | null {
  const files = detail.dataFiles.filter(isAttachmentFile);
  if (!files.length) return null;
  const sidecars = new Map(detail.dataFiles.filter((p) => sidecarId(p)).map((p) => [sidecarId(p)!, p]));
  return h(
    'div',
    { class: 'pr-attachments' },
    files.map((path) => {
      const id = attachmentFileId(path) ?? path;
      const name = path.split('/').pop()!;
      const key = `${detail.headSha}:${path}`;
      const cached = urls.get(key);
      const img = h('img', { alt: name, loading: 'lazy', ...(cached && { src: cached }) });
      const link = h('a', { class: 'pr-photo', target: '_blank', rel: 'noopener', title: 'Open full size', ...(cached && { href: cached }) }, img);
      const caption = h('figcaption', null, h('code', null, name));
      if (VIEWABLE.test(path) && !cached)
        void fetchFile(app, detail, path).then((blob) => {
          if (!blob) return link.replaceWith(h('div', { class: 'pr-photo missing' }, 'Couldn’t load the photo'));
          const url = objectUrl(key, blob);
          img.setAttribute('src', url);
          link.setAttribute('href', url);
        });
      else if (!VIEWABLE.test(path)) link.replaceChildren(h('div', { class: 'pr-photo missing' }, 'No preview for this format'));
      const sidecarPath = sidecars.get(id);
      if (sidecarPath)
        void fetchFile(app, detail, sidecarPath)
          .then((blob) => blob?.text())
          .then((text) => {
            if (!text) return;
            const s = JSON.parse(text) as AttachmentSidecar;
            caption.prepend(
              ...(s.title ? [h('strong', null, s.title)] : []),
              ...(s.text ? [h('span', { class: 'pr-photo-text' }, s.text)] : []),
              h('small', { class: 'muted' }, `${{ share: 'shared', button: 'added with 📷', paste: 'pasted' }[s.via] ?? s.via} · ${relTime(s.addedAt)}`),
            );
          })
          .catch(() => undefined);
      return h('figure', { class: 'pr-attachment', 'data-attachment': id }, link, caption);
    }),
  );
}
