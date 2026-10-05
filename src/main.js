import * as THREE from 'three';
import './style.css';

(() => {
'use strict';
const root = document.documentElement;

// ---------------------------------------------------------------------------
// Ponteiro: a mão do portfólio (cursor/repouso, hover, clique), com contorno
// claro. Ela é pintada no canvas da interface, então passa pelo pontilhado.
// ---------------------------------------------------------------------------
const BASE = import.meta.env.BASE_URL;
const CUR = { repouso: `${BASE}cursor/repouso.png`, hover: `${BASE}cursor/hover.png`, clique: `${BASE}cursor/clique.png` };
const HOT = { repouso: [5, 6], hover: [8, 3], clique: [7, 12] };
const hands = {};
let aimState = 'repouso', uiDirty = true;
for (const k of Object.keys(HOT)) { const im = new Image(); im.onload = () => { uiDirty = true; }; im.src = CUR[k]; hands[k] = im; }
function setAim(s) { if (s !== aimState) { aimState = s; uiDirty = true; } }

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;

// ---------------------------------------------------------------------------
// Ruído e relevo. Tudo determinístico (hash inteiro), então física e malha
// leem exatamente o mesmo chão.
// ---------------------------------------------------------------------------
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function hash2(ix, iz) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm3(x, z) {
  return (vnoise(x, z) * 0.5 + vnoise(x * 2.03 + 17.3, z * 2.03 - 9.1) * 0.25 + vnoise(x * 4.1 + 34.6, z * 4.1 - 18.2) * 0.125) / 0.875;
}
function fbm4(x, z) {
  return (vnoise(x, z) * 0.5 + vnoise(x * 2.03 + 17.3, z * 2.03 - 9.1) * 0.25 + vnoise(x * 4.1 + 34.6, z * 4.1 - 18.2) * 0.125 + vnoise(x * 8.3 + 51.9, z * 8.3 - 27.3) * 0.0625) / 0.9375;
}
function height(x, z) {
  const wx = x + (fbm3(x * 0.0021, z * 0.0021) - 0.5) * 170;
  const wz = z + (fbm3(x * 0.0021 + 31.7, z * 0.0021 - 12.3) - 0.5) * 170;
  const big = (fbm4(wx * 0.0009, wz * 0.0009) - 0.5) * 380;
  const ang = vnoise(x * 0.0006 + 7.1, z * 0.0006 - 3.3) * 6.2832;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const dx = wx * ca - wz * sa, dz = wx * sa + wz * ca;
  const a = vnoise(dx * 0.008, dz * 0.0022) * 2 - 1;
  const r = 1 - Math.sqrt(a * a + 0.006);
  const dunes = r * r * 66;
  const rm = smooth(0.52, 0.72, vnoise(x * 0.0011 + 50.5, z * 0.0011 + 50.5));
  const rp = Math.sin(wx * 0.017 + Math.sin(wz * 0.008) * 2.6) * 0.5 + 0.5;
  const detail = (vnoise(wx * 0.035, wz * 0.035) - 0.5) * 3.2;
  return big + dunes * (1 - rm * 0.75) + rp * rp * 40 * rm + detail;
}
function normalAt(x, z, out) {
  const e = 0.9;
  const hx = height(x + e, z) - height(x - e, z);
  const hz = height(x, z + e) - height(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}
// O que o shader do relevo faz de longe: respira e curva. Repetido aqui para
// os olhos e aros distantes acompanharem o chão.
function farOffset(x, z, t, px, pz) {
  const d = Math.hypot(x - px, z - pz);
  const far = smooth(220, 620, d);
  const b = Math.sin(x * 0.007 + t * 0.25) * Math.cos(z * 0.006 - t * 0.19) * 30 + Math.sin((x + z) * 0.004 + t * 0.13) * 20;
  const c = Math.max(d - 100, 0);
  return b * far - c * c * 0.00008;
}
// Clima: dois campos lentos, temperatura e umidade, que escolhem o bioma como
// na Terra (deserto, savana, floresta, estepe, taiga, tundra, neve). O shader
// do relevo repete as mesmas contas.
function climateAt(x, z, t) {
  const T = 0.5 + 0.5 * Math.sin(x * 0.0012 + Math.sin(z * 0.0009) * 2.1 + t * 0.004);
  const M = 0.5 + 0.5 * Math.sin(z * 0.0011 + Math.sin(x * 0.0008 + 1.7) * 2.4 - t * 0.003);
  return [T, M];
}

// ---------------------------------------------------------------------------
// Render: cena em baixa resolução, depois o retículo de Bayer por cima.
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('status').textContent = 'Este navegador não abriu o WebGL. Tente outro navegador ou ative a aceleração de hardware.';
  document.getElementById('start').disabled = true;
  return;
}
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 380, 900);
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 5000);

// Porte direto de src/lib/dither.ts: matriz de Bayer 4x4, luminância Rec. 601,
// cor original acima do limiar e preto abaixo, com viés e fase animada.
// A interface é um segundo canvas que entra aqui antes do retículo: a cor dela
// passa pelo mesmo limiar, e a transparência também vira pontilhado (um painel
// a 80% deixa o mundo aparecer em 20% dos pontos da matriz).
const ui = document.createElement('canvas');
const g2 = ui.getContext('2d');
const uiTex = new THREE.CanvasTexture(ui);
uiTex.minFilter = uiTex.magFilter = THREE.NearestFilter; uiTex.generateMipmaps = false;
const postMat = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null }, tUI: { value: uiTex }, uRes: { value: new THREE.Vector2(1, 1) },
    uScreen: { value: new THREE.Vector2(1, 1) }, uCell: { value: 1 },
    uPhase: { value: new THREE.Vector2(0, 0) }, uBias: { value: 4 }, uOn: { value: 1 },
    uSpread: { value: 0.5 }, uShade: { value: 0.62 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tScene; uniform sampler2D tUI; uniform vec2 uRes; uniform vec2 uScreen; uniform float uCell;
    uniform vec2 uPhase; uniform float uBias; uniform float uOn; uniform float uSpread; uniform float uShade;
    varying vec2 vUv;
    float bayer4(vec2 p){
      vec4 r = p.y < 0.5 ? vec4(0.,8.,2.,10.) : (p.y < 1.5 ? vec4(12.,4.,14.,6.) : (p.y < 2.5 ? vec4(3.,11.,1.,9.) : vec4(15.,7.,13.,5.)));
      return p.x < 0.5 ? r.x : (p.x < 1.5 ? r.y : (p.x < 2.5 ? r.z : r.w));
    }
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)) * 255.0; }
    void main(){
      vec3 c = texture2D(tScene, vUv).rgb;
      // Retículo no pixel da tela (não no da cena) e suave: abaixo do limiar a
      // cor só escurece, em vez de virar preto, e o limiar cobre só os tons baixos.
      float bs = bayer4(mod(floor(gl_FragCoord.xy) + uPhase, 4.0));
      vec3 sd = lum(c) < bs * (255.0 / 16.0) * uSpread + uBias ? c * uShade : c;
      vec4 u = texture2D(tUI, vUv);
      float bu = bayer4(mod(floor(vUv * uScreen / uCell) + uPhase, 4.0));
      vec3 ud = lum(u.rgb) < bu * (255.0 / 16.0) + uBias ? vec3(0.0) : u.rgb;
      float ua = u.a * 16.0 > bu + 0.5 ? 1.0 : 0.0;
      vec3 dithered = mix(sd, ud, ua);
      vec3 plain = mix(c, u.rgb, u.a);
      gl_FragColor = vec4(uOn > 0.5 ? dithered : plain, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
const PHASES = [[0, 0], [2, 0], [2, 2], [0, 2]];
let phaseIndex = 0, phaseClock = 0;

let W = 1, H = 1, rt = null;
function resize() {
  W = innerWidth; H = innerHeight;
  const px = W > 1600 ? 2 : 1;
  renderer.setSize(W, H, false);
  const rw = Math.max(1, Math.floor(W / px)), rh = Math.max(1, Math.floor(H / px));
  if (rt) rt.dispose();
  rt = new THREE.WebGLRenderTarget(rw, rh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  postMat.uniforms.tScene.value = rt.texture;
  postMat.uniforms.uRes.value.set(rw, rh);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  ui.width = W; ui.height = H;
  postMat.uniforms.uScreen.value.set(W, H);
  uiDirty = true;
}
addEventListener('resize', resize);
resize();

// Luz e materiais em degraus (toon), para as superfícies lerem como massa.
const gradTex = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true;
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradTex });
const hemi = new THREE.HemisphereLight(0xe4ecf2, 0x8c7a62, 0.62);
const sunLight = new THREE.DirectionalLight(0xffffff, 0.75);
scene.add(hemi, sunLight, sunLight.target);
const sunDir = new THREE.Vector3(0.5, 0.6, -0.4).normalize();

// ---------------------------------------------------------------------------
// Céu
// ---------------------------------------------------------------------------
const skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: sunDir }, uTime: { value: 0 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform float uTime;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float y = d.y;
      vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.55, y));
      float ang = atan(d.z, d.x);
      float sw = sin(ang * 9.0 + y * 14.0 - uTime * 0.15) * 0.5 + 0.5;
      col = mix(col, col * vec3(1.05, 1.0, 0.96), sw * smoothstep(0.05, 0.5, y) * 0.35);
      vec3 s = normalize(uSun);
      float sd = dot(d, s);
      float a = acos(clamp(sd, -1.0, 1.0));
      float disc = 1.0 - smoothstep(0.075, 0.08, a);
      float rings = step(0.55, fract(a * 22.0 - uTime * 0.25)) * (1.0 - smoothstep(0.08, 0.34, a)) * step(0.08, a);
      col += vec3(1.0, 0.9, 0.75) * pow(max(sd, 0.0), 10.0) * 0.25;
      col = mix(col, vec3(1.0, 0.96, 0.88), rings * 0.18);
      col = mix(col, vec3(1.0, 0.98, 0.92), disc);
      vec3 pd = normalize(vec3(-0.55, 0.3, -0.78));
      float pa = acos(clamp(dot(d, pd), -1.0, 1.0));
      float st = sin((d.y - pd.y) * 85.0 + sin(d.x * 38.0) * 2.2 + uTime * 0.08);
      // Um gigante gasoso em faixas de ocre e creme, lavado pela atmosfera.
      vec3 pc = mix(vec3(0.62, 0.49, 0.37), vec3(0.88, 0.83, 0.74), st * 0.5 + 0.5);
      float lit = clamp(dot(normalize(d - pd * 0.98), s) * 3.0 + 0.85, 0.72, 1.0);
      col = mix(col, mix(pc * lit, uHor, 0.3), 1.0 - smoothstep(0.17, 0.175, pa));
      float ringBand = abs((d.y - pd.y) + (d.x - pd.x) * 0.35);
      float pr = (1.0 - smoothstep(0.006, 0.012, ringBand)) * smoothstep(0.17, 0.18, pa) * (1.0 - smoothstep(0.3, 0.32, pa));
      col = mix(col, mix(vec3(0.86, 0.82, 0.74), uHor, 0.3), pr);
      col = mix(col, uHor, smoothstep(0.02, -0.12, y));
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
sky.renderOrder = -10;
scene.add(sky);

// ---------------------------------------------------------------------------
// Relevo: grade que acompanha o jogador, refeita aos poucos (algumas linhas
// por quadro) num segundo buffer e trocada quando fica pronta.
// ---------------------------------------------------------------------------
const N = 161, CELL = 9, HALF = (N - 1) * CELL / 2, SNAP = CELL * 8;
const terrU = { uFogNear: { value: 360 }, uFogFar: { value: 880 }, uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uSun: { value: sunDir }, uFog: { value: new THREE.Color() }, uCam: { value: new THREE.Vector3() } };
const terrMat = new THREE.ShaderMaterial({
  uniforms: terrU,
  vertexShader: `
    uniform float uTime; uniform vec3 uPlayer;
    varying vec3 vWorld; varying vec3 vN;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      float d = length(w.xz - uPlayer.xz);
      float far = smoothstep(220.0, 620.0, d);
      float b = sin(w.x * 0.007 + uTime * 0.25) * cos(w.z * 0.006 - uTime * 0.19) * 30.0 + sin((w.x + w.z) * 0.004 + uTime * 0.13) * 20.0;
      float c = max(d - 100.0, 0.0);
      w.y += b * far - c * c * 0.00008;
      vWorld = w.xyz; vN = normal;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform float uTime; uniform vec3 uSun; uniform vec3 uFog; uniform vec3 uCam; uniform float uFogNear; uniform float uFogFar;
    varying vec3 vWorld; varying vec3 vN;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + 1.0), f.x), f.y);
    }
    // seco -> médio -> úmido, com faixas de transição curtas para os biomas lerem
    vec3 tri(vec3 a, vec3 b, vec3 c, float x){ return mix(mix(a, b, smoothstep(0.3, 0.44, x)), c, smoothstep(0.56, 0.7, x)); }
    void main(){
      vec3 n = normalize(vN);
      float h = vWorld.y;
      vec2 xz = vWorld.xz;
      float T = 0.5 + 0.5 * sin(xz.x * 0.0012 + sin(xz.y * 0.0009) * 2.1 + uTime * 0.004);
      float M = 0.5 + 0.5 * sin(xz.y * 0.0011 + sin(xz.x * 0.0008 + 1.7) * 2.4 - uTime * 0.003);
      float patchN = vn(xz * 0.013), grain = vn(xz * 0.09);
      T = clamp(T - h * 0.0011 + (patchN - 0.5) * 0.08, 0.0, 1.0);
      M = clamp(M + (patchN - 0.5) * 0.1, 0.0, 1.0);
      // Paleta da Terra. Linhas: frio, temperado, quente. Colunas: seco, médio, úmido.
      vec3 cold = tri(vec3(0.56, 0.53, 0.45), vec3(0.23, 0.30, 0.21), vec3(0.86, 0.89, 0.92), M); // tundra, taiga, neve
      vec3 temp = tri(vec3(0.66, 0.62, 0.43), vec3(0.42, 0.50, 0.26), vec3(0.22, 0.35, 0.17), M); // estepe, campo, floresta
      vec3 hot  = tri(vec3(0.86, 0.72, 0.50), vec3(0.74, 0.62, 0.36), vec3(0.15, 0.31, 0.13), M); // deserto, savana, mata
      vec3 base = mix(mix(cold, temp, smoothstep(0.28, 0.42, T)), hot, smoothstep(0.58, 0.72, T));
      // Manchas: tufos de vegetação ou de areia mais escura, e um grão fino.
      float veg = smoothstep(0.35, 0.75, M) * (1.0 - smoothstep(0.75, 0.9, M) * (1.0 - smoothstep(0.42, 0.28, T)));
      base *= 1.0 - smoothstep(0.55, 0.8, vn(xz * 0.05 + 7.0)) * 0.22 * veg;
      base *= 0.94 + grain * 0.12;
      // Encostas viram rocha: granito no frio, rocha parda no temperado, arenito no quente.
      vec3 rock = mix(mix(vec3(0.46, 0.47, 0.48), vec3(0.47, 0.41, 0.34), smoothstep(0.28, 0.42, T)), vec3(0.68, 0.38, 0.24), smoothstep(0.58, 0.72, T));
      rock *= 0.9 + 0.1 * sin(h * 0.55 + grain * 1.5);
      float steep = 1.0 - n.y + (grain - 0.5) * 0.08;
      base = mix(base, rock, smoothstep(0.26, 0.42, steep));
      // Neve nos picos: a linha sobe com o calor e só assenta onde é plano.
      float snowline = mix(60.0, 330.0, T);
      float snow = smoothstep(snowline, snowline + 35.0, h + (patchN - 0.5) * 40.0) * (1.0 - smoothstep(0.35, 0.55, steep));
      base = mix(base, vec3(0.92, 0.94, 0.96), snow);
      // Curvas de nível que descem devagar: o toque estranho, sem roubar a cor.
      float band = fract(h * 0.045 - uTime * 0.05);
      float line = smoothstep(0.0, 0.03, band) * (1.0 - smoothstep(0.07, 0.1, band));
      float l = dot(n, normalize(uSun));
      float tl = l > 0.45 ? 1.0 : (l > 0.1 ? 0.84 : 0.66);
      vec3 col = base * tl * 1.08;
      col = mix(col, col * 0.72, line * 0.4);
      float dist = length(vWorld - uCam);
      col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
});
function makeTerrain() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (j * N + i) * 3; pos[k] = i * CELL - HALF; pos[k + 2] = j * CELL - HALF; nor[k + 1] = 1;
  }
  const idx = new Uint16Array((N - 1) * (N - 1) * 6); let t = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const m = new THREE.Mesh(g, terrMat);
  m.frustumCulled = false; m.visible = false;
  scene.add(m);
  return { mesh: m, geo: g };
}
const terr = [makeTerrain(), makeTerrain()];
let activeT = 0, centerX = 0, centerZ = 0, job = null;
function startJob(cx, cz) { job = { cx, cz, row: 0, target: 1 - activeT, h: new Float32Array(N * N) }; }
function stepJob(rows) {
  const { cx, cz, h } = job;
  const end = Math.min(N, job.row + rows);
  for (let j = job.row; j < end; j++) {
    const z = cz + j * CELL - HALF;
    for (let i = 0; i < N; i++) h[j * N + i] = height(cx + i * CELL - HALF, z);
  }
  job.row = end;
  if (end >= N) finishJob();
}
function finishJob() {
  const t = terr[job.target], h = job.h;
  const pos = t.geo.attributes.position.array, nor = t.geo.attributes.normal.array;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    pos[k * 3 + 1] = h[k];
    const hl = h[j * N + Math.max(i - 1, 0)], hr = h[j * N + Math.min(i + 1, N - 1)];
    const hd = h[Math.max(j - 1, 0) * N + i], hu = h[Math.min(j + 1, N - 1) * N + i];
    let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz); nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
  }
  t.geo.attributes.position.needsUpdate = true; t.geo.attributes.normal.needsUpdate = true;
  t.mesh.position.set(job.cx, 0, job.cz);
  t.mesh.visible = true; terr[activeT].mesh.visible = false;
  activeT = job.target; centerX = job.cx; centerZ = job.cz; job = null;
}

// ---------------------------------------------------------------------------
// Jogador
// ---------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const P = {
  p: new THREE.Vector3(0, 0, 0), v: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0),
  grounded: true, charge: 0, charging: false, coyote: 0, jumpLock: 0, airT: 0,
  imp: 15, dashCd: 0, dash: null, dashT: 0, preDash: 0, invuln: 0,
  rope: null, ropeL: 0, gliding: false, dist: 0, runPhase: 0,
};
// Começa numa ilha flutuante bem acima do morro mais alto da região, virada
// para a descida. A ilha fica um pouco antes do topo, para que um salto para
// frente aterrisse na encosta e não no cume plano.
let spawnYaw = 0;
const ISL = { x: 0, z: 0, top: 0, R: 18 };
{
  let bx = 0, bz = 0, bh = -1e9;
  for (let z = -700; z <= 700; z += 35) for (let x = -700; x <= 700; x += 35) { const h = height(x, z); if (h > bh) { bh = h; bx = x; bz = z; } }
  let low = 1e9;
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, h = height(bx + Math.sin(a) * 60, bz + Math.cos(a) * 60);
    if (h < low) { low = h; spawnYaw = a + Math.PI; }
  }
  const fx = -Math.sin(spawnYaw), fz = -Math.cos(spawnYaw);
  ISL.x = bx - fx * 70; ISL.z = bz - fz * 70;
  let peak = -1e9;
  for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; for (const r of [0, 40, 90, 140]) peak = Math.max(peak, height(ISL.x + Math.sin(a) * r, ISL.z + Math.cos(a) * r)); }
  ISL.top = peak + 330;
  P.p.set(ISL.x - fx * 9, ISL.top, ISL.z - fz * 9);
}
// Trilha: o mundo só tem frente. Um eixo que sai da ilha e serpenteia devagar;
// o viajante pode abrir até MAXANG para os lados, nunca voltar, e quanto mais
// se afasta do centro, mais o lado de fora se fecha até empurrar de volta.
const CF = { x: -Math.sin(spawnYaw), z: -Math.cos(spawnYaw) }, CR = { x: Math.cos(spawnYaw), z: -Math.sin(spawnYaw) };
const courseC = (u) => 260 * Math.sin(u * 0.0008) + 120 * Math.sin(u * 0.0021);
const courseD = (u) => 0.208 * Math.cos(u * 0.0008) + 0.252 * Math.cos(u * 0.0021);
const courseU = (x, z) => (x - ISL.x) * CF.x + (z - ISL.z) * CF.z;
function courseFrame(x, z, out) {
  const u = courseU(x, z), w = (x - ISL.x) * CR.x + (z - ISL.z) * CR.z, d = courseD(u), l = Math.hypot(1, d);
  out.u = u; out.off = w - courseC(u);
  out.fx = (CF.x + CR.x * d) / l; out.fz = (CF.z + CR.z * d) / l;
  out.rx = (CR.x - CF.x * d) / l; out.rz = (CR.z - CF.z * d) / l;
  return out;
}
function coursePoint(u, off, out) {
  const w = courseC(u) + off;
  out.x = ISL.x + CF.x * u + CR.x * w; out.z = ISL.z + CF.z * u + CR.z * w;
  return out;
}
const U0 = courseU(P.p.x, P.p.z), MAXANG = 1.0, CORR_IN = 100, CORR_OUT = 220;
const cfStep = {}, cfCam = {}, cfHud = {};
// Corta a velocidade que sai do cone: a direção vai para a borda e o módulo
// cai com o cosseno do excesso (andar de ré vira zero, não velocidade de graça).
function keepForward(v, cf) {
  const hs = Math.hypot(v.x, v.z); if (hs < 0.01) return;
  const a = Math.atan2(v.x * cf.rx + v.z * cf.rz, v.x * cf.fx + v.z * cf.fz);
  const limOut = MAXANG - (MAXANG + 0.35) * smooth(CORR_IN, CORR_OUT, Math.abs(cf.off));
  const lo = cf.off < 0 ? -limOut : -MAXANG, hi = cf.off > 0 ? limOut : MAXANG;
  const b = clamp(a, lo, hi);
  if (b === a) return;
  const m = hs * Math.max(0, Math.cos(a - b)), c = Math.cos(b), sn = Math.sin(b);
  v.x = (cf.fx * c + cf.rx * sn) * m; v.z = (cf.fz * c + cf.rz * sn) * m;
}
const isAhead = (x, z, slack) => courseU(x, z) > courseU(P.p.x, P.p.z) - slack;
function onIsland(x, z, y) { const dx = x - ISL.x, dz = z - ISL.z; return dx * dx + dz * dz < ISL.R * ISL.R && y > ISL.top - 3; }
function groundH(x, z, y) { return onIsland(x, z, y) ? Math.max(ISL.top, height(x, z)) : height(x, z); }
function groundN(x, z, y, out) { return onIsland(x, z, y) ? out.set(0, 1, 0) : normalAt(x, z, out); }

// Viajante: túnica torneada com pregas e faixas bordadas, capuz com ponta e
// borla, rosto escuro com olhos que brilham, braços e pernas articulados.
const playerG = new THREE.Group();
const body = new THREE.Group();
playerG.add(body);
const C_CREAM = new THREE.Color(0xece2cf), C_MAG = new THREE.Color(0x9a2c24), C_GOLD = new THREE.Color(0xc4983f), C_TEAL = new THREE.Color(0x34507a);
const toonVC = () => new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: gradTex });
{
  const prof = [new THREE.Vector2(0.001, 0.3)];
  for (let k = 0; k <= 30; k++) {
    const t = k / 30, y = 0.3 + t * 1.86;
    prof.push(new THREE.Vector2(0.3 + 0.66 * Math.pow(1 - t, 1.25) + (t < 0.05 ? 0.03 : 0), y));
  }
  prof.push(new THREE.Vector2(0.001, 2.17));
  const g = new THREE.LatheGeometry(prof, 36);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(x, z), t = clamp((y - 0.3) / 1.86, 0, 1);
    const pleat = 1 + 0.07 * Math.sin(ang * 9) * Math.pow(1 - t, 2);
    pos.setX(i, x * pleat); pos.setZ(i, z * pleat);
    const seg = Math.floor((ang + Math.PI) / (Math.PI * 2) * 18);
    const row = Math.floor((y - 0.62) / 0.075);
    let c = C_CREAM;
    if (y < 0.44) c = C_MAG;
    else if (y < 0.52) c = C_GOLD;
    else if (y > 0.6 && y < 0.92 && (seg + row) % 2 === 0) c = C_GOLD;
    else if (y > 0.97 && y < 1.03) c = C_MAG;
    else if (Math.abs(Math.sin(ang)) < 0.12 && z < 0 && y > 1.05 && y < 1.9) c = C_TEAL;
    else if (y > 1.98) c = C_MAG;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  body.add(new THREE.Mesh(g, toonVC()));
}
const hoodMat = toon(0x9a2c24);
const headG = new THREE.Group(); headG.position.y = 2.36; body.add(headG);
const hoodBall = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), hoodMat); hoodBall.scale.set(1, 1.08, 1.06);
const hoodTip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.05, 14), hoodMat); hoodTip.position.set(0, 0.64, 0.16); hoodTip.rotation.x = 0.38;
const tassel = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), toon(0xc4983f)); tassel.position.set(0, 1.1, 0.38);
const face = new THREE.Mesh(new THREE.SphereGeometry(0.37, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0a0410 })); face.position.set(0, -0.03, -0.31); face.scale.set(1, 1.04, 0.55);
const eyeGlow = new THREE.MeshBasicMaterial({ color: 0xffffff });
const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.04), eyeGlow); eyeL.position.set(-0.125, 0.03, -0.5); eyeL.rotation.z = -0.15;
const eyeR = eyeL.clone(); eyeR.position.x = 0.125; eyeR.rotation.z = 0.15;
const brow = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.05, 6, 20, Math.PI), toon(0xc4983f)); brow.position.set(0, -0.02, -0.33); brow.scale.set(1, 1.05, 1);
headG.add(hoodBall, hoodTip, tassel, face, eyeL, eyeR, brow);
function makeArm(side) {
  const g = new THREE.Group(); g.position.set(side * 0.44, 1.92, 0);
  const sleeve = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 12), toon(0x34507a)); sleeve.position.y = -0.42;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.1, 12), toon(0xc4983f)); cuff.position.y = -0.84;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0410 })); hand.position.y = -0.96;
  g.add(sleeve, cuff, hand);
  body.add(g);
  return g;
}
function makeLeg(side) {
  const g = new THREE.Group(); g.position.set(side * 0.19, 0.55, 0);
  const m = new THREE.MeshBasicMaterial({ color: 0x0a0410 });
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.52, 6), m); leg.position.y = -0.26;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.24), m); foot.position.set(0, -0.52, -0.05);
  g.add(leg, foot);
  body.add(g);
  return g;
}
const armL = makeArm(-1), armR = makeArm(1), legL = makeLeg(-1), legR = makeLeg(1);
const pose = { lean: 0, crouch: 0, bob: 0, aLx: 0, aLz: -0.1, aRx: 0, aRz: 0.1, lL: 0, lR: 0, head: 0 };
const HAND_LOCAL = new THREE.Vector3(0, -0.96, 0);
const handWorld = new THREE.Vector3();
scene.add(playerG);

// Ilha flutuante: tampo turquesa, rocha em estratos por baixo, raízes
// pendentes e um arco na borda de onde se pula.
const island = new THREE.Group();
{
  const R = ISL.R;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.96, 3, 48, 1), toon(0x7a8d4c));
  top.position.y = -1.5;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.98, 0.5, 6, 48), toon(0x8a6a44)); rim.rotation.x = Math.PI / 2; rim.position.y = -0.2;
  const rockG = new THREE.ConeGeometry(R * 0.97, 46, 40, 14);
  rockG.rotateX(Math.PI); rockG.translate(0, -26, 0);
  const rp = rockG.attributes.position, rc = new Float32Array(rp.count * 3);
  const strata = [new THREE.Color(0xb98a5e), new THREE.Color(0xd6bf98), new THREE.Color(0x8b6748), new THREE.Color(0xa65a3a)];
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const a = Math.atan2(x, z), j = 1 + (hash2(Math.round(a * 20), Math.round(y)) - 0.5) * 0.28;
    rp.setX(i, x * j); rp.setZ(i, z * j);
    const c = strata[Math.abs(Math.floor(y / 5)) % strata.length];
    rc[i * 3] = c.r; rc[i * 3 + 1] = c.g; rc[i * 3 + 2] = c.b;
  }
  rockG.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  rockG.computeVertexNormals();
  const rock = new THREE.Mesh(rockG, toonVC());
  island.add(top, rim, rock);
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2 + 0.3, r = R * (0.55 + 0.3 * hash2(k, 7));
    const len = 8 + 16 * hash2(k, 3);
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.6 + hash2(k, 9), len, 6), toon(k % 2 ? 0x6e7f45 : 0x5e4630));
    root.rotation.x = Math.PI; root.position.set(Math.sin(a) * r, -6 - len / 2 - 10 * (1 - r / R), Math.cos(a) * r);
    island.add(root);
  }
  // arco na borda da frente
  const arch = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.7, 8, 28, Math.PI), toon(0xa3542f));
  const fx = -Math.sin(spawnYaw), fz = -Math.cos(spawnYaw);
  arch.position.set(fx * (R - 3), 0, fz * (R - 3)); arch.rotation.y = spawnYaw;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), toon(0xc4983f)); knob.position.set(fx * (R - 3), 6.3, fz * (R - 3));
  island.add(arch, knob);
  // três hastes com olhos no tampo
  for (let k = 0; k < 3; k++) {
    const a = spawnYaw + Math.PI + (k - 1) * 0.9, r = R * 0.68, hgt = 4 + k * 1.5;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, hgt, 6), toon(0x6b5a45)); stem.position.set(Math.sin(a) * r, hgt / 2, Math.cos(a) * r);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), toon(0xf2eee6)); eye.position.set(Math.sin(a) * r, hgt + 0.8, Math.cos(a) * r);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0x000000 })); pu.position.copy(eye.position); pu.userData.eye = eye;
    island.add(stem, eye, pu);
  }
}
island.position.set(ISL.x, ISL.top, ISL.z);
scene.add(island);
const islandPupils = island.children.filter((c) => c.userData.eye);

// Letreiros no ar: texto grande pintado num canvas e mostrado como sprite,
// para passar pela cena e pelo pontilhado como qualquer outro objeto.
function airText(lines, w) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = lines.length > 1 ? 620 : 340;
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(w, w * c.height / c.width, 1);
  sp.userData.draw = () => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const size = lines.length > 1 ? 250 : 300;
    g.font = `800 ${size}px "Bricolage Grotesque", Archivo, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    lines.forEach((l, i) => {
      const y = (lines.length > 1 ? 260 : 270) + i * 280;
      let fs = size; while (g.measureText(l).width > c.width - 80 && fs > 60) { fs -= 10; g.font = `800 ${fs}px "Bricolage Grotesque", Archivo, sans-serif`; }
      g.lineWidth = 34; g.strokeStyle = '#000'; g.strokeText(l, c.width / 2, y);
      const gr = g.createLinearGradient(0, y - fs * 0.75, 0, y);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#fff6c8'); gr.addColorStop(1, '#ffc93a');
      g.fillStyle = gr; g.fillText(l, c.width / 2, y);
    });
    tex.needsUpdate = true;
  };
  sp.userData.draw();
  sp.visible = false; sp.renderOrder = 30;
  scene.add(sp);
  return sp;
}
const signJump = airText(['PULE'], 48);
const signShift = airText(['SEGURE', 'SHIFT'], 24);
let intro = 'island', introT = 0, shiftHeldT = 0, signShiftA = 0;
const signShiftPos = new THREE.Vector3();

// Cachecol: corrente de Verlet; o comprimento mostra o ímpeto.
const SC_MAX = 40, SEG = 0.42;
let scarfInit = false;
const scarfPts = [], scarfPrev = [];
for (let i = 0; i < SC_MAX; i++) { scarfPts.push(new THREE.Vector3(0, 2, i * SEG)); scarfPrev.push(new THREE.Vector3(0, 2, i * SEG)); }
const scarfGeo = new THREE.BufferGeometry();
const scPos = new Float32Array(SC_MAX * 2 * 3), scCol = new Float32Array(SC_MAX * 2 * 3);
const scIdx = [];
for (let i = 0; i < SC_MAX - 1; i++) { const a = i * 2; scIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
for (let i = 0; i < SC_MAX; i++) {
  const gold = Math.floor(i / 3) % 2 === 1;
  for (let s = 0; s < 2; s++) { const k = (i * 2 + s) * 3; scCol[k] = gold ? 0.78 : 0.6; scCol[k + 1] = gold ? 0.6 : 0.17; scCol[k + 2] = gold ? 0.26 : 0.14; }
}
scarfGeo.setIndex(scIdx);
scarfGeo.setAttribute('position', new THREE.BufferAttribute(scPos, 3));
scarfGeo.setAttribute('color', new THREE.BufferAttribute(scCol, 3));
const scarf = new THREE.Mesh(scarfGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
scarf.frustumCulled = false;
scene.add(scarf);

// Sombra, carga do salto, corda, mira.
const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.25, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
scene.add(shadow);
const chargeRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false }));
scene.add(chargeRing);
const ropeGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
rope.frustumCulled = false; rope.visible = false;
scene.add(rope);
const marker = new THREE.Mesh(new THREE.RingGeometry(1, 1.22, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
marker.renderOrder = 20; marker.visible = false;
scene.add(marker);

// ---------------------------------------------------------------------------
// Olhos (âncoras da corda) e aros, em células determinísticas ao redor.
// ---------------------------------------------------------------------------
const ORB_CELL = 80, ORB_R = 7, RING_CELL = 150, RING_R = 4;
const orbCache = new Map(), ringCache = new Map();
function orbAt(i, j) {
  const key = i + ',' + j;
  let o = orbCache.get(key);
  if (o === undefined) {
    o = null;
    if (hash2(i * 7 + 3, j * 13 + 1) < 0.5) {
      const x = (i + 0.15 + 0.7 * hash2(i, j + 99)) * ORB_CELL, z = (j + 0.15 + 0.7 * hash2(i + 41, j)) * ORB_CELL;
      const g = height(x, z);
      o = { x, z, g, off: 22 + 40 * hash2(i + 5, j - 3), stem: hash2(i - 8, j + 8) < 0.62, hue: hash2(i + 77, j + 31), y: 0, base: 0, key };
    }
    orbCache.set(key, o);
  }
  return o;
}
function ringAt(i, j) {
  const key = i + ',' + j;
  let r = ringCache.get(key);
  if (r === undefined) {
    r = null;
    if (hash2(i * 3 - 11, j * 5 + 7) < 0.55) {
      const x = (i + 0.2 + 0.6 * hash2(i + 3, j + 9)) * RING_CELL, z = (j + 0.2 + 0.6 * hash2(i - 6, j + 2)) * RING_CELL;
      const g = height(x, z);
      const yaw = hash2(i + 19, j - 19) * Math.PI * 2;
      r = { x, z, g, off: 11 + 16 * hash2(i, j + 55), yaw, nx: Math.sin(yaw), nz: Math.cos(yaw), y: 0, key, used: -99, prevAlong: null, hue: hash2(i + 2, j + 2) };
    }
    ringCache.set(key, r);
  }
  return r;
}
const MAX_ORBS = 260;
const eyeball = new THREE.InstancedMesh(new THREE.SphereGeometry(3.2, 16, 12), toon(0xf2eee6), MAX_ORBS);
const iris = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), toon(0xffffff), MAX_ORBS);
const pupil = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }), MAX_ORBS);
const stemGeo = new THREE.CylinderGeometry(0.4, 0.7, 1, 6); stemGeo.translate(0, 0.5, 0);
const stems = new THREE.InstancedMesh(stemGeo, toon(0xffffff), MAX_ORBS);
const MAX_RINGS = 120;
const ringGeo = new THREE.TorusGeometry(RING_R * 1.6, 0.75, 8, 32);
const rings = new THREE.InstancedMesh(ringGeo, toon(0xffffff), MAX_RINGS);
const tmpC = new THREE.Color();
// Cores de íris de verdade: castanho, avelã, verde, azul, cinza, âmbar.
const IRIS = [0x5a3a22, 0x7a5a2e, 0x4f6e4a, 0x4a6f8f, 0x6b7378, 0x8a6a3a].map((c) => new THREE.Color(c));
for (let i = 0; i < MAX_ORBS; i++) { iris.setColorAt(i, IRIS[0]); stems.setColorAt(i, IRIS[0]); }
for (let i = 0; i < MAX_RINGS; i++) rings.setColorAt(i, tmpC.setHSL(0.11, 0.55, 0.5));
[eyeball, iris, pupil, stems, rings].forEach((m) => { m.frustumCulled = false; m.count = 0; scene.add(m); });
let visOrbs = [], visRings = [];
const dummy = new THREE.Object3D();
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tv3 = new THREE.Vector3();

function updateProps(t) {
  const px = P.p.x, pz = P.p.z;
  visOrbs = [];
  const oi = Math.floor(px / ORB_CELL), oj = Math.floor(pz / ORB_CELL);
  for (let j = oj - 7; j <= oj + 7; j++) for (let i = oi - 7; i <= oi + 7; i++) {
    const o = orbAt(i, j); if (!o) continue;
    const fo = farOffset(o.x, o.z, t, px, pz);
    o.base = o.g + fo; o.y = o.base + o.off + Math.sin(t * 0.6 + o.hue * 20) * 1.2;
    visOrbs.push(o);
    if (visOrbs.length >= MAX_ORBS) break;
  }
  let s = 0;
  for (let k = 0; k < visOrbs.length; k++) {
    const o = visOrbs[k];
    dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    eyeball.setMatrixAt(k, dummy.matrix);
    tv.set(P.p.x - o.x, P.p.y + 1.5 - o.y, P.p.z - o.z).normalize();
    dummy.position.set(o.x + tv.x * 2.55, o.y + tv.y * 2.55, o.z + tv.z * 2.55);
    dummy.lookAt(P.p.x, P.p.y + 1.5, P.p.z); dummy.scale.set(1.75, 1.75, 0.8); dummy.updateMatrix();
    iris.setMatrixAt(k, dummy.matrix);
    iris.setColorAt(k, IRIS[Math.floor(o.hue * IRIS.length) % IRIS.length]);
    dummy.position.set(o.x + tv.x * 3.05, o.y + tv.y * 3.05, o.z + tv.z * 3.05);
    dummy.scale.set(0.8, 0.8, 0.4); dummy.updateMatrix();
    pupil.setMatrixAt(k, dummy.matrix);
    if (o.stem) {
      const hgt = Math.max(1, o.y - 3 - o.base + 2);
      dummy.position.set(o.x, o.base - 2, o.z); dummy.rotation.set(Math.sin(t * 0.4 + o.hue * 9) * 0.04, 0, Math.cos(t * 0.33 + o.hue * 7) * 0.04);
      dummy.scale.set(1, hgt, 1); dummy.updateMatrix();
      stems.setMatrixAt(s, dummy.matrix);
      stems.setColorAt(s, tmpC.setHSL(0.07 + o.hue * 0.17, 0.28, 0.36));
      s++;
    }
  }
  eyeball.count = iris.count = pupil.count = visOrbs.length; stems.count = s;
  [eyeball, iris, pupil, stems].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });

  visRings = [];
  const ri = Math.floor(px / RING_CELL), rj = Math.floor(pz / RING_CELL);
  for (let j = rj - 4; j <= rj + 4; j++) for (let i = ri - 4; i <= ri + 4; i++) {
    const r = ringAt(i, j); if (!r) continue;
    r.y = r.g + farOffset(r.x, r.z, t, px, pz) + r.off;
    visRings.push(r);
  }
  for (let k = 0; k < visRings.length && k < MAX_RINGS; k++) {
    const r = visRings[k];
    const glow = t - r.used < 0.6;
    dummy.position.set(r.x, r.y, r.z); dummy.rotation.set(0, r.yaw, Math.sin(t * 0.5 + r.hue * 10) * 0.15);
    const sc = glow ? 1.25 : 1; dummy.scale.set(sc, sc, sc); dummy.updateMatrix();
    rings.setMatrixAt(k, dummy.matrix);
    rings.setColorAt(k, glow ? tmpC.setRGB(1, 1, 1) : tmpC.setHSL(0.11 + Math.sin(t + r.hue * 6) * 0.01, 0.55, 0.5));
  }
  rings.count = Math.min(visRings.length, MAX_RINGS);
  rings.instanceMatrix.needsUpdate = true; if (rings.instanceColor) rings.instanceColor.needsUpdate = true;

  if (orbCache.size > 3000) for (const [k, o] of orbCache) if (o && Math.hypot(o.x - px, o.z - pz) > 1500) orbCache.delete(k);
  if (ringCache.size > 1200) for (const [k, r] of ringCache) if (r && Math.hypot(r.x - px, r.z - pz) > 1500) ringCache.delete(k);
}

// ---------------------------------------------------------------------------
// Bocas: inimigos que perseguem e mordem o ímpeto.
// ---------------------------------------------------------------------------
const enemies = [];
const bodyGeo = new THREE.SphereGeometry(2.2, 16, 12);
const mouthGeo = new THREE.SphereGeometry(1, 14, 10);
const eGeo = new THREE.SphereGeometry(0.55, 10, 8);
const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const whiteMat = toon(0xffffff);
const toothGeo = new THREE.ConeGeometry(0.22, 0.5, 4);
for (let i = 0; i < 10; i++) {
  const g = new THREE.Group();
  const mat = toon(0xb0705a);
  const b = new THREE.Mesh(bodyGeo, mat);
  const mouth = new THREE.Mesh(mouthGeo, blackMat); mouth.position.set(0, -0.35, 1.75); mouth.scale.set(1.25, 0.6, 0.7);
  const e1 = new THREE.Mesh(eGeo, whiteMat); e1.position.set(-0.75, 0.95, 1.6);
  const e2 = e1.clone(); e2.position.x = 0.75; e2.scale.setScalar(1.35);
  const p1 = new THREE.Mesh(eGeo, blackMat); p1.scale.setScalar(0.45); p1.position.set(-0.75, 0.95, 2.1);
  const p2 = p1.clone(); p2.position.x = 0.75; p2.position.z = 2.25;
  const t1 = new THREE.Mesh(toothGeo, whiteMat); t1.position.set(-0.4, 0.05, 2.3); t1.rotation.x = Math.PI;
  const t2 = t1.clone(); t2.position.x = 0.4;
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 6), mat); horn.position.set(0.3, 2.4, -0.2); horn.rotation.z = -0.4;
  g.add(b, mouth, e1, e2, p1, p2, t1, t2, horn);
  g.visible = false;
  scene.add(g);
  enemies.push({ g, mat, mouth, active: false, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, stun: 0, dying: -1, seed: Math.random() });
}
let spawnClock = 3, combo = 0, lastKill = -99;
function spawnEnemy() {
  const e = enemies.find((x) => !x.active);
  if (!e) return;
  const hs = Math.hypot(P.v.x, P.v.z);
  let base = hs > 4 ? Math.atan2(P.v.x, P.v.z) : camYaw + Math.PI;
  const a = base + (Math.random() - 0.5) * 2.2;
  const d = 150 + Math.random() * 90;
  const x = P.p.x + Math.sin(a) * d, z = P.p.z + Math.cos(a) * d;
  e.pos.set(x, height(x, z) + 10 + Math.random() * 22, z);
  e.vel.set(0, 0, 0); e.active = true; e.alive = true; e.stun = 0; e.dying = -1; e.t = 0; e.seed = Math.random();
  e.g.visible = true; e.g.scale.setScalar(1);
}
function updateEnemies(dt, t) {
  const level = Math.min(1, P.dist / 6000);
  const maxE = 3 + Math.floor(level * 5);
  if (intro !== 'done') return;
  spawnClock -= dt;
  const alive = enemies.filter((e) => e.active && e.alive).length;
  if (spawnClock <= 0 && alive < maxE) { spawnEnemy(); spawnClock = 2.4 + Math.random() * 1.8 - level; }
  for (const e of enemies) {
    if (!e.active) continue;
    e.t += dt;
    if (e.dying >= 0) {
      e.dying += dt;
      const s = e.dying < 0.12 ? 1 + e.dying * 6 : Math.max(0, 1.7 - (e.dying - 0.12) * 9);
      e.g.scale.setScalar(Math.max(0.001, s));
      if (e.dying > 0.32) { e.active = false; e.g.visible = false; }
      continue;
    }
    tv.set(P.p.x - e.pos.x, P.p.y + 1.4 - e.pos.y, P.p.z - e.pos.z);
    const d = tv.length();
    if (d > 470) { e.active = false; e.alive = false; e.g.visible = false; continue; }
    if (e.stun > 0) { e.stun -= dt; e.vel.multiplyScalar(1 - 2 * dt); }
    else {
      const sp = d > 260 ? 12 : 19 + level * 12 + (d < 40 ? 5 : 0);
      tv.multiplyScalar(sp / Math.max(d, 0.001));
      tv.y += Math.sin(e.t * 2 + e.seed * 9) * 3;
      e.vel.lerp(tv, Math.min(1, 1.6 * dt));
    }
    e.pos.addScaledVector(e.vel, dt);
    const gh = height(e.pos.x, e.pos.z) + 3;
    if (e.pos.y < gh) e.pos.y = gh;
    e.g.position.copy(e.pos);
    e.g.lookAt(P.p.x, P.p.y + 1.4, P.p.z);
    const open = e.stun > 0 ? 0.25 : 0.35 + 0.65 * Math.abs(Math.sin(e.t * (d < 40 ? 11 : 4)));
    e.mouth.scale.y = 0.25 + open * 0.75;
    e.mat.color.setHSL(0.02 + e.seed * 0.06, 0.42, e.stun > 0 ? 0.72 : 0.5);
  }
}

// ---------------------------------------------------------------------------
// A Boca: vem pela trilha atrás do viajante, cada vez mais rápida. Se a
// distância chega a zero, engole. Longe demais, ela apressa o passo.
// ---------------------------------------------------------------------------
const CH = { on: false, u: 0, off: 0, sp: 0, t: 0, gap: 999, pos: new THREE.Vector3(), g: new THREE.Group() };
const CH_START = 130, CH_EAT = 12;
{
  const flesh = toon(0x6e4b3c);
  CH.flesh = flesh;
  const b = new THREE.Mesh(new THREE.SphereGeometry(16, 28, 20), flesh); b.scale.set(1.15, 0.95, 1);
  CH.mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), blackMat); CH.mouth.position.set(0, -2, 12.5); CH.mouth.scale.set(12, 7, 5.5);
  const gum = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 8, 40), toon(0x8e4a48)); gum.scale.set(12.3, 7.3, 6); gum.position.copy(CH.mouth.position);
  CH.gum = gum;
  const toothM = toon(0xe9e2cf);
  CH.teeth = [];
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 5), toothM);
    tooth.userData.a = a;
    CH.teeth.push(tooth); CH.g.add(tooth);
  }
  const eyeW = toon(0xf2eee6);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), eyeW); e.position.set(sx * 7.5, 9, 9.5);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), blackMat); pu.position.set(sx * 7.5, 9, 12.4);
    CH.g.add(e, pu);
  }
  CH.g.add(b, CH.mouth, gum);
  CH.g.visible = false;
  scene.add(CH.g);
}
function placeTeeth(open) {
  for (const tooth of CH.teeth) {
    const a = tooth.userData.a, up = Math.sin(a) > 0;
    tooth.position.set(Math.cos(a) * 11, -2 + Math.sin(a) * 6.3 * open, 13.6);
    tooth.rotation.set(0, 0, up ? Math.PI : 0);
  }
  CH.mouth.scale.y = 7 * open; CH.gum.scale.y = 7.3 * open;
}
function updateChaser(dt, t) {
  const cf = courseFrame(P.p.x, P.p.z, cfHud);
  if (state === 'play' && intro === 'done') {
    if (!CH.on) { CH.on = true; CH.u = cf.u - CH_START; CH.off = cf.off; CH.t = 0; }
    CH.t += dt;
    const gap = cf.u - CH.u;
    CH.sp = Math.min(58, 17 + CH.t * 0.15) + Math.max(0, gap - 200) * 0.3;
    CH.u += CH.sp * dt;
    CH.off = lerp(CH.off, cf.off, 1 - Math.exp(-1.5 * dt));
    if (cf.u - CH.u < CH_EAT) swallow();
  } else if (state === 'eaten') {
    CH.u = lerp(CH.u, cf.u + 2, 1 - Math.exp(-6 * dt));
    CH.off = lerp(CH.off, cf.off, 1 - Math.exp(-6 * dt));
  }
  CH.gap = CH.on ? cf.u - CH.u : 999;
  CH.g.visible = CH.on && CH.gap < 700;
  if (!CH.g.visible) return;
  coursePoint(CH.u, CH.off, CH.pos);
  const gy = height(CH.pos.x, CH.pos.z) + farOffset(CH.pos.x, CH.pos.z, t, P.p.x, P.p.z) + 15;
  CH.pos.y = lerp(gy, Math.max(gy - 8, P.p.y + 1), smooth(160, 30, CH.gap)) + Math.sin(t * 1.3) * 1.5;
  CH.g.position.copy(CH.pos);
  CH.g.lookAt(P.p.x, P.p.y + 1.4, P.p.z);
  const near = smooth(120, 20, CH.gap);
  placeTeeth(state === 'eaten' ? Math.max(0.05, 1 - eatenT * 1.6) : 0.55 + 0.45 * Math.abs(Math.sin(t * (2 + near * 5))));
  if (state === 'play') shake = Math.max(shake, near * 0.18);
}
let eatenT = 0;
function swallow() {
  if (state !== 'play') return;
  state = 'eaten'; eatenT = 0;
  releaseRope(); P.dash = null;
  shake += 0.8; hitstop = 0;
  saveBest();
}
function finishSwallow() {
  state = 'dead';
  showBest();
  setStatus(`A boca te alcançou a ${fmt(P.dist)} m.`);
  btnLabel = 'Recomeçar'; startBtn.textContent = btnLabel;
  $('panel').hidden = false; startBtn.hidden = false;
  setAim('repouso');
  startBtn.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Partículas
// ---------------------------------------------------------------------------
const PN = 700;
const partGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3);
const pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN);
for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -1e5;
partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
partGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const parts = new THREE.Points(partGeo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, sizeAttenuation: true }));
parts.frustumCulled = false;
scene.add(parts);
let pHead = 0;
function emit(x, y, z, n, speed, hue, spread = 1, up = 0) {
  for (let k = 0; k < n; k++) {
    const i = pHead; pHead = (pHead + 1) % PN;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1);
    const s = speed * (0.4 + Math.random() * 0.6);
    pVel[i * 3] = Math.sin(b) * Math.cos(a) * s * spread; pVel[i * 3 + 1] = Math.abs(Math.cos(b)) * s + up; pVel[i * 3 + 2] = Math.sin(b) * Math.sin(a) * s * spread;
    pLife[i] = 0.6 + Math.random() * 0.7;
    if (hue < 0) tmpC.setRGB(0.96, 0.93, 0.87); else tmpC.setHSL(0.04 + hue * 0.08 + Math.random() * 0.04, 0.4, 0.5 + Math.random() * 0.2);
    pCol[i * 3] = tmpC.r; pCol[i * 3 + 1] = tmpC.g; pCol[i * 3 + 2] = tmpC.b;
  }
}
function updateParts(dt) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -1e5; continue; }
    pVel[i * 3 + 1] -= 18 * dt;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
  }
  partGeo.attributes.position.needsUpdate = true; partGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const K = Object.create(null);
let lmb = false, rmb = false, spaceHeld = false, menuDown = false;
const mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false };
let state = 'menu';
// A mira é o próprio ponteiro, solto na tela. A câmera gira na direção dele
// (mais rápido quanto mais perto da borda) e olha para cima ou para baixo
// conforme a altura em que ele está.
function aimPoint() { return [mouse.x, mouse.y]; }
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { if (state === 'play') pause(); return; }
  if (state !== 'play') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  K[e.code] = true;
  if (e.code === 'Space') {
    spaceHeld = true;
    if (P.grounded || P.coyote > 0) { P.charging = true; P.charge = 0; }
  }
  if (e.code === 'KeyF') strike();
  if (e.code === 'KeyB') {
    const on = postMat.uniforms.uOn.value < 0.5;
    postMat.uniforms.uOn.value = on ? 1 : 0;
    toast(on ? 'Pontilhado ligado' : 'Pontilhado desligado');
  }
});
addEventListener('keyup', (e) => {
  K[e.code] = false;
  if (e.code === 'Space') {
    spaceHeld = false;
    if (P.charging) { P.charging = false; if (state === 'play' && (P.grounded || P.coyote > 0)) doJump(); }
  }
});
addEventListener('mousemove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
  uiDirty = true;
});
root.addEventListener('mouseleave', () => { mouse.inside = false; uiDirty = true; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousedown', (e) => {
  if (state !== 'play') { menuDown = true; uiDirty = true; return; }
  if (e.button === 0) { lmb = true; fireRope(); }
  if (e.button === 2) { rmb = true; strike(); }
});
addEventListener('mouseup', (e) => {
  menuDown = false; uiDirty = true;
  if (e.button === 0) { lmb = false; releaseRope(); }
  if (e.button === 2) rmb = false;
});
addEventListener('blur', () => { for (const k in K) K[k] = false; lmb = rmb = spaceHeld = false; releaseRope(); if (state === 'play') pause(); });

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------
let camYaw = 0, camPitch = 0.2, lookUp = 0, fovKick = 0, shake = 0, hitstop = 0, time = 0;
const camPos = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hover = null;

function raySphere(ro, rd, cx, cy, cz, r) {
  const ox = cx - ro.x, oy = cy - ro.y, oz = cz - ro.z;
  const tca = ox * rd.x + oy * rd.y + oz * rd.z;
  if (tca < 0) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}
function rayTerrain(ro, rd, maxT) {
  for (let t = 2; t < maxT; t += 3) {
    if (ro.y + rd.y * t < height(ro.x + rd.x * t, ro.z + rd.z * t)) {
      let a = t - 3, b = t;
      for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (ro.y + rd.y * m < height(ro.x + rd.x * m, ro.z + rd.z * m)) b = m; else a = m; }
      return b;
    }
  }
  return -1;
}
function pick() {
  hover = null;
  if (state !== 'play' || !mouse.inside) return;
  const [ax0, ay0] = aimPoint();
  ndc.set(ax0 / W * 2 - 1, -(ay0 / H) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
  let best = 1e9;
  for (const e of enemies) {
    if (!e.active || !e.alive || e.dying >= 0) continue;
    if (e.pos.distanceTo(P.p) > 120 || !isAhead(e.pos.x, e.pos.z, 8)) continue;
    const t = raySphere(ro, rd, e.pos.x, e.pos.y, e.pos.z, 6);
    if (t > 0 && t < best) { best = t; hover = { type: 'enemy', e }; }
  }
  if (hover) return;
  for (const o of visOrbs) {
    const dx = o.x - P.p.x, dy = o.y - P.p.y, dz = o.z - P.p.z;
    if (dx * dx + dy * dy + dz * dz > 180 * 180 || !isAhead(o.x, o.z, 4)) continue;
    const t = raySphere(ro, rd, o.x, o.y, o.z, 8);
    if (t > 0 && t < best) { best = t; hover = { type: 'orb', o }; }
  }
}
function fireRope() {
  pick();
  let ax, ay, az;
  if (hover && hover.type === 'orb') { ax = hover.o.x; ay = hover.o.y; az = hover.o.z; }
  else {
    const [ax0, ay0] = aimPoint();
    ndc.set(ax0 / W * 2 - 1, -(ay0 / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    const t = rayTerrain(ro, rd, 320);
    if (t < 0) return;
    ax = ro.x + rd.x * t; ay = ro.y + rd.y * t; az = ro.z + rd.z * t;
    if (Math.hypot(ax - P.p.x, ay - P.p.y, az - P.p.z) > 180 || !isAhead(ax, az, 4)) return;
  }
  P.rope = new THREE.Vector3(ax, ay, az);
  P.ropeL = Math.max(6, P.rope.distanceTo(P.p));
  tv.copy(P.rope).sub(P.p).normalize();
  P.v.addScaledVector(tv, 14);
  if (ay > P.p.y + 2) { P.grounded = false; P.jumpLock = 0.1; }
  P.dash = null;
  emit(ax, ay, az, 14, 10, -1);
}
function releaseRope() {
  if (!P.rope) return;
  P.rope = null;
  const sp = P.v.length();
  if (sp > 12) { P.v.multiplyScalar(1.07); P.v.y += 3; fovKick += 3; }
}
function strike() {
  if (state !== 'play') return;
  pick();
  if (hover && hover.type === 'enemy') {
    P.dash = hover.e; P.dashT = 0.9; P.preDash = Math.hypot(P.v.x, P.v.z);
    releaseRope(); P.grounded = false; fovKick += 5;
    return;
  }
  if (P.dashCd > 0) return;
  const [ax0, ay0] = aimPoint();
  ndc.set(ax0 / W * 2 - 1, -(ay0 / H) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const rd = raycaster.ray.direction;
  P.v.addScaledVector(rd, 30);
  if (rd.y > 0.15 || !P.grounded) P.grounded = false;
  P.dashCd = 0.9; fovKick += 6;
  emit(P.p.x, P.p.y + 1.2, P.p.z, 18, 9, -1);
}
function doJump() {
  const c = P.charge;
  tv.copy(P.n).lerp(UP, 0.6).normalize();
  const vn = P.v.dot(tv); if (vn < 0) P.v.addScaledVector(tv, -vn);
  P.v.addScaledVector(tv, 13 + 27 * c);
  if (c > 0.25) {
    let hx = P.v.x, hz = P.v.z; const hs = Math.hypot(hx, hz);
    if (hs > 2) { hx /= hs; hz /= hs; } else { hx = -Math.sin(camYaw); hz = -Math.cos(camYaw); }
    P.v.x += hx * 24 * c; P.v.z += hz * 24 * c;
    emit(P.p.x, P.p.y + 0.3, P.p.z, Math.floor(20 + 30 * c), 14, -1, 1.5);
    fovKick += 8 * c; shake += 0.25 * c;
  }
  P.grounded = false; P.jumpLock = 0.12; P.coyote = 0; P.charge = 0;
}
function rotateToward(v, dx, dz, maxAng) {
  const hs = Math.hypot(v.x, v.z);
  if (hs < 0.01) return;
  const cur = Math.atan2(v.x, v.z), tgt = Math.atan2(dx, dz);
  let d = tgt - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
  const a = cur + clamp(d, -maxAng, maxAng);
  v.x = Math.sin(a) * hs; v.z = Math.cos(a) * hs;
}
function killEnemy(e, viaDash) {
  e.alive = false; e.dying = 0;
  combo = time - lastKill < 5 ? combo + 1 : 1; lastKill = time;
  P.imp = Math.min(100, P.imp + 14 + 6 * combo);
  let hx = P.v.x, hz = P.v.z; const hs = Math.hypot(hx, hz) || 1; hx /= hs; hz /= hs;
  const target = (viaDash ? P.preDash : hs) + 16 + 4 * combo;
  P.v.x = hx * target; P.v.z = hz * target; P.v.y = viaDash ? 14 : 19;
  P.grounded = false; P.jumpLock = 0.2; P.dashCd = 0;
  emit(e.pos.x, e.pos.y, e.pos.z, 60, 24, e.seed, 1.2);
  hitstop = 0.07; shake += 0.45; fovKick += 9;
  if (combo >= 2) showCombo();
}
function bite(e) {
  P.v.x *= 0.35; P.v.z *= 0.35; P.v.y = Math.max(P.v.y, 9);
  P.imp = Math.max(0, P.imp - 25); P.invuln = 1.2; P.grounded = false; P.jumpLock = 0.1;
  combo = 0;
  e.stun = 1.6; tv.copy(e.pos).sub(P.p).normalize(); e.vel.copy(tv).multiplyScalar(26);
  shake += 0.6; flash(0.55);
  releaseRope();
  emit(P.p.x, P.p.y + 1.5, P.p.z, 25, 10, -1);
}

// ---------------------------------------------------------------------------
// Física (passos fixos)
// ---------------------------------------------------------------------------
const G = 40;
const tn = new THREE.Vector3();
function step(dt) {
  const p = P.p, v = P.v;
  P.jumpLock = Math.max(0, P.jumpLock - dt);
  P.coyote = Math.max(0, P.coyote - dt);
  P.dashCd = Math.max(0, P.dashCd - dt);
  P.invuln = Math.max(0, P.invuln - dt);
  P.imp = Math.max(0, P.imp - dt * 2.2);

  // Fora da ilha o viajante corre sozinho: A e D só desviam a direção dentro
  // do cone da trilha. Na ilha, W anda.
  const auto = intro !== 'island';
  const inR = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
  const inF = auto || K.KeyW || K.ArrowUp ? 1 : 0;
  const cf = courseFrame(p.x, p.z, cfStep);
  const fx = cf.fx, fz = cf.fz;
  // sem A nem D, volta devagar para o meio da trilha
  const sa = inR ? inR * MAXANG * 0.85 : -clamp(cf.off / 300, -0.3, 0.3), ca = Math.cos(sa), sna = Math.sin(sa);
  const dx = cf.fx * ca + cf.rx * sna, dz = cf.fz * ca + cf.rz * sna;
  const hasIn = inF > 0 || inR !== 0;
  const shift = K.ShiftLeft || K.ShiftRight;
  const runSpeed = 20 + P.imp * 0.3;

  if (P.dash) {
    const e = P.dash;
    if (!e.alive || !e.active) { P.dash = null; }
    else {
      tv.set(e.pos.x - p.x, e.pos.y - p.y - 1, e.pos.z - p.z);
      const d = tv.length();
      if (d < 4.2) { P.dash = null; killEnemy(e, true); }
      else {
        v.copy(tv).multiplyScalar(98 / d);
        p.addScaledVector(v, dt);
        const h = groundH(p.x, p.z, p.y); if (p.y < h) p.y = h;
        P.dashT -= dt;
        if (P.dashT <= 0) { P.dash = null; v.multiplyScalar(0.5); }
        P.grounded = false;
        return;
      }
    }
  }

  if (P.charging && P.grounded) P.charge = Math.min(1, P.charge + dt / 0.8);
  if (P.charging && !P.grounded && P.coyote <= 0) P.charging = false;

  if (P.grounded) {
    P.airT = 0;
    const n = groundN(p.x, p.z, p.y, P.n);
    const sf = shift ? 1.0 : 0.45;
    v.x += G * n.y * n.x * sf * dt; v.y += (-G + G * n.y * n.y) * sf * dt; v.z += G * n.y * n.z * sf * dt;
    const hs = Math.hypot(v.x, v.z);
    if (hasIn) {
      rotateToward(v, dx, dz, (shift ? 1.7 : hs > runSpeed ? 3.2 : 8) * dt);
      if (!shift && hs < runSpeed) { v.x += dx * 60 * dt; v.z += dz * 60 * dt; }
    } else if (!shift) {
      const f = Math.max(0, hs - 30 * dt) / (hs || 1); v.x *= f; v.z *= f;
    }
    if (!shift && hs > runSpeed) { const f = Math.max(runSpeed, hs - (hs - runSpeed) * 0.45 * dt) / hs; v.x *= f; v.z *= f; }
    if (shift) { const f = 1 - 0.06 * dt; v.x *= f; v.z *= f; }
    const vn = v.dot(n); if (vn < 0) v.addScaledVector(n, -vn);
    p.addScaledVector(v, dt);
    const h = groundH(p.x, p.z, p.y + 0.5);
    const gap = p.y - h;
    const sp = v.length();
    const allow = (shift ? 0.35 : 0.06) * sp * dt + 0.012;
    if (gap < 0 || (P.jumpLock <= 0 && gap < allow)) {
      p.y = h;
      groundN(p.x, p.z, p.y, n);
      const vn2 = v.dot(n);
      v.addScaledVector(n, -vn2);
      const l = v.length(); if (l > 1e-4) v.multiplyScalar(sp / l);
      if (shift && sp > 25 && Math.random() < 0.5) emit(p.x, p.y + 0.2, p.z, 1, 3, -1, 0.6, 2);
    } else {
      P.grounded = false; P.coyote = 0.12;
    }
    P.runPhase += sp * dt * 0.55;
  } else {
    P.airT += dt;
    const dive = shift && !P.rope;
    v.y -= G * dt * (dive ? 2.4 : 1);
    P.gliding = spaceHeld && !P.charging && !P.rope && v.y < 3;
    let hs = Math.hypot(v.x, v.z);
    if (P.gliding) {
      const sink = -3.5;
      if (v.y < sink) {
        const dvy = (sink - v.y) * Math.min(1, 5 * dt);
        v.y += dvy;
        let hx, hz;
        if (hs > 1) { hx = v.x / hs; hz = v.z / hs; } else if (hasIn) { hx = dx; hz = dz; } else { hx = fx; hz = fz; }
        const gain = 0.5 * Math.max(0, dvy - G * dt) + G * 3.2 * dt / Math.max(hs, 8);
        v.x += hx * gain; v.z += hz * gain;
      }
      if (hasIn) {
        rotateToward(v, dx, dz, 1.7 * dt);
        if (hs < 16) { v.x += dx * 14 * dt; v.z += dz * 14 * dt; }
      }
    } else if (P.rope) {
      if (hasIn) { v.x += dx * 16 * dt; v.z += dz * 16 * dt; }
    } else if (hasIn) {
      rotateToward(v, dx, dz, 1.0 * dt);
      if (hs < runSpeed) { v.x += dx * 16 * dt; v.z += dz * 16 * dt; }
    }
    const sp = v.length();
    const drag = (P.gliding ? 0.0004 : 0.00026) * sp;
    v.multiplyScalar(Math.max(0, 1 - drag * dt));
    if (sp > 240) v.multiplyScalar(240 / sp);
    p.addScaledVector(v, dt);
  }

  if (P.rope) {
    // A corda puxa: aceleração na direção da âncora, forte de longe e
    // suave perto, e o comprimento acompanha a distância (nunca afrouxa).
    tv.copy(P.rope).sub(p);
    const dr = tv.length();
    if (dr > 0.01) {
      const pull = 72 * smooth(4, 22, dr) * (inF > 0 ? 1.3 : 1);
      v.addScaledVector(tv, pull * dt / dr);
      if (P.grounded && tv.y / dr > 0.15) { P.grounded = false; P.jumpLock = 0.1; }
    }
    P.ropeL = Math.max(5, Math.min(P.ropeL, dr));
    tv.copy(p).sub(P.rope);
    const len = tv.length();
    if (len > P.ropeL) {
      tv.multiplyScalar(1 / len);
      p.copy(P.rope).addScaledVector(tv, P.ropeL);
      const vr = v.dot(tv);
      if (vr > 0) v.addScaledVector(tv, -vr);
    }
  }

  const h = groundH(p.x, p.z, p.y + 0.5);
  if (p.y < h) {
    p.y = h;
    if (!P.grounded) {
      groundN(p.x, p.z, p.y, P.n);
      const vn = v.dot(P.n);
      if (vn < 0) v.addScaledVector(P.n, -vn);
      if (-vn > 14) { emit(p.x, p.y + 0.3, p.z, Math.min(40, Math.floor(-vn)), 8, -1, 1.4); shake += Math.min(0.4, -vn * 0.01); }
      // Mergulho: com Shift, parte do impacto vira velocidade ao longo da encosta.
      if (shift && -vn > 10) {
        let tx = v.x, tz = v.z, tl = Math.hypot(tx, tz);
        if (tl < 3) { tx = P.n.x; tz = P.n.z; tl = Math.hypot(tx, tz); }
        if (tl < 0.05) { tx = fx; tz = fz; tl = 1; }
        const add = Math.min(95, -vn * 0.55);
        v.x += tx / tl * add; v.z += tz / tl * add;
        const vn2 = v.dot(P.n); v.addScaledVector(P.n, -vn2);
        const vl = v.length(); if (vl > 150) v.multiplyScalar(150 / vl);
        P.imp = Math.min(100, P.imp + add * 0.15);
        fovKick += 10; emit(p.x, p.y + 0.4, p.z, 14, 9, 0.12, 1.2);
      }
      P.grounded = true; P.gliding = false;
      if (P.charging) P.charge = 0;
    }
  } else if (P.grounded && p.y > h + 0.05) {
    P.grounded = false;
  }
  keepForward(v, courseFrame(p.x, p.z, cfStep));
}

function checkContacts(t) {
  for (const e of enemies) {
    if (!e.active || !e.alive || e.dying >= 0 || P.dash === e) continue;
    const d = Math.hypot(P.p.x - e.pos.x, P.p.y + 1.2 - e.pos.y, P.p.z - e.pos.z);
    if (d < 3.8) {
      if (P.v.y < -3 && P.p.y + 0.5 > e.pos.y) killEnemy(e, false);
      else if (P.invuln <= 0 && e.stun <= 0) bite(e);
    }
  }
  for (const r of visRings) {
    const rx = P.p.x - r.x, ry = P.p.y + 1.2 - r.y, rz = P.p.z - r.z;
    if (rx * rx + ry * ry + rz * rz > 60 * 60) { r.prevAlong = null; continue; }
    const along = rx * r.nx + rz * r.nz;
    const radial = Math.hypot(rx - r.nx * along, ry, rz - r.nz * along);
    if (r.prevAlong !== null && Math.sign(along) !== Math.sign(r.prevAlong) && radial < RING_R * 1.6 + 0.8 && t - r.used > 2) {
      r.used = t;
      const sp = P.v.length() || 1;
      P.v.multiplyScalar((sp + 20) / sp); P.v.y += 3;
      P.imp = Math.min(100, P.imp + 10);
      fovKick += 7;
      emit(r.x, r.y, r.z, 40, 16, 0.12, 1.2);
    }
    r.prevAlong = along;
  }
}

// ---------------------------------------------------------------------------
// Câmera, visual do jogador, cachecol
// ---------------------------------------------------------------------------
function updateIntro(dt, t) {
  const shift = K.ShiftLeft || K.ShiftRight;
  if (state === 'play') introT += dt;
  if (intro === 'island' && !P.grounded && (P.p.y < ISL.top - 12 || Math.hypot(P.p.x - ISL.x, P.p.z - ISL.z) > ISL.R + 1)) intro = 'fall';
  if (intro === 'fall' && P.grounded) { intro = 'done'; spawnClock = 4; }
  const fx = -Math.sin(spawnYaw), fz = -Math.cos(spawnYaw);
  // PULE: surge no ar depois da borda da ilha e some quando a queda começa.
  const ja = signJump.userData.a || 0;
  const jt = state === 'play' && intro === 'island' && introT > 0.6 ? 1 : 0;
  const na = lerp(ja, jt, 1 - Math.exp(-(jt ? 4 : 8) * dt));
  signJump.userData.a = na;
  signJump.visible = na > 0.01;
  if (signJump.visible) {
    const pop = reduceMotion ? 1 : 0.75 + 0.25 * na + Math.sin(Math.min(1, na) * Math.PI) * 0.12;
    signJump.position.set(ISL.x + fx * (ISL.R + 26), ISL.top + 15 + Math.sin(t * 1.6) * 0.8, ISL.z + fz * (ISL.R + 26));
    signJump.scale.set(48 * pop, 48 * pop * 340 / 1024, 1);
    signJump.material.opacity = Math.min(1, na * 1.4);
  }
  // SEGURE SHIFT: acompanha a queda, um pouco à frente e abaixo do viajante.
  shiftHeldT = shift ? shiftHeldT + dt : 0;
  const st = state === 'play' && intro === 'fall' && shiftHeldT < 0.35 ? 1 : 0;
  signShiftA = lerp(signShiftA, st, 1 - Math.exp(-(st ? 5 : 9) * dt));
  signShift.visible = signShiftA > 0.01;
  const cfx = -Math.sin(camYaw), cfz = -Math.cos(camYaw);
  tv.set(P.p.x + cfx * 10, P.p.y - 20, P.p.z + cfz * 10);
  if (!signShift.visible) signShiftPos.copy(tv); else signShiftPos.lerp(tv, 1 - Math.exp(-6 * dt));
  if (signShift.visible) {
    signShift.position.copy(signShiftPos);
    signShift.material.opacity = Math.min(1, signShiftA * 1.3);
    const sc = 24 * (0.85 + 0.15 * signShiftA);
    signShift.scale.set(sc, sc * 620 / 1024, 1);
  }
  // os olhos da ilha acompanham o viajante
  for (const pu of islandPupils) {
    const e = pu.userData.eye;
    tv.set(P.p.x - ISL.x - e.position.x, P.p.y + 1.5 - ISL.top - e.position.y, P.p.z - ISL.z - e.position.z).normalize();
    pu.position.copy(e.position).addScaledVector(tv, 0.75);
  }
}
const focus = new THREE.Vector3(); let focusInit = false, camDist = 46;
const chaseRise = () => CH.on ? smooth(115, 80, CH.gap) + smooth(40, 12, CH.gap) * 0.6 : 0;
function updateCamera(dt, t) {
  const sp = P.v.length(), hs = Math.hypot(P.v.x, P.v.z);
  const live = state === 'play' || state === 'eaten';
  if (live) {
    // A câmera fica atrás do viajante, entre a direção da trilha e a da
    // corrida; o ponteiro só a desvia um pouco para olhar de lado.
    const cf = courseFrame(P.p.x, P.p.z, cfCam);
    const cy = Math.atan2(-cf.fx, -cf.fz);
    let target = cy;
    if (hs > 4) { let dv = Math.atan2(-P.v.x, -P.v.z) - cy; while (dv > Math.PI) dv -= Math.PI * 2; while (dv < -Math.PI) dv += Math.PI * 2; target += dv * 0.6; }
    if (mouse.inside) target -= (mouse.x / W * 2 - 1) * 0.45;
    // engolido: a câmera vira para trás e encara a boca
    if (state === 'eaten') target += Math.PI * smooth(0, 0.45, eatenT);
    let dy = target - camYaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    camYaw += dy * (1 - Math.exp(-3 * dt));
    {
      const ny = mouse.inside ? mouse.y / H * 2 - 1 : 0;
      const fallBias = intro === 'fall' ? 0.55 : 0;
      camPitch = lerp(camPitch, clamp(0.26 + ny * 0.36 + fallBias + chaseRise() * 0.55, -0.2, 1.1), 1 - Math.exp(-3 * dt));
      lookUp = lerp(lookUp, fallBias ? 0 : Math.pow(clamp(-ny, 0, 1), 1.3) * 16, 1 - Math.exp(-3 * dt));
    }
  } else {
    camYaw += dt * 0.08;
    camPitch = lerp(camPitch, intro === 'island' ? 0.42 : 0.2, 1 - Math.exp(-2 * dt));
    lookUp = lerp(lookUp, 0, 1 - Math.exp(-2 * dt));
  }
  if (!focusInit) { focus.copy(P.p); focusInit = true; }
  focus.lerp(P.p, 1 - Math.exp(-14 * dt));
  let dist = live ? Math.min(27, 11 + sp * 0.07) : (intro === 'island' ? 46 : 22);
  // Com a Boca perto, a câmera sobe primeiro e depois recua por cima dela,
  // até ficar atrás e acima, com a Boca na parte de baixo do quadro e o
  // viajante à frente. Subir antes evita atravessar a Boca no caminho.
  if (live && CH.on) dist = lerp(dist, Math.max(dist, CH.gap + 32), smooth(85, 45, CH.gap));
  camDist = lerp(camDist, dist, 1 - Math.exp(-4 * dt));
  dist = camDist;
  const cp = Math.cos(camPitch);
  camera.position.set(focus.x + Math.sin(camYaw) * cp * dist, focus.y + 2.4 + Math.sin(camPitch) * dist, focus.z + Math.cos(camYaw) * cp * dist);
  const gh = groundH(camera.position.x, camera.position.z, camera.position.y + 2) + 1.6;
  if (camera.position.y < gh) camera.position.y = gh;
  if (shake > 0 && !reduceMotion) {
    camera.position.x += (Math.random() - 0.5) * shake * 2;
    camera.position.y += (Math.random() - 0.5) * shake * 2;
  }
  shake = Math.max(0, shake - dt * 2.5);
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  if (live || W < 900) camera.lookAt(focus.x + fx * lookUp * 0.8, focus.y + 2.4 + lookUp, focus.z + fz * lookUp * 0.8);
  else camera.lookAt(focus.x - Math.cos(camYaw) * 7, focus.y + 2.2, focus.z + Math.sin(camYaw) * 7);
  fovKick = Math.max(0, fovKick - dt * 18);
  const fov = 68 + Math.min(sp, 180) * 0.13 + (reduceMotion ? 0 : fovKick);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-6 * dt)); camera.updateProjectionMatrix(); }
}

// O cachecol não atravessa o corpo: cada ponto que entra na túnica ou no capuz
// é empurrado para fora, no espaço do corpo (que já inclui inclinação e
// agachamento). Um ponto que atravessou para a frente volta para as costas.
const SCARF_M = 0.2, scLoc = new THREE.Vector3(), scOld = new THREE.Vector3();
function scarfCollide(p, prev) {
  body.worldToLocal(scLoc.copy(p));
  scOld.copy(scLoc);
  const y = scLoc.y;
  if (y > 0.2 && y < 2.25) {
    const tt = clamp((y - 0.3) / 1.86, 0, 1);
    const rr = (0.3 + 0.66 * Math.pow(1 - tt, 1.25)) * 1.07 + SCARF_M;
    let r = Math.hypot(scLoc.x, scLoc.z);
    if (r < rr) {
      if (scLoc.z < 0) scLoc.z = -scLoc.z;
      if (r < 1e-3) { scLoc.x = 0; scLoc.z = 1; r = 1; }
      scLoc.x *= rr / r; scLoc.z *= rr / r;
    }
  }
  for (const [cy, cz, cr] of SCARF_HEAD) {
    const dy = scLoc.y - cy, dz = scLoc.z - cz, d = Math.hypot(scLoc.x, dy, dz), rr = cr + 0.12;
    if (d < rr) {
      if (d < 1e-3) { scLoc.z = cz + rr; continue; }
      scLoc.x *= rr / d; scLoc.y = cy + dy * rr / d; scLoc.z = cz + dz * rr / d;
    }
  }
  if (scLoc.equals(scOld)) return;
  body.localToWorld(scLoc);
  prev.add(tv3.subVectors(scLoc, p));
  p.copy(scLoc);
}
const SCARF_HEAD = [[2.36, 0, 0.54], [2.95, 0.2, 0.3]];
function updatePlayerVisual(dt, t) {
  playerG.position.copy(P.p);
  const hs = Math.hypot(P.v.x, P.v.z);
  if (hs > 1 && !P.charging) {
    const target = Math.atan2(-P.v.x, -P.v.z);
    let d = target - playerG.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    playerG.rotation.y += d * Math.min(1, 10 * dt);
  }
  // Pose alvo por estado; tudo amortecido para as transições ficarem macias.
  const shift = K.ShiftLeft || K.ShiftRight;
  const tg = { lean: 0, crouch: 0, bob: 0, aLx: 0, aLz: -0.12, aRx: 0, aRz: 0.12, lL: 0, lR: 0, head: 0 };
  let ropeArm = false;
  if (P.dash) {
    Object.assign(tg, { lean: 1.25, aLx: 1.3, aRx: 1.3, aLz: -0.35, aRz: 0.35, lL: 0.7, lR: 0.5, head: -0.5 });
  } else if (P.rope) {
    ropeArm = true;
    const sw = Math.sin(t * 5) * 0.25;
    Object.assign(tg, { lean: 0.15, aLx: 0.3 + sw, aLz: -0.7, lL: 0.4 + sw, lR: -0.2 - sw, head: -0.25 });
  } else if (P.gliding) {
    const fl = Math.sin(t * 7) * 0.06;
    Object.assign(tg, { lean: 1.15, aLz: -1.45 + fl, aRz: 1.45 - fl, aLx: -0.15, aRx: -0.15, lL: 0.45, lR: 0.35, head: -0.9 });
  } else if (P.charging && P.grounded) {
    const c = P.charge;
    Object.assign(tg, { lean: 0.35 * c, crouch: 0.3 * c, aLx: 1.0 * c, aRx: 1.0 * c, aLz: -0.25, aRz: 0.25, lL: -0.6 * c, lR: -0.6 * c, head: -0.3 * c });
  } else if (!P.grounded) {
    const up = clamp(P.v.y / 20, -1, 1);
    Object.assign(tg, { lean: 0.25 - up * 0.2, aLz: -0.7 - up * 0.4, aRz: 0.7 + up * 0.4, aLx: -0.3, aRx: -0.3, lL: 0.6, lR: -0.25, head: up * 0.2 });
    if (shift) Object.assign(tg, { lean: 0.9, aLz: -0.25, aRz: 0.25, aLx: 1.2, aRx: 1.2, lL: 0.3, lR: 0.3, head: -0.6 });
  } else if (shift && hs > 3) {
    Object.assign(tg, { lean: -0.12, crouch: 0.16, aLz: -0.85, aRz: 0.85, aLx: -0.25, aRx: 0.15, lL: -0.5, lR: 0.25, head: 0.1 });
  } else if (hs > 1.5) {
    const amp = clamp(hs / 18, 0, 1), ph = P.runPhase, s1 = Math.sin(ph);
    Object.assign(tg, { lean: clamp(hs / 110, 0, 0.5), bob: Math.abs(Math.cos(ph)) * 0.16 * amp, lL: s1 * 0.95 * amp, lR: -s1 * 0.95 * amp, aLx: -s1 * 0.75 * amp, aRx: s1 * 0.75 * amp, aLz: -0.12 - amp * 0.1, aRz: 0.12 + amp * 0.1, head: -0.1 * amp });
  } else {
    const br = Math.sin(t * 1.8);
    Object.assign(tg, { bob: br * 0.02, aLz: -0.1 - br * 0.02, aRz: 0.1 + br * 0.02, head: Math.sin(t * 0.6) * 0.08 });
  }
  const k = 1 - Math.exp(-(P.grounded && hs > 1.5 && !shift ? 22 : 11) * dt);
  for (const key in tg) pose[key] += (tg[key] - pose[key]) * k;
  body.rotation.x = -pose.lean;
  body.position.y = pose.bob - pose.crouch * 0.6;
  body.scale.set(1 + pose.crouch * 0.35, 1 - pose.crouch, 1 + pose.crouch * 0.35);
  headG.rotation.x = pose.head * 0.5; headG.rotation.y = pose.head > 0 ? 0 : Math.sin(t * 0.6) * 0.05;
  armL.rotation.set(pose.aLx, 0, pose.aLz - 0.24);
  legL.rotation.x = pose.lL; legR.rotation.x = pose.lR;
  if (ropeArm) {
    playerG.updateMatrixWorld(true);
    tv.copy(P.rope); body.worldToLocal(tv); tv.sub(armR.position).normalize();
    armR.rotation.set(Math.atan2(-tv.z, -tv.y), 0, Math.asin(clamp(tv.x, -1, 1)));
    pose.aRx = armR.rotation.x; pose.aRz = armR.rotation.z;
  } else armR.rotation.set(pose.aRx, 0, pose.aRz + 0.24);
  hoodMat.color.setHSL(0.012 + Math.sin(t * 0.7) * 0.006, 0.62, P.invuln > 0 && Math.floor(t * 14) % 2 ? 0.85 : 0.38);
  eyeGlow.color.setRGB(1, P.invuln > 0 ? 0.3 : 1, P.invuln > 0 ? 0.3 : 1);
  playerG.updateMatrixWorld(true);
  armR.localToWorld(handWorld.copy(HAND_LOCAL));

  const gh = groundH(P.p.x, P.p.z, P.p.y + 0.5);
  groundN(P.p.x, P.p.z, P.p.y + 0.5, tn);
  shadow.position.set(P.p.x, gh + 0.08, P.p.z);
  shadow.lookAt(P.p.x + tn.x, gh + 0.08 + tn.y, P.p.z + tn.z);
  const sh = 1 / (1 + (P.p.y - gh) * 0.04);
  shadow.scale.setScalar(sh);
  chargeRing.visible = P.charging && P.grounded;
  if (chargeRing.visible) {
    chargeRing.position.copy(shadow.position); chargeRing.position.y += 0.05;
    chargeRing.quaternion.copy(shadow.quaternion);
    chargeRing.scale.setScalar(0.6 + P.charge * 2.4);
  }

  rope.visible = !!P.rope;
  if (P.rope) {
    const arr = ropeGeo.attributes.position.array;
    const hx = handWorld.x, hy = handWorld.y, hz = handWorld.z;
    const slack = Math.max(0, P.ropeL - P.rope.distanceTo(P.p));
    for (let i = 0; i < 16; i++) {
      const u = i / 15;
      arr[i * 3] = lerp(hx, P.rope.x, u);
      arr[i * 3 + 1] = lerp(hy, P.rope.y, u) - Math.sin(u * Math.PI) * slack * 0.5 + Math.sin(u * 20 - t * 30) * 0.06;
      arr[i * 3 + 2] = lerp(hz, P.rope.z, u);
    }
    ropeGeo.attributes.position.needsUpdate = true;
  }

  // cachecol
  const count = 8 + Math.floor((P.imp / 100) * (SC_MAX - 8));
  const ang = playerG.rotation.y;
  body.localToWorld(tv2.set(0, 2.0, 0.44));
  scarfPts[0].copy(tv2); scarfPrev[0].copy(tv2);
  const sdt = Math.min(dt, 1 / 30);
  if (!scarfInit) { for (let i = 0; i < SC_MAX; i++) { scarfPts[i].set(tv2.x, tv2.y, tv2.z + i * SEG * 0.3); scarfPrev[i].copy(scarfPts[i]); } scarfInit = true; }
  const wind = 0.6 + Math.min(1, Math.hypot(P.v.x, P.v.z) / 40);
  for (let i = 1; i < SC_MAX; i++) {
    const a = scarfPts[i], b = scarfPrev[i];
    const vx = (a.x - b.x) * 0.84, vy = (a.y - b.y) * 0.84, vz = (a.z - b.z) * 0.84;
    b.copy(a);
    const fl = Math.sin(t * 8 - i * 0.55) * 0.05 * wind;
    a.x += vx + fl * Math.cos(ang); a.y += vy + (lerp(-7, 1.5, clamp(Math.hypot(P.v.x, P.v.z) / 25, 0, 1)) - i * 0.12) * sdt * sdt + Math.cos(t * 6.3 - i * 0.4) * 0.025 * wind; a.z += vz - fl * Math.sin(ang);
  }
  for (let it = 0; it < 2; it++) {
    for (let i = 1; i < SC_MAX; i++) {
      const a = scarfPts[i - 1], b = scarfPts[i];
      tv.subVectors(b, a); const l = tv.length() || 1e-4;
      const corr = 1 - SEG / l;
      b.addScaledVector(tv, -corr);
      scarfPrev[i].addScaledVector(tv, -corr * 0.9);
    }
    for (let i = 2; i < SC_MAX; i++) scarfCollide(scarfPts[i], scarfPrev[i]);
  }
  for (let i = 1; i < SC_MAX; i++) {
    const gh2 = height(scarfPts[i].x, scarfPts[i].z) + 0.1;
    if (scarfPts[i].y < gh2) scarfPts[i].y = gh2;
  }
  for (let i = 0; i < SC_MAX; i++) {
    const a = scarfPts[Math.min(i, count - 1)];
    const nb = scarfPts[Math.min(i + 1, count - 1)], pr = scarfPts[Math.max(i - 1, 0)];
    tv.subVectors(nb, pr);
    tv3.subVectors(camera.position, a);
    tv2.crossVectors(tv, tv3).normalize();
    const w = i >= count ? 0 : 0.24 * (1 - (i / count) * 0.5);
    const k = i * 6;
    scPos[k] = a.x + tv2.x * w; scPos[k + 1] = a.y + tv2.y * w; scPos[k + 2] = a.z + tv2.z * w;
    scPos[k + 3] = a.x - tv2.x * w; scPos[k + 4] = a.y - tv2.y * w; scPos[k + 5] = a.z - tv2.z * w;
  }
  scarfGeo.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Cores do céu e do mundo, que mudam com a região e com o tempo
// ---------------------------------------------------------------------------
// Cantos [frio seco, frio úmido, quente seco, quente úmido], misturados em dois eixos.
const SKY_TOP = [[0.42, 0.56, 0.72], [0.52, 0.6, 0.7], [0.24, 0.46, 0.76], [0.44, 0.6, 0.76]];
const SKY_HOR = [[0.82, 0.85, 0.88], [0.84, 0.87, 0.9], [0.9, 0.82, 0.68], [0.84, 0.87, 0.84]];
function biomeMix(wT, wM, c, out) {
  const k = (i) => lerp(lerp(c[0][i], c[1][i], wM), lerp(c[2][i], c[3][i], wM), wT);
  return out.setRGB(k(0), k(1), k(2));
}
function updateAtmos(t) {
  // Céu de verdade para cada clima: azul fundo e horizonte empoeirado no
  // deserto, branco úmido sobre a mata, cinza-azulado e frio na tundra.
  const [T, M] = climateAt(P.p.x, P.p.z, t);
  const wT = smooth(0.3, 0.7, T), wM = smooth(0.3, 0.7, M);
  biomeMix(wT, wM, SKY_TOP, skyU.uTop.value);
  biomeMix(wT, wM, SKY_HOR, skyU.uHor.value);
  terrU.uFog.value.copy(skyU.uHor.value);
  scene.fog.color.copy(skyU.uHor.value);
  const sa = t * 0.012 + 0.8;
  sunDir.set(Math.cos(sa) * 0.7, 0.42 + Math.sin(t * 0.009) * 0.14, Math.sin(sa) * 0.7).normalize();
  sunLight.position.copy(P.p).addScaledVector(sunDir, 100);
  sunLight.target.position.copy(P.p);
  // Lá do alto a névoa recua, para as montanhas aparecerem inteiras embaixo.
  const alt = Math.max(0, P.p.y - height(P.p.x, P.p.z));
  terrU.uFogNear.value = 330 + alt * 0.6; terrU.uFogFar.value = Math.min(1000, 860 + alt * 0.18);
  scene.fog.near = terrU.uFogNear.value + 20; scene.fog.far = terrU.uFogFar.value + 20;
  skyU.uTime.value = t; terrU.uTime.value = t;
  terrU.uPlayer.value.copy(P.p); terrU.uCam.value.copy(camera.position);
  sky.position.copy(camera.position);
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const startBtn = $('start');
const fmt = (n) => Math.floor(n).toLocaleString('pt-BR');
const FD = '"Bricolage Grotesque", Archivo, sans-serif', FB = 'Archivo, "Helvetica Neue", Arial, sans-serif';
if (document.fonts) {
  Promise.all(['800 100px "Bricolage Grotesque"', '500 20px "Bricolage Grotesque"', '400 16px Archivo', '600 16px Archivo']
    .map((f) => document.fonts.load(f).catch(() => null))).then(() => { uiDirty = true; signJump.userData.draw(); signShift.userData.draw(); });
}
const TXT = {
  lead: 'Uma ilha solta no céu, e embaixo uma terra sem fim que se refaz enquanto você atravessa: dunas, savanas, matas, estepes, tundra e neve. Daqui só se vai para a frente, e uma boca enorme vem atrás, cada vez mais rápida. Não perca velocidade: deslize nas descidas, se pendure nos olhos do céu, passe pelos aros e derrube as bocas menores que tentam te frear. Se ela te alcançar, te engole.',
  keys: [
    ['Mouse', 'Mira. A câmera olha um pouco para o lado do ponteiro.'],
    ['A D', 'Desviar. Você corre sozinho e nunca volta.'],
    ['W', 'Andar na ilha, antes do salto'],
    ['Espaço', 'Saltar. Segure no chão para um salto longo.'],
    ['Espaço no ar', 'Planar enquanto segurar'],
    ['Shift', 'Deslizar no chão e mergulhar no ar'],
    ['Botão esquerdo', 'Segure sobre um olho ou sobre o chão. A corda te puxa até lá.'],
    ['Botão direito ou F', 'Golpeia a boca sob o ponteiro. Sem alvo, dá um impulso.'],
    ['B', 'Liga e desliga o pontilhado'],
    ['Esc', 'Pausa'],
  ],
  tip: 'Segure Shift ao cair e a queda vira velocidade quando você tocar o chão. Os aros dourados e cada boca derrubada também aceleram.',
};
let best = 0, statusText = '', btnLabel = 'Começar';
try { best = Number(localStorage.getItem('deriva-recorde')) || 0; } catch (e) { best = 0; }
function showBest() { $('best').textContent = best > 0 ? `Recorde: ${fmt(best)} m` : ''; uiDirty = true; }
function setStatus(t) { statusText = t; $('status').textContent = t; uiDirty = true; }
showBest();
if (coarseOnly) {
  setStatus('Deriva se joga com teclado e mouse. No celular dá para assistir o mundo passar.');
  startBtn.disabled = true;
}
let toastText = '', toastT = -99;
function toast(msg) { toastText = msg; toastT = time; $('toast').textContent = msg; uiDirty = true; }
let flashV = 0;
function flash(a) { flashV = Math.max(flashV, a); }
let comboT = -99;
function showCombo() { comboT = time; }
function saveBest() {
  if (P.dist > best) { best = P.dist; try { localStorage.setItem('deriva-recorde', String(Math.floor(best))); } catch (e) { /* sem armazenamento, segue */ } }
}
function play() {
  if (coarseOnly) return;
  state = 'play';
  $('panel').hidden = true; startBtn.hidden = true;
  btnLabel = 'Continuar'; startBtn.textContent = btnLabel;
  uiDirty = true;
}
function pause() {
  state = 'paused';
  saveBest(); showBest();
  for (const k in K) K[k] = false; lmb = rmb = spaceHeld = false; P.charging = false; releaseRope();
  setStatus(`Pausado em ${fmt(P.dist)} m.`);
  $('panel').hidden = false; startBtn.hidden = false;
  setAim('repouso');
  startBtn.focus({ preventScroll: true });
}
// Recomeçar recarrega a página e entra direto no jogo: o mundo inteiro (ilha,
// trilha, caches) nasce limpo, sem precisar desfazer estado à mão.
startBtn.addEventListener('click', () => {
  if (state !== 'dead') { play(); return; }
  try { sessionStorage.setItem('deriva-auto', '1'); } catch (e) { /* sem armazenamento, segue */ }
  location.reload();
});
startBtn.addEventListener('focus', () => { uiDirty = true; });
startBtn.addEventListener('blur', () => { uiDirty = true; });

// --- Pintura da interface --------------------------------------------------
function wrap(text, maxW) {
  const words = text.split(' '), lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g2.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function outlined(text, x, y, lw = 4) {
  g2.lineJoin = 'round'; g2.lineWidth = lw; g2.strokeStyle = '#000';
  g2.strokeText(text, x, y); g2.fillText(text, x, y);
}
let btnRect = null;
function drawPanel() {
  const PW = Math.min(560, W - 48), pad = 28, inner = PW - pad * 2;
  const ops = []; let y = pad;
  const tSize = Math.round(clamp(W * 0.11, 64, 132));
  ops.push(['title', y + tSize * 0.8, tSize]); y += tSize * 0.86 + 18;
  g2.font = `400 17px ${FB}`;
  for (const l of wrap(TXT.lead, Math.min(inner, 430))) { ops.push(['text', y + 17, l, `400 17px ${FB}`, '#fff', 0]); y += 24.5; }
  y += 18;
  if (statusText) {
    g2.font = `600 15px ${FB}`;
    for (const l of wrap(statusText, inner)) { ops.push(['text', y + 15, l, `600 15px ${FB}`, '#fff', 0]); y += 21; }
    y += 16;
  }
  g2.font = `600 14px ${FB}`;
  const dtW = Math.max(...TXT.keys.map(([k]) => g2.measureText(k).width));
  const colX = dtW + 20, colW = inner - colX;
  for (const [kk, dd] of TXT.keys) {
    ops.push(['text', y + 14, kk, `600 14px ${FB}`, '#fff', 0]);
    g2.font = `400 14px ${FB}`;
    const ls = wrap(dd, colW);
    ls.forEach((l, i) => ops.push(['text', y + 14 + i * 19, l, `400 14px ${FB}`, '#e4e4e4', colX]));
    y += Math.max(1, ls.length) * 19 + 7;
  }
  y += 14;
  g2.font = `400 14px ${FB}`;
  const tl = wrap(TXT.tip, Math.min(inner - 14, 400));
  ops.push(['bar', y, tl.length * 20]);
  tl.forEach((l, i) => ops.push(['text', y + 15 + i * 20, l, `400 14px ${FB}`, '#fff', 14]));
  y += tl.length * 20 + 24;
  g2.font = `500 19px ${FD}`;
  const bw = g2.measureText(btnLabel).width + 52, bh = 50;
  ops.push(['button', y, bw, bh]);
  if (best > 0) ops.push(['text', y + 30, `Recorde: ${fmt(best)} m`, `400 14px ${FB}`, '#e4e4e4', bw + 18]);
  y += bh + pad;

  const avail = H - 48;
  const sc = Math.min(1, avail / y);
  const x0 = 24, y0 = H - 24 - y * sc;
  g2.save(); g2.translate(x0, y0); g2.scale(sc, sc);
  // Fundo: preto sólido sob o texto, rareando só na faixa do título; o
  // pontilhado transforma essa transparência numa trama por onde o mundo aparece.
  const edge = pad + tSize * 0.9;
  const bg = g2.createLinearGradient(0, 0, 0, edge);
  bg.addColorStop(0, 'rgba(0,0,0,0.15)'); bg.addColorStop(1, 'rgba(0,0,0,1)');
  g2.fillStyle = bg; g2.fillRect(0, 0, PW, y);
  g2.textBaseline = 'alphabetic';
  for (const op of ops) {
    if (op[0] === 'title') {
      g2.font = `800 ${op[2]}px ${FD}`;
      const tg = g2.createLinearGradient(0, op[1] - op[2] * 0.75, 0, op[1] + op[2] * 0.05);
      tg.addColorStop(0, '#fff'); tg.addColorStop(0.55, '#fff'); tg.addColorStop(1, '#6e6e6e');
      g2.fillStyle = tg;
      try { g2.letterSpacing = `${-0.05 * op[2]}px`; } catch (e) { /* sem letterSpacing */ }
      g2.fillText('Deriva', pad - op[2] * 0.04, op[1]);
      try { g2.letterSpacing = '0px'; } catch (e) { /* idem */ }
    } else if (op[0] === 'text') {
      g2.font = op[3]; g2.fillStyle = op[4]; g2.fillText(op[2], pad + op[5], op[1]);
    } else if (op[0] === 'bar') {
      g2.fillStyle = '#fff'; g2.fillRect(pad, op[1], 2, op[2]);
    } else if (op[0] === 'button') {
      const [, by, bw2, bh2] = op;
      const sx = x0 + pad * sc, sy = y0 + by * sc;
      btnRect = { x: sx, y: sy, w: bw2 * sc, h: bh2 * sc };
      const over = !coarseOnly && mouse.inside && mouse.x >= sx && mouse.x <= sx + bw2 * sc && mouse.y >= sy && mouse.y <= sy + bh2 * sc;
      const down = over && menuDown;
      g2.fillStyle = coarseOnly ? '#555' : down ? '#000' : over ? '#9a9a9a' : '#fff';
      g2.fillRect(pad, by, bw2, bh2);
      if (down) { g2.strokeStyle = '#fff'; g2.lineWidth = 2; g2.strokeRect(pad + 1, by + 1, bw2 - 2, bh2 - 2); }
      if (document.activeElement === startBtn) { g2.strokeStyle = '#fff'; g2.lineWidth = 2; g2.strokeRect(pad - 4, by - 4, bw2 + 8, bh2 + 8); }
      g2.font = `500 19px ${FD}`; g2.fillStyle = down ? '#fff' : '#000';
      g2.fillText(btnLabel, pad + 26, by + 32);
      if (over) setAim(down ? 'clique' : 'hover'); else setAim('repouso');
    }
  }
  g2.restore();
  if (btnRect) Object.assign(startBtn.style, { left: btnRect.x + 'px', top: btnRect.y + 'px', width: btnRect.w + 'px', height: btnRect.h + 'px' });
}
function drawHUD() {
  g2.textBaseline = 'alphabetic';
  // A Boca: escuridão que fecha pelas bordas quando ela chega perto, e a
  // distância no alto, no centro.
  if (CH.on) {
    const near = smooth(110, 15, CH.gap);
    if (near > 0) {
      const vg = g2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.62 - near * 0.3), W / 2, H / 2, Math.hypot(W, H) * 0.55);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${(0.35 + near * 0.6).toFixed(3)})`);
      g2.fillStyle = vg; g2.fillRect(0, 0, W, H);
    }
    const gap = Math.max(0, Math.round(CH.gap - CH_EAT));
    g2.textAlign = 'center';
    g2.font = `400 13px ${FB}`; g2.fillStyle = '#fff';
    outlined('a boca está a', W / 2, 30, 3);
    g2.font = `800 30px ${FD}`;
    const gg = g2.createLinearGradient(0, 64 - 22, 0, 64);
    gg.addColorStop(0, '#fff'); gg.addColorStop(0.45, '#fff'); gg.addColorStop(1, '#5c5c5c'); g2.fillStyle = gg;
    outlined(`${gap} m`, W / 2, 64, 5);
    const bw = Math.min(220, W * 0.4), bx = W / 2 - bw / 2;
    g2.fillStyle = '#000'; g2.fillRect(bx, 74, bw, 6);
    g2.fillStyle = '#fff'; g2.fillRect(bx + 1, 75, (bw - 2) * clamp(gap / (CH_START + 140), 0, 1), 4);
    g2.textAlign = 'left';
  }
  // Números com degradê de branco para cinza, como o título: o retículo
  // transforma a parte de baixo de cada algarismo em pontos.
  const grad = (y, size) => {
    const gr = g2.createLinearGradient(0, y - size * 0.74, 0, y);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#ffffff'); gr.addColorStop(1, '#5c5c5c');
    return gr;
  };
  g2.font = `800 26px ${FD}`;
  g2.fillStyle = grad(44, 26);
  outlined(`${fmt(P.dist)} m`, 24, 44, 5);
  const sp = String(Math.round(P.v.length() * 3.6));
  g2.font = `800 72px ${FD}`;
  try { g2.letterSpacing = '-2px'; } catch (e) { /* sem letterSpacing */ }
  const bottom = H - 24;
  g2.fillStyle = grad(bottom - 30, 72);
  outlined(sp, 22, bottom - 30, 5);
  const sw = g2.measureText(sp).width;
  try { g2.letterSpacing = '0px'; } catch (e) { /* idem */ }
  g2.font = `500 18px ${FD}`;
  g2.fillStyle = '#c8c8c8';
  outlined('km/h', 30 + sw, bottom - 30);
  // Barra de ímpeto: rampa de cinza para branco, que o retículo vira gradiente pontilhado.
  const bw = Math.min(180, W * 0.3), by = bottom - 14;
  g2.fillStyle = '#000'; g2.fillRect(24, by, bw, 10);
  const rg = g2.createLinearGradient(24, 0, 24 + bw, 0);
  rg.addColorStop(0, '#4a4a4a'); rg.addColorStop(1, '#ffffff');
  g2.fillStyle = rg; g2.fillRect(25, by + 1, (bw - 2) * P.imp / 100, 8);
  g2.strokeStyle = '#fff'; g2.lineWidth = 1; g2.strokeRect(24.5, by + 0.5, bw - 1, 9);
  g2.font = `400 13px ${FB}`; g2.fillStyle = '#fff';
  outlined('ímpeto', 34 + bw, by + 10, 3);
  if (P.charging && P.grounded) {
    const cw = 120;
    g2.fillStyle = 'rgba(0,0,0,0.7)'; g2.fillRect(W / 2 - cw / 2, H / 2 + 46, cw, 6);
    g2.fillStyle = '#fff'; g2.fillRect(W / 2 - cw / 2, H / 2 + 46, cw * P.charge, 6);
  }
  const ct = time - comboT;
  if (ct < 1.6 && combo >= 2) {
    const a = ct < 1.1 ? 1 : 1 - (ct - 1.1) / 0.5;
    const s = reduceMotion ? 1 : ct < 0.18 ? 1.5 - ct / 0.18 * 0.5 : 1;
    g2.save(); g2.globalAlpha = clamp(a, 0, 1);
    g2.translate(W / 2, H * 0.78 - (reduceMotion ? 0 : Math.max(0, ct - 1.1) * 24)); g2.scale(s, s);
    g2.font = `800 56px ${FD}`; g2.textAlign = 'center';
    const cg = g2.createLinearGradient(0, -42, 0, 0); cg.addColorStop(0, '#fff'); cg.addColorStop(0.45, '#fff'); cg.addColorStop(1, '#5c5c5c'); g2.fillStyle = cg;
    outlined(`×${combo}`, 0, 0, 5);
    g2.restore();
  }
}
// Mira do jogo: anel aberto em repouso, anel com marcas sobre um alvo,
// ponto cheio com a corda ou o golpe ativos. Contorno preto para ler em
// qualquer chão.
function drawReticle(x, y) {
  x = Math.round(x) + 0.5; y = Math.round(y) + 0.5;
  const ring = (r, lw) => {
    g2.beginPath(); g2.arc(x, y, r, 0, Math.PI * 2);
    g2.strokeStyle = '#000'; g2.lineWidth = lw + 3; g2.stroke();
    g2.strokeStyle = '#fff'; g2.lineWidth = lw; g2.stroke();
  };
  const dot = (r) => {
    g2.beginPath(); g2.arc(x, y, r + 1.5, 0, Math.PI * 2); g2.fillStyle = '#000'; g2.fill();
    g2.beginPath(); g2.arc(x, y, r, 0, Math.PI * 2); g2.fillStyle = '#fff'; g2.fill();
  };
  if (aimState === 'clique') { ring(7, 2); dot(3); return; }
  if (aimState === 'hover') {
    ring(13, 2);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s2 = Math.sin(a);
      g2.beginPath(); g2.moveTo(x + c * 16, y + s2 * 16); g2.lineTo(x + c * 23, y + s2 * 23);
      g2.strokeStyle = '#000'; g2.lineWidth = 5; g2.stroke();
      g2.strokeStyle = '#fff'; g2.lineWidth = 2; g2.stroke();
    }
    dot(2);
    return;
  }
  ring(9, 2);
  dot(1.5);
}
function drawUI() {
  g2.clearRect(0, 0, W, H);
  if (state === 'play' || state === 'eaten') drawHUD(); else drawPanel();
  if (state === 'eaten') { g2.fillStyle = `rgba(0,0,0,${clamp(eatenT * 1.2, 0, 1).toFixed(3)})`; g2.fillRect(0, 0, W, H); }
  const tt = time - toastT;
  if (tt < 2.2 && toastText) {
    g2.save(); g2.globalAlpha = tt < 1.6 ? 1 : 1 - (tt - 1.6) / 0.6;
    g2.font = `400 13px ${FB}`; g2.textAlign = 'right'; g2.fillStyle = '#fff';
    outlined(toastText, W - 24, H - 28, 3);
    g2.restore();
  }
  if (flashV > 0) { g2.fillStyle = `rgba(255,255,255,${flashV.toFixed(3)})`; g2.fillRect(0, 0, W, H); }
  if (state === 'play') {
    if (mouse.inside) drawReticle(mouse.x, mouse.y);
  } else if (state !== 'eaten' && mouse.inside && !coarseOnly) {
    const im = hands[aimState];
    if (im && im.complete) g2.drawImage(im, Math.round(mouse.x - HOT[aimState][0]), Math.round(mouse.y - HOT[aimState][1]));
  }
  uiTex.needsUpdate = true;
}
canvas.tabIndex = -1;

// ---------------------------------------------------------------------------
// Laço principal
// ---------------------------------------------------------------------------
camYaw = spawnYaw;
startJob(Math.round(P.p.x / SNAP) * SNAP, Math.round(P.p.z / SNAP) * SNAP);
stepJob(N);
let last = performance.now(), hudClock = 0, saveClock = 0;
const prevP = new THREE.Vector3().copy(P.p);
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  time += dt;

  if (state === 'play') {
    if (hitstop > 0) hitstop -= dt;
    else {
      const sub = 4;
      for (let i = 0; i < sub; i++) step(dt / sub);
    }
    updateEnemies(dt, time);
    updateChaser(dt, time);
    checkContacts(time);
    P.dist = Math.max(P.dist, courseU(P.p.x, P.p.z) - U0);
    saveClock += dt; if (saveClock > 2) { saveClock = 0; saveBest(); }
  }
  prevP.copy(P.p);
  if (state === 'eaten') {
    eatenT += dt;
    updateChaser(dt, time);
    if (eatenT > 1.1) finishSwallow();
  }

  updateIntro(dt, time);
  updateCamera(dt, time);
  updateAtmos(time);
  updateProps(time);
  updatePlayerVisual(dt, time);
  updateParts(dt);

  pick();
  if (state === 'play') setAim(lmb || rmb || P.dash ? 'clique' : hover ? 'hover' : 'repouso');
  if (hover && state === 'play') {
    const tp = hover.type === 'enemy' ? hover.e.pos : tv3.set(hover.o.x, hover.o.y, hover.o.z);
    marker.visible = true;
    marker.position.copy(tp);
    marker.quaternion.copy(camera.quaternion);
    const s = camera.position.distanceTo(tp) * 0.045 * (1 + Math.sin(time * 10) * 0.08);
    marker.scale.setScalar(Math.max(s, hover.type === 'enemy' ? 3.4 : 4.4));
  } else marker.visible = false;

  if (!job) {
    const dx = P.p.x - centerX, dz = P.p.z - centerZ;
    if (dx * dx + dz * dz > 150 * 150) {
      const ax = P.p.x + P.v.x * 1.2, az = P.p.z + P.v.z * 1.2;
      startJob(Math.round(ax / SNAP) * SNAP, Math.round(az / SNAP) * SNAP);
    }
  }
  if (job) stepJob(state === 'play' ? 22 : 40);

  phaseClock += dt * 1000;
  if (phaseClock >= 175) { phaseClock %= 175; if (!reduceMotion) phaseIndex = (phaseIndex + 1) % 4; }
  postMat.uniforms.uPhase.value.set(PHASES[phaseIndex][0], PHASES[phaseIndex][1]);

  const flashing = flashV > 0;
  flashV = Math.max(0, flashV - dt * 3);
  hudClock += dt;
  const animating = flashing || time - comboT < 1.7 || time - toastT < 2.3 || (P.charging && state === 'play');
  if (uiDirty || animating || (state === 'play' && hudClock > 0.05) || (state !== 'play' && mouse.inside)) {
    hudClock = 0; uiDirty = false;
    drawUI();
  }

  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}
requestAnimationFrame(frame);
try { if (sessionStorage.getItem('deriva-auto')) { sessionStorage.removeItem('deriva-auto'); play(); } } catch (e) { /* idem */ }
})();
