// clawd-buddy: Clip-Modell (reine Daten und Funktionen).
//
// Ein Clip besteht aus bis zu drei Teilen, die nacheinander mit "klebenden" Feldern (Sticky-Merge) abgespielt werden:
//   intro  – einmal, z. B. Gegenstand hervorholen
//   frames – der Hauptteil; bei `loop: true` wiederholt sich nur dieser Teil
//   outro  – einmal beim Verlassen, z. B. Gegenstand wegräumen
// Felder, die ein Frame nicht nennt, bleiben vom Vorgänger; `props` wird nur ersetzt, wenn der Frame es nennt.
// `from` und `to` sind kanonische Posen (stage.ts → POSES), über die Clips verbunden werden.
import { NUM, POSES, STRUCT } from './stage.ts'
import type { Pose, PropRef } from './stage.ts'

/**
 * `bt` (0.11.0): Länge des Bilds in Schlägen des laufenden Songs (0,5 = Ab- oder Aufschlag, 0,25 = Solo). Mit Takt (tune-strip.beat)
 * richtet die Engine das Bild am Schlagraster aus, sonst gilt `t`. Ein Hauptteil mit `bt`-Bildern beginnt auf einem Schlag.
 */
export type Frame = Partial<Omit<Pose, 'props'>> & { t?: number; bt?: number; props?: readonly PropRef[] }

/** Gewichte eines Musik-Clips je Gruppe des Songs (0.11.0); `none` gilt, solange die Gruppe offen ist (ohne Gruppe, ohne tune-strip). */
export type MusicWeights = { calm: number; groove: number; hard: number; sad: number; none: number; notBad?: boolean }

export type ClipDef = {
  name: string
  label: string
  cat: string
  from: string
  to: string
  loop: boolean
  breathe: boolean
  lookable: boolean
  interruptible: boolean
  /** Nur bei Nacht bzw. nur am Tag in die Auswahl nehmen (Standard 'any'). */
  when: 'any' | 'night' | 'day'
  /** Gewicht bei der Zufallsauswahl innerhalb der Gruppe (Standard 1). */
  weight: number
  /**
   * Musik-Clips (0.11.0): Gewicht je Gruppe des Songs statt `weight` (SPEC Nachtrag 0.11.0, Tabelle); 0 = nie. `notBad`: nicht bei
   * schlechter Laune (Luftgitarre, Headbangen).
   */
  music?: MusicWeights
  /**
   * Laune, zu der der Clip gehört (Engine gewichtet danach, siehe mood.ts → deriveTemper): 'bad' nur bei Frust (je stärker, desto
   * häufiger), 'good' nur bei guter Laune, 'tired' nur bei Müdigkeit. Ohne Angabe: immer möglich.
   */
  temper?: 'bad' | 'good' | 'tired'
  /**
   * Der Clip zeichnet den Begleiter auf Platz 0 selbst (Interaktion mit einem laufenden Subagenten). Er beginnt und endet mit
   * `agent_s` auf [MATE_X[0], MATE_Y]; die Begleiter-Ebene der Engine lässt Platz 0 so lange aus.
   */
  companion?: boolean
  /**
   * Gewichtsfaktoren nach Tageszeit: [Morgen 5–11 Uhr, Mittag 11–17, Abend 17 bis Nachtbeginn, Nacht (Nachtfenster)]. Ohne Angabe überall 1.
   * Nachts sind nur Clips mit Faktor > 0 als Zeitvertreib wählbar (Fynn: Zeitvertreib verändert sich über den Tag).
   */
  daypart?: readonly [number, number, number, number]
  /** Nur an besonderen Tagen wählbar und dann bevorzugt: Geburtstag (userConfig `birthday`) bzw. Silvester/Neujahr. */
  special?: 'birthday' | 'newyear'
  /** Nur wählbar, wenn mindestens so viele Begleiter (Subagenten-Helfer) stehen, z. B. Gespräch mit dem zweiten Helfer. */
  minMates?: number
  /** Ausnahme: Augenformen aus einzelnen Pixeln (happy, angry, sad, tight, dizzy) bleiben erhalten (sonst rechteckig, SQUARE_EYES). */
  shapedEyes?: boolean
  /** false: nie gespiegelt abspielen (z. B. Clips, die bewusst nach links weiterlaufen). Standard: zufällig gespiegelt, wenn es passt. */
  mirror?: boolean
  intro: readonly Frame[]
  frames: readonly Frame[]
  outro: readonly Frame[]
}

/** `b`: Länge in Schlägen (aus `bt`), `bf`: Lage des Bildbeginns im Schlag (0 = auf dem Schlag, 0,5 = dazwischen), von `beatMarks`. */
export type Resolved = { p: Pose; t: number; b?: number; bf?: number }
export type ResolvedClip = { intro: Resolved[]; body: Resolved[]; outro: Resolved[] }

/** Clip mit Voreinstellungen anlegen. `to` ist standardmäßig `from`. */
export function clip(
  name: string,
  label: string,
  cat: string,
  def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] },
): ClipDef {
  return {
    name, label, cat, from: 'stand', loop: false, breathe: false, lookable: false, interruptible: false,
    when: 'any', weight: 1, intro: [], outro: [], ...def, to: def.to ?? def.from ?? 'stand',
  }
}

/** Sticky-Merge ab einer Startpose über eine Frameliste. */
export function mergeFrames(start: Pose, frames: readonly Frame[]): Resolved[] {
  let cur = start
  return beatMarks(
    frames.map((f) => {
      const { t, bt, props, ...rest } = f
      cur = { ...cur, ...rest, props: props !== undefined ? props : cur.props } as Pose
      return bt ? { p: cur, t: Math.max(1, t || 1), b: bt } : { p: cur, t: Math.max(1, t || 1) }
    }),
  )
}

/** Lage jedes Schlag-Bilds im Schlag: Summe der Schlaglängen davor (die Liste beginnt auf einem Schlag), modulo 1. */
export function beatMarks(list: Resolved[]): Resolved[] {
  let pos = 0
  return list.map((f) => {
    if (!f.b) return f
    const bf = ((pos % 1) + 1) % 1
    pos += f.b
    return { ...f, bf: Math.round(bf * 1000) / 1000 }
  })
}

/**
 * Augen bleiben rechteckig (Fynn): Formen aus einzelnen Pixeln (^ ^, schräg, Spirale) wirken unruhig und sind nur in wenigen Clips
 * erlaubt (`shapedEyes: true`). Sonst werden sie auf die nächste rechteckige Form abgebildet.
 */
export const SQUARE_EYES: Readonly<Record<string, string>> = { happy: 'closed', angry: 'half', sad: 'half', tight: 'closed', dizzy: 'wide' }
const squareEyes = (l: Resolved[]): Resolved[] =>
  l.map((f) => (SQUARE_EYES[f.p.eyes] ? { ...f, p: { ...f.p, eyes: SQUARE_EYES[f.p.eyes] } } : f))

/** Clip auflösen: Intro, Hauptteil und Outro laufen auf derselben Sticky-Kette. */
export function resolveClip(c: ClipDef): ResolvedClip {
  const start = POSES[c.from]
  const intro = mergeFrames(start, c.intro)
  const afterIntro = intro.length ? intro[intro.length - 1].p : start
  const body = mergeFrames(afterIntro, c.frames)
  const afterBody = body.length ? body[body.length - 1].p : afterIntro
  const outro = mergeFrames(afterBody, c.outro)
  if (c.shapedEyes) return { intro, body, outro }
  return { intro: squareEyes(intro), body: squareEyes(body), outro: squareEyes(outro) }
}

/** Ein Frame ist "sicher", wenn die Figur dort strukturell in ihrer Ausgangspose steht und der Clip unterbrechbar ist. */
export function isSafe(c: ClipDef, p: Pose): boolean {
  if (!c.interruptible) return false
  const base = POSES[c.from]
  return STRUCT.every((k) => p[k] === base[k]) && (p.legs === 'stand' || p.legs === base.legs)
}

/** Glättung: Sprünge > 1 px (fx, fy, by, squash) bekommen automatisch Zwischenbilder, auch beim Einstieg. */
export function smooth(frames: readonly Resolved[], prev: Pose | null): Resolved[] {
  const out: Resolved[] = []
  let last = prev
  for (const f of frames) {
    if (last) {
      const gap = Math.max(...NUM.map((k) => Math.abs(f.p[k] - last![k])))
      for (let i = 1; i < gap; i++) {
        const mid: Pose = { ...f.p }
        for (const k of NUM) mid[k] = Math.round(last[k] + ((f.p[k] - last[k]) * i) / gap)
        out.push({ p: mid, t: 1 })
      }
    }
    out.push(f)
    last = f.p
  }
  return out
}

/** Planer: kürzester Weg über Übergangsclips zwischen kanonischen Posen (Breitensuche). */
export function planPath(clips: readonly ClipDef[], fromPose: string, toPose: string): string[] {
  if (fromPose === toPose) return []
  const edges = clips.filter((c) => c.cat === 'transition')
  const seen = new Set([fromPose])
  const queue: [string, string[]][] = [[fromPose, []]]
  while (queue.length) {
    const [pose, acc] = queue.shift()!
    for (const e of edges) {
      if (e.from === pose && !seen.has(e.to)) {
        const next = [...acc, e.name]
        if (e.to === toPose) return next
        seen.add(e.to)
        queue.push([e.to, next])
      }
    }
  }
  return []
}

/** Frames n-mal wiederholen. */
export const rep = <T>(n: number, frames: readonly T[]): T[] => Array.from({ length: n }, () => frames).flat()
