// src/main.js
import { buildSchedule } from "./engine.js";
import { create3DViewer } from "./view3d.js";

const $ = (id) => document.getElementById(id);

let scenario = null;
let layout = null;
let sim = null;

let viewer3D = null;
let clockTimer = null;

function log(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${path}`);
  return await res.json();
}

/* ---------------- Timeline 2D ---------------- */

function renderTimeline() {
  if (!sim?.rows?.length) return;

  const canvas = $("timeline");
  const ctx = canvas.getContext("2d");

  const scale = Number($("scale")?.value ?? 2);
  const maxRows = Number($("maxRows")?.value ?? 60);

  const rows = sim.rows.slice(0, maxRows);

  // auto ancho mínimo
  const tMax = Math.max(...rows.map(r => r.endMargen));
  const neededW = Math.max(900, 80 + tMax * scale + 80);
  canvas.width = Math.min(2400, Math.floor(neededW));
  canvas.height = Math.max(300, 30 + rows.length * 14);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // eje
  ctx.fillStyle = "#111";
  ctx.font = "12px system-ui";
  ctx.fillText("min →", 10, 18);

  let y = 30;

  for (const r of rows) {
    ctx.fillStyle = "#666";
    ctx.font = "10px system-ui";
    ctx.fillText(String(r.id).padStart(2, "0"), 10, y + 9);

    drawBar(r.startValidacion, r.endValidacion, y, "#f59e0b"); // valid
    drawBar(r.startCambiador, r.endCambiador, y, "#3b82f6");   // camb
    drawBar(r.startScan, r.endScan, y, "#22c55e");             // scan
    drawBar(r.startSalidaCambio, r.endSalidaCambio, y, "#a855f7"); // out
    drawBar(r.startMargen, r.endMargen, y, "#ef4444");         // margen

    y += 14;
  }

  function drawBar(t0, t1, y, color) {
    const x = 60 + t0 * scale;
    const w = Math.max(1, (t1 - t0) * scale);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 10);
  }
}

/* ---------------- Table ---------------- */

function renderTable() {
  // Si tu index no tiene tabla, no rompe.
  const thead = $("thead");
  const tbody = $("tbody");
  if (!thead || !tbody) return;

  const cols = [
    ["id", "Paciente", "left"],
    ["tipo", "Tipo", "left"],
    ["turnoAsignado", "Turno (min)", ""],
    ["llegada", "Llegada (min)", ""],
    ["horaLlegada", "Hora llegada", "left"],
    ["validacion", "Validación", ""],
    ["cambiador", "Cambiador", ""],
    ["scan", "Scan", ""],
    ["salidaCambio", "Salida+cambio", ""],
    ["margen", "Margen", ""],
    ["tiempoTotalServicio", "Total servicio", ""],
    ["horaSalida", "Hora salida", "left"],
    ["espera", "Espera", ""],
  ];

  thead.innerHTML = `<tr>${cols.map(c => `<th class="${c[2] || ""}">${c[1]}</th>`).join("")}</tr>`;
  tbody.innerHTML = sim.rows.map(r => {
    return `<tr>${
      cols.map(c => {
        const k = c[0];
        const v = r[k];
        const isNum = typeof v === "number";
        const txt = isNum ? v.toFixed(2) : String(v);
        return `<td class="${c[2] || ""}">${txt}</td>`;
      }).join("")
    }</tr>`;
  }).join("");
}

/* ---------------- 3D ---------------- */

function init3D() {
  if (!sim?.rows?.length) return;

  const canvas = $("view3d");
  if (!canvas) return;

  viewer3D = create3DViewer(canvas, layout);
  viewer3D.load(sim.rows);
  viewer3D.setSpeed(Number($("speed3D")?.value ?? 10));

  $("btnPlay3D") && ($("btnPlay3D").disabled = false);
  $("btnWpMode") && ($("btnWpMode").disabled = false);
  $("btnEdgeMode") && ($("btnEdgeMode").disabled = false);
  $("btnExportLayout") && ($("btnExportLayout").disabled = false);

  if (!clockTimer && $("clock3D")) {
    clockTimer = setInterval(() => {
      $("clock3D").textContent = `t=${viewer3D.getTime().toFixed(1)} min`;
    }, 200);
  }
}

function wire3DControls() {
  $("btn3D") && ($("btn3D").onclick = () => init3D());
  $("btnPlay3D") && ($("btnPlay3D").onclick = () => viewer3D?.toggle());
  $("speed3D") && ($("speed3D").oninput = () => viewer3D?.setSpeed(Number($("speed3D").value)));

  $("btnWpMode") && ($("btnWpMode").onclick = () => viewer3D?.setEditorMode("wp"));
  $("btnEdgeMode") && ($("btnEdgeMode").onclick = () => viewer3D?.setEditorMode("edge"));

  $("btnExportLayout") && ($("btnExportLayout").onclick = () => {
    const obj = viewer3D?.exportLayout();
    if (!obj) return;
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "layout.json";
    a.click();
  });
}

/* ---------------- Boot ---------------- */

async function boot() {
  try {
    scenario = await loadJSON("./escenario.json");
    layout = await loadJSON("./layout.json");
    log("Cargado: escenario.json + layout.json");

    // UI
    wire3DControls();

    $("btnSim") && ($("btnSim").onclick = () => {
      sim = buildSchedule(scenario);

      $("btnTimeline") && ($("btnTimeline").disabled = false);
      $("btn3D") && ($("btn3D").disabled = false);

      renderTimeline();
      renderTable();

      log(`Simulación OK: n=${sim.n} pacientes | fin=${sim.rows.at(-1)?.endMargen?.toFixed(1)} min`);
    });

    $("btnTimeline") && ($("btnTimeline").onclick = () => renderTimeline());

  } catch (e) {
    console.error(e);
    log("Error: " + e.message);
  }
}

boot();
