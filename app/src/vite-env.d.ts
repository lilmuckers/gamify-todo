/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET?: string;
  readonly VITE_GH_REPO?: string;
  readonly VITE_GH_BRANCH?: string;
  /** Google Analytics measurement id; empty = no analytics. */
  readonly VITE_GA_ID?: string;
  /** Sign in with GitHub: the token-exchange Worker's origin. Empty = no sign-in, tokens only. */
  readonly VITE_AUTH_URL?: string;
  /** The GitHub App's Client ID (public). */
  readonly VITE_GITHUB_APP_CLIENT_ID?: string;
  /** The GitHub App's slug, for its install page (github.com/apps/<slug>). */
  readonly VITE_GITHUB_APP_SLUG?: string;
  /** Set for end-to-end test builds: exposes the game to the tests. */
  readonly VITE_E2E?: string;
}
