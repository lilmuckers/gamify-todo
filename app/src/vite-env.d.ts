/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET?: string;
  readonly VITE_GH_REPO?: string;
  readonly VITE_GH_BRANCH?: string;
}
