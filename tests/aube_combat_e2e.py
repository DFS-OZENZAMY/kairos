"""Aube : armes, magie, instrument, IA des ennemis (réflexes, pouvoirs), boss, trésors. Usage : python3 tests/aube_combat_e2e.py http://localhost:8960"""
import asyncio, sys
from playwright.async_api import async_playwright
B = sys.argv[1]; out = []
def ok(c, m): print(("PASS " if c else "FAIL ") + m); out.append(bool(c))
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-watchdog"])
    pg = await (await b.new_context(viewport={"width": 960, "height": 540})).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append((e.stack or str(e))[:400]))
    await pg.add_init_script("localStorage.setItem('aube.settings.v1', JSON.stringify({quality:'low', renderer:'webgl2'})); localStorage.removeItem('aube.save.v1')")
    await pg.goto(B + "/jeux/aventure/")
    for _ in range(400):
      if await pg.evaluate("window.aube && window.aube.state") == "title": break
      await pg.wait_for_timeout(1000)
    E = lambda js: pg.evaluate(js); W = lambda ms: pg.wait_for_timeout(ms)
    await E("aube.render(false)")
    await pg.click("[data-act='new']"); await pg.click(".char-card[data-char='nera']"); await W(800)
    # Ilyas offre la flûte
    await E("aube.teleport(aube.interactables.find(i=>i.id==='ilyas').x, aube.interactables.find(i=>i.id==='ilyas').z + 2.2)"); await W(300)
    await E("aube.interact('ilyas')"); await W(200); await E("aube.finishDialogue()"); await W(300)
    ok(await E("aube.save.items.flute === true"), "Ilyas confie la Flûte d’Aube (instrument magique)")
    slots = await E("document.querySelectorAll('#weapons .wslot').length"); ok(slots == 4, "barre d’armes : 4 emplacements (épée, arc, bâton, flûte)")
    ok(await E("!document.getElementById('mpBar').closest('.meter').hidden") , "barre de mana affichée")
    # coffre gardé : refus tant que les gardiens vivent, puis arc + flèches
    c1 = await E("(() => { const c = aube.chests.find(c=>c.id==='c1'); return [c.x, c.z] })()")
    await E(f"aube.teleport({c1[0]}, {c1[1]} + 2)"); await W(300)
    await E("aube.openChest('c1')"); await W(200)
    ok(await E("aube.save.items.bow !== true"), "coffre gardé : impossible de l’ouvrir tant que ses gardiens rôdent")
    for _ in range(3): await E("aube.enemies.filter(e=>e.alive&&e.zone==='guard').forEach(e=>{ e.inv=0; e.hp=1; })"); await E("aube.kill('guard')"); await W(150)
    await E("aube.openChest('c1')"); await W(500)
    ok(await E("aube.save.items.bow === true && aube.save.arrows >= 20") and "Arc des vents" in await E("document.getElementById('loot').textContent"), "trésor : Arc des vents + 20 flèches (fenêtre de butin)")
    ok(await E("aube.chests.find(c=>c.id==='c1').open"), "le couvercle du coffre s’ouvre")
    # arc : tir chargé qui touche un ennemi
    async def target(kind, dist=8):
      return await E(f"""(() => {{ const e = aube.enemies.find(e=>e.alive&&e.kind==='{kind}'&&e.zone!=='guard'&&e.zone!=='pylon'); e.d = {{...e.d, reflex: 0, block: 0}}; e.state='idle'; e.cd=99; e.cd2=99; e.cd3=99; e.hx=e.x; e.hz=e.z;
        aube.teleport(e.x, e.z + {dist}); aube.player.yaw = Math.PI; e.frozen=0; e.stun=0; e.burn=0; return aube.enemies.indexOf(e); }})()""")
    i = await target('golem'); await E("aube.selectWeapon('bow')"); hp0 = await E(f"aube.enemies[{i}].hp"); a0 = await E("aube.save.arrows")
    await E("aube.press('Attack')"); await W(500); await E("aube.press('AttackUp')"); await W(1200)
    ok(await E(f"aube.enemies[{i}].hp") < hp0 and await E("aube.save.arrows") == a0 - 1, f"arc : flèche chargée qui touche (PV {hp0} → {await E(f'aube.enemies[{i}].hp')})")
    # bâton (magie) : boule de feu explosive + brûlure, nova de givre
    await E("aube.save.items.staff = true; aube.player.mp = 90"); await E("aube.selectWeapon('staff')")
    i = await target('golem'); hp0 = await E(f"aube.enemies[{i}].hp")
    await E("aube.press('Attack')"); await W(1200)
    st = await E(f"(() => {{ const e = aube.enemies[{i}]; return {{hp: e.hp, burn: e.burn > 0}} }})()")
    ok(st["hp"] < hp0 and st["burn"], f"bâton de braise : boule de feu explosive et brûlure (PV {hp0} → {st['hp']})")
    ok(await E("aube.player.mp") < 90, "les sorts consomment de la mana")
    await E(f"aube.teleport(aube.enemies[{i}].x, aube.enemies[{i}].z + 3)"); await E("aube.player.mp = 90; aube.press('KeyF')"); await W(300)
    ok(await E(f"aube.enemies[{i}].frozen > 0"), "nova de givre : l’ennemi est gelé")
    # flûte (instrument) : onde qui étourdit
    await E("aube.selectWeapon('flute')"); i = await target('slime', 4); await E("aube.player.mp = 90; aube.press('Attack')"); await W(250)
    ok(await E(f"aube.enemies[{i}].stun > 0"), "flûte d’Aube : la note de lumière étourdit et repousse")
    await E("aube.teleport(0, 120); aube.player.hp = 40; aube.player.mp = 90; aube.player.powerCd.flute = 0; aube.press('KeyF')"); await W(300)
    hot = await E("aube.player.hot"); await W(2000)
    ok(hot > 30 and await E("aube.player.hp") > 55, f"mélodie de guérison : soin progressif (+{round(hot)} PV en cours)")
    # épée : tourbillon
    await E("aube.selectWeapon('sword')"); i = await target('slime', 2); hp0 = await E(f"aube.enemies[{i}].hp"); await E("aube.player.st = 100; aube.press('KeyF')"); await W(400)
    ok(await E(f"aube.enemies[{i}].hp") < hp0, "épée : pouvoir Tourbillon")
    # réflexes des ennemis : esquives et parades
    dodges = await E("""(() => { let n = 0, b = 0; const g = aube.enemies.find(e=>e.alive&&e.kind==='golem'&&e.zone!=='guard'); const s = aube.enemies.find(e=>e.alive&&e.kind==='slime'&&e.zone!=='guard');
      for (let k = 0; k < 40; k++) { for (const e of [g, s]) { e.d = {...aube.ENEMY_REF?.[e.kind] ?? e.d, reflex: e.kind==='slime' ? 0.2 : 0.08, block: e.kind==='golem' ? 0.38 : undefined}; e.state='chase'; e.frozen=0; e.stun=0; e.inv=0; e.cd=99; } aube.teleport(g.x, g.z + 2.5); aube.player.yaw = Math.PI; aube.player.attack=0; aube.player.comboWindow=0; aube.player.st=100; aube.press('Attack'); }
      return 'ok' })()""")
    stats = await E("""(() => { let dodge = 0, block = 0; const g = aube.enemies.find(e=>e.alive&&e.kind==='golem'&&e.zone!=='guard'); for (let k = 0; k < 60; k++) { g.state='chase'; g.inv=0; g.frozen=0; g.stun=0; aube.teleport(g.x, g.z + 2.5); aube.player.yaw = Math.PI;
      const before = g.state; window.__r = (window.__r||0); } return 0 })()""")
    # mesure statistique directe via une boucle de jeu réelle
    blocks = 0; ddg = 0
    for k in range(14):
      r = await E("""(() => { const g = aube.enemies.find(e=>e.alive&&e.kind==='golem'&&e.zone!=='guard'); g.d = {...g.d, block: 0.38, reflex: 0.08}; g.state='chase'; g.inv=0; g.cd=99; g.cd2=99; g.cd3=99; g.frozen=0; g.stun=0; g.hp = g.maxHp;
        aube.teleport(g.x, g.z + 2.6); aube.player.yaw = Math.PI; aube.player.attack=0; aube.player.comboWindow=0; aube.player.st=100; aube.press('Attack'); return aube.enemies.indexOf(g) })()""")
      await W(120); stt = await E(f"aube.enemies[{r}].state")
      if stt == 'block': blocks += 1
      if stt == 'dodge': ddg += 1
      await W(900)
    ok(blocks + ddg > 0, f"réflexes : le gardien pare ou esquive les coups ({blocks} parades, {ddg} esquives sur 14 attaques)")
    # pouvoirs ennemis : division du Brumelin, sylvain qui se téléporte
    n0 = await E("aube.enemies.filter(e=>e.alive&&e.kind==='mini').length")
    await E("(() => { const s = aube.enemies.find(e=>e.alive&&e.kind==='slime'&&e.zone!=='guard'); s.inv=0; s.state='chase'; aube.kill && 0; })()")
    await E("(() => { const s = aube.enemies.find(e=>e.alive&&e.kind==='slime'&&e.zone!=='guard'); s.inv = 0; s.hp = 1; aube.player.yaw = Math.atan2(s.x-aube.player.x, s.z-aube.player.z); })()")
    si = await E("aube.enemies.findIndex(e=>e.alive&&e.kind==='slime'&&e.zone!=='guard')"); await E(f"aube.slay({si})"); await W(400)
    ok(await E("aube.enemies.filter(e=>e.alive&&e.kind==='mini').length") > n0, "pouvoir : le Brumelin vaincu se divise en deux")
    w = await E("(() => { const w = aube.enemies.find(e=>e.alive&&e.kind==='wisp'); w.state='chase'; w.cd3=0; w.cd=99; w.cd2=99; w.frozen=0; w.stun=0; aube.teleport(w.x, w.z + 3); return [w.x, w.z, aube.enemies.indexOf(w)] })()")
    await W(1500); w2 = await E(f"[aube.enemies[{w[2]}].x, aube.enemies[{w[2]}].z]")
    ok(abs(w2[0] - w[0]) + abs(w2[1] - w[1]) > 5, "Sylvain corrompu : se téléporte quand on l’approche")
    await E(f"(() => {{ const w = aube.enemies[{w[2]}]; w.cd = 0; w.cd3 = 99; w.state='chase'; aube.teleport(w.x, w.z + 10); }})()"); await W(1600)
    ok(await E("aube.projectiles.some(p=>p.kind==='orb')") or await E("aube.player.hp < aube.player.maxHp"), "Sylvain : lance des orbes magiques à tête chercheuse")
    # boss : bouclier de cristal alimenté par trois cristaux
    await E("aube.teleport(0, -128)"); await W(1500)
    await E("(() => { const b = aube.enemies.find(e=>e.kind==='boss'); b.hp = b.maxHp * 0.62; })()")
    await E("(() => { const b = aube.enemies.find(e=>e.kind==='boss'); aube.teleport(b.x, b.z + 3.2); aube.player.yaw = Math.PI; aube.selectWeapon('sword'); aube.player.attack=0; aube.player.st=100; aube.press('Attack'); })()"); await W(800)
    sh = await E("(() => { const b = aube.enemies.find(e=>e.kind==='boss'); return {shield: !!b.shield, pylons: aube.enemies.filter(e=>e.alive&&e.kind==='pylon').length} })()")
    ok(sh["shield"] and sh["pylons"] == 3, "Colosse : bouclier de cristal alimenté par 3 cristaux")
    for _ in range(4): await E("aube.kill('pylon')"); await W(150)
    ok(await E("!aube.enemies.find(e=>e.kind==='boss').shield"), "détruire les cristaux brise le bouclier")
    # potions, boutique, inventaire
    await E("aube.teleport(0, 120)"); await W(300); await E("aube.player.hp = 30; aube.save.potions.hp = 1; aube.press('KeyR')"); await W(300)
    ok(await E("aube.player.hp") >= 90, "potion de vie (touche R)")
    await E("aube.save.gold = 200"); await E("aube.teleport(aube.interactables.find(i=>i.id==='ilyas').x, aube.interactables.find(i=>i.id==='ilyas').z + 2.2)"); await W(300)
    await E("aube.interact('ilyas')"); await W(200)
    labels = await E("aube.state === 'dialogue' ? [...document.querySelectorAll('#dlgChoices button')].map(b=>b.textContent) : []")
    if not labels: await W(1500); labels = await E("[...document.querySelectorAll('#dlgChoices button')].map(b=>b.textContent)")
    ok(any("Commercer" in l for l in labels), "Ilyas propose de commercer")
    await pg.keyboard.press("Digit1"); await W(400)
    shop = await E("[...document.querySelectorAll('#dlgChoices button')].map(b=>b.textContent)")
    if not shop: await pg.keyboard.press("KeyE"); await W(600); shop = await E("[...document.querySelectorAll('#dlgChoices button')].map(b=>b.textContent)")
    ok(any("Affûter" in l for l in shop), "boutique : potions, flèches, épée affûtée, armure")
    idx = next(i for i, l in enumerate(shop) if "Affûter" in l); await pg.keyboard.press(f"Digit{idx+1}") if idx < 9 else None; await W(300)
    if idx >= 3: await E(f"document.querySelectorAll('#dlgChoices button')[{idx}].click()")
    await E("aube.finishDialogue()"); await W(200)
    ok(await E("aube.save.upgrades.blade === true && aube.save.gold === 80"), "achat : épée affûtée (+25 % de dégâts, 120 or)")
    await pg.keyboard.press("KeyI"); await W(400)
    ok(await E("aube.state") == "inventory" and "Arc des vents" in await E("document.getElementById('invBody').textContent"), "inventaire (I) : armes, objets, statistiques")
    try: await asyncio.wait_for(E("aube.snap()"), 60); await pg.screenshot(path="/tmp/aube_inventory.png", timeout=60000)
    except Exception: pass
    await pg.keyboard.press("KeyI"); await W(300)
    ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:2]}" if errs else ""))
    print(f"\n{sum(out)}/{len(out)} vérifications réussies"); await b.close()
asyncio.run(main())
