"""Partie complète d'Aube dans un navigateur sans écran (rendu logiciel). Usage : python3 tests/aube_game_e2e.py http://localhost:8953"""
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
      try: await asyncio.wait_for(E("aube.snap()"), 120)
      except Exception: pass
      await pg.screenshot(path=path)
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
    # combat : un Brumelin
    await E("aube.teleport(-120, 30)"); await pg.wait_for_timeout(2500)
    zt = await E("document.getElementById('zoneTitle').textContent"); ok("Forêt murmurante" in zt, "titre de zone : Forêt murmurante")
    hp0 = await E("aube.enemies.filter(e=>e.zone==='forest'&&e.alive).map(e=>e.hp).reduce((a,b)=>a+b,0)")
    for _ in range(8):
      await E("(() => { const e = aube.enemies.find(e=>e.zone==='forest'&&e.alive); if (e) { aube.player.yaw = Math.atan2(e.x-aube.player.x, e.z-aube.player.z); aube.teleport(e.x - Math.sin(aube.player.yaw)*1.6, e.z - Math.cos(aube.player.yaw)*1.6); aube.press('Attack'); } })()")
      await pg.wait_for_timeout(450)
    hp1 = await E("aube.enemies.filter(e=>e.zone==='forest').map(e=>Math.max(0,e.hp)).reduce((a,b)=>a+b,0)")
    ok(hp1 < hp0, f"attaques à l’épée : PV des Brumelins {hp0} → {hp1}")
    await shot("/tmp/aube_combat.png")
    php = await E("aube.player.hp"); ok(php <= 100, f"les ennemis ripostent (PV de Néra : {php:.0f})")
    await E("aube.kill('forest')"); await pg.wait_for_timeout(800)
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
    await E("aube.teleport(0, -128)"); await pg.wait_for_timeout(1800)
    boss = await E("(() => { const b = aube.enemies.find(e=>e.kind==='boss'); return {state: b.state, bar: !document.getElementById('bossBar').hidden} })()")
    ok(boss["state"] != "dormant" and boss["bar"], "le Colosse de cristal s’éveille : barre de vie du boss")
    await shot("/tmp/aube_boss.png")
    await E("aube.kill('ridge')"); await pg.wait_for_timeout(900)
    ok(await E("aube.save.cleared.ridge") == True and not await E("aube.zoneObjs.ridge.barrier.enabled"), "Colosse vaincu : la barrière de la crête tombe")
    await E("aube.interact('shard:ridge')"); await pg.wait_for_timeout(400); await E("aube.finishDialogue()")
    # lac : énigme + gardiens
    await E("aube.kill('lake')"); o2 = await E("({order: aube.zoneObjs.lake.order, glyphs: aube.zoneObjs.lake.glyphs})")
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
    await pg.click("[data-act='toTitle']"); await pg.wait_for_timeout(500)
    ok("3/3 éclats" in await E("document.getElementById('saveInfo').textContent"), "menu titre : « Continuer » avec la progression")
    ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:2]}" if errs else ""))
    print(f"\n{sum(out)}/{len(out)} vérifications réussies")
    await b.close()
asyncio.run(main())
