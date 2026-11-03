// Panggung 3D bergaya diorama kartun (toon shading, alas melayang, bayangan lembut).
// Konfigurasi datang dari tombol "Generate" di admin: JSON di <script type="application/json"> dalam [data-stage].
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const SKINS = [0xf6d2b0, 0xe8b48c, 0xc68a5e, 0x9a6440];
const HAIRS = [0x2b1d16, 0x4a2f1f, 0x1c1c24, 0x8a5a2b, 0xd9a441, 0xc0392b];

// --- Material toon: 3 tingkat bayangan = kesan kartun ---
const ramp = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
let mats = new Map(); // direset tiap mount: satu set material per renderer
const toon = (color, extra) => {
  if (extra) return new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
  const k = new THREE.Color(color).getHex();
  if (!mats.has(k)) mats.set(k, new THREE.MeshToonMaterial({ color: k, gradientMap: ramp }));
  return mats.get(k);
};
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });

function mesh(geo, mat, [x, y, z] = [0, 0, 0], parent) {
  const m = new THREE.Mesh(geo, mat?.isMaterial ? mat : toon(mat));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent?.add(m);
  return m;
}
const rbox = (w, h, d, r = 0.15) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));

function canvasTex(w, h, draw) {
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.redraw = (...a) => { draw(c.getContext("2d"), w, h, ...a); t.needsUpdate = true; };
  t.redraw(0);
  return t;
}

// --- Orang kartun: kepala besar, badan kacang, mata titik ---
const G = {
  body: new THREE.CapsuleGeometry(0.32, 0.42, 4, 12),
  head: new THREE.SphereGeometry(0.4, 20, 16),
  hair: new THREE.SphereGeometry(0.43, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  eye: new THREE.SphereGeometry(0.055, 8, 6),
  arm: new THREE.CapsuleGeometry(0.1, 0.36, 4, 8).translate(0, -0.22, 0),
};
function person(color, R) {
  const g = new THREE.Group();
  const body = mesh(G.body, color, [0, 0.53, 0], g);
  const head = new THREE.Group();
  head.position.y = 1.36;
  g.add(head);
  mesh(G.head, SKINS[Math.floor(R() * SKINS.length)], [0, 0, 0], head);
  mesh(G.hair, HAIRS[Math.floor(R() * HAIRS.length)], [0, 0.03, -0.02], head).rotation.x = -0.55;
  for (const s of [-1, 1]) mesh(G.eye, 0x1a1a1a, [0.14 * s, 0.02, 0.37], head);
  const arm = (s) => mesh(G.arm, color, [0.4 * s, 0.88, 0], g);
  g.userData = { armL: arm(-1), armR: arm(1), head, body };
  return g;
}

// Penonton massal: 3 InstancedMesh (badan, kepala, rambut) berbagi matriks yang sama
function crowdMesh(scene, N, colors, R) {
  const parts = [
    [G.body.clone().translate(0, 0.53, 0), () => colors[Math.floor(R() * colors.length)]],
    [G.head.clone().translate(0, 1.36, 0), () => SKINS[Math.floor(R() * SKINS.length)]],
    [G.hair.clone().rotateX(0.55).translate(0, 1.39, 0.02), () => HAIRS[Math.floor(R() * HAIRS.length)]],
  ].map(([geo, pick]) => {
    const im = new THREE.InstancedMesh(geo, toon(0xffffff, {}), N);
    for (let i = 0; i < N; i++) im.setColorAt(i, new THREE.Color(pick()));
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
    return im;
  });
  const m = new THREE.Matrix4();
  return (i, x, y, z, s) => {
    m.makeScale(s, s, s).setPosition(x, y, z);
    for (const p of parts) p.setMatrixAt(i, m);
    if (i === N - 1) for (const p of parts) p.instanceMatrix.needsUpdate = true;
  };
}

// Alas diorama: lempengan sudut membulat yang melayang
function base(scene, w, d, top, side, topMap) {
  const s = new THREE.Shape(), r = 1.2, x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 3, curveSegments: 12 });
  geo.rotateX(-Math.PI / 2).translate(0, -1.45, 0);
  const slab = new THREE.Mesh(geo, [topMap ? toon(0xffffff, { map: topMap }) : toon(top), toon(side)]);
  slab.receiveShadow = true;
  scene.add(slab);
}

function lights(scene, sky = 0xffffff, ground = 0x9a8fb0, sunI = 2.4) {
  scene.add(new THREE.HemisphereLight(sky, ground, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, sunI);
  sun.position.set(9, 18, 11);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
}

// Kerucut cahaya lembut (bukan additive: latarnya terang)
function beam(from, to, radius, color, opacity = 0.2) {
  const len = from.distanceTo(to);
  const geo = new THREE.ConeGeometry(radius, len, 32, 1, true).translate(0, -len / 2, 0).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.position.copy(from);
  m.lookAt(to);
  return m;
}

function tree(scene, x, z, s = 1, color = 0x7cc46a) {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.4, 8), 0x8b5a3c, [0, 0.7, 0], g);
  mesh(new THREE.SphereGeometry(1, 12, 10), color, [0, 2, 0], g);
  mesh(new THREE.SphereGeometry(0.7, 12, 10), new THREE.Color(color).offsetHSL(0.02, 0, 0.06), [0.45, 2.6, 0.2], g);
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  scene.add(g);
}

function lamp(scene, x, z, h = 4) {
  mesh(new THREE.CylinderGeometry(0.08, 0.12, h, 8), 0x3b3a4a, [x, h / 2, z], scene);
  mesh(new THREE.SphereGeometry(0.28, 12, 10), glow(0xfff1b8), [x, h + 0.1, z], scene);
  return new THREE.Vector3(x, h, z);
}

// Bendera segitiga di tali melengkung
function bunting(scene, a, b, colors, sag = 0.8) {
  const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0, -0.5)]));
  const fm = colors.map((c) => toon(c, { side: THREE.DoubleSide }));
  const pts = [], n = Math.round(a.distanceTo(b) / 0.7);
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
    if (i && i < n) {
      const f = new THREE.Mesh(tri, fm[i % fm.length]);
      f.position.copy(p);
      f.lookAt(p.x + (b.z - a.z), p.y, p.z - (b.x - a.x));
      f.castShadow = true;
      scene.add(f);
    }
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3b3a4a })));
}

function guitar(color) {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 16).rotateX(Math.PI / 2), color, [0, 0, 0], g);
  mesh(new THREE.BoxGeometry(0.08, 0.85, 0.06), 0x5b3a22, [0, 0.5, 0], g);
  g.position.set(0.05, 0.6, 0.36);
  g.rotation.z = -0.95;
  return g;
}

// ---------- KONSER / FESTIVAL ----------
function concert(scene, cfg, R) {
  const fest = cfg.type === "festival";
  const pal = cfg.palette;
  lights(scene, 0xffffff, fest ? 0x9ab07a : 0x9a8fb0);
  base(scene, 26, 20, fest ? 0x8fcf6a : 0x6b6485, fest ? 0x6a4a35 : 0x4a4360);

  // Panggung + tangga depan
  mesh(rbox(14, 1.4, 6.4, 0.25), 0x34304a, [0, 0.7, -6], scene);
  mesh(rbox(14.2, 0.3, 0.3, 0.12), pal[0], [0, 1.35, -2.85], scene);
  mesh(rbox(3, 0.7, 1, 0.12), 0x4a4566, [0, 0.35, -2.3], scene);

  // Lengkung atap + layar LED
  mesh(new THREE.TorusGeometry(7.6, 0.38, 12, 48, Math.PI), 0xf3f0fa, [0, 1.4, -8.6], scene).scale.y = 0.95;
  const led = canvasTex(256, 112, (g, w, h, t = 0, boost = 0) => {
    g.fillStyle = "#231c3d"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 24; i++) {
      const v = Math.abs(Math.sin(i * 0.55 + t * 3.1) * Math.sin(i * 0.13 - t * 1.3)) * (0.75 + boost * 0.5);
      const bh = Math.min(h - 14, 8 + v * (h - 18));
      g.fillStyle = pal[i % pal.length];
      g.beginPath(); g.roundRect(i * 10.6 + 3, h - bh - 7, 7, bh, 3.5); g.fill();
    }
  });
  mesh(rbox(12.6, 5.4, 0.4, 0.2), 0x2a2540, [0, 4.4, -8.8], scene);
  mesh(new THREE.PlaneGeometry(12, 4.9), new THREE.MeshBasicMaterial({ map: led }), [0, 4.4, -8.58], scene);

  // Speaker
  for (const s of [-1, 1]) {
    const box = mesh(rbox(1.8, 3.4, 1.5, 0.2), 0x2b2838, [s * 8.6, 1.7, -4.6], scene);
    for (const y of [-0.8, 0.7]) mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 24).rotateX(Math.PI / 2), 0x6c6888, [0, y, 0.76], box);
    mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 24), pal[1], [0, 0.7, 0.8], box);
  }

  // Band: vokalis di tengah, sisanya pegang gitar
  const band = [], n = cfg.performers - 1;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -4.2 + (8.4 / (n - 1)) * i;
    const p = person(pal[i % pal.length], R);
    p.position.set(x, 1.4, -4);
    if (i === Math.floor(n / 2)) {
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5), 0x333333, [0, 0.75, 0.55], p);
      mesh(new THREE.SphereGeometry(0.09, 10, 8), 0x222222, [0, 1.52, 0.5], p);
    } else p.add(guitar(i % 2 ? 0xe74c3c : 0xf5f5f5));
    p.scale.setScalar(1.35);
    p.userData.phase = R() * 6;
    band.push(p);
    scene.add(p);
  }
  mesh(rbox(4.4, 0.6, 2.6, 0.15), 0x4a4566, [0, 1.7, -7.2], scene);
  const drummer = person(0x2d2a3e, R);
  drummer.scale.setScalar(1.25);
  drummer.position.set(0, 2, -7.6);
  scene.add(drummer);
  mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.6, 24).rotateX(Math.PI / 2), pal[0], [0, 2.75, -6.5], scene);
  mesh(new THREE.CircleGeometry(0.62, 24), 0xf5f5f5, [0, 2.75, -6.19], scene);
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.35, 20), pal[0], [s * 1.1, 3.1, -6.7], scene);
    mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 24), 0xf2c94c, [s * 1.7, 3.8, -7], scene);
  }

  // Lampu sorot dari lengkung atap
  const cones = [];
  for (let i = 0; i < cfg.lights; i++) {
    const a = 0.35 + (Math.PI - 0.7) * (i / (cfg.lights - 1));
    const from = new THREE.Vector3(Math.cos(a) * 7.6, 1.4 + Math.sin(a) * 7.2, -8.3);
    mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 12), 0x2b2838, from.toArray(), scene);
    const c = beam(from, new THREE.Vector3(from.x * 0.6, 1.4, -3), 1.3, pal[i % pal.length], 0.22);
    c.userData = { base: c.rotation.clone(), ph: R() * 6, sp: 0.6 + R() * 0.8 };
    cones.push(c);
    scene.add(c);
  }

  // Pagar pembatas kuning
  mesh(rbox(20, 0.7, 0.35, 0.12), 0xf6c343, [0, 0.35, -1.4], scene);

  // Penonton
  const N = Math.round(cfg.crowd * 0.45);
  const place = crowdMesh(scene, N, [...pal, 0xffffff, 0x5dade2, 0xf8c471], R);
  const pos = [...Array(N)].map(() => [(R() - 0.5) * 21, -0.6 + R() * 9.4, R() * 6, 0.85 + R() * 0.25]);

  // Hiasan: pohon, tiang lampu, bendera
  for (const [x, z, s] of [[-11.6, 8, 1.1], [11.4, 7.6, 0.9], [-11.8, -8, 1.3], [11.6, -7.6, 1]]) tree(scene, x, z, s, fest ? 0x6cbf5a : 0x7cc46a);
  bunting(scene, lamp(scene, -11.4, -1.2), lamp(scene, -11.4, 5.5), pal);
  bunting(scene, lamp(scene, 11.4, -1.2), lamp(scene, 11.4, 5.5), pal);
  if (fest) mesh(new THREE.SphereGeometry(2.4, 32, 24), glow(0xff9a4d), [-7, 12, -14], scene).castShadow = false;

  return {
    bg: fest ? "radial-gradient(120% 90% at 50% 30%, #fff1e2 0%, #f9d3b4 100%)" : "radial-gradient(120% 90% at 50% 30%, #f6f1ff 0%, #d8cdef 100%)",
    camera: [17, 15, 24], target: [0, 1.6, 0], hint: "Geser untuk memutar · klik untuk bikin penonton loncat",
    update(t, boost) {
      led.redraw(t, boost);
      cones.forEach((c) => {
        const u = c.userData;
        c.rotation.set(u.base.x + Math.sin(t * u.sp + u.ph) * 0.3, u.base.y + Math.cos(t * u.sp * 0.8 + u.ph) * 0.4, u.base.z);
        c.material.opacity = 0.14 + 0.1 * Math.abs(Math.sin(t * 2 + u.ph)) + boost * 0.15;
      });
      for (const p of band) {
        const ph = p.userData.phase;
        p.position.y = 1.4 + Math.abs(Math.sin(t * 4 + ph)) * 0.12 * (1 + boost * 3);
        p.userData.armR.rotation.z = 0.6 + Math.sin(t * 9 + ph) * 0.35;
        p.userData.armL.rotation.x = -1.1;
        p.userData.head.rotation.x = Math.sin(t * 4 + ph) * 0.2;
      }
      drummer.userData.armL.rotation.x = -1.2 + Math.sin(t * 12) * 0.5;
      drummer.userData.armR.rotation.x = -1.2 + Math.sin(t * 12 + Math.PI) * 0.5;
      pos.forEach(([x, z, ph, s], i) => place(i, x, Math.max(0, Math.sin(t * 5 + ph)) * (0.2 + boost * 0.9) * s, z, s));
    },
  };
}

// ---------- STAND-UP ----------
function standup(scene, cfg, R) {
  const pal = cfg.palette;
  lights(scene, 0xfff3e2, 0xb08a6a, 2);
  const planks = canvasTex(256, 256, (g, w) => {
    const r = rng(cfg.seed);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsl(28 ${45 + r() * 10}% ${52 + r() * 8}%)`;
      g.fillRect(0, i * 32, w, 32);
      g.fillStyle = "rgba(90,50,20,.35)";
      g.fillRect(0, i * 32, w, 2);
      g.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
    }
  });
  planks.wrapS = planks.wrapT = THREE.RepeatWrapping;
  planks.repeat.set(0.16, 0.16);
  base(scene, 20, 16, 0, 0x7a4e2e, planks);

  // Dinding bata belakang + dinding samping krem (potongan ruangan)
  const bricks = canvasTex(256, 256, (g, w, h) => {
    const r = rng(cfg.seed + 3);
    g.fillStyle = "#e9d2b4"; g.fillRect(0, 0, w, h);
    for (let y = 0, row = 0; y < h; y += 32, row++) for (let x = row % 2 ? -32 : 0; x < w; x += 64) {
      g.fillStyle = `hsl(${8 + r() * 8} 55% ${44 + r() * 10}%)`;
      g.beginPath(); g.roundRect(x + 3, y + 3, 58, 26, 6); g.fill();
    }
  });
  bricks.wrapS = bricks.wrapT = THREE.RepeatWrapping;
  bricks.repeat.set(4, 1.6);
  mesh(rbox(20, 7.5, 0.7, 0.2), toon(0xffffff, { map: bricks }), [0, 3.75, -7.65], scene);
  mesh(rbox(0.7, 7.5, 16, 0.2), 0xf1e3cf, [-9.65, 3.75, 0], scene);
  for (const [z, c] of [[-3, pal[0]], [2, pal[1]]]) {
    mesh(rbox(0.08, 2.4, 1.7, 0.05), 0x2b2b2b, [-9.27, 3.6, z], scene);
    mesh(rbox(0.06, 2.2, 1.5, 0.05), c, [-9.22, 3.6, z], scene);
  }

  // Tirai merah di kiri-kanan panggung
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    mesh(new THREE.CylinderGeometry(0.28, 0.32, 6.8, 12), 0xc0392b, [s * (4.4 + i * 0.5), 3.4, -6.9 + (i % 2) * 0.2], scene);
  }

  // Neon
  const neonColor = pal[0];
  const neon = canvasTex(512, 128, (g, w, h, flick = 1) => {
    g.clearRect(0, 0, w, h);
    g.font = "900 78px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 10; g.strokeStyle = "#2a1530"; g.strokeText(cfg.neon, w / 2, h / 2);
    g.shadowColor = neonColor; g.shadowBlur = 26 * flick;
    g.fillStyle = flick > 0.5 ? "#fffbe6" : neonColor;
    g.fillText(cfg.neon, w / 2, h / 2);
  });
  mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: neon, transparent: true }), [0, 5.7, -7.25], scene).castShadow = false;

  // Panggung bundar
  mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.6, 48), 0x3a2a3f, [0, 0.3, -4.2], scene);
  mesh(new THREE.TorusGeometry(3.62, 0.08, 8, 64).rotateX(Math.PI / 2), pal[1], [0, 0.6, -4.2], scene);

  const comic = person(pal[2] ?? pal[0], R);
  comic.scale.setScalar(1.35);
  comic.position.set(0, 0.6, -3.9);
  scene.add(comic);
  const stand = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 20), 0x222222, [0, 0, 0], stand);
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.1), 0x444444, [0, 1.05, 0], stand);
  mesh(new THREE.SphereGeometry(0.12, 12, 10), 0x222222, [0, 2.12, -0.05], stand);
  stand.position.set(0.25, 0.6, -2.9);
  scene.add(stand);
  const stool = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20), 0xd35400, [0, 1.15, 0], stool);
  for (let i = 0; i < 3; i++) mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.15), 0x2b2b2b, [Math.cos(i * 2.1) * 0.28, 0.58, Math.sin(i * 2.1) * 0.28], stool);
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 12), toon(0x7fd3f7, { transparent: true, opacity: 0.8 }), [0, 1.42, 0], stool);
  stool.position.set(-2, 0.6, -4.6);
  scene.add(stool);

  // Lampu gantung + sorot hangat
  mesh(rbox(10, 0.25, 0.25, 0.1), 0x2b2838, [0, 9.5, 5], scene);
  const from = new THREE.Vector3(0, 9.3, 5);
  mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.7, 12).rotateX(0.7), 0x2b2838, from.toArray(), scene);
  scene.add(beam(from, new THREE.Vector3(0, 0.6, -3.9), 1.9, 0xffe2a0, 0.2));
  mesh(new THREE.CircleGeometry(1.7, 40).rotateX(-Math.PI / 2), glow(0xfff0c2, 0.45), [0, 0.62, -3.9], scene).castShadow = false;

  // Meja bundar + lilin + penonton duduk
  const crowd = [], rows = cfg.audience_rows;
  for (let row = 0; row < rows; row++) {
    const n = 3 + row * 2, rad = 4.6 + row * (5.2 / Math.max(1, rows - 1));
    for (let i = 0; i < n; i++) {
      const a = -0.85 + (1.7 / (n - 1)) * i;
      const x = Math.sin(a) * rad, z = -4.2 + Math.cos(a) * rad;
      if (z > 7 || Math.abs(x) > 8.8) continue;
      if (i % 2 === 0) {
        const tx = Math.sin(a) * (rad - 0.9), tz = -4.2 + Math.cos(a) * (rad - 0.9);
        mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 20), 0x5a3a28, [tx, 0.85, tz], scene);
        mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.85, 8), 0x2b2b2b, [tx, 0.42, tz], scene);
        mesh(new THREE.SphereGeometry(0.07, 8, 6), glow(0xffb84d), [tx, 1.05, tz], scene).castShadow = false;
      }
      mesh(rbox(0.7, 0.5, 0.7, 0.1), 0x2b2838, [x, 0.25, z], scene);
      const p = person(new THREE.Color().setHSL(R(), 0.55, 0.55), R);
      p.position.set(x, 0.3, z);
      p.lookAt(0, 0.3, -4.2);
      p.userData.ph = R() * 6;
      crowd.push(p);
      scene.add(p);
    }
  }
  tree(scene, 8.4, 6.6, 0.7, 0x5fae5a);

  let nextLaugh = 3;
  return {
    bg: "radial-gradient(120% 90% at 50% 30%, #fff6ea 0%, #efd3b8 100%)",
    camera: [13, 12, 18], target: [0, 0.9, -1], hint: "Geser untuk memutar · klik untuk bikin penonton tertawa",
    update(t, boost) {
      if (t > nextLaugh) { boost = Math.max(boost, 0.6); if (t > nextLaugh + 1.4) nextLaugh = t + 4 + Math.random() * 4; }
      neon.redraw(Math.sin(t * 23) > -0.97 ? 1 : 0.2);
      comic.rotation.y = Math.sin(t * 0.7) * 0.5;
      comic.userData.armR.rotation.z = 0.4 + Math.abs(Math.sin(t * 1.6)) * 1.1;
      comic.userData.armR.rotation.x = Math.sin(t * 2.2) * 0.4;
      comic.userData.armL.rotation.x = -1.2 + Math.sin(t * 1.1) * 0.15;
      comic.userData.head.rotation.y = Math.sin(t * 1.3) * 0.3;
      for (const p of crowd) {
        const laugh = boost * Math.abs(Math.sin(t * 14 + p.userData.ph));
        p.position.y = 0.3 + laugh * 0.15;
        p.userData.head.rotation.x = -laugh * 0.5;
        p.userData.armL.rotation.z = -laugh * 1.2;
        p.userData.armR.rotation.z = laugh * 1.2;
      }
    },
  };
}

// ---------- SEMINAR ----------
function seminar(scene, cfg, R) {
  const accent = cfg.palette[0];
  lights(scene, 0xffffff, 0x8fa3c4);
  base(scene, 20, 16, 0x9fb3d6, 0x50607e);
  mesh(rbox(20, 7, 0.7, 0.2), 0xf4efe6, [0, 3.5, -7.65], scene);
  const slide = canvasTex(512, 288, (g, w, h, n = 0, p = 0) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.fillStyle = accent; g.fillRect(0, 0, w, 14);
    g.fillStyle = "#1e293b"; g.font = "800 42px system-ui"; g.fillText(`Sesi ${n + 1}`, 32, 82);
    g.fillStyle = "#475569"; g.font = "24px system-ui";
    ["Tren 2026", "Studi kasus", "Tanya jawab"].forEach((s, i) => g.fillText("• " + s, 36, 142 + i * 38));
    g.fillStyle = accent;
    [0.5, 0.8, 0.35, 0.65].forEach((v, i) => { g.beginPath(); g.roundRect(330 + i * 40, 255 - v * 140 * p, 28, v * 140 * p, 6); g.fill(); });
  });
  mesh(rbox(9.6, 5.6, 0.3, 0.15), 0x2b2838, [1.5, 4, -7.15], scene);
  mesh(new THREE.PlaneGeometry(9, 5.06), new THREE.MeshBasicMaterial({ map: slide }), [1.5, 4, -6.98], scene);
  mesh(rbox(1.4, 1.5, 0.9, 0.12), accent, [-5, 0.75, -4.5], scene);
  const speaker = person(0x334155, R);
  speaker.scale.setScalar(1.2);
  speaker.position.set(-5, 0, -5.4);
  scene.add(speaker);
  const crowd = [];
  for (let r = 0; r < cfg.rows; r++) for (let i = 0; i < 8; i++) {
    const x = -6.3 + i * 1.8, z = -1.2 + r * (7.8 / cfg.rows);
    mesh(rbox(1, 0.15, 0.9, 0.06), 0x3b4a6b, [x, 0.55, z], scene);
    mesh(rbox(1, 0.9, 0.14, 0.06), 0x3b4a6b, [x, 1, z + 0.42], scene);
    if (R() < 0.75) {
      const p = person(new THREE.Color().setHSL(R(), 0.5, 0.55), R);
      p.position.set(x, 0.35, z);
      p.rotation.y = Math.PI;
      p.userData.ph = R() * 6;
      crowd.push(p);
      scene.add(p);
    }
  }
  tree(scene, -8.4, -6, 0.7, 0x5fae5a);
  tree(scene, 8.4, -6, 0.7, 0x5fae5a);
  let page = 0, last = 0;
  return {
    bg: "radial-gradient(120% 90% at 50% 30%, #f3f7ff 0%, #ccd9ef 100%)",
    camera: [-12, 12, 18], target: [0, 1.8, -1], hint: "Geser untuk memutar · klik untuk tepuk tangan",
    update(t, boost) {
      if (t - last > 6) { page = (page + 1) % 3; last = t; }
      slide.redraw(page, Math.min(1, (t - last) / 1.5));
      speaker.userData.armR.rotation.x = -0.6 + Math.sin(t * 1.8) * 0.4;
      speaker.rotation.y = Math.sin(t * 0.5) * 0.4 + 0.4;
      for (const p of crowd) {
        const clap = boost * Math.abs(Math.sin(t * 16 + p.userData.ph));
        p.userData.armL.rotation.x = p.userData.armR.rotation.x = -1.2 * Math.min(1, boost * 2);
        p.userData.armL.rotation.z = -clap * 0.5;
        p.userData.armR.rotation.z = clap * 0.5;
        p.userData.head.rotation.x = Math.sin(t + p.userData.ph) * 0.08;
      }
    },
  };
}

// ---------- PAMERAN ----------
function exhibition(scene, cfg, R) {
  lights(scene, 0xffffff, 0xcfc4b0);
  base(scene, 20, 16, 0xe2c9a4, 0x9b7a55);
  mesh(rbox(20, 7, 0.7, 0.2), 0xfbfaf6, [0, 3.5, -7.65], scene);
  mesh(rbox(0.7, 7, 16, 0.2), 0xfbfaf6, [-9.65, 3.5, 0], scene);
  const back = Math.ceil(cfg.frames / 2);
  for (let i = 0; i < cfg.frames; i++) {
    const tex = canvasTex(256, 320, (g, w, h) => {
      const r = rng(cfg.seed + i * 7);
      g.fillStyle = "#fffdf7"; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = cfg.palette[k % cfg.palette.length];
        if (r() < 0.5) { g.beginPath(); g.arc(r() * w, r() * h, 20 + r() * 70, 0, 7); g.fill(); }
        else { g.beginPath(); g.roundRect(r() * w * 0.7, r() * h * 0.7, 30 + r() * 110, 20 + r() * 90, 12); g.fill(); }
      }
    });
    const f = new THREE.Group();
    mesh(rbox(2, 2.5, 0.16, 0.06), 0x2b2b2b, [0, 0, 0], f);
    mesh(new THREE.PlaneGeometry(1.75, 2.25), toon(0xffffff, { map: tex }), [0, 0, 0.09], f);
    if (i < back) f.position.set(-6.5 + (14 / Math.max(1, back - 1)) * i, 3.4, -7.2);
    else { f.position.set(-9.2, 3.4, -5 + (10 / Math.max(1, cfg.frames - back - 1)) * (i - back)); f.rotation.y = Math.PI / 2; }
    scene.add(f);
  }
  mesh(rbox(1.6, 1.3, 1.6, 0.12), 0xffffff, [0, 0.65, -1], scene);
  const sculpt = mesh(new THREE.TorusKnotGeometry(0.6, 0.2, 120, 16), cfg.palette[0], [0, 2.2, -1], scene);
  mesh(rbox(3, 0.5, 0.9, 0.1), 0x8b5a3c, [0, 0.45, 4.5], scene);
  const visitors = [...Array(6)].map((_, i) => {
    const p = person(new THREE.Color().setHSL(R(), 0.5, 0.55), R);
    p.userData = { ...p.userData, r: 3.4 + R() * 2.6, ph: (i / 6) * Math.PI * 2, sp: 0.08 + R() * 0.06 };
    scene.add(p);
    return p;
  });
  tree(scene, 8.4, 6.4, 0.7, 0x5fae5a);
  let spin = 0.5;
  return {
    bg: "radial-gradient(120% 90% at 50% 30%, #fbfaf5 0%, #e3dccd 100%)",
    camera: [13, 12, 18], target: [0, 1.8, -1], hint: "Geser untuk memutar · klik untuk memutar patung",
    update(t, boost, dt) {
      spin += (0.5 + boost * 6 - spin) * 0.1;
      sculpt.rotation.y += spin * dt;
      sculpt.rotation.x = Math.sin(t * 0.5) * 0.3;
      for (const p of visitors) {
        const a = p.userData.ph + t * p.userData.sp;
        p.position.set(Math.cos(a) * p.userData.r, Math.abs(Math.sin(t * 4 + p.userData.ph)) * 0.06, -1 + Math.sin(a) * p.userData.r);
        p.rotation.y = -a;
      }
    },
  };
}

const BUILDERS = { concert, festival: concert, standup, seminar, exhibition };

function mount(el) {
  const cfg = JSON.parse(el.querySelector("script[type='application/json']").textContent);
  const build = BUILDERS[cfg.type];
  if (!build) return;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", cursor: "grab" });
  el.appendChild(renderer.domElement);

  mats = new Map();
  const scene = new THREE.Scene();
  const api = build(scene, cfg, rng(cfg.seed));
  el.style.background = api.bg;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...api.target);
  Object.assign(controls, { enableDamping: true, enablePan: false, enableZoom: false, autoRotate: !reduce,
    autoRotateSpeed: 0.6, minPolarAngle: 0.35, maxPolarAngle: 1.25 });
  renderer.domElement.style.touchAction = "pan-y"; // tetap bisa scroll halaman di HP

  const hint = Object.assign(document.createElement("div"), { textContent: el.clientWidth < 520 ? api.hint.split(" · ")[1].replace("klik", "Ketuk") : api.hint });
  Object.assign(hint.style, { position: "absolute", left: "12px", bottom: "12px", padding: "6px 12px", borderRadius: "999px",
    background: "rgba(30,25,45,.7)", color: "#fff", font: "500 13px system-ui", pointerEvents: "none" });
  el.appendChild(hint);

  let boost = 0, down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) boost = 1;
    down = null;
  });
  controls.addEventListener("start", () => (controls.autoRotate = false));

  // Layar sempit (HP) = kamera mundur supaya diorama tetap muat
  const home = new THREE.Vector3(...api.camera).sub(controls.target);
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dir = camera.position.lengthSq() ? camera.position.clone().sub(controls.target).normalize() : home.clone().normalize();
    camera.position.copy(controls.target).addScaledVector(dir, home.length() * Math.max(1.3, 2 / camera.aspect));
    camera.updateProjectionMatrix();
    if (reduce) renderer.render(scene, camera);
  };
  new ResizeObserver(resize).observe(el);
  resize();

  let visible = false, last = performance.now(), t = 0;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "100px" }).observe(el);
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) return;
    t += dt;
    boost = Math.max(0, boost - dt * 0.7);
    api.update(t, boost, dt);
    controls.update();
    renderer.render(scene, camera);
  };
  if (reduce) {
    api.update(0, 0, 0);
    controls.addEventListener("change", () => renderer.render(scene, camera));
    controls.update();
    renderer.render(scene, camera);
  } else renderer.setAnimationLoop(frame);
}

document.querySelectorAll("[data-stage]").forEach(mount);
