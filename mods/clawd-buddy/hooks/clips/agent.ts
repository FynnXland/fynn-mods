// clawd-buddy: Clips der Gruppe "agent" (Stimmung work_agent: ein Subagent läuft; agent_done: ein Subagent ist fertig).
//
// Fynn (Rückmeldung zu den Subagenten): Die Helfer sollen anders aussehen und kleiner sein, nicht ständig auftauchen und verschwinden und nicht
// zu zweit oder zu dritt auf einmal kommen. Läuft ein Subagent, steht genau EIN Helfer die ganze Zeit neben Clawd; es gibt verschiedene
// Interaktionen zwischen beiden. Das Geschenk gibt es nur, wenn ein Subagent fertig ist.
//
// Aufteilung mit der Engine (hooks/engine.ts, "Begleiter"): Die Engine lässt den Helfer beim Start des Subagenten von unten aufsteigen,
// zeichnet ihn im Stehen (`agent_s`, mit Blinzeln `agent_sb`) und lässt ihn absinken, wenn der Agent fertig ist. Die Clips hier sind reine
// Interaktionen (`companion: true`): Der Helfer ist darin eine 'g'-Requisite auf Platz 0 (x -8, y 5, 6×5 Pixel); jeder Clip beginnt und endet mit
// `agent_s` genau dort, dann übernimmt die Engine nahtlos. Kein Aufsteigen und Absinken in diesen Clips.
//
// Helfer-Design ("Blobb"): kleines hellblaues, rundes Wesen mit zwei Augen und dunkelblauen Stummelarmen, deutlich anders als der orange Clawd.
// Alle Posen heißen `agent_s<Ziffer>` (gleiche Familie `agent_s`, damit die Prüfung sie als dieselbe Figur verfolgt).
//
// Stil der Hände (Fynn, überall gleich): Clawds Arme sind Blöcke (2 Pixel dick, kurze Stummel, höchstens 6 lang), die in ganzen Pixelschritten auf und ab
// gehen und ein Stück ausfahren.
//
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { fetchOut } from '../macros.ts'

// ---- Der Helfer (6×5): L = hellblau (Körper), N = Marine (Stummelarme), K = Augen. Zeile 4 = Füße. Er schaut Clawd an (Clawd steht rechts von ihm).
// 0 (`agent_s`) steht, `agent_sb`/6 blinzelt, 1 winkt (rechter Arm hoch), 2 winkt (Arm halb), 3 beide Arme hoch (jubelt), 4 redet, 5 duckt sich froh
// (Kopf eine Zeile tiefer, wenn man ihn tätschelt oder er nickt), 7 schaut zur Seite zu Clawd (Augen rechts).
const MATE_STAND = ['.LLLL.', 'LKLLKL', 'NLLLLN', '.LLLL.', '.L..L.']
const MATE_BLINK = ['.LLLL.', 'LNLLNL', 'NLLLLN', '.LLLL.', '.L..L.']
const helperProps: Record<string, PropSprite> = {
  agent_s: { rows: MATE_STAND },
  agent_sb: { rows: MATE_BLINK },
  // Hintere Reihe (Plätze 7–12): dieselbe Gestalt als dunklere blaue Silhouette ohne Einzelheiten
  agent_sback: { rows: ['.NNNN.', 'NKNNKN', 'NNNNNN', '.NNNN.', '.N..N.'] },
  agent_s1: { rows: ['.LLLLN', 'LKLLKN', 'NLLLLL', '.LLLL.', '.L..L.'] },
  agent_s2: { rows: ['.LLLL.', 'LKLLKN', 'NLLLLL', '.LLLL.', '.L..L.'] },
  agent_s3: { rows: ['NLLLLN', 'NKLLKN', 'LLLLLL', '.LLLL.', '.L..L.'] },
  agent_s4: { rows: ['.LLLL.', 'LKLLKL', 'NLKKLN', '.LLLL.', '.L..L.'] },
  agent_s5: { rows: ['......', '.LLLL.', 'LNLLNL', 'NLLLLN', '.L..L.'] },
  agent_s6: { rows: MATE_BLINK },
  // Arbeits-Posen: Blick nach unten auf das winzige Gerät (grauer Streifen am Bauch), die Stummelarme tippen abwechselnd
  agent_s8: { rows: ['.LLLL.', 'LLLLLL', 'LKLLKL', 'NGGGGL', '.L..L.'] },
  agent_s9: { rows: ['.LLLL.', 'LLLLLL', 'LKLLKL', 'LGGGGN', '.L..L.'] },
  agent_s7: { rows: ['.LLLL.', 'LLKLLK', 'NLLLLN', '.LLLL.', '.L..L.'] },
  // Sprechblase (7×4) mit ein, zwei, drei Punkten: Effekt, der vom Sprecher ausgeht
  agent_bub1: { rows: ['.WWWWW.', 'WGWWWWW', '.WWWWW.', '...W...'], effect: true },
  agent_bub2: { rows: ['.WWWWW.', 'WGWGWWW', '.WWWWW.', '...W...'], effect: true },
  agent_bub3: { rows: ['.WWWWW.', 'WGWGWGW', '.WWWWW.', '...W...'], effect: true },
  // Denk-Spinner (6×3, genau über dem Kopf des Helfers): drei Punkte (hell, grau, dunkel) laufen im Kreis um die Mitte; th7 = gelbes Funkeln (Idee)
  agent_th1: { rows: ['..DG..', '....W.', '......'], effect: true },
  agent_th2: { rows: ['...D..', '....G.', '...W..'], effect: true },
  agent_th3: { rows: ['......', '....D.', '..WG..'], effect: true },
  agent_th4: { rows: ['......', '.W....', '..GD..'], effect: true },
  agent_th5: { rows: ['..W...', '.G....', '..D...'], effect: true },
  agent_th6: { rows: ['..GW..', '.D....', '......'], effect: true },
  agent_th7: { rows: ['..YY..', '.YYYY.', '..YY..'], effect: true },
  // Ergebnisse, die der Helfer übergibt (je 5×5): Zettel (beschrieben), Blätterstapel, Mappe, Briefumschlag mit Siegel
  // Geschenk (5×5): blaue Schachtel, gelbes Band als Kreuz, Schleife obenauf
  agent_gift: { rows: ['.Y.Y.', 'BBYBB', 'YYYYY', 'BBYBB', 'BBYBB'] },
  agent_note: { rows: ['CCCCC', 'CGGGC', 'CCCCC', 'CGGCC', 'CCCCC'] },
  agent_stack: { rows: ['.WWWW', '.WGGW', 'WWWWG', 'WGGWG', 'GGGGG'] },
  agent_folder: { rows: ['CCC..', 'CCCCC', 'CWWWC', 'CCCCC', 'CCCCC'] },
  agent_env: { rows: ['WWWWW', 'WGWGW', 'WWMWW', 'WWWWW', 'WWWWW'] },
  // Herzchen (3×3) und Klatsch-Funken (7×5, 7×5, 3×3)
  agent_hs: { rows: ['P.P', 'PPP', '.P.'], effect: true },
  agent_pow: { rows: ['...Y...', '.Y.W.Y.', 'YWWWWWY', '.Y.W.Y.', '...Y...'], effect: true },
  agent_powB: { rows: ['Y..Y..Y', '.YYWYY.', '..WWW..', '.YYWYY.', 'Y..Y..Y'], effect: true },
  agent_pow2: { rows: ['.Y.', 'YWY', '.Y.'], effect: true },
}

/** Requisiten, die nur diese Gruppe braucht (Name → Sprite). Namen müssen über alle Gruppen eindeutig sein (Präfix `agent_`). */
export const PROPS: Readonly<Record<string, PropSprite>> = {
  ...helperProps,
}

// ---- Clawd. Arme: nur Blöcke, 2 dick, in ganzen Pixelschritten.
const CALM: Frame = { armL: 'down', armR: 'down', eyes: 'open', mouth: null, look: [0, 0], fy: 0, legs: 'stand' }
/** Vollständiger Frame: alles Nichtgenannte zurück auf ruhig (so passen Teile und Schleifenränder lückenlos zusammen). */
const P = (patch: Frame = {}): Frame => ({ ...CALM, ...patch })
const HAP: Frame = { eyes: 'happy', look: [-1, 0], mouth: 'smile' } // freut sich
const A = (out: number, y: number) => ({ out, y, h: 2 })
const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Interaktionen mit dem Helfer (work_agent): Platz 0 des Begleiters. Alle Clips sind Schleifen ohne Intro/Outro, der Helfer ist eine 'g'-Requisite
// auf [-8, 5] und kehrt immer in `agent_s` dorthin zurück. Er hat ihn die ganze Zeit; nur Pose (und beim Hüpfen die Höhe) wechselt.
const MX = -8
const MYH = 5
/** Helfer in Pose `v` (0 = steht, sonst `agent_s<v>`), um dx/dy verschoben. */
const HS = (v: number, dx = 0, dy = 0): PropRef => [v ? `agent_s${v}` : 'agent_s', MX + dx, MYH + dy, 'g']
/** Beim Verlassen mitten in der Schleife: Helfer zurück in die Grundpose auf Platz 0 (danach zeichnet ihn wieder die Engine). */
const SETTLE: Frame[] = [{ ...P(), props: [HS(0)], t: 1 }]
/** Ein Takt: [Ticks, Clawd-Frame (alles Nichtgenannte zurück auf ruhig), Requisiten]. */
type Beat = readonly [n: number, c: Frame, ...p: PropRef[]]
const beats = (list: readonly Beat[]): Frame[] => list.map(([n, c, ...p]) => ({ ...P(c), props: p, t: n }))
const FL: Frame = { eyes: 'open', look: [-1, 0], mouth: 'smile' } // schaut den Helfer an
const rep = (n: number, one: readonly Beat[]): Beat[] => Array.from({ length: n }, () => one).flat()
/** Hüpfer des Helfers (Arme hoch in der Luft): Höhen 0, -1, -2, -1; `c` ist Clawds Frame dazu. */
const hopBeats = (n: number, c: (dy: number) => Frame): Beat[] =>
  rep(n, [0, -1, -2, -1].map((dy) => [1, c(dy), HS(dy ? 3 : 0, 0, dy)] as Beat))

// 1. Winken hin und her (der ruhigste Clip, wird bei reduzierter Bewegung genommen): Clawd hebt den Armstummel in Schritten, der Helfer winkt zurück.
// Beide winken dreimal im Wechsel, dann blinzelt der Helfer.
C('wave_helper', 'Winkt dem Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 1,
  frames: beats([
    [3, FL, HS(0)],
    [1, { ...FL, armL: A(2, 3) }, HS(2)],
    [1, { ...FL, armL: A(3, 1) }, HS(1)],
    ...rep(3, [[2, { ...FL, armL: A(3, -1) }, HS(1)], [2, { ...FL, armL: A(3, 1) }, HS(2)]]),
    [1, { ...FL, armL: A(2, 3) }, HS(2)],
    [6, FL, HS(0)], [1, FL, HS(6)], [3, FL, HS(0)],
  ]),
})

// 2. High five: Der Helfer hüpft mit erhobener Hand, Clawd hebt den Stummel dem Helfer entgegen; im höchsten Punkt klatschen die Hände ab
// (Funke darüber, Clawd hüpft mit). Dann freuen sich beide.
const POW_A: PropRef = ['agent_pow', -6, -2, 'g']
const POW_B: PropRef = ['agent_powB', -6, -2, 'g']
const POW_S: PropRef = ['agent_pow2', -5, -1, 'g']
C('high_five_helper', 'High five mit Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 0.3,
  frames: beats([
    [4, FL, HS(0)],
    [1, { ...FL, armL: A(2, 5) }, HS(0)],
    [1, { ...FL, armL: A(3, 4) }, HS(1, 0, -1)],
    [1, { ...FL, armL: A(4, 3), fy: -1 }, HS(1, 0, -2)],
    [1, { ...HAP, armL: A(4, 3), fy: -1 }, HS(1, 0, -2), POW_A],
    [1, { ...HAP, armL: A(4, 3), fy: -1 }, HS(1, 0, -2), POW_B],
    [1, { ...HAP, armL: A(4, 3), fy: -1 }, HS(1, 0, -2), POW_A],
    [1, { ...HAP, armL: A(3, 4), fy: 0 }, HS(3, 0, -1), POW_S],
    [1, { ...HAP, armL: A(2, 5) }, HS(3, 0, 0)],
    [2, HAP, HS(5)], [2, HAP, HS(0)], [1, FL, HS(6)], [5, FL, HS(0)],
  ]),
})

// 3. Faustgruß: Clawd streckt den Stummel in Schritten aus, bis er die Faust (Stummelarm) des Helfers berührt; kurz ausholen, anstoßen (Funke), beide freuen sich.
const SPARK: PropRef = ['agent_pow2', -3, 3, 'g']
C('fist_bump_helper', 'Faustgruß mit Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 0.5,
  frames: beats([
    [4, FL, HS(0)],
    [1, { ...FL, armL: A(2, 6) }, HS(0)],
    [1, { ...FL, armL: A(3, 6) }, HS(0)],
    [2, { ...FL, armL: A(4, 6) }, HS(0)],
    [1, { ...HAP, armL: A(3, 6) }, HS(0)],
    [1, { ...HAP, armL: A(4, 6) }, HS(0), SPARK],
    [2, { ...HAP, armL: A(4, 6) }, HS(5), SPARK],
    [1, { ...HAP, armL: A(3, 6) }, HS(5)],
    [1, { ...HAP, armL: A(2, 5) }, HS(0)],
    [2, HAP, HS(5)], [2, HAP, HS(0)], [1, FL, HS(6)], [5, FL, HS(0)],
  ]),
})

// 4. Kleines Gespräch: Punkte-Sprechblasen wandern abwechselnd über den Helfer und über Clawd (ein, zwei, drei Punkte), der jeweils andere nickt.
// Zum Schluss freut sich der Helfer mit einem Hüpfer.
const BH = (n: number): PropRef => [`agent_bub${n}`, -8, 0, 'g'] // über dem Helfer (Schwanz über seiner Kopfmitte, x -5)
const BC = (n: number): PropRef => [`agent_bub${n}`, 5, -4, 'g'] // über Clawd (Schwanz über seiner Kopfmitte, x 8)
C('chat_helper', 'Plaudert mit dem Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 1.5,
  frames: beats([
    [2, FL, HS(0)],
    [2, FL, HS(4), BH(1)], [2, { ...FL, by: 1 }, HS(0), BH(2)], [2, FL, HS(4), BH(3)], [2, { ...FL, by: 1 }, HS(0), BH(3)],
    [2, FL, HS(7)],
    [2, { ...FL, mouth: 'o' }, HS(7), BC(1)], [2, FL, HS(5), BC(2)], [2, { ...FL, mouth: 'o' }, HS(7), BC(3)], [2, FL, HS(5), BC(3)],
    [2, FL, HS(7)],
    [2, FL, HS(4), BH(1)], [2, FL, HS(0), BH(2)],
    [1, HAP, HS(3, 0, -1)], [1, HAP, HS(3, 0, -1)], [1, HAP, HS(0)], [4, FL, HS(0)],
  ]),
})

// 5. Tanzen: Erst hüpft der Helfer (Clawd klatscht mit dem Stummel mit), dann Clawd (der Helfer klatscht mit), dann hüpfen beide zusammen.
const clap = (dy: number): Frame => ({ ...HAP, armL: dy < 0 ? A(3, -1) : A(3, 1) })
const clawdHop = (n: number, h: (fy: number) => Beat): Beat[] => rep(n, [0, -1, -1, 0].map(h))
C('hop_with_helper', 'Hüpft mit dem Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 0.2,
  frames: beats([
    [3, FL, HS(0)],
    ...hopBeats(2, clap),
    ...clawdHop(2, (fy) => [1, { ...HAP, armL: fy ? A(3, -1) : A(3, 1), armR: fy ? A(3, -1) : A(3, 1), fy }, HS(fy ? 1 : 2)] as Beat),
    ...rep(2, [0, 1, 2, 3].map((k) => [1, { ...HAP, fy: [0, -1, -1, 0][k], armL: k === 1 || k === 2 ? A(3, -1) : A(3, 1), armR: k === 1 || k === 2 ? A(3, -1) : A(3, 1) }, HS([0, 3, 3, 0][k], 0, [0, -1, -2, -1][k])] as Beat)),
    [2, HAP, HS(3)], [2, HAP, HS(0)], [1, FL, HS(6)], [3, FL, HS(0)],
  ]),
})

// 6. Tätscheln: Der Helfer tritt zwei Schritte näher, Clawd streckt den Stummel aus und tätschelt ihm den Kopf (der Helfer duckt sich froh), ein Herz steigt auf.
// Dann geht der Helfer zurück auf seinen Platz.
const HEART = (y: number): PropRef => ['agent_hs', -6, y, 'g']
C('pat_helper', 'Tätschelt den Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 0.5,
  frames: beats([
    [3, FL, HS(0)],
    [1, FL, HS(0, 1)], [1, FL, HS(0, 2)],
    [1, { ...FL, armL: A(3, 3) }, HS(0, 2)], [1, { ...FL, armL: A(5, 3) }, HS(0, 2)], [1, { ...FL, armL: A(6, 3) }, HS(0, 2)],
    [1, { ...HAP, armL: A(6, 3) }, HS(0, 2)], [1, { ...HAP, armL: A(6, 4) }, HS(5, 2)],
    [1, { ...HAP, armL: A(6, 3) }, HS(0, 2)], [1, { ...HAP, armL: A(6, 4) }, HS(5, 2), HEART(0)],
    [1, { ...HAP, armL: A(6, 3) }, HS(0, 2), HEART(-1)], [1, { ...HAP, armL: A(6, 4) }, HS(5, 2), HEART(-2)],
    [1, { ...HAP, armL: A(5, 3) }, HS(0, 2)], [1, { ...HAP, armL: A(3, 3) }, HS(3, 2, -1)], [1, { ...HAP, armL: A(2, 4) }, HS(3, 2)],
    [1, HAP, HS(0, 1)], [1, HAP, HS(0)], [1, FL, HS(6)], [4, FL, HS(0)],
  ]),
})

// ---- Ruhige Clips (Fynn: die beiden sind zu aktiv; der Helfer soll öfter mit sich selbst beschäftigt sein, und wenn sie sich unterhalten, dann ruhig).
const N0: Frame = { eyes: 'open', look: [0, 0], mouth: null } // Clawd schaut geradeaus und wartet
const TH = (n: number): PropRef => [`agent_th${n}`, -8, 1, 'g'] // Spinner genau über dem Kopf des Helfers (ein Pixel Abstand)

// 7. Erzählt: Sprechblasen nur beim Helfer, er redet ruhig in zwei Absätzen; Clawd hört zu und nickt.
C('helper_report', 'Helfer erzählt', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 1,
  frames: beats([
    [3, FL, HS(0)],
    [2, FL, HS(4), BH(1)], [2, FL, HS(0), BH(2)], [2, FL, HS(4), BH(3)], [3, FL, HS(0), BH(3)],
    [3, { ...FL, by: 1 }, HS(0)],
    [3, FL, HS(0)],
    [2, FL, HS(4), BH(1)], [2, FL, HS(0), BH(2)], [2, FL, HS(4), BH(3)], [2, FL, HS(0), BH(3)], [2, FL, HS(4), BH(3)],
    [3, { ...FL, by: 1 }, HS(0)],
    [4, FL, HS(0)], [1, FL, HS(6)], [4, FL, HS(0)],
  ]),
})

// 8. Arbeitet für sich: Der Helfer tippt auf seinem winzigen Gerät (grauer Streifen am Bauch, Arme wechseln sich ab). Clawd schaut ab und zu hin; einmal blickt der
// Helfer auf, Clawd nickt, dann tippt er weiter.
const typing = (n: number, c: Frame): Beat[] => rep(n, [[2, c, HS(8)], [2, c, HS(9)]])
C('helper_busy', 'Helfer arbeitet', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 3,
  frames: beats([
    [3, N0, HS(0)],
    ...typing(4, N0),
    ...typing(1, FL),
    [3, FL, HS(7)], [2, { ...FL, by: 1 }, HS(7)], [2, FL, HS(0)],
    ...typing(3, FL),
    ...typing(1, N0),
    [4, N0, HS(0)], [1, N0, HS(6)], [3, N0, HS(0)],
  ]),
})

// 9. Denkt nach: Der Helfer starrt nachdenklich zur Seite, über seinem Kopf (genau mittig, kein Sprechblasen-Umriss) kreisen drei Punkte wie bei einem Ladekreis,
// dann blitzt ein gelbes Funkeln auf (Idee) und er werkelt los (Tippen). Clawd wartet geduldig.
const SPIN = Array.from({ length: 13 }, (_, k): Beat => [1, FL, HS(7), TH(((k + 2) % 6) + 1)])
C('helper_think', 'Helfer denkt nach', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, outro: SETTLE, weight: 1.5,
  frames: beats([
    [3, FL, HS(0)],
    [1, FL, HS(0), TH(3)],
    ...SPIN,
    [1, { ...FL, eyes: 'closed' }, HS(7), TH(3)],
    [3, FL, HS(1), ['agent_th7', -8, 1, 'g']],
    ...typing(2, FL),
    [3, FL, HS(0)], [1, FL, HS(6)], [3, FL, HS(0)],
  ]),
})

// ---- Nachts (when: 'night'): Läuft ein Subagent länger, schläft Clawd nicht wie im Leerlauf ein, sondern setzt sich neben den arbeitenden Helfer.
// Hinsetzen im Intro, Aufstehen im Outro (so beginnt und endet jeder Clip stehend); der Helfer werkelt die ganze Zeit (agent_s8/agent_s9).
const SIT: Frame = { by: 2, eyes: 'half', look: [-1, 0], mouth: null } // sitzt und schaut müde zum Helfer
const sitDown = (c: Frame): Frame[] => beats([[2, { ...c, by: 1 }, HS(0)], [2, c, HS(0)]])
const standUp = (c: Frame): Frame[] =>
  beats([[2, { ...c, by: 1, mouth: null }, HS(0)], [1, { by: 0, fy: -1, legs: 'tuck', eyes: 'half' }, HS(0)], [2, { eyes: 'open' }, HS(0)]])
const ZZ = (n: number, y: number): PropRef => [n ? 'zb' : 'zs', 16 + n, y]

// 10. Schaut müde zu: Er sitzt, die Augen sind halb offen (langsames Blinzeln), zwischendurch gähnt er; der Helfer tippt und schaut einmal zu ihm herüber.
C('helper_night_watch', 'Schaut dem Helfer müde zu', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, when: 'night', weight: 3,
  intro: sitDown(SIT),
  frames: beats([
    ...typing(3, SIT),
    [2, { ...SIT, eyes: 'closed' }, HS(8)], [3, SIT, HS(9)],
    ...typing(2, SIT),
    [2, { ...SIT, eyes: 'closed', mouth: 'yawn' }, HS(8)], [5, { ...SIT, eyes: 'closed', mouth: 'yawnBig' }, HS(9)], [2, { ...SIT, eyes: 'closed', mouth: 'yawn' }, HS(8)],
    [3, SIT, HS(9)],
    ...typing(2, SIT),
    [3, SIT, HS(7)], [2, { ...SIT, eyes: 'closed' }, HS(7)], [2, SIT, HS(0)],
    ...typing(2, SIT),
  ]),
  outro: standUp(SIT),
})

// 11. Döst: Er sitzt neben dem Helfer und nickt weg (Augen zu, Kopf sinkt, kleine zZ steigen auf), der Helfer arbeitet weiter. Zweimal schreckt er leicht hoch,
// schaut zum Helfer, der kurz herüberschaut, und nickt wieder weg.
const DZ: Frame = { by: 2, eyes: 'closed', squash: 1, look: [0, 0], mouth: null }
C('helper_doze', 'Döst neben dem Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, companion: true, when: 'night', weight: 3,
  intro: sitDown(SIT),
  frames: beats([
    [3, SIT, HS(8)], [2, { ...SIT, eyes: 'closed' }, HS(9)],
    [2, DZ, HS(8), ZZ(0, 0)], [2, DZ, HS(9), ZZ(1, -2)], [3, DZ, HS(8), ZZ(1, -3)], [2, DZ, HS(9)],
    [2, DZ, HS(8), ZZ(0, 0)], [2, DZ, HS(9), ZZ(1, -2)], [3, DZ, HS(8), ZZ(1, -3)],
    [1, { ...SIT, eyes: 'wide', by: 1 }, HS(7)], [3, { ...SIT, eyes: 'wide' }, HS(7)], [2, SIT, HS(7)], [2, SIT, HS(0)], [2, { ...SIT, eyes: 'closed' }, HS(8)],
    [2, DZ, HS(9), ZZ(0, 0)], [2, DZ, HS(8), ZZ(1, -2)], [3, DZ, HS(9), ZZ(1, -3)], [2, DZ, HS(8)],
    [2, DZ, HS(9), ZZ(0, 0)], [2, DZ, HS(8), ZZ(1, -2)],
    [1, { ...SIT, eyes: 'wide', by: 1 }, HS(7)], [3, { ...SIT, eyes: 'wide' }, HS(7)], [2, SIT, HS(7)], [2, SIT, HS(0)],
    ...typing(1, SIT),
  ]),
  outro: standUp(SIT),
})

// ---- Mehrere Helfer (minMates): Die Helfer auf den Plätzen 1, 2 … zeichnet die Engine; diese Clips (nicht companion) zeichnen nur Effekte und lassen Clawd
// zu ihnen schauen. Eine Sprechblase muss nahe an Clawd entstehen und vergehen (Prüfung "nichts taucht auf"); sie wandert deshalb als Nachricht von Clawd über die
// Reihe zum zweiten Helfer (Platz 1, Kopf bei x -15) und als Antwort wieder zurück.
const BF = (n: number, x: number, y: number): PropRef => [`agent_bub${n}`, x, y, 'g']
const TALK2: Frame = { ...FL, mouth: 'o' }

// 12. Gespräch mit dem zweiten Helfer: Clawd sagt etwas (Blase über ihm), die Blase wandert zum Helfer auf Platz 1, der antwortet (die Blase kommt zurück), Clawd nickt.
C('chat_second', 'Spricht mit dem zweiten Helfer', 'work_agent', {
  loop: true, interruptible: true, mirror: false, minMates: 2, weight: 1,
  frames: beats([
    [4, FL],
    [2, TALK2, BF(1, 5, -4)], [2, FL, BF(2, 5, -4)], [2, TALK2, BF(3, 5, -4)],
    [1, FL, BF(3, -2, -3)], [1, FL, BF(3, -8, -2)], [1, FL, BF(3, -13, -1)], [2, FL, BF(3, -17, 0)],
    [2, FL, BF(2, -17, 0)], [2, FL, BF(1, -17, 0)], [2, FL, BF(3, -17, 0)],
    [1, FL, BF(3, -13, -1)], [1, FL, BF(3, -8, -2)], [1, FL, BF(3, -2, -3)], [2, FL, BF(3, 5, -4)],
    [3, { ...FL, by: 1 }], [5, FL],
  ]),
})

// 13. Nickt dem Team zu: Clawd schaut die Reihe entlang (Blick links, Mitte, wieder links), nickt, freut sich, ein kleines Herz steigt neben der vorderen Reihe auf.
const NH = (y: number): PropRef => ['agent_hs', -6, y, 'g']
C('nod_to_team', 'Nickt dem Team zu', 'work_agent', {
  loop: true, interruptible: true, mirror: false, minMates: 2, weight: 1,
  frames: beats([
    [4, N0],
    [3, FL], [2, N0], [3, FL],
    [2, { ...FL, by: 1 }], [2, FL],
    [2, { ...HAP, by: 1 }], [1, HAP, NH(1)], [1, HAP, NH(0)], [1, HAP, NH(-1)], [2, HAP, NH(-2)],
    [2, FL], [5, N0],
  ]),
})

// 14. Zählt das Team (ab vier Helfern): Clawd zeigt mit dem Stummel nacheinander immer weiter die Reihe entlang (der Arm fährt aus, tippt leicht auf und ab, der Mund
// zählt mit), nickt zufrieden.
C('team_glance', 'Zählt das Team durch', 'work_agent', {
  loop: true, interruptible: true, mirror: false, minMates: 4, weight: 1,
  frames: beats([
    [4, N0],
    ...[3, 4, 5, 6].flatMap((out, k): Beat[] => [[1, { ...FL, mouth: 'o', armL: A(out, 3) }], [1, { ...FL, mouth: k % 2 ? null : 'o', armL: A(out, 4) }], [1, { ...FL, armL: A(out, 3) }]]),
    [2, { ...FL, armL: A(4, 4) }], [1, { ...FL, armL: A(3, 5) }],
    [2, { ...HAP, by: 1 }], [2, HAP], [2, { ...HAP, by: 1 }],
    [2, FL], [5, N0],
  ]),
})

// ---- Subagent fertig (agent_done, einmalig, ~3 s): Der Helfer übergibt Clawd das Ergebnis seiner Arbeit, in fünf Varianten (Geschenk, Zettel, Blätterstapel, Mappe, Briefumschlag).
// Ablauf in allen gleich: Der Helfer hebt die Hand ("Ich hab was!"), holt es klein an seiner Hand hervor (es wächst), reicht es rüber; Clawd streckt den Stummel aus, nimmt
// es, schaut kurz darauf und nickt, packt es in seine Tasche (es wird kleiner und verschwindet dort, fetchOut) und der Helfer winkt. Der Helfer steht am Ende wieder
// als `agent_s` auf Platz 0 (danach lässt ihn die Engine absinken).
const gf = (n: string, y: number): PropRef => [n, -3, y, 'g']
const WOW: Frame = { ...FL, eyes: 'wide' }
function handoff(name: string, label: string, item: string, look: Frame): void {
  const O = { name: item, size: [5, 5] as const, at: [-3, 5] as const, side: 'L' as const, grip: 1, lift: 3, keep: [HS(3)] as const }
  C(name, label, 'agent_done', {
    companion: true, mirror: false,
    frames: [
      ...beats([
        [3, WOW, HS(1)],
        [1, { ...WOW, armL: A(2, 6) }, HS(0)],
        [1, { ...WOW, armL: A(3, 6) }, HS(0), gf(item + '@40', 7)],
        [1, { ...WOW, armL: A(3, 6) }, HS(0), gf(item + '@60', 6)],
        [1, { ...WOW, armL: A(3, 6) }, HS(0), gf(item + '@80', 5)],
        [2, { ...FL, armL: A(3, 6) }, HS(3), gf(item, 5)],
        [2, { ...look, armL: A(3, 6) }, HS(3), gf(item, 5)],
        [2, { ...look, armL: A(3, 6), by: 1 }, HS(3), gf(item, 5)],
      ]),
      ...fetchOut(O),
      ...beats([
        [2, { ...FL, armL: A(3, -1) }, HS(1)], [2, { ...FL, armL: A(3, 1) }, HS(2)],
        [2, { ...FL, armL: A(3, -1) }, HS(1)], [1, { ...FL, armL: A(3, 1) }, HS(2)],
        [1, { ...FL, armL: A(2, 3) }, HS(0)], [2, {}, HS(0)],
      ]),
    ],
  })
}
handoff('helper_gift', 'Helfer bringt ein Geschenk', 'agent_gift', { eyes: 'open', look: [-1, 1], mouth: 'smile' })
handoff('handoff_note', 'Helfer übergibt einen Zettel', 'agent_note', { eyes: 'half', look: [-1, 1], mouth: 'smile' })
handoff('handoff_stack', 'Helfer übergibt einen Blätterstapel', 'agent_stack', { eyes: 'wide', look: [-1, 1], mouth: 'o' })
handoff('handoff_folder', 'Helfer übergibt eine Mappe', 'agent_folder', { eyes: 'half', look: [-1, 1], mouth: null })
handoff('handoff_envelope', 'Helfer übergibt einen Briefumschlag', 'agent_env', { eyes: 'wide', look: [-1, 1], mouth: 'smile' })

export const CLIPS: readonly ClipDef[] = out
