import type { HeroId } from '@quest/shared';
import { parseLine, type DialogueLine } from '../ui/dialogue';

/** Non-game things that can be jammed in the console (the easter egg). */
export type JunkKind = 'sock' | 'snack' | 'soda' | 'juice' | 'pizza' | 'comic' | 'controller';
export const JUNK_KINDS: JunkKind[] = ['sock', 'snack', 'soda', 'juice', 'pizza', 'comic', 'controller'];

/**
 * What the player's hero says after putting something that isn't a game in
 * the console. First person, in that hero's own voice, which comes from their
 * style and personality: never from background, identity or accent.
 *
 * Each line starts with its mood: `+` happy, `=` meh, `!` shocked, `-` sad.
 * Meh and shocked lines get the "reacting" portrait. One *keyword* per line
 * is highlighted. `{label}` is the snack's brand or the comic's sound word.
 * `any` is the fallback for kinds added later.
 */
const LINES: Record<HeroId, Record<JunkKind | 'any', string[]>> = {
  classic: {
    sock: ["+Wahoo! ...wait, that's a *sock*. Wahoo anyway!", "!Oh no, that's a *sock*! Let's go anyway!", '+One sock, one slot, one *adventure*!'],
    snack: ['+{label}! A *power-up* in a bag!', "+If I eat it in the console, does it count as *1-UP*?", "!Oh no! The {label} went in the *wrong pipe*!"],
    soda: ['+A can! I bet it does a *super jump*!', '!Fizzing! The console is *fizzing*!', "+Shake it, slot it, *let's go*!"],
    juice: ['!Uh-oh. The console is *swimming* now.', "+It's an *underwater level*!", '-I just wanted to save my *progress*...'],
    pizza: ['+Pizza! The *best* cartridge!', "!It's got a *topping* stuck in the pins!", '+Extra cheese, extra *lives*!'],
    comic: ['+{label}! It looks like a *game* already!', "+I'm in the *comic* now! Wahoo!", '!Hey, the *pages* don\'t press START!'],
    controller: ['!A controller in the console? *Player zero*?', "+It's controlling *itself*! Amazing!", '=Hmm. Who is *playing* who?'],
    any: ['+Wahoo! *Something* went in!', "+Let's see what *happens*!", "!That's not a *cartridge*! ...Let's go!"],
  },
  bearded: {
    sock: ["=Well. That's one way to *darn* a sock.", '=I *sigh* in sixteen bits.', "-This is why we can't have *nice* consoles."],
    snack: ["={label}. Saving it for *later*, apparently.", "=Crisps in the slot. *Crunch* time.", '-I was going to *eat* that.'],
    soda: ['=Soda. Bit *flat*, as a game.', "=It's a can-do *attitude*. Literally.", '-That was my last *fizzy* one.'],
    juice: ['=Juice. Now the console is *sticky* too.', "-I'll get the *mop*.", '=That one was *concentrated* foolishness.'],
    pizza: ["=Pizza. That's a *slice* of life I didn't need.", "=It doesn't *fit*. It never fits.", "-Well, there goes *tea*."],
    comic: ['={label}. As in my *back*, bending to fix this.', "=It's a graphic *novel* approach.", '+Fine. That was *quite* funny.'],
    controller: ['=Controller in the console. Very *self-aware*.', "=I'm not *mad*. I'm impressed.", '+A classic *dad* move, to be fair.'],
    any: ['=Well. That *happened*.', '-I just *cleaned* that.', "=Let's call it a *feature*."],
  },
  redhead: {
    sock: ["+Honestly? Best thing that console's *played* all year.", '+One sock *short* of a pair, one game richer.', '=The sock *chose* this. I respect it.'],
    snack: ['+{label} edition. *Limited* release.', '+Crunchy *graphics*. Love it.', "=Bit *crumby* on the loading screen."],
    soda: ['+Fizzy launch, *zero* regrets.', '+A *carbonated* classic.', "=It's mostly *bubbles*, but so am I."],
    juice: ['+Juice level! Very *refreshing*.', "=Sure, it's leaking. It's *fine*.", '+The TV smells *fruity* now.'],
    pizza: ['+Pizza in the slot. *Vibes*.', "+Honestly, it's an *improvement*.", '=Cold pizza runs *smoother*.'],
    comic: ['+{label}! Way more *plot* than most games.', '+Two-player *reading* mode.', "=I'll wait for the *movie*."],
    controller: ['+Controller-ception. *Chef\'s kiss*.', "=It's playing itself. *Relatable*.", '+No hands *needed*. Love that.'],
    any: ['+Sure, why *not*?', '+Chaos looks *good* on that console.', '=Eh. It *works*. Kind of.'],
  },
  'mustard-jumper': {
    sock: ['!To be clear, socks are not a *supported* format. I checked.', '=The manual says *nothing* about socks. I read it twice.', '!That voids the *warranty*. Probably. I should check.'],
    snack: ['!{label} is a *snack*, not a cartridge. I have notes.', '=There are crumbs in the *contacts* now. Seventeen, roughly.', '-I labelled that bag *specifically*.'],
    soda: ['!Liquids near electronics is *risk* number one on my list.', '=Technically it is *aluminium*. Technically.', '!Is it supposed to *hiss* like that?'],
    juice: ['!Juice! In the console! I need a *towel* and a plan.', '-I did a *risk assessment* for exactly this.', '=On the bright side, it is *vitamin* C.'],
    pizza: ['!That slice is at least three times the *slot* width.', '=The cheese has bridged the *pins*. Interesting. Bad, but interesting.', '-I was told this was a *pizza*-free zone.'],
    comic: ['={label}. The *page* count is not compatible.', '!Paper in a slot is a *fire* hazard. Probably.', '+To be fair, it does have a *story* mode.'],
    controller: ['!A controller cannot control *itself*. Can it? I need to check.', '=That is a *loop*. I dislike loops.', '!Who is player one *now*?'],
    any: ['!That is *not* in the spec.', '=I will add this to the *FAQ*.', '-I did *warn* everyone.'],
  },
  'denim-jacket': {
    sock: ["+It's not a bug, it's an *installation*.", '+Sock in console. I call it *Untitled #3*.', '=Mixed *media*. Very mixed.'],
    snack: ['+{label}: a study in *crunch*.', '+The crumbs are the *brushstrokes*.', "=Very pop art. Very *salty*."],
    soda: ['+Soda can, console, *found object*.', '+The fizz is the *soundtrack*.', "=Bit *derivative*. Still nice."],
    juice: ['+A juice *wash*. Bold palette.', '=Is it *art* if it drips? Yes.', '+The puddle is part of the *piece*.'],
    pizza: ['+Pizza on circuit board. *Gallery* ready.', '+Melted cheese, *texture* goals.', "=I'd title it *Cold Slice*."],
    comic: ['+{label}! Now *that\'s* a composition.', "+Comic meets console. It's a *collab*.", '=The panels need more *negative* space.'],
    controller: ['+A controller playing a controller. *Meta* art.', '+Very *recursive*. Very now.', '=It needs a *frame*. Or a fuse.'],
    any: ['+Everything is *art* if you squint.', "+I'm calling it a *happening*.", '=Hmm. *Interesting* choice.'],
  },
  hoodie: {
    sock: ['+Any% sock glitch. New world *record*.', '+Skipped the whole game with one *sock*. Frame perfect.', "=Gonna need a *reset*."],
    snack: ['+{label} skip! Saves *four* seconds.', '+Crisp *clip* through the slot. Nice.', "=Lost a *frame* on the crunch."],
    soda: ['+Soda boost. *Speed* tech.', '+Can launch *strat*. Wild.', "!That's a *softlock*. Probably."],
    juice: ['=Water level. Worst *level*.', "!Juice got into the *RNG*.", '-Run *killed* by juice.'],
    pizza: ['+Pizza *pause* buffer. Big brain.', "+Slice clip. *Out of bounds*!", "=It's not optimal but it's *tasty*."],
    comic: ['+Speedrunning *literature*. {label}!', '+Skipped every *cutscene*.', '=Reading is a *slow* category.'],
    controller: ['+TAS *mode*. It plays itself.', '+Controller in console. *Tool*-assisted.', '!Two inputs, *zero* hands.'],
    any: ['+New *category* just dropped.', '+GG. *Frame* perfect.', '=Reset the *run*.'],
  },
  emo: {
    sock: ['-Even the console rejects me. ...*Same*, console. Same.', '-A lone sock, *forgotten*. I know the feeling.', '+Okay that was *kind of* great.'],
    snack: ["-{label}. It's not a game, it's a *cry* for help.", '+Crunchy *despair*. My favourite.', "-Even the crisps feel *empty*."],
    soda: ['-Flat. Like my *heart*.', '+It fizzed. It *felt* something.', '=The console is *bitter* now.'],
    juice: ['-The console *weeps* juice.', '-Sticky, like my *memories*.', '+Okay, the drip trail is *very* aesthetic.'],
    pizza: ['-Pizza, cold as the *world*.', '+Folded in half. *Relatable*.', '=No one *understands* pizza like I do.'],
    comic: ['-{label}... nobody hears the *panels* scream.', "+The hero's sad backstory *slaps*.", '-My life in *black and white*.'],
    controller: ['-A controller, *controlled*. Like us all.', "+That's *deep*, actually.", '-Player one has left the *chat*.'],
    any: ['-Of course it *did*.', '+Fine, that was *fun*. Tell no one.', '-This is my *life* now.'],
  },
  goth: {
    sock: ['-The sock descends into the *abyss*. As all things must.', '=Its pair waits in the *dark*. Forever.', '+A fitting *tomb*.'],
    snack: ['={label}. A feast for the *void*.', '+The crisps rest in *peace*.', '-The bag is *empty*. Like everything.'],
    soda: ['=The bubbles rise. The can *falls*.', '+An elegant *hiss*, like a cat in a graveyard.', '-The fizz is *dead*. Long live the fizz.'],
    juice: ['=The machine drinks. It *thirsts* no more.', '+Crimson juice. *Very* fitting.', '-Spilled, like *candle* wax at midnight.'],
    pizza: ['=Pizza: *mortal*, cold, delicious.', '+A slice for the *shadows*.', "-Even pizza can't escape *entropy*."],
    comic: ['={label}. The hero dies at *dawn*.', '+Gothic *panels*. Approved.', '-The ink bleeds *dark*. Good.'],
    controller: ['=The controller *controls* nothing now.', '+A haunted *loop*. Lovely.', '-Player one is a *ghost*.'],
    any: ['=Into the *dark* it goes.', '+How *delightfully* grim.', '-Everything ends. Even *that*.'],
  },
  punk: {
    sock: ['+No rules! No cartridges! *JUST SOCK!*', '+Sock the *system*!', "+They said socks don't fit. *Watch me*."],
    snack: ['+{label} riot! *Crunch* the system!', '+Crisps in the console! *Anarchy*!', '!That bag was *full*. Was.'],
    soda: ['+Shake it up! *Smash* the can!', '+Fizz the *establishment*!', "!It's *exploding*! Brilliant!"],
    juice: ['+Juice *revolution*!', "!It's *leaking*! Even better!", '+No towels! *No surrender*!'],
    pizza: ['+Pizza in the console! The man *can\'t stop* us!', '+Extra cheese, extra *rebellion*!', '+Folded and *proud*!'],
    comic: ['+{label}! Punk *zine* mode!', '+Read it *loud*!', '+DIY *game*! Nobody asked!'],
    controller: ['+Controller controls itself! *No masters*!', '+Two controllers, *one* rule: none!', '!It *unionised*!'],
    any: ['+No rules! *Just this*!', '+Break the *slot*!', '!It went *in*! Amazing!'],
  },
  'rainbow-tee': {
    sock: ["+Yes, sock! Look at you go! You're a *game* now!", '+Sock, you *did it*!', "+Sock's *main character* era!"],
    snack: ['+{label}, you *superstar*!', '+Crisps getting the *spotlight*! Love!', '+Best *snack* debut ever!'],
    soda: ['+Go, soda, *go*!', '+Fizzy and *fabulous*!', "+That can's a *natural*!"],
    juice: ['+Juice is *living* its best life!', '+Splash *zone*! Amazing!', '=Okay, a *bit* messy. Still proud!'],
    pizza: ['+Pizza slice, *icon*!', '+So proud of that *pizza*!', '+Ten out of ten *slice*!'],
    comic: ['+{label}! *Stunning* debut!', '+The comic is *thriving*!', '+Front page *material*!'],
    controller: ['+Two controllers? *Teamwork*!', '+It believes in *itself*!', '+Controller *support* group!'],
    any: ['+You go, *thing*!', "+That's the *spirit*!", '+So *proud* of you, random object!'],
  },
  'trans-flag-hair': {
    sock: ['+Go on, little sock, live your *dream*.', '+Every sock deserves a *quest*.', '+Wave goodbye to the *drawer*!'],
    snack: ['+{label}, off on an *adventure*!', '+Hello, crisps! *Welcome* to the castle!', '=Bye, crisps. I barely *knew* you.'],
    soda: ['+Little can, *big* dreams!', "+Fly, soda, *fly*!", '=You were *fizzier* than this, once.'],
    juice: ['+Juice, you get a *bath* in there!', '-Oh no, *sticky* little console!', '+Swim, juice, *swim*!'],
    pizza: ['+Pizza wants to be a *hero*!', "+Hello, slice! Don't be *scared*!", '+A *cheesy* new beginning!'],
    comic: ['+{label}! The comic *gets* it.', '+Comic, meet *console*. Be friends!', '+A *story* inside a story!'],
    controller: ['+Look, they found a *friend*!', '+Controller *family* reunion!', '+Aww, it wants to *play* too!'],
    any: ['+Good *luck* in there!', '+Be *brave*, little thing!', '=Oh! Hello, *you*!'],
  },
  'trans-pin': {
    sock: ["=I've made worse *decisions*. Not many, but some.", '+Well, it *fits*. Sort of.', '=The sock looks *calm*. More than me.'],
    snack: ["={label}. We'll call it a *tasting* menu.", "+There's a *crumb* of logic to it.", '=I was saving those for *Friday*.'],
    soda: ['=Gently does *it*. Too late.', "+Fizz. Well. That's *something*.", '=Note to self: *cans* are not games.'],
    juice: ['-I had *one* job.', "=It's fine. Juice is *mostly* water.", '+Well, the console *smells* nice.'],
    pizza: ['=The pizza *insisted*.', "+Honestly, it's the best *meal* that console's had.", "=Let's not *mention* this."],
    comic: ['+{label}. Fair *point*, comic.', "=Bit of light *reading* for the console.", '+A quiet *classic*.'],
    controller: ['=Who controls the *controller*? Philosophy.', '+It looks *happier* in there.', "=I'll just *unplug* myself."],
    any: ['=Well. That *happened*.', '+Could be *worse*.', '=Quietly *impressive*.'],
  },
  'bi-bomber': {
    sock: ["+Sock in the slot. Nobody's ever done it like *this*.", '+Smooth *insert*. Clean.', '+First try. *Obviously*.'],
    snack: ['+{label} drop. *Exclusive*.', '+Crisp in, *no* crumbs. Skill.', '+Limited *edition* move.'],
    soda: ['+Can in the console. *Iconic*.', '+Effortless *fizz*.', "=Didn't even *spill*. Mostly."],
    juice: ['+Splash with *style*.', "=It's leaking, but *fashionably*.", '+Juice, *nailed* it.'],
    pizza: ['+Pizza slot? *Signature* move.', '+Folded it in one *motion*.', '+Never been *done*. Until now.'],
    comic: ['+{label}. *Cover* star.', '+Comic in, *cool* out.', '+That was *cinema*.'],
    controller: ['+Controller on controller. *Power* move.', '+Even the console is *impressed*.', '+One-handed. *Easy*.'],
    any: ['+*Nailed* it.', '+Clean. *Smooth*. Done.', "+You're *welcome*, console."],
  },
  'drag-glam': {
    sock: ['!A sock, darling? In THIS *economy*? Iconic.', '+The sock is *serving*.', '!Bold. *Brave*. A little bit wrong.'],
    snack: ['+{label}, darling, you are *stunning*.', '+Crunchy *couture*.', "!Crumbs on the *runway*?!"],
    soda: ['+Fizz, sparkle, *glamour*.', '+The can gave a *performance*.', '!Bubbles everywhere! *Encore*!'],
    juice: ['!Darling, the juice is *everywhere*.', '+A splash *entrance*. Love.', '+Very *wet look*. Very now.'],
    pizza: ['+Pizza slice, *fierce*.', '!Folded? Darling, we do *drama*.', '+Extra cheese is a *lifestyle*.'],
    comic: ['+{label}! Give me panels, give me *story*.', '+The comic is *giving* hero.', '!The plot *thickens*, darling.'],
    controller: ['+A controller inside a controller? Very *meta*, very fashion.', '+Double the *drama*.', '!It plays *itself*? Iconic.'],
    any: ['+Darling, *iconic*.', '!Gasp! *Scandalous*!', '+A *moment*. Truly.'],
  },
  'nb-beanie': {
    sock: ["=Is it a game if it's a sock? Is *anything*?", "=Socks: the console's *existential* crisis.", '+Maybe the sock was the *quest* all along.'],
    snack: ['={label}: a game *about* snacking. Or the other way round.', '=If crisps fall in a console, do they make a *sound*?', '+Snack as *metaphor*. Got it.'],
    soda: ['=The can is half *full*. Of console.', '+Bubbles are just *tiny* questions.', '=Fizz is temporary. Like *everything*.'],
    juice: ['=Where does the juice *end* and the console begin?', '-Some spills are *permanent*.', '+Fluid *identity*, console.'],
    pizza: ['=Is a folded slice still a *slice*?', '+Pizza: the original *open world*.', '=Hmm. Cheese as *interface*.'],
    comic: ['={label}. Words are just *noise* until you read them.', '+A comic in a console. *Layers*.', "=Who's reading *whom*?"],
    controller: ['=If it controls itself, is it *free*?', '+Nice *loop*. Very zen.', '!Wait. Am I the *controller*?'],
    any: ['=Interesting. Or is *it*?', '+Sure. *Why not*?', "=Let's sit with *that*."],
  },
  'hijab-skater': {
    sock: ['+Kickflip into the cartridge slot. Stuck the *landing*!', '+Sock *grind*! Clean!', "+Ten points for *style*!"],
    snack: ['+{label} *ollie*! Big air!', '+Crisp *bail*, but cool!', '+Smooth *drop-in*!'],
    soda: ['+Can *launch*! Huge!', '+Soda *slide*, nailed it!', "!It *rolled* off! Again!"],
    juice: ['!Juice *wipeout*!', '+Splash *combo*!', '=Slippery *landing*. Respect.'],
    pizza: ['+Pizza *manual* into the slot!', '+Slice *spin*, full rotation!', '+Cheese grab! *Sick*!'],
    comic: ['+{label}! *Trick* of the day!', '+Comic *flip*!', '+Read it mid-*air*!'],
    controller: ['+Controller *combo*! Double trick!', '+Two-pad *rail* slide!', '!It landed *itself*!'],
    any: ['+Stuck the *landing*!', '+Clean *line*!', "!That's a *new* trick!"],
  },
  'silver-locs': {
    sock: ['+In my day we put the sock on the *foot*. Bold choice.', '=The sock had a good *run*, love.', "+Well, it's warmer in *there*."],
    snack: ["+{label}? That's not a game, love, that's *lunch*.", "=You'll want a *plate* for that.", '+I used to hide crisps in *drawers*. Same idea.'],
    soda: ['=Fizzy pop. Rots your *circuits*.', "+A can! Very *modern*.", '=Back in my day cans had *ring pulls*.'],
    juice: ['=Juice everywhere. I\'ll put the *kettle* on.', '+Watering the console. It might *grow*.', '-That was my good *glass*.'],
    pizza: ["+Pizza in the slot. You'll make a fine *cook* one day.", "=Eat it first, love. That's the *trick*.", '+Cold pizza: a *classic* for a reason.'],
    comic: ['+{label}! I had that *issue*.', "+Comics. That's *real* reading, that is.", '=Mind the *pages*, they\'re older than you.'],
    controller: ['+A controller playing a controller. *Clever* clogs.', '=Even the controller needs a *rest*.', "+That's the *family* business."],
    any: ['+Well, I *never*.', '=Curious *choice*, love.', '+You *always* surprise me.'],
  },
  flannel: {
    sock: ['=Tried to fix it with a sock. *Classic* me.', '=Sock as a *gasket*. Might hold.', "+Sometimes you use what's in the *truck*."],
    snack: ['={label}. Field *rations*.', '=Crumbs in the *works*. Seen worse.', "+It'll do as *packing*."],
    soda: ['=Can as a *shim*. Rough fix.', '+Fizz is just *pressure*. Manageable.', '=That will *rust*.'],
    juice: ['-Juice in the *bearings*.', "=Needs a *drain* plug.", "=Leaks happen. *Patch* it later."],
    pizza: ['=Pizza wedge holding the *slot*. Practical.', "+Best *door stop* I've made.", '=Cheese as *sealant*. Not ideal.'],
    comic: ['={label}. Good *kindling*. Not today.', '+Reading the *manual*. Sort of.', '=Comic as a *spacer*. Fine.'],
    controller: ['=Spare controller as a *spare part*.', "+If it works, it *works*.", '=Two of them. *Backup*.'],
    any: ['=That should *hold*.', '+Rough, but it *works*.', '=Tighten it *later*.'],
  },
};

/** A junk line, ready for the dialogue box. */
export type JunkLine = DialogueLine;

/** The raw lines for a hero and kind (falling back to the hero's generic ones). */
export function junkLines(hero: HeroId, kind: string): string[] {
  const lines = LINES[hero] ?? LINES.classic;
  return (lines as Record<string, string[]>)[kind] ?? lines.any;
}

export { parseLine };

/** A line from `hero` about putting `kind` in the console, never the same as `last` (its text) twice running. */
export function junkLine(hero: HeroId, kind: string, label = '', last?: string, r: () => number = Math.random): JunkLine {
  const lines = junkLines(hero, kind).map((l) => parseLine(l, label));
  const fresh = lines.length > 1 ? lines.filter((l) => l.text !== last) : lines;
  return fresh[Math.floor(r() * fresh.length)];
}

/** Every hero's raw lines, for tests. */
export const JUNK_LINES = LINES;
