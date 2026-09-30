import type { GameState, Level } from '../src/model';

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

export function state(lvl: Level = level()): GameState {
  return {
    overworld: { title: 'T', goals: [{ id: 'g', title: 'Goal' }], worldOrder: ['w'] },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels: [lvl] } },
  };
}
