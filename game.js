/**
 * OVERDRIVE 4K - Ultra-Realistic Highway Racer
 * Core Game Engine: Three.js 3D Rendering, Dynamic Traffic, Procedural Highway,
 * Web Audio Synthesizer, Realtime Radar, and Photo Mode.
 */

// ==========================================
// 1. GAME STATE & CONSTANTS
// ==========================================
const CONFIG = {
  LANES: [-6, -2, 2, 6],
  ROAD_WIDTH: 16,
  SEGMENT_LENGTH: 100,
  NUM_SEGMENTS: 12,
  MAX_SPEED: 220, // MPH
  ACCELERATION: 45,
  BRAKING: 70,
  FRICTION: 12,
  NITRO_ACCEL: 80,
  NITRO_MAX_SPEED: 270,
  STEER_SPEED: 14,
  MAX_STEER_ANGLE: 0.35,
};

const STATE = {
  menu: true,
  playing: false,
  crashed: false,
  paused: false,
  photoMode: false,
  
  score: 0,
  distance: 0,
  speed: 0, // MPH
  gear: 1,
  rpm: 1000,
  multiplier: 1.0,
  nearMissCount: 0,
  topSpeed: 0,
  nitro: 100,
  isNitro: false,
  isDrifting: false,
  
  carColor: 0x0e3a6c,
  envMode: 'sunset',
  cameraMode: 0, // 0: Chase, 1: Cockpit/Hood, 2: Bumper, 3: Orbit
};

const KEYS = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  nitro: false,
  drift: false
};

// ==========================================
// 2. WEB AUDIO SYNTHESIZER
// ==========================================
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineGain = null;
    this.osc1 = null;
    this.osc2 = null;
    this.filter = null;
    this.skidGain = null;
    this.skidNoise = null;
    this.nitroGain = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master output
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Engine Synthesizer (Harmonic Dual Oscillator + Lowpass Filter)
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.15, this.ctx.currentTime);

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.setValueAtTime(400, this.ctx.currentTime);

      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.setValueAtTime(45, this.ctx.currentTime);

      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'triangle';
      this.osc2.frequency.setValueAtTime(90, this.ctx.currentTime);

      this.osc1.connect(this.filter);
      this.osc2.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.osc1.start();
      this.osc2.start();

      // Tire Skid Synthesizer (White noise buffer)
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.skidNoise = this.ctx.createBufferSource();
      this.skidNoise.buffer = noiseBuffer;
      this.skidNoise.loop = true;

      const skidFilter = this.ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.setValueAtTime(1200, this.ctx.currentTime);
      skidFilter.Q.setValueAtTime(3, this.ctx.currentTime);

      this.skidGain = this.ctx.createGain();
      this.skidGain.gain.setValueAtTime(0, this.ctx.currentTime);

      this.skidNoise.connect(skidFilter);
      skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.masterGain);
      this.skidNoise.start();

      // Nitro Rush Synthesizer
      const nitroFilter = this.ctx.createBiquadFilter();
      nitroFilter.type = 'lowpass';
      nitroFilter.frequency.setValueAtTime(800, this.ctx.currentTime);

      const nitroNoise = this.ctx.createBufferSource();
      nitroNoise.buffer = noiseBuffer;
      nitroNoise.loop = true;

      this.nitroGain = this.ctx.createGain();
      this.nitroGain.gain.setValueAtTime(0, this.ctx.currentTime);

      nitroNoise.connect(nitroFilter);
      nitroFilter.connect(this.nitroGain);
      this.nitroGain.connect(this.masterGain);
      nitroNoise.start();

      this.initialized = true;
    } catch (e) {
      console.warn("Audio Context init error: ", e);
    }
  }

  update(speed, rpm, isDrifting, isNitro) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;

    // Pitch engine based on RPM
    const baseFreq = 35 + (rpm / 8000) * 160;
    this.osc1.frequency.setTargetAtTime(baseFreq, t, 0.05);
    this.osc2.frequency.setTargetAtTime(baseFreq * 1.5, t, 0.05);
    this.filter.frequency.setTargetAtTime(300 + (rpm / 8000) * 1400, t, 0.05);

    // Throttle volume
    const vol = Math.min(0.25, 0.08 + (speed / CONFIG.MAX_SPEED) * 0.18);
    this.engineGain.gain.setTargetAtTime(vol, t, 0.05);

    // Skid audio
    const skidTarget = isDrifting && speed > 20 ? 0.35 : 0;
    this.skidGain.gain.setTargetAtTime(skidTarget, t, 0.08);

    // Nitro audio
    const nitroTarget = isNitro ? 0.4 : 0;
    this.nitroGain.gain.setTargetAtTime(nitroTarget, t, 0.08);
  }

  playNearMiss() {
    if (!this.initialized || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.25);
  }

  playCrash() {
    if (!this.initialized || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 0.6);
    gain.gain.setValueAtTime(0.6, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.6);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.3, this.ctx.currentTime);
    }
  }
}

const Audio = new SoundEngine();

// ==========================================
// 3. THREE.JS 3D SCENE & LIGHTING
// ==========================================
let scene, camera, renderer, container;
let sunLight, ambientLight, skyMesh;
let roadSegments = [];
let trafficCars = [];
let particles, rainSystem;
let playerCarGroup, playerCarBodyMesh;
let playerSpotlights = [];

function init3D() {
  container = document.getElementById('game-container');
  
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xdd8855, 0.0035);

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 4, 10);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Lighting
  ambientLight = new THREE.AmbientLight(0xffeedd, 0.7);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xff9944, 2.2);
  sunLight.position.set(40, 60, -150);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 300;
  sunLight.shadow.camera.left = -40;
  sunLight.shadow.camera.right = 40;
  sunLight.shadow.camera.top = 40;
  sunLight.shadow.camera.bottom = -40;
  scene.add(sunLight);

  createSkyDome();
  createMountains();
  buildRoadSegments();
  buildPlayerCar();
  createWeatherEffects();
  setEnvironment(STATE.envMode);

  window.addEventListener('resize', onWindowResize);
}

function createSkyDome() {
  const skyGeo = new THREE.SphereGeometry(600, 32, 24);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xff6633,
    side: THREE.BackSide
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);
}

function createMountains() {
  const mountainGeo = new THREE.ConeGeometry(140, 180, 5);
  const mountainMat = new THREE.MeshStandardMaterial({
    color: 0x221828,
    roughness: 0.9,
    metalness: 0.1,
    flatShading: true
  });

  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(mountainGeo, mountainMat);
    const side = i % 2 === 0 ? 1 : -1;
    m.position.set(
      side * (180 + Math.random() * 120),
      40 + Math.random() * 30,
      -300 + (i * 45)
    );
    m.scale.set(1 + Math.random() * 0.8, 0.7 + Math.random() * 0.7, 1 + Math.random() * 0.8);
    scene.add(m);
  }
}

// ==========================================
// 4. PROCEDURAL HIGHWAY & TEXTURES
// ==========================================
function createWetRoadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Dark wet asphalt base
  ctx.fillStyle = '#16191f';
  ctx.fillRect(0, 0, 512, 512);

  // Noise / grain
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgb(${22 + v}, ${25 + v}, ${31 + v})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Lane dividers (Dashed white lines)
  ctx.fillStyle = '#ffffff';
  const lanesX = [128, 256, 384];
  lanesX.forEach(lx => {
    for (let y = 0; y < 512; y += 64) {
      ctx.fillRect(lx - 3, y + 12, 6, 38);
    }
  });

  // Outer solid lines
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(16, 0, 6, 512);
  ctx.fillRect(490, 0, 6, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 4);
  return texture;
}

function buildRoadSegments() {
  const roadTex = createWetRoadTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.18, // Glossy wet reflections
    metalness: 0.4,
    bumpScale: 0.05
  });

  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0x8899aa,
    metalness: 0.8,
    roughness: 0.3
  });

  const neonStripeMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });

  for (let i = 0; i < CONFIG.NUM_SEGMENTS; i++) {
    const segGroup = new THREE.Group();

    // Main 4-lane Asphalt Deck
    const deckGeo = new THREE.PlaneGeometry(CONFIG.ROAD_WIDTH, CONFIG.SEGMENT_LENGTH);
    const deck = new THREE.Mesh(deckGeo, roadMat);
    deck.rotation.x = -Math.PI / 2;
    deck.receiveShadow = true;
    segGroup.add(deck);

    // Left Guardrail
    const railGeo = new THREE.BoxGeometry(0.6, 0.9, CONFIG.SEGMENT_LENGTH);
    const leftRail = new THREE.Mesh(railGeo, barrierMat);
    leftRail.position.set(-CONFIG.ROAD_WIDTH / 2 - 0.3, 0.45, 0);
    segGroup.add(leftRail);

    // Right Guardrail
    const rightRail = new THREE.Mesh(railGeo, barrierMat);
    rightRail.position.set(CONFIG.ROAD_WIDTH / 2 + 0.3, 0.45, 0);
    segGroup.add(rightRail);

    // Neon Edge Markers
    const neonGeo = new THREE.BoxGeometry(0.1, 0.1, CONFIG.SEGMENT_LENGTH);
    const leftNeon = new THREE.Mesh(neonGeo, neonStripeMat);
    leftNeon.position.set(-CONFIG.ROAD_WIDTH / 2, 0.9, 0);
    segGroup.add(leftNeon);

    const rightNeon = new THREE.Mesh(neonGeo, neonStripeMat);
    rightNeon.position.set(CONFIG.ROAD_WIDTH / 2, 0.9, 0);
    segGroup.add(rightNeon);

    // Streetlights (Every 50m)
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 7, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.8 });
    const lampPole = new THREE.Mesh(poleGeo, poleMat);
    lampPole.position.set(-CONFIG.ROAD_WIDTH / 2 - 1.5, 3.5, 0);
    segGroup.add(lampPole);

    const lampBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffeedd })
    );
    lampBulb.position.set(-CONFIG.ROAD_WIDTH / 2 - 0.6, 6.8, 0);
    segGroup.add(lampBulb);

    segGroup.position.z = -i * CONFIG.SEGMENT_LENGTH;
    scene.add(segGroup);
    roadSegments.push(segGroup);
  }
}

// ==========================================
// 5. DETAILED SPORTS CAR 3D MESH BUILDER
// ==========================================
function buildPlayerCar() {
  playerCarGroup = new THREE.Group();

  // Car Paint Material (Metallic with high specular shine)
  const paintMat = new THREE.MeshStandardMaterial({
    color: STATE.carColor,
    metalness: 0.85,
    roughness: 0.2,
    envMapIntensity: 1.5
  });

  // Carbon Fiber / Trim
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x111115,
    metalness: 0.5,
    roughness: 0.4
  });

  // Glass Windshield
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x051020,
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.75
  });

  // 1. Lower Aerodynamic Chassis
  const lowerGeo = new THREE.BoxGeometry(2.1, 0.45, 4.4);
  const lowerBody = new THREE.Mesh(lowerGeo, paintMat);
  lowerBody.position.y = 0.42;
  lowerBody.castShadow = true;
  playerCarGroup.add(lowerBody);
  playerCarBodyMesh = lowerBody;

  // 2. Cockpit Cabin
  const cabinGeo = new THREE.BoxGeometry(1.65, 0.45, 2.1);
  const cabin = new THREE.Mesh(cabinGeo, paintMat);
  cabin.position.set(0, 0.8, -0.2);
  cabin.castShadow = true;
  playerCarGroup.add(cabin);

  // Windshield & Rear Glass
  const winGeo = new THREE.PlaneGeometry(1.5, 0.6);
  const frontWindshield = new THREE.Mesh(winGeo, glassMat);
  frontWindshield.position.set(0, 0.8, 0.9);
  frontWindshield.rotation.x = -Math.PI / 4;
  playerCarGroup.add(frontWindshield);

  const rearWindshield = new THREE.Mesh(winGeo, glassMat);
  rearWindshield.position.set(0, 0.8, -1.3);
  rearWindshield.rotation.x = Math.PI / 4;
  rearWindshield.rotation.y = Math.PI;
  playerCarGroup.add(rearWindshield);

  // 3. GT Spoiler Wing
  const wingGeo = new THREE.BoxGeometry(2.2, 0.08, 0.5);
  const wing = new THREE.Mesh(wingGeo, trimMat);
  wing.position.set(0, 0.95, -2.1);
  playerCarGroup.add(wing);

  const wingStands = new THREE.BoxGeometry(0.08, 0.35, 0.2);
  const stand1 = new THREE.Mesh(wingStands, trimMat);
  stand1.position.set(-0.7, 0.75, -2.05);
  const stand2 = new THREE.Mesh(wingStands, trimMat);
  stand2.position.set(0.7, 0.75, -2.05);
  playerCarGroup.add(stand1, stand2);

  // 4. LED Headlights & Taillights
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.1), headlightMat);
  headL.position.set(-0.75, 0.48, 2.2);
  const headR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.1), headlightMat);
  headR.position.set(0.75, 0.48, 2.2);
  playerCarGroup.add(headL, headR);

  // Spotlights for Night Road Illumination
  const spotL = new THREE.SpotLight(0xffffff, 4, 60, Math.PI / 6, 0.4);
  spotL.position.set(-0.75, 0.5, 2.2);
  spotL.target.position.set(-0.75, 0, 30);
  playerCarGroup.add(spotL);
  playerCarGroup.add(spotL.target);
  playerSpotlights.push(spotL);

  const spotR = new THREE.SpotLight(0xffffff, 4, 60, Math.PI / 6, 0.4);
  spotR.position.set(0.75, 0.5, 2.2);
  spotR.target.position.set(0.75, 0, 30);
  playerCarGroup.add(spotR);
  playerCarGroup.add(spotR.target);
  playerSpotlights.push(spotR);

  // Taillights
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
  const tailStrip = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.05), taillightMat);
  tailStrip.position.set(0, 0.55, -2.2);
  playerCarGroup.add(tailStrip);

  // 5. Wheels & Alloy Rims
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.8 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xddeeff, metalness: 0.9, roughness: 0.1 });

  playerCarGroup.wheels = [];
  const wheelPositions = [
    { x: -1.05, y: 0.38, z: 1.35 },
    { x: 1.05, y: 0.38, z: 1.35 },
    { x: -1.05, y: 0.38, z: -1.35 },
    { x: 1.05, y: 0.38, z: -1.35 },
  ];

  wheelPositions.forEach((pos, idx) => {
    const wheelGroup = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    tire.castShadow = true;

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 12), rimMat);
    rim.rotateZ(Math.PI / 2);

    wheelGroup.add(tire, rim);
    wheelGroup.position.set(pos.x, pos.y, pos.z);
    playerCarGroup.add(wheelGroup);
    playerCarGroup.wheels.push(wheelGroup);
  });

  // 6. Exhaust Nitro Glow Mesh
  const nitroFlameMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0 });
  const flameGeo = new THREE.ConeGeometry(0.12, 0.8, 8);
  flameGeo.rotateX(-Math.PI / 2);

  const flameL = new THREE.Mesh(flameGeo, nitroFlameMat);
  flameL.position.set(-0.4, 0.3, -2.4);
  const flameR = new THREE.Mesh(flameGeo, nitroFlameMat);
  flameR.position.set(0.4, 0.3, -2.4);

  playerCarGroup.add(flameL, flameR);
  playerCarGroup.nitroFlames = [flameL, flameR];

  playerCarGroup.position.set(0, 0, 0);
  scene.add(playerCarGroup);
}

// ==========================================
// 6. DYNAMIC AI TRAFFIC SYSTEM
// ==========================================
function createAITrafficCar(zPos) {
  const carGroup = new THREE.Group();
  const laneIndex = Math.floor(Math.random() * CONFIG.LANES.length);
  const laneX = CONFIG.LANES[laneIndex];

  // Random Vehicle Type: 0: Sports, 1: Sedan, 2: Truck
  const type = Math.random() > 0.3 ? (Math.random() > 0.5 ? 0 : 1) : 2;
  const colors = [0xd62828, 0x003049, 0xfdf0d5, 0x669bbc, 0x2b2d42, 0x8d99ae];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const paintMat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.7, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x151518, roughness: 0.8 });

  if (type === 2) {
    // Semi-Truck
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 3), paintMat);
    cab.position.set(0, 1.2, 2.5);
    const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 6.5), new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.3 }));
    trailer.position.set(0, 1.4, -2);
    carGroup.add(cab, trailer);
    carGroup.length = 8;
  } else {
    // Standard Car / Sedan
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.2), paintMat);
    body.position.set(0, 0.55, 0);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.2), darkMat);
    cabin.position.set(0, 0.95, -0.2);
    carGroup.add(body, cabin);
    carGroup.length = 4.2;
  }

  // Taillights
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0xff1122 }));
  tailLight.position.set(0, 0.5, -carGroup.length / 2);
  carGroup.add(tailLight);

  carGroup.position.set(laneX, 0, zPos);
  carGroup.lane = laneIndex;
  carGroup.speed = 55 + Math.random() * 45; // AI cruising speed 55 - 100 MPH
  carGroup.scoredNearMiss = false;

  scene.add(carGroup);
  trafficCars.push(carGroup);
}

function spawnTrafficFleet() {
  // Clear old traffic
  trafficCars.forEach(c => scene.remove(c));
  trafficCars = [];

  for (let i = 1; i <= 10; i++) {
    createAITrafficCar(-i * 45 - 20);
  }
}

// ==========================================
// 7. WEATHER & POST FX PARTICLES
// ==========================================
function createWeatherEffects() {
  const rainCount = 1200;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(rainCount * 3);

  for (let i = 0; i < rainCount * 3; i += 3) {
    rainPos[i] = (Math.random() - 0.5) * 60;
    rainPos[i + 1] = Math.random() * 30;
    rainPos[i + 2] = (Math.random() - 0.5) * 120;
  }

  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0x99ccff,
    size: 0.25,
    transparent: true,
    opacity: 0
  });

  rainSystem = new THREE.Points(rainGeo, rainMat);
  scene.add(rainSystem);
}

function setEnvironment(env) {
  STATE.envMode = env;
  const fogColor = {
    sunset: 0xdd7744,
    midnight: 0x050b18,
    rain: 0x223344,
    golden: 0xffaa55
  }[env];

  scene.fog.color.setHex(fogColor);
  renderer.setClearColor(fogColor);

  if (skyMesh) {
    skyMesh.material.color.setHex(fogColor);
  }

  if (env === 'midnight') {
    ambientLight.intensity = 0.2;
    sunLight.intensity = 0.4;
    sunLight.color.setHex(0x3366cc);
    playerSpotlights.forEach(s => s.intensity = 6);
    rainSystem.material.opacity = 0;
  } else if (env === 'rain') {
    ambientLight.intensity = 0.5;
    sunLight.intensity = 0.8;
    sunLight.color.setHex(0x7799aa);
    playerSpotlights.forEach(s => s.intensity = 4);
    rainSystem.material.opacity = 0.65;
  } else if (env === 'golden') {
    ambientLight.intensity = 0.8;
    sunLight.intensity = 2.5;
    sunLight.color.setHex(0xffaa44);
    playerSpotlights.forEach(s => s.intensity = 0.5);
    rainSystem.material.opacity = 0;
  } else {
    // Sunset
    ambientLight.intensity = 0.7;
    sunLight.intensity = 2.2;
    sunLight.color.setHex(0xff8833);
    playerSpotlights.forEach(s => s.intensity = 2);
    rainSystem.material.opacity = 0;
  }
}

// ==========================================
// 8. RADAR MINIMAP SCANNER
// ==========================================
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function renderRadar() {
  if (!minimapCtx) return;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const scale = 0.85; // radar range

  minimapCtx.clearRect(0, 0, w, h);

  // Radar grid rings
  minimapCtx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
  minimapCtx.lineWidth = 1;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 30, 0, Math.PI * 2);
  minimapCtx.arc(cx, cy, 60, 0, Math.PI * 2);
  minimapCtx.stroke();

  // Highway lane borders
  minimapCtx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
  minimapCtx.strokeRect(cx - 24, 10, 48, h - 20);

  // Traffic blips
  trafficCars.forEach(car => {
    const relZ = car.position.z - playerCarGroup.position.z;
    const relX = car.position.x;
    if (Math.abs(relZ) < 100) {
      const px = cx + (relX / CONFIG.ROAD_WIDTH) * 48;
      const py = cy + (relZ / 100) * 60;

      minimapCtx.fillStyle = '#ff2a55';
      minimapCtx.beginPath();
      minimapCtx.arc(px, py, 3.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  });

  // Player blip (Cyan Arrow)
  const playerPX = cx + (playerCarGroup.position.x / CONFIG.ROAD_WIDTH) * 48;
  minimapCtx.fillStyle = '#00f0ff';
  minimapCtx.beginPath();
  minimapCtx.moveTo(playerPX, cy - 6);
  minimapCtx.lineTo(playerPX - 4, cy + 4);
  minimapCtx.lineTo(playerPX + 4, cy + 4);
  minimapCtx.closePath();
  minimapCtx.fill();
}

// ==========================================
// 9. GAMEPLAY PHYSICS & CONTROLS LOOP
// ==========================================
let steerAngle = 0;
let carRoll = 0;
let comboTimer = null;

function updatePhysics(delta) {
  if (!STATE.playing || STATE.paused || STATE.crashed) return;

  // 1. Acceleration & Braking
  const maxSpd = STATE.isNitro ? CONFIG.NITRO_MAX_SPEED : CONFIG.MAX_SPEED;
  const accelRate = STATE.isNitro ? CONFIG.NITRO_ACCEL : CONFIG.ACCELERATION;

  if (KEYS.forward) {
    STATE.speed = Math.min(maxSpd, STATE.speed + accelRate * delta);
  } else if (KEYS.backward) {
    STATE.speed = Math.max(0, STATE.speed - CONFIG.BRAKING * delta);
  } else {
    STATE.speed = Math.max(0, STATE.speed - CONFIG.FRICTION * delta);
  }

  // Nitro consumption & recharge
  if (KEYS.nitro && STATE.nitro > 0 && STATE.speed > 30) {
    STATE.isNitro = true;
    STATE.nitro = Math.max(0, STATE.nitro - 35 * delta);
    document.getElementById('nitro-overlay').style.opacity = '0.7';
    playerCarGroup.nitroFlames.forEach(f => f.material.opacity = 0.9);
  } else {
    STATE.isNitro = false;
    STATE.nitro = Math.min(100, STATE.nitro + 10 * delta);
    document.getElementById('nitro-overlay').style.opacity = '0';
    playerCarGroup.nitroFlames.forEach(f => f.material.opacity = 0);
  }

  // 2. Steering & Drifting
  STATE.isDrifting = KEYS.drift && STATE.speed > 40;
  const steerMult = STATE.isDrifting ? 1.6 : 1.0;

  if (KEYS.left) {
    steerAngle = Math.max(-CONFIG.MAX_STEER_ANGLE, steerAngle - CONFIG.STEER_SPEED * steerMult * delta);
    playerCarGroup.position.x -= (STATE.speed * 0.12 * steerMult + 5) * delta;
    carRoll = THREE.MathUtils.lerp(carRoll, -0.12, 0.15);
  } else if (KEYS.right) {
    steerAngle = Math.min(CONFIG.MAX_STEER_ANGLE, steerAngle + CONFIG.STEER_SPEED * steerMult * delta);
    playerCarGroup.position.x += (STATE.speed * 0.12 * steerMult + 5) * delta;
    carRoll = THREE.MathUtils.lerp(carRoll, 0.12, 0.15);
  } else {
    steerAngle = THREE.MathUtils.lerp(steerAngle, 0, 0.15);
    carRoll = THREE.MathUtils.lerp(carRoll, 0, 0.1);
  }

  // Clamp road boundary
  const boundary = CONFIG.ROAD_WIDTH / 2 - 1.2;
  if (playerCarGroup.position.x < -boundary) {
    playerCarGroup.position.x = -boundary;
    STATE.speed *= 0.95;
  } else if (playerCarGroup.position.x > boundary) {
    playerCarGroup.position.x = boundary;
    STATE.speed *= 0.95;
  }

  // Apply car yaw & roll tilts
  playerCarGroup.rotation.y = -steerAngle * 0.6;
  playerCarGroup.rotation.z = -carRoll;

  // Spin wheels
  const wheelSpinSpeed = (STATE.speed / 10) * delta * 20;
  playerCarGroup.wheels.forEach((w, i) => {
    w.rotation.x += wheelSpinSpeed;
    if (i < 2) w.rotation.y = -steerAngle; // Front steer
  });

  // Calculate Gears & RPM
  const gearRatios = [0, 40, 80, 125, 170, 215, 270];
  for (let g = 1; g < gearRatios.length; g++) {
    if (STATE.speed <= gearRatios[g]) {
      STATE.gear = g;
      const prev = gearRatios[g - 1];
      const range = gearRatios[g] - prev;
      STATE.rpm = Math.floor(1500 + ((STATE.speed - prev) / range) * 6500);
      break;
    }
  }

  // Update distance & score
  const deltaDistance = (STATE.speed * 0.44704 * delta) / 1000; // KM
  STATE.distance += deltaDistance;
  STATE.score += Math.floor(STATE.speed * STATE.multiplier * delta * 5);
  if (STATE.speed > STATE.topSpeed) STATE.topSpeed = Math.floor(STATE.speed);

  // Speed lines effect
  const speedLinesEl = document.getElementById('speed-lines');
  if (speedLinesEl) {
    speedLinesEl.style.opacity = STATE.speed > 130 ? (STATE.speed - 130) / 100 : 0;
  }

  // 3. Move Highway Segments (Infinite Scrolling)
  const roadScrollSpeed = (STATE.speed * 0.44704) * delta * 2.8;
  roadSegments.forEach(seg => {
    seg.position.z += roadScrollSpeed;
    if (seg.position.z > CONFIG.SEGMENT_LENGTH) {
      seg.position.z -= CONFIG.NUM_SEGMENTS * CONFIG.SEGMENT_LENGTH;
    }
  });

  // 4. Update AI Traffic & Collision Checks
  trafficCars.forEach(car => {
    // Relative motion: player speed vs traffic speed
    const relativeSpeed = (STATE.speed - car.speed) * 0.44704 * delta * 2.8;
    car.position.z += relativeSpeed;

    // Traffic respawn ahead or behind
    if (car.position.z > 30) {
      car.position.z = -CONFIG.NUM_SEGMENTS * 35 - Math.random() * 50;
      car.position.x = CONFIG.LANES[Math.floor(Math.random() * CONFIG.LANES.length)];
      car.scoredNearMiss = false;
    } else if (car.position.z < -CONFIG.NUM_SEGMENTS * 45) {
      car.position.z = 25;
    }

    // Near Miss & Collision Detection
    const dx = Math.abs(car.position.x - playerCarGroup.position.x);
    const dz = Math.abs(car.position.z - playerCarGroup.position.z);

    if (dx < 1.9 && dz < (car.length / 2 + 1.8)) {
      triggerCrash();
    } else if (dx < 2.8 && dz < 3.2 && !car.scoredNearMiss && STATE.speed > 80) {
      triggerNearMiss();
      car.scoredNearMiss = true;
    }
  });

  // Rain animation
  if (STATE.envMode === 'rain' && rainSystem) {
    const positions = rainSystem.geometry.attributes.position.array;
    for (let i = 1; i < positions.length; i += 3) {
      positions[i] -= 35 * delta;
      if (positions[i] < 0) positions[i] = 25;
    }
    rainSystem.geometry.attributes.position.needsUpdate = true;
  }

  // Update Audio Synthesizer
  Audio.update(STATE.speed, STATE.rpm, STATE.isDrifting, STATE.isNitro);

  // Update HUD
  updateHUD();
}

function updateHUD() {
  document.getElementById('speed-display').innerText = Math.floor(STATE.speed);
  document.getElementById('score-display').innerText = STATE.score.toLocaleString();
  document.getElementById('distance-display').innerText = STATE.distance.toFixed(1) + " KM";
  document.getElementById('multiplier-display').innerText = STATE.multiplier.toFixed(1) + "x";
  document.getElementById('gear-display').innerHTML = `GEAR <span class="glow-cyan">${STATE.gear}</span>`;

  // Speedo gauge SVG Arc (380 is full dashoffset)
  const maxSpd = CONFIG.NITRO_MAX_SPEED;
  const dashOffset = 380 - (Math.min(STATE.speed, maxSpd) / maxSpd) * 280;
  const speedoArc = document.getElementById('speedo-arc');
  if (speedoArc) speedoArc.style.strokeDashoffset = dashOffset;

  // Nitro & RPM bars
  document.getElementById('nitro-bar-fill').style.width = STATE.nitro + '%';
  document.getElementById('nitro-pct').innerText = Math.floor(STATE.nitro) + '%';
  document.getElementById('rpm-bar-fill').style.width = (STATE.rpm / 8000 * 100) + '%';
  document.getElementById('rpm-text').innerText = (STATE.rpm / 1000).toFixed(1);
}

function triggerNearMiss() {
  STATE.nearMissCount++;
  STATE.multiplier = Math.min(5.0, STATE.multiplier + 0.5);
  STATE.score += 500 * STATE.multiplier;

  Audio.playNearMiss();

  const banner = document.getElementById('combo-banner');
  const text = document.getElementById('combo-text');
  text.innerText = `NEAR MISS +${Math.floor(500 * STATE.multiplier)} (x${STATE.multiplier.toFixed(1)})`;
  banner.classList.add('active');

  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => {
    banner.classList.remove('active');
  }, 1200);
}

function triggerCrash() {
  STATE.crashed = true;
  STATE.playing = false;
  Audio.playCrash();

  // Show Game Over UI
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('game-over-screen').classList.remove('hidden');

  document.getElementById('final-score').innerText = STATE.score.toLocaleString();
  document.getElementById('final-top-speed').innerText = STATE.topSpeed + ' MPH';
  document.getElementById('final-distance').innerText = STATE.distance.toFixed(1) + ' KM';
  document.getElementById('final-near-misses').innerText = STATE.nearMissCount;

  // High score record
  const savedHigh = parseInt(localStorage.getItem('overdrive_high_score') || '0', 10);
  if (STATE.score > savedHigh) {
    localStorage.setItem('overdrive_high_score', STATE.score.toString());
    document.getElementById('menu-high-score').innerText = STATE.score.toLocaleString() + ' PTS';
  }
}

// ==========================================
// 10. DYNAMIC CAMERA SYSTEM
// ==========================================
function updateCamera() {
  if (STATE.photoMode) return;

  if (STATE.cameraMode === 0) {
    // Dynamic Chase Cam (Smooth follow with speed lag & FOV warp)
    const targetCamX = playerCarGroup.position.x * 0.65;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 0.1);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 3.8 + (STATE.speed / CONFIG.MAX_SPEED) * 0.4, 0.1);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, 7.8 + (STATE.speed / CONFIG.MAX_SPEED) * 1.5, 0.1);
    camera.lookAt(playerCarGroup.position.x * 0.4, 1.2, -18);

    // FOV Speed Warping
    camera.fov = THREE.MathUtils.lerp(camera.fov, 62 + (STATE.speed / CONFIG.MAX_SPEED) * 16, 0.08);
    camera.updateProjectionMatrix();
  } else if (STATE.cameraMode === 1) {
    // Hood / Cockpit Cam
    camera.position.set(playerCarGroup.position.x, 1.15, 0.4);
    camera.lookAt(playerCarGroup.position.x, 1.15, -40);
    camera.fov = 75;
    camera.updateProjectionMatrix();
  } else if (STATE.cameraMode === 2) {
    // Low Bumper Cam
    camera.position.set(playerCarGroup.position.x, 0.4, 2.2);
    camera.lookAt(playerCarGroup.position.x, 0.4, -40);
    camera.fov = 85;
    camera.updateProjectionMatrix();
  } else {
    // Cinematic Side Orbit
    const time = Date.now() * 0.001;
    camera.position.set(Math.sin(time) * 12, 4, Math.cos(time) * 12);
    camera.lookAt(playerCarGroup.position);
  }
}

// ==========================================
// 11. EVENT LISTENERS & UI WIRING
// ==========================================
function setupEventListeners() {
  window.addEventListener('keydown', (e) => {
    Audio.init(); // Initialize audio context on first user gesture

    if (e.code === 'KeyW' || e.code === 'ArrowUp') KEYS.forward = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') KEYS.backward = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') KEYS.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') KEYS.right = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') KEYS.nitro = true;
    if (e.code === 'Space') KEYS.drift = true;

    if (e.code === 'KeyC') {
      STATE.cameraMode = (STATE.cameraMode + 1) % 4;
    }
    if (e.code === 'KeyT') {
      const modes = ['sunset', 'midnight', 'rain', 'golden'];
      const nextIdx = (modes.indexOf(STATE.envMode) + 1) % modes.length;
      setEnvironment(modes[nextIdx]);
    }
    if (e.code === 'KeyM') {
      Audio.toggleMute();
    }
    if (e.code === 'KeyP') {
      togglePhotoMode();
    }
    if (e.code === 'Escape' && STATE.photoMode) {
      togglePhotoMode();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') KEYS.forward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') KEYS.backward = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') KEYS.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') KEYS.right = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') KEYS.nitro = false;
    if (e.code === 'Space') KEYS.drift = false;
  });

  // Start Game Button
  document.getElementById('start-btn').addEventListener('click', () => {
    Audio.init();
    startGame();
  });

  // Retry Button
  document.getElementById('retry-btn').addEventListener('click', () => {
    startGame();
  });

  // Main Menu Button
  document.getElementById('main-menu-btn').addEventListener('click', () => {
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
    STATE.menu = true;
    STATE.playing = false;
  });

  // Color Buttons
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const hex = parseInt(btn.dataset.color.replace('#', '0x'), 16);
      STATE.carColor = hex;
      if (playerCarBodyMesh) {
        playerCarBodyMesh.material.color.setHex(hex);
      }
    });
  });

  // Environment Selector Buttons
  document.querySelectorAll('.env-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.env-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setEnvironment(btn.dataset.env);
    });
  });

  // Wallpaper Modal
  const wpModal = document.getElementById('wallpaper-modal');
  document.getElementById('view-screenshot-btn').addEventListener('click', () => {
    wpModal.classList.remove('hidden');
  });
  document.getElementById('close-wallpaper-btn').addEventListener('click', () => {
    wpModal.classList.add('hidden');
  });

  // Photo Mode Controls
  document.getElementById('close-photo-btn').addEventListener('click', togglePhotoMode);
  document.getElementById('take-snapshot-btn').addEventListener('click', take4KSnapshot);
}

function startGame() {
  STATE.menu = false;
  STATE.playing = true;
  STATE.crashed = false;
  STATE.score = 0;
  STATE.distance = 0;
  STATE.speed = 40;
  STATE.multiplier = 1.0;
  STATE.nearMissCount = 0;
  STATE.nitro = 100;

  playerCarGroup.position.set(0, 0, 0);
  spawnTrafficFleet();

  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
}

function togglePhotoMode() {
  STATE.photoMode = !STATE.photoMode;
  STATE.paused = STATE.photoMode;
  const photoModal = document.getElementById('photo-modal');
  const hud = document.getElementById('hud');

  if (STATE.photoMode) {
    photoModal.classList.remove('hidden');
    hud.classList.add('hidden');
  } else {
    photoModal.classList.add('hidden');
    if (STATE.playing && !STATE.crashed) hud.classList.remove('hidden');
  }
}

function take4KSnapshot() {
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'OVERDRIVE_4K_Screenshot.png';
  link.href = dataURL;
  link.click();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================
// 12. MAIN ANIMATION RENDER LOOP
// ==========================================
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (STATE.menu) {
    // Menu background idle rotation
    const time = now * 0.0006;
    camera.position.set(Math.sin(time) * 9, 2.8, Math.cos(time) * 9);
    camera.lookAt(0, 0.8, 0);
  } else {
    updatePhysics(delta);
    updateCamera();
    renderRadar();
  }

  renderer.render(scene, camera);
}

// Initialize on Load
window.addEventListener('DOMContentLoaded', () => {
  const savedHigh = localStorage.getItem('overdrive_high_score') || '0';
  document.getElementById('menu-high-score').innerText = parseInt(savedHigh).toLocaleString() + ' PTS';

  init3D();
  setupEventListeners();
  animate();
});
