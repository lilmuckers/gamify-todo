import type { GameState, Level, Workspace } from '../src/model';

export function level(overrides: Partial<Level> = {}): Level {
  return {
    id: 'lvl',
    name: 'Level',
    deliverable: 'A thing',
    timeboxDays: 10,
    successCriteria: [
      { id: 'mvp-1', text: 'Works', mvp: true, done: false },
      { id: 'bonus', text: 'Pretty', mvp: false, done: false },
    ],
    items: [
      { id: 'a', type: 'task', title: 'A', status: 'todo' },
      { id: 'b', type: 'blocker', title: 'B', status: 'todo', dependsOn: ['a'] },
      { id: 'c', type: 'stretch', title: 'C', status: 'todo' },
    ],
    ...overrides,
  };
}

/** One project, id "p", with one world "w" holding `lvl`. */
export function state(lvl: Level = level()): GameState {
  return {
    overworld: { id: 'p', title: 'T', goals: [{ id: 'g', title: 'Goal' }], worldOrder: ['w'] },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels: [lvl] } },
  };
}

export function workspace(lvl: Level = level()): Workspace {
  return { projects: { p: state(lvl) } };
}

/** Address of the fixture level, for ops. */
export const at = { projectId: 'p', worldId: 'w', levelId: 'lvl' };

export const lvlOf = (ws: Workspace) => ws.projects.p.worlds.w.levels[0];
