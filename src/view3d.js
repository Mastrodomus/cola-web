import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function create3DViewer(canvas, planoUrl) {

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  const camera = new THREE.PerspectiveCamera(50,1,0.1,1000);
  camera.position.set(0,50,50);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,0,0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff,0.8));
  const light = new THREE.DirectionalLight(0xffffff,0.8);
  light.position.set(10,50,10);
  scene.add(light);

  const floorGeo = new THREE.PlaneGeometry(100,100);
  let floorMat;

  const loader = new THREE.TextureLoader();
  loader.load(planoUrl,
    tex=>{
      floorMat = new THREE.MeshStandardMaterial({ map:tex });
      floor.rotation.x = -Math.PI/2;
      floor.material = floorMat;
    },
    undefined,
    ()=> {
      floorMat = new THREE.MeshStandardMaterial({ color:0xdddddd });
      floor.material = floorMat;
    }
  );

  const floor = new THREE.Mesh(floorGeo,new THREE.MeshStandardMaterial({color:0xddd}));
  floor.rotation.x = -Math.PI/2;
  scene.add(floor);

  const nodes = {
    mesa: new THREE.Vector3(-20,0,0),
    cambiador: new THREE.Vector3(0,0,0),
    resonador: new THREE.Vector3(20,0,0)
  };

  const sphereGeo = new THREE.SphereGeometry(0.7,16,16);
  const sphereMat = new THREE.MeshStandardMaterial({color:0x0077ff});

  let agents=[];
  let t=0;
  let speed=10;
  let playing=false;

  function resize(){
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width,r.height,false);
    camera.aspect = r.width/r.height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize",resize);
  resize();

  function load(rows){
    agents.forEach(a=>scene.remove(a.mesh));
    agents=[];

    rows.forEach(r=>{
      const mesh = new THREE.Mesh(sphereGeo,sphereMat.clone());
      scene.add(mesh);

      const clips=[
        {a:nodes.mesa,b:nodes.mesa,t0:r.startValidacion,t1:r.endValidacion},
        {a:nodes.mesa,b:nodes.cambiador,t0:r.endValidacion,t1:r.startCambiador},
        {a:nodes.cambiador,b:nodes.resonador,t0:r.endCambiador,t1:r.startScan},
        {a:nodes.resonador,b:nodes.resonador,t0:r.startScan,t1:r.endScan},
        {a:nodes.resonador,b:nodes.mesa,t0:r.endScan,t1:r.endMargen}
      ];

      agents.push({mesh,clips});
    });

    t=0;
  }

  function update(){
    agents.forEach(a=>{
      let clip=null;
      for(const c of a.clips){
        if(t>=c.t0 && t<=c.t1){ clip=c; break;}
      }
      if(!clip) return;

      const alpha=(t-clip.t0)/(clip.t1-clip.t0);
      a.mesh.position.lerpVectors(clip.a,clip.b,alpha);
      a.mesh.position.y=1;
    });
  }

  function animate(now){
    if(playing) t+=0.016*speed;
    update();
    renderer.render(scene,camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    load,
    play(){playing=true},
    pause(){playing=false},
    toggle(){playing=!playing},
    setSpeed(v){speed=Number(v)||10},
    getTime(){return t}
  };
}
