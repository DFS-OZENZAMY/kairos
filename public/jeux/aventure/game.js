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

const WORLD = 560, N = 192, CELL = WORLD / N, HALF = WORLD / 2, SEA = 0;
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
    open: () => [0, 3, 7, 10, 14].forEach((n, i) => tone(hz(57 + n), 1.2, 'sine', 0.12, i * 0.12)), select: () => tone(hz(81), 0.08, 'triangle', 0.08),
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
  opts.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
  opts.resourceHandlers = [pc.TextureHandler];
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
  // Terrain (facettes plates, couleurs par face)
  await progress(0.32, 'Peinture des paysages…');
  const tg = new Geo();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = i * CELL - HALF, z0 = j * CELL - HALF, x1 = x0 + CELL, z1 = z0 + CELL;
    const a = [x0, HM[j * (N + 1) + i], z0], b = [x1, HM[j * (N + 1) + i + 1], z0], c = [x0, HM[(j + 1) * (N + 1) + i], z1], d = [x1, HM[(j + 1) * (N + 1) + i + 1], z1];
    const t1 = [a, c, b], t2 = [d, b, c];
    for (const t of [t1, t2]) {
      const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3, ch = (t[0][1] + t[1][1] + t[2][1]) / 3;
      const slope = Math.max(Math.abs(t[0][1] - t[1][1]), Math.abs(t[0][1] - t[2][1]), Math.abs(t[1][1] - t[2][1])) / CELL;
      tg.tri(t[0], t[1], t[2], groundColor(cx, cz, ch, slope), 0.07);
    }
  }
  addMesh(tg, mat('terrain', { vertex: true, gloss: 0.12 }), { shadows: true, name: 'terrain' });
  await progress(0.42, 'Remplissage de l’océan…');
  // Océan
  const water = prim('plane', mat('water', { diffuse: '#1A6C82', opacity: 0.84, gloss: 0.92, metal: 0.05 }), world, [0, SEA, 0], [1600, 1, 1600], [0, 0, 0], false);
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
  sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.92, 0.8), intensity: 1.55, castShadows: true, shadowDistance: 140, shadowResolution: Q().shadows, numCascades: Q().cascades, cascadeDistribution: 0.55, shadowBias: 0.25, normalOffsetBias: 0.06, shadowType: pc.SHADOW_PCF3_32F });
  sun.setLocalEulerAngles(52, 32, 0); app.root.addChild(sun);
  app.scene.ambientLight = new pc.Color(0.38, 0.44, 0.56);
  app.scene.fog.type = pc.FOG_LINEAR; app.scene.fog.color = col('#B9D3EA'); app.scene.fog.start = 140 * Q().fog; app.scene.fog.end = 700 * Q().fog;
  await progress(0.5, 'Plantation de la forêt…');
  buildVegetation();
  await progress(0.68, 'Érection du Temple de l’Aube…');
  buildStructures();
  await progress(0.82, 'Éveil des gardiens…');
  buildCamera(); buildPlayer(); buildParticles(); buildNPC(); buildInteractables(); buildMinimapImage();
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
const newSave = () => ({ v: 1, shards: {}, runes: {}, cleared: {}, hearts: [], checkpoint: 'camp', checkpoints: ['camp'], talked: 0, kills: 0, deaths: 0, play: 0, finished: false, created: Date.now() });
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
  P.root.setPosition(0, -50, 0);
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
const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: Math.PI, hp: 100, maxHp: 100, st: 100, grounded: true, attack: 0, combo: 0, comboWindow: 0, dodge: 0, invuln: 0, hurtFlash: 0, walk: 0, stepT: 0, dead: false, lastHitT: 0 };
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
  P = { root, body, head, armL, armR, legL, legR, cape: capePivot, sword, trail, mats: M };
}
const sharedMats = {};
/** Change l'émissif d'un matériau seulement si l'état change (update() à chaque image recompilerait les shaders). */
function setGlow(m, key, color, intensity) { if (m._glowKey === key) return; m._glowKey = key; m.emissive = col(color); m.emissiveIntensity = intensity; m.update(); }
function setOpacity(m, v) { if (m.opacity === v) return; m.opacity = v; m.update(); }
function enemyRig(kind) {
  const root = new pc.Entity(kind); world.addChild(root);
  const body = new pc.Entity('corps'); root.addChild(body);
  const r = { root, body, kind, parts: {} };
  if (kind === 'slime') {
    const m = new pc.StandardMaterial(); m.diffuse = col('#4FC3A1'); m.emissive = col('#1E7F6C'); m.emissiveIntensity = 0.5; m.gloss = 0.85; m.useMetalness = true; m.metalness = 0; m.opacity = 0.88; m.blendType = pc.BLEND_NORMAL; m.update();
    r.mat = m; r.parts.blob = prim('sphere', m, body, [0, 0.62, 0], [1.4, 1.2, 1.4]);
    prim('sphere', mat('eye'), body, [-0.24, 0.84, 0.6], [0.16, 0.22, 0.1]); prim('sphere', mat('eye'), body, [0.24, 0.84, 0.6], [0.16, 0.22, 0.1]);
  } else {
    const boss = kind === 'boss', sc = boss ? 2.6 : 1;
    const stoneM = boss ? mat('bossStone', { diffuse: '#6E6690', gloss: 0.35 }) : mat('golemStone', { diffuse: '#8B8579', gloss: 0.2 });
    const eyeM = new pc.StandardMaterial(); eyeM.diffuse = new pc.Color(0, 0, 0); eyeM.emissive = col(boss ? '#D9B8FF' : '#7FE3FF'); eyeM.emissiveIntensity = 3; eyeM.update(); r.eyeMat = eyeM;
    body.setLocalScale(sc, sc, sc);
    prim('box', stoneM, body, [0, 1.25, 0], [1.25, 1.15, 0.9]); prim('box', mat('moss', { diffuse: '#6E8F4E', gloss: 0.1 }), body, [0, 1.86, -0.05], [1.3, 0.12, 0.95]);
    const head = prim('box', stoneM, body, [0, 2.15, 0.1], [0.62, 0.55, 0.6]);
    prim('box', eyeM, head, [-0.22, 0.05, 0.51], [0.2, 0.12, 0.05]); prim('box', eyeM, head, [0.22, 0.05, 0.51], [0.2, 0.12, 0.05]);
    const arm = (x) => { const p = new pc.Entity('bras'); p.setLocalPosition(x, 1.75, 0); body.addChild(p); prim('box', stoneM, p, [0, -0.55, 0], [0.42, 1.1, 0.46]); prim('box', stoneM, p, [0, -1.2, 0.05], [0.55, 0.45, 0.6]); return p; };
    r.parts.armL = arm(-0.88); r.parts.armR = arm(0.88);
    prim('box', stoneM, body, [-0.35, 0.35, 0], [0.42, 0.7, 0.5]); prim('box', stoneM, body, [0.35, 0.35, 0], [0.42, 0.7, 0.5]);
    if (boss) { const cm = mat('crystal'); for (let i = 0; i < 7; i++) prim('cone', cm, body, [(R() - 0.5) * 1.1, 1.9 + R() * 0.3, -0.35 - R() * 0.2], [0.25, 0.7 + R() * 0.7, 0.25], [-30 + R() * 20, 0, (R() - 0.5) * 40]); }
  }
  return r;
}
const ENEMY = {
  slime: { name: 'Brumelin', hp: 32, speed: 4.4, range: 2.2, wind: 0.5, dmg: 12, radius: 0.8, aggro: 13 },
  golem: { name: 'Gardien de pierre', hp: 70, speed: 3.1, range: 2.6, wind: 0.75, dmg: 20, radius: 1.1, aggro: 14 },
  boss: { name: 'Colosse de cristal', hp: 300, speed: 3.4, range: 5, wind: 1.0, dmg: 28, radius: 2.6, aggro: 26 },
};
const enemies = [];
function spawnEnemy(kind, x, z, zone = null) {
  const [px, pz] = findLand(x, z, 1.2), d = ENEMY[kind];
  const e = { kind, d, zone, hx: px, hz: pz, x: px, z: pz, y: groundAt(px, pz), vx: 0, vz: 0, yaw: R() * 6, hp: d.hp, maxHp: d.hp, state: 'idle', t: R() * 3, cd: 1, alive: true, flash: 0, stag: 0, tx: px, tz: pz, phase2: false, hitsTaken: 0, rig: enemyRig(kind) };
  e.rig.root.setPosition(e.x, e.y, e.z); enemies.push(e); return e;
}
function clearEnemies() { for (const e of enemies) e.rig.root.destroy(); enemies.length = 0; }
function populateEnemies() {
  clearEnemies();
  if (!save.cleared.forest) [[-128, 20], [-112, 40], [-132, 42], [-104, 18]].forEach(([x, z]) => spawnEnemy('slime', x, z, 'forest'));
  if (!save.cleared.lake) { [[104, -4], [122, -24]].forEach(([x, z]) => spawnEnemy('golem', x, z, 'lake')); [[116, 2], [100, -26], [128, -6]].forEach(([x, z]) => spawnEnemy('slime', x, z, 'lake')); }
  if (!save.cleared.ridge) { [[2, -112], [-8, -122]].forEach(([x, z]) => spawnEnemy('golem', x, z, 'ridge-path')); W.boss = spawnEnemy('boss', 0, -146, 'ridge'); W.boss.state = 'dormant'; }
  [[-58, 12], [58, -4], [6, -72], [-8, 92], [60, 60], [-60, -70]].forEach(([x, z], i) => spawnEnemy(i % 3 === 2 ? 'golem' : 'slime', x, z, null));
}

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
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('mousedown', (e) => {
  Audio.init();
  if (state.mode !== 'playing') return;
  if (!locked() && !isTouch) { canvas.requestPointerLock?.()?.catch?.(() => {}); }
  if (e.button === 0) pressed.add('Attack'); if (e.button === 2) pressed.add('Dodge');
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
  document.querySelectorAll('[data-touch]').forEach((b) => b.addEventListener('touchstart', (e) => { e.preventDefault(); Audio.init(); pressed.add({ attack: 'Attack', jump: 'Space', dodge: 'Dodge', interact: 'KeyE' }[b.dataset.touch]); }, { passive: false }));
})();
function pollGamepad() {
  const gp = [...(navigator.getGamepads?.() || [])].find(Boolean); input.gp = gp || null; if (!gp) return;
  const b = (i) => gp.buttons[i]?.pressed, edge = (i, code) => { if (b(i) && !input.gpPrev[i]) pressed.add(code); input.gpPrev[i] = b(i); };
  edge(0, 'Space'); edge(2, 'Attack'); edge(1, 'Dodge'); edge(3, 'KeyE'); edge(5, 'KeyE'); edge(9, 'Escape'); edge(8, 'KeyM');
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
  animateWorld(dt);
  if (state.mode === 'title') { attractCamera(dt); }
  else if (state.mode === 'playing' || state.mode === 'dialogue' || state.mode === 'cinematic') {
    let gdt = dt;
    if (hitStop > 0) { hitStop -= dt; gdt = dt * 0.08; }
    if (state.mode === 'playing') { state.play += dt; save.play = state.play; updatePlayer(gdt); updateEnemies(gdt); updatePickups(gdt); updateInteract(); checkZones(); }
    else if (state.mode === 'dialogue') { updateEnemies(0); animatePlayer(dt, 0); updateDialogue(dt); }
    else updateCinematic(dt);
    updateCamera(dt);
  } else if (state.mode === 'dead') updateCamera(dt);
  updateParticles(dt);
  if (state.mode !== 'title' && state.mode !== 'loading') { hudT -= dt; if (hudT <= 0) { hudT = 0.2; if (!window.aube?.noMinimap) drawMinimap(); } updateHud(); }
  input.lookX = 0; input.lookY = 0; pressed.clear();
  if (settings.showFps) { fpsAcc += dtRaw; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} i/s · ${device.isWebGPU ? 'WebGPU' : 'WebGL 2'}`; fpsAcc = 0; fpsN = 0; } }
}
function animateWorld(dt) {
  const t = state.time;
  if (W.water) W.water.setLocalPosition(0, SEA + Math.sin(t * 0.6) * 0.08, 0);
  if (camera) { const cp = camera.getPosition(); W.sky.setPosition(cp.x, 0, cp.z); const sd = sun.forward; W.sunDisc.setPosition(cp.x - sd.x * 800, -sd.y * 800 - 60, cp.z - sd.z * 800); }
  if (W.fire) { const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06; W.fire.flames.forEach((e, i) => e.setLocalScale(0.9 * f / (i + 1) ** 0.5, 1.2 * (2 - f) / (i + 1) ** 0.4, 0.9 * f / (i + 1) ** 0.5)); W.fire.light.light.intensity = 2 + Math.sin(t * 17) * 0.3; if (R() < dt * 6) burst(PLACES.camp.x, heightAt(PLACES.camp.x, PLACES.camp.z) + 1, PLACES.camp.z, 1, 'fire', 1.5, 0.08, 1.2, -1); }
  for (const k in totems) { const tt = totems[k]; if (tt.lit && tt.flame) { const f = 1 + Math.sin(t * 11 + k.length) * 0.1; tt.flame.setLocalScale(0.7 * f, 1 * (2 - f), 0.7 * f); } }
  for (const Z of Object.values(ZONES)) { const o = zoneObjs[Z.key]; if (o.shard?.enabled) { o.shard.setLocalEulerAngles(0, t * 60, 0); const p = o.pedestal; o.shard.setPosition(p.x, groundAt(p.x, p.z) + 2.6 + Math.sin(t * 2) * 0.2, p.z); } if (o.barrier?.enabled) o.barrier.setLocalEulerAngles(0, t * 20, 0); }
  for (const p of pickups) if (!p.taken) { p.e.setLocalEulerAngles(0, t * (p.kind === 'heart' ? 90 : 30), 0); }
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
  const [ax, az] = moveAxis(), moving = Math.hypot(ax, az) > 0.05;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  let wx = rx * ax - fx * az, wz = rz * ax - fz * az;
  const run = running() && moving && p.st > 1 && p.attack <= 0;
  const speed = p.dodge > 0 ? 0 : (p.attack > 0 ? 1.6 : run ? 9.2 : 5.4);
  if (run) p.st = Math.max(0, p.st - 22 * dt); else if (p.dodge <= 0 && p.attack <= 0) p.st = Math.min(100, p.st + (moving ? 16 : 26) * dt);
  // attaque
  p.comboWindow -= dt;
  if (take('Attack') || take('KeyJ')) {
    if (p.attack <= 0.12 && p.dodge <= 0 && p.st >= 8) {
      p.combo = p.comboWindow > 0 ? (p.combo % 3) + 1 : 1; p.attack = p.combo === 3 ? 0.5 : 0.36; p.attackHit = false; p.comboWindow = p.attack + 0.35; p.st -= 8; play('swing');
      const tgt = nearestEnemy(4.5); if (tgt) p.yaw = Math.atan2(tgt.x - p.x, tgt.z - p.z); else if (moving) p.yaw = Math.atan2(wx, wz);
    }
  }
  if (p.attack > 0) { p.attack -= dt; const total = p.combo === 3 ? 0.5 : 0.36; if (!p.attackHit && p.attack < total * 0.55) { p.attackHit = true; strike(); } }
  // esquive
  if ((take('Dodge') || take('KeyK') || take('ControlLeft')) && p.dodge <= 0 && p.st >= 20 && p.grounded) {
    p.dodge = 0.45; p.invuln = 0.4; p.st -= 20; play('dodge'); p.attack = 0;
    const dx = moving ? wx : Math.sin(p.yaw), dz2 = moving ? wz : Math.cos(p.yaw), l = Math.hypot(dx, dz2) || 1; p.dvx = dx / l * 13; p.dvz = dz2 / l * 13; p.yaw = Math.atan2(p.dvx, p.dvz);
  }
  let tvx = wx * speed, tvz = wz * speed;
  if (p.dodge > 0) { p.dodge -= dt; tvx = p.dvx * (p.dodge / 0.45 + 0.2); tvz = p.dvz * (p.dodge / 0.45 + 0.2); }
  const acc = p.grounded ? 14 : 4; p.vx = lerp(p.vx, tvx, clamp(acc * dt, 0, 1)); p.vz = lerp(p.vz, tvz, clamp(acc * dt, 0, 1));
  if (moving && p.attack <= 0 && p.dodge <= 0) p.yaw = angleLerp(p.yaw, Math.atan2(wx, wz), clamp(12 * dt, 0, 1));
  // saut et gravité
  if (take('Space') && p.grounded && p.dodge <= 0) { p.vy = 8.6; p.grounded = false; play('jump'); }
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
  if (p.dodge > 0) { bodyX = (1 - p.dodge / 0.45) * 360; }
  if (!p.grounded) { aL = -30; aR = p.attack > 0 ? aR : -150; P.legL.setLocalEulerAngles(-30, 0, 0); P.legR.setLocalEulerAngles(20, 0, 0); }
  P.armR.setLocalEulerAngles(aR, 0, aRz); P.armL.setLocalEulerAngles(aL, 0, 8);
  P.body.setLocalEulerAngles(bodyX, bodyY, 0); P.body.setLocalPosition(0, p.dodge > 0 ? 0.55 : Math.abs(Math.sin(p.walk * 2)) * 0.06 * clamp(sp / 6, 0, 1), 0);
  P.cape.setLocalEulerAngles(10 + clamp(sp * 4, 0, 40) + Math.sin(state.time * 3) * 4, 0, 0);
  P.head.setLocalEulerAngles(Math.sin(state.time * 1.7) * 2, 0, 0);
  const flash = p.hurtFlash > 0 && Math.floor(state.time * 20) % 2 === 0; P.root.enabled = !flash || p.dead;
}
function nearestEnemy(range) { let best = null, bd = range; for (const e of enemies) { if (!e.alive || e.state === 'dormant') continue; const d = dist2(e.x, e.z, player.x, player.z); if (d < bd) { bd = d; best = e; } } return best; }
function strike() {
  const p = player, dmgBase = p.combo === 3 ? 22 : 12, reach = p.combo === 3 ? 3.4 : 2.9, arc = p.combo === 2 ? 2.4 : 1.4;
  let hit = false;
  for (const e of enemies) {
    if (!e.alive || e.state === 'dormant') continue;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) - e.d.radius * 0.6;
    const ang = Math.abs(((Math.atan2(dx, dz) - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d < reach && ang < arc) { const crit = R() < 0.12, dmg = Math.round(dmgBase * (crit ? 1.8 : 1) * (0.9 + R() * 0.2)); damageEnemy(e, dmg, dx / (Math.hypot(dx, dz) || 1), dz / (Math.hypot(dx, dz) || 1), crit); hit = true; }
  }
  if (hit) { hitStop = 0.06; shake(0.25); play('hit'); }
}
function shake(a) { if (settings.shake) cam.shake = Math.max(cam.shake, a); }
function hurtPlayer(dmg, fromX, fromZ) {
  const p = player; if (p.invuln > 0 || p.dead || state.mode !== 'playing') return;
  p.hp = Math.max(0, p.hp - dmg); p.invuln = 0.7; p.hurtFlash = 0.5; play('hurt'); shake(0.5);
  const dx = p.x - fromX, dz = p.z - fromZ, l = Math.hypot(dx, dz) || 1; p.vx += dx / l * 9; p.vz += dz / l * 9; p.vy = 4; p.grounded = false;
  $('dmgFlash').style.opacity = 1; setTimeout(() => { $('dmgFlash').style.opacity = 0; }, 160);
  floater(p.x, p.y + 2.4, p.z, `-${dmg}`, 'hurt');
  if (p.hp <= 0) die();
}

/* ---------- Ennemis ---------- */
function damageEnemy(e, dmg, nx, nz, crit) {
  e.hp -= dmg; e.flash = 0.15; play('enemyHit'); e.hitsTaken++;
  floater(e.x, e.y + (e.kind === 'boss' ? 7 : e.kind === 'golem' ? 3.2 : 1.8), e.z, crit ? `${dmg} !` : `${dmg}`, crit ? 'crit' : '');
  burst(e.x, e.y + 1.2, e.z, 6, e.kind === 'slime' ? 'slime' : e.kind === 'boss' ? 'violet' : 'stone', 6, 0.16, 0.6);
  if (e.kind !== 'boss' || e.hitsTaken % 4 === 0) { e.vx += nx * (e.kind === 'slime' ? 11 : 6); e.vz += nz * (e.kind === 'slime' ? 11 : 6); if (e.state === 'windup' && e.kind !== 'boss') e.state = 'chase'; e.stag = 0.25; }
  if (e.state === 'idle' || e.state === 'return') e.state = 'chase';
  if (e.kind === 'boss' && !e.phase2 && e.hp < e.maxHp / 2) { e.phase2 = true; toast('Le Colosse appelle des Brumelins à l’aide !'); spawnEnemy('slime', e.x + 6, e.z, 'ridge-adds').state = 'chase'; spawnEnemy('slime', e.x - 6, e.z, 'ridge-adds').state = 'chase'; e.d = { ...e.d, speed: 4.4, wind: 0.8 }; shake(0.8); }
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.alive = false; save.kills++; play('death'); burst(e.x, e.y + 1, e.z, e.kind === 'boss' ? 60 : 18, e.kind === 'slime' ? 'slime' : e.kind === 'boss' ? 'violet' : 'stone', e.kind === 'boss' ? 12 : 7, 0.22, 1.2);
  e.dieT = 0.6;
  if (e.kind === 'boss') { save.cleared.ridge = true; $('bossBar').hidden = true; Audio.setMode('explore'); toast('Le Colosse de cristal s’effondre. La barrière se dissout !'); openZone('ridge'); writeSave(); }
  if (e.zone && ZONES[e.zone] && e.zone !== 'ridge') {
    const left = enemies.filter((x) => x.alive && x.zone === e.zone).length;
    if (!left) { save.cleared[e.zone] = true; toast(save.runes[e.zone] ? 'Zone libérée : la barrière s’ouvre !' : 'Zone libérée. Il reste l’énigme de la stèle.'); if (zoneOpen(e.zone)) openZone(e.zone); writeSave(); }
  }
  if (R() < (e.kind === 'slime' ? 0.25 : 0.5)) dropFlower(e.x, e.z);
}
function dropFlower(x, z) { const f = pickups.find((p) => p.kind === 'flower' && p.taken); if (!f) return; f.x = x + 0.6; f.z = z; f.e.setPosition(f.x, groundAt(f.x, f.z), f.z); f.e.enabled = true; f.taken = false; }
function updateEnemies(dt) {
  const p = player;
  for (const e of enemies) {
    const r = e.rig;
    if (!e.alive) { if (e.dieT > 0) { e.dieT -= dt; const s = Math.max(0.01, e.dieT / 0.6); r.root.setLocalScale(s, s * 0.6, s); if (e.dieT <= 0) r.root.enabled = false; } continue; }
    if (e.flash > 0) e.flash -= dt;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz), D = e.d;
    e.t += dt; e.cd -= dt; e.stag -= dt;
    let tvx = 0, tvz = 0;
    if (e.state === 'dormant') { if (d < 24 && !p.dead) { e.state = 'chase'; $('bossBar').hidden = false; $('bossName').textContent = D.name; Audio.setMode('boss'); showZoneTitle('Colosse de cristal', 'Gardien de la crête'); } }
    else if (e.state === 'idle') {
      if (e.t > 2.5) { e.t = 0; const a = R() * Math.PI * 2; e.tx = e.hx + Math.cos(a) * 5; e.tz = e.hz + Math.sin(a) * 5; }
      const ex = e.tx - e.x, ez = e.tz - e.z, l = Math.hypot(ex, ez); if (l > 0.5) { tvx = ex / l * D.speed * 0.35; tvz = ez / l * D.speed * 0.35; }
      if (d < D.aggro && !p.dead) e.state = 'chase';
    } else if (e.state === 'chase') {
      if (p.dead || dist2(e.x, e.z, e.hx, e.hz) > (e.kind === 'boss' ? 40 : 30)) e.state = 'return';
      else if (d < D.range + (e.kind === 'boss' ? 0.5 : 0) && e.cd <= 0 && e.stag <= 0) { e.state = 'windup'; e.t = 0; e.lungeX = dx / (d || 1); e.lungeZ = dz / (d || 1); if (e.kind === 'boss') e.slamX = p.x, e.slamZ = p.z; }
      else if (d > D.range * 0.7) { tvx = dx / d * D.speed; tvz = dz / d * D.speed; }
      e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), clamp(8 * dt, 0, 1));
    } else if (e.state === 'windup') {
      if (e.t >= D.wind) { e.state = 'strike'; e.t = 0;
        if (e.kind === 'slime') { e.vx = e.lungeX * 13; e.vz = e.lungeZ * 13; }
        else if (e.kind === 'golem') { const ang = Math.abs(((Math.atan2(dx, dz) - e.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (d < D.range + 0.6 && ang < 1.1) hurtPlayer(D.dmg, e.x, e.z); play('slam'); shake(0.25); }
        else { const sd = dist2(p.x, p.z, e.slamX, e.slamZ); if (sd < 5.2 && p.grounded) hurtPlayer(D.dmg, e.slamX, e.slamZ); play('slam'); shake(0.9); burst(e.slamX, groundAt(e.slamX, e.slamZ) + 0.2, e.slamZ, 26, 'violet', 9, 0.25, 0.9); }
      } else if (e.kind === 'boss') e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), clamp(3 * dt, 0, 1));
    } else if (e.state === 'strike') {
      if (e.kind === 'slime' && !e.hitDone && d < 1.5) { hurtPlayer(D.dmg, e.x, e.z); e.hitDone = true; }
      if (e.t > (e.kind === 'slime' ? 0.45 : 0.6)) { e.state = 'chase'; e.cd = e.kind === 'boss' ? (e.phase2 ? 1.2 : 1.8) : 1.2 + R(); e.hitDone = false; }
    } else if (e.state === 'return') {
      const hx = e.hx - e.x, hz = e.hz - e.z, l = Math.hypot(hx, hz); e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.3 * dt);
      if (l < 1.5) { e.state = e.kind === 'boss' ? 'dormant' : 'idle'; if (e.kind === 'boss') { $('bossBar').hidden = true; Audio.setMode('explore'); } } else { tvx = hx / l * D.speed; tvz = hz / l * D.speed; e.yaw = angleLerp(e.yaw, Math.atan2(hx, hz), clamp(6 * dt, 0, 1)); }
    }
    if (e.state === 'idle' && Math.hypot(tvx, tvz) > 0.1) e.yaw = angleLerp(e.yaw, Math.atan2(tvx, tvz), clamp(4 * dt, 0, 1));
    const k = e.state === 'strike' && e.kind === 'slime' ? 0.02 : clamp(8 * dt, 0, 1);
    e.vx = lerp(e.vx, tvx, k); e.vz = lerp(e.vz, tvz, k);
    let nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
    for (const c of nearColliders(nx, nz)) { if (!c.on) continue; const cx = nx - c.x, cz = nz - c.z, cd = Math.hypot(cx, cz), m = c.r + D.radius * 0.8; if (cd < m && cd > 0.0001) { nx = c.x + cx / cd * m; nz = c.z + cz / cd * m; } }
    for (const o of enemies) { if (o === e || !o.alive) continue; const cx = nx - o.x, cz = nz - o.z, cd = Math.hypot(cx, cz), m = (D.radius + o.d.radius) * 0.8; if (cd < m && cd > 0.0001) { nx += cx / cd * (m - cd) * 0.5; nz += cz / cd * (m - cd) * 0.5; } }
    if (terrainH(nx, nz) > 0.2) { e.x = nx; e.z = nz; } else { e.vx = 0; e.vz = 0; }
    e.y = groundAt(e.x, e.z);
    animateEnemy(e, dt, d);
  }
  const boss = W.boss; if (boss && boss.alive && boss.state !== 'dormant') $('bossHp').style.transform = `scaleX(${clamp(boss.hp / boss.maxHp, 0, 1)})`;
}
function animateEnemy(e, dt, d) {
  const r = e.rig, t = state.time + e.hx;
  r.root.setPosition(e.x, e.y, e.z); r.root.setEulerAngles(0, e.yaw * 180 / Math.PI, 0);
  if (e.kind === 'slime') {
    let sy = 1 + Math.sin(t * 6) * 0.08, sxz = 1 - Math.sin(t * 6) * 0.05, y = Math.max(0, Math.sin(t * 6)) * 0.25;
    if (e.state === 'windup') { const k = e.t / e.d.wind; sy = 1 - k * 0.35; sxz = 1 + k * 0.25; y = 0; }
    if (e.state === 'strike') { sy = 1.25; sxz = 0.85; y = 0.6; }
    r.body.setLocalScale(sxz, sy, sxz); r.body.setLocalPosition(0, y, 0);
    if (e.flash > 0) setGlow(r.mat, 'flash', '#FFFFFF', 2); else if (e.state === 'windup') setGlow(r.mat, 'wind', '#E65A33', 0.9); else setGlow(r.mat, 'idle', '#1E7F6C', 0.5);
  } else {
    const sp = Math.hypot(e.vx, e.vz), sw = Math.sin(t * 5) * clamp(sp / 3, 0, 1);
    let aL = sw * 25, aR = -sw * 25, lean = 0;
    if (e.state === 'windup') { const k = e.t / e.d.wind; aL = aR = -k * 150; lean = -k * 12; }
    if (e.state === 'strike') { const k = clamp(e.t / 0.15, 0, 1); aL = aR = lerp(-150, 30, k); lean = lerp(-12, 18, k); }
    r.parts.armL.setLocalEulerAngles(aL, 0, 0); r.parts.armR.setLocalEulerAngles(aR, 0, 0); r.body.setLocalEulerAngles(lean, 0, Math.sin(t * 2.5) * 2 * clamp(sp, 0, 1));
    if (e.flash > 0) setGlow(r.eyeMat, 'flash', '#FFFFFF', 5); else if (e.state === 'windup') setGlow(r.eyeMat, 'hot', '#FF4A3A', 5); else setGlow(r.eyeMat, 'idle', e.kind === 'boss' ? '#D9B8FF' : '#7FE3FF', 3);
    if (e.kind === 'boss' && e.state === 'windup' && R() < dt * 30) burst(e.slamX, groundAt(e.slamX, e.slamZ) + 0.1, e.slamZ, 1, 'red', 4, 0.2, 0.4, 2);
  }
}

/* ---------- Ramassables ---------- */
function updatePickups(dt) {
  for (const p of pickups) {
    if (p.taken) { if (p.kind === 'flower' && p.respawn > 0) { p.respawn -= dt; if (p.respawn <= 0) { p.taken = false; p.e.enabled = true; } } continue; }
    if (dist2(p.x, p.z, player.x, player.z) < (p.kind === 'heart' ? 1.8 : 1.4)) {
      if (p.kind === 'flower') { if (player.hp >= player.maxHp) continue; player.hp = Math.min(player.maxHp, player.hp + 30); play('heal'); floater(player.x, player.y + 2.3, player.z, '+30', ''); burst(p.x, groundAt(p.x, p.z) + 0.7, p.z, 10, 'gold', 3, 0.12, 0.8); p.taken = true; p.respawn = 90; p.e.enabled = false; }
      else { save.hearts.push(p.id); player.maxHp += 25; player.hp = player.maxHp; play('pickup'); burst(p.x, groundAt(p.x, p.z) + 1.2, p.z, 24, 'red', 5, 0.16, 1); p.taken = true; p.e.enabled = false; toast(`Pierre de cœur trouvée : vie maximale +25 (${save.hearts.length}/4)`); writeSave(); }
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
      { who: 'Ilyas', text: 'Rapporte les éclats sur l’autel, au centre de l’île. Allume les totems d’Aube en chemin : ils garderont ta trace si tu tombes. Que la lumière te guide.' },
    ], () => { setQuestChanged(); toast('Nouvel objectif : retrouver les trois éclats d’Aube'); });
  }
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
function choose(i) { const l = dlg.lines[dlg.i]; const c = l.choices?.[i]; if (!c) return; play('select'); dlg.lines.splice(dlg.i + 1, 0, ...c.next); dlg.i++; if (dlg.i >= dlg.lines.length) return endDialogue(); showLine(); }
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
const SCREENS = ['title', 'pause', 'settings', 'controls', 'credits', 'map', 'gameover', 'victory'];
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
  if (screenStack.length) { back(); return; }
  if (state.mode === 'playing') setPaused(true); else if (state.mode === 'paused') setPaused(false);
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
  if (a === 'new') { if (loadSave() && !confirm('Commencer une nouvelle partie ? La progression actuelle sera remplacée.')) return; startGame(newSave()); }
  if (a === 'continue') startGame(loadSave());
  if (['settings', 'controls', 'credits', 'map'].includes(a)) openOverlay(a);
  if (a === 'back') { back(); if (state.mode === 'map' && $('map').hidden) state.mode = 'playing'; }
  if (a === 'resume') setPaused(false);
  if (a === 'pause') setPaused(true);
  if (a === 'toTitle') toTitle();
  if (a === 'quit') quitToKairos();
  if (a === 'respawn') respawn();
  if (a === 'explore') { show(null); state.mode = 'playing'; }
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
  setDawn(!!save.finished, 1);
  renderShards(); renderHearts();
}
function startGame(s) {
  save = s; state.play = s.play || 0; player.maxHp = 100 + s.hearts.length * 25; player.hp = player.maxHp; player.st = 100; player.dead = false;
  applySaveToWorld(); populateEnemies();
  const cp = CHECKPOINTS[s.talked ? s.checkpoint : 'camp'];
  placePlayer(s.talked ? cp.x : 2, s.talked ? cp.z : 140, s.talked ? null : Math.PI);
  show(null); screenStack = []; $('hud').hidden = false; $('touch').hidden = !isTouch;
  state.mode = 'playing'; lastZone = null; setQuestChanged(); Audio.init(); Audio.setMode(save.finished ? 'dawn' : 'explore');
  if (!s.talked) setTimeout(() => toast('Approche-toi d’Ilyas et appuie sur E pour lui parler.'), 1500);
  if (!isTouch) canvas.requestPointerLock?.()?.catch?.(() => {});
}
function placePlayer(x, z, yaw) {
  const [px, pz] = findLand(x, z, 0.6); player.x = px; player.z = pz; player.y = groundAt(px, pz); player.vx = player.vz = player.vy = 0;
  if (yaw !== null && yaw !== undefined) { player.yaw = yaw; cam.yaw = yaw + Math.PI; }
  cam.x = px; cam.y = player.y + 5; cam.z = pz + 7; cam.pitch = 0.3;
}
function toTitle() { writeSave(); state.mode = 'title'; $('hud').hidden = true; $('touch').hidden = true; $('dialogue').hidden = true; screenStack = []; show('title'); refreshTitle(); if (locked()) document.exitPointerLock(); Audio.setMode('explore'); }
function die() {
  player.dead = true; save.deaths++; writeSave(); play('death');
  setTimeout(() => { state.mode = 'dead'; show('gameover'); if (locked()) document.exitPointerLock(); }, 900);
}
function respawn() {
  player.dead = false; player.hp = player.maxHp; player.st = 100; populateEnemies(); applySaveToWorld();
  const cp = CHECKPOINTS[save.checkpoint] || CHECKPOINTS.camp; placePlayer(cp.x, cp.z + 2.5, null);
  $('bossBar').hidden = true; show(null); state.mode = 'playing'; Audio.setMode('explore'); if (!isTouch) canvas.requestPointerLock?.()?.catch?.(() => {});
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
    teleport: (x, z) => placePlayer(x, z, null), interact: (id) => interactables.find((i) => i.id === id)?.act(), kill: (zone) => enemies.filter((e) => e.alive && (!zone || e.zone === zone)).forEach((e) => damageEnemy(e, 9999, 0, 0)),
    press: (code) => pressed.add(code), finishDialogue: () => { while (dlg) { dlg.shown = dlg.full.length; if (dlg.lines[dlg.i].choices) choose(dlg.lines[dlg.i].choices.length - 1); else advance(); } },
  };
})();
