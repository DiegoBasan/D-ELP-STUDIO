using System;

namespace EstudioGuitarra.Audio;

public readonly struct MeterReading
{
    public readonly double Nivel;   // 0..1
    public readonly double Pico;    // 0..1, con decay
    public readonly bool Clip;

    public MeterReading(double nivel, double pico, bool clip)
    {
        Nivel = nivel; Pico = pico; Clip = clip;
    }
}

/// <summary>
/// Medidor de nivel RMS/pico con decay del pico, igual criterio que arrancarMedidor() del
/// motor original (ventana de analisis, mapeo de dB a 0..1, umbral de clip).
/// </summary>
public sealed class LevelMeter
{
    private double _picoDecay;
    private readonly object _lock = new();
    private double _nivel;
    private double _pico;
    private bool _clip;

    /// <summary>Procesa un bloque de muestras capturado en un callback de audio.</summary>
    public void ProcessBlock(ReadOnlySpan<float> buffer)
    {
        double sum = 0, peak = 0;
        for (int i = 0; i < buffer.Length; i++)
        {
            float v = buffer[i];
            sum += (double)v * v;
            double av = Math.Abs(v);
            if (av > peak) peak = av;
        }
        if (buffer.Length == 0) return;

        double db = 20 * Math.Log10(Math.Max(Math.Sqrt(sum / buffer.Length), 1e-6));
        double nivel = Math.Clamp((db + 60) / 60, 0, 1);

        lock (_lock)
        {
            _picoDecay = Math.Max(nivel, _picoDecay - 0.012);
            _nivel = nivel;
            _pico = _picoDecay;
            _clip = peak > 0.985;
        }
    }

    public MeterReading Read()
    {
        lock (_lock) return new MeterReading(_nivel, _pico, _clip);
    }
}
