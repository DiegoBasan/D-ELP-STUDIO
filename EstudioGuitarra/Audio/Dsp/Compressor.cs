using System;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>Compresor feedforward simple, equivalente al DynamicsCompressorNode del motor original.</summary>
public sealed class Compressor
{
    private readonly int _sampleRate;
    private double _envelopeDb = -100;

    public double ThresholdDb { get; set; } = -24;
    public double Ratio { get; set; } = 4;
    public double AttackSeconds { get; set; } = 0.006;
    public double ReleaseSeconds { get; set; } = 0.18;
    public double MakeupGain { get; set; } = 1;

    public Compressor(int sampleRate)
    {
        _sampleRate = sampleRate;
    }

    public float Process(float x)
    {
        double inputDb = 20 * Math.Log10(Math.Max(Math.Abs(x), 1e-8));

        double coeff = inputDb > _envelopeDb
            ? Math.Exp(-1.0 / (_sampleRate * AttackSeconds))
            : Math.Exp(-1.0 / (_sampleRate * ReleaseSeconds));
        _envelopeDb = coeff * _envelopeDb + (1 - coeff) * inputDb;

        double gainReductionDb = 0;
        if (_envelopeDb > ThresholdDb)
            gainReductionDb = (ThresholdDb - _envelopeDb) * (1 - 1 / Ratio);

        double gain = Math.Pow(10, gainReductionDb / 20) * MakeupGain;
        return (float)(x * gain);
    }
}
