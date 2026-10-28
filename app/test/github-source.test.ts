import { GitHubClient, renderStub, STUB_PATH } from '@quest/shared';
import { describe, expect, it } from 'vitest';
import { GitHubSource } from '../src/data/github';

const CONFIG = 'data/automation.json';

/** A repo whose head holds `workflow`, answering just what a commit needs. */
function source(workflow: string | undefined, refuseWorkflows = false) {
  const trees: { path: string }[][] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const reply = (status: number, body: unknown, text = false) =>
      ({ ok: status < 300, status, statusText: String(status), json: async () => body, text: async () => (text ? body : JSON.stringify(body)) }) as Response;
    if (url.includes('/contents/.github/workflows/quest.yml')) return workflow === undefined ? reply(404, { message: 'Not Found' }) : reply(200, workflow, true);
    if (url.endsWith('/git/commits/head')) return reply(200, { tree: { sha: 't0' } });
    if (url.endsWith('/git/trees')) {
      const tree = JSON.parse(String(init.body)).tree;
      trees.push(tree);
      return reply(201, { sha: `t${trees.length}` });
    }
    if (url.endsWith('/git/commits')) return reply(201, { sha: `c${trees.length}` });
    if (url.endsWith('/git/refs/heads/main')) {
      const touches = trees.at(-1)!.some((e) => e.path === STUB_PATH);
      return refuseWorkflows && touches
        ? reply(422, { message: 'refusing to allow a GitHub App to create or update workflow `.github/workflows/quest.yml` without `workflows` permission' })
        : reply(200, {});
    }
    return reply(404, { message: `unexpected ${url}` });
  }) as typeof fetch;
  const src = new GitHubSource('tok', { owner: 'o', repo: 'r', branch: 'main' });
  src.client = new GitHubClient('tok', src.client.repo, fetchImpl);
  return { src, paths: () => trees.map((t) => t.map((e) => e.path)) };
}

const beta = JSON.stringify({ channel: 'beta' });

describe('GitHubSource.commit', () => {
  it('re-renders our workflow into the same commit when automation.json changes', async () => {
    const { src, paths } = source(renderStub(undefined).text);
    await src.commit({ [CONFIG]: beta }, 'quest: automation: channel = beta', 'head');
    expect(paths()).toEqual([[CONFIG, STUB_PATH]]);
  });

  it('leaves a missing, foreign or newer workflow alone', async () => {
    for (const workflow of [undefined, 'name: CI\non: push\n', renderStub(undefined).text.replace('quest-stub: 1', 'quest-stub: 99')]) {
      const { src, paths } = source(workflow);
      await src.commit({ [CONFIG]: beta }, 'msg', 'head');
      expect(paths()).toEqual([[CONFIG]]);
    }
  });

  it('skips the workflow when it would not change, and when other files change', async () => {
    const { src, paths } = source(renderStub({ channel: 'beta' }).text);
    await src.commit({ [CONFIG]: beta }, 'msg', 'head');
    await src.commit({ 'data/settings.json': '{}' }, 'msg', 'head');
    expect(paths()).toEqual([[CONFIG], ['data/settings.json']]);
  });

  it('still saves the settings when the app may not write workflows yet', async () => {
    const { src, paths } = source(renderStub(undefined).text, true);
    expect(await src.commit({ [CONFIG]: beta }, 'msg', 'head')).toBe('c2');
    expect(paths()).toEqual([[CONFIG, STUB_PATH], [CONFIG]]);
  });
});
