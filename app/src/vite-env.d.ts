/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET?: string;
  readonly VITE_GH_REPO?: string;
  readonly VITE_GH_BRANCH?: string;
  /** Google Analytics measurement id; empty = no analytics. */
  readonly VITE_GA_ID?: string;
}
