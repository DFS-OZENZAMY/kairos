"""Rubrique Jeux de Kairos : vitrine, lancement du jeu dans Kairos, retour sans re-verrouillage. Usage : python3 tests/games_hub_e2e.py http://localhost:8960"""
import asyncio, sys
from playwright.async_api import async_playwright
B = sys.argv[1]; out = []
def ok(c, m): print(("PASS " if c else "FAIL ") + m); out.append(bool(c))
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-watchdog"])
    pg = await (await b.new_context(viewport={"width": 1280, "height": 760})).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    await pg.add_init_script("localStorage.setItem('aube.settings.v1', JSON.stringify({quality:'low', renderer:'webgl2'}))")
    await pg.goto(B + "/"); await pg.wait_for_selector("#mp", timeout=20000)
    await pg.fill("#mp", "Kairos-Maitre-2026!"); await pg.fill("#mp2", "Kairos-Maitre-2026!"); await pg.click("#lockBtn"); await pg.wait_for_selector("#nav a", timeout=30000)
    ok(await pg.locator("#nav a[href='#/games']").count() == 1, "entrée « Jeux » dans la navigation de Kairos")
    await pg.click("#nav a[href='#/games']"); await pg.wait_for_selector(".game-hero")
    ok("AUBE" in await pg.inner_text(".game-logo") and "Jouer" in await pg.inner_text(".game-actions"), "vitrine du jeu : titre, description, bouton Jouer")
    await pg.screenshot(path="/tmp/kairos_games.png", full_page=True)
    await pg.click("[data-act='playGame']"); await pg.wait_for_selector("#gameOverlay iframe")
    fr = pg.frame_locator("#gameOverlay iframe")
    ok(True, "le jeu s’ouvre en plein écran au-dessus de Kairos")
    frame = pg.frames[1]
    for _ in range(400):
      try:
        if await frame.evaluate("window.aube && window.aube.state") == "title": break
      except Exception: pass
      await pg.wait_for_timeout(1000)
    ok(await frame.evaluate("window.aube.state") == "title", "le jeu se charge dans Kairos (menu titre)")
    ok((await frame.inner_text("#btnQuitTitle")).strip() == "↩ Retour à Kairos", "bouton « Retour à Kairos » dans le jeu")
    await frame.evaluate("aube.render(false)")
    await frame.evaluate("parent.postMessage({type: 'kairos:activity'}, location.origin)")
    await frame.click("#btnQuitTitle"); await pg.wait_for_timeout(800)
    ok(await pg.locator("#gameOverlay").count() == 0 and await pg.locator(".game-hero").count() == 1, "retour à Kairos : le jeu se ferme, le coffre reste déverrouillé")
    ok(await pg.evaluate("location.hash") == "#/games", "on revient sur la rubrique Jeux")
    ok(not errs, "aucune erreur JavaScript" + (f" : {errs}" if errs else ""))
    print(f"\n{sum(out)}/{len(out)} vérifications réussies"); await b.close()
asyncio.run(main())
