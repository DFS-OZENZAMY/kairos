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

## Sécurité

- Un seul **mot de passe maître**, jamais stocké. La clé de chiffrement en est dérivée avec PBKDF2-SHA256 (310 000 itérations, sel aléatoire).
- Toutes les données sont chiffrées avec **AES-256-GCM** (Web Crypto API du navigateur) avant d’être enregistrées dans le stockage local.
- **Aucun serveur, aucun compte, aucune télémétrie.** Rien ne quitte ton appareil. Les seules ressources externes sont les polices Google Fonts et la bibliothèque de lecture QR `jsQR` (jsDelivr, version figée).
- Verrouillage automatique après inactivité (réglable), et `Ctrl + Maj + L` pour verrouiller tout de suite.
- **Si tu oublies ton mot de passe maître, personne ne peut récupérer les données.** Télécharge régulièrement une sauvegarde chiffrée (Réglages → Sauvegarde).

> Les données sont liées au navigateur et à l’appareil. Pour passer sur un autre PC : Réglages → Télécharger une sauvegarde, puis sur le nouvel appareil, « Restaurer une sauvegarde » depuis l’écran d’accueil.

## Utilisation

### En ligne (GitHub Pages)
Ouvre l’adresse GitHub Pages du dépôt dans Chrome ou Edge, puis installe-la : icône d’installation dans la barre d’adresse (ou menu ⋮ → Installer Kairos). Elle apparaît alors dans le menu Démarrer de Windows comme une vraie application et fonctionne hors ligne.

### En local
```bash
python -m http.server 8080
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
index.html            Coquille de l’app
styles.css            Interface (thèmes clair et sombre)
app.js                Logique : chiffrement, TOTP, vues
sw.js                 Fonctionnement hors ligne
manifest.webmanifest  Installation comme application
```

Aucune étape de build : HTML, CSS et JavaScript natifs.
