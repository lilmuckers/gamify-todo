import {
  attachmentFileId,
  attachmentSidecarPath,
  attachmentTargetLabel,
  ConflictError,
  isAttachmentFile,
  orderedProjects,
  orderedWorlds,
  parseTags,
  sidecarText,
  validateFiles,
  type AttachmentSidecar,
  type AttachmentTarget,
  type PullDetail,
  type Workspace,
} from '@quest/shared';
import type { App } from '../app';
import { h, relTime } from './dom';
import { deviceLine, originalLine } from '../data/capture';
import { toast } from './toast';

/** Formats browsers draw in an <img>; HEIC is listed by name only. */
const VIEWABLE = /\.(jpe?g|png|webp)$/i;

/** Photos already fetched, by head sha and path, so re-renders don't refetch. */
const cache = new Map<string, Promise<Blob | undefined>>();
const urls = new Map<string, string>();
/** Attachment ids whose edit form is open, and the link each form has picked so far. */
const open = new Set<string>();
const picked = new Map<string, AttachmentTarget | undefined>();

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

const VIA = { share: 'shared', button: 'added with 📷', paste: 'pasted' } as const;

/**
 * The photos a pull request attaches, each with its sidecar's details, so a reviewer sees what
 * they're merging (plans G6). Images load from the PR's head; a click opens one full size.
 * On a PR in this repo, "Edit details" rewrites the sidecar on the PR's branch: title, notes,
 * the day it was taken, tags, and what it's attached to.
 */
export function pullAttachments(app: App, detail: PullDetail, head: Workspace): HTMLElement | null {
  const files = detail.dataFiles.filter(isAttachmentFile);
  if (!files.length) return null;
  const pulls = app.store.source.pulls;
  const editable = !!pulls?.saveSidecar && !!pulls.canEditSidecars?.(detail);
  return h(
    'div',
    { class: 'pr-attachments' },
    files.map((path) => {
      const id = attachmentFileId(path) ?? path;
      const sidecar = head.attachments?.find((a) => a.id === id);
      return h(
        'figure',
        { class: 'pr-attachment', 'data-attachment': id },
        photo(app, detail, path),
        h(
          'figcaption',
          null,
          sidecar?.title && h('strong', null, sidecar.title),
          sidecar?.text && h('span', { class: 'pr-photo-text' }, sidecar.text),
          sidecar?.attachedTo && h('span', { class: 'pr-photo-link' }, '📎 ', attachmentTargetLabel(app.workspace ?? head, sidecar.attachedTo)),
          !!(sidecar?.takenOn || sidecar?.tags?.length) &&
            h('small', null, [sidecar!.takenOn && `taken ${sidecar!.takenOn}`, sidecar!.tags?.map((t) => `#${t}`).join(' ')].filter(Boolean).join(' · ')),
          sidecar && h('small', { class: 'muted' }, `${VIA[sidecar.via] ?? sidecar.via} · ${relTime(sidecar.addedAt)}`),
          sidecar?.capturedWith && h('small', { class: 'muted pr-photo-device' }, deviceLine(sidecar.capturedWith)),
          sidecar?.original && h('small', { class: 'muted pr-photo-original' }, originalLine(sidecar.original)),
          h('code', null, path.split('/').pop()),
        ),
        editable && sidecar && editForm(app, detail, sidecar),
      );
    }),
  );
}

function photo(app: App, detail: PullDetail, path: string) {
  const name = path.split('/').pop()!;
  if (!VIEWABLE.test(path)) return h('div', { class: 'pr-photo missing' }, 'No preview for this format');
  const key = `${detail.headSha}:${path}`;
  const cached = urls.get(key);
  const img = h('img', { alt: name, loading: 'lazy', ...(cached && { src: cached }) });
  const link = h('a', { class: 'pr-photo', target: '_blank', rel: 'noopener', title: 'Open full size', ...(cached && { href: cached }) }, img);
  if (!cached)
    void fetchFile(app, detail, path).then((blob) => {
      if (!blob) return link.replaceWith(h('div', { class: 'pr-photo missing' }, 'Couldn’t load the photo'));
      const url = objectUrl(key, blob);
      img.setAttribute('src', url);
      link.setAttribute('href', url);
    });
  return link;
}

function editForm(app: App, detail: PullDetail, sidecar: AttachmentSidecar) {
  const id = sidecar.id;
  // Keys carry the head sha: after a save the form starts again from what was saved.
  const keep = (field: string) => `attach-${detail.headSha}-${id}-${field}`;
  if (!picked.has(id)) picked.set(id, sidecar.attachedTo);
  const field = (label: string, input: HTMLElement) => h('label', { class: 'pr-attach-field' }, h('span', null, label), input);
  const title = h('input', { type: 'text', maxLength: 120, value: sidecar.title ?? '', placeholder: 'e.g. Boiler receipt', 'data-keep': keep('title') });
  const notes = h('textarea', { rows: 3, 'data-keep': keep('notes') }, sidecar.text ?? '');
  const takenOn = h('input', { type: 'date', value: sidecar.takenOn ?? '', 'data-keep': keep('taken') });
  const tags = h('input', { type: 'text', value: (sidecar.tags ?? []).join(', '), placeholder: 'receipt, boiler', 'data-keep': keep('tags') });
  const target = h('div', { class: 'pr-attach-target' });
  const drawTarget = () => target.replaceChildren(...targetPicker(app.workspace, picked.get(id), (t) => (picked.set(id, t), drawTarget())));
  drawTarget();
  const save = h('button', { class: 'btn sm', type: 'submit' }, 'Save to the pull request');
  const form = h(
    'form',
    {
      class: 'pr-attach-edit',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        // What the app recorded when it was added (device, original file) stays as it was.
        const { title: _t, text: _x, takenOn: _d, tags: _g, attachedTo: _a, ...kept } = sidecar;
        const next: AttachmentSidecar = {
          ...kept,
          ...(title.value.trim() && { title: title.value.trim() }),
          ...(notes.value.trim() && { text: notes.value.trim() }),
          ...(takenOn.value && { takenOn: takenOn.value }),
          ...(parseTags(tags.value).length && { tags: parseTags(tags.value) }),
          ...(picked.get(id) && { attachedTo: picked.get(id) }),
        };
        const issue = validateFiles({ [attachmentSidecarPath(id)]: sidecarText(next) })[0];
        if (issue) return toast(`Can’t save: ${issue.path.slice(1) || 'details'} ${issue.message}`, 'warn', 6000);
        save.disabled = true;
        try {
          await app.store.source.pulls!.saveSidecar!(detail, next);
          picked.delete(id);
          open.delete(id);
          toast('Saved to the pull request', 'win');
        } catch (err) {
          toast(err instanceof ConflictError ? 'The pull request changed: here it is again. Check and save once more.' : `Couldn’t save: ${(err as Error).message}`, 'warn', 6000);
        }
        save.disabled = false;
        void app.loadPull(detail.number, true);
      },
    },
    field('Title', title),
    field('Notes', notes),
    h('div', { class: 'pr-attach-row' }, field('Taken on', takenOn), field('Tags (comma between)', tags)),
    h('div', { class: 'pr-attach-field' }, h('span', null, 'Attach to'), target),
    save,
  );
  const details = h('details', { class: 'pr-attach-details', ...(open.has(id) && { open: true }) }, h('summary', null, 'Edit details'), form);
  details.addEventListener('toggle', () => (details.open ? open.add(id) : open.delete(id)));
  return details;
}

/**
 * Project › world › level › item selects. Each step is optional below the project; changing one
 * clears the steps under it.
 */
function targetPicker(ws: Workspace | undefined, t: AttachmentTarget | undefined, set: (t: AttachmentTarget | undefined) => void): HTMLElement[] {
  const select = (label: string, value: string | undefined, options: [string, string][], none: string, pick: (v: string | undefined) => void) =>
    h(
      'select',
      { 'aria-label': label, onchange: (e: Event) => pick((e.target as HTMLSelectElement).value || undefined) },
      h('option', { value: '' }, none),
      options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)),
    );
  const out: HTMLElement[] = [];
  const projects = ws ? orderedProjects(ws) : [];
  out.push(select('Project', t?.project, projects.map((p) => [p.overworld.id, p.overworld.title]), 'Nothing yet', (v) => set(v ? { project: v } : undefined)));
  const state = t && ws?.projects[t.project];
  if (!t || !state) return out;
  out.push(select('World', t.world, orderedWorlds(state).map((w) => [w.id, w.name]), 'The whole project', (v) => set({ project: t.project, ...(v && { world: v }) })));
  const world = t.world ? state.worlds[t.world] : undefined;
  if (!world) return out;
  out.push(select('Level', t.level, world.levels.map((l) => [l.id, l.name]), 'The whole world', (v) => set({ project: t.project, world: t.world, ...(v && { level: v }) })));
  const level = t.level ? world.levels.find((l) => l.id === t.level) : undefined;
  if (!level) return out;
  out.push(select('Item', t.item, level.items.map((i) => [i.id, i.title]), 'The whole level', (v) => set({ project: t.project, world: t.world, level: t.level, ...(v && { item: v }) })));
  return out;
}
