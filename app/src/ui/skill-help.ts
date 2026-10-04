import { track } from '../analytics';
import { BASE_URL, fetchText, repoRef } from '../config';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';
import { zip } from './zip';

const SKILL_PATH = 'skills/quest-log/SKILL.md';
const SCRIPT_PATH = 'skills/quest-log/scripts/quest.py';
const MANIFEST_PATH = 'schema/index.json';

/** Absolute URL of the published skill, for pasting into assistants. */
export function skillUrl(): string {
  return new URL(`${BASE_URL}${SKILL_PATH}`, location.href.split('#')[0]).href;
}

const text = (path: string) => fetchText(`${BASE_URL}${path}`);

const skillText = () => text(SKILL_PATH);

/**
 * The skill folder as Claude expects it: SKILL.md, the helper script, and the
 * schemas (listed by the manifest) so validation works without internet.
 */
export async function skillPackage(): Promise<Record<string, string>> {
  const manifest = JSON.parse(await text(MANIFEST_PATH)) as { schemas: { file: string }[] };
  const files: Record<string, string> = {
    'quest-log/SKILL.md': await skillText(),
    'quest-log/scripts/quest.py': await text(SCRIPT_PATH),
    'quest-log/schemas/index.json': JSON.stringify(manifest, null, 2) + '\n',
  };
  await Promise.all(manifest.schemas.map(async (s) => (files[`quest-log/schemas/${s.file}`] = await text(`schema/${s.file}`))));
  return files;
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const steps = (...items: (string | Node)[][]) => h('ol', { class: 'steps' }, items.map((i) => h('li', null, ...i)));
const code = (s: string) => h('code', null, s);

/** How to install SKILL.md in Claude or ChatGPT, and what it does. */
export function skillHelpDialog() {
  track('skill_help_open');
  const repo = repoRef();
  const repoName = repo ? `${repo.owner}/${repo.repo}` : 'your data repo';
  const busy = (btn: HTMLButtonElement, run: () => Promise<void>) => async () => {
    btn.disabled = true;
    try {
      await run();
    } catch (err) {
      toast((err as Error).message, 'alert', 6000);
    } finally {
      btn.disabled = false;
    }
  };

  const copyBtn = h('button', { class: 'btn sm', type: 'button' }, 'Copy link');
  copyBtn.onclick = busy(copyBtn, async () => {
    await navigator.clipboard.writeText(skillUrl());
    track('skill_download', { format: 'link' });
    toast('Skill link copied', 'win');
  });
  const mdBtn = h('button', { class: 'btn sm', type: 'button' }, 'Download SKILL.md');
  mdBtn.onclick = busy(mdBtn, async () => {
    download('SKILL.md', await skillText(), 'text/markdown');
    track('skill_download', { format: 'md' });
  });
  const zipBtn = h('button', { class: 'btn sm primary', type: 'button' }, 'Download skill (.zip)');
  zipBtn.onclick = busy(zipBtn, async () => {
    download('quest-log-skill.zip', zip(await skillPackage()) as BlobPart, 'application/zip');
    track('skill_download', { format: 'zip' });
  });
  const pyBtn = h('button', { class: 'btn sm', type: 'button' }, 'Download quest.py');
  pyBtn.onclick = busy(pyBtn, async () => {
    download('quest.py', await text(SCRIPT_PATH), 'text/x-python');
    track('skill_download', { format: 'py' });
  });

  const body = h(
    'div',
    { class: 'skill-help' },
    h('h3', null, 'How it works'),
    h(
      'ul',
      null,
      h('li', null, code('SKILL.md'), ' teaches an AI assistant Quest Log’s folders and schema and how to plan small "good enough" levels. The bundled ', code('quest.py'), ' does the mechanical parts: validating files and reading or committing them through the GitHub API.'),
      h('li', null, 'Then just ask in plain words: ', h('i', null, '"Plan my kitchen renovation as a Quest Log project"'), ', ', h('i', null, '"Mark Order tiles as done"'), ', ', h('i', null, '"Add a blocker to Demolition"'), '. The assistant edits the right JSON files and commits them, or opens a pull request you can review in the Warp Zone.'),
      h('li', null, 'It works on whichever repo holds your data (yours is ', h('b', null, repoName), '). Tell the assistant the repo. If it has its own GitHub access (ChatGPT’s GitHub connector or Codex, Claude’s GitHub integration, Claude Code), it uses that; otherwise give it a fine-grained token limited to that repo (Contents: read & write, plus Pull requests if you want PRs).'),
      h('li', null, 'Not sure where something goes? Just say it: the assistant drops unclear ideas into your ', h('b', null, 'Inbox'), ' page for you to sort later.'),
      h('li', null, 'Assistants that can’t make web requests give you the finished files instead, for you to commit. The assistant validates every change against the schema first, and the app and CI check again, so mistakes are caught.'),
      h('li', null, 'The skill checks for a newer version before each job. If yours is out of date, the assistant uses the latest one and asks you to download and reinstall it from here.'),
    ),
    h('div', { class: 'actions' }, zipBtn, mdBtn, pyBtn, copyBtn),
    h(
      'p',
      { class: 'muted' },
      'The zip contains ',
      code('SKILL.md'),
      ', ',
      code('scripts/quest.py'),
      ' (a dependency-free Python helper that validates data and pulls/pushes it through the GitHub API) and the JSON schemas, so it works offline too. The schemas are also listed at ',
      h('a', { href: `${BASE_URL}${MANIFEST_PATH}`, target: '_blank', rel: 'noopener', class: 'link' }, 'schema/index.json'),
      '.',
    ),
    h('p', { class: 'muted' }, 'Skill link: ', h('a', { href: skillUrl(), target: '_blank', rel: 'noopener', class: 'link' }, skillUrl())),

    h('h3', null, 'Claude'),
    h('h4', null, 'claude.ai on the web and the desktop app'),
    steps(
      ['Download the ', h('b', null, 'skill (.zip)'), ' above.'],
      ['Open ', h('b', null, 'Settings → Capabilities'), '. Make sure code execution / file creation is switched on (skills need it).'],
      ['Under ', h('b', null, 'Skills'), ', choose ', h('b', null, 'Upload skill'), ' and pick ', code('quest-log-skill.zip'), '.'],
      ['Start a chat and ask, e.g. ', h('i', null, '"Use the quest-log skill to add a task to my Kitchen world in ' + repoName + '"'), '.'],
    ),
    h('h4', null, 'Claude on iPhone / Android'),
    h('p', null, 'Skills belong to your account: upload it once on the web or desktop, and it’s available in the mobile apps too.'),
    h('h4', null, 'Claude Code'),
    steps(
      ['Unzip the skill into ', code('~/.claude/skills/'), ' so you have ', code('~/.claude/skills/quest-log/SKILL.md'), ' (or use ', code('.claude/skills/'), ' inside a project).'],
      ['Claude Code picks it up automatically and runs ', code('quest.py'), ' with your ', code('GITHUB_TOKEN'), ' to pull, edit and push your data.'],
    ),

    h('h3', null, 'ChatGPT'),
    h('h4', null, 'Desktop app or chatgpt.com'),
    steps(
      ['Download ', code('SKILL.md'), ' and the ', h('b', null, 'skill (.zip)'), ' above.'],
      ['Create a ', h('b', null, 'Project'), ' (sidebar → New project), add both as project files, and set the project instructions to ', h('i', null, '"Follow SKILL.md for all Quest Log requests. Unzip quest-log-skill.zip to use scripts/quest.py. My data repo is ' + repoName + '."')],
      ['Chat inside that project. Alternatively, make a custom GPT (', h('b', null, 'Explore GPTs → Create'), ') with ', code('SKILL.md'), ' under Knowledge and the same instruction.'],
    ),
    h('h4', null, 'ChatGPT on iPhone'),
    steps(
      ['Projects and custom GPTs you set up on the web or desktop sync to the iOS app: open the project (or GPT) and chat as usual.'],
      ['For a one-off chat: save ', code('SKILL.md'), ' to Files, tap ', h('b', null, '+'), ' in a chat to attach it, and say ', h('i', null, '"Follow this skill"'), '. Creating custom GPTs isn’t available in the iOS app.'],
    ),
    h('p', { class: 'muted' }, 'ChatGPT’s code interpreter has no internet access, so it runs ', code('quest.py validate'), ' against the schemas bundled in the zip to check its work, then hands you complete files to commit or paste into a pull request.'),
    h('p', { class: 'muted' }, 'Menu names change between app versions; look for the closest match. Never paste a token that can access more than your data repo.'),
  );
  openModal('Use Quest Log with an AI assistant', body);
}
