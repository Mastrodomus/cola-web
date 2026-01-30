import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function vecXZ(p) { return new THREE.Vector3(p[0], 0, p[1]); }
function dist2(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += points[i].distanceTo(points[i - 1]);
  return L;
}
function pointAlong(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = b.distanceTo(a);
    if (acc + seg >= s) {
      const t = seg <= 1e-9 ? 1 : (s - acc) / seg;
      return new THREE.Vector3().lerpVectors(a, b, t);
    }
    acc += seg;
  }
  return points[points.length - 1].clone();
}

function nearestWaypointId(waypoints, p) {
  let best = null, bestD = Infinity;
  for (const w of waypoints) {
    const d = dist2(w.p, p);
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

function astar(byId, neighbors, startId, goalId) {
  if (!startId || !goalId) return null;
  if (startId === goalId) return [startId];

  const open = new Set([startId]);
  const came = new Map();
  const g = new Map([[startId, 0]]);
  const h = (id) => dist2(byId[id].p, byId[goalId].p);

  while (open.size) {
    let current = null, bestF = Infinity;
    for (const id of open) {
      const f = (g.get(id) ?? Infinity) + h(id);
      if (f < bestF) { bestF = f; current = id; }
    }
    if (current === goalId) {
      const path = [current];
      let c = current;
      while (came.has(c)) { c = came.get(c); path.push(c); }
      path.reverse();
      return path;
    }
    open.delete(current);

    for (const nb of neighbors.get(current) ?? []) {
      const tentative = (g.get(current) ?? 0) + dist2(byId[current].p, byId[nb].p);
      if (tentative < (g.get(nb) ?? Infinity)) {
        came.set(nb, current);
        g.set(nb, tentative);
        open.add(nb);
      }
    }
  }
  return null;
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
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(10, 80, 10);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  if (layout.planImage) {
    new THREE.TextureLoader().load(layout.planImage, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.center.set(0.5, 0.5);
      tex.rotation = Number(layout.texture?.rotation ?? 0);
      tex.flipY = false;
      tex.premultiplyAlpha = false;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;

      floor.material.map = tex;
      floor.material.needsUpdate = true;
    });
  }

  const grid = new THREE.GridHelper(floorSize, 20);
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);

  // ------- layout mutable (editor) -------
  let nodes = structuredClone(layout.nodes ?? {});
  let waiting = structuredClone(layout.waiting ?? null);
  let waypoints = structuredClone(layout.waypoints ?? []);
  let edges = structuredClone(layout.edges ?? []);

  function buildGraph() {
    const byId = Object.fromEntries(waypoints.map(w => [w.id, w]));
    const neighbors = new Map();
    for (const [a, b] of edges) {
      if (!neighbors.has(a)) neighbors.set(a, []);
      if (!neighbors.has(b)) neighbors.set(b, []);
      neighbors.get(a).push(b);
      neighbors.get(b).push(a);
    }
    return { byId, neighbors };
  }

  // ------- visuals: nodes, waypoints -------
  const wpMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wpGeo = new THREE.SphereGeometry(0.35, 10, 10);
  const wpMeshes = new Map(); // id -> mesh

  function redrawWaypoints() {
    for (const mesh of wpMeshes.values()) scene.remove(mesh);
    wpMeshes.clear();
    for (const w of waypoints) {
      const m = new THREE.Mesh(wpGeo, wpMat);
      m.position.set(w.p[0], 0.25, w.p[1]);
      m.userData = { kind: "wp", id: w.id };
      scene.add(m);
      wpMeshes.set(w.id, m);
    }
  }
  redrawWaypoints();

  const nodeMat = new THREE.MeshStandardMaterial({ color: 0x2563eb });
  function redrawNodes() {
    // nodos solo como markers “tontos” (no editor por ahora)
    // si querés editor de nodes también, lo sumamos luego
    for (const k of Object.keys(nodes)) {
      const p = nodes[k];
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.25, 16), nodeMat);
      m.position.set(p[0], 0.13, p[1]);
      scene.add(m);
    }
  }
  redrawNodes();

  // ------- chairs visual (simple) -------
  const chairMeshes = [];
  function redrawChairs() {
    for (const m of chairMeshes) scene.remove(m);
    chairMeshes.length = 0;
    if (!waiting) return;

    const base = vecXZ(waiting.anchor);
    const geo = new THREE.BoxGeometry(0.9, 0.6, 0.9);
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    for (let r = 0; r < waiting.rows; r++) {
      for (let c = 0; c < waiting.cols; c++) {
        const p = base.clone().add(new THREE.Vector3(c * waiting.dx, 0, -r * waiting.dz));
        const s = new THREE.Mesh(geo, mat);
        s.position.set(p.x, 0.3, p.z);
        scene.add(s);
        chairMeshes.push(s);
      }
    }
  }
  redrawChairs();

  // ------- simulation agents -------
  const agentGeo = new THREE.SphereGeometry(0.8, 16, 16);
  const agentMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9 });
  const walkSpeed = Number(layout.walk?.speed ?? 60);

  let agents = [];
  let t = 0;
  let speed = 10;
  let playing = false;

  // waiting allocation (slots)
  const chairs = [];
  const chairByPatient = new Map();
  function rebuildChairSlots() {
    chairs.length = 0;
    chairByPatient.clear();
    if (!waiting) return;
    const base = waiting.anchor;
    for (let r = 0; r < waiting.rows; r++) {
      for (let c = 0; c < waiting.cols; c++) {
        chairs.push({ p: [base[0] + c * waiting.dx, base[1] - r * waiting.dz], busy: null });
      }
    }
  }
  rebuildChairSlots();

  function acquireChair(id) {
    if (!waiting) return;
    if (chairByPatient.has(id)) return;
    const idx = chairs.findIndex(x => x.busy == null);
    if (idx >= 0) { chairs[idx].busy = id; chairByPatient.set(id, idx); }
  }
  function releaseChair(id) {
    const idx = chairByPatient.get(id);
    if (idx === undefined) return;
    chairs[idx].busy = null;
    chairByPatient.delete(id);
  }
  function waitingPointFor(id) {
    const idx = chairByPatient.get(id);
    if (idx !== undefined) return vecXZ(chairs[idx].p);
    return vecXZ(waiting?.overflow ?? nodes.sala_espera);
  }

  function routeBetween(aName, bName) {
    const A = nodes[aName], B = nodes[bName];
    if (!A || !B || waypoints.length === 0) return null;

    const { byId, neighbors } = buildGraph();
    const startWp = nearestWaypointId(waypoints, A);
    const goalWp = nearestWaypointId(waypoints, B);
    const pathIds = astar(byId, neighbors, startWp, goalWp);
    if (!pathIds) return null;

    const pts = [vecXZ(A)];
    for (const id of pathIds) pts.push(vecXZ(byId[id].p));
    pts.push(vecXZ(B));
    return pts;
  }

  function travelClip(from, to, t0) {
    const pts = routeBetween(from, to);
    if (!pts) return { type: "blocked", t0, t1: t0 + 0.0001, at: from };
    const L = polylineLength(pts);
    const dt = walkSpeed <= 0 ? 0 : (L / walkSpeed);
    return { type: "move", pts, L, t0, t1: t0 + dt };
  }
  function waitClip(p, t0, t1) {
    return { type: "wait", p, t0, t1 };
  }

  function load(rows) {
    agents.forEach(a => scene.remove(a.mesh));
    agents = [];

    rebuildChairSlots();

    for (const r of rows) {
      const mesh = new THREE.Mesh(agentGeo, agentMat);
      scene.add(mesh);

      acquireChair(r.id);

      const clips = [];
      clips.push(waitClip(waitingPointFor(r.id), 0, r.startValidacion));
      releaseChair(r.id);

      clips.push(travelClip("sala_espera", "mesa", r.startValidacion));
      clips.push(waitClip(vecXZ(nodes.mesa), r.startValidacion, r.endValidacion));

      clips.push(travelClip("mesa", "cambiador", r.endValidacion));
      clips.push(waitClip(vecXZ(nodes.cambiador), r.startCambiador, r.endCambiador));

      clips.push(travelClip("cambiador", "resonador", r.endCambiador));
      clips.push(waitClip(vecXZ(nodes.resonador), r.startScan, r.endScan));

      clips.push(travelClip("resonador", "mesa", r.endScan));
      clips.push(waitClip(vecXZ(nodes.mesa), r.startMargen, r.endMargen));

      clips.push(travelClip("mesa", "salida", r.endMargen));

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
      } else if (c.type === "move") {
        const alpha = (simT - c.t0) / (c.t1 - c.t0);
        const p = pointAlong(c.pts, Math.max(0, Math.min(1, alpha)) * c.L);
        a.mesh.position.copy(p);
        a.mesh.position.y = 1;
      } else {
        const at = nodes[c.at] ?? nodes.sala_espera;
        a.mesh.position.copy(vecXZ(at));
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

  // ------- editor interactions -------
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let editorMode = "wp"; // "wp" | "edge"
  let edgeA = null;

  function hitTestWaypoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((clientY - rect.top) / rect.height) * 2 - 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(Array.from(wpMeshes.values()), false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  function pickFloorPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((clientY - rect.top) / rect.height) * 2 - 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(floor, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    return [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))];
  }

  function nextWpId() {
    let n = 1;
    const used = new Set(waypoints.map(w => w.id));
    while (used.has(`w${n}`)) n++;
    return `w${n}`;
  }

  function addWaypoint(p) {
    const id = nextWpId();
    waypoints.push({ id, p });
    redrawWaypoints();
    return id;
  }

  function removeWaypoint(id) {
    waypoints = waypoints.filter(w => w.id !== id);
    edges = edges.filter(([a, b]) => a !== id && b !== id);
    if (edgeA === id) edgeA = null;
    redrawWaypoints();
  }

  function addEdge(a, b) {
    if (a === b) return;
    const key = (x, y) => `${x}__${y}`;
    const existing = new Set(edges.map(([x, y]) => key(x, y)).concat(edges.map(([x, y]) => key(y, x))));
    if (existing.has(key(a, b))) return;
    edges.push([a, b]);
  }

  canvas.addEventListener("click", (e) => {
    // shift+click delete waypoint
    const hitId = hitTestWaypoint(e.clientX, e.clientY);
    if (e.shiftKey && hitId) {
      removeWaypoint(hitId);
      return;
    }

    if (editorMode === "wp") {
      const p = pickFloorPoint(e.clientX, e.clientY);
      if (!p) return;
      addWaypoint(p);
      return;
    }

    if (editorMode === "edge") {
      if (!hitId) return;
      if (!edgeA) {
        edgeA = hitId;
      } else {
        addEdge(edgeA, hitId);
        edgeA = null;
      }
    }
  });

  function setEditorMode(mode) {
    editorMode = mode === "edge" ? "edge" : "wp";
    edgeA = null;
  }

  function exportLayout() {
    return {
      ...layout,
      nodes,
      waiting,
      waypoints,
      edges
    };
  }

  // ------- loop -------
  function animate() {
    if (playing) t += (1 / 60) * speed;
    update(t);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    load,
    toggle() { playing = !playing; },
    setSpeed(v) { speed = Number(v) || 10; },
    getTime() { return t; },

    setEditorMode,
    exportLayout
  };
}
