import * as THREE from "three";

const canvas = document.getElementById("hero-canvas");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function ticketShape(w = 2.4, h = 1.2, notch = 0.22) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, -notch);
  s.absarc(w / 2, 0, notch, -Math.PI / 2, Math.PI / 2, true); // sobekan kanan
  s.lineTo(w / 2, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.lineTo(-w / 2, notch);
  s.absarc(-w / 2, 0, notch, Math.PI / 2, -Math.PI / 2, true); // sobekan kiri
  s.lineTo(-w / 2, -h / 2);
  return s;
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 12;

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 5, 8);
  scene.add(sun);

  const geo = new THREE.ExtrudeGeometry(ticketShape(), {
    depth: 0.08, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3,
  });
  geo.center();
  const colors = [0x60a5fa, 0xa78bfa, 0xf472b6, 0xfbbf24, 0x34d399];

  const tickets = Array.from({ length: 14 }, (_, i) => {
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.35, metalness: 0.2 }),
    );
    mesh.position.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.scale.setScalar(0.6 + Math.random() * 0.6);
    mesh.userData = { spin: 0.2 + Math.random() * 0.5, phase: Math.random() * Math.PI * 2, y: mesh.position.y };
    scene.add(mesh);
    return mesh;
  });

  // partikel bintang kecil
  const pts = new Float32Array(600 * 3).map(() => (Math.random() - 0.5) * 30);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  const stars = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.7 }));
  scene.add(stars);

  // parallax ikut kursor / sentuhan
  const pointer = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / innerWidth - 0.5) * 2;
    pointer.y = (e.clientY / innerHeight - 0.5) * 2;
  });

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);

  const clock = new THREE.Clock();
  const frame = () => {
    const t = clock.getElapsedTime();
    const dt = 1 / 60;
    for (const m of tickets) {
      m.rotation.x += m.userData.spin * dt;
      m.rotation.y += m.userData.spin * 0.7 * dt;
      m.position.y = m.userData.y + Math.sin(t + m.userData.phase) * 0.4;
    }
    stars.rotation.y = t * 0.02;
    camera.position.x += (pointer.x * 1.5 - camera.position.x) * 0.05;
    camera.position.y += (-pointer.y * 1 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };

  if (reduceMotion) return frame(); // satu frame diam, tanpa animasi
  renderer.setAnimationLoop(() => visible && frame());
}

if (canvas) {
  try {
    start();
  } catch (e) {
    console.warn("WebGL tidak tersedia, pakai background gradient saja", e);
  }
}
