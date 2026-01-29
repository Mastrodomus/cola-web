import plantillaRaw from "../plantilla.json";
import { simulateDay } from "./engine.js";

let plantilla = structuredClone(plantillaRaw);
let lastRows = null;

const formRoot = document.getElementById("formRoot");
const btnSim = document.getElementById("btnSim");
const btnCSV = document.getElementById("btnCSV");
const btnJSON = document.getElementById("btnJSON");
const kpisEl = document.getElementById("kpis");
const thead = document.getElementById("thead");
const tbody = document.getElementById("tbody");

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function hhmmToMin(hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
}
function minutesToHHMM(minFromStart, startHHMM) {
  const base = hhmmToMin(startHHMM);
  const totalMin = base + minFromStart;
  const hh = Math.floor(totalMin / 60);
  const mm = Math.floor(totalMin % 60);
  const ampm = hh >= 12 ? "p.m." : "a.m.";
  const hh12 = ((hh + 11) % 12) + 1;
  return `${hh12}:${mm.toString().padStart(2, "0")} ${ampm}`;
}

function inputNumber(labelText, value, onChange, opts = {}) {
  const wrap = document.createElement("div");
  wrap.style.minWidth = "160px";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.value = value;
  if (opts.step) input.step = opts.step;
  if (opts.min !== undefined) input.min = opts.min;
  if (opts.max !== undefined) input.max = opts.max;
  input.className = opts.small ? "small" : "";
  input.addEventListener("input", () => onChange(Number(input.value)));
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}
function inputText(labelText, value, onChange) {
  const wrap = document.createElement("div");
  wrap.style.minWidth = "160px";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

function section(title) {
  const div = document.createElement("div");
  div.className = "card";
  div.style.margin = "10px 0";
  const h = document.createElement("h4");
  h.textContent = title;
  h.style.margin = "0 0 10px";
  div.appendChild(h);
  return div;
}
function rowContainer() {
  const div = document.createElement("div");
  div.className = "row";
  return div;
}

function renderForm() {
  formRoot.innerHTML = "";

  // Día
  const sDay = section("Día");
  const rDay = rowContainer();
  rDay.appendChild(inputText("Inicio (HH:MM)", plantilla.day.start, v => plantilla.day.start = v));
  rDay.appendChild(inputText("Fin (HH:MM)", plantilla.day.end, v => plantilla.day.end = v));
  rDay.appendChild(inputNumber("λ resonancias/día", plantilla.day.lambdaPerDay, v => plantilla.day.lambdaPerDay = Math.max(0, v), { step: "1", min: 0 }));
  rDay.appendChild(inputNumber("Seed", plantilla.day.seed, v => plantilla.day.seed = Math.floor(v), { step: "1", min: 0 }));
  sDay.appendChild(rDay);
  formRoot.appendChild(sDay);

  // Mix
  const sMix = section("Mix (triangular alrededor del mode)");
  const rMix1 = rowContainer();
  rMix1.appendChild(inputNumber("Volatilidad triangular (0-1)", plantilla.mix.triangularVolatility, v => plantilla.mix.triangularVolatility = clamp01(v), { step: "0.01", min: 0, max: 1 }));
  sMix.appendChild(rMix1);

  const rMix2 = rowContainer();
  for (const k of Object.keys(plantilla.mix.mode)) {
    rMix2.appendChild(inputNumber(`P(mode) ${k}`, plantilla.mix.mode[k], v => plantilla.mix.mode[k] = clamp01(v), { step: "0.01", min: 0, max: 1, small: true }));
  }
  sMix.appendChild(rMix2);
  formRoot.appendChild(sMix);

  // Service time total
  const sSvc = section("Tiempo total por estudio (Normal truncada)");
  const rSvc1 = rowContainer();
  rSvc1.appendChild(inputNumber("CV total (σ = μ·CV)", plantilla.serviceTime.cv, v => plantilla.serviceTime.cv = Math.max(0, v), { step: "0.01", min: 0 }));
  rSvc1.appendChild(inputNumber("Clamp mínimo (min)", plantilla.serviceTime.minClamp ?? 1, v => plantilla.serviceTime.minClamp = Math.max(0, v), { step: "1", min: 0 }));
  sSvc.appendChild(rSvc1);

  const rSvc2 = rowContainer();
  for (const k of Object.keys(plantilla.serviceTime.meansMin)) {
    rSvc2.appendChild(inputNumber(`μ ${k} (min)`, plantilla.serviceTime.meansMin[k], v => plantilla.serviceTime.meansMin[k] = Math.max(0, v), { step: "0.01", min: 0, small: true }));
  }
  sSvc.appendChild(rSvc2);
  formRoot.appendChild(sSvc);

  // Stages
  const sStages = section("Etapas (shares suman 1)");
  const rSt1 = rowContainer();
  rSt1.appendChild(inputNumber("enabled (1/0)", plantilla.stages.enabled ? 1 : 0, v => plantilla.stages.enabled = !!Math.round(v), { step: "1", min: 0, max: 1 }));
  sStages.appendChild(rSt1);

  const rSt2 = rowContainer();
  for (const k of Object.keys(plantilla.stages.shares)) {
    rSt2.appendChild(inputNumber(`share ${k}`, plantilla.stages.shares[k], v => plantilla.stages.shares[k] = Math.max(0, v), { step: "0.01", min: 0, max: 1, small: true }));
  }
  sStages.appendChild(rSt2);

  const rSt3 = rowContainer();
  for (const k of Object.keys(plantilla.stages.stageCv)) {
    rSt3.appendChild(inputNumber(`cv ${k}`, plantilla.stages.stageCv[k], v => plantilla.stages.stageCv[k] = Math.max(0, v), { step: "0.01", min: 0, small: true }));
  }
  sStages.appendChild(rSt3);

  formRoot.appendChild(sStages);
}

function renderKPIs(rows) {
  const start = plantilla.day.start;
  const horizon = hhmmToMin(plantilla.day.end) - hhmmToMin(plantilla.day.start);

  const N = rows.length;
  const lastFinish = N ? Math.max(...rows.map(r => r.salida)) : 0;
  const overtime = Math.max(0, lastFinish - horizon);

  // Utilización por estación = suma(service)/horizon (aprox, si 1 servidor)
  const utilScan = N ? (rows.reduce((a, r) => a + r.scan, 0) / horizon) : 0;
  const utilMesa = N ? (rows.reduce((a, r) => a + r.validacion + r.margen, 0) / horizon) : 0;
  const utilCamb = N ? (rows.reduce((a, r) => a + r.cambiador + r.salidaCambio, 0) / horizon) : 0;

  const avgWaitScan = N ? rows.reduce((a, r) => a + r.waitScan, 0) / N : 0;
  const avgSys = N ? rows.reduce((a, r) => a + r.tiempoTotalSistema, 0) / N : 0;

  const maxQueueScan = estimateMaxConcurrent(rows, "startScan", "endScan", "startCambiador", "endCambiador"); // aproximación usable

  const items = [
    ["Pacientes (N)", String(N)],
    ["Utilización Resonador", (utilScan * 100).toFixed(1) + "%"],
    ["Utilización Mesa", (utilMesa * 100).toFixed(1) + "%"],
    ["Utilización Cambiador", (utilCamb * 100).toFixed(1) + "%"],
    ["Espera prom. pre-scan", avgWaitScan.toFixed(2) + " min"],
    ["Tiempo sistema prom.", avgSys.toFixed(2) + " min"],
    ["Hora última salida", N ? minutesToHHMM(lastFinish, start) : "-"],
    ["Overtime", overtime.toFixed(2) + " min"]
  ];

  kpisEl.innerHTML = "";
  for (const [k, v] of items) {
    const d = document.createElement("div");
    d.innerHTML = `<div class="muted">${k}</div><div style="font-size:18px;font-weight:700">${v}</div>`;
    kpisEl.appendChild(d);
  }
}

// Estimación simple de “presión” de cola: no es la cola exacta,
// pero sirve como indicador hasta que loguemos eventos.
function estimateMaxConcurrent(rows) {
  // eventos de inicio y fin scan (ocupación)
  const events = [];
  for (const r of rows) {
    events.push({ t: r.startScan, d: +1 });
    events.push({ t: r.endScan, d: -1 });
  }
  events.sort((a, b) => a.t - b.t || b.d - a.d);
  let cur = 0, max = 0;
  for (const e of events) {
    cur += e.d;
    if (cur > max) max = cur;
  }
  return max;
}

function renderTable(rows) {
  // columnas “tipo Sheet”
  const cols = [
    { key: "id", label: "Paciente", align: "left" },
    { key: "tipo", label: "Tipo de estudio", align: "left" },
    { key: "horaLlegada", label: "Horario llegada", align: "left" },
    { key: "validacion", label: "Validación" },
    { key: "cambiador", label: "Cambiador" },
    { key: "scan", label: "Scan" },
    { key: "salidaCambio", label: "Salida - cambio" },
    { key: "margen", label: "Margen de error" },
    { key: "tiempoTotalServicio", label: "Tiempo total servicio" },
    { key: "horaSalida", label: "Horario salida", align: "left" }
  ];

  thead.innerHTML = "";
  const trh = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c.label;
    th.className = c.align === "left" ? "left" : "";
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");

    const tiempoTotalServicio = r.validacion + r.cambiador + r.scan + r.salidaCambio + r.margen;

    const view = {
      ...r,
      horaLlegada: minutesToHHMM(r.llegada, plantilla.day.start),
      horaSalida: minutesToHHMM(r.salida, plantilla.day.start),
      validacion: r.validacion.toFixed(2),
      cambiador: r.cambiador.toFixed(2),
      scan: r.scan.toFixed(2),
      salidaCambio: r.salidaCambio.toFixed(2),
      margen: r.margen.toFixed(2),
      tiempoTotalServicio: tiempoTotalServicio.toFixed(2)
    };

    for (const c of cols) {
      const td = document.createElement("td");
      td.textContent = view[c.key] ?? "";
      td.className = c.align === "left" ? "left" : "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function downloadText(filename, text, mime="text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toCSV(rows) {
  const headers = [
    "Paciente","Tipo","LlegadaMin","HorarioLlegada",
    "Validacion","Cambiador","Scan","SalidaCambio","Margen",
    "TiempoTotalServicio","SalidaMin","HorarioSalida",
    "StartValidacion","EndValidacion","StartCambiador","EndCambiador","StartScan","EndScan","StartSalidaCambio","EndSalidaCambio","StartMargen","EndMargen",
    "WaitValidacion","WaitCambiador","WaitScan","WaitSalidaCambio","WaitMargen"
  ];
  const lines = [headers.join(",")];

  for (const r of rows) {
    const tts = r.validacion + r.cambiador + r.scan + r.salidaCambio + r.margen;
    const vals = [
      r.id, r.tipo,
      r.llegada.toFixed(2), minutesToHHMM(r.llegada, plantilla.day.start),
      r.validacion.toFixed(2), r.cambiador.toFixed(2), r.scan.toFixed(2), r.salidaCambio.toFixed(2), r.margen.toFixed(2),
      tts.toFixed(2),
      r.salida.toFixed(2), minutesToHHMM(r.salida, plantilla.day.start),
      r.startValidacion.toFixed(2), r.endValidacion.toFixed(2),
      r.startCambiador.toFixed(2), r.endCambiador.toFixed(2),
      r.startScan.toFixed(2), r.endScan.toFixed(2),
      r.startSalidaCambio.toFixed(2), r.endSalidaCambio.toFixed(2),
      r.startMargen.toFixed(2), r.endMargen.toFixed(2),
      r.waitValidacion.toFixed(2), r.waitCambiador.toFixed(2), r.waitScan.toFixed(2), r.waitSalidaCambio.toFixed(2), r.waitMargen.toFixed(2)
    ];
    lines.push(vals.join(","));
  }
  return lines.join("\n");
}

btnSim.addEventListener("click", () => {
  lastRows = simulateDay(plantilla);
  renderKPIs(lastRows);
  renderTable(lastRows);
  btnCSV.disabled = false;
  btnJSON.disabled = false;
});

btnCSV.addEventListener("click", () => {
  if (!lastRows) return;
  downloadText("escenario.csv", toCSV(lastRows), "text/csv");
});

btnJSON.addEventListener("click", () => {
  if (!lastRows) return;
  const payload = { plantilla, generatedAt: new Date().toISOString(), rows: lastRows };
  downloadText("escenario.json", JSON.stringify(payload, null, 2), "application/json");
});

// Init
renderForm();
