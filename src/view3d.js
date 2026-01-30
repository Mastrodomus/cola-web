import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function create3DViewer(canvas, layout) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 60, 60);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(10, 80, 10);
  scene.add(light);

  // Piso + textura
  const floorSize = layout.floorSize ?? 100;
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);

  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: 0xdddddd })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  if (layout.planImage) {
    new THREE.TextureLoader().load(
      layout.planImage,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        floor.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
        floor.material.needsUpdate = true;
      },
      undefined,
      () => {
        // ok: se queda gris
      }
    );
  }

  // Grid leve
  const grid = new THREE.GridHelper(floorSize, 20);
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);

  // Nodes
  let nodes = {
    mesa: layout.nodes?.mesa ?? [-20, 0],
    cambiador: layout.nodes?.cambiador ?? [0, 0],
    resonador: layout.nodes?.resonador ?? [20, 0]
  };

  function v2(arr) { return new THREE.Vector3(arr[0], 0, arr[1]); }

  let nodeVec = {
    mesa: v2(nodes.mesa),
    cambiador: v2(nodes.cambiador),
    resonador: v2(nodes.resonador)
  };

  // Marcadores
  const markerMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const markers = {};

  function makeMarker(name, pos) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.25, 16), markerMat);
    m.position.set(pos.x, 0.13, pos.z);
    scene.add(m);
    markers[name] = m;
  }

  makeMarker("mesa", nodeVec.mesa);
  makeMarker("cambiador", nodeVec.cambiador);
  makeMarker("resonador", nodeVec.resonador);

  function setNodes(newNodes) {
    nodes = newNodes;
    nodeVec = {
      mesa: v2(nodes.mesa),
      cambiador: v2(nodes.cambiador),
      resonador: v2(nodes.resonador)
    };
    markers.mesa.position.set(nodeVec.mesa.x, 0.13, nodeVec.mesa.z);
    markers.cambiador.position.set(nodeVec.cambiador.x, 0.13, nodeVec.cambiador.z);
    markers.resonador.position.set(nodeVec.resonador.x, 0.13, nodeVec.resonador.z);
  }

  // Agentes
  const sphereGeo = new THREE.SphereGeometry(0.8, 16, 16);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x0077ff });

  let agents = [];
  let t = 0;
  let speed = 10;
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

    rows.forEach(r => {
      const mesh = new THREE.Mesh(sphereGeo, baseMat.clone());
      scene.add(mesh);

      const clips = [
        { a: nodeVec.mesa, b: nodeVec.mesa, t0: r.startValidacion, t1: r.endValidacion },
        { a: nodeVec.mesa, b: nodeVec.cambiador, t0: r.endValidacion, t1: r.startCambiador },
        { a: nodeVec.cambiador, b: nodeVec.cambiador, t0: r.startCambiador, t1: r.endCambiador },
        { a: nodeVec.cambiador, b: nodeVec.resonador, t0: r.endCambiador, t1: r.startScan },
        { a: nodeVec.resonador, b: nodeVec.resonador, t0: r.startScan, t1: r.endScan },
        { a: nodeVec.resonador, b: nodeVec.mesa, t0: r.endScan, t1: r.endMargen }
      ];

      agents.push({ mesh, clips });
    });

    t = 0;
  }

  function update() {
    agents.forEach(a => {
      let clip = null;
      for (const c of a.clips) {
        if (t >= c.t0 && t <= c.t1) { clip = c; break; }
      }
      if (!clip) return;

      const dt = clip.t1 - clip.t0;
      const alpha = dt <= 0 ? 1 : (t - clip.t0) / dt;
      a.mesh.position.lerpVectors(clip.a, clip.b, Math.max(0, Math.min(1, alpha)));
      a.mesh.position.y = 1;
    });
  }

  // Picking (click en el piso)
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
    update();
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
