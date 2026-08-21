using System;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>
/// Reverb algoritmico (4 comb en paralelo + 2 allpass en serie, diseno Schroeder/Moorer).
/// El motor original usaba un ConvolverNode con un impulso de ruido generado en el momento;
/// aqui se sustituye por un algoritmo equivalente en caracter (cola difusa que decae) pero
/// mucho mas barato de procesar muestra a muestra en tiempo real, sin anadir latencia por FFT.
/// </summary>
public sealed class SchroederReverb
{
    private sealed class Comb
    {
        private readonly float[] _buf;
        private int _pos;
        public double Feedback;

        public Comb(int sampleRate, double delaySeconds)
        {
            _buf = new float[Math.Max(1, (int)(sampleRate * delaySeconds))];
        }

        public float Process(float x)
        {
            float y = _buf[_pos];
            _buf[_pos] = (float)(x + y * Feedback);
            _pos = (_pos + 1) % _buf.Length;
            return y;
        }
    }

    private sealed class AllPass
    {
        private readonly float[] _buf;
        private int _pos;
        private const double G = 0.5;

        public AllPass(int sampleRate, double delaySeconds)
        {
            _buf = new float[Math.Max(1, (int)(sampleRate * delaySeconds))];
        }

        public float Process(float x)
        {
            float bufOut = _buf[_pos];
            float y = (float)(-G * x + bufOut);
            _buf[_pos] = (float)(x + bufOut * G);
            _pos = (_pos + 1) % _buf.Length;
            return y;
        }
    }

    private readonly Comb[] _combs;
    private readonly AllPass[] _allpasses;

    private static readonly double[] CombDelays = { 0.0297, 0.0371, 0.0411, 0.0437 };
    private static readonly double[] AllPassDelays = { 0.005, 0.0017 };

    public SchroederReverb(int sampleRate)
    {
        _combs = new Comb[CombDelays.Length];
        for (int i = 0; i < CombDelays.Length; i++)
            _combs[i] = new Comb(sampleRate, CombDelays[i]);

        _allpasses = new AllPass[AllPassDelays.Length];
        for (int i = 0; i < AllPassDelays.Length; i++)
            _allpasses[i] = new AllPass(sampleRate, AllPassDelays[i]);

        SetSize(0.5);
    }

    /// <summary>0..1, mapea al "tamano" del panel (mas grande = cola mas larga).</summary>
    public void SetSize(double size01)
    {
        double fb = 0.7 + Math.Clamp(size01, 0, 1) * 0.28; // 0.70 .. 0.98
        foreach (var c in _combs) c.Feedback = fb;
    }

    public float Process(float x)
    {
        float sum = 0;
        foreach (var c in _combs) sum += c.Process(x);
        sum /= _combs.Length;
        foreach (var ap in _allpasses) sum = ap.Process(sum);
        return sum;
    }
}
