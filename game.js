/**
 * OVERDRIVE 4K - Bridge Highway Edition
 * Inspired by classic Highway Traffic Racers
 * Features: 4-Lane Scenic Bridge over Water, Rocky Cliffs, Box Trucks, SUVs, Sports Cars,
 * Dynamic Shadows, Realistic Traffic AI, and Web Audio Engine.
 */

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const CONFIG = {
  // 4 lanes: -5.4, -1.8 (Left Side), +1.8, +5.4 (Right Side)
  LANES: [-5.4, -1.8, 1.8, 5.4],
  ROAD_WIDTH: 15,
  SEGMENT_LENGTH: 80,
  NUM_SEGMENTS: 14,
  MAX_SPEED: 180, // MPH
  ACCELERATION: 40,
  BRAKING: 65,
  FRICTION: 10,
  NITRO_ACCEL: 75,
  NITRO_MAX_SPEED: 225,
  STEER_SPEED: 12,
  MAX_STEER_ANGLE: 0.28,
};

const STATE = {
  menu: true,
  playing: false,
  crashed: false,
  paused: false,
  photoMode: false,
  
  score: 0,
  distance: 0,
  speed: 0,
  gear: 1,
  rpm: 1000,
  multiplier: 1.0,
  nearMissCount: 0,
  topSpeed: 0,
  nitro: 100,
  isNitro: false,
  isDrifting: false,
  
  carColor: 0xba1826, // Classic Sports Red (like screenshot)
  envMode: 'daylight', // daylight, sunset, night, storm
  cameraMode: 0, // 0: Elevated Bridge Cam (Screenshot Angle), 1: Close Chase, 2: Cockpit, 3: Bumper
  twoWayTraffic: false // Can toggle two-way traffic
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
// 2. AUDIO SYNTHESIZER (Web Audio API)
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
    this.nitroGain = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Engine Polyphonic Synth
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.setValueAtTime(500, this.ctx.currentTime);

      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.setValueAtTime(50, this.ctx.currentTime);

      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'triangle';
      this.osc2.frequency.setValueAtTime(100, this.ctx.currentTime);

      this.osc1.connect(this.filter);
      this.osc2.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.osc1.start();
      this.osc2.start();

      // Noise generator for tire skids & wind
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const skidFilter = this.ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.setValueAtTime(1400, this.ctx.currentTime);
      skidFilter.Q.setValueAtTime(3, this.ctx.currentTime);

      this.skidGain = this.ctx.createGain();
      this.skidGain.gain.setValueAtTime(0, this.ctx.currentTime);

      noiseSource.connect(skidFilter);
      skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.masterGain);
      noiseSource.start();

      // Nitro Synth
      const nitroNoise = this.ctx.createBufferSource();
      nitroNoise.buffer = noiseBuffer;
      nitroNoise.loop = true;
      const nitroFilter = this.ctx.createBiquadFilter();
      nitroFilter.type = 'lowpass';
      nitroFilter.frequency.setValueAtTime(900, this.ctx.currentTime);
      this.nitroGain = this.ctx.createGain();
      this.nitroGain.gain.setValueAtTime(0, this.ctx.currentTime);

      nitroNoise.connect(nitroFilter);
      nitroFilter.connect(this.nitroGain);
      this.nitroGain.connect(this.masterGain);
      nitroNoise.start();

      this.initialized = true;
    } catch (e) {
      console.warn("Audio init warning:", e);
    }
  }

  update(speed, rpm, isDrifting, isNitro) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;
    const baseFreq = 40 + (rpm / 8000) * 150;
    this.osc1.frequency.setTargetAtTime(baseFreq, t, 0.05);
    this.osc2.frequency.setTargetAtTime(baseFreq * 1.5, t, 0.05);
    this.filter.frequency.setTargetAtTime(350 + (rpm / 8000) * 1500, t, 0.05);

    const vol = Math.min(0.28, 0.08 + (speed / CONFIG.MAX_SPEED) * 0.18);
    this.engineGain.gain.setTargetAtTime(vol, t, 0.05);

    this.skidGain.gain.setTargetAtTime(isDrifting && speed > 20 ? 0.35 : 0, t, 0.08);
    this.nitroGain.gain.setTargetAtTime(isNitro ? 0.4 : 0, t, 0.08);
  }

  playNearMiss() {
    if (!this.initialized || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(550, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1100, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.22);
  }

  playCrash() {
    if (!this.initialized || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(25, this.ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.6, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.35, this.ctx.currentTime);
    }
  }
}

const Audio = new SoundEngine();

// ==========================================
// 3. THREE.JS SCENE SETUP & BRIDGE ENVIRONMENT
// ==========================================
let scene, camera, renderer, container;
let sunLight, ambientLight, skyMesh;
let roadSegments = [];
let trafficCars = [];
let waterPlanes = [];
let playerCarGroup, playerCarBodyMesh;
let shadowTexture = null;

function init3D() {
  container = document.getElementById('game-container');
  
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xa0c4de, 0.0028);

  camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 1000);
  
  // Screenshot Elevated Bridge Perspective (Viewing down highway from behind & above)
  camera.position.set(0, 11, 14);
  camera.lookAt(0, 0.8, -35);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Sunlight (Crisp Natural Daytime Lighting like screenshot)
  ambientLight = new THREE.AmbientLight(0xfff5ea, 0.85);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xfff8ee, 1.8);
  sunLight.position.set(35, 70, 30);
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

  shadowTexture = createContactShadowTexture();

  createSkyDome();
  createWaterAndTerrain();
  buildRoadSegments();
  buildPlayerCar();
  setEnvironment(STATE.envMode);

  window.addEventListener('resize', onWindowResize);
}

function createContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.4)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createSkyDome() {
  const skyGeo = new THREE.SphereGeometry(700, 32, 24);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x93b7d8,
    side: THREE.BackSide
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);
}

// 4-Lane Bridge Over Water & Rocky Cliffs
function createWaterAndTerrain() {
  // 1. Water Surface (Shimmering Blue Water below bridge)
  const waterGeo = new THREE.PlaneGeometry(350, 800, 32, 32);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1b7294, // Beautiful tropical/river blue
    roughness: 0.15,
    metalness: 0.65,
  });

  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -6.5, -200);
  scene.add(water);
  waterPlanes.push(water);

  // 2. Grassy Terrain / Banks in the Distance
  const terrainGeo = new THREE.PlaneGeometry(600, 800);
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0xa1a55f, // Grassy hillside like screenshot
    roughness: 0.9,
    metalness: 0.1
  });

  const leftBank = new THREE.Mesh(terrainGeo, terrainMat);
  leftBank.rotation.x = -Math.PI / 2;
  leftBank.position.set(-180, -2, -200);
  scene.add(leftBank);

  const rightBank = new THREE.Mesh(terrainGeo, terrainMat);
  rightBank.rotation.x = -Math.PI / 2;
  rightBank.position.set(180, -2, -200);
  scene.add(rightBank);

  // 3. Rocky Cliffs flanking the bridge
  const rockGeo = new THREE.DodecahedronGeometry(8, 1);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x48423a,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true
  });

  for (let i = 0; i < 24; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const side = i % 2 === 0 ? -1 : 1;
    rock.position.set(
      side * (CONFIG.ROAD_WIDTH / 2 + 7 + Math.random() * 6),
      -2 + Math.random() * 2,
      -i * 35 + 50
    );
    rock.scale.set(1.5 + Math.random() * 0.8, 1.2 + Math.random() * 0.6, 1.8 + Math.random() * 1.2);
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    scene.add(rock);
  }
}

// ==========================================
// 4. 4-LANE BRIDGE HIGHWAY TEXTURE & SEGMENTS
// ==========================================
function createBridgeRoadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Concrete / Asphalt Bridge Base (Grey textured road like screenshot)
  ctx.fillStyle = '#6b7278';
  ctx.fillRect(0, 0, 1024, 1024);

  // Realistic asphalt noise & weathering
  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const v = Math.floor(Math.random() * 26) - 13;
    ctx.fillStyle = `rgb(${107 + v}, ${114 + v}, ${120 + v})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Tire skid marks & wear
  ctx.fillStyle = 'rgba(40, 45, 50, 0.08)';
  const tireTracks = [130, 230, 380, 480, 640, 740, 890, 990];
  tireTracks.forEach(tx => {
    ctx.fillRect(tx - 18, 0, 36, 1024);
  });

  // Solid Center Divider (Prominent Solid White Line dividing the 2 halves)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(507, 0, 10, 1024);

  // Dashed Lane Lines (White Dashes between Lane 1 & 2, and Lane 3 & 4)
  const dashedLanes = [256, 768];
  dashedLanes.forEach(lx => {
    for (let y = 0; y < 1024; y += 128) {
      ctx.fillRect(lx - 4, y + 20, 8, 75);
    }
  });

  // Solid Outer Edge Lines
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(20, 0, 8, 1024);
  ctx.fillRect(996, 0, 8, 1024);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 2);
  return texture;
}

function buildRoadSegments() {
  const roadTex = createBridgeRoadTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.6,
    metalness: 0.15
  });

  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0xb5bec6, // Metal guard rail
    metalness: 0.8,
    roughness: 0.3
  });

  const postMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    metalness: 0.9,
    roughness: 0.2
  });

  const bridgeConcreteMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f54,
    roughness: 0.9
  });

  for (let i = 0; i < CONFIG.NUM_SEGMENTS; i++) {
    const segGroup = new THREE.Group();

    // 1. Asphalt Deck
    const deckGeo = new THREE.PlaneGeometry(CONFIG.ROAD_WIDTH, CONFIG.SEGMENT_LENGTH);
    const deck = new THREE.Mesh(deckGeo, roadMat);
    deck.rotation.x = -Math.PI / 2;
    deck.receiveShadow = true;
    segGroup.add(deck);

    // 2. Concrete Bridge Retaining Edge & Wall
    const ledgeGeo = new THREE.BoxGeometry(0.8, 1.2, CONFIG.SEGMENT_LENGTH);
    const leftLedge = new THREE.Mesh(ledgeGeo, bridgeConcreteMat);
    leftLedge.position.set(-CONFIG.ROAD_WIDTH / 2 - 0.4, -0.4, 0);
    const rightLedge = new THREE.Mesh(ledgeGeo, bridgeConcreteMat);
    rightLedge.position.set(CONFIG.ROAD_WIDTH / 2 + 0.4, -0.4, 0);
    segGroup.add(leftLedge, rightLedge);

    // 3. Steel W-Beam Guardrails (Left & Right)
    const railGeo = new THREE.BoxGeometry(0.2, 0.45, CONFIG.SEGMENT_LENGTH);
    const leftRail = new THREE.Mesh(railGeo, barrierMat);
    leftRail.position.set(-CONFIG.ROAD_WIDTH / 2 - 0.2, 0.5, 0);
    leftRail.castShadow = true;

    const rightRail = new THREE.Mesh(railGeo, barrierMat);
    rightRail.position.set(CONFIG.ROAD_WIDTH / 2 + 0.2, 0.5, 0);
    rightRail.castShadow = true;
    segGroup.add(leftRail, rightRail);

    // Guardrail Support Posts every 8m
    const postGeo = new THREE.BoxGeometry(0.15, 0.8, 0.15);
    for (let z = -CONFIG.SEGMENT_LENGTH / 2; z <= CONFIG.SEGMENT_LENGTH / 2; z += 8) {
      const pL = new THREE.Mesh(postGeo, postMat);
      pL.position.set(-CONFIG.ROAD_WIDTH / 2 - 0.2, 0.35, z);
      const pR = new THREE.Mesh(postGeo, postMat);
      pR.position.set(CONFIG.ROAD_WIDTH / 2 + 0.2, 0.35, z);
      segGroup.add(pL, pR);
    }

    // 4. Bridge Concrete Pier Pillars underneath
    const pierGeo = new THREE.CylinderGeometry(1.2, 1.4, 8, 12);
    const pierL = new THREE.Mesh(pierGeo, bridgeConcreteMat);
    pierL.position.set(-CONFIG.ROAD_WIDTH / 2 + 2, -4, 0);
    const pierR = new THREE.Mesh(pierGeo, bridgeConcreteMat);
    pierR.position.set(CONFIG.ROAD_WIDTH / 2 - 2, -4, 0);
    segGroup.add(pierL, pierR);

    segGroup.position.z = -i * CONFIG.SEGMENT_LENGTH;
    scene.add(segGroup);
    roadSegments.push(segGroup);
  }
}

// ==========================================
// 5. CAR BUILDERS (SPORTS COUPE, BOX TRUCK, SUV)
// ==========================================

// Helper: Soft contact shadow plane beneath any vehicle
function addContactShadow(parentGroup, width = 2.4, length = 4.8) {
  const shadowGeo = new THREE.PlaneGeometry(width, length);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.7,
    depthWrite: false
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0.4, 0.02, 0.2); // Offset slightly with sunlight angle
  parentGroup.add(shadowPlane);
}

// 1. Player Sports Coupe / Convertible (Red Car in Screenshot)
function buildPlayerCar() {
  playerCarGroup = new THREE.Group();

  const paintMat = new THREE.MeshStandardMaterial({
    color: STATE.carColor,
    metalness: 0.8,
    roughness: 0.25
  });

  const blackRoofMat = new THREE.MeshStandardMaterial({
    color: 0x16171b,
    metalness: 0.6,
    roughness: 0.3
  });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0a1018,
    metalness: 0.95,
    roughness: 0.1,
    transparent: true,
    opacity: 0.85
  });

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.5 });

  // Chassis Lower Body
  const bodyGeo = new THREE.BoxGeometry(2.1, 0.5, 4.3);
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.position.y = 0.45;
  body.castShadow = true;
  playerCarGroup.add(body);
  playerCarBodyMesh = body;

  // Front Hood & Rear Deck Slope
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.35, 1.4), paintMat);
  hood.position.set(0, 0.5, -1.2);
  playerCarGroup.add(hood);

  // Black Convertible Top / Cabin
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.42, 2.0), blackRoofMat);
  roof.position.set(0, 0.82, 0.1);
  roof.castShadow = true;
  playerCarGroup.add(roof);

  // Rear Tinted Glass (Curved look)
  const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), glassMat);
  rearGlass.position.set(0, 0.8, 1.0);
  rearGlass.rotation.x = -Math.PI / 4;
  playerCarGroup.add(rearGlass);

  // Front Windshield
  const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), glassMat);
  frontGlass.position.set(0, 0.8, -0.85);
  frontGlass.rotation.x = Math.PI / 4;
  playerCarGroup.add(frontGlass);

  // Side Mirrors
  const mirrorGeo = new THREE.BoxGeometry(0.25, 0.15, 0.12);
  const mirrorL = new THREE.Mesh(mirrorGeo, blackRoofMat);
  mirrorL.position.set(-1.12, 0.65, -0.6);
  const mirrorR = new THREE.Mesh(mirrorGeo, blackRoofMat);
  mirrorR.position.set(1.12, 0.65, -0.6);
  playerCarGroup.add(mirrorL, mirrorR);

  // Taillights (Glowing Red LEDs)
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff0022 });
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.05), tailMat);
  tailL.position.set(-0.72, 0.55, 2.15);
  const tailR = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.05), tailMat);
  tailR.position.set(0.72, 0.55, 2.15);
  playerCarGroup.add(tailL, tailR);

  // Headlights
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), headMat);
  headL.position.set(-0.72, 0.5, -2.15);
  const headR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), headMat);
  headR.position.set(0.72, 0.5, -2.15);
  playerCarGroup.add(headL, headR);

  // Wheels (Silver Alloy Rims with high detail)
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.8 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, metalness: 0.95, roughness: 0.1 });

  playerCarGroup.wheels = [];
  const wheelPositions = [
    { x: -1.02, y: 0.38, z: -1.25 },
    { x: 1.02, y: 0.38, z: -1.25 },
    { x: -1.02, y: 0.38, z: 1.25 },
    { x: 1.02, y: 0.38, z: 1.25 },
  ];

  wheelPositions.forEach((pos, idx) => {
    const wheelGroup = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.32, 10), rimMat);
    rim.rotateZ(Math.PI / 2);
    wheelGroup.add(tire, rim);
    wheelGroup.position.set(pos.x, pos.y, pos.z);
    playerCarGroup.add(wheelGroup);
    playerCarGroup.wheels.push(wheelGroup);
  });

  // Nitro Exhaust Glow
  const flameGeo = new THREE.ConeGeometry(0.12, 0.8, 8);
  flameGeo.rotateX(Math.PI / 2);
  const nitroMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0 });
  const flameL = new THREE.Mesh(flameGeo, nitroMat);
  flameL.position.set(-0.5, 0.35, 2.3);
  const flameR = new THREE.Mesh(flameGeo, nitroMat);
  flameR.position.set(0.5, 0.35, 2.3);
  playerCarGroup.add(flameL, flameR);
  playerCarGroup.nitroFlames = [flameL, flameR];

  // Soft Contact Shadow Plane
  addContactShadow(playerCarGroup, 2.6, 4.8);

  // Default Lane: Lane 1 (Left lane, red car in screenshot)
  playerCarGroup.position.set(CONFIG.LANES[0], 0, 0);
  scene.add(playerCarGroup);
}

// 2. White Box Delivery Semi-Truck (Matches Truck in screenshot)
function buildBoxTruckMesh() {
  const truck = new THREE.Group();

  const whiteCargoMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.4 });
  const blueCabMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.7, roughness: 0.3 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x22252a, metalness: 0.8, roughness: 0.4 });

  // Main White Cargo Box
  const boxGeo = new THREE.BoxGeometry(2.8, 3.2, 6.2);
  const box = new THREE.Mesh(boxGeo, whiteCargoMat);
  box.position.set(0, 2.2, -0.8);
  box.castShadow = true;
  truck.add(box);

  // Rear Cargo Doors & Trim Lines
  const trimGeo = new THREE.BoxGeometry(2.7, 0.05, 0.05);
  const t1 = new THREE.Mesh(trimGeo, darkMetalMat);
  t1.position.set(0, 3.6, 2.32);
  truck.add(t1);

  // Cab Front Cabin
  const cabGeo = new THREE.BoxGeometry(2.6, 2.4, 2.4);
  const cab = new THREE.Mesh(cabGeo, blueCabMat);
  cab.position.set(0, 1.5, -4.5);
  cab.castShadow = true;
  truck.add(cab);

  // Cab Windshield
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.1), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.1 }));
  win.position.set(0, 1.8, -5.72);
  truck.add(win);

  // Rear Mudflaps & Bumper
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.3, 0.2), darkMetalMat);
  bumper.position.set(0, 0.5, 2.3);
  truck.add(bumper);

  // Taillights
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), tailMat);
  tailL.position.set(-1.0, 0.6, 2.4);
  const tailR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), tailMat);
  tailR.position.set(1.0, 0.6, 2.4);
  truck.add(tailL, tailR);

  // Truck Wheels (6 Wheels)
  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.38, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });

  [-4.2, 0.2, 1.4].forEach(z => {
    [-1.35, 1.35].forEach(x => {
      const w = new THREE.Mesh(wheelGeo, tireMat);
      w.position.set(x, 0.48, z);
      truck.add(w);
    });
  });

  addContactShadow(truck, 3.4, 8.5);
  truck.length = 8.5;
  return truck;
}

// 3. Modern Luxury SUV / Crossover (Grey/Silver with Black Glass Roof in screenshot)
function buildSUVMesh() {
  const suv = new THREE.Group();

  const silverPaintMat = new THREE.MeshStandardMaterial({
    color: 0x7c8793, // Sleek modern silver/grey like screenshot
    metalness: 0.85,
    roughness: 0.2
  });

  const blackGlassMat = new THREE.MeshStandardMaterial({
    color: 0x11161d,
    metalness: 0.9,
    roughness: 0.1
  });

  // Lower Body
  const bodyGeo = new THREE.BoxGeometry(2.2, 0.65, 4.6);
  const body = new THREE.Mesh(bodyGeo, silverPaintMat);
  body.position.y = 0.55;
  body.castShadow = true;
  suv.add(body);

  // Upper Cabin with Full Panoramic Black Glass Roof (Matches screenshot)
  const cabinGeo = new THREE.BoxGeometry(1.85, 0.58, 2.8);
  const cabin = new THREE.Mesh(cabinGeo, blackGlassMat);
  cabin.position.set(0, 1.1, 0.1);
  cabin.castShadow = true;
  suv.add(cabin);

  // White / Silver A-Pillar accent (Matches SUV in screenshot)
  const pillarGeo = new THREE.BoxGeometry(0.12, 0.55, 1.2);
  const pL = new THREE.Mesh(pillarGeo, silverPaintMat);
  pL.position.set(-0.94, 1.1, -0.6);
  pL.rotation.x = Math.PI / 6;
  const pR = new THREE.Mesh(pillarGeo, silverPaintMat);
  pR.position.set(0.94, 1.1, -0.6);
  pR.rotation.x = Math.PI / 6;
  suv.add(pL, pR);

  // Rear Dual Exhaust & Taillight bar
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0xff1525 }));
  tailBar.position.set(0, 0.75, 2.32);
  suv.add(tailBar);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 0.9, roughness: 0.15 });

  [
    { x: -1.05, z: -1.35 }, { x: 1.05, z: -1.35 },
    { x: -1.05, z: 1.35 }, { x: 1.05, z: 1.35 }
  ].forEach(pos => {
    const wGroup = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.34, 12), rimMat);
    rim.rotateZ(Math.PI / 2);
    wGroup.add(tire, rim);
    wGroup.position.set(pos.x, 0.42, pos.z);
    suv.add(wGroup);
  });

  addContactShadow(suv, 2.7, 5.2);
  suv.length = 5.0;
  return suv;
}

// 4. Pickup Truck / Sedan Variety
function buildSedanMesh(colorHex) {
  const sedan = new THREE.Group();
  const paintMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.75, roughness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x151c24, roughness: 0.2 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.55, 4.4), paintMat);
  body.position.y = 0.5;
  body.castShadow = true;

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.48, 2.2), glassMat);
  cabin.position.set(0, 0.95, -0.1);
  cabin.castShadow = true;

  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xff1122 }));
  tail.position.set(0, 0.55, 2.22);

  sedan.add(body, cabin, tail);
  addContactShadow(sedan, 2.5, 4.9);
  sedan.length = 4.5;
  return sedan;
}

// ==========================================
// 6. TRAFFIC FLEET GENERATOR & AI LOGIC
// ==========================================
function createAITrafficCar(zPos, forcedType = null, forcedLane = null) {
  let carGroup;
  const type = forcedType !== null ? forcedType : Math.floor(Math.random() * 3);

  if (type === 0) {
    carGroup = buildBoxTruckMesh(); // Box Truck (Left Lane in screenshot)
  } else if (type === 1) {
    carGroup = buildSUVMesh(); // SUV (Right Lane in screenshot)
  } else {
    const colors = [0x991b1b, 0x1e3a8a, 0x374151, 0x065f46, 0x854d0e];
    const c = colors[Math.floor(Math.random() * colors.length)];
    carGroup = buildSedanMesh(c);
  }

  const laneIndex = forcedLane !== null ? forcedLane : Math.floor(Math.random() * CONFIG.LANES.length);
  carGroup.position.set(CONFIG.LANES[laneIndex], 0, zPos);
  carGroup.lane = laneIndex;
  carGroup.speed = 45 + Math.random() * 40; // Cruising speed 45 - 85 MPH
  carGroup.scoredNearMiss = false;

  scene.add(carGroup);
  trafficCars.push(carGroup);
}

function spawnTrafficFleet() {
  trafficCars.forEach(c => scene.remove(c));
  trafficCars = [];

  // Match the screenshot layout initially:
  // 1. White Box Truck in Lane 1 ahead (-35)
  createAITrafficCar(-35, 0, 0);

  // 2. Grey SUV in Lane 3 ahead (-45)
  createAITrafficCar(-48, 1, 2);

  // 3. Red Truck / Car far in distance Lane 3 (-90)
  createAITrafficCar(-90, 2, 2);

  // 4. Sedan in Lane 4 far (-125)
  createAITrafficCar(-125, 2, 3);

  // Remaining traffic cars spaced out
  for (let i = 4; i < 9; i++) {
    createAITrafficCar(-i * 40 - 20);
  }
}

// ==========================================
// 7. ENVIRONMENT & TIME PRESETS
// ==========================================
function setEnvironment(env) {
  STATE.envMode = env;

  if (env === 'daylight') {
    // Natural Sunlight Bridge (Exact match with screenshot)
    scene.fog.color.setHex(0xa0c4de);
    renderer.setClearColor(0xa0c4de);
    if (skyMesh) skyMesh.material.color.setHex(0x93b7d8);
    ambientLight.color.setHex(0xfff5ea);
    ambientLight.intensity = 0.9;
    sunLight.color.setHex(0xfff8ee);
    sunLight.intensity = 1.9;
    sunLight.position.set(35, 70, 30);
  } else if (env === 'sunset') {
    scene.fog.color.setHex(0xdd7744);
    renderer.setClearColor(0xdd7744);
    if (skyMesh) skyMesh.material.color.setHex(0xdd6633);
    ambientLight.color.setHex(0xffeedd);
    ambientLight.intensity = 0.7;
    sunLight.color.setHex(0xff8833);
    sunLight.intensity = 2.2;
    sunLight.position.set(40, 50, -120);
  } else if (env === 'midnight') {
    scene.fog.color.setHex(0x050b18);
    renderer.setClearColor(0x050b18);
    if (skyMesh) skyMesh.material.color.setHex(0x040812);
    ambientLight.color.setHex(0x224466);
    ambientLight.intensity = 0.3;
    sunLight.color.setHex(0x3366cc);
    sunLight.intensity = 0.5;
  } else {
    // Wet Storm
    scene.fog.color.setHex(0x334455);
    renderer.setClearColor(0x334455);
    if (skyMesh) skyMesh.material.color.setHex(0x263340);
    ambientLight.intensity = 0.6;
    sunLight.intensity = 0.8;
  }
}

// ==========================================
// 8. RADAR SCANNER (Canvas 2D)
// ==========================================
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function renderRadar() {
  if (!minimapCtx) return;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  minimapCtx.clearRect(0, 0, w, h);

  // Radar grid rings
  minimapCtx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
  minimapCtx.lineWidth = 1;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 30, 0, Math.PI * 2);
  minimapCtx.arc(cx, cy, 60, 0, Math.PI * 2);
  minimapCtx.stroke();

  // 4 Highway Lanes on radar
  minimapCtx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
  minimapCtx.strokeRect(cx - 26, 8, 52, h - 16);

  // Traffic Blips (Red dots)
  trafficCars.forEach(car => {
    const relZ = car.position.z - playerCarGroup.position.z;
    const relX = car.position.x;
    if (Math.abs(relZ) < 110) {
      const px = cx + (relX / CONFIG.ROAD_WIDTH) * 52;
      const py = cy + (relZ / 110) * 60;

      minimapCtx.fillStyle = car.length > 6 ? '#ffaa00' : '#ff2a55';
      minimapCtx.beginPath();
      minimapCtx.arc(px, py, car.length > 6 ? 4.5 : 3.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  });

  // Player Blip (Cyan Arrow)
  const playerPX = cx + (playerCarGroup.position.x / CONFIG.ROAD_WIDTH) * 52;
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

  const maxSpd = STATE.isNitro ? CONFIG.NITRO_MAX_SPEED : CONFIG.MAX_SPEED;
  const accelRate = STATE.isNitro ? CONFIG.NITRO_ACCEL : CONFIG.ACCELERATION;

  // 1. Acceleration & Braking
  if (KEYS.forward) {
    STATE.speed = Math.min(maxSpd, STATE.speed + accelRate * delta);
  } else if (KEYS.backward) {
    STATE.speed = Math.max(0, STATE.speed - CONFIG.BRAKING * delta);
  } else {
    STATE.speed = Math.max(0, STATE.speed - CONFIG.FRICTION * delta);
  }

  // Nitro consumption & recharge
  if (KEYS.nitro && STATE.nitro > 0 && STATE.speed > 25) {
    STATE.isNitro = true;
    STATE.nitro = Math.max(0, STATE.nitro - 35 * delta);
    document.getElementById('nitro-overlay').style.opacity = '0.6';
    playerCarGroup.nitroFlames.forEach(f => f.material.opacity = 0.9);
  } else {
    STATE.isNitro = false;
    STATE.nitro = Math.min(100, STATE.nitro + 12 * delta);
    document.getElementById('nitro-overlay').style.opacity = '0';
    playerCarGroup.nitroFlames.forEach(f => f.material.opacity = 0);
  }

  // 2. Steering & Drifting
  STATE.isDrifting = KEYS.drift && STATE.speed > 35;
  const steerMult = STATE.isDrifting ? 1.5 : 1.0;

  if (KEYS.left) {
    steerAngle = Math.max(-CONFIG.MAX_STEER_ANGLE, steerAngle - CONFIG.STEER_SPEED * steerMult * delta);
    playerCarGroup.position.x -= (STATE.speed * 0.11 * steerMult + 4.5) * delta;
    carRoll = THREE.MathUtils.lerp(carRoll, -0.08, 0.15);
  } else if (KEYS.right) {
    steerAngle = Math.min(CONFIG.MAX_STEER_ANGLE, steerAngle + CONFIG.STEER_SPEED * steerMult * delta);
    playerCarGroup.position.x += (STATE.speed * 0.11 * steerMult + 4.5) * delta;
    carRoll = THREE.MathUtils.lerp(carRoll, 0.08, 0.15);
  } else {
    steerAngle = THREE.MathUtils.lerp(steerAngle, 0, 0.15);
    carRoll = THREE.MathUtils.lerp(carRoll, 0, 0.1);
  }

  // Clamp bridge boundaries
  const boundary = CONFIG.ROAD_WIDTH / 2 - 1.2;
  if (playerCarGroup.position.x < -boundary) {
    playerCarGroup.position.x = -boundary;
    STATE.speed *= 0.96;
  } else if (playerCarGroup.position.x > boundary) {
    playerCarGroup.position.x = boundary;
    STATE.speed *= 0.96;
  }

  // Body tilts
  playerCarGroup.rotation.y = -steerAngle * 0.5;
  playerCarGroup.rotation.z = -carRoll;

  // Spin wheels
  const wheelSpinSpeed = (STATE.speed / 10) * delta * 20;
  playerCarGroup.wheels.forEach((w, i) => {
    w.rotation.x -= wheelSpinSpeed;
    if (i < 2) w.rotation.y = -steerAngle;
  });

  // Calculate Gears & RPM
  const gearRatios = [0, 35, 70, 110, 150, 185, 225];
  for (let g = 1; g < gearRatios.length; g++) {
    if (STATE.speed <= gearRatios[g]) {
      STATE.gear = g;
      const prev = gearRatios[g - 1];
      const range = gearRatios[g] - prev;
      STATE.rpm = Math.floor(1500 + ((STATE.speed - prev) / range) * 6500);
      break;
    }
  }

  // Distance & Score
  const deltaDistance = (STATE.speed * 0.44704 * delta) / 1000;
  STATE.distance += deltaDistance;
  STATE.score += Math.floor(STATE.speed * STATE.multiplier * delta * 5);
  if (STATE.speed > STATE.topSpeed) STATE.topSpeed = Math.floor(STATE.speed);

  // Speed lines
  const speedLinesEl = document.getElementById('speed-lines');
  if (speedLinesEl) {
    speedLinesEl.style.opacity = STATE.speed > 120 ? (STATE.speed - 120) / 100 : 0;
  }

  // 3. Infinite Road Scrolling
  const roadScrollSpeed = (STATE.speed * 0.44704) * delta * 2.8;
  roadSegments.forEach(seg => {
    seg.position.z += roadScrollSpeed;
    if (seg.position.z > CONFIG.SEGMENT_LENGTH) {
      seg.position.z -= CONFIG.NUM_SEGMENTS * CONFIG.SEGMENT_LENGTH;
    }
  });

  // 4. Update AI Traffic
  trafficCars.forEach(car => {
    const relativeSpeed = (STATE.speed - car.speed) * 0.44704 * delta * 2.8;
    car.position.z += relativeSpeed;

    // Traffic respawn ahead or behind
    if (car.position.z > 30) {
      car.position.z = -CONFIG.NUM_SEGMENTS * 28 - Math.random() * 40;
      car.position.x = CONFIG.LANES[Math.floor(Math.random() * CONFIG.LANES.length)];
      car.scoredNearMiss = false;
    } else if (car.position.z < -CONFIG.NUM_SEGMENTS * 40) {
      car.position.z = 25;
    }

    // Collision & Near Miss
    const dx = Math.abs(car.position.x - playerCarGroup.position.x);
    const dz = Math.abs(car.position.z - playerCarGroup.position.z);

    if (dx < 1.9 && dz < (car.length / 2 + 1.8)) {
      triggerCrash();
    } else if (dx < 2.8 && dz < 3.2 && !car.scoredNearMiss && STATE.speed > 70) {
      triggerNearMiss();
      car.scoredNearMiss = true;
    }
  });

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

  // Speedo gauge SVG Arc
  const maxSpd = CONFIG.NITRO_MAX_SPEED;
  const dashOffset = 380 - (Math.min(STATE.speed, maxSpd) / maxSpd) * 280;
  const speedoArc = document.getElementById('speedo-arc');
  if (speedoArc) speedoArc.style.strokeDashoffset = dashOffset;

  // Nitro & RPM
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

  document.getElementById('hud').classList.add('hidden');
  document.getElementById('game-over-screen').classList.remove('hidden');

  document.getElementById('final-score').innerText = STATE.score.toLocaleString();
  document.getElementById('final-top-speed').innerText = STATE.topSpeed + ' MPH';
  document.getElementById('final-distance').innerText = STATE.distance.toFixed(1) + ' KM';
  document.getElementById('final-near-misses').innerText = STATE.nearMissCount;

  const savedHigh = parseInt(localStorage.getItem('overdrive_high_score') || '0', 10);
  if (STATE.score > savedHigh) {
    localStorage.setItem('overdrive_high_score', STATE.score.toString());
    document.getElementById('menu-high-score').innerText = STATE.score.toLocaleString() + ' PTS';
  }
}

// ==========================================
// 10. DYNAMIC CAMERA SYSTEM (EXACT MATCH ANGLE)
// ==========================================
function updateCamera() {
  if (STATE.photoMode) return;

  if (STATE.cameraMode === 0) {
    // Screenshot Elevated Chase Angle: High overview looking ahead down the bridge
    const targetCamX = playerCarGroup.position.x * 0.4;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 0.08);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 9.8 + (STATE.speed / CONFIG.MAX_SPEED) * 0.5, 0.08);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, playerCarGroup.position.z + 13.5 + (STATE.speed / CONFIG.MAX_SPEED) * 1.2, 0.08);
    camera.lookAt(playerCarGroup.position.x * 0.2, 1.0, playerCarGroup.position.z - 36);

    camera.fov = THREE.MathUtils.lerp(camera.fov, 54 + (STATE.speed / CONFIG.MAX_SPEED) * 10, 0.08);
    camera.updateProjectionMatrix();
  } else if (STATE.cameraMode === 1) {
    // Close Chase Cam
    const targetCamX = playerCarGroup.position.x * 0.7;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 0.1);
    camera.position.y = 3.6;
    camera.position.z = playerCarGroup.position.z + 7.5;
    camera.lookAt(playerCarGroup.position.x * 0.4, 1.2, playerCarGroup.position.z - 25);
    camera.fov = 65;
    camera.updateProjectionMatrix();
  } else if (STATE.cameraMode === 2) {
    // Cockpit Cam
    camera.position.set(playerCarGroup.position.x, 1.05, playerCarGroup.position.z + 0.2);
    camera.lookAt(playerCarGroup.position.x, 1.05, playerCarGroup.position.z - 40);
    camera.fov = 75;
    camera.updateProjectionMatrix();
  } else {
    // Bumper Cam
    camera.position.set(playerCarGroup.position.x, 0.4, playerCarGroup.position.z - 2.1);
    camera.lookAt(playerCarGroup.position.x, 0.4, playerCarGroup.position.z - 45);
    camera.fov = 85;
    camera.updateProjectionMatrix();
  }
}

// ==========================================
// 11. EVENT LISTENERS & UI WIRING
// ==========================================
function setupEventListeners() {
  window.addEventListener('keydown', (e) => {
    Audio.init();

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
      const modes = ['daylight', 'sunset', 'midnight', 'rain'];
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

  // Start Button
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
    btn.addEventListener('click', () => {
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
  STATE.speed = 45;
  STATE.multiplier = 1.0;
  STATE.nearMissCount = 0;
  STATE.nitro = 100;

  playerCarGroup.position.set(CONFIG.LANES[0], 0, 0);
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
  link.download = 'OVERDRIVE_Bridge_Screenshot.png';
  link.href = dataURL;
  link.click();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================
// 12. MAIN ANIMATION LOOP
// ==========================================
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (STATE.menu) {
    // Menu background smooth camera showcase
    const time = now * 0.0005;
    camera.position.set(Math.sin(time) * 11, 7, Math.cos(time) * 11 + 6);
    camera.lookAt(playerCarGroup.position.x, 1.2, 0);
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
