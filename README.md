# 🎵 PicoTune — Chiptune Composer (MVP)

Une petite app web **installable sur iPhone** (PWA) pour composer des musiques
chiptune façon NES / Game Boy. Tout le son est **synthétisé en temps réel**
dans le navigateur via la Web Audio API — aucun fichier audio nécessaire.

## Concept

Trois instruments, une ligne chacun, que l'on **déplie** pour composer
visuellement sur une grille de pas :

| Piste     | Son                                   | Édition            |
|-----------|---------------------------------------|--------------------|
| **Drum**  | Kick · Snare · Hi-hat (synthèse)      | Grille on/off      |
| **Bass**  | Onde triangle/carrée/dent (graves)    | Mini piano-roll    |
| **Lead**  | Onde carrée/triangle/dent (aigus)     | Mini piano-roll    |

- **BPM réglable** (40–240) via le curseur
- **Résolution réglable** : 8 / 16 / 32 pas par mesure
- **Lecture en boucle** avec tête de lecture (playhead) animée
- **Mute** par piste, choix de la **forme d'onde** pour bass & lead
- **Sauvegarde automatique** (localStorage) — ta compo est conservée
- **Fonctionne hors-ligne** une fois chargée (service worker)

## Lancer en local

```bash
# Depuis la racine du projet
python3 -m http.server 8000
# puis ouvrir http://localhost:8000 dans le navigateur
```

> ⚠️ À ouvrir via un serveur HTTP (pas `file://`) car le code utilise des
> modules ES et un service worker.

## Installer sur iPhone

1. Servir les fichiers en HTTPS (ex. déploiement statique : GitHub Pages,
   Netlify, Vercel…).
2. Ouvrir l'URL dans **Safari**.
3. Bouton **Partager → « Sur l'écran d'accueil »**.
4. L'app se lance en plein écran, comme une app native.

> 💡 Sur iOS, le son ne démarre qu'après une **interaction** (appui sur ▶ ou
> sur une case) — c'est une contrainte d'Apple, gérée par l'app.

## Structure

```
index.html              # Coquille de l'app
css/styles.css          # UI mobile-first, thème sombre
js/audio.js             # Moteur de synthèse + séquenceur (scheduler Web Audio)
js/app.js               # État, rendu de la grille, contrôles transport
manifest.webmanifest    # Métadonnées PWA
sw.js                   # Service worker (cache hors-ligne)
icons/                  # Icônes générées
scripts/make_icons.py   # Génère les icônes (pur Python, sans dépendance)
```

## Détails techniques

- **Scheduler** : modèle de lookahead recommandé pour la Web Audio API
  (un `setTimeout` planifie les notes à l'avance, le rendu visuel suit via
  `requestAnimationFrame`) → timing stable indépendant du framerate.
- **Drum** : kick = sinus avec chute de pitch, snare = bruit filtré + tonale,
  hi-hat = bruit passe-haut court.
- **Bass / Lead** : oscillateurs avec enveloppe « snappy » courte.
- Un `DynamicsCompressor` sert de limiteur doux pour éviter la saturation.

## Idées pour la suite (post-MVP)

- Plusieurs mesures / patterns chaînables (mode « song »)
- Réglage du volume et du duty cycle par piste
- Export `.wav` / partage
- Quantification sur une gamme (mode mélodique facile)
- Plus d'instruments (arpège, 2e lead, percussions)
