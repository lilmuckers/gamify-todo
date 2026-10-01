import Phaser from 'phaser';
import { registerTextures } from './common';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    registerTextures(this);
    this.game.events.emit('booted');
  }
}
