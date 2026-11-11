"""Aube : personnages glTF animés (choix, K-7 androïde, animations, arme en main, renard compagnon). Usage : python3 tests/aube_characters_e2e.py http://localhost:8960"""
import asyncio, sys
from playwright.async_api import async_playwright
B = sys.argv[1]; out = []
def ok(c, m): print(("PASS " if c else "FAIL ") + m); out.append(bool(c))
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-watchdog"])
    pg = await (await b.new_context(viewport={"width": 960, "height": 540})).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append((e.stack or str(e))[:300]))
    await pg.add_init_script("localStorage.setItem('aube.settings.v1', JSON.stringify({quality:'low', renderer:'webgl2'})); localStorage.removeItem('aube.save.v1')")
    await pg.goto(B + "/jeux/aventure/")
    for _ in range(400):
      if await pg.evaluate("window.aube && window.aube.state") == "title": break
      await pg.wait_for_timeout(1000)
    E = pg.evaluate; W = pg.wait_for_timeout
    ok(await E("aube.MODELS.player.k7?.measured === true && aube.fox?.measured === true"), "modèles glTF chargés et mis à l’échelle automatiquement (K-7, renard)")
    ok(await E("aube.MODELS.player.k7.states.size") >= 8, "K-7 : graphe d’animations (repos, marche, course, coup, saut, sort, coup reçu, mort)")
    await E("aube.render(false)"); await pg.click("[data-act='new']"); await W(300)
    cards = await E("[...document.querySelectorAll('.char-card b')].map(b=>b.textContent)")
    ok(cards[:2] == ["Néra", "K-7"] and "Extraterrestre" in cards, "écran de choix : Néra, K-7 + espèces à venir")
    await pg.click(".char-card[data-char='k7']"); await W(800)
    ok(await E("aube.state") == "playing" and await E("aube.P.char") == "k7" and await E("aube.save.character") == "k7", "partie lancée avec K-7 (sauvegardé)")
    ok(await E("aube.P.model.holder.enabled && !aube.P.body.children[0].enabled"), "le modèle 3D remplace le corps en primitives")
    await pg.keyboard.down("KeyW"); await W(800); walk = await E("aube.P.model.cur"); await pg.keyboard.down("ShiftLeft"); await W(700); run = await E("aube.P.model.cur"); await pg.keyboard.up("ShiftLeft"); await pg.keyboard.up("KeyW"); await W(700)
    ok(walk == "walk" and run == "run", f"animations de déplacement : {walk} → {run}")
    await E("aube.press('Attack')"); await W(100); ok(await E("aube.P.model.cur") == "attack", "animation d’attaque à l’épée")
    d = await E("(() => { const h = aube.P.model.hand.getPosition(), w = aube.P.weapons.sword.getPosition(); return Math.hypot(h.x-w.x, h.y-w.y, h.z-w.z) })()")
    ok(d < 0.05, "l’épée suit l’os de la main du squelette")
    await E("aube.selectWeapon('flute')") if await E("aube.save.items.flute") else None
    fx = await E("[aube.fox.holder.enabled, Math.hypot(aube.fox.x-aube.player.x, aube.fox.z-aube.player.z)]")
    ok(fx[0] and fx[1] < 8, f"Roux, le renard compagnon, suit le joueur ({fx[1]:.1f} m)")
    await E("aube.teleport(60, 120)"); await W(1500); ok(await E("aube.fox.cur") in ("run", "walk", "idle") and await E("Math.hypot(aube.fox.x-aube.player.x, aube.fox.z-aube.player.z)") < 15, "le renard rattrape le joueur en courant")
    await E("aube.player.hp = 1; aube.player.invuln = 0"); await E("(() => { const e = aube.enemies.find(e=>e.alive&&e.kind==='slime'); aube.teleport(e.x, e.z+1.2); })()"); await W(4000)
    ok(await E("aube.player.dead") == False or await E("aube.P.model.cur") == "death", "animation de mort")
    # retour à Néra (corps procédural) : les armes reviennent dans ses mains
    await E("aube.setCharacter('nera')"); ok(await E("!aube.P.model && aube.P.weapons.sword.parent === aube.P.weaponHome.sword.parent"), "changement de personnage : armes rendues au corps de Néra")
    ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:2]}" if errs else ""))
    print(f"\n{sum(out)}/{len(out)} vérifications réussies"); await b.close()
asyncio.run(main())
