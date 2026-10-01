/* eslint-disable */
// GENERATED from schema/quest.schema.json by `npm run schema:gen`. Do not edit.

/**
 * Data format for Quest Log, a project tracker shown as a side-scrolling platformer game. Data lives in a folder tree under data/: one folder per PROJECT (completely unrelated efforts, e.g. 'house-renovation' vs 'work-launch'), holding project.json; one sub-folder per WORLD (a theme within the project) holding world.json; and one file per LEVEL (one key deliverable) in the world folder, named <level-id>.json. Paths: data/<project-id>/project.json, data/<project-id>/<world-id>/world.json, data/<project-id>/<world-id>/<level-id>.json. An optional data/settings.json holds repo-wide display settings. Folder and file names must equal the ids inside. Design principle: 'good enough' beats perfect. Keep MVP criteria minimal; put nice-to-haves in 'stretch' items or non-MVP criteria.
 */
export type QuestLogData = Project | World | Level | Settings;
/**
 * Short human-readable name. Imperative for tasks ('Write API docs'), noun phrase for deliverables ('Public beta').
 */
export type Title = string;
/**
 * Optional free-text detail. Markdown allowed.
 */
export type Notes = string;
/**
 * Stable identifier in lowercase kebab-case (letters, digits, single hyphens). Also used as folder/file names. Unique within its scope: projects across the repo, worlds within a project, levels within a world, items and criteria within a level. Never reuse or rename once created.
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
 * Item types allowed inside a dependency's sub-level: any type except 'dependency' (sub-levels don't nest).
 */
export type SubtaskType = "task" | "deliverable" | "blocker" | "risk" | "decision" | "stretch";

/**
 * A project: one self-contained effort, stored at data/<project-id>/project.json. Its map (the overworld) shows its key goals and its worlds in order. Projects never reference each other.
 */
export interface Project {
  /**
   * Pointer to this schema for editor tooling.
   */
  $schema?: string;
  /**
   * Project id. Must equal the project folder name: data/<id>/project.json.
   */
  id: string;
  title: Title;
  description?: Notes;
  /**
   * Key project goals. Keep to 1-5.
   *
   * @maxItems 20
   */
  goals: Goal[];
  /**
   * World ids in the order they appear on the overworld path. Every world folder data/<project-id>/<world-id>/ must be listed here, and every id here must have data/<project-id>/<world-id>/world.json.
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
 * A themed group of levels inside a project (e.g. 'Kitchen', 'Payments'), stored at data/<project-id>/<world-id>/world.json. Its levels are separate files in the same folder.
 */
export interface World {
  /**
   * Pointer to this schema for editor tooling.
   */
  $schema?: string;
  /**
   * Stable identifier in lowercase kebab-case (letters, digits, single hyphens). Also used as folder/file names. Unique within its scope: projects across the repo, worlds within a project, levels within a world, items and criteria within a level. Never reuse or rename once created.
   */
  id: string;
  name: Title;
  description?: Notes;
  theme: Theme;
  /**
   * Ids of goals in this project's project.json that this world contributes to.
   */
  goalIds: Id[];
  /**
   * Optional ids of other worlds IN THE SAME PROJECT that should be cleared first. Purely visual (world is shown locked), never prevents editing.
   */
  unlocksAfter?: Id[];
  /**
   * Level ids in play order. Each id must have a file data/<project-id>/<world-id>/<level-id>.json, and every level file in the folder must be listed here.
   *
   * @maxItems 50
   */
  levelOrder: Id[];
}
/**
 * One key deliverable, stored at data/<project-id>/<world-id>/<level-id>.json. The level is CLEARED when every MVP success criterion is done. Keep MVP criteria to the minimum that makes the deliverable useful.
 */
export interface Level {
  /**
   * Pointer to this schema for editor tooling.
   */
  $schema?: string;
  /**
   * Stable identifier in lowercase kebab-case (letters, digits, single hyphens). Also used as folder/file names. Unique within its scope: projects across the repo, worlds within a project, levels within a world, items and criteria within a level. Never reuse or rename once created.
   */
  id: string;
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
   * Ids of other items IN THE SAME LEVEL FILE that must come first. Determines left-to-right placement. Must not form cycles.
   */
  dependsOn?: Id[];
  /**
   * For dependency items: another level IN THE SAME PROJECT this depends on, as '<world-id>/<level-id>'. Rendered as a cloud that carries the hero to that level. Don't combine with 'subtasks'.
   */
  levelRef?: string;
  /**
   * For dependency items: the steps needed to get it, when you have to chase it yourself. Rendered as a warp pipe down into a bonus sub-level holding these; clearing them brings the hero back up. Don't combine with 'levelRef'. Omit when the dependency is just something to wait for.
   *
   * @maxItems 100
   */
  subtasks?: Subtask[];
  /**
   * Optional URL to a ticket, doc or PR.
   */
  link?: string;
  notes?: Notes;
}
/**
 * A step inside a dependency's sub-level. Like an item, but it can't be a dependency itself.
 */
export interface Subtask {
  /**
   * Stable identifier in lowercase kebab-case (letters, digits, single hyphens). Also used as folder/file names. Unique within its scope: projects across the repo, worlds within a project, levels within a world, items and criteria within a level. Never reuse or rename once created.
   */
  id: string;
  type: SubtaskType;
  title: Title;
  status: Status;
  /**
   * true (default) = needed to close the dependency. false = optional. Ignored for 'stretch'.
   */
  mvp?: boolean;
  /**
   * Ids of OTHER SUBTASKS OF THE SAME DEPENDENCY that must come first. Must not form cycles.
   */
  dependsOn?: Id[];
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
/**
 * Repo-wide display settings, stored at data/settings.json. Optional: without it the app uses its defaults.
 */
export interface Settings {
  /**
   * Optional pointer to this schema, for editor autocompletion.
   */
  $schema?: string;
  /**
   * Default player character for everyone viewing this repo. A viewer's own choice (saved in their browser) wins in read-only mode.
   */
  hero?: "classic" | "bearded" | "redhead" | "mustard-jumper" | "denim-jacket" | "hoodie";
}
