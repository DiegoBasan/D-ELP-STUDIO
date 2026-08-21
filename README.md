# Estudio de guitarra — version C# / WebView2

Version en escritorio (Windows) del prototipo `Estudio_de_Guitarra_v4.dc.html`,
pensada para eliminar la latencia de audio que tenia la version en Chrome/navegador.

## Por que existe esta version

En el navegador, la señal de guitarra tiene que pasar por: micrófono → SO →
motor de audio de Chrome → Web Audio API → salida del SO → altavoces/auriculares.
Cada una de esas capas añade latencia, y en Chrome esa cadena típicamente ronda
40-100+ ms — perceptible al tocar en vivo con pedalera/ampli simulado.

Aquí la cadena en vivo (**entrada de guitarra → pedalera → amplificador → salida**)
se procesa **enteramente en C#**, muestra a muestra, usando NAudio sobre WASAPI en
modo compartido, y nunca toca el motor de renderizado del navegador. El resultado
es una latencia de ida y vuelta de aproximadamente **15-25 ms** (configurable),
muy por debajo de lo que se conseguía en Chrome, sin depender de hardware con
drivers ASIO.

El resto de la aplicación (interfaz, metrónomo, banda de acompañamiento, looper
multipista, diapasón, acordes, YouTube) sigue siendo HTML/CSS/JS estándar,
mostrado dentro de un control **WebView2**, tal como se pidió: solo el
procesamiento de audio se movió a C#/Visual Studio.

## Estructura del proyecto

```
EstudioGuitarra.sln
EstudioGuitarra/
  EstudioGuitarra.csproj        proyecto WPF (.NET 8, Windows)
  App.xaml / MainWindow.xaml    ventana host con el control WebView2
  MainWindow.xaml.cs            arranca el motor de audio y lo expone a JS
  Audio/
    AudioEngine.cs              captura/render WASAPI (NAudio), hilo de audio
    PitchDetector.cs            afinador por autocorrelacion
    LevelMeter.cs                medidor de nivel/pico/clip
    SpectrumAnalyzer.cs          analizador de espectro (banco de pasa-banda)
    Dsp/
      BiquadFilter.cs            filtro biquad (RBJ cookbook)
      Lfo.cs, DelayLine.cs, WaveShaper.cs, Compressor.cs, SchroederReverb.cs
      Pedal.cs                   los 12 tipos de pedal (comp/boost/od/dist/fuzz/
                                  eq/wah/chorus/phaser/trem/delay/reverb)
      OutputStage.cs               etapa de salida: solo volumen (el tono lo dan los pedales)
      SignalChain.cs               encadena pedales + salida en orden
  Interop/
    AudioBridge.cs               objeto host expuesto a JS (chrome.webview.hostObjects.audio)
  wwwroot/
    index.html, styles.css, app.js   interfaz (reconstruida en HTML/CSS/JS estandar)
```

## Requisitos para compilar

- **Windows 10/11** (WPF y WASAPI son especificos de Windows; no compila en macOS/Linux).
- **Visual Studio 2022** (17.8+) con las cargas de trabajo:
  - ".NET desktop development" (para WPF)
- **.NET SDK**: el proyecto apunta a `net10.0-windows`. Si `dotnet --list-sdks` ya
  te muestra una versión 10.x (como pasa en equipos donde no puedes instalar
  nada sin IT), no necesitas instalar nada más. Si tu equipo solo tiene el
  SDK de .NET 8 instalado, cambia `<TargetFramework>net10.0-windows</TargetFramework>`
  por `<TargetFramework>net8.0-windows</TargetFramework>` en
  `EstudioGuitarra/EstudioGuitarra.csproj` — el código no usa nada específico
  de una versión u otra.
- **WebView2 Runtime** — ya viene preinstalado en Windows 10/11 actualizados
  (es el motor de Edge). Si falta, Visual Studio avisa y se descarga desde
  https://developer.microsoft.com/microsoft-edge/webview2/.
- Paquetes NuGet (se restauran solos al abrir/compilar en Visual Studio):
  `Microsoft.Web.WebView2`, `NAudio`.

> Nota: este proyecto se generó y revisó en un entorno Linux (sin Visual Studio
> disponible), por lo que el código no pudo compilarse aquí — WPF y WASAPI solo
> compilan en Windows. Se revisó manualmente la sintaxis y el uso de las APIs de
> NAudio/WebView2, pero conviene compilarlo y probarlo la primera vez con margen
> por si Visual Studio señala algún ajuste menor (versión exacta de paquete,
> etc.).

## Cómo abrir y ejecutar

1. Abre `EstudioGuitarra.sln` en Visual Studio.
2. Espera a que restaure los paquetes NuGet.
3. Compila y ejecuta (F5) en configuración `Debug | x64`.
4. En la ventana, pulsa **«Conectar entrada»** para que el motor abra el
   micrófono/interfaz de audio por defecto de Windows y arranque el render
   por WASAPI. El badge de la cabecera y el indicador de **Latencia** se
   actualizan solos.
5. Activa el **amplificador** y añade pedales desde la pestaña **Pedalera**
   del panel inferior: todo lo que ajustes ahí (perillas, presets, combos,
   orden de la cadena) se envía en tiempo real al motor en C#.
6. Los selectores junto a «Conectar entrada» eligen dispositivo de entrada
   y salida (o «por defecto» para dejar que el sistema decida).

## Arreglo multipista (estilo Logic Pro)

- **Pistas de audio**: cada grabación/importación se agrega como una
  **región** independiente (no se sobrescribe lo anterior). Arrastra una
  región para moverla en el tiempo, tira de sus bordes para recortarla
  (trim no destructivo, no borra audio del buffer original) y usa el botón
  **«Cortar»** de la pista para partirla en dos en la posición del cursor.
  Click en una región la selecciona (Suprimir/Backspace la borra); click
  en la regla o en una pista vacía mueve el cursor.
- **Enter** reproduce/pausa desde la posición del cursor (como la barra
  espaciadora en un DAW); el botón «Reproducir» hace lo mismo. El cursor
  avanza usando el reloj del `AudioContext`, no un `setInterval`, así que
  no se desincroniza con lo que realmente suena.
- **Pistas MIDI** (botón «+ Pista MIDI»): en vez de regiones tienen notas
  individuales, editables en la pestaña **«Teclado MIDI»** del panel
  inferior — se activa sola al seleccionar una pista MIDI (o con su botón
  «Ed»). Click en la rejilla agrega una nota (con el teclado de piano de
  la izquierda puedes tocarla primero para escuchar el tono); arrastra una
  nota para moverla/cambiar su tono, tira de su borde derecho para cambiar
  la duración, doble click la borra. La rejilla de fracción de tiempo
  (negra/corchea/semicorchea) controla el "snap".
  *Nota de alcance*: cortar/mover como "región" es un concepto de pista de
  audio; en las pistas MIDI la edición equivalente es mover/recortar notas
  individuales en el piano roll.

## Notas de diseño / diferencias respecto al original

- **Pedalera**: el original permitía cablear los pedales como un grafo libre
  (arrastrando cables entre nodos). Aquí se modela como una **cadena en serie
  reordenable** (arrastra los pedales en la pestaña Pedalera para reordenar),
  que es como se usa en la práctica el 99% de las veces (auto-cablear, combos,
  añadir pedal siempre se comportaban así también en el original).
- **Reverb**: el original usaba un `ConvolverNode` con un impulso de ruido
  generado al vuelo. En C# se sustituyó por un reverb algorítmico
  (Schroeder/Moorer: 4 combs + 2 allpass), mismo carácter de cola difusa,
  pero sin el coste de una convolución por FFT muestra a muestra.
- **Espectrograma**: como la señal en vivo ya no pasa por el navegador, no hay
  `AnalyserNode` disponible en JS. El espectro se calcula en C#
  (`SpectrumAnalyzer.cs`, banco de filtros pasa-banda) y se expone a la
  página vía `GetSpectrum()`.
- **Latencia mostrada**: es la latencia de la tubería configurada en NAudio
  (tamaño de buffer de captura + de render), no una medición acústica de
  ida y vuelta con micrófono como hacía el original. Es un número honesto y
  siempre disponible; con "Baja latencia" activada debería rondar 15-25 ms.
- **Banda de acompañamiento, metrónomo, looper, diapasón, acordes, MIDI y
  YouTube** siguen en JavaScript/Web Audio dentro del WebView2, porque no
  necesitan latencia de monitorización en tiempo real (son reproducción
  programada, no una señal que reacciona a lo que tocas en el instante).
  Corren en un `AudioContext` independiente del motor en C#, y ambos suenan
  a la vez por la salida de Windows sin conflicto.
- Los selectores de dispositivo de entrada/salida del header llaman a
  `bridge.ListarEntradas()`/`ListarSalidas()` para poblarse y a
  `bridge.Conectar(inputId, outputId)` al pulsar «Conectar entrada»
  (`null`/vacío = dispositivo por defecto del sistema).

## Ajustar la latencia

El botón **«Baja latencia»** (tarjeta Amplificador) alterna entre:

- **Activada**: buffer de captura ~6 ms + render ~10 ms.
- **Desactivada**: buffer de captura ~20 ms + render ~30 ms (más estable en
  equipos con CPU limitada o interfaces de audio menos precisas).

Si tu tarjeta de sonido tiene drivers ASIO, se puede sustituir `WasapiCapture`/
`WasapiOut` en `AudioEngine.cs` por `AsioOut` (NAudio ya lo trae) para bajar
aún más la latencia (~2-5 ms); se dejó fuera de esta primera versión porque
no todas las tarjetas integradas traen drivers ASIO.

## Cambios recientes

- **Amplificador simplificado**: ya no simula drive/EQ/cabina/delay/reverb
  (eso duplicaba lo que hacen los pedales de la pedalera y hacía parecer que
  el widget "no estaba conectado a nada"). `OutputStage.cs` ahora es solo una
  ganancia de salida; el widget "Amplificador" quedó como un fader de
  Volumen. Esto también arregló el espectrograma: antes la cadena completa
  daba silencio hasta encender el amplificador, así que no había nada que
  graficar.
- **Fix de CSS**: el canvas del espectrograma no tenía `width`/`height`
  forzados al 100% del contenedor, así que se quedaba con el tamaño por
  defecto de un `<canvas>` (300×150) en vez de ocupar el panel. También le
  faltaba `min-height:0` a la columna central del layout, lo que hacía que
  el panel inferior se comprimiera en vez de que la lista de pistas
  scrolleara internamente al crecer.
- **Fix del playhead en el piano roll**: tenía un offset de 176px copiado
  por error del timeline principal (que sí lo necesita por su columna de
  cabecera); en el piano roll no aplica y lo desincronizaba.
- **Pistas MIDI arrastrables + snapping magnético**: una pista MIDI ahora se
  ve y se arrastra en el arreglo como un bloque (todas sus notas se mueven
  juntas). Arrastrar una región de audio o un bloque MIDI imanta el borde a
  la rejilla de compases o al borde de otra región/bloque cercano (~8px).
- **SoundFont de piano real**: botón «Importar piano real (SoundFont)» en
  la pestaña Teclado MIDI descarga `FluidR3_GM/acoustic_grand_piano` del
  proyecto `gleitz/midi-js-soundfonts` (MIT, gratis, 88 muestras MP3 en
  base64, notación A0..C8 con bemoles Bb/Db/Eb/Gb/Ab) y decodifica las
  muestras en el propio `AudioContext`. Mientras no se importa, las pistas
  MIDI suenan con un sintetizador sawtooth simple.
- **Diagrama de acorde**: la tarjeta Acordes dibuja un diapasón pequeño
  (6 cuerdas × 4 trastes) con el traste más bajo que contiene cada nota del
  acorde por cuerda. Como el buscador de acordes es genérico (cualquier
  raíz × carácter × extensión, no una tabla curada de formas como el
  original), es una digitación calculada, no necesariamente la más habitual
  para tocar.
- **Pistas más compactas**: se redujo la altura de cada fila (~76px → 40px)
  y el padding de la cabecera para ver más pistas a la vez sin scrollear.
