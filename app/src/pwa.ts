/**
 * Keeps the installed app (and the service-worker cached web app) from going
 * stale. Workbox serves the precached build cache-first, and the browser only
 * looks for a new one on navigation, so an installed app left open for days
 * keeps running old code. Once the cached copy is older than `maxAgeMs` and
 * we're online, ask for a new build; when one activates, reload at a moment
 * that won't interrupt anything.
 */

/** How long the cached app may go unchecked while online. */
export const APP_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** How soon after boot a reload still counts as part of loading. */
const BOOT_GRACE_MS = 10_000;
const CHECKED_KEY = 'quest-sw-checked';

/** The part of a ServiceWorkerRegistration we use. */
export interface Updatable {
  update(): Promise<unknown>;
}

export interface FreshnessDeps {
  now?: () => number;
  online?: () => boolean;
  hidden?: () => boolean;
  reload?: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  maxAgeMs?: number;
}

/** Update checks and safe reloads for one service-worker registration. */
export class AppFreshness {
  private registration?: Updatable;
  private checking = false;
  private reloadWanted = false;
  private readonly bootAt: number;
  private readonly now: () => number;
  private readonly online: () => boolean;
  private readonly hidden: () => boolean;
  private readonly doReload: () => void;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
  private readonly maxAgeMs: number;
  private interacted = false;

  constructor(deps: FreshnessDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.online = deps.online ?? (() => navigator.onLine);
    this.hidden = deps.hidden ?? (() => document.visibilityState === 'hidden');
    this.doReload = deps.reload ?? (() => location.reload());
    this.storage = deps.storage ?? safeLocalStorage();
    this.maxAgeMs = deps.maxAgeMs ?? APP_MAX_AGE_MS;
    this.bootAt = this.now();
  }

  /** When the cached app was last confirmed current (0: never). */
  get lastChecked(): number {
    try {
      return Number(this.storage?.getItem(CHECKED_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  private set lastChecked(at: number) {
    try {
      this.storage?.setItem(CHECKED_KEY, String(at));
    } catch {
      // Private mode or blocked storage: we'll just check a little more often.
    }
  }

  /** The cached app is past its age and we can reach the network to replace it. */
  isStale(): boolean {
    return this.online() && this.now() - this.lastChecked >= this.maxAgeMs;
  }

  /** The service worker registered: check straight away if the cache is old. */
  registered(registration: Updatable): Promise<void> {
    this.registration = registration;
    return this.check();
  }

  /** Asks the browser for a new build if the cached one has expired. */
  async check(): Promise<void> {
    if (!this.registration || this.checking || !this.isStale()) return;
    this.checking = true;
    try {
      await this.registration.update();
      this.lastChecked = this.now();
    } catch {
      // Flaky network: try again at the next check.
    } finally {
      this.checking = false;
    }
  }

  /** The user did something: from now on, don't reload under them. */
  touched() {
    this.interacted = true;
  }

  /**
   * A new build took over. Reload now if nobody would notice (still booting,
   * or the tab is hidden), else wait until the tab is next hidden.
   */
  needReload() {
    this.reloadWanted = true;
    const booting = !this.interacted && this.now() - this.bootAt < BOOT_GRACE_MS;
    if (booting || this.hidden()) this.reload();
  }

  /** Tab visibility changed. */
  visibilityChanged() {
    if (this.hidden()) {
      if (this.reloadWanted) this.reload();
    } else void this.check();
  }

  private reload() {
    this.reloadWanted = false;
    this.doReload();
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Registers the service worker and keeps the cached app fresh. */
export async function startFreshness(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  const fresh = new AppFreshness();
  registerSW({
    immediate: true,
    onNeedReload: () => fresh.needReload(),
    onRegisteredSW: (_url, registration) => {
      if (registration) void fresh.registered(registration);
    },
  });
  for (const type of ['pointerdown', 'keydown'])
    window.addEventListener(type, () => fresh.touched(), { once: true, capture: true, passive: true });
  document.addEventListener('visibilitychange', () => fresh.visibilityChanged());
  window.addEventListener('online', () => void fresh.check());
  // An installed app can stay open and visible for days: look now and then.
  setInterval(() => void fresh.check(), 15 * 60 * 1000);
}
