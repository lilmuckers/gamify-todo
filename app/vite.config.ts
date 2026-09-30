import { execSync } from 'node:child_process';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const repoRoot = resolve(__dirname, '..');
const target = process.env.VITE_TARGET === 'local' ? 'local' : 'pages';

function detectRepo(): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execSync('git remote get-url origin', { cwd: repoRoot }).toString().trim();
    const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
    return m?.[1];
  } catch {
    return undefined;
  }
}

const repo = process.env.VITE_GH_REPO ?? detectRepo();
// Project pages live under /<repo>/; override with VITE_BASE for custom domains.
const base = process.env.VITE_BASE ?? (target === 'pages' && repo ? `/${repo.split('/')[1]}/` : '/');

/** Serves /data and /schema from the repo in dev; copies them into the Pages build. */
function repoData(): Plugin {
  const dirs = ['data', 'schema'];
  return {
    name: 'quest-repo-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]).replace(base, '/');
        const dir = dirs.find((d) => url.startsWith(`/${d}/`));
        if (!dir) return next();
        const file = join(repoRoot, url);
        if (!file.startsWith(join(repoRoot, dir)) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (target !== 'pages') return;
      for (const d of dirs) cpSync(join(repoRoot, d), join(__dirname, 'dist', d), { recursive: true });
    },
  };
}

/** Strict CSP for production builds (dev needs inline HMR scripts). */
function csp(): Plugin {
  const connect = target === 'pages' ? "'self' https://api.github.com" : "'self'";
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'quest-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig({
  base,
  define: {
    'import.meta.env.VITE_TARGET': JSON.stringify(target),
    'import.meta.env.VITE_GH_REPO': JSON.stringify(repo ?? ''),
  },
  server: {
    port: 5173,
    proxy: target === 'local' ? { '/api': 'http://localhost:8787' } : undefined,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    repoData(),
    csp(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Quest Log',
        short_name: 'Quest Log',
        description: 'A project tracker you play. Ship good enough, then move on.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1a1c2c',
        theme_color: '#1a1c2c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2,woff}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Static data: fresh when online, cached copy when offline.
            urlPattern: ({ url }) => /\/(data|schema)\/.*\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'quest-data', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
});
