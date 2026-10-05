import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detailedStats, fromFiles, historyEvents, isCleared, levelsOf, scanChanges, stampEvents, type ChangeEvent, type Level } from '@quest/shared';
import { demoCommits, demoHistory } from '../src/data/demo-history';

/**
 * The demo's stats must tell the truth about the demo's data: the made-up
 * history may only add what the data allows (it records reopens and edits
 * in `stats`), and nothing may happen out of order or after the data ends.
 */
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
const commits = demoCommits(ws);
const deep = scanChanges(commits);
const located = levelsOf(ws).map(({ level, ref }) => ({ level, key: `${ref.projectId}/${ref.worldId}/${ref.levelId}` }));
const t = (iso?: string) => (iso ? Date.parse(iso) : NaN);

/** The last moment the data knows about. */
const horizon = Math.max(
  ...located.flatMap(({ level }) => [
    t(level.startedAt),
    t(level.clearedAt),
    ...level.items.flatMap((i) => [t(i.doneAt), ...(i.subtasks ?? []).map((s) => t(s.doneAt))]),
    ...level.successCriteria.map((c) => t(c.doneAt)),
  ]).filter((n) => !Number.isNaN(n)),
);
const byLevel = (key: string) => deep.filter((e) => e.level === key);
const itemKey = (e: ChangeEvent, level: Level) => {
  for (const i of level.items) {
    if (i.title === e.subject) return i.id;
    for (const s of i.subtasks ?? []) if (`${s.title} (in ${i.title})` === e.subject) return `${i.id}/${s.id}`;
  }
};

describe('the demo data', () => {
  it('stamps happen inside their level, in dependency order', () => {
    const bad: string[] = [];
    for (const { level, key } of located) {
      const start = t(level.startedAt);
      const end = Number.isNaN(t(level.clearedAt)) ? horizon : t(level.clearedAt);
      const check = (what: string, at?: string) => {
        if (!at) return;
        if (Number.isNaN(start) || t(at) < start || t(at) > end) bad.push(`${key}: ${what} at ${at} outside ${level.startedAt}..${level.clearedAt ?? 'now'}`);
      };
      for (const i of level.items) {
        check(i.title, i.doneAt);
        for (const s of i.subtasks ?? []) check(`${s.title} (in ${i.title})`, s.doneAt);
        for (const d of i.dependsOn ?? []) {
          const dep = level.items.find((x) => x.id === d);
          if (i.doneAt && dep?.status === 'done' && dep.doneAt && dep.doneAt > i.doneAt) bad.push(`${key}: ${i.title} done before what it waits for (${dep.title})`);
        }
      }
      for (const c of level.successCriteria) check(c.text, c.doneAt);
      if (isCleared(level)) {
        const last = level.successCriteria.filter((c) => c.mvp).map((c) => c.doneAt ?? '').sort().at(-1);
        if (last !== level.clearedAt) bad.push(`${key}: cleared at ${level.clearedAt} but the last MVP tick is ${last}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the demo history', () => {
  it('ends when the data does', () => {
    expect(commits.filter((c) => t(c.date) > horizon + 60_000).map((c) => `${c.date} ${c.message}`)).toEqual([]);
  });

  it('keeps every event inside its level, and adds items before they are done', () => {
    const bad: string[] = [];
    for (const { level, key } of located) {
      const start = t(level.startedAt);
      const end = Number.isNaN(t(level.clearedAt)) ? horizon : t(level.clearedAt);
      for (const e of byLevel(key)) {
        const at = t(e.at);
        const afterClear = !!e.afterClear;
        if (at < start - 60_000 || (!afterClear && at > end + 60_000)) bad.push(`${key}: ${e.kind} ${e.subject} at ${e.at}`);
        if (e.kind === 'added') {
          const firstDone = byLevel(key).find((x) => x.kind === 'done' && x.subject === e.subject);
          if (firstDone && firstDone.at < e.at) bad.push(`${key}: ${e.subject} done before it was added`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('reopens and edits done items exactly as often as the data recorded (stats.itemEdits)', () => {
    const bad: string[] = [];
    for (const { level, key } of located) {
      const counted: Record<string, number> = {};
      for (const e of byLevel(key)) {
        // What the app counts: reopening or editing an item while it's done, before the clear.
        if ((e.kind === 'reopened' || e.kind === 'edited') && !e.afterClear) {
          const k = itemKey(e, level) ?? e.subject;
          counted[k] = (counted[k] ?? 0) + 1;
        }
      }
      const recorded = level.stats?.itemEdits ?? {};
      for (const k of new Set([...Object.keys(counted), ...Object.keys(recorded)]))
        if ((counted[k] ?? 0) !== (recorded[k] ?? 0)) bad.push(`${key} ${k}: history ${counted[k] ?? 0}, data ${recorded[k] ?? 0}`);
    }
    expect(bad).toEqual([]);
  });

  it('polishes after clearing and extends time-boxes exactly as the data recorded', () => {
    const bad: string[] = [];
    for (const { level, key } of located) {
      const events = byLevel(key);
      // As the app counts polish: any change to a cleared level except adding or cutting scope.
      const after = events.filter((e) => e.afterClear && ['edited', 'reopened', 'done', 'ticked', 'unticked', 'extended'].includes(e.kind)).length;
      if (after !== (level.stats?.editsAfterClear ?? 0)) bad.push(`${key}: ${after} edits after clear, data ${level.stats?.editsAfterClear ?? 0}`);
      const ext = events.filter((e) => e.kind === 'extended');
      const days = ext.reduce((n, e) => n + (e.days ?? 0), 0);
      if (days !== (level.stats?.timeboxExtendedDays ?? 0)) bad.push(`${key}: extended ${days}, data ${level.stats?.timeboxExtendedDays ?? 0}`);
      // Extending happens once the original box has run out (the weekly review offers it then).
      const original = t(level.startedAt) + (level.timeboxDays - (level.stats?.timeboxExtendedDays ?? 0)) * 86_400_000;
      for (const e of ext) if (t(e.at) < original) bad.push(`${key}: extended before the time-box ran out`);
    }
    expect(bad).toEqual([]);
  });

  it('adds up to the data on the detailed page', () => {
    const quick = historyEvents(demoHistory(ws));
    const s = detailedStats(ws, { now: horizon + 60_000, quick, deep });
    const sum = (f: (l: Level) => number) => located.reduce((n, { level }) => n + f(level), 0);
    expect(s.total).toBe(stampEvents(ws).length + s.undone);
    expect(s.polish.editsAfterClear).toBe(sum((l) => l.stats?.editsAfterClear ?? 0));
    expect(s.scope.extendedDays).toBe(sum((l) => l.stats?.timeboxExtendedDays ?? 0));
    expect(s.scope.cut).toBe(sum((l) => l.items.filter((i) => i.status === 'dropped').length + l.items.flatMap((i) => i.subtasks ?? []).filter((x) => x.status === 'dropped').length));
    // Every reopen the page counts is one the data recorded.
    expect(s.polish.reopened).toBeLessThanOrEqual(sum((l) => Object.values(l.stats?.itemEdits ?? {}).reduce((a, b) => a + b, 0)));
    expect(s.undone).toBe(s.polish.reopened);
    expect(s.streak.current).toBeGreaterThan(0);
  });
});
