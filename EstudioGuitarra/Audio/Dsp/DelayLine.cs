using System;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>
/// Linea de retardo circular con lectura interpolada (para tiempos de delay modulados,
/// como en el chorus/phaser) y realimentacion opcional integrada, equivalente al
/// DelayNode + feedback GainNode que usaba el motor original.
/// </summary>
public sealed class DelayLine
{
    private readonly float[] _buffer;
    private readonly int _sampleRate;
    private int _writePos;

    public DelayLine(int sampleRate, double maxSeconds)
    {
        _sampleRate = sampleRate;
        _buffer = new float[Math.Max(2, (int)(sampleRate * maxSeconds) + 4)];
    }

    public void Write(float sample)
    {
        _buffer[_writePos] = sample;
        _writePos = (_writePos + 1) % _buffer.Length;
    }

    /// <summary>Lee con interpolacion lineal, delaySeconds hacia atras desde la posicion actual.</summary>
    public float Read(double delaySeconds)
    {
        double delaySamples = Math.Clamp(delaySeconds * _sampleRate, 0, _buffer.Length - 2);
        double readPos = _writePos - delaySamples;
        while (readPos < 0) readPos += _buffer.Length;

        // Salvaguarda: con delaySeconds cambiando en tiempo real (chorus/phaser modulados por LFO),
        // el redondeo de punto flotante puede dejar readPos infinitesimalmente negativo justo antes
        // de esta suma; al sumar _buffer.Length ese resto minúsculo se pierde por precision y readPos
        // puede terminar dando exactamente _buffer.Length (fuera de rango). Se recorta explicitamente.
        int i0 = Math.Clamp((int)readPos, 0, _buffer.Length - 1);
        int i1 = (i0 + 1) % _buffer.Length;
        double frac = Math.Clamp(readPos - i0, 0, 1);
        return (float)(_buffer[i0] * (1 - frac) + _buffer[i1] * frac);
    }

    /// <summary>Procesa un ciclo write+read con realimentacion: escribe entrada + eco*feedback, devuelve el eco leido.</summary>
    public float ProcessFeedback(float input, double delaySeconds, double feedback)
    {
        float echo = Read(delaySeconds);
        Write(input + echo * (float)feedback);
        return echo;
    }
}
