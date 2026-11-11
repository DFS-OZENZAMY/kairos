# Kairos

Ta journée de A à Z, tes mots de passe et tes codes 2FA, dans une seule app. Tout est chiffré sur ton appareil.

## Ce que fait l’app

- **Aujourd’hui** : tes tâches du jour, ta progression, tes habitudes, tes codes 2FA favoris et un journal quotidien.
- **Tâches** : échéances, priorités, étiquettes, vues Aujourd’hui / À venir / À faire / Terminées. L’étoile ajoute une tâche à ta journée.
- **Habitudes** : coche chaque jour, séries, rattrapage des 7 derniers jours.
- **Notes** : enregistrement automatique, épinglage, recherche.
- **Coffre** : identifiants, mots de passe, catégories, favoris. Copie en un clic (effacée du presse-papiers après 30 s), générateur de mots de passe, détection des mots de passe faibles ou réutilisés.
- **Codes 2FA (TOTP)** : remplace Google Authenticator / Microsoft Authenticator. Scan de QR code par caméra, import d’image ou collage d’une capture (Ctrl + V), saisie de la clé, liens `otpauth://`, et **import de tous tes comptes Google Authenticator en une fois** (son export « Transférer des comptes »).
- **Focus** : minuteur Pomodoro avec statistiques sur 7 jours et notifications.
- **Recherche globale** : `Ctrl + K` pour trouver un site, un code, une tâche ou une note et copier en un geste.

## Projets d’équipe (gestion de projet façon ClickUp)

Section **Projets** de la navigation (nécessite le déploiement Cloudflare). Un compte d’équipe (identifiant + mot de passe) est créé séparément du coffre : les données d’équipe sont stockées sur le serveur pour être partagées, le coffre personnel reste chiffré de bout en bout.

- **Organisation** : espaces de travail (équipes, invitations par code, rôles propriétaire / administrateur / membre) → **espaces** (couleur) → **dossiers** → **listes** → **tâches** → **sous-tâches**. Les anciens projets d’équipe deviennent automatiquement des listes, avec leurs tâches et leur discussion.
- **Tâches** : statuts personnalisables par liste (ouvert / en cours / terminé, couleurs, ordre), plusieurs responsables, observateurs, priorité (urgente → basse), dates de début et d’échéance, estimation, **suivi du temps** (chronomètre visible partout ou saisie manuelle), étiquettes, **champs personnalisés** (texte, nombre, liste déroulante, date, case à cocher, lien), checklist, **dépendances** (« bloquée par », sans boucle, confirmation avant de terminer une tâche bloquée), jalons, **tâches récurrentes** (jour / semaine / mois), description en Markdown, commentaires avec **@mentions**, historique d’activité, duplication, archivage, déplacement entre listes.
- **Vues** : **Liste** (groupée par statut, responsable, priorité, échéance…), **Tableau** Kanban (glisser-déposer), **Données** (tableur éditable avec totaux), **Calendrier** (glisser une tâche sur un jour), **Gantt** (barres déplaçables et redimensionnables, flèches de dépendances, jalons). Recherche, filtres (responsables, priorité, étiquettes, échéance), tri, « Moi », tâches terminées et sous-tâches, **vues enregistrées** (personnelles ou partagées), actions groupées.
- **Transversal** : **Mes tâches** sur tous les espaces, **boîte de réception** (assignations, mentions, commentaires, changements de statut des tâches suivies), **tableau de bord** (indicateurs, charge de chaque membre, activité sur 8 semaines, retards, à venir), **objectifs** (cibles chiffrées, oui/non ou tâches liées, progression automatique), **documents** d’espace en Markdown.
- **Temps réel** : les changements et la discussion de chaque liste arrivent instantanément chez les autres membres (Durable Object `ProjectRoom`), avec la présence des personnes connectées.

Code : `worker/pm.js` (API `/api/pm`, tables `pm_*` créées automatiquement), `public/pm.js` et `public/pm.css`. Tests : `tests/pm_api_test.py` (API, 31 vérifications) et `tests/pm_browser_e2e.py` (navigateur, deux membres, 25 vérifications) contre `npx wrangler dev`.

## Jeux

Rubrique **Jeux** de la navigation. Le jeu s’ouvre en plein écran **dans Kairos** (le coffre reste déverrouillé ; le jeu signale l’activité du joueur pour éviter le verrouillage automatique, et se ferme si Kairos se verrouille), ou dans un onglet séparé (`/jeux/aventure/`).

**Aube — Les Reliques du Gardien** : jeu d’aventure 3D construit sur le moteur open source **PlayCanvas 2.24** (licence MIT, embarqué dans `public/jeux/vendor/`), rendu **WebGPU** avec repli automatique sur **WebGL 2**.
- Île générée procéduralement (relief, plages, chemins, forêts, rochers, océan, ciel), style low-poly, ombres en cascade, brouillard, post-traitement (tonalité ACES, bloom, vignette, occlusion ambiante en Ultra), 4 niveaux de qualité.
- **Quatre armes** (touches 1 à 4, pouvoir sur F, mana) : épée (combo de trois coups, Tourbillon), arc des vents (tir chargé, volée de cinq flèches), bâton de braise (boule de feu explosive qui enflamme, nova de givre qui gèle), flûte d’Aube (onde sonore qui repousse et étourdit, mélodie de guérison). Esquive avec invulnérabilité, endurance, potions (R / T).
- **Ennemis à réflexes et pouvoirs** : ils esquivent coups et projectiles, parent de face (gardiens), encerclent la joueuse et n’attaquent qu’à deux à la fois. Brumelins (acide ralentissant, division en mourant), Gardiens de pierre (charge, onde au sol, garde), Sylvains corrompus (téléportation, orbes à tête chercheuse, racines), Colosse de cristal en trois phases (bouclier alimenté par trois cristaux, renforts, rage et ondes de choc).
- **Trésors** : dix coffres (certains gardés), or, potions, flèches, arc, bâton, amulette, anneau, talisman, rune de force, carte au trésor ; boutique et forge chez Ilyas ; inventaire (I).
- Relief lissé et texturé, vagues animées, nuages, ombres douces.
- **Personnages 3D animés (glTF)** : modèles avec squelette et animations (repos, marche, course, coup, saut, sort, coup reçu, mort), mise à l’échelle automatique, armes tenues par l’os de la main. Écran de choix du héros : **Néra** (exploratrice redessinée d’après son illustration : veste bleue, bandeau olive, sac à dos, corde, sacoche et boussole magique lumineuse ; illustration utilisée comme portrait et comme affiche) ou **K-7 (androïde)** ; **Roux**, un renard animé, accompagne le joueur. Espèces à venir : homme-loup, reptilien, extraterrestre.
  Pour ajouter un personnage : déposer un `.glb` (maillage + squelette + animations, par exemple exporté de Mixamo ou d’un outil de génération 3D) dans `public/jeux/aventure/models/` et ajouter une entrée dans `CHARACTERS` (`game.js`) avec les noms des animations, l’os de la main et la taille voulue. Crédits des modèles : `models/CREDITS.txt`. **Modèle 3D de Néra** : déposer `models/nera.glb` (personnage riggé Mixamo, animations nommées `Idle`, `Walk`, `Run`, `Attack`, `Jump`, `Death`, `Cast`, `Hurt`) ; il remplace automatiquement la version en formes simples.
- Trois sanctuaires : vaincre les gardiens, lire la stèle et éveiller les runes dans le bon ordre, prendre l’éclat ; finale au Temple de l’Aube.
- Sage Ilyas (dialogues à choix), totems de sauvegarde, pierres de cœur cachées, fleurs de soin, mini-carte et carte (M), quêtes, menus, réglages (qualité, rendu, sensibilité, champ de vision, volumes, axe inversé, secousses).
- Musique générative et bruitages synthétisés (Web Audio), clavier et souris, manette, écran tactile. Sauvegarde locale (`localStorage`).

Code : `public/jeux/aventure/` (`index.html`, `game.css`, `game.js`). Tests : `tests/aube_game_e2e.py` (partie complète, 37 vérifications), `tests/aube_combat_e2e.py` (armes, magie, IA, boss, trésors, 25 vérifications), `tests/aube_characters_e2e.py` (personnages glTF, 13 vérifications) et `tests/games_hub_e2e.py` (rubrique Jeux dans Kairos, 8 vérifications).

## Synchronisation entre appareils (Cloudflare)

Déployé sur Cloudflare, Kairos peut synchroniser ton coffre entre tous tes appareils grâce à une base **Cloudflare D1**, **chiffrée de bout en bout** :

- Le coffre est chiffré dans ton navigateur avant l’envoi. Le serveur ne stocke que du texte chiffré.
- Le serveur ne connaît jamais ton mot de passe maître ni ta clé de chiffrement. Il reçoit un jeton d’accès dérivé séparément (PBKDF2), dont il ne garde que l’empreinte SHA-256.
- Si tu modifies sur deux appareils en même temps, les changements sont fusionnés élément par élément (la version la plus récente gagne, les suppressions sont respectées).
- Limitation des tentatives : 10 essais ratés bloquent l’accès 15 minutes.

**Activer** : Réglages → Synchronisation → Activer, puis choisis un identifiant de coffre.
**Nouvel appareil** : sur l’écran d’accueil, « J’ai déjà un coffre en ligne », puis identifiant + mot de passe maître.

### Déployer sur Cloudflare (recommandé)

1. Tableau de bord Cloudflare → **Workers & Pages** → **Create** → onglet **Workers** → **Import a repository**.
   ⚠️ Choisis bien **Workers**, pas Pages : Pages n’exécuterait pas l’API de synchronisation.
2. Sélectionne le dépôt `kairos`.
3. Nom du projet : **`kairos`** (il doit correspondre au `name` de `wrangler.jsonc`).
4. Laisse la commande de build vide et la commande de déploiement sur `npx wrangler deploy`. Clique **Deploy**.

Au premier déploiement, Wrangler crée automatiquement la base D1 `kairos-db` et la relie au Worker ; le Worker crée ses tables au premier appel. Ensuite, chaque push sur `main` redéploie tout seul.

Une action GitHub manuelle (`.github/workflows/deploy-cloudflare.yml`, secret `CLOUDFLARE_API_TOKEN`) existe aussi en solution de secours.

### Déploiement manuel

```bash
npm install
npx wrangler login
npx wrangler deploy                        # crée la base D1 si besoin
```

### Développement local

```bash
npm install
npx wrangler dev                           # http://localhost:8787 avec une base D1 locale
```

## Sécurité

- Un seul **mot de passe maître**, jamais stocké. La clé de chiffrement en est dérivée avec PBKDF2-SHA256 (310 000 itérations, sel aléatoire).
- Toutes les données sont chiffrées avec **AES-256-GCM** (Web Crypto API du navigateur) avant d’être enregistrées dans le stockage local.
- **Aucun compte, aucune télémétrie.** Sans synchronisation, rien ne quitte ton appareil. Avec, seul le coffre chiffré est envoyé à ta propre base Cloudflare. Les seules ressources externes sont les polices Google Fonts et la bibliothèque de lecture QR `jsQR` (jsDelivr, version figée).
- Verrouillage automatique après inactivité (réglable), et `Ctrl + Maj + L` pour verrouiller tout de suite.
- **Si tu oublies ton mot de passe maître, personne ne peut récupérer les données.** Télécharge régulièrement une sauvegarde chiffrée (Réglages → Sauvegarde).

> Les données sont liées au navigateur et à l’appareil. Pour passer sur un autre PC : Réglages → Télécharger une sauvegarde, puis sur le nouvel appareil, « Restaurer une sauvegarde » depuis l’écran d’accueil.

## Utilisation

### En ligne
Sur Cloudflare (avec synchronisation) ou sur GitHub Pages (version locale uniquement), ouvre l’adresse dans Chrome ou Edge, puis installe-la : icône d’installation dans la barre d’adresse (ou menu ⋮ → Installer Kairos). Elle apparaît alors dans le menu Démarrer de Windows comme une vraie application et fonctionne hors ligne.

### En local, sans synchronisation
```bash
cd public && python -m http.server 8080
# puis ouvre http://localhost:8080
```

### Importer tes codes Google Authenticator
1. Dans Google Authenticator : menu ⋮ → **Transférer des comptes** → **Exporter des comptes**.
2. Dans Kairos : **Codes 2FA** → **Ajouter un code** → **Scanner avec la caméra** (ou fais une capture du QR et colle-la avec Ctrl + V).
3. Tous les comptes sont ajoutés d’un coup. Vérifie qu’un code correspond bien avant de supprimer l’ancienne appli.

## Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl + K` | Recherche globale et copie rapide |
| `Ctrl + Maj + L` | Verrouiller |
| `Alt + 1…8` | Changer de section |
| `/` | Aller au champ de recherche de la page |

## Structure

```
public/               Application (HTML, CSS, JS natifs, sans build)
  app.js              Chiffrement, TOTP, synchronisation, vues
  sw.js               Fonctionnement hors ligne
worker/index.js       API Cloudflare (synchronisation chiffrée)
migrations/           Schéma de la base D1
wrangler.jsonc        Configuration Cloudflare
scripts/ensure-d1.mjs Création automatique de la base
.github/workflows/    Déploiements Cloudflare et GitHub Pages
```
