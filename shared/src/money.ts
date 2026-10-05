import { budgetPrefs, itemCost, levelCost, projectCost, roundMoney } from './budget';
import type { Item, Workspace } from './model';
import { isResolved } from './model';
import type { ChangeEvent } from './scan';
import { isCleared } from './scoring';
import { dayKey } from './stats';
import { levelsOf } from './today';

export interface MoneyMonth {
  /** YYYY-MM. */
  month: string;
  /** Spent that month. */
  spent: number;
  /** Spent in all by the end of the month. */
  total: number;
  /** What the things finished by then were budgeted at: spend running above this is overspend. */
  planned: number;
}

export interface MoneyLine {
  title: string;
  levelName: string;
  project: string;
  budget: number;
  spent: number;
}

export interface MoneyProject {
  id: string;
  title: string;
  budget: number;
  spent: number;
  left: number;
  saved: number;
  finished: boolean;
}

export interface MoneyStats {
  /** The currency these numbers are in (the one most spent in); other currencies' projects are left out. */
  currency: string;
  /** Projects with money in another currency, not counted here. */
  otherCurrencies: string[];
  budget: number;
  spent: number;
  left: number;
  /** Banked from settled things: under budget adds, over budget takes away. */
  saved: number;
  /** Settled items and levels with a budget of their own: how many came in on or under it. */
  settled: number;
  onBudget: number;
  /** Median spent ÷ budget over those (1 = exactly on budget). */
  medianRatio?: number;
  /** Biggest overspends, and the biggest savings (dropped things save their whole budget). */
  overruns: (MoneyLine & { over: number })[];
  savings: (MoneyLine & { saved: number; dropped: boolean })[];
  projects: MoneyProject[];
  /** Spend by month, from the first month money went out to now (at most `months`), with anything earlier or undated. */
  months: MoneyMonth[];
  before: number;
  /** Spending dated from the history (when each cost was logged) rather than when things were finished. */
  fromHistory: boolean;
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Money across every project with budgets turned on, over time. When each
 * cost was logged comes from the deep scan's 'spent' events; anything they
 * don't cover is dated by when its item was finished (or its level cleared
 * or started). Undefined when no project tracks money.
 */
export function moneyStats(ws: Workspace, opts: { now?: number; months?: number; deep?: ChangeEvent[] } = {}): MoneyStats | undefined {
  const now = opts.now ?? Date.now();
  const monthsMax = opts.months ?? 36;
  const deep = opts.deep ?? [];
  const states = Object.values(ws.projects).filter((p) => budgetPrefs(p));
  if (!states.length) return;

  // Pick the currency most money went through; others are noted, not mixed in.
  const byCurrency = new Map<string, number>();
  for (const p of states) {
    const c = budgetPrefs(p)!.currency;
    const cost = projectCost(p);
    byCurrency.set(c, (byCurrency.get(c) ?? 0) + cost.spent + cost.budget);
  }
  const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const counted = new Set(states.filter((p) => budgetPrefs(p)!.currency === currency).map((p) => p.overworld.id));

  // Spend events by item, from the history.
  const logged = new Map<string, { at: number; amount: number }[]>();
  for (const e of deep) {
    if (e.kind !== 'spent' || !e.amount) continue;
    const k = `${e.level}|${e.subject}`;
    logged.set(k, [...(logged.get(k) ?? []), { at: Date.parse(e.at), amount: e.amount }]);
  }
  const droppedAt = new Map<string, number>();
  for (const e of deep) if (e.kind === 'dropped') droppedAt.set(`${e.level}|${e.subject}`, Date.parse(e.at));

  const spends: { at?: number; amount: number }[] = [];
  const settles: { at?: number; budget: number }[] = [];
  const ratios: number[] = [];
  const overruns: MoneyStats['overruns'] = [];
  const savings: MoneyStats['savings'] = [];
  let fromHistory = false;
  const t = (iso?: string) => (iso ? Date.parse(iso) : undefined);

  for (const { level, ref } of levelsOf(ws)) {
    if (!counted.has(ref.projectId)) continue;
    const key = `${ref.projectId}/${ref.worldId}/${ref.levelId}`;
    const fallback = t(level.clearedAt) ?? t(level.startedAt);
    const things: { item: Item; subject: string }[] = level.items.flatMap((item) => [
      { item, subject: item.title },
      ...(item.subtasks ?? []).map((s) => ({ item: s as Item, subject: `${s.title} (in ${item.title})` })),
    ]);
    for (const { item, subject } of things) {
      const spent = item.spent ?? 0;
      const when = t(item.doneAt) ?? fallback;
      // History first; whatever it doesn't account for is dated by the item.
      let rest = spent;
      for (const l of logged.get(`${key}|${subject}`) ?? []) {
        spends.push(l);
        rest = roundMoney(rest - l.amount);
        fromHistory = true;
      }
      if (rest) spends.push({ at: when, amount: rest });

      if (item.budget === undefined || !isResolved(item)) continue;
      const line = { title: subject, levelName: level.name, project: ref.projectId, budget: item.budget, spent: itemCost(item).spent };
      if (item.status === 'dropped') {
        // A level with its own budget is one envelope: its items' budgets don't add to it.
        if (level.budget === undefined) settles.push({ at: droppedAt.get(`${key}|${subject}`) ?? fallback, budget: item.budget });
        if (item.budget - line.spent > 0) savings.push({ ...line, saved: roundMoney(item.budget - line.spent), dropped: true });
        continue;
      }
      if (level.budget === undefined) settles.push({ at: when, budget: item.budget });
      if (item.budget > 0) ratios.push(line.spent / item.budget);
      if (line.spent > item.budget) overruns.push({ ...line, over: roundMoney(line.spent - item.budget) });
      else if (line.spent < item.budget) savings.push({ ...line, saved: roundMoney(item.budget - line.spent), dropped: false });
    }
    // A level with its own budget is one envelope, settled when it clears.
    if (level.budget !== undefined && isCleared(level)) {
      settles.push({ at: t(level.clearedAt), budget: level.budget });
      const c = levelCost(level);
      if (level.budget > 0) ratios.push(c.spent / level.budget);
      const line = { title: level.name, levelName: level.name, project: ref.projectId, budget: level.budget, spent: c.spent };
      if (c.spent > level.budget) overruns.push({ ...line, over: roundMoney(c.spent - level.budget) });
      else if (c.spent < level.budget) savings.push({ ...line, saved: roundMoney(level.budget - c.spent), dropped: false });
    }
  }

  const projects: MoneyProject[] = states
    .filter((p) => counted.has(p.overworld.id))
    .map((p) => {
      const c = projectCost(p);
      const levels = Object.values(p.worlds).flatMap((w) => w.levels);
      return { id: p.overworld.id, title: p.overworld.title, budget: c.budget, spent: c.spent, left: c.left, saved: c.saved, finished: levels.length > 0 && levels.every(isCleared) };
    })
    .sort((a, b) => b.spent - a.spent);

  // By month, from the first month anything was spent (or settled), up to this one.
  const monthOf = (ms: number) => dayKey(Math.min(ms, now)).slice(0, 7);
  const thisMonth = monthOf(now);
  const dated = [...spends, ...settles].flatMap((s) => (s.at === undefined ? [] : [monthOf(s.at)]));
  let start = dated.length ? dated.reduce((a, b) => (a < b ? a : b)) : thisMonth;
  const shift = (m: string, n: number) => {
    const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const span = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
  if (span(start, thisMonth) > monthsMax) start = shift(thisMonth, 1 - monthsMax);
  const months: MoneyMonth[] = [];
  const index = new Map<string, number>();
  for (let m = start, i = 0; m <= thisMonth; m = shift(m, 1), i++) {
    index.set(m, i);
    months.push({ month: m, spent: 0, total: 0, planned: 0 });
  }
  let before = 0;
  let plannedBefore = 0;
  for (const s of spends) {
    const i = s.at === undefined ? undefined : index.get(monthOf(s.at));
    if (i === undefined) before += s.amount;
    else months[i].spent += s.amount;
  }
  const plannedIn = new Array<number>(months.length).fill(0);
  for (const s of settles) {
    const i = s.at === undefined ? undefined : index.get(monthOf(s.at));
    if (i === undefined) plannedBefore += s.budget;
    else plannedIn[i] += s.budget;
  }
  let total = before;
  let planned = plannedBefore;
  months.forEach((m, i) => {
    m.spent = roundMoney(m.spent);
    total = roundMoney(total + m.spent);
    planned = roundMoney(planned + plannedIn[i]);
    m.total = total;
    m.planned = planned;
  });

  const sum = (f: (p: MoneyProject) => number) => roundMoney(projects.reduce((n, p) => n + f(p), 0));
  return {
    currency,
    otherCurrencies: [...byCurrency.keys()].filter((c) => c !== currency),
    budget: sum((p) => p.budget),
    spent: sum((p) => p.spent),
    left: sum((p) => p.left),
    saved: sum((p) => p.saved),
    settled: ratios.length,
    onBudget: ratios.filter((r) => r <= 1).length,
    medianRatio: median(ratios),
    overruns: overruns.sort((a, b) => b.over - a.over).slice(0, 5),
    savings: savings.sort((a, b) => b.saved - a.saved).slice(0, 5),
    projects,
    months,
    before: roundMoney(before),
    fromHistory,
  };
}
