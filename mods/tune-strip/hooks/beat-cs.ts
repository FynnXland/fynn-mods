// tune-strip 0.6.0: Quelltext des Takt-Helfers (C# 5, übersetzt von Windows PowerShell 5.1 per `Add-Type`). Fester Text im Mod,
// keine eigene Datei zur Laufzeit (Add-Type übersetzt in Windows PowerShell 5.1 über den C#-Compiler von Windows, der dafür kurz
// Temp-Dateien mit diesem Code anlegt; Ton wird nie geschrieben, Review 0.6.0 S3). Herkunft: probe/beat/Beat.cs (Analyse) und probe/beat/Proc.cs (nur Spotify abhören), hier fortlaufend:
// die Hüllkurve wächst Stück für Stück, alle 2,5 s wird ausgewertet.
//
// Was er tut: Er hört per WASAPI Process-Loopback (`VAD\Process_Loopback`, Windows 10 2004+) nur den Prozessbaum mit der Prozess-ID
// `pid` ab (Spotify). Gibt es diesen Zugang nicht, endet er mit `fail` (kein Rückfall auf den ganzen Systemton). Der Ton bleibt im
// Speicher (1024 Werte für die FFT, dazu je 5 ms ein Satz Zahlen über höchstens 20 s); nichts wird aufgenommen oder geschrieben.
//
// Ausgabe (stdout, eine Zeile je Ergebnis, Zahlen mit Punkt):
//   ready
//   b <win s> <ende ms> <bpm> <tempoKlarheit> <schlag ms> <phaseKlarheit> <bass> <hoehen> <schwerpunkt Hz> <flachheit> <anschlaege/s> <pegel>
//   q <ende ms>          (Stille)
//   fail <grund>         (danach Ende)
// Zeiten sind Unix-ms; <schlag ms> ist der letzte Schlag im Fenster, wie Spotify ihn an Windows übergibt (ohne Geräteverzögerung).
// Er endet, wenn Spotify oder der Prozess, der ihn gestartet hat, nicht mehr läuft (Sicherheitsnetz, falls Claude Code abstürzt).
export const BEAT_CS = String.raw`
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

namespace TuneStripBeat {
  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    int GetBufferSize(out uint frames);
    int GetStreamLatency(out long latency);
    int GetCurrentPadding(out uint padding);
    int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    int GetMixFormat(out IntPtr format);
    int GetDevicePeriod(out long def, out long min);
    int Start();
    int Stop();
    int Reset();
    int SetEventHandle(IntPtr h);
    int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
  }

  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient {
    int GetBuffer(out IntPtr data, out uint frames, out int flags, out long devPos, out long qpcPos);
    int ReleaseBuffer(uint frames);
    int GetNextPacketSize(out uint frames);
  }

  [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAgileObject { }

  [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IActivateAudioInterfaceAsyncOperation {
    void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
  }

  [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IActivateAudioInterfaceCompletionHandler {
    void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
  }

  [ClassInterface(ClassInterfaceType.None)]
  class ActHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject {
    public readonly ManualResetEvent Done = new ManualResetEvent(false);
    public int Hr;
    public object Iface;
    public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) {
      op.GetActivateResult(out Hr, out Iface);
      Done.Set();
    }
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PBI {
    public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr Reserved2a; public IntPtr Reserved2b;
    public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId;
  }

  public static class Helper {
    const int RATE = 44100, CH = 2, WIN = 1024, HOP = 220, ENV = 4000;
    const double FPS = (double)RATE / HOP;          // Hüllkurvenwerte je Sekunde (200,45)
    const int SHORT = 1200, EMIT_MS = 2500;         // kurzes Fenster 6 s, Ausgabe alle 2,5 s
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
      IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI info, int len, out int retLen);

    // Ringe: Ton für die FFT, Hüllkurve und Merkmale je Hüllkurvenwert
    static readonly float[] smp = new float[WIN];
    static int smpPos, sinceHop;
    static long smpCount, frames;
    static readonly double[] eFlux = new double[ENV], eLow = new double[ENV], eBass = new double[ENV], eHigh = new double[ENV],
      eTot = new double[ENV], eCent = new double[ENV], eFlat = new double[ENV], eRms = new double[ENV], eMs = new double[ENV];
    static readonly double[] prevLog = new double[WIN / 2], re = new double[WIN], im = new double[WIN], hann = new double[WIN];

    static double NowMs() { return (DateTime.UtcNow.Ticks - 621355968000000000L) / 10000.0; }

    static bool Alive(int pid, DateTime before) {
      try { var p = Process.GetProcessById(pid); return !p.HasExited && p.StartTime <= before; } catch { return false; }
    }

    static int ParentPid() {
      try {
        var pbi = new PBI(); int rl;
        if (NtQueryInformationProcess(Process.GetCurrentProcess().Handle, 0, ref pbi, Marshal.SizeOf(pbi), out rl) != 0) return 0;
        return pbi.InheritedFromUniqueProcessId.ToInt32();
      } catch { return 0; }
    }

    static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

    public static void Run(int pid) {
      if (pid <= 0) { Say("fail pid"); return; }
      for (int i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / WIN);
      var started = DateTime.Now;
      int parent = ParentPid();

      // AUDIOCLIENT_ACTIVATION_PARAMS: Typ 1 (Prozess-Loopback), Ziel-PID, Modus 0 (Prozessbaum einschließen)
      IntPtr ap = Marshal.AllocHGlobal(12);
      Marshal.WriteInt32(ap, 0, 1); Marshal.WriteInt32(ap, 4, pid); Marshal.WriteInt32(ap, 8, 0);
      // PROPVARIANT VT_BLOB
      IntPtr pv = Marshal.AllocHGlobal(24);
      for (int i = 0; i < 24; i++) Marshal.WriteByte(pv, i, 0);
      Marshal.WriteInt16(pv, 0, 65); Marshal.WriteInt32(pv, 8, 12); Marshal.WriteIntPtr(pv, 16, ap);
      var h = new ActHandler(); IActivateAudioInterfaceAsyncOperation op;
      try { ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, pv, h, out op); }
      catch (Exception) { Say("fail activate"); return; }
      if (!h.Done.WaitOne(5000)) { Say("fail timeout"); return; }
      if (h.Hr != 0 || h.Iface == null) { Say("fail 0x" + h.Hr.ToString("X8")); return; }
      var ac = (IAudioClient)h.Iface;

      // 44,1 kHz Stereo float; Windows wandelt um (AUTOCONVERTPCM)
      IntPtr fmt = Marshal.AllocHGlobal(18);
      Marshal.WriteInt16(fmt, 0, 3); Marshal.WriteInt16(fmt, 2, (short)CH); Marshal.WriteInt32(fmt, 4, RATE);
      Marshal.WriteInt32(fmt, 8, RATE * CH * 4); Marshal.WriteInt16(fmt, 12, (short)(CH * 4)); Marshal.WriteInt16(fmt, 14, 32); Marshal.WriteInt16(fmt, 16, 0);
      // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM, Puffer 200 ms
      int hr = ac.Initialize(0, 0x00020000 | 0x00040000 | unchecked((int)0x80000000), 2000000, 0, fmt, IntPtr.Zero);
      if (hr != 0) { Say("fail init 0x" + hr.ToString("X8")); return; }
      var ev = new AutoResetEvent(false);
      if (ac.SetEventHandle(ev.SafeWaitHandle.DangerousGetHandle()) != 0) { Say("fail event"); return; }
      Guid iidCc = typeof(IAudioCaptureClient).GUID; object c;
      if (ac.GetService(ref iidCc, out c) != 0) { Say("fail service"); return; }
      var cc = (IAudioCaptureClient)c;
      if (ac.Start() != 0) { Say("fail start"); return; }
      Say("ready");

      var buf = new float[0];
      double lastSampleMs = NowMs(), lastEmit = NowMs(), lastCheck = NowMs();
      long qpcFreq = Stopwatch.Frequency;
      while (true) {
        ev.WaitOne(100);
        uint n;
        while (cc.GetNextPacketSize(out n) == 0 && n > 0) {
          IntPtr d; uint fr; int fl; long dp, qp;
          if (cc.GetBuffer(out d, out fr, out fl, out dp, out qp) != 0) break;
          double now = NowMs();
          // Zeit des ersten Werts: aus dem Leistungszähler der Aufnahme (100-ns-Einheiten), sonst aus der Ankunft
          double startMs = now - fr * 1000.0 / RATE;
          if (qp > 0) {
            double nowQpc = Stopwatch.GetTimestamp() * (1e7 / qpcFreq);
            double q = now - (nowQpc - qp) / 1e4;
            if (Math.Abs(q - startMs) < 200) startMs = q;
          }
          int cnt = (int)fr * CH; if (buf.Length < cnt) buf = new float[cnt];
          if ((fl & 2) != 0) Array.Clear(buf, 0, cnt); else Marshal.Copy(d, buf, 0, cnt);
          cc.ReleaseBuffer(fr);
          for (int i = 0; i < fr; i++) Push((buf[i * CH] + buf[i * CH + 1]) * 0.5f, startMs + i * 1000.0 / RATE);
          lastSampleMs = startMs + fr * 1000.0 / RATE;
        }
        double t = NowMs();
        // Keine Pakete (Spotify still): Stille nachtragen, damit die Hüllkurve gleichmäßig weiterläuft
        if (t - lastSampleMs > 300) {
          int z = (int)Math.Min((t - lastSampleMs - 100) * RATE / 1000.0, RATE * 20.0);
          for (int i = 0; i < z; i++) Push(0f, lastSampleMs + i * 1000.0 / RATE);
          lastSampleMs += z * 1000.0 / RATE;
        }
        if (t - lastCheck > 5000) {
          lastCheck = t;
          if (!Alive(pid, started)) { Say("fail gone"); break; }
          if (parent > 0 && !Alive(parent, started)) break;
        }
        if (t - lastEmit >= EMIT_MS) {
          lastEmit = t;
          Emit();
        }
      }
      ac.Stop();
    }

    static void Push(float s, double ms) {
      smp[smpPos] = s; smpPos = (smpPos + 1) % WIN; smpCount++;
      if (++sinceHop < HOP) return;
      sinceHop = 0;
      if (smpCount >= WIN) Frame(ms - (WIN / 2.0) * 1000.0 / RATE);
    }

    // Ein Hüllkurvenwert: spektraler Fluss der log-komprimierten Beträge (gesamt und unter 200 Hz) und die Klangmerkmale
    static void Frame(double centerMs) {
      double e = 0;
      for (int i = 0; i < WIN; i++) { double v = smp[(smpPos + i) % WIN]; e += v * v; re[i] = v * hann[i]; im[i] = 0; }
      Fft(re, im);
      double fx = 0, fl = 0, bass = 0, high = 0, tot = 0, num = 0, lsum = 0, lin = 0; int nb = 0;
      for (int b = 1; b < WIN / 2; b++) {
        double mag = Math.Sqrt(re[b] * re[b] + im[b] * im[b]);
        double lm = Math.Log(1 + 100 * mag);
        double dl = lm - prevLog[b]; prevLog[b] = lm;
        double hz = (double)b * RATE / WIN;
        if (dl > 0) { fx += dl; if (hz < 200) fl += dl; }
        if (hz < 150) bass += mag; else if (hz > 4000) high += mag;
        tot += mag; num += hz * mag;
        if (hz >= 200 && hz <= 8000) { lsum += Math.Log(mag + 1e-9); lin += mag; nb++; }
      }
      int k = (int)(frames % ENV);
      eFlux[k] = fx; eLow[k] = fl; eBass[k] = bass; eHigh[k] = high; eTot[k] = tot;
      eCent[k] = tot > 0 ? num / tot : 0;
      eFlat[k] = lin > 0 ? Math.Exp(lsum / nb) / (lin / nb) : 0;
      eRms[k] = Math.Sqrt(e / WIN); eMs[k] = centerMs;
      frames++;
    }

    static void Emit() {
      if (frames < SHORT) return;
      // Stille: Pegel der letzten 2 s (Pause liefert Nullen; die Grenze liegt weit darunter, was leise Musik bei kleiner Lautstärke hat)
      double r = 0; int m = 400;
      for (int i = 0; i < m; i++) r += eRms[(int)((frames - 1 - i) % ENV)];
      if (r / m < 0.00002) { Say("q " + ((long)eMs[(int)((frames - 1) % ENV)]).ToString(Inv)); return; }
      Say(Analyze(SHORT));
      if (frames >= ENV) Say(Analyze(ENV));
    }

    // Tempo per Autokorrelation (Vielfache mitgezählt, Vorliebe um 120 bpm), Schlag per Kammfilter (Bass doppelt), Merkmale gemittelt
    static string Analyze(int W) {
      var raw = new double[W]; var rawL = new double[W]; var ms = new double[W];
      double bass = 0, high = 0, tot = 0, cent = 0, flat = 0, rms = 0;
      for (int i = 0; i < W; i++) {
        int k = (int)((frames - W + i) % ENV);
        raw[i] = eFlux[k]; rawL[i] = eLow[k]; ms[i] = eMs[k];
        bass += eBass[k]; high += eHigh[k]; tot += eTot[k]; cent += eCent[k]; flat += eFlat[k]; rms += eRms[k];
      }
      var flux = new double[W]; var low = new double[W]; int M = 20; double fsum = 0, fsq = 0;
      for (int f = 0; f < W; f++) {
        double s = 0, sl = 0; int c = 0;
        for (int j = Math.Max(0, f - M); j <= Math.Min(W - 1, f + M); j++) { s += raw[j]; sl += rawL[j]; c++; }
        flux[f] = Math.Max(0, raw[f] - s / c); low[f] = Math.Max(0, rawL[f] - sl / c);
        fsum += flux[f]; fsq += flux[f] * flux[f];
      }
      // Anschlagdichte: Spitzen des Flusses über Mittel + Streuung, mindestens 50 ms auseinander
      double fmean = fsum / W, fstd = Math.Sqrt(Math.Max(0, fsq / W - fmean * fmean)); int onsets = 0, lastOn = -100;
      for (int f = 3; f < W - 3; f++) {
        double v = flux[f];
        if (v > fmean + fstd && v >= flux[f - 1] && v >= flux[f + 1] && v >= flux[f - 2] && v >= flux[f + 2] && f - lastOn >= 10) { onsets++; lastOn = f; }
      }

      int minLag = (int)(FPS * 60 / 210), maxLag = (int)(FPS * 60 / 55) + 1;
      int top = Math.Min(W / 2, maxLag * 4 + 2);
      var acf = new double[top + 2];
      for (int lag = 1; lag <= top + 1 && lag < W; lag++) {
        double s = 0; for (int f = lag; f < W; f++) s += flux[f] * flux[f - lag];
        acf[lag] = s / (W - lag);
      }
      var score = new double[maxLag + 2]; int best = minLag, second = minLag; double bestV = -1, secV = -1;
      for (int lag = minLag; lag <= maxLag; lag++) {
        double s = 0;
        for (int q = 1; q <= 4 && q * lag + 1 <= top + 1; q++) s += Math.Max(acf[q * lag - 1], Math.Max(acf[q * lag], acf[q * lag + 1])) / q;
        double bpm = 60.0 * FPS / lag;
        s *= Math.Exp(-0.5 * Math.Pow(Math.Log(bpm / 120.0, 2), 2));
        score[lag] = s;
      }
      for (int lag = minLag; lag <= maxLag; lag++) if (score[lag] > bestV) { bestV = score[lag]; best = lag; }
      for (int lag = minLag + 1; lag < maxLag; lag++)
        if (Math.Abs(lag - best) > 3 && score[lag] > secV && score[lag] >= score[lag - 1] && score[lag] >= score[lag + 1]) { secV = score[lag]; second = lag; }
      double a = acf[best - 1], b0 = acf[best], c2 = acf[best + 1];
      double off = (a - 2 * b0 + c2) != 0 ? 0.5 * (a - c2) / (a - 2 * b0 + c2) : 0;
      if (Math.Abs(off) > 1) off = 0;
      double period = best + off;
      double bpmOut = 60.0 * FPS / period;
      double tclar = secV > 0 ? bestV / secV : 9.99;

      int P = (int)Math.Round(period); double bestPh = 0, bestPs = -1, sumPs = 0, lsumAll = 0;
      for (int f = 0; f < W; f++) lsumAll += low[f];
      double lw = lsumAll > 0 ? 2.0 * fsum / lsumAll : 0;
      var ph2 = new double[W]; for (int f = 0; f < W; f++) ph2[f] = flux[f] + lw * low[f];
      for (int ph = 0; ph < P; ph++) {
        double s = 0;
        for (double t = ph; t < W - 2; t += period) { int i = (int)Math.Round(t); s += ph2[i] + 0.5 * (i > 0 ? ph2[i - 1] : 0) + 0.5 * ph2[i + 1]; }
        sumPs += s; if (s > bestPs) { bestPs = s; bestPh = ph; }
      }
      double pclar = sumPs > 0 ? bestPs / (sumPs / P) : 0;
      double lastBeat = bestPh; while (lastBeat + period < W - 1) lastBeat += period;
      int lb = (int)Math.Floor(lastBeat);
      double beatMs = ms[lb] + (lastBeat - lb) * 1000.0 / FPS;

      return string.Format(Inv, "b {0} {1} {2:0.00} {3:0.00} {4} {5:0.00} {6:0.0000} {7:0.0000} {8:0} {9:0.0000} {10:0.00} {11:0.00000}",
        (int)Math.Round(W / FPS), (long)ms[W - 1], bpmOut, Math.Min(tclar, 9.99), (long)Math.Round(beatMs), pclar,
        tot > 0 ? bass / tot : 0, tot > 0 ? high / tot : 0, cent / W, flat / W, onsets * FPS / W, rms / W);
    }

    static void Fft(double[] re, double[] im) {
      int n = re.Length;
      for (int i = 1, j = 0; i < n; i++) {
        int bit = n >> 1; for (; (j & bit) != 0; bit >>= 1) j ^= bit; j ^= bit;
        if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (int len = 2; len <= n; len <<= 1) {
        double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
        for (int i = 0; i < n; i += len) {
          double cr = 1, ci = 0;
          for (int k = 0; k < len / 2; k++) {
            int u = i + k, v = i + k + len / 2;
            double xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
            re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi;
            double ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
    }
  }
}
`

/**
 * Startzeile für `powershell.exe -MTA … -Command`: liest den C#-Text von stdin (`input` von `$.process.spawn`, types:8478-8484),
 * übersetzt ihn und startet den Helfer. Die Prozess-ID kommt nur über `SP_PID` hinein und wird als Zahl geprüft, nie als Text
 * ausgeführt. Ohne doppelte Anführungszeichen (wie ps.ts), damit das Quoting unter Windows nichts verändert.
 */
export const BEAT_BOOT =
  "$ErrorActionPreference='Stop'; if($env:SP_PID -notmatch '^[0-9]{1,7}$'){ 'fail pid'; exit 0 }; " +
  "$src=[Console]::In.ReadToEnd(); Add-Type -TypeDefinition $src; [TuneStripBeat.Helper]::Run([int]$env:SP_PID)"
