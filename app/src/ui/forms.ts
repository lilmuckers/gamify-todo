import {
  ITEM_TYPES,
  STATUSES,
  THEMES,
  orderedWorlds,
  uniqueId,
  type Criterion,
  type Goal,
  type Item,
  type ItemType,
  type Level,
  type World,
} from '@quest/shared';
import type { App } from '../app';
import { go } from '../router';
import { h } from './dom';
import { confirmDialog, openModal } from './modal';

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

function field(label: string, input: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint && h('small', null, hint));
}

function text(value = '', opts: { max?: number; required?: boolean; placeholder?: string } = {}) {
  return h('input', {
    type: 'text',
    value,
    maxLength: opts.max ?? 120,
    required: opts.required ?? true,
    placeholder: opts.placeholder ?? '',
  });
}

function area(value = '', max = 4000) {
  return h('textarea', { rows: 3, maxLength: max }, value);
}

function select<T extends string>(options: { value: T; label: string }[], value?: T) {
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

const checked = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);

const orUndef = <T>(arr: T[]) => (arr.length ? arr : undefined);
const trimOrUndef = (s: string) => s.trim() || undefined;

/** Returns false (keep modal open) when a required input is empty. */
function requireFilled(...inputs: (HTMLInputElement | HTMLTextAreaElement)[]) {
  for (const i of inputs)
    if (!i.value.trim()) {
      i.focus();
      i.reportValidity();
      return false;
    }
  return true;
}

export function itemForm(app: App, worldId: string, level: Level, item?: Item, preset?: Partial<Item>) {
  const others = level.items.filter((i) => i.id !== item?.id);
  const title = text(item?.title ?? preset?.title);
  const type = select(
    ITEM_TYPES.map((t) => ({ value: t, label: `${TYPE_INFO[t].label} — ${TYPE_INFO[t].hint}` })),
    item?.type ?? preset?.type ?? 'task',
  );
  const status = select(
    STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    item?.status ?? 'todo',
  );
  const mvp = h('input', { type: 'checkbox', checked: item ? item.mvp !== false : preset?.mvp !== false });
  const deps = checks(
    others.map((i) => ({ value: i.id, label: i.title })),
    item?.dependsOn,
  );
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
  const mvpRow = field('Critical path (MVP)', mvp, 'Unticked = optional: the hero walks past it.');
  const refRow = field('Depends on level', levelRef, 'Renders as a warp pipe to that level.');
  const sync = () => {
    mvpRow.hidden = type.value === 'stretch';
    refRow.hidden = type.value !== 'dependency';
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
    others.length ? field('Comes after', deps, 'Items in this level that must happen first.') : null,
    field('Link', link),
    field('Notes', notes),
  );

  const save = () => {
    if (!requireFilled(title)) return false;
    if (link.value && !link.checkValidity()) {
      link.reportValidity();
      return false;
    }
    const t = type.value as ItemType;
    const values: Omit<Item, 'id'> = {
      title: title.value.trim(),
      type: t,
      status: status.value as Item['status'],
      mvp: t === 'stretch' || mvp.checked ? undefined : false,
      dependsOn: orUndef(checked(deps)),
      levelRef: t === 'dependency' ? trimOrUndef(levelRef.value) : undefined,
      link: trimOrUndef(link.value),
      notes: trimOrUndef(notes.value),
    };
    const at = { worldId, levelId: level.id };
    const r = item
      ? app.dispatch({ projectId: app.projectId!, kind: 'updateItem', ...at, itemId: item.id, patch: values })
      : app.dispatch({
          projectId: app.projectId!,
          kind: 'addItem',
          ...at,
          item: stripUndefined({ id: uniqueId(values.title, level.items.map((i) => i.id)), ...values }),
        });
    return r.ok;
  };

  const actions = [
    ...(item
      ? [
          {
            label: 'Delete',
            kind: 'danger' as const,
            run: async () => {
              if (!(await confirmDialog('Delete item', `Delete "${item.title}"? Dropping it keeps history.`, 'Delete', true)))
                return false;
              app.dispatch({ projectId: app.projectId!, kind: 'deleteItem', worldId, levelId: level.id, itemId: item.id });
              app.select(undefined);
            },
          },
        ]
      : []),
    { label: 'Cancel' },
    { label: item ? 'Save' : 'Add', kind: 'primary' as const, run: save },
  ];
  openModal(item ? 'Edit item' : 'New item', body, actions);
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function criterionForm(app: App, worldId: string, level: Level, c?: Criterion) {
  const txt = text(c?.text, { max: 280 });
  const mvp = h('input', { type: 'checkbox', checked: c ? c.mvp : true });
  const body = h(
    'div',
    null,
    field('Success criterion', txt, 'Observable and testable: "A new user can sign up".'),
    field('MVP', mvp, 'MVP criteria raise the flagpole. Keep them to the 1–3 that truly matter.'),
  );
  const at = { worldId, levelId: level.id };
  openModal(c ? 'Edit criterion' : 'New criterion', body, [
    ...(c
      ? [
          {
            label: 'Delete',
            kind: 'danger' as const,
            run: () => app.dispatch({ projectId: app.projectId!, kind: 'deleteCriterion', ...at, criterionId: c.id }).ok,
          },
        ]
      : []),
    { label: 'Cancel' },
    {
      label: c ? 'Save' : 'Add',
      kind: 'primary',
      run: () => {
        if (!requireFilled(txt)) return false;
        const values = { text: txt.value.trim(), mvp: mvp.checked };
        return c
          ? app.dispatch({ projectId: app.projectId!, kind: 'updateCriterion', ...at, criterionId: c.id, patch: values }).ok
          : app.dispatch({
          projectId: app.projectId!,
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
  const name = text(level?.name);
  const deliverable = text(level?.deliverable, { max: 280 });
  const days = h('input', { type: 'number', min: 1, max: 90, value: String(level?.timeboxDays ?? 5), required: true });
  const desc = area(level?.description);
  const firstCriterion = level ? null : text('', { max: 280, placeholder: 'e.g. Users can log in' });
  const body = h(
    'div',
    null,
    field('Level name', name),
    field('Deliverable', deliverable, 'One sentence: what exists when this level is cleared.'),
    field('Time-box (days)', days, 'Finish early for bonus XP. Go over and you lose a star.'),
    firstCriterion && field('First MVP criterion', firstCriterion, 'The one check that says "good enough".'),
    field('Description', desc),
  );
  openModal(level ? 'Edit level' : 'New level', body, [
    ...(level
      ? [
          {
            label: 'Delete',
            kind: 'danger' as const,
            run: async () => {
              if (!(await confirmDialog('Delete level', `Delete "${level.name}" and all its items?`, 'Delete', true)))
                return false;
              if (app.dispatch({ projectId: app.projectId!, kind: 'deleteLevel', worldId: world.id, levelId: level.id }).ok)
                go({ view: 'world', projectId: app.projectId!, worldId: world.id });
            },
          },
        ]
      : []),
    { label: 'Cancel' },
    {
      label: level ? 'Save' : 'Create',
      kind: 'primary',
      run: () => {
        if (!requireFilled(name, deliverable, ...(firstCriterion ? [firstCriterion] : []))) return false;
        const timeboxDays = Math.max(1, Math.min(90, Math.round(Number(days.value) || 5)));
        const patch = {
          name: name.value.trim(),
          deliverable: deliverable.value.trim(),
          timeboxDays,
          description: trimOrUndef(desc.value),
        };
        if (level)
          return app.dispatch({ projectId: app.projectId!, kind: 'updateLevel', worldId: world.id, levelId: level.id, patch }).ok;
        const id = uniqueId(patch.name, ['world', ...world.levels.map((l) => l.id)]);
        const ok = app.dispatch({
          projectId: app.projectId!,
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
        if (ok) go({ view: 'level', projectId: app.projectId!, worldId: world.id, levelId: id });
        return ok;
      },
    },
  ]);
}

export function worldForm(app: App, world?: World) {
  const state = app.state!;
  const name = text(world?.name);
  const theme = select(
    THEMES.map((t) => ({ value: t, label: t })),
    world?.theme ?? 'grass',
  );
  const desc = area(world?.description);
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
    field('Description', desc),
  );
  openModal(world ? 'Edit world' : 'New world', body, [
    ...(world
      ? [
          {
            label: 'Delete',
            kind: 'danger' as const,
            run: async () => {
              if (!(await confirmDialog('Delete world', `Delete "${world.name}" and all its levels?`, 'Delete', true)))
                return false;
              if (app.dispatch({ projectId: app.projectId!, kind: 'deleteWorld', worldId: world.id }).ok) go({ view: 'overworld', projectId: app.projectId! });
            },
          },
        ]
      : []),
    { label: 'Cancel' },
    {
      label: world ? 'Save' : 'Create',
      kind: 'primary',
      run: () => {
        if (!requireFilled(name)) return false;
        const patch = {
          name: name.value.trim(),
          theme: theme.value as World['theme'],
          description: trimOrUndef(desc.value),
          goalIds: checked(goals),
          unlocksAfter: orUndef(checked(unlocks)),
        };
        if (world) return app.dispatch({ projectId: app.projectId!, kind: 'updateWorld', worldId: world.id, patch }).ok;
        const id = uniqueId(patch.name, Object.keys(state.worlds));
        const ok = app.dispatch({ projectId: app.projectId!, kind: 'addWorld', world: stripUndefined({ id, ...patch, levels: [] }) }).ok;
        if (ok) go({ view: 'world', projectId: app.projectId!, worldId: id });
        return ok;
      },
    },
  ]);
}

export function goalForm(app: App, goal?: Goal) {
  const title = text(goal?.title);
  const desc = area(goal?.description);
  openModal(goal ? 'Edit goal' : 'New goal', h('div', null, field('Goal', title), field('Description', desc)), [
    ...(goal
      ? [{ label: 'Delete', kind: 'danger' as const, run: () => app.dispatch({ projectId: app.projectId!, kind: 'deleteGoal', goalId: goal.id }).ok }]
      : []),
    { label: 'Cancel' },
    {
      label: goal ? 'Save' : 'Add',
      kind: 'primary',
      run: () => {
        if (!requireFilled(title)) return false;
        const values = { title: title.value.trim(), description: trimOrUndef(desc.value) };
        return goal
          ? app.dispatch({ projectId: app.projectId!, kind: 'updateGoal', goalId: goal.id, patch: values }).ok
          : app.dispatch({
          projectId: app.projectId!,
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
  const goal = create ? text('', { placeholder: 'e.g. Kitchen usable by Christmas' }) : null;
  const body = h(
    'div',
    null,
    create && h('p', { class: 'muted' }, 'A project is a completely separate effort — a house renovation, a furniture build, a work launch. It gets its own folder and map.'),
    field('Project title', title),
    goal && field('First key goal', goal, 'What does success look like? You can add more later.'),
    field('Description', desc),
  );
  const save = () => {
    if (!requireFilled(title, ...(goal ? [goal] : []))) return false;
    const values = { title: title.value.trim(), description: trimOrUndef(desc.value) };
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
    ...(!create
      ? [
          {
            label: 'Delete',
            kind: 'danger' as const,
            run: async () => {
              if (!(await confirmDialog('Delete project', `Delete "${o!.title}" with all its worlds and levels?`, 'Delete', true)))
                return false;
              if (app.dispatch({ kind: 'deleteProject', projectId: app.projectId! }).ok) go({ view: 'projects' });
            },
          },
        ]
      : []),
    { label: 'Cancel' },
    { label: create ? 'Create' : 'Save', kind: 'primary' as const, run: save },
  ];
  openModal(create ? 'New project' : 'Edit project', body, actions);
}
