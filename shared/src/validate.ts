import { validateInbox, validateLevel, validateProject, validateSettings, validateWorld } from './validators.gen.js';
import type { GameState, Level, Workspace } from './model';
import { parseLevelRef } from './model';
import { classifyPath, DATA_ROOT, fromFiles, levelPath, projectPath, toFiles, worldPath } from './serialize';

export interface Issue {
  /** Repo file the issue is in. */
  file: string;
  /** JSON pointer-ish location inside the file. */
  path: string;
  message: string;
}

type Compiled = typeof validateWorld;
const VALIDATORS: Record<'project' | 'world' | 'level' | 'settings' | 'inbox', Compiled> = {
  project: validateProject,
  world: validateWorld,
  level: validateLevel,
  settings: validateSettings,
  inbox: validateInbox,
};

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
export function findCycle(level: Pick<Level, 'items'>): string[] | undefined {
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

/** Rules JSON Schema cannot express, within one project: references, uniqueness, cycles. */
export function semanticIssues(projectId: string, state: GameState): Issue[] {
  const issues: Issue[] = [];
  const { overworld, worlds } = state;
  const pfile = projectPath(projectId);

  for (const id of duplicates(overworld.goals.map((g) => g.id)))
    issues.push({ file: pfile, path: '/goals', message: `duplicate goal id "${id}"` });
  const goalIds = new Set(overworld.goals.map((g) => g.id));

  for (const [key, world] of Object.entries(worlds)) {
    const file = worldPath(projectId, key);
    world.goalIds.forEach((g, i) => {
      if (!goalIds.has(g)) issues.push({ file, path: `/goalIds/${i}`, message: `unknown goal "${g}"` });
    });
    (world.unlocksAfter ?? []).forEach((w, i) => {
      if (w === key || !worlds[w])
        issues.push({ file, path: `/unlocksAfter/${i}`, message: `invalid world reference "${w}"` });
    });
    for (const id of duplicates(world.levels.map((l) => l.id)))
      issues.push({ file, path: '/levelOrder', message: `duplicate level id "${id}"` });

    for (const level of world.levels) {
      const lfile = levelPath(projectId, key, level.id);
      if (level.id === 'world') issues.push({ file: lfile, path: '/id', message: '"world" is reserved' });
      const itemIds = new Set(level.items.map((i) => i.id));
      for (const id of duplicates(level.items.map((i) => i.id)))
        issues.push({ file: lfile, path: '/items', message: `duplicate item id "${id}"` });
      for (const id of duplicates(level.successCriteria.map((c) => c.id)))
        issues.push({ file: lfile, path: '/successCriteria', message: `duplicate criterion id "${id}"` });
      if (!level.successCriteria.some((c) => c.mvp))
        issues.push({ file: lfile, path: '/successCriteria', message: 'at least one criterion must have mvp: true' });
      level.items.forEach((item, ii) => {
        const ip = `/items/${ii}`;
        (item.dependsOn ?? []).forEach((d, di) => {
          if (d === item.id) issues.push({ file: lfile, path: `${ip}/dependsOn/${di}`, message: 'item depends on itself' });
          else if (!itemIds.has(d))
            issues.push({ file: lfile, path: `${ip}/dependsOn/${di}`, message: `unknown item "${d}"` });
        });
        if (item.levelRef) {
          const ref = parseLevelRef(item.levelRef);
          const target = ref && worlds[ref.worldId]?.levels.some((l) => l.id === ref.levelId);
          if (!target) issues.push({ file: lfile, path: `${ip}/levelRef`, message: `unknown level "${item.levelRef}" in this project` });
          else if (ref.worldId === key && ref.levelId === level.id)
            issues.push({ file: lfile, path: `${ip}/levelRef`, message: 'a level cannot depend on itself' });
        }
        if (item.subtasks) {
          if (item.type !== 'dependency')
            issues.push({ file: lfile, path: `${ip}/subtasks`, message: 'only dependency items can have subtasks' });
          if (item.levelRef)
            issues.push({ file: lfile, path: `${ip}/subtasks`, message: 'use levelRef or subtasks, not both' });
          const subIds = new Set(item.subtasks.map((s) => s.id));
          for (const id of duplicates(item.subtasks.map((s) => s.id)))
            issues.push({ file: lfile, path: `${ip}/subtasks`, message: `duplicate subtask id "${id}"` });
          item.subtasks.forEach((sub, si) =>
            (sub.dependsOn ?? []).forEach((d, di) => {
              const sp = `${ip}/subtasks/${si}/dependsOn/${di}`;
              if (d === sub.id) issues.push({ file: lfile, path: sp, message: 'subtask depends on itself' });
              else if (!subIds.has(d)) issues.push({ file: lfile, path: sp, message: `unknown subtask "${d}"` });
            }),
          );
          const subCycle = findCycle({ items: item.subtasks as Level['items'] });
          if (subCycle)
            issues.push({ file: lfile, path: `${ip}/subtasks`, message: `dependency cycle: ${subCycle.join(' → ')}` });
        }
      });
      const cycle = findCycle(level);
      if (cycle) issues.push({ file: lfile, path: '/items', message: `dependency cycle: ${cycle.join(' → ')}` });
    }
  }
  return issues;
}

/**
 * Full validation of a data tree: JSON syntax, schema per file type, folder
 * structure (ids match paths, order lists match files), then semantic rules.
 */
export function validateFiles(files: Record<string, string>): Issue[] {
  const issues: Issue[] = [];
  const parsed: Record<string, unknown> = {};
  const projects = new Set<string>();
  const worlds = new Map<string, Set<string>>(); // project → world ids with world.json
  const levels = new Map<string, Set<string>>(); // "p/w" → level ids with files

  for (const [path, text] of Object.entries(files)) {
    const f = classifyPath(path);
    if (!f) {
      if (path.startsWith(`${DATA_ROOT}/`) && path.endsWith('.json'))
        issues.push({ file: path, path: '/', message: `unexpected file: use ${DATA_ROOT}/<project>/project.json, ${DATA_ROOT}/<project>/<world>/world.json, ${DATA_ROOT}/<project>/<world>/<level>.json, ${DATA_ROOT}/settings.json or ${DATA_ROOT}/inbox.json` });
      continue;
    }
    try {
      parsed[path] = JSON.parse(text);
    } catch (err) {
      issues.push({ file: path, path: '/', message: `invalid JSON: ${(err as Error).message}` });
      continue;
    }
    const data = parsed[path] as { id?: unknown };
    issues.push(...schemaIssues(VALIDATORS[f.kind], data, path));
    if (f.kind === 'settings') continue;
    if (f.kind === 'inbox') {
      const items = (data as { items?: { id?: string }[] }).items;
      if (Array.isArray(items))
        for (const id of duplicates(items.map((i) => String(i?.id))))
          issues.push({ file: path, path: '/items', message: `duplicate inbox item id "${id}"` });
      continue;
    }
    const expected = f.kind === 'project' ? f.projectId : f.kind === 'world' ? f.worldId : f.levelId;
    if (data && typeof data === 'object' && data.id !== expected)
      issues.push({ file: path, path: '/id', message: `id "${String(data.id)}" must match its ${f.kind === 'project' ? 'folder' : f.kind === 'world' ? 'folder' : 'file name'} "${expected}"` });
    if (f.kind === 'project') projects.add(f.projectId);
    if (f.kind === 'world') (worlds.get(f.projectId) ?? worlds.set(f.projectId, new Set()).get(f.projectId)!).add(f.worldId);
    if (f.kind === 'level') {
      const key = `${f.projectId}/${f.worldId}`;
      (levels.get(key) ?? levels.set(key, new Set()).get(key)!).add(f.levelId);
    }
  }

  // Structure: every file hangs off a parent, and order lists match what exists.
  for (const [pid, ws] of worlds)
    if (!projects.has(pid))
      for (const wid of ws) issues.push({ file: worldPath(pid, wid), path: '/', message: `no ${projectPath(pid)} for this world` });
  for (const [key, ls] of levels) {
    const [pid, wid] = key.split('/');
    if (!worlds.get(pid)?.has(wid))
      for (const lid of ls) issues.push({ file: levelPath(pid, wid, lid), path: '/', message: `no ${worldPath(pid, wid)} for this level` });
  }
  for (const pid of projects) {
    const p = parsed[projectPath(pid)] as { worldOrder?: unknown };
    const order = Array.isArray(p?.worldOrder) ? (p.worldOrder as string[]) : [];
    const present = worlds.get(pid) ?? new Set();
    order.forEach((wid, i) => {
      if (!present.has(wid)) issues.push({ file: projectPath(pid), path: `/worldOrder/${i}`, message: `no ${worldPath(pid, wid)}` });
    });
    for (const wid of present)
      if (!order.includes(wid)) issues.push({ file: projectPath(pid), path: '/worldOrder', message: `world "${wid}" missing from worldOrder` });
    for (const wid of present) {
      const w = parsed[worldPath(pid, wid)] as { levelOrder?: unknown };
      const lorder = Array.isArray(w?.levelOrder) ? (w.levelOrder as string[]) : [];
      const lpresent = levels.get(`${pid}/${wid}`) ?? new Set();
      lorder.forEach((lid, i) => {
        if (!lpresent.has(lid)) issues.push({ file: worldPath(pid, wid), path: `/levelOrder/${i}`, message: `no ${levelPath(pid, wid, lid)}` });
      });
      for (const lid of lpresent)
        if (!lorder.includes(lid)) issues.push({ file: worldPath(pid, wid), path: '/levelOrder', message: `level "${lid}" missing from levelOrder` });
    }
  }

  // Semantic checks assume structurally valid data.
  if (issues.length) return issues;
  const ws = fromFiles(files);
  for (const [pid, state] of Object.entries(ws.projects)) issues.push(...semanticIssues(pid, state));
  return issues;
}

export function validateWorkspace(ws: Workspace): Issue[] {
  // A level called "world" would overwrite world.json when serialized.
  for (const [pid, state] of Object.entries(ws.projects))
    for (const [wid, w] of Object.entries(state.worlds))
      if (w.levels.some((l) => l.id === 'world'))
        return [{ file: worldPath(pid, wid), path: '/levelOrder', message: 'level id "world" is reserved' }];
  const issues = validateFiles(toFiles(ws));
  // In memory, a project/world/level could be keyed differently from its id.
  for (const [pid, state] of Object.entries(ws.projects)) {
    if (state.overworld.id !== pid)
      issues.push({ file: projectPath(pid), path: '/id', message: `id "${state.overworld.id}" must match folder "${pid}"` });
    for (const [wid, w] of Object.entries(state.worlds))
      if (w.id !== wid) issues.push({ file: worldPath(pid, wid), path: '/id', message: `id "${w.id}" must match folder "${wid}"` });
  }
  return issues;
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.file}${i.path}: ${i.message}`).join('\n');
}
