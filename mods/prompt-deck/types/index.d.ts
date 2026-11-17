// $.state-Werte von prompt-deck (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur prompt-deck schreibt (types:3629-3659).
// Absprachen mit sidekick (SPEC „Absprachen über $.state“); gleiche Fassung in mods/sidekick/types/index.d.ts.
//
// `saved`: Namen und Wortmengen der gespeicherten Prompts (Reihenfolge des Speicherns), kein voller Text. sidekick bietet nichts an,
//          was einem gespeicherten ähnelt, und überspringt beim Umzug vorhandene Namen. Geschrieben bei session.start und jeder Änderung.
// `later`: Knopf „Danach“ geklickt (`armed`, `at` = $.clock.now des Klicks); `null` nach dem zweiten Klick oder sobald
//          `sidekick.status.later` wegfällt. sidekick nimmt die nächste eigene Nachricht der Runde als „danach“, wenn `at` nach dem
//          Rundenstart liegt und noch nicht verbraucht ist.
//
// `sidekick.status` (Kopie der gelesenen Felder aus mods/sidekick/types/index.d.ts, muss gleich bleiben): `later: true`, solange
// „Danach“ gilt (Zug läuft, Stufe Begleiter, `queue` an); `laterUsed` = `at` der zuletzt verbrauchten Markierung.

declare module 'claude-code' {
  interface PluginState {
    'prompt-deck': {
      saved: { items: { name: string; words: string[] }[] } | null
      later: { armed: true; at: number } | null
    }
    sidekick: {
      status: { level: 'off' | 'cache' | 'guide'; busy: boolean; tip?: string; cold?: true; handoff?: true; later?: true; laterUsed?: number } | null
    }
  }
}
