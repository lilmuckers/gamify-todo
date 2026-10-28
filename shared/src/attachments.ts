import type { AttachmentSidecar } from './types.gen';

export type { AttachmentSidecar };
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
