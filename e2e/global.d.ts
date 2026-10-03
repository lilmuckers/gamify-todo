import type Phaser from 'phaser';

declare global {
  interface Window {
    /** Exposed by dev and e2e builds (app/src/game/index.ts). */
    __questGame?: Phaser.Game;
  }
}
