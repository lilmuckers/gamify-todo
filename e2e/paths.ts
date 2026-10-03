import { resolve } from 'node:path';

/** The local editor's repo, reseeded each time its server starts. */
export const E2E_REPO = resolve(import.meta.dirname, '.tmp/repo');
export const PAGES_PORT = 4317;
export const LOCAL_PORT = 8797;
