import { execSync } from 'node:child_process';
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { isDataPath } from '../shared/src/serialize';
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
// Google Analytics: on for the Pages build, off for Docker/local unless set explicitly.
const gaId = process.env.VITE_GA_ID ?? (target === 'pages' ? 'G-5D7YVR6VN6' : '');
const GOOGLE = 'https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com';
// Pages builds use relative URLs so the same build works at /<repo>/ on github.io
// and at the root of a custom domain (routing is hash-based). Override with VITE_BASE.
const base = process.env.VITE_BASE ?? (target === 'pages' ? './' : '/');

/** Every data file path under data/, for the static site's manifest. */
function dataIndex(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        const rel = relative(repoRoot, abs).split(sep).join('/');
        if (isDataPath(rel)) files.push(rel);
      }
    }
  };
  if (existsSync(join(repoRoot, 'data'))) walk(join(repoRoot, 'data'));
  return JSON.stringify({ files }, null, 2) + '\n';
}

/**
 * Serves data/, schema/ and skills/ from the repo in dev and copies them into the
 * Pages build, plus data/index.json (static hosting can't list folders).
 */
function repoData(): Plugin {
  let outDir = join(__dirname, 'dist');
  const dirs = ['data', 'schema', 'skills'];
  const types: Record<string, string> = {
    '.json': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
    '.py': 'text/x-python; charset=utf-8',
  };
  return {
    name: 'quest-repo-data',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // The demo's copy of the example games (the Docker build ships them under examples/).
        const url = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/examples\/data\//, '/data/');
        if (url === '/data/index.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          return res.end(dataIndex());
        }
        const dir = dirs.find((d) => url.startsWith(`/${d}/`));
        if (!dir) return next();
        const file = join(repoRoot, url);
        if (!file.startsWith(join(repoRoot, dir)) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      // Schema and skill ship with every build; data only with the static Pages site.
      for (const d of target === 'pages' ? dirs : dirs.filter((d) => d !== 'data'))
        if (existsSync(join(repoRoot, d)))
          cpSync(join(repoRoot, d), join(outDir, d), { recursive: true, filter: (src) => !/__pycache__|\.pyc$/.test(src) });
      // The Docker editor reads live data through its API; it still ships the
      // example games, under examples/, for Play the demo.
      const dataDir = target === 'pages' ? join(outDir, 'data') : join(outDir, 'examples', 'data');
      if (target !== 'pages' && existsSync(join(repoRoot, 'data'))) cpSync(join(repoRoot, 'data'), dataDir, { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'index.json'), dataIndex());
    },
  };
}

/** Strict CSP for production builds (dev needs inline HMR scripts). */
function csp(): Plugin {
  const connect = target === 'pages' ? "'self' https://api.github.com" : "'self'";
  const ga = (sources: string) => (gaId ? ` ${sources}` : '');
  const policy = [
    "default-src 'self'",
    `script-src 'self'${ga('https://www.googletagmanager.com')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${ga(GOOGLE)}`,
    "font-src 'self'",
    `connect-src ${connect}${ga(GOOGLE)}`,
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
    'import.meta.env.VITE_GA_ID': JSON.stringify(gaId),
  },
  server: {
    port: 5173,
    // Keep the browser's Host so the server's same-origin check passes.
    proxy: target === 'local' ? { '/api': { target: 'http://localhost:8787', changeOrigin: false } } : undefined,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    // Never inline fonts as data: URIs; the CSP only allows same-origin fonts.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf)$/.test(file) ? false : undefined),
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
        // Share a link or text to the installed app (Android) and it lands in the inbox.
        share_target: {
          action: './',
          method: 'GET',
          params: { title: 'share-title', text: 'share-text', url: 'share-url' },
        },
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
