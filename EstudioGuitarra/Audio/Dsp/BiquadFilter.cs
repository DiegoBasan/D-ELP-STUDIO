using System;

namespace EstudioGuitarra.Audio.Dsp;

public enum BiquadType
{
    LowPass,
    HighPass,
    BandPass,
    LowShelf,
    HighShelf,
    Peaking,
    AllPass
}

/// <summary>
/// Filtro biquad de forma directa II, coeficientes RBJ (Audio EQ Cookbook).
/// Equivalente a los BiquadFilterNode que usaba el motor original en Web Audio API.
/// </summary>
public sealed class BiquadFilter
{
    private double _b0, _b1, _b2, _a1, _a2;
    private double _z1, _z2;

    public BiquadType Type { get; private set; } = BiquadType.LowPass;
    public double Frequency { get; private set; } = 1000;
    public double Q { get; private set; } = 0.707;
    public double GainDb { get; private set; } = 0;
    public int SampleRate { get; private set; } = 48000;

    public BiquadFilter(int sampleRate = 48000)
    {
        SampleRate = sampleRate;
        Recalculate(BiquadType.LowPass, 1000, 0.707, 0);
    }

    public void SetSampleRate(int sampleRate)
    {
        SampleRate = sampleRate;
        Recalculate(Type, Frequency, Q, GainDb);
    }

    public void Configure(BiquadType type, double frequency, double q, double gainDb = 0)
    {
        // Evita recalcular coeficientes si nada cambio (se llama a menudo desde los sliders)
        if (type == Type && Math.Abs(frequency - Frequency) < 0.01 && Math.Abs(q - Q) < 0.0001 && Math.Abs(gainDb - GainDb) < 0.001)
            return;
        Recalculate(type, frequency, q, gainDb);
    }

    private void Recalculate(BiquadType type, double frequency, double q, double gainDb)
    {
        Type = type;
        Frequency = Math.Clamp(frequency, 10, SampleRate * 0.49);
        Q = Math.Max(0.0001, q);
        GainDb = gainDb;

        double a0;
        double w0 = 2 * Math.PI * Frequency / SampleRate;
        double cosw0 = Math.Cos(w0);
        double sinw0 = Math.Sin(w0);
        double alpha = sinw0 / (2 * Q);
        double A = Math.Pow(10, gainDb / 40.0);

        switch (type)
        {
            case BiquadType.LowPass:
                _b0 = (1 - cosw0) / 2; _b1 = 1 - cosw0; _b2 = (1 - cosw0) / 2;
                a0 = 1 + alpha; _a1 = -2 * cosw0; _a2 = 1 - alpha;
                break;
            case BiquadType.HighPass:
                _b0 = (1 + cosw0) / 2; _b1 = -(1 + cosw0); _b2 = (1 + cosw0) / 2;
                a0 = 1 + alpha; _a1 = -2 * cosw0; _a2 = 1 - alpha;
                break;
            case BiquadType.BandPass:
                _b0 = alpha; _b1 = 0; _b2 = -alpha;
                a0 = 1 + alpha; _a1 = -2 * cosw0; _a2 = 1 - alpha;
                break;
            case BiquadType.LowShelf:
            {
                double twoSqrtAalpha = 2 * Math.Sqrt(A) * alpha;
                _b0 = A * ((A + 1) - (A - 1) * cosw0 + twoSqrtAalpha);
                _b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
                _b2 = A * ((A + 1) - (A - 1) * cosw0 - twoSqrtAalpha);
                a0 = (A + 1) + (A - 1) * cosw0 + twoSqrtAalpha;
                _a1 = -2 * ((A - 1) + (A + 1) * cosw0);
                _a2 = (A + 1) + (A - 1) * cosw0 - twoSqrtAalpha;
                break;
            }
            case BiquadType.HighShelf:
            {
                double twoSqrtAalpha = 2 * Math.Sqrt(A) * alpha;
                _b0 = A * ((A + 1) + (A - 1) * cosw0 + twoSqrtAalpha);
                _b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
                _b2 = A * ((A + 1) + (A - 1) * cosw0 - twoSqrtAalpha);
                a0 = (A + 1) - (A - 1) * cosw0 + twoSqrtAalpha;
                _a1 = 2 * ((A - 1) - (A + 1) * cosw0);
                _a2 = (A + 1) - (A - 1) * cosw0 - twoSqrtAalpha;
                break;
            }
            case BiquadType.Peaking:
                _b0 = 1 + alpha * A; _b1 = -2 * cosw0; _b2 = 1 - alpha * A;
                a0 = 1 + alpha / A; _a1 = -2 * cosw0; _a2 = 1 - alpha / A;
                break;
            case BiquadType.AllPass:
            default:
                _b0 = 1 - alpha; _b1 = -2 * cosw0; _b2 = 1 + alpha;
                a0 = 1 + alpha; _a1 = -2 * cosw0; _a2 = 1 - alpha;
                break;
        }

        _b0 /= a0; _b1 /= a0; _b2 /= a0; _a1 /= a0; _a2 /= a0;
    }

    public float Process(float x)
    {
        // Transposed Direct Form II
        double y = _b0 * x + _z1;
        _z1 = _b1 * x - _a1 * y + _z2;
        _z2 = _b2 * x - _a2 * y;
        return (float)y;
    }

    public void Reset()
    {
        _z1 = 0; _z2 = 0;
    }
}
