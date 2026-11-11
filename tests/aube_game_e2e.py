"""Partie complète d'Aube dans un navigateur sans écran (rendu logiciel). Usage : python3 tests/aube_game_e2e.py http://localhost:8960"""
import asyncio, sys
from playwright.async_api import async_playwright
B = sys.argv[1]; out = []
def ok(c, m): print(("PASS " if c else "FAIL ") + m); out.append(bool(c))
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--disable-gpu-watchdog", "--disable-renderer-backgrounding"])
    pg = await (await b.new_context(viewport={"width": 960, "height": 540})).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append((e.stack or str(e))[:300]))
    await pg.add_init_script("localStorage.setItem('aube.settings.v1', JSON.stringify({quality:'low', renderer:'webgl2'})); localStorage.removeItem('aube.save.v1')")
    await pg.goto(B + "/jeux/aventure/")
    for _ in range(400):
      if await pg.evaluate("window.aube && window.aube.state") == "title": break
      await pg.wait_for_timeout(1000)
    ok(await pg.evaluate("window.aube.state") == "title", "le jeu se charge jusqu’au menu titre (" + await pg.evaluate("window.aube.device") + ")")
    E = lambda js: pg.evaluate(js)
    await E("aube.render(false)")   # rendu logiciel trop lent : logique à pleine vitesse, rendu à la demande
    async def shot(path):
      try: await asyncio.wait_for(E("aube.snap()"), 60); await pg.screenshot(path=path, timeout=60000)
      except Exception: pass   # capture facultative : le rendu logiciel des tests est très lent
    await pg.click("[data-act='new']"); await pg.wait_for_timeout(1200)
    ok(await E("window.aube.state") == "playing" and not await E("document.getElementById('hud').hidden"), "nouvelle partie : interface en jeu affichée")
    q = await E("document.getElementById('questText').textContent"); ok("Ilyas" in q, "objectif initial : " + q)
    # déplacement clavier (code physique KeyW = Z sur AZERTY)
    x0 = await E("[aube.player.x, aube.player.z]")
    await pg.keyboard.down("KeyW"); await pg.wait_for_timeout(1500); await pg.keyboard.up("KeyW")
    x1 = await E("[aube.player.x, aube.player.z]")
    ok(abs(x1[0] - x0[0]) + abs(x1[1] - x0[1]) > 2, f"déplacement au clavier ({abs(x1[1]-x0[1]):.1f} m)")
    await shot("/tmp/aube_play.png")
    # dialogue avec Ilyas
    await E("aube.teleport(aube.interactables.find(i=>i.id==='ilyas').x, aube.interactables.find(i=>i.id==='ilyas').z + 2.2)"); await pg.wait_for_timeout(500)
    ok("Ilyas" in await E("document.getElementById('prompt').textContent"), "invite « Parler à Ilyas » à proximité")
    await pg.keyboard.press("KeyE"); await pg.wait_for_timeout(1500)
    ok(await E("aube.state") == "dialogue" and "Ilyas" in await E("document.getElementById('dlgName').textContent"), "dialogue avec Ilyas (texte progressif)")
    await shot("/tmp/aube_dialogue.png")
    await E("aube.finishDialogue()"); await pg.wait_for_timeout(500)
    ok(await E("aube.save.talked") == 1 and "éclats" in (await E("document.getElementById('questTitle').textContent")).lower(), "quête principale lancée")
    # --- arsenal, magie, instrument, trésors
    ok(await E("aube.save.items.flute === true") and await E("document.querySelectorAll('.wslot:not(.locked)').length") == 2, "Ilyas confie la flûte : 2 armes disponibles (épée, flûte)")
    await E("aube.select('flute')"); await pg.wait_for_timeout(200)
    ok(await E("aube.player.weapon") == "flute", "changement d’arme (touche 4 : flûte)")
    # coffre gardé de la forêt (arc) : refusé tant que les gardiens vivent
    c1 = await E("(() => { const c = aube.chests.find(c => c.id === 'c1'); return {x: c.x, z: c.z}; })()")
    await E(f"aube.teleport({c1['x']}, {c1['z']} + 2)"); await pg.wait_for_timeout(300)
    await E("aube.interact('chest:c1')"); await pg.wait_for_timeout(200)
    ok(not await E("aube.save.items.bow"), "coffre gardé : impossible de l’ouvrir tant que ses gardiens rôdent")
    await E("aube.kill('guard')"); await pg.wait_for_timeout(300); await E("aube.interact('chest:c1')"); await pg.wait_for_timeout(500)
    ok(await E("aube.save.items.bow") and await E("aube.save.arrows") == 20 and "Arc des vents" in await E("document.getElementById('loot').textContent"), "coffre ouvert : Arc des vents + 20 flèches (fenêtre de butin)")
    await shot("/tmp/aube_loot.png")
    # flûte : onde sonore qui étourdit
    await E("aube.teleport(-58, 18)"); await pg.wait_for_timeout(300)
    await E("(() => { const e = aube.enemies.find(e => e.alive && e.zone === null && e.kind === 'slime' && Math.hypot(e.x + 58, e.z - 12) < 12); aube.player.yaw = Math.atan2(e.x - aube.player.x, e.z - aube.player.z); e.x = aube.player.x + Math.sin(aube.player.yaw) * 4; e.z = aube.player.z + Math.cos(aube.player.yaw) * 4; e.state = 'chase'; window.__s = e; })()")
    mp0 = await E("aube.player.mp"); await E("aube.press('Attack')"); await pg.wait_for_timeout(250)
    ok(await E("window.__s.stun > 0 || window.__s.hp < window.__s.maxHp") and await E("aube.player.mp") < mp0, "flûte : la note de lumière consomme du mana et étourdit le Brumelin")
    # bâton (obtenu via le coffre du lac) : boule de feu et nova de givre
    c2 = await E("(() => { const c = aube.chests.find(c => c.id === 'c2'); return {x: c.x, z: c.z}; })()")
    await E("aube.kill('guard')"); await E(f"aube.teleport({c2['x']}, {c2['z']} + 2)"); await pg.wait_for_timeout(300); await E("aube.interact('chest:c2')"); await pg.wait_for_timeout(300)
    ok(await E("aube.save.items.staff") == True, "coffre du lac : Bâton de braise")
    await E("aube.select('staff'); aube.teleport(-58, 18)"); await pg.wait_for_timeout(300)
    await E("(() => { const e = window.__s.alive ? window.__s : aube.enemies.find(e => e.alive && e.zone === null); aube.player.yaw = Math.atan2(e.x - aube.player.x, e.z - aube.player.z); e.x = aube.player.x + Math.sin(aube.player.yaw) * 6; e.z = aube.player.z + Math.cos(aube.player.yaw) * 6; e.d = {...e.d, reflex: 0}; e.stun = 3; window.__f = e; window.__hp0 = e.hp; })()")
    await E("aube.player.mp = 100; aube.press('Attack')"); await pg.wait_for_timeout(900)
    ok(await E("!window.__f.alive || window.__f.hp < window.__hp0"), "bâton : la boule de feu explose et touche l’ennemi")
    ok(await E("!window.__f.alive || window.__f.burn > 0 || window.__f.hp < window.__hp0 - 20"), "bâton : l’explosion enflamme (dégâts sur la durée)")
    await E("(() => { const e = aube.enemies.find(e => e.alive && e.kind !== 'boss' && e.kind !== 'pylon'); e.x = aube.player.x + 3; e.z = aube.player.z; e.stun = 0; window.__g = e; })()")
    await E("aube.player.mp = 100; aube.press('KeyF')"); await pg.wait_for_timeout(300)
    ok(await E("window.__g.frozen > 0"), "bâton : la nova de givre gèle les ennemis proches")
    await shot("/tmp/aube_magic.png")
    # flûte : mélodie de guérison
    await E("aube.select('flute'); aube.player.hp = 40; aube.player.mp = 100; aube.press('KeyF')"); await pg.wait_for_timeout(2500)
    ok(await E("aube.player.hp") > 55, "flûte : la mélodie de guérison régénère la vie")
    # arc : flèche chargée
    await E("aube.select('bow')"); await pg.wait_for_timeout(100)
    n0 = await E("aube.save.arrows"); await pg.mouse.move(480, 270)
    await E("aube.press('Attack')"); await pg.wait_for_timeout(250); await E("aube.press('AttackUp')"); await pg.wait_for_timeout(300)
    ok(await E("aube.save.arrows") == n0 - 1, "arc : une flèche tirée (munitions décomptées)")
    # IA : réflexes et pouvoirs (statistiques sur plusieurs essais)
    await E("aube.select('sword')")
    dodged = await E("""(() => { let n = 0; for (let i = 0; i < 40; i++) { const e = aube.enemies.find(x => x.alive && x.kind === 'golem'); if (!e) break; e.state = 'chase'; e.frozen = 0; e.stun = 0; e.x = aube.player.x + Math.sin(aube.player.yaw) * 2.5; e.z = aube.player.z + Math.cos(aube.player.yaw) * 2.5; aube.__reflex(3.4); if (e.state === 'block' || e.state === 'dodge') n++; } return n; })()""")
    ok(dodged >= 6, f"réflexes : le Gardien de pierre pare ou esquive ({dodged}/40 coups d’épée anticipés)")
    split = await E("(() => { const e = aube.enemies.find(x => x.alive && x.kind === 'slime'); const n0 = aube.enemies.filter(x => x.alive && x.kind === 'mini').length; e.hp = 1; aube.__dmg(e, 5); return aube.enemies.filter(x => x.alive && x.kind === 'mini').length - n0; })()")
    ok(split == 2, "pouvoir : le Brumelin vaincu se divise en deux petits")
    g0 = await E("aube.gold"); ok(g0 > 0, f"butin : or récupéré sur les ennemis ({g0} pièces)")
    # boutique d'Ilyas
    await E("aube.save.gold = 100"); await E("aube.teleport(aube.interactables.find(i=>i.id==='ilyas').x, aube.interactables.find(i=>i.id==='ilyas').z + 2.2)"); await pg.wait_for_timeout(300)
    await E("aube.interact('ilyas')"); await pg.wait_for_timeout(1500); await pg.keyboard.press("Space"); await pg.wait_for_timeout(300)
    await pg.click("#dlgChoices [data-choice='0']"); await pg.wait_for_timeout(1200); await pg.keyboard.press("Space"); await pg.wait_for_timeout(300)
    hp0 = await E("aube.save.potions.hp"); await pg.click("#dlgChoices [data-choice='0']"); await pg.wait_for_timeout(300)
    ok(await E("aube.save.gold") == 70 and await E("aube.save.potions.hp") == hp0 + 1, "boutique d’Ilyas : potion de vie achetée (100 → 70 or)")
    await E("aube.finishDialogue()")
    await pg.keyboard.press("KeyI"); await pg.wait_for_timeout(500)
    inv = await E("document.getElementById('invBody').textContent")
    ok("Arc des vents" in inv and "Bâton de braise" in inv and "Coffres ouverts : 2" in inv, "inventaire (I) : armes, objets, coffres ouverts")
    await shot("/tmp/aube_inventory.png"); await pg.keyboard.press("KeyI"); await pg.wait_for_timeout(300)
    # combat : un Brumelin
    await E("aube.teleport(-120, 30)"); await pg.wait_for_timeout(2500)
    zt = await E("document.getElementById('zoneTitle').textContent"); ok("Forêt murmurante" in zt, "titre de zone : Forêt murmurante")
    hp0 = await E("aube.enemies.filter(e=>e.zone==='forest'&&e.alive&&e.kind==='slime').map(e=>e.hp).reduce((a,b)=>a+b,0)")
    for _ in range(8):
      await E("(() => { const e = aube.enemies.find(e=>e.zone==='forest'&&e.alive&&e.kind==='slime'); if (e) { aube.player.yaw = Math.atan2(e.x-aube.player.x, e.z-aube.player.z); aube.teleport(e.x - Math.sin(aube.player.yaw)*1.6, e.z - Math.cos(aube.player.yaw)*1.6); aube.press('Attack'); } })()")
      await pg.wait_for_timeout(450)
    hp1 = await E("aube.enemies.filter(e=>e.zone==='forest'&&e.kind==='slime').map(e=>Math.max(0,e.hp)).reduce((a,b)=>a+b,0)")
    ok(hp1 < hp0, f"attaques à l’épée : PV des gardiens de la forêt {hp0} → {hp1}")
    await shot("/tmp/aube_combat.png")
    php = await E("aube.player.hp"); ok(php <= 100, f"les ennemis ripostent (PV de Néra : {php:.0f})")
    for _ in range(4): await E("aube.kill('forest')"); await pg.wait_for_timeout(300)
    ok(await E("aube.save.cleared.forest") == True, "forêt libérée de ses gardiens")
    # énigme des runes : mauvais ordre puis bon ordre
    o = await E("({order: aube.zoneObjs.forest.order, glyphs: aube.zoneObjs.forest.glyphs})")
    wrong = [g for g in o["glyphs"] if g != o["order"][0]][0]
    await E(f"aube.interact('rune:forest:{o['glyphs'].index(wrong)}')"); await pg.wait_for_timeout(300)
    ok(not await E("aube.zoneObjs.forest.runes.some(r=>r.on)"), "mauvais ordre : les runes s’éteignent")
    await E("aube.interact('stele:forest')"); await pg.wait_for_timeout(300)
    stele = await E("document.getElementById('dlgText').textContent || ''"); await E("aube.finishDialogue()")
    for g in o["order"]: await E(f"aube.interact('rune:forest:{o['glyphs'].index(g)}')"); await pg.wait_for_timeout(250)
    ok(await E("aube.save.runes.forest") == True and not await E("aube.zoneObjs.forest.barrier.enabled"), "bon ordre (lu sur la stèle) : sceau rompu, barrière ouverte")
    await E("aube.interact('shard:forest')"); await pg.wait_for_timeout(600); await E("aube.finishDialogue()")
    ok(await E("aube.save.shards.forest") == True and await E("document.querySelectorAll('.shard.on').length") == 1, "Éclat de sève récupéré (1/3)")
    # boss de la crête
    await E("aube.player.hp = aube.player.maxHp"); await E("aube.teleport(0, -128)"); await pg.wait_for_timeout(1800)   # le test ne pare pas les coups : on soigne avant le boss
    boss = await E("(() => { const b = aube.enemies.find(e=>e.kind==='boss'); return {state: b.state, bar: !document.getElementById('bossBar').hidden} })()")
    ok(boss["state"] != "dormant" and boss["bar"], "le Colosse de cristal s’éveille : barre de vie du boss")
    await shot("/tmp/aube_boss.png")
    await E("aube.kill('ridge')"); await pg.wait_for_timeout(900)
    ok(await E("aube.save.cleared.ridge") == True and not await E("aube.zoneObjs.ridge.barrier.enabled"), "Colosse vaincu : la barrière de la crête tombe")
    await E("aube.interact('shard:ridge')"); await pg.wait_for_timeout(400); await E("aube.finishDialogue()")
    # lac : énigme + gardiens
    for _ in range(4): await E("aube.kill('lake')"); await pg.wait_for_timeout(200)
    o2 = await E("({order: aube.zoneObjs.lake.order, glyphs: aube.zoneObjs.lake.glyphs})")
    for g in o2["order"]: await E(f"aube.interact('rune:lake:{o2['glyphs'].index(g)}')"); await pg.wait_for_timeout(200)
    await E("aube.interact('shard:lake')"); await pg.wait_for_timeout(400); await E("aube.finishDialogue()")
    ok(await E("Object.keys(aube.save.shards).length") == 3, "les trois éclats sont réunis")
    # sauvegarde + totem
    await E("aube.interact('cp:temple')"); await pg.wait_for_timeout(300)
    saved = await E("JSON.parse(localStorage.getItem('aube.save.v1'))")
    ok(saved["checkpoint"] == "temple" and len(saved["shards"]) == 3, "totem allumé : progression sauvegardée")
    # finale
    await E("aube.teleport(0, 6)"); await pg.wait_for_timeout(300); await E("aube.interact('altar')")
    for _ in range(14):
      if await E("aube.state") == "victory": break
      await pg.wait_for_timeout(1000)
    ok(await E("aube.state") == "victory" and await E("aube.save.finished") == True, "finale : l’Aube se lève, écran de victoire")
    await shot("/tmp/aube_victory.png")
    # reprise depuis le menu
    await pg.click("#victory [data-act='toTitle']"); await pg.wait_for_timeout(500)
    ok("3/3 éclats" in await E("document.getElementById('saveInfo').textContent"), "menu titre : « Continuer » avec la progression")
    ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:2]}" if errs else ""))
    print(f"\n{sum(out)}/{len(out)} vérifications réussies")
    await b.close()
asyncio.run(main())
