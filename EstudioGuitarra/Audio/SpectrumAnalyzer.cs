using System;
using EstudioGuitarra.Audio.Dsp;

namespace EstudioGuitarra.Audio;

/// <summary>
/// Analizador de espectro en banda de frecuencias, calculado con un banco de filtros
/// pasa-banda + seguidor de envolvente (en vez de una FFT), pensado para alimentar el
/// espectrograma de la interfaz. Es necesario porque la senal en vivo ya no pasa por el
/// motor de audio del navegador (por eso ya no hay AnalyserNode disponible en JS): esta
/// clase corre dentro del propio motor en C# sobre la senal real que suena.
/// </summary>
public sealed class SpectrumAnalyzer
{
    private readonly BiquadFilter[] _bandas;
    private readonly double[] _frecuencias;
    private readonly double[] _envolvente;
    private readonly object _lock = new();

    public SpectrumAnalyzer(int sampleRate, int bandas = 32, double fMin = 60, double fMax = 8000)
    {
        _bandas = new BiquadFilter[bandas];
        _frecuencias = new double[bandas];
        _envolvente = new double[bandas];

        double lMin = Math.Log(fMin), lMax = Math.Log(fMax);
        for (int i = 0; i < bandas; i++)
        {
            double t = bandas == 1 ? 0 : (double)i / (bandas - 1);
            double freq = Math.Exp(lMin + (lMax - lMin) * t);
            _frecuencias[i] = freq;
            var f = new BiquadFilter(sampleRate);
            f.Configure(BiquadType.BandPass, freq, 4.0);
            _bandas[i] = f;
        }
    }

    public void ProcessBlock(ReadOnlySpan<float> buffer)
    {
        lock (_lock)
        {
            for (int b = 0; b < _bandas.Length; b++)
            {
                double sum = 0;
                for (int i = 0; i < buffer.Length; i++)
                {
                    float y = _bandas[b].Process(buffer[i]);
                    sum += (double)y * y;
                }
                double rms = buffer.Length > 0 ? Math.Sqrt(sum / buffer.Length) : 0;
                double nivel = Math.Clamp(rms * 6, 0, 1);
                // decaimiento suave para que se vea como un analizador, no un parpadeo
                _envolvente[b] = Math.Max(nivel, _envolvente[b] * 0.85);
            }
        }
    }

    public (double[] Frecuencias, double[] Niveles) Read()
    {
        lock (_lock) return (_frecuencias, (double[])_envolvente.Clone());
    }
}
