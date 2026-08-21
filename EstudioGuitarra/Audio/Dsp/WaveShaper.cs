using System;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>
/// Waveshaper de saturacion, misma formula que el motor original
/// (funcion curva(amount, k2) generada como WaveShaperNode.curve), pero evaluada
/// analiticamente muestra a muestra en vez de con una tabla precalculada.
/// </summary>
public static class WaveShaper
{
    public static float Shape(float x, double amount, double k2 = 90)
    {
        double k = 1 + amount * k2;
        double ax = Math.Abs(x);
        return (float)((1 + k) * x / (1 + k * ax));
    }
}
