namespace EstudioGuitarra.Audio.Dsp;

/// <summary>
/// Etapa de salida de la cadena: solo ganancia/volumen, nada de saturacion, EQ, cabina,
/// delay ni reverb. Esas coloraciones ya las aportan los pedales de la pedalera (que
/// pueden encadenarse en cualquier orden); tener un "amplificador" con su propio drive/EQ
/// encima solo duplicaba controles y confundia (parecia que no hacia nada si no se
/// prendia primero). Aqui el "amplificador" es literalmente el fader de salida.
/// </summary>
public sealed class OutputStage
{
    public double Vol { get; private set; } = 70;

    public void SetVolumen(double vol) => Vol = vol;

    public float Process(float x) => (float)(x * (Vol / 100.0) * 0.9);
}
