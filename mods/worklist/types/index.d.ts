// $.state-Werte von worklist. Jeder Wert muss hier deklariert sein (docs/raw/en/interface.md:717-769); der Vertrag muss
// in sich geschlossen sein (kein import). Gleiche Form wie `Runtime` in hooks/model.ts.
// `rt` hält den Laufzustand über einen Hot Reload (/reload-plugins) hinweg; /clear und ein neuer Prozess setzen ihn zurück.

declare module 'claude-code' {
  interface PluginState {
    worklist: {
      rt: {
        sid: string
        busy: boolean
        turnSeq: number
        turn: { startedAt: number; todoId: string | null; text: string; fromFynn: boolean }
        // ab 0.4.0: 'fresh' nach Neustart, Resume oder Chatwechsel (läuft, sendet erst nach Fynns Zutun)
        state: 'idle' | 'waiting' | 'checking' | 'ask' | 'blocked' | 'unclear' | 'fresh'
        stateReason: string
        // ab 0.4.0: kind 'background' für „Nicht mehr warten?“
        notice: { reason: string; todoId: string | null; kind?: 'background' } | null
        autoRun: number
        strikes: { id: string; n: number }
        hold: boolean
        plan: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }[]
        sessionDone: number
        expectOwn: string | null
        // ab 0.3.0: Befehls-To-do, auf dessen Turn gewartet wird, und die gesendeten To-dos des Chats (Prüfsumme statt Text)
        expectCmd: string | null
        // ab 0.4.0: c = Fortsetzung statt To-do-Text
        sent: { id: string; h: string; n: number; m: number; c?: boolean }[]
        lastResult: string
        // ab 0.4.0: Warten mit Grenze (Kurzform, Beginn, Hinweis gezeigt, ausgenommene Aufgaben) und letztes Turn-Ende
        stateShort: string
        waitSince: number
        waitNoticed: boolean
        ignoreBg: string[]
        turnEndAt: number
      }
      // Zähler zum Neuzeichnen: nur die Seitenleiste liest ihn, also zeichnet ein Schreiben nur sie neu
      paint: number
    }
  }
}
