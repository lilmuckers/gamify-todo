import { describe, expect, it } from 'vitest';
import type { PushDevice } from '@quest/shared';
import {
  defaultLabel,
  findThisDevice,
  needsKeys,
  subscribedWith,
  subscription,
  subscriptionEntry,
  support,
  VAPID_SECRET,
  type PushEnv,
  type PushManagerLike,
  type SubscriptionLike,
} from '../src/push/push';
import { fromBase64Url, generateVapidKeys, toBase64Url } from '../src/push/vapid';
import { safeRoute } from '../src/push/worker';

const env = (over: Partial<PushEnv> = {}): PushEnv => ({
  hasPush: true,
  ios: false,
  standalone: false,
  userAgent: '',
  permission: () => 'default',
  requestPermission: async () => 'granted',
  pushManager: async () => fakePushManager(),
  timezone: () => 'Europe/London',
  ...over,
});

let n = 0;
function fakeSub(key: Uint8Array): SubscriptionLike & { gone: boolean } {
  const id = ++n;
  return {
    gone: false,
    endpoint: `https://push.example.com/${id}`,
    options: { applicationServerKey: key.slice().buffer },
    toJSON: () => ({ endpoint: `https://push.example.com/${id}`, keys: { p256dh: `p${id}`, auth: `a${id}` } }),
    async unsubscribe() {
      this.gone = true;
      return true;
    },
  };
}

function fakePushManager(current: SubscriptionLike | null = null): PushManagerLike & { made: number } {
  return {
    made: 0,
    getSubscription: async () => current,
    async subscribe({ applicationServerKey }) {
      this.made++;
      current = fakeSub(applicationServerKey);
      return current;
    },
  };
}

const device = (id: string, endpoint: string): PushDevice => ({
  id,
  label: id,
  addedAt: '2026-10-28T09:00:00Z',
  timezone: 'UTC',
  subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
});

describe('generateVapidKeys', () => {
  it('makes a raw P-256 public point and a private scalar that sign and verify together', async () => {
    const keys = await generateVapidKeys();
    const raw = fromBase64Url(keys.publicKey);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(4);
    expect(fromBase64Url(keys.privateKey).length).toBe(32);
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);

    // What web-push does with them: sign a JWT with d, check it with the public point.
    const jwk = { kty: 'EC', crv: 'P-256', x: toBase64Url(raw.slice(1, 33)), y: toBase64Url(raw.slice(33)), d: keys.privateKey };
    const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const pub = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const data = new TextEncoder().encode('header.claims');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, data)).toBe(true);
  });

  it('round-trips base64url', () => {
    const bytes = Uint8Array.from({ length: 70 }, (_, i) => (i * 37) % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});

describe('support', () => {
  it('needs the Home Screen app on iOS, and notes a block', () => {
    expect(support(env({ hasPush: false, ios: true }))).toBe('ios-needs-install');
    expect(support(env({ hasPush: false }))).toBe('unsupported');
    expect(support(env({ permission: () => 'denied' }))).toBe('denied');
    expect(support(env({ ios: true, standalone: true }))).toBe('ready');
  });
});

describe('defaultLabel', () => {
  it('names the platform and browser', () => {
    expect(defaultLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130.0 Mobile Safari/537.36', false, false)).toBe('Android Chrome');
    expect(defaultLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0', false, false)).toBe('Mac Firefox');
    expect(defaultLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', true, true)).toBe('iPhone app');
  });
});

describe('device bookkeeping', () => {
  it('finds this device by id, or by endpoint when the id was lost', () => {
    const devices = [device('pixel', 'https://push.example.com/a'), device('laptop', 'https://push.example.com/b')];
    expect(findThisDevice(devices, 'laptop')?.id).toBe('laptop');
    expect(findThisDevice(devices, 'web-new', 'https://push.example.com/a')?.id).toBe('pixel');
    expect(findThisDevice(devices, undefined)).toBeUndefined();
  });

  it('needs keys until both the public key and the secret exist', () => {
    expect(needsKeys(undefined, [])).toBe(true);
    expect(needsKeys({ notify: { vapidPublicKey: 'B' } }, [])).toBe(true);
    expect(needsKeys({}, [VAPID_SECRET])).toBe(true);
    expect(needsKeys({ notify: { vapidPublicKey: 'B' } }, [VAPID_SECRET])).toBe(false);
  });

  it('stores only the endpoint and keys, and refuses a subscription without keys', () => {
    const sub = fakeSub(new Uint8Array([4]));
    expect(subscriptionEntry(sub)).toEqual({ endpoint: sub.endpoint, keys: sub.toJSON().keys });
    expect(() => subscriptionEntry({ ...sub, toJSON: () => ({ endpoint: 'x' }) })).toThrow(/no keys/);
  });
});

describe('subscription', () => {
  it('keeps a subscription made for the same key, and replaces one for another key', async () => {
    const { publicKey } = await generateVapidKeys();
    const other = await generateVapidKeys();
    const same = fakeSub(fromBase64Url(publicKey));
    expect(subscribedWith(same, publicKey)).toBe(true);
    expect(subscribedWith(same, other.publicKey)).toBe(false);

    const pm = fakePushManager(same);
    expect(await subscription(pm, publicKey)).toBe(same);
    expect(pm.made).toBe(0);

    const replaced = await subscription(pm, other.publicKey);
    expect(replaced).not.toBe(same);
    expect(same.gone).toBe(true);
    expect(subscribedWith(replaced, other.publicKey)).toBe(true);
  });

  it('starts over when asked, even for the same key', async () => {
    const { publicKey } = await generateVapidKeys();
    const old = fakeSub(fromBase64Url(publicKey));
    const pm = fakePushManager(old);
    expect(await subscription(pm, publicKey, true)).not.toBe(old);
    expect(old.gone).toBe(true);
  });
});

describe('safeRoute', () => {
  it('lets only in-app hash routes through', () => {
    expect(safeRoute('#/pr/3')).toBe('#/pr/3');
    expect(safeRoute('#/p/house/kitchen/tiles')).toBe('#/p/house/kitchen/tiles');
    expect(safeRoute('https://evil.example.com')).toBeUndefined();
    expect(safeRoute('javascript:alert(1)')).toBeUndefined();
    expect(safeRoute(42)).toBeUndefined();
  });
});
