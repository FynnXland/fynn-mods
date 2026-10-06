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
        state: 'idle' | 'waiting' | 'checking' | 'ask' | 'blocked' | 'unclear'
        stateReason: string
        notice: { reason: string; todoId: string | null } | null
        autoRun: number
        strikes: { id: string; n: number }
        hold: boolean
        plan: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }[]
        sessionDone: number
        expectOwn: string | null
        lastResult: string
      }
      // Zähler zum Neuzeichnen: nur die Seitenleiste liest ihn, also zeichnet ein Schreiben nur sie neu
      paint: number
    }
  }
}
