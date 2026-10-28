// The repo's VAPID key pair, made in this browser the first time any device turns push on. The
// public key goes into automation.json (plans D9); the private key only ever leaves as a sealed
// Actions secret. web-push wants the raw 65-byte public point and the 32-byte private scalar,
// both base64url.

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export const toBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** A fresh P-256 pair from WebCrypto, in the form web-push and `pushManager.subscribe` take. */
export async function generateVapidKeys(subtle: SubtleCrypto = crypto.subtle): Promise<VapidKeys> {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const { d } = await subtle.exportKey('jwk', pair.privateKey);
  if (raw.length !== 65 || raw[0] !== 4 || !d) throw new Error('This browser made an unexpected VAPID key');
  return { publicKey: toBase64Url(raw), privateKey: d };
}
