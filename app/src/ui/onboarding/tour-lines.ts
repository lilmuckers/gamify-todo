import type { HeroId } from '@quest/shared';

/** The tour's stops, in order. */
export type TourStepId = 'bedroom' | 'project' | 'world' | 'level' | 'deps' | 'flag' | 'pad' | 'play' | 'ai';
export const TOUR_STEPS: TourStepId[] = ['bedroom', 'project', 'world', 'level', 'deps', 'flag', 'pad', 'play', 'ai'];

/**
 * What every guide must get across at each stop, whatever their voice. The
 * keyword (the *starred* word) is the concept being taught.
 */
export const CORE: Record<TourStepId, string> = {
  bedroom: 'Each cartridge is a project: hover to read it, click to play.',
  project: 'The map is one project: islands are worlds (phases), the path is their order.',
  world: 'Each stop is a level: one milestone with a time-box.',
  level: 'Tasks are ? blocks: click to read, DONE completes it, the hero walks on.',
  deps: 'Dependencies: a warp pipe has steps below, a cloud waits on another level.',
  flag: 'The stairs to the flagpole are success criteria: tick the must-dos to clear; good enough.',
  pad: 'Today shows what is late and next; the Inbox holds ideas (T, I, N).',
  play: 'PLAY (or P) lets you steer the hero; bumping blocks finishes tasks.',
  ai: 'The AI skill lets ChatGPT or Claude update your quests; then demo or get started.',
};

/**
 * Each hero's tour, in their own voice (see junk-lines.ts for the voices):
 * style and personality, never background, identity or accent, and the joke
 * never hides the instruction. Same format as the junk lines: a mood mark
 * (`+` happy, `=` meh, `!` shocked, `-` sad) and one *keyword*. Two variants
 * per stop, so a repeat tour reads differently.
 */
export const TOUR_LINES: Record<HeroId, Record<TourStepId, [string, string]>> = {
  classic: {
    bedroom: ['+Wahoo! Each *cartridge* on this floor is a project. Hover to peek, click one to play!', '+Welcome! Every *cartridge* here is a whole project. Point at one to read it, click to jump in!'],
    project: ['+This *map* is the project! Each island is a world, a phase of the work, and the path shows the order.', "+Here's the *map*! Worlds are the big phases, joined by a path. Follow it island by island!"],
    world: ['+Inside a world, each stop is a *level*: one milestone with its own time-box. Clear them in order!', "+Every *level* here is a milestone with a time-box. Beat one, the path opens to the next. Let's go!"],
    level: ["+Every task is a *? block*! Click one to read it, hit DONE when it's done, and I'll run to the next!", '+See the *? blocks*? Those are tasks! Click to read, DONE to finish, and off I go to the next one!'],
    deps: ["+A *warp pipe* hides a dependency's steps underground. A cloud carries you to another level it waits on!", "+Things you're waiting on show up as a *warp pipe* (steps below) or a cloud (another level). Hop in!"],
    flag: ['+The steps up to the *flagpole* are success criteria. Tick the must-dos to clear it. Good enough wins!', '+Climb to the *flagpole* by ticking success criteria! Bonus steps are optional. Clear it, then move on!'],
    pad: ["+*Today* shows what's due and what's next. The Inbox catches stray ideas. Press T, I or N to jot!", "+Lost? Pull up *Today* for what's next, or the Inbox to scribble an idea. Keys: T, I and N!"],
    play: ['+Hit *PLAY* (or P) and you steer me with keys or a gamepad. Bump blocks to finish tasks!', '+Want to run the level yourself? Press *PLAY* or P and grab a gamepad. Wahoo!'],
    ai: ['+Last one! The *AI skill* lets ChatGPT or Claude update your quests for you. Now, demo or get started?', '+Got an AI helper? The *AI skill* teaches it the rules so it can log your quests. Ready for real?'],
  },
  bearded: {
    bedroom: ['=Each *cartridge* is a project. Hover to read the label. Click to play. Like the old days, minus blowing on it.', "=Right. Every *cartridge* on this carpet is a project. Point at one, then click. I'll wait."],
    project: ['=This is the project *map*. Islands are worlds, a fancy word for phases. The path shows the order.', '=Behold, the *map*. Each world is a phase of the project, in path order. Thrilling cartography.'],
    world: ['=Each stop here is a *level*: one milestone, one time-box. Do them in order. Revolutionary, I know.', '=Each *level* is a milestone with a time-box on it. Like a deadline, but with music.'],
    level: ["=Every task's a *? block*. Click it, read it, hit DONE. I'll trudge on to the next one. Thrilling stuff.", "=Tasks live in *? blocks*. Click to read, DONE to finish, and I walk to the next. That's the whole trick."],
    deps: ['=Waiting on something? A *warp pipe* has its steps down below. A cloud means it waits on another level.', '=Dependencies come as a *warp pipe*, with steps underground, or a cloud to another level. Mind your head.'],
    flag: ["=Those stairs to the *flagpole* are success criteria. Tick the must-dos and it's clear. Then stop polishing.", '=Climb to the *flagpole* by ticking criteria. Bonus ones are optional. Polishing after costs you. I checked.'],
    pad: ["=*Today* lists what's overdue and what's next. The Inbox is for ideas you can't place yet. T, I and N.", "=Can't remember what's next? *Today* knows. Got a thought? Inbox. Keys T, I, N. Even I manage that."],
    play: ['=Press *PLAY*, or P, and you drive. Keyboard or gamepad. Try not to walk me into a pit.', '=Fancy doing the walking? *PLAY* hands you the controls. Bumping a block finishes its task. Gently.'],
    ai: ['=Finally, the *AI skill* lets ChatGPT or Claude update all this for you. Now: demo, or set up properly?', "=One more. The *AI skill* teaches your AI assistant the rules. Then it's demo, or the real thing."],
  },
  redhead: {
    bedroom: ['+Every *cartridge* on the floor is a project. Hover for the blurb, click to play. Easy.', "+Pick a *cartridge*, any cartridge. Each one's a project. Hover to read, click to dive in."],
    project: ["+This is the project *map*. Each island's a world, a phase, and the path joins them up in order.", '+Welcome to the *map*. Worlds are the big chunks of work, strung along a path. Follow the trail.'],
    world: ['+Each stop is a *level*, one milestone with a time-box. Knock them off one by one, no stress.', "+Here every *level* is a milestone, with a time-box so it doesn't drag on forever. Freeing, honestly."],
    level: ["+Tasks are *? blocks*. Click one, read it, hit DONE, and I'll stroll on to the next. Lovely.", "+See those *? blocks*? Each one's a task. Click, read, DONE. I'll wander over to whatever's next."],
    deps: ["+A *warp pipe* hides a dependency's own steps below. A cloud floats you to another level it needs.", "+Waiting on something? That's a *warp pipe* with steps underground, or a cloud off to another level."],
    flag: ["+Each step to the *flagpole* is a success criterion. Tick the must-dos and you're clear. Bonus? Optional.", '+Hop up to the *flagpole* by ticking criteria. Clear means good enough, so leave the polishing.'],
    pad: ["+*Today* shows what's due and what's next, and the Inbox catches random ideas. T, I and N, if you like keys.", '+Pull up *Today* for your next move, or scribble in the Inbox when inspiration strikes. T, I or N.'],
    play: ['+Hit *PLAY*, or P, and take the controls yourself. Keyboard or gamepad, whatever is handy.', '+Want a go? *PLAY* lets you run and jump me through the level. Bump a block to finish its task.'],
    ai: ['+Last thing: the *AI skill* lets ChatGPT or Claude keep this updated for you. So, demo or the real thing?', "+Oh, and the *AI skill* teaches your AI helper the rules. Right, that's the tour. What next?"],
  },
  'mustard-jumper': {
    bedroom: ['=Each *cartridge* is one project. To be clear: hover to read it, click to open it. Nothing gets changed.', "=Quick orientation: every *cartridge* here is a separate project. Hover reads it, click opens it. That's all."],
    project: ["=This *map* shows one project. Islands are worlds, meaning phases, in order along the path. I've checked.", '=On this *map*, each world is a phase. The path order matters. You can look ahead. Please do.'],
    world: ['=Each stop is a *level*: precisely one milestone, with a time-box in days. In order. Ideally on time.', '=A *level* is a milestone with a time-box. The number of days is shown. I find that very reassuring.'],
    level: ['=Every task is a *? block*. Click to read the details, press DONE when complete. I then walk to the next.', '=Tasks are *? blocks*, specifically. Click one for details. DONE marks it done, and I move on.'],
    deps: ['=A *warp pipe* means a dependency with steps inside it. A cloud means it waits on another level. Distinct.', '=Two kinds of waiting: a *warp pipe* has sub-steps below, a cloud links to another level. Note the difference.'],
    flag: ["=The steps to the *flagpole* are success criteria. MVP ones are required, bonus ones aren't. Then it's clear.", '=To reach the *flagpole*, tick the success criteria. Required first. Editing after a clear adds polish points.'],
    pad: ['=*Today* lists overdue, in-progress and next items. The Inbox holds unsorted ideas. Shortcuts: T, I, N.', '=For planning: *Today* shows what is next, the Inbox stores ideas for later. Keys are T, I and N.'],
    play: ['=*PLAY*, or the P key, gives you manual control. Keyboard or gamepad. Edits made while playing are reviewed after.', '=Optional: press *PLAY* to steer me yourself. Bumping a block completes its task. You confirm after.'],
    ai: ['=Finally, the *AI skill* lets ChatGPT or Claude edit your quests correctly. Then choose: demo, or proper setup.', '=One more thing: the *AI skill* explains the data format to your assistant. Now, demo or setup? Both fine.'],
  },
  'denim-jacket': {
    bedroom: ["+Every *cartridge* is a project. Each one's got its own cover art. Hover to read, click to play.", "+Check the floor. Each *cartridge* is a project, a little work of art. Hover, then click in."],
    project: ["+This *map* is the whole project. Islands are worlds, phases of the work. The path's the composition.", "+Here's the *map*. Every world's a phase, laid out along a path. Kind of a journey piece, right?"],
    world: ["+Each stop's a *level*, one milestone with its own time-box. Deadlines are just frames, you know?", '+Every *level* is a milestone, framed by a time-box. Clear one, the path opens to the next.'],
    level: ["+Tasks are *? blocks*. Click one to read it, hit DONE when it's done. I'll drift on to the next.", "+Each *? block* is a task. Click, read, DONE. Then I walk on. Very performance art."],
    deps: ["+A *warp pipe* has the dependency's steps underneath. A cloud floats you over to another level it needs.", "+Waiting on stuff? It's a *warp pipe* with steps below, or a cloud to another level. Layers."],
    flag: ["+The steps to the *flagpole* are success criteria. Tick the must-dos and it's done. Art is never finished.", '+Climb to the *flagpole* by ticking criteria. Bonus ones are optional. Know when to put the brush down.'],
    pad: ["+*Today* shows what's next and what's late. The Inbox is your sketchbook for ideas. T, I and N.", '+Pull up *Today* for the plan, or doodle an idea in the Inbox. Keys T, I, N.'],
    play: ["+Press *PLAY*, or P, and you're the one moving. Keys or a gamepad. Improvise.", '+Hit *PLAY* and steer me yourself. Bump a block to finish its task. Freestyle it.'],
    ai: ['+Last bit: the *AI skill* lets ChatGPT or Claude keep your quests updated. Now, demo or the real canvas?', "+The *AI skill* teaches your AI the rules, so it can help out. That's the tour. Where to next?"],
  },
  hoodie: {
    bedroom: ['+Each *cartridge* is a project. Hover to read the stats, click to load it. Easy any%.', "+Floor's full of *cartridges*. Each one's a project. Hover for info, click to boot it."],
    project: ['+Project *map*. Islands are worlds, the phases. The path shows the route. No skips. Probably.', "+This *map* is the overworld. Each world's a phase of the project. Follow the path in order."],
    world: ["+Each stop's a *level*, one milestone with a time-box. Think of it as a par time.", '+Every *level* is a milestone. The time-box is your par time. Beat it if you can.'],
    level: ['+Tasks are *? blocks*. Click to read, hit DONE, and I auto-run to the next one. Optimal.', "+Every *? block* is a task. Click it, read it, DONE it. I'll path to the next one."],
    deps: ["+A *warp pipe* hides a dependency's steps in a sub-level. A cloud warps you to another level it needs.", '+Dependencies: *warp pipe* means steps below, a cloud means it waits on another level. Learn the routes.'],
    flag: ['+Stairs to the *flagpole* are success criteria. Tick the must-dos to clear. Bonus is optional, no 100% needed.', "+Hit the *flagpole* by ticking criteria. Polishing after the clear costs you. Don't grind it."],
    pad: ["+*Today* shows your next splits: overdue and up next. The Inbox is for ideas. Binds: T, I, N.", "+Open *Today* to see what's next, or the Inbox to dump ideas. Hotkeys T, I and N."],
    play: ['+Press *PLAY* or P for manual control. Keyboard or pad. Bump blocks to finish tasks.', '+Want to run it yourself? *PLAY*, grab a pad, go. Edits get reviewed at the end.'],
    ai: ['+Last tip: the *AI skill* lets ChatGPT or Claude update quests for you. Now pick: demo, or real setup?', '+The *AI skill* teaches your AI the rules. Tour complete. GG. What next?'],
  },
  emo: {
    bedroom: ['=Every *cartridge* here is a project. Hover to read its sad little label. Click if you dare.', '=These *cartridges*... each one a project, waiting. Hover to read. Click to begin. Like I care. (I care.)'],
    project: ['=The project *map*. Islands of work, called worlds, drifting in order along a lonely path.', '=This *map* is the whole project. Each world is a phase. The path goes on. It always does.'],
    world: ['=Each stop is a *level*: a milestone, with a time-box ticking away. Like everything.', '=Every *level* is a milestone. It has a time-box. Time is fleeting. Anyway, do them in order.'],
    level: ["=Every task is a *? block*. Click it, read it, mark it DONE. I'll walk on. Alone. It's fine.", '=See the *? blocks*? Tasks. Click to read, DONE to finish. Then I trudge on. Story of my life.'],
    deps: ["=A *warp pipe* hides a dependency's steps, deep below. A cloud means it waits on another level. Relatable.", '=Waiting on something? A *warp pipe* has steps underground. A cloud waits on another level. We all wait.'],
    flag: ['+The stairs to the *flagpole* are success criteria. Tick the must-dos. Good enough is... actually kind of nice.', "=Climb to the *flagpole* by ticking criteria. Bonus ones are optional. Nothing's perfect. That's the point."],
    pad: ["=*Today* shows what's due and what's next. The Inbox holds your thoughts. Keys: T, I, N. Write it down.", "=Open *Today* for what's next. Pour ideas into the Inbox. T, I and N. It listens."],
    play: ['+Press *PLAY* or P and you control me. Keys or gamepad. Finally, someone gets me.', "=Hit *PLAY* to steer me yourself. Bump blocks to finish tasks. At least someone's in control."],
    ai: ['=Last thing. The *AI skill* lets ChatGPT or Claude update your quests. Then: demo, or real setup. Choose wisely.', "+The *AI skill* teaches your AI the rules. That's the tour. ...That was kind of fun. Don't tell anyone."],
  },
  goth: {
    bedroom: ['=Each *cartridge* here holds a project, sealed and waiting. Hover to read its epitaph. Click to awaken it.', '=Behold the *cartridges*: every one a project. Hover for its tale, click to enter.'],
    project: ['=This *map* charts the project. Its islands are worlds, phases of the work, bound by a winding path.', '=The *map* reveals all. Each world is a phase, and the path decrees their order.'],
    world: ['=Each stop is a *level*: a milestone, its time-box tolling like a distant bell.', '=Every *level* is a milestone, bound by a time-box. The days pass. As they must.'],
    level: ['=Each task waits in a *? block*, like a small sealed fate. Open it, mark it DONE, and I drift onward.', '=The *? blocks* hold your tasks. Click to read, DONE to lay each to rest. Then I walk on.'],
    deps: ["=A *warp pipe* descends to a dependency's hidden steps. A cloud bears you to another level it awaits.", '=What you wait upon appears as a *warp pipe*, steps below, or a cloud, another level. Patience.'],
    flag: ['=The stairs to the *flagpole* are success criteria. Tick the necessary ones. Perfection is a beautiful lie.', '=Ascend to the *flagpole* by ticking criteria. Bonus ones are optional. Good enough is its own grim victory.'],
    pad: ['=*Today* reveals what is late and what comes next. The Inbox keeps stray thoughts. T, I and N.', '=Consult *Today* for your next task. Commit fleeting ideas to the Inbox. T, I, N.'],
    play: ['=Press *PLAY*, or P, and my fate is in your hands. Keys or gamepad. Bump blocks to end tasks.', '=Seize control with *PLAY*. Guide me through the level. Try not to let me fall.'],
    ai: ['=Lastly, the *AI skill* lets ChatGPT or Claude tend your quests. Now choose: the demo, or the true path.', '=The *AI skill* teaches your AI familiar the rules. The tour ends here. What next?'],
  },
  punk: {
    bedroom: ['+Every *cartridge* on the floor is a project! Hover to read it, click to smash it in!', '+Oi! Each *cartridge* is a project! Hover for the blurb, click to play! No rules! Well, those rules.'],
    project: ['+This is the project *map*! Islands are worlds, the phases! The path shows the order! Follow it! (Do.)', "+Check the *map*! Every world's a phase of the project, lined up along a path! Let's go!"],
    world: ["+Each stop's a *level*! One milestone, one time-box! Beat the clock, beat the system!", '+Every *level* is a milestone with a time-box! Clear it and the path opens! Easy!'],
    level: ['+See the *? blocks*? Those are your tasks! Smash DONE and I leg it to the next one. No rules! Well, one rule.', "+Every task's a *? block*! Click it, read it, DONE it! I'll charge on to the next!"],
    deps: ['+A *warp pipe* means a dependency with steps underground! A cloud means it waits on another level! Rad!', '+Waiting on stuff? *Warp pipe*: steps below! Cloud: another level! Down the pipe we go!'],
    flag: ["+The stairs to the *flagpole* are success criteria! Tick the must-dos and you're clear! Perfect is boring!", '+Climb the stairs to the *flagpole*! Bonus steps are optional! Done beats perfect! Every time!'],
    pad: ["+*Today* shows what's late and what's next! The Inbox eats your ideas! Keys T, I, N!", '+Hit *Today* for the plan! Chuck ideas in the Inbox! T, I, N! Simple!'],
    play: ['+Hit *PLAY* or P and take the controls! Keys, gamepad, whatever! Bash blocks to finish tasks!', '+*PLAY* puts you in charge! Run! Jump! Bump blocks! Chaos!'],
    ai: ['+Last one! The *AI skill* lets ChatGPT or Claude update your quests! Now: demo or the real deal?', "+The *AI skill* teaches your AI the rules! Tour's over! What next?!"],
  },
  'rainbow-tee': {
    bedroom: ["+Hi! Every *cartridge* is a project! Hover to read it, click to play. You're gonna love this!", "+Look at all these *cartridges*! Each one's a project! Hover, click, you've got this!"],
    project: ["+This is the project *map*! Each island's a world, a phase of the work, and the path shows the order!", "+Yay, the *map*! Worlds are the big phases, all along one path! Look how far you'll go!"],
    world: ["+Every stop's a *level*: a milestone with its own time-box! You can totally do these!", "+Each *level* is a milestone with a time-box! One at a time, and you'll fly through them!"],
    level: ["+Tasks are *? blocks*! Click one, read it, hit DONE, and I'll run to the next. Go you!", '+Every *? block* is a task! Click, read, DONE! Then I walk on and we celebrate!'],
    deps: ["+A *warp pipe* has a dependency's steps underneath! A cloud lifts you to another level it needs! So fun!", "+Waiting on something? It's a *warp pipe* with steps below, or a cloud to another level! Easy!"],
    flag: ["+The steps to the *flagpole* are success criteria! Tick the must-dos and you've cleared it! Good enough is great!", '+Climb to the *flagpole* by ticking criteria! Bonus ones are optional! Clearing it is the win!'],
    pad: ["+*Today* shows what's next and what's late! The Inbox catches every idea! T, I and N! Love it!", "+Open *Today* for your next step, or the Inbox for ideas! T, I, N! You're doing amazing!"],
    play: ['+Press *PLAY* or P and you steer me! Keys or gamepad! Bump blocks to finish tasks! Yes!', '+Hit *PLAY* and take the controls! Run and jump! I believe in you!'],
    ai: ['+Last thing! The *AI skill* lets ChatGPT or Claude update your quests! Demo or get started? Both great!', "+The *AI skill* teaches your AI the rules! That's the tour! You did it!"],
  },
  'trans-flag-hair': {
    bedroom: ['+Hello, little *cartridges*! Each one is a project. Hover to say hi, click to play!', '+Every *cartridge* on the floor is a project, waiting for a friend. Hover to read, click to play!'],
    project: ['+This is the project *map*! The islands are worlds, the phases, all holding hands along a path!', '+Hello, *map*! Each world is a phase of the project, and the path shows which comes first.'],
    world: ['+Each stop is a *level*, a milestone with its own little time-box. Say hi to it, then clear it!', "+Every *level* is a milestone with a time-box. They line up so nicely, don't they?"],
    level: ["+Tasks live in *? blocks*! Click one, read it, hit DONE, and I'll skip along to the next!", '+Hello, *? blocks*! Each one is a task. Click to read, DONE to finish, then I hop on.'],
    deps: ["+A *warp pipe* keeps a dependency's steps cosy underground. A cloud floats you to another level it needs!", '+Waiting on something? A *warp pipe* has steps below, and a cloud is a lift to another level. Wheee!'],
    flag: ["+The stairs to the *flagpole* are success criteria! Tick the must-dos and it's clear. Bonus ones are a treat!", "+Climb to the *flagpole* by ticking criteria! Good enough gets the flag. Isn't that lovely?"],
    pad: ["+*Today* shows what's next and what's late. The Inbox keeps your ideas safe! T, I and N.", "+Peek at *Today* for what's next, or whisper an idea to the Inbox! T, I, N!"],
    play: ['+Press *PLAY* or P and you get to move me! Keys or gamepad. Boop blocks to finish tasks!', '+Hit *PLAY* and we go on an adventure together! Bump a block to finish its task!'],
    ai: ['+One more! The *AI skill* lets ChatGPT or Claude update your quests. Now, demo or get started?', "+The *AI skill* teaches your AI friend the rules! That's the tour. Where shall we go?"],
  },
  'trans-pin': {
    bedroom: ["+Each *cartridge* on the floor is a project. Hover to read about it, click when you're ready.", '+Take your time. Every *cartridge* here is a project. Hover to read, click to play.'],
    project: ['+This is the project *map*. Islands are worlds, phases of the work, joined by a path in order.', "+Here's the *map*. Each world is a phase. Follow the path, one island at a time."],
    world: ['+Each stop is a *level*: one milestone with a time-box. Small steps. It adds up.', '+Every *level* is a milestone, with a time-box to keep it honest. One at a time is plenty.'],
    level: ["+Every task is a *? block*. Click to read, DONE when it's done, and I'll walk to the next one.", "+Tasks are *? blocks*. Click one, read it, mark it DONE. I'll quietly move on to the next."],
    deps: ["+A *warp pipe* holds a dependency's own steps below. A cloud means it waits on another level.", "+Things you're waiting on show as a *warp pipe*, with steps below, or a cloud to another level."],
    flag: ["+The steps to the *flagpole* are success criteria. Tick the must-dos and it's clear. Good enough is good.", '+Climb to the *flagpole* by ticking criteria. Bonus ones are optional. Then let it go. Kindly.'],
    pad: ["+*Today* shows what's late and what's next. The Inbox holds ideas until you're ready. T, I and N.", "+When it's a lot, open *Today*: just what's next. Ideas go in the Inbox. T, I, N."],
    play: ['+Press *PLAY* or P to steer me yourself. Keys or a gamepad. Bump a block to finish a task.', "+If you'd like, *PLAY* hands you the controls. No pressure. You can review edits after."],
    ai: ['+Last one. The *AI skill* lets ChatGPT or Claude update your quests. Demo next, or get set up?', "+The *AI skill* teaches your AI the rules. That's the tour. Thanks for coming along."],
  },
  'bi-bomber': {
    bedroom: ['+Every *cartridge* here is a project. Hover to read, click to play. Smooth, right?', "+Take a look. Each *cartridge* is a project. Hover for details, click and you're in."],
    project: ['+This is the project *map*. Islands are worlds, the phases, lined up along a path. Clean.', '+The *map*. Each world is a phase of the project, in order. Nobody plans it better.'],
    world: ["+Each stop's a *level*: a milestone, with a time-box. Clear it like it's nothing.", '+Every *level* is a milestone with its own time-box. We hit those. Easily.'],
    level: ["+Tasks are *? blocks*. Click one, read it, hit DONE. I'll stroll to the next. Effortless.", "+See those *? blocks*? Tasks. Click, read, DONE. Then I'm on to the next one. Easy."],
    deps: ["+A *warp pipe* has a dependency's steps underground. A cloud takes you to another level it needs. Stylish.", '+Waiting on something? *Warp pipe*: steps below. Cloud: another level. Handled.'],
    flag: ["+The stairs to the *flagpole* are success criteria. Tick the must-dos, clear it, move on. That's the move.", '+Climb to the *flagpole* by ticking criteria. Bonus is optional. Good enough, done with style.'],
    pad: ["+*Today* shows what's next and what's late. The Inbox catches ideas. T, I, N. Smooth.", '+Need a plan? *Today*. Got an idea? Inbox. Keys T, I and N.'],
    play: ['+Hit *PLAY* or P and take the wheel. Keys or a pad. Bump blocks to finish tasks.', "+Press *PLAY* and show me what you've got. Run, jump, finish tasks."],
    ai: ['+Last thing: the *AI skill* lets ChatGPT or Claude update your quests. Demo, or set it up for real?', "+The *AI skill* teaches your AI the rules. Tour's done. What's your next move?"],
  },
  'drag-glam': {
    bedroom: ['+Darling, every *cartridge* on this floor is a project. Hover for the gossip, click to make an entrance!', '+Welcome to the show! Each *cartridge* is a project. Hover to read, click to take the stage!'],
    project: ['+This, my love, is the *map*. Each island is a world, a phase, and the path is your runway.', '+Behold the *map*! Every world is a phase of the project, in order. Work it, island by island.'],
    world: ['+Each stop is a *level*: a milestone with a time-box. Curtain up, curtain down, next number!', '+Every *level* is a milestone, darling, with a time-box. Hit your marks, on time.'],
    level: ['+Every task is a *? block*. Click to read, hit DONE, and I sashay to the next. Iconic.', '+Those *? blocks*? Tasks, sweetie. Click, read, DONE, and I strut on to the next one.'],
    deps: ["+A *warp pipe* hides a dependency's steps backstage, below. A cloud whisks you to another level it needs!", '+Waiting on something? A *warp pipe* has its steps below, a cloud flies you to another level. Drama!'],
    flag: ['+The stairs to the *flagpole* are success criteria. Tick the must-dos and take your bow. Good enough is gorgeous.', '+Climb to the *flagpole* by ticking criteria. Bonus is optional, darling. Know when to leave the stage.'],
    pad: ["+*Today* is your call sheet: what's late, what's next. The Inbox holds every bright idea. T, I and N.", '+Check *Today* for your next scene, and jot ideas in the Inbox. T, I, N, darling.'],
    play: ["+Press *PLAY* or P and you're directing, sweetie. Keys or gamepad. Bump blocks to finish tasks.", '+Hit *PLAY* and take the spotlight yourself! Run, jump, and finish tasks in style.'],
    ai: ['+Finale! The *AI skill* lets ChatGPT or Claude update your quests. Now, the demo, or the real show?', "+The *AI skill* teaches your AI the choreography. That's the tour, darling. Encore?"],
  },
  'nb-beanie': {
    bedroom: ['=Each *cartridge* is a project. Hover to read it, click to play. Is a project ever just one thing?', '+Every *cartridge* on this floor is a project. Hover to learn about it. Click to begin.'],
    project: ['=This *map* is the project. Islands are worlds, phases of the work, ordered by a path. Very tidy.', '+On this *map*, each world is a phase. The path suggests an order. The order is wise.'],
    world: ['=Each stop is a *level*: one milestone, one time-box. Time is a construct, but a useful one.', '+Every *level* is a milestone, with a time-box. Limits make things finishable.'],
    level: ["+Every task is a *? block*. Click to read, DONE when it's done, and I walk on. Simple, yet profound.", "=Tasks are *? blocks*. What's inside? Click to read. DONE to finish. I'll walk on to the next."],
    deps: ["=A *warp pipe* holds a dependency's steps below. A cloud waits on another level. Everything's connected.", "+Waiting on something? It's a *warp pipe* with steps underneath, or a cloud to another level."],
    flag: ["+The steps to the *flagpole* are success criteria. Tick the must-dos and it's clear. Good enough is enough.", '=Climb to the *flagpole* by ticking criteria. Bonus is optional. Perfection is just a rumour.'],
    pad: ["+*Today* shows what's next and what's late. The Inbox holds ideas without judging. T, I and N.", "=Open *Today* for what's next. The Inbox is where thoughts wait their turn. T, I, N."],
    play: ['+Press *PLAY* or P and you steer me. Keys or gamepad. Bump blocks to finish tasks.', "=With *PLAY*, you control me. Who's really playing whom? Bump blocks to finish tasks."],
    ai: ['+Lastly, the *AI skill* lets ChatGPT or Claude update your quests. Now: demo, or the real thing?', "=The *AI skill* teaches your AI the rules. That's the tour. Where does it lead? You decide."],
  },
  'hijab-skater': {
    bedroom: ['+Every *cartridge* on the floor is a project! Hover to read it, click to drop in!', "+Line up a *cartridge*, each one's a project! Hover for info, click and drop in!"],
    project: ['+This is the project *map*! Islands are worlds, the phases, linked by a path. Ride it in order!', "+Here's the *map*! Every world's a phase, along one path. Like a skate line, start to finish!"],
    world: ["+Each stop's a *level*: one milestone with a time-box. Land it before the clock runs out!", '+Every *level* is a milestone with a time-box. Hit them one after another. Combo!'],
    level: ['+Tasks are *? blocks*! Click one, read it, DONE it, and I roll on to the next. Clean landing!', "+Each *? block* is a task! Click, read, DONE! I'll grind over to the next one!"],
    deps: ["+A *warp pipe* drops into a dependency's steps below! A cloud lifts you to another level it needs!", '+Waiting on stuff? *Warp pipe*: drop in for the steps! Cloud: ride over to another level!'],
    flag: ['+The stairs to the *flagpole* are success criteria! Tick the must-dos, stick the landing, done!', '+Ollie up to the *flagpole* by ticking criteria! Bonus is optional. Clean beats flashy!'],
    pad: ["+*Today* shows what's next and what's late! The Inbox catches ideas mid-run! T, I and N!", '+Check *Today* for your next trick, drop ideas in the Inbox! T, I, N!'],
    play: ["+Press *PLAY* or P and you're riding! Keys or a gamepad! Bump blocks to finish tasks!", '+Hit *PLAY* and take control! Run, jump, kickflip into tasks!'],
    ai: ['+Last one! The *AI skill* lets ChatGPT or Claude update your quests! Demo or get started?', "+The *AI skill* teaches your AI the rules! That's the tour! Nailed it!"],
  },
  'silver-locs': {
    bedroom: ['+Each *cartridge* on this floor is a project, love. Hover to read it, click to play. Go on.', "+Now then, every *cartridge* here is a project. Hover to read it. Click it. Don't be shy."],
    project: ['+This is the project *map*. Each island is a world, a phase, and the path keeps them in order.', "+Here's the *map*, dear. Worlds are the phases, one after another. Like a good garden plan."],
    world: ['+Each stop is a *level*: a milestone with a time-box. One season at a time.', "+Every *level* is a milestone, with a time-box so it doesn't run wild. Wise, that."],
    level: ["+Every task is a *? block*. Click to read it, DONE when it's done, and I'll toddle on to the next.", "+Tasks live in *? blocks*, love. Click, read, DONE. Then I'll walk on. Steady does it."],
    deps: ["+A *warp pipe* hides a dependency's steps below. A cloud means it's waiting on another level. Patience.", '+Waiting on something? A *warp pipe* has steps underneath, a cloud waits on another level.'],
    flag: ["+The steps to the *flagpole* are success criteria. Tick the must-dos and it's clear. Then stop fussing.", '+Climb to the *flagpole* by ticking criteria, dear. Bonus ones are optional. Good enough is good enough.'],
    pad: ["+*Today* shows what's late and what's next. The Inbox keeps your ideas till you're ready. T, I and N.", '+Look at *Today* each morning, love. Ideas go in the Inbox. T, I, N.'],
    play: ['+Press *PLAY* or P and you can steer me. Keys or a gamepad. Bump blocks to finish tasks. Mind my knees.', '+Fancy a go? *PLAY* gives you the controls. Bump a block to finish its task.'],
    ai: ['+Last thing: the *AI skill* lets ChatGPT or Claude keep your quests updated. Now, demo or the real thing?', "+The *AI skill* teaches your AI helper the rules. That's the tour, love. What next?"],
  },
  flannel: {
    bedroom: ['=Each *cartridge* is a project. Hover to read it, click to play. Simple tools, simple job.', '+Every *cartridge* on the floor is a project. Hover for the details, click to get stuck in.'],
    project: ['=This is the project *map*. Islands are worlds, the phases, along a path. Like a trail map.', "+Here's the *map*. Each world is a phase of the job. Follow the path in order."],
    world: ['=Each stop is a *level*: one milestone, one time-box. Set up camp, finish, move on.', '+Every *level* is a milestone with a time-box. Get it done and head to the next.'],
    level: ["+Tasks are *? blocks*. Click one, read it, hit DONE, and I'll hike to the next one.", '=Every *? block* is a task. Click, read, DONE. Then I walk on. No fuss.'],
    deps: ["=A *warp pipe* holds a dependency's steps underground. A cloud means it waits on another level.", "+Waiting on parts? That's a *warp pipe* with steps below, or a cloud to another level."],
    flag: ["+The steps to the *flagpole* are success criteria. Tick the must-dos and it's done. Don't over-sand it.", '=Climb to the *flagpole* by ticking criteria. Bonus is optional. If it works, it works.'],
    pad: ["+*Today* shows what's next and what's late. The Inbox holds ideas for later. T, I and N.", '=Check *Today* for the next job. Stick ideas in the Inbox. T, I, N.'],
    play: ["+Press *PLAY* or P and you're driving. Keys or a gamepad. Bump blocks to finish tasks.", '=Want to do it yourself? *PLAY*. Bump a block to finish its task. Mind the pits.'],
    ai: ['+Last thing: the *AI skill* lets ChatGPT or Claude update your quests. Demo, or set up properly?', "=The *AI skill* teaches your AI the rules. That's the tour. Right, what next?"],
  },
};

/** Longest a tour line may be (after the marks come off), so it fits the box without scrolling. */
export const MAX_TOUR_LINE = 140;

/**
 * Who gives the tour: the hero this browser picked, or (never picked) a
 * random one, never the previous tour's guide, so a repeat tour has a new voice.
 */
export function pickGuide(ids: readonly HeroId[], chosen: string | undefined, last: string | undefined, r: () => number = Math.random): { guide: HeroId; random: boolean } {
  if (chosen && ids.includes(chosen as HeroId)) return { guide: chosen as HeroId, random: false };
  const pool = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
  return { guide: pool[Math.floor(r() * pool.length)], random: true };
}

/** Which variant of each step to use: not the one used last time (when there's a choice). */
export function pickVariants(last: readonly number[] | undefined, r: () => number = Math.random): number[] {
  return TOUR_STEPS.map((_, i) => {
    const prev = last?.[i];
    if (prev === 0 || prev === 1) return 1 - prev;
    return r() < 0.5 ? 0 : 1;
  });
}

/** Stops that need a mouse and keyboard: phones have no play mode. */
export const DESKTOP_ONLY: TourStepId[] = ['play'];

/**
 * Rewords a line for a touch screen, keeping the guide's voice: no hovering,
 * taps instead of clicks, and the Today/Inbox tabs instead of shortcut keys.
 */
export function forTouch(raw: string): string {
  const keys = /(?:(?:Press|Keys(?: are)?|Shortcuts|Binds|Hotkeys):?\s*)?T, I,? (?:and |or )?N(?: to jot)?(?:, if you like keys)?/g;
  return raw
    .replace(keys, 'Tabs at the bottom')
    .replace(/\bHover reads it, click opens it\b/, 'Tap one to open it')
    // "Hover to read it" becomes "Read it", capitalised only where a sentence starts.
    .replace(/\b([Hh])over to (\w)/g, (_m, h: string, c: string) => (h === 'H' ? c.toUpperCase() : c))
    .replace(/\b([Hh])over for /g, (_m, h: string) => (h === 'H' ? 'Check ' : 'check '))
    .replace(/\b([Hh])over\b/g, (_m, h: string) => (h === 'H' ? 'Look' : 'look'))
    .replace(/\b([Pp])oint at\b/g, (_m, p: string) => (p === 'P' ? 'Pick' : 'pick'))
    .replace(/\b([Cc])lick\b/g, (_m, c: string) => (c === 'C' ? 'Tap' : 'tap'));
}
