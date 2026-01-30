import { create3DViewer } from "./view3d.js";

const $ = (id) => document.getElementById(id);

let rows = [];
let viewer3D = null;
let layout = null;
let clockTimer = null;

function log(msg) {
  $("status").textContent = msg;
}

async function loadLayout() {
  const res = await fetch("./layout.json", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar layout.json");
  return await res.json();
}

/* ---------------- Simulación simple (placeholder estable) ---------------- */

function simulate() {
  const out = [];
  let t = 0;

  for (let i = 0; i < 24; i++) {
    const valid = 2 + Math.random() * 3;
    const camb = 3 + Math.random() * 4;
    const scan = 12 + Math.random() * 15;
    const marg = 1 + Math.random() * 2;

    const startValidacion = t;
    const endValidacion = startValidacion + valid;

    const startCambiador = endValidacion;
    const endCambiador = startCambiador + camb;

    const startScan = endCambiador;
    const endScan = startScan + scan;

    const startMargen = endScan;
    const endMargen = startMargen + marg;

    out.push({
      id: i + 1,
      startValidacion, endValidacion,
      startCambiador, endCambiador,
      startScan, endScan,
      startMargen, endMargen
    });

    t = endMargen;
  }

  return out;
}

/* ---------------- Timeline 2D ---------------- */

function renderTimeline() {
  const canvas = $("timeline");
  const ctx = canvas.getContext("2d");
  const scale = Number($("scale").value);
  const maxRows = Number($("maxRows").value);

  const show = rows.slice(0, maxRows);

  ctx.clearRect(0,0,canvas.width,canvas.height);

  let y = 20;

  for (const r of show) {
    drawBar(r.startValidacion, r.endValidacion, y, "orange");
    drawBar(r.startCambiador, r.endCambiador, y, "blue");
    drawBar(r.startScan, r.endScan, y, "green");
    drawBar(r.startMargen, r.endMargen, y, "red");
    y += 12;
  }

  function drawBar(t0, t1, y, color) {
    const x = t0 * scale + 40;
    const w = (t1 - t0) * scale;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 10);
  }
}

/* ---------------- UI ---------------- */

$("btnSim").onclick = () => {
  rows = simulate();
  $("btnTimeline").disabled = false;
  $("btn3D").disabled = false;
  log(`Simulados ${rows.length} pacientes`);
};

$("btnTimeline").onclick = () => {
  renderTimeline();
  log("Timeline renderizado");
};

$("btn3D").onclick = async () => {
  layout = await loadLayout();

  viewer3D = create3DViewer($("view3d"), layout);
  viewer3D.load(rows);

  $("btnPlay3D").disabled = false;
  $("btnWpMode").disabled = false;
  $("btnEdgeMode").disabled = false;
  $("btnExportLayout").disabled = false;

  viewer3D.setSpeed(Number($("speed3D").value));

  if (!clockTimer) {
    clockTimer = setInterval(() => {
      $("clock3D").textContent = "t=" + viewer3D.getTime().toFixed(1) + " min";
    }, 200);
  }

  log("Vista 3D inicializada");
};

$("btnPlay3D").onclick = () => viewer3D.toggle();

$("speed3D").oninput = () => {
  viewer3D?.setSpeed(Number($("speed3D").value));
};

$("btnWpMode").onclick = () => {
  viewer3D.setEditorMode("wp");
  $("wpHint").textContent = "Modo Waypoints: click crea punto. Shift+click borra.";
};

$("btnEdgeMode").onclick = () => {
  viewer3D.setEditorMode("edge");
  $("wpHint").textContent = "Modo Conectar: click A y luego B.";
};

$("btnExportLayout").onclick = () => {
  const obj = viewer3D.exportLayout();
  const blob = new Blob([JSON.stringify(obj,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "layout.json";
  a.click();
};
