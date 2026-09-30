import Phaser from 'phaser';
import { registerTextures } from './common';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    registerTextures(this);
    this.anims.create({
      key: 'hero-walk',
      frames: [{ key: 'hero' }, { key: 'hero-walk' }],
      frameRate: 8,
      repeat: -1,
    });
    this.game.events.emit('booted');
  }
}
