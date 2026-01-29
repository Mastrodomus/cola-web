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

function minutesToHHMM(minFromStart) {
  // día arranca 08:00 por tu definición
  const startHour = 8;
  const totalMin = startHour * 60 + minFromStart;
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
  rDay.appendChild(inputNumber("λ resonancias/día", plantilla.day.lambdaPerDay, v => plantilla.day.lambdaPerDay = v, { step: "1", min: 0 }));
  rDay.appendChild(inputNumber("Seed", plantilla.day.seed, v => plantilla.day.seed = Math.floor(v), { step: "1", min: 0 }));
  // horario fijo 08-20 según vos (lo dejamos visible pero no editable)
  const info = document.createElement("div");
  info.className = "muted";
  info.textContent = "Horario fijo: 08:00–20:00 (720 min)";
  sDay.appendChild(rDay);
  sDay.appendChild(info);
  formRoot.appendChild(sDay);

  // Mix
  const sMix = section("Mix de estudios");
  const rMix1 = rowContainer();
  rMix1.appendChild(inputNumber("Volatilidad triangular (0-1)", plantilla.mix.triangularVolatility, v => plantilla.mix.triangularVolatility = clamp01(v), { step: "0.01", min: 0, max: 1 }));
  sMix.appendChild(rMix1);

  const rMix2 = rowContainer();
  for (const k of Object.keys(plantilla.mix.base)) {
    rMix2.appendChild(inputNumber(`P(base) ${k}`, plantilla.mix.base[k], v => plantilla.mix.base[k] = clamp01(v), { step: "0.01", min: 0, max: 1, small: true }));
  }
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "Tip: si las P(base) no suman 1, el engine normaliza automáticamente a nivel día.";
  sMix.appendChild(rMix2);
  sMix.appendChild(note);
  formRoot.appendChild(sMix);

  // Tiempos totales
  const sSvc = section("Tiempo total por estudio (Normal truncada)");
  const rSvc1 = rowContainer();
  rSvc1.appendChild(inputNumber("CV total (σ = μ·CV)", plantilla.serviceTotal.cvTotal, v => plantilla.serviceTotal.cvTotal = Math.max(0, v), { step: "0.01", min: 0 }));
  rSvc1.appendChild(inputNumber("Clamp mínimo (min)", plantilla.serviceTotal.minClamp ?? 1, v => plantilla.serviceTotal.minClamp = Math.max(0, v), { step: "1", min: 0 }));
  sSvc.appendChild(rSvc1);

  const rSvc2 = rowContainer();
  for (const k of Object.keys(plantilla.serviceTotal.meansMin)) {
    rSvc2.appendChild(inputNumber(`μ ${k} (min)`, plantilla.serviceTotal.meansMin[k], v => plantilla.serviceTotal.meansMin[k] = Math.max(0, v), { step: "0.01", min: 0, small: true }));
  }
  sSvc.appendChild(rSvc2);
  formRoot.appendChild(sSvc);

  // Shares
  const sShares = section("Shares por etapa (suman 1)");
  const rSh = rowContainer();
  for (const k of Object.keys(plantilla.shares)) {
    rSh.appendChild(inputNumber(k, plantilla.shares[k], v => plantilla.shares[k] = Math.max(0, v), { step: "0.01", min: 0, max: 1, small: true }));
  }
  const warn = document.createElement("div");
  warn.className = "muted";
  warn.textContent = "Si no suman 1 exacto, el engine no las corrige: ajustalas para mantener consistencia.";
  sShares.appendChild(rSh);
  sShares.appendChild(warn);
  formRoot.appendChild(sShares);

  // Capacidad (para futuro; hoy fijo 1, pero lo dejamos visible)
  const sCap = section("Capacidad (servidores)");
  const rCap = rowContainer();
  rCap.appendChild(inputNumber("Mesa", plantilla.capacity.mesa, v => plantilla.capacity.mesa = Math.max(1, Math.floor(v)), { step: "1", min: 1, small: true }));
  rCap.appendChild(inputNumber("Cambiador", plantilla.capacity.cambiador, v => plantilla.capacity.cambiador = Math.max(1, Math.floor(v)), { step: "1", min: 1, small: true }));
