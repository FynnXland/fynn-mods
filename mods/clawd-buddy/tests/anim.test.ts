// clawd-buddy: Tests für Datenmodell, Engine, Übergänge, Maus, Nacht und die Prüfung "nichts taucht aus dem Nichts auf".
// Reine Funktionen ohne Test-Kit-Stubs (kein `$` nötig); laufen mit `claude plugin test`.
import { expect, test } from 'claude-code/testing'
import { ALL_CLIPS, ALL_PROPS } from '../hooks/library.ts'
import { planPath } from '../hooks/clipdef.ts'
import { ARMS, CROSS_L, EYES, EYES_ONE, FRONT, FX, FY, H, LEGS, MOUTH, PAL, POSES, W, compose, propSprite } from '../hooks/stage.ts'
import type { Pose } from '../hooks/stage.ts'
import { resolveClip } from '../hooks/clipdef.ts'
import { captureClip, newEngine } from '../hooks/capture.ts'
import { lintFrames } from '../hooks/lint.ts'
import { PLAN_TICKS, SOURCE_MAX, createDesk } from '../hooks/desk.ts'
import { NO_FACTS, NO_STRAIN } from '../hooks/mood.ts'

const LIB = { clips: ALL_CLIPS, props: ALL_PROPS }
const byName = (n: string) => ALL_CLIPS.find((c) => c.name === n)!
const cat = (c: string) => ALL_CLIPS.filter((x) => x.cat === c)

test('Daten: jeder Clip nennt gültige Posen, Körperteile, Requisiten und Dauern', () => {
  for (const c of ALL_CLIPS) {
    expect(POSES[c.from], `${c.name}: from`).toBeDefined()
    expect(POSES[c.to], `${c.name}: to`).toBeDefined()
    const r = resolveClip(c)
    for (const f of [...r.intro, ...r.body, ...r.outro]) {
      const p: Pose = f.p
      expect(f.t, `${c.name}: t`).toBeGreaterThanOrEqual(1)
      expect(LEGS[p.legs], `${c.name}: legs ${p.legs}`).toBeDefined()
      expect(EYES[p.eyes] || EYES_ONE[p.eyes], `${c.name}: eyes ${p.eyes}`).toBeDefined()
      if (p.mouth) expect(MOUTH[p.mouth], `${c.name}: mouth ${p.mouth}`).toBeDefined()
      for (const a of [p.armL, p.armR]) {
        if (typeof a === 'string') expect(ARMS[a] || FRONT[a] || a === 'cross', `${c.name}: arm ${a}`).toBeTruthy()
        else if ('to' in a) expect(a.to.length, `${c.name}: arm to`).toBe(2)
        else expect(typeof a.out === 'number' && typeof a.y === 'number', `${c.name}: Blockarm out/y`).toBe(true)
      }
      for (const pr of p.props) expect(propSprite(ALL_PROPS, pr[0]), `${c.name}: Requisite ${pr[0]}`).toBeDefined()
    }
  }
  expect(CROSS_L.length).toBeGreaterThan(0)
})

test('Stil: Hände sind Blöcke (keine dünnen {to}-Arme in Clips), Blockarme sind 2 Pixel dick und liegen am Körperrand', () => {
  for (const c of ALL_CLIPS) {
    const r = resolveClip(c)
    for (const f of [...r.intro, ...r.body, ...r.outro]) {
      for (const a of [f.p.armL, f.p.armR]) {
        if (typeof a === 'object') {
          expect('to' in a, `${c.name}: dünner {to}-Arm; Blockarm { out, y } verwenden`).toBe(false)
          if (!('to' in a)) {
            expect(a.out, `${c.name}: Blockarm out`).toBeGreaterThanOrEqual(1) // 1 = Hand steckt in der Tasche
            expect(a.out, `${c.name}: Blockarm out`).toBeLessThanOrEqual(6)
            expect([2, 3].includes(a.h ?? 2), `${c.name}: Blockarm h ${a.h} (2 oder 3 Pixel dick)`).toBe(true)
          }
        }
      }
    }
  }
})

test('Effekte überlappen sich nie (Pfeif-Noten, Funken, Herzen …) und nicht mit anderen Requisiten', () => {
  const bad: string[] = []
  for (const c of ALL_CLIPS) {
    const r = resolveClip(c)
    let idx = 0
    for (const f of [...r.intro, ...r.body, ...r.outro]) {
      idx++
      const cells = new Map<number, string>()
      f.p.props.forEach((pr, k) => {
        const sp = propSprite(ALL_PROPS, pr[0])!
        const ox = pr[3] === 'g' ? FX + pr[1] : FX + f.p.fx + pr[1]
        const oy = pr[3] === 'g' ? FY + pr[2] : FY + f.p.fy + f.p.by + pr[2]
        sp.rows.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            if (row[rx] === '.') continue
            const x = ox + rx
            const y = oy + ry
            if (x < 0 || y < 0 || x >= W || y >= H) continue
            const key = y * W + x
            const other = cells.get(key)
            // Zwei verschiedene Requisiten auf demselben Pixel (mindestens eine ein Effekt) = Überlappung
            if (other !== undefined && other !== `${k}`) {
              const o = f.p.props[Number(other)]
              const os = propSprite(ALL_PROPS, o[0])!
              // Sichtbar ist das später gezeichnete: liegt ein Effekt oben, überdeckt er etwas (Fynn: Pfeif-Noten übereinander). Ein Effekt
              // unter einem festen Gegenstand ist verdeckt (Knäuel fällt hinter den Kartonrand). Eine Hand (`hand`) liegt bewusst auf dem,
              // was sie hält.
              if (sp.effect && !sp.hand && !os.hand) bad.push(`${c.name} Frame ${idx}: ${pr[0]} überlappt ${o[0]} bei (${x},${y})`)
            }
            cells.set(key, `${k}`)
          }
        })
      })
    }
  }
  expect([...new Set(bad)].slice(0, 12).join(' | ')).toBe('')
})

test('Daten: Sprites sind rechteckig und nutzen nur Palettenzeichen; Clip-Namen sind eindeutig', () => {
  for (const [name, sp] of Object.entries(ALL_PROPS)) {
    const w = sp.rows[0].length
    for (const row of sp.rows) {
      expect(row.length, `${name}: Zeilenbreite`).toBe(w)
      for (const ch of row) if (ch !== '.') expect(PAL[ch], `${name}: Farbe ${ch}`).toBeDefined()
    }
  }
  const names = ALL_CLIPS.map((c) => c.name)
  expect(new Set(names).size).toBe(names.length)
})

test('Mindestinventar nach SPEC (und Fynns Wunsch nach mehr Subagenten)', () => {
  expect(cat('fun').length).toBeGreaterThanOrEqual(6)
  for (const k of ['work_write', 'work_read', 'work_shell', 'work_web', 'work_think']) expect(cat(k).length, k).toBeGreaterThanOrEqual(2)
  expect(cat('work_agent').length).toBeGreaterThanOrEqual(4)
  expect(cat('wait10').length + cat('wait60').length).toBeGreaterThanOrEqual(3)
  expect(cat('waitUser').length).toBeGreaterThanOrEqual(2)
  for (const n of ['yawn', 'drowsy', 'sleep', 'startled', 'rub_eyes', 'giggle', 'boop', 'blush', 'grumpy', 'sulk', 'held_wiggle', 'dizzy', 'idle_breathe', 'idle_look']) {
    expect(byName(n), n).toBeDefined()
  }
  expect(cat('done').length).toBeGreaterThanOrEqual(2)
  expect(cat('oops').length).toBeGreaterThanOrEqual(2)
})

test('Übergänge: von jeder kanonischen Pose führt ein Weg zur Ausgangspose jedes Clips', () => {
  for (const from of Object.keys(POSES)) {
    for (const c of ALL_CLIPS) {
      if (c.cat === 'transition') continue
      if (from !== c.from) expect(planPath(ALL_CLIPS, from, c.from).length, `${from} → ${c.from} (${c.name})`).toBeGreaterThan(0)
    }
  }
})

test('Jeder Clip endet in seiner Zielpose ohne liegengebliebene Gegenstände und hat bei Schleife ein Outro, wenn er Gegenstände zeigt', () => {
  for (const c of ALL_CLIPS) {
    if (c.cat === 'transition') continue
    const r = resolveClip(c)
    const all = [...r.intro, ...r.body, ...r.outro]
    const usesProps = all.some((f) => f.p.props.some((x) => !propSprite(ALL_PROPS, x[0])!.effect))
    if (c.loop && usesProps) expect(c.outro.length, `${c.name}: Schleife mit Gegenstand braucht ein Outro`).toBeGreaterThan(0)
    const last = all[all.length - 1].p
    if (!c.loop) {
      // Begleiter-Clips enden mit dem Helfer des Subagenten (die Engine lässt ihn danach absinken)
      const left = last.props.filter((x) => !propSprite(ALL_PROPS, x[0])!.effect && !(c.companion && x[0].startsWith('agent_s')))
      expect(left.length, `${c.name}: am Ende bleibt ${left.map((x) => x[0]).join(',')} liegen`).toBe(0)
    }
  }
})

test('Nichts taucht aus dem Nichts auf: jeder Clip, mehrere Zufallsstarts (Lint)', { timeoutMs: 120000 }, () => {
  const bad: string[] = []
  for (const c of ALL_CLIPS) {
    for (const seed of [1, 2]) {
      for (const i of lintFrames(captureClip(LIB, c.name, { seed }), ALL_PROPS)) bad.push(`${c.name} (Seed ${seed}) Bild ${i.frame + 1}: ${i.kind} "${i.name}" bei (${i.x},${i.y})`)
    }
  }
  expect(bad.slice(0, 20).join('\n')).toBe('')
})

const hashRun = (seed: number) => {
  const e = newEngine(LIB, seed, { idleSeconds: 6 })
  e.start()
  let h = 7
  const moods = ['work_write', 'wait10', 'idle', 'work_agent', 'done', 'idle', 'watching']
  for (let t = 0; t < 1500; t++) {
    if (t % 150 === 10) e.setMood(moods[(t / 150) | 0 ? ((t / 150) | 0) % moods.length : 0])
    e.tick()
    const { buf } = e.render()
    for (let i = 0; i < buf.length; i += 7) h = (Math.imul(h, 31) + (buf[i] ? buf[i]!.charCodeAt(0) : 1)) | 0
  }
  return h
}

test('Engine: gleicher Seed, gleiche Bilder (deterministisch)', { timeoutMs: 30000 }, () => {
  expect(hashRun(5)).toBe(hashRun(5))
  expect(hashRun(5)).not.toBe(hashRun(6))
})

test('Engine: Zufallsläufe mit Stimmungen, Klicks, Ziehen und Tageszeit werfen nie', { timeoutMs: 120000 }, () => {
  const moods = ['idle', 'watching', 'work_think', 'work_read', 'work_write', 'work_shell', 'work_web', 'work_agent', 'wait10', 'wait60', 'waitUser', 'done', 'oops']
  for (let seed = 1; seed <= 4; seed++) {
    const e = newEngine(LIB, seed, { idleSeconds: 6 })
    let r = seed * 7919
    const rand = () => {
      r = (r * 1103515245 + 12345) & 0x7fffffff
      return r / 0x7fffffff
    }
    e.start()
    for (let t = 0; t < 1800; t++) {
      const roll = rand()
      if (roll < 0.012) e.setMood(moods[Math.floor(rand() * moods.length)])
      else if (roll < 0.016) {
        e.render()
        const x = 34 + Math.floor(rand() * 17)
        const y = 4 + Math.floor(rand() * 10)
        e.pointer('move', x, y)
        e.pointer('down', x, y)
        if (rand() < 0.6) for (let k = 0; k < 6; k++) { e.pointer('move', x + rand() * 20 - 10, y + rand() * 8 - 6); e.tick() }
        e.pointer('up', x + 2, y)
      } else if (roll < 0.018) e.set({ hour: rand() < 0.5 ? 23.5 : 7.25 })
      e.tick()
      const p = e.pose()
      for (const k of ['fx', 'fy', 'by', 'squash'] as const) expect(Number.isFinite(p[k])).toBe(true)
      expect(POSES[e.S.landing]).toBeDefined()
    }
  }
})

test('Stimmungen: jede Stimmung spielt nach spätestens 12 s einen Clip ihrer Gruppe', { timeoutMs: 60000 }, () => {
  for (const mood of ['watching', 'work_think', 'work_read', 'work_write', 'work_shell', 'work_web', 'work_agent', 'wait10', 'wait60', 'waitUser', 'done', 'oops']) {
    const e = newEngine(LIB, 3)
    e.start()
    for (let i = 0; i < 10; i++) e.tick()
    e.setMood(mood)
    let seen = false
    for (let i = 0; i < 120 && !seen; i++) {
      e.tick()
      const c = e.S.play?.clip
      if (c && c.cat === mood) seen = true
    }
    expect(seen, mood).toBe(true)
  }
})

test('Nacht: Gähnen → Nickerchen → Schlaf, über Mitternacht; Aktivität weckt über Aufschrecken und Augenreiben', { timeoutMs: 30000 }, () => {
  const e = newEngine(LIB, 2, { hour: 23.5, idleSeconds: 6 })
  expect(e.isNight()).toBe(true)
  e.set({ hour: 3 })
  expect(e.isNight()).toBe(true)
  e.set({ hour: 12 })
  expect(e.isNight()).toBe(false)
  e.set({ hour: 23.5 })
  e.start()
  const seen: string[] = []
  for (let i = 0; i < 1500 && !seen.includes('sleep'); i++) {
    e.tick()
    const n = e.S.play?.clip.name
    if (n && !seen.includes(n)) seen.push(n)
  }
  expect(seen).toContain('yawn')
  expect(seen).toContain('drowsy')
  expect(seen).toContain('sleep')
  // Aufwachen bei Aktivität
  e.setMood('work_write')
  const after: string[] = []
  for (let i = 0; i < 200; i++) {
    e.tick()
    const n = e.S.play?.clip.name
    if (n && !after.includes(n)) after.push(n)
  }
  expect(after).toContain('startled')
  expect(after).toContain('rub_eyes')
})

test('Maus: Klick löst Reaktion aus, wiederholte Klicks steigern den Ärger, Armziehen schnappt zurück, Hochheben fällt', { timeoutMs: 30000 }, () => {
  const e = newEngine(LIB, 4)
  e.start()
  for (let i = 0; i < 20; i++) e.tick()
  const bodyPixel = () => {
    const { hit } = e.render()
    const i = hit.findIndex((t) => t === 'body')
    return [i % W, Math.floor(i / W)] as const
  }
  const click = () => {
    const [x, y] = bodyPixel()
    e.pointer('down', x, y)
    e.pointer('up', x, y)
    for (let i = 0; i < 3; i++) e.tick()
  }
  const seen = new Set<string>()
  for (let n = 0; n < 8; n++) {
    click()
    if (e.S.play) seen.add(e.S.play.clip.name)
    for (let i = 0; i < 4; i++) {
      e.tick()
      if (e.S.play) seen.add(e.S.play.clip.name)
    }
  }
  expect(['giggle', 'boop', 'blush'].some((n) => seen.has(n))).toBe(true)
  expect(seen.has('grumpy')).toBe(true)
  expect(seen.has('sulk')).toBe(true)
  // Arm ziehen
  const e2 = newEngine(LIB, 5)
  e2.start()
  for (let i = 0; i < 20; i++) e2.tick()
  const { hit } = e2.render()
  const ai = hit.findIndex((t) => t === 'armL')
  expect(ai).toBeGreaterThanOrEqual(0)
  const ax = ai % W
  const ay = Math.floor(ai / W)
  e2.pointer('down', ax, ay)
  for (let k = 0; k < 6; k++) {
    e2.pointer('move', ax - k * 2, ay - k)
    e2.tick()
  }
  expect(e2.S.drag).not.toBeNull()
  e2.pointer('up', ax - 10, ay - 5)
  const names: string[] = []
  for (let i = 0; i < 60; i++) {
    e2.tick()
    const n = e2.S.play?.clip.name
    if (n && !names.includes(n)) names.push(n)
  }
  expect(names).toContain('zurueckschnappen')
  expect(POSES[e2.S.landing].fy).toBe(0)
  // Hochheben erst nach längerem Festhalten, dann folgt er dem Zeiger direkt; losgelassen fällt er und geht zurück
  const e3 = newEngine(LIB, 8)
  e3.start()
  for (let i = 0; i < 20; i++) e3.tick()
  const bi = e3.render().hit.findIndex((t) => t === 'body')
  const bx = bi % W
  const by = Math.floor(bi / W)
  e3.pointer('down', bx, by)
  for (let i = 0; i < 3; i++) e3.tick()
  expect(e3.S.drag?.mode).toBe('press')
  expect(e3.pose().fy).toBe(0)
  for (let i = 0; i < 8; i++) e3.tick()
  expect(e3.S.drag?.mode).toBe('lift')
  e3.pointer('move', bx - 20, by)
  e3.tick()
  expect(e3.pose().fx).toBe(-20)
  e3.pointer('up', bx - 20, by)
  const seen3: string[] = []
  for (let i = 0; i < 120; i++) {
    e3.tick()
    const n = e3.S.play?.clip.name
    if (n && !seen3.includes(n)) seen3.push(n)
  }
  expect(seen3).toContain('fallen')
  expect(seen3).toContain('zurueckgehen')
  expect(e3.pose().fx).toBe(0)
})

test('Maus: Klick mitten in einem Clip mit Gegenstand lässt den Gegenstand stehen und räumt ihn danach weg (nichts verschwindet)', { timeoutMs: 60000 }, () => {
  const e = newEngine(LIB, 6)
  e.start()
  for (let i = 0; i < 10; i++) e.tick()
  e.setMood('work_write')
  const frames = []
  let clicked = false
  for (let i = 0; i < 900; i++) {
    const pl = e.S.play
    if (!clicked && pl && pl.phase === 'body' && pl.clip.name.startsWith('type') && pl.fi >= 2) {
      const { hit } = e.render()
      const bi = hit.findIndex((t) => t === 'body')
      e.pointer('down', bi % W, Math.floor(bi / W))
      e.pointer('up', bi % W, Math.floor(bi / W))
      clicked = true
      e.setMood('wait10')
    }
    e.tick()
    const c = e.render()
    frames.push({ buf: c.buf, hit: c.hit, pose: e.pose() })
    if (clicked && i > 300) break
  }
  expect(clicked).toBe(true)
  const issues = lintFrames(frames, ALL_PROPS).filter((x) => x.kind !== 'liegt am Ende noch herum')
  expect(issues.map((x) => `Bild ${x.frame}: ${x.kind} ${x.name}`).join('\n')).toBe('')
})

test('Ruhe: flackernde Stimmungen (Tools im Sekundentakt) wechseln den Clip nicht hektisch; eben gespielte Clips kommen nicht gleich wieder', { timeoutMs: 30000 }, () => {
  const e = newEngine(LIB, 13)
  e.start()
  e.setMood('work_think')
  for (let i = 0; i < 40; i++) e.tick()
  const first = e.S.play?.clip.name
  expect(first && ALL_CLIPS.find((c) => c.name === first)?.cat).toBe('work_think')
  // Lesen-Denken-Lesen im Abstand von 4 Ticks (0,3 s): kein Wechsel
  for (let i = 0; i < 60; i++) {
    e.setMood(i % 8 < 4 ? 'work_read' : 'work_think')
    e.tick()
  }
  expect(e.S.play?.clip.name).toBe(first)
  // Bleibt es länger beim Lesen, wechselt er (nach Entprellung und Mindestdauer)
  e.setMood('work_read')
  let switched = false
  for (let i = 0; i < 200 && !switched; i++) {
    e.tick()
    if (e.S.mood === 'work_read') switched = true
  }
  expect(switched).toBe(true)
  // Wartet auf dich: sofort
  e.setMood('waitUser')
  expect(e.S.mood).toBe('waitUser')
  // Cooldown: in der Gruppe "watching" kommt derselbe Clip nach dem Ende nicht gleich wieder (über viele Starts gemittelt)
  const w = newEngine(LIB, 14)
  w.start()
  let repeats = 0
  let picks = 0
  let prev = ''
  for (let n = 0; n < 12; n++) {
    w.setMood('watching')
    for (let i = 0; i < 80; i++) w.tick()
    const cur = w.S.play?.clip.name ?? ''
    if (prev && cur === prev) repeats++
    if (cur) picks++
    prev = cur
    w.setMood('idle')
    for (let i = 0; i < 80; i++) w.tick()
  }
  expect(picks).toBeGreaterThan(6)
  expect(repeats).toBeLessThanOrEqual(2)
})

test('Arbeitsfluss: von einer Tool-Arbeit zur nächsten erst nach ~10 s (ausgepackt bleibt eine Weile), aus dem Grübeln schnell', { timeoutMs: 30000 }, () => {
  const e = newEngine(LIB, 21)
  e.start()
  e.setMood('work_shell')
  for (let i = 0; i < 60; i++) e.tick() // 4,5 s Shell
  expect(e.S.mood).toBe('work_shell')
  const start = e.S.clipStart
  e.setMood('work_read')
  let at = -1
  for (let i = 0; i < 300 && at < 0; i++) {
    e.tick()
    if (e.S.mood === 'work_read') at = e.S.ticks
  }
  // vorher genügten 3 s Mindestdauer und 0,75 s Entprellung
  expect(at - start).toBeGreaterThanOrEqual(133)
  // Aus dem Grübeln (ohne Gegenstände) in eine Tool-Arbeit: normale Mindestdauer
  const t = newEngine(LIB, 22)
  t.start()
  t.setMood('work_think')
  for (let i = 0; i < 45; i++) t.tick()
  t.setMood('work_shell')
  let n = 0
  while (t.S.mood !== 'work_shell' && n < 300) {
    t.tick()
    n++
  }
  expect(n).toBeLessThanOrEqual(40)
})

test('Begleiter: je Subagent ein Helfer, steigt einmal auf, bleibt (auch bei eigener Arbeit, die dann rechts läuft), Übergabe des Ergebnisses zum Schluss, sinkt ab', { timeoutMs: 30000 }, () => {
  const e = newEngine(LIB, 15)
  e.start()
  const mate = () => e.pose().props.find((x) => x[0].startsWith('agent_s') && x[1] === -8)
  e.set({ agents: 1 })
  e.setMood('work_agent')
  for (let i = 0; i < 12; i++) e.tick()
  expect(mate()?.[2]).toBe(5)
  // Er bleibt durchgehend sichtbar, auch wenn Claude selbst arbeitet; Clawds eigene Gegenstände liegen dann nie links bei den Helfern
  for (const mood of ['work_read', 'work_shell', 'work_test']) {
    e.setMood(mood)
    let always = true
    let leftClear = true
    for (let i = 0; i < 300; i++) {
      e.tick()
      const p = e.pose()
      if (!p.props.some((x) => x[0].startsWith('agent_s'))) always = false
      if (e.S.play && e.S.play.clip.cat === mood) {
        const hit = compose(p, ALL_PROPS).hit
        if (hit.some((t, k) => !!t && t.startsWith('prop:') && !t.startsWith('prop:agent_s') && k % W < FX - 1)) leftClear = false
      }
    }
    expect(always).toBe(true)
    expect(leftClear).toBe(true)
  }
  // Subagent fertig: Übergabe (Zettel, Stapel, Mappe, Umschlag oder Geschenk) oder Abklatschen, danach sinkt der Helfer ab
  e.set({ agents: 0 })
  e.setMood('agent_done')
  const seen: string[] = []
  for (let i = 0; i < 300; i++) {
    e.tick()
    const n = e.S.play?.clip.name
    if (n && !seen.includes(n)) seen.push(n)
  }
  expect(seen.some((n) => n.startsWith('handoff_') || n === 'helper_gift' || n === 'high_five_helper')).toBe(true)
  expect(e.S.mates.length).toBe(0)
  expect(mate()).toBeUndefined()
})

test('Tageszeit: nachts nur ruhiger Zeitvertreib, dann Schlaf; besondere Tage nur an ihrem Tag', { timeoutMs: 60000 }, () => {
  const funAt = (hour: number, special: '' | 'birthday' | 'newyear', ticks: number) => {
    const e = newEngine(LIB, 16, { idleSeconds: 3 })
    e.set({ hour, special })
    e.start()
    const seen = new Set<string>()
    let slept = false
    for (let i = 0; i < ticks; i++) {
      e.tick()
      const c = e.S.play?.clip
      if (c?.cat === 'fun') seen.add(c.name)
      if (c?.name === 'sleep') slept = true
    }
    return { seen: [...seen].map((n) => ALL_CLIPS.find((c) => c.name === n)!), slept }
  }
  const night = funAt(23.5, '', 6000)
  expect(night.seen.length).toBeGreaterThan(0)
  expect(night.seen.every((c) => (c.daypart?.[3] ?? 1) > 0)).toBe(true)
  expect(night.slept).toBe(true)
  const day = funAt(13, '', 6000)
  expect(day.seen.some((c) => c.special)).toBe(false)
  expect(day.seen.some((c) => c.name.startsWith('night_'))).toBe(false)
  const bday = funAt(13, 'birthday', 9000)
  expect(bday.seen.some((c) => c.special === 'birthday')).toBe(true)
  expect(bday.seen.some((c) => c.special === 'newyear')).toBe(false)
})

test('Spiegeln: Schrift und Zeichen (Fragezeichen-Schild) wechseln die Seite, bleiben aber lesbar', () => {
  expect(ALL_PROPS.wait_sign.noFlip).toBe(true)
  expect(ALL_PROPS.question.noFlip).toBe(true)
  const s = ALL_PROPS.wait_sign
  const w = Math.max(...s.rows.map((r) => r.length))
  const pose = { ...POSES.stand, props: [['wait_sign', 20, 0, 'g'] as const] } as Pose
  const plain = compose(pose, ALL_PROPS).buf
  const mirr = compose({ ...pose, mirror: true }, ALL_PROPS).buf
  // Zeile für Zeile: gespiegelt steht das Schild auf der anderen Seite, die Pixel laufen aber in derselben Reihenfolge
  s.rows.forEach((row, ry) => {
    const y = FY + ry
    const a = Array.from({ length: w }, (_, i) => plain[y * W + FX + 20 + i] ?? null).join(',')
    const mxStart = 2 * (FX + 8) - (FX + 20 + w - 1)
    const b = Array.from({ length: w }, (_, i) => mirr[y * W + mxStart + i] ?? null).join(',')
    expect(b).toBe(a)
  })
})

test('Hände vor dem Körper verdecken und berühren nie ein Auge (außer Augenreiben)', () => {
  const bad: string[] = []
  for (const c of ALL_CLIPS) {
    const r = resolveClip(c)
    for (const f of [...r.intro, ...r.body, ...r.outro]) {
      const p = { ...f.p, mouth: null, props: [] }
      const isFront = (a: unknown) => typeof a === 'string' && (FRONT[a] || a === 'cross') && !a.startsWith('rub')
      if (!isFront(p.armL) && !isFront(p.armR)) continue
      const bare = compose({ ...p, armL: isFront(p.armL) ? 'down' : p.armL, armR: isFront(p.armR) ? 'down' : p.armR }, ALL_PROPS).buf
      const full = compose(p, ALL_PROPS).buf
      bare.forEach((v, i) => {
        if (v !== 'K') return
        const near = [0, 1, -1, W, -W].some((d) => full[i + d] === 'Q')
        if (full[i] !== 'K' || near) bad.push(`${c.name}: Auge bei (${i % W},${Math.floor(i / W)})`)
      })
    }
  }
  expect([...new Set(bad)].slice(0, 10).join('\n')).toBe('')
})

test('Laune: Frust-Clips nur bei Frust (dann häufig), Gute-Laune-Clips nur bei guter Laune', { timeoutMs: 60000 }, () => {
  const seenAt = (temper: number) => {
    const e = newEngine(LIB, 11)
    e.start()
    e.set({ temper })
    const seen: string[] = []
    for (let n = 0; n < 12; n++) {
      e.setMood(n % 2 ? 'oops' : 'done')
      for (let i = 0; i < 200; i++) {
        e.tick()
        const c = e.S.play?.clip
        if (c && (c.cat === 'oops' || c.cat === 'done')) seen.push(c.name)
        if (e.S.mood === 'idle' && i > 5) break
      }
    }
    return seen.map((n) => ALL_CLIPS.find((c) => c.name === n)!)
  }
  const calm = seenAt(0)
  expect(calm.some((c) => c.temper)).toBe(false)
  const angry = seenAt(-1)
  expect(angry.filter((c) => c.temper === 'bad').length).toBeGreaterThan(angry.length / 3)
  expect(angry.some((c) => c.temper === 'good')).toBe(false)
  // Neutrale Clips zeigen bei Frust zusammengekniffene (rechteckige) Augen
  const e = newEngine(LIB, 12)
  e.start()
  e.set({ temper: -0.8 })
  let angryEyes = false
  for (let i = 0; i < 100; i++) {
    e.tick()
    if (e.pose().eyes === 'half') angryEyes = true
  }
  expect(angryEyes).toBe(true)
})

test('Reduzierte Bewegung: im Leerlauf kein Zeitvertreib, in Arbeit der erste (ruhigste) Clip der Gruppe', { timeoutMs: 30000 }, () => {
  const e = newEngine(LIB, 7, { idleSeconds: 3 })
  e.set({ reduced: true })
  e.start()
  for (let i = 0; i < 600; i++) {
    e.tick()
    expect(e.S.play?.clip.cat === 'fun').toBe(false)
  }
  e.setMood('work_write')
  const names = new Set<string>()
  for (let i = 0; i < 400; i++) {
    e.tick()
    if (e.S.play?.clip.cat === 'work_write') names.add(e.S.play.clip.name)
  }
  expect([...names]).toEqual([e.poolOf('work_write')[0].name])
})

test('Bühne: eine Pose lässt sich zeichnen, alles unter der Linie wird abgeschnitten', () => {
  const p: Pose = { ...POSES.stand, props: [['laptop', -8, 10, 'g']] }
  const c = compose(p, ALL_PROPS)
  expect(c.buf.length).toBe(W * H)
  expect(c.hit.some((t) => t === 'prop:laptop')).toBe(false)
  const q: Pose = { ...POSES.stand, props: [['laptop', -8, 8, 'g']] }
  expect(compose(q, ALL_PROPS).hit.some((t) => t === 'prop:laptop')).toBe(true)
})

test('Rückkehr: Begrüßung (Augen reiben, dann Morgen-Clip) zu jeder Uhrzeit, übersteht das Tippen; aus dem Schlaf über Aufschrecken', { timeoutMs: 30000 }, () => {
  const MORNING = cat('morning').map((c) => c.name)
  for (const hour of [7, 15, 23.5]) {
    const e = newEngine(LIB, 4, { hour, idleSeconds: 6 })
    e.start()
    for (let i = 0; i < 30; i++) e.tick()
    e.welcome()
    e.setMood('watching') // die erste Taste kommt gleichzeitig
    const seen: string[] = []
    for (let i = 0; i < 1200; i++) {
      e.tick()
      const n = e.S.play?.clip.name
      if (n && !seen.includes(n)) seen.push(n)
      if (seen.some((s) => MORNING.includes(s)) && e.S.play?.clip.cat === 'watching') break
    }
    const r = seen.indexOf('rub_eyes')
    const m = seen.findIndex((s) => MORNING.includes(s))
    expect(r).toBeGreaterThanOrEqual(0)
    expect(m).toBeGreaterThan(r)
    expect(seen.some((s) => cat('watching').some((c) => c.name === s))).toBe(true) // danach liest er mit
  }
  // Schläft er, steht er erst auf
  const n = newEngine(LIB, 2, { hour: 23.5, idleSeconds: 6 })
  n.start()
  for (let i = 0; i < 1500 && n.S.play?.clip.name !== 'sleep'; i++) n.tick()
  n.welcome()
  const seen: string[] = []
  for (let i = 0; i < 600; i++) {
    n.tick()
    const c = n.S.play?.clip.name
    if (c && !seen.includes(c)) seen.push(c)
  }
  expect(seen.indexOf('startled')).toBeGreaterThanOrEqual(0)
  expect(seen.findIndex((s) => MORNING.includes(s))).toBeGreaterThan(seen.indexOf('rub_eyes'))
  // Ohne Rückkehr kein Morgen-Clip beim Aufwachen
  const w = newEngine(LIB, 2, { hour: 7, idleSeconds: 6 })
  w.start()
  w.S.sleepStage = 3
  expect(w.wakeUp).toBeDefined()
  w.wakeUp()
  expect(w.S.queue.some((q) => typeof q === 'string' && MORNING.includes(q))).toBe(false)
})

test('Gesicht: kein Mund; Blinzeln senkt nur das Lid (Auge springt nie zur Seite)', { timeoutMs: 30000 }, () => {
  const plain = compose({ ...POSES.stand }, ALL_PROPS).buf
  for (const m of Object.keys(MOUTH)) expect(compose({ ...POSES.stand, mouth: m }, ALL_PROPS).buf).toEqual(plain)
  const e = newEngine(LIB, 9)
  e.start()
  for (let i = 0; i < 600; i++) {
    e.tick()
    expect(e.pose().eyes === 'closed' && e.S.play?.clip.name === 'idle_breathe').toBe(false)
  }
})

test('Desktop: plan rechnet voraus, ohne den Stand zu ändern, und bleibt unter der Svg-Grenze, auch bei Arbeit mit vielen Helfern', () => {
  const opts = { seed: 7, nightStart: 23, nightEnd: 6, idleSeconds: 45, reduced: false, flip: false }
  const a = createDesk(opts)
  const b = createDesk(opts)
  const t0 = Date.UTC(2026, 9, 6, 12)
  const calm = { ...NO_FACTS, endedAt: t0 - 1000 }
  const busy = { ...calm, turnActive: true, tool: { kind: 'write' as const, since: t0 }, agents: Array.from({ length: 12 }, () => t0) }
  let now = t0
  a.advance(now, calm, NO_STRAIN)
  b.advance(now, calm, NO_STRAIN)
  for (const facts of [calm, busy, calm, busy]) {
    for (let r = 0; r < 4; r++) {
      const p = a.plan(facts, NO_STRAIN, 4)
      expect(p.source.length).toBeLessThanOrEqual(SOURCE_MAX)
      expect(p.ticks).toBeGreaterThan(0)
      expect(p.ticks).toBeLessThanOrEqual(PLAN_TICKS)
      // b plant nie: beide müssen danach gleich weiterlaufen
      now += Math.round(p.ticks * 0.6) * 75
      a.advance(now, facts, NO_STRAIN)
      b.advance(now, facts, NO_STRAIN)
      expect(a.engine.render().buf).toEqual(b.engine.render().buf)
    }
  }
})

test('Desktop: ein Ereignis wirkt ab seiner Zeichnung, nicht rückwirkend (nach langer Ruhe kommen „fertig“ und die Begrüßung an)', () => {
  const d = createDesk({ seed: 7, nightStart: 23, nightEnd: 6, idleSeconds: 45, reduced: false, flip: false })
  const t0 = Date.UTC(2026, 9, 6, 12)
  /** Was nach der Zeichnung zu `t` in den nächsten 4 s läuft (Clip-Gruppen), Takt für Takt wie gezeigt nachgezogen. */
  const after = (t: number) => {
    const cats = new Set<string>()
    for (let ms = 0; ms <= 4000; ms += 75) {
      d.catchUp(t + ms)
      cats.add(d.engine.S.play?.clip.cat ?? '')
      if (d.engine.S.welcome) cats.add('welcome')
    }
    return cats
  }
  const calm = { ...NO_FACTS, endedAt: t0 - 60_000 }
  d.draw(t0, calm, NO_STRAIN, 4)
  // 20 s Ruhe (die gezeigte Animation), dann endet ein Turn: ab dieser Zeichnung freut er sich (vorher lief „fertig“ unsichtbar im Nachziehen ab)
  const t1 = t0 + 20_000
  const done = { ...calm, endedAt: t1 - 50, endedKind: 'done' as const }
  d.draw(t1, done, NO_STRAIN, 4)
  expect([...after(t1)]).toContain('done')
  // Rückkehr nach langer Pause (backAt) 60 s später: die Begrüßung läuft
  const t2 = t1 + 60_000
  d.catchUp(t2)
  d.draw(t2, { ...done, backAt: t2 - 50 }, NO_STRAIN, 4)
  expect([...after(t2)]).toContain('welcome')
})

test('Nichts mittendrin abbrechen: ein Wechsel wartet aufs Ende des Durchgangs bzw. eine Ruhestelle; dringende Stimmungen kommen schnell', { timeoutMs: 30000 }, () => {
  for (let seed = 1; seed <= 6; seed++) {
    const e = newEngine(LIB, 300 + seed)
    e.start()
    e.setMood('work_think')
    for (let i = 0; i < 200; i++) e.tick()
    const pl = e.S.play!
    expect(pl.clip.cat).toBe('work_think')
    // ruhiger Wechsel: verlassen wird nur am Ende des Durchgangs oder an einer Ruhestelle (Ausgangspose, Arme unten)
    e.setMood('watching')
    let left = -1
    for (let i = 0; i < 400 && left < 0; i++) {
      const before = e.S.play!
      const fi = before.fi
      const phase = before.phase
      e.tick()
      if (before.interrupted && phase === 'body') {
        // Ausstieg am nächsten Bild (die Engine prüft nach dem Weiterschalten) oder an der Schleifengrenze (letztes Bild)
        const last = fi === before.body.length - 1
        const f = before.body[Math.min(fi + 1, before.body.length - 1)]
        const rest = f.p.armL === 'down' && f.p.armR === 'down' && f.p.fx === 0 && f.p.fy === 0
        expect(rest || last, `${before.clip.name}: Ausstieg bei Bild ${fi + 1}`).toBe(true)
        left = i
      }
      if (e.S.play!.clip.cat === 'watching') left = Math.max(left, i)
    }
    expect(left).toBeGreaterThanOrEqual(0)
  }
  // Rückkehr der Stimmung: der laufende Clip bleibt einfach (Schreiben hat im Hauptteil keine sicheren Bilder, spielt also zu Ende)
  for (let seed = 41; seed <= 44; seed++) {
    const r = newEngine(LIB, seed)
    r.start()
    r.setMood('work_write')
    let k = 0
    while (!(r.S.play!.clip.cat === 'work_write' && r.S.play!.phase === 'body' && r.S.play!.fi === 0) && k++ < 400) r.tick()
    const same = r.S.play!
    r.setMood('watching')
    for (let i = 0; i < 60 && r.S.mood !== 'watching'; i++) r.tick()
    expect(r.S.mood).toBe('watching')
    expect(r.S.pending).toBe(true)
    r.setMood('work_write')
    for (let i = 0; i < 60 && r.S.mood !== 'work_write'; i++) r.tick()
    r.tick()
    expect(r.S.play, `${same.clip.name}: bleibt`).toBe(same)
    expect(r.S.pending).toBe(false)
    for (let i = 0; i < 100; i++) r.tick()
    expect(r.S.play!.clip.name).toBe(same.clip.name)
  }
  // Einmal-Stimmung geht nicht verloren: Fertig, während er schreibt; nach 4 s wäre die Stimmung schon wieder Leerlauf
  for (let seed = 50; seed < 58; seed++) {
    const d = newEngine(LIB, seed)
    d.start()
    d.setMood('work_write')
    let k = 0
    while (!(d.S.play!.clip.cat === 'work_write' && d.S.play!.phase === 'body') && k++ < 400) d.tick()
    d.setMood('done')
    let seen = false
    for (let i = 0; i < 300 && !seen; i++) {
      if (i === 53) d.setMood('idle')
      d.tick()
      if (d.S.play!.clip.cat === 'done') seen = true
    }
    expect(seen, `Seed ${seed}: Fertig-Clip läuft`).toBe(true)
  }
  // dringend (wartet auf dich): spätestens nach ~2 s plus Ausstieg
  const u = newEngine(LIB, 42)
  u.start()
  u.setMood('work_shell')
  for (let i = 0; i < 200; i++) u.tick()
  u.setMood('waitUser')
  let n = 0
  while (u.S.play!.clip.cat !== 'waitUser' && n < 200) {
    u.tick()
    n++
  }
  expect(n).toBeLessThanOrEqual(80)
})

test('Türmchen: er bleibt an seinem Platz (kein Hin- und Herlaufen), und Hinweis-Clips gibt es für beide neuen Stimmungen', () => {
  const r = resolveClip(byName('build_tower'))
  for (const f of [...r.intro, ...r.body, ...r.outro]) expect(f.p.fx).toBe(0)
  expect(cat('ctx_full').length).toBeGreaterThanOrEqual(2)
  expect(cat('done_long').length).toBeGreaterThanOrEqual(2)
})
