import type { PropKind } from '../sprites/bedroom';

/** Things on the bedroom floor that aren't games, but have opinions anyway. */
export type Thing = PropKind | 'console' | 'controller' | 'tv';

/** `{label}` is replaced with the words printed on the thing (snack brand, comic sound, book title). */
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
  cassette: [
    '{label}. Side B is just someone coughing.',
    'Rewind it with a pencil. It is the law.',
    'The tape is fine. The tape is never fine.',
    'Recorded off the radio. The DJ talks over every ending.',
    'Do not let the deck eat it. It is hungry.',
  ],
  banana: [
    'A banana. Do not step on it. Seriously.',
    'Going brown at the speed of regret.',
    'Nature\'s cartridge. Does not fit.',
    'Somebody is going to slip on this. Possibly you.',
    'A source of potassium and plot.',
  ],
  duck: [
    'Squeak. That was the duck, not the floor.',
    'It has seen bathtime. It has seen things.',
    'A rubber duck. Debugging partner, very quiet.',
    'It floats. On carpet, it mostly sulks.',
    'Quack. That one was also the duck.',
  ],
  donut: [
    'A donut with one bite missing. Not yours. Probably.',
    'The sprinkles are spreading. Contain them.',
    'Zero calories if found on the floor. That is science.',
    'It has a hole in it. Like your plan.',
    'Sticky icing, fluffy carpet. A bond for life.',
  ],
  teddy: [
    'Teddy. Has kept watch over this room since forever.',
    'One eye is slightly looser than the other. Brave.',
    'It saw everything. It will tell no one.',
    'Softest thing in the room, including the carpet.',
    'Retired from bedtime. Still on call.',
  ],
  yoyo: [
    'Walk the dog? It barely walks the floor.',
    'Tangled. It is always tangled.',
    'Up, down, up, down. Like your motivation.',
    'Around the world! ...Around the bed, at least.',
    'The string has a knot older than the console.',
  ],
  gamebook: [
    '{label}. Book 4 of 12. You only own book 4.',
    'Finger still in page 112, just in case.',
    'You are in a messy bedroom. There is a sock. Turn to 7.',
    'The pencil map in the back is mostly rubbed out.',
    'Roll two dice. The dice are under the bed. Good luck.',
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

/** What the flagpole says when you reach it with must-do steps left. `{n}` is how many. */
const POLE_QUIPS = [
  'Oi! You missed something.',
  'Nice try. Check the steps.',
  'Not so fast, the boring bits count too.',
  "Did you forget something? Because I didn't.",
  "That's not how stairs work.",
  'Required means required.',
  "Come back when you've done your homework.",
  '{n} short. Off you pop.',
];

/** A telling-off from the flagpole, never the same as `last` twice in a row. */
export function poleQuip(left: number, last?: string, r: () => number = Math.random): string {
  const n = `${left} step${left === 1 ? '' : 's'}`;
  const lines = POLE_QUIPS.map((q) => q.replaceAll('{n}', n));
  const fresh = lines.filter((q) => q !== last);
  return fresh[Math.floor(r() * fresh.length)];
}
