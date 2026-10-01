import { BASE_URL, repoRef } from '../config';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';
import { zip } from './zip';

const SKILL_PATH = 'skills/quest-log/SKILL.md';

/** Absolute URL of the published skill, for pasting into assistants. */
export function skillUrl(): string {
  return new URL(`${BASE_URL}${SKILL_PATH}`, location.href.split('#')[0]).href;
}

async function skillText(): Promise<string> {
  const res = await fetch(`${BASE_URL}${SKILL_PATH}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn't load SKILL.md (${res.status})`);
  return res.text();
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
    toast('Skill link copied', 'win');
  });
  const mdBtn = h('button', { class: 'btn sm', type: 'button' }, 'Download SKILL.md');
  mdBtn.onclick = busy(mdBtn, async () => download('SKILL.md', await skillText(), 'text/markdown'));
  const zipBtn = h('button', { class: 'btn sm primary', type: 'button' }, 'Download Claude skill (.zip)');
  zipBtn.onclick = busy(zipBtn, async () =>
    download('quest-log-skill.zip', zip({ 'quest-log/SKILL.md': await skillText() }) as BlobPart, 'application/zip'),
  );

  const body = h(
    'div',
    { class: 'skill-help' },
    h('h3', null, 'How it works'),
    h(
      'ul',
      null,
      h('li', null, 'The skill is one file, ', code('SKILL.md'), '. It teaches an AI assistant Quest Log’s folders and schema, how to plan small "good enough" levels, and how to read and commit your data through the GitHub API.'),
      h('li', null, 'Then just ask in plain words: ', h('i', null, '"Plan my kitchen renovation as a Quest Log project"'), ', ', h('i', null, '"Mark Order tiles as done"'), ', ', h('i', null, '"Add a blocker to Demolition"'), '. The assistant edits the right JSON files and commits them, or opens a pull request you can review in the Warp Zone.'),
      h('li', null, 'It works on whichever repo holds your data (yours is ', h('b', null, repoName), '). Tell the assistant the repo, and give it a fine-grained token limited to that repo (Contents: read & write, plus Pull requests if you want PRs).'),
      h('li', null, 'Assistants that can’t make web requests give you the finished files instead, for you to commit. The app and CI validate everything, so mistakes are caught.'),
    ),
    h('div', { class: 'actions' }, zipBtn, mdBtn, copyBtn),
    h('p', { class: 'muted' }, 'Skill link: ', h('a', { href: skillUrl(), target: '_blank', rel: 'noopener', class: 'link' }, skillUrl())),

    h('h3', null, 'Claude'),
    h('h4', null, 'claude.ai on the web and the desktop app'),
    steps(
      ['Download the ', h('b', null, 'Claude skill (.zip)'), ' above.'],
      ['Open ', h('b', null, 'Settings → Capabilities'), '. Make sure code execution / file creation is switched on (skills need it).'],
      ['Under ', h('b', null, 'Skills'), ', choose ', h('b', null, 'Upload skill'), ' and pick ', code('quest-log-skill.zip'), '.'],
      ['Start a chat and ask, e.g. ', h('i', null, '"Use the quest-log skill to add a task to my Kitchen world in ' + repoName + '"'), '.'],
    ),
    h('h4', null, 'Claude on iPhone / Android'),
    h('p', null, 'Skills belong to your account: upload it once on the web or desktop, and it’s available in the mobile apps too.'),
    h('h4', null, 'Claude Code'),
    steps(
      ['Save ', code('SKILL.md'), ' as ', code('~/.claude/skills/quest-log/SKILL.md'), ' (or ', code('.claude/skills/quest-log/SKILL.md'), ' inside a project).'],
      ['Claude Code picks it up automatically; ask it to update your quests and it will use the GitHub API or edit a local clone of your data repo.'],
    ),

    h('h3', null, 'ChatGPT'),
    h('h4', null, 'Desktop app or chatgpt.com'),
    steps(
      ['Download ', code('SKILL.md'), ' above.'],
      ['Create a ', h('b', null, 'Project'), ' (sidebar → New project), add ', code('SKILL.md'), ' as a project file, and set the project instructions to ', h('i', null, '"Follow SKILL.md for all Quest Log requests. My data repo is ' + repoName + '."')],
      ['Chat inside that project. Alternatively, make a custom GPT (', h('b', null, 'Explore GPTs → Create'), ') with ', code('SKILL.md'), ' under Knowledge and the same instruction.'],
    ),
    h('h4', null, 'ChatGPT on iPhone'),
    steps(
      ['Projects and custom GPTs you set up on the web or desktop sync to the iOS app: open the project (or GPT) and chat as usual.'],
      ['For a one-off chat: save ', code('SKILL.md'), ' to Files, tap ', h('b', null, '+'), ' in a chat to attach it, and say ', h('i', null, '"Follow this skill"'), '. Creating custom GPTs isn’t available in the iOS app.'],
    ),
    h('p', { class: 'muted' }, 'ChatGPT usually can’t call the GitHub API from a chat, so expect it to hand you complete files to commit (or paste into a pull request).'),
    h('p', { class: 'muted' }, 'Menu names change between app versions; look for the closest match. Never paste a token that can access more than your data repo.'),
  );
  openModal('Use Quest Log with an AI assistant', body);
}
