/* Aube — Les Reliques du Gardien
   Jeu d'aventure 3D pour Kairos, sur le moteur PlayCanvas (MIT) — WebGPU avec repli WebGL 2.
   Monde, modèles et animations procéduraux ; musique et bruitages synthétisés (Web Audio). */
import * as pc from '../vendor/playcanvas-2.24.0.min.mjs';

/* =====================================================================
   Réglages, sauvegarde, utilitaires
   ===================================================================== */
const SETTINGS_KEY = 'aube.settings.v1', SAVE_KEY = 'aube.save.v1';
const DEFAULTS = { quality: 'high', renderer: 'auto', sensitivity: 1, fov: 68, volume: 0.8, music: 0.55, sfx: 0.9, invertY: false, shake: true, showFps: false };
const settings = { ...DEFAULTS, ...(() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } })() };
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* stockage plein */ } };
const QUALITY = {
  low: { ratio: 0.85, shadows: 1024, cascades: 1, frame: false, ssao: false, samples: 1, trees: 0.55, grass: 0.25, fog: 0.75 },
  medium: { ratio: 1, shadows: 2048, cascades: 2, frame: true, ssao: false, samples: 1, trees: 0.8, grass: 0.55, fog: 0.9 },
  high: { ratio: 1.5, shadows: 2048, cascades: 3, frame: true, ssao: false, samples: 4, trees: 1, grass: 0.9, fog: 1 },
  ultra: { ratio: 2, shadows: 4096, cascades: 4, frame: true, ssao: true, samples: 4, trees: 1.15, grass: 1.3, fog: 1.1 },
};
const Q = () => QUALITY[settings.quality] || QUALITY.high;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (dx, dz, s) => Math.exp(-(dx * dx + dz * dz) / (2 * s * s));
const angleLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261111);
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const col = (h) => new pc.Color(...hex(h));
const fmtTime = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s % 60).padStart(2, '0')} s`; };
const inFrame = window.parent !== window;
const tick = () => new Promise((r) => setTimeout(r, 0));

/* =====================================================================
   Bruit et relief de l'île
   ===================================================================== */
const PERM = new Uint8Array(512); { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const GR = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10), u = f(xf), v = f(yf);
  const g = (h, a, b) => { const q = GR[h & 7]; return q[0] * a + q[1] * b; };
  const aa = PERM[PERM[X] + Y], ab = PERM[PERM[X] + Y + 1], ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1];
  return lerp(lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u), lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u), v) * 1.4;
}
const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; };

const WORLD = 560, N = 256, CELL = WORLD / N, HALF = WORLD / 2, SEA = 0;
function shape(x, z) {
  const r = Math.hypot(x * 0.95, z) + fbm(x * 0.006 + 3.1, z * 0.006 - 1.7, 4) * 45;
  const land = 1 - smooth(165, 245, r);
  let h = -8 + land * (10 + fbm(x * 0.018, z * 0.018, 4) * 6);
  h += land * gauss(x + 120, z - 30, 70) * (5 + 4 * fbm(x * 0.03, z * 0.03, 3));
  const rid = 1 - Math.abs(noise(x * 0.025 + 10, z * 0.025));
  h += land * gauss(x, z + 150, 80) * (14 + 20 * rid * rid);
  h -= gauss(x - 158, z + 48, 30) * 15;
  h = lerp(h, 2.6, gauss(x, z - 158, 42) * 0.7);
  return h;
}
const ZONES = {
  forest: { key: 'forest', name: 'Forêt murmurante', sub: 'Ouest de l’île', x: -120, z: 30, r: 48, color: '#9BE36B', shardName: 'Éclat de sève' },
  lake: { key: 'lake', name: 'Ruines du lac', sub: 'Est de l’île', x: 112, z: -14, r: 44, color: '#6FC6FF', shardName: 'Éclat d’écume' },
  ridge: { key: 'ridge', name: 'Crête de cristal', sub: 'Nord de l’île', x: 0, z: -140, r: 46, color: '#C59BFF', shardName: 'Éclat de givre' },
};
const PLACES = { temple: { x: 0, z: 0 }, camp: { x: 0, z: 150 } };
const FLATS = [
  { x: 0, z: 0, r: 34, h: 9.5 }, { x: 0, z: 150, r: 16 }, { x: -120, z: 30, r: 24 }, { x: 112, z: -14, r: 24 }, { x: 0, z: -140, r: 32 },
  { x: -88, z: 42, r: 7 }, { x: 88, z: -4, r: 7 }, { x: 6, z: -100, r: 7 }, { x: 0, z: 28, r: 6 },
];
for (const f of FLATS) if (f.h === undefined) f.h = Math.max(3, shape(f.x, f.z));
const PATHS = [
  [[0, 146], [6, 110], [-4, 70], [2, 34]], [[-30, 0], [-62, 14], [-96, 30], [-116, 30]],
  [[30, -2], [62, -6], [96, -12], [110, -14]], [[0, -32], [8, -70], [4, -104], [0, -132]],
];
function pathDist(x, z) {
  let d = 1e9;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1], vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return d;
}
function heightAt(x, z) {
  let h = shape(x, z);
  for (const f of FLATS) { const d = Math.hypot(x - f.x, z - f.z); if (d < f.r) h = lerp(h, f.h, 1 - smooth(f.r * 0.6, f.r, d)); }
  const pd = pathDist(x, z); if (pd < 5 && h > 1) h = lerp(h, h - 0.25, 1 - pd / 5);
  return h;
}
const HM = new Float32Array((N + 1) * (N + 1));
function terrainH(x, z) {                // hauteur exacte du maillage (triangles)
  const gx = clamp((x + HALF) / CELL, 0, N - 0.0001), gz = clamp((z + HALF) / CELL, 0, N - 0.0001);
  const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz, i = iz * (N + 1) + ix;
  const h00 = HM[i], h10 = HM[i + 1], h01 = HM[i + N + 1], h11 = HM[i + N + 2];
  return u + v < 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
const FLOORS = [];                        // sols construits (marches du temple…)
function groundAt(x, z) { let h = terrainH(x, z); for (const f of FLOORS) if (Math.hypot(x - f.x, z - f.z) < f.r) h = Math.max(h, f.h); return h; }
function findLand(x, z, minH = 2.2) { for (let r = 0; r < 60; r += 2) for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (heightAt(px, pz) > minH) return [px, pz]; } return [x, z]; }

const SRGB2LIN = new Uint8Array(256).map((_, i) => Math.round(Math.pow(i / 255, 2.2) * 255));
/* =====================================================================
   Géométrie low-poly (facettes plates, couleurs par face)
   ===================================================================== */
class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; }
  tri(a, b, c, color, jitter = 0.06) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const k = 1 + (R() - 0.5) * jitter, r = clamp(color[0] * k, 0, 1) * 255, g = clamp(color[1] * k, 0, 1) * 255, bl = clamp(color[2] * k, 0, 1) * 255;
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.c.push(r, g, bl, 255); }
  }
  triC(a, b, c, ca, cb, cc) {   // dégradé : une couleur par sommet
    for (const [v, k] of [[a, ca], [b, cb], [c, cc]]) { this.p.push(v[0], v[1], v[2]); this.n.push(0, -1, 0); this.c.push(k[0] * 255, k[1] * 255, k[2] * 255, 255); }
  }
  quad(a, b, c, d, color, j) { this.tri(a, b, c, color, j); this.tri(a, c, d, color, j); }
  ring(cx, cy, cz, r, segs, rot = 0) { return [...Array(segs)].map((_, i) => { const t = rot + i / segs * Math.PI * 2; return [cx + Math.cos(t) * r, cy, cz + Math.sin(t) * r]; }); }
  cone(x, y, z, r, h, segs, color, rot = R() * 6) { const b = this.ring(x, y, z, r, segs, rot), tip = [x, y + h, z]; for (let i = 0; i < segs; i++) this.tri(b[i], tip, b[(i + 1) % segs], color); }
  frustum(x, y, z, r1, r2, h, segs, color, rot = R() * 6, caps = true) {
    const a = this.ring(x, y, z, r1, segs, rot), b = this.ring(x, y + h, z, r2, segs, rot);
    for (let i = 0; i < segs; i++) { const j = (i + 1) % segs; this.quad(a[i], b[i], b[j], a[j], color); }
    if (caps) { for (let i = 1; i < segs - 1; i++) this.tri(b[0], b[i], b[i + 1], color); }
  }
  box(x, y, z, sx, sy, sz, color, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (dx, dy, dz) => [x + dx * c - dz * s, y + dy, z + dx * s + dz * c];
    const v = [P(-sx, 0, -sz), P(sx, 0, -sz), P(sx, 0, sz), P(-sx, 0, sz), P(-sx, sy * 2, -sz), P(sx, sy * 2, -sz), P(sx, sy * 2, sz), P(-sx, sy * 2, sz)];
    [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]].forEach(([a, b, cc, d]) => this.quad(v[a], v[b], v[cc], v[d], color));
  }
  rock(x, y, z, s, color, sy = 0.7) {        // icosaèdre déformé
    const t = (1 + Math.sqrt(5)) / 2, V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map(([a, b, c]) => { const k = s * (0.75 + R() * 0.5) / Math.hypot(a, b, c); return [x + a * k, y + b * k * sy, z + c * k]; });
    [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
      .forEach(([a, b, c]) => this.tri(V[a], V[b], V[c], color, 0.1));
  }
  sphere(x, y, z, r, color, segs = 7, rings = 5, sy = 1) {
    const pt = (i, j) => { const th = i / segs * Math.PI * 2, ph = j / rings * Math.PI; return [x + Math.cos(th) * Math.sin(ph) * r, y + Math.cos(ph) * r * sy, z + Math.sin(th) * Math.sin(ph) * r]; };
    for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) { const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1); if (j > 0) this.tri(a, b, c, color); if (j < rings - 1) this.tri(a, c, d, color); }
  }
  get empty() { return !this.p.length; }
  mesh(device) {
    const m = new pc.Mesh(device);
    // couleurs de sommets : sRGB → linéaire (le moteur les interprète en linéaire)
    const c = new Uint8Array(this.c.length); for (let i = 0; i < c.length; i++) c[i] = (i & 3) === 3 ? this.c[i] : SRGB2LIN[Math.round(this.c[i])];
    m.setPositions(new Float32Array(this.p)); m.setNormals(new Float32Array(this.n)); m.setColors32(c);
    m.update(pc.PRIMITIVE_TRIANGLES); return m;
  }
}

/* =====================================================================
   Audio : musique générative et bruitages synthétisés
   ===================================================================== */
const Audio = (() => {
  let ctx = null, master, music, sfx, verb, mode = 'explore', nextNote = 0, step = 0, timer = null;
  const SCALE = { explore: [62, 64, 66, 69, 71, 74, 76, 78], boss: [57, 60, 62, 63, 65, 67, 69, 70], dawn: [62, 66, 69, 71, 74, 78, 81, 83] };
  const CHORDS = { explore: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]], boss: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 58], [40, 47, 52, 56]], dawn: [[50, 57, 62, 66], [55, 62, 67, 71], [57, 64, 69, 73], [52, 59, 64, 69]] };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ctx.createGain(); music = ctx.createGain(); sfx = ctx.createGain(); verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
    verb.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.32;
    music.connect(master); sfx.connect(master); music.connect(verb); sfx.connect(verb); verb.connect(wet); wet.connect(master); master.connect(ctx.destination);
    apply(); nextNote = ctx.currentTime + 0.2; timer = setInterval(schedule, 90);
  }
  function apply() { if (!ctx) return; master.gain.value = settings.volume; music.gain.value = settings.music * 0.55; sfx.gain.value = settings.sfx; }
  function voice(t, f, dur, type, gain, dest, attack = 0.02, cutoff = 2400) {
    const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(fl); fl.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const bpm = mode === 'boss' ? 118 : 72, beat = 60 / bpm;
    while (nextNote < ctx.currentTime + 0.4) {
      const t = nextNote, bar = Math.floor(step / 8) % 4, ch = CHORDS[mode][bar];
      if (step % 8 === 0) ch.forEach((m, i) => { voice(t, hz(m), beat * 8.4, 'triangle', 0.05, music, 0.9, 900); voice(t, hz(m) * 1.004, beat * 8.4, 'sawtooth', 0.012, music, 1.2, 700 + i * 80); });
      const sc = SCALE[mode];
      if ((mode === 'boss' ? step % 2 === 0 : Math.random() < 0.55)) voice(t, hz(sc[Math.floor(Math.random() * sc.length)] + (Math.random() < 0.2 ? 12 : 0)), beat * 1.6, 'sine', 0.05, music, 0.01, 3000);
      if (mode === 'boss' && step % 2 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); g.connect(music); o.start(t); o.stop(t + 0.3); }
      nextNote += beat / 2; step++;
    }
  }
  function noiseBurst(dur, freq, q, gain, sweep) {
    if (!ctx) return; const t = ctx.currentTime, b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur); f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(sfx); s.start(t);
  }
  const tone = (f, dur, type = 'sine', gain = 0.2, delay = 0) => { if (ctx) voice(ctx.currentTime + delay, f, dur, type, gain, sfx, 0.005, 5000); };
  const SFX = {
    swing: () => noiseBurst(0.18, 1800, 1.2, 0.35, 600), hit: () => { noiseBurst(0.12, 400, 0.8, 0.6); tone(120, 0.15, 'square', 0.12); },
    hurt: () => { tone(220, 0.2, 'sawtooth', 0.18); tone(150, 0.25, 'sawtooth', 0.14, 0.05); }, step: (sand) => noiseBurst(0.06, sand ? 2400 : 900, 2, 0.06),
    jump: () => tone(330, 0.15, 'triangle', 0.12), land: () => noiseBurst(0.09, 300, 1, 0.18), dodge: () => noiseBurst(0.25, 900, 0.7, 0.25, 300),
    pickup: () => [0, 4, 7, 12].forEach((n, i) => tone(hz(74 + n), 0.3, 'sine', 0.12, i * 0.06)), heal: () => [0, 5, 9].forEach((n, i) => tone(hz(79 + n), 0.4, 'sine', 0.1, i * 0.08)),
    shard: () => [0, 7, 12, 16, 19, 24].forEach((n, i) => tone(hz(62 + n), 1.2, 'triangle', 0.13, i * 0.09)), rune: () => { tone(hz(81), 1.4, 'sine', 0.16); tone(hz(88), 1.2, 'sine', 0.08, 0.02); },
    wrong: () => { tone(110, 0.35, 'square', 0.12); tone(104, 0.35, 'square', 0.12); }, checkpoint: () => [0, 4, 7, 11, 14].forEach((n, i) => tone(hz(62 + n), 1.5, 'triangle', 0.1, i * 0.1)),
    blip: () => tone(hz(86 + Math.floor(Math.random() * 3)), 0.04, 'square', 0.025), enemyHit: () => { noiseBurst(0.1, 700, 1, 0.45); tone(90, 0.12, 'triangle', 0.15); },
    death: () => { noiseBurst(0.6, 600, 0.6, 0.4, 80); tone(hz(50), 0.8, 'sawtooth', 0.12); }, slam: () => { noiseBurst(0.7, 140, 0.5, 0.9, 50); tone(55, 0.6, 'sine', 0.4); },
    open: () => [0, 3, 7, 10, 14].forEach((n, i) => tone(hz(57 + n), 1.2, 'sine', 0.12, i * 0.12)),
    arrow: () => noiseBurst(0.12, 2600, 3, 0.25, 900), arrowHit: () => noiseBurst(0.08, 1200, 2, 0.3),
    boom: () => { noiseBurst(0.6, 200, 0.5, 0.8, 60); tone(70, 0.5, 'sine', 0.35); }, fireCast: () => noiseBurst(0.35, 600, 0.8, 0.35, 2400),
    freeze: () => { [0, 3, 7, 12].forEach((n, i) => tone(hz(88 + n), 0.6, 'triangle', 0.08, i * 0.03)); noiseBurst(0.5, 5000, 1, 0.2, 1500); },
    note: () => [0, 7, 12].forEach((n, i) => tone(hz(79 + n), 0.35, 'sine', 0.14, i * 0.05)),
    melody: () => [0, 4, 7, 12, 7, 4, 9, 12].forEach((n, i) => tone(hz(74 + n), 0.45, 'sine', 0.11, i * 0.16)),
    chest: () => { noiseBurst(0.3, 300, 1, 0.3); [0, 4, 7, 11, 14, 19].forEach((n, i) => tone(hz(72 + n), 0.8, 'triangle', 0.1, 0.2 + i * 0.07)); },
    coin: () => [0, 7].forEach((n, i) => tone(hz(91 + n), 0.12, 'square', 0.05, i * 0.05)), spit: () => noiseBurst(0.2, 900, 1.5, 0.3, 300),
    blink: () => { tone(hz(84), 0.3, 'sine', 0.12); tone(hz(72), 0.3, 'sine', 0.12, 0.08); }, block: () => { tone(900, 0.08, 'square', 0.12); noiseBurst(0.1, 3000, 2, 0.2); },
    whoosh: () => noiseBurst(0.3, 500, 0.7, 0.3, 2000), charge: () => noiseBurst(0.6, 120, 0.6, 0.5, 400),
    shield: () => [0, 5, 10].forEach((n, i) => tone(hz(60 + n), 1.2, 'sawtooth', 0.06, i * 0.1)), buy: () => [0, 4, 7].forEach((n, i) => tone(hz(84 + n), 0.15, 'triangle', 0.08, i * 0.05)),
    select: () => tone(hz(81), 0.08, 'triangle', 0.08),
  };
  return { init, apply, SFX, setMode: (m) => { if (CHORDS[m] && mode !== m) { mode = m; step = 0; } }, get ready() { return !!ctx; } };
})();
const play = (n, ...a) => { try { Audio.SFX[n]?.(...a); } catch { /* audio indisponible */ } };

/* =====================================================================
   Moteur PlayCanvas
   ===================================================================== */
const canvas = $('game');
const loadBar = $('loadBar'), loadText = $('loadText');
const progress = async (p, t) => { loadBar.style.width = Math.round(p * 100) + '%'; if (t) loadText.textContent = t; await tick(); };
let app, device, camera, cameraFrame = null, sun, world, matCache = {};
const W = {};   // références du monde (jamais stockées sur les entités : `fire`, etc. sont des méthodes du moteur)

async function boot() {
  await progress(0.04, 'Initialisation du rendu…');
  const types = settings.renderer === 'webgl2' || !navigator.gpu ? [pc.DEVICETYPE_WEBGL2] : [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2];
  try { device = await pc.createGraphicsDevice(canvas, { deviceTypes: types, antialias: false, powerPreference: 'high-performance', alpha: false }); }
  catch (e) { loadText.textContent = 'Ton navigateur ne prend pas en charge WebGL 2 ni WebGPU. Essaie avec Chrome, Edge, Firefox ou Safari récents.'; throw e; }
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, Q().ratio);
  const opts = new pc.AppOptions();
  opts.graphicsDevice = device;
  opts.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.AnimComponentSystem];
  opts.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler, pc.AnimClipHandler, pc.AnimStateGraphHandler];
  app = new pc.AppBase(canvas); app.init(opts);
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW); app.setCanvasResolution(pc.RESOLUTION_AUTO);
  addEventListener('resize', () => app.resizeCanvas());
  $('engineInfo').textContent = `PlayCanvas ${pc.version} · ${device.isWebGPU ? 'WebGPU' : 'WebGL 2'}`;
  app.start();
  await buildWorld();
  app.on('update', update);
}

/* ---------- Matériaux ---------- */
function mat(key, o = {}) {
  if (matCache[key]) return matCache[key];
  const m = new pc.StandardMaterial();
  m.useMetalness = true; m.metalness = o.metal ?? 0; m.gloss = o.gloss ?? 0.25;
  m.diffuse = o.diffuse ? col(o.diffuse) : new pc.Color(1, 1, 1);
  if (o.vertex) m.diffuseVertexColor = true;
  if (o.emissive) { m.emissive = col(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
  if (o.opacity !== undefined) { m.opacity = o.opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = !!o.depthWrite; }
  if (o.unlit) { m.useLighting = false; m.useFog = !!o.fog; m.useSkybox = false; }
  if (o.cull !== undefined) m.cull = o.cull;
  m.update(); matCache[key] = m; return m;
}
function addMesh(geo, material, { shadows = true, receive = true, name = 'mesh' } = {}) {
  if (geo.empty) return null;
  const e = new pc.Entity(name);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(geo.mesh(device), material)], castShadows: shadows, receiveShadows: receive });
  world.addChild(e); return e;
}
function prim(type, material, parent, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0], shadows = true) {
  const e = new pc.Entity(type);
  e.addComponent('render', { type, material, castShadows: shadows, receiveShadows: true });
  e.setLocalPosition(...pos); e.setLocalScale(...scale); e.setLocalEulerAngles(...rot); parent.addChild(e); return e;
}

/* ---------- Textures procédurales (bruit périodique) ---------- */
function tileNoise(size, octaves, seed, base = 4) {
  const out = new Float32Array(size * size); let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o, rnd = rng(seed + o * 97), lat = new Float32Array(cells * cells).map(() => rnd());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * cells, fy = y / size * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), L = (a, b) => lat[((b % cells + cells) % cells) * cells + ((a % cells + cells) % cells)];
      out[y * size + x] += lerp(lerp(L(ix, iy), L(ix + 1, iy), sx), lerp(L(ix, iy + 1), L(ix + 1, iy + 1), sx), sy) * amp;
    }
    tot += amp; amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function makeTexture(name, size, fill) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), img = g.createImageData(size, size);
  fill(img.data, size); g.putImageData(img, 0, 0);
  const t = new pc.Texture(device, { name, width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, anisotropy: 8 });
  t.setSource(c); return t;
}
function normalTexture(name, h, size, strength) {
  return makeTexture(name, size, (d) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const H = (a, b) => h[((b + size) % size) * size + ((a + size) % size)];
    let nx = (H(x - 1, y) - H(x + 1, y)) * strength, ny = (H(x, y - 1) - H(x, y + 1)) * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * size + x) * 4; d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255; } });
}
function buildClouds() {
  const m = mat('cloud', { diffuse: '#FFFFFF', emissive: '#C9D6E6', ei: 0.55, opacity: 0.88, gloss: 0 }); m.useFog = false; m.update();
  W.clouds = new pc.Entity('nuages'); app.root.addChild(W.clouds);
  for (let i = 0; i < 26; i++) {
    const g = new pc.Entity('nuage'), a = R() * Math.PI * 2, r = 120 + R() * 380;
    g.setLocalPosition(Math.cos(a) * r, 120 + R() * 60, Math.sin(a) * r); W.clouds.addChild(g);
    const n = 4 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) { const s = 14 + R() * 18; prim('sphere', m, g, [(k - n / 2) * 11 + R() * 6, R() * 4, (R() - 0.5) * 12], [s * 1.6, s * 0.55, s], [0, 0, 0], false); }
  }
}

/* =====================================================================
   Construction du monde
   ===================================================================== */
const COLLIDERS = [], GRID = new Map(), GC = 12;
function addCollider(x, z, r, tag) { const c = { x, z, r, tag, on: true }; COLLIDERS.push(c); const k = `${Math.floor(x / GC)},${Math.floor(z / GC)}`; if (!GRID.has(k)) GRID.set(k, []); GRID.get(k).push(c); return c; }
function nearColliders(x, z) { const out = [], gx = Math.floor(x / GC), gz = Math.floor(z / GC); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = GRID.get(`${gx + i},${gz + j}`); if (a) out.push(...a); } return out; }
const PAL = { sand: hex('#E3CC93'), sandWet: hex('#BFA36B'), grass: hex('#6E9F45'), grass2: hex('#557F3A'), forest: hex('#3A6E33'), rock: hex('#8C8576'), rock2: hex('#6E6A63'), crystalRock: hex('#7A7194'), path: hex('#B88D5D'), seabed: hex('#A99466'), snow: hex('#E8EEF2') };
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function groundColor(x, z, h, slope) {
  if (h < -0.2) return mix(PAL.seabed, PAL.sandWet, clamp((h + 6) / 6, 0, 1));
  if (h < 1.6) return h < 0.6 ? PAL.sandWet : PAL.sand;
  const pd = pathDist(x, z); if (pd < 2.8 && h < 26) return mix(PAL.path, PAL.grass, smooth(1.6, 2.8, pd));
  const ridge = gauss(x, z + 150, 75);
  if (h > 34) return mix(PAL.crystalRock, PAL.snow, smooth(38, 46, h));
  if (slope > 0.62 || h > 24) return ridge > 0.35 ? mix(PAL.rock2, PAL.crystalRock, ridge) : (fbm(x * 0.1, z * 0.1, 2) > 0 ? PAL.rock : PAL.rock2);
  const forest = gauss(x + 120, z - 30, 60), v = fbm(x * 0.05 + 7, z * 0.05, 3);
  return mix(mix(PAL.grass, PAL.grass2, clamp(v + 0.5, 0, 1)), PAL.forest, clamp(forest * 1.4, 0, 0.9));
}

async function buildWorld() {
  world = new pc.Entity('world'); app.root.addChild(world);
  await progress(0.1, 'Sculpture de l’île…');
  for (let j = 0; j <= N; j++) { for (let i = 0; i <= N; i++) HM[j * (N + 1) + i] = heightAt(i * CELL - HALF, j * CELL - HALF); if (j % 24 === 0) await progress(0.1 + j / N * 0.2); }
  // Terrain lissé : normales par sommet (relief doux), couleurs par sommet, texture de détail et relief fin
  await progress(0.32, 'Peinture des paysages…');
  const V = (N + 1) * (N + 1), pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3), cols = new Uint8Array(V * 4), uvs = new Float32Array(V * 2);
  const Hh = (i, j) => HM[clamp(j, 0, N) * (N + 1) + clamp(i, 0, N)];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i, x = i * CELL - HALF, z = j * CELL - HALF, h = HM[k];
    let nx = Hh(i - 1, j) - Hh(i + 1, j), ny = 2 * CELL, nz = Hh(i, j - 1) - Hh(i, j + 1); const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    pos.set([x, h, z], k * 3); nrm.set([nx, ny, nz], k * 3); uvs.set([x / 7, z / 7], k * 2);
    const c = groundColor(x, z, h, Math.sqrt(1 - ny * ny) / Math.max(ny, 0.2)), v = 1 + (fbm(x * 0.21, z * 0.21, 2)) * 0.12;
    cols.set([SRGB2LIN[clamp(Math.round(c[0] * v * 255), 0, 255)], SRGB2LIN[clamp(Math.round(c[1] * v * 255), 0, 255)], SRGB2LIN[clamp(Math.round(c[2] * v * 255), 0, 255)], 255], k * 4);
  }
  const idx = new Uint32Array(N * N * 6); let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c;
  }
  const tm = new pc.Mesh(device); tm.setPositions(pos); tm.setNormals(nrm); tm.setColors32(cols); tm.setUvs(0, uvs); tm.setIndices(idx); tm.update(pc.PRIMITIVE_TRIANGLES);
  const detail = tileNoise(256, 5, 77, 8);
  const tmat = new pc.StandardMaterial(); tmat.useMetalness = true; tmat.metalness = 0; tmat.gloss = 0.16; tmat.diffuseVertexColor = true;
  tmat.diffuseMap = makeTexture('terrain-détail', 256, (dd, S) => { for (let n = 0; n < S * S; n++) { const v = 200 + detail[n] * 55; dd[n * 4] = dd[n * 4 + 1] = dd[n * 4 + 2] = v; dd[n * 4 + 3] = 255; } });
  tmat.normalMap = normalTexture('terrain-relief', detail, 256, 6); tmat.bumpiness = 0.9; tmat.update(); matCache.terrain = tmat;
  const te = new pc.Entity('terrain'); te.addComponent('render', { meshInstances: [new pc.MeshInstance(tm, tmat)], castShadows: true, receiveShadows: true }); world.addChild(te);
  await progress(0.42, 'Remplissage de l’océan…');
  // Océan
  const wmat = mat('water', { diffuse: '#17627A', opacity: 0.86, gloss: 0.94, metal: 0.05 });
  wmat.normalMap = normalTexture('vagues', tileNoise(256, 4, 31, 6), 256, 9); wmat.normalMapTiling = new pc.Vec2(160, 160); wmat.bumpiness = 0.7; wmat.update();
  const water = prim('plane', wmat, world, [0, SEA, 0], [1600, 1, 1600], [0, 0, 0], false);
  water.render.receiveShadows = false; W.water = water;
  // Ciel : dôme dégradé + soleil
  const sky = new Geo(); const top = hex('#2F63B8'), mid = hex('#8EC3EC'), hor = hex('#F6D9A8');
  const segs = 32, rings = 18, Rr = 900;
  const P = (i, j) => { const th = i / segs * Math.PI * 2, ph = j / rings * Math.PI * 0.6; return [Math.cos(th) * Math.sin(ph) * Rr, Math.cos(ph) * Rr - 120, Math.sin(th) * Math.sin(ph) * Rr]; };
  const skyC = (j) => { const t = j / rings; return t < 0.55 ? mix(top, mid, t / 0.55) : mix(mid, hor, (t - 0.55) / 0.45); };
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const c0 = skyC(j), c1 = skyC(j + 1);
    sky.triC(P(i, j), P(i + 1, j), P(i + 1, j + 1), c0, c0, c1); sky.triC(P(i, j), P(i + 1, j + 1), P(i, j + 1), c0, c1, c1);
  }
  const skyMat = new pc.StandardMaterial(); skyMat.useLighting = false; skyMat.useFog = false; skyMat.useSkybox = false; skyMat.diffuse = new pc.Color(0, 0, 0);
  skyMat.emissive = new pc.Color(1, 1, 1); skyMat.emissiveVertexColor = true; skyMat.cull = pc.CULLFACE_NONE; skyMat.depthWrite = false; skyMat.update(); matCache.sky = skyMat;
  W.sky = addMesh(sky, skyMat, { shadows: false, receive: false, name: 'sky' });
  W.sky.render.meshInstances[0].drawOrder = -1;
  W.sunDisc = prim('sphere', mat('sun', { unlit: true, emissive: '#FFE6B0', ei: 6, diffuse: '#000000' }), world, [0, 0, 0], [60, 60, 60], [0, 0, 0], false);
  // Lumière et atmosphère
  sun = new pc.Entity('soleil');
  sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.92, 0.8), intensity: 1.55, castShadows: true, shadowDistance: 140, shadowResolution: Q().shadows, numCascades: Q().cascades, cascadeDistribution: 0.55, shadowBias: 0.25, normalOffsetBias: 0.06, shadowType: settings.quality === 'low' ? pc.SHADOW_PCF1_32F : pc.SHADOW_PCF5_32F });
  sun.setLocalEulerAngles(52, 32, 0); app.root.addChild(sun);
  buildClouds();
  app.scene.ambientLight = new pc.Color(0.38, 0.44, 0.56);
  app.scene.fog.type = pc.FOG_LINEAR; app.scene.fog.color = col('#B9D3EA'); app.scene.fog.start = 140 * Q().fog; app.scene.fog.end = 700 * Q().fog;
  await progress(0.5, 'Plantation de la forêt…');
  buildVegetation();
  await progress(0.68, 'Érection du Temple de l’Aube…');
  buildStructures();
  await progress(0.82, 'Éveil des gardiens…');
  buildCamera(); buildPlayer(); buildParticles(); buildNPC(); buildInteractables(); buildMinimapImage();
  await progress(0.83, 'Chargement des personnages…'); await loadCharacters();
  await warmShaders();
  await progress(1, 'L’île t’attend.');
}

/* ---------- Végétation et rochers (fusionnés par secteurs pour le rendu) ---------- */
function buildVegetation() {
  const S = 4, sector = (x, z) => clamp(Math.floor((x + HALF) / WORLD * S), 0, S - 1) * S + clamp(Math.floor((z + HALF) / WORLD * S), 0, S - 1);
  const trees = [...Array(S * S)].map(() => new Geo()), rocks = [...Array(S * S)].map(() => new Geo()), grass = [...Array(S * S)].map(() => new Geo());
  const blocked = (x, z, pad = 0) => FLATS.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 0.85 + pad) || pathDist(x, z) < 3.5;
  const nT = Math.round(900 * Q().trees);
  for (let n = 0, tries = 0; n < nT && tries < nT * 8; tries++) {
    const x = (R() - 0.5) * WORLD * 0.92, z = (R() - 0.5) * WORLD * 0.92, h = heightAt(x, z);
    if (h < 1.8 || h > 30 || blocked(x, z, 2)) continue;
    const slope = Math.abs(heightAt(x + 1.5, z) - h) + Math.abs(heightAt(x, z + 1.5) - h); if (slope > 1.6) continue;
    const forest = gauss(x + 120, z - 30, 65), ridge = gauss(x, z + 150, 80);
    if (R() > 0.12 + forest * 1.3 + (h > 14 ? 0.25 : 0)) continue;
    const g = trees[sector(x, z)], s = 0.8 + R() * 0.7;
    if (h < 3.4 && R() < 0.7) {                                  // palmier de plage
      const lean = (R() - 0.5) * 1.2; let px = x, py = h, pz = z;
      for (let k = 0; k < 5; k++) { g.frustum(px, py, pz, 0.28 * s, 0.24 * s, 1.3 * s, 5, hex('#8A6A44')); px += lean * 0.3; py += 1.3 * s; }
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + R(); const tip = [px + Math.cos(a) * 3.2 * s, py - 1.1 * s, pz + Math.sin(a) * 3.2 * s]; g.tri([px, py + 0.3, pz], tip, [px + Math.cos(a + 0.4) * 1.6 * s, py + 0.1, pz + Math.sin(a + 0.4) * 1.6 * s], hex('#4F9A3A'), 0.12); g.tri([px, py + 0.3, pz], [px + Math.cos(a - 0.4) * 1.6 * s, py + 0.1, pz + Math.sin(a - 0.4) * 1.6 * s], tip, hex('#5DAA44'), 0.12); }
    } else if (h > 12 || ridge > 0.3 || R() < 0.45) {            // sapin
      g.frustum(x, h - 0.3, z, 0.35 * s, 0.25 * s, 1.8 * s, 5, hex('#6B4F33'));
      const green = ridge > 0.3 ? hex('#3E6E5A') : hex('#2F6B3A');
      for (let k = 0; k < 3; k++) g.cone(x, h + (1.3 + k * 1.55) * s, z, (2.3 - k * 0.6) * s, 2.6 * s, 7, mix(green, hex('#4E8F45'), k * 0.25));
    } else {                                                     // feuillu
      g.frustum(x, h - 0.3, z, 0.4 * s, 0.3 * s, 2.6 * s, 6, hex('#7A5A3A'));
      const leaf = forest > 0.4 ? hex('#3C8A3A') : hex('#6DAE45'), k2 = R();
      g.rock(x, h + 3.6 * s, z, 2.2 * s, leaf, 0.9); if (k2 > 0.4) g.rock(x + 1.2 * s, h + 3 * s, z + 0.5 * s, 1.5 * s, mix(leaf, hex('#A7C94A'), 0.2), 0.9);
    }
    addCollider(x, z, 0.55 * s, 'tree'); n++;
  }
  for (let n = 0; n < 260 * Q().trees; n++) {
    const x = (R() - 0.5) * WORLD * 0.9, z = (R() - 0.5) * WORLD * 0.9, h = heightAt(x, z);
    if (h < 0.4 || blocked(x, z, 1)) continue;
    const ridge = gauss(x, z + 150, 80), s = 0.6 + R() * (h > 14 ? 2.6 : 1.4);
    rocks[sector(x, z)].rock(x, h - 0.2, z, s, ridge > 0.35 ? mix(PAL.rock2, PAL.crystalRock, 0.6) : (R() > 0.5 ? PAL.rock : PAL.rock2), 0.65);
    if (s > 0.9) addCollider(x, z, s * 0.85, 'rock');
  }
  const nG = Math.round(3200 * Q().grass);
  for (let n = 0; n < nG; n++) {
    const x = (R() - 0.5) * WORLD * 0.85, z = (R() - 0.5) * WORLD * 0.85, h = heightAt(x, z);
    if (h < 1.9 || h > 22 || pathDist(x, z) < 2.4) continue;
    const g = grass[sector(x, z)], c = R() < 0.06 ? [hex('#F2D14B'), hex('#E86F8F'), hex('#FFFFFF'), hex('#9B7BFF')][Math.floor(R() * 4)] : mix(hex('#7FAE4C'), hex('#557F3A'), R());
    for (let k = 0; k < 3; k++) { const a = R() * Math.PI * 2, s = 0.35 + R() * 0.35, ox = x + (R() - 0.5) * 0.8, oz = z + (R() - 0.5) * 0.8;
      g.tri([ox - Math.cos(a) * 0.12, h - 0.05, oz - Math.sin(a) * 0.12], [ox + Math.cos(a) * 0.12, h - 0.05, oz + Math.sin(a) * 0.12], [ox + (R() - 0.5) * 0.3, h + s, oz + (R() - 0.5) * 0.3], c, 0.15); }
  }
  trees.forEach((g) => addMesh(g, mat('veg', { vertex: true, gloss: 0.18 }), { name: 'arbres' }));
  rocks.forEach((g) => addMesh(g, mat('veg', { vertex: true, gloss: 0.18 }), { name: 'rochers' }));
  grass.forEach((g) => addMesh(g, mat('grass', { vertex: true, gloss: 0.1, cull: pc.CULLFACE_NONE }), { shadows: false, name: 'herbe' }));
}

/* ---------- Temple, camp, ruines, cristaux, totems ---------- */
const state = { mode: 'loading', time: 0, play: 0 };
let save = null;
const newSave = () => ({ v: 1, shards: {}, runes: {}, cleared: {}, hearts: [], checkpoint: 'camp', checkpoints: ['camp'], talked: 0, kills: 0, deaths: 0, play: 0, finished: false, created: Date.now(), character: 'nera',
  gold: 0, potions: { hp: 1, mp: 0 }, arrows: 0, items: { sword: true }, chests: [], upgrades: {} });
const CHECKPOINTS = { camp: { x: 6, z: 146, name: 'Camp d’Ilyas' }, forest: { x: -88, z: 42, name: 'Totem de la forêt' }, lake: { x: 88, z: -4, name: 'Totem du lac' }, ridge: { x: 6, z: -100, name: 'Totem de la crête' }, temple: { x: 0, z: 28, name: 'Seuil du Temple' } };
const GLYPHS = ['☀', '☾', '✦', '◆', '❂', '♆', '✧', '⚘'];
const zoneObjs = {};
function stone(g, x, y, z, sx, sy, sz, rot = 0, c = hex('#B9B1A0')) { g.box(x, y, z, sx, sy, sz, c, rot); }
function buildStructures() {
  const s = new Geo(), cr = new Geo(), stoneC = hex('#C4BBA8'), darkC = hex('#8F8676'), moss = hex('#7E9A5C');
  // Temple de l'Aube : trois marches, colonnade, autel
  const H = 9.5;
  [[26, 0.6], [21, 1.2], [16.5, 1.8]].forEach(([r, h], i) => { s.frustum(0, H - 0.4, 0, r, r - 0.4, h + 0.4, 28, i % 2 ? stoneC : hex('#D3CAB6'), 0.06); FLOORS.push({ x: 0, z: 0, r: r - 0.4, h: H + h }); });
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, x = Math.cos(a) * 14, z = Math.sin(a) * 14, broken = i % 4 === 3, ph = broken ? 3 + R() * 2 : 7.5;
    s.box(x, H + 1.8, z, 0.9, 0.25, 0.9, darkC, a); s.frustum(x, H + 2.3, z, 0.7, 0.62, ph, 8, stoneC);
    if (!broken) s.box(x, H + 2.3 + ph, z, 0.95, 0.3, 0.95, darkC, a); else s.rock(x + 1.5, H + 2.2, z + 1, 0.8, stoneC, 0.6);
    addCollider(x, z, 0.85, 'pillar');
  }
  s.box(0, H + 1.8, 0, 2.6, 0.55, 1.6, darkC); s.box(0, H + 2.9, 0, 2.2, 0.35, 1.2, stoneC); addCollider(0, 0, 2.6, 'altar');
  // Camp d'Ilyas
  const c0 = PLACES.camp, ch = heightAt(c0.x, c0.z);
  s.cone(c0.x - 6, ch - 0.1, c0.z - 3, 3.4, 3.6, 4, hex('#C9A06B'), 0.4); addCollider(c0.x - 6, c0.z - 3, 3, 'tent');
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; s.box(c0.x + Math.cos(a) * 0.7, ch, c0.z + Math.sin(a) * 0.7, 0.12, 0.12, 0.6, hex('#6B4A2B'), a); }
  s.box(c0.x + 5, ch, c0.z - 4, 0.6, 0.6, 0.6, hex('#9C7448'), 0.3); s.box(c0.x + 5.6, ch, c0.z - 2.6, 0.45, 0.45, 0.45, hex('#8A6640'), 0.8); addCollider(c0.x + 5.2, c0.z - 3.4, 1.2, 'crate');
  [[c0.x - 2.5, c0.z + 1.8], [c0.x + 2.4, c0.z + 2]].forEach(([x, z]) => s.box(x, ch, z, 0.9, 0.2, 0.3, hex('#7A5634'), 0.5));
  // Zones : stèle, pierres runiques, piédestal
  for (const Z of Object.values(ZONES)) {
    const zh = heightAt(Z.x, Z.z), o = zoneObjs[Z.key] = { runes: [], order: [] };
    if (Z.key === 'lake') {            // ruines : arches et colonnes
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.2, x = Z.x + Math.cos(a) * 17, z = Z.z + Math.sin(a) * 17, h = 2 + R() * 5;
        s.frustum(x, heightAt(x, z) - 0.2, z, 0.75, 0.65, h, 7, i % 3 ? stoneC : moss); addCollider(x, z, 0.8, 'pillar'); if (R() > 0.5) s.rock(x + 1.2, heightAt(x, z), z - 0.8, 0.8, stoneC, 0.5); }
      const ax = Z.x + 15, az = Z.z - 10; s.box(ax - 2, zh, az, 0.6, 2.4, 0.6, stoneC); s.box(ax + 2, zh, az, 0.6, 2.4, 0.6, stoneC); s.box(ax, zh + 4.8, az, 2.8, 0.4, 0.7, darkC);
    }
    if (Z.key === 'forest') for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, x = Z.x + Math.cos(a) * 19, z = Z.z + Math.sin(a) * 19; s.rock(x, heightAt(x, z), z, 1.4 + R(), moss, 1.4); addCollider(x, z, 1.4, 'rock'); }
    if (Z.key === 'ridge') {           // arène et cristaux
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, x = Z.x + Math.cos(a) * 27, z = Z.z + Math.sin(a) * 27; s.frustum(x, heightAt(x, z) - 0.3, z, 1, 0.6, 3 + R() * 3, 5, hex('#8C84A8')); addCollider(x, z, 1, 'stone'); }
      for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, d = 30 + R() * 45, x = Z.x + Math.cos(a) * d, z = Z.z + 10 + Math.sin(a) * d, h = heightAt(x, z); if (h < 3) continue;
        for (let k = 0; k < 3; k++) cr.cone(x + (R() - 0.5) * 1.6, h - 0.3, z + (R() - 0.5) * 1.6, 0.4 + R() * 0.4, 1.8 + R() * 3, 5, mix(hex('#B48CFF'), hex('#7FD6FF'), R())); }
    }
    // stèle
    const st = { x: Z.x + 10, z: Z.z + 12 }; stone(s, st.x, heightAt(st.x, st.z) - 0.2, st.z, 1.1, 1.5, 0.35, 0.3, darkC); addCollider(st.x, st.z, 1.2, 'stele'); o.stele = st;
    // piédestal de l'éclat
    const pd = { x: Z.x, z: Z.z - 6 }; s.frustum(pd.x, heightAt(pd.x, pd.z) - 0.2, pd.z, 1.6, 1.2, 1.2, 8, stoneC); o.pedestal = pd;
    // ordre des runes (3 symboles uniques)
    const pool = [...GLYPHS].sort(() => R() - 0.5).slice(0, 3); o.glyphs = pool; o.order = [...pool].sort(() => R() - 0.5);
  }
  addMesh(s, mat('stone', { vertex: true, gloss: 0.2 }), { name: 'pierres' });
  addMesh(cr, mat('crystal', { vertex: true, gloss: 0.9, emissive: '#5A3C9C', ei: 0.9 }), { name: 'cristaux', shadows: true });
}

/* ---------- Préchauffage des shaders ----------
   Chaque nouveau matériau (héroïne, ennemis, éclats, effets) est affiché une fois devant la caméra pendant le
   chargement, un groupe par image : les compilations ont lieu derrière la barre de progression, pas en jeu. */
async function warmShaders() {
  const nextFrame = () => new Promise((r) => app.once('frameend', r));
  const spot = new pc.Vec3(0, 500, 0);
  camera.setPosition(spot.x, spot.y, spot.z + 6); camera.lookAt(spot);
  const groups = [() => { P.root.setPosition(spot); return [P.root]; },
    () => { const r = enemyRig('slime'); r.root.setPosition(spot); return [r.root]; },
    () => { const r = enemyRig('golem'); r.root.setPosition(spot); return [r.root]; },
    () => { const r = enemyRig('boss'); r.root.setPosition(spot.x, spot.y - 3, spot.z - 4); return [r.root]; },
    () => { burst(spot.x, spot.y, spot.z, 8, 'gold', 0.1, 0.4, 0.5, 0); return []; },
    () => { const e = prim('box', mat('trail'), world, [spot.x, spot.y, spot.z]); return [e]; }];
  for (let i = 0; i < groups.length; i++) {
    const made = groups[i]();
    await progress(0.84 + i / groups.length * 0.14, 'Préparation des effets visuels…');
    await nextFrame(); await nextFrame();
    made.forEach((e) => { if (e !== P.root) e.destroy(); });
  }
  // personnages glTF : un rendu pour mettre à jour les squelettes, puis mise à l'échelle automatique
  P.root.setPosition(spot); for (const m of Object.values(MODELS.player)) m.holder.enabled = true;
  if (W.fox) { W.fox.holder.enabled = true; W.fox.holder.setPosition(spot.x + 2.5, spot.y, spot.z); }
  await progress(0.98, 'Préparation des personnages…'); await nextFrame(); await nextFrame();
  for (const m of [...Object.values(MODELS.player), W.fox].filter(Boolean)) measureModel(m);
  await nextFrame();
  for (const m of Object.values(MODELS.player)) m.holder.enabled = false; if (W.fox) W.fox.holder.enabled = false;
  P.root.setPosition(0, -50, 0);
}

/* =====================================================================
   Personnages 3D animés (glTF : maillage, squelette, animations)
   Pour ajouter un personnage : déposer le .glb dans models/ et ajouter une entrée ci-dessous
   (noms des animations du fichier, os de la main qui tient l'arme, taille voulue en mètres).
   ===================================================================== */
const CHARACTERS = {
  nera: { name: 'Néra', species: 'Humaine', desc: 'Exploratrice d’Aube, agile et polyvalente.', icon: '🧭', builtin: true },
  k7: { name: 'K-7', species: 'Androïde', desc: 'Automate d’un peuple disparu, réveillé par la lumière d’Aube. Lourd, mais infatigable.', icon: '🤖',
    url: 'models/RobotExpressive.glb', height: 2.05, hand: 'Palm2.R', grip: { pos: [0, 0, 0], rot: [90, 0, 0] },
    anims: { idle: 'Idle', walk: 'Walking', run: 'Running', attack: 'Punch', jump: 'Jump', death: 'Death', cast: 'Yes', hurt: 'No', win: 'Dance' },
    credit: '« RobotExpressive » de Tomás Laulhé (Quaternius), licence CC0' },
};
const UPCOMING = [{ name: 'Homme-loup', icon: '🐺' }, { name: 'Reptilien', icon: '🦎' }, { name: 'Extraterrestre', icon: '👽' }];
const COMPANION = { name: 'Roux', url: 'models/Fox.glb', height: 0.85, yawOffset: 0, anims: { idle: 'Survey', walk: 'Walk', run: 'Run' } };
const ONESHOT = new Set(['attack', 'jump', 'death', 'cast', 'hurt']);
const MODELS = { player: {} };
const loadContainer = (url) => (loadContainer.c ||= {})[url] ||= new Promise((res, rej) => app.assets.loadFromUrl(url, 'container', (err, a) => (err ? rej(err) : res(a))));
async function createModel(def) {
  const asset = await loadContainer(def.url);
  const holder = new pc.Entity(def.name), inner = asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
  holder.addChild(inner);
  const tracks = asset.resource.animations.map((a) => a.resource);
  const names = Object.keys(def.anims).filter((k) => tracks.some((t) => t.name === def.anims[k]));
  holder.addComponent('anim', { activate: true });
  holder.anim.loadStateGraph(new pc.AnimStateGraph({ layers: [{ name: 'Base', states: [{ name: 'START' }, ...names.map((n) => ({ name: n, speed: 1, loop: !ONESHOT.has(n) }))], transitions: [{ from: 'START', to: 'idle', time: 0 }] }], parameters: {} }));
  for (const n of names) holder.anim.assignAnimation(n, tracks.find((t) => t.name === def.anims[n]), 'Base');
  return { holder, inner, def, cur: 'idle', states: new Set(names), x: 0, z: 0, yaw: 0 };
}
function measureModel(m) {          // taille voulue, pieds au sol (quelles que soient les unités du fichier)
  const box = new pc.BoundingBox(); let first = true;
  for (const r of m.holder.findComponents('render')) for (const mi of r.meshInstances) { if (first) { box.copy(mi.aabb); first = false; } else box.add(mi.aabb); }
  if (first || box.halfExtents.y <= 0) return false;
  const k = m.def.height / (box.halfExtents.y * 2), base = box.getMin().y - m.holder.getPosition().y;
  const s0 = m.inner.getLocalScale().x; m.inner.setLocalScale(s0 * k, s0 * k, s0 * k); m.inner.setLocalPosition(0, -base * k, 0); m.measured = true; return true;
}
function playAnim(m, state, blend = 0.18, force = false) {
  if (!m || !m.states.has(state) || (m.cur === state && !force)) return;
  m.cur = state; try { m.holder.anim.baseLayer.transition(state, blend, 0); } catch { /* état absent */ }
}
async function loadCharacters() {
  for (const [id, def] of Object.entries(CHARACTERS)) {
    if (def.builtin) continue;
    try { const m = await createModel(def); m.holder.enabled = false; P.root.addChild(m.holder); m.hand = def.hand ? m.holder.findByName(def.hand) : null; MODELS.player[id] = m; }
    catch (e) { console.warn('Personnage indisponible :', def.url, e); delete CHARACTERS[id]; }
  }
  try { W.fox = await createModel(COMPANION); W.fox.holder.enabled = false; world.addChild(W.fox.holder); } catch (e) { console.warn('Compagnon indisponible', e); }
  // support d'arme qui suit l'os de la main sans hériter de son échelle
  P.mount = new pc.Entity('support-arme'); world.addChild(P.mount); P.grip = new pc.Entity('prise'); P.mount.addChild(P.grip); P.mount.enabled = false;
}
function setCharacter(id) {
  const key = CHARACTERS[id] ? id : 'nera', m = MODELS.player[key] || null;
  P.char = key; P.model = m;
  for (const mm of Object.values(MODELS.player)) mm.holder.enabled = mm === m;
  for (const c of P.body.children) c.enabled = !m;                       // corps procédural masqué pour un modèle 3D
  if (m) { const g = CHARACTERS[key].grip || { pos: [0, 0, 0], rot: [0, 0, 0] }; P.grip.setLocalPosition(...g.pos); P.grip.setLocalEulerAngles(...g.rot); }
  for (const [wid, w] of Object.entries(P.weapons)) {
    const home = P.weaponHome[wid];
    if (m && m.hand) { w.reparent(P.grip); w.setLocalPosition(0, 0, 0); w.setLocalEulerAngles(...home.gripRot); }
    else { w.reparent(home.parent); w.setLocalPosition(...home.pos); w.setLocalEulerAngles(...home.rot); }
  }
  if (P.mount) P.mount.enabled = !!(m && m.hand);
}
function updateCompanion(dt) {
  const f = W.fox; if (!f || !f.holder.enabled) return;
  const p = player, tx = p.x - Math.sin(p.yaw) * 2.6 + Math.cos(p.yaw) * 1.4, tz = p.z - Math.cos(p.yaw) * 2.6 - Math.sin(p.yaw) * 1.4;
  let dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
  if (d > 45 || terrainH(f.x, f.z) < 0.2) { f.x = tx; f.z = tz; dx = dz = d = 0; }
  const sp = d > 10 ? 11 : d > 4 ? 7 : d > 1.3 ? 3 : 0;
  if (sp) { f.x += dx / d * Math.min(sp * dt, d); f.z += dz / d * Math.min(sp * dt, d); f.yaw = angleLerp(f.yaw, Math.atan2(dx, dz), clamp(8 * dt, 0, 1)); }
  else f.yaw = angleLerp(f.yaw, Math.atan2(p.x - f.x, p.z - f.z), clamp(2 * dt, 0, 1));
  f.holder.setPosition(f.x, groundAt(f.x, f.z), f.z); f.holder.setEulerAngles(0, f.yaw * 180 / Math.PI + (f.def.yawOffset || 0), 0);
  playAnim(f, sp > 6 ? 'run' : sp > 0 ? 'walk' : 'idle', 0.25);
}

/* =====================================================================
   Caméra, rendu
   ===================================================================== */
function buildCamera() {
  camera = new pc.Entity('camera');
  camera.addComponent('camera', { clearColor: col('#F6D9A8'), fov: settings.fov, nearClip: 0.15, farClip: 1400 });
  app.root.addChild(camera);
  applyQuality();
}
function applyQuality() {
  const q = Q();
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, q.ratio); app.resizeCanvas();
  sun.light.shadowResolution = q.shadows; sun.light.numCascades = q.cascades;
  app.scene.fog.start = 140 * q.fog; app.scene.fog.end = 700 * q.fog;
  camera.camera.fov = settings.fov;
  if (q.frame && !cameraFrame) { try { cameraFrame = new pc.CameraFrame(app, camera.camera); } catch (e) { console.warn('Post-traitement indisponible', e); cameraFrame = null; } }
  if (cameraFrame) {
    cameraFrame.enabled = q.frame;
    cameraFrame.rendering.toneMapping = pc.TONEMAP_ACES; cameraFrame.rendering.samples = q.samples;
    cameraFrame.bloom.intensity = state.dawn ? 0.06 : 0.018; cameraFrame.bloom.blurLevel = 16;
    cameraFrame.vignette.intensity = 0.35; cameraFrame.vignette.inner = 0.55; cameraFrame.vignette.outer = 1.2;
    cameraFrame.ssao.type = q.ssao ? 'lighting' : 'none'; cameraFrame.ssao.intensity = 0.4; cameraFrame.ssao.radius = 20;
    cameraFrame.update();
  }
  camera.camera.toneMapping = cameraFrame?.enabled ? pc.TONEMAP_LINEAR : pc.TONEMAP_ACES;
}

/* =====================================================================
   Personnages
   ===================================================================== */
const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: Math.PI, hp: 100, maxHp: 100, st: 100, grounded: true, attack: 0, combo: 0, comboWindow: 0, dodge: 0, invuln: 0, hurtFlash: 0, walk: 0, stepT: 0, dead: false, lastHitT: 0,
  mp: 60, weapon: 'sword', powerCd: { sword: 0, bow: 0, staff: 0, flute: 0 }, primCd: 0, cast: 0, charging: false, chargeT: 0, spin: 0, slow: 0, rooted: 0, hot: 0 };
let P;   // rig 3D de l'héroïne
function buildPlayer() {
  const root = new pc.Entity('Néra'); world.addChild(root);
  const body = new pc.Entity('corps'); root.addChild(body);
  const M = {
    tunic: mat('tunic', { diffuse: '#2C8C88', gloss: 0.3 }), skin: mat('skin', { diffuse: '#E9B48A', gloss: 0.35 }), hair: mat('hair', { diffuse: '#3A2418', gloss: 0.4 }),
    pants: mat('pants', { diffuse: '#3C3A52', gloss: 0.2 }), boots: mat('boots', { diffuse: '#5B3A23', gloss: 0.3 }), cape: mat('cape', { diffuse: '#C3423A', gloss: 0.25, cull: pc.CULLFACE_NONE }),
    belt: mat('belt', { diffuse: '#7A4E26', gloss: 0.4 }), gold: mat('gold', { diffuse: '#E0B04C', gloss: 0.8, metal: 0.9 }), blade: mat('blade', { diffuse: '#DDE8F5', gloss: 0.95, metal: 1, emissive: '#6FB8FF', ei: 0.25 }), eye: mat('eye', { diffuse: '#1A1A22' }),
  };
  prim('box', M.pants, body, [0, 0.98, 0], [0.5, 0.24, 0.32]);
  prim('box', M.tunic, body, [0, 1.36, 0], [0.56, 0.6, 0.34]);
  prim('box', M.belt, body, [0, 1.08, 0], [0.6, 0.1, 0.38]);
  prim('box', M.gold, body, [0, 1.08, 0.19], [0.12, 0.1, 0.04]);
  const head = new pc.Entity('tête'); head.setLocalPosition(0, 1.88, 0); body.addChild(head);
  prim('sphere', M.skin, head, [0, 0, 0], [0.44, 0.48, 0.44]);
  prim('sphere', M.hair, head, [0, 0.07, -0.05], [0.48, 0.44, 0.48]);
  prim('box', M.hair, head, [0, -0.08, -0.2], [0.34, 0.42, 0.12]);
  prim('box', M.eye, head, [-0.09, 0.02, 0.21], [0.05, 0.07, 0.02]); prim('box', M.eye, head, [0.09, 0.02, 0.21], [0.05, 0.07, 0.02]);
  const capePivot = new pc.Entity('cape'); capePivot.setLocalPosition(0, 1.62, -0.18); body.addChild(capePivot);
  prim('box', M.cape, capePivot, [0, -0.48, 0], [0.58, 0.96, 0.03]);
  const limb = (x, y, matU, len, w, end, endMat) => { const p = new pc.Entity('membre'); p.setLocalPosition(x, y, 0); body.addChild(p); prim('box', matU, p, [0, -len / 2, 0], [w, len, w]); if (end) prim(end, endMat, p, [0, -len - 0.04, end === 'box' ? 0.04 : 0], end === 'box' ? [w * 1.15, 0.14, w * 1.5] : [w * 1.1, w * 1.1, w * 1.1]); return p; };
  const armL = limb(-0.37, 1.62, M.tunic, 0.52, 0.16, 'sphere', M.skin), armR = limb(0.37, 1.62, M.tunic, 0.52, 0.16, 'sphere', M.skin);
  const legL = limb(-0.14, 0.95, M.pants, 0.86, 0.2, 'box', M.boots), legR = limb(0.14, 0.95, M.pants, 0.86, 0.2, 'box', M.boots);
  const sword = new pc.Entity('épée'); sword.setLocalPosition(0, -0.58, 0.05); sword.setLocalEulerAngles(80, 0, 0); armR.addChild(sword);
  prim('box', M.belt, sword, [0, 0, 0], [0.06, 0.24, 0.06]); prim('box', M.gold, sword, [0, 0.14, 0], [0.32, 0.05, 0.08]); prim('box', M.blade, sword, [0, 0.66, 0], [0.08, 0.98, 0.025]);
  const trail = prim('box', mat('trail', { unlit: true, emissive: '#BFE2FF', ei: 2.5, opacity: 0.0 }), sword, [0, 0.66, 0], [0.5, 1.05, 0.01], [0, 0, 0], false);
  const bow = new pc.Entity('arc'); bow.setLocalPosition(0, -0.6, 0.06); armL.addChild(bow);
  for (let i = -2; i <= 2; i++) prim('box', M.belt, bow, [0, i * 0.24, Math.abs(i) * -0.07], [0.05, 0.26, 0.05], [i * 14, 0, 0]);
  prim('box', mat('string', { diffuse: '#EDE6D2' }), bow, [0, 0, -0.16], [0.012, 1.1, 0.012]);
  const staff = new pc.Entity('bâton'); staff.setLocalPosition(0, -0.58, 0.05); staff.setLocalEulerAngles(80, 0, 0); armR.addChild(staff);
  prim('cylinder', mat('staffWood', { diffuse: '#5A3A22', gloss: 0.35 }), staff, [0, 0.3, 0], [0.06, 1.7, 0.06]);
  prim('sphere', mat('staffOrb', { unlit: true, emissive: '#FF8A2A', ei: 3.5 }), staff, [0, 1.2, 0], [0.22, 0.22, 0.22], [0, 0, 0], false);
  prim('box', M.gold, staff, [0, 1.05, 0], [0.16, 0.08, 0.16]);
  const flute = new pc.Entity('flûte'); flute.setLocalPosition(0, -0.58, 0.08); flute.setLocalEulerAngles(70, 0, 0); armR.addChild(flute);
  prim('cylinder', mat('fluteBody', { diffuse: '#E7D6A8', gloss: 0.7, metal: 0.4 }), flute, [0, 0.2, 0], [0.05, 0.55, 0.05]);
  prim('box', M.gold, flute, [0, 0.45, 0], [0.07, 0.04, 0.07]);
  bow.enabled = staff.enabled = flute.enabled = false;
  P = { root, body, head, armL, armR, legL, legR, cape: capePivot, sword, trail, mats: M, weapons: { sword, bow, staff, flute } };
  P.weaponHome = Object.fromEntries(Object.entries(P.weapons).map(([k, w]) => { const lp = w.getLocalPosition(), le = w.getLocalEulerAngles();
    return [k, { parent: w.parent, pos: [lp.x, lp.y, lp.z], rot: [le.x, le.y, le.z], gripRot: k === 'bow' ? [0, 90, 0] : [80, 0, 0] }]; }));
}
const sharedMats = {};
/** Change l'émissif d'un matériau seulement si l'état change (update() à chaque image recompilerait les shaders). */
function setGlow(m, key, color, intensity) { if (m._glowKey === key) return; m._glowKey = key; m.emissive = col(color); m.emissiveIntensity = intensity; m.update(); }
function setOpacity(m, v) { if (m.opacity === v) return; m.opacity = v; m.update(); }
/* =====================================================================
   Arsenal : épée, arc, bâton de braise (magie), flûte d'Aube (instrument)
   ===================================================================== */
const WEAPONS = [
  { id: 'sword', name: 'Épée d’Aube', icon: '🗡', key: '1', power: 'Tourbillon', desc: 'Enchaînement de trois coups. Pouvoir (F) : Tourbillon, frappe tout autour de toi.' },
  { id: 'bow', name: 'Arc des vents', icon: '🏹', key: '2', power: 'Volée', desc: 'Maintiens l’attaque pour bander l’arc. Pouvoir (F) : Volée de cinq flèches.' },
  { id: 'staff', name: 'Bâton de braise', icon: '🔥', key: '3', power: 'Nova de givre', desc: 'Boule de feu explosive qui enflamme. Pouvoir (F) : Nova de givre, gèle les ennemis proches.' },
  { id: 'flute', name: 'Flûte d’Aube', icon: '🎶', key: '4', power: 'Mélodie de guérison', desc: 'Note de lumière : onde sonore qui repousse et étourdit. Pouvoir (F) : Mélodie de guérison.' },
];
const ITEMS = {
  bow: { name: 'Arc des vents', icon: '🏹', desc: 'Nouvelle arme (touche 2). Tire des flèches ; maintiens pour charger.' },
  staff: { name: 'Bâton de braise', icon: '🔥', desc: 'Nouvelle arme magique (touche 3). Boules de feu et nova de givre.' },
  flute: { name: 'Flûte d’Aube', icon: '🎶', desc: 'Instrument magique (touche 4). Ondes sonores et mélodie de guérison.' },
  amulet: { name: 'Amulette d’Aube', icon: '📿', desc: '+30 de mana maximum.' },
  ring: { name: 'Anneau de vélocité', icon: '💍', desc: '+10 % de vitesse de déplacement.' },
  talisman: { name: 'Talisman de pierre', icon: '🪨', desc: '−20 % de dégâts subis.' },
  map: { name: 'Carte au trésor', icon: '🗺', desc: 'Révèle tous les coffres sur la carte (M).' },
  runeForce: { name: 'Rune de force', icon: 'ᚱ', desc: '+20 % de dégâts avec toutes les armes.' },
};
const CHESTS = [
  { id: 'c1', x: -150, z: 58, rare: true, guard: ['slime', 'slime'], loot: { item: 'bow', arrows: 20 } },
  { id: 'c2', x: 132, z: -34, rare: true, guard: ['golem'], loot: { item: 'staff', mp: 1 } },
  { id: 'c3', x: 58, z: 165, loot: { gold: 60, hp: 1 } },
  { id: 'c4', x: -42, z: -170, rare: true, loot: { item: 'amulet', gold: 40 } },
  { id: 'c5', x: 186, z: 8, loot: { item: 'ring', gold: 30 } },
  { id: 'c6', x: -196, z: 96, rare: true, loot: { item: 'talisman', gold: 20 } },
  { id: 'c7', x: 18, z: 26, loot: { gold: 40, mp: 1 } },
  { id: 'c8', x: -172, z: -12, loot: { item: 'map', gold: 25 } },
  { id: 'c9', x: 150, z: -72, loot: { gold: 80, arrows: 15 } },
  { id: 'c10', x: 92, z: -122, rare: true, guard: ['wisp'], loot: { item: 'runeForce', gold: 50 } },
];
const SHOP = [
  { id: 'hp', label: 'Potion de vie', price: 30, desc: '+60 PV (touche R)', buy: () => { save.potions.hp++; } },
  { id: 'mp', label: 'Potion de mana', price: 30, desc: '+60 mana (touche T)', buy: () => { save.potions.mp++; } },
  { id: 'arrows', label: '10 flèches', price: 20, need: () => save.items.bow, buy: () => { save.arrows += 10; } },
  { id: 'blade', label: 'Affûter l’épée', price: 120, once: true, desc: '+25 % de dégâts', buy: () => { save.upgrades.blade = true; } },
  { id: 'armor', label: 'Armure renforcée', price: 150, once: true, desc: '+25 PV maximum', buy: () => { save.upgrades.armor = true; player.maxHp = stats().maxHp; player.hp = player.maxHp; } },
];
function stats() {
  const it = save?.items || {}, up = save?.upgrades || {};
  return { dmg: (up.blade ? 1.25 : 1) * (it.runeForce ? 1.2 : 1), def: it.talisman ? 0.8 : 1, speed: it.ring ? 1.1 : 1,
    maxMp: 60 + (it.amulet ? 30 : 0), maxHp: 100 + (save?.hearts.length || 0) * 25 + (up.armor ? 25 : 0) };
}
const held = { attack: false };
function selectWeapon(id) {
  if (!save.items[id]) { const w = WEAPONS.find((x) => x.id === id); toast(`${w.name} : pas encore trouvé${id === 'flute' ? ' (Ilyas te la confiera)' : ' (cherche dans les coffres)'}.`); return; }
  if (player.weapon === id) return;
  player.weapon = id; player.charging = false; player.attack = 0; play('select');
  for (const [k, e] of Object.entries(P.weapons)) e.enabled = k === id;
  hud.weapons = null;
}
function cycleWeapon(dir) { const own = WEAPONS.filter((w) => save.items[w.id]); if (own.length < 2) return; const i = own.findIndex((w) => w.id === player.weapon); selectWeapon(own[(i + dir + own.length) % own.length].id); }
function usePotion(kind) {
  if (!save.potions[kind]) { toast(kind === 'hp' ? 'Aucune potion de vie.' : 'Aucune potion de mana.'); return; }
  const st = stats();
  if (kind === 'hp' && player.hp >= player.maxHp) return; if (kind === 'mp' && player.mp >= st.maxMp) return;
  save.potions[kind]--; play('heal');
  if (kind === 'hp') { player.hp = Math.min(player.maxHp, player.hp + 60); floater(player.x, player.y + 2.3, player.z, '+60', ''); burst(player.x, player.y + 1.2, player.z, 14, 'red', 3, 0.12, 0.8, -2); }
  else { player.mp = Math.min(st.maxMp, player.mp + 60); burst(player.x, player.y + 1.2, player.z, 14, 'blue', 3, 0.12, 0.8, -2); }
}
const noMana = () => { if (state.time - (noMana.t || 0) > 1) { toast('Pas assez de mana.'); noMana.t = state.time; play('wrong'); } };
function aimDir() {
  const origin = new pc.Vec3(player.x, player.y + 1.5, player.z);
  let dir = null;
  if (locked()) { const f = camera.forward, cp = camera.getPosition(); dir = new pc.Vec3(cp.x + f.x * 45 - origin.x, cp.y + f.y * 45 - origin.y, cp.z + f.z * 45 - origin.z).normalize(); }
  const ref = dir || new pc.Vec3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  let best = null, bestA = locked() ? 0.2 : 0.7;
  for (const e of enemies) {
    if (!e.alive || e.state === 'dormant') continue;
    const to = new pc.Vec3(e.x - origin.x, e.y + e.d.h * 0.55 - origin.y, e.z - origin.z), d = to.length(); if (d > 38) continue;
    to.mulScalar(1 / d); const a = Math.acos(clamp(to.x * ref.x + to.y * ref.y + to.z * ref.z, -1, 1)); if (a < bestA) { bestA = a; best = to; }
  }
  return { origin, dir: best || dir || new pc.Vec3(Math.sin(player.yaw), 0.03, Math.cos(player.yaw)) };
}
function weaponActions(dt, moving, wx, wz) {
  const p = player, w = p.weapon, st = stats();
  const atk = take('Attack') || take('KeyJ'), up = take('AttackUp'), pow = take('KeyF');
  if (w === 'sword') {
    if (atk && p.attack <= 0.12 && p.dodge <= 0 && p.spin <= 0 && p.st >= 8) {
      p.combo = p.comboWindow > 0 ? (p.combo % 3) + 1 : 1; p.attack = p.combo === 3 ? 0.5 : 0.36; p.attackHit = false; p.comboWindow = p.attack + 0.35; p.st -= 8; play('swing');
      const tgt = nearestEnemy(4.5); if (tgt) p.yaw = Math.atan2(tgt.x - p.x, tgt.z - p.z); else if (moving) p.yaw = Math.atan2(wx, wz);
      enemyReflex(3.4);
    }
    if (pow && p.powerCd.sword <= 0 && p.dodge <= 0) {
      if (p.st < 30) { toast('Pas assez d’endurance.'); } else { p.st -= 30; p.powerCd.sword = 4; p.spin = 0.45; p.attack = 0; play('whoosh'); enemyReflex(3.8); spinAttack(); }
    }
  } else if (w === 'bow') {
    if (atk && !p.charging && p.primCd <= 0) { if (save.arrows <= 0) { toast('Plus de flèches : ouvre des coffres ou achète-en à Ilyas.'); play('wrong'); } else { p.charging = true; p.chargeT = 0; } }
    if (p.charging) { p.chargeT += dt; if (up || (!held.attack && p.chargeT > 0.05)) fireArrow(); }
    if (pow && p.powerCd.bow <= 0) { if (save.arrows < 5) toast('Il faut 5 flèches pour une volée.'); else volley(); }
  } else if (w === 'staff') {
    if (atk && p.primCd <= 0) {
      if (p.mp < 15) noMana(); else { p.mp -= 15; p.primCd = 0.55; p.cast = 0.35; const { origin, dir } = aimDir(); p.yaw = Math.atan2(dir.x, dir.z);
        shoot('fire', 'player', origin.x + dir.x, origin.y + dir.y, origin.z + dir.z, dir.x, dir.y, dir.z, 26 * st.dmg); play('fireCast'); }
    }
    if (pow && p.powerCd.staff <= 0) { if (p.mp < 35) noMana(); else { p.mp -= 35; p.powerCd.staff = 9; p.cast = 0.5; frostNova(); } }
  } else if (w === 'flute') {
    if (atk && p.primCd <= 0) { if (p.mp < 8) noMana(); else { p.mp -= 8; p.primCd = 0.8; p.cast = 0.45; soundWave(); } }
    if (pow && p.powerCd.flute <= 0) {
      if (p.mp < 40) noMana(); else { p.mp -= 40; p.powerCd.flute = 16; p.cast = 1.0; p.hot += 45; play('melody'); burst(p.x, p.y + 1.6, p.z, 26, 'gold', 2.5, 0.14, 1.6, -1.5); toast('Mélodie de guérison : ta vie se régénère.'); }
    }
  }
}
function fireArrow() {
  const p = player; p.charging = false; p.primCd = 0.35; p.cast = 0.2;
  const k = clamp(p.chargeT / 0.9, 0.3, 1), { origin, dir } = aimDir(); p.yaw = Math.atan2(dir.x, dir.z); save.arrows--;
  shoot('arrow', 'player', origin.x + dir.x * 0.8, origin.y + dir.y * 0.8, origin.z + dir.z * 0.8, dir.x, dir.y + 0.02, dir.z, (12 + 26 * k) * stats().dmg, { speedMul: 0.6 + 0.5 * k }); play('arrow');
}
function volley() {
  const p = player; p.powerCd.bow = 8; save.arrows -= 5; p.cast = 0.3; const { origin, dir } = aimDir(); const yaw = Math.atan2(dir.x, dir.z); p.yaw = yaw;
  for (let i = -2; i <= 2; i++) { const a = yaw + i * 0.12; shoot('arrow', 'player', origin.x, origin.y, origin.z, Math.sin(a), dir.y + 0.03, Math.cos(a), 22 * stats().dmg); }
  play('arrow'); setTimeout(() => play('arrow'), 60);
}
function spinAttack() {
  const p = player; let hit = false;
  for (const e of enemies) { if (!e.alive || e.state === 'dormant') continue; const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz); if (d - e.d.radius * 0.6 < 3.6) { damageEnemy(e, Math.round(20 * stats().dmg), dx / (d || 1), dz / (d || 1), false, 'melee'); hit = true; } }
  ring(p.x, p.z, 3.6, 'gold', 0.35); if (hit) { hitStop = 0.06; shake(0.3); play('hit'); }
}
function frostNova() {
  const p = player; play('freeze'); ring(p.x, p.z, 7.5, 'blue', 0.5); burst(p.x, p.y + 0.8, p.z, 40, 'blue', 9, 0.18, 1, 2);
  for (const e of enemies) { if (!e.alive || e.state === 'dormant' || e.kind === 'pylon') continue; const d = dist2(e.x, e.z, p.x, p.z); if (d < 7.5) { e.frozen = e.kind === 'boss' ? 1.2 : 3; e.state = e.kind === 'boss' ? e.state : 'chase'; damageEnemy(e, Math.round(10 * stats().dmg), 0, 0, false, 'magic'); } }
}
function soundWave() {
  const p = player; play('note'); ring(p.x + Math.sin(p.yaw) * 3, p.z + Math.cos(p.yaw) * 3, 5, 'gold', 0.4);
  burst(p.x + Math.sin(p.yaw) * 1.5, p.y + 1.5, p.z + Math.cos(p.yaw) * 1.5, 12, 'gold', 6, 0.12, 0.6, 0);
  for (const e of enemies) {
    if (!e.alive || e.state === 'dormant' || e.kind === 'pylon') continue;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz), ang = Math.abs(((Math.atan2(dx, dz) - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d < 9 && ang < 1.3) { e.stun = e.kind === 'boss' ? 0.3 : 1.4; damageEnemy(e, Math.round(6 * stats().dmg), dx / (d || 1), dz / (d || 1), false, 'magic'); if (e.kind !== 'boss') { e.vx += dx / (d || 1) * 10; e.vz += dz / (d || 1) * 10; } }
  }
}

/* ---------- Projectiles ---------- */
const projectiles = [];
const PROJ = {
  arrow: { speed: 46, g: 9, radius: 0.4 }, fire: { speed: 28, g: 0, radius: 0.6 }, acid: { speed: 15, g: 14, radius: 0.5 },
  orb: { speed: 12, g: 0, radius: 0.55, homing: 1.4 }, shard: { speed: 26, g: 0, radius: 0.55 },
};
function projEntity(kind) {
  const e = new pc.Entity(kind); world.addChild(e);
  if (kind === 'arrow') { prim('box', mat('belt'), e, [0, 0, 0], [0.05, 0.05, 0.9], [0, 0, 0], false); prim('box', mat('blade'), e, [0, 0, 0.5], [0.09, 0.09, 0.14], [0, 0, 0], false); prim('box', mat('cape'), e, [0, 0, -0.42], [0.02, 0.12, 0.16], [0, 0, 0], false); }
  if (kind === 'fire') { prim('sphere', mat('fireball', { unlit: true, emissive: '#FF8A2A', ei: 5 }), e, [0, 0, 0], [0.55, 0.55, 0.55], [0, 0, 0], false); prim('sphere', mat('fire2'), e, [0, 0, 0], [0.8, 0.8, 0.8], [0, 0, 0], false);
    const l = new pc.Entity('lueur'); l.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.55, 0.2), intensity: 2, range: 7, castShadows: false }); e.addChild(l); }
  if (kind === 'acid') prim('sphere', mat('acid', { diffuse: '#7BE05A', emissive: '#4FB82E', ei: 1.5, gloss: 0.9 }), e, [0, 0, 0], [0.45, 0.4, 0.45], [0, 0, 0], false);
  if (kind === 'orb') { prim('sphere', mat('orb2', { unlit: true, emissive: '#B07CFF', ei: 4 }), e, [0, 0, 0], [0.5, 0.5, 0.5], [0, 0, 0], false); prim('sphere', mat('orbHalo', { unlit: true, emissive: '#6A3DD8', ei: 2, opacity: 0.4 }), e, [0, 0, 0], [0.9, 0.9, 0.9], [0, 0, 0], false); }
  if (kind === 'shard') prim('cone', mat('crystal'), e, [0, 0, 0], [0.35, 1.1, 0.35], [90, 0, 0], false);
  return e;
}
function shoot(kind, owner, x, y, z, dx, dy, dz, dmg, extra = {}) {
  const d = PROJ[kind], l = Math.hypot(dx, dy, dz) || 1, sp = d.speed * (extra.speedMul || 1);
  const p = { kind, owner, x, y, z, vx: dx / l * sp, vy: dy / l * sp, vz: dz / l * sp, dmg, life: 5, d, e: projEntity(kind), rolled: new Set(), ...extra };
  if (extra.v) { p.vx = extra.v[0]; p.vy = extra.v[1]; p.vz = extra.v[2]; }
  p.e.setPosition(x, y, z); projectiles.push(p); return p;
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; p.life -= dt;
    if (p.d.homing && p.owner === 'enemy' && !player.dead) {
      const tx = player.x - p.x, ty = player.y + 1.2 - p.y, tz = player.z - p.z, l = Math.hypot(tx, ty, tz) || 1, sp = p.d.speed;
      p.vx = lerp(p.vx, tx / l * sp, p.d.homing * dt); p.vy = lerp(p.vy, ty / l * sp, p.d.homing * dt); p.vz = lerp(p.vz, tz / l * sp, p.d.homing * dt);
    }
    p.vy -= p.d.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.e.setPosition(p.x, p.y, p.z); p.e.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
    if (p.kind === 'fire' && R() < dt * 30) burst(p.x, p.y, p.z, 1, 'fire', 1, 0.12, 0.4, -1);
    let hit = null, impact = false;
    if (p.owner === 'player') {
      for (const e of enemies) {
        if (!e.alive || e.state === 'dormant') continue;
        const cy = e.y + e.d.h * 0.5, dd = Math.hypot(e.x - p.x, cy - p.y, e.z - p.z);
        if (dd < e.d.radius + p.d.radius + e.d.h * 0.25) { hit = e; break; }
        // réflexes : un ennemi qui voit venir le projectile peut l'esquiver
        if (!p.rolled.has(e)) {
          const rx = e.x - p.x, rz = e.z - p.z, sp = Math.hypot(p.vx, p.vz) || 1, ahead = (rx * p.vx + rz * p.vz) / sp, lat = Math.abs(rx * p.vz - rz * p.vx) / sp;
          if (ahead > 0 && ahead < 9 && lat < 1.8) { p.rolled.add(e); if (R() < e.d.reflex * 0.85) { const s = (rx * p.vz - rz * p.vx) > 0 ? 1 : -1; enemyDodge(e, p.vz / sp * s, -p.vx / sp * s, 10); } }
        }
      }
    } else if (!player.dead && Math.hypot(player.x - p.x, player.y + 1.1 - p.y, player.z - p.z) < 0.85 + p.d.radius) {
      if (player.invuln <= 0) { hurtPlayer(p.dmg, p.x - p.vx, p.z - p.vz, p.kind === 'acid' ? { slow: 2.5 } : {}); impact = true; }
    }
    const g = groundAt(p.x, p.z);
    if (p.y < g + 0.1 || p.y < SEA - 0.3) impact = true;
    else for (const c of nearColliders(p.x, p.z)) if (c.on && c.tag !== 'barrier' && p.y < g + (c.tag === 'pillar' ? 9 : 3.5) && Math.hypot(p.x - c.x, p.z - c.z) < c.r) { impact = true; break; }
    if (hit || impact || p.life <= 0) { onImpact(p, hit); p.e.destroy(); projectiles.splice(i, 1); }
  }
}
function onImpact(p, e) {
  const n = Math.hypot(p.vx, p.vz) || 1;
  if (p.kind === 'arrow') { if (e) { damageEnemy(e, Math.round(p.dmg), p.vx / n, p.vz / n, R() < 0.15, 'arrow'); play('arrowHit'); } burst(p.x, p.y, p.z, 4, 'stone', 3, 0.08, 0.4); }
  else if (p.kind === 'fire') {
    play('boom'); shake(0.35); burst(p.x, p.y, p.z, 34, 'fire', 8, 0.2, 0.8, 3); ring(p.x, p.z, 3.6, 'fire', 0.3); flash(p.x, p.y, p.z, '#FF8A3A');
    for (const x of enemies) { if (!x.alive || x.state === 'dormant') continue; const d = Math.hypot(x.x - p.x, x.y + x.d.h * 0.4 - p.y, x.z - p.z) - x.d.radius * 0.5; if (d < 3.6) { damageEnemy(x, Math.round(p.dmg * (1 - d / 6)), (x.x - p.x) / (d + 0.1), (x.z - p.z) / (d + 0.1), false, 'magic'); if (x.alive) { x.burn = 3; x.burnTick = 0.6; } } }
  } else if (p.kind === 'acid') { burst(p.x, p.y, p.z, 12, 'slime', 4, 0.14, 0.6); if (dist2(player.x, player.z, p.x, p.z) < 1.8 && player.invuln <= 0 && Math.abs(player.y - p.y) < 2) hurtPlayer(Math.round(p.dmg * 0.6), p.x, p.z, { slow: 2.5 }); }
  else burst(p.x, p.y, p.z, 12, 'violet', 4, 0.14, 0.6);
}
const flashes = [];
function flash(x, y, z, color) { const l = new pc.Entity('éclair'); l.addComponent('light', { type: 'omni', color: col(color), intensity: 4, range: 12, castShadows: false }); l.setPosition(x, y + 1, z); world.addChild(l); flashes.push({ l, t: 0.25 }); }
/* Anneaux au sol : télégraphes d'attaques ennemies et effets de sorts */
const rings = [];
function ring(x, z, r, color, life, warn = false) {
  let g = rings.find((q) => !q.on && q.color === color);
  if (!g) { const e = prim('cylinder', mat('ring:' + color, { unlit: true, emissive: parts.colors[color] || color, ei: warn ? 2 : 3, opacity: warn ? 0.38 : 0.5, cull: pc.CULLFACE_NONE }), world, [0, 0, 0], [1, 0.04, 1], [0, 0, 0], false); g = { e, color }; rings.push(g); }
  g.on = true; g.t = 0; g.life = life; g.r = r; g.grow = !warn; g.e.enabled = true; g.e.setPosition(x, groundAt(x, z) + 0.08, z); g.e.setLocalScale(warn ? r * 2 : 0.5, 0.04, warn ? r * 2 : 0.5);
  return g;
}
const hazards = [];
function updateFx(dt) {
  for (const g of rings) { if (!g.on) continue; g.t += dt; if (g.grow) { const s = lerp(0.5, g.r * 2, Math.min(1, g.t / g.life)); g.e.setLocalScale(s, 0.04, s); } if (g.t >= g.life) { g.on = false; g.e.enabled = false; } }
  for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t -= dt; f.l.light.intensity = Math.max(0, f.t * 16); if (f.t <= 0) { f.l.destroy(); flashes.splice(i, 1); } }
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i]; h.t -= dt;
    if (h.kind === 'wave') {             // onde de choc du Colosse : saute pour l'éviter
      h.r += dt * 10; h.ring.e.setLocalScale(h.r * 2, 0.04, h.r * 2); h.ring.t = 0;
      const d = dist2(player.x, player.z, h.x, h.z);
      if (!h.hit && Math.abs(d - h.r) < 0.9 && player.y - groundAt(player.x, player.z) < 0.4) { h.hit = true; hurtPlayer(16, h.x, h.z); }
      if (h.r > 14) { h.ring.on = false; h.ring.e.enabled = false; hazards.splice(i, 1); }
      continue;
    }
    if (h.t <= 0) {
      if (dist2(player.x, player.z, h.x, h.z) < h.r) { hurtPlayer(h.dmg, h.x, h.z, h.root ? { root: h.root } : {}); }
      burst(h.x, groundAt(h.x, h.z) + 0.3, h.z, 18, h.color, 6, 0.18, 0.7); if (h.root) for (let k = 0; k < 6; k++) burst(h.x, groundAt(h.x, h.z), h.z, 2, 'green', 3, 0.2, 0.9, 1);
      hazards.splice(i, 1);
    }
  }
}

/* =====================================================================
   Ennemis : réflexes, garde, encerclement, pouvoirs
   ===================================================================== */
function enemyRig(kind) {
  const root = new pc.Entity(kind); world.addChild(root);
  const body = new pc.Entity('corps'); root.addChild(body);
  const r = { root, body, kind, parts: {} };
  if (kind === 'slime' || kind === 'mini') {
    const m = new pc.StandardMaterial(); m.diffuse = col('#4FC3A1'); m.emissive = col('#1E7F6C'); m.emissiveIntensity = 0.5; m.gloss = 0.88; m.useMetalness = true; m.metalness = 0; m.opacity = 0.86; m.blendType = pc.BLEND_NORMAL; m.update();
    r.mat = m; const s = kind === 'mini' ? 0.6 : 1; body.setLocalScale(s, s, s);
    r.parts.blob = prim('sphere', m, body, [0, 0.62, 0], [1.4, 1.2, 1.4]); prim('sphere', mat('slimeCore', { diffuse: '#2E8F74', emissive: '#3BD1A8', ei: 1.2 }), body, [0, 0.55, 0], [0.5, 0.45, 0.5]);
    prim('sphere', mat('eye'), body, [-0.24, 0.84, 0.6], [0.16, 0.22, 0.1]); prim('sphere', mat('eye'), body, [0.24, 0.84, 0.6], [0.16, 0.22, 0.1]);
  } else if (kind === 'wisp') {
    const robe = mat('wispRobe', { diffuse: '#2F4A3A', gloss: 0.3 }), eyeM = new pc.StandardMaterial(); eyeM.diffuse = new pc.Color(0, 0, 0); eyeM.emissive = col('#B07CFF'); eyeM.emissiveIntensity = 4; eyeM.update(); r.eyeMat = eyeM;
    prim('cone', robe, body, [0, 0.9, 0], [1.1, 1.8, 1.1]); prim('box', mat('bark', { diffuse: '#5B4630', gloss: 0.2 }), body, [0, 1.9, 0], [0.7, 0.5, 0.5]);
    const head = prim('sphere', mat('mask', { diffuse: '#D9D2BF', gloss: 0.5 }), body, [0, 2.35, 0.05], [0.55, 0.62, 0.5]);
    prim('box', eyeM, head, [-0.18, 0.05, 0.45], [0.18, 0.1, 0.05]); prim('box', eyeM, head, [0.18, 0.05, 0.45], [0.18, 0.1, 0.05]);
    for (let i = 0; i < 4; i++) prim('cone', mat('antler', { diffuse: '#7A6248' }), head, [(i < 2 ? -1 : 1) * (0.2 + (i % 2) * 0.15), 0.5, -0.05], [0.08, 0.5, 0.08], [0, 0, (i < 2 ? 1 : -1) * (20 + (i % 2) * 25)]);
    const arm = (x) => { const p = new pc.Entity('bras'); p.setLocalPosition(x, 1.95, 0); body.addChild(p); prim('box', robe, p, [0, -0.45, 0], [0.18, 0.9, 0.18]); return p; };
    r.parts.armL = arm(-0.45); r.parts.armR = arm(0.45);
    r.parts.orb = prim('sphere', mat('orb2'), body, [0, 1.5, 0.8], [0.3, 0.3, 0.3], [0, 0, 0], false);
  } else if (kind === 'pylon') {
    const cm = mat('crystal'); for (let i = 0; i < 4; i++) prim('cone', cm, body, [(R() - 0.5) * 0.8, 0, (R() - 0.5) * 0.8], [0.6, 2.4 + R() * 1.6, 0.6], [(R() - 0.5) * 20, 0, (R() - 0.5) * 20]);
    const l = new pc.Entity('lueur'); l.addComponent('light', { type: 'omni', color: col('#C59BFF'), intensity: 2.5, range: 9, castShadows: false }); l.setLocalPosition(0, 2, 0); body.addChild(l);
  } else {
    const boss = kind === 'boss', sc = boss ? 2.6 : 1;
    const stoneM = boss ? mat('bossStone', { diffuse: '#6E6690', gloss: 0.35 }) : mat('golemStone', { diffuse: '#8B8579', gloss: 0.2 });
    const eyeM = new pc.StandardMaterial(); eyeM.diffuse = new pc.Color(0, 0, 0); eyeM.emissive = col(boss ? '#D9B8FF' : '#7FE3FF'); eyeM.emissiveIntensity = 3; eyeM.update(); r.eyeMat = eyeM;
    body.setLocalScale(sc, sc, sc);
    prim('box', stoneM, body, [0, 1.25, 0], [1.25, 1.15, 0.9]); prim('box', mat('moss', { diffuse: '#6E8F4E', gloss: 0.1 }), body, [0, 1.86, -0.05], [1.3, 0.12, 0.95]);
    prim('box', stoneM, body, [0, 0.82, 0.32], [0.9, 0.4, 0.3]);
    const head = prim('box', stoneM, body, [0, 2.15, 0.1], [0.62, 0.55, 0.6]);
    prim('box', eyeM, head, [-0.22, 0.05, 0.51], [0.2, 0.12, 0.05]); prim('box', eyeM, head, [0.22, 0.05, 0.51], [0.2, 0.12, 0.05]);
    const arm = (x) => { const p = new pc.Entity('bras'); p.setLocalPosition(x, 1.75, 0); body.addChild(p); prim('box', stoneM, p, [0, -0.55, 0], [0.42, 1.1, 0.46]); prim('box', stoneM, p, [0, -1.2, 0.05], [0.55, 0.45, 0.6]); return p; };
    r.parts.armL = arm(-0.88); r.parts.armR = arm(0.88);
    prim('box', stoneM, body, [-0.35, 0.35, 0], [0.42, 0.7, 0.5]); prim('box', stoneM, body, [0.35, 0.35, 0], [0.42, 0.7, 0.5]);
    if (boss) {
      const cm = mat('crystal'); for (let i = 0; i < 9; i++) prim('cone', cm, body, [(R() - 0.5) * 1.2, 1.9 + R() * 0.3, -0.35 - R() * 0.2], [0.25, 0.7 + R() * 0.8, 0.25], [-30 + R() * 20, 0, (R() - 0.5) * 40]);
      r.shield = prim('sphere', mat('bossShield', { unlit: true, emissive: '#B48CFF', ei: 1.4, opacity: 0.25, cull: pc.CULLFACE_NONE }), root, [0, 3.2, 0], [9, 9, 9], [0, 0, 0], false); r.shield.enabled = false;
    }
  }
  if (kind !== 'pylon') { const s = kind === 'boss' ? 6.5 : kind === 'golem' ? 3 : kind === 'wisp' ? 2.4 : kind === 'mini' ? 1 : 1.8;
    r.ice = prim('sphere', mat('ice', { diffuse: '#BFE6FF', emissive: '#6FB8FF', ei: 0.6, opacity: 0.45, gloss: 0.95 }), root, [0, s * 0.45, 0], [s * 0.8, s, s * 0.8], [0, 0, 0], false); r.ice.enabled = false; }
  return r;
}
const ENEMY = {
  slime: { name: 'Brumelin', hp: 34, speed: 4.6, range: 2.2, wind: 0.45, dmg: 11, radius: 0.8, aggro: 14, h: 1.2, reflex: 0.2, gold: [3, 7] },
  mini: { name: 'Petit Brumelin', hp: 12, speed: 5.4, range: 1.8, wind: 0.35, dmg: 6, radius: 0.5, aggro: 16, h: 0.7, reflex: 0.25, gold: [1, 2] },
  golem: { name: 'Gardien de pierre', hp: 80, speed: 3.2, range: 2.7, wind: 0.7, dmg: 20, radius: 1.1, aggro: 15, h: 2.6, reflex: 0.08, block: 0.38, gold: [8, 14] },
  wisp: { name: 'Sylvain corrompu', hp: 46, speed: 4.4, range: 12, wind: 0.55, dmg: 13, radius: 0.7, aggro: 20, h: 2.4, reflex: 0.45, gold: [10, 15] },
  pylon: { name: 'Cristal du bouclier', hp: 40, speed: 0, range: 0, wind: 0, dmg: 0, radius: 1.1, aggro: 0, h: 3.2, reflex: 0, gold: [0, 0] },
  boss: { name: 'Colosse de cristal', hp: 420, speed: 3.4, range: 5, wind: 1.0, dmg: 28, radius: 2.6, aggro: 26, h: 6.5, reflex: 0, gold: [120, 120] },
};
function spawnEnemy(kind, x, z, zone = null) {
  const [px, pz] = findLand(x, z, 1.2), d = ENEMY[kind];
  const e = { kind, d, zone, hx: px, hz: pz, x: px, z: pz, y: groundAt(px, pz), vx: 0, vz: 0, yaw: R() * 6, hp: d.hp, maxHp: d.hp, state: 'idle', t: R() * 3, cd: 1, cd2: 2 + R() * 2, cd3: 2, alive: true,
    flash: 0, stag: 0, tx: px, tz: pz, orbit: R() < 0.5 ? 1 : -1, inv: 0, frozen: 0, stun: 0, burn: 0, burnTick: 0, rig: enemyRig(kind) };
  e.rig.root.setPosition(e.x, e.y, e.z); enemies.push(e); return e;
}
function populateEnemies() {
  clearEnemies(); hazards.length = 0; projectiles.splice(0).forEach((p) => p.e.destroy());
  if (!save.cleared.forest) { [[-128, 20], [-112, 40], [-104, 18]].forEach(([x, z]) => spawnEnemy('slime', x, z, 'forest')); spawnEnemy('wisp', -134, 38, 'forest'); }
  if (!save.cleared.lake) { [[104, -4], [122, -24]].forEach(([x, z]) => spawnEnemy('golem', x, z, 'lake')); [[116, 2], [100, -26]].forEach(([x, z]) => spawnEnemy('slime', x, z, 'lake')); spawnEnemy('wisp', 126, -2, 'lake'); }
  if (!save.cleared.ridge) { [[2, -112], [-8, -122]].forEach(([x, z]) => spawnEnemy('golem', x, z, 'ridge-path')); spawnEnemy('wisp', 12, -118, 'ridge-path'); W.boss = spawnEnemy('boss', 0, -146, 'ridge'); W.boss.state = 'dormant'; }
  [[-58, 12, 'slime'], [58, -4, 'slime'], [6, -72, 'golem'], [-8, 92, 'slime'], [60, 60, 'wisp'], [-60, -70, 'golem']].forEach(([x, z, k]) => spawnEnemy(k, x, z, null));
  for (const c of chests) if (!c.open && c.guard) c.guard.forEach((k, i) => spawnEnemy(k, c.x + (i ? 3 : -3), c.z + 2, 'guard'));
}
const meleeBusy = (x) => x.alive && x.kind !== 'boss' && (x.state === 'windup' || x.state === 'strike' || x.state === 'charge');
function enemyDodge(e, sx, sz, speed) {
  if (!e.alive || e.kind === 'boss' || e.kind === 'pylon' || e.frozen > 0 || e.stun > 0 || ['windup', 'strike', 'charge', 'recover', 'dormant', 'dodge'].includes(e.state)) return false;
  if (e.kind === 'wisp' && e.cd3 <= 0) { blink(e); return true; }
  const l = Math.hypot(sx, sz) || 1; e.state = 'dodge'; e.t = 0; e.vx = sx / l * speed; e.vz = sz / l * speed; e.inv = 0.3; play('whoosh'); return true;
}
function enemyReflex(reach) {     // réflexes face à un coup d'épée qui arrive
  for (const e of enemies) {
    if (!e.alive || ['boss', 'pylon'].includes(e.kind) || !['chase', 'idle', 'circle'].includes(e.state) || e.frozen > 0 || e.stun > 0) continue;
    const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz); if (d > reach + 1.4) continue;
    const ang = Math.abs(((Math.atan2(dx, dz) - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (ang > 1.3) continue;
    const r = R();
    if (e.kind === 'golem' && r < e.d.block) { e.state = 'block'; e.t = 0; e.yaw = Math.atan2(-dx, -dz); continue; }
    if (r < e.d.reflex) { const s = R() < 0.5 ? 1 : -1; enemyDodge(e, -dz / d * s + dx / d * 0.4, dx / d * s + dz / d * 0.4, 9); }
  }
}
function blink(e) {
  const p = player; burst(e.x, e.y + 1.2, e.z, 16, 'violet', 5, 0.15, 0.6); play('blink');
  for (let k = 0; k < 8; k++) { const a = R() * Math.PI * 2, d = 10 + R() * 3, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    if (terrainH(x, z) > 0.8 && dist2(x, z, e.hx, e.hz) < 28) { e.x = x; e.z = z; break; } }
  e.y = groundAt(e.x, e.z); e.cd3 = 5 + R() * 2; e.inv = 0.25; e.state = 'chase'; burst(e.x, e.y + 1.2, e.z, 16, 'violet', 5, 0.15, 0.6);
}
function startWindup(e, atk, t) {
  const p = player; e.state = 'windup'; e.atk = atk; e.t = 0; e.wind = t; e.tx = p.x; e.tz = p.z;
  if (atk === 'stomp') e.warn = ring(e.x, e.z, 4.3, 'red', t, true);
  if (atk === 'slam') { e.slamX = p.x; e.slamZ = p.z; e.warn = ring(p.x, p.z, 5.2, 'red', t, true); }
  if (atk === 'charge') { const d = Math.hypot(p.x - e.x, p.z - e.z) || 1; e.cdx = (p.x - e.x) / d; e.cdz = (p.z - e.z) / d; play('charge'); }
}
function finishWindup(e, d) {
  const p = player, D = e.d;
  switch (e.atk) {
    case 'melee':
      if (e.kind === 'golem') { const dx = p.x - e.x, dz = p.z - e.z, ang = Math.abs(((Math.atan2(dx, dz) - e.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < D.range + 0.6 && ang < 1.1) hurtPlayer(D.dmg, e.x, e.z); play('slam'); shake(0.25); e.state = 'recover'; e.t = 0; e.rec = 0.55; e.cd = 1.3 + R(); }
      else { const l = d || 1; e.vx = (p.x - e.x) / l * 13; e.vz = (p.z - e.z) / l * 13; e.state = 'strike'; e.t = 0; e.hitDone = false; play('spit'); }
      return;
    case 'spit': {
      const ox = e.x, oy = e.y + 1, oz = e.z, hx = p.x + p.vx * 0.5 - ox, hz = p.z + p.vz * 0.5 - oz, dist = Math.hypot(hx, hz) || 1, t = dist / 14;
      shoot('acid', 'enemy', ox, oy, oz, 0, 0, 0, D.dmg, { v: [hx / t, ((p.y + 1) - oy + 0.5 * 14 * t * t) / t, hz / t] }); play('spit'); e.cd2 = 3.5 + R() * 2; e.state = 'chase'; return;
    }
    case 'stomp':
      if (d < 4.4 && p.y - groundAt(p.x, p.z) < 0.5) hurtPlayer(20, e.x, e.z); play('slam'); shake(0.5); burst(e.x, e.y + 0.2, e.z, 26, 'stone', 7, 0.2, 0.7);
      e.cd3 = 6 + R() * 2; e.state = 'recover'; e.t = 0; e.rec = 0.8; return;
    case 'charge': e.state = 'charge'; e.t = 0; e.hitDone = false; return;
    case 'cast': { const ox = e.x + Math.sin(e.yaw) * 0.8, oz = e.z + Math.cos(e.yaw) * 0.8; shoot('orb', 'enemy', ox, e.y + 1.8, oz, p.x - ox, p.y + 1.2 - e.y - 1.8, p.z - oz, D.dmg); play('blink'); e.cd = 2.2 + R() * 1.2; e.state = 'chase'; return; }
    case 'root': hazards.push({ kind: 'root', x: e.tx, z: e.tz, r: 1.9, t: 1.0, dmg: 14, root: 1.3, color: 'green' }); ring(e.tx, e.tz, 1.9, 'green', 1.0, true); e.cd2 = 7 + R() * 2; e.state = 'chase'; return;
    case 'slam':
      if (dist2(p.x, p.z, e.slamX, e.slamZ) < 5.2 && p.y - groundAt(p.x, p.z) < 0.6) hurtPlayer(D.dmg, e.slamX, e.slamZ);
      play('slam'); shake(0.9); burst(e.slamX, groundAt(e.slamX, e.slamZ) + 0.2, e.slamZ, 30, 'violet', 9, 0.25, 0.9);
      if (e.enraged) hazards.push({ kind: 'wave', x: e.slamX, z: e.slamZ, r: 0.5, t: 99, ring: ring(e.slamX, e.slamZ, 1, 'violet', 99, true) });
      e.cd = e.enraged ? 1.0 : e.phase2 ? 1.4 : 1.9; e.state = 'recover'; e.t = 0; e.rec = 0.7; return;
    case 'volley': {
      const yaw = Math.atan2(p.x - e.x, p.z - e.z); for (let i = -2; i <= 2; i++) { const a = yaw + i * 0.18; shoot('shard', 'enemy', e.x + Math.sin(a) * 3, e.y + 4, e.z + Math.cos(a) * 3, Math.sin(a), -0.08, Math.cos(a), 16); }
      play('shield'); e.cd2 = e.enraged ? 3.5 : 5.5; e.state = e.shield ? 'shield' : 'chase'; return;
    }
  }
}
function startShield(e) {
  e.shield = true; e.state = 'shield'; e.t = 0; e.rig.shield.enabled = true; play('shield'); shake(0.6);
  e.pylons = [0, 1, 2].map((i) => { const a = i / 3 * Math.PI * 2 + 0.5, x = e.hx + Math.cos(a) * 15, z = e.hz + Math.sin(a) * 15; const py = spawnEnemy('pylon', x, z, 'pylon'); py.state = 'pylon'; return py; });
  toast('Le Colosse s’entoure d’un bouclier ! Détruis les trois cristaux qui l’alimentent.');
}
function damageEnemy(e, dmg, nx, nz, crit, src = 'melee') {
  if (!e.alive) return;
  const top = e.y + e.d.h + 0.4;
  if (e.kind === 'boss' && e.shield) { floater(e.x, top, e.z, 'Bouclier', 'crit'); burst(e.x, e.y + 3, e.z, 6, 'violet', 4, 0.14, 0.5); play('block'); return; }
  if (e.inv > 0 && src !== 'burn') { floater(e.x, top, e.z, 'Esquive', ''); return; }
  if (e.state === 'block' && (src === 'melee' || src === 'arrow')) {
    const fa = Math.abs(((Math.atan2(player.x - e.x, player.z - e.z) - e.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (fa < 1.25) { dmg = Math.max(1, Math.round(dmg * 0.2)); floater(e.x, top, e.z, `Paré ${dmg}`, ''); play('block'); burst(e.x + Math.sin(e.yaw), e.y + 1.6, e.z + Math.cos(e.yaw), 10, 'white', 6, 0.08, 0.3); e.hp -= dmg; if (e.hp <= 0) killEnemy(e); return; }
  }
  if (e.frozen > 0 && src !== 'burn' && src !== 'magic') dmg = Math.round(dmg * 1.3);
  if (e.state === 'recover') dmg = Math.round(dmg * 1.4);
  e.hp -= dmg; e.flash = 0.15; e.hitsTaken = (e.hitsTaken || 0) + 1;
  if (src !== 'burn') { play('enemyHit'); burst(e.x, e.y + e.d.h * 0.5, e.z, 6, e.kind === 'slime' || e.kind === 'mini' ? 'slime' : e.kind === 'boss' || e.kind === 'pylon' || e.kind === 'wisp' ? 'violet' : 'stone', 6, 0.16, 0.6); }
  floater(e.x, top, e.z, crit ? `${dmg} !` : `${dmg}`, crit ? 'crit' : src === 'burn' ? 'burn' : '');
  if (e.kind !== 'boss' && e.kind !== 'pylon' && src !== 'burn') { const kb = e.kind === 'slime' || e.kind === 'mini' ? 10 : e.kind === 'wisp' ? 8 : 4; e.vx += nx * kb; e.vz += nz * kb; if (e.state === 'windup' && e.kind !== 'golem') { e.state = 'chase'; e.warn = null; } }
  if (['idle', 'return'].includes(e.state)) e.state = 'chase';
  if (e.kind === 'boss') {
    if (!e.shieldDone && !e.shield && e.hp < e.maxHp * 0.6) startShield(e);
    if (!e.phase2 && e.hp < e.maxHp * 0.35) { e.phase2 = true; toast('Le Colosse appelle ses serviteurs !'); ['slime', 'slime', 'wisp'].forEach((k, i) => { const s = spawnEnemy(k, e.x + (i - 1) * 7, e.z + 5, 'ridge-adds'); s.state = 'chase'; }); e.d = { ...e.d, speed: 4.2 }; shake(0.8); }
    if (!e.enraged && e.hp < e.maxHp * 0.18) { e.enraged = true; toast('Le Colosse entre en rage : saute par-dessus ses ondes de choc !'); }
  }
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.alive = false; e.dieT = 0.6; e.rig.ice && (e.rig.ice.enabled = false);
  if (e.kind === 'pylon') { play('boom'); burst(e.x, e.y + 2, e.z, 30, 'violet', 8, 0.2, 1); const b = W.boss; if (b?.shield && b.pylons.every((q) => !q.alive)) { b.shield = false; b.shieldDone = true; b.rig.shield.enabled = false; b.state = 'recover'; b.t = 0; b.rec = 2.2; toast('Le bouclier se brise ! Le Colosse chancelle.'); shake(0.8); play('open'); } return; }
  save.kills++; play('death');
  burst(e.x, e.y + 1, e.z, e.kind === 'boss' ? 60 : 18, e.kind === 'slime' || e.kind === 'mini' ? 'slime' : e.kind === 'boss' || e.kind === 'wisp' ? 'violet' : 'stone', e.kind === 'boss' ? 12 : 7, 0.22, 1.2);
  const [g0, g1] = e.d.gold, gold = g0 + Math.floor(R() * (g1 - g0 + 1));
  if (gold) { save.gold += gold; setTimeout(() => { floater(e.x, e.y + 1.5, e.z, `+${gold} or`, 'gold'); play('coin'); }, 200); burst(e.x, e.y + 1, e.z, 8, 'gold', 4, 0.12, 0.8); }
  if (e.kind === 'slime') { toast('Le Brumelin se divise !'); [-1, 1].forEach((s) => { const m = spawnEnemy('mini', e.x + s * 1.2, e.z, e.zone); m.state = 'chase'; m.vx = s * 6; }); }
  if (e.kind === 'boss') { save.cleared.ridge = true; $('bossBar').hidden = true; Audio.setMode('explore'); toast('Le Colosse de cristal s’effondre. La barrière se dissout !'); openZone('ridge'); writeSave(); }
  if (e.zone && ZONES[e.zone] && e.zone !== 'ridge') {
    const left = enemies.filter((x) => x.alive && x.zone === e.zone).length;
    if (!left) { save.cleared[e.zone] = true; toast(save.runes[e.zone] ? 'Zone libérée : la barrière s’ouvre !' : 'Zone libérée. Il reste l’énigme de la stèle.'); if (zoneOpen(e.zone)) openZone(e.zone); writeSave(); }
  }
  if (R() < (e.kind === 'slime' || e.kind === 'mini' ? 0.2 : 0.45)) dropFlower(e.x, e.z);
}
function updateEnemies(dt) {
  const p = player, attackers = enemies.filter(meleeBusy).length;
  for (const e of enemies) {
    const r = e.rig;
    if (!e.alive) { if (e.dieT > 0) { e.dieT -= dt; const s = Math.max(0.01, e.dieT / 0.6); r.root.setLocalScale(s, s * 0.6, s); if (e.dieT <= 0) r.root.enabled = false; } continue; }
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 0.001, D = e.d;
    if (e.kind === 'pylon') { r.body.setLocalEulerAngles(0, state.time * 30, 0); r.root.setPosition(e.x, e.y, e.z); continue; }
    e.flash = Math.max(0, e.flash - dt); e.inv = Math.max(0, e.inv - dt); e.t += dt; e.cd -= dt; e.cd2 -= dt; e.cd3 -= dt;
    if (e.burn > 0) { e.burn -= dt; e.burnTick -= dt; if (R() < dt * 12) burst(e.x, e.y + D.h * 0.6, e.z, 1, 'fire', 1.5, 0.1, 0.5, -1); if (e.burnTick <= 0) { e.burnTick = 0.6; damageEnemy(e, 3, 0, 0, false, 'burn'); if (!e.alive) continue; } }
    let tvx = 0, tvz = 0, control = false;
    if (e.frozen > 0) { e.frozen -= dt; control = true; e.vx *= 0.8; e.vz *= 0.8; if (e.frozen <= 0 && e.state === 'windup') e.state = 'chase'; }
    else if (e.stun > 0) { e.stun -= dt; control = true; if (R() < dt * 5) burst(e.x, e.y + D.h + 0.3, e.z, 1, 'gold', 1.5, 0.1, 0.5, 0); if (e.state === 'windup') { e.state = 'chase'; } }
    if (r.ice) r.ice.enabled = e.frozen > 0;
    if (!control) switch (e.state) {
      case 'dormant': if (d < 24 && !p.dead) { e.state = 'chase'; $('bossBar').hidden = false; $('bossName').textContent = D.name; Audio.setMode('boss'); showZoneTitle('Colosse de cristal', 'Gardien de la crête'); } break;
      case 'idle': {
        if (e.t > 2.5) { e.t = 0; const a = R() * Math.PI * 2; e.tx = e.hx + Math.cos(a) * 5; e.tz = e.hz + Math.sin(a) * 5; }
        const ex = e.tx - e.x, ez = e.tz - e.z, l = Math.hypot(ex, ez); if (l > 0.5) { tvx = ex / l * D.speed * 0.35; tvz = ez / l * D.speed * 0.35; e.yaw = angleLerp(e.yaw, Math.atan2(tvx, tvz), clamp(4 * dt, 0, 1)); }
        if (d < D.aggro && !p.dead) { e.state = 'chase'; floater(e.x, e.y + D.h + 0.5, e.z, '!', 'alert'); }
        break;
      }
      case 'return': {
        const hx = e.hx - e.x, hz = e.hz - e.z, l = Math.hypot(hx, hz); e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.3 * dt);
        if (l < 1.5) { e.state = e.kind === 'boss' ? 'dormant' : 'idle'; if (e.kind === 'boss') { $('bossBar').hidden = true; Audio.setMode('explore'); } } else { tvx = hx / l * D.speed; tvz = hz / l * D.speed; e.yaw = angleLerp(e.yaw, Math.atan2(hx, hz), clamp(6 * dt, 0, 1)); }
        break;
      }
      case 'shield': {                  // le Colosse protégé tire des salves d'éclats
        e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), clamp(3 * dt, 0, 1));
        const hx = e.hx - e.x, hz = e.hz - e.z, l = Math.hypot(hx, hz); if (l > 2) { tvx = hx / l * 2; tvz = hz / l * 2; }
        if (e.cd2 <= 0) startWindup(e, 'volley', 0.7);
        break;
      }
      case 'chase': {
        if (p.dead || dist2(e.x, e.z, e.hx, e.hz) > (e.kind === 'boss' ? 42 : 34)) { e.state = 'return'; break; }
        e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), clamp(8 * dt, 0, 1));
        const ux = dx / d, uz = dz / d, orbitX = -uz * e.orbit, orbitZ = ux * e.orbit;
        if (R() < dt * 0.25) e.orbit *= -1;
        if (e.kind === 'wisp') {
          if (d < 5.5 && e.cd3 <= 0) { blink(e); break; }
          if (e.cd <= 0 && d < 20) { startWindup(e, 'cast', D.wind); break; }
          if (e.cd2 <= 0 && d < 16) { startWindup(e, 'root', 0.35); break; }
          const radial = clamp((d - 11) * 0.5, -1, 1); tvx = (ux * radial + orbitX * 0.8) * D.speed; tvz = (uz * radial + orbitZ * 0.8) * D.speed;
        } else if (e.kind === 'boss') {
          if (d > 9 && e.cd2 <= 0) startWindup(e, 'volley', 0.7);
          else if (d < D.range + 0.5 && e.cd <= 0) startWindup(e, 'slam', e.enraged ? 0.75 : D.wind);
          else if (d > D.range * 0.7) { tvx = ux * D.speed; tvz = uz * D.speed; }
        } else {
          const tok = attackers < 2;
          if (e.kind === 'golem' && d > 7 && d < 15 && e.cd2 <= 0 && tok) startWindup(e, 'charge', 0.6);
          else if (e.kind === 'golem' && d < 4.2 && e.cd3 <= 0 && R() < 0.4 && tok) startWindup(e, 'stomp', 0.85);
          else if (e.kind === 'slime' && d > 5 && d < 11 && e.cd2 <= 0 && R() < dt * 2) startWindup(e, 'spit', 0.4);
          else if (d < D.range && e.cd <= 0 && tok) startWindup(e, 'melee', D.wind);
          else if (d < 6.5 && (!tok || e.cd > 0)) { const radial = clamp((d - 4.6) * 0.8, -1, 1); tvx = (ux * radial + orbitX) * D.speed * 0.75; tvz = (uz * radial + orbitZ) * D.speed * 0.75; }
          else { tvx = (ux + orbitX * 0.25) * D.speed; tvz = (uz + orbitZ * 0.25) * D.speed; }
        }
        break;
      }
      case 'windup':
        if (e.kind !== 'golem' || e.atk !== 'charge') e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), clamp((e.kind === 'boss' ? 3 : 6) * dt, 0, 1));
        if (e.kind === 'boss' && e.atk === 'slam' && R() < dt * 30) burst(e.slamX, groundAt(e.slamX, e.slamZ) + 0.1, e.slamZ, 1, 'red', 4, 0.2, 0.4, 2);
        if (e.t >= e.wind) finishWindup(e, d);
        break;
      case 'strike':
        if (!e.hitDone && d < 1.4 + D.radius * 0.5) { hurtPlayer(D.dmg, e.x, e.z); e.hitDone = true; }
        if (e.t > 0.45) { e.state = 'chase'; e.cd = 1.1 + R(); }
        break;
      case 'charge': {
        tvx = e.cdx * 15; tvz = e.cdz * 15; e.yaw = Math.atan2(e.cdx, e.cdz); if (R() < dt * 20) burst(e.x, e.y + 0.2, e.z, 1, 'stone', 3, 0.15, 0.5);
        if (!e.hitDone && d < 1.9) { e.hitDone = true; hurtPlayer(18, e.x, e.z); }
        if (e.t > 1.1 || e.hitDone || e.bumped) { e.state = 'recover'; e.t = 0; e.rec = 1.0; e.cd2 = 7 + R() * 2; e.bumped = false; if (!e.hitDone) floater(e.x, e.y + D.h + 0.4, e.z, 'Étourdi', ''); }
        break;
      }
      case 'recover': if (e.t > (e.rec || 0.6)) e.state = 'chase'; break;
      case 'dodge': if (e.t > 0.3) e.state = 'chase'; break;
      case 'block': e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), clamp(10 * dt, 0, 1)); if (e.t > 0.8) { e.state = 'chase'; e.cd = Math.min(e.cd, 0.2); } break;
    }
    const k = e.state === 'dodge' || e.state === 'strike' ? 0.02 : e.state === 'charge' ? 0.3 : clamp(8 * dt, 0, 1);
    e.vx = lerp(e.vx, tvx, k); e.vz = lerp(e.vz, tvz, k);
    let nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
    for (const c of nearColliders(nx, nz)) { if (!c.on) continue; const cx = nx - c.x, cz = nz - c.z, cd = Math.hypot(cx, cz), m = c.r + D.radius * 0.8; if (cd < m && cd > 0.0001) { nx = c.x + cx / cd * m; nz = c.z + cz / cd * m; if (e.state === 'charge') e.bumped = true; } }
    for (const o of enemies) { if (o === e || !o.alive) continue; const cx = nx - o.x, cz = nz - o.z, cd = Math.hypot(cx, cz), m = (D.radius + o.d.radius) * 0.8; if (cd < m && cd > 0.0001) { nx += cx / cd * (m - cd) * 0.5; nz += cz / cd * (m - cd) * 0.5; } }
    if (terrainH(nx, nz) > 0.2) { e.x = nx; e.z = nz; } else { e.vx = 0; e.vz = 0; if (e.state === 'charge') e.bumped = true; }
    e.y = groundAt(e.x, e.z);
    animateEnemy(e, dt, d);
  }
  const boss = W.boss; if (boss && boss.alive && boss.state !== 'dormant') $('bossHp').style.transform = `scaleX(${clamp(boss.hp / boss.maxHp, 0, 1)})`;
}
function animateEnemy(e, dt, d) {
  const r = e.rig, t = state.time + e.hx, frozen = e.frozen > 0;
  r.root.setPosition(e.x, e.y, e.z); r.root.setEulerAngles(0, e.yaw * 180 / Math.PI, 0);
  if (frozen) return;
  if (e.kind === 'slime' || e.kind === 'mini') {
    let sy = 1 + Math.sin(t * 6) * 0.08, sxz = 1 - Math.sin(t * 6) * 0.05, y = Math.max(0, Math.sin(t * 6)) * 0.25;
    if (e.state === 'windup') { const k = e.t / e.wind; sy = 1 - k * 0.35; sxz = 1 + k * 0.25; y = 0; }
    if (e.state === 'strike') { sy = 1.25; sxz = 0.85; y = 0.6; }
    if (e.state === 'dodge') { sy = 0.8; sxz = 1.2; y = 0.3; }
    const s = e.kind === 'mini' ? 0.6 : 1; r.body.setLocalScale(sxz * s, sy * s, sxz * s); r.body.setLocalPosition(0, y, 0);
    if (e.flash > 0) setGlow(r.mat, 'flash', '#FFFFFF', 2); else if (e.state === 'windup') setGlow(r.mat, e.atk === 'spit' ? 'spit' : 'wind', e.atk === 'spit' ? '#9BFF4A' : '#E65A33', 0.9); else setGlow(r.mat, 'idle', '#1E7F6C', 0.5);
  } else if (e.kind === 'wisp') {
    const y = 0.5 + Math.sin(t * 2.2) * 0.25; r.body.setLocalPosition(0, y, 0);
    const cast = e.state === 'windup'; r.parts.armL.setLocalEulerAngles(cast ? -150 : Math.sin(t * 2) * 15, 0, 15); r.parts.armR.setLocalEulerAngles(cast ? -150 : -Math.sin(t * 2) * 15, 0, -15);
    r.parts.orb.setLocalPosition(Math.sin(t * 3) * 0.9, 1.6 + Math.sin(t * 5) * 0.2, Math.cos(t * 3) * 0.9);
    if (e.flash > 0) setGlow(r.eyeMat, 'flash', '#FFFFFF', 5); else if (cast) setGlow(r.eyeMat, 'hot', '#FF5AE0', 6); else setGlow(r.eyeMat, 'idle', '#B07CFF', 4);
  } else {
    const sp = Math.hypot(e.vx, e.vz), sw = Math.sin(t * 5) * clamp(sp / 3, 0, 1);
    let aL = sw * 25, aR = -sw * 25, lean = 0, crouch = 0;
    if (e.state === 'windup') { const k = e.t / e.wind; if (e.atk === 'charge') { lean = 25 * k; aL = aR = 40; crouch = -0.15 * k; } else if (e.atk === 'stomp') { aL = aR = -60 * k; crouch = 0.3 * k; } else { aL = aR = -k * 150; lean = -k * 12; } }
    if (e.state === 'recover' && e.t < 0.15) { const k = clamp(e.t / 0.15, 0, 1); aL = aR = lerp(-150, 30, k); lean = lerp(-12, 18, k); }
    if (e.state === 'charge') { lean = 28; aL = aR = 50; }
    if (e.state === 'block') { aL = -95; aR = -95; lean = -6; }
    r.parts.armL.setLocalEulerAngles(aL, 0, e.state === 'block' ? 25 : 0); r.parts.armR.setLocalEulerAngles(aR, 0, e.state === 'block' ? -25 : 0);
    r.body.setLocalEulerAngles(lean, 0, Math.sin(t * 2.5) * 2 * clamp(sp, 0, 1)); r.body.setLocalPosition(0, crouch, 0);
    const hot = e.state === 'windup'; if (e.flash > 0) setGlow(r.eyeMat, 'flash', '#FFFFFF', 5); else if (hot) setGlow(r.eyeMat, 'hot', '#FF4A3A', 5); else setGlow(r.eyeMat, 'idle', e.kind === 'boss' ? '#D9B8FF' : '#7FE3FF', 3);
    if (e.kind === 'boss' && r.shield.enabled) r.shield.setLocalEulerAngles(0, t * 40, 0);
  }
}

/* =====================================================================
   Trésors : coffres, or, boutique, inventaire
   ===================================================================== */
const chests = [];
function buildChests() {
  for (const c of CHESTS) {
    const [x, z] = findLand(c.x, c.z, 2.2), y = groundAt(x, z), root = new pc.Entity('coffre');
    root.setPosition(x, y, z); root.setEulerAngles(0, R() * 360, 0); world.addChild(root);
    const wood = c.rare ? mat('chestGold', { diffuse: '#B8862F', gloss: 0.72, metal: 0.65 }) : mat('chestWood', { diffuse: '#7A4E26', gloss: 0.3 }), band = mat('chestBand', { diffuse: '#D9B45A', gloss: 0.85, metal: 0.9 });
    prim('box', wood, root, [0, 0.35, 0], [1.2, 0.7, 0.8]); prim('box', band, root, [0, 0.35, 0], [1.24, 0.12, 0.84]);
    prim('box', band, root, [-0.45, 0.35, 0], [0.1, 0.72, 0.84]); prim('box', band, root, [0.45, 0.35, 0], [0.1, 0.72, 0.84]);
    const lid = new pc.Entity('couvercle'); lid.setLocalPosition(0, 0.7, -0.4); root.addChild(lid);
    prim('box', wood, lid, [0, 0.12, 0.4], [1.2, 0.24, 0.8]); prim('box', band, lid, [0, 0.12, 0.81], [0.22, 0.2, 0.05]);
    let light = null;
    if (c.rare) { light = new pc.Entity('lueur'); light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.78, 0.4), intensity: 1.3, range: 6, castShadows: false }); light.setLocalPosition(0, 1.3, 0); root.addChild(light); }
    addCollider(x, z, 0.8, 'chest');
    const ch = { ...c, x, z, root, lid, light, open: false, lidT: 0 }; chests.push(ch);
    interactables.push({ id: 'chest:' + c.id, x, z, r: 2.4, label: () => c.rare ? 'Ouvrir le coffre ancien' : 'Ouvrir le coffre', act: () => openChest(ch), enabled: () => !ch.open });
  }
}
function openChest(ch) {
  if (ch.open) return;
  const guards = enemies.filter((e) => e.alive && e.zone === 'guard' && dist2(e.x, e.z, ch.x, ch.z) < 12);
  if (guards.length) { toast('Des gardiens protègent ce coffre : élimine-les d’abord.'); play('wrong'); return; }
  ch.open = true; if (!save.chests.includes(ch.id)) save.chests.push(ch.id); play('chest'); shake(0.15);
  burst(ch.x, groundAt(ch.x, ch.z) + 1, ch.z, 30, 'gold', 5, 0.16, 1.2, 4); if (ch.light) ch.light.enabled = false;
  const L = ch.loot, lines = [];
  if (L.gold) { save.gold += L.gold; lines.push(`🪙 ${L.gold} pièces d’or`); }
  if (L.arrows) { save.arrows += L.arrows; lines.push(`🏹 ${L.arrows} flèches`); }
  if (L.hp) { save.potions.hp += L.hp; lines.push('🧪 Potion de vie'); }
  if (L.mp) { save.potions.mp += L.mp; lines.push('💧 Potion de mana'); }
  if (L.item) { save.items[L.item] = true; const it = ITEMS[L.item]; lines.unshift(`<b>${it.icon} ${it.name}</b><small>${it.desc}</small>`); if (L.item === 'amulet') player.mp = stats().maxMp; hud.weapons = null; }
  showLoot(ch.rare ? 'Trésor ancien !' : 'Trésor !', lines); writeSave();
}
let lootTimer = null;
function showLoot(title, lines) { const el = $('loot'); el.innerHTML = `<h3>${title}</h3>${lines.map((l) => `<p>${l}</p>`).join('')}`; el.hidden = false; clearTimeout(lootTimer); lootTimer = setTimeout(() => { el.hidden = true; }, 4200); }
function shopLines() {
  const offers = SHOP.filter((o) => (!o.need || o.need()) && !(o.once && save.upgrades[o.id]));
  return [{ who: 'Ilyas', text: `Que puis-je faire pour toi ? Tu as ${save.gold} pièces d’or.`, choices: [
    ...offers.map((o) => ({ label: `${o.label} — ${o.price} or${o.desc ? ` (${o.desc})` : ''}`, act: () => {
      if (save.gold < o.price) return [{ who: 'Ilyas', text: 'Il te manque quelques pièces… Les coffres de l’île en regorgent, paraît-il.' }];
      save.gold -= o.price; o.buy(); play('buy'); writeSave(); hud.purse = null;
      return [{ who: 'Ilyas', text: `Voilà pour toi : ${o.label.toLowerCase()}. Il te reste ${save.gold} pièces.` }];
    } })),
    { label: 'Rien, merci.', next: [] },
  ] }];
}
function renderInventory() {
  const st = stats(), own = Object.keys(ITEMS).filter((k) => save.items[k]);
  $('invBody').innerHTML = `<div class="inv-stats"><span>❤ ${Math.ceil(player.hp)} / ${player.maxHp}</span><span>✦ ${Math.round(player.mp)} / ${st.maxMp} mana</span><span>🪙 ${save.gold} or</span><span>🏹 ${save.arrows} flèches</span><span>🧪 ${save.potions.hp} vie · 💧 ${save.potions.mp} mana</span><span>⚔ dégâts ×${st.dmg.toFixed(2)}</span><span>🛡 dégâts subis ×${st.def.toFixed(2)}</span></div>
    <h3>Armes</h3><div class="inv-grid">${WEAPONS.map((w) => `<div class="inv-item ${save.items[w.id] ? '' : 'locked'}"><b>${w.icon} ${w.name}</b><small>${save.items[w.id] ? w.desc : 'Pas encore trouvé.'}</small><kbd>${w.key}</kbd></div>`).join('')}</div>
    <h3>Objets</h3><div class="inv-grid">${own.filter((k) => !WEAPONS.some((w) => w.id === k)).map((k) => `<div class="inv-item"><b>${ITEMS[k].icon} ${ITEMS[k].name}</b><small>${ITEMS[k].desc}</small></div>`).join('') || '<p class="hint">Aucun objet pour l’instant : explore l’île à la recherche de coffres.</p>'}</div>
    <p class="hint">Coffres ouverts : ${save.chests.length} / ${CHESTS.length} · Pierres de cœur : ${save.hearts.length} / 4${save.upgrades.blade ? ' · Épée affûtée' : ''}${save.upgrades.armor ? ' · Armure renforcée' : ''}</p>`;
}
const ebarPool = [];
function updateEnemyBars() {
  const host = $('ebars'); let n = 0;
  for (const e of enemies) {
    if (!e.alive || e.state === 'dormant' || e.kind === 'boss' || (e.hp >= e.maxHp && e.state === 'idle')) continue;
    if (dist2(e.x, e.z, player.x, player.z) > 26) continue;
    const v = camera.camera.worldToScreen(new pc.Vec3(e.x, e.y + e.d.h + 0.6, e.z)); if (v.z < 0) continue;
    let el = ebarPool[n]; if (!el) { el = document.createElement('div'); el.className = 'ebar'; el.innerHTML = '<i></i><span></span>'; host.append(el); ebarPool.push(el); }
    el.hidden = false; el.style.transform = `translate(${Math.round(v.x - 28)}px, ${Math.round(v.y)}px)`; el.firstChild.style.width = `${Math.max(0, e.hp / e.maxHp * 100)}%`;
    el.lastChild.textContent = e.frozen > 0 ? '❄' : e.stun > 0 ? '✶' : e.burn > 0 ? '🔥' : e.state === 'block' ? '🛡' : '';
    n++;
  }
  for (let i = n; i < ebarPool.length; i++) ebarPool[i].hidden = true;
}

const enemies = [];
function clearEnemies() { for (const e of enemies) e.rig.root.destroy(); enemies.length = 0; }

/* ---------- PNJ : Ilyas ---------- */
let ilyas;
function buildNPC() {
  const c = PLACES.camp, x = c.x - 2, z = c.z - 4, y = heightAt(x, z);
  const root = new pc.Entity('Ilyas'); root.setPosition(x, y, z); root.setEulerAngles(0, 170, 0); world.addChild(root);
  const robe = mat('robe', { diffuse: '#4A5C9E', gloss: 0.25 }), beard = mat('beard', { diffuse: '#ECE6DA' });
  prim('cone', robe, root, [0, 0.85, 0], [1.1, 1.7, 1.1]); prim('box', robe, root, [0, 1.55, 0], [0.6, 0.4, 0.42]);
  const head = prim('sphere', mat('skin'), root, [0, 2.0, 0], [0.42, 0.46, 0.42]); prim('cone', beard, head, [0, -0.32, 0.18], [0.5, 0.6, 0.35], [180, 0, 0]);
  prim('cone', mat('hat', { diffuse: '#2E3A6E' }), root, [0, 2.45, 0], [0.8, 0.8, 0.8]);
  const staff = prim('cylinder', mat('belt'), root, [0.55, 1.1, 0.2], [0.07, 2.2, 0.07]); prim('sphere', mat('orb', { unlit: true, emissive: '#FFD27A', ei: 4 }), staff, [0, 0.55, 0], [3.2, 0.12, 3.2]);
  const light = new pc.Entity('feu'); light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.6, 0.25), intensity: 2.2, range: 14, castShadows: false });
  light.setPosition(c.x, heightAt(c.x, c.z) + 1, c.z); world.addChild(light);
  const fire = new pc.Entity('flammes'); fire.setPosition(c.x, heightAt(c.x, c.z), c.z); world.addChild(fire);
  const fm = mat('fire', { unlit: true, emissive: '#FF9A3D', ei: 4, opacity: 0.9 }), fm2 = mat('fire2', { unlit: true, emissive: '#FFE07A', ei: 5, opacity: 0.85 });
  W.fire = { light, flames: [prim('cone', fm, fire, [0, 0.5, 0], [0.9, 1.2, 0.9], [0, 0, 0], false), prim('cone', fm2, fire, [0.1, 0.4, 0.05], [0.5, 0.8, 0.5], [0, 30, 0], false)] };
  ilyas = { root, x, z };
  addCollider(x, z, 0.8, 'npc');
}

/* ---------- Objets interactifs ---------- */
const interactables = [], pickups = [];
let altar, totems = {};
function glowMat(key, color, on) { return mat(`${key}:${on}`, { diffuse: on ? color : '#5A5650', emissive: on ? color : '#000000', ei: on ? 3 : 0, gloss: 0.4 }); }
function buildInteractables() {
  // Ilyas
  interactables.push({ id: 'ilyas', x: ilyas.x, z: ilyas.z, r: 3.2, label: () => 'Parler à Ilyas', act: talkIlyas });
  // Totems (points de sauvegarde)
  for (const [k, c] of Object.entries(CHECKPOINTS)) {
    if (k === 'camp') { totems[k] = { lit: true }; continue; }
    const y = groundAt(c.x, c.z), root = new pc.Entity('totem'); root.setPosition(c.x, y, c.z); world.addChild(root);
    prim('cylinder', mat('stone2', { diffuse: '#A79E8A', gloss: 0.2 }), root, [0, 0.9, 0], [0.7, 1.8, 0.7]);
    const bowl = prim('cylinder', mat('belt'), root, [0, 1.9, 0], [1.1, 0.3, 1.1]);
    const flame = prim('cone', mat('fire'), root, [0, 2.5, 0], [0.7, 1, 0.7], [0, 0, 0], false); flame.enabled = false;
    const light = new pc.Entity('lueur'); light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.62, 0.3), intensity: 1.6, range: 10, castShadows: false }); light.setLocalPosition(0, 2.6, 0); root.addChild(light); light.enabled = false;
    totems[k] = { root, flame, light, lit: false, bowl };
    addCollider(c.x, c.z, 0.9, 'totem');
    interactables.push({ id: 'cp:' + k, x: c.x, z: c.z, r: 3, label: () => totems[k].lit ? `Se reposer au ${c.name}` : `Allumer le ${c.name}`, act: () => activateCheckpoint(k) });
  }
  // Autel
  const sockets = [-1, 0, 1].map((i, n) => { const key = Object.keys(ZONES)[n], e = prim('cylinder', glowMat('socket', ZONES[key].color, false), world, [i * 1.4, 9.5 + 3.62, 0], [0.5, 0.25, 0.5]); return e; });
  const beam = prim('cylinder', mat('beam', { unlit: true, emissive: '#FFE6A8', ei: 6, opacity: 0.55 }), world, [0, 60, 0], [3, 100, 3], [0, 0, 0], false); beam.enabled = false;
  altar = { sockets, beam };
  interactables.push({ id: 'altar', x: 0, z: 0, r: 4.2, label: () => save.finished ? 'L’autel rayonne' : Object.keys(save.shards).length === 3 ? 'Déposer les trois éclats' : `Autel de l’Aube (${Object.keys(save.shards).length}/3 éclats)`, act: useAltar });
  // Zones : stèles, runes, éclats, barrières
  for (const Z of Object.values(ZONES)) {
    const o = zoneObjs[Z.key];
    interactables.push({ id: 'stele:' + Z.key, x: o.stele.x, z: o.stele.z, r: 3, label: () => 'Lire la stèle', act: () => readStele(Z) });
    o.glyphs.forEach((g, i) => {
      const a = i / 3 * Math.PI * 2 + 0.6, x = Z.x + Math.cos(a) * 11, z = Z.z + Math.sin(a) * 11 + 2, y = groundAt(x, z);
      const root = new pc.Entity('rune'); root.setPosition(x, y, z); world.addChild(root);
      prim('box', mat('runeStone', { diffuse: '#7D7A86', gloss: 0.3 }), root, [0, 0.9, 0], [1, 1.8, 0.7], [0, R() * 40, 0]);
      const top = prim('box', glowMat('rune', Z.color, false), root, [0, 1.95, 0], [0.8, 0.22, 0.55]);
      const rune = { glyph: g, root, top, on: false, x, z }; o.runes.push(rune); addCollider(x, z, 0.8, 'rune');
      interactables.push({ id: `rune:${Z.key}:${i}`, x, z, r: 2.6, zone: Z.key, label: () => `Activer la rune ${g}`, act: () => pressRune(Z, rune), enabled: () => !save.runes[Z.key] && Z.key !== 'ridge' });
    });
    if (Z.key === 'ridge') o.runes.forEach((r) => { r.root.enabled = false; });
    const p = o.pedestal, py = groundAt(p.x, p.z) + 1.2;
    const shard = new pc.Entity('éclat'); shard.setPosition(p.x, py + 1.4, p.z); world.addChild(shard);
    const sm = mat('shard:' + Z.key, { diffuse: Z.color, emissive: Z.color, ei: 3.5, gloss: 0.95 });
    prim('cone', sm, shard, [0, 0.5, 0], [0.9, 1, 0.9], [0, 0, 0], false); prim('cone', sm, shard, [0, -0.5, 0], [0.9, 1, 0.9], [180, 0, 0], false);
    const sl = new pc.Entity('lueur'); sl.addComponent('light', { type: 'omni', color: col(Z.color), intensity: 2.5, range: 12, castShadows: false }); shard.addChild(sl);
    const barrier = prim('cylinder', mat('barrier:' + Z.key, { unlit: true, emissive: Z.color, ei: 1.6, opacity: 0.28, cull: pc.CULLFACE_NONE }), world, [p.x, py + 1.8, p.z], [5, 4.4, 5], [0, 0, 0], false);
    const bc = addCollider(p.x, p.z, 2.6, 'barrier');
    o.shard = shard; o.barrier = barrier; o.barrierCol = bc;
    interactables.push({ id: 'shard:' + Z.key, x: p.x, z: p.z, r: 3.4, label: () => `Prendre l’${Z.shardName}`, act: () => takeShard(Z), enabled: () => !save.shards[Z.key] && zoneOpen(Z.key) });
  }
  buildChests();
  // Pierres de cœur (exploration)
  [['h1', -176, -40], ['h2', 172, 36], ['h3', -66, -168], ['h4', 70, 120]].forEach(([id, x, z]) => {
    const [px, pz] = findLand(x, z, 2.6), y = groundAt(px, pz);
    const e = new pc.Entity('cœur'); e.setPosition(px, y + 1.2, pz); world.addChild(e);
    prim('sphere', mat('heart', { diffuse: '#FF5A6E', emissive: '#FF2E4D', ei: 2.5, gloss: 0.9 }), e, [0, 0, 0], [0.7, 0.8, 0.7], [0, 0, 0], false);
    prim('cylinder', mat('stone2'), world, [px, y + 0.3, pz], [1, 0.6, 1]);
    pickups.push({ kind: 'heart', id, x: px, z: pz, e, taken: false });
  });
  // Fleurs d'aube (soins)
  for (let n = 0; n < 34; n++) {
    let x = (R() - 0.5) * 380, z = (R() - 0.5) * 380; const h = heightAt(x, z);
    if (h < 2.2 || h > 26) { n--; continue; }
    const e = new pc.Entity('fleur'); e.setPosition(x, h, z); world.addChild(e);
    prim('cylinder', mat('stem', { diffuse: '#4E8F3A' }), e, [0, 0.3, 0], [0.06, 0.6, 0.06], [0, 0, 0], false);
    prim('sphere', mat('flower', { diffuse: '#FFD36B', emissive: '#FFB547', ei: 1.4 }), e, [0, 0.68, 0], [0.42, 0.22, 0.42], [0, 0, 0], false);
    pickups.push({ kind: 'flower', x, z, e, taken: false, respawn: 0 });
  }
}
const zoneOpen = (k) => k === 'ridge' ? !!save.cleared.ridge : !!(save.runes[k] && save.cleared[k]);

/* ---------- Particules (pool) ---------- */
const parts = [];
function buildParticles() {
  const colors = { gold: '#FFD27A', green: '#9BE36B', blue: '#6FC6FF', violet: '#C59BFF', red: '#FF6A5A', white: '#FFFFFF', slime: '#7FE8C8', stone: '#B5AC98', fire: '#FF9A3D' };
  for (let i = 0; i < 160; i++) {
    const e = new pc.Entity('p'); e.addComponent('render', { type: 'box', material: mat('pk:gold', { unlit: true, emissive: colors.gold, ei: 3 }), castShadows: false }); e.enabled = false; world.addChild(e);
    parts.push({ e, life: 0, vx: 0, vy: 0, vz: 0, s: 0.2, g: 9 });
  }
  parts.colors = colors;
}
function burst(x, y, z, n, color, speed = 5, size = 0.18, life = 0.8, g = 9) {
  const m = mat('pk:' + color, { unlit: true, emissive: parts.colors[color] || color, ei: 3 });
  for (let i = 0, k = 0; i < parts.length && k < n; i++) {
    const p = parts[i]; if (p.life > 0) continue;
    const a = R() * Math.PI * 2, u = R() * 2 - 1, s = speed * (0.4 + R() * 0.8);
    p.life = p.max = life * (0.6 + R() * 0.6); p.vx = Math.cos(a) * Math.sqrt(1 - u * u) * s; p.vy = Math.abs(u) * s + 1; p.vz = Math.sin(a) * Math.sqrt(1 - u * u) * s; p.s = size; p.g = g;
    p.e.render.material = m; p.e.setPosition(x, y, z); p.e.enabled = true; k++;
  }
}
function updateParticles(dt) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt; if (p.life <= 0) { p.e.enabled = false; continue; }
    p.vy -= p.g * dt; const pos = p.e.getPosition(); p.e.setPosition(pos.x + p.vx * dt, pos.y + p.vy * dt, pos.z + p.vz * dt);
    const s = p.s * (p.life / p.max); p.e.setLocalScale(s, s, s); p.e.rotateLocal(200 * dt, 140 * dt, 0);
  }
}

/* =====================================================================
   Entrées : clavier, souris, manette, tactile
   ===================================================================== */
const keys = new Set(), pressed = new Set();
const input = { mx: 0, my: 0, lookX: 0, lookY: 0, zoom: 7, touchMove: [0, 0], gp: null, gpPrev: {} };
addEventListener('keydown', (e) => {
  if (e.repeat) { if (['Space'].includes(e.code)) e.preventDefault(); return; }
  keys.add(e.code); pressed.add(e.code); Audio.init();
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' || e.code === 'KeyP') onPauseKey();
  if (e.code === 'KeyM' && ['playing', 'map'].includes(state.mode)) toggleMap();
  if ((e.code === 'KeyI' || e.code === 'Tab') && ['playing', 'inventory'].includes(state.mode)) toggleInventory();
  if (e.code === 'KeyJ') held.attack = true;
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyJ') { held.attack = false; pressed.add('AttackUp'); } });
addEventListener('mouseup', (e) => { if (e.button === 0 && held.attack) { held.attack = false; pressed.add('AttackUp'); } });
addEventListener('blur', () => keys.clear());
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('mousedown', (e) => {
  Audio.init();
  if (state.mode !== 'playing') return;
  if (!locked() && !isTouch && canvas.requestPointerLock) { const r = canvas.requestPointerLock(); r?.catch?.(() => {}); return; }   // 1er clic : capture seulement
  if (e.button === 0) { pressed.add('Attack'); held.attack = true; } if (e.button === 2) pressed.add('Dodge');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => { if (locked() || (e.buttons & 4)) { input.lookX += e.movementX; input.lookY += e.movementY; } });
canvas.addEventListener('wheel', (e) => { input.zoom = clamp(input.zoom + Math.sign(e.deltaY) * 0.8, 3.5, 12); e.preventDefault(); }, { passive: false });
document.addEventListener('pointerlockchange', () => { if (!locked() && state.mode === 'playing' && !isTouch && !state.ignoreUnlock) setPaused(true); state.ignoreUnlock = false; });
// tactile
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('has-touch');
(function touchControls() {
  const stick = $('stick'), knob = $('stickKnob'); let sid = null, lid = null, lx = 0, ly = 0;
  stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; Audio.init(); e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === sid) { const r = stick.getBoundingClientRect(), dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2), d = Math.min(1, Math.hypot(dx, dy) / 55), a = Math.atan2(dy, dx);
        input.touchMove = [Math.cos(a) * d, Math.sin(a) * d]; knob.style.transform = `translate(${Math.cos(a) * d * 44}px, ${Math.sin(a) * d * 44}px)`; }
      if (t.identifier === lid) { input.lookX += (t.clientX - lx) * 1.6; input.lookY += (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: true });
  addEventListener('touchend', (e) => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; input.touchMove = [0, 0]; knob.style.transform = ''; } if (t.identifier === lid) lid = null; } });
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; if (t.clientX > innerWidth * 0.4) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } Audio.init(); }, { passive: true });
  document.querySelectorAll('[data-touch]').forEach((b) => b.addEventListener('touchstart', (e) => { e.preventDefault(); Audio.init(); const k = { attack: 'Attack', jump: 'Space', dodge: 'Dodge', interact: 'KeyE', power: 'KeyF', weapon: 'NextWeapon', potion: 'KeyR' }[b.dataset.touch]; pressed.add(k); if (k === 'Attack') held.attack = true; }, { passive: false }));
  document.querySelectorAll('[data-touch="attack"]').forEach((b) => b.addEventListener('touchend', () => { held.attack = false; pressed.add('AttackUp'); }));
})();
function pollGamepad() {
  const gp = [...(navigator.getGamepads?.() || [])].find(Boolean); input.gp = gp || null; if (!gp) return;
  const b = (i) => gp.buttons[i]?.pressed, edge = (i, code) => { if (b(i) && !input.gpPrev[i]) pressed.add(code); input.gpPrev[i] = b(i); };
  const wasAtk = !!input.gpPrev[2];
  edge(0, 'Space'); edge(2, 'Attack'); edge(1, 'Dodge'); edge(3, 'KeyE'); edge(5, 'KeyE'); edge(9, 'Escape'); edge(8, 'KeyM');
  edge(7, 'KeyF'); edge(14, 'PrevWeapon'); edge(15, 'NextWeapon'); edge(12, 'KeyR'); edge(13, 'KeyT');
  if (b(2)) held.attack = true; else if (wasAtk) { held.attack = false; pressed.add('AttackUp'); }
  if (pressed.has('Escape')) { pressed.delete('Escape'); onPauseKey(); }
  if (pressed.has('KeyM') && ['playing', 'map'].includes(state.mode)) { pressed.delete('KeyM'); toggleMap(); }
  const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
  input.lookX += dz(gp.axes[2] || 0) * 14; input.lookY += dz(gp.axes[3] || 0) * 10;
}
function moveAxis() {
  let x = 0, z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (input.gp) { const ax = input.gp.axes[0] || 0, az = input.gp.axes[1] || 0; if (Math.hypot(ax, az) > 0.15) { x += ax; z += az; } }
  x += input.touchMove[0]; z += input.touchMove[1];
  const l = Math.hypot(x, z); return l > 1 ? [x / l, z / l] : [x, z];
}
const running = () => keys.has('ShiftLeft') || keys.has('ShiftRight') || !!input.gp?.buttons[4]?.pressed;
const take = (code) => { const h = pressed.has(code); pressed.delete(code); return h; };

/* =====================================================================
   Boucle de jeu
   ===================================================================== */
const cam = { yaw: Math.PI, pitch: 0.28, x: 0, y: 20, z: 40, shake: 0, orbit: 0 };
let hitStop = 0, fpsAcc = 0, fpsN = 0, lastZone = null, interactTarget = null, hudT = 0;
function update(dtRaw) {
  const dt = Math.min(dtRaw, 1 / 20);
  state.time += dt;
  pollGamepad();
  if (!window.aube?.skip?.world) animateWorld(dt);
  if (state.mode === 'title') { attractCamera(dt); }
  else if (state.mode === 'playing' || state.mode === 'dialogue' || state.mode === 'cinematic') {
    let gdt = dt;
    if (hitStop > 0) { hitStop -= dt; gdt = dt * 0.08; }
    const skip = window.aube?.skip || {};
    if (state.mode === 'playing') { state.play += dt; save.play = state.play; if (!skip.player) updatePlayer(gdt); if (!skip.enemies) { updateEnemies(gdt); updateProjectiles(gdt); updateFx(gdt); updateCompanion(gdt); } if (!skip.pickups) updatePickups(gdt); if (!skip.interact) updateInteract(); if (!skip.zones) checkZones(); }
    else if (state.mode === 'dialogue') { updateEnemies(0); animatePlayer(dt, 0); updateDialogue(dt); }
    else updateCinematic(dt);
    if (!skip.camera) updateCamera(dt);
  } else if (state.mode === 'dead') updateCamera(dt);
  if (!window.aube?.skip?.particles) updateParticles(dt);
  if (state.mode !== 'title' && state.mode !== 'loading' && !window.aube?.skip?.hud) { hudT -= dt; if (hudT <= 0) { hudT = 0.2; if (!window.aube?.noMinimap) drawMinimap(); } if (state.mode === 'playing') updateEnemyBars(); updateHud(); }
  input.lookX = 0; input.lookY = 0; pressed.clear();
  if (settings.showFps) { fpsAcc += dtRaw; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} i/s · ${device.isWebGPU ? 'WebGPU' : 'WebGL 2'}`; fpsAcc = 0; fpsN = 0; } }
}
function animateWorld(dt) {
  const t = state.time;
  if (W.water) W.water.setLocalPosition((t * 0.35) % 10, SEA + Math.sin(t * 0.6) * 0.08, (t * 0.22) % 10);   // les vagues défilent
  if (W.clouds) W.clouds.setLocalEulerAngles(0, t * 0.25, 0);
  if (camera) { const cp = camera.getPosition(); W.sky.setPosition(cp.x, 0, cp.z); const sd = sun.forward; W.sunDisc.setPosition(cp.x - sd.x * 800, -sd.y * 800 - 60, cp.z - sd.z * 800); }
  if (W.fire) { const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06; W.fire.flames.forEach((e, i) => e.setLocalScale(0.9 * f / (i + 1) ** 0.5, 1.2 * (2 - f) / (i + 1) ** 0.4, 0.9 * f / (i + 1) ** 0.5)); W.fire.light.light.intensity = 2 + Math.sin(t * 17) * 0.3; if (R() < dt * 6) burst(PLACES.camp.x, heightAt(PLACES.camp.x, PLACES.camp.z) + 1, PLACES.camp.z, 1, 'fire', 1.5, 0.08, 1.2, -1); }
  for (const k in totems) { const tt = totems[k]; if (tt.lit && tt.flame) { const f = 1 + Math.sin(t * 11 + k.length) * 0.1; tt.flame.setLocalScale(0.7 * f, 1 * (2 - f), 0.7 * f); } }
  for (const Z of Object.values(ZONES)) { const o = zoneObjs[Z.key]; if (o.shard?.enabled) { o.shard.setLocalEulerAngles(0, t * 60, 0); const p = o.pedestal; o.shard.setPosition(p.x, groundAt(p.x, p.z) + 2.6 + Math.sin(t * 2) * 0.2, p.z); } if (o.barrier?.enabled) o.barrier.setLocalEulerAngles(0, t * 20, 0); }
  for (const p of pickups) if (!p.taken) { p.e.setLocalEulerAngles(0, t * (p.kind === 'heart' ? 90 : 30), 0); }
  for (const c of chests) if (c.open && c.lidT < 1) { c.lidT = Math.min(1, c.lidT + dt * 2); c.lid.setLocalEulerAngles(-110 * (1 - (1 - c.lidT) ** 3), 0, 0); }
  if (altar?.beam.enabled) { const s = altar.beamGrow ?? 1; altar.beam.setLocalScale(3 + Math.sin(t * 3) * 0.3, 100 * s, 3 + Math.sin(t * 3) * 0.3); altar.beam.setLocalPosition(0, 13 + 50 * s, 0); }
}
function attractCamera(dt) {
  cam.orbit += dt * 0.05;
  const r = 120, x = Math.cos(cam.orbit) * r, z = Math.sin(cam.orbit) * r + 20, y = Math.max(heightAt(x, z), 0) + 34;
  camera.setPosition(x, y, z); camera.lookAt(0, 10, 0);
}

/* ---------- Joueuse ---------- */
function updatePlayer(dt) {
  const p = player;
  if (p.dead) return;
  const sens = 0.0026 * settings.sensitivity;
  cam.yaw -= input.lookX * sens; cam.pitch = clamp(cam.pitch + input.lookY * sens * (settings.invertY ? -1 : 1), -0.35, 1.15);
  const st = stats();
  for (const k in p.powerCd) p.powerCd[k] = Math.max(0, p.powerCd[k] - dt);
  p.primCd = Math.max(0, p.primCd - dt); p.cast = Math.max(0, p.cast - dt); p.spin = Math.max(0, p.spin - dt); p.slow = Math.max(0, p.slow - dt); p.rooted = Math.max(0, p.rooted - dt);
  p.mp = Math.min(st.maxMp, p.mp + 4 * dt);
  if (p.hot > 0) { const h = Math.min(p.hot, dt * 11); p.hot -= h; p.hp = Math.min(p.maxHp, p.hp + h); if (R() < dt * 8) burst(p.x, p.y + 1, p.z, 1, 'gold', 1.5, 0.1, 0.8, -2); }
  for (const [code, id] of [['Digit1', 'sword'], ['Digit2', 'bow'], ['Digit3', 'staff'], ['Digit4', 'flute']]) if (take(code)) selectWeapon(id);
  if (take('NextWeapon')) cycleWeapon(1); if (take('PrevWeapon')) cycleWeapon(-1);
  if (take('KeyR')) usePotion('hp'); if (take('KeyT')) usePotion('mp');
  const [ax, az] = moveAxis(), moving = Math.hypot(ax, az) > 0.05 && p.rooted <= 0;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  let wx = rx * ax - fx * az, wz = rz * ax - fz * az;
  const busy = p.attack > 0 || p.cast > 0 || p.charging || p.spin > 0;
  const run = running() && moving && p.st > 1 && !busy;
  let speed = p.dodge > 0 ? 0 : (busy ? (p.charging ? 2.6 : 1.6) : run ? 9.2 : 5.4);
  speed *= st.speed * (p.slow > 0 ? 0.55 : 1); if (p.rooted > 0) speed = 0;
  if (run) p.st = Math.max(0, p.st - 22 * dt); else if (p.dodge <= 0 && !busy) p.st = Math.min(100, p.st + (moving ? 16 : 26) * dt);
  // armes
  p.comboWindow -= dt;
  weaponActions(dt, moving, wx, wz);
  if (p.attack > 0) { p.attack -= dt; const total = p.combo === 3 ? 0.5 : 0.36; if (!p.attackHit && p.attack < total * 0.55) { p.attackHit = true; strike(); } }
  // esquive
  if ((take('Dodge') || take('KeyK') || take('ControlLeft')) && p.dodge <= 0 && p.st >= 20 && p.grounded && p.rooted <= 0) {
    p.dodge = 0.45; p.invuln = 0.4; p.st -= 20; play('dodge'); p.attack = 0; p.charging = false;
    const dx = moving ? wx : Math.sin(p.yaw), dz2 = moving ? wz : Math.cos(p.yaw), l = Math.hypot(dx, dz2) || 1; p.dvx = dx / l * 13; p.dvz = dz2 / l * 13; p.yaw = Math.atan2(p.dvx, p.dvz);
  }
  let tvx = wx * speed, tvz = wz * speed;
  if (p.dodge > 0) { p.dodge -= dt; tvx = p.dvx * (p.dodge / 0.45 + 0.2); tvz = p.dvz * (p.dodge / 0.45 + 0.2); }
  const acc = p.grounded ? 14 : 4; p.vx = lerp(p.vx, tvx, clamp(acc * dt, 0, 1)); p.vz = lerp(p.vz, tvz, clamp(acc * dt, 0, 1));
  if (moving && !busy && p.dodge <= 0) p.yaw = angleLerp(p.yaw, Math.atan2(wx, wz), clamp(12 * dt, 0, 1));
  if (p.charging) { const { dir } = aimDir(); p.yaw = angleLerp(p.yaw, Math.atan2(dir.x, dir.z), clamp(14 * dt, 0, 1)); }
  // saut et gravité
  if (take('Space') && p.grounded && p.dodge <= 0 && p.rooted <= 0) { p.vy = 8.6; p.grounded = false; play('jump'); }
  p.vy -= 24 * dt;
  let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
  // collisions (cercles) + bords de l'île
  for (const c of nearColliders(nx, nz)) { if (!c.on) continue; const dx = nx - c.x, dz2 = nz - c.z, d = Math.hypot(dx, dz2), m = c.r + 0.45; if (d < m && d > 0.0001) { nx = c.x + dx / d * m; nz = c.z + dz2 / d * m; } }
  for (const e of enemies) { if (!e.alive || e.state === 'dormant') continue; const dx = nx - e.x, dz2 = nz - e.z, d = Math.hypot(dx, dz2), m = e.d.radius + 0.4; if (d < m && d > 0.0001) { nx = e.x + dx / d * m; nz = e.z + dz2 / d * m; } }
  if (terrainH(nx, nz) < -1.1) { nx = p.x; nz = p.z; if (!p.waterWarn) { toast('L’océan est trop profond : reviens vers la terre ferme.'); p.waterWarn = true; } }
  p.x = nx; p.z = nz;
  const g = groundAt(p.x, p.z); p.y += p.vy * dt;
  if (p.y <= g) { if (!p.grounded && p.vy < -10) play('land'); p.y = g; p.vy = 0; p.grounded = true; } else if (p.y - g > 0.35) p.grounded = false; else if (p.grounded) p.y = g;
  // pas
  const sp = Math.hypot(p.vx, p.vz);
  if (p.grounded && sp > 1) { p.stepT -= dt * sp * 0.36; if (p.stepT <= 0) { p.stepT = 1; play('step', terrainH(p.x, p.z) < 1.8); } }
  p.invuln -= dt; p.hurtFlash -= dt;
  if (p.y < SEA - 0.4 && terrainH(p.x, p.z) < 0) { /* pataugeoire : ralentie */ p.vx *= 0.96; p.vz *= 0.96; }
  animatePlayer(dt, sp);
}
function animatePlayer(dt, sp) {
  const p = player; if (!P) return;
  P.root.setPosition(p.x, p.y, p.z); P.root.setEulerAngles(0, p.yaw * 180 / Math.PI, 0);
  p.walk += dt * (sp > 0.3 ? sp * 1.25 : 0); const sw = Math.sin(p.walk) * clamp(sp / 6, 0, 1.1);
  P.legL.setLocalEulerAngles(sw * 45, 0, 0); P.legR.setLocalEulerAngles(-sw * 45, 0, 0);
  let aR = -sw * 35, aRz = 0, aL = sw * 40, bodyX = sp * 1.2, bodyY = 0;
  if (p.attack > 0) {
    const total = p.combo === 3 ? 0.5 : 0.36, t = 1 - p.attack / total, e = t < 0.35 ? -t / 0.35 : (t - 0.35) / 0.65;
    if (p.combo === 2) { aR = -80; aRz = lerp(70, -90, clamp(e, 0, 1)); bodyY = lerp(-25, 30, clamp(e, 0, 1)); }
    else if (p.combo === 3) { aR = lerp(-200, 10, clamp(e, 0, 1)); bodyX = lerp(-10, 25, clamp(e, 0, 1)); }
    else { aR = lerp(-160, 20, clamp(e, 0, 1)); aRz = -20; bodyY = lerp(20, -25, clamp(e, 0, 1)); }
    setOpacity(P.trail.render.material, t > 0.3 && t < 0.85 ? 0.45 : 0);
  } else setOpacity(P.trail.render.material, 0);
  if (p.charging) { aL = -88; aR = -80; bodyY = -12; }
  else if (p.cast > 0 && p.weapon === 'staff') { aR = -120; aRz = 10; }
  else if (p.cast > 0 && p.weapon === 'flute') { aR = -125; aRz = 35; aL = -110; }
  else if (p.cast > 0 && p.weapon === 'bow') { aL = -88; aR = -40; }
  if (p.spin > 0) { bodyY = (1 - p.spin / 0.45) * 360; aR = -90; aRz = 60; }
  if (p.dodge > 0) { bodyX = (1 - p.dodge / 0.45) * 360; }
  if (!p.grounded) { aL = -30; aR = p.attack > 0 ? aR : -150; P.legL.setLocalEulerAngles(-30, 0, 0); P.legR.setLocalEulerAngles(20, 0, 0); }
  P.armR.setLocalEulerAngles(aR, 0, aRz); P.armL.setLocalEulerAngles(aL, 0, 8);
  P.body.setLocalEulerAngles(bodyX, bodyY, 0); P.body.setLocalPosition(0, p.dodge > 0 ? 0.55 : Math.abs(Math.sin(p.walk * 2)) * 0.06 * clamp(sp / 6, 0, 1), 0);
  P.cape.setLocalEulerAngles(10 + clamp(sp * 4, 0, 40) + Math.sin(state.time * 3) * 4, 0, 0);
  P.head.setLocalEulerAngles(Math.sin(state.time * 1.7) * 2, 0, 0);
  if (P.model) {
    const m = P.model; let st = 'idle';
    if (p.dead) st = 'death'; else if (p.attack > 0 || p.spin > 0) st = 'attack'; else if (p.cast > 0 || p.charging) st = 'cast';
    else if (!p.grounded) st = 'jump'; else if (p.hurtFlash > 0.35) st = 'hurt'; else if (sp > 6.5) st = 'run'; else if (sp > 0.4) st = 'walk';
    const newSwing = p.attack > (P.lastAttack || 0) + 0.05; P.lastAttack = p.attack;
    playAnim(m, st, st === 'attack' ? 0.06 : 0.18, st === 'attack' && newSwing);
    m.holder.setLocalEulerAngles(p.dodge > 0 ? bodyX : 0, p.spin > 0 ? bodyY : 0, 0);
    if (m.hand) { P.mount.setPosition(m.hand.getPosition()); P.mount.setRotation(m.hand.getRotation()); }
  }
  const flash = p.hurtFlash > 0 && Math.floor(state.time * 20) % 2 === 0; P.root.enabled = !flash || p.dead;
  if (P.mount) P.mount.enabled = !!(P.model && P.model.hand) && P.root.enabled;   // l'arme clignote avec le personnage
}
function nearestEnemy(range) { let best = null, bd = range; for (const e of enemies) { if (!e.alive || e.state === 'dormant') continue; const d = dist2(e.x, e.z, player.x, player.z); if (d < bd) { bd = d; best = e; } } return best; }
function strike() {
  const p = player, dmgBase = (p.combo === 3 ? 22 : 12) * stats().dmg, reach = p.combo === 3 ? 3.4 : 2.9, arc = p.combo === 2 ? 2.4 : 1.4;
  let hit = false;
  for (const e of enemies) {
    if (!e.alive || e.state === 'dormant') continue;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) - e.d.radius * 0.6;
    const ang = Math.abs(((Math.atan2(dx, dz) - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d < reach && ang < arc) { const crit = R() < 0.12, dmg = Math.round(dmgBase * (crit ? 1.8 : 1) * (0.9 + R() * 0.2)); damageEnemy(e, dmg, dx / (Math.hypot(dx, dz) || 1), dz / (Math.hypot(dx, dz) || 1), crit, 'melee'); hit = true; }
  }
  if (hit) { hitStop = 0.06; shake(0.25); play('hit'); }
}
function shake(a) { if (settings.shake) cam.shake = Math.max(cam.shake, a); }
function hurtPlayer(dmg, fromX, fromZ, fx = {}) {
  const p = player; if (p.invuln > 0 || p.dead || state.mode !== 'playing') return;
  dmg = Math.max(1, Math.round(dmg * stats().def)); p.charging = false;
  if (fx.slow) { p.slow = fx.slow; toast('Acide : tu es ralentie.'); } if (fx.root) { p.rooted = fx.root; toast('Des racines t’immobilisent !'); }
  p.hp = Math.max(0, p.hp - dmg); p.invuln = 0.7; p.hurtFlash = 0.5; play('hurt'); shake(0.5);
  const dx = p.x - fromX, dz = p.z - fromZ, l = Math.hypot(dx, dz) || 1; p.vx += dx / l * 9; p.vz += dz / l * 9; p.vy = 4; p.grounded = false;
  $('dmgFlash').style.opacity = 1; setTimeout(() => { $('dmgFlash').style.opacity = 0; }, 160);
  floater(p.x, p.y + 2.4, p.z, `-${dmg}`, 'hurt');
  if (p.hp <= 0) die();
}

/* ---------- Ennemis ---------- */
function dropFlower(x, z) { const f = pickups.find((p) => p.kind === 'flower' && p.taken); if (!f) return; f.x = x + 0.6; f.z = z; f.e.setPosition(f.x, groundAt(f.x, f.z), f.z); f.e.enabled = true; f.taken = false; }

/* ---------- Ramassables ---------- */
function updatePickups(dt) {
  for (const p of pickups) {
    if (p.taken) { if (p.kind === 'flower' && p.respawn > 0) { p.respawn -= dt; if (p.respawn <= 0) { p.taken = false; p.e.enabled = true; } } continue; }
    if (dist2(p.x, p.z, player.x, player.z) < (p.kind === 'heart' ? 1.8 : 1.4)) {
      if (p.kind === 'flower') { if (player.hp >= player.maxHp) continue; player.hp = Math.min(player.maxHp, player.hp + 30); play('heal'); floater(player.x, player.y + 2.3, player.z, '+30', ''); burst(p.x, groundAt(p.x, p.z) + 0.7, p.z, 10, 'gold', 3, 0.12, 0.8); p.taken = true; p.respawn = 90; p.e.enabled = false; }
      else { save.hearts.push(p.id); player.maxHp = stats().maxHp; player.hp = player.maxHp; play('pickup'); burst(p.x, groundAt(p.x, p.z) + 1.2, p.z, 24, 'red', 5, 0.16, 1); p.taken = true; p.e.enabled = false; toast(`Pierre de cœur trouvée : vie maximale +25 (${save.hearts.length}/4)`); writeSave(); }
    }
  }
}

/* ---------- Interaction ---------- */
function updateInteract() {
  let best = null, bd = 1e9;
  for (const it of interactables) { if (it.enabled && !it.enabled()) continue; const d = dist2(it.x, it.z, player.x, player.z); if (d < it.r && d < bd) { bd = d; best = it; } }
  interactTarget = best;
  const pr = $('prompt');
  const html = best ? `<kbd>${input.gp ? 'Y' : 'E'}</kbd>${best.label()}` : '';
  if (hud.prompt !== html) { hud.prompt = html; pr.hidden = !best; if (best) pr.innerHTML = html; }
  if (best && take('KeyE')) best.act();
}
function talkIlyas() {
  const n = Object.keys(save.shards).length;
  if (!save.talked) {
    save.talked = 1; writeSave();
    return dialogue([
      { who: 'Ilyas', text: 'Ah… un visage nouveau. Je suis Ilyas, dernier gardien du feu d’Aube.' },
      { who: 'Ilyas', text: 'Depuis que les trois éclats ont été arrachés à l’autel du Temple, le soleil refuse de se lever. Les gardiens de l’île sont devenus fous.' },
      { who: 'Ilyas', text: 'Un éclat repose dans la Forêt murmurante, à l’ouest. Un autre dans les Ruines du lac, à l’est. Le dernier, sur la Crête de cristal au nord… gardé par le Colosse.' },
      { who: 'Ilyas', text: 'Que veux-tu savoir avant de partir ?', choices: [
        { label: 'Comment me battre ?', next: [{ who: 'Ilyas', text: 'Frappe trois fois d’affilée : le troisième coup est le plus puissant. Roule pour esquiver : tant que tu roules, rien ne t’atteint. Surveille ton endurance.' }, { who: 'Ilyas', text: 'Les gardiens de pierre lèvent les bras avant de frapper, et leurs yeux rougissent. C’est le moment de t’écarter.' }] },
        { label: 'Que sont les stèles ?', next: [{ who: 'Ilyas', text: 'Chaque sanctuaire est scellé par trois runes. La stèle indique l’ordre dans lequel les éveiller. Une erreur, et il faudra recommencer.' }] },
        { label: 'Je pars sur-le-champ.', next: [] },
      ] },
      { who: 'Ilyas', text: 'Rapporte les éclats sur l’autel, au centre de l’île. Allume les totems d’Aube en chemin : ils garderont ta trace si tu tombes.' },
      { who: 'Ilyas', text: 'Prends aussi cette flûte. Ses notes repoussent les créatures, et sa mélodie soigne les blessures. On dit qu’un arc et un bâton de braise dorment dans les coffres de l’île… Reviens me voir si tu trouves de l’or : je vends potions et flèches, et je peux renforcer ton équipement.' },
    ], () => { save.items.flute = true; hud.weapons = null; writeSave(); setQuestChanged(); showLoot('Nouvel instrument', [`<b>🎶 Flûte d’Aube</b><small>${ITEMS.flute.desc}</small>`]); toast('Nouvel objectif : retrouver les trois éclats d’Aube'); });
  }
  const menu = (text) => dialogue([{ who: 'Ilyas', text, choices: [
    { label: 'Commercer et forger', act: () => shopLines() },
    { label: 'Un conseil ?', next: [{ who: 'Ilyas', text: advice() }] },
    { label: 'À bientôt.', next: [] }] }]);
  if (save.finished) return menu('Regarde ce ciel… Tu as rendu l’Aube à cette île. Que puis-je encore faire pour toi ?');
  return menu(n === 3 ? 'Les trois éclats ! Je les sens vibrer d’ici. Va jusqu’à l’autel du Temple. Avant cela, as-tu besoin de quelque chose ?' : `${n} éclat${n > 1 ? 's' : ''} sur 3. Que puis-je faire pour toi ?`);
}
function advice() {
  const tips = ['Les Gardiens de pierre se protègent derrière leurs bras : frappe-les après une charge manquée, quand ils sont étourdis.',
    'Les Sylvains se téléportent quand on les approche. L’arc ou une boule de feu les atteignent de loin.',
    'Gèle tes ennemis avec la nova du bâton : un ennemi gelé subit des dégâts accrus.',
    'Les Brumelins se divisent en deux petits quand ils meurent. Et méfie-toi de leur acide : il ralentit.',
    'Le Colosse s’entoure d’un bouclier alimenté par trois cristaux. Détruis-les. Enragé, ses ondes de choc se sautent.',
    `Il reste ${CHESTS.length - save.chests.length} coffres sur l’île. Les plus précieux sont gardés.`];
  return tips[Math.floor(R() * tips.length)];
}
function _oldIlyas(n) {
  if (save.finished) return dialogue([{ who: 'Ilyas', text: 'Regarde ce ciel… Tu as rendu l’Aube à cette île. Je n’ai plus qu’à entretenir le feu, désormais.' }]);
  if (n === 3) return dialogue([{ who: 'Ilyas', text: 'Les trois éclats ! Je les sens vibrer d’ici. Va jusqu’à l’autel du Temple, au centre de l’île.' }]);
  const tips = [];
  if (!save.shards.forest) tips.push('Dans la Forêt murmurante, les Brumelins ont la peau tendre mais ils bondissent vite. Recule quand ils se tassent.');
  if (!save.shards.lake) tips.push('Aux Ruines du lac, deux gardiens de pierre veillent. Frappe-les dans le dos après leur coup.');
  if (!save.shards.ridge) tips.push('Le Colosse de cristal frappe le sol là où tu te tiens : quand les étincelles rouges jaillissent, roule hors de la zone. Un saut ne suffit pas toujours…');
  return dialogue([{ who: 'Ilyas', text: `${n} éclat${n > 1 ? 's' : ''} sur 3. ${tips[Math.floor(R() * tips.length)] || ''}` }]);
}
function readStele(Z) {
  const o = zoneObjs[Z.key];
  if (Z.key === 'ridge') return dialogue([{ who: 'Stèle', text: '« Ici veille le Colosse de cristal. Seule sa chute ouvrira le sanctuaire. »' }]);
  if (save.runes[Z.key]) return dialogue([{ who: 'Stèle', text: 'Les runes brillent d’une lumière paisible. Le sceau est rompu.' }]);
  dialogue([{ who: 'Stèle', text: `Trois symboles sont gravés, dans cet ordre : ${o.order.join('  →  ')}. Éveille les runes de la même façon.` }]);
  o.read = true;
}
function pressRune(Z, rune) {
  const o = zoneObjs[Z.key]; if (rune.on) return;
  o.seq = o.seq || [];
  const expected = o.order[o.seq.length];
  if (rune.glyph !== expected) {
    play('wrong'); toast(o.read ? 'Le sceau rejette cet ordre. Les runes s’éteignent.' : 'Rien ne se passe… La stèle doit indiquer un ordre.');
    o.seq = []; o.runes.forEach((r) => { r.on = false; r.top.render.material = glowMat('rune', Z.color, false); }); return;
  }
  rune.on = true; rune.top.render.material = glowMat('rune', Z.color, true); o.seq.push(rune.glyph); play('rune'); burst(rune.x, groundAt(rune.x, rune.z) + 2.2, rune.z, 14, Z.key === 'forest' ? 'green' : 'blue', 4, 0.14, 0.9);
  if (o.seq.length === 3) {
    save.runes[Z.key] = true; writeSave();
    if (save.cleared[Z.key]) { openZone(Z.key); toast('Les trois runes résonnent : la barrière s’ouvre !'); }
    else toast('Le sceau est rompu… mais des gardiens rôdent encore. Élimine-les pour ouvrir la barrière.');
  }
}
function openZone(k) { const o = zoneObjs[k]; if (!o.barrier.enabled) return; o.barrier.enabled = false; o.barrierCol.on = false; play('open'); burst(o.pedestal.x, groundAt(o.pedestal.x, o.pedestal.z) + 2, o.pedestal.z, 40, k === 'forest' ? 'green' : k === 'lake' ? 'blue' : 'violet', 7, 0.2, 1.2); setQuestChanged(); }
function takeShard(Z) {
  const o = zoneObjs[Z.key]; save.shards[Z.key] = true; o.shard.enabled = false; play('shard'); shake(0.3);
  burst(o.pedestal.x, groundAt(o.pedestal.x, o.pedestal.z) + 2.6, o.pedestal.z, 50, Z.key === 'forest' ? 'green' : Z.key === 'lake' ? 'blue' : 'violet', 8, 0.2, 1.4, 3);
  const n = Object.keys(save.shards).length;
  writeSave(); setQuestChanged(); renderShards();
  dialogue([{ who: Z.shardName, text: n === 3 ? 'Les trois éclats résonnent ensemble. Le Temple de l’Aube t’appelle, au centre de l’île.' : `Une chaleur douce t’envahit. ${n} éclat${n > 1 ? 's' : ''} sur 3.` }]);
}
function activateCheckpoint(k) {
  const t = totems[k];
  if (!t.lit) { t.lit = true; t.flame.enabled = true; t.light.enabled = true; if (!save.checkpoints.includes(k)) save.checkpoints.push(k); burst(CHECKPOINTS[k].x, groundAt(CHECKPOINTS[k].x, CHECKPOINTS[k].z) + 2.6, CHECKPOINTS[k].z, 20, 'fire', 4, 0.14, 1); }
  save.checkpoint = k; player.hp = player.maxHp; player.st = 100; play('checkpoint'); writeSave();
  toast(`${CHECKPOINTS[k].name} : vie restaurée, progression sauvegardée.`);
}
function useAltar() {
  if (save.finished) return dialogue([{ who: 'Autel', text: 'Les trois éclats brûlent d’une lumière dorée. L’île est en paix.' }]);
  const n = Object.keys(save.shards).length;
  if (n < 3) return dialogue([{ who: 'Autel', text: `Trois creux attendent leurs éclats. ${3 - n === 1 ? 'Il en manque un.' : `Il en manque ${3 - n}.`}` }]);
  startFinale();
}

/* ---------- Zones et titres ---------- */
function checkZones() {
  let z = null;
  for (const Z of Object.values(ZONES)) if (dist2(player.x, player.z, Z.x, Z.z) < Z.r) z = Z.key;
  if (!z && dist2(player.x, player.z, 0, 0) < 30) z = 'temple';
  if (z !== lastZone) { lastZone = z; if (z === 'temple') showZoneTitle('Temple de l’Aube', 'Cœur de l’île'); else if (z) showZoneTitle(ZONES[z].name, ZONES[z].sub); setQuestChanged(); }
}
let zoneTimer = null;
function showZoneTitle(t, s) { const el = $('zoneTitle'); el.innerHTML = `${t}<small>${s}</small>`; el.classList.add('show'); clearTimeout(zoneTimer); zoneTimer = setTimeout(() => el.classList.remove('show'), 3200); }

/* ---------- Caméra ---------- */
function updateCamera(dt) {
  const p = player, dist = input.zoom, tx = p.x, ty = p.y + 1.6, tz = p.z;
  let cx = tx + Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist, cy = ty + Math.sin(cam.pitch) * dist, cz = tz + Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist;
  const gmin = Math.max(groundAt(cx, cz), SEA) + 0.6; if (cy < gmin) cy = gmin;
  const k = clamp(dt * 12, 0, 1); cam.x = lerp(cam.x, cx, k); cam.y = lerp(cam.y, cy, k); cam.z = lerp(cam.z, cz, k);
  cam.shake = Math.max(0, cam.shake - dt * 2.5); const s = cam.shake * cam.shake * 0.6;
  camera.setPosition(cam.x + (R() - 0.5) * s, cam.y + (R() - 0.5) * s, cam.z + (R() - 0.5) * s); camera.lookAt(tx, ty, tz);
}

/* =====================================================================
   Interface : HUD, dialogues, menus, carte
   ===================================================================== */
function floater(x, y, z, text, cls) {
  const v = camera.camera.worldToScreen(new pc.Vec3(x, y, z)); if (v.z < 0) return;
  const el = document.createElement('div'); el.className = `floater ${cls}`; el.textContent = text; el.style.left = v.x + 'px'; el.style.top = v.y + 'px';
  $('floaters').append(el); setTimeout(() => el.remove(), 950);
}
function toast(msg) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; $('toasts').append(el); setTimeout(() => el.remove(), 4600); while ($('toasts').children.length > 4) $('toasts').firstChild.remove(); }
function renderShards() { $('shards').innerHTML = Object.values(ZONES).map((Z) => `<span class="shard ${save?.shards[Z.key] ? 'on' : ''}" style="--c:${Z.color}" title="${Z.shardName}"></span>`).join(''); }
function renderHearts() { $('hearts').textContent = save ? '❤'.repeat(save.hearts.length) + '♡'.repeat(4 - save.hearts.length) : ''; }
let questDirty = true;
const setQuestChanged = () => { questDirty = true; };
function questText() {
  const n = Object.keys(save.shards).length;
  if (save.finished) return ['L’Aube est revenue', 'Explore l’île librement.', ''];
  if (!save.talked) return ['Prologue', 'Parle au sage Ilyas, près du feu de camp.', ''];
  if (n === 3) return ['Le retour', 'Dépose les trois éclats sur l’autel du Temple de l’Aube.', ''];
  let sub = '';
  if (lastZone && ZONES[lastZone] && !save.shards[lastZone]) {
    const Z = ZONES[lastZone], left = enemies.filter((e) => e.alive && e.zone === lastZone).length;
    if (lastZone === 'ridge') sub = save.cleared.ridge ? 'Prends l’éclat sur son piédestal.' : 'Terrasse le Colosse de cristal.';
    else if (!save.cleared[lastZone]) sub = `Élimine les gardiens corrompus (${left} restant${left > 1 ? 's' : ''})${save.runes[lastZone] ? '' : ' et éveille les runes'}.`;
    else if (!save.runes[lastZone]) sub = 'Lis la stèle et éveille les trois runes dans l’ordre.';
    else sub = `Prends l’${Z.shardName}.`;
  }
  const missing = Object.values(ZONES).filter((Z) => !save.shards[Z.key]).map((Z) => Z.name).join(', ');
  return [`Les éclats d’Aube (${n}/3)`, `Restants : ${missing}.`, sub];
}
const hud = {};
function updateHud() {
  const p = player;
  // n'écrire dans le DOM que ce qui change (sinon l'interface est repeinte à chaque image)
  const hp = `${Math.ceil(p.hp)} / ${p.maxHp}`, hpS = clamp(p.hp / p.maxHp, 0, 1).toFixed(3), stS = clamp(p.st / 100, 0, 1).toFixed(2);
  if (hud.hp !== hp) { hud.hp = hp; $('hpText').textContent = hp; }
  if (hud.hpS !== hpS) { hud.hpS = hpS; $('hpBar').style.transform = `scaleX(${hpS})`; }
  if (hud.stS !== stS) { hud.stS = stS; $('stBar').style.transform = `scaleX(${stS})`; }
  const mpS = clamp(p.mp / stats().maxMp, 0, 1).toFixed(2); if (hud.mpS !== mpS) { hud.mpS = mpS; $('mpBar').style.transform = `scaleX(${mpS})`; }
  const purse = `🪙 ${save.gold} · 🧪 ${save.potions.hp} · 💧 ${save.potions.mp}${save.items.bow ? ` · 🏹 ${save.arrows}` : ''}`;
  if (hud.purse !== purse) { hud.purse = purse; $('purse').textContent = purse; }
  const wkey = WEAPONS.map((w) => `${w.id}:${!!save.items[w.id]}:${p.weapon === w.id}:${Math.ceil(p.powerCd[w.id])}`).join('|');
  if (hud.weapons !== wkey) { hud.weapons = wkey; $('weapons').innerHTML = WEAPONS.map((w) => `<div class="wslot ${save.items[w.id] ? '' : 'locked'} ${p.weapon === w.id ? 'on' : ''}" title="${w.name} — pouvoir : ${w.power}"><kbd>${w.key}</kbd><span>${save.items[w.id] ? w.icon : '?'}</span>${p.powerCd[w.id] > 0 ? `<em>${Math.ceil(p.powerCd[w.id])}</em>` : ''}</div>`).join('') + `<div class="wpower">F · ${WEAPONS.find((w) => w.id === p.weapon).power}</div>`; }
  const ch = (p.weapon === 'bow' || p.weapon === 'staff') && locked(); if (hud.cross !== ch) { hud.cross = ch; $('crosshair').hidden = !ch; }
  $('crosshair').classList.toggle('charge', p.charging && p.chargeT > 0.85);
  if (questDirty && save) { questDirty = false; const q = questText().join('|'); if (hud.q !== q) { hud.q = q; const [t, a, b] = q.split('|'); $('questTitle').textContent = t; $('questText').textContent = a; $('questSub').textContent = b; renderHearts(); } }
  if (Math.floor(state.time * 2) % 4 === 0) questDirty = true;
}
/* Dialogues */
let dlg = null;
function dialogue(lines, done) { dlg = { lines: [...lines], i: 0, shown: 0, done, choices: null }; state.prev = state.mode; state.mode = 'dialogue'; $('dialogue').hidden = false; $('prompt').hidden = true; if (locked()) { state.ignoreUnlock = true; } showLine(); }
function showLine() {
  const l = dlg.lines[dlg.i]; $('dlgName').textContent = l.who; $('dlgPortrait').textContent = l.who[0]; $('dlgText').textContent = ''; dlg.shown = 0; dlg.full = l.text;
  $('dlgChoices').innerHTML = ''; $('dlgNext').hidden = true;
}
function updateDialogue(dt) {
  if (!dlg) return;
  const l = dlg.lines[dlg.i];
  if (dlg.shown < dlg.full.length) { const before = Math.floor(dlg.shown); dlg.shown = Math.min(dlg.full.length, dlg.shown + dt * 48); if (Math.floor(dlg.shown) > before && Math.floor(dlg.shown) % 3 === 0) play('blip'); $('dlgText').textContent = dlg.full.slice(0, Math.floor(dlg.shown)); if (dlg.shown >= dlg.full.length) finishLine(l); }
  if (take('KeyE') || take('Space') || take('Enter') || take('Attack')) advance();
}
function finishLine(l) {
  $('dlgText').textContent = dlg.full;
  if (l.choices && !$('dlgChoices').children.length) { $('dlgChoices').innerHTML = l.choices.map((c, i) => `<button data-choice="${i}">${i + 1}. ${c.label}</button>`).join(''); $('dlgChoices').querySelector('button')?.focus(); }
  else if (!l.choices) $('dlgNext').hidden = false;
}
function advance() {
  const l = dlg.lines[dlg.i];
  if (dlg.shown < dlg.full.length) { dlg.shown = dlg.full.length; finishLine(l); return; }
  if (l.choices) return;
  dlg.i++; if (dlg.i >= dlg.lines.length) return endDialogue(); showLine();
}
function choose(i) { const l = dlg.lines[dlg.i]; const c = l.choices?.[i]; if (!c) return; play('select'); const extra = c.act ? (c.act() || []) : []; dlg.lines.splice(dlg.i + 1, 0, ...extra, ...(c.next || [])); dlg.i++; if (dlg.i >= dlg.lines.length) return endDialogue(); showLine(); }
function endDialogue() { $('dialogue').hidden = true; const d = dlg; dlg = null; state.mode = 'playing'; d.done?.(); setQuestChanged(); }
$('dlgChoices').addEventListener('click', (e) => { const b = e.target.closest('[data-choice]'); if (b) choose(Number(b.dataset.choice)); });
$('dialogue').addEventListener('click', (e) => { if (!e.target.closest('[data-choice]')) advance(); });
addEventListener('keydown', (e) => { if (state.mode === 'dialogue' && /^Digit[1-3]$/.test(e.code)) choose(Number(e.code.slice(5)) - 1); });

/* Mini-carte et carte */
let mapImg = null;
function buildMinimapImage() {
  const S = 280; mapImg = document.createElement('canvas'); mapImg.width = mapImg.height = S; const g = mapImg.getContext('2d'), img = g.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = i / S * WORLD - HALF, z = j / S * WORLD - HALF, h = terrainH(x, z), c = h < SEA ? mix(hex('#0E3B52'), hex('#2B7F96'), clamp((h + 8) / 8, 0, 1)) : groundColor(x, z, h, Math.abs(terrainH(x + 2, z) - h) / 2);
    const k = (j * S + i) * 4, shade = h > 0 ? 0.85 + clamp((terrainH(x - 2, z - 2) - h) * -0.05, -0.15, 0.2) : 1; img.data[k] = c[0] * 255 * shade; img.data[k + 1] = c[1] * 255 * shade; img.data[k + 2] = c[2] * 255 * shade; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#E7D3FF'; g.beginPath(); g.arc(S / 2, S / 2, 6, 0, Math.PI * 2); g.fill();
}
function markers() {
  const m = [];
  if (!save.talked) m.push([ilyas.x, ilyas.z, '#79B8FF', 'npc']);
  for (const Z of Object.values(ZONES)) if (!save.shards[Z.key] && save.talked) m.push([Z.x, Z.z, '#F2C46D', 'goal']);
  if (Object.keys(save.shards).length === 3 && !save.finished) m.push([0, 0, '#F2C46D', 'goal']);
  for (const k of save.checkpoints) m.push([CHECKPOINTS[k].x, CHECKPOINTS[k].z, '#FF9D4D', 'cp']);
  if (save.talked) m.push([ilyas.x, ilyas.z, '#79B8FF', 'npc']);
  for (const c of chests) if (!c.open && (save.items.map || dist2(c.x, c.z, player.x, player.z) < 30)) m.push([c.x, c.z, '#FFE07A', 'chest']);
  for (const c of chests) if (!c.open && save.items.map) m.push([c.x, c.z, c.rare ? '#FFD36B' : '#C9A06B', 'chest']);
  return m;
}
function drawMinimap() {
  const c = $('minimap'), g = c.getContext('2d'), S = c.width, scale = 280 / WORLD, view = 150;
  g.save(); g.clearRect(0, 0, S, S); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
  g.translate(S / 2, S / 2); g.rotate(cam.yaw - Math.PI);
  const px = (player.x + HALF) * scale, pz = (player.z + HALF) * scale, z = S / (view * scale);
  g.scale(z, z); g.drawImage(mapImg, -px, -pz);
  for (const [x, zz, color] of markers()) { g.fillStyle = color; g.beginPath(); g.arc((x + HALF) * scale - px, (zz + HALF) * scale - pz, 3.2 / z * 1.4, 0, Math.PI * 2); g.fill(); }
  g.restore();
  g.save(); g.translate(S / 2, S / 2); g.rotate(-(player.yaw - cam.yaw)); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
  g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 11px system-ui'; g.textAlign = 'center'; const a = cam.yaw - Math.PI; g.fillText('N', S / 2 + Math.sin(-a) * (S / 2 - 10) * -1, S / 2 - Math.cos(-a) * (S / 2 - 10) + 4);
}
function drawBigMap() {
  const c = $('bigmap'), g = c.getContext('2d'), S = c.width, k = S / 280, scale = 280 / WORLD;
  g.clearRect(0, 0, S, S); g.drawImage(mapImg, 0, 0, S, S);
  g.font = '600 13px Cinzel, serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.9)'; g.shadowColor = '#000'; g.shadowBlur = 4;
  for (const Z of Object.values(ZONES)) g.fillText(Z.name, (Z.x + HALF) * scale * k, (Z.z + HALF) * scale * k - 14);
  g.fillText('Temple de l’Aube', S / 2, S / 2 - 16); g.fillText('Camp', (PLACES.camp.x + HALF) * scale * k, (PLACES.camp.z + HALF) * scale * k + 22);
  g.shadowBlur = 0;
  for (const [x, z, color] of markers()) { g.fillStyle = color; g.beginPath(); g.arc((x + HALF) * scale * k, (z + HALF) * scale * k, 6, 0, Math.PI * 2); g.fill(); }
  const px = (player.x + HALF) * scale * k, pz = (player.z + HALF) * scale * k;
  g.save(); g.translate(px, pz); g.rotate(-player.yaw + Math.PI); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
}

/* Écrans et flux de jeu */
const SCREENS = ['title', 'pause', 'settings', 'controls', 'credits', 'map', 'gameover', 'victory', 'inventory', 'charSelect'];
let screenStack = [];
function show(id) { SCREENS.forEach((s) => { $(s).hidden = s !== id; }); }
function openOverlay(id) { screenStack.push(SCREENS.find((s) => !$(s).hidden) || null); show(id); if (id === 'settings') fillSettings(); if (id === 'map') drawBigMap(); }
function back() { const prev = screenStack.pop(); show(prev); if (!prev && state.mode === 'map') { state.mode = 'playing'; } }
function setPaused(on) {
  if (on && state.mode === 'playing') { state.mode = 'paused'; show('pause'); $('pauseStats').textContent = `Temps de jeu : ${fmtTime(state.play)} · Éclats : ${Object.keys(save.shards).length}/3 · Gardiens vaincus : ${save.kills}`; if (locked()) document.exitPointerLock(); }
  else if (!on && state.mode === 'paused') { state.mode = 'playing'; show(null); screenStack = []; }
}
function onPauseKey() {
  if (state.mode === 'dialogue') return;
  if (state.mode === 'map') { toggleMap(); return; }
  if (state.mode === 'inventory') { toggleInventory(); return; }
  if (screenStack.length) { back(); return; }
  if (state.mode === 'playing') setPaused(true); else if (state.mode === 'paused') setPaused(false);
}
function openCharSelect() {
  $('charCards').innerHTML = Object.entries(CHARACTERS).map(([id, c]) => `<button class="char-card" data-act="pickChar" data-char="${id}"><span class="char-icon">${c.icon}</span><b>${c.name}</b><em>${c.species}</em><small>${c.desc}</small>${c.builtin ? '' : '<i class="char-tag">Modèle 3D animé</i>'}</button>`).join('')
    + UPCOMING.map((u) => `<div class="char-card locked"><span class="char-icon">${u.icon}</span><b>${u.name}</b><em>Bientôt</em><small>Modèle en préparation.</small></div>`).join('');
  screenStack = ['title']; show('charSelect');
}
function toggleInventory() {
  if (state.mode === 'playing') { state.mode = 'inventory'; screenStack = []; renderInventory(); show('inventory'); if (locked()) { state.ignoreUnlock = true; document.exitPointerLock(); } }
  else if (state.mode === 'inventory') { state.mode = 'playing'; show(null); }
}
function toggleMap() {
  if (state.mode === 'playing') { state.mode = 'map'; screenStack = []; show('map'); drawBigMap(); if (locked()) { state.ignoreUnlock = true; document.exitPointerLock(); } }
  else if (state.mode === 'map') { state.mode = 'playing'; show(null); }
}
function fillSettings() {
  const f = $('settingsForm'); for (const [k, v] of Object.entries(settings)) { const el = f.elements[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; }
}
$('settingsForm').addEventListener('input', (e) => {
  const el = e.target; if (!el.name) return;
  settings[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value; saveSettings();
  if (['volume', 'music', 'sfx'].includes(el.name)) Audio.apply();
  if (['quality', 'fov'].includes(el.name)) applyQuality();
  if (el.name === 'showFps') $('fps').hidden = !settings.showFps;
  if (el.name === 'renderer') $('rendererHint').textContent = 'Le changement de rendu s’appliquera au prochain lancement du jeu.';
});
function quitToKairos() { writeSave(); if (inFrame) parent.postMessage({ type: 'kairos:closeGame' }, location.origin); else location.href = '/#/games'; }
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return; Audio.init(); play('select');
  const a = b.dataset.act;
  if (a === 'new') { if (loadSave() && !confirm('Commencer une nouvelle partie ? La progression actuelle sera remplacée.')) return; openCharSelect(); }
  if (a === 'pickChar') { const s = newSave(); s.character = b.dataset.char; startGame(s); }
  if (a === 'continue') startGame(loadSave());
  if (['settings', 'controls', 'credits', 'map'].includes(a)) openOverlay(a);
  if (a === 'back') { back(); if (state.mode === 'map' && $('map').hidden) state.mode = 'playing'; }
  if (a === 'resume') setPaused(false);
  if (a === 'pause') setPaused(true);
  if (a === 'toTitle') toTitle();
  if (a === 'quit') quitToKairos();
  if (a === 'respawn') respawn();
  if (a === 'explore') { show(null); state.mode = 'playing'; }
  if (a === 'inventory') { if (state.mode === 'paused') { show(null); state.mode = 'playing'; } toggleInventory(); }
  if (a === 'closeInv') toggleInventory();
});

/* Sauvegardes */
function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.v === 1 ? s : null; } catch { return null; } }
function writeSave() { if (!save) return; save.play = state.play; save.maxHp = player.maxHp; try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* stockage plein */ } }
setInterval(() => { if (state.mode === 'playing') writeSave(); }, 30000);
addEventListener('beforeunload', writeSave);
function refreshTitle() {
  const s = loadSave(); $('btnContinue').hidden = !s;
  if (s) $('saveInfo').textContent = `${Object.keys(s.shards).length}/3 éclats · ${fmtTime(s.play || 0)}${s.finished ? ' · terminée' : ''}`;
}
function applySaveToWorld() {
  for (const Z of Object.values(ZONES)) {
    const o = zoneObjs[Z.key], open = zoneOpen(Z.key);
    o.barrier.enabled = !open; o.barrierCol.on = !open; o.shard.enabled = !save.shards[Z.key];
    o.seq = []; o.runes.forEach((r) => { r.on = !!save.runes[Z.key]; r.top.render.material = glowMat('rune', Z.color, r.on); });
  }
  for (const [k, t] of Object.entries(totems)) if (t.flame) { t.lit = save.checkpoints.includes(k); t.flame.enabled = t.lit; t.light.enabled = t.lit; }
  for (const p of pickups) if (p.kind === 'heart') { p.taken = save.hearts.includes(p.id); p.e.enabled = !p.taken; }
  altar.sockets.forEach((s, i) => { const key = Object.keys(ZONES)[i]; s.render.material = glowMat('socket', ZONES[key].color, !!save.finished); });
  altar.beam.enabled = !!save.finished; altar.beamGrow = 1;
  for (const c of chests) { c.open = save.chests.includes(c.id); c.lidT = c.open ? 1 : 0; c.lid.setLocalEulerAngles(c.open ? -110 : 0, 0, 0); if (c.light) c.light.enabled = !c.open; }
  setDawn(!!save.finished, 1);
  renderShards(); renderHearts();
}
function startGame(s) {
  // anciennes sauvegardes : nouveaux champs
  s.gold ??= 0; s.potions ??= { hp: 1, mp: 0 }; s.arrows ??= 0; s.items ??= { sword: true }; s.chests ??= []; s.upgrades ??= {}; if (s.talked) s.items.flute = true;
  save = s; state.play = s.play || 0; player.maxHp = stats().maxHp; player.hp = player.maxHp; player.st = 100; player.dead = false; player.mp = stats().maxMp; player.hot = player.slow = player.rooted = 0;
  s.character ??= 'nera'; setCharacter(s.character);
  for (const k in player.powerCd) player.powerCd[k] = 0; player.weapon = 'flute'; selectWeapon('sword'); hud.weapons = null; hud.purse = null;
  const sk = window.aube?.skipStart || {};
  if (!sk.apply) applySaveToWorld(); if (!sk.enemies) populateEnemies();
  const cp = CHECKPOINTS[s.talked ? s.checkpoint : 'camp'];
  placePlayer(s.talked ? cp.x : 2, s.talked ? cp.z : 140, s.talked ? null : Math.PI);
  if (W.fox) { W.fox.holder.enabled = true; W.fox.x = player.x - 2; W.fox.z = player.z + 2; W.fox.yaw = player.yaw; }
  show(null); screenStack = []; $('hud').hidden = false; $('touch').hidden = !isTouch;
  state.mode = sk.mode || 'playing'; lastZone = null; setQuestChanged(); if (!sk.audio) { Audio.init(); Audio.setMode(save.finished ? 'dawn' : 'explore'); }
  if (!s.talked) setTimeout(() => toast('Approche-toi d’Ilyas et appuie sur E pour lui parler.'), 1500);
  // La souris n'est capturée qu'au premier clic dans la scène (geste explicite, comportement standard des jeux web)
  if (!isTouch) setTimeout(() => toast('Clique dans le jeu pour diriger la caméra avec la souris.'), 400);
}
function placePlayer(x, z, yaw) {
  const [px, pz] = findLand(x, z, 0.6); player.x = px; player.z = pz; player.y = groundAt(px, pz); player.vx = player.vz = player.vy = 0;
  if (yaw !== null && yaw !== undefined) { player.yaw = yaw; cam.yaw = yaw + Math.PI; }
  cam.x = px; cam.y = player.y + 5; cam.z = pz + 7; cam.pitch = 0.3;
}
function toTitle() { writeSave(); state.mode = 'title'; $('hud').hidden = true; $('touch').hidden = true; $('dialogue').hidden = true; screenStack = []; show('title'); refreshTitle(); if (locked()) document.exitPointerLock(); Audio.setMode('explore'); }
function die() {
  if (P.model) playAnim(P.model, 'death', 0.1);
  player.dead = true; save.deaths++; writeSave(); play('death');
  setTimeout(() => { state.mode = 'dead'; show('gameover'); if (locked()) document.exitPointerLock(); }, 900);
}
function respawn() {
  player.dead = false; player.hp = player.maxHp; player.st = 100; player.mp = stats().maxMp; player.slow = player.rooted = 0; populateEnemies(); applySaveToWorld();
  const cp = CHECKPOINTS[save.checkpoint] || CHECKPOINTS.camp; placePlayer(cp.x, cp.z + 2.5, null);
  $('bossBar').hidden = true; show(null); state.mode = 'playing'; Audio.setMode('explore');
}

/* ---------- Finale ---------- */
let cine = null;
function startFinale() {
  state.mode = 'cinematic'; cine = { t: 0 }; $('prompt').hidden = true; Audio.setMode('dawn'); play('shard');
  if (locked()) { state.ignoreUnlock = true; document.exitPointerLock(); }
}
function updateCinematic(dt) {
  cine.t += dt; const t = cine.t;
  for (let i = 0; i < 3; i++) if (t > 0.6 + i * 0.7 && !cine['s' + i]) { cine['s' + i] = true; const key = Object.keys(ZONES)[i]; altar.sockets[i].render.material = glowMat('socket', ZONES[key].color, true); play('rune'); burst((i - 1) * 1.4, 13.2, 0, 20, key === 'forest' ? 'green' : key === 'lake' ? 'blue' : 'violet', 5, 0.16, 1); }
  if (t > 2.8 && !cine.beam) { cine.beam = true; altar.beam.enabled = true; altar.beamGrow = 0.01; shake(0.6); play('open'); }
  if (cine.beam) altar.beamGrow = Math.min(1, altar.beamGrow + dt * 0.5);
  if (t > 3.2) setDawn(true, clamp((t - 3.2) / 4, 0, 1));
  const a = t * 0.18 + 0.4, r = 32 - t * 1.2; camera.setPosition(Math.cos(a) * r, 18 + t * 1.5, Math.sin(a) * r); camera.lookAt(0, 12 + t * 2, 0);
  if (t > 9 && !cine.end) {
    cine.end = true; save.finished = true; writeSave(); state.mode = 'victory'; show('victory');
    $('victoryStats').innerHTML = `<dt>Temps de jeu</dt><dd>${fmtTime(state.play)}</dd><dt>Gardiens vaincus</dt><dd>${save.kills}</dd><dt>Chutes</dt><dd>${save.deaths}</dd><dt>Pierres de cœur</dt><dd>${save.hearts.length}/4</dd>`;
  }
}
function setDawn(on, k) {
  const day = { sun: [1, 0.92, 0.8], amb: [0.38, 0.44, 0.56], fog: '#B9D3EA', clear: '#F3D6A6', sky: [1, 1, 1] }, dawn = { sun: [1, 0.78, 0.55], amb: [0.5, 0.44, 0.48], fog: '#F3C9A5', clear: '#FFC48A', sky: [1.15, 0.92, 0.85] };
  const L = (a, b) => a.map((v, i) => lerp(v, b[i], on ? k : 0));
  const s = L(day.sun, dawn.sun); sun.light.color = new pc.Color(...s); sun.light.intensity = 1.55 + (on ? k * 0.5 : 0);
  app.scene.ambientLight = new pc.Color(...L(day.amb, dawn.amb));
  app.scene.fog.color = new pc.Color(...L(hex(day.fog), hex(dawn.fog))); camera.camera.clearColor = new pc.Color(...L(hex(day.clear), hex(dawn.clear)));
  const sk = matCache.sky; sk.emissive = new pc.Color(...L(day.sky, dawn.sky)); sk.update();
  state.dawn = on && k > 0.5; if (cameraFrame) { cameraFrame.bloom.intensity = 0.018 + (on ? k * 0.04 : 0); cameraFrame.update(); }
}

/* =====================================================================
   Démarrage
   ===================================================================== */
(async () => {
  try { await boot(); }
  catch (e) { console.error(e); loadText.textContent = 'Le jeu n’a pas pu démarrer : ' + (e.message || e); return; }
  $('loader').hidden = true; state.mode = 'title'; show('title'); refreshTitle(); renderShards();
  $('fps').hidden = !settings.showFps; $('btnQuitTitle').textContent = inFrame ? '↩ Retour à Kairos' : '↩ Ouvrir Kairos';
  // Kairos ne doit pas se verrouiller pendant une partie (l'activité dans l'iframe ne lui parvient pas)
  if (inFrame) setInterval(() => { if (!document.hidden && ['playing', 'dialogue', 'cinematic', 'map'].includes(state.mode)) parent.postMessage({ type: 'kairos:activity' }, location.origin); }, 20000);
  window.aube = {          // accès de test et de débogage
    pc, get app() { return app; }, render: (on) => { app.autoRender = on; app.renderNextFrame = true; }, snap: () => new Promise((r) => { app.renderNextFrame = true; app.once('frameend', r); }), get camera() { return camera; }, get cameraFrame() { return cameraFrame; }, W, sun, settings, applyQuality, setDawn,
    get state() { return state.mode; }, get save() { return save; }, player, enemies, ZONES, zoneObjs, interactables, device: device.isWebGPU ? 'webgpu' : 'webgl2',
    teleport: (x, z) => placePlayer(x, z, null), slay: (i) => { const e = enemies[i]; if (e?.alive) { e.hp = 0; killEnemy(e); } }, interact: (id) => interactables.find((i) => i.id === id)?.act(), kill: (zone) => { for (let k = 0; k < 6; k++) enemies.filter((e) => e.alive && (!zone || e.zone === zone || (zone === 'ridge' && e.zone === 'pylon'))).forEach((e) => { e.hp = 0; if (e.kind === 'boss') { e.shield = false; e.rig.shield.enabled = false; } killEnemy(e); }); },
    get gold() { return save.gold; }, select: (w) => selectWeapon(w), stats, chests, projectiles, __reflex: (r) => enemyReflex(r), __dmg: (e, d) => damageEnemy(e, d, 0, 0, false, 'melee'),
    press: (code) => pressed.add(code), cam, input, MODELS, setCharacter, get P() { return P; }, get fox() { return W.fox; }, chests, projectiles, selectWeapon, stats, openChest: (id) => openChest(chests.find((c) => c.id === id)), finishDialogue: () => { while (dlg) { dlg.shown = dlg.full.length; if (dlg.lines[dlg.i].choices) choose(dlg.lines[dlg.i].choices.length - 1); else advance(); } },
  };
})();
