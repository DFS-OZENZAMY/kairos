/* Kairos — application locale chiffrée (tâches, habitudes, notes, coffre, 2FA, focus) */
'use strict';
(() => {
  const VERSION = '1.0.0';
  const ITER = 310000;
  const STORE_KEY = 'kairos.vault.v1';
  const PREFS_KEY = 'kairos.prefs';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* =========================================================
     Utilitaires
     ========================================================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
  const z = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hueOf = (s) => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();
  const avatar = (name, cls = '') => `<span class="avatar ${cls}" style="--h:${hueOf(name)}" aria-hidden="true">${esc(initial(name))}</span>`;
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'à l’instant';
    const m = Math.round(s / 60); if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `il y a ${h} h`;
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  /* =========================================================
     Icônes
     ========================================================= */
  const ICONS = {
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m8 12 3 3 5-6"/>',
    habits: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    vault: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
    otp: '<path d="M12 3 4 6v6c0 4.8 3.4 8 8 9 4.6-1 8-4.2 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h3v3h-3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.8-3.5M4 4v4h4M4 13a8 8 0 0 0 14.8 3.5M20 20v-4h-4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 4h16"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    skip: '<path d="M5 5v14l10-7zM19 5v14"/>',
    pin: '<path d="M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.01"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="8.5" cy="15.5" r="1"/>',
  };
  const ic = (n, cls = '') => `<svg class="ic ${n === 'play' || n === 'pause' ? 'fill' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  /* =========================================================
     Stockage et préférences
     ========================================================= */
  const Store = {
    read() { try { const r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } },
    write(o) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); return true; }
      catch { toast('Enregistrement impossible : le stockage du navigateur est plein ou bloqué', 'error'); return false; }
    },
    clear() { try { localStorage.removeItem(STORE_KEY); } catch { /* rien */ } },
  };
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } })();
  prefs.theme ??= 'system'; prefs.autolock ??= 5; prefs.clipClear ??= 30;
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* rien */ } };
  function applyTheme() {
    if (prefs.theme === 'light' || prefs.theme === 'dark') document.documentElement.dataset.theme = prefs.theme;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme();

  /* =========================================================
     Chiffrement (PBKDF2-SHA256 → AES-GCM 256)
     ========================================================= */
  async function deriveKey(password, salt, iter = ITER) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptJSON(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function decryptJSON(key, iv, ct) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
    return JSON.parse(dec.decode(pt));
  }

  /* =========================================================
     TOTP (RFC 6238) + base32
     ========================================================= */
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function base32Decode(input) {
    const s = String(input).replace(/[\s=-]/g, '').toUpperCase();
    if (!s) throw new Error('Clé vide');
    let bits = 0, val = 0; const out = [];
    for (const c of s) {
      const i = B32.indexOf(c);
      if (i < 0) throw new Error('La clé contient des caractères invalides (seulement A–Z et 2–7)');
      val = (val << 5) | i; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }
  function base32Encode(bytes) {
    let bits = 0, val = 0, out = '';
    for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  }
  const hmacKeys = new Map();
  async function totp(o, t = Date.now()) {
    const period = o.period || 30, digits = o.digits || 6, alg = o.algorithm || 'SHA-1';
    const ck = `${alg}:${o.secret}`;
    let key = hmacKeys.get(ck);
    if (!key) {
      key = await crypto.subtle.importKey('raw', base32Decode(o.secret), { name: 'HMAC', hash: alg }, false, ['sign']);
      hmacKeys.set(ck, key);
    }
    const counter = Math.floor(t / 1000 / period);
    const buf = new ArrayBuffer(8); const dv = new DataView(buf);
    dv.setUint32(0, Math.floor(counter / 2 ** 32)); dv.setUint32(4, counter >>> 0);
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
    const off = h[h.length - 1] & 15;
    const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  }
  const codeCache = new Map();
  async function codeAt(o, t) {
    const k = `${o.id}:${o.secret}:${Math.floor(t / 1000 / (o.period || 30))}`;
    if (codeCache.has(k)) return codeCache.get(k);
    if (codeCache.size > 300) codeCache.clear();
    const c = await totp(o, t); codeCache.set(k, c); return c;
  }
  const fmtCode = (c) => (c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c);

  function parseOtpauth(uri) {
    let u;
    try { u = new URL(uri.trim()); } catch { throw new Error('Ce lien n’est pas un lien otpauth:// valide'); }
    if (u.protocol !== 'otpauth:') throw new Error('Le lien doit commencer par otpauth://');
    const type = (u.host || u.hostname || '').toLowerCase();
    if (type === 'hotp') throw new Error('Les codes HOTP (par compteur) ne sont pas pris en charge, seulement TOTP');
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const p = u.searchParams;
    let issuer = p.get('issuer') || '', account = label;
    if (label.includes(':')) { const [a, ...b] = label.split(':'); issuer = issuer || a.trim(); account = b.join(':').trim(); }
    const algMap = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
    return {
      issuer: issuer || account || 'Compte', account,
      secret: (p.get('secret') || '').replace(/\s/g, '').toUpperCase(),
      digits: Number(p.get('digits')) || 6, period: Number(p.get('period')) || 30,
      algorithm: algMap[(p.get('algorithm') || 'SHA1').toUpperCase()] || 'SHA-1',
    };
  }

  // Export Google Authenticator : otpauth-migration://offline?data=… (protobuf)
  function parseMigration(uri) {
    const u = new URL(uri.trim());
    let d64 = (u.searchParams.get('data') || '').replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    while (d64.length % 4) d64 += '=';
    const raw = unb64(d64);
    let pos = 0;
    const varint = (buf) => { let r = 0, s = 0, b; do { b = buf[pos++]; r += (b & 127) * 2 ** s; s += 7; } while (b & 128); return r; };
    const readMsg = (buf, end, onField) => {
      while (pos < end) {
        const tag = varint(buf); const f = tag >>> 3, wt = tag & 7;
        if (wt === 0) onField(f, varint(buf));
        else if (wt === 2) { const len = varint(buf); const start = pos; onField(f, buf.subarray(start, start + len), start, start + len); pos = start + len; }
        else if (wt === 1) pos += 8; else if (wt === 5) pos += 4; else throw new Error('Format d’export non reconnu');
      }
    };
    const out = []; let skipped = 0;
    readMsg(raw, raw.length, (f, v, s, e) => {
      if (f !== 1 || !(v instanceof Uint8Array)) return;
      const save = pos; pos = s;
      const o = { secret: '', name: '', issuer: '', alg: 1, digits: 1, type: 2 };
      readMsg(raw, e, (ff, vv) => {
        if (ff === 1) o.secret = base32Encode(vv);
        else if (ff === 2) o.name = dec.decode(vv);
        else if (ff === 3) o.issuer = dec.decode(vv);
        else if (ff === 4) o.alg = vv; else if (ff === 5) o.digits = vv; else if (ff === 6) o.type = vv;
      });
      pos = save;
      if (o.type === 1) { skipped++; return; }
      let account = o.name, issuer = o.issuer;
      if (account.includes(':')) { const [a, ...b] = account.split(':'); issuer = issuer || a.trim(); account = b.join(':').trim(); }
      out.push({
        issuer: issuer || account || 'Compte', account, secret: o.secret,
        algorithm: { 2: 'SHA-256', 3: 'SHA-512' }[o.alg] || 'SHA-1',
        digits: o.digits === 2 ? 8 : 6, period: 30,
      });
    });
    return { items: out, skipped };
  }

  /* =========================================================
     Générateur et robustesse des mots de passe
     ========================================================= */
  function randInt(max) {
    const lim = Math.floor(2 ** 32 / max) * max; const a = new Uint32Array(1);
    do crypto.getRandomValues(a); while (a[0] >= lim);
    return a[0] % max;
  }
  function generate(o) {
    const sets = [];
    const amb = o.ambiguous ? '' : 'Il1O0o';
    const clean = (s) => [...s].filter((c) => !amb.includes(c)).join('');
    if (o.lower) sets.push(clean('abcdefghijkmnopqrstuvwxyz' + (o.ambiguous ? 'lo' : '')));
    if (o.upper) sets.push(clean('ABCDEFGHJKLMNPQRSTUVWXYZ' + (o.ambiguous ? 'IO' : '')));
    if (o.digits) sets.push(clean('23456789' + (o.ambiguous ? '01' : '')));
    if (o.symbols) sets.push('!@#$%&*?-_=+;:.');
    if (!sets.length) sets.push('abcdefghijkmnopqrstuvwxyz');
    const all = sets.join('');
    const chars = sets.map((s) => s[randInt(s.length)]);
    while (chars.length < o.length) chars.push(all[randInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = randInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    return chars.join('');
  }
  function strength(pw) {
    if (!pw) return { score: 0, label: '', bits: 0 };
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10; if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
    let bits = pw.length * Math.log2(pool || 1);
    if (/^(.)\1+$/.test(pw)) bits = 4;
    if (/(password|motdepasse|azerty|qwerty|123456|abcdef|admin|soleil|bonjour)/i.test(pw)) bits = Math.min(bits, 24);
    const score = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    return { score, bits: Math.round(bits), label: ['', 'Faible', 'Moyen', 'Solide', 'Excellent'][score] };
  }
  const genPrefs = { length: 20, lower: true, upper: true, digits: true, symbols: true, ambiguous: false };
  const colorPw = (pw) => esc(pw).replace(/([!@#$%*?\-_=+;:.]|&amp;)/g, '<span class="s">$1</span>').replace(/(\d+)/g, '<span class="d">$1</span>');

  /* =========================================================
     Session et données
     ========================================================= */
  let session = { key: null, salt: null, data: null };
  const state = { view: 'today', taskFilter: 'today', vaultFilter: 'all', vaultQuery: '', otpQuery: '', noteId: null, noteQuery: '', habitColor: '#2F45D8' };
  const D = () => session.data;

  function seed() {
    return {
      vault: [], otp: [], tasks: [], habits: [],
      notes: [{
        id: uid(), pinned: true, updatedAt: Date.now(), title: 'Bienvenue dans Kairos',
        body: 'Tout ce que tu enregistres ici est chiffré sur ton appareil avec ton mot de passe maître.\n\nRaccourcis utiles :\n• Ctrl + K : chercher partout (un site, un code, une note…) et copier en un geste\n• Ctrl + Maj + L : verrouiller tout de suite\n\nPour importer tes codes depuis Google Authenticator : dans l’appli, menu ⋮ → Transférer des comptes → Exporter, puis dans Kairos : Codes 2FA → Ajouter → Scanner avec la caméra.\n\nPense à télécharger une sauvegarde chiffrée de temps en temps (Réglages → Sauvegarde).',
      }],
      journal: {}, focus: {}, focusSessions: {}, createdAt: Date.now(),
    };
  }
  function migrate(d) {
    const s = seed();
    for (const k of Object.keys(s)) if (d[k] === undefined) d[k] = Array.isArray(s[k]) ? [] : (typeof s[k] === 'object' ? {} : s[k]);
    return d;
  }

  let saveTimer = null, savePending = false;
  function save() { savePending = true; clearTimeout(saveTimer); saveTimer = setTimeout(persist, 350); }
  async function persist() {
    clearTimeout(saveTimer);
    if (!session.key || !session.data) return;
    savePending = false;
    const { iv, ct } = await encryptJSON(session.key, session.data);
    Store.write({ v: 1, app: 'kairos', kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(session.salt), iv, ct });
  }
  addEventListener('beforeunload', () => { if (savePending) persist(); });
  addEventListener('pagehide', () => { if (savePending) persist(); });

  /* =========================================================
     Toasts, presse-papiers, fenêtres
     ========================================================= */
  function toast(msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = (kind === 'ok' ? ic('check') : kind === 'error' ? ic('warn') : '') + `<span>${esc(msg)}</span>`;
    $('#toasts').append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, kind === 'error' ? 4200 : 2600);
  }
  let clipTimer = null;
  async function copy(text, label = 'Copié', sensitive = true) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const s = Number(prefs.clipClear) || 0;
    toast(sensitive && s ? `${label}. Effacé du presse-papiers dans ${s} s` : label, 'ok');
    clearTimeout(clipTimer);
    if (sensitive && s) clipTimer = setTimeout(() => navigator.clipboard?.writeText('').catch(() => {}), s * 1000);
  }

  const modal = $('#modal');
  function openModal(html, { wide = false, onMount } = {}) {
    if (modal.open) modal.close();
    modal.className = wide ? 'wide' : '';
    modal.innerHTML = html;
    modal.showModal();
    onMount?.(modal);
    const f = modal.querySelector('[autofocus]'); if (f) f.focus();
  }
  function closeModal() { if (modal.open) modal.close(); }
  modal.addEventListener('close', () => { if (modal.open) return; stopCamera(); modal.innerHTML = ''; });
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });

  function confirmBox({ title, text, ok = 'Confirmer', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      openModal(`<form class="dlg" method="dialog" data-form="confirm">
        <div class="dlg-head"><h2>${esc(title)}</h2></div>
        <p class="hint" style="font-size:15px">${esc(text)}</p>
        <div class="dlg-foot"><button class="btn" type="button" data-act="close">Annuler</button>
        <button class="btn ${danger ? 'danger solid' : 'primary'}" value="ok" autofocus>${esc(ok)}</button></div></form>`, {
        onMount: (m) => {
          const onClose = () => { if (modal.open) return; modal.removeEventListener('close', onClose); if (!done) { done = true; resolve(false); } };
          m.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done = true; modal.removeEventListener('close', onClose); closeModal(); resolve(true); }, { once: true });
          m.addEventListener('close', onClose);
        },
      });
    });
  }

  /* =========================================================
     Écran de verrouillage
     ========================================================= */
  const LOGO = '<svg class="lock-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg>';
  function showLock(message = '') {
    const exists = !!Store.read();
    $('#app').hidden = true;
    const L = $('#lock'); L.hidden = false;
    document.title = 'Kairos';
    L.innerHTML = `<div class="lock-card">
      ${LOGO}
      <div style="display:grid;gap:12px">
        <h1 class="lock-title">Kairos</h1>
        <p class="lock-sub">${exists
          ? 'Ta journée, tes accès et tes codes 2FA. Déverrouille pour continuer.'
          : 'Choisis ton mot de passe maître. Il chiffre tout ce que tu enregistres ici, et lui seul peut l’ouvrir.'}</p>
      </div>
      <form id="lockForm" class="lock-form" autocomplete="off" novalidate>
        <label class="field"><span>Mot de passe maître</span>
          <div class="input-group"><input type="password" id="mp" autocomplete="${exists ? 'current-password' : 'new-password'}" autofocus>
          <button class="icon-btn" type="button" data-act="peek" data-target="mp" aria-label="Afficher le mot de passe">${ic('eye')}</button></div>
        </label>
        ${exists ? '' : `<div><div class="meter" id="mpMeter"><span></span></div><div class="meter-row"><span id="mpLabel">12 caractères ou plus conseillés</span><span id="mpBits"></span></div></div>
          <label class="field"><span>Confirme-le</span><input type="password" id="mp2" autocomplete="new-password"></label>
          <p class="hint warn">Personne ne peut le récupérer si tu l’oublies, pas même toi. Note-le en lieu sûr.</p>`}
        <p class="form-error" id="lockErr" role="alert">${esc(message)}</p>
        <button class="btn primary lg block" type="submit" id="lockBtn">${exists ? 'Déverrouiller' : 'Créer mon coffre'}</button>
      </form>
      <div class="lock-foot"><span>Chiffré sur cet appareil, AES-256</span>
        ${exists ? '<button class="link-btn" type="button" data-act="forgot">Mot de passe oublié ?</button>' : '<button class="link-btn" type="button" data-act="importFromLock">Restaurer une sauvegarde</button>'}</div>
    </div>`;
    const mp = $('#mp');
    setTimeout(() => mp.focus(), 50);
    if (!exists) mp.addEventListener('input', () => {
      const s = strength(mp.value);
      $('#mpMeter').dataset.s = s.score; $('#mpLabel').textContent = s.label || '12 caractères ou plus conseillés';
      $('#mpBits').textContent = s.bits ? `≈ ${s.bits} bits` : '';
    });
    $('#lockForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#lockErr'), btn = $('#lockBtn'), pw = mp.value;
      err.textContent = '';
      if (!pw) { err.textContent = 'Entre ton mot de passe maître.'; return; }
      if (!exists) {
        if (pw.length < 8) { err.textContent = 'Utilise au moins 8 caractères, idéalement 12 ou plus.'; return; }
        if (pw !== $('#mp2').value) { err.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
      }
      btn.disabled = true; btn.textContent = exists ? 'Déchiffrement…' : 'Création du coffre…';
      try {
        if (exists) await unlock(pw); else await createVault(pw);
      } catch {
        btn.disabled = false; btn.textContent = exists ? 'Déverrouiller' : 'Créer mon coffre';
        err.textContent = exists ? 'Mot de passe incorrect. Réessaie.' : 'Création impossible dans ce navigateur.';
        $('.lock-card').classList.remove('shake'); void $('.lock-card').offsetWidth; $('.lock-card').classList.add('shake');
        mp.select();
      }
    });
  }
  async function unlock(pw) {
    const s = Store.read();
    const salt = unb64(s.salt);
    const key = await deriveKey(pw, salt, s.iter || ITER);
    const data = await decryptJSON(key, s.iv, s.ct);
    session = { key, salt, data: migrate(data) };
    enterApp();
  }
  async function createVault(pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pw, salt);
    session = { key, salt, data: seed() };
    await persist();
    enterApp();
    toast('Coffre créé. Tout est chiffré sur cet appareil.', 'ok');
  }
  async function lock() {
    if (!session.key) return;
    await persist();
    session = { key: null, salt: null, data: null };
    hmacKeys.clear(); codeCache.clear();
    closeModal(); if ($('#palette').open) $('#palette').close();
    showLock();
  }

  /* =========================================================
     Coque de l'app et navigation
     ========================================================= */
  const NAV = [
    ['today', 'Aujourd’hui'], ['tasks', 'Tâches'], ['habits', 'Habitudes'], ['notes', 'Notes'],
    ['vault', 'Coffre'], ['otp', 'Codes 2FA'], ['focus', 'Focus'], ['settings', 'Réglages'],
  ];
  function enterApp() {
    $('#lock').hidden = true; $('#lock').innerHTML = '';
    $('#app').hidden = false;
    lastActivity = Date.now();
    if (pendingFocus) { D().focus[pendingFocus.day] = (D().focus[pendingFocus.day] || 0) + pendingFocus.min; pendingFocus = null; save(); }
    route();
  }
  function renderNav() {
    const tk = dayKey();
    const openToday = D().tasks.filter((t) => !t.done && t.due && t.due <= tk).length;
    $('#nav').innerHTML = NAV.map(([id, label]) => {
      let badge = '';
      if (id === 'tasks' && openToday) badge = `<span class="badge">${openToday}</span>`;
      if (id === 'focus' && timer.running) badge = `<span class="badge live" id="navTimer">${fmtTimer(timerRemaining())}</span>`;
      return `<a href="#/${id}" ${state.view === id ? 'aria-current="page"' : ''}>${ic(id)}<span>${label}</span>${badge}</a>`;
    }).join('');
  }
  function route() {
    if (!session.key) return;
    const v = location.hash.replace(/^#\/?/, '') || 'today';
    state.view = VIEWS[v] ? v : 'today';
    render();
    $('#view').focus({ preventScroll: true });
    scrollTo(0, 0);
  }
  addEventListener('hashchange', route);
  function render() {
    if (!session.key) return;
    renderNav();
    $('#view').innerHTML = `<div class="page">${VIEWS[state.view]()}</div>`;
    AFTER[state.view]?.();
    tick();
  }
  const rerender = () => render();

  /* =========================================================
     Vue : Aujourd’hui
     ========================================================= */
  function todayTasks() {
    const tk = dayKey();
    return D().tasks.filter((t) => (!t.done && ((t.due && t.due <= tk) || (!t.due && t.top))) || (t.done && t.doneAt && dayKey(new Date(t.doneAt)) === tk && (t.due ? t.due <= tk : t.top)));
  }
  const taskSort = (a, b) => (a.done - b.done) || ((b.top ? 1 : 0) - (a.top ? 1 : 0)) || ((b.priority || 0) - (a.priority || 0)) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || (a.createdAt - b.createdAt);

  function ringSvg(p, size = 76, r = 32) {
    const c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
      <circle class="val" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/></svg>`;
  }

  const VIEWS = {};
  const AFTER = {};

  VIEWS.today = () => {
    const now = new Date(), tk = dayKey();
    const h = now.getHours();
    const greet = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
    const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const list = todayTasks().sort(taskSort);
    const done = list.filter((t) => t.done).length;
    const p = list.length ? done / list.length : 0;
    const favOtp = D().otp.filter((o) => o.fav).concat(D().otp.filter((o) => !o.fav)).slice(0, 4);
    const focusMin = D().focus[tk] || 0;
    const sessions = D().focusSessions[tk] || 0;
    return `
      <header class="page-head"><div>
        <p class="today-date">${esc(dateStr.charAt(0).toUpperCase() + dateStr.slice(1))}</p>
        <h1>${greet}.</h1>
        <p class="sub">${list.length ? (done === list.length ? 'Tout est fait pour aujourd’hui. Beau travail.' : `${plural(list.length - done, 'chose', 'choses')} à faire aujourd’hui.`) : 'Rien de prévu pour l’instant. Ajoute ce qui compte aujourd’hui.'}</p>
      </div></header>
      <div class="today-grid">
        <section class="panel" aria-labelledby="tdTasks">
          <div class="panel-head"><h2 id="tdTasks">Aujourd’hui</h2><a class="more-link" href="#/tasks">Toutes les tâches</a></div>
          <form class="add-row" data-form="quickTask">
            <input class="input grow" name="title" placeholder="Ajouter une tâche pour aujourd’hui, puis Entrée" autocomplete="off" aria-label="Nouvelle tâche">
            <button class="btn primary" type="submit">${ic('plus')}<span>Ajouter</span></button>
          </form>
          ${list.length ? `<ul class="task-list">${list.map(taskRow).join('')}</ul>` : '<div class="empty"><strong>Ta liste du jour est vide</strong><span>Une tâche marquée d’une étoile ou prévue aujourd’hui apparaît ici.</span></div>'}
        </section>
        <div class="today-side">
          <section class="panel">
            <div class="progress">${ringSvg(p)}<div><div class="progress-num">${done}<small> / ${list.length}</small></div><span class="hint">tâches terminées</span></div></div>
            <div class="stat-row">
              <div class="stat"><b>${focusMin}</b><span>min de focus</span></div>
              <div class="stat"><b>${sessions}</b><span>${sessions > 1 ? 'sessions' : 'session'}</span></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Habitudes</h2><a class="more-link" href="#/habits">Gérer</a></div>
            ${D().habits.length ? D().habits.map((hb) => `<div class="habit-mini" style="--hc:${esc(hb.color)}">
              <button class="check" role="checkbox" aria-checked="${!!hb.log[tk]}" data-act="habitDay" data-id="${hb.id}" data-day="${tk}" aria-label="${esc(hb.name)}">${ic('check')}</button>
              <span>${esc(hb.name)}</span><small>${streak(hb) ? `${streak(hb)} j d’affilée` : ''}</small></div>`).join('')
              : '<div class="empty" style="padding:12px 0"><span>Crée une habitude à suivre chaque jour.</span><a class="btn" href="#/habits">' + ic('plus') + 'Nouvelle habitude</a></div>'}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Codes 2FA</h2><a class="more-link" href="#/otp">Tous les codes</a></div>
            ${favOtp.length ? favOtp.map((o) => `<button class="otp-mini" data-otp="${o.id}" data-act="copyOtp" data-id="${o.id}" title="Copier le code">
              ${avatar(o.issuer, 'sm')}<div><strong>${esc(o.issuer)}</strong><span class="otp-rem"></span></div><span class="otp-digits">··· ···</span></button>`).join('')
              : `<div class="empty" style="padding:12px 0"><span>Ajoute tes codes ici pour ne plus ouvrir d’autre appli.</span><button class="btn" data-act="addOtp">${ic('plus')}Ajouter un code</button></div>`}
          </section>
        </div>
        <section class="panel journal" style="grid-column:1/-1">
          <div class="panel-head"><h2>Journal du jour</h2><span class="saved-hint" id="journalSaved"></span></div>
          <textarea data-journal="${tk}" placeholder="Une idée, un bilan, ce qui t’a marqué aujourd’hui…" aria-label="Journal du jour">${esc(D().journal[tk] || '')}</textarea>
        </section>
      </div>`;
  };

  /* =========================================================
     Vue : Tâches
     ========================================================= */
  function fmtDue(due) {
    const tk = dayKey(), tm = dayKey(addDays(new Date(), 1));
    if (due === tk) return ['Aujourd’hui', 'today'];
    if (due === tm) return ['Demain', ''];
    const s = new Date(`${due}T00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return due < tk ? [`En retard, ${s}`, 'late'] : [s, ''];
  }
  function taskRow(t) {
    let due = '';
    if (t.due) { const [l, c] = fmtDue(t.due); due = `<span class="tag ${t.done ? '' : c}">${esc(l)}</span>`; }
    const pr = t.priority === 3 ? '<span class="tag late">Urgent</span>' : t.priority === 2 ? '<span class="tag warn">Important</span>' : '';
    return `<li class="task ${t.done ? 'done' : ''} p${t.priority || 0}">
      <button class="check" role="checkbox" aria-checked="${!!t.done}" data-act="toggleTask" data-id="${t.id}" aria-label="Terminer : ${esc(t.title)}">${ic('check')}</button>
      <div class="task-main"><button class="task-title" data-act="editTask" data-id="${t.id}">${esc(t.title)}</button>
        <span class="task-meta">${pr}${due}${t.tag ? `<span class="tag">#${esc(t.tag)}</span>` : ''}</span></div>
      <button class="icon-btn ${t.top ? 'on' : ''}" data-act="topTask" data-id="${t.id}" aria-label="${t.top ? 'Retirer des priorités du jour' : 'Mettre en priorité aujourd’hui'}" title="Priorité du jour">${ic('star')}</button>
      <button class="icon-btn" data-act="delTask" data-id="${t.id}" aria-label="Supprimer">${ic('trash')}</button>
    </li>`;
  }
  VIEWS.tasks = () => {
    const tk = dayKey(); const T = D().tasks;
    const f = state.taskFilter;
    const counts = {
      today: T.filter((t) => !t.done && ((t.due && t.due <= tk) || (!t.due && t.top))).length,
      upcoming: T.filter((t) => !t.done && t.due && t.due > tk).length,
      all: T.filter((t) => !t.done).length,
      done: T.filter((t) => t.done).length,
    };
    let list;
    if (f === 'today') list = todayTasks();
    else if (f === 'upcoming') list = T.filter((t) => !t.done && t.due && t.due > tk);
    else if (f === 'done') list = T.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
    else list = T.filter((t) => !t.done);
    if (f !== 'done') list.sort(taskSort);
    const tags = [...new Set(T.map((t) => t.tag).filter(Boolean))];
    const labels = { today: 'Aujourd’hui', upcoming: 'À venir', all: 'À faire', done: 'Terminées' };
    const emptyMsg = { today: 'Rien pour aujourd’hui. Profite, ou avance sur la suite.', upcoming: 'Aucune tâche planifiée pour les prochains jours.', all: 'Aucune tâche en cours. Ajoute la première ci-dessus.', done: 'Les tâches terminées s’afficheront ici.' };

    let body;
    if (!list.length) body = `<div class="empty"><strong>${emptyMsg[f]}</strong></div>`;
    else if (f === 'upcoming') {
      const groups = {};
      for (const t of list) (groups[t.due] ||= []).push(t);
      body = Object.keys(groups).sort().map((d) => `<p class="section-label">${esc(new Date(`${d}T00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p><ul class="task-list">${groups[d].map(taskRow).join('')}</ul>`).join('');
    } else body = `<ul class="task-list">${list.map(taskRow).join('')}</ul>`;

    return `
      <header class="page-head"><div><h1>Tâches</h1><p class="sub">Étoile une tâche pour la mettre dans ta journée.</p></div>
        ${f === 'done' && counts.done ? '<div class="actions"><button class="btn" data-act="clearDone">Vider les terminées</button></div>' : ''}</header>
      <form class="add-row" data-form="addTask">
        <input class="input grow" name="title" placeholder="Nouvelle tâche" autocomplete="off" aria-label="Nouvelle tâche" required>
        <input class="input" type="date" name="due" value="${f === 'today' ? tk : ''}" aria-label="Échéance">
        <select class="input" name="priority" aria-label="Priorité"><option value="0">Normale</option><option value="2">Importante</option><option value="3">Urgente</option></select>
        <input class="input" name="tag" placeholder="#étiquette" list="tagList" style="width:140px" aria-label="Étiquette" autocomplete="off">
        <datalist id="tagList">${tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <button class="btn primary" type="submit">${ic('plus')}<span>Ajouter</span></button>
      </form>
      <div class="chips" style="margin-bottom:14px" role="tablist">
        ${Object.keys(labels).map((k) => `<button class="chip ${f === k ? 'on' : ''}" role="tab" aria-selected="${f === k}" data-act="taskFilter" data-f="${k}">${labels[k]} <span class="count">${counts[k]}</span></button>`).join('')}
      </div>
      <section class="panel">${body}</section>`;
  };
  function editTaskDialog(id) {
    const t = D().tasks.find((x) => x.id === id); if (!t) return;
    openModal(`<form class="dlg" data-form="editTask" data-id="${t.id}">
      <div class="dlg-head"><h2>Modifier la tâche</h2><button class="icon-btn" type="button" data-act="close" aria-label="Fermer">${ic('x')}</button></div>
      <label class="field"><span>Titre</span><input name="title" value="${esc(t.title)}" required autofocus></label>
      <div class="grid-2">
        <label class="field"><span>Échéance</span><input type="date" name="due" value="${esc(t.due || '')}"></label>
        <label class="field"><span>Priorité</span><select name="priority">
          ${[[0, 'Normale'], [2, 'Importante'], [3, 'Urgente']].map(([v, l]) => `<option value="${v}" ${(t.priority || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Étiquette</span><input name="tag" value="${esc(t.tag || '')}"></label>
      <label class="field"><span>Détails</span><textarea name="notes" placeholder="Liens, étapes, contexte…">${esc(t.notes || '')}</textarea></label>
      <div class="dlg-foot"><button class="btn danger" type="button" data-act="delTask" data-id="${t.id}">${ic('trash')}Supprimer</button><span class="spacer"></span>
        <button class="btn" type="button" data-act="close">Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`);
  }

  /* =========================================================
     Vue : Habitudes
     ========================================================= */
  const HABIT_COLORS = ['#2F45D8', '#17865A', '#C27A08', '#C93A31', '#8A3FD1', '#0E8BA8'];
  function streak(h) {
    let n = 0, d = new Date();
    if (!h.log[dayKey(d)]) d = addDays(d, -1);
    while (h.log[dayKey(d)]) { n++; d = addDays(d, -1); }
    return n;
  }
  const DAY_L = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  VIEWS.habits = () => {
    const tk = dayKey();
    const days = [...Array(7)].map((_, i) => addDays(new Date(), i - 6));
    const monthPrefix = tk.slice(0, 7);
    return `
      <header class="page-head"><div><h1>Habitudes</h1><p class="sub">Coche chaque jour. Tu peux rattraper les 7 derniers jours.</p></div></header>
      <form class="add-row" data-form="addHabit">
        <input class="input grow" name="name" placeholder="Nouvelle habitude, par ex. Lire 20 minutes" autocomplete="off" aria-label="Nouvelle habitude" required>
        <div class="swatches" role="group" aria-label="Couleur">${HABIT_COLORS.map((c) => `<button type="button" class="swatch" style="--sc:${c}" aria-pressed="${state.habitColor === c}" data-act="habitColor" data-c="${c}" aria-label="Couleur ${c}"></button>`).join('')}</div>
        <button class="btn primary" type="submit">${ic('plus')}<span>Ajouter</span></button>
      </form>
      ${D().habits.length ? `<div class="habit-list">${D().habits.map((h) => {
        const st = streak(h);
        const month = Object.keys(h.log).filter((k) => k.startsWith(monthPrefix) && h.log[k]).length;
        return `<article class="habit" style="--hc:${esc(h.color)}">
          <div><div class="habit-name"><span class="habit-dot"></span>${esc(h.name)}</div>
            <div class="habit-meta">${st ? `${st} jour${st > 1 ? 's' : ''} d’affilée` : 'Pas de série en cours'}, ${month} ce mois-ci</div></div>
          <div class="week">${days.map((d) => { const k = dayKey(d); return `<button class="day-cell ${h.log[k] ? 'on' : ''} ${k === tk ? 'today' : ''}" data-act="habitDay" data-id="${h.id}" data-day="${k}" aria-pressed="${!!h.log[k]}" aria-label="${esc(h.name)}, ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}">${DAY_L[d.getDay()]}<b>${d.getDate()}</b></button>`; }).join('')}
            <button class="icon-btn" data-act="delHabit" data-id="${h.id}" aria-label="Supprimer l’habitude">${ic('trash')}</button></div>
        </article>`;
      }).join('')}</div>` : '<section class="panel"><div class="empty"><strong>Aucune habitude pour l’instant</strong><span>Commence petit : une seule habitude tenue vaut mieux que cinq abandonnées.</span></div></section>'}`;
  };

  /* =========================================================
     Vue : Notes
     ========================================================= */
  const noteSort = (a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (b.updatedAt - a.updatedAt);
  function noteItems() {
    const q = norm(state.noteQuery);
    const list = D().notes.filter((n) => !q || norm(n.title + ' ' + n.body).includes(q)).sort(noteSort);
    if (!list.length) return `<li class="empty" style="padding:20px 8px"><span>${q ? 'Aucune note ne correspond.' : 'Aucune note.'}</span></li>`;
    return list.map((n) => `<li><button class="note-item" data-act="openNote" data-id="${n.id}" aria-current="${n.id === state.noteId}">
      <strong>${n.pinned ? ic('pin') : ''}<span data-title-of="${n.id}">${esc(n.title || 'Sans titre')}</span></strong>
      <span>${esc(timeAgo(n.updatedAt))}, ${esc((n.body || '').replace(/\s+/g, ' ').slice(0, 60) || 'vide')}</span></button></li>`).join('');
  }
  VIEWS.notes = () => {
    const n = D().notes.find((x) => x.id === state.noteId);
    return `
      <header class="page-head"><div><h1>Notes</h1><p class="sub">Enregistrées automatiquement, chiffrées comme le reste.</p></div>
        <div class="actions"><button class="btn primary" data-act="newNote">${ic('plus')}<span>Nouvelle note</span></button></div></header>
      <div class="notes-layout ${n ? 'editing' : ''}">
        <aside class="notes-list">
          <div class="input-wrap">${ic('search')}<input class="input" data-filter="notes" placeholder="Chercher dans les notes" value="${esc(state.noteQuery)}" aria-label="Chercher dans les notes"></div>
          <ul class="note-items" id="noteItems">${noteItems()}</ul>
        </aside>
        <section class="panel editor">${n ? `
          <button class="btn ghost back-btn" data-act="closeNote" style="justify-self:start;margin:-8px 0 8px -8px">${ic('back')}Notes</button>
          <input class="editor-title" data-note-field="title" value="${esc(n.title)}" placeholder="Titre" aria-label="Titre de la note">
          <textarea class="editor-body" data-note-field="body" placeholder="Écris ici…" aria-label="Contenu de la note">${esc(n.body)}</textarea>
          <div class="editor-foot"><span class="hint" id="noteSaved">Modifiée ${esc(timeAgo(n.updatedAt))}</span>
            <div style="display:flex;gap:4px"><button class="icon-btn ${n.pinned ? 'on' : ''}" data-act="pinNote" data-id="${n.id}" aria-label="${n.pinned ? 'Désépingler' : 'Épingler'}" title="Épingler">${ic('pin')}</button>
            <button class="icon-btn" data-act="copyNote" data-id="${n.id}" aria-label="Copier le texte" title="Copier le texte">${ic('copy')}</button>
            <button class="icon-btn" data-act="delNote" data-id="${n.id}" aria-label="Supprimer la note" title="Supprimer">${ic('trash')}</button></div></div>`
          : '<div class="empty" style="margin:auto"><strong>Choisis une note ou crée-en une</strong><span>Astuce : Ctrl + K retrouve n’importe quelle note en deux lettres.</span></div>'}
        </section>
      </div>`;
  };
  AFTER.notes = () => {
    const n = D().notes.find((x) => x.id === state.noteId);
    if (n && !n.title && !n.body) $('.editor-title')?.focus();
  };

  /* =========================================================
     Vue : Coffre (mots de passe)
     ========================================================= */
  function vaultHealth() {
    const counts = {};
    for (const v of D().vault) if (v.password) counts[v.password] = (counts[v.password] || 0) + 1;
    const weak = new Set(D().vault.filter((v) => v.password && strength(v.password).score <= 1).map((v) => v.id));
    const reused = new Set(D().vault.filter((v) => v.password && counts[v.password] > 1).map((v) => v.id));
    return { weak, reused };
  }
  const hostOf = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u; } };
  const urlOf = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
  function vaultList() {
    const q = norm(state.vaultQuery); const f = state.vaultFilter;
    const { weak, reused } = vaultHealth();
    let list = D().vault.filter((v) => !q || norm(`${v.name} ${v.username} ${v.url} ${v.category}`).includes(q));
    if (f === 'fav') list = list.filter((v) => v.fav);
    else if (f === 'risk') list = list.filter((v) => weak.has(v.id) || reused.has(v.id));
    else if (f.startsWith('cat:')) list = list.filter((v) => (v.category || '') === f.slice(4));
    list.sort((a, b) => ((b.fav ? 1 : 0) - (a.fav ? 1 : 0)) || a.name.localeCompare(b.name, 'fr'));
    if (!list.length) return `<div class="panel"><div class="empty"><strong>${D().vault.length ? 'Aucun identifiant ne correspond' : 'Ton coffre est vide'}</strong>
      <span>${D().vault.length ? 'Essaie un autre mot ou retire le filtre.' : 'Ajoute ton premier site : il ne te restera qu’un seul mot de passe à retenir.'}</span>
      ${D().vault.length ? '' : `<button class="btn primary" data-act="addCred">${ic('plus')}Ajouter un identifiant</button>`}</div></div>`;
    return `<ul class="cred-list">${list.map((v) => {
      const risk = weak.has(v.id) ? '<span class="tag late">Faible</span>' : reused.has(v.id) ? '<span class="tag warn">Réutilisé</span>' : '';
      const otp = v.otpId && D().otp.find((o) => o.id === v.otpId);
      return `<li class="cred">
        <button class="cred-open" data-act="editCred" data-id="${v.id}">${avatar(v.name)}
          <span class="cred-text"><strong>${esc(v.name)}${v.fav ? `<span style="color:var(--amber);display:flex">${ic('star', 'fill')}</span>` : ''}${risk}</strong><span>${esc(v.username || hostOf(v.url) || 'Sans identifiant')}</span></span></button>
        ${otp ? `<button class="cred-otp" data-otp="${otp.id}" data-act="copyOtp" data-id="${otp.id}" title="Copier le code 2FA"><span class="otp-digits">··· ···</span></button>` : ''}
        <div class="row-actions">
          ${v.username ? `<button class="icon-btn hide-sm" data-act="copyUser" data-id="${v.id}" aria-label="Copier l’identifiant" title="Copier l’identifiant">${ic('user')}</button>` : ''}
          <button class="icon-btn" data-act="copyPw" data-id="${v.id}" aria-label="Copier le mot de passe" title="Copier le mot de passe">${ic('key')}</button>
          ${v.url ? `<button class="icon-btn" data-act="openSite" data-id="${v.id}" aria-label="Ouvrir le site" title="Copier le mot de passe et ouvrir le site">${ic('external')}</button>` : ''}
        </div></li>`;
    }).join('')}</ul>`;
  }
  VIEWS.vault = () => {
    const { weak, reused } = vaultHealth();
    const risk = new Set([...weak, ...reused]).size;
    const cats = [...new Set(D().vault.map((v) => v.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const f = state.vaultFilter;
    return `
      <header class="page-head"><div><h1>Coffre</h1><p class="sub">${plural(D().vault.length, 'identifiant', 'identifiants')}, un seul mot de passe à retenir.</p></div>
        <div class="actions"><button class="btn" data-act="generator">${ic('dice')}<span>Générateur</span></button>
        <button class="btn primary" data-act="addCred">${ic('plus')}<span>Ajouter</span></button></div></header>
      ${risk ? `<div class="health">${ic('warn')}<span>${[weak.size ? plural(weak.size, 'mot de passe faible', 'mots de passe faibles') : '', reused.size ? plural(reused.size, 'mot de passe réutilisé', 'mots de passe réutilisés') : ''].filter(Boolean).join(' et ')}</span>
        <button class="btn" data-act="vaultFilter" data-f="${f === 'risk' ? 'all' : 'risk'}">${f === 'risk' ? 'Tout afficher' : 'Voir lesquels'}</button></div>` : ''}
      <div class="toolbar">
        <div class="input-wrap">${ic('search')}<input class="input" data-filter="vault" placeholder="Chercher un site, un identifiant…" value="${esc(state.vaultQuery)}" aria-label="Chercher dans le coffre"></div>
        <div class="chips">
          <button class="chip ${f === 'all' ? 'on' : ''}" data-act="vaultFilter" data-f="all">Tous</button>
          <button class="chip ${f === 'fav' ? 'on' : ''}" data-act="vaultFilter" data-f="fav">Favoris</button>
          ${cats.map((c) => `<button class="chip ${f === `cat:${c}` ? 'on' : ''}" data-act="vaultFilter" data-f="cat:${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
      </div>
      <div id="vaultList">${vaultList()}</div>`;
  };

  function genPanelHtml(withUse) {
    const pw = generate(genPrefs); const s = strength(pw);
    return `<div class="gen-panel" id="genPanel">
      <div class="gen-out"><output id="genOut" data-pw="${esc(pw)}">${colorPw(pw)}</output>
        <button class="icon-btn" type="button" data-act="genRefresh" aria-label="Générer un autre" title="Générer un autre">${ic('refresh')}</button>
        <button class="icon-btn" type="button" data-act="genCopy" aria-label="Copier" title="Copier">${ic('copy')}</button></div>
      <div><div class="meter" id="genMeter" data-s="${s.score}"><span></span></div><div class="meter-row"><span id="genLabel">${s.label}</span><span id="genBits">≈ ${s.bits} bits</span></div></div>
      <div class="range-row"><span class="hint">Longueur</span><input type="range" min="8" max="64" value="${genPrefs.length}" data-gen="length" aria-label="Longueur"><b id="genLen">${genPrefs.length}</b></div>
      <div class="toggles">
        ${[['upper', 'Majuscules'], ['lower', 'Minuscules'], ['digits', 'Chiffres'], ['symbols', 'Symboles']].map(([k, l]) => `<label class="toggle"><input type="checkbox" data-gen="${k}" ${genPrefs[k] ? 'checked' : ''}>${l}</label>`).join('')}
      </div>
      ${withUse ? `<button class="btn primary" type="button" data-act="genUse">${ic('check')}Utiliser ce mot de passe</button>` : ''}
    </div>`;
  }
  function refreshGen() {
    const out = $('#genOut'); if (!out) return;
    const pw = generate(genPrefs); const s = strength(pw);
    out.dataset.pw = pw; out.innerHTML = colorPw(pw);
    $('#genMeter').dataset.s = s.score; $('#genLabel').textContent = s.label; $('#genBits').textContent = `≈ ${s.bits} bits`;
    $('#genLen').textContent = genPrefs.length;
  }
  function credDialog(id) {
    const v = id ? D().vault.find((x) => x.id === id) : null;
    const cats = [...new Set(D().vault.map((x) => x.category).filter(Boolean))];
    const s = strength(v?.password || '');
    openModal(`<form class="dlg" data-form="cred" data-id="${v?.id || ''}" autocomplete="off">
      <div class="dlg-head"><h2>${v ? esc(v.name) : 'Nouvel identifiant'}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Fermer">${ic('x')}</button></div>
      <div class="grid-2">
        <label class="field"><span>Nom</span><input name="name" value="${esc(v?.name || '')}" placeholder="GitHub" required ${v ? '' : 'autofocus'}></label>
        <label class="field"><span>Adresse du site</span><input name="url" value="${esc(v?.url || '')}" placeholder="github.com" inputmode="url"></label>
      </div>
      <label class="field"><span>Identifiant ou e-mail</span><div class="input-group"><input name="username" value="${esc(v?.username || '')}" autocomplete="off">
        ${v?.username ? `<button class="icon-btn" type="button" data-act="copyField" data-field="username" aria-label="Copier l’identifiant">${ic('copy')}</button>` : ''}</div></label>
      <label class="field"><span>Mot de passe</span><div class="input-group">
        <input name="password" id="credPw" type="password" value="${esc(v?.password || '')}" class="mono" autocomplete="new-password" data-strength="credMeter">
        <button class="icon-btn" type="button" data-act="peek" data-target="credPw" aria-label="Afficher">${ic('eye')}</button>
        <button class="icon-btn" type="button" data-act="copyField" data-field="password" aria-label="Copier le mot de passe">${ic('copy')}</button>
        <button class="icon-btn" type="button" data-act="toggleGen" aria-label="Générer un mot de passe" title="Générer">${ic('dice')}</button></div>
        <div><div class="meter" id="credMeter" data-s="${s.score}"><span></span></div><div class="meter-row"><span id="credMeterLabel">${s.label}</span></div></div>
      </label>
      <div id="genSlot"></div>
      <div class="grid-2">
        <label class="field"><span>Catégorie</span><input name="category" value="${esc(v?.category || '')}" list="catList" placeholder="Travail, Perso, Banque…">
          <datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Code 2FA lié</span><select name="otpId"><option value="">Aucun</option>
          ${D().otp.map((o) => `<option value="${o.id}" ${v?.otpId === o.id ? 'selected' : ''}>${esc(o.issuer)}${o.account ? ` (${esc(o.account)})` : ''}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes" placeholder="Questions de sécurité, codes de secours…">${esc(v?.notes || '')}</textarea></label>
      <label class="toggle" style="border:0;padding:0"><input type="checkbox" name="fav" ${v?.fav ? 'checked' : ''}>Mettre en favori</label>
      <div class="dlg-foot">${v ? `<button class="btn danger" type="button" data-act="delCred" data-id="${v.id}">${ic('trash')}Supprimer</button>` : ''}<span class="spacer"></span>
        <button class="btn" type="button" data-act="close">Annuler</button><button class="btn primary">${v ? 'Enregistrer' : 'Ajouter au coffre'}</button></div>
    </form>`, { wide: true });
  }

  /* =========================================================
     Vue : Codes 2FA
     ========================================================= */
  VIEWS.otp = () => {
    const q = norm(state.otpQuery);
    const list = D().otp.filter((o) => !q || norm(`${o.issuer} ${o.account}`).includes(q))
      .sort((a, b) => ((b.fav ? 1 : 0) - (a.fav ? 1 : 0)) || a.issuer.localeCompare(b.issuer, 'fr'));
    return `
      <header class="page-head"><div><h1>Codes 2FA</h1><p class="sub">Clique sur un code pour le copier. Ils se renouvellent toutes les 30 secondes.</p></div>
        <div class="actions"><button class="btn primary" data-act="addOtp">${ic('plus')}<span>Ajouter un code</span></button></div></header>
      ${D().otp.length > 3 ? `<div class="toolbar"><div class="input-wrap">${ic('search')}<input class="input" data-filter="otp" placeholder="Chercher un service" value="${esc(state.otpQuery)}" aria-label="Chercher un code"></div></div>` : ''}
      ${list.length ? `<div class="otp-grid">${list.map((o) => `
        <article class="otp-tile" data-otp="${o.id}">
          <header>${avatar(o.issuer)}<div><strong>${esc(o.issuer)}</strong><span>${esc(o.account || ' ')}</span></div>
            <button class="icon-btn ${o.fav ? 'on' : ''}" data-act="favOtp" data-id="${o.id}" aria-label="${o.fav ? 'Retirer de l’accueil' : 'Afficher sur l’accueil'}" title="Afficher sur Aujourd’hui">${ic('star')}</button>
            <button class="icon-btn" data-act="editOtp" data-id="${o.id}" aria-label="Modifier">${ic('edit')}</button></header>
          <button class="otp-code" data-act="copyOtp" data-id="${o.id}" aria-label="Copier le code ${esc(o.issuer)}"><span class="otp-digits">··· ···</span><span class="copy-hint">Copier</span></button>
          <div class="otp-bar"><span></span></div>
          <div class="otp-foot"><span class="otp-rem"></span><span class="otp-next"></span></div>
        </article>`).join('')}</div>`
        : `<section class="panel"><div class="empty"><strong>${D().otp.length ? 'Aucun code ne correspond' : 'Plus besoin d’ouvrir Google Authenticator'}</strong>
          <span>${D().otp.length ? 'Essaie un autre nom.' : 'Scanne le QR code d’un site, ou importe tous tes comptes Google Authenticator d’un coup avec son export.'}</span>
          ${D().otp.length ? '' : `<button class="btn primary" data-act="addOtp">${ic('qr')}Ajouter mon premier code</button>`}</div></section>`}`;
  };

  let camStream = null, camRaf = 0;
  function stopCamera() {
    cancelAnimationFrame(camRaf); camRaf = 0;
    if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  }
  function otpDialog(id) {
    const o = id ? D().otp.find((x) => x.id === id) : null;
    openModal(`<form class="dlg" data-form="otp" data-id="${o?.id || ''}" autocomplete="off">
      <div class="dlg-head"><h2>${o ? 'Modifier le code' : 'Ajouter un code 2FA'}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Fermer">${ic('x')}</button></div>
      ${o ? '' : `<div class="source-row">
        <button type="button" class="source-btn" data-act="scanCam">${ic('camera')}Scanner avec la caméra<span>Le QR code affiché par le site, ou l’export Google Authenticator</span></button>
        <button type="button" class="source-btn" data-act="scanFile">${ic('image')}Importer une image<span>Une capture du QR code. Tu peux aussi la coller avec Ctrl + V</span></button>
      </div>
      <input type="file" accept="image/*" id="qrFile" hidden>
      <div id="scanArea"></div>
      <p class="hint" style="text-align:center">ou saisis la clé fournie par le site</p>`}
      <div class="grid-2">
        <label class="field"><span>Service</span><input name="issuer" value="${esc(o?.issuer || '')}" placeholder="Google, GitHub, Binance…" required></label>
        <label class="field"><span>Compte</span><input name="account" value="${esc(o?.account || '')}" placeholder="toi@exemple.com"></label>
      </div>
      <label class="field"><span>Clé secrète ou lien otpauth://</span><div class="input-group">
        <input name="secret" id="otpSecret" type="${o ? 'password' : 'text'}" class="mono" value="${esc(o?.secret || '')}" placeholder="JBSW Y3DP EHPK 3PXP" spellcheck="false" required>
        ${o ? `<button class="icon-btn" type="button" data-act="peek" data-target="otpSecret" aria-label="Afficher la clé">${ic('eye')}</button>` : ''}</div></label>
      <details class="adv"><summary>Options avancées</summary>
        <div class="grid-3">
          <label class="field"><span>Chiffres</span><select name="digits">${[6, 7, 8].map((d) => `<option ${((o?.digits || 6) === d) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="field"><span>Période (s)</span><select name="period">${[30, 60].map((d) => `<option ${((o?.period || 30) === d) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="field"><span>Algorithme</span><select name="algorithm">${['SHA-1', 'SHA-256', 'SHA-512'].map((a) => `<option ${((o?.algorithm || 'SHA-1') === a) ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        </div></details>
      <div id="otpPreview" aria-live="polite"></div>
      <p class="form-error" id="otpErr" role="alert"></p>
      <div class="dlg-foot">${o ? `<button class="btn danger" type="button" data-act="delOtp" data-id="${o.id}">${ic('trash')}Supprimer</button>` : ''}<span class="spacer"></span>
        <button class="btn" type="button" data-act="close">Annuler</button><button class="btn primary">${o ? 'Enregistrer' : 'Ajouter'}</button></div>
    </form>`, {
      wide: true,
      onMount: (m) => {
        const form = m.querySelector('form');
        form.addEventListener('input', (e) => { if (['secret', 'digits', 'period', 'algorithm'].includes(e.target.name)) previewOtp(form); });
        form.addEventListener('change', (e) => { if (['digits', 'period', 'algorithm'].includes(e.target.name)) previewOtp(form); });
        $('#qrFile', m)?.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) decodeImageFile(f); e.target.value = ''; });
        m.addEventListener('paste', (e) => {
          const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
          if (item) { e.preventDefault(); decodeImageFile(item.getAsFile()); }
        });
        if (o) previewOtp(form);
      },
    });
  }
  function setSelect(sel, val) {
    val = String(val);
    if (![...sel.options].some((o) => o.value === val)) sel.add(new Option(val, val));
    sel.value = val;
  }
  let previewSeq = 0;
  async function previewOtp(form) {
    const seq = ++previewSeq;
    const box = $('#otpPreview'); const err = $('#otpErr');
    let secret = form.secret.value.trim();
    err.textContent = '';
    if (/^otpauth:/i.test(secret)) {
      try {
        const p = parseOtpauth(secret);
        form.issuer.value = form.issuer.value || p.issuer; form.account.value = form.account.value || p.account;
        form.secret.value = secret = p.secret; setSelect(form.digits, p.digits); setSelect(form.period, p.period); setSelect(form.algorithm, p.algorithm);
      } catch (e) { box.innerHTML = ''; err.textContent = e.message; return; }
    }
    if (!secret) { box.innerHTML = ''; return; }
    try {
      const o = { id: 'preview', secret: secret.replace(/\s/g, '').toUpperCase(), digits: +form.digits.value, period: +form.period.value, algorithm: form.algorithm.value };
      if (base32Decode(o.secret).length < 5) throw new Error('Clé trop courte');
      const code = await totp(o);
      if (seq !== previewSeq) return;
      box.innerHTML = `<div class="preview-code"><span>Code actuel. Vérifie qu’il correspond à celui demandé par le site.</span><b>${fmtCode(code)}</b></div>`;
    } catch (e) {
      if (seq !== previewSeq) return;
      box.innerHTML = ''; err.textContent = e.message === 'Clé trop courte' ? 'Cette clé semble trop courte.' : e.message;
    }
  }
  function handleQrText(text) {
    stopCamera(); $('#scanArea') && ($('#scanArea').innerHTML = '');
    if (/^otpauth-migration:/i.test(text)) {
      try {
        const { items, skipped } = parseMigration(text);
        const known = new Set(D().otp.map((o) => o.secret));
        const fresh = items.filter((i) => !known.has(i.secret));
        for (const i of fresh) D().otp.push({ id: uid(), ...i, createdAt: Date.now() });
        save(); closeModal(); render();
        toast(`${plural(fresh.length, 'compte importé', 'comptes importés')} depuis Google Authenticator${items.length - fresh.length ? `, ${items.length - fresh.length} déjà présent(s)` : ''}${skipped ? `, ${skipped} HOTP ignoré(s)` : ''}`, 'ok');
      } catch { toast('Export Google Authenticator illisible. Réessaie le scan.', 'error'); }
      return;
    }
    if (/^otpauth:/i.test(text)) {
      const form = $('form[data-form="otp"]'); if (!form) return;
      form.secret.value = text; form.issuer.value = ''; form.account.value = '';
      previewOtp(form);
      toast('QR code lu. Vérifie puis ajoute.', 'ok');
      return;
    }
    toast('Ce QR code ne contient pas de code 2FA.', 'error');
  }
  function decodeFromCanvas(ctx, w, h) {
    if (typeof jsQR !== 'function') return null;
    const img = ctx.getImageData(0, 0, w, h);
    const r = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    return r?.data || null;
  }
  async function decodeImageFile(file) {
    if (typeof jsQR !== 'function') { toast('Lecteur de QR indisponible : vérifie ta connexion puis recharge la page.', 'error'); return; }
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
      const text = decodeFromCanvas(ctx, w, h);
      if (text) handleQrText(text); else toast('Aucun QR code trouvé dans cette image. Recadre-la au plus près.', 'error');
    } catch { toast('Image illisible.', 'error'); }
  }
  async function startCamera() {
    if (typeof jsQR !== 'function') { toast('Lecteur de QR indisponible : vérifie ta connexion puis recharge la page.', 'error'); return; }
    const area = $('#scanArea');
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch { toast('Accès à la caméra refusé ou indisponible. Importe plutôt une capture.', 'error'); return; }
    area.innerHTML = `<div class="scanner"><video playsinline muted></video></div><button class="btn ghost block" type="button" data-act="stopCam" style="margin-top:8px">Arrêter la caméra</button>`;
    const video = $('video', area); video.srcObject = camStream; await video.play().catch(() => {});
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d', { willReadFrequently: true });
    let last = 0;
    const loop = (t) => {
      if (!camStream) return;
      if (t - last > 180 && video.videoWidth) {
        last = t;
        const scale = Math.min(1, 800 / video.videoWidth);
        cv.width = Math.round(video.videoWidth * scale); cv.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, cv.width, cv.height);
        const text = decodeFromCanvas(ctx, cv.width, cv.height);
        if (text) { handleQrText(text); return; }
      }
      camRaf = requestAnimationFrame(loop);
    };
    camRaf = requestAnimationFrame(loop);
  }

  /* =========================================================
     Vue : Focus (minuteur Pomodoro)
     ========================================================= */
  const timer = { mode: 'focus', durations: { focus: 25, short: 5, long: 15 }, running: false, endAt: 0, remaining: 25 * 60000, cycle: 0, taskId: '' };
  let pendingFocus = null;
  const MODE_L = { focus: 'Focus', short: 'Pause courte', long: 'Pause longue' };
  const timerRemaining = () => (timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remaining);
  const fmtTimer = (ms) => { const s = Math.ceil(ms / 1000); return `${z(Math.floor(s / 60))}:${z(s % 60)}`; };
  function setMode(m) { timer.mode = m; timer.running = false; timer.remaining = timer.durations[m] * 60000; }
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22, 0.44].forEach((d, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = [660, 880, 990][i]; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, ac.currentTime + d); g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.2);
        o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.22);
      });
    } catch { /* rien */ }
  }
  function finishTimer() {
    timer.running = false; beep();
    const wasFocus = timer.mode === 'focus';
    if (wasFocus) {
      const min = timer.durations.focus, day = dayKey();
      if (session.key) { D().focus[day] = (D().focus[day] || 0) + min; D().focusSessions[day] = (D().focusSessions[day] || 0) + 1; save(); }
      else pendingFocus = { day, min: (pendingFocus?.min || 0) + min };
      timer.cycle++;
      setMode(timer.cycle % 4 === 0 ? 'long' : 'short');
    } else setMode('focus');
    const msg = wasFocus ? 'Session terminée. Prends une pause.' : 'Pause terminée. On s’y remet ?';
    try { if (Notification.permission === 'granted' && document.hidden) new Notification('Kairos', { body: msg, icon: 'icon-192.png' }); } catch { /* rien */ }
    toast(msg, 'ok');
    if (session.key && state.view === 'focus') render(); else if (session.key) renderNav();
  }
  function updateTimer() {
    if (timer.running && Date.now() >= timer.endAt) { finishTimer(); return; }
    const rem = timerRemaining();
    const navT = $('#navTimer'); if (navT) navT.textContent = fmtTimer(rem);
    if (timer.running) document.title = `${fmtTimer(rem)} ${MODE_L[timer.mode]}, Kairos`;
    else if (document.title !== 'Kairos') document.title = 'Kairos';
    if (state.view !== 'focus') return;
    const t = $('#focusTime'); if (t) t.textContent = fmtTimer(rem);
    const ring = $('#focusVal'); if (ring) { const c = +ring.dataset.c; ring.style.strokeDashoffset = c * (1 - rem / (timer.durations[timer.mode] * 60000)); }
  }
  VIEWS.focus = () => {
    const rem = timerRemaining(); const total = timer.durations[timer.mode] * 60000;
    const r = 120, c = 2 * Math.PI * r; const tk = dayKey();
    const days = [...Array(7)].map((_, i) => addDays(new Date(), i - 6));
    const max = Math.max(25, ...days.map((d) => D().focus[dayKey(d)] || 0));
    const open = D().tasks.filter((t) => !t.done).sort(taskSort).slice(0, 30);
    const week = days.reduce((s, d) => s + (D().focus[dayKey(d)] || 0), 0);
    return `
      <header class="page-head"><div><h1>Focus</h1><p class="sub">${timer.durations.focus} minutes de travail, puis une pause. Une longue pause toutes les quatre sessions.</p></div></header>
      <div class="focus-wrap">
        <section class="panel focus-main">
          <div class="segmented" role="group" aria-label="Mode">${Object.keys(MODE_L).map((m) => `<button aria-pressed="${timer.mode === m}" data-act="focusMode" data-m="${m}">${MODE_L[m]}</button>`).join('')}</div>
          <div class="focus-ring ${timer.mode}">
            <svg viewBox="0 0 260 260" aria-hidden="true"><circle class="track" cx="130" cy="130" r="${r}"/><circle class="val" id="focusVal" data-c="${c}" cx="130" cy="130" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - rem / total)}"/></svg>
            <div class="focus-time"><b id="focusTime" role="timer">${fmtTimer(rem)}</b><span>${timer.running ? MODE_L[timer.mode] + ' en cours' : 'Prêt'}</span></div>
          </div>
          <div class="focus-controls">
            <button class="icon-btn" data-act="focusReset" aria-label="Réinitialiser" title="Réinitialiser">${ic('reset')}</button>
            <button class="btn primary" data-act="focusToggle">${timer.running ? ic('pause') + 'Pause' : ic('play') + (rem < total ? 'Reprendre' : 'Démarrer')}</button>
            <button class="icon-btn" data-act="focusSkip" aria-label="Passer à la suite" title="Passer">${ic('skip')}</button>
          </div>
          <label class="field" style="width:min(380px,100%)"><span>Sur quoi tu travailles ?</span>
            <select class="input" data-focus-task><option value="">Choisir une tâche (facultatif)</option>
            ${open.map((t) => `<option value="${t.id}" ${timer.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label>
        </section>
        <div class="today-side">
          <section class="panel"><div class="stat-row" style="margin:0">
            <div class="stat"><b>${D().focus[tk] || 0}</b><span>min aujourd’hui</span></div>
            <div class="stat"><b>${Math.round(week / 6) / 10} h</b><span>sur 7 jours</span></div></div>
            <div class="bars" aria-label="Minutes de focus sur 7 jours">${days.map((d) => { const v = D().focus[dayKey(d)] || 0; return `<div class="${dayKey(d) === tk ? 'today' : ''}" title="${v} min"><i style="height:${Math.max(4, (v / max) * 100)}%"></i><span>${DAY_L[d.getDay()]}</span></div>`; }).join('')}</div>
          </section>
          <section class="panel"><h2 style="margin-bottom:12px">Durées</h2>
            <div class="grid-3">${Object.keys(MODE_L).map((m) => `<label class="field"><span>${MODE_L[m]}</span><input class="input" type="number" min="1" max="120" value="${timer.durations[m]}" data-duration="${m}"></label>`).join('')}</div>
          </section>
        </div>
      </div>`;
  };

  /* =========================================================
     Vue : Réglages
     ========================================================= */
  let installEvt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (state.view === 'settings' && session.key) render(); });
  VIEWS.settings = () => `
    <header class="page-head"><div><h1>Réglages</h1><p class="sub">Version ${VERSION}. Tes données ne quittent jamais cet appareil.</p></div></header>
    <div class="settings">
      <section class="panel"><h2 style="margin-bottom:14px">Apparence</h2>
        <div class="set-row"><div><strong>Thème</strong><p>Suit Windows par défaut.</p></div>
          <div class="segmented">${[['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button aria-pressed="${prefs.theme === k}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div></div>
      </section>
      <section class="panel"><h2 style="margin-bottom:14px">Sécurité</h2>
        <div class="set-row"><div><strong>Verrouillage automatique</strong><p>Après une période sans activité.</p></div>
          <select class="input" data-pref="autolock">${[[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 heure'], [0, 'Jamais']].map(([v, l]) => `<option value="${v}" ${+prefs.autolock === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="set-row"><div><strong>Effacer le presse-papiers</strong><p>Après la copie d’un mot de passe ou d’un code.</p></div>
          <select class="input" data-pref="clipClear">${[[15, '15 secondes'], [30, '30 secondes'], [60, '1 minute'], [0, 'Jamais']].map(([v, l]) => `<option value="${v}" ${+prefs.clipClear === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="set-row"><div><strong>Mot de passe maître</strong><p>Rechiffre tout le coffre avec un nouveau mot de passe.</p></div>
          <button class="btn" data-act="changeMaster">Changer</button></div>
      </section>
      <section class="panel"><h2 style="margin-bottom:14px">Sauvegarde</h2>
        <div class="set-row"><div><strong>Télécharger une sauvegarde</strong><p>Fichier chiffré, lisible uniquement avec ton mot de passe maître actuel.</p></div>
          <button class="btn" data-act="exportBackup">${ic('download')}Télécharger</button></div>
        <div class="set-row"><div><strong>Restaurer une sauvegarde</strong><p>Remplace les données actuelles.</p></div>
          <button class="btn" data-act="importBackup">${ic('upload')}Restaurer</button></div>
      </section>
      <section class="panel"><h2 style="margin-bottom:14px">Application</h2>
        <div class="set-row"><div><strong>Installer sur cet ordinateur</strong><p>${installEvt ? 'Ouvre Kairos dans sa propre fenêtre, depuis le menu Démarrer.' : 'Dans Chrome ou Edge : icône d’installation dans la barre d’adresse, ou menu ⋮ puis Installer Kairos.'}</p></div>
          ${installEvt ? `<button class="btn primary" data-act="install">${ic('download')}Installer</button>` : ''}</div>
        <div class="set-row"><div><strong>Notifications du minuteur</strong><p>Te prévient à la fin d’une session, même dans une autre fenêtre.</p></div>
          <button class="btn" data-act="notif">${'Notification' in window && Notification.permission === 'granted' ? 'Activées' : 'Activer'}</button></div>
        <div class="set-row" style="display:block"><strong>Raccourcis clavier</strong>
          <div class="shortcuts" style="margin-top:12px"><span><kbd>Ctrl</kbd> <kbd>K</kbd></span><span>Chercher partout et copier en un geste</span>
          <span><kbd>Ctrl</kbd> <kbd>Maj</kbd> <kbd>L</kbd></span><span>Verrouiller</span>
          <span><kbd>/</kbd></span><span>Aller au champ de recherche de la page</span>
          <span><kbd>Alt</kbd> <kbd>1</kbd>…<kbd>8</kbd></span><span>Changer de section</span></div></div>
      </section>
      <section class="panel danger-zone"><h2 style="margin-bottom:14px">Zone sensible</h2>
        <div class="set-row"><div><strong>Tout effacer</strong><p>Supprime définitivement le coffre de cet appareil.</p></div>
          <button class="btn danger" data-act="wipe">${ic('trash')}Tout effacer</button></div>
      </section>
    </div>`;

  function changeMasterDialog() {
    openModal(`<form class="dlg" data-form="changeMaster" autocomplete="off">
      <div class="dlg-head"><h2>Changer le mot de passe maître</h2><button class="icon-btn" type="button" data-act="close" aria-label="Fermer">${ic('x')}</button></div>
      <label class="field"><span>Mot de passe actuel</span><input type="password" name="current" autocomplete="current-password" autofocus required></label>
      <label class="field"><span>Nouveau mot de passe</span><input type="password" name="next" autocomplete="new-password" data-strength="cmMeter" required minlength="8"></label>
      <div><div class="meter" id="cmMeter"><span></span></div><div class="meter-row"><span id="cmMeterLabel"></span></div></div>
      <label class="field"><span>Confirme le nouveau</span><input type="password" name="confirm" autocomplete="new-password" required></label>
      <p class="form-error" id="cmErr" role="alert"></p>
      <div class="dlg-foot"><button class="btn" type="button" data-act="close">Annuler</button><button class="btn primary">Changer</button></div></form>`);
  }
  function exportBackup() {
    persist().then(() => {
      const raw = localStorage.getItem(STORE_KEY);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      a.download = `kairos-sauvegarde-${dayKey()}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Sauvegarde chiffrée téléchargée', 'ok');
    });
  }
  function pickBackupFile(fromLock = false) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      let blob;
      try { blob = JSON.parse(await f.text()); if (!blob.salt || !blob.iv || !blob.ct) throw 0; }
      catch { toast('Ce fichier n’est pas une sauvegarde Kairos.', 'error'); return; }
      openModal(`<form class="dlg" data-form="restore" autocomplete="off">
        <div class="dlg-head"><h2>Restaurer la sauvegarde</h2><button class="icon-btn" type="button" data-act="close" aria-label="Fermer">${ic('x')}</button></div>
        <p class="hint" style="font-size:15px">Entre le mot de passe maître utilisé au moment de cette sauvegarde.${fromLock ? '' : ' Les données actuelles seront remplacées, ton mot de passe maître actuel est conservé.'}</p>
        <label class="field"><span>Mot de passe de la sauvegarde</span><input type="password" name="pw" autofocus required></label>
        <p class="form-error" id="rsErr" role="alert"></p>
        <div class="dlg-foot"><button class="btn" type="button" data-act="close">Annuler</button><button class="btn primary">Restaurer</button></div></form>`, {
        onMount: (m) => m.querySelector('form').addEventListener('submit', async (e) => {
          e.preventDefault(); e.stopPropagation();
          const btn = m.querySelector('.btn.primary'); btn.disabled = true; btn.textContent = 'Déchiffrement…';
          try {
            const salt = unb64(blob.salt); const key = await deriveKey(e.target.pw.value, salt, blob.iter || ITER);
            const data = migrate(await decryptJSON(key, blob.iv, blob.ct));
            if (fromLock || !session.key) { Store.write(blob); session = { key, salt, data }; closeModal(); enterApp(); }
            else { session.data = data; await persist(); closeModal(); render(); }
            toast('Sauvegarde restaurée', 'ok');
          } catch { btn.disabled = false; btn.textContent = 'Restaurer'; $('#rsErr').textContent = 'Mot de passe incorrect pour cette sauvegarde.'; }
        }, { capture: true }),
      });
    };
    inp.click();
  }

  /* =========================================================
     Palette de commandes (Ctrl + K)
     ========================================================= */
  const palette = $('#palette');
  let palItems = [], palIdx = 0;
  function openPalette() {
    if (!session.key) return;
    closeModal();
    palette.innerHTML = `<div class="pal-search">${ic('search')}<input id="palQ" placeholder="Un site, un code, une tâche, une note… ou une action" autocomplete="off" spellcheck="false" aria-label="Rechercher"></div>
      <ul class="pal-list" id="palList" role="listbox"></ul>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>Entrée</kbd> valider</span><span><kbd>Échap</kbd> fermer</span></div>`;
    palette.showModal();
    const q = $('#palQ');
    q.addEventListener('input', () => { palIdx = 0; renderPal(q.value); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palItems.length - 1, palIdx + 1); paintPal(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(0, palIdx - 1); paintPal(); }
      else if (e.key === 'Enter') { e.preventDefault(); runPal(palIdx); }
    });
    renderPal('');
    q.focus();
  }
  palette.addEventListener('mousedown', (e) => { if (e.target === palette) palette.close(); });
  palette.addEventListener('close', () => { palette.innerHTML = ''; });
  function buildPal(query) {
    const q = norm(query.trim());
    const m = (s) => !q || norm(s).includes(q);
    const out = [];
    const go = (v) => () => { location.hash = `#/${v}`; };
    const actions = [
      ['Nouvelle tâche', 'tasks', () => { location.hash = '#/tasks'; setTimeout(() => $('form[data-form="addTask"] input')?.focus(), 30); }],
      ['Nouvelle note', 'notes', () => newNote()],
      ['Ajouter un identifiant au coffre', 'vault', () => credDialog()],
      ['Ajouter un code 2FA', 'otp', () => otpDialog()],
      ['Générer un mot de passe', 'dice', () => generatorDialog()],
      ['Démarrer une session de focus', 'focus', () => { location.hash = '#/focus'; if (!timer.running) toggleTimer(); }],
      ['Verrouiller maintenant', 'lock', () => lock()],
    ];
    for (const v of D().vault.filter((x) => m(`${x.name} ${x.username} ${x.url}`)).slice(0, 8))
      out.push({ g: 'Coffre', html: `${avatar(v.name, 'sm')}<div><strong>${esc(v.name)}</strong><span>${esc(v.username || hostOf(v.url))}</span></div><em>Entrée : copier le mot de passe</em>`, run: () => copy(v.password || '', `Mot de passe ${v.name} copié`) });
    for (const o of D().otp.filter((x) => m(`${x.issuer} ${x.account}`)).slice(0, 6))
      out.push({ g: 'Codes 2FA', html: `${avatar(o.issuer, 'sm')}<div><strong>${esc(o.issuer)}</strong><span>${esc(o.account)}</span></div><em>Entrée : copier le code</em>`, run: async () => copy(await codeAt(o, Date.now()), `Code ${o.issuer} copié`) });
    if (q) {
      for (const t of D().tasks.filter((x) => !x.done && m(x.title)).slice(0, 5))
        out.push({ g: 'Tâches', html: `${ic('tasks')}<div><strong>${esc(t.title)}</strong><span>${t.due ? esc(fmtDue(t.due)[0]) : 'Sans échéance'}</span></div>`, run: () => { location.hash = '#/tasks'; setTimeout(() => editTaskDialog(t.id), 30); } });
      for (const n of D().notes.filter((x) => m(`${x.title} ${x.body}`)).slice(0, 5))
        out.push({ g: 'Notes', html: `${ic('notes')}<div><strong>${esc(n.title || 'Sans titre')}</strong><span>${esc((n.body || '').slice(0, 70))}</span></div>`, run: () => { state.noteId = n.id; location.hash === '#/notes' ? render() : (location.hash = '#/notes'); } });
    }
    for (const [l, i, run] of actions) if (m(l)) out.push({ g: 'Actions', html: `${ic(i)}<div><strong>${esc(l)}</strong></div>`, run });
    for (const [id, label] of NAV) if (m(`Aller à ${label}`)) out.push({ g: 'Aller à', html: `${ic(id)}<div><strong>${esc(label)}</strong></div>`, run: go(id) });
    return out;
  }
  function renderPal(q) {
    palItems = buildPal(q);
    const list = $('#palList');
    if (!palItems.length) { list.innerHTML = '<li class="empty"><span>Aucun résultat. Essaie le nom d’un site, d’une tâche ou d’une note.</span></li>'; return; }
    let g = '', html = '';
    palItems.forEach((it, i) => {
      if (it.g !== g) { g = it.g; html += `<li class="pal-group" role="presentation">${esc(g)}</li>`; }
      html += `<li class="pal-item" role="option" data-i="${i}" aria-selected="${i === palIdx}">${it.html}</li>`;
    });
    list.innerHTML = html;
    $$('.pal-item', list).forEach((el) => {
      el.addEventListener('click', () => runPal(+el.dataset.i));
      el.addEventListener('mousemove', () => { if (palIdx !== +el.dataset.i) { palIdx = +el.dataset.i; paintPal(false); } });
    });
  }
  function paintPal(scroll = true) {
    $$('.pal-item').forEach((el) => el.setAttribute('aria-selected', +el.dataset.i === palIdx));
    if (scroll) $(`.pal-item[data-i="${palIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function runPal(i) { const it = palItems[i]; if (!it) return; palette.close(); it.run(); }

  function generatorDialog() {
    openModal(`<div class="dlg"><div class="dlg-head"><h2>Générateur de mots de passe</h2><button class="icon-btn" type="button" data-act="close" aria-label="Fermer">${ic('x')}</button></div>
      ${genPanelHtml(false)}<p class="hint">Généré avec le hasard cryptographique de ton navigateur. Rien n’est envoyé nulle part.</p></div>`);
  }
  function newNote() {
    const n = { id: uid(), title: '', body: '', pinned: false, updatedAt: Date.now() };
    D().notes.push(n); state.noteId = n.id; save();
    if (location.hash !== '#/notes') location.hash = '#/notes'; else render();
  }
  function toggleTimer() {
    if (timer.running) { timer.remaining = timerRemaining(); timer.running = false; }
    else {
      timer.endAt = Date.now() + timer.remaining; timer.running = true;
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    }
    if (state.view === 'focus') render(); else renderNav();
  }

  /* =========================================================
     Actions (clics)
     ========================================================= */
  const findTask = (id) => D().tasks.find((t) => t.id === id);
  const ACT = {
    close: () => closeModal(),
    palette: () => openPalette(),
    lock: () => lock(),
    forgot: async () => {
      const ok = await confirmBox({ title: 'Mot de passe oublié', text: 'Ton coffre est chiffré avec ce mot de passe : personne ne peut le retrouver. Tu peux soit restaurer une sauvegarde dont tu connais le mot de passe, soit effacer ce coffre et repartir de zéro. Effacer est définitif.', ok: 'Effacer et recommencer', danger: true });
      if (ok) { Store.clear(); showLock(); toast('Coffre effacé'); }
    },
    importFromLock: () => pickBackupFile(true),
    peek: (el) => {
      const inp = document.getElementById(el.dataset.target); if (!inp) return;
      const show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
      el.innerHTML = ic(show ? 'eyeOff' : 'eye'); el.setAttribute('aria-label', show ? 'Masquer' : 'Afficher');
    },
    // Tâches
    toggleTask: (el) => { const t = findTask(el.dataset.id); if (!t) return; t.done = !t.done; t.doneAt = t.done ? Date.now() : null; save(); rerender(); if (t.done) toast('Tâche terminée', 'ok'); },
    topTask: (el) => { const t = findTask(el.dataset.id); if (!t) return; t.top = !t.top; save(); rerender(); },
    delTask: (el) => {
      const i = D().tasks.findIndex((t) => t.id === el.dataset.id); if (i < 0) return;
      const [t] = D().tasks.splice(i, 1); save(); closeModal(); rerender();
      undoToast('Tâche supprimée', () => { D().tasks.splice(i, 0, t); save(); rerender(); });
    },
    editTask: (el) => editTaskDialog(el.dataset.id),
    taskFilter: (el) => { state.taskFilter = el.dataset.f; rerender(); },
    clearDone: async () => {
      if (!(await confirmBox({ title: 'Vider les tâches terminées ?', text: 'Elles seront supprimées définitivement.', ok: 'Vider', danger: true }))) return;
      session.data.tasks = D().tasks.filter((t) => !t.done); save(); rerender();
    },
    // Habitudes
    habitColor: (el) => { state.habitColor = el.dataset.c; $$('.swatch').forEach((s) => s.setAttribute('aria-pressed', s.dataset.c === state.habitColor)); },
    habitDay: (el) => { const h = D().habits.find((x) => x.id === el.dataset.id); if (!h) return; const k = el.dataset.day; if (h.log[k]) delete h.log[k]; else h.log[k] = true; save(); rerender(); },
    delHabit: async (el) => {
      const h = D().habits.find((x) => x.id === el.dataset.id); if (!h) return;
      if (!(await confirmBox({ title: `Supprimer « ${h.name} » ?`, text: 'Son historique sera perdu.', ok: 'Supprimer', danger: true }))) return;
      session.data.habits = D().habits.filter((x) => x.id !== h.id); save(); rerender();
    },
    // Notes
    newNote: () => newNote(),
    openNote: (el) => { state.noteId = el.dataset.id; rerender(); },
    closeNote: () => { state.noteId = null; rerender(); },
    pinNote: (el) => { const n = D().notes.find((x) => x.id === el.dataset.id); if (!n) return; n.pinned = !n.pinned; save(); rerender(); },
    copyNote: (el) => { const n = D().notes.find((x) => x.id === el.dataset.id); if (n) copy(`${n.title}\n\n${n.body}`.trim(), 'Note copiée', false); },
    delNote: (el) => {
      const i = D().notes.findIndex((x) => x.id === el.dataset.id); if (i < 0) return;
      const [n] = D().notes.splice(i, 1); state.noteId = null; save(); rerender();
      undoToast('Note supprimée', () => { D().notes.splice(i, 0, n); state.noteId = n.id; save(); rerender(); });
    },
    // Coffre
    addCred: () => credDialog(),
    editCred: (el) => credDialog(el.dataset.id),
    vaultFilter: (el) => { state.vaultFilter = el.dataset.f; rerender(); },
    copyUser: (el) => { const v = D().vault.find((x) => x.id === el.dataset.id); if (v) copy(v.username, 'Identifiant copié', false); },
    copyPw: (el) => { const v = D().vault.find((x) => x.id === el.dataset.id); if (v) copy(v.password || '', 'Mot de passe copié'); },
    openSite: (el) => { const v = D().vault.find((x) => x.id === el.dataset.id); if (!v) return; if (v.password) copy(v.password, 'Mot de passe copié'); window.open(urlOf(v.url), '_blank', 'noopener,noreferrer'); },
    copyField: (el) => { const f = el.closest('form')[el.dataset.field]; if (f?.value) copy(f.value, el.dataset.field === 'password' ? 'Mot de passe copié' : 'Identifiant copié', el.dataset.field === 'password'); },
    delCred: async (el) => {
      const v = D().vault.find((x) => x.id === el.dataset.id); if (!v) return;
      if (!(await confirmBox({ title: `Supprimer ${v.name} ?`, text: 'L’identifiant et le mot de passe seront retirés du coffre.', ok: 'Supprimer', danger: true }))) return;
      session.data.vault = D().vault.filter((x) => x.id !== v.id); save(); rerender(); toast('Identifiant supprimé');
    },
    generator: () => generatorDialog(),
    toggleGen: () => {
      const slot = $('#genSlot'); if (!slot) return;
      if (slot.innerHTML) { slot.innerHTML = ''; return; }
      slot.innerHTML = genPanelHtml(true);
    },
    genRefresh: () => refreshGen(),
    genCopy: () => { const p = $('#genOut')?.dataset.pw; if (p) copy(p, 'Mot de passe copié'); },
    genUse: () => {
      const p = $('#genOut')?.dataset.pw; const inp = $('#credPw'); if (!p || !inp) return;
      inp.value = p; inp.type = 'text'; inp.dispatchEvent(new Event('input', { bubbles: true })); $('#genSlot').innerHTML = '';
    },
    // 2FA
    addOtp: () => otpDialog(),
    editOtp: (el) => otpDialog(el.dataset.id),
    favOtp: (el) => { const o = D().otp.find((x) => x.id === el.dataset.id); if (!o) return; o.fav = !o.fav; save(); rerender(); },
    copyOtp: async (el) => { const o = D().otp.find((x) => x.id === el.dataset.id); if (!o) return; try { copy(await codeAt(o, Date.now()), `Code ${o.issuer} copié`); } catch { toast('Clé invalide pour ce code', 'error'); } },
    delOtp: async (el) => {
      const o = D().otp.find((x) => x.id === el.dataset.id); if (!o) return;
      if (!(await confirmBox({ title: `Supprimer le code ${o.issuer} ?`, text: 'Assure-toi d’avoir désactivé la double authentification sur ce site, ou d’avoir ses codes de secours : sinon tu risques de ne plus pouvoir t’y connecter.', ok: 'Supprimer', danger: true }))) return;
      session.data.otp = D().otp.filter((x) => x.id !== o.id);
      for (const v of D().vault) if (v.otpId === o.id) v.otpId = '';
      save(); rerender(); toast('Code supprimé');
    },
    scanCam: () => startCamera(),
    stopCam: () => { stopCamera(); $('#scanArea').innerHTML = ''; },
    scanFile: () => $('#qrFile')?.click(),
    // Focus
    focusMode: (el) => { setMode(el.dataset.m); rerender(); },
    focusToggle: () => toggleTimer(),
    focusReset: () => { setMode(timer.mode); rerender(); },
    focusSkip: () => { timer.running = false; if (timer.mode === 'focus') setMode('short'); else setMode('focus'); rerender(); },
    // Réglages
    theme: (el) => { prefs.theme = el.dataset.t; savePrefs(); applyTheme(); rerender(); },
    changeMaster: () => changeMasterDialog(),
    exportBackup: () => exportBackup(),
    importBackup: () => pickBackupFile(false),
    install: async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; rerender(); },
    notif: async () => {
      if (!('Notification' in window)) { toast('Ton navigateur ne gère pas les notifications.', 'error'); return; }
      const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notifications activées' : 'Notifications refusées dans le navigateur', p === 'granted' ? 'ok' : 'error'); rerender();
    },
    wipe: async () => {
      const ok = await confirmBox({ title: 'Tout effacer ?', text: 'Le coffre, les codes 2FA, les tâches et les notes seront supprimés de cet appareil. Sans sauvegarde, c’est irréversible.', ok: 'Effacer définitivement', danger: true });
      if (!ok) return; Store.clear(); session = { key: null, salt: null, data: null }; showLock(); toast('Toutes les données ont été effacées');
    },
  };
  function undoToast(msg, undo) {
    const t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = `<span>${esc(msg)}</span><button class="btn" style="height:28px;background:transparent;color:inherit;border-color:currentColor">Annuler</button>`;
    $('#toasts').append(t); requestAnimationFrame(() => t.classList.add('in'));
    const kill = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); };
    t.querySelector('button').onclick = () => { undo(); kill(); };
    setTimeout(kill, 5000);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACT[el.dataset.act];
    if (!fn) return;
    if (el.tagName === 'A') return;
    e.preventDefault();
    fn(el, e);
  });

  /* =========================================================
     Formulaires
     ========================================================= */
  const FORMS = {
    quickTask: (f) => {
      const title = f.title.value.trim(); if (!title) return;
      D().tasks.push({ id: uid(), title, due: dayKey(), priority: 0, tag: '', done: false, top: false, createdAt: Date.now() });
      save(); rerender(); setTimeout(() => $('form[data-form="quickTask"] input')?.focus(), 0);
    },
    addTask: (f) => {
      const title = f.title.value.trim(); if (!title) return;
      D().tasks.push({ id: uid(), title, due: f.due.value || '', priority: +f.priority.value, tag: f.tag.value.trim().replace(/^#/, ''), done: false, top: false, createdAt: Date.now() });
      save(); rerender(); setTimeout(() => $('form[data-form="addTask"] input')?.focus(), 0);
      toast('Tâche ajoutée', 'ok');
    },
    editTask: (f) => {
      const t = findTask(f.dataset.id); if (!t) return;
      Object.assign(t, { title: f.title.value.trim() || t.title, due: f.due.value, priority: +f.priority.value, tag: f.tag.value.trim().replace(/^#/, ''), notes: f.notes.value });
      save(); closeModal(); rerender();
    },
    addHabit: (f) => {
      const name = f.name.value.trim(); if (!name) return;
      D().habits.push({ id: uid(), name, color: state.habitColor, log: {}, createdAt: Date.now() });
      save(); rerender();
    },
    cred: (f) => {
      const name = f.name.value.trim(); if (!name) { f.name.focus(); return; }
      const fields = { name, url: f.url.value.trim(), username: f.username.value.trim(), password: f.password.value, category: f.category.value.trim(), otpId: f.otpId.value, notes: f.notes.value, fav: f.fav.checked, updatedAt: Date.now() };
      const id = f.dataset.id;
      if (id) Object.assign(D().vault.find((x) => x.id === id), fields);
      else D().vault.push({ id: uid(), createdAt: Date.now(), ...fields });
      save(); closeModal(); rerender(); toast(id ? 'Identifiant enregistré' : `${name} ajouté au coffre`, 'ok');
    },
    otp: async (f) => {
      let secret = f.secret.value.trim();
      const err = $('#otpErr');
      try {
        if (/^otpauth:/i.test(secret)) { await previewOtp(f); secret = f.secret.value.trim(); }
        secret = secret.replace(/[\s=-]/g, '').toUpperCase();
        base32Decode(secret);
        const o = { secret, issuer: f.issuer.value.trim() || 'Compte', account: f.account.value.trim(), digits: +f.digits.value, period: +f.period.value, algorithm: f.algorithm.value };
        await totp({ id: 'check', ...o });
        const id = f.dataset.id;
        if (id) Object.assign(D().otp.find((x) => x.id === id), o);
        else {
          if (D().otp.some((x) => x.secret === secret)) { err.textContent = 'Ce code est déjà dans ta liste.'; return; }
          D().otp.push({ id: uid(), createdAt: Date.now(), ...o });
        }
        codeCache.clear(); save(); closeModal(); rerender(); toast(id ? 'Code enregistré' : `Code ${o.issuer} ajouté`, 'ok');
      } catch (e) { err.textContent = e.message || 'Clé invalide.'; }
    },
    changeMaster: async (f) => {
      const err = $('#cmErr'); err.textContent = '';
      if (f.next.value.length < 8) { err.textContent = 'Utilise au moins 8 caractères.'; return; }
      if (f.next.value !== f.confirm.value) { err.textContent = 'Les nouveaux mots de passe ne sont pas identiques.'; return; }
      const btn = f.querySelector('.btn.primary'); btn.disabled = true; btn.textContent = 'Rechiffrement…';
      try {
        await persist();
        const s = Store.read();
        await decryptJSON(await deriveKey(f.current.value, unb64(s.salt), s.iter || ITER), s.iv, s.ct);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        session.key = await deriveKey(f.next.value, salt); session.salt = salt;
        await persist(); closeModal(); toast('Mot de passe maître changé. Pense à refaire une sauvegarde.', 'ok');
      } catch { btn.disabled = false; btn.textContent = 'Changer'; err.textContent = 'Le mot de passe actuel est incorrect.'; }
    },
  };
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f || !FORMS[f.dataset.form]) return;
    e.preventDefault();
    FORMS[f.dataset.form](f);
  });

  /* =========================================================
     Saisie en direct (filtres, notes, journal, générateur)
     ========================================================= */
  let journalTimer = null;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.filter === 'vault') { state.vaultQuery = el.value; $('#vaultList').innerHTML = vaultList(); tick(); return; }
    if (el.dataset.filter === 'notes') { state.noteQuery = el.value; $('#noteItems').innerHTML = noteItems(); return; }
    if (el.dataset.filter === 'otp') {
      state.otpQuery = el.value; const pos = el.selectionStart; render();
      const ni = $('[data-filter="otp"]'); ni.focus(); ni.setSelectionRange(pos, pos); return;
    }
    if (el.dataset.noteField) {
      const n = D().notes.find((x) => x.id === state.noteId); if (!n) return;
      n[el.dataset.noteField] = el.value; n.updatedAt = Date.now(); save();
      const t = $(`[data-title-of="${n.id}"]`); if (t && el.dataset.noteField === 'title') t.textContent = n.title || 'Sans titre';
      const s = $('#noteSaved'); if (s) s.textContent = 'Enregistré';
      return;
    }
    if (el.dataset.journal) {
      const k = el.dataset.journal;
      if (el.value) D().journal[k] = el.value; else delete D().journal[k];
      save();
      const s = $('#journalSaved'); if (s) { s.textContent = 'Enregistrement…'; clearTimeout(journalTimer); journalTimer = setTimeout(() => { s.textContent = 'Enregistré'; }, 600); }
      return;
    }
    if (el.dataset.gen) {
      genPrefs[el.dataset.gen] = el.type === 'checkbox' ? el.checked : +el.value;
      if (!genPrefs.lower && !genPrefs.upper && !genPrefs.digits && !genPrefs.symbols) { genPrefs.lower = true; const lc = $('[data-gen="lower"]'); if (lc) lc.checked = true; }
      refreshGen(); return;
    }
    if (el.dataset.strength) {
      const s = strength(el.value); const m = document.getElementById(el.dataset.strength);
      if (m) m.dataset.s = s.score; const l = document.getElementById(`${el.dataset.strength}Label`); if (l) l.textContent = s.label;
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.pref) { prefs[el.dataset.pref] = +el.value; savePrefs(); toast('Réglage enregistré', 'ok'); }
    if (el.dataset.focusTask !== undefined) timer.taskId = el.value;
    if (el.dataset.duration) {
      const v = Math.min(120, Math.max(1, Math.round(+el.value) || 1)); el.value = v;
      timer.durations[el.dataset.duration] = v;
      if (!timer.running && timer.mode === el.dataset.duration) { timer.remaining = v * 60000; render(); }
    }
  });

  /* =========================================================
     Clavier, inactivité, horloge
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (palette.open) palette.close(); else openPalette(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); return; }
    if (!session.key) return;
    if (e.altKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); location.hash = `#/${NAV[+e.key - 1][0]}`; return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing && !modal.open && !palette.open) {
      const s = $('[data-filter]') || $('form[data-form="quickTask"] input') || $('form[data-form="addTask"] input');
      if (s) { e.preventDefault(); s.focus(); }
    }
  });

  let lastActivity = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => {
    const m = +prefs.autolock;
    if (session.key && m > 0 && Date.now() - lastActivity > m * 60000) { lock(); }
  }, 5000);

  async function tick() {
    updateTimer();
    if (!session.key) return;
    const nodes = $$('[data-otp]'); if (!nodes.length) return;
    const now = Date.now();
    for (const el of nodes) {
      const o = D()?.otp.find((x) => x.id === el.dataset.otp); if (!o) continue;
      const period = o.period || 30;
      const rem = period - (Math.floor(now / 1000) % period);
      let code = null;
      try { code = await codeAt(o, now); } catch { code = null; }
      const dg = el.querySelector('.otp-digits'); if (dg) dg.textContent = code ? fmtCode(code) : 'Clé invalide';
      el.classList.toggle('expiring', rem <= 6);
      const r = el.querySelector('.otp-rem'); if (r) r.textContent = `${rem} s`;
      const bar = el.querySelector('.otp-bar > span');
      if (bar) {
        const p = (rem - 1) / period; const prev = parseFloat(bar.dataset.p ?? '-1');
        if (p > prev) { bar.style.transition = 'none'; bar.style.width = `${(rem / period) * 100}%`; void bar.offsetWidth; bar.style.transition = ''; }
        bar.style.width = `${p * 100}%`; bar.dataset.p = p;
      }
      const nx = el.querySelector('.otp-next');
      if (nx) {
        if (rem <= 6 && code) { try { nx.textContent = `Suivant : ${fmtCode(await codeAt(o, now + period * 1000))}`; } catch { /* rien */ } }
        else nx.textContent = '';
      }
    }
  }
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));

  // Rafraîchit la vue Aujourd’hui au changement de jour
  let lastDay = dayKey();
  setInterval(() => { const d = dayKey(); if (d !== lastDay) { lastDay = d; if (session.key) render(); } }, 30000);

  /* =========================================================
     Démarrage
     ========================================================= */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  if (!window.crypto?.subtle) {
    $('#lock').hidden = false;
    $('#lock').innerHTML = '<div class="lock-card"><h1 class="lock-title">Kairos</h1><p class="lock-sub">Ouvre Kairos depuis une adresse sécurisée (https) ou en local : le chiffrement n’est pas disponible ici.</p></div>';
  } else showLock();

  // Expose les fonctions TOTP pour les tests automatisés
  window.__kairosTest = { totp, base32Decode, base32Encode, parseOtpauth, parseMigration, strength, generate };
})();
