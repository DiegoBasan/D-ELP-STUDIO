using System;

namespace EstudioGuitarra.Audio;

public readonly struct TunerReading
{
    public readonly double FrequencyHz;
    public readonly string Nota;
    public readonly int Cents;
    public readonly bool HaySenal;

    public TunerReading(double freq, string nota, int cents, bool haySenal)
    {
        FrequencyHz = freq; Nota = nota; Cents = cents; HaySenal = haySenal;
    }
}

/// <summary>
/// Detector de tono por autocorrelacion sobre la senal cruda de entrada (antes de pedalera/ampli),
/// igual algoritmo que el metodo detectar() del motor original: umbral de RMS, busqueda de mejor
/// lag entre 500 Hz y 60 Hz, y conversion a nota/cents con la referencia A4 configurable.
/// </summary>
public sealed class PitchDetector
{
    private static readonly string[] Notas = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };

    private readonly int _sampleRate;
    private readonly double _a4;
    private readonly float[] _ring;
    private readonly object _lock = new();
    private int _writePos;
    private int _filled;

    public PitchDetector(int sampleRate, double a4 = 440, int bufferSize = 2048)
    {
        _sampleRate = sampleRate;
        _a4 = a4;
        _ring = new float[bufferSize];
    }

    public void Write(float sample)
    {
        lock (_lock)
        {
            _ring[_writePos] = sample;
            _writePos = (_writePos + 1) % _ring.Length;
            if (_filled < _ring.Length) _filled++;
        }
    }

    public TunerReading Detect()
    {
        float[] buf = new float[_ring.Length];
        lock (_lock)
        {
            if (_filled < _ring.Length) return new TunerReading(0, "—", 0, false);
            for (int i = 0; i < _ring.Length; i++)
                buf[i] = _ring[(_writePos + i) % _ring.Length];
        }

        int n = buf.Length;
        double rms = 0;
        for (int i = 0; i < n; i++) rms += buf[i] * buf[i];
        rms = Math.Sqrt(rms / n);
        if (rms <= 0.008) return new TunerReading(0, "—", 0, false);

        int minLag = _sampleRate / 500;
        int maxLag = _sampleRate / 60;
        int best = -1;
        double bestCorr = 0;
        for (int lag = minLag; lag < maxLag && lag < n; lag++)
        {
            double c = 0;
            for (int i = 0; i < n - lag; i++) c += buf[i] * buf[i + lag];
            c /= (n - lag);
            if (c > bestCorr) { bestCorr = c; best = lag; }
        }

        if (best <= 0 || bestCorr <= 0.0005) return new TunerReading(0, "—", 0, false);

        double freq = (double)_sampleRate / best;
        double midi = 69 + 12 * Math.Log2(freq / _a4);
        int round = (int)Math.Round(midi);
        string nota = Notas[((round % 12) + 12) % 12];
        int cents = (int)Math.Round((midi - round) * 100);
        return new TunerReading(freq, nota, cents, true);
    }
}
