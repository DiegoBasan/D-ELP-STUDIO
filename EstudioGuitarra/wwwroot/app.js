"use strict";

/* =====================================================================
   Puente con el motor de audio en C# (AudioBridge, expuesto por
   MainWindow.xaml.cs via CoreWebView2.AddHostObjectToScript("audio", ...)).
   Todas las llamadas son asincronas (devuelven Promise) aunque el metodo
   de C# sea sincrono. Si la pagina se abre fuera de WebView2 (por ejemplo
   para iterar el CSS en un navegador normal) se usa un "stub" inofensivo
   para que la interfaz no se rompa.
   ===================================================================== */

const hostAudio = (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects)
  ? window.chrome.webview.hostObjects.audio
  : null;

const bridgeStub = {
  ListarEntradas: async () => "[]",
  ListarSalidas: async () => "[]",
  Conectar: async () => false,
  Desconectar: async () => {},
  EstaConectado: async () => false,
  LatenciaMs: async () => 0,
  SetBajaLatencia: async () => {},
  SetA4: async () => {},
  SetAmpOn: async () => {},
  SetAmpParams: async () => {},
  AddPedal: async () => {},
  RemovePedal: async () => {},
  SetPedalParam: async () => {},
  SetPedalBypass: async () => {},
  ReorderChain: async () => {},
  ClearPedales: async () => {},
  GetTuner: async () => JSON.stringify({ freq: 0, nota: "—", cents: 0, haySenal: false }),
  GetMeter: async () => JSON.stringify({ nivel: 0, pico: 0, clip: false }),
  GetSpectrum: async () => JSON.stringify({ frecuencias: [], niveles: [] }),
  StartRecording: async () => {},
  StopRecordingWavBase64: async () => ""
};

const bridge = hostAudio || bridgeStub;
if (!hostAudio) console.warn("No hay host object de C# disponible: ejecutando en modo vista previa (sin audio en vivo).");

/* =====================================================================
   Tablas de datos (mismos valores que usaba el motor original en JS)
   ===================================================================== */

const NOTAS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const ESCALAS = {
  "Pentatónica menor": [0,3,5,7,10], "Pentatónica mayor": [0,2,4,7,9],
  "Mayor (jónica)": [0,2,4,5,7,9,11], "Menor natural": [0,2,3,5,7,8,10],
  "Dórica": [0,2,3,5,7,9,10], "Mixolidia": [0,2,4,5,7,9,10],
  "Blues": [0,3,5,6,7,10], "Menor armónica": [0,2,3,5,7,8,11]
};
const GRADOS = {0:"1",1:"b2",2:"2",3:"b3",4:"3",5:"4",6:"b5",7:"5",8:"b6",9:"6",10:"b7",11:"7"};
const CUERDAS = [64,59,55,50,45,40];
const CUERDA_NOMBRES = ["E","B","G","D","A","E"];
const PATRONES = {
  rock:{k:[0,10],s:[4,12],h:[0,2,4,6,8,10,12,14]},
  blues:{k:[0,6,10],s:[4,12],h:[0,3,4,7,8,11,12,15]},
  balada:{k:[0,8],s:[4,12],h:[2,6,10,14]},
  funk:{k:[0,3,9,14],s:[4,12],h:[0,2,4,6,8,10,12,14]},
  metal:{k:[0,2,4,6,8,10,12,14],s:[4,12],h:[0,4,8,12]}
};
const PROGRESIONES = { "I-IV-V":[0,5,7,0], "blues12":[0,0,0,0,5,5,0,0,7,5,0,7], "ii-V-I":[2,7,0,0], "vi-IV-I-V":[9,5,0,7], "pedal":[0] };
const FAMILIAS = [
  { id: "mayor", nombre: "Mayor", tipos: [["", "Tríada"], ["6", "sexta"], ["maj7", "maj7"], ["add9", "add9"], ["maj9", "maj9"], ["6/9", "6/9"]] },
  { id: "menor", nombre: "Menor", tipos: [["m", "Tríada"], ["m6", "m6"], ["m7", "m7"], ["m9", "m9"], ["m11", "m11"], ["mMaj7", "m(maj7)"]] },
  { id: "dominante", nombre: "Dominante", tipos: [["7", "7"], ["9", "9"], ["13", "13"], ["7sus4", "7sus4"], ["7b5", "7b5"], ["7#9", "7#9"]] },
  { id: "suspendido", nombre: "Suspendido", tipos: [["sus2", "sus2"], ["sus4", "sus4"], ["sus4add9", "sus4 add9"]] },
  { id: "alterado", nombre: "Disminuido / aumentado", tipos: [["dim", "dim"], ["dim7", "dim7"], ["m7b5", "m7b5"], ["aug", "aug"], ["aug7", "aug7"]] }
];
const FORMULAS = {
  "": [0,4,7], "6": [0,4,7,9], "maj7": [0,4,7,11], "add9": [0,4,7,14], "maj9": [0,4,7,11,14], "6/9": [0,4,7,9,14],
  "m": [0,3,7], "m6": [0,3,7,9], "m7": [0,3,7,10], "m9": [0,3,7,10,14], "m11": [0,3,7,10,17], "mMaj7": [0,3,7,11],
  "7": [0,4,7,10], "9": [0,4,7,10,14], "13": [0,4,7,10,21], "7sus4": [0,5,7,10], "7b5": [0,4,6,10], "7#9": [0,4,7,10,15],
  "sus2": [0,2,7], "sus4": [0,5,7], "sus4add9": [0,5,7,14],
  "dim": [0,3,6], "dim7": [0,3,6,9], "m7b5": [0,3,6,10], "aug": [0,4,8], "aug7": [0,4,8,10]
};
const GRADOS_KEY = [{ g: 0, t: "" }, { g: 2, t: "m" }, { g: 4, t: "m" }, { g: 5, t: "" }, { g: 7, t: "7" }, { g: 9, t: "m" }, { g: 11, t: "m7b5" }];
const RAMAS = { 0: [5,7,9,2], 2: [7,5,0,9], 4: [9,2,5,7], 5: [0,7,2,9], 7: [0,9,5,2], 9: [2,5,7,4], 11: [0,7,4,9] };
const NUMERALES = { 0: "I", 2: "ii", 4: "iii", 5: "IV", 7: "V", 9: "vi", 11: "vii" };

const PRESETS = {
  "Limpio":{gain:12,bass:55,mid:50,treble:60,rev:22,dly:8,vol:70},
  "Crunch":{gain:45,bass:50,mid:60,treble:55,rev:18,dly:10,vol:60},
  "Blues":{gain:35,bass:60,mid:65,treble:45,rev:30,dly:14,vol:62},
  "Lead":{gain:65,bass:45,mid:70,treble:60,rev:35,dly:30,vol:58},
  "Metal":{gain:88,bass:70,mid:30,treble:70,rev:12,dly:5,vol:55},
  "Acústica":{gain:5,bass:45,mid:45,treble:70,rev:40,dly:6,vol:75}
};
const MANDOS_AMP = [["Ganancia","gain"],["Graves","bass"],["Medios","mid"],["Agudos","treble"],["Delay","dly"],["Reverb","rev"],["Volumen","vol"]];
const PEDALES = {
  comp:   { nombre:"Compresor", color:"#7fc8a9", k:[["umbral","Umbral",45],["ratio","Ratio",50],["nivel","Nivel",60]] },
  boost:  { nombre:"Booster",   color:"#c8e05f", k:[["nivel","Nivel",55],["tono","Tono",70]] },
  od:     { nombre:"Overdrive", color:"#e8b95a", k:[["drive","Drive",50],["tono","Tono",60],["nivel","Nivel",55]] },
  dist:   { nombre:"Distorsión",color:"#FF822F", k:[["drive","Drive",65],["cuerpo","Cuerpo",50],["nivel","Nivel",50]] },
  fuzz:   { nombre:"Fuzz",      color:"#C82C44", k:[["fuzz","Fuzz",75],["tono","Tono",45],["nivel","Nivel",45]] },
  eq:     { nombre:"EQ gráfico",color:"#9db2e8", k:[["graves","Graves",50],["medios","Medios",50],["agudos","Agudos",50]] },
  wah:    { nombre:"Auto-wah",  color:"#b98ae0", k:[["ritmo","Ritmo",40],["rango","Rango",55],["res","Resonancia",55]] },
  chorus: { nombre:"Chorus",    color:"#6fc6d8", k:[["ritmo","Ritmo",35],["prof","Profund.",45],["mezcla","Mezcla",45]] },
  phaser: { nombre:"Phaser",    color:"#8ea0d8", k:[["ritmo","Ritmo",30],["prof","Profund.",55],["mezcla","Mezcla",50]] },
  trem:   { nombre:"Trémolo",   color:"#d8c46f", k:[["ritmo","Ritmo",45],["prof","Profund.",55]] },
  delay:  { nombre:"Delay",     color:"#5fb8e0", k:[["tiempo","Tiempo",40],["repes","Repes",35],["mezcla","Mezcla",35]] },
  reverb: { nombre:"Reverb",    color:"#a7d8c0", k:[["tamano","Tamaño",50],["mezcla","Mezcla",35]] }
};
const COMBOS = [
  { nombre:"Blues cristalino", detalle:"Compresor → Overdrive → Reverb", tipos:["comp","od","reverb"], preset:"Blues" },
  { nombre:"Rock de garaje", detalle:"Booster → Distorsión → Delay", tipos:["boost","dist","delay"], preset:"Crunch" },
  { nombre:"Funk elástico", detalle:"Compresor → Auto-wah → EQ", tipos:["comp","wah","eq"], preset:"Limpio" },
  { nombre:"Ambiental", detalle:"Chorus → Delay → Reverb", tipos:["chorus","delay","reverb"], preset:"Limpio" },
  { nombre:"Muro de metal", detalle:"EQ → Fuzz → Trémolo", tipos:["eq","fuzz","trem"], preset:"Metal" }
];
const LANE_COLORES = ["#c8e05f","#FF822F","#6fc6d8","#b98ae0","#e8b95a","#7fc8a9"];

/* =====================================================================
   Utilidades
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtTime(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ":" + r.toFixed(1).padStart(4, "0");
}
function midiToFreq(m, a4) { return (a4 || 440) * Math.pow(2, (m - 69) / 12); }
function uid(prefix) { return prefix + Date.now().toString(36) + Math.floor(Math.random() * 9999); }

/* =====================================================================
   Estado global
   ===================================================================== */

const state = {
  bpm: 90, subdiv: 1, compas: 4, playing: false, pulsoActual: -1,
  bandaOn: false, estilo: "rock", tonalidad: "A", progresion: "I-IV-V", compasActual: 1,
  afinadorOn: false,
  ampOn: false, preset: "Limpio", amp: { gain:12, bass:55, mid:50, treble:60, rev:22, dly:8, vol:70 },
  bajaLatencia: true,
  conectado: false,
  pedales: [], // { id, tipo, params }
  pistas: [], // { id, nombre, color, buffer, vol, muted, solo, offset }
  duracion: 16, pxSeg: 60, cursor: 0, reproduciendo: false, recording: false, pistaArmada: null,
  latenciaCompensacionMs: 60,
  raiz: "A", escala: "Pentatónica menor", grados: false,
  raizAc: "C", familiaAc: "mayor", tipoAc: "", secuencia: [],
  muestras: {}, // nombre -> AudioBuffer
  ytPlayer: null, ytA: 0, ytB: 0, ytAB: false
};

/* AudioContext local, solo para reproduccion no critica en tiempo real:
   metronomo, banda de acompañamiento, looper y acordes de referencia.
   La señal en vivo de la guitarra NUNCA pasa por aqui: va directo por
   WASAPI desde el motor en C#, por eso tiene latencia casi nula. */
let loopCtx = null;
function ensureLoopCtx() {
  if (!loopCtx) loopCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (loopCtx.state === "suspended") loopCtx.resume();
  return loopCtx;
}
let clickGain, drumGain, bassGain, loopGain, masterLoop;
function ensureBuses() {
  const c = ensureLoopCtx();
  if (masterLoop) return;
  masterLoop = c.createGain(); masterLoop.connect(c.destination);
  clickGain = c.createGain(); clickGain.connect(masterLoop);
  drumGain = c.createGain(); drumGain.connect(masterLoop);
  bassGain = c.createGain(); bassGain.connect(masterLoop);
  loopGain = c.createGain(); loopGain.connect(masterLoop);
  syncVols();
}
function syncVols() {
  if (!clickGain) return;
  clickGain.gain.value = ($("volClick").value / 100) * 0.5;
  drumGain.gain.value = ($("volDrums").value / 100) * 0.9;
  bassGain.gain.value = ($("volBass").value / 100) * 0.9;
}

/* =====================================================================
   Inicializacion de selects / catalogos
   ===================================================================== */

function llenarSelect(sel, valores, seleccion) {
  sel.innerHTML = "";
  valores.forEach(v => {
    const o = document.createElement("option");
    o.value = v; o.textContent = v;
    if (v === seleccion) o.selected = true;
    sel.appendChild(o);
  });
}

function initSelectsBasicos() {
  llenarSelect($("selTonalidad"), NOTAS, state.tonalidad);
  llenarSelect($("selRaizDiap"), NOTAS, state.raiz);
  llenarSelect($("selEscala"), Object.keys(ESCALAS), state.escala);
  llenarSelect($("selRaizAc"), NOTAS, state.raizAc);
  llenarSelect($("selFamiliaAc"), FAMILIAS.map(f => f.nombre), FAMILIAS.find(f => f.id === state.familiaAc).nombre);
  actualizarTiposAcorde();
}
function actualizarTiposAcorde() {
  const fam = FAMILIAS.find(f => f.nombre === $("selFamiliaAc").value) || FAMILIAS[0];
  state.familiaAc = fam.id;
  $("selTipoAc").innerHTML = "";
  fam.tipos.forEach(([val, label]) => {
    const o = document.createElement("option");
    o.value = val; o.textContent = label;
    $("selTipoAc").appendChild(o);
  });
  state.tipoAc = fam.tipos[0][0];
}

function initCuerdasRef() {
  const box = $("cuerdasRef");
  box.innerHTML = "";
  CUERDA_NOMBRES.forEach((nombre, i) => {
    const div = document.createElement("div");
    div.className = "s";
    div.innerHTML = `<span class="nm">${nombre}${6 - i}</span><span class="hz">${midiToFreq(CUERDAS[i], 440).toFixed(1)} Hz</span>`;
    box.appendChild(div);
  });
}

function initPulsos() {
  const box = $("pulsos");
  box.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("span");
    s.className = "pulso";
    box.appendChild(s);
  }
}

function initMeterBars() {
  const box = $("meterBars");
  box.innerHTML = "";
  for (let i = 0; i < 30; i++) {
    const s = document.createElement("span");
    box.appendChild(s);
  }
}

function initCatalogoPedales() {
  const box = $("catalogoPedales");
  box.innerHTML = "";
  Object.entries(PEDALES).forEach(([tipo, meta]) => {
    const b = document.createElement("button");
    b.innerHTML = `<span class="dot" style="background:${meta.color}"></span>${meta.nombre}`;
    b.onclick = () => anadirPedal(tipo);
    box.appendChild(b);
  });

  const combos = $("combosPedales");
  combos.innerHTML = "";
  COMBOS.forEach(c => {
    const b = document.createElement("button");
    b.innerHTML = `<span class="nm">${c.nombre}</span><span class="dt">${c.detalle}</span>`;
    b.onclick = () => aplicarCombo(c);
    combos.appendChild(b);
  });
}

function initPresetsAmp() {
  const box = $("presetsAmp");
  box.innerHTML = "";
  Object.keys(PRESETS).forEach(nombre => {
    const b = document.createElement("button");
    b.textContent = nombre;
    b.className = state.preset === nombre ? "on" : "";
    b.onclick = () => aplicarPresetAmp(nombre);
    box.appendChild(b);
  });
}

function initMandosAmp() {
  const box = $("mandosAmp");
  box.innerHTML = "";
  MANDOS_AMP.forEach(([label, key]) => {
    const row = document.createElement("label");
    row.className = "slider-row";
    row.innerHTML = `<span class="head"><span>${label}</span><span class="v" id="ampV_${key}">${state.amp[key]}</span></span>
      <input type="range" min="0" max="100" value="${state.amp[key]}" id="ampR_${key}">`;
    box.appendChild(row);
    row.querySelector("input").addEventListener("input", (e) => {
      state.amp[key] = Number(e.target.value);
      $("ampV_" + key).textContent = state.amp[key];
      state.preset = "";
      enviarAmpParams();
    });
  });
}

/* =====================================================================
   Header: transporte / tempo / claqueta / entrada / medidor / latencia
   ===================================================================== */

let tapTimes = [];
function actualizarBpmUI() { $("bpmValor").textContent = state.bpm; }

$("bpmMas").onclick = () => { state.bpm = clamp(state.bpm + 1, 40, 240); actualizarBpmUI(); };
$("bpmMenos").onclick = () => { state.bpm = clamp(state.bpm - 1, 40, 240); actualizarBpmUI(); };
$("btnTap").onclick = () => {
  const now = performance.now();
  tapTimes = tapTimes.filter(t => now - t < 2000);
  tapTimes.push(now);
  if (tapTimes.length >= 2) {
    const intervalos = [];
    for (let i = 1; i < tapTimes.length; i++) intervalos.push(tapTimes[i] - tapTimes[i - 1]);
    const media = intervalos.reduce((a, b) => a + b, 0) / intervalos.length;
    state.bpm = clamp(Math.round(60000 / media), 40, 240);
    actualizarBpmUI();
  }
};

let clickOn = false;
$("btnClick").onclick = () => {
  clickOn = !clickOn;
  $("btnClick").classList.toggle("on", clickOn);
  refreshClock();
};
$("btnBanda").onclick = () => {
  state.bandaOn = !state.bandaOn;
  $("btnBanda").classList.toggle("on", state.bandaOn);
  refreshClock();
};

$("btnInicio").onclick = () => { state.cursor = 0; actualizarCursorUI(); };
$("btnPararTodo").onclick = () => {
  state.playing = false; state.reproduciendo = false; clickOn = false; state.bandaOn = false;
  $("btnClick").classList.remove("on"); $("btnBanda").classList.remove("on");
  detenerPistas();
  refreshClock();
};

$("btnConectar").onclick = async () => {
  const ok = await bridge.Conectar(null, null);
  state.conectado = !!ok;
  actualizarBadgeEntrada();
};

function actualizarBadgeEntrada() {
  const b = $("badgeEntrada");
  b.classList.toggle("ok", state.conectado);
  b.classList.toggle("err", !state.conectado);
  $("badgeEntradaTxt").textContent = state.conectado ? "entrada conectada" : "sin conectar";
}

async function pollEstadoEntrada() {
  try {
    const [conectado, latencia] = await Promise.all([bridge.EstaConectado(), bridge.LatenciaMs()]);
    state.conectado = !!conectado;
    actualizarBadgeEntrada();
    $("latenciaTxt").textContent = state.conectado ? Math.round(latencia) + " ms" : "—";
  } catch (e) { /* motor no disponible todavia */ }
}

async function pollMedidor() {
  try {
    const json = await bridge.GetMeter();
    const m = JSON.parse(json);
    const bars = $("meterBars").children;
    const activos = Math.round((m.nivel || 0) * bars.length);
    for (let i = 0; i < bars.length; i++) {
      bars[i].classList.toggle("on", i < activos);
      bars[i].classList.toggle("hot", i < activos && i > bars.length * 0.75);
      bars[i].classList.toggle("clip", m.clip && i >= bars.length - 2);
    }
    $("clipTexto").textContent = m.clip ? "CLIP" : "Nivel";
    $("clipTexto").style.color = m.clip ? "var(--danger-fg)" : "";
    const db = m.nivel > 0 ? Math.round(m.nivel * 60 - 60) : -Infinity;
    $("nivelTexto").textContent = isFinite(db) ? db + " dB" : "-inf dB";
  } catch (e) { /* motor no disponible todavia */ }
}

async function pollAfinador() {
  if (!state.afinadorOn) return;
  try {
    const json = await bridge.GetTuner();
    const t = JSON.parse(json);
    if (t.haySenal) {
      $("notaDetectada").textContent = t.nota;
      $("freqDetectada").textContent = t.freq.toFixed(1);
      const pos = clamp(50 + t.cents / 50 * 50, 2, 98);
      $("agujaAfinador").style.left = pos + "%";
      const afinado = Math.abs(t.cents) < 6;
      $("agujaAfinador").style.background = afinado ? "var(--lima)" : "var(--danger-fg)";
      $("desvioTexto").textContent = afinado ? "Afinado" : (t.cents > 0 ? `+${t.cents} cents (alto)` : `${t.cents} cents (bajo)`);
    } else {
      $("desvioTexto").textContent = "Toca una cuerda para afinar";
    }
  } catch (e) { /* motor no disponible todavia */ }
}

$("btnAfinador").onclick = () => {
  state.afinadorOn = !state.afinadorOn;
  $("btnAfinador").classList.toggle("on", state.afinadorOn);
  $("btnAfinador").textContent = state.afinadorOn ? "Desactivar afinador" : "Activar afinador";
};

setInterval(pollEstadoEntrada, 400);
setInterval(pollMedidor, 120);
setInterval(pollAfinador, 90);

/* =====================================================================
   Reloj / metronomo / banda de acompañamiento (Web Audio normal:
   no es la señal en vivo, es reproduccion programada, la latencia de
   agenda del navegador aqui no afecta la sensacion de tocar)
   ===================================================================== */

let clockTimer = null, clockStep = 0, clockNextTime = 0;
function refreshClock() {
  const need = clickOn || state.bandaOn;
  if (need && !clockTimer) startClock();
  if (!need && clockTimer) stopClock();
}
function startClock() {
  ensureBuses();
  clockStep = 0; clockNextTime = loopCtx.currentTime + 0.08;
  clockTick();
}
function stopClock() {
  if (clockTimer) { clearTimeout(clockTimer); clockTimer = null; }
  state.pulsoActual = -1; pintarPulsos();
}
function clockTick() {
  const spb = 60 / state.bpm / 4;
  while (clockNextTime < loopCtx.currentTime + 0.12) {
    scheduleStep(clockStep, clockNextTime);
    clockNextTime += spb; clockStep++;
  }
  clockTimer = setTimeout(clockTick, 25);
}
function scheduleStep(step, t) {
  const spb16 = state.compas * 4, local = step % spb16, bar = Math.floor(step / spb16);
  if (clickOn && local % (4 / state.subdiv) === 0) clickSound(t, local === 0);
  if (local % 4 === 0) {
    const beat = local / 4;
    setTimeout(() => { state.pulsoActual = beat; pintarPulsos(); }, Math.max(0, (t - loopCtx.currentTime) * 1000));
  }
  if (state.bandaOn) {
    const p = PATRONES[state.estilo], b16 = step % 16;
    if (p.k.includes(b16)) drumHit("kick", t);
    if (p.s.includes(b16)) drumHit("snare", t);
    if (p.h.includes(b16)) drumHit("hat", t);
    const prog = PROGRESIONES[state.progresion], idx = bar % prog.length;
    const root = 40 + NOTAS.indexOf(state.tonalidad) + prog[idx];
    if (b16 === 0 || b16 === 8) bassNote(t, root);
    if (b16 === 6) bassNote(t, root + 12);
    if (b16 === 12) bassNote(t, root + 7);
    if (b16 === 0 && state.compasActual !== idx + 1) {
      setTimeout(() => {
        state.compasActual = idx + 1;
        $("compasActual").textContent = state.compasActual;
        $("acordeActual").textContent = nombreAcordeSimple(root % 12);
      }, Math.max(0, (t - loopCtx.currentTime) * 1000));
    }
  }
}
function pintarPulsos() {
  const box = $("pulsos").children;
  for (let i = 0; i < box.length; i++) box[i].classList.toggle("on", i === state.pulsoActual);
}
function clickSound(t, acc) {
  const c = loopCtx, o = c.createOscillator(), g = c.createGain();
  o.frequency.value = acc ? 1500 : 900; o.type = "square";
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(acc ? 0.9 : 0.45, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  o.connect(g); g.connect(clickGain); o.start(t); o.stop(t + 0.06);
}
let noiseBuffer = null;
function ensureNoise() {
  if (noiseBuffer) return noiseBuffer;
  const c = loopCtx, len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = b; return b;
}
function drumHit(tipo, t) {
  const muestra = state.muestras[tipo];
  if (muestra) {
    const c = loopCtx, s = c.createBufferSource(); s.buffer = muestra;
    s.connect(drumGain); s.start(t); return;
  }
  const c = loopCtx;
  if (tipo === "kick") {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(drumGain); o.start(t); o.stop(t + 0.32);
  } else if (tipo === "snare") {
    const s = c.createBufferSource(); s.buffer = ensureNoise();
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(hp); hp.connect(g); g.connect(drumGain); s.start(t); s.stop(t + 0.18);
  } else {
    const s = c.createBufferSource(); s.buffer = ensureNoise();
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(hp); hp.connect(g); g.connect(drumGain); s.start(t); s.stop(t + 0.07);
  }
}
function bassNote(t, midi) {
  const muestra = state.muestras["bass"];
  const c = loopCtx;
  if (muestra) {
    const s = c.createBufferSource(); s.buffer = muestra;
    s.playbackRate.value = midiToFreq(midi, 440) / midiToFreq(40, 440);
    s.connect(bassGain); s.start(t); return;
  }
  const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 900;
  o.type = "triangle"; o.frequency.value = midiToFreq(midi, 440);
  const dur = 60 / state.bpm * 0.85;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); lp.connect(g); g.connect(bassGain); o.start(t); o.stop(t + dur + 0.05);
}
function nombreAcordeSimple(pc) {
  const key = GRADOS_KEY.find(g => g.g === pc);
  return NOTAS[pc] + (key ? key.t : "");
}

["selEstilo","selTonalidad","selCompas","selProgresion"].forEach(id => {
  $(id).addEventListener("change", (e) => {
    const map = { selEstilo: "estilo", selTonalidad: "tonalidad", selCompas: "compas", selProgresion: "progresion" };
    const key = map[id];
    state[key] = key === "compas" ? Number(e.target.value) : e.target.value;
  });
});
["volDrums","volBass","volClick"].forEach(id => $(id).addEventListener("input", syncVols));

/* =====================================================================
   Pedalera (envia todo a C# via bridge; la UI solo refleja el estado)
   ===================================================================== */

function anadirPedal(tipo) {
  const meta = PEDALES[tipo];
  const id = uid("p");
  const params = {}; meta.k.forEach(k => params[k[0]] = k[2]);
  state.pedales.push({ id, tipo, params });
  bridge.AddPedal(id, tipo, JSON.stringify(params));
  bridge.ReorderChain(JSON.stringify(state.pedales.map(p => p.id)));
  renderChainRack();
}
function quitarPedal(id) {
  state.pedales = state.pedales.filter(p => p.id !== id);
  bridge.RemovePedal(id);
  renderChainRack();
}
function aplicarCombo(combo) {
  state.pedales.forEach(p => bridge.RemovePedal(p.id));
  state.pedales = combo.tipos.map(tipo => {
    const meta = PEDALES[tipo], id = uid("p"), params = {};
    meta.k.forEach(k => params[k[0]] = k[2]);
    bridge.AddPedal(id, tipo, JSON.stringify(params));
    return { id, tipo, params };
  });
  bridge.ReorderChain(JSON.stringify(state.pedales.map(p => p.id)));
  aplicarPresetAmp(combo.preset);
  if (!state.ampOn) { state.ampOn = true; bridge.SetAmpOn(true); actualizarBotonAmp(); }
  renderChainRack();
}
$("btnAutoCablear").onclick = () => bridge.ReorderChain(JSON.stringify(state.pedales.map(p => p.id)));
$("btnVaciarPedalera").onclick = () => {
  state.pedales.forEach(p => bridge.RemovePedal(p.id));
  state.pedales = [];
  bridge.ClearPedales();
  renderChainRack();
};

let dragPedalId = null;
function renderChainRack() {
  const rack = $("chainRack");
  rack.innerHTML = "";
  const nodoGuitarra = document.createElement("div");
  nodoGuitarra.className = "chain-node fixed";
  nodoGuitarra.innerHTML = `<div class="tipo">Entrada</div><div class="nombre">Guitarra</div>`;
  rack.appendChild(nodoGuitarra);

  state.pedales.forEach(p => {
    rack.appendChild(flecha());
    rack.appendChild(renderPedalNode(p));
  });

  rack.appendChild(flecha());
  const nodoAmp = document.createElement("div");
  nodoAmp.className = "chain-node fixed";
  nodoAmp.innerHTML = `<div class="tipo">Salida</div><div class="nombre">Amplificador</div>`;
  rack.appendChild(nodoAmp);

  $("textoCadena").textContent = "Guitarra → " + (state.pedales.map(p => PEDALES[p.tipo].nombre).join(" → ") + (state.pedales.length ? " → " : "")) + "Amplificador";
}
function flecha() { const s = document.createElement("div"); s.className = "chain-arrow"; s.textContent = "→"; return s; }

function renderPedalNode(p) {
  const meta = PEDALES[p.tipo];
  const node = document.createElement("div");
  node.className = "chain-node";
  node.draggable = true;
  node.dataset.id = p.id;
  node.style.borderColor = meta.color;
  node.innerHTML = `
    <div class="tipo" style="color:${meta.color}">${p.bypass ? "Puenteado" : "Activo"}</div>
    <div class="nombre">${meta.nombre}</div>
    <div class="knobs"></div>
    <div class="row2">
      <button class="bp">${p.bypass ? "Off" : "On"}</button>
      <button class="x">×</button>
    </div>`;
  const knobsBox = node.querySelector(".knobs");
  meta.k.forEach(([key, label]) => {
    const k = document.createElement("div");
    k.className = "knob";
    const deg = -140 + (p.params[key] / 100) * 280;
    k.innerHTML = `<div class="dial"><div class="mark" style="transform:rotate(${deg}deg)"></div></div><span class="lb">${label}</span>`;
    k.querySelector(".dial").addEventListener("pointerdown", (e) => arrastrarMando(e, p, key, k));
    knobsBox.appendChild(k);
  });
  node.querySelector(".bp").onclick = () => {
    p.bypass = !p.bypass;
    bridge.SetPedalBypass(p.id, p.bypass);
    renderChainRack();
  };
  node.querySelector(".x").onclick = () => quitarPedal(p.id);

  node.addEventListener("dragstart", () => { dragPedalId = p.id; node.classList.add("dragging"); });
  node.addEventListener("dragend", () => { node.classList.remove("dragging"); dragPedalId = null; });
  node.addEventListener("dragover", (e) => e.preventDefault());
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragPedalId || dragPedalId === p.id) return;
    const from = state.pedales.findIndex(x => x.id === dragPedalId);
    const to = state.pedales.findIndex(x => x.id === p.id);
    const [moved] = state.pedales.splice(from, 1);
    state.pedales.splice(to, 0, moved);
    bridge.ReorderChain(JSON.stringify(state.pedales.map(x => x.id)));
    renderChainRack();
  });
  return node;
}
function arrastrarMando(e, pedal, key, knobEl) {
  e.preventDefault();
  const v0 = pedal.params[key], y0 = e.clientY;
  const mover = (ev) => {
    const v = clamp(Math.round(v0 + (y0 - ev.clientY) * 0.7), 0, 100);
    pedal.params[key] = v;
    bridge.SetPedalParam(pedal.id, key, v);
    const deg = -140 + (v / 100) * 280;
    knobEl.querySelector(".mark").style.transform = `rotate(${deg}deg)`;
  };
  const soltar = () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
}

/* =====================================================================
   Amplificador
   ===================================================================== */

function actualizarBotonAmp() {
  $("btnAmp").classList.toggle("on", state.ampOn);
  $("btnAmp").textContent = state.ampOn ? "Apagar amplificador" : "Encender amplificador";
}
function enviarAmpParams() {
  const a = state.amp;
  bridge.SetAmpParams(a.gain, a.bass, a.mid, a.treble, a.rev, a.dly, a.vol);
}
$("btnAmp").onclick = () => {
  state.ampOn = !state.ampOn;
  bridge.SetAmpOn(state.ampOn);
  actualizarBotonAmp();
};
function aplicarPresetAmp(nombre) {
  const p = PRESETS[nombre];
  if (!p) return;
  state.preset = nombre;
  Object.assign(state.amp, p);
  MANDOS_AMP.forEach(([, key]) => {
    $("ampR_" + key).value = state.amp[key];
    $("ampV_" + key).textContent = state.amp[key];
  });
  initPresetsAmp();
  enviarAmpParams();
}
$("btnBajaLatencia").onclick = () => {
  state.bajaLatencia = !state.bajaLatencia;
  bridge.SetBajaLatencia(state.bajaLatencia);
  $("btnBajaLatencia").classList.toggle("on", state.bajaLatencia);
  $("btnBajaLatencia").textContent = "Baja latencia: " + (state.bajaLatencia ? "activada" : "desactivada");
};

/* =====================================================================
   Analizador de espectro (datos calculados en C# sobre la senal real,
   dibujados aqui como espectrograma desplazante)
   ===================================================================== */

function initEjesEspectro() {
  const axis = $("specAxis");
  axis.innerHTML = "";
  ["8k","4k","2k","1k","500","250","60"].forEach(v => {
    const s = document.createElement("span"); s.textContent = v; axis.appendChild(s);
  });
}
function colorEspectro(v) {
  if (v < 0.06) return "#101010";
  if (v < 0.32) { const a = (v - 0.06) / 0.26; return `rgb(${Math.round(12+a*6)},${Math.round(16+a*40)},${Math.round(28+a*100)})`; }
  if (v < 0.62) { const a = (v - 0.32) / 0.3; return `rgb(${Math.round(18+a*24)},${Math.round(56+a*94)},${Math.round(128+a*82)})`; }
  const a = Math.min(1, (v - 0.62) / 0.38);
  return `rgb(${Math.round(42+a*190)},${Math.round(150+a*88)},${Math.round(210+a*45)})`;
}
async function pasoEspectrograma() {
  const cv = $("specCanvas");
  const w = cv.clientWidth, h = cv.clientHeight;
  if (w && h && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
  if (w && h) {
    try {
      const json = await bridge.GetSpectrum();
      const { niveles } = JSON.parse(json);
      const g = cv.getContext("2d");
      g.drawImage(cv, -2, 0);
      if (niveles && niveles.length) {
        for (let y = 0; y < h; y++) {
          const idx = Math.min(niveles.length - 1, Math.floor((1 - y / h) * niveles.length));
          g.fillStyle = colorEspectro(niveles[idx]);
          g.fillRect(w - 2, y, 2, 1);
        }
      }
    } catch (e) { /* motor no disponible todavia */ }
  }
  requestAnimationFrame(pasoEspectrograma);
}

/* =====================================================================
   Diapason
   ===================================================================== */

function renderDiapason() {
  const nums = $("fretNums"); nums.innerHTML = "";
  for (let i = 0; i <= 15; i++) { const s = document.createElement("span"); s.textContent = i; nums.appendChild(s); }
  const grid = $("fretGrid"); grid.innerHTML = "";
  const raiz = NOTAS.indexOf(state.raiz);
  const escala = ESCALAS[state.escala];
  for (let cuerda = 0; cuerda < 6; cuerda++) {
    for (let tr = 0; tr <= 15; tr++) {
      const pc = (CUERDAS[cuerda] + tr) % 12;
      const rel = ((pc - raiz) % 12 + 12) % 12;
      const cell = document.createElement("span");
      cell.className = "cell";
      if (escala.includes(rel)) {
        cell.classList.add(rel === 0 ? "root" : "in");
        cell.textContent = state.grados ? GRADOS[rel] : NOTAS[pc];
      }
      grid.appendChild(cell);
    }
  }
}
$("selRaizDiap").addEventListener("change", e => { state.raiz = e.target.value; renderDiapason(); });
$("selEscala").addEventListener("change", e => { state.escala = e.target.value; renderDiapason(); });
$("btnGrados").onclick = () => { state.grados = !state.grados; $("btnGrados").classList.toggle("on", state.grados); renderDiapason(); };

/* =====================================================================
   Acordes
   ===================================================================== */

function notaAcordeActual() {
  const raiz = NOTAS.indexOf(state.raizAc);
  const formula = FORMULAS[state.tipoAc] || [0,4,7];
  const notas = formula.map(iv => NOTAS[(raiz + iv) % 12]);
  return { nombre: state.raizAc + state.tipoAc, notas };
}
function actualizarAcordeUI() {
  const { nombre, notas } = notaAcordeActual();
  $("nombreAcorde").textContent = nombre;
  $("notasAcordeTxt").textContent = notas.join(" ");
  renderSugerencias();
}
$("selRaizAc").addEventListener("change", e => { state.raizAc = e.target.value; actualizarAcordeUI(); });
$("selFamiliaAc").addEventListener("change", () => { actualizarTiposAcorde(); actualizarAcordeUI(); });
$("selTipoAc").addEventListener("change", e => { state.tipoAc = e.target.value; actualizarAcordeUI(); });

function renderSugerencias() {
  const raiz = NOTAS.indexOf(state.raizAc);
  const ramas = RAMAS[raiz] || RAMAS[0];
  const box = $("sugerenciasAc");
  box.innerHTML = "";
  ramas.forEach(g => {
    const key = GRADOS_KEY.find(k => k.g === g) || { g, t: "" };
    const pc = (raiz + g) % 12;
    const b = document.createElement("button");
    b.innerHTML = `<span class="g">${NOTAS[pc]}${key.t}</span><span class="d">${NUMERALES[g] || ""}</span>`;
    b.onclick = () => {
      state.secuencia.push(NOTAS[pc] + key.t);
      actualizarSecuenciaUI();
    };
    box.appendChild(b);
  });
}
function actualizarSecuenciaUI() {
  $("textoSecuencia").textContent = state.secuencia.length ? state.secuencia.join("  –  ") : "Sin acordes en la secuencia.";
}
$("btnQuitarUltimo").onclick = () => { state.secuencia.pop(); actualizarSecuenciaUI(); };
$("btnVaciarSecuencia").onclick = () => { state.secuencia = []; actualizarSecuenciaUI(); };
$("btnEscuchar").onclick = () => sonarSecuencia(state.secuencia.length ? state.secuencia : [notaAcordeActual().nombre]);

function sonarSecuencia(nombres) {
  ensureBuses();
  const c = loopCtx;
  let t = c.currentTime + 0.05;
  nombres.forEach(nombre => {
    const m = /^([A-G]#?)(.*)$/.exec(nombre);
    if (!m) return;
    const raiz = NOTAS.indexOf(m[1]);
    const formula = FORMULAS[m[2]] || [0,4,7];
    formula.forEach(iv => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "triangle"; o.frequency.value = midiToFreq(48 + raiz + iv, 440);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(masterLoop); o.start(t); o.stop(t + 0.95);
    });
    t += 1.0;
  });
}

/* =====================================================================
   Looper / arreglo multipista
   ===================================================================== */

function actualizarReglaYLanes() {
  const px = state.pxSeg, dur = state.duracion;
  const marks = $("reglaMarks");
  marks.innerHTML = "";
  const nCompases = Math.ceil(dur / (60 / state.bpm * state.compas));
  const wCompas = (60 / state.bpm * state.compas) * px;
  for (let i = 0; i < Math.max(4, nCompases); i++) {
    const m = document.createElement("div");
    m.className = "m"; m.style.width = wCompas + "px"; m.textContent = i + 1;
    marks.appendChild(m);
  }
  $("lanesWrap").style.width = (176 + dur * px) + "px";
  renderLanes();
  $("zoomTxt").textContent = px + " px/s";
  $("infoLoop").textContent = fmtTime(state.cursor) + " / " + fmtTime(dur);
}

function renderLanes() {
  const list = $("lanesList");
  list.innerHTML = "";
  state.pistas.forEach((t, idx) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.innerHTML = `
      <div class="lane-head">
        <div class="top-row">
          <span class="swatch" style="background:${t.color}"></span>
          <div style="min-width:0">
            <div class="name">${t.nombre}</div>
            <div class="detail">${t.buffer ? fmtTime(t.buffer.duration) : "vacía"}</div>
          </div>
        </div>
        <div class="ctrl-row">
          <button class="ar ${state.pistaArmada === t.id ? "on" : ""}">R</button>
          <button class="mu ${t.muted ? "on" : ""}">M</button>
          <button class="so ${t.solo ? "on" : ""}">S</button>
          <button class="del">×</button>
        </div>
        <input type="range" min="0" max="100" value="${t.vol}" class="vol">
      </div>
      <div class="lane-track"></div>`;
    lane.querySelector(".ar").onclick = () => { state.pistaArmada = t.id; renderLanes(); };
    lane.querySelector(".mu").onclick = () => { t.muted = !t.muted; aplicarVolPista(t); renderLanes(); };
    lane.querySelector(".so").onclick = () => { t.solo = !t.solo; aplicarTodasVol(); renderLanes(); };
    lane.querySelector(".del").onclick = () => { state.pistas = state.pistas.filter(x => x.id !== t.id); renderLanes(); };
    lane.querySelector(".vol").addEventListener("input", (e) => { t.vol = Number(e.target.value); aplicarVolPista(t); });

    const track = lane.querySelector(".lane-track");
    track.style.width = (state.duracion * state.pxSeg) + "px";
    if (t.buffer) {
      const region = document.createElement("div");
      region.className = "region";
      region.style.left = (t.offset * state.pxSeg) + "px";
      region.style.width = Math.max(4, t.buffer.duration * state.pxSeg) + "px";
      region.style.border = `1px solid ${t.color}`;
      region.style.background = t.color + "33";
      region.innerHTML = `<div class="region-head" style="background:${t.color}33">${t.nombre}</div>${dibujarOnda(t.buffer, t.color)}`;
      track.appendChild(region);
    }
    list.appendChild(lane);
  });
}
function dibujarOnda(buffer, color) {
  const data = buffer.getChannelData(0);
  const pasos = 100, bloque = Math.max(1, Math.floor(data.length / pasos));
  let d = "M0,20";
  for (let i = 0; i < pasos; i++) {
    let max = 0;
    for (let j = 0; j < bloque; j++) { const v = Math.abs(data[i * bloque + j] || 0); if (v > max) max = v; }
    const y = 20 - max * 20;
    d += ` L${i},${y.toFixed(1)}`;
  }
  for (let i = pasos - 1; i >= 0; i--) {
    let max = 0;
    for (let j = 0; j < bloque; j++) { const v = Math.abs(data[i * bloque + j] || 0); if (v > max) max = v; }
    const y = 20 + max * 20;
    d += ` L${i},${y.toFixed(1)}`;
  }
  d += " Z";
  return `<svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d="${d}" fill="${color}" opacity="0.85"></path></svg>`;
}
function aplicarVolPista(t) {
  if (t.gainNode) t.gainNode.gain.value = t.muted ? 0 : (t.vol / 100) * 0.85;
}
function aplicarTodasVol() {
  const haySolo = state.pistas.some(t => t.solo);
  state.pistas.forEach(t => {
    if (t.gainNode) t.gainNode.gain.value = (t.muted || (haySolo && !t.solo)) ? 0 : (t.vol / 100) * 0.85;
  });
}

function nuevaPista(armar) {
  ensureBuses();
  const id = uid("t");
  const t = { id, nombre: "Pista " + (state.pistas.length + 1), color: LANE_COLORES[state.pistas.length % LANE_COLORES.length],
    buffer: null, vol: 85, muted: false, solo: false, offset: 0, gainNode: null };
  state.pistas.push(t);
  if (armar) state.pistaArmada = id;
  renderLanes();
  return t;
}
$("btnNuevaPista").onclick = () => nuevaPista(true);
$("btnNuevaPista2").onclick = () => nuevaPista(true);

function pistaDestino() {
  let t = state.pistas.find(x => x.id === state.pistaArmada && !x.buffer);
  if (!t) t = state.pistas.find(x => !x.buffer);
  return t || nuevaPista(true);
}

$("btnRec").onclick = async () => {
  if (state.recording) {
    state.recording = false;
    $("btnRec").textContent = "Grabar"; $("btnRec").classList.remove("on");
    const base64 = await bridge.StopRecordingWavBase64();
    if (base64) await colocarGrabacionEnPista(base64);
    return;
  }
  if (!state.conectado) {
    mostrarAviso("Sin entrada de audio: pulsa «Conectar entrada» primero.");
    return;
  }
  const destino = pistaDestino();
  state.pistaArmada = destino.id;
  await bridge.StartRecording();
  state.recording = true;
  $("btnRec").textContent = "Detener"; $("btnRec").classList.add("on");
};

async function colocarGrabacionEnPista(base64) {
  ensureBuses();
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    const buffer = await loopCtx.decodeAudioData(bytes.buffer);
    const t = state.pistas.find(x => x.id === state.pistaArmada) || nuevaPista(false);
    t.buffer = buffer;
    t.offset = state.cursor;
    t.gainNode = loopCtx.createGain();
    t.gainNode.connect(loopGain);
    aplicarVolPista(t);
    state.duracion = Math.max(state.duracion, t.offset + buffer.duration + 1);
    actualizarReglaYLanes();
  } catch (e) {
    mostrarAviso("No se pudo decodificar la grabación.");
  }
}

function mostrarAviso(txt) {
  $("avisoTexto").textContent = txt;
  $("aviso").classList.remove("hidden");
}
$("btnCerrarAviso").onclick = () => $("aviso").classList.add("hidden");

let fuentesActivas = [];
function detenerPistas() {
  fuentesActivas.forEach(s => { try { s.stop(); } catch (e) {} });
  fuentesActivas = [];
}
function reproducirPistas() {
  ensureBuses();
  detenerPistas();
  const c = loopCtx, t0 = c.currentTime + 0.05;
  aplicarTodasVol();
  state.pistas.forEach(t => {
    if (!t.buffer) return;
    const desde = state.cursor - t.offset;
    if (desde >= t.buffer.duration) return;
    const s = c.createBufferSource();
    s.buffer = t.buffer;
    s.connect(t.gainNode || loopGain);
    const cuando = desde < 0 ? t0 - desde : t0;
    s.start(cuando, Math.max(0, desde));
    fuentesActivas.push(s);
  });
}
$("btnLoopPlay").onclick = () => {
  state.reproduciendo = !state.reproduciendo;
  $("btnLoopPlay").classList.toggle("on", state.reproduciendo);
  $("btnLoopPlay").textContent = state.reproduciendo ? "Pausar loop" : "Reproducir loop";
  if (state.reproduciendo) reproducirPistas(); else detenerPistas();
};
$("btnVaciarLoop").onclick = () => {
  detenerPistas();
  state.pistas = [];
  state.duracion = 16;
  actualizarReglaYLanes();
};
$("zoomMas").onclick = () => { state.pxSeg = clamp(state.pxSeg * 1.25, 10, 400); actualizarReglaYLanes(); };
$("zoomMenos").onclick = () => { state.pxSeg = clamp(state.pxSeg / 1.25, 10, 400); actualizarReglaYLanes(); };
$("masTiempo").onclick = () => { state.duracion += 16; actualizarReglaYLanes(); };
$("rangoLatenciaComp").addEventListener("input", (e) => {
  state.latenciaCompensacionMs = Number(e.target.value);
  $("latenciaCompTxt").textContent = state.latenciaCompensacionMs;
});
$("btnMedirLatencia").onclick = async () => {
  const ms = await bridge.LatenciaMs();
  state.latenciaCompensacionMs = clamp(Math.round(ms / 5) * 5, 0, 250);
  $("rangoLatenciaComp").value = state.latenciaCompensacionMs;
  $("latenciaCompTxt").textContent = state.latenciaCompensacionMs;
};

$("inputImportar").addEventListener("change", async (e) => {
  ensureBuses();
  for (const file of e.target.files) {
    const bytes = await file.arrayBuffer();
    try {
      const buffer = await loopCtx.decodeAudioData(bytes);
      const t = nuevaPista(false);
      t.nombre = file.name.replace(/\.[^.]+$/, "").slice(0, 24);
      t.buffer = buffer; t.offset = state.cursor;
      t.gainNode = loopCtx.createGain(); t.gainNode.connect(loopGain);
      aplicarVolPista(t);
      state.duracion = Math.max(state.duracion, t.offset + buffer.duration + 1);
    } catch (err) { mostrarAviso("No se pudo importar " + file.name); }
  }
  actualizarReglaYLanes();
  e.target.value = "";
});

$("btnExportar").onclick = async () => {
  if (!state.pistas.some(t => t.buffer)) { mostrarAviso("No hay pistas grabadas para exportar."); return; }
  const dur = state.duracion, sr = loopCtx ? loopCtx.sampleRate : 48000;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  state.pistas.forEach(t => {
    if (!t.buffer || t.muted) return;
    const s = off.createBufferSource(); s.buffer = t.buffer;
    const g = off.createGain(); g.gain.value = (t.vol / 100) * 0.85;
    s.connect(g); g.connect(off.destination);
    s.start(t.offset);
  });
  const mezcla = await off.startRendering();
  const wav = bufferToWav(mezcla);
  const blob = new Blob([wav], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "mezcla.wav"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
function bufferToWav(buffer) {
  const nCh = buffer.numberOfChannels, len = buffer.length * nCh * 2 + 44;
  const ab = new ArrayBuffer(len), view = new DataView(ab);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, len - 8, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, nCh, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * nCh * 2, true); view.setUint16(32, nCh * 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, len - 44, true);
  let offset = 44;
  const chans = []; for (let i = 0; i < nCh; i++) chans.push(buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      const s = clamp(chans[ch][i], -1, 1);
      view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
      offset += 2;
    }
  }
  return ab;
}

$("timelineScroll").addEventListener("scroll", () => {});
document.getElementById("reglaMarks").addEventListener("mousedown", (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  state.cursor = clamp((e.clientX - rect.left) / state.pxSeg, 0, state.duracion);
  actualizarCursorUI();
});
function actualizarCursorUI() {
  $("cursorTxt").textContent = fmtTime(state.cursor);
  $("playhead").style.left = (state.cursor * state.pxSeg) + "px";
  $("infoLoop").textContent = fmtTime(state.cursor) + " / " + fmtTime(state.duracion);
}
setInterval(() => {
  if (state.reproduciendo && loopCtx) {
    state.cursor += 0.1;
    if (state.cursor >= state.duracion) { state.cursor = 0; if (state.reproduciendo) reproducirPistas(); }
    actualizarCursorUI();
  }
}, 100);

/* =====================================================================
   Muestras (sustituyen la sintesis de banda por audio real)
   ===================================================================== */

function initMuestras() {
  const box = $("muestrasList");
  box.innerHTML = "";
  [["kick","Bombo"],["snare","Caja"],["hat","Hi-hat"],["bass","Bajo (una nota)"]].forEach(([key, label]) => {
    const row = document.createElement("label");
    row.className = "sample-row";
    row.innerHTML = `<span class="nm">${label}</span><span class="st" id="mst_${key}">sin cargar</span>
      <input type="file" accept="audio/*" style="display:none">`;
    row.querySelector("input").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      ensureBuses();
      try {
        const buffer = await loopCtx.decodeAudioData(await file.arrayBuffer());
        state.muestras[key] = buffer;
        $("mst_" + key).textContent = "cargado";
      } catch (err) { $("mst_" + key).textContent = "error"; }
    });
    box.appendChild(row);
  });
}
$("btnQuitarMuestras").onclick = () => {
  state.muestras = {};
  document.querySelectorAll("[id^=mst_]").forEach(el => el.textContent = "sin cargar");
};

/* =====================================================================
   MIDI
   ===================================================================== */

$("btnMidi").onclick = async () => {
  if (!navigator.requestMIDIAccess) { $("midiDisp").textContent = "Web MIDI no disponible en este entorno."; return; }
  try {
    const acceso = await navigator.requestMIDIAccess();
    const box = $("midiDisp"); box.innerHTML = "";
    const entradas = Array.from(acceso.inputs.values());
    if (!entradas.length) { box.innerHTML = "<span class='midi-item'>Sin dispositivos MIDI</span>"; }
    entradas.forEach(dev => {
      const s = document.createElement("span"); s.className = "midi-item"; s.textContent = dev.name;
      box.appendChild(s);
      dev.onmidimessage = onMidiMessage;
    });
    $("btnMidi").textContent = "MIDI activo (" + entradas.length + ")";
  } catch (e) {
    $("midiDisp").textContent = "No se pudo activar MIDI: " + e.message;
  }
};
function onMidiMessage(msg) {
  const [status, d1, d2] = msg.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && d2 > 0) {
    $("midiNota").textContent = NOTAS[d1 % 12] + Math.floor(d1 / 12 - 1);
    ensureBuses();
    const t = loopCtx.currentTime, o = loopCtx.createOscillator(), g = loopCtx.createGain();
    o.type = "sawtooth"; o.frequency.value = midiToFreq(d1, 440);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(masterLoop); o.start(t); o.stop(t + 0.65);
  } else if (cmd === 0xb0 && d1 === 7) {
    state.amp.vol = Math.round((d2 / 127) * 100);
    $("ampR_vol").value = state.amp.vol; $("ampV_vol").textContent = state.amp.vol;
    enviarAmpParams();
  } else if (cmd === 0xfa) { // start
    state.reproduciendo = true; reproducirPistas();
  } else if (cmd === 0xfc) { // stop
    state.reproduciendo = false; detenerPistas();
  }
}

/* =====================================================================
   YouTube (IFrame API) - practica con A/B loop y velocidad
   ===================================================================== */

let ytApiListo = false, ytPlayer = null;
function cargarYtApi() {
  if (window.YT && window.YT.Player) { ytApiListo = true; return; }
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => { ytApiListo = true; };
}
function extraerIdYoutube(url) {
  const m = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/.exec(url || "");
  return m ? m[1] : (url || "").trim();
}
$("btnCargarYt").onclick = () => {
  const id = extraerIdYoutube($("ytUrl").value);
  if (!id) return;
  if (!ytApiListo || !window.YT) { setTimeout(() => $("btnCargarYt").onclick(), 400); return; }
  if (ytPlayer) { ytPlayer.loadVideoById(id); return; }
  ytPlayer = new YT.Player("ytHost", { videoId: id, playerVars: { rel: 0 } });
};
$("btnYtPlay").onclick = () => {
  if (!ytPlayer) return;
  const st = ytPlayer.getPlayerState();
  if (st === 1) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
};
$("btnMarcarA").onclick = () => { if (ytPlayer) { state.ytA = ytPlayer.getCurrentTime(); $("marcaA").textContent = fmtTime(state.ytA); } };
$("btnMarcarB").onclick = () => { if (ytPlayer) { state.ytB = ytPlayer.getCurrentTime(); $("marcaB").textContent = fmtTime(state.ytB); } };
$("btnToggleAB").onclick = () => { state.ytAB = !state.ytAB; $("btnToggleAB").classList.toggle("on", state.ytAB); };
$("rangoVelocidad").addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  $("velTxt").textContent = v.toFixed(2);
  if (ytPlayer) ytPlayer.setPlaybackRate(v);
});
setInterval(() => {
  if (ytPlayer && state.ytAB && state.ytB > state.ytA) {
    const t = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    if (t >= state.ytB) ytPlayer.seekTo(state.ytA, true);
  }
}, 250);

/* =====================================================================
   Panel inferior: pestañas + redimensionar
   ===================================================================== */

document.querySelectorAll("#panelTabs button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#panelTabs button").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    document.querySelectorAll(".panel-view").forEach(v => v.classList.remove("on"));
    $("view" + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).classList.add("on");
  };
});
(function initDragHandle() {
  const handle = $("dragHandle"), panel = $("bottomPanel");
  handle.addEventListener("pointerdown", (e) => {
    const y0 = e.clientY, h0 = panel.getBoundingClientRect().height;
    const mover = (ev) => { panel.style.height = clamp(h0 - (ev.clientY - y0), 160, 640) + "px"; };
    const soltar = () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  });
})();

/* =====================================================================
   Arranque
   ===================================================================== */

function init() {
  initSelectsBasicos();
  initCuerdasRef();
  initPulsos();
  initMeterBars();
  initCatalogoPedales();
  initPresetsAmp();
  initMandosAmp();
  initEjesEspectro();
  initMuestras();
  actualizarBpmUI();
  actualizarBadgeEntrada();
  actualizarBotonAmp();
  actualizarAcordeUI();
  actualizarSecuenciaUI();
  renderDiapason();
  renderChainRack();
  actualizarReglaYLanes();
  actualizarCursorUI();
  cargarYtApi();
  requestAnimationFrame(pasoEspectrograma);
}
init();
