#!/usr/bin/env python3
"""Quest Log helper: validate quest data and sync it with a GitHub repository.

Standard library only (Python 3.8+), so it runs in Claude's code execution,
ChatGPT's code interpreter, CI and a normal terminal.

    python3 quest.py update-check                 is this copy of the skill the latest? (exit 3 = outdated)
    python3 quest.py validate [DIR] [--refresh]   check a data tree (DIR contains data/)
    python3 quest.py info --repo OWNER/REPO       default branch and whether the token can push
    python3 quest.py pull --repo OWNER/REPO [--branch B] [--dir DIR]
    python3 quest.py changes BASE DIR | --git REF DIR   what DIR adds, changes and removes vs BASE (exit 5 = removals)
    python3 quest.py push [--dir DIR] -m MESSAGE [--pr TITLE] [--allow-delete KEY ...]
                                                 updates from the branch (and a PR's base) first
    python3 quest.py schemas [--refresh]          where the schemas come from (download or bundled)

GitHub commands read the token from GITHUB_TOKEN (or GH_TOKEN). It is only
ever sent to the GitHub API and never printed.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# The skill version this script ships with; must match SKILL.md (`npm run skill:version`).
SKILL_VERSION = 2

SITE = os.environ.get('QUEST_SITE', 'https://tasks.patrick-mckinley.com/')
API = os.environ.get('QUEST_GITHUB_API', 'https://api.github.com').rstrip('/')
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'quest-log', 'schemas')
BASE_FILE = '.quest-base.json'

SLUG = r'[a-z0-9]+(?:-[a-z0-9]+)*'
PROJECT_RE = re.compile(rf'^data/({SLUG})/project\.json$')
WORLD_RE = re.compile(rf'^data/({SLUG})/({SLUG})/world\.json$')
LEVEL_RE = re.compile(rf'^data/({SLUG})/({SLUG})/({SLUG})\.json$')


class QuestError(Exception):
    pass


# ---------------------------------------------------------------- schemas

def _schema_dirs():
    """Bundled schemas (skill zip), the repo checkout, then the download cache."""
    return [os.path.join(HERE, '..', 'schemas'), os.path.join(HERE, '..', '..', '..', 'schema'), CACHE]


def _http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def download_schemas():
    """Fetch the manifest and every schema it lists into the cache."""
    manifest = json.loads(_http_get(urllib.parse.urljoin(SITE, 'schema/index.json')))
    os.makedirs(CACHE, exist_ok=True)
    for s in manifest['schemas']:
        body = _http_get(urllib.parse.urljoin(manifest.get('baseUrl', urllib.parse.urljoin(SITE, 'schema/')), s['file']))
        json.loads(body)
        with open(os.path.join(CACHE, s['file']), 'wb') as f:
            f.write(body)
    with open(os.path.join(CACHE, 'index.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    return CACHE


def find_schemas(refresh=False):
    """Returns (directory, manifest). Downloads if nothing local is usable."""
    if refresh:
        try:
            d = download_schemas()
            return d, json.load(open(os.path.join(d, 'index.json')))
        except (urllib.error.URLError, OSError, ValueError) as e:
            print(f'warning: could not download the latest schemas ({e}); using local copies', file=sys.stderr)
    for d in _schema_dirs():
        idx = os.path.join(d, 'index.json')
        if os.path.isfile(idx):
            return os.path.abspath(d), json.load(open(idx))
    try:
        d = download_schemas()
    except (urllib.error.URLError, OSError) as e:
        raise QuestError(f'No bundled schemas and download failed ({e}). Pass --schemas DIR or run where {SITE} is reachable.')
    return d, json.load(open(os.path.join(d, 'index.json')))


def load_registry(schema_dir=None, refresh=False):
    if schema_dir:
        manifest = json.load(open(os.path.join(schema_dir, 'index.json')))
        d = schema_dir
    else:
        d, manifest = find_schemas(refresh)
    registry, by_name = {}, {}
    for s in manifest['schemas']:
        doc = json.load(open(os.path.join(d, s['file'])))
        registry[doc['$id']] = doc
        by_name[s['name']] = doc['$id']
    return registry, by_name, d


# ---------------------------------------------------------------- JSON Schema (subset used by Quest Log)

DATE_TIME = re.compile(r'^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$')
TYPES = {
    'object': lambda v: isinstance(v, dict),
    'array': lambda v: isinstance(v, list),
    'string': lambda v: isinstance(v, str),
    'boolean': lambda v: isinstance(v, bool),
    'integer': lambda v: isinstance(v, int) and not isinstance(v, bool),
    'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
}


def _is_uri(v):
    u = urllib.parse.urlparse(v)
    return bool(u.scheme and (u.netloc or u.path))


class MiniValidator:
    """Enough of draft 2020-12 for Quest Log's schemas, with no dependencies."""

    def __init__(self, registry):
        self.registry = registry

    def resolve(self, ref, base):
        url = urllib.parse.urljoin(base, ref)
        doc_url, _, frag = url.partition('#')
        node = self.registry[doc_url]
        for part in [p for p in frag.split('/') if p]:
            node = node[part]
        return node, doc_url

    def errors(self, inst, schema, base, path='/'):
        out = []
        if '$ref' in schema:
            target, b = self.resolve(schema['$ref'], base)
            out += self.errors(inst, target, b, path)
        for sub in schema.get('allOf', []):
            out += self.errors(inst, sub, base, path)
        if 'oneOf' in schema:
            ok = [s for s in schema['oneOf'] if not self.errors(inst, s, base, path)]
            if len(ok) != 1:
                consts = [s['const'] for s in schema['oneOf'] if 'const' in s]
                out.append((path, f'must be one of: {", ".join(map(str, consts))}' if consts else 'must match exactly one schema'))
        if 'const' in schema and inst != schema['const']:
            out.append((path, f'must be {schema["const"]!r}'))
        if 'type' in schema and not TYPES[schema['type']](inst):
            return out + [(path, f'must be {schema["type"]}')]
        if isinstance(inst, dict):
            for k in schema.get('required', []):
                if k not in inst:
                    out.append((path, f"missing required property '{k}'"))
            props = schema.get('properties', {})
            for k, v in inst.items():
                p = f'{path.rstrip("/")}/{k}'
                if k in props:
                    out += self.errors(v, props[k], base, p)
                elif schema.get('additionalProperties') is False:
                    out.append((path, f"unexpected property '{k}'"))
                elif isinstance(schema.get('additionalProperties'), dict):
                    out += self.errors(v, schema['additionalProperties'], base, p)
                if 'propertyNames' in schema:
                    out += [(p, f'property name {e}') for _, e in self.errors(k, schema['propertyNames'], base, p)]
        if isinstance(inst, list):
            if 'minItems' in schema and len(inst) < schema['minItems']:
                out.append((path, f'needs at least {schema["minItems"]} item(s)'))
            if 'maxItems' in schema and len(inst) > schema['maxItems']:
                out.append((path, f'allows at most {schema["maxItems"]} item(s)'))
            if schema.get('uniqueItems') and len({json.dumps(x, sort_keys=True) for x in inst}) != len(inst):
                out.append((path, 'items must be unique'))
            if 'items' in schema:
                for i, v in enumerate(inst):
                    out += self.errors(v, schema['items'], base, f'{path.rstrip("/")}/{i}')
        if isinstance(inst, str):
            if 'minLength' in schema and len(inst) < schema['minLength']:
                out.append((path, f'shorter than {schema["minLength"]}'))
            if 'maxLength' in schema and len(inst) > schema['maxLength']:
                out.append((path, f'longer than {schema["maxLength"]}'))
            if 'pattern' in schema and not re.search(schema['pattern'], inst):
                out.append((path, f'must match {schema["pattern"]}'))
            fmt = schema.get('format')
            if fmt == 'date-time' and not DATE_TIME.match(inst):
                out.append((path, 'must be an ISO 8601 date-time'))
            if fmt == 'uri' and not _is_uri(inst):
                out.append((path, 'must be a URI'))
        if TYPES['number'](inst):
            if 'minimum' in schema and inst < schema['minimum']:
                out.append((path, f'must be >= {schema["minimum"]}'))
            if 'maximum' in schema and inst > schema['maximum']:
                out.append((path, f'must be <= {schema["maximum"]}'))
        return out


def make_checker(registry):
    """Uses the jsonschema package when available (and not disabled), else MiniValidator."""
    if not os.environ.get('QUEST_NO_JSONSCHEMA'):
        try:
            import jsonschema  # type: ignore
            from jsonschema import Draft202012Validator, FormatChecker  # type: ignore

            try:
                from referencing import Registry, Resource  # type: ignore

                reg = Registry().with_resources([(k, Resource.from_contents(v)) for k, v in registry.items()])
                kwargs = {'registry': reg}
            except ImportError:
                kwargs = {'resolver': jsonschema.RefResolver('', {}, store=registry)}

            # Own format checks: jsonschema skips date-time/uri unless optional extras are installed.
            formats = FormatChecker()
            formats.checks('date-time')(lambda v: not isinstance(v, str) or bool(DATE_TIME.match(v)))
            formats.checks('uri')(lambda v: not isinstance(v, str) or _is_uri(v))

            def check(inst, schema_id):
                v = Draft202012Validator(registry[schema_id], format_checker=formats, **kwargs)
                return [('/' + '/'.join(map(str, e.absolute_path)), e.message) for e in v.iter_errors(inst)]

            return check, 'jsonschema'
        except ImportError:
            pass
    mini = MiniValidator(registry)
    return (lambda inst, schema_id: mini.errors(inst, registry[schema_id], schema_id)), 'built-in'


# ---------------------------------------------------------------- data tree

def classify(path):
    if path == 'data/settings.json':
        return ('settings', None, None, None)
    if path == 'data/inbox.json':
        return ('inbox', None, None, None)
    m = PROJECT_RE.match(path)
    if m:
        return ('project', m.group(1), None, None)
    m = WORLD_RE.match(path)
    if m:
        return ('world', m.group(1), m.group(2), None)
    m = LEVEL_RE.match(path)
    if m:
        return ('level', m.group(1), m.group(2), m.group(3))
    return None


def read_tree(root):
    """Every .json under ROOT/data, keyed by repo-relative posix path."""
    files = {}
    data = os.path.join(root, 'data')
    if not os.path.isdir(data):
        raise QuestError(f'No data/ folder in {os.path.abspath(root)}')
    for dirpath, _, names in os.walk(data):
        for n in sorted(names):
            if n.endswith('.json'):
                full = os.path.join(dirpath, n)
                rel = os.path.relpath(full, root).replace(os.sep, '/')
                with open(full, encoding='utf-8') as f:
                    files[rel] = f.read()
    return files


# ---------------------------------------------------------------- what a change adds and removes

def tree_keys(files):
    """{key: json} for everything with an id, keyed like 'level:p/w/l' or 'item:p/w/l/i'."""
    out = {}

    def put(key, value):
        out[key] = json.dumps(value, sort_keys=True)

    def load(text):
        try:
            return json.loads(text)
        except ValueError:
            return None

    for path, text in files.items():
        d = load(text)
        if not isinstance(d, dict):
            continue
        if path == 'data/inbox.json':
            for i in d.get('items') or []:
                put(f'inbox:{i.get("id")}', i)
            continue
        c = classify(path)
        if not c or c[0] == 'settings' or c[0] == 'inbox':
            continue
        kind, p, w, lv = c
        if kind == 'project':
            put(f'project:{p}', {k: v for k, v in d.items() if k not in ('goals', 'worldOrder')})
            for g in d.get('goals') or []:
                put(f'goal:{p}/{g.get("id")}', g)
        elif kind == 'world':
            put(f'world:{p}/{w}', {k: v for k, v in d.items() if k != 'levelOrder'})
        else:
            put(f'level:{p}/{w}/{lv}', {k: v for k, v in d.items() if k not in ('items', 'successCriteria', 'stats')})
            for cr in d.get('successCriteria') or []:
                put(f'criterion:{p}/{w}/{lv}/{cr.get("id")}', cr)
            for it in d.get('items') or []:
                put(f'item:{p}/{w}/{lv}/{it.get("id")}', {k: v for k, v in it.items() if k != 'subtasks'})
                for s in it.get('subtasks') or []:
                    put(f'step:{p}/{w}/{lv}/{it.get("id")}/{s.get("id")}', s)
    return out


def diff_trees(before, after):
    """(added, changed, removed) keys going from one data tree to another."""
    a, b = tree_keys(before), tree_keys(after)
    return (sorted(k for k in b if k not in a), sorted(k for k in b if k in a and a[k] != b[k]),
            sorted(k for k in a if k not in b))


def allowed(key, allow):
    """A removal is allowed if it's named, or sits inside something named (a level's items)."""
    kind, path = key.split(':', 1)
    for a in allow:
        akind, _, apath = a.partition(':')
        if (akind == kind and apath == path) or (akind in ('project', 'world', 'level', 'item') and path.startswith(apath + '/')):
            return True
    return False


def unapproved_removals(before, after, allow):
    return [k for k in diff_trees(before, after)[2] if not allowed(k, allow or [])]


def removal_error(keys, where):
    return QuestError(f'This would remove {len(keys)} thing(s) that exist on {where}:\n  ' + '\n  '.join(keys) +
                      '\nIf that is not what the user asked for, your copy is stale: update from the base branch and '
                      're-apply only your change. If it is, name each one with --allow-delete KEY (a level or world '
                      'also covers what is inside it).')


def find_cycle(items):
    deps = {i['id']: [d for d in i.get('dependsOn', [])] for i in items}
    state, stack = {}, []

    def visit(n):
        if state.get(n) == 2:
            return None
        if state.get(n) == 1:
            return stack[stack.index(n):] + [n]
        state[n] = 1
        stack.append(n)
        for d in deps.get(n, []):
            if d in deps:
                c = visit(d)
                if c:
                    return c
        stack.pop()
        state[n] = 2
        return None

    for n in deps:
        c = visit(n)
        if c:
            return c
    return None


def subtask_issues(lf, at, item, subs):
    """Rules for a dependency's subtasks (its warp-pipe sub-level)."""
    out = []
    if item['type'] != 'dependency':
        out.append((lf, f'{at}/subtasks', 'only dependency items can have subtasks'))
    if item.get('levelRef'):
        out.append((lf, f'{at}/subtasks', 'use levelRef or subtasks, not both'))
    ids = [t['id'] for t in subs]
    if len(set(ids)) != len(ids):
        out.append((lf, f'{at}/subtasks', 'duplicate subtask ids'))
    for k, t in enumerate(subs):
        for j, d in enumerate(t.get('dependsOn', [])):
            if d == t['id']:
                out.append((lf, f'{at}/subtasks/{k}/dependsOn/{j}', 'subtask depends on itself'))
            elif d not in ids:
                out.append((lf, f'{at}/subtasks/{k}/dependsOn/{j}', f'unknown subtask "{d}"'))
    cycle = find_cycle(subs)
    if cycle:
        out.append((lf, f'{at}/subtasks', 'dependency cycle: ' + ' -> '.join(cycle)))
    return out


def validate_files(files, registry, by_name):
    """Schema, folder structure, then cross-reference checks. Returns [(file, path, message)]."""
    check, _ = make_checker(registry)
    issues, parsed = [], {}
    projects, worlds, levels = set(), {}, {}
    for path, text in sorted(files.items()):
        kind = classify(path)
        if not kind:
            if path.startswith('data/') and path.endswith('.json'):
                issues.append((path, '/', 'unexpected file: use data/<project>/project.json, '
                                          'data/<project>/<world>/world.json, data/<project>/<world>/<level>.json, '
                                          'data/settings.json or data/inbox.json'))
            continue
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as e:
            issues.append((path, '/', f'invalid JSON: {e}'))
            continue
        parsed[path] = doc
        k, p, w, lv = kind
        issues += [(path, at, msg) for at, msg in check(doc, by_name[k])]
        if k == 'settings':
            continue
        if k == 'inbox':
            ids = [i.get('id') for i in doc.get('items', []) if isinstance(i, dict)] if isinstance(doc, dict) else []
            for dup in sorted({i for i in ids if ids.count(i) > 1}):
                issues.append((path, '/items', f'duplicate inbox item id "{dup}"'))
            continue
        expected = {'project': p, 'world': w, 'level': lv}[k]
        if isinstance(doc, dict) and doc.get('id') != expected:
            issues.append((path, '/id', f'id "{doc.get("id")}" must match its {"file name" if k == "level" else "folder"} "{expected}"'))
        if k == 'project':
            projects.add(p)
        elif k == 'world':
            worlds.setdefault(p, set()).add(w)
        elif lv == 'world':
            pass
        else:
            levels.setdefault((p, w), set()).add(lv)

    for p, ws in worlds.items():
        if p not in projects:
            issues += [(f'data/{p}/{w}/world.json', '/', f'no data/{p}/project.json for this world') for w in ws]
    for (p, w), ls in levels.items():
        if w not in worlds.get(p, set()):
            issues += [(f'data/{p}/{w}/{lv}.json', '/', f'no data/{p}/{w}/world.json for this level') for lv in ls]
    # Order lists may leave worlds and levels out (they go last), but can't name missing ones.
    for p in projects:
        order = (parsed.get(f'data/{p}/project.json') or {}).get('worldOrder') or []
        present = worlds.get(p, set())
        issues += [(f'data/{p}/project.json', f'/worldOrder/{i}', f'no data/{p}/{w}/world.json') for i, w in enumerate(order) if w not in present]
        for w in present:
            lorder = (parsed.get(f'data/{p}/{w}/world.json') or {}).get('levelOrder') or []
            lp = levels.get((p, w), set())
            issues += [(f'data/{p}/{w}/world.json', f'/levelOrder/{i}', f'no data/{p}/{w}/{lv}.json') for i, lv in enumerate(lorder) if lv not in lp]
    if issues:
        return issues

    # Cross references, now that the structure is sound.
    for p in projects:
        project = parsed[f'data/{p}/project.json']
        goal_ids = [g['id'] for g in project['goals']]
        if len(set(goal_ids)) != len(goal_ids):
            issues.append((f'data/{p}/project.json', '/goals', 'duplicate goal ids'))
        wids = worlds.get(p, set())
        all_levels = {(w, lv) for w in wids for lv in levels.get((p, w), set())}
        for w in wids:
            wf = f'data/{p}/{w}/world.json'
            world = parsed[wf]
            for i, g in enumerate(world['goalIds']):
                if g not in goal_ids:
                    issues.append((wf, f'/goalIds/{i}', f'unknown goal "{g}"'))
            for i, u in enumerate(world.get('unlocksAfter', [])):
                if u == w or u not in wids:
                    issues.append((wf, f'/unlocksAfter/{i}', f'invalid world reference "{u}"'))
            for lv in sorted(levels.get((p, w), set())):
                lf = f'data/{p}/{w}/{lv}.json'
                level = parsed[lf]
                ids = [i['id'] for i in level['items']]
                if len(set(ids)) != len(ids):
                    issues.append((lf, '/items', 'duplicate item ids'))
                cids = [c['id'] for c in level['successCriteria']]
                if len(set(cids)) != len(cids):
                    issues.append((lf, '/successCriteria', 'duplicate criterion ids'))
                if not any(c['mvp'] for c in level['successCriteria']):
                    issues.append((lf, '/successCriteria', 'at least one criterion must have mvp: true'))
                for n, item in enumerate(level['items']):
                    for j, d in enumerate(item.get('dependsOn', [])):
                        if d == item['id']:
                            issues.append((lf, f'/items/{n}/dependsOn/{j}', 'item depends on itself'))
                        elif d not in ids:
                            issues.append((lf, f'/items/{n}/dependsOn/{j}', f'unknown item "{d}"'))
                    ref = item.get('levelRef')
                    if ref and tuple(ref.split('/', 1)) not in all_levels:
                        issues.append((lf, f'/items/{n}/levelRef', f'unknown level "{ref}" in this project'))
                    elif ref and tuple(ref.split('/', 1)) == (w, lv):
                        issues.append((lf, f'/items/{n}/levelRef', 'a level cannot depend on itself'))
                    subs = item.get('subtasks')
                    if subs is not None:
                        issues += subtask_issues(lf, f'/items/{n}', item, subs)
                cycle = find_cycle(level['items'])
                if cycle:
                    issues.append((lf, '/items', 'dependency cycle: ' + ' -> '.join(cycle)))
    return issues


# ---------------------------------------------------------------- GitHub

def git_blob_sha(text):
    data = text.encode('utf-8')
    return hashlib.sha1(b'blob %d\x00' % len(data) + data).hexdigest()


class GitHub:
    def __init__(self, repo):
        token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
        if not token:
            raise QuestError('Set GITHUB_TOKEN to a fine-grained token for the data repo.')
        if not re.match(r'^[\w.-]+/[\w.-]+$', repo or ''):
            raise QuestError('Repo must look like owner/repo.')
        self.token, self.repo = token, repo
        self.base = f'{API}/repos/{repo}'

    def call(self, method, url, body=None, raw=False):
        url = url if url.startswith('http') else self.base + url
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': f'Bearer {self.token}',
            'Accept': 'application/vnd.github.raw+json' if raw else 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'quest-log-skill',
            **({'Content-Type': 'application/json'} if data else {}),
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                payload = res.read()
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get('message', '')
            except Exception:
                msg = ''
            raise GitHubError(e.code, f'{method} {url.replace(API, "")}: {e.code} {msg}'.strip()) from None
        except urllib.error.URLError as e:
            raise QuestError(f'Cannot reach {API} ({e.reason}). If this sandbox has no internet, validate locally and hand the files to the user.')
        if raw:
            return payload.decode('utf-8')
        return json.loads(payload) if payload else None

    def info(self):
        return self.call('GET', '')

    def has_commits(self):
        # Ask the commit log, not the repo's `size`: GitHub computes that lazily and
        # rounds to whole KB, so a fresh repo with just a README can still report 0.
        try:
            self.call('GET', '/commits?per_page=1')
            return True
        except GitHubError as e:
            if e.status == 409:  # "Git Repository is empty"
                return False
            raise

    def head(self, branch):
        return self.call('GET', f'/git/ref/heads/{urllib.parse.quote(branch)}')['object']['sha']

    def data_blobs(self, sha):
        """{path: blob sha} for data files at a commit."""
        tree = self.call('GET', f'/git/trees/{sha}?recursive=1')
        return {e['path']: e['sha'] for e in tree['tree'] if e['type'] == 'blob' and classify(e['path'])}

    def blob(self, sha):
        return self.call('GET', f'/git/blobs/{sha}', raw=True)

    def open_pull(self, branch):
        """The open pull request whose head is `branch` in this repo, if any."""
        owner = self.repo.split('/')[0]
        pulls = self.call('GET', f'/pulls?state=open&head={urllib.parse.quote(f"{owner}:{branch}")}')
        return pulls[0] if pulls else None

    def merge(self, into, source):
        """Merges `source` into branch `into`. True if that made a merge commit, False if already up to date."""
        r = self.call('POST', '/merges', {'base': into, 'head': source, 'commit_message': f'Merge {source} into {into}'})
        return r is not None

    def commit(self, changes, message, parent, branch, create_branch=False):
        tree_sha = self.call('GET', f'/git/commits/{parent}')['tree']['sha']
        entries = [{'path': p, 'mode': '100644', 'type': 'blob', **({'sha': None} if c is None else {'content': c})}
                   for p, c in sorted(changes.items())]
        tree = self.call('POST', '/git/trees', {'base_tree': tree_sha, 'tree': entries})['sha']
        new = self.call('POST', '/git/commits', {'message': message, 'tree': tree, 'parents': [parent]})['sha']
        if create_branch:
            self.call('POST', '/git/refs', {'ref': f'refs/heads/{branch}', 'sha': new})
        else:
            self.call('PATCH', f'/git/refs/heads/{urllib.parse.quote(branch)}', {'sha': new, 'force': False})
        return new


class GitHubError(QuestError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- skill updates

def latest_skill():
    """The published version.json, or None when the site can't be reached."""
    try:
        return json.loads(_http_get(urllib.parse.urljoin(SITE, 'skills/quest-log/version.json')))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def outdated_warning(latest):
    return (f'SKILL OUTDATED: this copy is version {SKILL_VERSION}, the published skill is version {latest["version"]}. '
            f'Stop and load the latest SKILL.md ({latest.get("skill")}) and quest.py ({latest.get("script")}) '
            'before doing anything else, and ask the user to reinstall the skill.')


# ---------------------------------------------------------------- commands

def cmd_update_check(args):
    latest = latest_skill()
    report = {'installed': SKILL_VERSION, 'latest': latest and latest.get('version'), 'checked': latest is not None}
    if latest:
        report.update({'outdated': latest['version'] > SKILL_VERSION, 'skill': latest.get('skill'), 'script': latest.get('script')})
    print(json.dumps(report, indent=2))
    if not latest:
        print(f'warning: could not reach {SITE} to check for a newer skill', file=sys.stderr)
        return 4
    if report['outdated']:
        print(outdated_warning(latest), file=sys.stderr)
        return 3
    return 0


def cmd_validate(args):
    registry, by_name, d = load_registry(args.schemas, args.refresh)
    files = read_tree(args.dir)
    issues = validate_files(files, registry, by_name)
    _, engine = make_checker(registry)
    if issues:
        for f, at, msg in issues:
            print(f'{f}{at}: {msg}')
        print(f'\n✗ {len(issues)} issue(s) in {len(files)} file(s)', file=sys.stderr)
        return 1
    print(f'✓ {len(files)} data file(s) valid (schemas: {d}, validator: {engine})')
    latest = latest_skill() if args.refresh else None
    if latest and latest.get('version', 0) > SKILL_VERSION:
        print(outdated_warning(latest), file=sys.stderr)
    return 0


def cmd_info(args):
    gh = GitHub(args.repo)
    r = gh.info()
    print(json.dumps({
        'repo': r.get('full_name', args.repo),
        'default_branch': r.get('default_branch'),
        'can_push': bool((r.get('permissions') or {}).get('push')),
        'private': r.get('private'),
        'empty': not gh.has_commits(),
    }, indent=2))
    return 0


def cmd_pull(args):
    gh = GitHub(args.repo)
    info = gh.info()
    if not gh.has_commits():
        raise QuestError('That repo has no commits yet. Add a README on GitHub first.')
    branch = args.branch or info['default_branch']
    sha = gh.head(branch)
    blobs = gh.data_blobs(sha)
    root = args.dir
    data = os.path.join(root, 'data')
    if os.path.isdir(data) and not args.force and os.path.exists(os.path.join(root, BASE_FILE)):
        _, _, dirty = local_changes(root)
        if dirty:
            raise QuestError(f'Unpushed local changes in {len(dirty)} file(s); push them first or pass --force.')
    write_tree(root, {path: gh.blob(blob) for path, blob in blobs.items()})
    with open(os.path.join(root, BASE_FILE), 'w') as f:
        json.dump({'repo': args.repo, 'branch': branch, 'sha': sha, 'files': blobs}, f, indent=2)
    print(f'Pulled {len(blobs)} data file(s) from {args.repo}@{branch} ({sha[:7]}) into {os.path.abspath(root)}')
    print(f'Can push: {bool((info.get("permissions") or {}).get("push"))}')
    return 0


def write_tree(root, files):
    """Replaces every data file under root/data with `files` ({path: text})."""
    data = os.path.join(root, 'data')
    if os.path.isdir(data):
        for dirpath, _, names in os.walk(data):
            for n in names:
                if n.endswith('.json'):
                    os.remove(os.path.join(dirpath, n))
    for path, text in sorted(files.items()):
        full = os.path.join(root, *path.split('/'))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)


def local_changes(root):
    base_path = os.path.join(root, BASE_FILE)
    if not os.path.exists(base_path):
        raise QuestError(f'No {BASE_FILE} in {root}: run pull first.')
    base = json.load(open(base_path))
    local = read_tree(root)
    changes = {p: t for p, t in local.items() if base['files'].get(p) != git_blob_sha(t)}
    changes.update({p: None for p in base['files'] if p not in local})
    return base, local, changes


def cmd_status(args):
    base, _, changes = local_changes(args.dir)
    print(f'{base["repo"]}@{base["branch"]} base {base["sha"][:7]}')
    for p, c in sorted(changes.items()):
        print(f'  {"deleted " if c is None else "changed "} {p}')
    if not changes:
        print('  no local changes')
    return 0


def _issues(files, schemas):
    registry, by_name, _ = load_registry(schemas, False)
    return validate_files(files, registry, by_name)


def _report(issues, what):
    for f, at, msg in issues:
        print(f'{f}{at}: {msg}')
    raise QuestError(f'{len(issues)} validation issue(s) {what}; fix them before pushing.')


def update_pr_branch(gh, branch):
    """Brings a pull request's base branch into its head branch before adding commits to it."""
    try:
        pr = gh.open_pull(branch)
    except GitHubError as e:
        print(f'warning: could not look up pull requests for {branch} ({e}); not updating it from its base', file=sys.stderr)
        return
    if not pr:
        return
    target = pr['base']['ref']
    try:
        merged = gh.merge(branch, target)
    except GitHubError as e:
        if e.status == 409:
            raise QuestError(f'Pull request #{pr["number"]} ({branch}) conflicts with {target}. Pull {target}, re-apply the '
                             f'pull request\'s changes on top, and commit them to {branch} as a merge, or ask the user.')
        raise
    print(f'Updated pull request #{pr["number"]} ({branch}) from {target}' if merged else f'{branch} is up to date with {target}')


def git_tree(root, ref):
    """Data files at a git ref of the checkout in root."""
    def git(*a):
        r = subprocess.run(['git', '-C', root, *a], capture_output=True)
        if r.returncode:
            raise QuestError(f'git {" ".join(a)}: {r.stderr.decode().strip()}')
        return r.stdout.decode('utf-8')
    return {p: git('show', f'{ref}:{p}') for p in git('ls-tree', '-r', '--name-only', ref, '--', 'data').splitlines() if classify(p)}


def cmd_changes(args):
    if args.git:
        before, after_dir = git_tree(args.paths[0], args.git), args.paths[0]
    elif len(args.paths) == 2:
        before, after_dir = read_tree(args.paths[0]), args.paths[1]
    else:
        raise QuestError('Give BASE and DIR, or --git REF and DIR.')
    added, changed, removed = diff_trees(before, read_tree(after_dir))
    for label, keys in (('added', added), ('changed', changed), ('removed', removed)):
        for k in keys:
            print(f'{label:8} {k}')
    if not (added or changed or removed):
        print('no changes')
    bad = [k for k in removed if not allowed(k, args.allow_delete or [])]
    if bad and not args.warn:
        print(f'\n✗ {len(bad)} removal(s) not named with --allow-delete', file=sys.stderr)
        return 5
    return 0


def cmd_push(args):
    base, local, changes = local_changes(args.dir)
    if not changes:
        print('Nothing to push.')
        return 0
    # Validation is not optional: nothing reaches GitHub unless the whole tree passes.
    issues = _issues(local, args.schemas)
    if issues:
        _report(issues, 'in your files')
    gh = GitHub(base['repo'])
    if not args.pr:
        update_pr_branch(gh, base['branch'])
    for attempt in range(3):
        head = gh.head(base['branch'])
        result = dict(local)
        remote = base['files']
        if head != base['sha']:
            # The branch moved: fine unless someone changed the same files.
            remote = gh.data_blobs(head)
            clashes = [p for p in changes if remote.get(p) != base['files'].get(p)]
            if clashes:
                raise QuestError('Remote changed the same file(s) since your pull: ' + ', '.join(sorted(clashes)) +
                                 '. Run pull --force, re-apply your edits, then push again.')
            # What the branch will hold after this commit: the latest files plus your changes.
            result = {p: (local[p] if base['files'].get(p) == sha and p in local else gh.blob(sha))
                      for p, sha in remote.items() if p not in changes}
            result.update({p: c for p, c in changes.items() if c is not None})
            upstream = sorted(p for p in set(remote) | set(base['files']) if p not in changes and remote.get(p) != base['files'].get(p))
            print(f'{base["branch"]} moved to {head[:7]} since your pull ({len(upstream)} data file(s) changed there); '
                  'validating your changes on top of it')
            issues = _issues(result, args.schemas)
            if issues:
                _report(issues, f'once your changes are combined with the latest {base["branch"]}')
        # Nothing on the branch disappears unless the user asked for it.
        before = {p: (gh.blob(sha) if p in changes else result[p]) for p, sha in remote.items()}
        bad = unapproved_removals(before, result, args.allow_delete)
        if bad:
            raise removal_error(bad, f'{base["branch"]}@{head[:7]}')
        if args.pr:
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
            branch = f'quest/{re.sub(r"[^a-z0-9]+", "-", args.pr.lower()).strip("-")[:40]}-{stamp}'
            gh.commit(changes, args.message, head, branch, create_branch=True)
            pr = gh.call('POST', '/pulls', {'title': args.pr, 'head': branch, 'base': base['branch'],
                                            'body': args.body or args.message})
            print(f'Opened pull request #{pr["number"]} from {base["branch"]}@{head[:7]}: {pr["html_url"]}')
            return 0
        try:
            new = gh.commit(changes, args.message, head, base['branch'])
        except GitHubError as e:
            if e.status == 422 and attempt < 2:
                time.sleep(1)
                continue  # Lost a race: re-check and retry.
            raise
        # Bring the folder up to date with what the branch now holds.
        write_tree(args.dir, result)
        files = {p: s for p, s in remote.items() if p not in changes}
        files.update({p: git_blob_sha(c) for p, c in changes.items() if c is not None})
        with open(os.path.join(args.dir, BASE_FILE), 'w') as f:
            json.dump({**base, 'sha': new, 'files': files}, f, indent=2)
        print(f'Committed {len(changes)} file(s) to {base["repo"]}@{base["branch"]}: {new[:7]} "{args.message.splitlines()[0]}"')
        return 0
    raise QuestError('Branch kept moving; try again.')


def cmd_schemas(args):
    registry, by_name, d = load_registry(args.schemas, args.refresh)
    _, engine = make_checker(registry)
    print(json.dumps({'directory': d, 'schemas': by_name, 'validator': engine}, indent=2))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog='quest.py', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--schemas', help='directory with index.json and the schema files (default: bundled, repo, cache or download)')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('update-check', help='compare this skill with the published one (exit 3 = outdated, 4 = could not check)')
    p.set_defaults(run=cmd_update_check)

    p = sub.add_parser('validate', help='validate a data tree')
    p.add_argument('dir', nargs='?', default='.', help='folder containing data/ (default: .)')
    p.add_argument('--refresh', action='store_true', help='download the latest schemas first and check for a newer skill')
    p.set_defaults(run=cmd_validate)

    p = sub.add_parser('info', help='repo default branch and push access')
    p.add_argument('--repo', required=True)
    p.set_defaults(run=cmd_info)

    p = sub.add_parser('pull', help='download data/ from GitHub')
    p.add_argument('--repo', required=True)
    p.add_argument('--branch')
    p.add_argument('--dir', default='quest-data')
    p.add_argument('--force', action='store_true', help='discard unpushed local changes')
    p.set_defaults(run=cmd_pull)

    p = sub.add_parser('status', help='local changes since pull')
    p.add_argument('--dir', default='quest-data')
    p.set_defaults(run=cmd_status)

    p = sub.add_parser('push', help='validate and commit local changes (one commit, or a pull request)')
    p.add_argument('--dir', default='quest-data')
    p.add_argument('-m', '--message', required=True, help='commit message, e.g. "quest: done: Fit units (kitchen/fit/units)"')
    p.add_argument('--pr', metavar='TITLE', help='open a pull request instead of committing to the branch')
    p.add_argument('--body', help='pull request description')
    p.add_argument('--allow-delete', action='append', metavar='KEY', help='a removal you mean to make, e.g. level:p/w/l or inbox:idea (repeat)')
    p.set_defaults(run=cmd_push)

    p = sub.add_parser('changes', help='what a data tree adds, changes and removes compared with another (exit 5 = removals not allowed)')
    p.add_argument('paths', nargs='+', metavar='DIR', help='BASE DIR, or just DIR with --git')
    p.add_argument('--git', metavar='REF', help='compare the checkout in DIR with this git ref, e.g. origin/main')
    p.add_argument('--allow-delete', action='append', metavar='KEY', help='a removal you mean to make (repeat)')
    p.add_argument('--warn', action='store_true', help='list removals but exit 0 (for CI)')
    p.set_defaults(run=cmd_changes)

    p = sub.add_parser('schemas', help='show where schemas are loaded from')
    p.add_argument('--refresh', action='store_true')
    p.set_defaults(run=cmd_schemas)

    args = ap.parse_args(argv)
    try:
        return args.run(args)
    except QuestError as e:
        print(f'error: {e}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
