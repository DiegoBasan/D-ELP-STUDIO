using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using EstudioGuitarra.Audio.Dsp;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace EstudioGuitarra.Audio;

public sealed record DeviceInfo(string Id, string Nombre);

/// <summary>
/// Motor de audio en vivo: captura por WASAPI, procesa la cadena guitarra -> pedalera -> ampli
/// muestra a muestra en C#, y renderiza directo a la salida por WASAPI, sin pasar por el motor
/// de audio del navegador. Esto es lo que elimina la latencia de ida y vuelta de Chrome/WebView:
/// el camino en vivo nunca toca el proceso de renderizado ni el hilo de UI.
/// </summary>
public sealed class AudioEngine : IDisposable
{
    private WasapiCapture? _capture;
    private WasapiOut? _output;
    private BufferedWaveProvider? _outputBuffer;
    private MMDevice? _renderDevice;
    private string? _captureDeviceId;
    private string? _renderDeviceId;

    private readonly object _chainLock = new();
    private SignalChain? _chain;
    private PitchDetector? _tuner;
    private SpectrumAnalyzer? _spectrum;
    private readonly LevelMeter _meter = new();

    private int _sampleRate = 48000;
    private int _outChannels = 2;
    private bool _bajaLatencia = true;
    private int _captureBufferMs = 10;
    private int _outputLatencyMs = 10;

    private readonly object _recLock = new();
    private WaveFileWriter? _recordWriter;
    private string? _recordPath;

    public bool IsConnected => _capture != null;
    public double A4 { get; set; } = 440;

    /// <summary>"exclusivo" (WASAPI toma el dispositivo por su cuenta, la latencia real de
    /// ida y vuelta suele quedar en unos pocos milisegundos) o "compartido" (pasa por el
    /// mezclador de Windows, mas compatible pero con mas latencia real de la que sugieren
    /// los tamaños de buffer). Util para que la interfaz le diga al usuario cual se logro.</summary>
    public string ModoConexion { get; private set; } = "sin conectar";

    // ---------- dispositivos ----------

    public IReadOnlyList<DeviceInfo> ListCaptureDevices()
    {
        using var enumerator = new MMDeviceEnumerator();
        return enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)
            .Select(d => new DeviceInfo(d.ID, d.FriendlyName))
            .ToList();
    }

    public IReadOnlyList<DeviceInfo> ListRenderDevices()
    {
        using var enumerator = new MMDeviceEnumerator();
        return enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
            .Select(d => new DeviceInfo(d.ID, d.FriendlyName))
            .ToList();
    }

    public void SetBajaLatencia(bool activo)
    {
        if (_bajaLatencia == activo) return;
        _bajaLatencia = activo;
        if (IsConnected) Reconnect();
    }

    // ---------- conexion ----------

    public bool Connect(string? captureDeviceId, string? renderDeviceId)
    {
        Disconnect();

        using var enumerator = new MMDeviceEnumerator();
        MMDevice captureDevice = string.IsNullOrEmpty(captureDeviceId)
            ? enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications)
            : enumerator.GetDevice(captureDeviceId);
        MMDevice renderDevice = string.IsNullOrEmpty(renderDeviceId)
            ? enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)
            : enumerator.GetDevice(renderDeviceId);

        _renderDevice = renderDevice;
        _captureDeviceId = captureDevice.ID;
        _renderDeviceId = renderDevice.ID;

        // Primero se intenta modo exclusivo (WASAPI le entrega el dispositivo entero a esta app,
        // sin pasar por el mezclador/motor de audio compartido de Windows: ahi es donde suele
        // esconderse la latencia real que no se ve en los tamaños de buffer que pedimos). Si el
        // hardware/driver no lo soporta (pasa con algunos Bluetooth, USB compuestos o políticas
        // de empresa), se cae automaticamente a modo compartido, que es lo que ya funcionaba.
        if (_bajaLatencia && TryConectar(captureDevice, renderDevice, exclusivo: true))
        {
            ModoConexion = "exclusivo";
            return true;
        }
        if (TryConectar(captureDevice, renderDevice, exclusivo: false))
        {
            ModoConexion = "compartido";
            return true;
        }
        ModoConexion = "sin conectar";
        return false;
    }

    private bool TryConectar(MMDevice captureDevice, MMDevice renderDevice, bool exclusivo)
    {
        _captureBufferMs = exclusivo ? 3 : (_bajaLatencia ? 6 : 20);
        _outputLatencyMs = exclusivo ? 3 : (_bajaLatencia ? 10 : 30);

        try
        {
            _capture = new WasapiCapture(captureDevice, true, _captureBufferMs);
            if (exclusivo)
            {
                // En modo exclusivo el driver casi nunca acepta el formato float del mezclador
                // compartido; se pide PCM entero a la misma frecuencia/canales que ya usa el
                // dispositivo, que es el formato "nativo" que casi todo hardware acepta.
                var mix = captureDevice.AudioClient.MixFormat;
                _capture.ShareMode = AudioClientShareMode.Exclusive;
                _capture.WaveFormat = new WaveFormat(mix.SampleRate, 16, Math.Max(1, mix.Channels));
            }

            _sampleRate = _capture.WaveFormat.SampleRate;
            _outChannels = Math.Max(1, renderDevice.AudioClient.MixFormat.Channels);

            lock (_chainLock)
            {
                _chain = new SignalChain(_sampleRate);
                _tuner = new PitchDetector(_sampleRate, A4);
                _spectrum = new SpectrumAnalyzer(_sampleRate);
            }

            var outFormat = WaveFormat.CreateIeeeFloatWaveFormat(_sampleRate, _outChannels);
            _outputBuffer = new BufferedWaveProvider(outFormat)
            {
                DiscardOnBufferOverflow = true,
                BufferDuration = TimeSpan.FromMilliseconds(Math.Max(200, _outputLatencyMs * 6))
            };

            // WasapiOut ya sabe negociar el formato/alineacion de buffer en modo exclusivo y
            // convertir sobre la marcha si hace falta, asi que aqui no hay que adivinar nada.
            _output = new WasapiOut(renderDevice, exclusivo ? AudioClientShareMode.Exclusive : AudioClientShareMode.Shared, true, _outputLatencyMs);
            _output.Init(_outputBuffer);

            _capture.DataAvailable += OnDataAvailable;
            _capture.StartRecording();
            _output.Play();
            return true;
        }
        catch
        {
            LimpiarRecursos();
            return false;
        }
    }

    private void Reconnect()
    {
        var captureId = _captureDeviceId;
        var renderId = _renderDeviceId;
        Disconnect();
        Connect(captureId, renderId);
    }

    public void Disconnect()
    {
        LimpiarRecursos();
        ModoConexion = "sin conectar";
        StopRecordingInternal();
    }

    private void LimpiarRecursos()
    {
        try { _capture?.StopRecording(); } catch { /* ya detenido */ }
        if (_capture != null) _capture.DataAvailable -= OnDataAvailable;
        _capture?.Dispose();
        _capture = null;

        try { _output?.Stop(); } catch { /* ya detenido */ }
        _output?.Dispose();
        _output = null;
        _outputBuffer = null;
    }

    public double EstimatedLatencyMs => IsConnected ? _captureBufferMs + _outputLatencyMs : 0;

    // ---------- captura -> proceso -> salida ----------

    private float[] _monoScratch = Array.Empty<float>();
    private float[] _outScratch = Array.Empty<float>();
    private float[] _processedScratch = Array.Empty<float>();

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        var capture = _capture;
        var outputBuffer = _outputBuffer;
        var chain = _chain;
        var tuner = _tuner;
        if (capture == null || outputBuffer == null || chain == null) return;

        int bytesPerSample = capture.WaveFormat.BitsPerSample / 8;
        int channels = capture.WaveFormat.Channels;
        int frames = e.BytesRecorded / (bytesPerSample * channels);
        if (frames <= 0) return;

        if (_monoScratch.Length < frames) _monoScratch = new float[frames];
        if (_outScratch.Length < frames * _outChannels) _outScratch = new float[frames * _outChannels];
        if (_processedScratch.Length < frames) _processedScratch = new float[frames];

        bool isFloat = capture.WaveFormat.Encoding == WaveFormatEncoding.IeeeFloat && bytesPerSample == 4;

        for (int i = 0; i < frames; i++)
        {
            double sum = 0;
            int baseIdx = i * channels * bytesPerSample;
            for (int ch = 0; ch < channels; ch++)
            {
                int off = baseIdx + ch * bytesPerSample;
                float s = isFloat
                    ? BitConverter.ToSingle(e.Buffer, off)
                    : BitConverter.ToInt16(e.Buffer, off) / 32768f;
                sum += s;
            }
            _monoScratch[i] = (float)(sum / channels);
        }

        var rawSpan = new ReadOnlySpan<float>(_monoScratch, 0, frames);
        _meter.ProcessBlock(rawSpan);

        lock (_chainLock)
        {
            var writer = GetActiveRecordWriter();
            for (int i = 0; i < frames; i++)
            {
                float raw = _monoScratch[i];
                tuner?.Write(raw);
                float processed = chain.Process(raw);
                writer?.WriteSample(processed);
                _processedScratch[i] = processed;
                int baseOut = i * _outChannels;
                for (int ch = 0; ch < _outChannels; ch++)
                    _outScratch[baseOut + ch] = processed;
            }
            _spectrum?.ProcessBlock(new ReadOnlySpan<float>(_processedScratch, 0, frames));
        }

        var outSpan = new ReadOnlySpan<float>(_outScratch, 0, frames * _outChannels);
        var bytes = MemoryMarshal.AsBytes(outSpan);
        outputBuffer.AddSamples(bytes.ToArray(), 0, bytes.Length);
    }

    // ---------- pedalera / ampli ----------

    public void AddPedal(string id, string tipo, IReadOnlyDictionary<string, double> parametros)
    {
        lock (_chainLock)
        {
            if (_chain == null) return;
            var pedal = _chain.AddPedal(id, tipo);
            pedal.SetParams(parametros);
        }
    }

    public void RemovePedal(string id)
    {
        lock (_chainLock) { _chain?.RemovePedal(id); }
    }

    public void SetPedalParam(string id, string param, double valor)
    {
        lock (_chainLock) { _chain?.SetPedalParam(id, param, valor); }
    }

    public void SetPedalBypass(string id, bool bypass)
    {
        lock (_chainLock) { _chain?.SetPedalBypass(id, bypass); }
    }

    public void ReorderChain(IEnumerable<string> ids)
    {
        lock (_chainLock) { _chain?.Reorder(ids); }
    }

    public void ClearPedales()
    {
        lock (_chainLock) { _chain?.Clear(); }
    }

    public void SetVolumenSalida(double vol)
    {
        lock (_chainLock) { _chain?.Salida.SetVolumen(vol); }
    }

    // ---------- afinador / medidor ----------

    public TunerReading GetTuner() => _tuner?.Detect() ?? new TunerReading(0, "—", 0, false);

    public MeterReading GetMeter() => _meter.Read();

    public (double[] Frecuencias, double[] Niveles) GetSpectrum()
        => _spectrum?.Read() ?? (Array.Empty<double>(), Array.Empty<double>());

    // ---------- grabacion (para el looper de la interfaz) ----------

    public void StartRecording()
    {
        lock (_recLock)
        {
            StopRecordingInternal();
            _recordPath = Path.Combine(Path.GetTempPath(), $"eg_rec_{Guid.NewGuid():N}.wav");
            _recordWriter = new WaveFileWriter(_recordPath, WaveFormat.CreateIeeeFloatWaveFormat(_sampleRate, 1));
        }
    }

    private WaveFileWriter? GetActiveRecordWriter()
    {
        lock (_recLock) return _recordWriter;
    }

    public byte[] StopRecordingAndReadWav()
    {
        lock (_recLock)
        {
            StopRecordingInternal();
            if (_recordPath != null && File.Exists(_recordPath))
            {
                var bytes = File.ReadAllBytes(_recordPath);
                try { File.Delete(_recordPath); } catch { /* limpieza best-effort */ }
                _recordPath = null;
                return bytes;
            }
            return Array.Empty<byte>();
        }
    }

    private void StopRecordingInternal()
    {
        try { _recordWriter?.Flush(); _recordWriter?.Dispose(); } catch { /* ya cerrado */ }
        _recordWriter = null;
    }

    public void Dispose()
    {
        Disconnect();
    }
}
