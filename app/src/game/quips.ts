import type { PropKind } from '../sprites/bedroom';

/** Things on the bedroom floor that aren't games, but have opinions anyway. */
export type Thing = PropKind | 'console' | 'controller' | 'tv';

/** `{label}` is replaced with the words printed on the thing (snack brand, comic sound). */
const QUIPS: Record<Thing, string[]> = {
  sock: [
    'SOCK... it\'s... it\'s a sock...',
    'The other one left in 2019. We don\'t talk about it.',
    'A sock. Waiting for its partner. As are we all.',
    'Smells faintly of victory. And feet.',
    'It has been here longer than some of your projects.',
  ],
  snack: [
    '{label}: 40% bag, 60% air, 100% gone.',
    'Contains three crisps and one regret.',
    '{label}. Now with crunch-adjacent flavour.',
    'Do not eat the little packet. Not again.',
    'The bag rustles. Nobody is touching it.',
  ],
  crumbs: [
    'Crumbs. Tiny fossils of snacks past.',
    'The ants have been notified.',
    'This used to be a whole bag. Time is cruel.',
    'Evidence. Destroy it before Mum gets home.',
  ],
  juice: [
    'Juice. It\'s in the carpet now. It lives there.',
    'The puddle is growing. Do not make eye contact.',
    'Mum is going to LOVE this.',
    'Sticky. Forever sticky.',
  ],
  soda: [
    'Shaken, not stirred. Do not open near the TV.',
    'Flat since Tuesday. Still fizzing in spirit.',
    'One sip left. Nobody will ever drink it.',
    'Contains 0% juice and 100% ambition.',
  ],
  pizza: [
    'Cold pizza: breakfast of champions.',
    'This slice has seen things.',
    'Pepperoni count: suspiciously low.',
    'It\'s fine. It\'s been on the floor less than a week.',
  ],
  comic: [
    '{label} Issue #1. Mint condition, apart from the juice.',
    'Spoiler: the hero saves the day. Unlike your deadline.',
    'You\'ve read it forty times. Read it again.',
    '{label} The panels are louder than they look.',
  ],
  console: [
    'Blow on the cartridge first. It doesn\'t help. Do it anyway.',
    'Warm. Humming. Possibly sentient.',
    'It is waiting for a game. Patiently. Mostly.',
    'The power light is off. It is thinking about you.',
  ],
  controller: [
    'Player 1. Player 2 fell asleep.',
    'Cable: exactly 30cm too short.',
    'The buttons are sticky. Don\'t ask.',
    'Up, up, down, down... no, nothing.',
  ],
  tv: [
    'Don\'t sit so close, your eyes will go square.',
    'Static. If you listen closely, it\'s reading your to-do list.',
    'It\'s warm. It\'s watching.',
    'Channel 3. It\'s always channel 3.',
  ],
};

/** A quip for `thing`, avoiding `last` when there's another to say. */
export function quip(thing: Thing, label = '', last?: string, r: () => number = Math.random): string {
  const lines = QUIPS[thing].map((q) => q.replaceAll('{label}', label).trim());
  const fresh = lines.length > 1 ? lines.filter((q) => q !== last) : lines;
  return fresh[Math.floor(r() * fresh.length)];
}
