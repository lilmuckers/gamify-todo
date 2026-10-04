import type { GameState, Item, Level, Subtask, World } from './model';
import { isResolved, orderedWorlds } from './model';
import { isCleared, isWorldCleared } from './scoring';

/** Currency for a project that doesn't name one. */
export const DEFAULT_CURRENCY = 'GBP';

/** Item and level fields that only record money: changing them is bookkeeping, never polish. */
export const COST_FIELDS = ['budget', 'spent'] as const;

/**
 * Cash for one item, level, world or project, rolled up from what's below it.
 * A budget set on the thing itself wins over the sum of its children's, so a
 * level can have one allowance however its items are costed.
 */
export interface Cost {
  /** A budget is set here or somewhere below. */
  budgeted: boolean;
  /** The budget is set on this thing itself (not only summed from below). */
  capped: boolean;
  /** The allowance: its own budget, else the sum of its children's. */
  budget: number;
  /** Sum of the children's budgets, to set against its own budget. */
  planned: number;
  /** Cash spent here and below. */
  spent: number;
  /** budget − spent; negative when over. */
  left: number;
  /**
   * Savings banked so far: budget − spent for everything settled (done or
   * dropped items, cleared levels, finished worlds). Negative means overspent.
   * Dropping a budgeted item banks all of it that wasn't spent.
   */
  saved: number;
  /** Done or dropped (items), cleared (levels), every level cleared (worlds). */
  settled: boolean;
}

/** Rounds to pennies, so sums of decimals don't drift (0.1 + 0.2). */
export const roundMoney = (n: number) => Math.round(n * 100) / 100;

const sum = (ns: number[]) => roundMoney(ns.reduce((a, b) => a + b, 0));

function rollup(own: { budget?: number; spent?: number }, settled: boolean, kids: Cost[]): Cost {
  const planned = sum(kids.filter((k) => k.budgeted).map((k) => k.budget));
  const capped = own.budget !== undefined;
  const budgeted = capped || kids.some((k) => k.budgeted);
  const budget = roundMoney(own.budget ?? planned);
  const spent = sum([own.spent ?? 0, ...kids.map((k) => k.spent)]);
  // Settling closes the whole envelope; until then only finished children count.
  const saved = settled && budgeted ? roundMoney(budget - spent) : sum(kids.map((k) => k.saved));
  return { budgeted, capped, budget, planned, spent, left: roundMoney(budget - spent), saved, settled };
}

/** An item's cash, including its steps when it's a dependency with a warp pipe. */
export function itemCost(item: Item | Subtask): Cost {
  const steps = 'subtasks' in item ? (item.subtasks ?? []) : [];
  return rollup(item, isResolved(item as Item), steps.map(itemCost));
}

export function levelCost(level: Level): Cost {
  return rollup(level, isCleared(level), level.items.map(itemCost));
}

export function worldCost(world: World): Cost {
  return rollup(world, isWorldCleared(world), world.levels.map(levelCost));
}

/** A whole project: its worlds added up (projects have no budget of their own). */
export function projectCost(state: GameState): Cost {
  return rollup({}, false, orderedWorlds(state).map(worldCost));
}

/** Whether there's any money to show: a budget, or cash spent. */
export const hasCost = (c: Cost) => c.budgeted || c.spent > 0;

/** Heads-up alert point when a project doesn't set one: 90% of a budget spent. */
export const DEFAULT_ALERT_AT = 90;

/** A project's budget settings with defaults filled in. */
export interface BudgetPrefs {
  currency: string;
  /** Alert as costs are logged. */
  alerts: boolean;
  /** Percentage of a budget that gives a heads-up. */
  alertAt: number;
}

/**
 * Budgets are opt-in per project: undefined when this project hasn't turned
 * them on, and then nothing about money is shown (whatever the files hold).
 */
export function budgetPrefs(state: GameState | undefined): BudgetPrefs | undefined {
  const b = state?.overworld.budgets;
  if (!b) return undefined;
  return { currency: b.currency ?? DEFAULT_CURRENCY, alerts: b.alerts !== false, alertAt: b.alertAt ?? DEFAULT_ALERT_AT };
}

const formats = new Map<string, Intl.NumberFormat>();

/** "£1,200" or "£49.99": pennies only when there are some. */
export function formatMoney(amount: number, currency = DEFAULT_CURRENCY): string {
  const pence = !Number.isInteger(roundMoney(amount));
  const key = `${currency}:${pence}`;
  let f = formats.get(key);
  if (!f) {
    try {
      const digits = pence ? 2 : 0;
      f = new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      // An unknown code is still valid data: show it plainly.
      return `${roundMoney(amount).toFixed(pence ? 2 : 0)} ${currency}`;
    }
    formats.set(key, f);
  }
  return f.format(roundMoney(amount));
}

/** Short cash label: "£35 of £40", "£40 budget" or "£12 spent". */
export function costLabel(c: Cost, currency = DEFAULT_CURRENCY): string {
  const m = (n: number) => formatMoney(n, currency);
  if (!c.budgeted) return `${m(c.spent)} spent`;
  return c.spent > 0 ? `${m(c.spent)} of ${m(c.budget)}` : `${m(c.budget)} budget`;
}

/** Banked savings: "£5 saved", or "£5 over" when it went over. Undefined when there are none. */
export function savedLabel(c: Cost, currency = DEFAULT_CURRENCY): string | undefined {
  if (!c.budgeted || !c.saved) return undefined;
  return c.saved > 0 ? `${formatMoney(c.saved, currency)} saved` : `${formatMoney(-c.saved, currency)} over`;
}

/** How worried to be: 0 fine, 1 past the heads-up point (while still open), 2 over budget. */
export type AlertLevel = 0 | 1 | 2;

export function alertLevel(c: Cost, alertAt = DEFAULT_ALERT_AT): AlertLevel {
  if (!c.budgeted) return 0;
  if (c.spent > c.budget) return 2;
  // Nearly spent is only news while there's still work to pay for.
  if (!c.settled && c.budget > 0 && c.spent >= (c.budget * alertAt) / 100) return 1;
  return 0;
}

export interface BudgetAlert {
  kind: 'item' | 'step' | 'level' | 'world';
  title: string;
  level: 1 | 2;
  cost: Cost;
}

/**
 * What an edit pushed past the heads-up point or over budget, comparing a
 * project before and after it: items and steps first, then their level and
 * world. Only things that got worse count, so a second receipt on something
 * already over doesn't alert again. Unchanged worlds and levels are skipped
 * by reference (ops are copy-on-write).
 */
export function budgetAlerts(before: GameState, after: GameState, alertAt = DEFAULT_ALERT_AT): BudgetAlert[] {
  const items: BudgetAlert[] = [];
  const containers: BudgetAlert[] = [];
  const check = (out: BudgetAlert[], kind: BudgetAlert['kind'], title: string, prev: Cost | undefined, next: Cost) => {
    const level = alertLevel(next, alertAt);
    if (level > (prev ? alertLevel(prev, alertAt) : 0)) out.push({ kind, title, level: level as 1 | 2, cost: next });
  };
  for (const [wid, world] of Object.entries(after.worlds)) {
    const oldWorld = before.worlds[wid];
    if (world === oldWorld) continue;
    for (const lvl of world.levels) {
      const oldLevel = oldWorld?.levels.find((l) => l.id === lvl.id);
      if (lvl === oldLevel) continue;
      for (const item of lvl.items) {
        const oldItem = oldLevel?.items.find((i) => i.id === item.id);
        for (const step of item.subtasks ?? []) {
          const oldStep = oldItem?.subtasks?.find((x) => x.id === step.id);
          check(items, 'step', step.title, oldStep && itemCost(oldStep), itemCost(step));
        }
        check(items, 'item', item.title, oldItem && itemCost(oldItem), itemCost(item));
      }
      check(containers, 'level', lvl.name, oldLevel && levelCost(oldLevel), levelCost(lvl));
    }
    check(containers, 'world', world.name, oldWorld && worldCost(oldWorld), worldCost(world));
  }
  return [...items, ...containers];
}

/** "Over budget: Tiling is at £520 of £450." / "Heads-up: Tiling has used 92% of its £450." */
export function alertText(a: BudgetAlert, currency = DEFAULT_CURRENCY): string {
  const m = (n: number) => formatMoney(n, currency);
  if (a.level === 2) return `Over budget: ${a.title} is at ${m(a.cost.spent)} of ${m(a.cost.budget)}.`;
  return `Heads-up: ${a.title} has used ${Math.floor((100 * a.cost.spent) / a.cost.budget)}% of its ${m(a.cost.budget)}.`;
}

/**
 * A warning for panels when the money needs a look: over budget, past the
 * heads-up point (when `alertAt` is given), or the parts below plan more than it.
 */
export function costNote(c: Cost, currency = DEFAULT_CURRENCY, alertAt?: number): { tone: 'warn' | 'alert'; text: string } | undefined {
  const m = (n: number) => formatMoney(Math.abs(n), currency);
  if (c.budgeted && c.left < 0) return { tone: 'alert', text: `Over budget by ${m(c.left)}. Anything optional you could drop?` };
  if (alertAt !== undefined && alertLevel(c, alertAt) === 1)
    return { tone: 'warn', text: `${Math.floor((100 * c.spent) / c.budget)}% of the budget spent, ${m(c.left)} left. Keep an eye on it.` };
  if (c.capped && c.planned > c.budget)
    return { tone: 'warn', text: `The parts below plan ${m(c.planned)}: ${m(c.planned - c.budget)} more than the budget.` };
  return undefined;
}

/** "£" for GBP, "€" for EUR; the code itself when there's no symbol. */
export function currencySymbol(currency = DEFAULT_CURRENCY): string {
  try {
    const parts = new Intl.NumberFormat('en-GB', { style: 'currency', currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}
