/**
 * OVERDRIVE 4K - Two-Way Highway Traffic Edition
 * Modeled directly after the iconic moody highway racer:
 * - 90s Black Street Tuner with dual chrome exhausts & amber/red taillights
 * - Two-way traffic: Oncoming cars (yellow hatchback, headlights) on left, forward traffic on right
 * - Glowing misty taillight halos & atmospheric red bloom in the distance
 * - Roadside telephone poles with crossbars, stormy overcast weather & rain/snow particles
 */

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const CONFIG = {
  // 4 Lanes:
  // Lane 0 (-5.4), Lane 1 (-1.8): ONCOMING TRAFFIC (driving towards player)
  // Lane 2 (+1.8), Lane 3 (+5.4): FORWARD TRAFFIC (same direction)
  LANES: [-5.4, -1.8, 1.8, 5.4],
  ROAD_WIDTH: 15,
  SEGMENT_LENGTH: 80,
  NUM_SEGMENTS: 14,
  MAX_SPEED: 180, // MPH
  ACCELERATION: 42,
  BRAKING: 70,
  FRICTION: 10,
  NITRO_ACCEL: 80,
  NITRO_MAX_SPEED: 220,
  STEER_SPEED: 13,
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
  
  carColor: 0x18191d, // Matte Black 90s Tuner (Exact screenshot match)
  envMode: 'overcast', // overcast/stormy (default), sunset, daylight, night
  cameraMode: 0, // 0: Tight Rear Chase (Screenshot angle), 1: Elevated, 2: Cockpit, 3: Bumper
  twoWayTraffic: true
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

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.setValueAtTime(500, this.ctx.currentTime);

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
      skidFilter.frequency.setValueAtTime(1300, this.ctx.currentTime);
      skidFilter.Q.setValueAtTime(3, this.ctx.currentTime);

      this.skidGain = this.ctx.createGain();
      this.skidGain.gain.setValueAtTime(0, this.ctx.currentTime);

      noiseSource.connect(skidFilter);
      skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.masterGain);
      noiseSource.start();

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
    const baseFreq = 38 + (rpm / 8000) * 155;
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
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.15);
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
// 3. THREE.JS SCENE SETUP & MOODY HIGHWAY
// ==========================================
let scene, camera, renderer, container;
let sunLight, ambientLight, skyMesh;
let roadSegments = [];
let trafficCars = [];
let weatherParticles;
let playerCarGroup, playerCarBodyMesh;
let shadowTexture, redGlowTexture, whiteGlowTexture;
let playerBrakeLights = [];

function init3D() {
  container = document.getElementById('game-container');
  
  scene = new THREE.Scene();
  // Moody dark mist fog (like screenshot)
  scene.fog = new THREE.FogExp2(0x283038, 0.0045);

  camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 800);
  
  // Signature low rear-view chase camera matching the screenshot
  camera.position.set(0, 3.4, 6.8);
  camera.lookAt(0, 1.1, -30);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Moody Overcast Lighting
  ambientLight = new THREE.AmbientLight(0x708090, 0.8);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xb0c4de, 1.2);
  sunLight.position.set(20, 60, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  scene.add(sunLight);

  shadowTexture = createContactShadowTexture();
  redGlowTexture = createGlowHaloTexture('#ff0022', 128);
  whiteGlowTexture = createGlowHaloTexture('#ffffff', 128);

  createSkyDome();
  buildRoadSegments();
  buildPlayerCar();
  createWeatherParticles();
  setEnvironment(STATE.envMode);

  window.addEventListener('resize', onWindowResize);
}

function createContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.4)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createGlowHaloTexture(colorStr, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size / 2;
  const grad = ctx.createRadialGradient(center, center, 2, center, center, center);
  grad.addColorStop(0, colorStr);
  grad.addColorStop(0.3, colorStr);
  grad.addColorStop(0.7, 'rgba(255, 30, 0, 0.2)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function createSkyDome() {
  const skyGeo = new THREE.SphereGeometry(600, 32, 24);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x222a32,
    side: THREE.BackSide
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);
}

// Weather Particle Snow / Rain Streaks
function createWeatherParticles() {
  const count = 1500;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);

  for (let i = 0; i < count * 3; i += 3) {
    pos[i] = (Math.random() - 0.5) * 50;
    pos[i + 1] = Math.random() * 25;
    pos[i + 2] = (Math.random() - 0.5) * 100;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xccddee,
    size: 0.2,
    transparent: true,
    opacity: 0.6
  });

  weatherParticles = new THREE.Points(geo, mat);
  scene.add(weatherParticles);
}

// ==========================================
// 4. ROADWAY & TELEPHONE UTILITY POLES
// ==========================================
function createHighwayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Dark wet asphalt base
  ctx.fillStyle = '#2b3036';
  ctx.fillRect(0, 0, 1024, 1024);

  // Noise & asphalt roughness
  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const v = Math.floor(Math.random() * 24) - 12;
    ctx.fillStyle = `rgb(${43 + v}, ${48 + v}, ${54 + v})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Heavy tire tracks
  ctx.fillStyle = 'rgba(20, 24, 28, 0.2)';
  const tireTracks = [120, 220, 360, 460, 620, 720, 860, 960];
  tireTracks.forEach(tx => {
    ctx.fillRect(tx - 20, 0, 40, 1024);
  });

  // Solid Center Divider Line
  ctx.fillStyle = '#dce1e6';
  ctx.fillRect(508, 0, 8, 1024);

  // Dashed White Lane Lines
  const dashedLanes = [256, 768];
  dashedLanes.forEach(lx => {
    for (let y = 0; y < 1024; y += 128) {
      ctx.fillRect(lx - 4, y + 20, 8, 70);
    }
  });

  // Solid Edge Lines
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(24, 0, 6, 1024);
  ctx.fillRect(994, 0, 6, 1024);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 2);
  return texture;
}

function buildRoadSegments() {
  const roadTex = createHighwayTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.45,
    metalness: 0.25
  });

  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0x5a636c,
    metalness: 0.7,
    roughness: 0.4
  });

  // Wooden / Concrete Utility Pole Materials
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3b32, roughness: 0.9 });
  const metalBracketMat = new THREE.MeshStandardMaterial({ color: 0x22252a, metalness: 0.8 });

  for (let i = 0; i < CONFIG.NUM_SEGMENTS; i++) {
    const segGroup = new THREE.Group();

    // 1. Asphalt Highway Surface
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.ROAD_WIDTH, CONFIG.SEGMENT_LENGTH), roadMat);
    deck.rotation.x = -Math.PI / 2;
    deck.receiveShadow = true;
    segGroup.add(deck);

    // 2. Continuous Steel Guardrails (Left & Right)
    const railGeo = new THREE.BoxGeometry(0.2, 0.45, CONFIG.SEGMENT_LENGTH);
    const leftRail = new THREE.Mesh(railGeo, barrierMat);
    leftRail.position.set(-CONFIG.ROAD_WIDTH / 2 - 0.2, 0.45, 0);
    leftRail.castShadow = true;

    const rightRail = new THREE.Mesh(railGeo, barrierMat);
    rightRail.position.set(CONFIG.ROAD_WIDTH / 2 + 0.2, 0.45, 0);
    rightRail.castShadow = true;
    segGroup.add(leftRail, rightRail);

    // Guardrail Support Posts
    const postGeo = new THREE.BoxGeometry(0.15, 0.8, 0.15);
    for (let z = -CONFIG.SEGMENT_LENGTH / 2; z <= CONFIG.SEGMENT_LENGTH / 2; z += 8) {
      const pL = new THREE.Mesh(postGeo, barrierMat);
      pL.position.set(-CONFIG.ROAD_WIDTH / 2 - 0.2, 0.3, z);
      const pR = new THREE.Mesh(postGeo, barrierMat);
      pR.position.set(CONFIG.ROAD_WIDTH / 2 + 0.2, 0.3, z);
      segGroup.add(pL, pR);
    }

    // 3. Wooden Telephone / Utility Poles with Crossarms (Matches screenshot!)
    for (let z = -CONFIG.SEGMENT_LENGTH / 2 + 20; z <= CONFIG.SEGMENT_LENGTH / 2; z += 40) {
      [-1, 1].forEach(side => {
        const poleGroup = new THREE.Group();
        const mainPole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 8.5, 8), poleMat);
        mainPole.position.y = 4.25;

        // Crossarms with electrical insulators
        const crossarm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.18), poleMat);
        crossarm.position.set(0, 7.6, 0);

        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), metalBracketMat);
        bracket.position.set(0, 7.3, 0);

        poleGroup.add(mainPole, crossarm, bracket);
        poleGroup.position.set(side * (CONFIG.ROAD_WIDTH / 2 + 2.5), 0, z);
        segGroup.add(poleGroup);
      });
    }

    // Roadside Terrain / Grass Shoulder
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x2e3830, roughness: 0.95 });
    const leftShoulder = new THREE.Mesh(new THREE.PlaneGeometry(60, CONFIG.SEGMENT_LENGTH), shoulderMat);
    leftShoulder.rotation.x = -Math.PI / 2;
    leftShoulder.position.set(-CONFIG.ROAD_WIDTH / 2 - 30, -0.05, 0);

    const rightShoulder = new THREE.Mesh(new THREE.PlaneGeometry(60, CONFIG.SEGMENT_LENGTH), shoulderMat);
    rightShoulder.rotation.x = -Math.PI / 2;
    rightShoulder.position.set(CONFIG.ROAD_WIDTH / 2 + 30, -0.05, 0);
    segGroup.add(leftShoulder, rightShoulder);

    segGroup.position.z = -i * CONFIG.SEGMENT_LENGTH;
    scene.add(segGroup);
    roadSegments.push(segGroup);
  }
}

// ==========================================
// 5. VEHICLE MESH BUILDERS (EXACT MATCH)
// ==========================================
function addContactShadow(parentGroup, width = 2.4, length = 4.8) {
  const shadowGeo = new THREE.PlaneGeometry(width, length);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0, 0.02, 0);
  parentGroup.add(shadowPlane);
}

// 1. Player 90s Black Street Tuner (Exact match with screenshot rear-view)
function buildPlayerCar() {
  playerCarGroup = new THREE.Group();

  const blackBodyMat = new THREE.MeshStandardMaterial({
    color: STATE.carColor, // Matte Black / Dark Charcoal
    metalness: 0.6,
    roughness: 0.4
  });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x182028,
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.88
  });

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.8 });

  // Main Boxy Lower Body
  const bodyGeo = new THREE.BoxGeometry(2.05, 0.52, 4.3);
  const body = new THREE.Mesh(bodyGeo, blackBodyMat);
  body.position.y = 0.45;
  body.castShadow = true;
  playerCarGroup.add(body);
  playerCarBodyMesh = body;

  // Rear Black Bumper with Horizontal Accent Strip
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.28, 0.2), trimMat);
  rearBumper.position.set(0, 0.32, 2.18);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: 0x555560 }));
  strip.position.set(0, 0.36, 2.29);
  playerCarGroup.add(rearBumper, strip);

  // Boxy Cabin with Wide Rear Window
  const cabinGeo = new THREE.BoxGeometry(1.7, 0.46, 2.3);
  const cabin = new THREE.Mesh(cabinGeo, blackBodyMat);
  cabin.position.set(0, 0.84, -0.1);
  cabin.castShadow = true;
  playerCarGroup.add(cabin);

  // Wide Sloped Rear Window
  const rearWin = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.65), glassMat);
  rearWin.position.set(0, 0.84, 1.1);
  rearWin.rotation.x = -Math.PI / 3.8;
  playerCarGroup.add(rearWin);

  // Front Windshield
  const frontWin = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.6), glassMat);
  frontWin.position.set(0, 0.84, -1.25);
  frontWin.rotation.x = Math.PI / 4;
  playerCarGroup.add(frontWin);

  // Side Mirrors
  const mirrorL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), trimMat);
  mirrorL.position.set(-1.08, 0.68, -0.7);
  const mirrorR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), trimMat);
  mirrorR.position.set(1.08, 0.68, -0.7);
  playerCarGroup.add(mirrorL, mirrorR);

  // 90s Dual-Section Taillights (Amber Indicator on top, Red Brake on bottom!)
  const amberMat = new THREE.MeshBasicMaterial({ color: 0xff8c00 });
  const redBrakeMat = new THREE.MeshBasicMaterial({ color: 0xff0022 });

  // Left Taillight (Amber Top + Red Bottom)
  const tLAmber = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), amberMat);
  tLAmber.position.set(-0.72, 0.58, 2.16);
  const tLRed = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.05), redBrakeMat);
  tLRed.position.set(-0.72, 0.46, 2.16);

  // Right Taillight (Amber Top + Red Bottom)
  const tRAmber = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), amberMat);
  tRAmber.position.set(0.72, 0.58, 2.16);
  const tRRed = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.05), redBrakeMat);
  tRRed.position.set(0.72, 0.46, 2.16);

  playerCarGroup.add(tLAmber, tLRed, tRAmber, tRRed);
  playerBrakeLights = [tLRed, tRRed];

  // Dual Chrome Exhaust Pipes at Lower Right (Exact match with screenshot!)
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.95, roughness: 0.1 });
  const exhaust1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 12), chromeMat);
  exhaust1.rotateX(Math.PI / 2);
  exhaust1.position.set(0.42, 0.18, 2.25);

  const exhaust2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 12), chromeMat);
  exhaust2.rotateX(Math.PI / 2);
  exhaust2.position.set(0.58, 0.18, 2.25);

  playerCarGroup.add(exhaust1, exhaust2);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x161619, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });

  playerCarGroup.wheels = [];
  [
    { x: -1.0, z: -1.2 }, { x: 1.0, z: -1.2 },
    { x: -1.0, z: 1.2 }, { x: 1.0, z: 1.2 }
  ].forEach(pos => {
    const wGroup = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 10), rimMat);
    rim.rotateZ(Math.PI / 2);
    wGroup.add(tire, rim);
    wGroup.position.set(pos.x, 0.36, pos.z);
    playerCarGroup.add(wGroup);
    playerCarGroup.wheels.push(wGroup);
  });

  // Nitro Flames
  const nitroMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0 });
  const flameGeo = new THREE.ConeGeometry(0.1, 0.6, 8);
  flameGeo.rotateX(Math.PI / 2);
  const fL = new THREE.Mesh(flameGeo, nitroMat);
  fL.position.set(0.42, 0.18, 2.5);
  const fR = new THREE.Mesh(flameGeo, nitroMat);
  fR.position.set(0.58, 0.18, 2.5);
  playerCarGroup.add(fL, fR);
  playerCarGroup.nitroFlames = [fL, fR];

  addContactShadow(playerCarGroup, 2.4, 4.6);

  // Position Player in Lane 2 (Right lane behind yellow car & red traffic)
  playerCarGroup.position.set(CONFIG.LANES[2], 0, 0);
  scene.add(playerCarGroup);
}

// 2. Yellow Compact Hatchback / Sedan (Matches oncoming yellow car in screenshot!)
function buildYellowCarMesh() {
  const car = new THREE.Group();
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.6, roughness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x182028, roughness: 0.2 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.48, 3.8), yellowMat);
  body.position.y = 0.44;
  body.castShadow = true;

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 2.0), glassMat);
  cabin.position.set(0, 0.82, -0.1);
  cabin.castShadow = true;

  // Oncoming Headlights (Bright White projector beams & lens glow)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.05), headMat);
  headL.position.set(-0.65, 0.48, 1.91); // Facing towards player when driving oncoming
  const headR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.05), headMat);
  headR.position.set(0.65, 0.48, 1.91);
  car.add(headL, headR);

  // Headlight Volumetric Sprite Glow
  const glowSpriteMat = new THREE.SpriteMaterial({ map: whiteGlowTexture, color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
  const glowL = new THREE.Sprite(glowSpriteMat);
  glowL.scale.set(3.2, 3.2, 1);
  glowL.position.set(-0.65, 0.48, 2.1);
  const glowR = new THREE.Sprite(glowSpriteMat);
  glowR.scale.set(3.2, 3.2, 1);
  glowR.position.set(0.65, 0.48, 2.1);
  car.add(glowL, glowR);

  addContactShadow(car, 2.3, 4.2);
  car.add(body, cabin);
  car.length = 4.0;
  return car;
}

// 3. Red Forward Traffic / Semi-Trucks with Glowing Red Fog Halos (Matches distant red lights!)
function buildRedTrafficVehicle(isTruck = false) {
  const car = new THREE.Group();
  const redMat = new THREE.MeshStandardMaterial({ color: isTruck ? 0xb91c1c : 0xdc2626, metalness: 0.7, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6 });

  if (isTruck) {
    // Red / White Box Truck
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 5.8), redMat);
    box.position.set(0, 1.8, -0.5);
    box.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.0, 2.2), darkMat);
    cab.position.set(0, 1.3, -4.2);
    car.add(box, cab);
    car.length = 7.5;
  } else {
    // Red Sedan / Hatchback
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.5, 4.1), redMat);
    body.position.y = 0.45;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.46, 2.2), darkMat);
    cabin.position.set(0, 0.85, -0.1);
    car.add(body, cabin);
    car.length = 4.3;
  }

  // Brilliant Glowing Red Taillights with Fog Halo (Matches the red glow in screenshot!)
  const tailGlowMat = new THREE.SpriteMaterial({
    map: redGlowTexture,
    color: 0xff0022,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending
  });

  const glowL = new THREE.Sprite(tailGlowMat);
  glowL.scale.set(4.5, 4.5, 1);
  glowL.position.set(-0.7, 0.6, 2.3);

  const glowR = new THREE.Sprite(tailGlowMat);
  glowR.scale.set(4.5, 4.5, 1);
  glowR.position.set(0.7, 0.6, 2.3);

  car.add(glowL, glowR);
  addContactShadow(car, 2.5, car.length);
  return car;
}

// ==========================================
// 6. TWO-WAY TRAFFIC FLEET CONTROLLER
// ==========================================
function createAITrafficCar(zPos, forcedType = null, forcedLane = null) {
  const laneIndex = forcedLane !== null ? forcedLane : Math.floor(Math.random() * CONFIG.LANES.length);
  const isOncoming = laneIndex < 2; // Lanes 0 & 1 are oncoming traffic!

  let carGroup;
  if (isOncoming) {
    carGroup = buildYellowCarMesh();
    carGroup.isOncoming = true;
    carGroup.speed = 55 + Math.random() * 25; // Driving towards player
  } else {
    const isTruck = forcedType === 'truck' || (forcedType === null && Math.random() > 0.65);
    carGroup = buildRedTrafficVehicle(isTruck);
    carGroup.isOncoming = false;
    carGroup.speed = 45 + Math.random() * 35; // Cruising forward
  }

  carGroup.position.set(CONFIG.LANES[laneIndex], 0, zPos);
  carGroup.lane = laneIndex;
  carGroup.scoredNearMiss = false;

  scene.add(carGroup);
  trafficCars.push(carGroup);
}

function spawnTrafficFleet() {
  trafficCars.forEach(c => scene.remove(c));
  trafficCars = [];

  // Match the screenshot exact composition:
  // 1. Oncoming Yellow Car in Lane 1 (ahead at z = -32)
  createAITrafficCar(-32, null, 1);

  // 2. Glowing Red Truck / Car in Lane 2 ahead at z = -58 (produces the glowing red halo!)
  createAITrafficCar(-58, 'truck', 2);

  // 3. Red Car in Lane 3 ahead at z = -72
  createAITrafficCar(-72, 'sedan', 3);

  // 4. Oncoming car in Lane 0 far at z = -95
  createAITrafficCar(-95, null, 0);

  // 5. Far Red traffic cluster
  createAITrafficCar(-120, 'truck', 2);
  createAITrafficCar(-145, 'sedan', 3);
  createAITrafficCar(-170, null, 1);
}

// ==========================================
// 7. ENVIRONMENT PRESETS
// ==========================================
function setEnvironment(env) {
  STATE.envMode = env;

  if (env === 'overcast') {
    // Moody stormy overcast (Exact screenshot match!)
    scene.fog.color.setHex(0x283038);
    renderer.setClearColor(0x283038);
    if (skyMesh) skyMesh.material.color.setHex(0x20262d);
    ambientLight.color.setHex(0x708090);
    ambientLight.intensity = 0.8;
    sunLight.color.setHex(0xb0c4de);
    sunLight.intensity = 1.2;
    if (weatherParticles) weatherParticles.material.opacity = 0.7;
  } else if (env === 'sunset') {
    scene.fog.color.setHex(0x883322);
    renderer.setClearColor(0x883322);
    if (skyMesh) skyMesh.material.color.setHex(0x662211);
    ambientLight.color.setHex(0xffaa77);
    ambientLight.intensity = 0.7;
    sunLight.color.setHex(0xff7733);
    sunLight.intensity = 2.0;
  } else if (env === 'midnight') {
    scene.fog.color.setHex(0x050810);
    renderer.setClearColor(0x050810);
    if (skyMesh) skyMesh.material.color.setHex(0x030508);
    ambientLight.color.setHex(0x223344);
    ambientLight.intensity = 0.4;
    sunLight.color.setHex(0x224488);
    sunLight.intensity = 0.5;
  } else {
    // Daylight
    scene.fog.color.setHex(0x8da4b8);
    renderer.setClearColor(0x8da4b8);
    if (skyMesh) skyMesh.material.color.setHex(0x7c94a8);
    ambientLight.color.setHex(0xfff5ea);
    ambientLight.intensity = 0.9;
    sunLight.color.setHex(0xffffff);
    sunLight.intensity = 1.8;
  }
}

// ==========================================
// 8. RADAR MINIMAP
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

  // Radar rings
  minimapCtx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
  minimapCtx.lineWidth = 1;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 30, 0, Math.PI * 2);
  minimapCtx.arc(cx, cy, 60, 0, Math.PI * 2);
  minimapCtx.stroke();

  // Highway boundary
  minimapCtx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
  minimapCtx.strokeRect(cx - 26, 8, 52, h - 16);

  // Center line divider
  minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  minimapCtx.beginPath();
  minimapCtx.moveTo(cx, 8);
  minimapCtx.lineTo(cx, h - 8);
  minimapCtx.stroke();

  // Traffic Blips (Yellow for oncoming on left, Red for forward on right)
  trafficCars.forEach(car => {
    const relZ = car.position.z - playerCarGroup.position.z;
    const relX = car.position.x;
    if (Math.abs(relZ) < 110) {
      const px = cx + (relX / CONFIG.ROAD_WIDTH) * 52;
      const py = cy + (relZ / 110) * 60;

      minimapCtx.fillStyle = car.isOncoming ? '#fbbf24' : '#ff2a55';
      minimapCtx.beginPath();
      minimapCtx.arc(px, py, car.length > 6 ? 4.5 : 3.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  });

  // Player Blip (Cyan)
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
// 9. GAMEPLAY PHYSICS & TWO-WAY SIMULATION
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

  // Dynamic brake light glow on player car
  const isBraking = KEYS.backward || STATE.speed < 5;
  playerBrakeLights.forEach(light => {
    light.material.color.setHex(isBraking ? 0xff0022 : 0xaa0015);
  });

  // Nitro
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
    carRoll = THREE.MathUtils.lerp(carRoll, -0.07, 0.15);
  } else if (KEYS.right) {
    steerAngle = Math.min(CONFIG.MAX_STEER_ANGLE, steerAngle + CONFIG.STEER_SPEED * steerMult * delta);
    playerCarGroup.position.x += (STATE.speed * 0.11 * steerMult + 4.5) * delta;
    carRoll = THREE.MathUtils.lerp(carRoll, 0.07, 0.15);
  } else {
    steerAngle = THREE.MathUtils.lerp(steerAngle, 0, 0.15);
    carRoll = THREE.MathUtils.lerp(carRoll, 0, 0.1);
  }

  // Clamp road boundary
  const boundary = CONFIG.ROAD_WIDTH / 2 - 1.2;
  if (playerCarGroup.position.x < -boundary) {
    playerCarGroup.position.x = -boundary;
    STATE.speed *= 0.96;
  } else if (playerCarGroup.position.x > boundary) {
    playerCarGroup.position.x = boundary;
    STATE.speed *= 0.96;
  }

  playerCarGroup.rotation.y = -steerAngle * 0.5;
  playerCarGroup.rotation.z = -carRoll;

  // Spin wheels
  const wheelSpinSpeed = (STATE.speed / 10) * delta * 20;
  playerCarGroup.wheels.forEach((w, i) => {
    w.rotation.x -= wheelSpinSpeed;
    if (i < 2) w.rotation.y = -steerAngle;
  });

  // Gears & RPM
  const gearRatios = [0, 35, 70, 110, 150, 185, 220];
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

  // Oncoming lane score multiplier bonus! (Driving in left lane is risky = 2x score)
  const inOncomingLane = playerCarGroup.position.x < 0;
  const laneBonus = inOncomingLane && STATE.speed > 60 ? 1.8 : 1.0;
  STATE.score += Math.floor(STATE.speed * STATE.multiplier * laneBonus * delta * 5);

  if (STATE.speed > STATE.topSpeed) STATE.topSpeed = Math.floor(STATE.speed);

  // Speed lines
  const speedLinesEl = document.getElementById('speed-lines');
  if (speedLinesEl) {
    speedLinesEl.style.opacity = STATE.speed > 120 ? (STATE.speed - 120) / 100 : 0;
  }

  // 3. Move Highway Segments
  const roadScrollSpeed = (STATE.speed * 0.44704) * delta * 2.8;
  roadSegments.forEach(seg => {
    seg.position.z += roadScrollSpeed;
    if (seg.position.z > CONFIG.SEGMENT_LENGTH) {
      seg.position.z -= CONFIG.NUM_SEGMENTS * CONFIG.SEGMENT_LENGTH;
    }
  });

  // 4. Update Two-Way AI Traffic
  trafficCars.forEach(car => {
    let relSpeed;
    if (car.isOncoming) {
      // Oncoming traffic comes TOWARDS player with combined speed!
      relSpeed = (STATE.speed + car.speed) * 0.44704 * delta * 2.8;
    } else {
      // Forward traffic moves away
      relSpeed = (STATE.speed - car.speed) * 0.44704 * delta * 2.8;
    }
    car.position.z += relSpeed;

    // Traffic respawn
    if (car.position.z > 35) {
      car.position.z = -CONFIG.NUM_SEGMENTS * 26 - Math.random() * 40;
      // Respawn in valid lane according to direction
      const availableLanes = car.isOncoming ? [0, 1] : [2, 3];
      const newLane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
      car.position.x = CONFIG.LANES[newLane];
      car.scoredNearMiss = false;
    } else if (car.position.z < -CONFIG.NUM_SEGMENTS * 38) {
      car.position.z = 25;
    }

    // Collision & Near Miss
    const dx = Math.abs(car.position.x - playerCarGroup.position.x);
    const dz = Math.abs(car.position.z - playerCarGroup.position.z);

    if (dx < 1.85 && dz < (car.length / 2 + 1.8)) {
      triggerCrash();
    } else if (dx < 2.7 && dz < 3.0 && !car.scoredNearMiss && STATE.speed > 65) {
      triggerNearMiss(car.isOncoming);
      car.scoredNearMiss = true;
    }
  });

  // Weather particles animation
  if (weatherParticles) {
    const pos = weatherParticles.geometry.attributes.position.array;
    for (let i = 1; i < pos.length; i += 3) {
      pos[i] -= 25 * delta;
      pos[i + 1] += (STATE.speed * 0.4) * delta; // Rush towards windshield with speed
      if (pos[i] < 0) pos[i] = 25;
    }
    weatherParticles.geometry.attributes.position.needsUpdate = true;
  }

  // Audio update
  Audio.update(STATE.speed, STATE.rpm, STATE.isDrifting, STATE.isNitro);

  // HUD
  updateHUD(inOncomingLane);
}

function updateHUD(inOncomingLane) {
  document.getElementById('speed-display').innerText = Math.floor(STATE.speed);
  document.getElementById('score-display').innerText = STATE.score.toLocaleString();
  document.getElementById('distance-display').innerText = STATE.distance.toFixed(1) + " KM";
  document.getElementById('multiplier-display').innerText = STATE.multiplier.toFixed(1) + "x" + (inOncomingLane ? " [ONCOMING 2X]" : "");
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

function triggerNearMiss(isOncoming) {
  STATE.nearMissCount++;
  const bonusMult = isOncoming ? 1.0 : 0.5;
  STATE.multiplier = Math.min(6.0, STATE.multiplier + bonusMult);
  const addScore = Math.floor(600 * STATE.multiplier * (isOncoming ? 1.5 : 1.0));
  STATE.score += addScore;

  Audio.playNearMiss();

  const banner = document.getElementById('combo-banner');
  const text = document.getElementById('combo-text');
  text.innerText = isOncoming ? `ONCOMING MISS +${addScore} (x${STATE.multiplier.toFixed(1)})` : `NEAR MISS +${addScore} (x${STATE.multiplier.toFixed(1)})`;
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
// 10. EXACT REAR CHASE CAMERA ANGLE
// ==========================================
function updateCamera() {
  if (STATE.photoMode) return;

  if (STATE.cameraMode === 0) {
    // Exact match with screenshot: Tight low rear chase behind the black car
    const targetCamX = playerCarGroup.position.x * 0.75;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 0.12);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 2.9 + (STATE.speed / CONFIG.MAX_SPEED) * 0.3, 0.1);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, playerCarGroup.position.z + 6.2 + (STATE.speed / CONFIG.MAX_SPEED) * 0.9, 0.1);
    camera.lookAt(playerCarGroup.position.x * 0.5, 1.2, playerCarGroup.position.z - 35);

    camera.fov = THREE.MathUtils.lerp(camera.fov, 56 + (STATE.speed / CONFIG.MAX_SPEED) * 12, 0.08);
    camera.updateProjectionMatrix();
  } else if (STATE.cameraMode === 1) {
    // Elevated Bridge Cam
    camera.position.set(playerCarGroup.position.x * 0.4, 8.5, playerCarGroup.position.z + 12);
    camera.lookAt(playerCarGroup.position.x * 0.2, 1.0, playerCarGroup.position.z - 36);
    camera.fov = 58;
    camera.updateProjectionMatrix();
  } else if (STATE.cameraMode === 2) {
    // Hood / Cockpit
    camera.position.set(playerCarGroup.position.x, 1.05, playerCarGroup.position.z + 0.2);
    camera.lookAt(playerCarGroup.position.x, 1.05, playerCarGroup.position.z - 40);
    camera.fov = 75;
    camera.updateProjectionMatrix();
  } else {
    // Low Bumper
    camera.position.set(playerCarGroup.position.x, 0.4, playerCarGroup.position.z - 2.1);
    camera.lookAt(playerCarGroup.position.x, 0.4, playerCarGroup.position.z - 45);
    camera.fov = 85;
    camera.updateProjectionMatrix();
  }
}

// ==========================================
// 11. EVENT LISTENERS & UI
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
      const modes = ['overcast', 'sunset', 'midnight', 'daylight'];
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

  document.getElementById('start-btn').addEventListener('click', () => {
    Audio.init();
    startGame();
  });

  document.getElementById('retry-btn').addEventListener('click', () => {
    startGame();
  });

  document.getElementById('main-menu-btn').addEventListener('click', () => {
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
    STATE.menu = true;
    STATE.playing = false;
  });

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

  document.querySelectorAll('.env-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.env-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setEnvironment(btn.dataset.env);
    });
  });

  const wpModal = document.getElementById('wallpaper-modal');
  document.getElementById('view-screenshot-btn').addEventListener('click', () => {
    wpModal.classList.remove('hidden');
  });
  document.getElementById('close-wallpaper-btn').addEventListener('click', () => {
    wpModal.classList.add('hidden');
  });

  document.getElementById('close-photo-btn').addEventListener('click', togglePhotoMode);
  document.getElementById('take-snapshot-btn').addEventListener('click', take4KSnapshot);
}

function startGame() {
  STATE.menu = false;
  STATE.playing = true;
  STATE.crashed = false;
  STATE.score = 0;
  STATE.distance = 0;
  STATE.speed = 50;
  STATE.multiplier = 1.0;
  STATE.nearMissCount = 0;
  STATE.nitro = 100;

  playerCarGroup.position.set(CONFIG.LANES[2], 0, 0); // Start in right lane
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
  link.download = 'OVERDRIVE_TwoWay_Screenshot.png';
  link.href = dataURL;
  link.click();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================
// 12. ANIMATION LOOP
// ==========================================
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (STATE.menu) {
    const time = now * 0.0005;
    camera.position.set(Math.sin(time) * 8, 3.2, Math.cos(time) * 8 + 4);
    camera.lookAt(playerCarGroup.position.x, 0.9, 0);
  } else {
    updatePhysics(delta);
    updateCamera();
    renderRadar();
  }

  renderer.render(scene, camera);
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  const savedHigh = localStorage.getItem('overdrive_high_score') || '0';
  document.getElementById('menu-high-score').innerText = parseInt(savedHigh).toLocaleString() + ' PTS';

  init3D();
  setupEventListeners();
  animate();
});
