import Phaser from 'phaser';
import type { App } from '../app';
import type { Route } from '../router';
import { BootScene } from './boot';
import { LevelScene } from './level';
import { OverworldScene } from './overworld';
import { ProjectsScene } from './projects';
import { WorldScene } from './world';

function sceneFor(route: Route): { key: string; params: object } {
  switch (route.view) {
    case 'projects':
    case 'prs':
      return { key: 'projects', params: {} };
    case 'overworld':
      return { key: 'overworld', params: { projectId: route.projectId } };
    case 'world':
      return { key: 'world', params: { projectId: route.projectId, worldId: route.worldId } };
    case 'pr':
      return { key: 'world', params: { pr: route.pr } };
    case 'level':
      return { key: 'level', params: { projectId: route.projectId, worldId: route.worldId, levelId: route.levelId } };
    case 'pr-level':
      return {
        key: 'level',
        params: { projectId: route.projectId, worldId: route.worldId, levelId: route.levelId, pr: route.pr },
      };
  }
}

/** Boots Phaser in `parent` and keeps the active scene in step with the route. */
export function startGame(app: App, parent: HTMLElement) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#5c94fc',
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    scene: [BootScene, ProjectsScene, OverworldScene, WorldScene, LevelScene],
    banner: false,
    input: { mouse: { preventDefaultWheel: true } },
  });
  game.registry.set('app', app);

  let current = '';
  const sync = () => {
    const { key, params } = sceneFor(app.route);
    const sig = `${key}:${JSON.stringify(params)}`;
    // Level/world scenes need data loaded before they can build.
    if (!app.workspace && key !== 'world' && !app.route.view.startsWith('pr')) return;
    if (sig === current) return;
    current = sig;
    for (const s of game.scene.getScenes(true)) if (s.scene.key !== 'boot') game.scene.stop(s.scene.key);
    game.scene.start(key, params);
  };
  game.events.once('booted', () => {
    sync();
    app.subscribe(sync);
  });
  return game;
}
