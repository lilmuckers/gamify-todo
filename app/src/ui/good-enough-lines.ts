/**
 * What the hero says, through gritted teeth, when a level clears with
 * optional items still lying about. Grudging approval is the joke: a
 * reluctant thumbs up beats a perfect finish nobody ships.
 */
export const GOOD_ENOUGH_LINES = [
  'You did enough.',
  "Fine. It's done. Ship it.",
  'Is it perfect? No. Is it done? Annoyingly, yes.',
  "Good enough. I hate that it's good enough.",
  'The must-dos are done. The rest can wait. Forever, ideally.',
  'Ship it before you start sanding it.',
  'Put the sandpaper down.',
  'Technically finished. The best kind of finished.',
  "That'll do.",
  'It works. Stop touching it.',
  'Done is a feature.',
  "Nobody will ever notice the bit you're worried about.",
  'Congratulations on doing exactly enough. That was the job.',
  'Wow. Adequate. Truly, deeply adequate.',
  'B-minus. Passes. Moving on.',
  'Close enough for jazz.',
  'Polishing costs stars. Just saying.',
  'The stretch goals will survive without you.',
  'Enough. You did enough. Go outside.',
  'Not perfect, but shipped. You picked the right one.',
  'Thumbs up. Reluctantly. But up.',
  "I've seen worse. I've seen better. This is fine.",
  "It's not a masterpiece. It's a finished thing, which is rarer.",
  'Ship it. Future you can be disappointed later.',
  'Your inner critic has been outvoted.',
  'Mission accomplished, give or take.',
  "That's a wrap. A slightly wonky wrap.",
  'Done. Not done done. But done.',
  "The flag is up. Don't ask me to look at the stitching.",
  'Perfect was booked solid. Good enough had an opening.',
  'Achievement unlocked: stopping.',
  'Shipped. The leftovers can go in a drawer.',
  'Good enough is a finish line, not a consolation prize.',
  "I'm proud of you. Ish.",
  'Ten out of ten for stopping.',
  'Meets requirements. Exceeds nothing. Perfect.',
  'Let it go. No, really. Let go of it.',
  "Every must-do: done. Every nice-to-have: someone else's problem.",
  'You could keep going. You could also not.',
  'Nailed it. The important bits, anyway.',
  'Unimpressed, but impressed you stopped.',
  "It's not unfinished, it's released. Big difference.",
];

/** A line for the moment: random, but never the one shown last time. */
export function pickGoodEnoughLine(last?: string, rand = Math.random): string {
  const pool = GOOD_ENOUGH_LINES.filter((l) => l !== last);
  return pool[Math.floor(rand() * pool.length)];
}
