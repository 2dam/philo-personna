import * as THREE from "./vendor/three.module.min.js";

// Gallery Tunnel — Originkit
// The component's Three.js tunnel algorithm is retained; React refs/props are
// connected directly to the Mindset 1000 static gateway.
const TUNNEL_WIDTH = 2;
const TUNNEL_HEIGHT = 1.8;
const SEGMENT_DEPTH = 1;
const NUM_SEGMENTS = 15;
const LINE_RADIUS = 0.003;
const SCROLL_TO_Z = 0.05;
const CAMERA_CHASE = 0.1;
const FADE_IN = 1;
const FOG_FAR = NUM_SEGMENTS * SEGMENT_DEPTH * 0.95;

const frame = document.querySelector("#galleryTunnel");
const canvas = document.querySelector("#galleryTunnelCanvas");

if (frame && canvas) {
  const images = [
    "assets/portraits-atlas.png#sun-tzu",
    "assets/portraits-atlas.png#nietzsche",
    "assets/portraits-atlas.png#adler",
    "assets/portraits-atlas.png#lincoln",
    "assets/portraits-atlas.png#sun-tzu-2",
    "assets/portraits-atlas.png#nietzsche-2",
    "assets/portraits-atlas.png#adler-2",
    "assets/portraits-atlas.png#lincoln-2",
  ];
  const palette = ["#132238", "#1f4f53", "#8c6f3f", "#34475f", "#376f67", "#66533a"];
  const background = "#071225";
  const lineColor = "#8fe0cf";
  const lineOpacity = 42;
  const grid = 4;
  const speed = 100;
  const fade = 100;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const fogNear = Math.min(
    FOG_FAR * (1 - Math.min(100, Math.max(0, fade)) / 100),
    FOG_FAR - 0.01
  );
  scene.fog = new THREE.Fog(new THREE.Color(background), fogNear, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000);
  camera.position.set(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const lineMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(lineColor),
    transparent: true,
    opacity: Math.min(100, Math.max(0, lineOpacity)) / 100,
  });
  const loader = new THREE.TextureLoader();
  const fading = [];
  let imageIndex = 0;
  let colorIndex = 0;
  let populateIndex = 0;
  let scrollPos = 0;
  let raf = 0;
  let last = 0;
  let alive = true;

  const hw = TUNNEL_WIDTH / 2;
  const hh = TUNNEL_HEIGHT / 2;
  const cols = Math.max(1, Math.round(grid));
  const rows = Math.max(1, Math.round(grid));
  const colW = TUNNEL_WIDTH / cols;
  const rowH = TUNNEL_HEIGHT / rows;
  const geoFloor = new THREE.PlaneGeometry(colW, SEGMENT_DEPTH);
  const geoWall = new THREE.PlaneGeometry(SEGMENT_DEPTH, rowH);
  const geoTubeZ = new THREE.TubeGeometry(
    new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -SEGMENT_DEPTH)),
    1,
    LINE_RADIUS,
    8
  );
  const geoTubeX = new THREE.TubeGeometry(
    new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(TUNNEL_WIDTH, 0, 0)),
    1,
    LINE_RADIUS,
    8
  );
  const geoTubeY = new THREE.TubeGeometry(
    new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, TUNNEL_HEIGHT, 0)),
    1,
    LINE_RADIUS,
    8
  );
  const colorMats = palette.map(
    (hex) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), side: THREE.DoubleSide })
  );
  const imageMats = images.map((url, imageSlot) => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    loader.load(
      url,
      (tex) => {
        if (!alive) {
          tex.dispose();
          return;
        }
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.repeat.set(0.5, 0.5);
        tex.offset.set((imageSlot % 2) * 0.5, imageSlot % 4 < 2 ? 0.5 : 0);
        mat.map = tex;
        mat.needsUpdate = true;
        fading.push(mat);
      },
      undefined,
      () => {}
    );
    return mat;
  });

  const tube = (geo, x, y, z = 0) => {
    const mesh = new THREE.Mesh(geo, lineMaterial);
    mesh.position.set(x, y, z);
    return mesh;
  };

  const slots = [];
  {
    const z = -SEGMENT_DEPTH / 2;
    for (let i = 0; i < cols; i++) {
      const x = -hw + i * colW + colW / 2;
      slots.push({
        geo: geoFloor,
        pos: new THREE.Vector3(x, -hh, z),
        rot: new THREE.Euler(-Math.PI / 2, 0, 0),
      });
      slots.push({
        geo: geoFloor,
        pos: new THREE.Vector3(x, hh, z),
        rot: new THREE.Euler(Math.PI / 2, 0, 0),
      });
    }
    for (let i = 0; i < rows; i++) {
      const y = -hh + i * rowH + rowH / 2;
      slots.push({
        geo: geoWall,
        pos: new THREE.Vector3(-hw, y, z),
        rot: new THREE.Euler(0, Math.PI / 2, 0),
      });
      slots.push({
        geo: geoWall,
        pos: new THREE.Vector3(hw, y, z),
        rot: new THREE.Euler(0, -Math.PI / 2, 0),
      });
    }
  }

  function populate(group) {
    const takesSlabs = populateIndex % 2 === 0;
    populateIndex++;
    for (const slab of group.userData.slabs) {
      if (!takesSlabs || Math.random() > 0.5) {
        slab.visible = false;
        continue;
      }
      slab.visible = true;
      if (Math.random() > 0.42) {
        slab.material = imageMats[(3 * imageIndex) % imageMats.length];
        imageIndex++;
      } else {
        slab.material = colorMats[(5 * colorIndex) % colorMats.length];
        colorIndex++;
      }
    }
  }

  function createSegment(z) {
    const group = new THREE.Group();
    group.position.z = z;
    for (let i = 0; i <= cols; i++) {
      const x = -hw + i * colW;
      group.add(tube(geoTubeZ, x, -hh));
      group.add(tube(geoTubeZ, x, hh));
    }
    for (let i = 1; i < rows; i++) {
      const y = -hh + i * rowH;
      group.add(tube(geoTubeZ, -hw, y));
      group.add(tube(geoTubeZ, hw, y));
    }
    group.add(tube(geoTubeX, -hw, -hh));
    group.add(tube(geoTubeX, -hw, hh));
    group.add(tube(geoTubeY, -hw, -hh));
    group.add(tube(geoTubeY, hw, -hh));
    const slabs = slots.map((slot) => {
      const mesh = new THREE.Mesh(slot.geo, colorMats[0]);
      mesh.position.copy(slot.pos);
      mesh.rotation.copy(slot.rot);
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    });
    group.userData.slabs = slabs;
    populate(group);
    return group;
  }

  const segments = [];
  for (let i = 0; i < NUM_SEGMENTS; i++) {
    const group = createSegment(-i * SEGMENT_DEPTH);
    scene.add(group);
    segments.push(group);
  }

  const resize = () => {
    const width = Math.max(1, frame.clientWidth);
    const height = Math.max(1, frame.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(frame);
  resize();

  const animate = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(animate);
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    scrollPos += Math.max(0, speed) / 100;
    const want = -SCROLL_TO_Z * scrollPos;
    camera.position.z += CAMERA_CHASE * (want - camera.position.z);
    const span = NUM_SEGMENTS * SEGMENT_DEPTH;
    const z = camera.position.z;
    for (const segment of segments) {
      if (segment.position.z > z + SEGMENT_DEPTH) {
        let min = 0;
        for (const item of segments) min = Math.min(min, item.position.z);
        segment.position.z = min - SEGMENT_DEPTH;
        populate(segment);
      } else if (segment.position.z < z - span - SEGMENT_DEPTH) {
        let max = -999999;
        for (const item of segments) max = Math.max(max, item.position.z);
        segment.position.z = max + SEGMENT_DEPTH;
        populate(segment);
      }
    }
    for (let i = fading.length - 1; i >= 0; i--) {
      const material = fading[i];
      material.opacity = Math.min(1, material.opacity + dt / FADE_IN);
      if (material.opacity >= 1) fading.splice(i, 1);
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(animate);
  window.dispatchEvent(new Event("mindset:tunnel-ready"));

  window.addEventListener(
    "mindset:tunnel-complete",
    () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
    },
    { once: true }
  );
}

