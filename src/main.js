import { create3DViewer } from "./view3d.js";

const btnSim = document.getElementById("btnSim");
const btnTimeline = document.getElementById("btnTimeline");
const btn3D = document.getElementById("btn3D");
const btnPlay3D = document.getElementById("btnPlay3D");
const speed3D = document.getElementById("speed3D");
const clock3D = document.getElementById("clock3D");

const btnCalib = document.getElementById("btnCalib");
const btnSaveLayout = document.getElementById("btnSaveLayout");
const pickInfo = document.getElementById("pickInfo");

const canvasTimeline = document.getElementById("timeline");
const ctx = canvasTimeline.getContext("2d");

const canvas3D = document.getElementById("view3d");

let rows = [];
let viewer3D = null;
let layout = null;
let clockTimer = null;

// ---------------- layout loader ----------------
async function loadLayout() {
  const res = await fetch("./layout.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar layout.json (HTTP ${res.status})`);
  return await res.json();
}

function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------- Simulación simple ----------------
function simulateDay(n = 25) {
  let t = 0;
  const out = [];

  for (let i = 0; i < n; i++) {
    const durValid = 2 + Math.random() * 3;
    const durCamb = 2 + Math.random() * 3;
    const durScan = 10 + Math.random() * 10;
    const durMarg = 2;

    const startValid = t;
    const endValid = startValid + durValid;
    const startCamb = endValid;
    const endCamb = startCamb + durCamb;
    const startScan = endCamb;
    const endScan = startScan + durScan;
    const startMarg = endScan;
    const endMarg = startMarg + durMarg;

    out.push({
      id: i + 1,
      startValidacion: startValid,
      endValidacion: endValid,
      startCambiador: startCamb,
      endCambiador: endCamb,
      startScan,
      endScan,
      startMargen: startMarg,
      endMargen: endMarg
    });

    t = endMarg;
  }
  return out;
}

// ---------------- Timeline 2D ----------------
function renderTimeline(rows) {
  ctx.clearRect(0, 0, canvasTimeline.width, canvasTimeline.height);

  const scale = 5;
  const rowH = 15;

  rows.forEach((r, i) => {
    const y = i * rowH;
    drawBlock(r.startValidacion, r.endValidacion, y, "orange");
    drawBlock(r.startCambiador, r.endCambiador, y, "blue");
    drawBlock(r.startScan, r.endScan, y, "green");
    drawBlock(r.startMargen, r.endMargen, y, "red");
  });

  function drawBlock(t0, t1, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(t0 * scale, y, (t1 - t0) * scale, rowH - 2);
  }
}

// ---------------- UI handlers ----------------
btnSim.onclick = () => {
  rows = simulateDay(25);
  btnTimeline.disabled = false;
  btn3D.disabled = false;
};

btnTimeline.onclick = () => renderTimeline(rows);

btn3D.onclick = async () => {
  if (!layout) layout = await loadLayout();

  viewer3D = create3DViewer(canvas3D, layout);
  viewer3D.load(rows);

  btnPlay3D.disabled = false;
  btnCalib.disabled = false;
  btnSaveLayout.disabled = false;

  viewer3D.setSpeed(Number(speed3D.value || 10));

  if (!clockTimer) {
    clockTimer = setInterval(() => {
      if (!viewer3D) return;
      clock3D.textContent = "t=" + viewer3D.getTime().toFixed(1);
    }, 200);
  }
};

btnPlay3D.onclick = () => viewer3D?.toggle();
speed3D.oninput = () => viewer3D?.setSpeed(speed3D.value);

// ---------------- Calibración por clicks ----------------
let calibMode = false;
let step = 0;
const order = ["mesa", "cambiador", "resonador"];

btnCalib.onclick = () => {
  if (!viewer3D) return;
  calibMode = !calibMode;
  step = 0;
  btnCalib.textContent = calibMode ? "Calibrando… (mesa)" : "Calibrar (click)";
  pickInfo.textContent = calibMode ? "Hacé click en el piso: mesa → cambiador → resonador" : "";
  viewer3D.setPickingEnabled(calibMode);
};

btnSaveLayout.onclick = () => {
  if (!layout) return;
  downloadText("layout.json", JSON.stringify(layout, null, 2), "application/json");
};

// Evento cuando el viewer detecta click en piso
window.addEventListener("layoutPick", (ev) => {
  if (!calibMode || !layout) return;

  const { x, z } = ev.detail;
  const key = order[step];
  layout.nodes[key] = [Number(x.toFixed(2)), Number(z.toFixed(2))];

  pickInfo.textContent = `${key}: [${layout.nodes[key][0]}, ${layout.nodes[key][1]}]`;

  step++;
  if (step >= order.length) {
    calibMode = false;
    viewer3D.setPickingEnabled(false);
    btnCalib.textContent = "Calibrar (click)";
    pickInfo.textContent += " ✅ listo. Exportá layout.json.";
  } else {
    btnCalib.textContent = `Calibrando… (${order[step]})`;
  }

  // refresca marcadores
  viewer3D.setNodes(layout.nodes);
});
