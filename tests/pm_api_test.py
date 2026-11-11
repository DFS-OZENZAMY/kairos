"""Gestion de projet Kairos : scénario d'équipe complet sur l'API /api/pm. Usage : BASE=http://127.0.0.1:8787 python3 tests/pm_api_test.py"""
import os, json, uuid, requests, datetime
B = os.environ["BASE"]; ok = lambda c, m: print(("PASS " if c else "FAIL ") + m)
def acct(name):
    s = requests.Session(); s.headers.update({"Content-Type": "application/json", "Origin": B})
    h = name.lower() + uuid.uuid4().hex[:5]
    r = s.post(B + "/api/team/register", json={"handle": h, "name": name, "password": "motdepasse1"}); assert r.status_code == 201, r.text
    s.uid = r.json()["user"]["id"]; s.handle = h; return s
amina, karim, intrus = acct("Amina"), acct("Karim"), acct("Intrus")
team = amina.post(B + "/api/team/teams", json={"name": "Agence Atlas"}).json()["team"]["id"]
code = amina.post(B + f"/api/team/teams/{team}/invites").json()["code"]; karim.post(B + "/api/team/join", json={"code": code})
# ancien projet (module équipes) → migration automatique en liste
old = amina.post(B + f"/api/team/teams/{team}/projects", json={"name": "Site vitrine"}).json()["project"]["id"]
amina.post(B + f"/api/team/projects/{old}/tasks", json={"title": "Maquette", "status": "doing", "priority": 3, "assigneeId": karim.uid})
tree = amina.get(B + f"/api/pm/teams/{team}/tree").json()
lst = next(l for l in tree["lists"] if l["id"] == old)
ok(tree["spaces"][0]["name"] == "Général" and lst["counts"].get("doing") == 1, "migration : l'ancien projet devient une liste (mêmes identifiant, tâches, chat)")
mig = amina.get(B + "/api/pm/tasks", params={"list": old}).json()["tasks"][0]
ok(mig["status"] == "doing" and mig["priority"] == 1 and mig["assignees"] == [karim.uid], "migration : statut, priorité (urgente) et responsable conservés")
ok(intrus.get(B + f"/api/pm/teams/{team}/tree").status_code == 404, "un non-membre ne voit pas l'espace de travail (404)")
# hiérarchie
sp = amina.post(B + f"/api/pm/teams/{team}/spaces", json={"name": "Clients", "color": "#C2410C"}).json()["space"]["id"]
fd = amina.post(B + f"/api/pm/spaces/{sp}/folders", json={"name": "Restaurant Le Zellige"}).json()["folder"]["id"]
statuses = [{"name": "Backlog", "type": "open", "color": "#8C94AD"}, {"name": "En production", "type": "active", "color": "#2F45D8"}, {"name": "Validation client", "type": "active", "color": "#C27A08"}, {"name": "Livré", "type": "closed", "color": "#17865A"}]
li = amina.post(B + f"/api/pm/spaces/{sp}/lists", json={"name": "Refonte du site", "folderId": fd, "statuses": statuses}).json()["list"]["id"]
meta = amina.get(B + f"/api/pm/lists/{li}").json()
keys = [s["key"] for s in meta["list"]["statuses"]]
ok(keys == ["backlog", "en_production", "validation_client", "livre"] and meta["list"]["folderId"] == fd, "espace → dossier → liste, statuts personnalisés : " + ", ".join(keys))
f_budget = amina.post(B + f"/api/pm/lists/{li}/fields", json={"name": "Budget", "type": "number"}).json()["field"]["id"]
f_canal = amina.post(B + f"/api/pm/lists/{li}/fields", json={"name": "Canal", "type": "select", "options": [{"id": "web", "name": "Web"}, {"id": "insta", "name": "Instagram"}]}).json()["field"]["id"]
today = datetime.date.today(); d = lambda n: (today + datetime.timedelta(days=n)).isoformat()
t1 = amina.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "Charte graphique", "priority": 2, "start": d(-3), "due": d(-1), "assignees": [karim.uid, amina.uid], "tags": ["Design", "client"], "estimate": 240, "custom": {f_budget: 1500, f_canal: "web"}}).json()["task"]
ok(t1["status"] == "backlog" and sorted(t1["assignees"]) == sorted([karim.uid, amina.uid]) and t1["tags"] == ["design", "client"] and t1["custom"] == {f_budget: 1500, f_canal: "web"}, "tâche riche : plusieurs responsables, étiquettes, estimation, champs personnalisés")
ok(amina.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "x", "custom": {f_canal: "fax"}}).status_code == 400, "champ « liste déroulante » : option inconnue refusée")
ok(amina.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "x", "start": d(5), "due": d(1)}).status_code == 400, "début après l'échéance refusé")
t2 = amina.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "Intégration des pages", "due": d(4), "start": d(1)}).json()["task"]
sub = amina.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "Page menu", "parentId": t2["id"]}).json()["task"]
ok(amina.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "x", "parentId": sub["id"]}).status_code == 400, "sous-tâche créée ; pas de sous-sous-tâche")
c1 = amina.post(B + f"/api/pm/tasks/{t2['id']}/checklist", json={"text": "Accueil"}).json()["item"]; amina.post(B + f"/api/pm/tasks/{t2['id']}/checklist", json={"text": "Contact"})
amina.patch(B + f"/api/pm/checklist/{c1['id']}", json={"done": True})
amina.post(B + f"/api/pm/tasks/{t2['id']}/deps", json={"blockedBy": t1["id"]})
ok(amina.post(B + f"/api/pm/tasks/{t1['id']}/deps", json={"blockedBy": t2["id"]}).json().get("error") == "Cette dépendance créerait une boucle", "dépendances : les boucles sont refusées")
tasks = {t["id"]: t for t in amina.get(B + "/api/pm/tasks", params={"list": li}).json()["tasks"]}
ok(tasks[t2["id"]]["subtasks"] == {"total": 1, "done": 0} and tasks[t2["id"]]["checklist"] == {"total": 2, "done": 1} and tasks[t2["id"]]["blockedBy"] == [t1["id"]], "compteurs : sous-tâches, checklist, dépendances")
r = amina.patch(B + f"/api/pm/tasks/{t2['id']}", json={"status": "livre"})
ok(r.status_code == 409 and r.json()["blockers"][0]["title"] == "Charte graphique", "clôturer une tâche bloquée demande confirmation (409 + tâches bloquantes)")
ok(amina.patch(B + f"/api/pm/tasks/{t2['id']}", json={"status": "livre", "force": True}).json()["task"]["statusType"] == "closed", "… et passe avec confirmation")
# commentaires, mentions, boîte de réception
amina.post(B + f"/api/pm/tasks/{t1['id']}/comments", json={"body": f"@{karim.handle} peux-tu valider les couleurs ?"})
inbox = karim.get(B + "/api/pm/notifications", params={"team": team}).json()["notifications"]
kinds = [n["kind"] for n in inbox]
ok("assigned" in kinds and "mention" in kinds, "boîte de réception : assignation et @mention reçues par Karim")
ok(karim.get(B + f"/api/pm/teams/{team}/tree").json()["unread"] >= 2, "compteur de notifications non lues")
karim.post(B + "/api/pm/notifications/read", json={"all": True}); ok(karim.get(B + f"/api/pm/teams/{team}/tree").json()["unread"] == 0, "tout marquer comme lu")
# temps passé
karim.post(B + f"/api/pm/tasks/{t1['id']}/time", json={"minutes": 90, "note": "Planche de tendances"})
run = karim.post(B + f"/api/pm/tasks/{t1['id']}/time/start").json()["running"]
ok(karim.get(B + f"/api/pm/teams/{team}/tree").json()["running"]["taskId"] == t1["id"], "chronomètre lancé (visible partout)")
stop = karim.post(B + "/api/pm/time/stop").json()["stopped"]
det = amina.get(B + f"/api/pm/tasks/{t1['id']}").json()
ok(stop["minutes"] >= 1 and det["task"]["timeSpent"] >= 91 and len(det["time"]) == 2, f"suivi du temps : saisie manuelle + chronomètre ({det['task']['timeSpent']} min)")
ok(any(a["kind"] == "comment" for a in det["activity"]) and any(a["kind"] == "created" for a in det["activity"]) and det["blocking"][0]["id"] == t2["id"], "détail : historique d'activité et tâches bloquées par celle-ci")
# récurrence
rec = amina.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "Rapport hebdo", "due": d(0), "recurrence": "weekly", "assignees": [karim.uid]}).json()["task"]
amina.patch(B + f"/api/pm/tasks/{rec['id']}", json={"status": "livre"})
nxt = [t for t in amina.get(B + "/api/pm/tasks", params={"list": li}).json()["tasks"] if t["title"] == "Rapport hebdo" and t["statusType"] != "closed"]
ok(len(nxt) == 1 and nxt[0]["due"] == d(7) and nxt[0]["assignees"] == [karim.uid], "tâche récurrente : prochaine occurrence créée (+7 jours, même responsable)")
# déplacement, statut renommé, actions groupées
amina.patch(B + f"/api/pm/tasks/{mig['id']}", json={"listId": li})
moved = amina.get(B + f"/api/pm/tasks/{mig['id']}").json()["task"]
ok(moved["listId"] == li and moved["status"] == "backlog", "déplacer une tâche vers une autre liste (statut adapté)")
new_st = [{"key": "backlog", "name": "À planifier", "type": "open", "color": "#8C94AD"}, {"key": "en_production", "name": "En production", "type": "active", "color": "#2F45D8"}, {"key": "livre", "name": "Livré", "type": "closed", "color": "#17865A"}]
amina.patch(B + f"/api/pm/lists/{li}", json={"statuses": new_st, "remap": {"validation_client": "en_production"}})
ok(amina.get(B + f"/api/pm/lists/{li}").json()["list"]["statuses"][0]["name"] == "À planifier", "statuts modifiés (renommage, suppression avec réaffectation)")
bulk = amina.post(B + "/api/pm/tasks/bulk", json={"ids": [t1["id"], moved["id"]], "patch": {"priority": 1, "tags": ["urgent"]}}).json()
ok(bulk["updated"] == 2, "actions groupées sur plusieurs tâches")
# mes tâches, vues, tableau de bord, documents, objectifs
mine = karim.get(B + "/api/pm/tasks").json()["tasks"]
ok({t["title"] for t in mine} >= {"Charte graphique", "Rapport hebdo"}, "« Mes tâches » de Karim sur tous ses espaces : " + ", ".join(sorted({t['title'] for t in mine})))
v = amina.post(B + "/api/pm/views", json={"team": team, "scope": f"list:{li}", "name": "Urgent design", "type": "board", "shared": True, "config": {"filters": {"priority": [1]}, "groupBy": "status"}}).json()["view"]["id"]
ok(any(x["id"] == v for x in karim.get(B + "/api/pm/views", params={"team": team, "scope": f"list:{li}"}).json()["views"]), "vue enregistrée partagée avec l'équipe")
dash = amina.get(B + f"/api/pm/teams/{team}/dashboard").json()
kw = next(w for w in dash["workload"] if w["userId"] == karim.uid)
ok(dash["totals"]["overdue"] >= 1 and kw["open"] >= 2 and kw["minutesWeek"] >= 91 and len(dash["weeks"]) == 8, f"tableau de bord : {dash['totals']['overdue']} en retard, charge de Karim {kw['open']} tâches, {kw['minutesWeek']} min cette semaine")
doc = amina.post(B + f"/api/pm/spaces/{sp}/docs", json={"title": "Brief client", "body": "# Objectifs\n- Plus de réservations"}).json()["doc"]["id"]
ok(karim.get(B + f"/api/pm/docs/{doc}").json()["doc"]["title"] == "Brief client", "document d'espace partagé")
g = amina.post(B + f"/api/pm/teams/{team}/goals", json={"name": "Lancer le nouveau site", "due": d(30), "targets": [{"name": "Pages livrées", "kind": "tasks", "taskIds": [t1["id"], t2["id"]]}, {"name": "Réservations / mois", "kind": "number", "start": 0, "target": 200, "current": 50}]}).json()["goal"]["id"]
goal = next(x for x in amina.get(B + f"/api/pm/teams/{team}/goals").json()["goals"] if x["id"] == g)
ok(abs(goal["progress"] - (0.5 + 0.25) / 2) < 0.01, f"objectif : progression calculée {round(goal['progress']*100)} % (tâches liées + valeur chiffrée)")
# sécurité
ok(intrus.get(B + f"/api/pm/tasks/{t1['id']}").status_code == 404 and intrus.patch(B + f"/api/pm/tasks/{t1['id']}", json={"title": "pirate"}).status_code == 404, "un non-membre ne peut ni lire ni modifier une tâche")
ok(karim.delete(B + f"/api/pm/spaces/{sp}").status_code == 403, "seuls les administrateurs suppriment un espace")
ok(requests.post(B + f"/api/pm/lists/{li}/tasks", json={"title": "x"}, headers={"Origin": "https://pirate.example", "Content-Type": "application/json", "Cookie": "kt_session=" + amina.cookies.get("kt_session")}).status_code == 403, "requêtes d'un autre site refusées")
ok(amina.delete(B + f"/api/pm/tasks/{t2['id']}").status_code == 200 and not any(t["id"] == sub["id"] for t in amina.get(B + "/api/pm/tasks", params={"list": li}).json()["tasks"]), "supprimer une tâche emporte ses sous-tâches")
