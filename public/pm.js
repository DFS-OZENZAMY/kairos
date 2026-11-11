/* Kairos — Gestion de projet d'équipe (façon ClickUp).
   Espaces → dossiers → listes → tâches ; vues Liste, Tableau, Tableau de données, Calendrier, Gantt ;
   détail de tâche complet ; boîte de réception ; tableau de bord ; objectifs ; documents ; temps réel. */
'use strict';
(() => {
  const K = () => window.Kairos;                       // utilitaires partagés par app.js (esc, toast, modales, icônes…)
  const esc = (s) => K().esc(s);
  const PREFS = 'kairos.pm';
  const P = (() => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; } })();
  P.modes ||= {}; P.collapsed ||= {}; P.groupBy ||= {};
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(P)); } catch { /* stockage plein */ } };

  const PRIO = { 1: ['Urgente', '#D23B2E'], 2: ['Haute', '#D98A0B'], 3: ['Normale', '#2F45D8'], 4: ['Basse', '#8C94AD'], 0: ['Aucune', ''] };
  const MODES = [['list', 'Liste'], ['board', 'Tableau'], ['table', 'Données'], ['calendar', 'Calendrier'], ['gantt', 'Gantt']];
  const TYPE_LABEL = { open: 'Ouvert', active: 'En cours', closed: 'Terminé' };
  const REC = { '': 'Aucune', daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois' };
  const FIELD_LABEL = { text: 'Texte', number: 'Nombre', select: 'Liste déroulante', date: 'Date', checkbox: 'Case à cocher', url: 'Lien' };
  const SWATCH = ['#2F45D8', '#7C3AED', '#C2410C', '#D23B2E', '#17865A', '#0E7490', '#D98A0B', '#DB2777', '#5D6584'];

  const S = {
    root: null, me: null, teams: [], tree: null, route: { page: 'home' }, tasks: [], meta: null, err: null,
    filters: { q: '', assignees: [], priorities: [], tags: [], due: '' }, showClosed: false, showSub: true, sel: new Set(),
    detail: null, dd: null, cal: null, ws: null, wsList: null, chatOpen: false, messages: [], online: [], views: [], activeView: null,
    page: null, timerTick: null,
  };

  /* =========================================================
     Utilitaires
     ========================================================= */
  async function api(method, path, body) {
    const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await r.json(); } catch { /* pas de corps */ }
    if (!r.ok) { const e = new Error(data.error || `Erreur ${r.status}`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  const toast = (m, k) => K().toast(m, k);
  const fail = (e) => toast(e.message || 'Une erreur est survenue', 'error');
  const z = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  const fmtDate = (s) => {
    if (!s) return '';
    const t = today(); if (s === t) return 'Aujourd’hui'; if (s === addDays(t, 1)) return 'Demain'; if (s === addDays(t, -1)) return 'Hier';
    const d = new Date(s + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  };
  const fmtMin = (m) => { m = Math.round(m || 0); if (!m) return '0 min'; const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ` ${z(r)}` : ''}` : `${r} min`; };
  const parseDuration = (s) => { s = String(s || '').trim().toLowerCase().replace(',', '.'); if (!s) return 0; let m = 0; const h = s.match(/([\d.]+)\s*h/), mi = s.match(/([\d.]+)\s*m/); if (h) m += parseFloat(h[1]) * 60; if (mi) m += parseFloat(mi[1]); if (!h && !mi) m = parseFloat(s) || 0; return Math.round(m); };
  const member = (id) => S.tree?.members.find((m) => m.id === id);
  const listOf = (id) => S.tree?.lists.find((l) => l.id === id);
  const spaceOf = (id) => S.tree?.spaces.find((s) => s.id === id);
  const statusOf = (t) => { const l = listOf(t.listId); return (l?.statuses || []).find((s) => s.key === t.status) || { key: t.status, name: t.status, color: '#8C94AD', type: t.statusType }; };
  const av = (id, cls = '') => { const m = member(id); return m ? `<span class="pm-av ${cls}" style="--h:${hue(m.name)}" title="${esc(m.name)}">${esc(m.name.trim()[0]?.toUpperCase() || '?')}</span>` : ''; };
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const tagColor = (t) => `hsl(${hue(t)} 60% var(--tag-l, 92%))`;
  const ic = (n) => K().ic(n);
  const flag = (p) => p ? `<svg class="pm-flag" viewBox="0 0 24 24" style="color:${PRIO[p][1]}" aria-label="Priorité ${PRIO[p][0]}"><path d="M5 21V4h11l-2 4 2 4H5" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>` : '';
  const md = (src) => {            // Markdown léger et sûr (le texte est échappé d'abord)
    const lines = esc(src || '').split('\n'); let html = '', inList = false;
    const inline = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/@([a-z0-9][a-z0-9._-]{2,31})/gi, '<span class="pm-mention">@$1</span>');
    for (const l of lines) {
      const li = l.match(/^\s*[-*] (?:\[( |x)\] )?(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1] !== undefined ? `<input type="checkbox" disabled ${li[1] === 'x' ? 'checked' : ''}> ` : ''}${inline(li[2])}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      const h = l.match(/^(#{1,3}) (.*)/);
      html += h ? `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>` : l.trim() ? `<p>${inline(l)}</p>` : '';
    }
    return html + (inList ? '</ul>' : '');
  };
  const scopeKey = () => `${S.route.page}:${S.route.id || ''}`;
  const mode = () => P.modes[scopeKey()] || 'list';
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* =========================================================
     Menus contextuels (statut, responsables, priorité…)
     ========================================================= */
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function menu(anchor, html, onClick, { width } = {}) {
    closeMenu();
    menuEl = document.createElement('div'); menuEl.className = 'pm-menu'; menuEl.innerHTML = html;
    if (width) menuEl.style.minWidth = width + 'px';
    document.body.append(menuEl);
    const r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    menuEl.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.left)) + 'px';
    menuEl.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
    menuEl.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; const keep = onClick(b.dataset.v, b, e); if (keep !== true) closeMenu(); /* seul « true » garde le menu ouvert (sélection multiple) */ });
    menuEl.querySelector('input')?.focus();
    return menuEl;
  }
  addEventListener('mousedown', (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu(); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuEl) { closeMenu(); return; }
    if (S.detail && !document.querySelector('dialog[open]')) closeDetail();
  });
  const statusMenu = (anchor, listId, current, pick) => {
    const l = listOf(listId);
    menu(anchor, `<div class="pm-menu-title">Statut</div>${(l?.statuses || []).map((s) => `<button data-v="${esc(s.key)}" class="${s.key === current ? 'on' : ''}"><i class="pm-dot" style="--c:${s.color}"></i>${esc(s.name)}</button>`).join('')}`, (v) => pick(v));
  };
  const prioMenu = (anchor, current, pick) => menu(anchor, `<div class="pm-menu-title">Priorité</div>${[1, 2, 3, 4, 0].map((p) => `<button data-v="${p}" class="${p === current ? 'on' : ''}">${flag(p) || '<span class="pm-flag"></span>'}${PRIO[p][0]}</button>`).join('')}`, (v) => pick(Number(v)));
  function peopleMenu(anchor, selected, pick, { single } = {}) {
    let sel = new Set(selected);
    const draw = (q = '') => `<input class="input sm" placeholder="Rechercher un membre" value="${esc(q)}" data-filter>${S.tree.members.filter((m) => !q || (m.name + m.handle).toLowerCase().includes(q.toLowerCase()))
      .map((m) => `<button data-v="${m.id}" class="${sel.has(m.id) ? 'on' : ''}">${av(m.id)}<span>${esc(m.name)} <small>@${esc(m.handle)}</small></span>${sel.has(m.id) ? '<b>✓</b>' : ''}</button>`).join('')}${!single ? '<div class="pm-menu-foot"><button data-v="__ok" class="btn primary sm">Valider</button></div>' : ''}`;
    const el = menu(anchor, draw(), (v, b) => {
      if (v === '__ok') { pick([...sel]); return false; }
      if (single) { pick(v); return false; }
      sel.has(v) ? sel.delete(v) : sel.add(v); b.classList.toggle('on'); b.querySelector('b')?.remove(); if (sel.has(v)) b.insertAdjacentHTML('beforeend', '<b>✓</b>');
      return true;
    }, { width: 260 });
    el.addEventListener('input', (e) => { if (e.target.matches('[data-filter]')) { const q = e.target.value; el.innerHTML = draw(q); const i = el.querySelector('input'); i.focus(); i.setSelectionRange(q.length, q.length); } });
  }

  /* =========================================================
     Chargement des données
     ========================================================= */
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').slice(1);
    const [page, id = ''] = parts;
    S.route = { page: page || 'home', id };   // « #/projects/ » = tableau de bord
  }
  async function loadTree() { S.tree = await api('GET', `/pm/teams/${P.teamId}/tree`); }
  async function loadPage() {
    const { page, id } = S.route;
    S.err = null; S.page = null;
    if (['list', 'space', 'folder', 'mine'].includes(page)) {
      const q = page === 'mine' ? `team=${P.teamId}&mine=1` : `${page}=${encodeURIComponent(id)}`;
      const [t, meta, views] = await Promise.all([
        api('GET', `/pm/tasks?${q}${S.showClosed ? '' : ''}`),
        page === 'list' ? api('GET', `/pm/lists/${id}`) : null,
        api('GET', `/pm/views?team=${P.teamId}&scope=${page === 'mine' ? 'mine:' + S.me.id : page + ':' + id}`).catch(() => ({ views: [] })),
      ]);
      S.tasks = t.tasks; S.meta = meta; S.views = views.views; S.messages = meta?.messages || [];
      connectWs(page === 'list' ? id : null);
    } else connectWs(null);
    if (page === 'inbox') S.page = await api('GET', `/pm/notifications?team=${P.teamId}`);
    if (page === 'home') S.page = await api('GET', `/pm/teams/${P.teamId}/dashboard${id ? '?space=' + id : ''}`);
    if (page === 'goals') { const [g, all] = await Promise.all([api('GET', `/pm/teams/${P.teamId}/goals`), api('GET', `/pm/tasks?team=${P.teamId}`)]); S.page = g; S.tasks = all.tasks; }
    if (page === 'docs') S.page = await api('GET', `/pm/spaces/${id}/docs`);
    if (page === 'doc') S.page = await api('GET', `/pm/docs/${id}`);
    if (page === 'settings') S.page = await api('GET', `/team/teams/${P.teamId}`);
    if (page === 'task') { const d = await api('GET', `/pm/tasks/${id}`); location.replace(`#/projects/list/${d.task.listId}`); S.detail = id; }
  }
  const refreshTasks = debounce(async () => {
    if (!['list', 'space', 'folder', 'mine'].includes(S.route.page) || !S.root?.isConnected) return;
    try { const { page, id } = S.route; S.tasks = (await api('GET', `/pm/tasks?${page === 'mine' ? `team=${P.teamId}&mine=1` : `${page}=${id}`}`)).tasks; renderMain(); } catch { /* réseau */ }
    if (S.detail) loadDetail(S.detail, true);
  }, 250);

  /* ---------- Temps réel (Durable Object de la liste) ---------- */
  function connectWs(listId) {
    if (S.wsList === listId && S.ws && S.ws.readyState <= 1) return;
    try { S.ws?.close(); } catch { /* déjà fermé */ }
    S.ws = null; S.wsList = listId; S.online = [];
    if (!listId) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/pm/lists/${listId}/ws`);
    S.ws = ws;
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'pm') { if (m.action === 'list') loadTree().then(renderAll); else refreshTasks(); }
      if (m.type === 'chat') { S.messages.push(m.message); if (S.chatOpen) renderChat(); else markChat(); }
      if (m.type === 'presence') { S.online = m.online; renderPresence(); }
    };
    ws.onclose = () => { if (S.ws === ws && S.wsList === listId && S.root?.isConnected) setTimeout(() => { if (S.wsList === listId) { S.ws = null; connectWs(listId); } }, 3000); };
  }

  /* =========================================================
     Montage et rendu
     ========================================================= */
  async function mount(root) {
    S.root = root; parseRoute();
    root.innerHTML = '<div class="pm-loading"><span class="pm-spin"></span>Chargement…</div>';
    try {
      if (!S.me) { const r = await api('GET', '/team/me'); S.me = r.user; S.teams = r.teams; }
    } catch (e) { if (e.status === 401) return renderAuth(); return renderFatal(e); }
    if (!S.teams.length) return renderNoTeam();
    if (!S.teams.some((t) => t.id === P.teamId)) { P.teamId = S.teams[0].id; savePrefs(); }
    try { await Promise.all([loadTree(), loadPage()]); }   // membres, compteurs et notifications toujours à jour
    catch (e) { if (e.status === 401) { S.me = null; return renderAuth(); } if (e.status === 404 && S.route.page !== 'home') { location.hash = '#/projects'; return; } return renderFatal(e); }
    if (S.route.page === 'task') return;          // lien direct : redirection vers la liste en cours
    renderAll();
  }
  function renderAll() {
    if (!S.root?.isConnected) return;
    S.root.innerHTML = `<div class="pm ${S.detail ? 'has-detail' : ''}">
      <aside class="pm-side" id="pmSide">${sidebar()}</aside>
      <section class="pm-main" id="pmMain"></section>
      <aside class="pm-detail" id="pmDetail" aria-label="Détail de la tâche"></aside>
      ${S.chatOpen ? '' : ''}</div>`;
    bind(S.root);
    renderMain();
    if (S.detail) loadDetail(S.detail);
    tickTimer();
  }
  function renderMain() {
    const el = S.root?.querySelector('#pmMain'); if (!el) return;
    const p = S.route.page;
    let html = '';
    try {
      if (['list', 'space', 'folder', 'mine'].includes(p)) html = tasksPage();
      else if (p === 'inbox') html = inboxPage();
      else if (p === 'goals') html = goalsPage();
      else if (p === 'docs') html = docsPage();
      else if (p === 'doc') html = docPage();
      else if (p === 'settings') html = settingsPage();
      else html = dashboardPage();
    } catch (e) { console.error(e); html = `<div class="empty"><strong>Affichage impossible</strong><span>${esc(e.message)}</span></div>`; }
    el.innerHTML = html;
    AFTER[p]?.(el);
    if (['list', 'space', 'folder', 'mine'].includes(p)) afterTasks(el);
  }
  const AFTER = {};

  /* ---------- Connexion / équipe ---------- */
  function renderFatal(e) { S.root.innerHTML = `<div class="empty"><strong>Gestion de projet indisponible</strong><span>${esc(e.message)}</span><button class="btn" data-pm="retry">Réessayer</button></div>`; bind(S.root); }
  function renderAuth() {
    S.root.innerHTML = `<div class="pm-auth">
      <div class="pm-auth-intro"><h1>Projets d’équipe</h1><p class="sub">Espaces, listes, tâches, vues Kanban, calendrier et Gantt, suivi du temps et objectifs, à plusieurs et en temps réel.</p>
        <p class="hint">Les données d’équipe sont stockées sur ton serveur Kairos, séparément de ton coffre chiffré.</p></div>
      <div class="pm-auth-forms">
        <form class="panel dlg" data-pm-form="login"><h2>Se connecter</h2>
          <label class="field"><span>Identifiant</span><input class="input" name="handle" autocomplete="username" required></label>
          <label class="field"><span>Mot de passe</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn primary">Se connecter</button></form>
        <form class="panel dlg" data-pm-form="register"><h2>Créer un compte d’équipe</h2>
          <label class="field"><span>Nom affiché</span><input class="input" name="name" required maxlength="60"></label>
          <label class="field"><span>Identifiant</span><input class="input" name="handle" required pattern="[a-z0-9][a-z0-9._\\-]{2,31}" placeholder="ex. amina.b" autocomplete="username"></label>
          <label class="field"><span>Mot de passe (8 caractères minimum)</span><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password"></label>
          <button class="btn primary">Créer mon compte</button></form>
      </div></div>`;
    bind(S.root);
  }
  function renderNoTeam() {
    S.root.innerHTML = `<div class="pm-auth"><div class="pm-auth-intro"><h1>Bienvenue, ${esc(S.me.name)}</h1><p class="sub">Crée ton espace de travail ou rejoins celui de ton équipe avec un code d’invitation.</p>
      <button class="btn ghost" data-pm="logout">Se déconnecter</button></div>
      <div class="pm-auth-forms">
        <form class="panel dlg" data-pm-form="createTeam"><h2>Créer un espace de travail</h2><label class="field"><span>Nom</span><input class="input" name="name" required maxlength="60" placeholder="ex. Agence Atlas"></label><button class="btn primary">Créer</button></form>
        <form class="panel dlg" data-pm-form="join"><h2>Rejoindre une équipe</h2><label class="field"><span>Code d’invitation</span><input class="input mono" name="code" required placeholder="24 caractères"></label><button class="btn primary">Rejoindre</button></form>
      </div></div>`;
    bind(S.root);
  }

  /* ---------- Barre latérale ---------- */
  function sidebar() {
    const t = S.tree, r = S.route;
    const link = (page, id, label, icon, extra = '') => `<a href="#/projects/${page}${id ? '/' + id : ''}" class="pm-link ${r.page === page && (r.id || '') === (id || '') ? 'on' : ''}">${icon}<span>${label}</span>${extra}</a>`;
    const openCount = (l) => Object.entries(l.counts || {}).filter(([k]) => (l.statuses.find((s) => s.key === k) || {}).type !== 'closed').reduce((a, [, n]) => a + n, 0);
    const listLink = (l) => `<a href="#/projects/list/${l.id}" class="pm-link pm-list ${r.page === 'list' && r.id === l.id ? 'on' : ''}" data-drop-list="${l.id}"><i class="pm-dot" style="--c:${l.color || spaceOf(l.spaceId)?.color || '#8C94AD'}"></i><span>${esc(l.name)}</span><small>${openCount(l) || ''}</small>
        <button class="pm-more" data-menu data-pm="listMenu" data-id="${l.id}" aria-label="Options de la liste">⋯</button></a>`;
    const spaces = t.spaces.filter((s) => !s.archived).map((s) => {
      const col = P.collapsed['s' + s.id];
      const folders = t.folders.filter((f) => f.spaceId === s.id && !f.archived);
      const lists = t.lists.filter((l) => l.spaceId === s.id && !l.folderId && !l.archived);
      return `<div class="pm-space"><div class="pm-space-head ${r.page === 'space' && r.id === s.id ? 'on' : ''}">
          <button class="pm-caret ${col ? '' : 'open'}" data-pm="toggle" data-id="s${s.id}" aria-label="Replier">▸</button>
          <a href="#/projects/space/${s.id}"><span class="pm-sq" style="--c:${s.color}">${esc(s.name[0]?.toUpperCase() || '?')}</span>${esc(s.name)}</a>
          <button class="pm-more" data-menu data-pm="spaceMenu" data-id="${s.id}" aria-label="Options de l’espace">⋯</button></div>
        ${col ? '' : `<div class="pm-space-body">
          ${folders.map((f) => { const fc = P.collapsed['f' + f.id]; return `<div class="pm-folder"><div class="pm-folder-head ${r.page === 'folder' && r.id === f.id ? 'on' : ''}"><button class="pm-caret ${fc ? '' : 'open'}" data-pm="toggle" data-id="f${f.id}">▸</button>
              <a href="#/projects/folder/${f.id}">📁 ${esc(f.name)}</a><button class="pm-more" data-menu data-pm="folderMenu" data-id="${f.id}" aria-label="Options du dossier">⋯</button></div>
              ${fc ? '' : t.lists.filter((l) => l.folderId === f.id && !l.archived).map(listLink).join('') || '<span class="pm-none">Aucune liste</span>'}</div>`; }).join('')}
          ${lists.map(listLink).join('')}
          ${!folders.length && !lists.length ? `<button class="pm-none link-btn" data-pm="newList" data-id="${s.id}">+ Créer une liste</button>` : ''}
          <a href="#/projects/docs/${s.id}" class="pm-link pm-list ${r.page === 'docs' && r.id === s.id ? 'on' : ''}">📄 <span>Documents</span></a>
        </div>`}</div>`;
    }).join('');
    return `<div class="pm-team"><select class="input sm" data-pm-change="team" aria-label="Espace de travail">${S.teams.map((x) => `<option value="${x.id}" ${x.id === P.teamId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">+ Nouvel espace de travail…</option><option value="__join">Rejoindre avec un code…</option></select>
        <a class="icon-btn" href="#/projects/settings" title="Réglages de l’équipe" aria-label="Réglages de l’équipe">${ic('settings')}</a></div>
      ${S.tree.running ? `<button class="pm-running" data-pm="openTask" data-id="${S.tree.running.taskId}"><i></i><span>${esc(S.tree.running.title)}</span><b id="pmTimer">0:00</b><span class="pm-stop" data-pm="stopTimer" title="Arrêter">■</span></button>` : ''}
      <nav class="pm-nav">${link('home', '', 'Tableau de bord', '📊')}${link('mine', '', 'Mes tâches', '✅')}${link('inbox', '', 'Boîte de réception', '📥', S.tree.unread ? `<span class="badge">${S.tree.unread}</span>` : '')}${link('goals', '', 'Objectifs', '🎯')}</nav>
      <div class="pm-side-title"><span>Espaces</span><button class="icon-btn sm" data-pm="newSpace" aria-label="Nouvel espace" title="Nouvel espace">+</button></div>
      <div class="pm-tree">${spaces || '<span class="pm-none">Aucun espace</span>'}</div>`;
  }

  /* =========================================================
     Pages de tâches (Liste, Tableau, Données, Calendrier, Gantt)
     ========================================================= */
  function scopeInfo() {
    const { page, id } = S.route;
    if (page === 'list') { const l = listOf(id), s = spaceOf(l?.spaceId), f = S.tree.folders.find((x) => x.id === l?.folderId); return { title: l?.name || 'Liste', crumbs: [s?.name, f?.name].filter(Boolean), color: l?.color || s?.color, desc: l?.description }; }
    if (page === 'space') { const s = spaceOf(id); return { title: s?.name || 'Espace', crumbs: [], color: s?.color }; }
    if (page === 'folder') { const f = S.tree.folders.find((x) => x.id === id); return { title: f?.name || 'Dossier', crumbs: [spaceOf(f?.spaceId)?.name], color: spaceOf(f?.spaceId)?.color }; }
    return { title: 'Mes tâches', crumbs: [S.tree.team.name], color: '#2F45D8' };
  }
  function visibleTasks() {
    const f = S.filters, q = f.q.trim().toLowerCase(), t0 = today(), week = addDays(t0, 7);
    let tasks = S.tasks.filter((t) => !t.archived);
    if (!S.showClosed) tasks = tasks.filter((t) => t.statusType !== 'closed');
    if (q) tasks = tasks.filter((t) => (t.title + ' ' + t.tags.join(' ') + ' ' + t.description).toLowerCase().includes(q));
    if (f.assignees.length) tasks = tasks.filter((t) => f.assignees.some((a) => a === '__none' ? !t.assignees.length : t.assignees.includes(a)));
    if (f.priorities.length) tasks = tasks.filter((t) => f.priorities.includes(t.priority));
    if (f.tags.length) tasks = tasks.filter((t) => f.tags.some((g) => t.tags.includes(g)));
    if (f.due === 'overdue') tasks = tasks.filter((t) => t.due && t.due < t0 && t.statusType !== 'closed');
    if (f.due === 'today') tasks = tasks.filter((t) => t.due === t0);
    if (f.due === 'week') tasks = tasks.filter((t) => t.due && t.due >= t0 && t.due <= week);
    if (f.due === 'none') tasks = tasks.filter((t) => !t.due);
    return tasks;
  }
  const sortTasks = (a, b) => {
    const s = P.sort || 'position';
    if (s === 'due') return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : a.position - b.position;
    if (s === 'priority') return ((a.priority || 9) - (b.priority || 9)) || a.position - b.position;
    if (s === 'title') return a.title.localeCompare(b.title, 'fr');
    if (s === 'created') return b.createdAt - a.createdAt;
    return a.position - b.position || a.createdAt - b.createdAt;
  };
  function groups(tasks) {
    const by = P.groupBy[scopeKey()] || 'status', single = S.route.page === 'list';
    if (by === 'none') return [{ key: 'all', label: 'Toutes les tâches', tasks }];
    if (by === 'status' && single) return listOf(S.route.id).statuses.map((s) => ({ key: s.key, label: s.name, color: s.color, patch: { status: s.key }, tasks: tasks.filter((t) => t.status === s.key) }));
    if (by === 'status') return ['open', 'active', 'closed'].map((k) => ({ key: k, label: TYPE_LABEL[k], color: { open: '#8C94AD', active: '#2F45D8', closed: '#17865A' }[k], tasks: tasks.filter((t) => t.statusType === k) }));
    if (by === 'priority') return [1, 2, 3, 4, 0].map((p) => ({ key: 'p' + p, label: PRIO[p][0], color: PRIO[p][1] || '#B9C0D3', patch: { priority: p }, tasks: tasks.filter((t) => t.priority === p) }));
    if (by === 'assignee') return [...S.tree.members.map((m) => ({ key: m.id, label: m.name, avatar: m.id, patch: { assignees: [m.id] }, tasks: tasks.filter((t) => t.assignees.includes(m.id)) })), { key: 'none', label: 'Non assignées', patch: { assignees: [] }, tasks: tasks.filter((t) => !t.assignees.length) }];
    if (by === 'due') { const t0 = today(), w = addDays(t0, 7); return [['late', 'En retard', '#D23B2E', (t) => t.due && t.due < t0], ['today', 'Aujourd’hui', '#D98A0B', (t) => t.due === t0], ['week', '7 prochains jours', '#2F45D8', (t) => t.due > t0 && t.due <= w], ['later', 'Plus tard', '#5D6584', (t) => t.due > w], ['nodate', 'Sans échéance', '#B9C0D3', (t) => !t.due]].map(([key, label, color, fn]) => ({ key, label, color, tasks: tasks.filter(fn) })); }
    if (by === 'list') return S.tree.lists.filter((l) => tasks.some((t) => t.listId === l.id)).map((l) => ({ key: l.id, label: l.name, color: l.color || spaceOf(l.spaceId)?.color, tasks: tasks.filter((t) => t.listId === l.id) }));
    return [{ key: 'all', label: 'Toutes', tasks }];
  }

  function tasksPage() {
    const info = scopeInfo(), m = mode(), all = visibleTasks();
    const top = all.filter((t) => !t.parentId || !S.showSub || !all.some((p) => p.id === t.parentId));
    const f = S.filters, nf = f.assignees.length + f.priorities.length + f.tags.length + (f.due ? 1 : 0);
    const by = P.groupBy[scopeKey()] || 'status';
    const list = S.route.page === 'list' ? listOf(S.route.id) : null;
    return `<header class="pm-head">
        <div class="pm-title"><span class="pm-crumbs">${info.crumbs.map(esc).join(' › ')}</span><h1><i class="pm-dot lg" style="--c:${info.color || '#8C94AD'}"></i>${esc(info.title)}</h1>${info.desc ? `<p class="hint">${esc(info.desc)}</p>` : ''}</div>
        <div class="pm-head-actions"><span id="pmPresence"></span>${list ? `<button class="btn" data-pm="chat">💬 Discussion<span id="pmChatDot"></span></button><button class="btn" data-pm="listSettings" data-id="${list.id}">${ic('settings')}<span>Statuts et champs</span></button>` : ''}
          ${S.route.page !== 'mine' ? `<button class="btn primary" data-pm="newTask">${ic('plus')}<span>Tâche</span></button>` : ''}</div></header>
      <div class="pm-tabs" role="tablist">${MODES.map(([k, l]) => `<button role="tab" aria-selected="${m === k}" data-pm="mode" data-id="${k}">${l}</button>`).join('')}
        ${S.views.map((v) => `<button class="pm-saved ${S.activeView === v.id ? 'on' : ''}" data-pm="applyView" data-id="${v.id}" title="Vue enregistrée${v.shared ? ' (partagée)' : ''}">★ ${esc(v.name)}<span data-pm="delView" data-id="${v.id}" aria-label="Supprimer la vue">×</span></button>`).join('')}
        <button class="pm-saved add" data-pm="saveView">+ Enregistrer la vue</button></div>
      <div class="pm-toolbar">
        <div class="input-wrap pm-search">${ic('search')}<input class="input sm" type="search" placeholder="Rechercher une tâche" value="${esc(f.q)}" data-pm-input="q"></div>
        <button class="btn sm ${nf ? 'active' : ''}" data-menu data-pm="filters">⏷ Filtres${nf ? ` <b>${nf}</b>` : ''}</button>
        ${m !== 'calendar' && m !== 'gantt' ? `<label class="pm-sel">Grouper<select class="input sm" data-pm-change="groupBy">${[['status', 'Statut'], ['assignee', 'Responsable'], ['priority', 'Priorité'], ['due', 'Échéance'], ...(S.route.page !== 'list' ? [['list', 'Liste']] : []), ['none', 'Aucun']].map(([k, l]) => `<option value="${k}" ${by === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="pm-sel">Trier<select class="input sm" data-pm-change="sort">${[['position', 'Manuel'], ['due', 'Échéance'], ['priority', 'Priorité'], ['title', 'Nom'], ['created', 'Création']].map(([k, l]) => `<option value="${k}" ${(P.sort || 'position') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <button class="btn sm ${f.assignees.length === 1 && f.assignees[0] === S.me.id ? 'active' : ''}" data-pm="onlyMe">👤 Moi</button>
        <label class="pm-check"><input type="checkbox" data-pm-change="closed" ${S.showClosed ? 'checked' : ''}> Terminées</label>
        <label class="pm-check"><input type="checkbox" data-pm-change="sub" ${S.showSub ? 'checked' : ''}> Sous-tâches</label>
      </div>
      ${S.sel.size ? bulkBar() : ''}
      <div class="pm-view pm-v-${m}">${{ list: listView, board: boardView, table: tableView, calendar: calendarView, gantt: ganttView }[m](top, all)}</div>
      ${S.chatOpen && list ? chatPanel() : ''}`;
  }
  function bulkBar() {
    return `<div class="pm-bulk"><b>${S.sel.size} sélectionnée${S.sel.size > 1 ? 's' : ''}</b>
      <button class="btn sm" data-menu data-pm="bulk" data-id="status">Statut</button><button class="btn sm" data-menu data-pm="bulk" data-id="assignees">Responsables</button>
      <button class="btn sm" data-menu data-pm="bulk" data-id="priority">Priorité</button><button class="btn sm" data-pm="bulk" data-id="due">Échéance</button>
      <button class="btn sm" data-menu data-pm="bulk" data-id="move">Déplacer</button><button class="btn sm" data-pm="bulk" data-id="archive">Archiver</button>
      <button class="btn sm danger" data-pm="bulk" data-id="delete">Supprimer</button><button class="btn sm ghost" data-pm="clearSel">Annuler</button></div>`;
  }

  /* ---------- Éléments d'une tâche ---------- */
  function dueHtml(t) {
    if (!t.due && !t.start) return '';
    const late = t.due && t.due < today() && t.statusType !== 'closed', soon = t.due === today();
    return `<span class="pm-due ${late ? 'late' : soon ? 'soon' : ''}" title="${t.start ? 'Début ' + fmtDate(t.start) + ' · ' : ''}Échéance ${fmtDate(t.due) || '—'}">${t.start && t.due ? `${fmtDate(t.start)} → ` : ''}${fmtDate(t.due) || fmtDate(t.start)}</span>`;
  }
  const metaBits = (t) => [
    t.subtasks.total ? `<span title="Sous-tâches">⑂ ${t.subtasks.done}/${t.subtasks.total}</span>` : '',
    t.checklist.total ? `<span title="Checklist" class="${t.checklist.done === t.checklist.total ? 'ok' : ''}">☑ ${t.checklist.done}/${t.checklist.total}</span>` : '',
    t.comments ? `<span title="Commentaires">💬 ${t.comments}</span>` : '',
    t.blockedBy.length ? `<span class="pm-blocked" title="Bloquée par ${t.blockedBy.length} tâche(s)">⛔ ${t.blockedBy.length}</span>` : '',
    t.recurrence ? `<span title="${REC[t.recurrence]}">🔁</span>` : '',
    t.timeSpent ? `<span title="Temps passé">⏱ ${fmtMin(t.timeSpent)}</span>` : '',
  ].join('');
  const tagsHtml = (t) => t.tags.map((g) => `<span class="pm-tag" style="background:${tagColor(g)}">${esc(g)}</span>`).join('');
  const avs = (ids) => `<span class="pm-avs">${ids.slice(0, 3).map((a) => av(a)).join('')}${ids.length > 3 ? `<span class="pm-av more">+${ids.length - 3}</span>` : ''}</span>`;

  function row(t, all, depth = 0) {
    const s = statusOf(t), subs = S.showSub ? all.filter((x) => x.parentId === t.id).sort(sortTasks) : [];
    const listName = S.route.page !== 'list' ? `<span class="pm-in">${esc(listOf(t.listId)?.name || '')}</span>` : '';
    return `<div class="pm-row ${t.statusType === 'closed' ? 'closed' : ''} ${S.detail === t.id ? 'open' : ''}" data-task="${t.id}" style="--d:${depth}" draggable="true">
        <input type="checkbox" class="pm-selbox" data-pm-change="sel" data-id="${t.id}" ${S.sel.has(t.id) ? 'checked' : ''} aria-label="Sélectionner">
        <button class="pm-status" data-menu data-pm="status" data-id="${t.id}" style="--c:${s.color}" title="${esc(s.name)}" aria-label="Statut : ${esc(s.name)}"></button>
        <button class="pm-name" data-pm="openTask" data-id="${t.id}">${t.milestone ? '<span class="pm-ms" title="Jalon">◆</span>' : ''}${esc(t.title)}</button>
        <span class="pm-meta">${metaBits(t)}${tagsHtml(t)}${listName}</span>
        <button class="pm-cell" data-menu data-pm="assignees" data-id="${t.id}" aria-label="Responsables">${t.assignees.length ? avs(t.assignees) : '<span class="pm-add-av">+</span>'}</button>
        <button class="pm-cell pm-cdue" data-pm="due" data-id="${t.id}" aria-label="Échéance">${dueHtml(t) || '<span class="pm-faint">Échéance</span>'}</button>
        <button class="pm-cell" data-menu data-pm="priority" data-id="${t.id}" aria-label="Priorité">${flag(t.priority) || '<span class="pm-faint">—</span>'}</button>
      </div>${subs.map((x) => row(x, all, depth + 1)).join('')}`;
  }
  function listView(top, all) {
    const gs = groups(top.sort(sortTasks)), by = P.groupBy[scopeKey()] || 'status', canAdd = S.route.page !== 'mine';
    if (!S.tasks.length && S.route.page !== 'list') return emptyTasks();   // une liste vide garde ses statuts et la saisie rapide
    return gs.map((g) => {
      const col = P.collapsed['g' + scopeKey() + g.key];
      if (!g.tasks.length && by !== 'status') return '';
      return `<section class="pm-group" data-group="${esc(g.key)}" data-drop-group='${esc(JSON.stringify(g.patch || null))}'>
        <header class="pm-ghead"><button class="pm-caret ${col ? '' : 'open'}" data-pm="toggle" data-id="g${scopeKey()}${esc(g.key)}">▸</button>
          ${g.avatar ? av(g.avatar) : `<span class="pm-pill" style="--c:${g.color || '#8C94AD'}">${esc(g.label)}</span>`}${g.avatar ? `<b>${esc(g.label)}</b>` : ''}<span class="pm-count">${g.tasks.length}</span></header>
        ${col ? '' : `<div class="pm-rows">${g.tasks.map((t) => row(t, all)).join('')}
          ${canAdd ? `<form class="pm-quick" data-pm-form="quick" data-patch='${esc(JSON.stringify(g.patch || {}))}'><span>+</span><input class="input sm" name="title" placeholder="Nouvelle tâche, puis Entrée" aria-label="Nouvelle tâche dans ${esc(g.label)}"></form>` : ''}</div>`}
      </section>`;
    }).join('') || '<div class="empty"><strong>Aucune tâche ne correspond aux filtres</strong></div>';
  }
  const emptyTasks = () => `<div class="empty pm-empty"><strong>${S.route.page === 'mine' ? 'Aucune tâche ne t’est assignée' : 'Aucune tâche pour l’instant'}</strong><span>${S.route.page === 'mine' ? 'Les tâches dont tu es responsable, dans toutes les listes, apparaîtront ici.' : 'Crée la première tâche pour lancer le projet.'}</span>${S.route.page !== 'mine' ? '<button class="btn primary" data-pm="newTask">Créer une tâche</button>' : ''}</div>`;

  function boardView(top) {
    const gs = groups(top.sort(sortTasks)).filter((g) => g.tasks.length || g.patch);
    return `<div class="pm-board">${gs.map((g) => `<section class="pm-col" data-drop-group='${esc(JSON.stringify(g.patch || null))}' data-group="${esc(g.key)}">
        <header>${g.avatar ? av(g.avatar) : `<i class="pm-dot" style="--c:${g.color || '#8C94AD'}"></i>`}<b>${esc(g.label)}</b><span class="pm-count">${g.tasks.length}</span></header>
        <div class="pm-cards">${g.tasks.map((t) => `<article class="pm-card ${t.statusType === 'closed' ? 'closed' : ''}" draggable="true" data-task="${t.id}">
            ${t.tags.length ? `<div class="pm-card-tags">${tagsHtml(t)}</div>` : ''}
            <button class="pm-name" data-pm="openTask" data-id="${t.id}">${t.milestone ? '<span class="pm-ms">◆</span>' : ''}${esc(t.title)}</button>
            ${S.route.page !== 'list' ? `<span class="pm-in">${esc(listOf(t.listId)?.name || '')}</span>` : ''}
            <div class="pm-card-foot">${avs(t.assignees)}${dueHtml(t)}${flag(t.priority)}<span class="pm-meta">${metaBits(t)}</span></div></article>`).join('')}</div>
        ${S.route.page !== 'mine' && g.patch !== null ? `<form class="pm-quick" data-pm-form="quick" data-patch='${esc(JSON.stringify(g.patch || {}))}'><span>+</span><input class="input sm" name="title" placeholder="Ajouter une tâche" aria-label="Ajouter une tâche dans ${esc(g.label)}"></form>` : ''}
      </section>`).join('')}</div>`;
  }

  function tableView(top, all) {
    const fields = S.meta?.fields || [], rows = (S.showSub ? all : top).sort(sortTasks);
    if (!S.tasks.length) return emptyTasks();
    const cell = (t, f) => {
      const v = t.custom[f.id];
      if (f.type === 'checkbox') return `<input type="checkbox" data-pm-change="custom" data-id="${t.id}" data-f="${f.id}" ${v ? 'checked' : ''} aria-label="${esc(f.name)}">`;
      if (f.type === 'select') return `<select class="pm-inline" data-pm-change="custom" data-id="${t.id}" data-f="${f.id}" aria-label="${esc(f.name)}"><option value="">—</option>${f.options.map((o) => `<option value="${esc(o.id)}" ${v === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
      if (f.type === 'date') return `<input class="pm-inline" type="date" value="${esc(v || '')}" data-pm-change="custom" data-id="${t.id}" data-f="${f.id}" aria-label="${esc(f.name)}">`;
      if (f.type === 'url') return v ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v.replace(/^https?:\/\//, '').slice(0, 28))}</a>` : `<input class="pm-inline" placeholder="https://" data-pm-change="custom" data-id="${t.id}" data-f="${f.id}" aria-label="${esc(f.name)}">`;
      return `<input class="pm-inline ${f.type === 'number' ? 'num' : ''}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(v ?? '')}" data-pm-change="custom" data-id="${t.id}" data-f="${f.id}" aria-label="${esc(f.name)}">`;
    };
    const sums = fields.filter((f) => f.type === 'number').map((f) => [f.id, rows.reduce((a, t) => a + (Number(t.custom[f.id]) || 0), 0)]);
    return `<div class="pm-table-wrap"><table class="pm-table"><thead><tr><th class="w-sel"></th><th>Tâche</th><th>Statut</th><th>Responsables</th><th>Priorité</th><th>Début</th><th>Échéance</th><th>Estimation</th><th>Temps passé</th><th>Étiquettes</th>${fields.map((f) => `<th title="${FIELD_LABEL[f.type]}">${esc(f.name)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((t) => { const s = statusOf(t); return `<tr data-task="${t.id}" class="${t.statusType === 'closed' ? 'closed' : ''}">
        <td><input type="checkbox" data-pm-change="sel" data-id="${t.id}" ${S.sel.has(t.id) ? 'checked' : ''} aria-label="Sélectionner"></td>
        <td class="pm-tname" style="--d:${t.parentId ? 1 : 0}"><input class="pm-inline title" value="${esc(t.title)}" data-pm-change="title" data-id="${t.id}" aria-label="Titre"><button class="icon-btn sm" data-pm="openTask" data-id="${t.id}" aria-label="Ouvrir">↗</button></td>
        <td><button class="pm-pill sm" data-menu data-pm="status" data-id="${t.id}" style="--c:${s.color}">${esc(s.name)}</button></td>
        <td><button class="pm-cell" data-menu data-pm="assignees" data-id="${t.id}">${t.assignees.length ? avs(t.assignees) : '<span class="pm-add-av">+</span>'}</button></td>
        <td><button class="pm-cell" data-menu data-pm="priority" data-id="${t.id}">${flag(t.priority)}${t.priority ? PRIO[t.priority][0] : '<span class="pm-faint">—</span>'}</button></td>
        <td><input class="pm-inline" type="date" value="${t.start}" data-pm-change="start" data-id="${t.id}" aria-label="Début"></td>
        <td><input class="pm-inline ${t.due && t.due < today() && t.statusType !== 'closed' ? 'late' : ''}" type="date" value="${t.due}" data-pm-change="dueDate" data-id="${t.id}" aria-label="Échéance"></td>
        <td><input class="pm-inline num" value="${t.estimate ? fmtMin(t.estimate) : ''}" placeholder="—" data-pm-change="estimate" data-id="${t.id}" aria-label="Estimation"></td>
        <td class="num">${t.timeSpent ? fmtMin(t.timeSpent) : '—'}</td><td>${tagsHtml(t)}</td>${fields.map((f) => `<td>${cell(t, f)}</td>`).join('')}</tr>`; }).join('')}</tbody>
      <tfoot><tr><td></td><td>${rows.length} tâche${rows.length > 1 ? 's' : ''}</td><td></td><td></td><td></td><td></td><td></td><td class="num">${fmtMin(rows.reduce((a, t) => a + t.estimate, 0))}</td><td class="num">${fmtMin(rows.reduce((a, t) => a + t.timeSpent, 0))}</td><td></td>${fields.map((f) => `<td class="num">${sums.find(([id]) => id === f.id) ? `Σ ${sums.find(([id]) => id === f.id)[1].toLocaleString('fr-FR')}` : ''}</td>`).join('')}</tr></tfoot></table></div>`;
  }

  function calendarView(top) {
    const ref = S.cal || (S.cal = new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const first = new Date(ref.getFullYear(), ref.getMonth(), 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const days = [...Array(42)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return iso(d); });
    const noDate = top.filter((t) => !t.due);
    return `<div class="pm-cal-head"><button class="btn sm" data-pm="cal" data-id="-1" aria-label="Mois précédent">‹</button><b>${first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</b><button class="btn sm" data-pm="cal" data-id="1" aria-label="Mois suivant">›</button><button class="btn sm ghost" data-pm="cal" data-id="0">Aujourd’hui</button></div>
      <div class="pm-cal">${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d) => `<div class="pm-cal-dow">${d}</div>`).join('')}
      ${days.map((d) => { const items = top.filter((t) => t.due === d); return `<div class="pm-cal-day ${d.slice(0, 7) !== iso(first).slice(0, 7) ? 'out' : ''} ${d === today() ? 'today' : ''}" data-drop-day="${d}">
        <div class="pm-cal-num"><span>${Number(d.slice(8))}</span><button data-pm="newTask" data-id="${d}" aria-label="Ajouter une tâche le ${d}">+</button></div>
        ${items.slice(0, 4).map((t) => `<button class="pm-cal-item ${t.statusType === 'closed' ? 'closed' : ''}" draggable="true" data-task="${t.id}" data-pm="openTask" data-id="${t.id}" style="--c:${statusOf(t).color}">${t.milestone ? '◆ ' : ''}${esc(t.title)}</button>`).join('')}
        ${items.length > 4 ? `<span class="pm-faint">+${items.length - 4} autres</span>` : ''}</div>`; }).join('')}</div>
      ${noDate.length ? `<details class="pm-nodate"><summary>${noDate.length} tâche${noDate.length > 1 ? 's' : ''} sans échéance (glisse-les sur un jour)</summary><div>${noDate.map((t) => `<button class="pm-cal-item" draggable="true" data-task="${t.id}" data-pm="openTask" data-id="${t.id}" style="--c:${statusOf(t).color}">${esc(t.title)}</button>`).join('')}</div></details>` : ''}`;
  }

  function ganttView(top, all) {
    const tasks = (S.showSub ? all : top).sort((a, b) => ((a.start || a.due || '9') < (b.start || b.due || '9') ? -1 : 1));
    const dated = tasks.filter((t) => t.due || t.start), undated = tasks.filter((t) => !t.due && !t.start);
    const zoom = P.zoom || 'week', W = zoom === 'day' ? 40 : zoom === 'week' ? 22 : 8;
    const t0 = today();
    const dates = dated.flatMap((t) => [t.start || t.due, t.due || t.start]);
    let from = addDays(dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : t0, -7); if (from > addDays(t0, -7)) from = addDays(t0, -7);
    let to = addDays(dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : t0, 21); if (to < addDays(t0, 30)) to = addDays(t0, 30);
    const n = diffDays(from, to) + 1, x = (d) => diffDays(from, d) * W;
    const months = []; for (let i = 0; i < n; i++) { const d = addDays(from, i); if (i === 0 || d.endsWith('-01')) months.push([i, new Date(d + 'T12:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })]); }
    const rowH = 36, idx = new Map(dated.map((t, i) => [t.id, i]));
    const arrows = dated.flatMap((t) => t.blockedBy.filter((b) => idx.has(b)).map((b) => {
      const B = dated[idx.get(b)], x1 = x(B.due || B.start) + W, y1 = idx.get(b) * rowH + rowH / 2, x2 = x(t.start || t.due), y2 = idx.get(t.id) * rowH + rowH / 2;
      return `<path d="M${x1} ${y1} H${x1 + 8} V${y2} H${x2 - 2}" class="pm-arrow" marker-end="url(#pmArrowHead)"/>`;
    })).join('');
    return `<div class="pm-gantt-head"><div class="segmented" role="group" aria-label="Échelle">${[['day', 'Jours'], ['week', 'Semaines'], ['month', 'Mois']].map(([k, l]) => `<button aria-pressed="${zoom === k}" data-pm="zoom" data-id="${k}">${l}</button>`).join('')}</div>
        <span class="hint">Glisse une barre pour la déplacer, son bord droit pour changer l’échéance.</span></div>
      <div class="pm-gantt" style="--w:${W}px;--rh:${rowH}px">
        <div class="pm-gantt-names"><div class="pm-gantt-corner">Tâche</div>${dated.map((t) => `<button class="pm-gantt-name" data-pm="openTask" data-id="${t.id}" style="--d:${t.parentId ? 1 : 0}"><i class="pm-dot" style="--c:${statusOf(t).color}"></i>${esc(t.title)}</button>`).join('')}</div>
        <div class="pm-gantt-scroll" id="pmGanttScroll"><div class="pm-gantt-grid" style="width:${n * W}px">
          <div class="pm-gantt-scale">${months.map(([i, l]) => `<span class="pm-month" style="left:${i * W}px">${l}</span>`).join('')}
            ${[...Array(n)].map((_, i) => { const d = addDays(from, i), dow = new Date(d + 'T12:00').getDay(); return zoom === 'month' ? '' : `<span class="pm-dayc ${dow === 0 || dow === 6 ? 'we' : ''}" style="left:${i * W}px;width:${W}px">${zoom === 'day' || dow === 1 ? Number(d.slice(8)) : ''}</span>`; }).join('')}</div>
          <div class="pm-gantt-body" style="height:${dated.length * rowH}px">
            ${zoom !== 'month' ? [...Array(n)].map((_, i) => { const dow = new Date(addDays(from, i) + 'T12:00').getDay(); return dow === 0 || dow === 6 ? `<i class="pm-we" style="left:${i * W}px;width:${W}px"></i>` : ''; }).join('') : ''}
            <i class="pm-today" style="left:${x(t0) + W / 2}px" title="Aujourd’hui"></i>
            <svg class="pm-arrows" width="${n * W}" height="${dated.length * rowH}"><defs><marker id="pmArrowHead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="currentColor"/></marker></defs>${arrows}</svg>
            ${dated.map((t, i) => { const s = t.start || t.due, e = t.due || t.start, st = statusOf(t), w = (diffDays(s, e) + 1) * W;
              return t.milestone ? `<button class="pm-ms-bar" data-gantt="${t.id}" data-pm="openTask" data-id="${t.id}" style="left:${x(e) + W / 2 - 9}px;top:${i * rowH + 9}px;--c:${st.color}" title="${esc(t.title)} — ${fmtDate(e)}"></button>`
                : `<div class="pm-bar ${t.statusType === 'closed' ? 'closed' : ''}" data-gantt="${t.id}" style="left:${x(s)}px;top:${i * rowH + 7}px;width:${w}px;--c:${st.color}" title="${esc(t.title)} : ${fmtDate(s)} → ${fmtDate(e)}">
                  <span>${esc(t.title)}</span><i class="pm-bar-r" data-resize="r"></i></div>`; }).join('')}
          </div></div></div></div>
      ${undated.length ? `<details class="pm-nodate"><summary>${undated.length} tâche${undated.length > 1 ? 's' : ''} sans dates</summary><div>${undated.map((t) => `<button class="pm-cal-item" data-pm="planTask" data-id="${t.id}" style="--c:${statusOf(t).color}">${esc(t.title)} · <u>Planifier sur 3 jours</u></button>`).join('')}</div></details>` : ''}`;
  }

  /* ---------- Discussion (chat temps réel de la liste) ---------- */
  function chatPanel() {
    return `<aside class="pm-chat" id="pmChat"><header><b>Discussion</b><button class="icon-btn sm" data-pm="chat" aria-label="Fermer">✕</button></header><div class="pm-chat-msgs" id="pmChatMsgs">${chatMsgs()}</div>
      <form data-pm-form="chat"><input class="input sm" name="body" maxlength="2000" placeholder="Écrire à l’équipe…" autocomplete="off" aria-label="Message"><button class="btn primary sm">Envoyer</button></form></aside>`;
  }
  const chatMsgs = () => S.messages.length ? S.messages.map((m) => `<div class="pm-msg ${m.userId === S.me.id ? 'me' : ''}">${m.userId === S.me.id ? '' : `<b>${esc(m.name)}</b>`}<p>${md(m.body)}</p><time>${new Date(m.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time></div>`).join('') : '<p class="hint">Aucun message. Lance la discussion avec ton équipe.</p>';
  function renderChat() { const el = S.root?.querySelector('#pmChatMsgs'); if (el) { el.innerHTML = chatMsgs(); el.scrollTop = el.scrollHeight; } }
  function markChat() { const d = S.root?.querySelector('#pmChatDot'); if (d) d.className = 'pm-unread'; }
  function renderPresence() { const el = S.root?.querySelector('#pmPresence'); if (el) el.innerHTML = S.online.filter((u) => u !== S.me.id).map((u) => av(u, 'online')).join(''); }

  /* =========================================================
     Détail d'une tâche (panneau latéral)
     ========================================================= */
  async function openDetail(id) { S.detail = id; S.root.querySelector('.pm')?.classList.add('has-detail'); await loadDetail(id); S.root.querySelectorAll('.pm-row.open').forEach((r) => r.classList.remove('open')); S.root.querySelector(`.pm-row[data-task="${id}"]`)?.classList.add('open'); }
  function closeDetail() { S.detail = null; S.dd = null; const p = S.root?.querySelector('.pm'); p?.classList.remove('has-detail'); const d = S.root?.querySelector('#pmDetail'); if (d) d.innerHTML = ''; S.root?.querySelectorAll('.pm-row.open').forEach((r) => r.classList.remove('open')); }
  async function loadDetail(id, quiet) {
    try { S.dd = await api('GET', `/pm/tasks/${id}`); } catch (e) { if (!quiet) fail(e); closeDetail(); return; }
    if (S.detail === id) renderDetail();
  }
  function renderDetail() {
    const el = S.root?.querySelector('#pmDetail'); if (!el || !S.dd) return;
    const d = S.dd, t = d.task, s = d.statuses.find((x) => x.key === t.status) || {}, l = listOf(t.listId), sp = spaceOf(l?.spaceId);
    const watching = d.watchers.includes(S.me.id), running = S.tree.running?.taskId === t.id;
    const tab = S.dTab || 'comments';
    const focused = document.activeElement?.closest('#pmDetail') ? document.activeElement.dataset.key : null;
    el.innerHTML = `<header class="pm-d-head"><span class="pm-crumbs">${esc(sp?.name || '')} › ${esc(l?.name || '')}${t.parentId ? ' › sous-tâche' : ''}</span>
        <div class="pm-d-actions"><button class="icon-btn sm ${watching ? 'on' : ''}" data-pm="watch" title="${watching ? 'Ne plus suivre' : 'Suivre'}" aria-label="Suivre">${watching ? '🔔' : '🔕'}</button>
        <button class="icon-btn sm" data-menu data-pm="taskMenu" aria-label="Plus d’actions">⋯</button><button class="icon-btn sm" data-pm="closeDetail" aria-label="Fermer">✕</button></div></header>
      <div class="pm-d-body">
        ${t.parentId ? `<button class="link-btn" data-pm="openTask" data-id="${t.parentId}">↖ Tâche parente</button>` : ''}
        <textarea class="pm-d-title" rows="1" data-key="title" data-pm-change="dTitle" maxlength="250" aria-label="Titre">${esc(t.title)}</textarea>
        <div class="pm-props">
          <span>Statut</span><div><button class="pm-pill" data-menu data-pm="dStatus" style="--c:${s.color}">${esc(s.name || t.status)}</button>
            ${t.statusType !== 'closed' ? `<button class="btn sm ghost" data-pm="dClose">✓ Terminer</button>` : ''}</div>
          <span>Responsables</span><div><button class="pm-cell" data-menu data-pm="dAssignees">${t.assignees.length ? t.assignees.map((a) => `${av(a)}<span class="pm-pname">${esc(member(a)?.name || '')}</span>`).join('') : '<span class="pm-faint">+ Assigner</span>'}</button></div>
          <span>Dates</span><div class="pm-dates"><input class="input sm" type="date" value="${t.start}" data-pm-change="dStart" aria-label="Début"><span>→</span><input class="input sm ${t.due && t.due < today() && t.statusType !== 'closed' ? 'late' : ''}" type="date" value="${t.due}" data-pm-change="dDue" aria-label="Échéance"></div>
          <span>Priorité</span><div><button class="pm-cell" data-menu data-pm="dPriority">${flag(t.priority)}${t.priority ? PRIO[t.priority][0] : '<span class="pm-faint">Aucune</span>'}</button></div>
          <span>Temps</span><div class="pm-time"><b>${fmtMin(t.timeSpent)}</b>${t.estimate ? `<span class="pm-faint">/ ${fmtMin(t.estimate)} estimées</span><span class="meter"><i style="width:${Math.min(100, Math.round(t.timeSpent / t.estimate * 100))}%;${t.timeSpent > t.estimate ? 'background:var(--danger)' : ''}"></i></span>` : ''}
            <button class="btn sm ${running ? 'danger' : ''}" data-pm="${running ? 'stopTimer' : 'startTimer'}">${running ? '■ Arrêter' : '▶ Démarrer'}</button><button class="btn sm ghost" data-pm="addTime">+ Saisir</button>
            <input class="input sm pm-est" placeholder="Estimation (ex. 2h30)" value="${t.estimate ? fmtMin(t.estimate) : ''}" data-pm-change="dEstimate" aria-label="Estimation"></div>
          <span>Étiquettes</span><div class="pm-tags-edit">${tagsHtml(t)}<input class="input sm" list="pmTags" placeholder="+ étiquette" data-pm-form-input="tag" aria-label="Ajouter une étiquette"><datalist id="pmTags">${S.tree.tags.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
            ${t.tags.length ? `<button class="link-btn" data-pm="clearTags">effacer</button>` : ''}</div>
          <span>Options</span><div class="pm-opts"><label class="pm-check"><input type="checkbox" data-pm-change="dMilestone" ${t.milestone ? 'checked' : ''}> Jalon</label>
            <label class="pm-sel">Récurrence<select class="input sm" data-pm-change="dRecurrence">${Object.entries(REC).map(([k, v]) => `<option value="${k}" ${t.recurrence === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
          ${d.fields.map((f) => `<span>${esc(f.name)}</span><div>${fieldInput(f, t.custom[f.id])}</div>`).join('')}
        </div>
        <section class="pm-d-sec"><h3>Description</h3>
          <div class="pm-desc ${S.editDesc ? 'editing' : ''}">${S.editDesc ? `<textarea class="input" rows="8" data-key="desc" data-pm-change="dDesc" placeholder="Décris la tâche… (Markdown : **gras**, - liste, - [ ] case, [lien](https://…), @mention)">${esc(t.description)}</textarea><div class="pm-row-actions"><button class="btn sm primary" data-pm="descDone">Terminé</button></div>`
            : `<div class="pm-md" data-pm="descEdit" role="button" tabindex="0" aria-label="Modifier la description">${t.description ? md(t.description) : '<span class="pm-faint">Ajouter une description…</span>'}</div>`}</div></section>
        <section class="pm-d-sec"><h3>Sous-tâches <span class="pm-count">${d.subtasks.length}</span></h3>
          ${d.subtasks.map((x) => { const xs = d.statuses.find((y) => y.key === x.status) || {}; return `<div class="pm-sub ${x.statusType === 'closed' ? 'closed' : ''}"><button class="pm-status" data-menu data-pm="status" data-id="${x.id}" style="--c:${xs.color}" aria-label="Statut ${esc(xs.name || '')}"></button><button class="pm-name" data-pm="openTask" data-id="${x.id}">${esc(x.title)}</button>${avs(x.assignees)}${dueHtml(x)}</div>`; }).join('')}
          ${t.parentId ? '' : `<form class="pm-quick" data-pm-form="subtask"><span>+</span><input class="input sm" name="title" placeholder="Ajouter une sous-tâche" aria-label="Nouvelle sous-tâche"></form>`}</section>
        <section class="pm-d-sec"><h3>Checklist <span class="pm-count">${d.checklist.filter((c) => c.done).length}/${d.checklist.length}</span></h3>
          ${d.checklist.length ? `<span class="meter"><i style="width:${Math.round(d.checklist.filter((c) => c.done).length / d.checklist.length * 100)}%"></i></span>` : ''}
          ${d.checklist.map((c) => `<label class="pm-chk ${c.done ? 'done' : ''}"><input type="checkbox" data-pm-change="chk" data-id="${c.id}" ${c.done ? 'checked' : ''}><span>${esc(c.text)}</span><button class="icon-btn sm" data-pm="chkDel" data-id="${c.id}" aria-label="Supprimer l’élément">✕</button></label>`).join('')}
          <form class="pm-quick" data-pm-form="check"><span>+</span><input class="input sm" name="text" placeholder="Ajouter un élément" aria-label="Nouvel élément de checklist"></form></section>
        <section class="pm-d-sec"><h3>Dépendances</h3>
          ${d.blockedBy.map((b) => `<div class="pm-dep ${b.closed ? 'ok' : 'wait'}"><span>${b.closed ? '✓' : '⛔'} Bloquée par</span><button class="pm-name" data-pm="openTask" data-id="${b.id}">${esc(b.title)}</button><small>${esc(b.statusName || '')}</small><button class="icon-btn sm" data-pm="depDel" data-id="${b.id}" aria-label="Retirer la dépendance">✕</button></div>`).join('')}
          ${d.blocking.map((b) => `<div class="pm-dep"><span>↪ Bloque</span><button class="pm-name" data-pm="openTask" data-id="${b.id}">${esc(b.title)}</button><small>${esc(b.statusName || '')}</small></div>`).join('')}
          <button class="btn sm ghost" data-menu data-pm="depAdd">+ Bloquée par une tâche…</button></section>
        <div class="pm-d-tabs" role="tablist"><button role="tab" aria-selected="${tab === 'comments'}" data-pm="dTab" data-id="comments">Commentaires (${d.comments.length})</button><button role="tab" aria-selected="${tab === 'activity'}" data-pm="dTab" data-id="activity">Activité</button><button role="tab" aria-selected="${tab === 'time'}" data-pm="dTab" data-id="time">Temps (${d.time.length})</button></div>
        ${tab === 'comments' ? `<div class="pm-comments">${d.comments.map((c) => `<div class="pm-comment">${av(c.userId)}<div><b>${esc(c.name)}</b> <time>${K().timeAgo(c.createdAt)}${c.editedAt ? ' · modifié' : ''}</time>${c.userId === S.me.id ? `<button class="link-btn" data-pm="comDel" data-id="${c.id}">supprimer</button>` : ''}<div class="pm-md">${md(c.body)}</div></div></div>`).join('') || '<p class="hint">Aucun commentaire.</p>'}
            <form class="pm-comment-form" data-pm-form="comment"><textarea class="input" name="body" rows="2" maxlength="5000" placeholder="Commenter… (@identifiant pour mentionner)" aria-label="Commentaire"></textarea><button class="btn primary sm">Envoyer</button></form>
            <p class="hint pm-mentions">Mentionner : ${S.tree.members.filter((m) => m.id !== S.me.id).map((m) => `<button class="link-btn" data-pm="mention" data-id="${esc(m.handle)}">@${esc(m.handle)}</button>`).join(' ')}</p></div>`
        : tab === 'activity' ? `<ul class="pm-activity">${d.activity.map((a) => `<li><b>${esc(a.name)}</b> ${activityText(a, d)} <time>${K().timeAgo(a.createdAt)}</time></li>`).join('')}</ul>`
        : `<ul class="pm-activity">${d.time.map((m) => `<li><b>${esc(m.name)}</b> ${m.endedAt ? fmtMin(m.minutes) : '<i>en cours…</i>'} <span class="pm-faint">${new Date(m.startedAt).toLocaleDateString('fr-FR')}</span> ${esc(m.note || '')} ${m.userId === S.me.id && m.endedAt ? `<button class="link-btn" data-pm="timeDel" data-id="${m.id}">supprimer</button>` : ''}</li>`).join('') || '<p class="hint">Aucun temps enregistré.</p>'}</ul>`}
      </div>`;
    const ta = el.querySelector('.pm-d-title'); const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; fit(); ta.addEventListener('input', fit);
    if (focused) el.querySelector(`[data-key="${focused}"]`)?.focus();
  }
  const fieldInput = (f, v) => {
    const a = `data-pm-change="dCustom" data-f="${f.id}" aria-label="${esc(f.name)}"`;
    if (f.type === 'checkbox') return `<input type="checkbox" ${a} ${v ? 'checked' : ''}>`;
    if (f.type === 'select') return `<select class="input sm" ${a}><option value="">—</option>${f.options.map((o) => `<option value="${esc(o.id)}" ${v === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    if (f.type === 'date') return `<input class="input sm" type="date" value="${esc(v || '')}" ${a}>`;
    if (f.type === 'number') return `<input class="input sm" inputmode="decimal" value="${esc(v ?? '')}" ${a}>`;
    if (f.type === 'url') return `<input class="input sm" type="url" placeholder="https://" value="${esc(v || '')}" ${a}>${v ? ` <a href="${esc(v)}" target="_blank" rel="noopener noreferrer">ouvrir ↗</a>` : ''}`;
    return `<input class="input sm" value="${esc(v ?? '')}" ${a}>`;
  };
  function activityText(a, d) {
    const st = (k) => esc((d.statuses.find((s) => s.key === k) || {}).name || k), x = a.detail;
    switch (a.kind) {
      case 'created': return x === 'duplicate' ? 'a dupliqué la tâche' : x === 'subtask' ? 'a créé cette sous-tâche' : 'a créé la tâche';
      case 'status': return `a changé le statut : ${st(x.from)} → <b>${st(x.to)}</b>`;
      case 'rename': return `a renommé en « ${esc(x)} »`;
      case 'priority': return `a mis la priorité ${PRIO[x]?.[0] || ''}`;
      case 'due': return x ? `a fixé l’échéance au ${fmtDate(x)}` : 'a retiré l’échéance';
      case 'start': return x ? `a fixé le début au ${fmtDate(x)}` : 'a retiré la date de début';
      case 'assignees': return `a modifié les responsables : ${(x || []).map((i) => esc(member(i)?.name || '?')).join(', ') || 'aucun'}`;
      case 'comment': return `a commenté : « ${esc(x)} »`;
      case 'time': return `a enregistré ${fmtMin(x)}`;
      case 'move': return `a déplacé vers « ${esc(x)} »`;
      case 'dep': return `a ajouté une dépendance : « ${esc(x)} »`;
      case 'archive': return 'a archivé la tâche'; case 'unarchive': return 'a désarchivé la tâche';
      case 'recurred': return 'a créé la prochaine occurrence';
      default: return esc(a.kind);
    }
  }

  /* =========================================================
     Autres pages
     ========================================================= */
  function dashboardPage() {
    if (!S.page?.totals) return '<div class="pm-loading"><span class="pm-spin"></span>Chargement…</div>';
    const d = S.page, t = d.totals, max = Math.max(1, ...d.weeks.map((w) => Math.max(w.done, w.created)));
    const maxLoad = Math.max(1, ...d.workload.map((w) => w.open));
    const item = (x) => `<button class="pm-dash-item" data-pm="openTask" data-id="${x.id}">${flag(x.priority)}<span>${esc(x.title)}</span>${avs(x.assignees)}<span class="pm-due ${x.due < today() ? 'late' : ''}">${fmtDate(x.due)}</span></button>`;
    return `<header class="pm-head"><div class="pm-title"><span class="pm-crumbs">${esc(S.tree.team.name)}</span><h1>Tableau de bord</h1></div>
        <div class="pm-head-actions"><select class="input sm" data-pm-change="dashSpace" aria-label="Périmètre"><option value="">Tout l’espace de travail</option>${S.tree.spaces.map((s) => `<option value="${s.id}" ${S.route.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div></header>
      <div class="pm-kpis">${[['Tâches ouvertes', t.open, ''], ['En retard', t.overdue, t.overdue ? 'bad' : ''], ['À rendre aujourd’hui', t.dueToday, t.dueToday ? 'warn' : ''], ['Non assignées', t.unassigned, ''], ['Terminées', t.done, 'ok'], ['Jalons', t.milestones, '']]
        .map(([l, v, c]) => `<div class="panel pm-kpi ${c}"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      <div class="pm-dash-grid">
        <section class="panel"><h2>Charge de l’équipe</h2><div class="pm-load">${d.workload.map((w) => `<div class="pm-load-row">${av(w.userId)}<span>${esc(w.name)}</span><span class="pm-load-bar"><i style="width:${w.open / maxLoad * 100}%"></i></span><b>${w.open}</b>
          <small>${w.overdue ? `<span class="late">${w.overdue} en retard</span> · ` : ''}${w.estimate ? fmtMin(w.estimate) + ' estimées · ' : ''}${fmtMin(w.minutesWeek)} cette semaine</small></div>`).join('')}</div></section>
        <section class="panel"><h2>Activité des 8 dernières semaines</h2><div class="pm-weeks">${d.weeks.map((w) => `<div title="Semaine du ${fmtDate(addDays(w.end, -6))} : ${w.created} créées, ${w.done} terminées"><span class="pm-wbars"><i class="c" style="height:${w.created / max * 100}%"></i><i class="d" style="height:${w.done / max * 100}%"></i></span><small>${fmtDate(w.end).replace(/\s\d{4}$/, '')}</small></div>`).join('')}</div>
          <p class="hint"><i class="pm-key c"></i> créées <i class="pm-key d"></i> terminées</p></section>
        <section class="panel"><h2>Par priorité</h2>${d.byPriority.filter((p) => p.count).map((p) => `<div class="pm-load-row">${flag(p.priority) || '<span class="pm-flag"></span>'}<span>${PRIO[p.priority][0]}</span><span class="pm-load-bar"><i style="width:${p.count / Math.max(1, t.open) * 100}%;background:${PRIO[p.priority][1] || 'var(--line-strong)'}"></i></span><b>${p.count}</b></div>`).join('') || '<p class="hint">Aucune tâche ouverte.</p>'}
          <h2 style="margin-top:18px">Avancement</h2><div class="pm-stack"><i style="flex:${d.byStatusType.open};background:#8C94AD" title="Ouvertes"></i><i style="flex:${d.byStatusType.active};background:var(--accent)" title="En cours"></i><i style="flex:${d.byStatusType.closed};background:var(--ok)" title="Terminées"></i></div>
          <p class="hint">${d.byStatusType.open} ouvertes · ${d.byStatusType.active} en cours · ${d.byStatusType.closed} terminées</p></section>
        <section class="panel"><h2>En retard</h2>${d.overdueList.map(item).join('') || '<p class="hint">Rien en retard. Bravo !</p>'}<h2 style="margin-top:18px">À venir</h2>${d.upcoming.map(item).join('') || '<p class="hint">Aucune échéance à venir.</p>'}</section>
      </div>`;
  }
  function inboxPage() {
    const n = S.page.notifications, unread = n.filter((x) => !x.readAt).length;
    const icon = { assigned: '👤', mention: '@', comment: '💬', status: '↻' };
    return `<header class="pm-head"><div class="pm-title"><h1>Boîte de réception</h1><p class="hint">${unread ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout est lu.'}</p></div>
        <div class="pm-head-actions">${unread ? '<button class="btn" data-pm="readAll">Tout marquer comme lu</button>' : ''}</div></header>
      <div class="panel pm-inbox">${n.map((x) => `<button class="pm-notif ${x.readAt ? '' : 'unread'}" data-pm="notif" data-id="${x.id}" data-task="${x.taskId || ''}"><span class="pm-ni">${icon[x.kind] || '•'}</span><span>${esc(x.text)}</span><time>${K().timeAgo(x.createdAt)}</time></button>`).join('') || '<div class="empty"><strong>Aucune notification</strong><span>Assignations, mentions et commentaires sur les tâches que tu suis apparaîtront ici.</span></div>'}</div>`;
  }
  function goalsPage() {
    const g = S.page.goals;
    return `<header class="pm-head"><div class="pm-title"><span class="pm-crumbs">${esc(S.tree.team.name)}</span><h1>Objectifs</h1><p class="hint">Suis les résultats de l’équipe : valeurs chiffrées, cases à cocher ou tâches liées.</p></div>
        <div class="pm-head-actions"><button class="btn primary" data-pm="goalEdit">${ic('plus')}<span>Objectif</span></button></div></header>
      <div class="pm-goals">${g.map((x) => `<article class="panel pm-goal" style="--c:${x.color}"><header><h2>${esc(x.name)}</h2><b>${Math.round(x.progress * 100)} %</b></header>
          <span class="meter"><i style="width:${Math.round(x.progress * 100)}%;background:${x.color}"></i></span>
          ${x.description ? `<p class="hint">${esc(x.description)}</p>` : ''}${x.due ? `<p class="pm-faint">Échéance : ${fmtDate(x.due)}</p>` : ''}
          <ul>${x.targets.map((t) => `<li><span>${esc(t.name)}</span>${t.kind === 'number' ? `<span class="pm-target"><input class="input sm num" value="${t.current}" data-pm-change="goalCurrent" data-id="${x.id}" data-t="${t.id}" aria-label="Valeur actuelle"> / ${t.target} ${esc(t.unit || '')}</span>`
            : t.kind === 'boolean' ? `<input type="checkbox" data-pm-change="goalBool" data-id="${x.id}" data-t="${t.id}" ${t.done ? 'checked' : ''} aria-label="Atteint">` : `<span class="pm-faint">${t.done}/${t.total} tâches</span>`}<span class="meter sm"><i style="width:${Math.round(t.progress * 100)}%"></i></span></li>`).join('')}</ul>
          <footer><button class="btn sm" data-pm="goalEdit" data-id="${x.id}">Modifier</button><button class="btn sm ghost" data-pm="goalDel" data-id="${x.id}">Supprimer</button></footer></article>`).join('') || '<div class="empty"><strong>Aucun objectif</strong><span>Crée un objectif et relie-le à des tâches pour suivre son avancement automatiquement.</span></div>'}</div>`;
  }
  function docsPage() {
    const sp = spaceOf(S.route.id);
    return `<header class="pm-head"><div class="pm-title"><span class="pm-crumbs">${esc(sp?.name || '')}</span><h1>Documents</h1><p class="hint">Briefs, comptes rendus, procédures : le wiki de l’espace.</p></div>
        <div class="pm-head-actions"><button class="btn primary" data-pm="docNew">${ic('plus')}<span>Document</span></button></div></header>
      <div class="panel pm-inbox">${S.page.docs.map((x) => `<a class="pm-notif" href="#/projects/doc/${x.id}"><span class="pm-ni">📄</span><span>${esc(x.title)}</span><time>${esc(x.updatedBy || '')} · ${K().timeAgo(x.updatedAt)}</time></a>`).join('') || '<div class="empty"><strong>Aucun document</strong></div>'}</div>`;
  }
  function docPage() {
    const d = S.page.doc;
    return `<header class="pm-head"><div class="pm-title"><a class="pm-crumbs" href="#/projects/docs/${d.spaceId}">‹ ${esc(spaceOf(d.spaceId)?.name || 'Documents')}</a>
        <input class="pm-doc-title" value="${esc(d.title)}" data-pm-change="docTitle" maxlength="120" aria-label="Titre du document"></div>
        <div class="pm-head-actions"><span class="hint" id="pmDocSaved">Enregistré</span><button class="btn ghost" data-pm="docDel">Supprimer</button></div></header>
      <div class="pm-doc"><textarea class="input" data-pm-input="docBody" aria-label="Contenu (Markdown)" placeholder="# Titre\nÉcris en Markdown…">${esc(d.body)}</textarea><div class="panel pm-md" id="pmDocPreview">${md(d.body)}</div></div>`;
  }
  function settingsPage() {
    const d = S.page, admin = ['owner', 'admin'].includes(d.role);
    return `<header class="pm-head"><div class="pm-title"><h1>${esc(d.team.name)}</h1><p class="hint">Membres, invitations et compte.</p></div>
        <div class="pm-head-actions"><button class="btn ghost" data-pm="logout">Se déconnecter (${esc(S.me.handle)})</button></div></header>
      <div class="pm-dash-grid">
        <section class="panel"><h2>Membres (${d.members.length})</h2>${d.members.map((m) => `<div class="pm-load-row">${av(m.id)}<span>${esc(m.name)} <small class="pm-faint">@${esc(m.handle)}</small></span><span class="pm-role">${{ owner: 'Propriétaire', admin: 'Administrateur', member: 'Membre' }[m.role]}</span>
          ${m.role !== 'owner' && (admin || m.id === S.me.id) ? `<button class="link-btn" data-pm="removeMember" data-id="${m.id}">${m.id === S.me.id ? 'Quitter' : 'Retirer'}</button>` : ''}</div>`).join('')}</section>
        <section class="panel"><h2>Inviter</h2>${admin ? `<p class="hint">Un code valable 7 jours, pour 20 personnes au maximum.</p><button class="btn primary" data-pm="invite">Créer un code d’invitation</button><div id="pmInvite"></div>` : '<p class="hint">Seuls les administrateurs peuvent inviter.</p>'}
          ${d.role === 'owner' ? `<h2 style="margin-top:24px">Zone sensible</h2><button class="btn danger" data-pm="deleteTeam">Supprimer l’espace de travail</button>` : ''}</section>
      </div>`;
  }

  /* =========================================================
     Actions
     ========================================================= */
  const findTask = (id) => !id ? undefined : S.tasks.find((t) => t.id === id) || (S.dd && S.dd.task.id === id ? S.dd.task : S.dd?.subtasks.find((x) => x.id === id));
  async function patchTask(id, patch, { quiet } = {}) {
    try {
      const r = await api('PATCH', `/pm/tasks/${id}`, patch);
      const i = S.tasks.findIndex((t) => t.id === id); if (i >= 0) S.tasks[i] = r.task;
      renderMain(); if (S.detail) loadDetail(S.detail, true);
      return r.task;
    } catch (e) {
      if (e.status === 409 && e.data?.blockers) {
        const ok = await K().confirmBox({ title: 'Tâche bloquée', text: `Elle attend encore : ${e.data.blockers.map((b) => '« ' + b.title + ' »').join(', ')}. La terminer quand même ?`, ok: 'Terminer quand même' });
        if (ok) return patchTask(id, { ...patch, force: true }, { quiet });
        renderMain(); return null;
      }
      if (!quiet) fail(e); renderMain(); return null;
    }
  }
  async function createTask(listId, data) {
    try { const r = await api('POST', `/pm/lists/${listId}/tasks`, data); if (S.route.page !== 'mine') S.tasks.push(r.task); renderMain(); return r.task; }
    catch (e) { fail(e); return null; }
  }
  const currentList = () => S.route.page === 'list' ? S.route.id : null;
  async function pickList(title = 'Dans quelle liste ?') {
    const lists = S.tree.lists.filter((l) => !l.archived && (S.route.page !== 'space' || l.spaceId === S.route.id) && (S.route.page !== 'folder' || l.folderId === S.route.id));
    if (lists.length === 1) return lists[0].id;
    if (!lists.length) { toast('Crée d’abord une liste dans un espace.', 'error'); return null; }
    return new Promise((res) => {
      K().openModal(`<form class="dlg" data-f="pick"><div class="dlg-head"><h2>${esc(title)}</h2></div><select class="input" name="list">${lists.map((l) => `<option value="${l.id}">${esc(spaceOf(l.spaceId)?.name || '')} › ${esc(l.name)}</option>`).join('')}</select>
        <div class="dlg-foot"><button class="btn" type="button" data-x>Annuler</button><button class="btn primary">Choisir</button></div></form>`, {
        onMount: (m) => { m.querySelector('[data-x]').onclick = () => { K().closeModal(); res(null); }; m.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = e.target.list.value; K().closeModal(); res(v); }; },
      });
    });
  }
  function promptBox({ title, label, value = '', ok = 'Valider', extra = '' }) {
    return new Promise((res) => {
      let done = false;
      K().openModal(`<form class="dlg"><div class="dlg-head"><h2>${esc(title)}</h2></div><label class="field"><span>${esc(label)}</span><input class="input" name="v" value="${esc(value)}" required maxlength="120" autofocus></label>${extra}
        <div class="dlg-foot"><button class="btn" type="button" data-x>Annuler</button><button class="btn primary">${esc(ok)}</button></div></form>`, {
        onMount: (m) => {
          m.querySelector('[data-x]').onclick = () => { K().closeModal(); };
          m.querySelector('form').onsubmit = (e) => { e.preventDefault(); done = true; const fd = Object.fromEntries(new FormData(e.target)); K().closeModal(); res(fd); };
          m.addEventListener('close', () => { if (!done) res(null); }, { once: true });
        },
      });
    });
  }
  const colorPick = (cur) => `<div class="field"><span>Couleur</span><div class="pm-swatches">${SWATCH.map((c) => `<label class="pm-swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === cur ? 'checked' : ''} aria-label="${c}"></label>`).join('')}</div></div>`;

  function listSettings(listId) {
    const l = listOf(listId), fields = S.meta?.fields || [];
    let statuses = l.statuses.map((s) => ({ ...s }));
    const draw = () => `<form class="dlg" data-f="ls"><div class="dlg-head"><h2>Réglages de « ${esc(l.name)} »</h2></div>
      <label class="field"><span>Nom</span><input class="input" name="name" value="${esc(l.name)}" maxlength="80" required></label>
      <label class="field"><span>Description</span><input class="input" name="description" value="${esc(l.description || '')}" maxlength="1000"></label>
      <div class="field"><span>Statuts (dans l’ordre du flux)</span><div class="pm-st-edit">${statuses.map((s, i) => `<div class="pm-st-row"><input type="color" value="${s.color}" data-i="${i}" data-k="color" aria-label="Couleur"><input class="input sm" value="${esc(s.name)}" data-i="${i}" data-k="name" maxlength="30" aria-label="Nom du statut">
        <select class="input sm" data-i="${i}" data-k="type" aria-label="Type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button type="button" class="icon-btn sm" data-up="${i}" aria-label="Monter">↑</button><button type="button" class="icon-btn sm" data-del="${i}" aria-label="Supprimer">✕</button></div>`).join('')}
        <button type="button" class="btn sm ghost" data-add>+ Ajouter un statut</button></div></div>
      <div class="field"><span>Champs personnalisés</span>${fields.map((f) => `<div class="pm-st-row"><b>${esc(f.name)}</b><span class="pm-faint">${FIELD_LABEL[f.type]}${f.type === 'select' ? ' : ' + f.options.map((o) => esc(o.name)).join(', ') : ''}</span><button type="button" class="icon-btn sm" data-fdel="${f.id}" aria-label="Supprimer le champ">✕</button></div>`).join('') || '<span class="hint">Aucun champ.</span>'}
        <div class="pm-st-row"><input class="input sm" name="fname" placeholder="Nouveau champ (ex. Budget)" maxlength="40"><select class="input sm" name="ftype">${Object.entries(FIELD_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <input class="input sm" name="fopts" placeholder="Options, séparées par des virgules"><button type="button" class="btn sm" data-fadd>Ajouter</button></div></div>
      <div class="dlg-foot"><button class="btn" type="button" data-x>Fermer</button><button class="btn primary">Enregistrer</button></div></form>`;
    K().openModal(draw(), { wide: true, onMount: function mount(m) {
      const rebind = () => { const f = m.querySelector('form'); const keep = { name: f.name.value, description: f.description.value }; m.innerHTML = draw(); m.querySelector('form').name.value = keep.name; m.querySelector('form').description.value = keep.description; mount(m); };
      m.querySelector('[data-x]').onclick = () => K().closeModal();
      m.querySelectorAll('[data-k]').forEach((x) => x.oninput = () => { statuses[x.dataset.i][x.dataset.k] = x.value; });
      m.querySelectorAll('[data-del]').forEach((x) => x.onclick = () => { statuses.splice(Number(x.dataset.del), 1); rebind(); });
      m.querySelectorAll('[data-up]').forEach((x) => x.onclick = () => { const i = Number(x.dataset.up); if (i > 0) { [statuses[i - 1], statuses[i]] = [statuses[i], statuses[i - 1]]; rebind(); } });
      m.querySelector('[data-add]').onclick = () => { statuses.splice(statuses.length - 1, 0, { name: 'Nouveau statut', color: '#7C3AED', type: 'active' }); rebind(); };
      m.querySelectorAll('[data-fdel]').forEach((x) => x.onclick = async () => { if (!await K().confirmBox({ title: 'Supprimer ce champ ?', text: 'Ses valeurs seront perdues.', ok: 'Supprimer', danger: true })) return listSettings(listId); await api('DELETE', `/pm/fields/${x.dataset.fdel}`).catch(fail); await reloadMeta(); listSettings(listId); });
      m.querySelector('[data-fadd]').onclick = async () => {
        const f = m.querySelector('form'), name = f.fname.value.trim(), type = f.ftype.value; if (!name) return f.fname.focus();
        const options = type === 'select' ? f.fopts.value.split(',').map((x) => x.trim()).filter(Boolean).map((n) => ({ name: n })) : undefined;
        try { await api('POST', `/pm/lists/${listId}/fields`, { name, type, options }); await reloadMeta(); toast('Champ ajouté'); listSettings(listId); } catch (e) { fail(e); }
      };
      m.querySelector('form').onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        try { await api('PATCH', `/pm/lists/${listId}`, { name: f.name.value, description: f.description.value, statuses }); K().closeModal(); await loadTree(); await reloadMeta(); renderAll(); toast('Liste mise à jour'); } catch (err) { fail(err); }
      };
    } });
  }
  async function reloadMeta() { if (S.route.page === 'list') { S.meta = await api('GET', `/pm/lists/${S.route.id}`); S.tasks = (await api('GET', `/pm/tasks?list=${S.route.id}`)).tasks; } }

  function filtersMenu(anchor) {
    const html = () => { const f = S.filters; return `<div class="pm-menu-title">Responsables</div>${[...S.tree.members.map((m) => [m.id, m.name]), ['__none', 'Non assignées']].map(([id, n]) => `<button data-v="a:${id}" class="${f.assignees.includes(id) ? 'on' : ''}">${id === '__none' ? '∅' : av(id)}${esc(n)}</button>`).join('')}
      <div class="pm-menu-title">Priorité</div>${[1, 2, 3, 4, 0].map((p) => `<button data-v="p:${p}" class="${f.priorities.includes(p) ? 'on' : ''}">${flag(p) || '<span class="pm-flag"></span>'}${PRIO[p][0]}</button>`).join('')}
      <div class="pm-menu-title">Échéance</div>${[['', 'Toutes'], ['overdue', 'En retard'], ['today', 'Aujourd’hui'], ['week', '7 prochains jours'], ['none', 'Sans échéance']].map(([k, l]) => `<button data-v="d:${k}" class="${f.due === k ? 'on' : ''}">${l}</button>`).join('')}
      ${S.tree.tags.length ? `<div class="pm-menu-title">Étiquettes</div>${S.tree.tags.map((g) => `<button data-v="t:${esc(g)}" class="${f.tags.includes(g) ? 'on' : ''}"><span class="pm-tag" style="background:${tagColor(g)}">${esc(g)}</span></button>`).join('')}` : ''}
      <div class="pm-menu-foot"><button data-v="reset" class="btn sm ghost">Réinitialiser</button></div>`; };
    const el = menu(anchor, html(), (v) => {
      const f = S.filters, k = v.slice(0, 1), x = v.slice(2);
      const tog = (arr, val) => (arr.includes(val) ? arr.filter((y) => y !== val) : [...arr, val]);
      if (v === 'reset') S.filters = { q: f.q, assignees: [], priorities: [], tags: [], due: '' };
      else if (k === 'a') f.assignees = tog(f.assignees, x); else if (k === 'p') f.priorities = tog(f.priorities, Number(x)); else if (k === 't') f.tags = tog(f.tags, x); else if (k === 'd') f.due = x;
      S.activeView = null; renderMain(); el.innerHTML = html(); return true;
    }, { width: 260 });
  }

  async function goalDialog(id) {
    const g = id ? S.page.goals.find((x) => x.id === id) : { name: '', description: '', due: '', color: '#2F45D8', targets: [] };
    let targets = g.targets.map((t) => ({ ...t }));
    const taskOpts = S.tasks.filter((t) => !t.parentId);
    const draw = () => `<form class="dlg"><div class="dlg-head"><h2>${id ? 'Modifier l’objectif' : 'Nouvel objectif'}</h2></div>
      <label class="field"><span>Nom</span><input class="input" name="name" value="${esc(g.name)}" required maxlength="100" placeholder="ex. Lancer le nouveau site"></label>
      <label class="field"><span>Description</span><input class="input" name="description" value="${esc(g.description)}" maxlength="1000"></label>
      <div class="grid-2"><label class="field"><span>Échéance</span><input class="input" type="date" name="due" value="${esc(g.due)}"></label>${colorPick(g.color)}</div>
      <div class="field"><span>Cibles</span>${targets.map((t, i) => `<div class="pm-st-row"><input class="input sm" value="${esc(t.name)}" data-i="${i}" data-k="name" aria-label="Nom de la cible">
          <select class="input sm" data-i="${i}" data-k="kind"><option value="number" ${t.kind === 'number' ? 'selected' : ''}>Valeur chiffrée</option><option value="boolean" ${t.kind === 'boolean' ? 'selected' : ''}>Oui / non</option><option value="tasks" ${t.kind === 'tasks' ? 'selected' : ''}>Tâches liées</option></select>
          ${t.kind === 'number' ? `<input class="input sm num" value="${t.start ?? 0}" data-i="${i}" data-k="start" aria-label="Départ" title="Départ"><input class="input sm num" value="${t.target ?? 100}" data-i="${i}" data-k="target" aria-label="Cible" title="Cible"><input class="input sm num" value="${esc(t.unit || '')}" data-i="${i}" data-k="unit" placeholder="unité" aria-label="Unité">`
            : t.kind === 'tasks' ? `<select class="input sm" multiple size="4" data-i="${i}" data-k="taskIds" aria-label="Tâches liées">${taskOpts.map((x) => `<option value="${x.id}" ${(t.taskIds || []).includes(x.id) ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>` : ''}
          <button type="button" class="icon-btn sm" data-del="${i}" aria-label="Supprimer la cible">✕</button></div>`).join('')}
        <button type="button" class="btn sm ghost" data-add>+ Ajouter une cible</button></div>
      <div class="dlg-foot"><button class="btn" type="button" data-x>Annuler</button><button class="btn primary">Enregistrer</button></div></form>`;
    K().openModal(draw(), { wide: true, onMount: function mount(m) {
      const keep = () => { const f = m.querySelector('form'); g.name = f.name.value; g.description = f.description.value; g.due = f.due.value; g.color = f.color?.value || g.color; };
      m.querySelector('[data-x]').onclick = () => K().closeModal();
      m.querySelectorAll('[data-k]').forEach((x) => x.onchange = x.oninput = () => {
        const t = targets[x.dataset.i];
        if (x.dataset.k === 'taskIds') t.taskIds = [...x.selectedOptions].map((o) => o.value);
        else if (x.dataset.k === 'kind') { t.kind = x.value; keep(); m.innerHTML = draw(); mount(m); }
        else t[x.dataset.k] = ['start', 'target'].includes(x.dataset.k) ? Number(x.value.replace(',', '.')) || 0 : x.value;
      });
      m.querySelectorAll('[data-del]').forEach((x) => x.onclick = () => { keep(); targets.splice(Number(x.dataset.del), 1); m.innerHTML = draw(); mount(m); });
      m.querySelector('[data-add]').onclick = () => { keep(); targets.push({ name: 'Nouvelle cible', kind: 'number', start: 0, target: 100, current: 0 }); m.innerHTML = draw(); mount(m); };
      m.querySelector('form').onsubmit = async (e) => {
        e.preventDefault(); keep();
        try { await api(id ? 'PATCH' : 'POST', id ? `/pm/goals/${id}` : `/pm/teams/${P.teamId}/goals`, { name: g.name, description: g.description, due: g.due, color: g.color, targets }); K().closeModal(); await loadPage(); renderMain(); }
        catch (err) { fail(err); }
      };
    } });
  }

  async function onAction(act, id, el, e) {
    const t = id && findTask(id);
    switch (act) {
      case 'retry': return mount(S.root);
      case 'toggle': P.collapsed[id] = !P.collapsed[id]; savePrefs(); return id.startsWith('g') ? renderMain() : (S.root.querySelector('#pmSide').innerHTML = sidebar());
      case 'mode': P.modes[scopeKey()] = id; savePrefs(); S.activeView = null; return renderMain();
      case 'openTask': e.preventDefault(); if (!S.tasks.some((x) => x.id === id) && S.route.page === 'inbox') return; return openDetail(id);
      case 'closeDetail': return closeDetail();
      case 'status': return statusMenu(el, t.listId, t.status, (v) => patchTask(id, { status: v }));
      case 'priority': return prioMenu(el, t.priority, (v) => patchTask(id, { priority: v }));
      case 'assignees': return peopleMenu(el, t.assignees, (v) => patchTask(id, { assignees: v }));
      case 'due': {
        const inp = Object.assign(document.createElement('input'), { type: 'date', value: t.due || '' });
        inp.className = 'pm-hidden-date'; el.append(inp);
        inp.onchange = () => patchTask(id, { due: inp.value }); inp.onblur = () => inp.remove();
        try { inp.showPicker(); } catch { inp.focus(); }
        return;
      }
      case 'newTask': {
        const listId = currentList() || await pickList(); if (!listId) return;
        const r = await promptBox({ title: 'Nouvelle tâche', label: 'Titre', ok: 'Créer' }); if (!r) return;
        const task = await createTask(listId, { title: r.v, ...(id && /^\d{4}-/.test(id) ? { due: id } : {}) }); if (task) openDetail(task.id);
        return;
      }
      case 'onlyMe': S.filters.assignees = S.filters.assignees.length === 1 && S.filters.assignees[0] === S.me.id ? [] : [S.me.id]; S.activeView = null; return renderMain();
      case 'filters': return filtersMenu(el);
      case 'clearSel': S.sel.clear(); return renderMain();
      case 'bulk': return bulk(id, el);
      case 'cal': if (id === '0') S.cal = null; else { const c = S.cal || new Date(new Date().getFullYear(), new Date().getMonth(), 1); S.cal = new Date(c.getFullYear(), c.getMonth() + Number(id), 1); } return renderMain();
      case 'zoom': P.zoom = id; savePrefs(); return renderMain();
      case 'planTask': { const s = today(); return patchTask(id, { start: s, due: addDays(s, 2) }); }
      case 'chat': S.chatOpen = !S.chatOpen; renderMain(); if (S.chatOpen) { renderChat(); S.root.querySelector('#pmChat input')?.focus(); } return;
      case 'listSettings': return listSettings(id);
      case 'saveView': {
        const r = await promptBox({ title: 'Enregistrer la vue', label: 'Nom de la vue', ok: 'Enregistrer', extra: '<label class="pm-check"><input type="checkbox" name="shared" checked> Partager avec l’équipe</label>' }); if (!r) return;
        const scope = S.route.page === 'mine' ? 'mine:' + S.me.id : `${S.route.page}:${S.route.id}`;
        try { const v = await api('POST', '/pm/views', { team: P.teamId, scope, name: r.v, type: mode(), shared: !!r.shared, config: { filters: S.filters, groupBy: P.groupBy[scopeKey()] || 'status', sort: P.sort || 'position', showClosed: S.showClosed, showSub: S.showSub } });
          S.views.push({ id: v.view.id, name: r.v, type: mode(), shared: !!r.shared, config: { filters: { ...S.filters } } }); S.activeView = v.view.id; renderMain(); toast('Vue enregistrée'); } catch (err) { fail(err); }
        return;
      }
      case 'applyView': {
        if (e.target.closest('[data-pm="delView"]')) return;
        const v = S.views.find((x) => x.id === id); if (!v) return;
        const c = v.config || {};
        S.filters = { q: '', assignees: [], priorities: [], tags: [], due: '', ...(c.filters || {}) };
        if (c.groupBy) P.groupBy[scopeKey()] = c.groupBy; if (c.sort) P.sort = c.sort; S.showClosed = !!c.showClosed; S.showSub = c.showSub !== false;
        P.modes[scopeKey()] = v.type; S.activeView = id; savePrefs(); return renderMain();
      }
      case 'delView': e.stopPropagation(); if (!await K().confirmBox({ title: 'Supprimer cette vue ?', text: 'Les tâches ne sont pas supprimées.', ok: 'Supprimer', danger: true })) return;
        try { await api('DELETE', `/pm/views/${id}`); S.views = S.views.filter((v) => v.id !== id); if (S.activeView === id) S.activeView = null; renderMain(); } catch (err) { fail(err); } return;
      // ---- arborescence ----
      case 'newSpace': { const r = await promptBox({ title: 'Nouvel espace', label: 'Nom', ok: 'Créer', extra: colorPick('#2F45D8') }); if (!r) return;
        try { const s = await api('POST', `/pm/teams/${P.teamId}/spaces`, { name: r.v, color: r.color }); await loadTree(); location.hash = `#/projects/space/${s.space.id}`; } catch (err) { fail(err); } return; }
      case 'newList': return newList(id);
      case 'spaceMenu': {
        const s = spaceOf(id);
        return menu(el, `<button data-v="list">+ Nouvelle liste</button><button data-v="folder">+ Nouveau dossier</button><button data-v="docs">📄 Documents</button><button data-v="dash">📊 Tableau de bord de l’espace</button><hr><button data-v="rename">Renommer / couleur</button><button data-v="archive">Archiver</button><button data-v="delete" class="danger">Supprimer…</button>`, async (v) => {
          if (v === 'list') return newList(id);
          if (v === 'folder') { const r = await promptBox({ title: 'Nouveau dossier', label: 'Nom', ok: 'Créer' }); if (r) { await api('POST', `/pm/spaces/${id}/folders`, { name: r.v }).catch(fail); await loadTree(); renderAll(); } }
          if (v === 'docs') location.hash = `#/projects/docs/${id}`;
          if (v === 'dash') location.hash = `#/projects/home/${id}`;
          if (v === 'rename') { const r = await promptBox({ title: 'Espace', label: 'Nom', value: s.name, extra: colorPick(s.color) }); if (r) { await api('PATCH', `/pm/spaces/${id}`, { name: r.v, color: r.color }).catch(fail); await loadTree(); renderAll(); } }
          if (v === 'archive') { await api('PATCH', `/pm/spaces/${id}`, { archived: true }).catch(fail); await loadTree(); location.hash = '#/projects'; }
          if (v === 'delete' && await K().confirmBox({ title: `Supprimer « ${s.name} » ?`, text: 'Toutes ses listes, tâches et documents seront supprimés définitivement.', ok: 'Supprimer', danger: true })) { await api('DELETE', `/pm/spaces/${id}`).catch(fail); await loadTree(); location.hash = '#/projects'; }
        });
      }
      case 'folderMenu': {
        const f = S.tree.folders.find((x) => x.id === id);
        return menu(el, `<button data-v="list">+ Nouvelle liste</button><button data-v="rename">Renommer</button><button data-v="delete" class="danger">Supprimer le dossier</button>`, async (v) => {
          if (v === 'list') return newList(f.spaceId, f.id);
          if (v === 'rename') { const r = await promptBox({ title: 'Dossier', label: 'Nom', value: f.name }); if (r) { await api('PATCH', `/pm/folders/${id}`, { name: r.v }).catch(fail); await loadTree(); renderAll(); } }
          if (v === 'delete' && await K().confirmBox({ title: 'Supprimer ce dossier ?', text: 'Ses listes remontent dans l’espace : aucune tâche n’est perdue.', ok: 'Supprimer' })) { await api('DELETE', `/pm/folders/${id}`).catch(fail); await loadTree(); renderAll(); }
        });
      }
      case 'listMenu': {
        e.preventDefault(); const l = listOf(id);
        const folders = S.tree.folders.filter((f) => f.spaceId === l.spaceId);
        return menu(el, `<button data-v="settings">Statuts et champs…</button><button data-v="rename">Renommer / couleur</button>${folders.length || l.folderId ? `<div class="pm-menu-title">Ranger dans</div>${l.folderId ? '<button data-v="f:">(à la racine de l’espace)</button>' : ''}${folders.filter((f) => f.id !== l.folderId).map((f) => `<button data-v="f:${f.id}">📁 ${esc(f.name)}</button>`).join('')}` : ''}
          <hr><button data-v="archive">Archiver</button><button data-v="delete" class="danger">Supprimer…</button>`, async (v) => {
          if (v === 'settings') { if (S.route.page !== 'list' || S.route.id !== id) { location.hash = `#/projects/list/${id}`; setTimeout(() => listSettings(id), 600); } else listSettings(id); }
          if (v === 'rename') { const r = await promptBox({ title: 'Liste', label: 'Nom', value: l.name, extra: colorPick(l.color || '#2F45D8') }); if (r) { await api('PATCH', `/pm/lists/${id}`, { name: r.v, color: r.color }).catch(fail); await loadTree(); renderAll(); } }
          if (v.startsWith('f:')) { await api('PATCH', `/pm/lists/${id}`, { folderId: v.slice(2) || null }).catch(fail); await loadTree(); renderAll(); }
          if (v === 'archive') { await api('PATCH', `/pm/lists/${id}`, { archived: true }).catch(fail); await loadTree(); if (S.route.id === id) location.hash = '#/projects'; else renderAll(); }
          if (v === 'delete' && await K().confirmBox({ title: `Supprimer « ${l.name} » ?`, text: 'Toutes ses tâches et sa discussion seront supprimées définitivement.', ok: 'Supprimer', danger: true })) { await api('DELETE', `/pm/lists/${id}`).catch(fail); await loadTree(); if (S.route.id === id) location.hash = '#/projects'; else renderAll(); }
        });
      }
      // ---- détail ----
      case 'dStatus': return statusMenu(el, S.dd.task.listId, S.dd.task.status, (v) => patchTask(S.detail, { status: v }));
      case 'dClose': { const c = S.dd.statuses.find((x) => x.type === 'closed'); return patchTask(S.detail, { status: c.key }); }
      case 'dPriority': return prioMenu(el, S.dd.task.priority, (v) => patchTask(S.detail, { priority: v }));
      case 'dAssignees': return peopleMenu(el, S.dd.task.assignees, (v) => patchTask(S.detail, { assignees: v }));
      case 'descEdit': S.editDesc = true; renderDetail(); S.root.querySelector('[data-key="desc"]')?.focus(); return;
      case 'descDone': { const v = S.root.querySelector('[data-key="desc"]').value; S.editDesc = false; await patchTask(S.detail, { description: v }); return; }
      case 'watch': await api('POST', `/pm/tasks/${S.detail}/watch`).catch(fail); return loadDetail(S.detail);
      case 'startTimer': try { const r = await api('POST', `/pm/tasks/${S.detail}/time/start`); S.tree.running = r.running; S.root.querySelector('#pmSide').innerHTML = sidebar(); tickTimer(); renderDetail(); toast('Chronomètre démarré'); } catch (err) { fail(err); } return;
      case 'stopTimer': e.stopPropagation(); try { const r = await api('POST', '/pm/time/stop'); S.tree.running = null; S.root.querySelector('#pmSide').innerHTML = sidebar(); if (r.stopped) toast(`${fmtMin(r.stopped.minutes)} enregistrées`); if (S.detail) loadDetail(S.detail); refreshTasks(); } catch (err) { fail(err); } return;
      case 'addTime': { const r = await promptBox({ title: 'Saisir du temps', label: 'Durée (ex. 1h30, 45m)', ok: 'Enregistrer', extra: `<label class="field"><span>Date</span><input class="input" type="date" name="date" value="${today()}"></label><label class="field"><span>Note</span><input class="input" name="note" maxlength="200"></label>` }); if (!r) return;
        const minutes = parseDuration(r.v); if (!minutes) return toast('Durée non reconnue', 'error');
        try { await api('POST', `/pm/tasks/${S.detail}/time`, { minutes, date: r.date, note: r.note }); loadDetail(S.detail); refreshTasks(); } catch (err) { fail(err); } return; }
      case 'timeDel': await api('DELETE', `/pm/time/${id}`).catch(fail); loadDetail(S.detail); refreshTasks(); return;
      case 'clearTags': return patchTask(S.detail, { tags: [] });
      case 'chkDel': e.preventDefault(); await api('DELETE', `/pm/checklist/${id}`).catch(fail); return loadDetail(S.detail);
      case 'depDel': await api('DELETE', `/pm/tasks/${S.detail}/deps/${id}`).catch(fail); loadDetail(S.detail); return refreshTasks();
      case 'depAdd': {
        const cands = S.tasks.filter((x) => x.id !== S.detail && !S.dd.blockedBy.some((b) => b.id === x.id));
        const draw = (q = '') => `<input class="input sm" placeholder="Rechercher une tâche" value="${esc(q)}" data-filter>${cands.filter((x) => !q || x.title.toLowerCase().includes(q.toLowerCase())).slice(0, 12).map((x) => `<button data-v="${x.id}"><i class="pm-dot" style="--c:${statusOf(x).color}"></i>${esc(x.title)}</button>`).join('') || '<span class="pm-none">Aucune tâche</span>'}`;
        const m = menu(el, draw(), async (v) => { try { await api('POST', `/pm/tasks/${S.detail}/deps`, { blockedBy: v }); loadDetail(S.detail); refreshTasks(); } catch (err) { fail(err); } }, { width: 280 });
        m.addEventListener('input', (ev) => { if (ev.target.matches('[data-filter]')) { const q = ev.target.value; m.innerHTML = draw(q); const i = m.querySelector('input'); i.focus(); i.setSelectionRange(q.length, q.length); } });
        return;
      }
      case 'dTab': S.dTab = id; return renderDetail();
      case 'mention': { const ta = S.root.querySelector('.pm-comment-form textarea'); ta.value += (ta.value && !ta.value.endsWith(' ') ? ' ' : '') + '@' + id + ' '; ta.focus(); return; }
      case 'comDel': if (!await K().confirmBox({ title: 'Supprimer ce commentaire ?', text: 'Cette action est définitive.', ok: 'Supprimer', danger: true })) return; await api('DELETE', `/pm/comments/${id}`).catch(fail); return loadDetail(S.detail);
      case 'taskMenu': {
        const tk = S.dd.task;
        return menu(el, `<button data-v="copy">🔗 Copier le lien</button><button data-v="dup">⧉ Dupliquer</button><button data-v="move">↪ Déplacer vers une liste…</button><button data-v="arch">${tk.archived ? 'Désarchiver' : 'Archiver'}</button><hr><button data-v="del" class="danger">Supprimer</button>`, async (v) => {
          if (v === 'copy') { const link = `${location.origin}/#/projects/task/${tk.id}`; try { await navigator.clipboard.writeText(link); toast('Lien copié'); } catch { toast(link); } }
          if (v === 'dup') { try { const r = await api('POST', `/pm/tasks/${tk.id}/duplicate`); await refreshNow(); openDetail(r.task.id); } catch (err) { fail(err); } }
          if (v === 'move') { const lid = await pickList('Déplacer vers…'); if (lid && lid !== tk.listId) { await patchTask(tk.id, { listId: lid }); await loadTree(); renderAll(); } }
          if (v === 'arch') { await patchTask(tk.id, { archived: !tk.archived }); closeDetail(); }
          if (v === 'del' && await K().confirmBox({ title: 'Supprimer la tâche ?', text: 'Ses sous-tâches, commentaires et temps enregistrés seront supprimés.', ok: 'Supprimer', danger: true })) { await api('DELETE', `/pm/tasks/${tk.id}`).catch(fail); S.tasks = S.tasks.filter((x) => x.id !== tk.id && x.parentId !== tk.id); closeDetail(); renderMain(); }
        });
      }
      // ---- pages ----
      case 'readAll': await api('POST', '/pm/notifications/read', { all: true }).catch(fail); S.tree.unread = 0; await loadPage(); return renderAll();
      case 'notif': {
        const task = el.dataset.task;
        api('POST', '/pm/notifications/read', { ids: [id] }).catch(() => {}); S.tree.unread = Math.max(0, S.tree.unread - (el.classList.contains('unread') ? 1 : 0));
        if (task) location.hash = `#/projects/task/${task}`; return;
      }
      case 'goalEdit': return goalDialog(id);
      case 'goalDel': if (!await K().confirmBox({ title: 'Supprimer cet objectif ?', text: 'Les tâches liées ne sont pas supprimées.', ok: 'Supprimer', danger: true })) return; await api('DELETE', `/pm/goals/${id}`).catch(fail); await loadPage(); return renderMain();
      case 'docNew': try { const r = await api('POST', `/pm/spaces/${S.route.id}/docs`, { title: 'Nouveau document', body: '' }); location.hash = `#/projects/doc/${r.doc.id}`; } catch (err) { fail(err); } return;
      case 'docDel': if (!await K().confirmBox({ title: 'Supprimer ce document ?', text: 'Cette action est définitive.', ok: 'Supprimer', danger: true })) return; await api('DELETE', `/pm/docs/${S.route.id}`).catch(fail); location.hash = `#/projects/docs/${S.page.doc.spaceId}`; return;
      case 'invite': try { const r = await api('POST', `/team/teams/${P.teamId}/invites`); S.root.querySelector('#pmInvite').innerHTML = `<p class="pm-code"><span class="mono">${esc(r.code)}</span><button class="btn sm" data-pm="copyCode" data-id="${esc(r.code)}">Copier</button></p><p class="hint">À saisir par ton collègue dans « Rejoindre avec un code ».</p>`; } catch (err) { fail(err); } return;
      case 'copyCode': try { await navigator.clipboard.writeText(id); toast('Code copié'); } catch { /* sélection manuelle */ } return;
      case 'removeMember': if (!await K().confirmBox({ title: id === S.me.id ? 'Quitter l’équipe ?' : 'Retirer ce membre ?', text: 'Ses tâches restent, sans responsable.', ok: id === S.me.id ? 'Quitter' : 'Retirer', danger: true })) return;
        try { await api('DELETE', `/team/teams/${P.teamId}/members/${id}`); if (id === S.me.id) { S.me = null; S.tree = null; P.teamId = null; savePrefs(); return mount(S.root); } await loadPage(); renderMain(); } catch (err) { fail(err); } return;
      case 'deleteTeam': if (!await K().confirmBox({ title: 'Supprimer l’espace de travail ?', text: 'Tous les projets, tâches, documents et objectifs seront supprimés pour toute l’équipe.', ok: 'Supprimer définitivement', danger: true })) return;
        try { await api('DELETE', `/team/teams/${P.teamId}`); S.me = null; S.tree = null; P.teamId = null; savePrefs(); location.hash = '#/projects'; mount(S.root); } catch (err) { fail(err); } return;
      case 'logout': await api('POST', '/team/logout').catch(() => {}); S.me = null; S.tree = null; S.teams = []; connectWs(null); return renderAuth();
    }
  }
  async function refreshNow() { const { page, id } = S.route; S.tasks = (await api('GET', `/pm/tasks?${page === 'mine' ? `team=${P.teamId}&mine=1` : `${page}=${id}`}`)).tasks; renderMain(); }
  async function newList(spaceId, folderId) {
    const r = await promptBox({ title: 'Nouvelle liste', label: 'Nom', ok: 'Créer', extra: '<p class="hint">Statuts par défaut : À faire, En cours, En revue, Terminé (modifiables ensuite).</p>' }); if (!r) return;
    try { const l = await api('POST', `/pm/spaces/${spaceId}/lists`, { name: r.v, folderId }); await loadTree(); location.hash = `#/projects/list/${l.list.id}`; } catch (e) { fail(e); }
  }
  async function bulk(kind, el) {
    const ids = [...S.sel], run = async (patch, del) => {
      try {
        const r = await api('POST', '/pm/tasks/bulk', del ? { ids, delete: true } : { ids, patch });
        if (r.conflicts.length) toast(`${r.conflicts.length} tâche(s) bloquée(s) non terminée(s)`, 'error'); else toast(`${r.updated} tâche(s) mise(s) à jour`);
        S.sel.clear(); await refreshNow();
      } catch (e) { fail(e); }
    };
    const first = findTask(ids[0]);
    if (kind === 'status') {
      const sameList = ids.every((i) => findTask(i)?.listId === first.listId);
      if (!sameList) return menu(el, Object.entries(TYPE_LABEL).map(([k, v]) => `<button data-v="${k}">${v}</button>`).join(''), async (v) => {
        for (const i of ids) { const tk = findTask(i), st = listOf(tk.listId).statuses.find((s) => s.type === v); if (st) await api('PATCH', `/pm/tasks/${i}`, { status: st.key, force: true }).catch(() => {}); }
        S.sel.clear(); refreshNow();
      });
      return statusMenu(el, first.listId, '', (v) => run({ status: v }));
    }
    if (kind === 'priority') return prioMenu(el, -1, (v) => run({ priority: v }));
    if (kind === 'assignees') return peopleMenu(el, [], (v) => run({ assignees: v }));
    if (kind === 'due') { const r = await promptBox({ title: 'Échéance', label: 'Date (AAAA-MM-JJ, vide pour retirer)', value: today() }); if (r) run({ due: r.v }); return; }
    if (kind === 'move') { const lid = await pickList('Déplacer vers…'); if (lid) { await run({ listId: lid }); await loadTree(); renderAll(); } return; }
    if (kind === 'archive') return run({ archived: true });
    if (kind === 'delete' && await K().confirmBox({ title: `Supprimer ${ids.length} tâche(s) ?`, text: 'Cette action est définitive.', ok: 'Supprimer', danger: true })) return run(null, true);
  }

  async function onChange(kind, el) {
    const id = el.dataset.id;
    switch (kind) {
      case 'team': {
        if (el.value === '__new') { const r = await promptBox({ title: 'Nouvel espace de travail', label: 'Nom', ok: 'Créer' }); if (r) { try { const t = await api('POST', '/team/teams', { name: r.v }); S.teams.push(t.team); P.teamId = t.team.id; } catch (e) { fail(e); } } }
        else if (el.value === '__join') { const r = await promptBox({ title: 'Rejoindre une équipe', label: 'Code d’invitation', ok: 'Rejoindre' }); if (r) { try { const t = await api('POST', '/team/join', { code: r.v }); const me = await api('GET', '/team/me'); S.teams = me.teams; P.teamId = t.team.id; } catch (e) { fail(e); } } }
        else P.teamId = el.value;
        savePrefs(); S.tree = null; S.detail = null; location.hash = '#/projects'; return mount(S.root);
      }
      case 'groupBy': P.groupBy[scopeKey()] = el.value; savePrefs(); S.activeView = null; return renderMain();
      case 'sort': P.sort = el.value; savePrefs(); return renderMain();
      case 'closed': S.showClosed = el.checked; return renderMain();
      case 'sub': S.showSub = el.checked; return renderMain();
      case 'sel': el.checked ? S.sel.add(id) : S.sel.delete(id); return renderMain();
      case 'title': if (el.value.trim()) return patchTask(id, { title: el.value.trim() }); return;
      case 'start': return patchTask(id, { start: el.value });
      case 'dueDate': return patchTask(id, { due: el.value });
      case 'estimate': return patchTask(id, { estimate: parseDuration(el.value) });
      case 'custom': return patchTask(id, { custom: { [el.dataset.f]: el.type === 'checkbox' ? el.checked : el.value } });
      case 'dTitle': if (el.value.trim() && el.value.trim() !== S.dd.task.title) return patchTask(S.detail, { title: el.value.trim().replace(/\n/g, ' ') }); return;
      case 'dStart': return patchTask(S.detail, { start: el.value });
      case 'dDue': return patchTask(S.detail, { due: el.value });
      case 'dEstimate': return patchTask(S.detail, { estimate: parseDuration(el.value) });
      case 'dMilestone': return patchTask(S.detail, { milestone: el.checked });
      case 'dRecurrence': return patchTask(S.detail, { recurrence: el.value });
      case 'dCustom': return patchTask(S.detail, { custom: { [el.dataset.f]: el.type === 'checkbox' ? el.checked : el.value } });
      case 'dDesc': return;
      case 'chk': await api('PATCH', `/pm/checklist/${id}`, { done: el.checked }).catch(fail); loadDetail(S.detail); return refreshTasks();
      case 'dashSpace': location.hash = `#/projects/home${el.value ? '/' + el.value : ''}`; return;
      case 'goalCurrent': case 'goalBool': {
        const g = S.page.goals.find((x) => x.id === id), targets = g.targets.map((t) => t.id === el.dataset.t ? (kind === 'goalBool' ? { ...t, done: el.checked } : { ...t, current: Number(el.value.replace(',', '.')) || 0 }) : t);
        try { await api('PATCH', `/pm/goals/${id}`, { targets }); await loadPage(); renderMain(); } catch (e) { fail(e); } return;
      }
      case 'docTitle': try { await api('PATCH', `/pm/docs/${S.route.id}`, { title: el.value || 'Sans titre' }); } catch (e) { fail(e); } return;
    }
  }
  const saveDoc = debounce(async (body) => { try { await api('PATCH', `/pm/docs/${S.route.id}`, { body }); const s = S.root?.querySelector('#pmDocSaved'); if (s) s.textContent = 'Enregistré'; } catch (e) { fail(e); } }, 700);

  async function onSubmit(kind, form) {
    const fd = Object.fromEntries(new FormData(form));
    try {
      if (kind === 'login' || kind === 'register') {
        const r = await api('POST', `/team/${kind}`, { handle: fd.handle?.trim().toLowerCase(), password: fd.password, name: fd.name });
        S.me = r.user; const me = await api('GET', '/team/me'); S.teams = me.teams; return mount(S.root);
      }
      if (kind === 'createTeam') { const t = await api('POST', '/team/teams', { name: fd.name }); S.teams = [t.team]; P.teamId = t.team.id; savePrefs(); return mount(S.root); }
      if (kind === 'join') { const t = await api('POST', '/team/join', { code: fd.code.trim() }); const me = await api('GET', '/team/me'); S.teams = me.teams; P.teamId = t.team.id; savePrefs(); return mount(S.root); }
      if (kind === 'quick') {
        const title = (fd.title || '').trim(); if (!title) return;
        const patch = JSON.parse(form.dataset.patch || '{}'); const listId = currentList() || await pickList(); if (!listId) return;
        if (patch.status && !listOf(listId).statuses.some((s) => s.key === patch.status)) delete patch.status;
        const t = await createTask(listId, { title, ...patch }); if (t) { const i = S.root.querySelector(`form[data-patch='${CSS.escape(form.dataset.patch)}'] input`); i?.focus(); }
        return;
      }
      if (kind === 'subtask') { const title = (fd.title || '').trim(); if (!title) return; await api('POST', `/pm/lists/${S.dd.task.listId}/tasks`, { title, parentId: S.detail }); await loadDetail(S.detail); refreshTasks(); S.root.querySelector('[data-pm-form="subtask"] input')?.focus(); return; }
      if (kind === 'check') { const text = (fd.text || '').trim(); if (!text) return; await api('POST', `/pm/tasks/${S.detail}/checklist`, { text }); await loadDetail(S.detail); refreshTasks(); S.root.querySelector('[data-pm-form="check"] input')?.focus(); return; }
      if (kind === 'comment') { const body = (fd.body || '').trim(); if (!body) return; await api('POST', `/pm/tasks/${S.detail}/comments`, { body }); S.dTab = 'comments'; await loadDetail(S.detail); refreshTasks(); return; }
      if (kind === 'chat') { const body = (fd.body || '').trim(); if (!body || !S.ws || S.ws.readyState !== 1) { if (body) toast('Connexion temps réel indisponible', 'error'); return; } S.ws.send(JSON.stringify({ type: 'chat', body })); form.reset(); return; }
    } catch (e) { fail(e); }
  }

  /* ---------- Glisser-déposer : Tableau, Liste, Calendrier, barre latérale ---------- */
  function afterTasks(root) {
    let dragId = null;
    root.querySelectorAll('[data-task][draggable]').forEach((c) => {
      c.addEventListener('dragstart', (e) => { dragId = c.dataset.task; e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); root.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); });
    });
    root.querySelectorAll('[data-drop-group]').forEach((zone) => {
      zone.addEventListener('dragover', (e) => { if (zone.dataset.dropGroup === 'null') return; e.preventDefault(); zone.classList.add('drop'); });
      zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop'); });
      zone.addEventListener('drop', async (e) => {
        e.preventDefault(); zone.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain'), t = findTask(id); if (!t) return;
        const patch = JSON.parse(zone.dataset.dropGroup || 'null'); if (!patch) return;
        // position : entre les cartes voisines au point de dépôt
        const cards = [...zone.querySelectorAll('[data-task]')].filter((x) => x.dataset.task !== id);
        const after = cards.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
        const pos = (el) => findTask(el?.dataset.task)?.position;
        const next = pos(after), prev = pos(after ? after.previousElementSibling : cards[cards.length - 1]);
        const position = next !== undefined ? (prev !== undefined && prev < next ? (prev + next) / 2 : next - 1) : (prev !== undefined ? prev + 1 : t.position);
        if (patch.status && !listOf(t.listId).statuses.some((s) => s.key === patch.status)) delete patch.status;
        if (patch.assignees && patch.assignees.length) patch.assignees = [...new Set([...patch.assignees])];
        t.position = position; Object.assign(t, patch.status ? { status: patch.status } : {});
        await patchTask(id, { ...patch, position });
      });
    });
    root.querySelectorAll('[data-drop-day]').forEach((cell) => {
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault(); cell.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain'), t = findTask(id), day = cell.dataset.dropDay; if (!t) return;
        const patch = { due: day }; if (t.start && t.due) patch.start = addDays(day, -diffDays(t.start, t.due)); else if (t.start && t.start > day) patch.start = '';
        patchTask(id, patch);
      });
    });
    // Gantt : déplacer ou redimensionner une barre
    const W = P.zoom === 'day' ? 40 : P.zoom === 'month' ? 8 : 22;
    root.querySelectorAll('.pm-bar').forEach((bar) => {
      bar.addEventListener('pointerdown', (e) => {
        const id = bar.dataset.gantt, t = findTask(id); if (!t || e.button !== 0) return;
        const resize = e.target.dataset.resize === 'r', x0 = e.clientX, left0 = bar.offsetLeft, w0 = bar.offsetWidth; let moved = 0;
        bar.setPointerCapture(e.pointerId); bar.classList.add('dragging');
        const onMove = (ev) => { moved = Math.round((ev.clientX - x0) / W); if (resize) bar.style.width = Math.max(W, w0 + moved * W) + 'px'; else bar.style.left = left0 + moved * W + 'px'; };
        const onUp = () => {
          bar.removeEventListener('pointermove', onMove); bar.classList.remove('dragging');
          if (!moved) return openDetail(id);
          const s = t.start || t.due, d = t.due || t.start;
          if (resize) patchTask(id, { start: s, due: addDays(d, Math.max(-diffDays(s, d), moved)) });
          else patchTask(id, { start: addDays(s, moved), due: addDays(d, moved) });
        };
        bar.addEventListener('pointermove', onMove); bar.addEventListener('pointerup', onUp, { once: true });
      });
    });
    const sc = root.querySelector('#pmGanttScroll'); if (sc && !sc.dataset.scrolled) { const td = sc.querySelector('.pm-today'); if (td) sc.scrollLeft = Math.max(0, td.offsetLeft - 160); sc.dataset.scrolled = '1'; }
    renderPresence();
    // déposer une tâche sur une liste de la barre latérale = la déplacer
    S.root.querySelectorAll('[data-drop-list]').forEach((a) => {
      a.ondragover = (e) => { e.preventDefault(); a.classList.add('drop'); }; a.ondragleave = () => a.classList.remove('drop');
      a.ondrop = async (e) => { e.preventDefault(); a.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id && findTask(id)?.listId !== a.dataset.dropList) { await patchTask(id, { listId: a.dataset.dropList }); S.tasks = S.tasks.filter((x) => S.route.page !== 'list' || x.listId === S.route.id); await loadTree(); renderAll(); toast('Tâche déplacée'); } };
    });
  }
  AFTER.doc = (root) => {
    const ta = root.querySelector('[data-pm-input="docBody"]'), pv = root.querySelector('#pmDocPreview');
    ta?.addEventListener('input', () => { pv.innerHTML = md(ta.value); root.querySelector('#pmDocSaved').textContent = 'Enregistrement…'; saveDoc(ta.value); });
  };

  /* ---------- Délégation d'évènements ---------- */
  function bind(root) {
    if (root.dataset.pmBound) return; root.dataset.pmBound = '1';
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-pm]'); if (!el || !root.contains(el)) return;
      if (el.tagName === 'A' && el.dataset.pm !== 'listMenu') e.preventDefault();
      if (el.tagName === 'BUTTON' && el.closest('a')) e.preventDefault();
      onAction(el.dataset.pm, el.dataset.id, el, e);
    });
    root.addEventListener('keydown', (e) => { const el = e.target.closest('[data-pm="descEdit"]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onAction('descEdit', null, el, e); } });
    root.addEventListener('change', (e) => { const el = e.target.closest('[data-pm-change]'); if (el) onChange(el.dataset.pmChange, el); });
    root.addEventListener('keydown', (e) => {
      const el = e.target;
      if (el.matches?.('.pm-d-title') && e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (el.matches?.('[data-pm-form-input="tag"]') && e.key === 'Enter') {
        e.preventDefault(); const v = el.value.trim().toLowerCase(); if (!v) return;
        patchTask(S.detail, { tags: [...new Set([...S.dd.task.tags, v])] }).then(() => { S.tree.tags = [...new Set([...S.tree.tags, v])].sort(); S.root.querySelector('[data-pm-form-input="tag"]')?.focus(); });
      }
    });
    root.addEventListener('input', debounce((e) => { const el = e.target; if (el.matches?.('[data-pm-input="q"]')) { S.filters.q = el.value; renderMain(); const i = S.root.querySelector('[data-pm-input="q"]'); i?.focus(); i?.setSelectionRange(el.value.length, el.value.length); } }, 200));
    root.addEventListener('submit', (e) => { const f = e.target.closest('[data-pm-form]'); if (!f) return; e.preventDefault(); onSubmit(f.dataset.pmForm, f).then(() => { if (['quick', 'subtask', 'check', 'comment'].includes(f.dataset.pmForm)) f.reset?.(); }); });
  }

  /* ---------- Chronomètre visible dans la barre latérale ---------- */
  function tickTimer() {
    clearInterval(S.timerTick);
    if (!S.tree?.running) return;
    const draw = () => { const el = document.getElementById('pmTimer'); if (!el) return clearInterval(S.timerTick); const s = Math.floor((Date.now() - S.tree.running.startedAt) / 1000); el.textContent = `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${z(Math.floor(s / 60) % 60)}:${z(s % 60)}`; };
    draw(); S.timerTick = setInterval(draw, 1000);
  }

  window.KairosPM = { mount };
})();
