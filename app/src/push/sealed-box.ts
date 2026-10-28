// libsodium's crypto_box_seal, which GitHub requires for Actions secrets, in pure JS: tweetnacl's
// box plus a BLAKE2b nonce. No WebAssembly, so the CSP stays as it is. Loaded only when a secret
// is written. Tested against libsodium-wrappers (app/test/sealed-box.test.ts).

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

/**
 * Seals `value` for the repo's secrets key (base64, from `secretsPublicKey`) and returns the
 * base64 box: an ephemeral public key, then box(value) with nonce = BLAKE2b-192(epk ‖ pk).
 * Only the holder of the repo's private key (GitHub) can open it.
 */
export async function sealSecret(publicKey: string, value: string): Promise<string> {
  const [naclModule, blakeModule] = await Promise.all([import('tweetnacl'), import('blakejs')]);
  // Both are CommonJS: the bundler and Node hand them over differently.
  const nacl = ((naclModule as { default?: unknown }).default ?? naclModule) as typeof import('tweetnacl');
  const { blake2b } = ((blakeModule as { default?: unknown }).default ?? blakeModule) as typeof import('blakejs');
  const pk = fromBase64(publicKey);
  if (pk.length !== nacl.box.publicKeyLength) throw new Error('Not a repo secrets key');
  const eph = nacl.box.keyPair();
  const nonce = blake2b(concat(eph.publicKey, pk), undefined, nacl.box.nonceLength);
  const box = nacl.box(new TextEncoder().encode(value), nonce, pk, eph.secretKey);
  eph.secretKey.fill(0);
  return toBase64(concat(eph.publicKey, box));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
