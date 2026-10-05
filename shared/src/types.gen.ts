/* eslint-disable */
// GENERATED from schema/quest.schema.json by `npm run schema:gen`. Do not edit.

/**
 * Data format for Quest Log, a project tracker shown as a side-scrolling platformer game. Data lives in a folder tree under data/: one folder per PROJECT (completely unrelated efforts, e.g. 'house-renovation' vs 'work-launch'), holding project.json; one sub-folder per WORLD (a theme within the project) holding world.json; and one file per LEVEL (one key deliverable) in the world folder, named <level-id>.json. Paths: data/<project-id>/project.json, data/<project-id>/<world-id>/world.json, data/<project-id>/<world-id>/<level-id>.json. An optional data/settings.json holds repo-wide display settings, and an optional data/inbox.json holds captured ideas not yet placed in a level. Folder and file names must equal the ids inside. Design principle: 'good enough' beats perfect. Keep MVP criteria minimal; put nice-to-haves in 'stretch' items or non-MVP criteria.
 */
export type QuestLogData = Project | World | Level | Settings | Inbox;
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
  budgets?: BudgetSettings;
  /**
   * Key project goals. Keep to 1-5.
   *
   * @maxItems 20
   */
  goals: Goal[];
  /**
   * World ids in the order they appear on the overworld path. Every id here must have data/<project-id>/<world-id>/world.json. Worlds left out still count: they go after the listed ones, sorted by id, and the app adds them here on its next save. So to add a world, just create its world.json; only edit this list to change the order (editing it is what makes two pull requests conflict).
   */
  worldOrder: Id[];
}
/**
 * Turns on cash budgets for this project. Omit it and the app hides every budget, cost and alert, even if items carry 'budget' or 'spent' (they are kept for when it's turned back on).
 */
export interface BudgetSettings {
  /**
   * Currency for every budget and cost in this project. Omit for GBP.
   */
  currency?: string;
  /**
   * true (default) = alert when a logged cost takes an item, step, level or world past alertAt or over its budget. false = no alerts; budgets still show.
   */
  alerts?: boolean;
  /**
   * Percentage of a budget that, once spent, gives a heads-up alert (default 90). Going over the budget always alerts while alerts are on.
   */
  alertAt?: number;
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
   * Optional cash allowance for the whole world. Without it, the world's budget is the sum of its levels' budgets. What's left is banked as savings once every level is cleared.
   */
  budget?: number;
  /**
   * Level ids in play order. Each id must have a file data/<project-id>/<world-id>/<level-id>.json. Level files left out still count: they go after the listed ones, sorted by id, and the app adds them here on its next save. So to add a level, just create its file; only edit this list to change the order (editing it is what makes two pull requests conflict).
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
   * true = parked on the someday shelf (from the weekly review): the level isn't being worked on, so it drops out of Today, the review's overdue/stale lists and 'next level' suggestions. Parking clears startedAt, so the time-box starts afresh when work resumes; marking an item doing/done or ticking a criterion unparks it. Omit when false.
   */
  someday?: boolean;
  /**
   * Optional cash allowance for this level. Without it, the level's budget is the sum of its items' budgets. Whatever is left when the level clears is banked as savings.
   */
  budget?: number;
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
  /**
   * When this criterion was last ticked. Set automatically when done becomes true and removed when it is un-ticked. Feeds the stats page's progress calendar and streaks. Optional: older data won't have it.
   */
  doneAt?: string;
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
   * When this item was last marked done. Set automatically when status becomes 'done' and removed when it changes away from done. Feeds the weekly review's "shipped this week". Optional: older data won't have it.
   */
  doneAt?: string;
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
   * Optional estimated cost: the cash set aside for this item. For a dependency with subtasks, it replaces the sum of its steps' budgets. Savings (budget minus spent) are banked when it is done or dropped, so dropping it banks whatever wasn't spent.
   */
  budget?: number;
  /**
   * Optional cash actually spent on this item so far. Fill it in as receipts come in, before or after it is done. For a dependency, it adds to whatever its steps spent.
   */
  spent?: number;
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
   * When this step was last marked done. Set automatically when status becomes 'done' and removed when it changes away from done. Feeds the weekly review's "shipped this week". Optional: older data won't have it.
   */
  doneAt?: string;
  /**
   * true (default) = needed to close the dependency. false = optional. Ignored for 'stretch'.
   */
  mvp?: boolean;
  /**
   * Ids of OTHER SUBTASKS OF THE SAME DEPENDENCY that must come first. Must not form cycles.
   */
  dependsOn?: Id[];
  /**
   * Optional estimated cost of this step. Adds up into the dependency's budget unless the dependency sets its own.
   */
  budget?: number;
  /**
   * Optional cash actually spent on this step so far.
   */
  spent?: number;
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
   * Map of item id (or dependency/step for a sub-level step) to number of edits made after that item was done.
   */
  itemEdits?: {
    [k: string]: number;
  };
  /**
   * Days added to timeboxDays after the level started (the weekly review's 'extend the time-box'). The in-time star and the time bonus are still scored against the original time-box (timeboxDays minus this).
   */
  timeboxExtendedDays?: number;
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
  hero?:
    | "classic"
    | "bearded"
    | "redhead"
    | "mustard-jumper"
    | "denim-jacket"
    | "hoodie"
    | "emo"
    | "goth"
    | "punk"
    | "rainbow-tee"
    | "trans-flag-hair"
    | "trans-pin"
    | "bi-bomber"
    | "drag-glam"
    | "nb-beanie"
    | "hijab-skater"
    | "silver-locs"
    | "flannel";
}
/**
 * Repo-wide inbox of captured ideas, stored at data/inbox.json (optional). Items move out of here when they are placed in a level.
 */
export interface Inbox {
  /**
   * Optional pointer to this schema, for editor autocompletion.
   */
  $schema?: string;
  /**
   * @maxItems 500
   */
  items: InboxItem[];
}
/**
 * A captured idea waiting to be placed in a level. Only the basics: placing it in a level turns it into a full item.
 */
export interface InboxItem {
  /**
   * Stable identifier in lowercase kebab-case (letters, digits, single hyphens). Also used as folder/file names. Unique within its scope: projects across the repo, worlds within a project, levels within a world, items and criteria within a level. Never reuse or rename once created.
   */
  id: string;
  type: ItemType;
  title: Title;
  notes?: Notes;
  /**
   * Optional URL (e.g. something shared to the app).
   */
  link?: string;
  /**
   * When it was captured.
   */
  addedAt?: string;
}
