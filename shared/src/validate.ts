import { validateOverworld, validateWorld } from './validators.gen.js';
import type { GameState, Level } from './model';
import { parseLevelRef } from './model';
import { GAME_PATH, worldPath } from './serialize';

export interface Issue {
  /** Repo file the issue is in. */
  file: string;
  /** JSON pointer-ish location inside the file. */
  path: string;
  message: string;
}

type Compiled = typeof validateWorld;

function schemaIssues(fn: Compiled, data: unknown, file: string): Issue[] {
  if (fn(data)) return [];
  return (fn.errors ?? []).map((e) => ({
    file,
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params && 'allowedValue' in e.params ? ` (${e.params.allowedValue})` : ''}${e.params && 'additionalProperty' in e.params ? `: ${e.params.additionalProperty}` : ''}`,
  }));
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/** Returns ids involved in a dependsOn cycle, if any. */
export function findCycle(level: Level): string[] | undefined {
  const deps = new Map(level.items.map((i) => [i.id, i.dependsOn ?? []]));
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) return stack.slice(stack.indexOf(id)).concat(id);
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      const cycle = visit(d);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of deps.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
}

/** Rules JSON Schema cannot express: references, uniqueness, cycles. */
export function semanticIssues(state: GameState): Issue[] {
  const issues: Issue[] = [];
  const { overworld, worlds } = state;

  for (const id of duplicates(overworld.goals.map((g) => g.id)))
    issues.push({ file: GAME_PATH, path: '/goals', message: `duplicate goal id "${id}"` });
  const goalIds = new Set(overworld.goals.map((g) => g.id));

  overworld.worldOrder.forEach((id, i) => {
    if (!worlds[id])
      issues.push({ file: GAME_PATH, path: `/worldOrder/${i}`, message: `no world file for "${id}"` });
  });

  for (const [key, world] of Object.entries(worlds)) {
    const file = worldPath(key);
    if (world.id !== key)
      issues.push({ file, path: '/id', message: `id "${world.id}" must match file name "${key}"` });
    if (!overworld.worldOrder.includes(key))
      issues.push({ file: GAME_PATH, path: '/worldOrder', message: `world "${key}" missing from worldOrder` });
    world.goalIds.forEach((g, i) => {
      if (!goalIds.has(g))
        issues.push({ file, path: `/goalIds/${i}`, message: `unknown goal "${g}"` });
    });
    (world.unlocksAfter ?? []).forEach((w, i) => {
      if (w === key || !worlds[w])
        issues.push({ file, path: `/unlocksAfter/${i}`, message: `invalid world reference "${w}"` });
    });
    for (const id of duplicates(world.levels.map((l) => l.id)))
      issues.push({ file, path: '/levels', message: `duplicate level id "${id}"` });

    world.levels.forEach((level, li) => {
      const lp = `/levels/${li}`;
      const itemIds = new Set(level.items.map((i) => i.id));
      for (const id of duplicates(level.items.map((i) => i.id)))
        issues.push({ file, path: `${lp}/items`, message: `duplicate item id "${id}"` });
      for (const id of duplicates(level.successCriteria.map((c) => c.id)))
        issues.push({ file, path: `${lp}/successCriteria`, message: `duplicate criterion id "${id}"` });
      if (!level.successCriteria.some((c) => c.mvp))
        issues.push({
          file,
          path: `${lp}/successCriteria`,
          message: 'at least one criterion must have mvp: true',
        });
      level.items.forEach((item, ii) => {
        const ip = `${lp}/items/${ii}`;
        (item.dependsOn ?? []).forEach((d, di) => {
          if (d === item.id)
            issues.push({ file, path: `${ip}/dependsOn/${di}`, message: 'item depends on itself' });
          else if (!itemIds.has(d))
            issues.push({ file, path: `${ip}/dependsOn/${di}`, message: `unknown item "${d}"` });
        });
        if (item.levelRef) {
          const ref = parseLevelRef(item.levelRef);
          const target = ref && worlds[ref.worldId]?.levels.some((l) => l.id === ref.levelId);
          if (!target)
            issues.push({ file, path: `${ip}/levelRef`, message: `unknown level "${item.levelRef}"` });
        }
      });
      const cycle = findCycle(level);
      if (cycle)
        issues.push({ file, path: `${lp}/items`, message: `dependency cycle: ${cycle.join(' → ')}` });
    });
  }
  return issues;
}

export function validateState(state: GameState): Issue[] {
  const issues = schemaIssues(validateOverworld, state.overworld, GAME_PATH);
  for (const [key, world] of Object.entries(state.worlds))
    issues.push(...schemaIssues(validateWorld, world, worldPath(key)));
  // Semantic checks assume structurally valid data.
  if (issues.length) return issues;
  return semanticIssues(state);
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.file}${i.path}: ${i.message}`).join('\n');
}
