using System;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>
/// Simulador de amplificador: pre-ganancia + saturacion + EQ de 3 bandas + filtro de gabinete
/// + delay + reverb, replicando buildAmp()/setAmpParams() del motor Web Audio original.
/// </summary>
public sealed class AmpSimulator
{
    private readonly BiquadFilter _fBass;
    private readonly BiquadFilter _fMid;
    private readonly BiquadFilter _fTre;
    private readonly BiquadFilter _cab;
    private readonly DelayLine _delay;
    private readonly SchroederReverb _reverb;

    private double _preGain = 0.6;
    private double _driveAmount;
    private double _wetDelay;
    private double _wetReverb;
    private double _outGain;

    public bool AmpOn { get; set; }
    public double Gain { get; private set; } = 12;
    public double Bass { get; private set; } = 55;
    public double Mid { get; private set; } = 50;
    public double Treble { get; private set; } = 60;
    public double Reverb { get; private set; } = 22;
    public double Delay { get; private set; } = 8;
    public double Vol { get; private set; } = 70;

    private const double DelayTimeSeconds = 0.28;
    private const double DelayFeedback = 0.26;

    public AmpSimulator(int sampleRate)
    {
        _fBass = new BiquadFilter(sampleRate);
        _fMid = new BiquadFilter(sampleRate);
        _fTre = new BiquadFilter(sampleRate);
        _cab = new BiquadFilter(sampleRate);
        _delay = new DelayLine(sampleRate, DelayTimeSeconds + 0.05);
        _reverb = new SchroederReverb(sampleRate);
        Recalculate();
    }

    private static double Db(double v) => (v - 50) / 50 * 12;

    public void SetParams(double gain, double bass, double mid, double treble, double reverb, double delay, double vol)
    {
        Gain = gain; Bass = bass; Mid = mid; Treble = treble; Reverb = reverb; Delay = delay; Vol = vol;
        Recalculate();
    }

    private void Recalculate()
    {
        _preGain = 0.6 + (Gain / 100) * 5;
        _driveAmount = Gain / 100;
        _fBass.Configure(BiquadType.LowShelf, 180, 0.707, Db(Bass));
        _fMid.Configure(BiquadType.Peaking, 800, 0.9, Db(Mid));
        _fTre.Configure(BiquadType.HighShelf, 3200, 0.707, Db(Treble));
        _cab.Configure(BiquadType.LowPass, 5200, 0.707);
        _wetDelay = (Delay / 100) * 0.8;
        _wetReverb = (Reverb / 100) * 0.9;
        _reverb.SetSize(0.55);
        _outGain = AmpOn ? (Vol / 100) * 0.9 : 0;
    }

    public float Process(float x)
    {
        if (_outGain <= 0) return 0f;

        float pre = (float)(x * _preGain);
        float shaped = WaveShaper.Shape(pre, _driveAmount, 90);
        float eq = _fTre.Process(_fMid.Process(_fBass.Process(shaped)));
        float cabOut = _cab.Process(eq);

        float dry = cabOut;
        float echo = _delay.ProcessFeedback(cabOut, DelayTimeSeconds, DelayFeedback);
        float verb = _reverb.Process(cabOut);

        float mix = dry + echo * (float)_wetDelay + verb * (float)_wetReverb;
        return (float)(mix * _outGain);
    }
}
