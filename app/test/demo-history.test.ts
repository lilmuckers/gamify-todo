import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detailedStats, fromFiles, historyEvents, progressStats, scanChanges, stampEvents } from '@quest/shared';
import { demoCommits, demoHistory, fakeScan } from '../src/data/demo-history';

const root = join(__dirname, '../..');
const files: Record<string, string> = {};
const walk = (dir: string) => {
  for (const f of readdirSync(join(root, dir))) {
    const rel = `${dir}/${f}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (f.endsWith('.json')) files[rel] = readFileSync(join(root, rel), 'utf8');
  }
};
walk('data');
const ws = fromFiles(files);
const NOW = Date.parse('2026-10-05T17:00:00Z');

describe('the demo history', () => {
  const commits = demoCommits(ws);
  const deep = scanChanges(commits);
  const quick = historyEvents(demoHistory(ws));
  const s = detailedStats(ws, { now: NOW, quick, deep });

  it('is the same every time and spans two years', () => {
    expect(demoCommits(ws)).toEqual(commits);
    expect(commits.length).toBeGreaterThan(600);
    expect(commits[0].date < '2024-10-31').toBe(true);
    expect(commits.at(-1)!.date >= '2026-10-01').toBe(true);
    expect(new Set(commits.map((c) => c.sha)).size).toBe(commits.length);
    expect(commits.every((c) => c.message.startsWith('quest: '))).toBe(true);
  });

  it('agrees with the data: every stamp once, plus what was done and reopened', () => {
    const stamps = stampEvents(ws).length;
    expect(s.undone).toBeGreaterThan(10);
    expect(s.total).toBe(stamps + s.undone);
    // The overlay (quick history only) sees the same reopened work.
    expect(progressStats(ws, NOW, 20, quick).undone).toBe(s.undone);
  });

  it('fills every panel of the detailed page', () => {
    expect(s.scanned).toBe(true);
    expect(s.scope.addedAfterStart).toBeGreaterThan(20);
    expect(s.scope.cut).toBeGreaterThan(10);
    expect(s.scope.extendedDays).toBeGreaterThan(10);
    expect(s.polish.reopened).toBe(s.undone);
    expect(s.polish.editsAfterClear).toBeGreaterThan(5);
    expect(s.polish.top.length).toBeGreaterThan(0);
    expect(s.streak.longest).toBeGreaterThan(14);
    expect(s.projects.filter((p) => p.finished)).toHaveLength(3);
    expect(s.heatmap.flat().filter((c) => c.count > 0).length).toBeGreaterThan(150);
  });

  it('pretends to scan, with progress', async () => {
    const seen: string[] = [];
    const t = Date.now();
    const got = await fakeScan(ws, (p) => seen.push(p.phase), 120);
    expect(got).toEqual(commits);
    expect(Date.now() - t).toBeGreaterThanOrEqual(100);
    expect(seen[0]).toBe('reading');
    expect(seen.at(-1)).toBe('comparing');
  });
});
