import type { Workspace } from './model';
import type { AttachmentKind, AttachmentRead, AttachmentSidecar, AttachmentTarget, Automation } from './types.gen';

export type { AttachmentKind, AttachmentRead, AttachmentSidecar, AttachmentTarget };
export type PhotoReader = NonNullable<NonNullable<Automation['photos']>['reader']>;
export type AttachmentVia = AttachmentSidecar['via'];

/**
 * Photos and documents (plans D14): each is `<id>.<ext>` with a `<id>.json` sidecar.
 * The files are binary, so they are only ever listed, never read or parsed.
 */
export const ATTACHMENTS_DIR = 'data/attachments';
/** File types an attachment may be, for now. */
export const ATTACHMENT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'] as const;
export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const SIDECAR_RE = new RegExp(`^${ATTACHMENTS_DIR}/(${SLUG})\\.json$`);
const FILE_RE = new RegExp(`^${ATTACHMENTS_DIR}/(${SLUG})\\.(?:${ATTACHMENT_EXTENSIONS.join('|')})$`);

export const attachmentFilePath = (id: string, ext: AttachmentExtension) => `${ATTACHMENTS_DIR}/${id}.${ext}`;
export const attachmentSidecarPath = (id: string) => `${ATTACHMENTS_DIR}/${id}.json`;

/** Whether a repo path is anything under data/attachments/: a file, a sidecar or a stray. */
export const isAttachmentPath = (path: string) => path.startsWith(`${ATTACHMENTS_DIR}/`);
/** Whether a path under data/attachments/ is a binary (anything but JSON), which is never read. */
export const isAttachmentFile = (path: string) => isAttachmentPath(path) && !path.endsWith('.json');
/** The id a sidecar path names, or undefined when it isn't `data/attachments/<id>.json`. */
export const sidecarId = (path: string) => SIDECAR_RE.exec(path)?.[1];
/** The id a file path names, or undefined when it isn't `data/attachments/<id>.<allowed ext>`. */
export const attachmentFileId = (path: string) => FILE_RE.exec(path)?.[1];

/** The file names under data/attachments/ among `paths`, sorted: how the Warp Zone lists them. */
export function attachmentNames(paths: string[]): string[] {
  return paths
    .filter(isAttachmentPath)
    .map((p) => p.slice(ATTACHMENTS_DIR.length + 1))
    .sort();
}

/**
 * Attachments linked to `target` or anything inside it (a world's include its levels' and
 * items'), newest first by the day taken, else when added. Links to things that are gone match
 * nothing, so they're simply not shown.
 */
export function attachmentsIn(list: readonly AttachmentSidecar[] | undefined, target: AttachmentTarget): AttachmentSidecar[] {
  const keys = (['project', 'world', 'level', 'item'] as const).filter((k) => target[k] !== undefined);
  const when = (a: AttachmentSidecar) => a.takenOn ?? a.addedAt;
  return (list ?? []).filter((a) => a.attachedTo && keys.every((k) => a.attachedTo![k] === target[k])).sort((a, b) => when(b).localeCompare(when(a)) || a.id.localeCompare(b.id));
}

/**
 * Where an attachment's file may be, most likely first. Sidecars don't record the extension and
 * the app reads only JSON from the tree, so readers try these in turn (the app writes .jpg).
 */
export const attachmentFileCandidates = (id: string) => ATTACHMENT_EXTENSIONS.map((ext) => attachmentFilePath(id, ext));

/** "Kitchen › Fit › Tiling › Grout", from whatever of the link still exists in `ws`. */
export function attachmentTargetLabel(ws: Workspace | undefined, t: AttachmentTarget): string {
  const state = ws?.projects[t.project];
  const world = t.world ? state?.worlds[t.world] : undefined;
  const level = t.level ? world?.levels.find((l) => l.id === t.level) : undefined;
  const item = t.item ? level?.items.find((i) => i.id === t.item) : undefined;
  return [state?.overworld.title ?? t.project, t.world && (world?.name ?? t.world), t.level && (level?.name ?? t.level), t.item && (item?.title ?? t.item)]
    .filter(Boolean)
    .join(' › ');
}

/** Tags typed as "receipt, boiler service": trimmed, de-duplicated, empties dropped. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];
}

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  receipt: 'Receipt',
  'quote-invoice': 'Quote or invoice',
  'letter-bill': 'Letter or bill',
  booking: 'Booking',
  'product-label': 'Product label',
  handwritten: 'Handwritten note',
  screenshot: 'Screenshot',
  page: 'Page',
  'plan-measure': 'Plan or measurements',
  scene: 'Photo',
};

/** A read's facts as label and text, in reading order. Items and dimensions come as one line each. */
export function readFieldRows(fields: AttachmentRead['fields']): [string, string][] {
  if (!fields) return [];
  const money = (v: string | undefined) => (v === undefined ? undefined : fields.currency ? `${v} ${fields.currency}` : v);
  const rows: [string, string | undefined][] = [
    ['From', fields.from],
    ['Date', fields.date],
    ['Time', fields.time],
    ['Where', fields.where],
    ['Due', fields.dueOn],
    ['Reference', fields.reference],
    ['Total', money(fields.total)],
    ['Tax', money(fields.tax)],
    ['Paid with', fields.paymentMethod],
    ['Brand', fields.brand],
    ['Model', fields.model],
    ['Serial', fields.serial],
    ['Spec', fields.spec],
    ['Source', fields.source],
    ['Link', fields.url],
    ['Caption', fields.caption],
    ...(fields.items ?? []).map((i): [string, string] => ['Item', [i.qty !== undefined && `${i.qty} ×`, i.name, i.price !== undefined && `· ${money(i.price)}`].filter(Boolean).join(' ')]),
    ...(fields.dimensions ?? []).map((d): [string, string] => [d.label ?? 'Measure', `${d.value} ${d.unit}`]),
  ];
  return rows.filter((r): r is [string, string] => r[1] !== undefined);
}
