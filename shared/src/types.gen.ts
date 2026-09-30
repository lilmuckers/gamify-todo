/* eslint-disable */
// GENERATED from schema/quest.schema.json by `npm run schema:gen`. Do not edit.

/**
 * Data format for Quest Log, a project tracker shown as a side-scrolling platformer game. A project is an Overworld (data/game.json) made of Worlds (data/worlds/<world-id>.json). Each World holds Levels. Each Level is ONE key deliverable with success criteria and the project items (tasks, blockers, dependencies, risks...) needed to ship it. Design principle: 'good enough' beats perfect. Keep MVP criteria minimal; put nice-to-haves in 'stretch' items or non-MVP criteria.
 */
export type QuestLogData = Overworld | World;
/**
 * Short human-readable name. Imperative for tasks ('Write API docs'), noun phrase for deliverables ('Public beta').
 */
export type Title = string;
/**
 * Optional free-text detail. Markdown allowed.
 */
export type Notes = string;
/**
 * Stable identifier in lowercase kebab-case (letters, digits, single hyphens). Unique within its scope: world ids across the project, level ids within a world, item and criterion ids within a level. Never reuse or rename once created.
 */
export type Id = string;
/**
 * Visual theme of a world. Pick one matching the world's topic mood.
 */
export type Theme = "grass" | "desert" | "water" | "ice" | "sky" | "castle";
/**
 * What kind of project item this is. Determines how it looks and behaves in the level.
 */
export type ItemType = "task" | "deliverable" | "blocker" | "dependency" | "risk" | "decision" | "stretch";
/**
 * Current state of an item.
 */
export type Status = "todo" | "doing" | "done" | "dropped";

/**
 * Top-level project file, stored at data/game.json. Lists the project goals and the order worlds appear on the map.
 */
export interface Overworld {
  /**
   * Pointer to this schema for editor tooling.
   */
  $schema?: string;
  title: Title;
  description?: Notes;
  /**
   * Key project goals. Keep to 1-5.
   *
   * @maxItems 20
   */
  goals: Goal[];
  /**
   * World ids in the order they appear on the Overworld path. Every file in data/worlds/ must be listed here, and every id here must have a file data/worlds/<id>.json.
   */
  worldOrder: Id[];
}
/**
 * A key project goal shown on the Overworld. Worlds reference goals they contribute to.
 */
export interface Goal {
  id: Id;
  title: Title;
  description?: Notes;
}
/**
 * A themed group of levels, stored at data/worlds/<id>.json. A world has one key theme or topic (e.g. 'Payments', 'Onboarding').
 */
export interface World {
  /**
   * Pointer to this schema for editor tooling.
   */
  $schema?: string;
  id: Id;
  name: Title;
  description?: Notes;
  theme: Theme;
  /**
   * Ids of Overworld goals this world contributes to.
   */
  goalIds: Id[];
  /**
   * Optional ids of other worlds that should be cleared first. Purely visual (world is shown locked), never prevents editing.
   */
  unlocksAfter?: Id[];
  /**
   * Levels in play order. Each level = one key deliverable.
   *
   * @maxItems 50
   */
  levels: Level[];
}
/**
 * One key deliverable. The level is CLEARED when every MVP success criterion is done. Keep MVP criteria to the minimum that makes the deliverable useful.
 */
export interface Level {
  id: Id;
  name: Title;
  /**
   * One sentence: what exists when this level is cleared.
   */
  deliverable: string;
  description?: Notes;
  /**
   * Time budget in days, counted from startedAt. Finishing early earns bonus XP; running over costs a star.
   */
  timeboxDays: number;
  /**
   * When work began. Set automatically when the first item moves to doing/done. Omit for levels not yet started.
   */
  startedAt?: string;
  /**
   * When all MVP criteria were first done. Set automatically. Omit for uncleared levels.
   */
  clearedAt?: string;
  /**
   * Checks that decide the level is done. At least one must have mvp=true. MVP criteria raise the flagpole; non-MVP criteria are bonus coins.
   *
   * @minItems 1
   * @maxItems 20
   */
  successCriteria: Criterion[];
  /**
   * Project items placed along the level, left to right by dependency order.
   *
   * @maxItems 200
   */
  items: Item[];
  stats?: LevelStats;
}
/**
 * A success criterion: an observable check that the deliverable is good enough.
 */
export interface Criterion {
  id: Id;
  /**
   * Observable, testable statement.
   */
  text: string;
  /**
   * true = required to clear the level. false = nice-to-have bonus.
   */
  mvp: boolean;
  /**
   * Whether the criterion is currently met.
   */
  done: boolean;
}
/**
 * A project item placed in a level.
 */
export interface Item {
  id: Id;
  type: ItemType;
  title: Title;
  status: Status;
  /**
   * true (default) = on the critical path: the hero stops here until it is done or dropped. false = optional. Ignored for 'stretch' (never MVP).
   */
  mvp?: boolean;
  /**
   * Ids of other items IN THE SAME LEVEL that must come first. Determines left-to-right placement. Must not form cycles.
   */
  dependsOn?: Id[];
  /**
   * For dependency items: another level this depends on, as '<world-id>/<level-id>'. Rendered as a warp pipe to that level.
   */
  levelRef?: string;
  /**
   * Optional URL to a ticket, doc or PR.
   */
  link?: string;
  notes?: Notes;
}
/**
 * Anti-perfectionism counters. Maintained automatically by the app; tools generating data should omit this.
 */
export interface LevelStats {
  /**
   * Edits made to the level after it was cleared.
   */
  editsAfterClear?: number;
  /**
   * Items added after the level was cleared (scope creep).
   */
  itemsAddedAfterClear?: number;
  /**
   * Map of item id to number of edits made after that item was done.
   */
  itemEdits?: {
    [k: string]: number;
  };
}
