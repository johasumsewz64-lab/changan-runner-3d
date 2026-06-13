import * as THREE from "three";

const canvas = document.getElementById("gameCanvas");
const scoreText = document.getElementById("scoreText");
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
  lane: 1,
  visualLaneX: 0,
  jumpTimer: 0,
  slideTimer: 0,
  jumpHeight: 0,
  slideAmount: 0,
  runPhase: 0,
  lastStepBucket: 0,
  obstacles: [],
  spawnCooldown: 0.5,
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
  tank: { halfWidth: 0.9, depth: 1.12 },
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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83c9ff);
scene.fog = new THREE.Fog(0x83c9ff, 42, 138);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 220);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const world = new THREE.Group();
const roadGroup = new THREE.Group();
const sceneryGroup = new THREE.Group();
const obstacleGroup = new THREE.Group();
const particleGroup = new THREE.Group();
scene.add(world, roadGroup, sceneryGroup, obstacleGroup, particleGroup);

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
  tank: new THREE.MeshStandardMaterial({ color: 0x546e4f, roughness: 0.9 }),
  tankDark: new THREE.MeshStandardMaterial({ color: 0x263a2e, roughness: 0.92 }),
  tankLight: new THREE.MeshStandardMaterial({ color: 0xbfd0a9, roughness: 0.78 }),
  tankMetal: new THREE.MeshStandardMaterial({ color: 0x1f2d28, roughness: 0.82 }),
  tankTrim: new THREE.MeshStandardMaterial({ color: 0x7f986e, roughness: 0.84 }),
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

function setMeshShadow(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

function buildLights() {
  const hemi = new THREE.HemisphereLight(0xf7fbff, 0x7d6545, 2.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.65);
  sun.position.set(-9, 16, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
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
  for (let i = 0; i < 34; i += 1) {
    for (const x of [-1.6, 1.6]) {
      const dash = makeBox(0.13, 0.055, 3.3, materials.laneWhite, x, 0.05, -i * 5, roadGroup);
      dashMeshes.push({ mesh: dash, base: -i * 5 });
    }
  }

  for (let i = 0; i < 46; i += 1) {
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
  const roof = makeCone(width * 0.78, 0.95, materials.red, 0, height + 0.45, 0, group);
  roof.rotation.y = Math.PI / 4;

  for (let row = 0; row < 4; row += 1) {
    for (let col = -1; col <= 1; col += 2) {
      const window = makeBox(0.28, 0.28, 0.035, materials.window, col * width * 0.22, 1.25 + row * 0.86, side > 0 ? depth / 2 + 0.03 : -depth / 2 - 0.03, group);
      window.castShadow = false;
      window.receiveShadow = false;
    }
  }

  group.position.x = side * (8.2 + (index % 4) * 1.25);
  group.userData.baseZ = -112 + index * 9.7;
  group.userData.speedFactor = 0.72;
  group.scale.setScalar(0.92 + (index % 5) * 0.06);
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
  group.position.x = side * 6.9;
  group.userData.baseZ = -108 + index * 8.6;
  group.userData.speedFactor = 0.88;
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
  group.position.x = side * 6.05;
  group.userData.baseZ = -110 + index * 11.2;
  group.userData.speedFactor = 0.98;
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

function buildScenery() {
  createBackdropGate();
  for (let i = 0; i < 18; i += 1) {
    createBuilding(-1, i);
    createBuilding(1, i + 4);
  }
  for (let i = 0; i < 22; i += 1) {
    createTree(-1, i);
    createTree(1, i + 7);
  }
  for (let i = 0; i < 16; i += 1) {
    createLamp(-1, i);
    createLamp(1, i + 3);
  }
}

function buildDustPool() {
  for (let i = 0; i < 34; i += 1) {
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
};

function buildPlayer() {
  player.root.position.set(0, 0, PLAYER_Z);
  player.root.rotation.y = Math.PI;
  player.root.add(player.bodyPivot);
  player.bodyPivot.position.y = 0;

  player.hips = makeBox(0.96, 0.35, 0.55, materials.pants, 0, 1.35, 0, player.bodyPivot);
  player.torso = makeBox(1.05, 1.18, 0.58, materials.white, 0, 2.17, 0.02, player.bodyPivot);

  makeBox(1.18, 0.18, 0.64, materials.white, 0, 2.78, 0.02, player.bodyPivot);
  makeBox(0.82, 0.16, 0.08, materials.white, 0, 2.72, -0.34, player.bodyPivot);
  makeBox(0.52, 0.08, 0.09, materials.shirtShade, 0, 2.79, -0.36, player.bodyPivot);
  const collarLeft = makeBox(0.34, 0.08, 0.06, materials.shirtShade, -0.16, 2.78, 0.34, player.bodyPivot);
  collarLeft.rotation.z = -0.55;
  const collarRight = makeBox(0.34, 0.08, 0.06, materials.shirtShade, 0.16, 2.78, 0.34, player.bodyPivot);
  collarRight.rotation.z = 0.55;
  makeBox(0.16, 0.84, 0.05, materials.tie, 0, 2.28, 0.36, player.bodyPivot);
  makeBox(0.27, 0.24, 0.05, materials.tie, 0, 2.67, 0.37, player.bodyPivot);
  makeBox(0.44, 0.2, 0.055, materials.white, 0.28, 2.34, 0.37, player.bodyPivot);
  makeBox(0.7, 0.16, 0.06, materials.white, 0, 2.74, -0.35, player.bodyPivot);

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

  player.root.scale.setScalar(0.96);
  setMeshShadow(player.root);
  scene.add(player.root);
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
  group.userData = { type: "tank", lane, z, passed: false, wobble: Math.random() * Math.PI * 2 };

  makeBox(2.45, 0.62, 1.62, materials.tank, 0, 0.68, 0, group);
  makeBox(2.76, 0.42, 1.86, materials.tankDark, 0, 0.32, 0, group);
  makeBox(2.25, 0.18, 1.72, materials.tankTrim, 0, 0.99, 0, group);
  makeBox(1.08, 0.52, 0.98, materials.tank, 0.08, 1.18, 0.04, group);
  makeBox(0.72, 0.18, 0.62, materials.tankTrim, 0.08, 1.52, 0.04, group);
  const hatch = makeCylinder(0.28, 0.32, 0.16, materials.tankDark, -0.22, 1.62, 0.03, group);
  hatch.rotation.y = Math.PI / 5;
  const cannon = makeCylinder(0.11, 0.14, 1.58, materials.tankDark, 0.1, 1.2, 1.05, group);
  cannon.rotation.x = Math.PI / 2;
  const muzzle = makeCylinder(0.16, 0.16, 0.2, materials.tankMetal, 0.1, 1.2, 1.92, group);
  muzzle.rotation.x = Math.PI / 2;

  for (const sideZ of [-1.02, 1.02]) {
    makeBox(2.62, 0.18, 0.12, materials.tankMetal, 0, 0.54, sideZ, group);
    for (const treadX of [-1.08, -0.72, -0.36, 0, 0.36, 0.72, 1.08]) {
      makeBox(0.18, 0.16, 0.18, materials.tankDark, treadX, 0.16, sideZ, group);
    }
  }

  for (const sideX of [-0.96, -0.56, -0.16, 0.24, 0.64, 1.04]) {
    const wheelL = makeCylinder(0.19, 0.19, 0.09, materials.tankLight, sideX, 0.3, 0.98, group);
    wheelL.rotation.x = Math.PI / 2;
    const hubL = makeCylinder(0.08, 0.08, 0.1, materials.tankMetal, sideX, 0.3, 1.04, group);
    hubL.rotation.x = Math.PI / 2;
    const wheelR = makeCylinder(0.19, 0.19, 0.09, materials.tankLight, sideX, 0.3, -0.98, group);
    wheelR.rotation.x = Math.PI / 2;
    const hubR = makeCylinder(0.08, 0.08, 0.1, materials.tankMetal, sideX, 0.3, -1.04, group);
    hubR.rotation.x = Math.PI / 2;
  }

  const star = makeCone(0.18, 0.08, materials.gold, -0.42, 0.9, 0.75, group);
  star.rotation.x = Math.PI / 2;
  star.rotation.z = Math.PI / 4;
  makeSphere(0.08, materials.window, 0.78, 0.9, 0.83, group, 8);
  makeSphere(0.08, materials.window, 1.03, 0.9, 0.83, group, 8);
  makeBox(0.12, 0.44, 0.08, materials.tankMetal, -0.82, 1.58, -0.34, group).rotation.z = -0.28;

  for (const boltX of [-0.92, -0.46, 0, 0.46, 0.92]) {
    makeSphere(0.045, materials.tankDark, boltX, 0.84, 0.86, group, 8);
    makeSphere(0.045, materials.tankDark, boltX, 0.84, -0.86, group, 8);
  }

  group.position.set(LANES[lane], 0.03, z);
  group.scale.setScalar(1.1);
  setMeshShadow(group);
  obstacleGroup.add(group);
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

function resetGame() {
  for (const obstacle of game.obstacles) {
    obstacleGroup.remove(obstacle);
  }

  game.state = "running";
  game.time = 0;
  game.distance = 0;
  game.speed = 17;
  game.score = 0;
  game.lane = 1;
  game.visualLaneX = 0;
  game.jumpTimer = 0;
  game.slideTimer = 0;
  game.jumpHeight = 0;
  game.slideAmount = 0;
  game.runPhase = 0;
  game.lastStepBucket = 0;
  game.obstacles = [];
  game.spawnCooldown = 0.5;
  game.flashTimer = 0;
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  updateHud();
}

function gameOver() {
  if (game.state !== "running") return;
  game.state = "gameover";
  game.flashTimer = 0.42;
  finalScore.textContent = String(game.score);
  window.setTimeout(() => {
    gameOverScreen.classList.remove("hidden");
  }, 240);
}

function updateHud() {
  scoreText.textContent = String(game.score);
  speedText.textContent = `${(game.speed / 17).toFixed(1)}x`;
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
    const span = 145;
    let z = item.userData.baseZ + (game.distance * item.userData.speedFactor) % span;
    if (z > 22) z -= span;
    item.position.z = z;
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
      obstacle.rotation.y = Math.sin(game.time * 3 + obstacle.userData.wobble) * 0.025;
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

function checkCollision() {
  for (const obstacle of game.obstacles) {
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
      gameOver();
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

    game.spawnCooldown -= dt;
    if (game.spawnCooldown <= 0) spawnWave();

    updateObstacles(dt);
    checkCollision();
    updateHud();
  }

  updatePlayer(dt);
  updateWorldMotion(dt);
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
  camera.aspect = game.width / game.height;
  camera.fov = game.width < 640 ? 66 : 58;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
