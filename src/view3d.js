// src/view3d.js
export function create3DViewer(canvas, planoUrl) {
  const THREE = window.THREE;
  const OrbitControls = window.OrbitControls;
  if (!THREE || !OrbitControls) {
    throw new Error("Three.js/OrbitControls no están cargados. Revisá el script de unpkg en index.html.");
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf7f7f7);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 55, 55);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();

  // Luces
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(30, 80, 40);
  scene.add(dir);

  // Piso con plano
  const floorSize = 100;
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);

  const tex = new THREE.TextureLoader().load(planoUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;

  const floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Grid suave
  const grid = new THREE.GridHelper(floorSize, 20);
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);

  // Nodos del flujo (ajustables a ojo)
  const nodes = {
    mesa: new THREE.Vector3(-28, 0, 10),
    cambiador: new THREE.Vector3(5, 0, 5),
    resonador: new THREE.Vector3(18, 0, 25)
  };

  // Marcadores
  const markerMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  function marker(pos) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 16), markerMat);
    m.position.set(pos.x, 0.11, pos.z);
    scene.add(m);
  }
  marker(nodes.mesa);
  marker(nodes.cambiador);
  marker(nodes.resonador);

  // Agentes
  const agentGeo = new THREE.SphereGeometry(0.7, 18, 18);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2b6cb0 });
  const agents = [];

  let t = 0;
  let playing = false;
  let speed = 10; // min simulados / seg real

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(10, rect.width);
    const h = Math.max(10, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  function lerpVec(out, a, b, alpha) {
    out.x = a.x + (b.x - a.x) * alpha;
    out.y = a.y + (b.y - a.y) * alpha;
    out.z = a.z + (b.z - a.z) * alpha;
  }

  function load(rows) {
    // limpiar
    for (const a of agents) scene.remove(a.mesh);
    agents.length = 0;

    for (const r of rows) {
      const mesh = new THREE.Mesh(agentGeo, baseMat.clone());
      mesh.position.set(nodes.mesa.x, 0.7, nodes.mesa.z);
      scene.add(mesh);

      // Clips: si hay gaps (esperas), esos clips generan movimiento/tiempo.
      const clips = [
        { a: nodes.mesa, b: nodes.mesa, t0: r.startValidacion, t1: r.endValidacion },
        { a: nodes.mesa, b: nodes.cambiador, t0: r.endValidacion, t1: r.startCambiador },
        { a: nodes.cambiador, b: nodes.cambiador, t0: r.startCambiador, t1: r.endCambiador },
        { a: nodes.cambiador, b: nodes.resonador, t0: r.endCambiador, t1: r.startScan },
        { a: nodes.resonador, b: nodes.resonador, t0: r.startScan, t1: r.endScan },
        { a: nodes.resonador, b: nodes.mesa, t0: r.endScan, t1: r.startMargen },
        { a: nodes.mesa, b: nodes.mesa, t0: r.startMargen, t1: r.endMargen }
      ];

      agents.push({ id: r.id, mesh, clips });
    }

    t = 0;
  }

  function updateAgents(simT) {
    const tmp = new THREE.Vector3();

    for (const a of agents) {
      let clip = null;
      for (const c of a.clips) {
        if (simT >= c.t0 && simT <= c.t1) { clip = c; break; }
      }
      if (!clip) {
        a.mesh.position.set(nodes.mesa.x, 0.7, nodes.mesa.z);
        continue;
      }

      const dt = clip.t1 - clip.t0;
      const alpha = dt <= 0 ? 1 : (simT - clip.t0) / dt;

      lerpVec(tmp, clip.a, clip.b, Math.max(0, Math.min(1, alpha)));
      a.mesh.position.set(tmp.x, 0.7, tmp.z);
    }
  }

  function setSpeed(v) { speed = Math.max(1, Number(v) || 10); }
  function play() { playing = true; }
  function pause() { playing = false; }
  function toggle() { playing = !playing; }
  function getTime() { return t; }
  function setTime(x) { t = Math.max(0, Number(x) || 0); }

  let last = performance.now();
  function loop(now) {
    const dtSec = (now - last) / 1000;
    last = now;

    if (playing) t += dtSec * speed;
    updateAgents(t);

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { load, play, pause, toggle, setSpeed, getTime, setTime };
}
