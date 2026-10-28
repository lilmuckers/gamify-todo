import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyLabels, detectBump, nextVersion, scriptInterface } from '../scripts/core-bump.mjs';
import { contentHash, pointerTags } from '../scripts/core-release.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = readFileSync(resolve(ROOT, 'skills/quest-log/scripts/quest.py'), 'utf8');

const level = () => ({
  $defs: {
    Item: {
      type: 'object',
      required: ['id', 'title'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9-]+$' },
        title: { type: 'string', minLength: 1, maxLength: 200, description: 'What to do.' },
        status: { enum: ['todo', 'doing', 'done'] },
        notes: { type: 'string' },
      },
    },
  },
});

/** The bump for one edit to the level schema above. */
function bumpFor(edit: (s: any) => void, script = SCRIPT) {
  const after = level();
  edit(after);
  return detectBump({ schemas: { 'quest.schema.json': level() }, script: SCRIPT }, { schemas: { 'quest.schema.json': after }, script });
}
const item = (s: any) => s.$defs.Item;

describe('core bump detection', () => {
  it('is none when nothing changed and patch for descriptions only', () => {
    expect(bumpFor(() => {}).bump).toBe('none');
    expect(bumpFor((s) => (item(s).properties.title.description = 'What needs doing.')).bump).toBe('patch');
    expect(bumpFor(() => {}, SCRIPT.replace('class QuestError', '# a fix\nclass QuestError')).bump).toBe('patch');
  });

  it('is major for removals, new required fields and tightened constraints', () => {
    const majors: [string, (s: any) => void][] = [
      ['property removed', (s) => delete item(s).properties.notes],
      ['def removed', (s) => delete s.$defs.Item],
      ['enum value removed', (s) => (item(s).properties.status.enum = ['todo', 'done'])],
      ['required property added', (s) => { item(s).properties.due = { type: 'string' }; item(s).required.push('due'); }],
      ['existing property now required', (s) => item(s).required.push('notes')],
      ['maxLength lowered', (s) => (item(s).properties.title.maxLength = 100)],
      ['minLength raised', (s) => (item(s).properties.title.minLength = 3)],
      ['new bound', (s) => (item(s).properties.notes.maxLength = 500)],
      ['pattern changed', (s) => (item(s).properties.id.pattern = '^[a-z]+$')],
      ['type narrowed', (s) => (item(s).properties.notes.type = 'integer')],
      ['additional properties closed', (s) => (item(s).properties.status.additionalProperties = false)],
    ];
    for (const [name, edit] of majors) expect(bumpFor(edit).bump, name).toBe('major');
  });

  it('is minor for additions and loosened constraints', () => {
    const minors: [string, (s: any) => void][] = [
      ['optional property added', (s) => (item(s).properties.due = { type: 'string' })],
      ['def added', (s) => (s.$defs.Automation = { type: 'object' })],
      ['enum value added', (s) => item(s).properties.status.enum.push('skipped')],
      ['maxLength raised', (s) => (item(s).properties.title.maxLength = 400)],
      ['required dropped', (s) => (item(s).required = ['id'])],
      ['type widened', (s) => (item(s).properties.notes.type = ['string', 'null'])],
      ['additional properties opened', (s) => (item(s).additionalProperties = true)],
    ];
    for (const [name, edit] of minors) expect(bumpFor(edit).bump, name).toBe('minor');
  });

  it('counts schema files and quest.py commands and flags', () => {
    const base = { schemas: { 'a.json': {} }, script: SCRIPT };
    expect(detectBump(base, { ...base, schemas: { 'a.json': {}, 'b.json': {} } }).bump).toBe('minor');
    expect(detectBump(base, { ...base, schemas: {} }).bump).toBe('major');
    const review = SCRIPT.replace("    p = sub.add_parser('schemas'", "    p = sub.add_parser('review')\n    p.add_argument('--now')\n    p = sub.add_parser('schemas'");
    expect(detectBump(base, { ...base, script: review })).toMatchObject({ bump: 'minor', reasons: expect.arrayContaining(['minor: quest.py: command review added', 'minor: quest.py: flag review --now added']) });
    expect(detectBump({ ...base, script: review }, base).bump).toBe('major');
  });

  it('reads the real quest.py interface', () => {
    const iface = scriptInterface(SCRIPT);
    expect(iface).toContain('command validate');
    expect(iface).toContain('flag validate --json');
    expect(iface).toContain('flag changes --json');
    expect(iface).toContain('flag --schemas');
  });
});

describe('core bump labels', () => {
  const minor = { bump: 'minor', reasons: ['minor: x'] };
  const major = { bump: 'major', reasons: ['major: y'] };
  it('raises but never lowers', () => {
    expect(applyLabels(minor, ['core: major']).bump).toBe('major');
    expect(applyLabels(major, ['core: patch']).bump).toBe('major');
    expect(applyLabels(minor, ['core: patch', 'enhancement']).bump).toBe('minor');
  });
  it('lets force-minor overrule a false major, with a note', () => {
    const r = applyLabels(major, ['core: force-minor', 'core: major']);
    expect(r).toMatchObject({ bump: 'minor', forced: true });
    expect(r.reasons.at(-1)).toMatch(/force-minor/);
  });
});

describe('core versions and pointer', () => {
  it('bumps versions', () => {
    expect(nextVersion(null, 'major')).toBe('1.0.0');
    expect(nextVersion('1.4.2', 'patch')).toBe('1.4.3');
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0');
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
  });

  it('hashes content only, independent of key order', () => {
    const a = { 'quest.py': Buffer.from('x'), 'schema/a.json': Buffer.from('{}') };
    const b = { 'schema/a.json': Buffer.from('{}'), 'quest.py': Buffer.from('x') };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash({ ...a, 'quest.py': Buffer.from('y') }));
  });

  const tags = ['1.0.0', '1.1.0', '1.2.0', '2.0.0'].map((v) => ({ tag: `core-v${v}`, version: v.split('.').map(Number) }));
  it('points each major at its newest release, freezing older majors', () => {
    expect(pointerTags(tags)).toEqual({ v1: 'core-v1.2.0', v2: 'core-v2.0.0' });
  });
  it('honours core-pin.json and rejects bad pins', () => {
    expect(pointerTags(tags, { v1: 'core-v1.1.0' })).toEqual({ v1: 'core-v1.1.0', v2: 'core-v2.0.0' });
    expect(() => pointerTags(tags, { v1: 'core-v2.0.0' })).toThrow(/not a v1 tag/);
    expect(() => pointerTags(tags, { v1: 'core-v1.9.0' })).toThrow(/doesn't exist/);
  });
});
