using System.Collections.Generic;
using System.Linq;

namespace EstudioGuitarra.Audio.Dsp;

/// <summary>
/// Cadena de senal en vivo: guitarra -> pedal 1 -> pedal 2 -> ... -> amplificador.
/// El original permitia cablear la pedalera como un grafo arbitrario (patchbay), pero en la
/// practica se construye siempre como una cadena serie (anadirPedal la inserta al final,
/// autoCablear/aplicarCombo la reconstruyen en orden). Esta clase modela esa cadena serie,
/// que es lo que realmente importa para el sonido: orden de pedales + ampli al final.
/// </summary>
public sealed class SignalChain
{
    private readonly int _sampleRate;
    private readonly Dictionary<string, Pedal> _pedales = new();
    private readonly List<string> _orden = new();

    public OutputStage Salida { get; }

    public SignalChain(int sampleRate)
    {
        _sampleRate = sampleRate;
        Salida = new OutputStage();
    }

    public Pedal AddPedal(string id, string tipo)
    {
        var pedal = new Pedal(id, tipo, _sampleRate);
        _pedales[id] = pedal;
        _orden.Add(id);
        return pedal;
    }

    public void RemovePedal(string id)
    {
        _pedales.Remove(id);
        _orden.Remove(id);
    }

    public void SetPedalParam(string id, string param, double value)
    {
        if (_pedales.TryGetValue(id, out var p)) p.SetParam(param, value);
    }

    public void SetPedalBypass(string id, bool bypass)
    {
        if (_pedales.TryGetValue(id, out var p)) p.Bypass = bypass;
    }

    /// <summary>Reordena la cadena (lista de ids de pedal en orden de senal, sin incluir el ampli).</summary>
    public void Reorder(IEnumerable<string> ids)
    {
        var nuevos = ids.Where(_pedales.ContainsKey).ToList();
        // conserva al final cualquier pedal que no vino en la lista, para no perderlo de la cadena
        foreach (var id in _orden)
            if (!nuevos.Contains(id)) nuevos.Add(id);
        _orden.Clear();
        _orden.AddRange(nuevos);
    }

    public void Clear()
    {
        _pedales.Clear();
        _orden.Clear();
    }

    public float Process(float x)
    {
        float signal = x;
        foreach (var id in _orden)
            if (_pedales.TryGetValue(id, out var p))
                signal = p.Process(signal);
        return Salida.Process(signal);
    }
}
