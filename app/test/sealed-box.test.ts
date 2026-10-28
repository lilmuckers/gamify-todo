import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { sealSecret } from '../src/push/sealed-box';

// The package's ESM build points at a file it doesn't ship: use the CommonJS one.
const sodium: typeof import('libsodium-wrappers') = createRequire(import.meta.url)('libsodium-wrappers');

describe('sealSecret', () => {
  it('makes a sealed box libsodium opens', async () => {
    await sodium.ready;
    const keys = sodium.crypto_box_keypair();
    const value = 'MIGHAgEAMBMGByqGSM49 ✓ private key';
    const sealed = await sealSecret(sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL), value);
    const opened = sodium.crypto_box_seal_open(sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL), keys.publicKey, keys.privateKey);
    expect(sodium.to_string(opened)).toBe(value);
  });

  it('uses a fresh key every time', async () => {
    await sodium.ready;
    const pk = sodium.to_base64(sodium.crypto_box_keypair().publicKey, sodium.base64_variants.ORIGINAL);
    expect(await sealSecret(pk, 'same')).not.toBe(await sealSecret(pk, 'same'));
  });

  it('refuses a key of the wrong size', async () => {
    await expect(sealSecret(btoa('short'), 'x')).rejects.toThrow(/secrets key/);
  });
});
