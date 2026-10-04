import { describe, expect, it, vi } from 'vitest';
import { APP_MAX_AGE_MS, AppFreshness } from '../src/pwa';

const HOUR = 60 * 60 * 1000;

function setup(start = 10 * HOUR) {
  const env = { now: start, online: true, hidden: false, reloads: 0, store: new Map<string, string>() };
  const fresh = new AppFreshness({
    now: () => env.now,
    online: () => env.online,
    hidden: () => env.hidden,
    reload: () => env.reloads++,
    storage: { getItem: (k) => env.store.get(k) ?? null, setItem: (k, v) => void env.store.set(k, v) },
  });
  const registration = { update: vi.fn(async () => undefined) };
  return { env, fresh, registration };
}

describe('AppFreshness', () => {
  it('checks for a new build on first registration', async () => {
    const { fresh, registration } = setup();
    await fresh.registered(registration);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache alone until it is a few hours old', async () => {
    const { env, fresh, registration } = setup();
    await fresh.registered(registration);
    env.now += APP_MAX_AGE_MS - 1;
    await fresh.check();
    expect(registration.update).toHaveBeenCalledTimes(1);
    env.now += 1;
    await fresh.check();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached app while offline', async () => {
    const { env, fresh, registration } = setup();
    env.online = false;
    await fresh.registered(registration);
    expect(registration.update).not.toHaveBeenCalled();
    env.online = true;
    await fresh.check();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('retries a failed check next time', async () => {
    const { fresh, registration } = setup();
    registration.update.mockRejectedValueOnce(new Error('network'));
    await fresh.registered(registration);
    expect(fresh.lastChecked).toBe(0);
    await fresh.check();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('reloads at once while booting', () => {
    const { env, fresh } = setup();
    fresh.needReload();
    expect(env.reloads).toBe(1);
  });

  it('waits for the tab to be hidden once the user is busy', () => {
    const { env, fresh } = setup();
    fresh.touched();
    fresh.needReload();
    expect(env.reloads).toBe(0);
    fresh.visibilityChanged();
    expect(env.reloads).toBe(0);
    env.hidden = true;
    fresh.visibilityChanged();
    expect(env.reloads).toBe(1);
    fresh.visibilityChanged();
    expect(env.reloads).toBe(1);
  });

  it('reloads a hidden tab straight away', () => {
    const { env, fresh } = setup();
    env.now += HOUR;
    env.hidden = true;
    fresh.needReload();
    expect(env.reloads).toBe(1);
  });
});
