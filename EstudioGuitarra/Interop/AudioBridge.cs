using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;
using EstudioGuitarra.Audio;

namespace EstudioGuitarra.Interop;

/// <summary>
/// Objeto host expuesto a JavaScript via CoreWebView2.AddHostObjectToScript("audio", ...).
/// Desde la pagina se llama como:
///   await chrome.webview.hostObjects.audio.SetAmpOn(true)
/// Todas las llamadas desde JS son asincronas (devuelven una Promise) aunque el metodo de C#
/// sea sincrono; por eso aqui no hace falta async/await salvo donde el propio trabajo lo pida.
/// Los tipos complejos (listas, diccionarios) se pasan como JSON en vez de objetos COM, que es
/// mucho mas fiable a traves del marshaling de host objects de WebView2.
/// </summary>
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public sealed class AudioBridge
{
    private readonly AudioEngine _engine;

    public AudioBridge(AudioEngine engine)
    {
        _engine = engine;
    }

    // ---------- dispositivos / conexion ----------

    public string ListarEntradas()
        => JsonSerializer.Serialize(_engine.ListCaptureDevices());

    public string ListarSalidas()
        => JsonSerializer.Serialize(_engine.ListRenderDevices());

    /// <summary>id vacio o null = dispositivo por defecto del sistema.</summary>
    public bool Conectar(string? captureId, string? renderId)
        => _engine.Connect(string.IsNullOrEmpty(captureId) ? null : captureId,
                            string.IsNullOrEmpty(renderId) ? null : renderId);

    public void Desconectar() => _engine.Disconnect();

    public bool EstaConectado() => _engine.IsConnected;

    public double LatenciaMs() => _engine.EstimatedLatencyMs;

    public void SetBajaLatencia(bool activo) => _engine.SetBajaLatencia(activo);

    public void SetA4(double hz) => _engine.A4 = hz;

    // ---------- amplificador ----------

    public void SetAmpOn(bool on) => _engine.SetAmpOn(on);

    public void SetAmpParams(double gain, double bass, double mid, double treble, double reverb, double delay, double vol)
        => _engine.SetAmpParams(gain, bass, mid, treble, reverb, delay, vol);

    // ---------- pedalera ----------

    /// <summary>parametrosJson: objeto plano {"clave": valor0a100, ...} con los mandos iniciales del pedal.</summary>
    public void AddPedal(string id, string tipo, string parametrosJson)
    {
        var parametros = string.IsNullOrEmpty(parametrosJson)
            ? new Dictionary<string, double>()
            : JsonSerializer.Deserialize<Dictionary<string, double>>(parametrosJson) ?? new();
        _engine.AddPedal(id, tipo, parametros);
    }

    public void RemovePedal(string id) => _engine.RemovePedal(id);

    public void SetPedalParam(string id, string param, double valor) => _engine.SetPedalParam(id, param, valor);

    public void SetPedalBypass(string id, bool bypass) => _engine.SetPedalBypass(id, bypass);

    /// <summary>idsJson: array de ids de pedal en orden de senal, ej. ["p1","p2","p3"].</summary>
    public void ReorderChain(string idsJson)
    {
        var ids = string.IsNullOrEmpty(idsJson)
            ? new List<string>()
            : JsonSerializer.Deserialize<List<string>>(idsJson) ?? new();
        _engine.ReorderChain(ids);
    }

    public void ClearPedales() => _engine.ClearPedales();

    // ---------- afinador / medidor ----------

    public string GetTuner()
    {
        var t = _engine.GetTuner();
        return JsonSerializer.Serialize(new { freq = t.FrequencyHz, nota = t.Nota, cents = t.Cents, haySenal = t.HaySenal });
    }

    public string GetMeter()
    {
        var m = _engine.GetMeter();
        return JsonSerializer.Serialize(new { nivel = m.Nivel, pico = m.Pico, clip = m.Clip });
    }

    /// <summary>Bandas del analizador de espectro (post pedalera+ampli), para dibujar el
    /// espectrograma en la pagina sin depender de un AnalyserNode del navegador.</summary>
    public string GetSpectrum()
    {
        var (frecuencias, niveles) = _engine.GetSpectrum();
        return JsonSerializer.Serialize(new { frecuencias, niveles });
    }

    // ---------- grabacion para el looper ----------

    public void StartRecording() => _engine.StartRecording();

    /// <summary>Devuelve el WAV grabado (senal procesada por pedalera+ampli) como base64 para que
    /// la pagina lo decodifique con decodeAudioData y lo coloque en la linea de tiempo.</summary>
    public string StopRecordingWavBase64()
    {
        var bytes = _engine.StopRecordingAndReadWav();
        return Convert.ToBase64String(bytes);
    }
}
