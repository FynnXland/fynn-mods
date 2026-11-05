// tune-strip: die zwei festen PowerShell-Skripte (Windows PowerShell 5.1) und das Lesen ihrer Antworten, ohne `$`.
// Quelle ist die Windows-Mediensteuerung (GlobalSystemMediaTransportControlsSessionManager), kein Spotify-Login, keine Tokens,
// kein Netzwerk. Nur die Sitzung `Spotify*` wird gelesen oder gesteuert; Browser, Riot Client usw. meldet die Mediensteuerung
// auch, sie werden nie angezeigt (SPEC „Fehlerverhalten“). Befehl und Argument gehen nur über die Umgebung (SP_CMD, SP_ARG,
// SP_KEY) hinein, nie in den Skripttext (wie LB_PATH bei limit-bars). Es werden keine Dateien geschrieben.

// Absoluter Pfad, damit keine powershell.exe aus dem Arbeitsordner der Sitzung zum Zug kommt (Review limit-bars 0.4.0)
export const PS_ABS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
export const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'] as const

// Gemeinsamer Anfang: WinRT-Hilfen, Spotify-Sitzung wählen. Ohne doppelte Anführungszeichen, damit das Quoting der Argumente unter
// Windows nichts verändert (limit-bars storage.ts). `Aw` wartet höchstens 10 s auf einen WinRT-Aufruf.
const HEAD = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "$at=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'})[0]",
  'function Aw($op,$ty){ $t=$at.MakeGenericMethod($ty).Invoke($null,@($op)); [void]$t.Wait(10000); $t.Result }',
  '[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]',
  '$mgr=Aw ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  "$s=$mgr.GetSessions()|Where-Object{$_.SourceAppUserModelId -like 'Spotify*'}|Select-Object -First 1",
]

// JSON-Text mit \uXXXX für alles außerhalb von ASCII, damit die Codepage der Ausgabe keine Rolle spielt
const JFUNC =
  'function J($s){ $b=New-Object Text.StringBuilder; [void]$b.Append([char]34); foreach($c in ([string]$s).ToCharArray()){ $n=[int]$c; ' +
  "if($n -eq 34 -or $n -eq 92){ [void]$b.Append([char]92).Append($c) } elseif($n -lt 32 -or $n -gt 126){ [void]$b.Append([char]92).Append('u').Append($n.ToString('x4')) } else { [void]$b.Append($c) } }; " +
  '[void]$b.Append([char]34); $b.ToString() }'

const BOOL = "function B($v){ if($v){ 'true' } else { 'false' } }"

/**
 * Abfrage: eine JSON-Zeile mit Titel, Interpret, Album, Status, Position, Länge, Shuffle, Repeat und den freien Steuerungen;
 * danach, nur wenn sich Titel/Interpret/Album seit `SP_KEY` geändert haben, eine Zeile `cover <Base64>` mit dem auf 112 px
 * verkleinerten Cover als JPEG (Anzeige 56 px, scharf auf Hi-DPI). Keine Sitzung: `{"ok":false}`.
 */
const PRELUDE = [
  ...HEAD,
  JFUNC,
  BOOL,
  '[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]',
  '[void][Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]',
]

// Ab hier liest die Abfrage die Sitzung `$s` (muss gesetzt sein)
const QUERY_BODY = [
  '$p=Aw ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
  '$pb=$s.GetPlaybackInfo(); $tl=$s.GetTimelineProperties(); $c=$pb.Controls; $inv=[Globalization.CultureInfo]::InvariantCulture',
  '$pos=$tl.Position.TotalSeconds; $end=$tl.EndTime.TotalSeconds',
  // Spotify meldet die Position nur bei Ereignissen: ab `LastUpdatedTime` mit der Uhr weiterrechnen
  "if([string]$pb.PlaybackStatus -eq 'Playing'){ $pos+=([DateTimeOffset]::UtcNow-$tl.LastUpdatedTime).TotalSeconds }",
  'if($pos -gt $end){ $pos=$end }; if($pos -lt 0){ $pos=0 }',
  '$key=$p.Title+[char]9+$p.Artist+[char]9+$p.AlbumTitle',
  // 0.6.0: Prozess-ID der Spotify-App für den Takt-Helfer (der zuerst gestartete Spotify-Prozess ist der Hauptprozess, sein Baum spielt den Ton)
  '$sp=0; try { $sp=[int](Get-Process -Name Spotify -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1).Id } catch { }',
  "$j='{'+(J 'ok')+':'+(B $true)+','+(J 'title')+':'+(J $p.Title)+','+(J 'artist')+':'+(J $p.Artist)+','+(J 'album')+':'+(J $p.AlbumTitle)+','+(J 'status')+':'+(J $pb.PlaybackStatus)" +
    "+','+(J 'pos')+':'+([Math]::Round($pos,1).ToString($inv))+','+(J 'end')+':'+([Math]::Round($end,1).ToString($inv))+','+(J 'shuffle')+':'+(B $pb.IsShuffleActive)+','+(J 'repeat')+':'+(J $pb.AutoRepeatMode)" +
    "+','+(J 'pid')+':'+$sp+','+(J 'can')+':{'+(J 'seek')+':'+(B $c.IsPlaybackPositionEnabled)+','+(J 'shuffle')+':'+(B $c.IsShuffleEnabled)+','+(J 'repeat')+':'+(B $c.IsRepeatEnabled)+'}}'",
  '$j',
  // Cover nur bei neuem Titel; Fehler beim Cover lassen die Textzeile unberührt
  "if($key -ne $env:SP_KEY -and $null -ne $p.Thumbnail){ try { " +
    'Add-Type -AssemblyName System.Drawing; ' +
    '$st=Aw ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType]); ' +
    "$m=[System.IO.WindowsRuntimeStreamExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IInputStream'}|Select-Object -First 1; " +
    '$ms=New-Object IO.MemoryStream; $m.Invoke($null,@($st)).CopyTo($ms); $ms.Position=0; ' +
    '$img=[Drawing.Image]::FromStream($ms); $bmp=New-Object Drawing.Bitmap 112,112; $g=[Drawing.Graphics]::FromImage($bmp); ' +
    "$g.InterpolationMode='HighQualityBicubic'; $g.DrawImage($img,0,0,112,112); " +
    "$o=New-Object IO.MemoryStream; $bmp.Save($o,[Drawing.Imaging.ImageFormat]::Jpeg); 'cover '+[Convert]::ToBase64String($o.ToArray()) } catch { } }",
]

export const QUERY_SCRIPT = [...PRELUDE, "if($null -eq $s){ '{'+(J 'ok')+':false}'; exit 0 }", ...QUERY_BODY].join('; ')

/** Steuerbefehle des Steuer-Skripts; `SP_CMD` ist immer einer davon. */
export const CONTROL_CMDS = ['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'shuffle', 'repeat'] as const
export type ControlCmd = (typeof CONTROL_CMDS)[number]
export const REPEAT_MODES = ['None', 'Track', 'List'] as const
export type RepeatMode = (typeof REPEAT_MODES)[number]

/**
 * Steuern und danach im selben Prozess lesen (ein PowerShell-Start statt zwei): `SP_CMD` (einer von CONTROL_CMDS), `SP_ARG` nur bei
 * seek (Zielposition in Sekunden), shuffle (true/false) und repeat (None/Track/List), `SP_WAIT` die Wartezeit in ms bis zum Lesen
 * (Spotify braucht einen Moment, bis die Mediensteuerung den neuen Stand meldet; nach next/prev die längste Zeit, die auf den neuen
 * Titel gewartet wird), `SP_KEY` wie bei der Abfrage. Die Zielposition
 * und die Wartezeit werden als Zahl geparst, nie als Text ausgeführt. Erste Zeile `ok`, `fail`, `nosession` oder `badcmd`;
 * bei `ok` und `fail` folgen die Zeilen der Abfrage.
 */
export const CONTROL_SCRIPT = [
  ...PRELUDE,
  "if($null -eq $s){ 'nosession'; exit 0 }",
  '$r=$false',
  "switch($env:SP_CMD){ " +
    "'play' { $r=Aw ($s.TryPlayAsync()) ([bool]) } " +
    "'pause' { $r=Aw ($s.TryPauseAsync()) ([bool]) } " +
    "'toggle' { $r=Aw ($s.TryTogglePlayPauseAsync()) ([bool]) } " +
    "'next' { $r=Aw ($s.TrySkipNextAsync()) ([bool]) } " +
    "'prev' { $r=Aw ($s.TrySkipPreviousAsync()) ([bool]) } " +
    "'seek' { $ticks=[long]([double]::Parse($env:SP_ARG,[Globalization.CultureInfo]::InvariantCulture)*10000000); $r=Aw ($s.TryChangePlaybackPositionAsync($ticks)) ([bool]) } " +
    "'shuffle' { $r=Aw ($s.TryChangeShuffleActiveAsync($env:SP_ARG -eq 'true')) ([bool]) } " +
    "'repeat' { $r=Aw ($s.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode]$env:SP_ARG)) ([bool]) } " +
    "default { 'badcmd'; exit 0 } }",
  "if($r){ 'ok' } else { 'fail' }",
  // Nach Weiter/Zurück so lange fragen, bis der Titel wechselt (höchstens SP_WAIT ms), sonst die feste Wartezeit
  '$w=[Math]::Min(2000,[Math]::Max(0,[int]$env:SP_WAIT))',
  "if($env:SP_CMD -eq 'next' -or $env:SP_CMD -eq 'prev'){ $sw=[Diagnostics.Stopwatch]::StartNew(); while($sw.ElapsedMilliseconds -lt $w){ " +
    '$pp=Aw ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]); ' +
    'if(($pp.Title+[char]9+$pp.Artist+[char]9+$pp.AlbumTitle) -ne $env:SP_KEY){ break }; [System.Threading.Thread]::Sleep(60) } } ' +
    'else { [System.Threading.Thread]::Sleep($w) }',
  ...QUERY_BODY,
].join('; ')

export type Track = {
  title: string
  artist: string
  album: string
  status: string
  /** Position in Sekunden zum Zeitpunkt der Abfrage (bei „Playing“ schon bis dahin weitergerechnet). */
  pos: number
  /** Länge in Sekunden; 0, wenn unbekannt. */
  end: number
  shuffle: boolean
  repeat: RepeatMode
  canSeek: boolean
  canShuffle: boolean
  canRepeat: boolean
}

/** `pid`: Prozess-ID der Spotify-App für den Takt-Helfer (0.6.0); fehlt, wenn sie nicht lesbar war. */
export type Query = { track: Track | null; cover?: string; pid?: number }

const TEXT_MAX = 200
const COVER_MAX = 40000 // Base64 eines 112-px-JPEG liegt bei ~5 KB; das Svg-Limit ist 131 072 (types:12276)

const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, TEXT_MAX) : '')
const secs = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 86400 ? v : 0)

/** Antwort des Abfrage-Skripts lesen. Kaputtes (leer, kein JSON, falsche Typen) → `undefined`, „keine Sitzung“ → `{ track: null }`. */
export function parseQuery(stdout: string): Query | undefined {
  const lines = stdout.split(/\r?\n/)
  const first = lines.find((l) => l.trim().startsWith('{'))
  if (!first) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(first)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (o.ok !== true) return o.ok === false ? { track: null } : undefined
  const can = (o.can && typeof o.can === 'object' ? o.can : {}) as Record<string, unknown>
  const repeat = REPEAT_MODES.find((m) => m === o.repeat) ?? 'None'
  const track: Track = {
    title: text(o.title),
    artist: text(o.artist),
    album: text(o.album),
    status: text(o.status),
    pos: secs(o.pos),
    end: secs(o.end),
    shuffle: o.shuffle === true,
    repeat,
    canSeek: can.seek === true,
    canShuffle: can.shuffle === true,
    canRepeat: can.repeat === true,
  }
  const c = lines.find((l) => l.startsWith('cover '))
  const b64 = c?.slice(6).trim()
  // Nur plausibles Base64 durchlassen: es landet in einer data:-URL im Svg
  const cover = b64 && b64.length <= COVER_MAX && /^[A-Za-z0-9+/]+=*$/.test(b64) ? b64 : undefined
  const out: Query = cover ? { track, cover } : { track }
  if (typeof o.pid === 'number' && Number.isInteger(o.pid) && o.pid > 0 && o.pid < 10_000_000) out.pid = o.pid
  return out
}

/** Schlüssel für `SP_KEY`: ändert er sich, liefert die Abfrage ein neues Cover. */
export function trackKey(t: Pick<Track, 'title' | 'artist' | 'album'>): string {
  return `${t.title}\t${t.artist}\t${t.album}`
}
