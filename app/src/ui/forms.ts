import {
  budgetPrefs,
  currencySymbol,
  DEFAULT_ALERT_AT,
  DEFAULT_CURRENCY,
  ITEM_TYPES,
  layoutLevel,
  STATUSES,
  THEMES,
  orderedWorlds,
  roundMoney,
  uniqueId,
  type Criterion,
  type Goal,
  type Item,
  type ItemType,
  type BudgetPrefs,
  type Level,
  type World,
} from '@quest/shared';
import { itemAddr, type App, type LevelView } from '../app';
import { go } from '../router';
import { h } from './dom';
import { confirmDialog, openModal, type ModalAction } from './modal';

export const TYPE_INFO: Record<ItemType, { label: string; sprite: string; hint: string }> = {
  task: { label: 'Task', sprite: 'qblock', hint: 'Work you do. A ? block; done pops a coin.' },
  deliverable: { label: 'Deliverable', sprite: 'flag', hint: 'Milestone inside the level. A checkpoint flag.' },
  blocker: { label: 'Blocker', sprite: 'brick', hint: 'Stops progress. A wall the hero cannot pass.' },
  dependency: { label: 'Dependency', sprite: 'plant', hint: 'Needed from elsewhere. A pipe with a plant.' },
  risk: { label: 'Risk', sprite: 'critter', hint: 'Might go wrong. Done = mitigated. A critter.' },
  decision: { label: 'Decision', sprite: 'sign-q', hint: 'Open question. The hero waits at the sign.' },
  stretch: { label: 'Stretch', sprite: 'coin', hint: 'Nice-to-have polish. Floating coins; never blocks.' },
};

export const STATUS_LABEL: Record<Item['status'], string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
  dropped: 'Dropped',
};

export function field(label: string, input: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint && h('small', null, hint));
}

export function text(value = '', opts: { max?: number; required?: boolean; placeholder?: string } = {}) {
  return h('input', {
    type: 'text',
    value,
    maxLength: opts.max ?? 120,
    required: opts.required ?? true,
    placeholder: opts.placeholder ?? '',
  });
}

export function area(value = '', max = 4000) {
  return h('textarea', { rows: 3, maxLength: max }, value);
}

export function select<T extends string>(options: { value: T; label: string }[], value?: T) {
  return h(
    'select',
    null,
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
}

function checks(options: { value: string; label: string }[], selected: string[] = []) {
  const box = h('div', { class: 'checks' });
  for (const o of options)
    box.append(
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', value: o.value, checked: selected.includes(o.value) }),
        o.label,
      ),
    );
  return box;
}

/**
 * "Waits for" picker: the other items in walking order, split into those
 * before and after this one, with their status. Items that already wait for
 * this one (directly or through others) can't be picked: that would be a loop.
 */
function waitsFor(level: Level, item: Item | undefined, others: Item[], selected: string[] = []) {
  const order = new Map(layoutLevel(level).entities.map((e, i) => [e.itemId, i]));
  const pos = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...others].sort((a, b) => pos(a.id) - pos(b.id));
  const here = item ? pos(item.id) : Number.MAX_SAFE_INTEGER;

  // Everything downstream of this item.
  const waiting = new Set<string>();
  if (item) {
    const queue = [item.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const o of others)
        if (o.dependsOn?.includes(id) && !waiting.has(o.id)) {
          waiting.add(o.id);
          queue.push(o.id);
        }
    }
  }

  const option = (o: Item) => {
    const loop = waiting.has(o.id);
    return h(
      'label',
      { class: `check ${o.status}${loop ? ' loop' : ''}`, title: loop ? `"${o.title}" already waits for this one` : STATUS_LABEL[o.status] },
      h('input', { type: 'checkbox', value: o.id, checked: selected.includes(o.id), disabled: loop }),
      h('span', { class: 'dep-title' }, o.title),
      // Status as a tag on the right, so the only box on the row is the one you tick.
      loop
        ? h('small', { class: 'dep-tag' }, 'waits for this')
        : o.status !== 'todo' && h('span', { class: `pill ${o.status}` }, STATUS_LABEL[o.status]),
    );
  };
  const group = (title: string, items: Item[]) => (items.length ? [h('div', { class: 'checks-group' }, title), items.map(option)] : null);
  return h(
    'div',
    { class: 'checks deps' },
    group(item ? 'Earlier in the level' : 'Already in the level', sorted.filter((o) => pos(o.id) < here)),
    group('Later in the level', sorted.filter((o) => pos(o.id) > here)),
  );
}

/** A cash amount field: blank means none set. */
export function money(value?: number) {
  return h('input', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal', value: value === undefined ? '' : String(value), placeholder: '—' });
}

/** The amount in a money field (undefined when blank), or null after reporting a bad one. */
export function readMoney(input: HTMLInputElement): number | undefined | null {
  if (!input.value.trim()) return undefined;
  const n = Number(input.value);
  if (!input.checkValidity() || !Number.isFinite(n) || n < 0 || n > 1e9) {
    input.reportValidity();
    return null;
  }
  return roundMoney(n);
}

/** Budget and spent side by side; nothing when the project doesn't track budgets. */
function costRow(prefs: BudgetPrefs | undefined, budget: HTMLInputElement, spent?: HTMLInputElement, hint?: string) {
  if (!prefs) return null;
  const sym = currencySymbol(prefs.currency);
  return h(
    'div',
    { class: 'field-row' },
    field(`Budget (${sym})`, budget, hint),
    spent && field(`Spent (${sym})`, spent, 'Fill it in as receipts come in. Logging costs never counts as polish.'),
  );
}

/** Currencies offered for a project; any other ISO code in the data is kept. */
const CURRENCIES = ['GBP', 'EUR', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'INR', 'ZAR'];

const checked = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);

const orUndef = <T>(arr: T[]) => (arr.length ? arr : undefined);
export const trimOrUndef = (s: string) => s.trim() || undefined;

/** Returns false (keep modal open) when a required input is empty. */
export function requireFilled(...inputs: (HTMLInputElement | HTMLTextAreaElement)[]) {
  for (const i of inputs)
    if (!i.value.trim()) {
      i.focus();
      i.reportValidity();
      return false;
    }
  return true;
}

/**
 * Adds or edits an item in the level view `cur`. Inside a dependency's
 * sub-level the item is one of its steps (and can't be a dependency).
 */
export function itemForm(app: App, cur: LevelView, item?: Item, preset?: Partial<Item>) {
  const { level } = cur;
  const worldId = cur.world.id;
  const inSub = !!cur.sub;
  const others = level.items.filter((i) => i.id !== item?.id);
  const title = text(item?.title ?? preset?.title);
  const type = select(
    ITEM_TYPES.filter((t) => !inSub || t !== 'dependency').map((t) => ({ value: t, label: `${TYPE_INFO[t].label} — ${TYPE_INFO[t].hint}` })),
    item?.type ?? preset?.type ?? 'task',
  );
  const status = select(
    STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    item?.status ?? 'todo',
  );
  const mvp = h('input', { type: 'checkbox', checked: item ? item.mvp !== false : preset?.mvp !== false });
  const deps = waitsFor(level, item, others, item?.dependsOn);
  const state = app.state!;
  const levelRef = select(
    [
      { value: '', label: '— none —' },
      ...orderedWorlds(state).flatMap((w) =>
        w.levels
          .filter((l) => !(w.id === worldId && l.id === level.id))
          .map((l) => ({ value: `${w.id}/${l.id}`, label: `${w.name} › ${l.name}` })),
      ),
    ],
    item?.levelRef ?? '',
  );
  const link = h('input', { type: 'url', value: item?.link ?? '', placeholder: 'https://…' });
  const notes = area(item?.notes);
  const budget = money(item?.budget);
  const spent = money(item?.spent);
  const mvpRow = field('Critical path (MVP)', mvp, 'Unticked = optional: the hero walks past it.');
  const stepCount = item?.subtasks?.length ?? 0;
  // A dependency is either a ride to another level or a pipe down to its own steps.
  if (stepCount) levelRef.disabled = true;
  const refRow = field(
    'Depends on level',
    levelRef,
    stepCount
      ? `It has ${stepCount} step${stepCount === 1 ? '' : 's'} of its own (a warp pipe), so it can't also point at a level.`
      : 'Shown as a cloud that carries the hero to that level. Leave empty to give it steps of its own instead (ADD STEPS on its bubble).',
  );
  const sync = () => {
    mvpRow.hidden = type.value === 'stretch';
    refRow.hidden = inSub || type.value !== 'dependency';
  };
  type.addEventListener('change', sync);
  sync();

  const body = h(
    'div',
    null,
    field('Title', title),
    field('Type', type),
    field('Status', status),
    mvpRow,
    refRow,
    others.length
      ? field(
          'Waits for',
          deps,
          `Tick anything that has to be finished before this ${inSub ? 'step' : 'item'} can start. Leave it all unticked if it can happen any time.`,
        )
      : null,
    costRow(
      cur.budgets,
      budget,
      spent,
      stepCount ? 'Leave it blank to add up its steps.' : 'What you expect it to cost. Finish under it and you bank the rest.',
    ),
    field('Link', link),
    field('Notes', notes),
  );

  const save = () => {
    if (!requireFilled(title)) return false;
    const cost = { budget: readMoney(budget), spent: readMoney(spent) };
    if (cost.budget === null || cost.spent === null) return false;
    if (link.value && !link.checkValidity()) {
      link.reportValidity();
      return false;
    }
    const t = type.value as ItemType;
    if (item?.subtasks?.length && t !== 'dependency') {
      type.setCustomValidity('Only dependencies can have steps: delete its steps first.');
      type.reportValidity();
      type.setCustomValidity('');
      return false;
    }
    const values: Omit<Item, 'id'> = {
      title: title.value.trim(),
      type: t,
      status: status.value as Item['status'],
      mvp: t === 'stretch' || mvp.checked ? undefined : false,
      dependsOn: orUndef(checked(deps)),
      levelRef: t === 'dependency' && !inSub && !stepCount ? trimOrUndef(levelRef.value) : undefined,
      // Budgets off: leave whatever cost data the item has alone.
      ...(cur.budgets ? { budget: cost.budget, spent: cost.spent } : {}),
      link: trimOrUndef(link.value),
      notes: trimOrUndef(notes.value),
    };
    const at = itemAddr(cur);
    const r = item
      ? app.dispatch({ kind: 'updateItem', ...at, itemId: item.id, patch: values })
      : app.dispatch({
          kind: 'addItem',
          ...at,
          item: stripUndefined({ id: uniqueId(values.title, level.items.map((i) => i.id)), ...values }),
        });
    return r.ok;
  };

  const actions = [
    ...deleteAction(
      item,
      () => {
        app.dispatch({ kind: 'deleteItem', ...itemAddr(cur), itemId: item!.id });
        app.select(undefined);
      },
      item && {
        title: 'Delete item',
        text: `Delete "${item.title}"?${stepCount ? ` Its ${stepCount} step${stepCount === 1 ? '' : 's'} go too.` : ''} Dropping it keeps history.`,
      },
    ),
    { label: 'Cancel' },
    { label: item ? 'Save' : 'Add', kind: 'primary' as const, run: save },
  ];
  openModal(item ? (inSub ? 'Edit step' : 'Edit item') : inSub ? `New step for "${cur.sub!.dep.title}"` : 'New item', body, actions);
}

/**
 * A form's Delete button, for spreading into its actions (none when there's
 * nothing to delete yet). With `confirm` it asks first; `run` returning false
 * keeps the form open.
 */
function deleteAction(show: unknown, run: () => boolean | void, confirm?: { title: string; text: string }): ModalAction[] {
  if (!show) return [];
  return [
    {
      label: 'Delete',
      kind: 'danger',
      run: async () => {
        if (confirm && !(await confirmDialog(confirm.title, confirm.text, 'Delete', true))) return false;
        return run();
      },
    },
  ];
}

export function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function criterionForm(app: App, worldId: string, level: Level, c?: Criterion) {
  const txt = text(c?.text, { max: 280 });
  const mvp = h('input', { type: 'checkbox', checked: c ? c.mvp : true });
  const body = h(
    'div',
    null,
    field('Success criterion', txt, 'Observable and testable: "A new user can sign up".'),
    field('MVP', mvp, 'MVP criteria are the must-do steps up to the flagpole. Keep them to the 1–3 that truly matter.'),
  );
  const at = { projectId: app.projectId!, worldId, levelId: level.id };
  openModal(c ? 'Edit criterion' : 'New criterion', body, [
    ...deleteAction(c, () => app.dispatch({ kind: 'deleteCriterion', ...at, criterionId: c!.id }).ok),
    { label: 'Cancel' },
    {
      label: c ? 'Save' : 'Add',
      kind: 'primary',
      run: () => {
        if (!requireFilled(txt)) return false;
        const values = { text: txt.value.trim(), mvp: mvp.checked };
        return c
          ? app.dispatch({ kind: 'updateCriterion', ...at, criterionId: c.id, patch: values }).ok
          : app.dispatch({
              kind: 'addCriterion',
              ...at,
              criterion: {
                id: uniqueId(values.text, level.successCriteria.map((x) => x.id)),
                ...values,
                done: false,
              },
            }).ok;
      },
    },
  ]);
}

export function levelForm(app: App, world: World, level?: Level) {
  const projectId = app.projectId!;
  const name = text(level?.name);
  const deliverable = text(level?.deliverable, { max: 280 });
  const days = h('input', { type: 'number', min: 1, max: 90, value: String(level?.timeboxDays ?? 5), required: true });
  const desc = area(level?.description);
  const budget = money(level?.budget);
  const firstCriterion = level ? null : text('', { max: 280, placeholder: 'e.g. Users can log in' });
  const body = h(
    'div',
    null,
    field('Level name', name),
    field('Deliverable', deliverable, 'One sentence: what exists when this level is cleared.'),
    field('Time-box (days)', days, 'Finish early for bonus XP. Go over and you lose a star.'),
    firstCriterion && field('First MVP criterion', firstCriterion, 'The one check that says "good enough".'),
    costRow(budgetPrefs(app.state), budget, undefined, "Cash for the whole level. Blank adds up its items' budgets."),
    field('Description', desc),
  );
  openModal(level ? 'Edit level' : 'New level', body, [
    ...deleteAction(
      level,
      () => {
        if (app.dispatch({ projectId, kind: 'deleteLevel', worldId: world.id, levelId: level!.id }).ok) go({ view: 'world', projectId, worldId: world.id });
      },
      level && { title: 'Delete level', text: `Delete "${level.name}" and all its items?` },
    ),
    { label: 'Cancel' },
    {
      label: level ? 'Save' : 'Create',
      kind: 'primary',
      run: () => {
        if (!requireFilled(name, deliverable, ...(firstCriterion ? [firstCriterion] : []))) return false;
        const cash = readMoney(budget);
        if (cash === null) return false;
        const timeboxDays = Math.max(1, Math.min(90, Math.round(Number(days.value) || 5)));
        const patch = {
          name: name.value.trim(),
          deliverable: deliverable.value.trim(),
          timeboxDays,
          description: trimOrUndef(desc.value),
          ...(budgetPrefs(app.state) ? { budget: cash } : {}),
        };
        if (level)
          return app.dispatch({ projectId, kind: 'updateLevel', worldId: world.id, levelId: level.id, patch }).ok;
        const id = uniqueId(patch.name, ['world', ...world.levels.map((l) => l.id)]);
        const ok = app.dispatch({
          projectId,
          kind: 'addLevel',
          worldId: world.id,
          level: stripUndefined({
            id,
            ...patch,
            successCriteria: [
              { id: uniqueId(firstCriterion!.value, []), text: firstCriterion!.value.trim(), mvp: true, done: false },
            ],
            items: [],
          }),
        }).ok;
        if (ok) go({ view: 'level', projectId, worldId: world.id, levelId: id });
        return ok;
      },
    },
  ]);
}

export function worldForm(app: App, world?: World) {
  const projectId = app.projectId!;
  const state = app.state!;
  const name = text(world?.name);
  const theme = select(
    THEMES.map((t) => ({ value: t, label: t })),
    world?.theme ?? 'grass',
  );
  const desc = area(world?.description);
  const budget = money(world?.budget);
  const goals = checks(
    state.overworld.goals.map((g) => ({ value: g.id, label: g.title })),
    world?.goalIds,
  );
  const unlocks = checks(
    orderedWorlds(state)
      .filter((w) => w.id !== world?.id)
      .map((w) => ({ value: w.id, label: w.name })),
    world?.unlocksAfter,
  );
  const body = h(
    'div',
    null,
    field('World name', name, 'One theme or topic, e.g. "Payments".'),
    field('Theme', theme),
    field('Contributes to goals', goals),
    field('Unlocks after', unlocks, 'Purely visual: shown locked until these are cleared.'),
    costRow(budgetPrefs(state), budget, undefined, "Cash for the whole world. Blank adds up its levels' budgets."),
    field('Description', desc),
  );
  openModal(world ? 'Edit world' : 'New world', body, [
    ...deleteAction(
      world,
      () => {
        if (app.dispatch({ projectId, kind: 'deleteWorld', worldId: world!.id }).ok) go({ view: 'overworld', projectId });
      },
      world && { title: 'Delete world', text: `Delete "${world.name}" and all its levels?` },
    ),
    { label: 'Cancel' },
    {
      label: world ? 'Save' : 'Create',
      kind: 'primary',
      run: () => {
        if (!requireFilled(name)) return false;
        const cash = readMoney(budget);
        if (cash === null) return false;
        const patch = {
          name: name.value.trim(),
          theme: theme.value as World['theme'],
          ...(budgetPrefs(state) ? { budget: cash } : {}),
          description: trimOrUndef(desc.value),
          goalIds: checked(goals),
          unlocksAfter: orUndef(checked(unlocks)),
        };
        if (world) return app.dispatch({ projectId, kind: 'updateWorld', worldId: world.id, patch }).ok;
        const id = uniqueId(patch.name, Object.keys(state.worlds));
        const ok = app.dispatch({ projectId, kind: 'addWorld', world: stripUndefined({ id, ...patch, levels: [] }) }).ok;
        if (ok) go({ view: 'world', projectId, worldId: id });
        return ok;
      },
    },
  ]);
}

export function goalForm(app: App, goal?: Goal) {
  const projectId = app.projectId!;
  const title = text(goal?.title);
  const desc = area(goal?.description);
  openModal(goal ? 'Edit goal' : 'New goal', h('div', null, field('Goal', title), field('Description', desc)), [
    ...deleteAction(goal, () => app.dispatch({ projectId, kind: 'deleteGoal', goalId: goal!.id }).ok),
    { label: 'Cancel' },
    {
      label: goal ? 'Save' : 'Add',
      kind: 'primary',
      run: () => {
        if (!requireFilled(title)) return false;
        const values = { title: title.value.trim(), description: trimOrUndef(desc.value) };
        return goal
          ? app.dispatch({ projectId, kind: 'updateGoal', goalId: goal.id, patch: values }).ok
          : app.dispatch({
              projectId,
              kind: 'addGoal',
              goal: stripUndefined({ id: uniqueId(values.title, app.state!.overworld.goals.map((g) => g.id)), ...values }),
            }).ok;
      },
    },
  ]);
}

/** Edits the current project, or creates a new one when `create` is set. */
export function projectForm(app: App, create = false) {
  const o = create ? undefined : app.state!.overworld;
  const title = text(o?.title);
  const desc = area(o?.description);
  // Cash budgets are opt-in: the tick shows their settings.
  const money = o?.budgets;
  const track = h('input', { type: 'checkbox', checked: !!money });
  const current = money?.currency ?? DEFAULT_CURRENCY;
  const currency = select(
    [...new Set([current, ...CURRENCIES])].map((c) => ({ value: c, label: `${c} (${currencySymbol(c)})` })),
    current,
  );
  const alerts = h('input', { type: 'checkbox', checked: money?.alerts !== false });
  const alertAt = h('input', { type: 'number', min: 50, max: 100, step: 1, value: String(money?.alertAt ?? DEFAULT_ALERT_AT) });
  const alertAtRow = field('Heads-up at (% of a budget spent)', alertAt, 'Going over a budget always alerts.');
  const moneyRows = h(
    'div',
    null,
    field('Currency', currency, 'For every budget and cost in this project.'),
    field('Budget alerts', alerts, 'A heads-up as you log costs, when an item, level or world nears or goes over its budget.'),
    alertAtRow,
  );
  const syncMoney = () => {
    moneyRows.hidden = !track.checked;
    alertAtRow.hidden = !alerts.checked;
  };
  track.addEventListener('change', syncMoney);
  alerts.addEventListener('change', syncMoney);
  syncMoney();
  const goal = create ? text('', { placeholder: 'e.g. Kitchen usable by Christmas' }) : null;
  const body = h(
    'div',
    null,
    create && h('p', { class: 'muted' }, 'A project is a completely separate effort — a house renovation, a furniture build, a work launch. It gets its own folder and map.'),
    field('Project title', title),
    goal && field('First key goal', goal, 'What does success look like? You can add more later.'),
    field(
      'Track cash budgets',
      track,
      'Optional: budgets and costs on items, levels and worlds, with savings and alerts. Turning it off hides them; nothing is deleted.',
    ),
    moneyRows,
    field('Description', desc),
  );
  const save = () => {
    if (!requireFilled(title, ...(goal ? [goal] : []))) return false;
    const at = Number(alertAt.value);
    if (track.checked && alerts.checked && (!alertAt.checkValidity() || !Number.isInteger(at))) {
      alertAt.reportValidity();
      return false;
    }
    const values = {
      title: title.value.trim(),
      description: trimOrUndef(desc.value),
      // Defaults aren't written out, so turning budgets on is just "budgets": {}.
      budgets: track.checked
        ? stripUndefined({
            currency: currency.value === DEFAULT_CURRENCY ? undefined : currency.value,
            alerts: alerts.checked ? undefined : false,
            alertAt: !Number.isInteger(at) || at === DEFAULT_ALERT_AT ? undefined : Math.max(50, Math.min(100, at)),
          })
        : undefined,
    };
    if (!create) return app.dispatch({ projectId: app.projectId!, kind: 'updateProject', patch: values }).ok;
    const id = uniqueId(values.title, Object.keys(app.workspace?.projects ?? {}));
    const ok = app.dispatch({
      kind: 'addProject',
      projectId: id,
      project: stripUndefined({
        id,
        ...values,
        goals: [{ id: uniqueId(goal!.value, []), title: goal!.value.trim() }],
        worldOrder: [],
      }),
    }).ok;
    if (ok) go({ view: 'overworld', projectId: id });
    return ok;
  };
  const actions = [
    ...deleteAction(
      o,
      () => {
        if (app.dispatch({ kind: 'deleteProject', projectId: app.projectId! }).ok) go({ view: 'projects' });
      },
      o && { title: 'Delete project', text: `Delete "${o.title}" with all its worlds and levels?` },
    ),
    // Put it on the shelf (clocks paused, out of Today and the review), or take it back down.
    ...(o
      ? [
          {
            label: o.archivedAt ? 'Unarchive' : 'Archive',
            run: () => app.dispatch({ projectId: app.projectId!, kind: 'setArchived', archived: !o.archivedAt }).ok,
          },
        ]
      : []),
    { label: 'Cancel' },
    { label: create ? 'Create' : 'Save', kind: 'primary' as const, run: save },
  ];
  openModal(create ? 'New project' : 'Edit project', body, actions);
}
