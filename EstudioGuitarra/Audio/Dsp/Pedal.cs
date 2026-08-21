using System;
using System.Collections.Generic;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>
/// Un pedal de la pedalera. Replica, tipo a tipo, la logica de crearPedalAudio()/aplicarParams()
/// del motor Web Audio original: mismos parametros (0..100) y mismo mapeo a valores de DSP,
/// pero procesado muestra a muestra en C# en vez de con un grafo de AudioNode del navegador.
/// </summary>
public sealed class Pedal
{
    public string Id { get; }
    public string Tipo { get; }
    public bool Bypass { get; set; }

    private readonly int _sampleRate;
    private readonly Dictionary<string, double> _params = new();

    // Sub-DSP por tipo (solo se instancia lo que hace falta)
    private Compressor? _comp;
    private BiquadFilter? _boostLp;
    private double _boostGain;

    private BiquadFilter? _drTono;
    private double _drPreGain, _drAmount, _drHardness, _drLevel;

    private BiquadFilter? _eqLow, _eqMid, _eqHigh;

    private BiquadFilter? _wahBp;
    private Lfo? _wahLfo;
    private double _wahBaseFreq, _wahDepth, _wahQ;

    private DelayLine? _chorusDelay;
    private Lfo? _chorusLfo;
    private double _chorusBaseDelay, _chorusDepth, _chorusWet, _chorusDry;

    private BiquadFilter[]? _phaserAps;
    private Lfo? _phaserLfo;
    private double _phaserDepth, _phaserWet, _phaserDry;

    private Lfo? _tremLfo;
    private double _tremBase, _tremDepth;

    private DelayLine? _delayLine;
    private double _delayTime, _delayFeedback, _delayWet;

    private SchroederReverb? _reverb;
    private double _reverbWet;

    public Pedal(string id, string tipo, int sampleRate)
    {
        Id = id;
        Tipo = tipo;
        _sampleRate = sampleRate;

        switch (tipo)
        {
            case "comp":
                _comp = new Compressor(sampleRate);
                break;
            case "boost":
                _boostLp = new BiquadFilter(sampleRate);
                break;
            case "od":
            case "dist":
            case "fuzz":
                _drTono = new BiquadFilter(sampleRate);
                break;
            case "eq":
                _eqLow = new BiquadFilter(sampleRate);
                _eqMid = new BiquadFilter(sampleRate);
                _eqHigh = new BiquadFilter(sampleRate);
                break;
            case "wah":
                _wahBp = new BiquadFilter(sampleRate);
                _wahLfo = new Lfo(sampleRate);
                break;
            case "chorus":
                _chorusDelay = new DelayLine(sampleRate, 0.1);
                _chorusLfo = new Lfo(sampleRate);
                break;
            case "phaser":
                _phaserAps = new[] { new BiquadFilter(sampleRate), new BiquadFilter(sampleRate), new BiquadFilter(sampleRate), new BiquadFilter(sampleRate) };
                _phaserLfo = new Lfo(sampleRate);
                break;
            case "trem":
                _tremLfo = new Lfo(sampleRate);
                break;
            case "delay":
                _delayLine = new DelayLine(sampleRate, 1.6);
                break;
            default: // "reverb"
                _reverb = new SchroederReverb(sampleRate);
                break;
        }
    }

    public void SetParam(string key, double value01to100)
    {
        _params[key] = value01to100;
        Recalculate();
    }

    public void SetParams(IReadOnlyDictionary<string, double> parametros)
    {
        foreach (var kv in parametros) _params[kv.Key] = kv.Value;
        Recalculate();
    }

    private double V(string key) => (_params.TryGetValue(key, out var v) ? v : 0) / 100.0;
    private static double Db(double v01to100) => (v01to100 - 50) / 50 * 14;

    private void Recalculate()
    {
        switch (Tipo)
        {
            case "comp":
                _comp!.ThresholdDb = -6 - V("umbral") * 44;
                _comp.Ratio = 1.5 + V("ratio") * 16;
                _comp.AttackSeconds = 0.006; _comp.ReleaseSeconds = 0.18;
                _comp.MakeupGain = 0.5 + V("nivel") * 1.6;
                break;
            case "boost":
                _boostGain = 0.5 + V("nivel") * 2.5;
                _boostLp!.Configure(BiquadType.LowPass, 1200 + V("tono") * 10000, 0.707);
                break;
            case "od":
            case "dist":
            case "fuzz":
            {
                string driveKey = Tipo == "fuzz" ? "fuzz" : "drive";
                double dureza = Tipo == "od" ? 40 : Tipo == "dist" ? 120 : 300;
                _drAmount = V(driveKey);
                _drHardness = dureza;
                _drPreGain = 0.8 + _drAmount * (Tipo == "fuzz" ? 12 : 6);
                string tk = Tipo == "dist" ? "cuerpo" : "tono";
                _drTono!.Configure(BiquadType.LowPass, 900 + V(tk) * 7000, 0.707);
                _drLevel = 0.15 + V("nivel") * 0.8;
                break;
            }
            case "eq":
                _eqLow!.Configure(BiquadType.LowShelf, 200, 0.707, Db(_params.GetValueOrDefault("graves")));
                _eqMid!.Configure(BiquadType.Peaking, 900, 1.0, Db(_params.GetValueOrDefault("medios")));
                _eqHigh!.Configure(BiquadType.HighShelf, 3000, 0.707, Db(_params.GetValueOrDefault("agudos")));
                break;
            case "wah":
                _wahLfo!.FrequencyHz = 0.3 + V("ritmo") * 6;
                _wahBaseFreq = 350 + V("rango") * 900;
                _wahDepth = 200 + V("rango") * 1400;
                _wahQ = 1 + V("res") * 12;
                break;
            case "chorus":
                _chorusLfo!.FrequencyHz = 0.1 + V("ritmo") * 4;
                _chorusBaseDelay = 0.008 + V("prof") * 0.02;
                _chorusDepth = V("prof") * 0.006;
                _chorusWet = V("mezcla"); _chorusDry = 1 - V("mezcla") * 0.5;
                break;
            case "phaser":
                _phaserLfo!.FrequencyHz = 0.1 + V("ritmo") * 3;
                _phaserDepth = 200 + V("prof") * 1200;
                _phaserWet = V("mezcla"); _phaserDry = 1 - V("mezcla") * 0.5;
                break;
            case "trem":
                _tremLfo!.FrequencyHz = 0.5 + V("ritmo") * 11;
                _tremBase = 1 - V("prof") / 2;
                _tremDepth = V("prof") / 2;
                break;
            case "delay":
                _delayTime = 0.05 + V("tiempo") * 0.85;
                _delayFeedback = V("repes") * 0.85;
                _delayWet = V("mezcla");
                break;
            default: // reverb
                _reverbWet = V("mezcla") * 1.4;
                _reverb!.SetSize(V("tamano"));
                break;
        }
    }

    public float Process(float x)
    {
        if (Bypass) return x;

        switch (Tipo)
        {
            case "comp":
                return _comp!.Process(x);

            case "boost":
                return _boostLp!.Process((float)(x * _boostGain));

            case "od":
            case "dist":
            case "fuzz":
            {
                float driven = WaveShaper.Shape((float)(x * _drPreGain), _drAmount, _drHardness);
                float toned = _drTono!.Process(driven);
                return (float)(toned * _drLevel);
            }

            case "eq":
                return _eqHigh!.Process(_eqMid!.Process(_eqLow!.Process(x)));

            case "wah":
            {
                float lfo = _wahLfo!.Next();
                double freq = Math.Clamp(_wahBaseFreq + lfo * _wahDepth, 80, _sampleRate * 0.45);
                _wahBp!.Configure(BiquadType.BandPass, freq, _wahQ);
                return _wahBp.Process(x);
            }

            case "chorus":
            {
                float lfo = _chorusLfo!.Next();
                double delaySeconds = Math.Max(0.001, _chorusBaseDelay + lfo * _chorusDepth);
                _chorusDelay!.Write(x);
                float delayed = _chorusDelay.Read(delaySeconds);
                return (float)(x * _chorusDry + delayed * _chorusWet);
            }

            case "phaser":
            {
                float lfo = _phaserLfo!.Next();
                double freqMod = lfo * _phaserDepth;
                float wet = x;
                for (int i = 0; i < _phaserAps!.Length; i++)
                {
                    double f = Math.Clamp(400 + i * 350 + freqMod, 40, _sampleRate * 0.45);
                    _phaserAps[i].Configure(BiquadType.AllPass, f, 0.7);
                    wet = _phaserAps[i].Process(wet);
                }
                return (float)(x * _phaserDry + wet * _phaserWet);
            }

            case "trem":
            {
                float lfo = _tremLfo!.Next();
                double gain = _tremBase + _tremDepth * lfo;
                return (float)(x * gain);
            }

            case "delay":
            {
                float echo = _delayLine!.ProcessFeedback(x, _delayTime, _delayFeedback);
                return (float)(x * 1.0 + echo * _delayWet);
            }

            default: // reverb
            {
                float wet = _reverb!.Process(x);
                return (float)(x * 1.0 + wet * _reverbWet);
            }
        }
    }
}
