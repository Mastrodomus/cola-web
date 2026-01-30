import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.hypot(dx, dz);
}

function nearestWaypointId(waypoints, p) {
  let best = waypoints[0]?.id;
  let bestD = Infinity;
  for (const w of waypoints) {
    const d = dist2(w.p, p);
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

// A* sobre grafo de waypoints (no pesa “tiempo”, pesa distancia)
function astar(waypointsById, neighbors, startId, goalId) {
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

  // sin ruta
  return null;
}

function vecXZ([x, z]) {
  return new THREE.Vector3(x, 0, z);
}

function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) {
    L += points[i].distanceTo(points[i-1]);
  }
  return L;
}

function pointAlongPolyline(points, s) {
  // s en [0, totalLength]
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1];
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

  if (layout.planImage) {
    new THREE.TextureLoader().load(
      layout.planImage,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.center.set(0.5, 0.5);
        // Si el plano está rotado, ajustá esto: 0, Math.PI/2, -Math.PI/2, Math.PI
        tex.rotation = 0;

        floor.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
        floor.material.needsUpdate = true;
      }
    );
  }

  const grid = new THREE.GridHelper(floorSize, 20);
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);

  // ---- Grafo de navegación ----
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

  // Debug waypoints (opcional)
  const wpMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wpMeshes = [];
  for (const w of waypoints) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), wpMat);
    m.position.set(w.p[0], 0.25, w.p[1]);
    scene.add(m);
    wpMeshes.push(m);
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

  // ---- Movimiento por rutas ----
  const walkSpeed = (layout.walk?.speed ?? 60); // unidades del layout/min
  // Si tu plano está en “px del mundo”, esto es “unidades/min”. Lo calibramos luego.

  const agentGeo = new THREE.SphereGeometry(0.8, 16, 16);
  const agentMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9 });

  let agents = [];
  let t = 0;
  let speed = 10; // min simulados / seg real
  let playing = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  function routeBetween(nodeAName, nodeBName) {
    const a = nodes[nodeAName];
    const b = nodes[nodeBName];
    if (!a || !b || waypoints.length === 0) {
      // fallback: línea recta
      return [vecXZ(a), vecXZ(b)];
    }

    const startWp = nearestWaypointId(waypoints, a);
    const goalWp = nearestWaypointId(waypoints, b);
    const pathIds = astar(waypointsById, neighbors, startWp, goalWp);

    if (!pathIds) {
      // fallback
      return [vecXZ(a), vecXZ(b)];
    }

    const pts = [];
    pts.push(vecXZ(a));
    for (const id of pathIds) {
      const wp = waypointsById[id];
      pts.push(vecXZ(wp.p));
    }
    pts.push(vecXZ(b));
    return pts;
  }

  function buildTravelClip(fromNode, toNode, t0) {
    const pts = routeBetween(fromNode, toNode);
    const L = polylineLength(pts);
    const travelMin = (walkSpeed <= 0) ? 0 : (L / walkSpeed);
    return { kind: "move", pts, L, t0, t1: t0 + travelMin, from: fromNode, to: toNode };
  }

  function buildWaitClip(atNode, t0, t1) {
    const p = vecXZ(nodes[atNode]);
    return { kind: "wait", p, t0, t1, at: atNode };
  }

  /**
   * rows: esperamos que tengan tiempos de etapas (como hoy)
   * Reglas de flujo pedidas:
   *   entrada -> sala_espera (si llega temprano) -> mesa -> cambiador -> resonador -> mesa -> salida
   * Nota: si querés “espera SOLO en sala_espera”, hacemos que cualquier gap ocurra ahí.
   */
  function load(rows) {
    agents.forEach(a => scene.remove(a.mesh));
    agents = [];

    for (const r of rows) {
      const mesh = new THREE.Mesh(agentGeo, agentMat.clone());
      scene.add(mesh);

      // Armamos una línea de tiempo con MOVIMIENTOS + ETAPAS
      // Usamos tus tiempos: startValidacion/endValidacion/... etc
      // Interpretación:
      // - el paciente "llega" al sistema en r.startValidacion (o antes, si tu engine lo trae)
      // Para tu engine real, conviene tener r.llegada. Acá hacemos MVP:
      const arrival = r.startValidacion; // reemplazar por r.llegada si existe

      const clips = [];

      // Entrada -> sala_espera
      // Si querés que “esperen” hasta su turno de validación, acá:
      const c1 = buildTravelClip("entrada", "sala_espera", Math.max(0, arrival - 2)); // 2 min antes “por defecto”
      clips.push(c1);

      // Espera hasta startValidacion en sala_espera
      const wait0 = Math.max(c1.t1, 0);
      if (r.startValidacion > wait0) clips.push(buildWaitClip("sala_espera", wait0, r.startValidacion));

      // sala_espera -> mesa (llega justo para validación)
      const c2 = buildTravelClip("sala_espera", "mesa", r.startValidacion);
      clips.push(c2);

      // Validación (quieto en mesa)
      clips.push(buildWaitClip("mesa", Math.max(c2.t1, r.startValidacion), r.endValidacion));

      // mesa -> cambiador
      const c3 = buildTravelClip("mesa", "cambiador", r.endValidacion);
      clips.push(c3);

      // Cambiador (quieto)
      clips.push(buildWaitClip("cambiador", Math.max(c3.t1, r.startCambiador), r.endCambiador));

      // cambiador -> resonador
      const c4 = buildTravelClip("cambiador", "resonador", r.endCambiador);
      clips.push(c4);

      // Scan (quieto en resonador)
      clips.push(buildWaitClip("resonador", Math.max(c4.t1, r.startScan), r.endScan));

      // resonador -> mesa (salida por mesa, como dijiste)
      const c5 = buildTravelClip("resonador", "mesa", r.endScan);
      clips.push(c5);

      // margen (quieto en mesa)
      clips.push(buildWaitClip("mesa", Math.max(c5.t1, r.startMargen), r.endMargen));

      // mesa -> salida
      const c6 = buildTravelClip("mesa", "salida", r.endMargen);
      clips.push(c6);

      agents.push({ mesh, clips });
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
      }
    }
  }

  // Picking para calibración (te queda igual)
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let pickingEnabled = false;

  function onClick(e) {
    if (!pickingEnabled) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

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
