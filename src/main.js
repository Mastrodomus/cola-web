import { create3DViewer } from "./view3d.js";

/* ---------------- helpers ---------------- */

const $ = (id) => document.getElementById(id);

function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt;
}

function enable(id, on) {
  const el = $(id);
  if (el) el.disabled = !on;
}

function toast(msg) {
  // simple “status line” bajo los botones si existe, si no, console
  const el = $("status");
  if (el) el.textContent = msg;
  else console.log(msg);
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${res.status})`);
  return await res.json();
}

/* ---------------- state ---------------- */

let layout = null;
let scenario = null;

let rows = [];
let viewer3D = null;
let clockTimer = null;

/* ---------------- 2D timeline ---------------- */

function renderTimeline(rows) {
  const canvas = $("timeline");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const pxPerMin = Number($("scale")?.value || 2);
  const maxRows = Number($("maxRows")?.value || 60);

  const show = rows.slice(0, maxRows);
  const rowH = 12;
  const leftPad = 34;
  const topPad = 24;

  // ancho fijo (podés hacerlo dinámico por max tiempo)
  canvas.width = 1400;
  canvas.height = Math.max(320, topPad + show.length * rowH + 20);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "#666";
  ctx.fillText("min", 6, 14);

  // grilla de tiempo
  ctx.strokeStyle = "#eee";
  ctx.lineWidth = 1;
  for (let m = 0; m <= 12 * 60; m += 30) {
    const x = leftPad + m * pxPerMin;
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  // barras por etapa
  for (let i = 0; i < show.length; i++) {
    const r = show[i];
    const y = topPad + i * rowH;

    // id
    ctx.fillStyle = "#111";
    ctx.fillText(String(r.id), 6, y + 9);

    drawBar(r.startValidacion, r.endValidacion, y, "#f59e0b"); // validación
    drawBar(r.startCambiador, r.endCambiador, y, "#3b82f6");   // cambiador
    drawBar(r.startScan, r.endScan, y, "#10b981");             // scan
    drawBar(r.startMargen, r.endMargen, y, "#ef4444");         // margen
  }

  function drawBar(t0, t1, y, color) {
    const x = leftPad + t0 * pxPerMin;
    const w = Math.max(1, (t1 - t0) * pxPerMin);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, rowH - 2);
  }
}

/* ---------------- simulación (placeholder estable) ----------------
   Esto te mantiene todo funcionando mientras enchufamos engine real.
------------------------------------------------------------------- */

function simulatePlaceholder() {
  // si scenario existe y trae lambdaPerDay, lo usamos
  const lambda = scenario?.day?.lambdaPerDay ?? 24;
  const n = Math.max(5, Math.round(lambda));

  const out = [];
  let t = 0;

  for (let i = 0; i < n; i++) {
    // tiempos coherentes (minutos)
    const valid = 2 + Math.random() * 4;
    const camb = 3 + Math.random() * 5;
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

    // pequeña separación entre pacientes (simula gap)
    t = endMargen + (Math.random() < 0.15 ? 2 : 0);
  }

  return out;
}

/* ---------------- UI wiring ---------------- */

async function init() {
  // botones
  const btnSim = $("btnSim");
  const btnTimeline = $("btnTimeline");
  const btn3D = $("btn3D");
  const btnPlay3D = $("btnPlay3D");
  const speed3D = $("speed3D");

  const btnWpMode = $("btnWpMode");
  const btnEdgeMode = $("btnEdgeMode");
  const btnExportLayout = $("btnExportLayout");

  // estado inicial
  enable("btnTimeline", false);
  enable("btn3D", false);
  enable("btnPlay3D", false);
  enable("btnWpMode", false);
  enable("btnEdgeMode", false);
  enable("btnExportLayout", false);

  setText("clock3D", "t=0.0 min");
  toast("Listo. Click en Simular.");

  // cargamos layout y escenario (si falta alguno, no rompemos)
  try {
    layout = await fetchJSON("./layout.json");
  } catch (e) {
    console.warn(e);
    toast("Aviso: no pude cargar layout.json todavía.");
  }

  try {
    scenario = await fetchJSON("./escenario.json");
  } catch (e) {
    console.warn(e);
    // no obligatorio
  }

  // --- Simular ---
  btnSim?.addEventListener("click", () => {
    try {
      rows = simulatePlaceholder();
      enable("btnTimeline", true);
      enable("btn3D", true);
      toast(`OK: simulados ${rows.length} pacientes.`);
    } catch (e) {
      console.error(e);
      toast("ERROR simulando: " + (e?.message || String(e)));
    }
  });

  // --- Timeline ---
  btnTimeline?.addEventListener("click", () => {
    try {
      renderTimeline(rows);
      toast("Timeline renderizado.");
    } catch (e) {
      console.error(e);
      toast("ERROR timeline: " + (e?.message || String(e)));
    }
  });

  // --- Init 3D ---
  btn3D?.addEventListener("click", async () => {
    try {
      if (!layout) layout = await fetchJSON("./layout.json");

      viewer3D = create3DViewer($("view3d"), layout);
      viewer3D.load(rows);

      enable("btnPlay3D", true);
      enable("btnWpMode", true);
      enable("btnEdgeMode", true);
      enable("btnExportLayout", true);

      // speed
      viewer3D.setSpeed(Number(speed3D?.value || 10));

      // reloj
      if (!clockTimer) {
        clockTimer = setInterval(() => {
          if (!viewer3D) return;
          setText("clock3D", "t=" + viewer3D.getTime().toFixed(1) + " min");
        }, 200);
      }

      toast("3D listo. Play cuando quieras.");
    } catch (e) {
      console.error(e);
      toast("ERROR 3D: " + (e?.message || String(e)));
    }
  });

  // --- Play 3D ---
  btnPlay3D?.addEventListener("click", () => {
    try {
      viewer3D?.toggle();
    } catch (e) {
      console.error(e);
      toast("ERROR Play: " + (e?.message || String(e)));
    }
  });

  // --- Speed 3D ---
  speed3D?.addEventListener("input", () => {
    try {
      viewer3D?.setSpeed(Number(speed3D.value || 10));
    } catch {}
  });

  // --- Editor Mode: Waypoints ---
  btnWpMode?.addEventListener("click", () => {
    try {
      viewer3D?.setEditorMode("wp");
      setText("wpHint", "Modo Waypoints: click en el piso crea waypoint. Shift+click borra waypoint.");
      toast("Editor: Waypoints.");
    } catch (e) {
      console.error(e);
      toast("ERROR editor wp: " + (e?.message || String(e)));
    }
  });

  // --- Editor Mode: Edges ---
  btnEdgeMode?.addEventListener("click", () => {
    try {
      viewer3D?.setEditorMode("edge");
      setText("wpHint", "Modo Conectar: click waypoint A y luego B para crear conexión. Shift+click borra waypoint.");
      toast("Editor: Conectar.");
    } catch (e) {
      console.error(e);
      toast("ERROR editor edge: " + (e?.message || String(e)));
    }
  });

  // --- Export Layout ---
  btnExportLayout?.addEventListener("click", () => {
    try {
      if (!viewer3D) return;

      const obj = viewer3D.exportLayout();
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "layout.json";
      a.click();
      URL.revokeObjectURL(a.href);

      toast("Layout exportado (layout.json). Reemplazalo en el repo y listo.");
    } catch (e) {
      console.error(e);
      toast("ERROR export: " + (e?.message || String(e)));
    }
  });
}

init();
