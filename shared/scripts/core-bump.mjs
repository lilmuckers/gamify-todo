// Picks the semver bump for a core release (quest.py + schema/), README §3.6 of the automation plan.
// Pure: callers pass in the old and new files, so the rules are unit-tested without git.
//   major: a removed property, def, enum value or schema file; a newly required field; a tightened
//          constraint; a removed quest.py command or flag
//   minor: a new optional property, def, enum value or schema file; a loosened constraint; a new
//          quest.py command or flag
//   patch: anything else (descriptions, a quest.py fix)

export const BUMPS = ['none', 'patch', 'minor', 'major'];
const rank = (b) => BUMPS.indexOf(b);
const higher = (a, b) => (rank(a) >= rank(b) ? a : b);

/** Keywords where a bigger number accepts less (tightening = raising it). */
const LOWER_BOUNDS = ['minLength', 'minimum', 'exclusiveMinimum', 'minItems', 'minProperties'];
/** Keywords where a smaller number accepts less (tightening = lowering it). */
const UPPER_BOUNDS = ['maxLength', 'maximum', 'exclusiveMaximum', 'maxItems', 'maxProperties'];
/** Sub-schema keywords holding a map of named schemas. */
const MAPS = ['properties', '$defs', 'patternProperties'];
/** Sub-schema keywords holding one schema. */
const SINGLE = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains'];
/** Sub-schema keywords holding a list of schemas. */
const LISTS = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const types = (s) => (s.type === undefined ? null : [].concat(s.type));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compares two schema nodes found at the same place. Returns [{ bump, reason }].
 * Only what changes which documents validate counts as minor or major.
 */
function compareNode(before, after, at, out) {
  if (!isObj(before) || !isObj(after)) {
    if (!same(before, after)) {
      // `additionalProperties: false` → `{…}`/`true` loosens; the reverse tightens.
      if (before === false) out.push({ bump: 'minor', reason: `${at}: now allowed` });
      else if (after === false) out.push({ bump: 'major', reason: `${at}: no longer allowed` });
      else if (isObj(before) || isObj(after)) out.push({ bump: 'major', reason: `${at}: schema replaced` });
    }
    return;
  }

  for (const key of MAPS) {
    const a = before[key] ?? {};
    const b = after[key] ?? {};
    for (const name of Object.keys(a)) {
      if (!(name in b)) out.push({ bump: 'major', reason: `${at}/${key}/${name}: removed` });
      else compareNode(a[name], b[name], `${at}/${key}/${name}`, out);
    }
    for (const name of Object.keys(b)) {
      if (name in a) continue;
      const required = key === 'properties' && (after.required ?? []).includes(name);
      out.push(required
        ? { bump: 'major', reason: `${at}/${key}/${name}: added as required` }
        : { bump: 'minor', reason: `${at}/${key}/${name}: added` });
    }
  }

  const wasRequired = new Set(before.required ?? []);
  for (const name of after.required ?? []) {
    // A property that's both new and required was reported above.
    if (!wasRequired.has(name) && (before.properties ?? {})[name] !== undefined)
      out.push({ bump: 'major', reason: `${at}/required: "${name}" is now required` });
  }
  const nowRequired = new Set(after.required ?? []);
  for (const name of wasRequired)
    if (!nowRequired.has(name)) out.push({ bump: 'minor', reason: `${at}/required: "${name}" is now optional` });

  if (before.enum || after.enum) {
    const a = before.enum ?? null;
    const b = after.enum ?? null;
    if (a && !b) out.push({ bump: 'minor', reason: `${at}/enum: removed (any value allowed)` });
    else if (!a && b) out.push({ bump: 'major', reason: `${at}/enum: added` });
    else {
      for (const v of a) if (!b.some((x) => same(x, v))) out.push({ bump: 'major', reason: `${at}/enum: ${JSON.stringify(v)} removed` });
      for (const v of b) if (!a.some((x) => same(x, v))) out.push({ bump: 'minor', reason: `${at}/enum: ${JSON.stringify(v)} added` });
    }
  }

  if (!same(before.const, after.const)) {
    if (after.const === undefined) out.push({ bump: 'minor', reason: `${at}/const: removed` });
    else out.push({ bump: 'major', reason: `${at}/const: changed` });
  }

  const ta = types(before);
  const tb = types(after);
  if (!same(ta, tb)) {
    if (tb === null || (ta !== null && ta.every((t) => tb.includes(t) || (t === 'integer' && tb.includes('number')))))
      out.push({ bump: 'minor', reason: `${at}/type: widened` });
    else out.push({ bump: 'major', reason: `${at}/type: narrowed` });
  }

  for (const key of LOWER_BOUNDS) bound(key, before[key], after[key], (a, b) => b > a, at, out);
  for (const key of UPPER_BOUNDS) bound(key, before[key], after[key], (a, b) => b < a, at, out);

  for (const key of ['pattern', 'format', '$ref']) {
    if (same(before[key], after[key])) continue;
    if (after[key] === undefined) out.push({ bump: 'minor', reason: `${at}/${key}: removed` });
    else out.push({ bump: 'major', reason: `${at}/${key}: ${before[key] === undefined ? 'added' : 'changed'}` });
  }

  for (const key of SINGLE) {
    if (before[key] === undefined && after[key] === undefined) continue;
    if (before[key] === undefined) {
      if (after[key] !== true) out.push({ bump: 'major', reason: `${at}/${key}: added` });
    } else if (after[key] === undefined) {
      if (before[key] !== true) out.push({ bump: 'minor', reason: `${at}/${key}: removed` });
    } else compareNode(before[key], after[key], `${at}/${key}`, out);
  }

  for (const key of LISTS) {
    const a = before[key];
    const b = after[key];
    if (!a && !b) continue;
    if (!a || !b || a.length !== b.length) {
      // anyOf/oneOf growing accepts more; anything else about a list change is treated as breaking.
      const grows = a && b && b.length > a.length && (key === 'anyOf' || key === 'oneOf') && a.every((s, i) => same(s, b[i]));
      out.push(grows ? { bump: 'minor', reason: `${at}/${key}: option added` } : { bump: 'major', reason: `${at}/${key}: changed` });
      continue;
    }
    a.forEach((s, i) => compareNode(s, b[i], `${at}/${key}/${i}`, out));
  }
}

function bound(key, a, b, tighter, at, out) {
  if (a === b) return;
  if (a === undefined) out.push({ bump: 'major', reason: `${at}/${key}: added (${b})` });
  else if (b === undefined) out.push({ bump: 'minor', reason: `${at}/${key}: removed` });
  else if (tighter(a, b)) out.push({ bump: 'major', reason: `${at}/${key}: tightened ${a} → ${b}` });
  else out.push({ bump: 'minor', reason: `${at}/${key}: loosened ${a} → ${b}` });
}

/** Commands and flags quest.py offers, read from its argparse calls. */
export function scriptInterface(source) {
  const out = new Set();
  let cmd = '';
  for (const line of source.split('\n')) {
    const p = /add_parser\('([^']+)'/.exec(line);
    if (p) {
      cmd = p[1];
      out.add(`command ${cmd}`);
      continue;
    }
    // Top-level flags come before the first subcommand.
    for (const m of line.matchAll(/add_argument\('(--?[\w-]+)'/g)) out.add(cmd ? `flag ${cmd} ${m[1]}` : `flag ${m[1]}`);
  }
  return out;
}

/**
 * The bump for going from `before` to `after`, each `{ schemas: { file: json }, script: string }`.
 * Returns `{ bump, reasons }`; `bump` is 'none' when nothing changed.
 */
export function detectBump(before, after) {
  const found = [];
  for (const file of Object.keys(before.schemas)) {
    if (!(file in after.schemas)) found.push({ bump: 'major', reason: `${file}: removed` });
    else compareNode(before.schemas[file], after.schemas[file], file, found);
  }
  for (const file of Object.keys(after.schemas))
    if (!(file in before.schemas)) found.push({ bump: 'minor', reason: `${file}: added` });

  const was = scriptInterface(before.script);
  const now = scriptInterface(after.script);
  for (const x of was) if (!now.has(x)) found.push({ bump: 'major', reason: `quest.py: ${x} removed` });
  for (const x of now) if (!was.has(x)) found.push({ bump: 'minor', reason: `quest.py: ${x} added` });

  const changed =
    before.script !== after.script ||
    Object.keys(after.schemas).length !== Object.keys(before.schemas).length ||
    Object.keys(after.schemas).some((f) => !same(before.schemas[f], after.schemas[f]));
  if (!changed) return { bump: 'none', reasons: [] };
  if (!found.length) return { bump: 'patch', reasons: ['quest.py or schema descriptions changed'] };
  return { bump: found.reduce((b, f) => higher(b, f.bump), 'patch'), reasons: found.map((f) => `${f.bump}: ${f.reason}`) };
}

/**
 * Applies `core: …` PR labels. The highest label raises the bump but can't lower a detected major,
 * except `core: force-minor`, which is for false positives and leaves a note.
 */
export function applyLabels(detected, labels) {
  const names = labels.map((l) => l.trim().toLowerCase());
  const reasons = [...detected.reasons];
  let bump = detected.bump;
  if (names.includes('core: force-minor')) {
    reasons.push(`label core: force-minor (detected ${bump})`);
    return { bump: bump === 'none' ? 'none' : 'minor', reasons, forced: true };
  }
  for (const b of ['patch', 'minor', 'major']) {
    if (names.includes(`core: ${b}`) && bump !== 'none' && rank(b) > rank(bump)) {
      reasons.push(`label core: ${b} raised ${bump}`);
      bump = b;
    }
  }
  return { bump, reasons, forced: false };
}

/** `1.4.2` + `minor` → `1.5.0`; no previous release → `1.0.0`. */
export function nextVersion(previous, bump) {
  if (!previous) return '1.0.0';
  const [maj, min, pat] = previous.split('.').map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  return previous;
}
