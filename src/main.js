import { create3DViewer } from "./view3d.js";

const $ = (id) => document.getElementById(id);

const btnSim = $("btnSim");
const btnTimeline = $("btnTimeline");
const btn3D = $("btn3D");
const btnPlay3D = $("btnPlay3D");
const speed3D = $("speed3D");
const clock3D = $("clock3D");

const scaleInp = $("scale");
const maxRowsInp = $("maxRows");

const timelineCanvas = $("timeline");
const ctx = timelineCanvas.getContext("2d");

const canvas3D = $("view3d");

let rows = [];
let viewer3D = null;
let layout = null;
let clockTimer = null;

// Panel simple de estado
const status = document.createElement("div");
status.className = "muted";
status.style.marginTop = "8px";
btnSim?.parentElement?.appendChild(status);

function setStatus(msg) {
  status.textContent = msg || "";
}

async function loadLayout() {
  const res = await fetch("./layout.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar layout.json (HTTP ${res.status})`);
  return await res.json();
}

/* ---------------- simulación mínima ----------------
   Esto NO es tu engine final. Es un generador estable
   para que 2D + 3D funcionen mientras iteramos.
----------------------------------------------------- */
function simulateDay(n = 25) {
  const out = [];
  let t = 0;

  for (let i = 0; i < n; i++) {
    const valid = 2 + Math.random() * 4;
    const camb  = 3 + Math.random() * 4;
    const scan  = 12 + Math.random() * 10;
    const marg  = 2 + Math.random() * 2;

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

/* ---------------- timeline 2D ---------------- */
function renderTimeline(rows) {
  const pxPerMin = Number(scaleInp?.value || 2);
  const maxRows = Number(maxRowsInp?.value || 60);

  const show = rows.slice(0, maxRows);
  const rowH = 12;

  // ajustar alto canvas dinámicamente
  const needH = Math.max(300, show.length * rowH + 40);
  if (timelineCanvas.height !== needH) timelineCanvas.height = needH;

  ctx.clearRect(0, 0, timelineCanvas.width, timelineCanvas.height);

  // eje tiempo simple
  ctx.fillStyle = "#666";
  ctx.font = "12px system-ui";
  ctx.fillText("min", 6, 14);

  show.forEach((r, i) => {
    const y = 24 + i * rowH;

    drawBar(r.startValidacion, r.endValidacion, y, "#f59e0b"); // valid
    drawBar(r.startCambiador, r.endCambiador, y, "#3b82f6");   // cambiador
    drawBar(r.startScan, r.endScan, y, "#10b981");             // scan
    drawBar(r.startMargen, r.endMargen, y, "#ef4444");         // margen

    ctx.fillStyle = "#111";
    ctx.fillText(String(r.id), 4, y + 9);
  });

  function drawBar(t0, t1, y, color) {
    const x = 28 + t0 * pxPerMin;
    const w = Math.max(1, (t1 - t0) * pxPerMin);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, rowH - 2);
  }
}

/* ---------------- handlers ---------------- */
btnSim.onclick = () => {
  try {
    setStatus("");
    rows = simulateDay(30);

    btnTimeline.disabled = false;
    btn3D.disabled = false;

    setStatus(`OK: simulados ${rows.length} pacientes.`);
  } catch (e) {
    console.error(e);
    setStatus("ERROR simulando: " + (e?.message || String(e)));
  }
};

btnTimeline.onclick = () => {
  try {
    renderTimeline(rows);
    setStatus("Timeline renderizado.");
  } catch (e) {
    console.error(e);
    setStatus("ERROR timeline: " + (e?.message || String(e)));
  }
};

btn3D.onclick = async () => {
  try {
    setStatus("Cargando layout…");
    if (!layout) layout = await loadLayout();

    setStatus("Inicializando 3D…");
    viewer3D = create3DViewer(canvas3D, layout);

    setStatus("Cargando simulación en 3D…");
    viewer3D.load(rows);

    btnPlay3D.disabled = false;
    viewer3D.setSpeed(Number(speed3D?.value || 10));

    if (!clockTimer) {
      clockTimer = setInterval(() => {
        if (!viewer3D) return;
        clock3D.textContent = "t=" + viewer3D.getTime().toFixed(1) + " min";
      }, 200);
    }

    setStatus("3D listo. Dale Play.");
  } catch (e) {
    console.error(e);
    setStatus("ERROR 3D: " + (e?.message || String(e)));
  }
};

btnPlay3D.onclick = () => {
  try {
    viewer3D?.toggle();
  } catch (e) {
    console.error(e);
    setStatus("ERROR play: " + (e?.message || String(e)));
  }
};

speed3D.oninput = () => {
  try {
    viewer3D?.setSpeed(Number(speed3D.value || 10));
  } catch {}
};

// Arranque: deshabilitar lo que corresponde
btnTimeline.disabled = true;
btn3D.disabled = true;
btnPlay3D.disabled = true;
setStatus("Listo. Click en Simular.");
