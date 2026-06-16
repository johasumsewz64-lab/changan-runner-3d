const THREE = window.THREE;

if (!THREE) {
  throw new Error("Three.js 没有加载成功，请检查 vendor/three.module.js 或网络备用源。");
}

const canvas = document.getElementById("gameCanvas");
const scoreText = document.getElementById("scoreText");
const healthText = document.getElementById("healthText");
const speedText = document.getElementById("speedText");
const finalScore = document.getElementById("finalScore");
const startScreen = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const musicButton = document.getElementById("musicButton");
const touchControls = document.querySelector(".touch-controls");

const LANES = [-3.2, 0, 3.2];
const SPAWN_Z = -105;
const PLAYER_Z = 0;
const MAX_HEALTH = 3;
const PICKUP_COOLDOWN_MIN = 8.5;
const PICKUP_COOLDOWN_RANDOM = 5.5;
const ROCKET_PICKUP_CHANCE = 0.38;
const PROJECTILE_FIRE_INTERVAL = 10;
const ROCKET_CHARGE_DURATION = 8;
const LANDMARK_TYPES = ["tiananmen", "xinhuamen", "tiantan", "monument", "cctv"];
const OBSTACLE_TYPES = ["tank", "tank", "tank", "barrier", "gate"];
const LICENSED_MUSIC_URL = "assets/wo-ai-beijing-tiananmen.mp3";

const game = {
  state: "ready",
  width: 1,
  height: 1,
  time: 0,
  distance: 0,
  speed: 17,
  score: 0,
  health: MAX_HEALTH,
  invincibleTimer: 0,
  lane: 1,
  visualLaneX: 0,
  jumpTimer: 0,
  slideTimer: 0,
  jumpHeight: 0,
  slideAmount: 0,
  runPhase: 0,
  lastStepBucket: 0,
  obstacles: [],
  projectiles: [],
  rockets: [],
  pickups: [],
  explosions: [],
  spawnCooldown: 0.5,
  pickupCooldown: PICKUP_COOLDOWN_MIN,
  tankFireCooldown: PROJECTILE_FIRE_INTERVAL,
  rocketAmmo: 0,
  rocketEquipTimer: 0,
  rocketFireCooldown: 0,
  flashTimer: 0,
  lastFrame: 0,
};

const music = {
  enabled: false,
  userMuted: false,
  context: null,
  master: null,
  timer: null,
  nextNoteIndex: 0,
  nextNoteTime: 0,
  externalAudio: null,
  externalChecked: false,
  externalAvailable: false,
  usingExternal: false,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

const COLLISION_PROFILES = {
  tank: { halfWidth: 1.44, depth: 2.35 },
  barrier: { halfWidth: 0.86, depth: 0.72, jumpClearHeight: 1.05 },
  gate: { halfWidth: 0.9, depth: 0.82, slideClearAmount: 0.64 },
};

function updateMusicButton() {
  musicButton.textContent = music.enabled ? "音乐：开" : "音乐：关";
  musicButton.setAttribute("aria-pressed", String(music.enabled));
}

function setupAudioContext() {
  if (music.context) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  music.context = new AudioContext();
  music.master = music.context.createGain();
  music.master.gain.value = 0;
  music.master.connect(music.context.destination);
}

async function tryStartLicensedTrack() {
  if (!music.externalChecked) {
    music.externalChecked = true;
    try {
      const response = await fetch(LICENSED_MUSIC_URL, { method: "HEAD", cache: "no-store" });
      music.externalAvailable = response.ok;
    } catch {
      music.externalAvailable = false;
    }
  }

  if (!music.externalAvailable) return false;

  if (!music.externalAudio) {
    music.externalAudio = new Audio(LICENSED_MUSIC_URL);
    music.externalAudio.loop = true;
    music.externalAudio.volume = 0.36;
  }

  try {
    music.externalAudio.currentTime = music.externalAudio.currentTime || 0;
    await music.externalAudio.play();
    music.usingExternal = true;
    return true;
  } catch {
    music.externalAvailable = false;
    music.usingExternal = false;
    return false;
  }
}

function scheduleTone(frequency, startTime, duration, gainValue, type = "triangle") {
  if (!music.context || !music.master) return;

  const oscillator = music.context.createOscillator();
  const gain = music.context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(music.master);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.03);
}

function scheduleSynthLoop() {
  if (!music.enabled || music.usingExternal || !music.context) return;

  const melody = [392, 523, 587, 659, 587, 523, 440, 392, 440, 523, 659, 784, 659, 587, 523, 440];
  const bass = [196, 196, 220, 220, 262, 262, 220, 196];
  const step = 0.24;

  while (music.nextNoteTime < music.context.currentTime + 0.55) {
    const i = music.nextNoteIndex;
    const melodyNote = melody[i % melody.length];
    const bassNote = bass[Math.floor(i / 2) % bass.length];

    scheduleTone(melodyNote, music.nextNoteTime, 0.18, 0.055, "triangle");
    if (i % 2 === 0) scheduleTone(bassNote, music.nextNoteTime, 0.22, 0.028, "sine");
    if (i % 4 === 0) scheduleTone(melodyNote * 2, music.nextNoteTime + 0.06, 0.08, 0.018, "square");

    music.nextNoteIndex += 1;
    music.nextNoteTime += step;
  }

  music.timer = window.setTimeout(scheduleSynthLoop, 90);
}

function startSynthMusic() {
  setupAudioContext();
  if (!music.context || !music.master) return;

  music.usingExternal = false;
  if (music.context.state === "suspended") {
    void music.context.resume();
  }
  music.master.gain.cancelScheduledValues(music.context.currentTime);
  music.master.gain.setTargetAtTime(0.24, music.context.currentTime, 0.08);
  music.nextNoteTime = music.context.currentTime + 0.03;
  music.nextNoteIndex = 0;
  window.clearTimeout(music.timer);
  scheduleSynthLoop();
}

async function startMusic(options = {}) {
  if (options.fromGameStart && music.userMuted) return;
  if (music.enabled && (music.usingExternal || music.timer)) return;

  music.enabled = true;
  updateMusicButton();

  const startedLicensedTrack = await tryStartLicensedTrack();
  if (!startedLicensedTrack && music.enabled) {
    startSynthMusic();
  }
}

function stopMusic(options = {}) {
  if (options.manual) music.userMuted = true;
  music.enabled = false;
  music.usingExternal = false;
  updateMusicButton();
  window.clearTimeout(music.timer);
  music.timer = null;

  if (music.externalAudio) {
    music.externalAudio.pause();
  }

  if (music.context && music.master) {
    music.master.gain.cancelScheduledValues(music.context.currentTime);
    music.master.gain.setTargetAtTime(0.0001, music.context.currentTime, 0.05);
  }
}

function toggleMusic() {
  if (music.enabled) {
    stopMusic({ manual: true });
  } else {
    music.userMuted = false;
    void startMusic();
  }
}

const isMobileView = () =>
  window.innerWidth <= 780 || window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83c9ff);
scene.fog = new THREE.Fog(0x83c9ff, 42, 138);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 220);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobileView(),
  powerPreference: "high-performance",
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const world = new THREE.Group();
const roadGroup = new THREE.Group();
const sceneryGroup = new THREE.Group();
const obstacleGroup = new THREE.Group();
const projectileGroup = new THREE.Group();
const rocketGroup = new THREE.Group();
const pickupGroup = new THREE.Group();
const explosionGroup = new THREE.Group();
const particleGroup = new THREE.Group();
scene.add(world, roadGroup, sceneryGroup, obstacleGroup, projectileGroup, rocketGroup, pickupGroup, explosionGroup, particleGroup);

const materials = {
  skyBlue: new THREE.MeshStandardMaterial({ color: 0x83c9ff, roughness: 1 }),
  road: new THREE.MeshStandardMaterial({ color: 0x394452, roughness: 0.92 }),
  shoulder: new THREE.MeshStandardMaterial({ color: 0x5f6d7c, roughness: 0.95 }),
  laneWhite: new THREE.MeshStandardMaterial({ color: 0xf4f6f6, roughness: 0.65 }),
  laneYellow: new THREE.MeshStandardMaterial({ color: 0xffd85f, roughness: 0.65 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf7f5ec, roughness: 0.72 }),
  shirtShade: new THREE.MeshStandardMaterial({ color: 0xd9ddd7, roughness: 0.78 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xf1c39b, roughness: 0.72 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x1f2530, roughness: 0.82 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x111722, roughness: 0.8 }),
  shoe: new THREE.MeshStandardMaterial({ color: 0x0f1320, roughness: 0.68 }),
  tie: new THREE.MeshStandardMaterial({ color: 0x202a3b, roughness: 0.72 }),
  belt: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.75 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xf0bf45, roughness: 0.56 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb72b2b, roughness: 0.78 }),
  deepRed: new THREE.MeshStandardMaterial({ color: 0x7c1d1d, roughness: 0.82 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xd8d0bd, roughness: 0.86 }),
  marble: new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.74 }),
  whiteWall: new THREE.MeshStandardMaterial({ color: 0xf7f0df, roughness: 0.82 }),
  templeBlue: new THREE.MeshStandardMaterial({ color: 0x2468a8, roughness: 0.7 }),
  glassBlue: new THREE.MeshStandardMaterial({ color: 0x5aa4c8, roughness: 0.42, metalness: 0.12 }),
  darkGlass: new THREE.MeshStandardMaterial({ color: 0x263d52, roughness: 0.35, metalness: 0.18 }),
  tank: new THREE.MeshStandardMaterial({ color: 0x546e4f, roughness: 0.9 }),
  tankDark: new THREE.MeshStandardMaterial({ color: 0x263a2e, roughness: 0.92 }),
  tankLight: new THREE.MeshStandardMaterial({ color: 0xbfd0a9, roughness: 0.78 }),
  tankMetal: new THREE.MeshStandardMaterial({ color: 0x1f2d28, roughness: 0.82 }),
  tankTrim: new THREE.MeshStandardMaterial({ color: 0x7f986e, roughness: 0.84 }),
  projectile: new THREE.MeshStandardMaterial({ color: 0x373f4d, roughness: 0.62 }),
  projectileTip: new THREE.MeshStandardMaterial({ color: 0xf0bf45, roughness: 0.5 }),
  rocketTube: new THREE.MeshStandardMaterial({ color: 0x2d3b35, roughness: 0.72 }),
  rocketBand: new THREE.MeshStandardMaterial({ color: 0xd9b445, roughness: 0.58 }),
  rocketBody: new THREE.MeshStandardMaterial({ color: 0xeff3ee, roughness: 0.55 }),
  rocketTip: new THREE.MeshStandardMaterial({ color: 0xd84632, roughness: 0.58 }),
  bun: new THREE.MeshStandardMaterial({ color: 0xfff0dd, roughness: 0.84 }),
  bunFold: new THREE.MeshStandardMaterial({ color: 0xe7c8aa, roughness: 0.88 }),
  powerupGlow: new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.46 }),
  barrier: new THREE.MeshStandardMaterial({ color: 0xd74836, roughness: 0.82 }),
  window: new THREE.MeshStandardMaterial({ color: 0xf8d58a, roughness: 0.55 }),
  tree: new THREE.MeshStandardMaterial({ color: 0x23945c, roughness: 0.9 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x8a552b, roughness: 0.95 }),
  dust: new THREE.MeshBasicMaterial({ color: 0xffdca6, transparent: true, opacity: 0.85 }),
  speedLine: new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  }),
};

function makeBox(width, height, depth, material, x = 0, y = 0, z = 0, parent = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

function makeSphere(radius, material, x = 0, y = 0, z = 0, parent = null, segments = 12) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, Math.max(6, Math.floor(segments * 0.65))),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

function makeCylinder(radiusTop, radiusBottom, height, material, x = 0, y = 0, z = 0, parent = null) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 10, 1, false),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

function makeCone(radius, height, material, x = 0, y = 0, z = 0, parent = null) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 4), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

function makeRoundCone(radius, height, material, x = 0, y = 0, z = 0, parent = null, segments = 18) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

function setMeshShadow(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    const materialsToDispose = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materialsToDispose) {
      if (material?.map) {
        material.map.dispose();
        material.dispose();
      }
    }
  });
}

function clearGroup(group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function createLabelPlane(text, width, height, x, y, z, parent, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const background = options.background ?? "#7c1d1d";
  const foreground = options.foreground ?? "#f7d87a";
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = foreground;
  context.lineWidth = 10;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = foreground;
  context.font = `bold ${options.fontSize ?? 48}px Microsoft YaHei, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  if (parent) parent.add(mesh);
  return mesh;
}

function buildLights() {
  const hemi = new THREE.HemisphereLight(0xf7fbff, 0x7d6545, 2.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.65);
  sun.position.set(-9, 16, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isMobileView() ? 1024 : 2048, isMobileView() ? 1024 : 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 70;
  scene.add(sun);
}

function buildRoad() {
  const road = makeBox(10.8, 0.12, 170, materials.road, 0, -0.06, -45, roadGroup);
  road.receiveShadow = true;
  makeBox(2.2, 0.1, 170, materials.shoulder, -6.5, -0.04, -45, roadGroup);
  makeBox(2.2, 0.1, 170, materials.shoulder, 6.5, -0.04, -45, roadGroup);

  for (const x of [-5.35, 5.35]) {
    makeBox(0.16, 0.04, 170, materials.laneYellow, x, 0.02, -45, roadGroup);
  }
}

const dashMeshes = [];
const speedLines = [];
const sceneryItems = [];
const dustPool = [];

function buildMotionStrips() {
  const dashCount = isMobileView() ? 24 : 34;
  const speedLineCount = isMobileView() ? 28 : 46;

  for (let i = 0; i < dashCount; i += 1) {
    for (const x of [-1.6, 1.6]) {
      const dash = makeBox(0.13, 0.055, 3.3, materials.laneWhite, x, 0.05, -i * 5, roadGroup);
      dashMeshes.push({ mesh: dash, base: -i * 5 });
    }
  }

  for (let i = 0; i < speedLineCount; i += 1) {
    const x = (i % 2 === 0 ? -1 : 1) * (2.5 + Math.random() * 2.45);
    const line = makeBox(0.06, 0.045, 3.4 + Math.random() * 3.5, materials.speedLine, x, 0.085, -i * 3.2, roadGroup);
    line.visible = false;
    speedLines.push({
      mesh: line,
      base: -i * 3.2,
      x,
      phase: Math.random() * 8,
    });
  }
}

function createBuilding(side, index) {
  const group = new THREE.Group();
  const width = 1.7 + (index % 3) * 0.4;
  const height = 4.8 + ((index * 7) % 5) * 0.7;
  const depth = 1.8 + (index % 2) * 0.7;
  const color = index % 4 === 0 ? 0xc98943 : index % 4 === 1 ? 0xd7a052 : index % 4 === 2 ? 0xb7773d : 0xd08b42;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88 });

  makeBox(width, height, depth, mat, 0, height / 2, 0, group);
  if (index % 3 === 0) {
    const roof = makeCone(width * 0.78, 0.95, materials.red, 0, height + 0.45, 0, group);
    roof.rotation.y = Math.PI / 4;
  } else if (index % 3 === 1) {
    makeBox(width * 1.12, 0.28, depth * 1.08, materials.deepRed, 0, height + 0.18, 0, group);
    const roof = makeCone(width * 0.62, 0.72, materials.gold, 0, height + 0.68, 0, group);
    roof.scale.z = 0.35;
    roof.rotation.y = Math.PI / 4;
  } else {
    makeBox(width * 1.08, 0.22, depth * 1.08, materials.stone, 0, height + 0.12, 0, group);
    makeBox(width * 0.72, 0.36, depth * 0.72, materials.red, 0, height + 0.42, 0, group);
  }
  makeBox(width * 1.04, 0.08, depth * 1.03, materials.gold, 0, height * 0.58, 0, group);
  makeBox(width * 0.46, 0.36, 0.05, materials.deepRed, 0, 0.46, side > 0 ? depth / 2 + 0.04 : -depth / 2 - 0.04, group);
  if (index % 4 === 2) {
    createLabelPlane("胡同", width * 0.46, 0.22, 0, 1.02, side > 0 ? depth / 2 + 0.05 : -depth / 2 - 0.05, group, {
      background: "#7c1d1d",
      foreground: "#f7d87a",
      fontSize: 42,
    });
  }

  for (let row = 0; row < 4; row += 1) {
    for (let col = -1; col <= 1; col += 2) {
      const window = makeBox(0.28, 0.28, 0.035, materials.window, col * width * 0.22, 1.25 + row * 0.86, side > 0 ? depth / 2 + 0.03 : -depth / 2 - 0.03, group);
      window.castShadow = false;
      window.receiveShadow = false;
    }
  }

  group.position.x = side * (13.4 + (index % 2) * 1.05);
  group.userData.baseZ = -138 + index * 48;
  group.userData.speedFactor = 0.7;
  group.userData.span = 240;
  group.scale.setScalar(0.82 + (index % 4) * 0.05);
  setMeshShadow(group);
  sceneryGroup.add(group);
  sceneryItems.push(group);
}

function createTree(side, index) {
  const group = new THREE.Group();
  makeCylinder(0.12, 0.17, 1.5, materials.trunk, 0, 0.75, 0, group);
  makeSphere(0.8, materials.tree, 0, 1.7, 0, group, 9);
  makeSphere(0.55, materials.tree, 0.42, 1.52, 0.18, group, 8);
  makeSphere(0.5, materials.tree, -0.38, 1.48, -0.08, group, 8);
  group.position.x = side * 6.25;
  group.userData.baseZ = -170 + index * 9.2;
  group.userData.speedFactor = 0.88;
  group.userData.span = 180;
  sceneryGroup.add(group);
  sceneryItems.push(group);
}

function createLamp(side, index) {
  const group = new THREE.Group();
  makeCylinder(0.045, 0.055, 3.0, new THREE.MeshStandardMaterial({ color: 0x596270, roughness: 0.78 }), 0, 1.5, 0, group);
  const arm = makeBox(0.9, 0.06, 0.06, new THREE.MeshStandardMaterial({ color: 0x596270, roughness: 0.78 }), side * -0.32, 2.95, 0, group);
  arm.rotation.z = side * 0.08;
  const lantern = makeBox(0.38, 0.48, 0.38, materials.red, side * -0.82, 2.72, 0, group);
  lantern.castShadow = false;
  makeBox(0.42, 0.08, 0.42, materials.gold, side * -0.82, 2.98, 0, group);
  group.position.x = side * 5.45;
  group.userData.baseZ = -168 + index * 12.5;
  group.userData.speedFactor = 0.98;
  group.userData.span = 180;
  sceneryGroup.add(group);
  sceneryItems.push(group);
}

function createBackdropGate() {
  const gate = new THREE.Group();
  makeBox(13.5, 3.0, 1.25, materials.red, 0, 2.05, 0, gate);
  makeBox(8.6, 0.75, 1.45, materials.deepRed, 0, 3.85, 0, gate);
  const roof1 = makeCone(7.8, 1.45, materials.gold, 0, 4.95, 0, gate);
  roof1.scale.z = 0.28;
  roof1.rotation.y = Math.PI / 4;
  const roof2 = makeCone(5.1, 1.05, materials.gold, 0, 5.72, 0, gate);
  roof2.scale.z = 0.28;
  roof2.rotation.y = Math.PI / 4;
  for (let i = -1; i <= 1; i += 1) {
    makeBox(1.4, 1.65, 1.36, materials.deepRed, i * 3.2, 1.25, 0.05, gate);
    makeBox(0.9, 1.05, 1.44, materials.gold, i * 3.2, 1.48, 0.12, gate);
  }
  gate.position.set(0, 0, -122);
  gate.scale.set(1.7, 1.7, 1.7);
  setMeshShadow(gate);
  sceneryGroup.add(gate);
}

function addTiledRoof(parent, width, depth, y, z, material, options = {}) {
  const trim = options.trim ?? materials.gold;
  const tiers = options.tiers ?? 3;
  const offsetX = options.x ?? 0;

  for (let i = 0; i < tiers; i += 1) {
    const layerWidth = width - i * 0.42;
    const layerDepth = depth - i * 0.24;
    const slab = makeBox(layerWidth, 0.12, layerDepth, material, offsetX, y + i * 0.11, z, parent);
    slab.rotation.x = i === 0 ? -0.03 : 0;
  }

  const tileCount = options.tileCount ?? Math.max(9, Math.floor(width / 0.36));
  for (let i = 0; i < tileCount; i += 1) {
    const x = offsetX - width * 0.42 + (i / Math.max(1, tileCount - 1)) * width * 0.84;
    const tile = makeCylinder(0.035, 0.04, depth * 0.88, material, x, y + tiers * 0.11 + 0.02, z, parent);
    tile.rotation.x = Math.PI / 2;
  }

  makeBox(width * 0.96, 0.09, 0.11, trim, offsetX, y + 0.26, z + depth * 0.48, parent);
  makeBox(width * 0.96, 0.09, 0.11, trim, offsetX, y + 0.26, z - depth * 0.48, parent);
  makeBox(0.12, 0.13, depth * 0.94, trim, offsetX - width * 0.49, y + 0.25, z, parent);
  makeBox(0.12, 0.13, depth * 0.94, trim, offsetX + width * 0.49, y + 0.25, z, parent);

  for (const x of [offsetX - width * 0.5, offsetX + width * 0.5]) {
    for (const edgeZ of [z - depth * 0.48, z + depth * 0.48]) {
      const corner = makeBox(0.34, 0.16, 0.24, trim, x, y + 0.32, edgeZ, parent);
      corner.rotation.z = x < offsetX ? 0.28 : -0.28;
    }
  }
}

function addStoneRailing(parent, width, depth, y, z) {
  makeBox(width, 0.14, 0.12, materials.marble, 0, y, z + depth / 2, parent);
  makeBox(width, 0.14, 0.12, materials.marble, 0, y, z - depth / 2, parent);
  makeBox(0.12, 0.14, depth, materials.marble, -width / 2, y, z, parent);
  makeBox(0.12, 0.14, depth, materials.marble, width / 2, y, z, parent);

  for (let i = 0; i <= 8; i += 1) {
    const x = -width / 2 + (i / 8) * width;
    makeBox(0.18, 0.34, 0.18, materials.marble, x, y + 0.16, z + depth / 2, parent);
    makeBox(0.18, 0.34, 0.18, materials.marble, x, y + 0.16, z - depth / 2, parent);
  }
}

function addFrontStairs(parent, width, z, y = 0.16, steps = 5) {
  for (let i = 0; i < steps; i += 1) {
    makeBox(width - i * 0.16, 0.08, 0.24, materials.stone, 0, y + i * 0.08, z - i * 0.18, parent);
  }
}

function addFacadeDoor(parent, x, y, width, height, z, options = {}) {
  makeBox(width + 0.16, height + 0.18, 0.08, materials.gold, x, y, z, parent);
  makeBox(width, height, 0.09, options.material ?? materials.deepRed, x, y, z + 0.02, parent);
  for (let i = 0; i < 3; i += 1) {
    makeSphere(0.035, materials.gold, x + width * 0.24, y - height * 0.25 + i * height * 0.22, z + 0.08, parent, 8);
    makeSphere(0.035, materials.gold, x - width * 0.24, y - height * 0.25 + i * height * 0.22, z + 0.08, parent, 8);
  }
}

function addFacadeWindows(parent, count, width, y, z) {
  for (let i = 0; i < count; i += 1) {
    const x = -width / 2 + ((i + 0.5) / count) * width;
    makeBox(0.42, 0.44, 0.08, materials.deepRed, x, y, z, parent);
    makeBox(0.34, 0.34, 0.09, materials.tankDark, x, y, z + 0.03, parent);
    makeBox(0.04, 0.34, 0.1, materials.gold, x, y, z + 0.07, parent);
    makeBox(0.34, 0.04, 0.1, materials.gold, x, y, z + 0.07, parent);
  }
}

function addCircularRailing(parent, radius, y, count = 18) {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    makeCylinder(0.04, 0.055, 0.34, materials.marble, Math.sin(angle) * radius, y, Math.cos(angle) * radius, parent);
  }
}

function addRadialRoofTiles(parent, radius, y, material, count = 26) {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    const strip = makeBox(0.03, 0.055, radius * 0.88, material, Math.sin(angle) * radius * 0.33, y, Math.cos(angle) * radius * 0.33, parent);
    strip.rotation.y = angle;
  }
}

function addTiananmenLandmark(group) {
  makeBox(8.2, 0.28, 2.7, materials.stone, 0, 0.14, 0, group);
  makeBox(7.8, 1.35, 2.3, materials.red, 0, 0.92, 0, group);
  makeBox(8.35, 0.28, 2.5, materials.marble, 0, 1.72, 0, group);
  addStoneRailing(group, 7.9, 2.25, 1.92, 0);
  addFrontStairs(group, 2.2, 1.72, 0.2, 4);

  addFacadeDoor(group, -2.35, 0.78, 0.62, 0.92, 1.17, { material: materials.tankDark });
  addFacadeDoor(group, 0, 0.78, 0.78, 1.14, 1.18, { material: materials.tankDark });
  addFacadeDoor(group, 2.35, 0.78, 0.62, 0.92, 1.17, { material: materials.tankDark });

  makeBox(6.3, 1.1, 1.55, materials.deepRed, 0, 2.56, 0, group);
  makeBox(5.55, 0.95, 1.35, materials.red, 0, 3.52, 0, group);
  for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) {
    makeCylinder(0.07, 0.08, 1.0, materials.deepRed, x, 2.54, 0.82, group);
    makeBox(0.22, 0.26, 0.08, materials.gold, x, 2.05, 0.86, group);
  }
  addFacadeWindows(group, 7, 5.45, 2.66, 0.82);
  createLabelPlane("\u5929\u5b89\u95e8", 1.25, 0.34, 0, 3.26, 0.84, group, { fontSize: 42 });

  addTiledRoof(group, 7.4, 2.35, 3.08, 0, materials.gold, { tileCount: 18 });
  addTiledRoof(group, 5.8, 1.85, 4.14, 0, materials.gold, { tileCount: 14 });
}

function addXinhuamenLandmark(group) {
  makeBox(7.8, 0.25, 1.8, materials.marble, 0, 0.13, 0, group);
  makeBox(2.1, 2.0, 1.15, materials.red, 0, 1.18, 0, group);
  makeBox(2.9, 1.35, 1.05, materials.red, -2.55, 0.96, 0, group);
  makeBox(2.9, 1.35, 1.05, materials.red, 2.55, 0.96, 0, group);
  makeBox(2.5, 0.22, 1.25, materials.marble, 0, 0.36, 0, group);
  makeBox(2.45, 0.2, 1.2, materials.marble, 0, 2.16, 0, group);
  makeBox(0.85, 1.35, 0.12, materials.tankDark, 0, 1.1, 0.6, group);
  makeBox(0.34, 1.1, 0.09, materials.deepRed, -0.24, 1.06, 0.68, group).rotation.y = -0.22;
  makeBox(0.34, 1.1, 0.09, materials.deepRed, 0.24, 1.06, 0.68, group).rotation.y = 0.22;

  addTiledRoof(group, 3.0, 1.42, 2.18, 0, materials.tankTrim, { trim: materials.tankLight, tileCount: 9 });
  addTiledRoof(group, 3.25, 1.24, 1.68, 0, materials.tankTrim, { trim: materials.tankLight, tileCount: 9, x: -2.55 });
  addTiledRoof(group, 3.25, 1.24, 1.68, 0, materials.tankTrim, { trim: materials.tankLight, tileCount: 9, x: 2.55 });

  for (const x of [-3.35, -1.75, 1.75, 3.35]) {
    makeBox(0.32, 0.42, 0.32, materials.marble, x, 0.55, 0.76, group);
    const cap = makeRoundCone(0.2, 0.18, materials.tankTrim, x, 0.86, 0.76, group, 8);
    cap.scale.y = 0.7;
  }
  createLabelPlane("\u65b0\u534e\u95e8", 1.08, 0.32, 0, 1.74, 0.62, group, {
    background: "#f4efe2",
    foreground: "#7c1d1d",
    fontSize: 42,
  });
}

function addTiantanLandmark(group) {
  makeCylinder(3.55, 3.7, 0.28, materials.marble, 0, 0.14, 0, group);
  makeCylinder(2.9, 3.05, 0.28, materials.marble, 0, 0.48, 0, group);
  makeCylinder(2.25, 2.4, 0.28, materials.marble, 0, 0.82, 0, group);
  addCircularRailing(group, 3.35, 0.7, 28);
  addCircularRailing(group, 2.75, 1.02, 22);
  addFrontStairs(group, 1.55, 3.6, 0.16, 6);
  addFrontStairs(group, 1.2, 2.85, 0.48, 5);

  makeCylinder(1.34, 1.42, 1.1, materials.red, 0, 1.45, 0, group);
  for (let i = 0; i < 16; i += 1) {
    const angle = (Math.PI * 2 * i) / 16;
    makeCylinder(0.045, 0.055, 1.06, materials.deepRed, Math.sin(angle) * 1.17, 1.45, Math.cos(angle) * 1.17, group);
  }
  const roof1 = makeRoundCone(2.05, 0.72, materials.templeBlue, 0, 2.26, 0, group, 32);
  roof1.scale.y = 0.58;
  addRadialRoofTiles(group, 1.95, 2.18, materials.glassBlue, 28);

  makeCylinder(1.02, 1.08, 0.72, materials.red, 0, 2.58, 0, group);
  const roof2 = makeRoundCone(1.64, 0.64, materials.templeBlue, 0, 3.12, 0, group, 32);
  roof2.scale.y = 0.58;
  addRadialRoofTiles(group, 1.54, 3.05, materials.glassBlue, 24);

  makeCylinder(0.7, 0.78, 0.6, materials.red, 0, 3.38, 0, group);
  const roof3 = makeRoundCone(1.18, 0.55, materials.templeBlue, 0, 3.84, 0, group, 32);
  roof3.scale.y = 0.58;
  addRadialRoofTiles(group, 1.1, 3.78, materials.glassBlue, 20);

  makeCylinder(0.12, 0.16, 0.3, materials.gold, 0, 4.08, 0, group);
  makeSphere(0.18, materials.gold, 0, 4.3, 0, group, 10);
  createLabelPlane("\u7948\u5e74\u6bbf", 0.84, 0.32, 0, 2.62, 1.06, group, {
    background: "#2468a8",
    foreground: "#f7d87a",
    fontSize: 40,
  });
}

function addMonumentLandmark(group) {
  makeBox(4.25, 0.24, 3.0, materials.stone, 0, 0.12, 0, group);
  makeBox(3.45, 0.28, 2.32, materials.marble, 0, 0.42, 0, group);
  makeBox(2.45, 0.34, 1.58, materials.stone, 0, 0.76, 0, group);
  addStoneRailing(group, 4.25, 3.0, 0.78, 0);
  addFrontStairs(group, 1.85, 1.72, 0.16, 6);

  makeBox(1.05, 4.25, 0.72, materials.marble, 0, 3.05, 0, group);
  makeBox(1.28, 0.22, 0.88, materials.stone, 0, 5.25, 0, group);
  makeBox(1.0, 0.18, 0.72, materials.marble, 0, 5.48, 0, group);
  const top = makeCone(0.56, 0.5, materials.marble, 0, 5.82, 0, group);
  top.scale.z = 0.7;
  top.rotation.y = Math.PI / 4;
  makeBox(0.78, 2.78, 0.05, materials.stone, 0, 3.18, 0.39, group);
  createLabelPlane("\u4eba\u6c11\u82f1\u96c4", 0.72, 0.34, 0, 3.8, 0.43, group, {
    background: "#d8d0bd",
    foreground: "#7c1d1d",
    fontSize: 32,
  });
  for (let i = 0; i < 7; i += 1) {
    makeSphere(0.055, materials.stone, -0.42 + i * 0.14, 1.22, 0.44, group, 8);
    makeBox(0.06, 0.28, 0.04, materials.stone, -0.42 + i * 0.14, 1.02, 0.45, group);
  }
}

function addCctvLandmark(group) {
  const towerA = makeBox(1.0, 5.55, 0.92, materials.darkGlass, -1.08, 2.76, 0, group);
  towerA.rotation.z = -0.18;
  const towerB = makeBox(1.0, 5.65, 0.92, materials.darkGlass, 1.1, 2.82, 0, group);
  towerB.rotation.z = 0.2;
  const bridgeTop = makeBox(3.55, 0.92, 0.94, materials.darkGlass, 0.02, 5.12, 0, group);
  bridgeTop.rotation.z = 0.04;
  const bridgeLow = makeBox(2.25, 0.62, 0.86, materials.darkGlass, 0.08, 1.16, 0, group);
  bridgeLow.rotation.z = -0.12;

  for (const x of [-1.08, 1.1, 0.02]) {
    for (let y = 1.1; y < 5.6; y += 0.72) {
      const diagA = makeBox(0.055, 1.08, 0.07, materials.marble, x, y, 0.5, group);
      diagA.rotation.z = 0.42;
      const diagB = makeBox(0.055, 1.08, 0.07, materials.marble, x, y, 0.51, group);
      diagB.rotation.z = -0.42;
    }
  }

  makeBox(3.8, 0.2, 2.25, materials.stone, 0, 0.1, 0, group);
  makeBox(0.9, 0.08, 0.58, materials.tankTrim, -1.15, 0.28, 0.84, group);
  makeBox(0.9, 0.08, 0.58, materials.tankTrim, 1.15, 0.28, 0.84, group);
  createLabelPlane("CCTV", 0.86, 0.32, 0, 0.68, 0.5, group, {
    background: "#263d52",
    foreground: "#bfefff",
    fontSize: 42,
  });
}

function buildLandmarkModel(group, type) {
  clearGroup(group);
  if (type === "tiananmen") addTiananmenLandmark(group);
  if (type === "xinhuamen") addXinhuamenLandmark(group);
  if (type === "tiantan") addTiantanLandmark(group);
  if (type === "monument") addMonumentLandmark(group);
  if (type === "cctv") addCctvLandmark(group);
  group.userData.landmarkType = type;
  setMeshShadow(group);
}

function randomLandmarkType(excludedType = "") {
  const options = LANDMARK_TYPES.filter((type) => type !== excludedType);
  return pick(options.length > 0 ? options : LANDMARK_TYPES);
}

function createLandmark(side, index) {
  const group = new THREE.Group();
  group.position.x = side * (9.55 + (index % 2) * 0.55);
  group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  group.userData = {
    baseZ: -184 + index * 24,
    speedFactor: 0.76,
    span: 192,
    isLandmark: true,
    side,
    lastZ: null,
    landmarkType: "",
  };
  group.scale.setScalar(0.78 + (index % 3) * 0.06);
  buildLandmarkModel(group, randomLandmarkType());
  sceneryGroup.add(group);
  sceneryItems.push(group);
}

function buildScenery() {
  createBackdropGate();
  const mobile = isMobileView();
  const buildingCount = mobile ? 2 : 3;
  const treeCount = mobile ? 10 : 16;
  const lampCount = mobile ? 8 : 13;
  const landmarkCount = mobile ? 6 : 8;

  for (let i = 0; i < buildingCount; i += 1) {
    createBuilding(-1, i);
    createBuilding(1, i + 4);
  }
  for (let i = 0; i < treeCount; i += 1) {
    createTree(-1, i);
    createTree(1, i + 7);
  }
  for (let i = 0; i < lampCount; i += 1) {
    createLamp(-1, i);
    createLamp(1, i + 3);
  }
  for (let i = 0; i < landmarkCount; i += 1) {
    createLandmark(i % 2 === 0 ? -1 : 1, i);
  }
}

function buildDustPool() {
  const dustCount = isMobileView() ? 20 : 34;
  for (let i = 0; i < dustCount; i += 1) {
    const particle = makeSphere(0.08, materials.dust, 0, -20, 0, particleGroup, 8);
    particle.visible = false;
    particle.userData.life = 0;
    dustPool.push(particle);
  }
}

const player = {
  root: new THREE.Group(),
  bodyPivot: new THREE.Group(),
  torso: null,
  hips: null,
  head: null,
  neck: null,
  leftArm: new THREE.Group(),
  rightArm: new THREE.Group(),
  leftLeg: new THREE.Group(),
  rightLeg: new THREE.Group(),
  leftKnee: new THREE.Group(),
  rightKnee: new THREE.Group(),
  leftShoe: null,
  rightShoe: null,
  rocketLauncher: null,
};

function buildPlayer() {
  player.root.position.set(0, 0, PLAYER_Z);
  player.root.rotation.y = Math.PI;
  player.root.add(player.bodyPivot);
  player.bodyPivot.position.y = 0;

  player.hips = makeBox(0.96, 0.35, 0.55, materials.pants, 0, 1.35, 0, player.bodyPivot);
  player.torso = makeBox(1.05, 1.18, 0.58, materials.white, 0, 2.17, 0.02, player.bodyPivot);

  makeBox(0.16, 0.84, 0.05, materials.tie, 0, 2.28, 0.36, player.bodyPivot);
  makeBox(0.27, 0.24, 0.05, materials.tie, 0, 2.67, 0.37, player.bodyPivot);
  makeBox(0.44, 0.2, 0.055, materials.white, 0.28, 2.34, 0.37, player.bodyPivot);

  for (let i = 0; i < 4; i += 1) {
    makeSphere(0.035, materials.tie, 0.02, 2.45 - i * 0.22, 0.39, player.bodyPivot, 8);
  }

  makeBox(1.02, 0.12, 0.64, materials.belt, 0, 1.55, 0.03, player.bodyPivot);
  makeBox(0.22, 0.16, 0.07, materials.gold, 0, 1.55, 0.39, player.bodyPivot);

  player.neck = makeCylinder(0.14, 0.16, 0.34, materials.skin, 0, 2.8, 0.0, player.bodyPivot);
  player.head = makeSphere(0.34, materials.skin, 0, 3.04, 0.05, player.bodyPivot, 16);
  player.head.scale.y = 1.08;
  const hairCap = makeSphere(0.36, materials.hair, 0, 3.24, -0.01, player.bodyPivot, 16);
  hairCap.scale.set(1.05, 0.66, 1.02);
  makeBox(0.52, 0.15, 0.15, materials.hair, 0, 3.25, 0.25, player.bodyPivot);
  const backHair = makeSphere(0.26, materials.hair, 0, 3.12, -0.24, player.bodyPivot, 12);
  backHair.scale.set(1.25, 0.9, 0.72);
  makeSphere(0.08, materials.hair, -0.28, 3.12, -0.1, player.bodyPivot, 8);
  makeSphere(0.08, materials.hair, 0.28, 3.12, -0.1, player.bodyPivot, 8);
  makeSphere(0.07, materials.skin, -0.34, 3.04, -0.02, player.bodyPivot, 8);
  makeSphere(0.07, materials.skin, 0.34, 3.04, -0.02, player.bodyPivot, 8);
  makeSphere(0.036, materials.hair, -0.13, 3.07, 0.36, player.bodyPivot, 8);
  makeSphere(0.036, materials.hair, 0.13, 3.07, 0.36, player.bodyPivot, 8);
  makeBox(0.12, 0.035, 0.03, materials.hair, -0.13, 3.18, 0.37, player.bodyPivot);
  makeBox(0.12, 0.035, 0.03, materials.hair, 0.13, 3.18, 0.37, player.bodyPivot);
  makeBox(0.2, 0.035, 0.035, new THREE.MeshStandardMaterial({ color: 0xb35d55, roughness: 0.7 }), 0, 2.92, 0.38, player.bodyPivot);

  player.leftArm.position.set(-0.66, 2.67, 0.02);
  player.rightArm.position.set(0.66, 2.67, 0.02);
  player.bodyPivot.add(player.leftArm, player.rightArm);
  buildArm(player.leftArm, -1);
  buildArm(player.rightArm, 1);

  player.leftLeg.position.set(-0.27, 1.27, 0.02);
  player.rightLeg.position.set(0.27, 1.27, 0.02);
  player.bodyPivot.add(player.leftLeg, player.rightLeg);
  buildLeg(player.leftLeg, player.leftKnee, -1);
  buildLeg(player.rightLeg, player.rightKnee, 1);
  buildShoulderRocketLauncher();

  player.root.scale.setScalar(0.68);
  setMeshShadow(player.root);
  scene.add(player.root);
}

function buildShoulderRocketLauncher() {
  const launcher = new THREE.Group();
  launcher.visible = false;
  launcher.position.set(0.56, 2.72, -0.02);
  launcher.rotation.set(0.03, 0, -0.08);

  const tube = makeCylinder(0.095, 0.095, 1.05, materials.rocketTube, 0, 0, 0, launcher);
  tube.rotation.x = Math.PI / 2;
  const frontBand = makeCylinder(0.108, 0.108, 0.13, materials.rocketBand, 0, 0, 0.45, launcher);
  frontBand.rotation.x = Math.PI / 2;
  const rearBand = makeCylinder(0.108, 0.108, 0.12, materials.rocketBand, 0, 0, -0.43, launcher);
  rearBand.rotation.x = Math.PI / 2;
  makeBox(0.12, 0.28, 0.12, materials.rocketTube, 0.02, -0.2, -0.12, launcher);
  makeBox(0.22, 0.08, 0.34, materials.rocketBand, 0.02, -0.36, -0.08, launcher);

  player.rocketLauncher = launcher;
  player.bodyPivot.add(launcher);
}

function buildArm(armGroup, side) {
  const sleeve = makeBox(0.24, 0.5, 0.28, materials.white, 0, -0.23, 0, armGroup);
  sleeve.rotation.z = side * 0.08;
  const forearm = makeBox(0.2, 0.55, 0.22, materials.skin, 0, -0.75, 0.02, armGroup);
  forearm.rotation.z = side * 0.04;
  makeSphere(0.13, materials.skin, 0, -1.08, 0.06, armGroup, 10);
  if (side > 0) {
    makeBox(0.28, 0.08, 0.25, new THREE.MeshStandardMaterial({ color: 0x2f405d, roughness: 0.62 }), 0.01, -0.52, 0.03, armGroup);
  }
}

function buildLeg(legGroup, kneeGroup, side) {
  const upper = makeBox(0.34, 0.72, 0.36, materials.pants, 0, -0.36, 0, legGroup);
  upper.rotation.z = side * 0.03;
  kneeGroup.position.set(0, -0.72, 0);
  legGroup.add(kneeGroup);
  makeBox(0.3, 0.78, 0.32, materials.pants, 0, -0.38, 0, kneeGroup);
  const shoe = makeBox(0.42, 0.18, 0.72, materials.shoe, 0, -0.8, 0.18, kneeGroup);
  makeBox(0.38, 0.055, 0.66, new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 0.72 }), 0, -0.915, 0.19, kneeGroup);
  if (side < 0) player.leftShoe = shoe;
  if (side > 0) player.rightShoe = shoe;
}

function createTank(lane, z) {
  const group = new THREE.Group();
  group.userData = {
    type: "tank",
    lane,
    z,
    passed: false,
    wobble: Math.random() * Math.PI * 2,
    fireCooldown: 0,
  };

  makeBox(1.82, 0.7, 2.78, materials.tank, 0, 0.72, -0.08, group);
  makeBox(1.96, 0.18, 2.68, materials.tankTrim, 0, 1.12, -0.16, group);
  const frontArmor = makeBox(2.12, 0.82, 0.38, materials.tankTrim, 0, 0.78, 1.52, group);
  frontArmor.rotation.x = -0.08;
  const frontNose = makeBox(1.62, 0.46, 0.16, materials.tank, 0, 0.78, 1.78, group);
  frontNose.rotation.x = -0.18;
  makeBox(1.96, 0.24, 0.22, materials.tankDark, 0, 0.25, 1.62, group);
  makeBox(1.28, 0.32, 0.08, materials.tankDark, 0, 0.52, 1.84, group);
  const deckSlope = makeBox(1.7, 0.12, 0.66, materials.tankLight, 0, 1.2, 0.9, group);
  deckSlope.rotation.x = -0.3;
  makeBox(1.12, 0.58, 1.02, materials.tank, 0, 1.26, 0.18, group);
  makeBox(0.92, 0.22, 0.72, materials.tankTrim, 0, 1.6, 0.2, group);
  makeBox(0.6, 0.42, 0.22, materials.tankTrim, 0, 1.28, 0.88, group);
  const hatchBase = makeCylinder(0.36, 0.42, 0.16, materials.tankTrim, 0.02, 1.73, 0.14, group);
  hatchBase.rotation.y = Math.PI / 8;
  const hatch = makeCylinder(0.26, 0.32, 0.14, materials.tankDark, 0.02, 1.88, 0.14, group);
  hatch.rotation.y = Math.PI / 5;
  const cannon = makeCylinder(0.11, 0.15, 2.08, materials.tankDark, 0, 1.31, 1.42, group);
  cannon.rotation.x = Math.PI / 2;
  const muzzle = makeCylinder(0.19, 0.19, 0.26, materials.tankMetal, 0, 1.31, 2.56, group);
  muzzle.rotation.x = Math.PI / 2;

  for (const sideX of [-0.88, 0.88]) {
    makeBox(0.32, 0.54, 1.94, materials.tankDark, sideX, 0.34, -0.46, group);
    makeBox(0.36, 0.2, 1.72, materials.tankMetal, sideX, 0.64, -0.52, group);
    makeBox(0.3, 0.2, 0.18, materials.tankMetal, sideX, 0.21, 1.86, group);
    makeBox(0.3, 0.16, 0.16, materials.tankMetal, sideX, 0.43, 1.94, group);
    makeBox(0.3, 0.13, 0.14, materials.tankMetal, sideX, 0.62, 1.84, group);
    for (const treadX of [-0.065, 0.065]) {
      const frontWheel = makeCylinder(0.13, 0.13, 0.08, materials.tankLight, sideX + treadX, 0.34, 1.92, group);
      frontWheel.rotation.x = Math.PI / 2;
      const hub = makeCylinder(0.052, 0.052, 0.09, materials.tankMetal, sideX + treadX, 0.34, 1.97, group);
      hub.rotation.x = Math.PI / 2;
    }
    for (const wheelZ of [-1.1, -0.55, 0, 0.55]) {
      const sideWheel = makeCylinder(0.16, 0.16, 0.08, materials.tankLight, sideX, 0.31, wheelZ, group);
      sideWheel.rotation.z = Math.PI / 2;
      makeCylinder(0.07, 0.07, 0.09, materials.tankMetal, sideX, 0.31, wheelZ, group).rotation.z = Math.PI / 2;
    }
  }

  for (const lightX of [-0.7, 0.7]) {
    makeBox(0.28, 0.2, 0.08, materials.tankMetal, lightX, 0.74, 1.9, group);
    makeSphere(0.1, materials.window, lightX, 0.74, 1.95, group, 8);
  }

  makeBox(0.18, 0.26, 0.16, materials.tankMetal, -0.48, 1.75, -0.08, group);
  makeBox(0.44, 0.32, 0.34, materials.tankDark, -0.48, 1.98, -0.02, group);
  makeBox(0.32, 0.2, 0.04, materials.glassBlue, -0.48, 1.98, 0.17, group);
  makeCylinder(0.09, 0.11, 0.26, materials.tankMetal, 0.66, 1.78, -0.46, group);
  const antenna = makeCylinder(0.024, 0.03, 1.34, materials.tankDark, 0.66, 2.56, -0.46, group);
  makeSphere(0.04, materials.tankDark, antenna.position.x, 3.24, antenna.position.z, group, 8);

  for (const hookX of [-0.42, 0.42]) {
    const hook = makeBox(0.2, 0.32, 0.1, materials.gold, hookX, 0.98, 1.82, group);
    hook.rotation.z = hookX < 0 ? -0.18 : 0.18;
  }

  for (const boltX of [-0.72, -0.36, 0, 0.36, 0.72]) {
    makeSphere(0.045, materials.tankDark, boltX, 0.98, 1.58, group, 8);
  }

  group.position.set(LANES[lane], 0.03, z);
  group.rotation.y = 0;
  group.scale.set(1.48, 1.78, 1.72);
  setMeshShadow(group);
  obstacleGroup.add(group);
  return group;
}

function createProjectile(tank) {
  const group = new THREE.Group();
  const tankData = tank.userData;
  const startX = tank.position.x;
  const startZ = tankData.z + 2.68 * tank.scale.z;
  const startY = 1.31 * tank.scale.y;

  const body = makeCylinder(0.105, 0.13, 0.62, materials.projectile, 0, 0, 0, group);
  body.rotation.x = Math.PI / 2;
  const tip = makeCone(0.14, 0.26, materials.projectileTip, 0, 0, 0.43, group);
  tip.rotation.x = Math.PI / 2;
  makeSphere(0.06, materials.projectileTip, 0, 0.13, -0.24, group, 8);

  group.position.set(startX, startY, startZ);
  group.userData = {
    type: "projectile",
    lane: tankData.lane,
    z: startZ,
    y: startY,
    velocityZ: game.speed + 27,
    velocityX: 0,
    wobble: Math.random() * Math.PI * 2,
    hit: false,
  };
  setMeshShadow(group);
  projectileGroup.add(group);
  return group;
}

function createBun(lane, z = SPAWN_Z) {
  const group = new THREE.Group();
  const bunBase = makeSphere(0.36, materials.bun, 0, 0.36, 0, group, 14);
  bunBase.scale.set(1.12, 0.64, 1.0);
  makeSphere(0.1, materials.bunFold, 0, 0.62, 0, group, 8);

  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6;
    const fold = makeCylinder(0.018, 0.026, 0.32, materials.bunFold, Math.cos(angle) * 0.12, 0.57, Math.sin(angle) * 0.12, group);
    fold.rotation.z = Math.cos(angle) * 0.45;
    fold.rotation.x = Math.sin(angle) * 0.45;
  }

  const steamMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38 });
  for (let i = 0; i < 3; i += 1) {
    const steam = makeSphere(0.055, steamMaterial, (i - 1) * 0.13, 0.86 + i * 0.07, 0, group, 8);
    steam.castShadow = false;
    steam.receiveShadow = false;
  }

  group.position.set(LANES[lane], 0.05, z);
  group.userData = {
    type: "bun",
    lane,
    z,
    wobble: Math.random() * Math.PI * 2,
  };
  setMeshShadow(group);
  pickupGroup.add(group);
  return group;
}

function createRocketLauncherPickup(lane, z = SPAWN_Z) {
  const group = new THREE.Group();

  const tube = makeCylinder(0.11, 0.11, 0.92, materials.rocketTube, 0, 0.42, 0, group);
  tube.rotation.z = Math.PI / 2;
  const muzzle = makeCylinder(0.14, 0.14, 0.16, materials.rocketBand, 0.5, 0.42, 0, group);
  muzzle.rotation.z = Math.PI / 2;
  const rear = makeCylinder(0.13, 0.13, 0.13, materials.tankMetal, -0.48, 0.42, 0, group);
  rear.rotation.z = Math.PI / 2;
  makeBox(0.12, 0.22, 0.12, materials.rocketTube, -0.12, 0.24, 0, group);
  makeBox(0.26, 0.08, 0.16, materials.rocketBand, 0.12, 0.21, 0, group);
  const glow = makeSphere(0.62, materials.powerupGlow, 0, 0.42, 0, group, 12);
  glow.castShadow = false;
  glow.receiveShadow = false;

  group.position.set(LANES[lane], 0.04, z);
  group.userData = {
    type: "rocketLauncher",
    lane,
    z,
    wobble: Math.random() * Math.PI * 2,
  };
  setMeshShadow(group);
  pickupGroup.add(group);
  return group;
}

function createBarrier(lane, z) {
  const group = new THREE.Group();
  group.userData = { type: "barrier", lane, z, passed: false, wobble: Math.random() * Math.PI * 2 };
  makeBox(2.1, 0.78, 0.32, materials.barrier, 0, 0.55, 0, group);
  for (let i = -1; i <= 1; i += 1) {
    const stripe = makeBox(0.22, 0.9, 0.36, materials.gold, i * 0.56, 0.56, 0.03, group);
    stripe.rotation.z = -0.42;
  }
  makeBox(2.35, 0.14, 0.45, materials.deepRed, 0, 0.15, 0, group);
  group.position.set(LANES[lane], 0.02, z);
  setMeshShadow(group);
  obstacleGroup.add(group);
  return group;
}

function createGateObstacle(lane, z) {
  const group = new THREE.Group();
  group.userData = { type: "gate", lane, z, passed: false, wobble: Math.random() * Math.PI * 2 };
  makeBox(0.28, 2.5, 0.34, materials.deepRed, -1.05, 1.25, 0, group);
  makeBox(0.28, 2.5, 0.34, materials.deepRed, 1.05, 1.25, 0, group);
  makeBox(2.42, 0.34, 0.38, materials.red, 0, 2.48, 0, group);
  const roof = makeCone(1.55, 0.7, materials.gold, 0, 2.95, 0, group);
  roof.scale.z = 0.28;
  roof.rotation.y = Math.PI / 4;
  makeBox(1.3, 0.18, 0.42, materials.gold, 0, 2.22, 0.02, group);
  group.position.set(LANES[lane], 0.02, z);
  setMeshShadow(group);
  obstacleGroup.add(group);
  return group;
}

function spawnObstacle(type, lane, z = SPAWN_Z) {
  if (type === "tank") return createTank(lane, z);
  if (type === "barrier") return createBarrier(lane, z);
  return createGateObstacle(lane, z);
}

function spawnWave() {
  const difficulty = clamp(game.distance / 1100, 0, 1);
  const count = Math.random() < 0.28 + difficulty * 0.32 ? 2 : 1;
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, count);

  for (const lane of lanes) {
    let type = pick(OBSTACLE_TYPES);
    if (game.distance < 130 && type === "gate") type = "tank";
    const obstacle = spawnObstacle(type, lane, SPAWN_Z - Math.random() * 5);
    game.obstacles.push(obstacle);
  }

  game.spawnCooldown = lerp(1.12, 0.58, difficulty) + Math.random() * 0.18;
}

function spawnPickup() {
  if (game.pickups.length > 0) {
    game.pickupCooldown = PICKUP_COOLDOWN_MIN * 0.65;
    return;
  }

  const openLanes = [0, 1, 2].filter(
    (lane) =>
      !game.obstacles.some(
        (obstacle) => obstacle.userData.lane === lane && Math.abs(obstacle.userData.z - SPAWN_Z) < 14,
      ),
  );
  const lane = pick(openLanes.length > 0 ? openLanes : [0, 1, 2]);
  const z = SPAWN_Z - Math.random() * 8;
  const pickup =
    Math.random() < ROCKET_PICKUP_CHANCE ? createRocketLauncherPickup(lane, z) : createBun(lane, z);
  game.pickups.push(pickup);
  game.pickupCooldown = PICKUP_COOLDOWN_MIN + Math.random() * PICKUP_COOLDOWN_RANDOM;
}

function removeObstacleAt(index) {
  const obstacle = game.obstacles[index];
  if (!obstacle) return;
  obstacleGroup.remove(obstacle);
  game.obstacles.splice(index, 1);
}

function removeObstacleObject(obstacle) {
  const index = game.obstacles.indexOf(obstacle);
  if (index >= 0) removeObstacleAt(index);
}

function removeProjectileAt(index) {
  const projectile = game.projectiles[index];
  if (!projectile) return;
  projectileGroup.remove(projectile);
  game.projectiles.splice(index, 1);
}

function removeRocketAt(index) {
  const rocket = game.rockets[index];
  if (!rocket) return;
  rocketGroup.remove(rocket);
  game.rockets.splice(index, 1);
}

function removePickupAt(index) {
  const pickup = game.pickups[index];
  if (!pickup) return;
  pickupGroup.remove(pickup);
  game.pickups.splice(index, 1);
}

function removeExplosionAt(index) {
  const explosion = game.explosions[index];
  if (!explosion) return;
  explosionGroup.remove(explosion);
  game.explosions.splice(index, 1);
}

function resetGame() {
  for (const obstacle of game.obstacles) {
    obstacleGroup.remove(obstacle);
  }
  for (const projectile of game.projectiles) {
    projectileGroup.remove(projectile);
  }
  for (const rocket of game.rockets) {
    rocketGroup.remove(rocket);
  }
  for (const pickup of game.pickups) {
    pickupGroup.remove(pickup);
  }
  for (const explosion of game.explosions) {
    explosionGroup.remove(explosion);
  }

  game.state = "running";
  game.time = 0;
  game.distance = 0;
  game.speed = 17;
  game.score = 0;
  game.health = MAX_HEALTH;
  game.invincibleTimer = 0;
  game.lane = 1;
  game.visualLaneX = 0;
  game.jumpTimer = 0;
  game.slideTimer = 0;
  game.jumpHeight = 0;
  game.slideAmount = 0;
  game.runPhase = 0;
  game.lastStepBucket = 0;
  game.obstacles = [];
  game.projectiles = [];
  game.rockets = [];
  game.pickups = [];
  game.explosions = [];
  game.spawnCooldown = 0.5;
  game.pickupCooldown = PICKUP_COOLDOWN_MIN;
  game.tankFireCooldown = PROJECTILE_FIRE_INTERVAL;
  game.rocketAmmo = 0;
  game.rocketEquipTimer = 0;
  game.rocketFireCooldown = 0;
  game.flashTimer = 0;
  player.root.visible = true;
  if (player.rocketLauncher) player.rocketLauncher.visible = false;
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  updateHud();
}

function gameOver() {
  if (game.state !== "running") return;
  game.state = "gameover";
  game.flashTimer = 0.42;
  player.root.visible = true;
  finalScore.textContent = String(game.score);
  window.setTimeout(() => {
    gameOverScreen.classList.remove("hidden");
  }, 240);
}

function updateHud() {
  scoreText.textContent = String(game.score);
  if (healthText) {
    healthText.textContent = "♥".repeat(game.health) + "♡".repeat(MAX_HEALTH - game.health);
  }
  speedText.textContent = `${(game.speed / 17).toFixed(1)}x`;
}

function damagePlayer() {
  if (game.state !== "running" || game.invincibleTimer > 0) return false;

  game.health = Math.max(0, game.health - 1);
  game.invincibleTimer = 1.25;
  game.flashTimer = 0.36;
  updateHud();

  if (game.health <= 0) {
    gameOver();
  }

  return true;
}

function healPlayer() {
  if (game.state !== "running") return;
  game.health = Math.min(MAX_HEALTH, game.health + 1);
  game.flashTimer = Math.max(game.flashTimer, 0.16);
  updateHud();
}

function grantRocketLauncher() {
  if (game.state !== "running") return;
  game.rocketAmmo = 1;
  game.rocketEquipTimer = ROCKET_CHARGE_DURATION;
  game.rocketFireCooldown = 0.35;
  game.flashTimer = Math.max(game.flashTimer, 0.18);
}

function findRocketTarget() {
  const tanks = game.obstacles.filter(
    (obstacle) =>
      obstacle.userData.type === "tank" &&
      obstacle.userData.z < PLAYER_Z - 4 &&
      obstacle.userData.z > SPAWN_Z + 4,
  );
  if (tanks.length === 0) return null;

  const sameLaneTanks = tanks.filter((tank) => tank.userData.lane === game.lane);
  const candidates = sameLaneTanks.length > 0 ? sameLaneTanks : tanks;
  return candidates.sort((a, b) => b.userData.z - a.userData.z)[0];
}

function createPlayerRocket(target) {
  const group = new THREE.Group();
  const startX = player.root.position.x + 0.32;
  const startY = player.root.position.y + 2.25;
  const startZ = PLAYER_Z - 0.62;

  const body = makeCylinder(0.075, 0.09, 0.62, materials.rocketBody, 0, 0, 0, group);
  body.rotation.x = Math.PI / 2;
  const tip = makeCone(0.11, 0.22, materials.rocketTip, 0, 0, -0.42, group);
  tip.rotation.x = -Math.PI / 2;
  makeBox(0.22, 0.045, 0.14, materials.rocketTip, 0, -0.08, 0.28, group);
  makeBox(0.045, 0.22, 0.14, materials.rocketTip, 0, -0.08, 0.28, group);

  group.position.set(startX, startY, startZ);
  group.userData = {
    type: "playerRocket",
    target,
    life: 2.6,
    speed: 52,
    wobble: Math.random() * Math.PI * 2,
  };
  setMeshShadow(group);
  rocketGroup.add(group);
  return group;
}

function tryFireRocket() {
  if (game.rocketAmmo <= 0 || game.rocketFireCooldown > 0 || game.rockets.length > 0) return;
  const target = findRocketTarget();
  if (!target) return;

  game.rocketAmmo = 0;
  game.rocketEquipTimer = 1.35;
  game.rocketFireCooldown = 1.1;
  game.rockets.push(createPlayerRocket(target));
}

function createExplosion(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0.86, z);
  group.userData = {
    life: 0.72,
    maxLife: 0.72,
    spin: (Math.random() - 0.5) * 2.4,
  };

  const colors = [0xfff07a, 0xffa340, 0xe94b35, 0x6e6a60];
  for (let i = 0; i < 15; i += 1) {
    const angle = (Math.PI * 2 * i) / 15;
    const radius = 0.12 + Math.random() * 0.48;
    const material = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: i % 4 === 3 ? 0.55 : 0.85,
      depthWrite: false,
    });
    const puff = makeSphere(0.14 + Math.random() * 0.2, material, Math.cos(angle) * radius, Math.random() * 0.55, Math.sin(angle) * radius, group, 9);
    puff.castShadow = false;
    puff.receiveShadow = false;
    puff.userData.outward = new THREE.Vector3(Math.cos(angle) * (0.9 + Math.random()), 0.5 + Math.random() * 1.2, Math.sin(angle) * (0.9 + Math.random()));
  }

  const flash = makeSphere(
    0.72,
    new THREE.MeshBasicMaterial({ color: 0xfff7b0, transparent: true, opacity: 0.62, depthWrite: false }),
    0,
    0.28,
    0,
    group,
    12,
  );
  flash.castShadow = false;
  flash.receiveShadow = false;

  explosionGroup.add(group);
  game.explosions.push(group);
  game.flashTimer = Math.max(game.flashTimer, 0.24);
}

function destroyTank(tank) {
  if (!tank || !game.obstacles.includes(tank)) return;
  createExplosion(tank.position.x, tank.userData.z);
  removeObstacleObject(tank);
  game.score += 250;
  updateHud();
}

function moveLane(direction) {
  if (game.state !== "running") return;
  game.lane = clamp(game.lane + direction, 0, 2);
}

function jump() {
  if (game.state !== "running" || game.jumpTimer > 0 || game.slideTimer > 0) return;
  game.jumpTimer = 0.68;
}

function slide() {
  if (game.state !== "running" || game.jumpTimer > 0 || game.slideTimer > 0) return;
  game.slideTimer = 0.72;
}

function handleAction(action) {
  if (action === "left") moveLane(-1);
  if (action === "right") moveLane(1);
  if (action === "jump") jump();
  if (action === "slide") slide();
}

function emitDust(x, z) {
  const particle = dustPool.find((item) => !item.visible);
  if (!particle) return;
  particle.visible = true;
  particle.position.set(x + (Math.random() - 0.5) * 0.25, 0.09, z + 0.32 + Math.random() * 0.2);
  particle.scale.setScalar(0.7 + Math.random() * 0.7);
  particle.userData.life = 0.42;
  particle.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.35, 2.2 + Math.random() * 0.9);
}

function updatePlayer(dt) {
  const targetLaneX = LANES[game.lane];
  game.visualLaneX = lerp(game.visualLaneX, targetLaneX, 1 - Math.pow(0.0008, dt));

  if (game.jumpTimer > 0) {
    game.jumpTimer = Math.max(0, game.jumpTimer - dt);
    const progress = 1 - game.jumpTimer / 0.68;
    game.jumpHeight = Math.sin(progress * Math.PI) * 2.15;
  } else {
    game.jumpHeight = 0;
  }

  if (game.slideTimer > 0) {
    game.slideTimer = Math.max(0, game.slideTimer - dt);
    const progress = 1 - game.slideTimer / 0.72;
    const enter = smoothstep(progress / 0.18);
    const exit = 1 - smoothstep((progress - 0.72) / 0.28);
    game.slideAmount = Math.min(enter, exit);
  } else {
    game.slideAmount = 0;
  }

  const running = game.state === "running";
  if (running) {
    game.runPhase += dt * (9.5 + game.speed * 0.26);
  }

  const run = Math.sin(game.runPhase);
  const counterRun = Math.sin(game.runPhase + Math.PI);
  const bob = running ? Math.abs(Math.sin(game.runPhase * 2)) * 0.13 : 0;
  const slide = game.slideAmount;
  const activeBob = bob * (1 - slide * 0.85);

  player.root.position.x = game.visualLaneX;
  player.root.position.y = game.jumpHeight + activeBob - slide * 0.18;
  player.root.rotation.z = clamp((targetLaneX - game.visualLaneX) * -0.08, -0.16, 0.16);
  player.bodyPivot.rotation.x = slide * 0.68;
  player.bodyPivot.position.y = -slide * 0.48;
  player.bodyPivot.scale.y = 1 - slide * 0.08;
  player.bodyPivot.position.z = slide * 0.16;

  const legSwing = 0.72 * (1 - slide);
  player.leftLeg.rotation.x = run * legSwing + slide * 0.58;
  player.rightLeg.rotation.x = counterRun * legSwing + slide * 0.18;
  player.leftKnee.rotation.x = Math.max(0, -run) * 0.92 * (1 - slide) + slide * 0.86;
  player.rightKnee.rotation.x = Math.max(0, -counterRun) * 0.92 * (1 - slide) + slide * 0.52;
  player.leftArm.rotation.x = counterRun * 0.82 * (1 - slide) - slide * 0.34;
  player.rightArm.rotation.x = run * 0.82 * (1 - slide) - slide * 0.42;
  player.leftArm.rotation.z = -0.18 - Math.abs(run) * 0.08 - slide * 0.08;
  player.rightArm.rotation.z = 0.18 + Math.abs(run) * 0.08 + slide * 0.08;
  player.head.rotation.y = Math.sin(game.runPhase * 0.5) * 0.06;
  player.head.rotation.x = -slide * 0.18;

  const currentBucket = Math.floor(game.runPhase / Math.PI);
  if (running && currentBucket !== game.lastStepBucket && game.jumpHeight < 0.15 && slide < 0.15) {
    game.lastStepBucket = currentBucket;
    emitDust(player.root.position.x + (currentBucket % 2 === 0 ? -0.28 : 0.28), PLAYER_Z + 0.2);
  }

  player.root.visible = game.state !== "running" || game.invincibleTimer <= 0 || Math.floor(game.time * 16) % 2 === 0;
}

function updateWorldMotion(dt) {
  const dashCycle = 58;
  for (const item of dashMeshes) {
    let z = item.base + (game.distance * 1.15) % dashCycle;
    if (z > 13) z -= dashCycle;
    item.mesh.position.z = z;
  }

  for (const line of speedLines) {
    let z = line.base + (game.distance * 2.35 + line.phase) % 138;
    if (z > 14) z -= 138;
    line.mesh.position.z = z;
    line.mesh.position.x = line.x + Math.sin(game.time * 4 + line.phase) * 0.12;
    line.mesh.visible = game.state === "running";
    line.mesh.material.opacity = 0.18 + clamp((game.speed - 17) / 14, 0, 1) * 0.36;
  }

  for (const item of sceneryItems) {
    const span = item.userData.span || 180;
    let z = item.userData.baseZ + (game.distance * item.userData.speedFactor) % span;
    if (z > 22) z -= span;
    if (item.userData.isLandmark && item.userData.lastZ !== null && z < item.userData.lastZ - span * 0.45) {
      buildLandmarkModel(item, randomLandmarkType(item.userData.landmarkType));
    }
    item.position.z = z;
    item.userData.lastZ = z;
  }

  for (const particle of dustPool) {
    if (!particle.visible) continue;
    const velocity = particle.userData.velocity;
    particle.userData.life -= dt;
    particle.position.x += velocity.x * dt;
    particle.position.y += velocity.y * dt;
    particle.position.z += velocity.z * dt;
    velocity.y -= 1.8 * dt;
    const alpha = clamp(particle.userData.life / 0.42, 0, 1);
    particle.material.opacity = alpha * 0.75;
    particle.scale.multiplyScalar(1 + dt * 1.8);
    if (particle.userData.life <= 0) {
      particle.visible = false;
      particle.position.y = -20;
    }
  }
}

function updateObstacles(dt) {
  for (const obstacle of game.obstacles) {
    obstacle.userData.z += game.speed * dt;
    obstacle.position.z = obstacle.userData.z;
    obstacle.position.y = 0.02 + Math.sin(game.time * 7 + obstacle.userData.wobble) * 0.025;
    if (obstacle.userData.type === "tank") {
      obstacle.rotation.y = 0;
      obstacle.userData.fireCooldown -= dt;
      if (
        obstacle.userData.fireCooldown <= 0 &&
        game.tankFireCooldown <= 0 &&
        obstacle.userData.lane === game.lane &&
        obstacle.userData.z > SPAWN_Z + 18 &&
        obstacle.userData.z < -8 &&
        game.projectiles.length < 18
      ) {
        game.projectiles.push(createProjectile(obstacle));
        obstacle.userData.fireCooldown = PROJECTILE_FIRE_INTERVAL;
        game.tankFireCooldown = PROJECTILE_FIRE_INTERVAL;
      }
    }
  }

  for (let i = game.obstacles.length - 1; i >= 0; i -= 1) {
    const obstacle = game.obstacles[i];
    if (obstacle.position.z > 18) {
      obstacleGroup.remove(obstacle);
      game.obstacles.splice(i, 1);
    }
  }
}

function updateRocketLauncher(dt) {
  game.rocketFireCooldown = Math.max(0, game.rocketFireCooldown - dt);

  if (game.rocketAmmo > 0) {
    game.rocketEquipTimer = Math.max(game.rocketEquipTimer, 0.6);
    tryFireRocket();
  } else {
    game.rocketEquipTimer = Math.max(0, game.rocketEquipTimer - dt);
  }

  if (player.rocketLauncher) {
    player.rocketLauncher.visible = game.rocketAmmo > 0 || game.rocketEquipTimer > 0 || game.rockets.length > 0;
    player.rocketLauncher.rotation.z = -0.08 + Math.sin(game.time * 9) * 0.015;
  }
}

function updateRockets(dt) {
  for (const rocket of game.rockets) {
    const data = rocket.userData;
    data.life -= dt;

    if (!data.target || !game.obstacles.includes(data.target)) {
      data.target = findRocketTarget();
      if (!data.target) {
        rocket.position.z -= data.speed * dt;
        rocket.position.y += Math.sin(game.time * 14 + data.wobble) * 0.01;
        continue;
      }
    }

    const target = data.target;
    const targetPosition = new THREE.Vector3(target.position.x, 1.1, target.userData.z + 0.15);
    const direction = targetPosition.sub(rocket.position);
    const distance = direction.length();
    const step = data.speed * dt;

    if (distance <= step + 0.58) {
      destroyTank(target);
      data.life = 0;
      continue;
    }

    direction.normalize();
    rocket.position.addScaledVector(direction, step);
    rocket.rotation.y = Math.atan2(direction.x, -direction.z);
    rocket.rotation.x = -direction.y * 0.25;
  }

  for (let i = game.rockets.length - 1; i >= 0; i -= 1) {
    const rocket = game.rockets[i];
    if (rocket.userData.life <= 0 || rocket.position.z < SPAWN_Z - 18 || Math.abs(rocket.position.x) > 10) {
      removeRocketAt(i);
    }
  }
}

function updateExplosions(dt) {
  for (const explosion of game.explosions) {
    const data = explosion.userData;
    data.life -= dt;
    const progress = 1 - clamp(data.life / data.maxLife, 0, 1);
    explosion.scale.setScalar(1 + progress * 1.25);
    explosion.rotation.y += data.spin * dt;
    explosion.position.y += dt * 0.22;

    for (const child of explosion.children) {
      if (child.userData.outward) {
        child.position.addScaledVector(child.userData.outward, dt);
      }
      if (child.material) {
        child.material.opacity = clamp(1 - progress, 0, 1) * (child.userData.outward ? 0.82 : 0.58);
      }
    }
  }

  for (let i = game.explosions.length - 1; i >= 0; i -= 1) {
    if (game.explosions[i].userData.life <= 0) {
      removeExplosionAt(i);
    }
  }
}

function updateProjectiles(dt) {
  for (const projectile of game.projectiles) {
    const data = projectile.userData;
    data.z += data.velocityZ * dt;
    projectile.position.z = data.z;
    projectile.position.x += data.velocityX * dt;
    projectile.position.y = data.y + Math.sin(game.time * 12 + data.wobble) * 0.035;
    projectile.rotation.z += dt * 8;
  }

  for (let i = game.projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = game.projectiles[i];
    const data = projectile.userData;
    const slide = game.slideAmount;
    const playerMinY = player.root.position.y + (slide > 0.55 ? 0.05 : 0.18);
    const playerMaxY = player.root.position.y + (slide > 0.55 ? 1.04 : 2.68);
    const xOverlap = Math.abs(projectile.position.x - player.root.position.x) < 0.55;
    const zOverlap = Math.abs(data.z - PLAYER_Z) < 0.72;
    const yOverlap = projectile.position.y >= playerMinY && projectile.position.y <= playerMaxY;

    if (xOverlap && zOverlap && yOverlap) {
      damagePlayer();
      removeProjectileAt(i);
      continue;
    }

    if (data.z > 18 || Math.abs(projectile.position.x) > 8) {
      removeProjectileAt(i);
    }
  }
}

function updatePickups(dt) {
  for (const pickup of game.pickups) {
    pickup.userData.z += game.speed * dt;
    pickup.position.z = pickup.userData.z;
    pickup.position.y = 0.05 + Math.sin(game.time * 4.2 + pickup.userData.wobble) * 0.08;
    pickup.rotation.y += dt * (pickup.userData.type === "rocketLauncher" ? 2.4 : 1.6);
  }

  for (let i = game.pickups.length - 1; i >= 0; i -= 1) {
    const pickup = game.pickups[i];
    const xOverlap = Math.abs(pickup.position.x - player.root.position.x) < 0.8;
    const zOverlap = Math.abs(pickup.userData.z - PLAYER_Z) < 0.95;
    const canReach = game.slideAmount < 0.82;

    if (xOverlap && zOverlap && canReach) {
      if (pickup.userData.type === "rocketLauncher") {
        grantRocketLauncher();
      } else {
        healPlayer();
      }
      removePickupAt(i);
      continue;
    }

    if (pickup.userData.z > 18) {
      removePickupAt(i);
    }
  }
}

function checkCollision() {
  for (let i = game.obstacles.length - 1; i >= 0; i -= 1) {
    const obstacle = game.obstacles[i];
    const data = obstacle.userData;
    const profile = COLLISION_PROFILES[data.type];
    if (!profile) continue;

    const playerHalfWidth = game.slideAmount > 0.45 ? 0.56 : 0.42;
    const xOverlap = Math.abs(player.root.position.x - obstacle.position.x) < profile.halfWidth + playerHalfWidth;
    const zOverlap = Math.abs(data.z - PLAYER_Z) < profile.depth;
    if (!xOverlap || !zOverlap) continue;

    const clearsBarrier = data.type === "barrier" && game.jumpHeight > profile.jumpClearHeight;
    const clearsGate = data.type === "gate" && game.slideAmount > profile.slideClearAmount;
    if (!clearsBarrier && !clearsGate) {
      damagePlayer();
      removeObstacleAt(i);
      return;
    }
  }
}

function updateCamera() {
  const running = game.state === "running";
  const bob = running ? Math.sin(game.runPhase * 2) * 0.055 : 0;
  const shake = running ? clamp((game.speed - 17) / 13, 0, 1) : 0;
  const targetX = game.visualLaneX * 0.22;
  const camX = targetX + Math.sin(game.runPhase * 0.5) * 0.06 * shake;
  const camY = 4.95 + bob + game.jumpHeight * 0.07;
  const camZ = 9.4 + Math.cos(game.runPhase * 2) * 0.055 * shake;

  camera.position.set(lerp(camera.position.x, camX, 0.1), lerp(camera.position.y, camY, 0.12), lerp(camera.position.z, camZ, 0.12));
  camera.lookAt(game.visualLaneX * 0.16, 1.95 + game.jumpHeight * 0.08, -11);
  camera.rotation.z += Math.sin(game.runPhase) * 0.006 * shake;
}

function update(dt) {
  game.time += dt;
  game.flashTimer = Math.max(0, game.flashTimer - dt);

  if (game.state === "running") {
    game.distance += game.speed * dt;
    game.speed = Math.min(31, 17 + game.distance / 150);
    game.score = Math.floor(game.distance * 7.5);
    game.invincibleTimer = Math.max(0, game.invincibleTimer - dt);
    game.tankFireCooldown = Math.max(0, game.tankFireCooldown - dt);

    game.spawnCooldown -= dt;
    if (game.spawnCooldown <= 0) spawnWave();

    game.pickupCooldown -= dt;
    if (game.pickupCooldown <= 0) spawnPickup();

    updateObstacles(dt);
    updateRocketLauncher(dt);
    updateRockets(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    checkCollision();
    updateHud();
  }

  updatePlayer(dt);
  updateWorldMotion(dt);
  updateExplosions(dt);
  updateCamera();
}

function renderFlash() {
  if (game.flashTimer <= 0) return;
  const alpha = clamp(game.flashTimer / 0.42, 0, 1) * 0.45;
  renderer.domElement.style.filter = `brightness(${1 + alpha * 1.8}) saturate(${1 + alpha * 0.8})`;
  window.setTimeout(() => {
    if (game.flashTimer <= 0) renderer.domElement.style.filter = "";
  }, 0);
}

function loop(now) {
  const dt = Math.min(0.033, (now - game.lastFrame) / 1000 || 0);
  game.lastFrame = now;
  update(dt);
  renderFlash();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function resize() {
  game.width = window.innerWidth;
  game.height = window.innerHeight;
  const mobile = isMobileView();
  camera.aspect = game.width / game.height;
  camera.fov = mobile ? 66 : 58;
  camera.updateProjectionMatrix();
  renderer.shadowMap.enabled = !mobile;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.15 : 1.75));
  renderer.setSize(game.width, game.height, false);
}

function installControls() {
  window.addEventListener("keydown", (event) => {
    const key = event.key;
    const canStart = game.state === "ready" || game.state === "gameover";

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) {
      event.preventDefault();
    }

    if (canStart && (key === "Enter" || key === " ")) {
      resetGame();
      void startMusic({ fromGameStart: true });
      return;
    }

    if (key === "ArrowLeft") handleAction("left");
    if (key === "ArrowRight") handleAction("right");
    if (key === "ArrowUp" || key === " ") handleAction("jump");
    if (key === "ArrowDown") handleAction("slide");
  });

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  window.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = performance.now();
    },
    { passive: true },
  );

  window.addEventListener(
    "touchend",
    (event) => {
      if (game.state !== "running") return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      const elapsed = performance.now() - touchStartTime;
      const minSwipe = Math.max(36, Math.min(game.width, game.height) * 0.055);

      if (elapsed > 650 && Math.hypot(dx, dy) < minSwipe) return;

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > minSwipe) {
        handleAction(dx < 0 ? "left" : "right");
      } else if (Math.abs(dy) > minSwipe) {
        handleAction(dy < 0 ? "jump" : "slide");
      }
    },
    { passive: true },
  );

  touchControls.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    event.preventDefault();
    handleAction(button.dataset.action);
  });
}

function buildScene() {
  buildLights();
  buildRoad();
  buildMotionStrips();
  buildScenery();
  buildDustPool();
  buildPlayer();

  const sun = makeSphere(3.2, new THREE.MeshBasicMaterial({ color: 0xffdb65 }), 20, 18, -55, scene, 18);
  sun.castShadow = false;
  sun.receiveShadow = false;
}

startButton.addEventListener("click", () => {
  resetGame();
  void startMusic({ fromGameStart: true });
});
restartButton.addEventListener("click", () => {
  resetGame();
  void startMusic({ fromGameStart: true });
});
musicButton.addEventListener("click", toggleMusic);
window.addEventListener("resize", resize);

buildScene();
installControls();
resize();
camera.position.set(0, 5.1, 9.7);
camera.lookAt(0, 2, -10);
updateHud();
updateMusicButton();
requestAnimationFrame(loop);
