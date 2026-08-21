using System;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>Oscilador de baja frecuencia (seno) usado para wah automatico, chorus, phaser y tremolo.</summary>
public sealed class Lfo
{
    private double _phase;
    private readonly int _sampleRate;

    public double FrequencyHz { get; set; } = 1.0;

    public Lfo(int sampleRate)
    {
        _sampleRate = sampleRate;
    }

    /// <summary>Siguiente muestra, bipolar en el rango [-1, 1].</summary>
    public float Next()
    {
        double v = Math.Sin(_phase);
        _phase += 2 * Math.PI * FrequencyHz / _sampleRate;
        if (_phase > 2 * Math.PI) _phase -= 2 * Math.PI;
        return (float)v;
    }
}
