import { create3DViewer } from "./view3d.js";

const btnSim = document.getElementById("btnSim");
const btnTimeline = document.getElementById("btnTimeline");
const btn3D = document.getElementById("btn3D");
const btnPlay3D = document.getElementById("btnPlay3D");
const speed3D = document.getElementById("speed3D");
const clock3D = document.getElementById("clock3D");

const canvasTimeline = document.getElementById("timeline");
const ctx = canvasTimeline.getContext("2d");

const canvas3D = document.getElementById("view3d");

let rows = [];
let viewer3D = null;

// Simulación simple
function simulateDay(n = 20) {
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
      id: i+1,
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

// Timeline 2D
function renderTimeline(rows) {
  ctx.clearRect(0,0,canvasTimeline.width,canvasTimeline.height);

  const scale = 5;
  const rowH = 15;

  rows.forEach((r,i)=>{
    const y = i * rowH;

    drawBlock(r.startValidacion, r.endValidacion, y, "orange");
    drawBlock(r.startCambiador, r.endCambiador, y, "blue");
    drawBlock(r.startScan, r.endScan, y, "green");
    drawBlock(r.startMargen, r.endMargen, y, "red");
  });

  function drawBlock(t0,t1,y,color){
    ctx.fillStyle = color;
    ctx.fillRect(t0*scale, y, (t1-t0)*scale, rowH-2);
  }
}

btnSim.onclick = ()=>{
  rows = simulateDay(25);
  btnTimeline.disabled = false;
  btn3D.disabled = false;
};

btnTimeline.onclick = ()=>{
  renderTimeline(rows);
};

btn3D.onclick = ()=>{
  viewer3D = create3DViewer(canvas3D, "./plano.png");
  viewer3D.load(rows);
  btnPlay3D.disabled = false;

  setInterval(()=>{
    clock3D.textContent = "t=" + viewer3D.getTime().toFixed(1);
  },200);
};

btnPlay3D.onclick = ()=>{
  viewer3D.toggle();
};

speed3D.oninput = ()=>{
  if(viewer3D) viewer3D.setSpeed(speed3D.value);
};
