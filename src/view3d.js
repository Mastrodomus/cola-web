import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* ----------------- utilidades ----------------- */

function vecXZ(p) {
  return new THREE.Vector3(p[0], 0, p[1]);
}

function dist2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) {
    L += points[i].distanceTo(points[i - 1]);
  }
  return L;
}

function pointAlongPolyline(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = b.distanceTo(a);
    if (acc + seg >= s) {
      const t = (s - acc) / seg;
      return new THREE.Vector3().lerpVectors(a, b, t);
    }
    acc += seg;
  }
  return points[points.length - 1].clone();
}

/* ----------------- A* ----------------- */

function nearestWaypointId(waypoints, p) {
  let best = null;
  let bestD = Infinity;
  for (const w of waypoints) {
    const d = dist2(w.p, p);
    if (d < bestD) {
      bestD = d;
      best = w.id;
    }
  }
  return best;
}

function astar(waypointsById, neighbors, startId, goalId) {
  if (!startId || !goalId) return null;
  if (startId === goalId) return [startId];

  const open = new Set([startId]);
  const cameFrom = new Map();
  const g = new Map([[startId, 0]]);

  function h(id) {
    const a = waypointsById[id].p;
    const b = waypointsById[goalId].p;
    return dist2(a, b);
  }

  while (open.size) {
    let current = null;
    let best = Infinity;
    for (const id of open) {
      const f = (g.get(id) ?? Infinity) + h(id);
      if (f < best) {
        best = f;
        current = id;
      }
    }

    if (current === goalId) {
      const path = [current];
      let c = current;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c);
        path.push(c);
      }
      return path.reverse();
    }

    open.delete(current);

    for (const nb of neighbors.get(current) || []) {
      const a = waypointsById[current].p;
      const b = waypointsById[nb].p;
      const tentative = (g.get(current) ?? 0) + dist2(a, b);

      if (tentative < (g.get(nb) ?? Infinity)) {
        cameFrom.set(nb, current);
        g.set(nb, tentative);
        open.add(nb);
      }
    }
  }

  return null;
}

/* ----------------- viewer ----------------- */

export function create3DViewer(canvas, layout) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(devicePixelRatio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, canvas);

  const size = layout.floorSize || 220;
  camera.position.set(0, size * 0.9, size * 0.9);
  controls.target.set(0, 0, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(10, 80, 10);
  scene.add(light);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0xdddddd })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

if (layout.planImage) {
  new THREE.TextureLoader().load(layout.planImage, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.center.set(0.5, 0.5);
    tex.rotation = Number(layout.texture?.rotation ?? 0);

    // 🔧 FIX WebGL warning
    tex.flipY = false;
    tex.premultiplyAlpha = false;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    floor.material.map = tex;
    floor.material.needsUpdate = true;
  });
}


  const grid = new THREE.GridHelper(size, 20);
  grid.material.opacity = 0.2;
  grid.material.transparent = true;
  scene.add(grid);

  /* ---- waypoints ---- */

  const waypoints = layout.waypoints || [];
  const edges = layout.edges || [];
  const waypointsById = Object.fromEntries(waypoints.map(w => [w.id, w]));

  const neighbors = new Map();
  for (const [a, b] of edges) {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }

  const wpMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  for (const w of waypoints) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), wpMat);
    m.position.set(w.p[0], 0.3, w.p[1]);
    scene.add(m);
  }

  /* ---- nodos funcionales ---- */

  const nodes = layout.nodes;
  const nodeMat = new THREE.MeshStandardMaterial({ color: 0x2563eb });

  for (const k in nodes) {
    const p = nodes[k];
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 0.2, 16),
      nodeMat
    );
    m.position.set(p[0], 0.2, p[1]);
    scene.add(m);
  }

  /* ---- sala de espera ---- */

  const waiting = layout.waiting;
  let chairs = [];
  let chairByPatient = new Map();

  if (waiting) {
    const base = vecXZ(waiting.anchor);
    const geo = new THREE.BoxGeometry(0.9, 0.6, 0.9);
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000 });

    for (let r = 0; r < waiting.rows; r++) {
      for (let c = 0; c < waiting.cols; c++) {
        const p = base.clone().add(new THREE.Vector3(c * waiting.dx, 0, -r * waiting.dz));
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p.x, 0.3, p.z);
        scene.add(m);
        chairs.push({ p, busy: null });
      }
    }
  }

  function acquireChair(id) {
    for (let i = 0; i < chairs.length; i++) {
      if (!chairs[i].busy) {
        chairs[i].busy = id;
        chairByPatient.set(id, i);
        return;
      }
    }
  }

  function releaseChair(id) {
    const i = chairByPatient.get(id);
    if (i !== undefined) {
      chairs[i].busy = null;
      chairByPatient.delete(id);
    }
  }

  function waitingPointFor(id) {
    const i = chairByPatient.get(id);
    if (i !== undefined) return chairs[i].p.clone();
    return vecXZ(waiting.overflow);
  }

  /* ---- agentes ---- */

  const agentGeo = new THREE.SphereGeometry(0.8, 16, 16);
  const agentMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9 });

  let agents = [];
  let t = 0;
  let speed = 10;
  let playing = false;

  function routeBetween(a, b) {
    const A = nodes[a];
    const B = nodes[b];
    const startWp = nearestWaypointId(waypoints, A);
    const endWp = nearestWaypointId(waypoints, B);
    const pathIds = astar(waypointsById, neighbors, startWp, endWp);
    if (!pathIds) return null;

    const pts = [vecXZ(A)];
    for (const id of pathIds) pts.push(vecXZ(waypointsById[id].p));
    pts.push(vecXZ(B));
    return pts;
  }

  function buildTravel(from, to, t0) {
    const pts = routeBetween(from, to);
    if (!pts) return null;
    const L = polylineLength(pts);
    const t1 = t0 + L / (layout.walk?.speed || 60);
    return { type: "move", pts, L, t0, t1 };
  }

  function buildWait(p, t0, t1) {
    return { type: "wait", p, t0, t1 };
  }

  function load(rows) {
    agents.forEach(a => scene.remove(a.mesh));
    agents = [];

    for (const r of rows) {
      const mesh = new THREE.Mesh(agentGeo, agentMat);
      scene.add(mesh);

      acquireChair(r.id);

      const clips = [];
      clips.push(buildWait(waitingPointFor(r.id), 0, r.startValidacion));
      releaseChair(r.id);

      clips.push(buildTravel("sala_espera", "mesa", r.startValidacion));
      clips.push(buildWait(vecXZ(nodes.mesa), r.startValidacion, r.endValidacion));

      clips.push(buildTravel("mesa", "cambiador", r.endValidacion));
      clips.push(buildWait(vecXZ(nodes.cambiador), r.startCambiador, r.endCambiador));

      clips.push(buildTravel("cambiador", "resonador", r.endCambiador));
      clips.push(buildWait(vecXZ(nodes.resonador), r.startScan, r.endScan));

      clips.push(buildTravel("resonador", "mesa", r.endScan));
      clips.push(buildWait(vecXZ(nodes.mesa), r.startMargen, r.endMargen));

      clips.push(buildTravel("mesa", "salida", r.endMargen));

      agents.push({ mesh, clips });
    }

    t = 0;
  }

  function update(simT) {
    for (const a of agents) {
      const c = a.clips.find(k => simT >= k.t0 && simT <= k.t1);
      if (!c) continue;

      if (c.type === "wait") {
        a.mesh.position.copy(c.p);
        a.mesh.position.y = 1;
      } else {
        const alpha = (simT - c.t0) / (c.t1 - c.t0);
        const p = pointAlongPolyline(c.pts, alpha * c.L);
        a.mesh.position.copy(p);
        a.mesh.position.y = 1;
      }
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  function animate() {
    if (playing) t += (1 / 60) * speed;
    update(t);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  return {
    load,
    toggle() { playing = !playing; },
    setSpeed(v) { speed = v; },
    getTime() { return t; }
  };
}
