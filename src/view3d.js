import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.hypot(dx, dz);
}

function nearestWaypointId(waypoints, p) {
  let best = waypoints[0]?.id ?? null;
  let bestD = Infinity;
  for (const w of waypoints) {
    const d = dist2(w.p, p);
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

function astar(waypointsById, neighbors, startId, goalId) {
  if (!startId || !goalId) return null;
  if (startId === goalId) return [startId];

  const h = (id) => {
    const a = waypointsById[id].p;
    const b = waypointsById[goalId].p;
    return dist2(a, b);
  };

  const open = new Set([startId]);
  const cameFrom = new Map();
  const g = new Map([[startId, 0]]);
  const f = new Map([[startId, h(startId)]]);

  const getBestOpen = () => {
    let best = null;
    let bestF = Infinity;
    for (const id of open) {
      const fv = f.get(id) ?? Infinity;
      if (fv < bestF) { bestF = fv; best = id; }
    }
    return best;
  };

  while (open.size) {
    const current = getBestOpen();
    if (!current) break;

    if (current === goalId) {
      const path = [current];
      let c = current;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c);
        path.push(c);
      }
      path.reverse();
      return path;
    }

    open.delete(current);

    const nbrs = neighbors.get(current) ?? [];
    for (const nb of nbrs) {
      const a = waypointsById[current].p;
      const b = waypointsById[nb].p;
      const tentative = (g.get(current) ?? Infinity) + dist2(a, b);

      if (tentative < (g.get(nb) ?? Infinity)) {
        cameFrom.set(nb, current);
        g.set(nb, tentative);
        f.set(nb, tentative + h(nb));
        open.add(nb);
      }
    }
  }

  return null;
}

function vecXZ([x, z]) {
  return new THREE.Vector3(x, 0, z);
}

function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += points[i].distanceTo(points[i - 1]);
  return L;
}

function pointAlongPolyline(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = b.distanceTo(a);
    if (acc + seg >= s) {
      const t = seg <= 1e-9 ? 1 : (s - acc) / seg;
      return new THREE.Vector3().lerpVectors(a, b, Math.max(0, Math.min(1, t)));
    }
    acc += seg;
  }
  return points[points.length - 1].clone();
}

export function create3DViewer(canvas, layout) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);

  const floorSize = layout.floorSize ?? 220;

  camera.position.set(0, floorSize * 0.9, floorSize * 0.9);
  controls.target.set(0, 0, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(10, 80, 10);
  scene.add(light);

  // Piso
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Textura del plano
  if (layout.planImage) {
    new THREE.TextureLoader().load(layout.planImage, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.center.set(0.5, 0.5);
      tex.rotation = Number(layout.texture?.rotation ?? 0);

      floor.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
      floor.material.needsUpdate = true;
    });
  }

  const grid = new THREE.GridHelper(floorSize, 20);
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);

  // ---- Grafo (waypoints) ----
  const waypoints = layout.waypoints ?? [];
  const edges = layout.edges ?? [];
  const waypointsById = Object.fromEntries(waypoints.map(w => [w.id, w]));

  const neighbors = new Map();
  for (const [a, b] of edges) {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }

  // Mostrar waypoints (debug)
  const wpMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  for (const w of waypoints) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), wpMat);
    m.position.set(w.p[0], 0.25, w.p[1]);
    scene.add(m);
  }

  // ---- Nodos funcionales ----
  let nodes = layout.nodes ?? {};

  const markerMat = new THREE.MeshStandardMaterial({ color: 0x2563eb });
  const markers = {};

  function setMarker(name, p) {
    if (!markers[name]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.25, 16), markerMat);
      scene.add(m);
      markers[name] = m;
    }
    markers[name].position.set(p[0], 0.13, p[1]);
  }

  for (const k of Object.keys(nodes)) setMarker(k, nodes[k]);

  function setNodes(newNodes) {
    nodes = newNodes;
    for (const k of Object.keys(nodes)) setMarker(k, nodes[k]);
  }

  // ---- Sala de espera (sillas) ----
  const waiting = layout.waiting ?? null;
  let chairSlots = [];          // { p: Vector3, busyBy: number|null }
  let chairByPatient = new Map(); // patientId -> slotIndex

  function buildChairSlots() {
    chairSlots = [];
    chairByPatient.clear();
    if (!waiting) return;

    const { anchor, rows, cols, dx, dz } = waiting;
    const base = new THREE.Vector3(anchor[0], 0, anchor[1]);

    const chairGeo = new THREE.BoxGeometry(0.9, 0.6, 0.9);
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    for (let r = 0; r < (rows ?? 2); r++) {
      for (let c = 0; c < (cols ?? 6); c++) {
        const p = base.clone().add(new THREE.Vector3(c * (dx ?? 3), 0, -r * (dz ?? 2.6)));

        const mesh = new THREE.Mesh(chairGeo, chairMat);
        mesh.position.set(p.x, 0.3, p.z);
        scene.add(mesh);

        chairSlots.push({ p, busyBy: null });
      }
    }
  }

  function acquireChair(patientId) {
    if (!waiting) return;
    if (chairByPatient.has(patientId)) return;
    const idx = chairSlots.findIndex(s => s.busyBy == null);
    if (idx >= 0) {
      chairSlots[idx].busyBy = patientId;
      chairByPatient.set(patientId, idx);
    }
  }

  function releaseChair(patientId) {
    const idx = chairByPatient.get(patientId);
    if (idx === undefined) return;
    chairSlots[idx].busyBy = null;
    chairByPatient.delete(patientId);
  }

  function waitingPointFor(patientId) {
    const idx = chairByPatient.get(patientId);
    if (idx !== undefined) return chairSlots[idx].p.clone();

    const ov = waiting?.overflow ?? nodes.sala_espera;
    return new THREE.Vector3(ov[0], 0, ov[1]);
  }

  buildChairSlots();

  // ---- Movimiento por rutas ----
  const walkSpeed = Number(layout.walk?.speed ?? 60); // unidades/min

  function routeBetween(nodeAName, nodeBName) {
    const a = nodes[nodeAName];
    const b = nodes[nodeBName];
    if (!a || !b) return null;
    if (waypoints.length === 0) return null;

    const startWp = nearestWaypointId(waypoints, a);
    const goalWp = nearestWaypointId(waypoints, b);
    const pathIds = astar(waypointsById, neighbors, startWp, goalWp);
    if (!pathIds) return null;

    const pts = [];
    pts.push(vecXZ(a));
    for (const id of pathIds) pts.push(vecXZ(waypointsById[id].p));
    pts.push(vecXZ(b));
    return pts;
  }

  function buildTravelClip(fromNode, toNode, t0) {
    const pts = routeBetween(fromNode, toNode);
    if (!pts) {
      // SIN fallback: si no hay ruta, el agente queda bloqueado (evita atravesar paredes)
      return { kind: "blocked", t0, t1: t0 + 0.0001, at: fromNode, from: fromNode, to: toNode };
    }

    const L = polylineLength(pts);
    const travelMin = (walkSpeed <= 0) ? 0 : (L / walkSpeed);
    return { kind: "move", pts, L, t0, t1: t0 + travelMin, from: fromNode, to: toNode };
  }

  function buildWaitClip(atNode, t0, t1, patientId = null) {
    let p;
    if (atNode === "sala_espera" && patientId != null) {
      p = waitingPointFor(patientId);
    } else {
      const n = nodes[atNode];
      p = new THREE.Vector3(n[0], 0, n[1]);
    }
    return { kind: "wait", p, t0, t1, at: atNode, patientId };
  }

  const agentGeo = new THREE.SphereGeometry(0.8, 16, 16);
  const agentMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9 });

  let agents = [];
  let t = 0;
  let speed = 10;     // min simulados / seg real
  let playing = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  function load(rows) {
    agents.forEach(a => scene.remove(a.mesh));
    agents = [];

    for (const r of rows) {
      const mesh = new THREE.Mesh(agentGeo, agentMat.clone());
      scene.add(mesh);

      const clips = [];

      // ✅ Entrada = sala de espera
      acquireChair(r.id);

      // Espera en silla hasta startValidacion
      clips.push(buildWaitClip("sala_espera", 0, r.startValidacion, r.id));

      // Se levanta y va a mesa
      releaseChair(r.id);
      clips.push(buildTravelClip("sala_espera", "mesa", r.startValidacion));

      // Validación quieto en mesa
      clips.push(buildWaitClip("mesa", r.startValidacion, r.endValidacion));

      // Mesa -> cambiador
      clips.push(buildTravelClip("mesa", "cambiador", r.endValidacion));

      // Cambiador
      clips.push(buildWaitClip("cambiador", r.startCambiador, r.endCambiador));

      // Cambiador -> resonador
      clips.push(buildTravelClip("cambiador", "resonador", r.endCambiador));

      // Scan
      clips.push(buildWaitClip("resonador", r.startScan, r.endScan));

      // Resonador -> mesa (sale por mesa, como pediste)
      clips.push(buildTravelClip("resonador", "mesa", r.endScan));

      // Margen en mesa
      clips.push(buildWaitClip("mesa", r.startMargen, r.endMargen));

      // Mesa -> salida (salida = sala_espera)
      clips.push(buildTravelClip("mesa", "salida", r.endMargen));

      agents.push({ id: r.id, mesh, clips });
    }

    t = 0;
  }

  function updateAgents(simT) {
    for (const a of agents) {
      let clip = null;
      for (const c of a.clips) {
        if (simT >= c.t0 && simT <= c.t1) { clip = c; break; }
      }
      if (!clip) continue;

      if (clip.kind === "wait") {
        a.mesh.position.copy(clip.p);
        a.mesh.position.y = 1;
      } else if (clip.kind === "move") {
        const dt = clip.t1 - clip.t0;
        const alpha = dt <= 1e-9 ? 1 : (simT - clip.t0) / dt;
        const s = Math.max(0, Math.min(1, alpha)) * clip.L;
        const p = pointAlongPolyline(clip.pts, s);
        a.mesh.position.copy(p);
        a.mesh.position.y = 1;
      } else if (clip.kind === "blocked") {
        const n = nodes[clip.at] ?? nodes.sala_espera;
        a.mesh.position.set(n[0], 1, n[1]);
      }
    }
  }

  // Picking (para calibración por clicks)
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let pickingEnabled = false;

  function onClick(e) {
    if (!pickingEnabled) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(floor);
    if (!hits.length) return;
    const p = hits[0].point;

    window.dispatchEvent(new CustomEvent("layoutPick", { detail: { x: p.x, z: p.z } }));
  }
  canvas.addEventListener("click", onClick);

  function setPickingEnabled(v) { pickingEnabled = !!v; }

  function animate() {
    if (playing) t += (1 / 60) * speed;
    updateAgents(t);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    load,
    toggle() { playing = !playing; },
    setSpeed(v) { speed = Number(v) || 10; },
    getTime() { return t; },
    setPickingEnabled,
    setNodes
  };
}
