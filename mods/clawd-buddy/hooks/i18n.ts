// clawd-buddy: Texte in zwei Sprachen (Einstellung `language`, Standard en; release/I18N.md). Rein, kein `$`.
// Die Figur selbst zeigt keinen Text; übersetzt werden die Ausgaben von /clawd, der alt-Text des Desktop-Bilds und die Clip-Namen.
// Clip-Bezeichnungen stehen deutsch in den Clip-Dateien (`label`), die englischen hier (CLIP_EN).

export type Lang = 'en' | 'de'

export const langOf = (v: unknown): Lang => (v === 'de' ? 'de' : 'en')

/** Zahl mit fester Nachkommazahl: en `1.5`, de `1,5`. */
export const num = (lang: Lang, n: number, digits = 1): string => {
  const s = n.toFixed(digits)
  return lang === 'de' ? s.replace('.', ',') : s
}

type Texts = {
  description: string
  help: string
  on: string
  off: string
  demoUsage: string
  demoNone: (arg: string) => string
  demoPlays: (name: string, label: string) => string
  demoMore: (names: string) => string
  nap: string
  unknown: (sub: string) => string
  status: (o: { on: boolean; mood: string; temper: string; tired: number; annoy: number; desk: string }) => string
  mood: { veryGrumpy: string; grumpy: string; great: string; good: string; even: string }
  deskNone: string
  desk: (o: { secs: string; draws: number; perMin: string; planSecs: string; changes: string; kb: string; calcAvg: string; calcMax: string; drawAvg: string; drawMax: string; others: string }) => string
  alt: string
}

export const T: Readonly<Record<Lang, Texts>> = {
  en: {
    description: 'Control the mascot',
    help: 'Commands: on | off | list | demo <animation> | nap | boop | status',
    on: 'clawd-buddy: on',
    off: 'clawd-buddy: off',
    demoUsage: 'clawd demo <animation>. /clawd list shows all of them.',
    demoNone: (arg) => `no animation "${arg}". /clawd list shows all of them.`,
    demoPlays: (name, label) => `playing: ${name} (${label})`,
    demoMore: (names) => `, more matches: ${names}`,
    nap: 'clawd-buddy: getting sleepy …',
    unknown: (sub) => `unknown: ${sub}.`,
    status: (o) => `clawd-buddy: ${o.on ? 'on' : 'off'}, ${o.mood} (${o.temper}), tiredness ${o.tired}%, annoyance ${o.annoy}. ${o.desk}.`,
    mood: { veryGrumpy: 'very grumpy', grumpy: 'grumpy', great: 'in a great mood', good: 'in a good mood', even: 'calm' },
    deskNone: 'Desktop drawing: no data (only runs in the desktop app while the band is drawn)',
    desk: (o) =>
      `Desktop drawing, last ${o.secs} s: ${o.draws} draws (${o.perMin}/min), animations avg ${o.planSecs} s with ${o.changes} frame changes, ` +
      `${o.kb} kB; compute avg ${o.calcAvg} / max ${o.calcMax} ms, draw avg ${o.drawAvg} / max ${o.drawMax} ms (other mods avg ${o.others} ms)`,
    alt: 'Clawd, the mascot',
  },
  de: {
    description: 'Maskottchen steuern',
    help: 'Befehle: on | off | list | demo <animation> | nap | boop | status',
    on: 'clawd-buddy: an',
    off: 'clawd-buddy: aus',
    demoUsage: 'clawd demo <animation>. Mit /clawd list siehst du alle.',
    demoNone: (arg) => `keine Animation „${arg}“. /clawd list zeigt alle.`,
    demoPlays: (name, label) => `spielt: ${name} (${label})`,
    demoMore: (names) => `, weitere Treffer: ${names}`,
    nap: 'clawd-buddy: wird müde …',
    unknown: (sub) => `unbekannt: ${sub}.`,
    status: (o) => `clawd-buddy: ${o.on ? 'an' : 'aus'}, ${o.mood} (${o.temper}), Müdigkeit ${o.tired} %, Ärger ${o.annoy}. ${o.desk}.`,
    mood: { veryGrumpy: 'sehr gereizt', grumpy: 'gereizt', great: 'bester Laune', good: 'gut gelaunt', even: 'ausgeglichen' },
    deskNone: 'Desktop-Zeichnung: keine Daten (läuft nur im Desktop, während das Band gezeichnet wird)',
    desk: (o) =>
      `Desktop-Zeichnung, letzte ${o.secs} s: ${o.draws} Zeichnungen (${o.perMin}/min), Animationen Ø ${o.planSecs} s mit ${o.changes} Bildwechseln, ` +
      `${o.kb} kB; Rechnen Ø ${o.calcAvg} / max ${o.calcMax} ms, Zeichnen Ø ${o.drawAvg} / max ${o.drawMax} ms (davon andere Mods Ø ${o.others} ms)`,
    alt: 'Clawd, das Maskottchen',
  },
}

/** Englische Bezeichnungen der Clips (die deutschen stehen als `label` an jedem Clip). */
export const CLIP_EN: Readonly<Record<string, string>> = {
  idle_breathe: 'Breathing & blinking',
  idle_look: 'Looking around',
  stretch: 'Stretching',
  whistle: 'Whistling',
  fly_chase: 'Chasing a fly',
  pebble_kick: 'Kicking a pebble',
  dance: 'Little dance',
  juggle: 'Juggling',
  stroll_whistle: 'Strolls and whistles',
  smell_flower: 'Smells a flower',
  dribble_ball: 'Bouncing a ball',
  bubbles: 'Soap bubbles',
  hop: 'Hopping',
  grumble_kick: 'Kicks grumpily',
  happy_hum: 'Hums happily',
  nap_sitting: 'Nap while sitting',
  night_candle: 'Tea light at night',
  night_sheep: 'Counting sheep',
  night_stars: 'Stargazing',
  bday_cake: 'Birthday cake',
  bday_party: 'Birthday party',
  ny_fireworks: 'Fireworks',
  ny_sparkler: 'Sparkler',
  type_laptop: 'Types on the laptop',
  type_fast: 'Types fast',
  type_sleepy: 'Types sleepily (at night)',
  read_scroll: 'Reads a scroll',
  magnify: 'Magnifying glass',
  terminal_watch: 'Watches the terminal',
  shell_log: 'Watches the log window',
  shell_spinner: 'Waits for the tablet',
  press_buttons: 'Presses buttons',
  globe_spin: 'Globe',
  antenna: 'Antenna (web)',
  wifi_router: 'Wi-Fi router',
  think_dots: 'Thinking (…)',
  think_tap: 'Pondering',
  shell_keys: 'Types on a mini keyboard',
  web_dove: 'Carrier pigeon',
  type_grumpy: 'Types grumpily',
  type_tired: 'Types tiredly',
  think_sigh: 'Sighs while thinking',
  think_happy: 'Thinks cheerfully',
  think_chin: 'Rubs his chin',
  think_scratch: 'Scratches his head',
  think_pace: 'Paces thoughtfully',
  think_look_up: 'Looks up thoughtfully',
  think_tap_foot: 'Taps his foot while pondering',
  git_graph: 'Watches the commit graph',
  test_checklist: 'Ticks off a checklist',
  git_save: 'Saves to a floppy disk',
  git_push: 'Pushes up into the cloud',
  test_tube: 'Shakes a test tube',
  wave_helper: 'Waves to the helper',
  high_five_helper: 'High five with the helper',
  fist_bump_helper: 'Fist bump with the helper',
  chat_helper: 'Chats with the helper',
  hop_with_helper: 'Hops with the helper',
  pat_helper: 'Pats the helper',
  helper_report: 'Helper tells a story',
  helper_busy: 'Helper is working',
  helper_think: 'Helper is thinking',
  helper_night_watch: 'Watches the helper sleepily',
  helper_doze: 'Dozes next to the helper',
  chat_second: 'Talks to the second helper',
  nod_to_team: 'Nods to the team',
  team_glance: 'Counts the team',
  helper_gift: 'Helper brings a present',
  handoff_note: 'Helper hands over a note',
  handoff_stack: 'Helper hands over a stack of pages',
  handoff_folder: 'Helper hands over a folder',
  handoff_envelope: 'Helper hands over an envelope',
  foot_tap: 'Foot tapping',
  watch_check: 'Checks the clock',
  sit_wait: 'Sits and waits',
  lie_wait: 'Lies down and waits',
  build_tower: 'Builds a little tower',
  sand_glass: 'Hourglass',
  walk_pace: 'Paces while waiting',
  look_prompt: 'Looks at the prompt',
  wave_question: 'Waves with a question mark',
  sign_question: 'Holds up a question mark sign',
  peek_prompt: 'Reads along while you type',
  nod: 'Nods in agreement',
  read_along: 'Reads along (line by line)',
  take_notes: 'Takes notes',
  rub_hands: 'Rubs his hands eagerly',
  impatient_huff: 'Huffs impatiently',
  knock_prompt: 'Knocks on the input',
  big_wave_question: 'Waves big with a question mark',
  alarm_nap: 'Dozes next to the alarm clock',
  spin_top: 'Plays with a spinning top',
  limit_annoyed: 'Annoyed (waiting for the limit)',
  limit_sad: 'Sad (not allowed to work)',
  suitcase_wait: 'Sits on packed bags and counts days',
  fishing_wait: 'Sits with a fishing rod and waits',
  sandglass_wait: 'Waits with the hourglass',
  limit_garden: 'Watches the flower grow',
  limit_paint: 'Paints a picture',
  limit_back_jump: 'Back to work (jump for joy)',
  limit_back_confetti: 'Back to work (confetti)',
  celebrate_jump: 'Jump for joy',
  sparkle_cheer: 'Cheers with sparkles',
  shrug: 'Shrug',
  sweat_drop: 'Drop of sweat',
  facepalm: 'Facepalm',
  stomp: 'Stomps in anger',
  relief: 'Relieved',
  victory_dance: 'Victory dance',
  streak_trophy: 'Trophy (winning streak)',
  streak_medal: 'Medal (winning streak)',
  yawn: 'Yawning',
  drowsy: 'Nodding off',
  sleep: 'Sleeping (zZz)',
  startled: 'Startled awake',
  rub_eyes: 'Rubbing his eyes',
  morning_stretch: 'Morning stretch',
  coffee: 'Coffee',
  morning_brush: 'Brushing teeth',
  giggle: 'Giggling',
  boop: 'Boop',
  blush: 'Blushing',
  grumpy: 'Annoyed',
  sulk: 'Sulking',
  held_wiggle: 'Lifted up (wriggles)',
  dizzy: 'Dizzy',
  sit_down: 'stand → sit',
  stand_up: 'sit → stand',
  lie_down: 'sit → lie',
  get_up: 'lie → sit',
  turn_away: 'turn away',
  turn_back: 'turn back',
  lift: 'stand → lifted',
  drop: 'lifted → stand',
}

/** Bezeichnung eines Clips in der eingestellten Sprache. */
export const clipLabel = (lang: Lang, c: { name: string; label: string }): string => (lang === 'de' ? c.label : (CLIP_EN[c.name] ?? c.name))
