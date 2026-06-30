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
- **Motifs (patterns)** : crée plusieurs motifs A, B, C… (nouveau / dupliquer / supprimer)
- **Chaîne (song mode)** : enchaîne les motifs (ex. `A A B C`) joués en boucle ;
  le motif en cours de lecture est surligné
- **Accords** : pinceau Majeur / Mineur — un seul appui pose tout l'accord
  (fondamentale + tierce + quinte), ou plusieurs notes libres sur un même pas
- **Lecture en boucle** avec tête de lecture (playhead) animée
- **Mute** par piste, choix de la **forme d'onde** pour bass & lead
- **Sauvegarde automatique** (localStorage) — ta compo est conservée
- **Fonctionne hors-ligne** une fois chargée (service worker)

### Composer avec les motifs et la chaîne

1. Le bloc **Motifs** liste tes motifs (A, B, …). Touche une lettre pour
   l'**éditer** ; `＋` en crée un nouveau, `⧉` duplique, `🗑` supprime.
2. Le bloc **Chaîne** définit l'ordre de lecture. `＋ A` ajoute le motif
   en cours d'édition à la fin de la chaîne ; touche un maillon pour le retirer.
3. ▶ joue la chaîne en boucle. Tu peux éditer un motif pendant la lecture.

### Accords

Dans Bass, Lead ou Lead 2, choisis le pinceau **Majeur** ou **Mineur** : un
appui sur une case pose l'accord complet (les notes hors de la plage visible
sont ignorées). Repose la fondamentale pour effacer l'accord. Mode **Note** =
saisie note par note (polyphonie libre possible).

### Notes tenues (sustain)

Sur une piste mélodique, **active plusieurs cases voisines sur la même ligne** :
elles se jouent comme **une seule note tenue** (pas de redéclenchement à chaque
pas). Valable en lecture, à l'export **WAV/MP3** et en **MIDI** (une seule note
de la bonne durée). Les arpèges (mode Arpège) restent, eux, redéclenchés.

### Volume par piste

Chaque piste a un **curseur de volume** (visible quand elle est dépliée),
appliqué en temps réel et pris en compte dans l'export.

### Instruments

- **Drum** : Kick · Snare · Hi-hat · Open hat · Clap · Tom (6 percussions)
- **Bass** (graves, triangle par défaut)
- **Lead** (médium-aigu, carré par défaut)
- **Lead 2** (aigu, dent de scie par défaut)

### Duty cycle (largeur d'impulsion)

Sur les pistes mélodiques, avec l'onde **Carré**, choisis le **Pulse** :
**12% / 25% / 50% / 75%**. Chaque largeur a un timbre différent, façon canaux
square de la NES (le 50% est l'onde carrée classique). Implémenté via
`PeriodicWave` (séries de Fourier du signal pulse).

### Arpégiateur

Bouton **Arpège** par piste mélodique : **Off / ↑ / ↓ / ↕**, avec une
**Vitesse** (×2 / ×3 / ×4 notes par pas). Quand il est actif, les notes posées
sur un même pas (par ex. un accord stampé) sont jouées en séquence rapide à
l'intérieur du pas — l'effet « arpège chiptune » classique. Combine-le avec le
pinceau Majeur/Mineur pour des arpèges instantanés.

### Clavier MIDI en direct (🎹)

Bouton **🎹** dans la barre Morceau (Web MIDI API). ⚠️ **Non supporté par Safari
iPhone** (limite d'Apple) — fonctionne sur Chrome (ordi) et Android ; sinon
l'app affiche « non supporté » et le reste marche normalement.

1. **Activer le MIDI** (autorise l'accès, branche un clavier/contrôleur)
2. **Cible** : la piste qui reçoit les notes (Bass / Lead / Lead 2)
3. **Enregistrer** (armer) :
   - en **lecture** → overdub en boucle, notes quantisées au pas courant ;
   - à l'**arrêt** → saisie pas-à-pas, le curseur (liseré jaune) avance après
     chaque note ; les notes jouées ensemble forment un accord sur le même pas.

Désarmé, le clavier sert juste à jouer/écouter l'instrument de la piste cible.

### Export audio

Bouton **⬇ MP3** ou **⬇ WAV** dans le bloc Export : le morceau entier
(toute la chaîne) est rendu hors-ligne via `OfflineAudioContext`, puis :

- **WAV** : encodage natif 16-bit (lossless)
- **MP3** : encodé en 160 kbps via [lamejs](https://github.com/zhuker/lamejs)
  (librairie embarquée dans `js/lame.min.js`)
- **MIDI** : Standard MIDI File (format 1) écrit à la main — une piste par
  instrument, percussions sur le canal 10 (GM), programmes GM par piste.
  Les **arpèges sont aplatis en vraies notes MIDI**, donc ils sont préservés à
  l'ouverture dans un DAW / GarageBand.

> Sur iPhone, selon la version d'iOS, le fichier peut s'ouvrir dans un lecteur
> plutôt que se télécharger directement — utilise alors le bouton Partager
> pour l'enregistrer dans Fichiers.

### Génération automatique (✨)

Bouton **✨** dans la barre Morceau : génère des phrases musicales **cohérentes**
dans le motif courant.

- **Gamme** : Majeur / Mineur / Penta (mineure)
- **Tonalité** : choisie ou **Aléatoire**
- **Densité** : Clair / Normal / Dense
- **Pistes** à remplir : Drum / Bass / Lead / Lead 2

**Styles** (ambiances prédéfinies) : touche un style et ça pré-règle la gamme,
le tempo, les formes d'onde (duty) et la densité — pour une couleur immédiate :
- **Standard** (mineur), **Asiatique** (*hirajoshi*), **Médiéval** (*dorien*),
  **Spatial** (*tons entiers*, lent), **Héroïque** (majeur, rapide, dense),
  **Donjon** (*phrygien*, sombre), **Lo-fi** (*dorien*, lent, doux),
  **Dance** (mineur, 128 bpm, dense), **Western** (*penta majeur*),
  **Horreur** (*mineur harmonique*, très lent).

Les sélecteurs Gamme / Densité restent modifiables ensuite pour affiner.

> Si la batterie n'est pas cochée, la basse et le lead entrent **dès le premier
> pas** (l'intro épurée ne reste pas silencieuse).

**Structure** :
- **1 motif** : remplit le motif courant.
- **Couplet / Refrain** : génère 2 motifs (A, B) et une chaîne `A A B A B B`.
- **Morceau complet** : génère 4 motifs (Intro / Couplet / Refrain / Pont) et
  une chaîne arrangée `A B C B C D C`. Tous les motifs partagent la **même
  tonalité** ; chaque section a sa densité et son instrumentation (l'intro est
  clairsemée sans lead, le refrain est dense avec arpège, etc.).
  ⚠️ Le mode morceau remplace les motifs et la chaîne existants.

La logique est musicale, pas du bruit aléatoire :
- une **progression d'accords diatonique** est tirée dans la gamme/tonalité ;
- la **basse** suit les fondamentales (et la quinte selon la densité) ;
- le **lead** est une mélodie calée sur la gamme, biaisée vers les notes
  d'accord sur les temps forts (marche aléatoire contrainte entre) ;
- **Lead 2** déroule un **arpège** de l'accord en cours ;
- la **batterie** pose kick/snare/hats sur une grille rythmique cohérente.

Chaque génération tire des **gabarits rythmiques** différents (grooves de
batterie kick/snare/hats + fills, rythmes de basse, phrasés de lead) et le lead
est **motivique** (un petit motif mélodique inventé puis répété et réancré sur
les accords) : les phrases varient nettement d'une génération à l'autre tout en
restant dans le genre.

Relance pour obtenir des variations. Ça remplit le motif courant — tu peux
ensuite retoucher à la main, dupliquer le motif, l'enchaîner, exporter, etc.

### Sauvegarder / recharger des morceaux

- **💾** : sauvegarde le morceau courant (sous un nom) dans la bibliothèque
  (localStorage du navigateur)
- **📂** : ouvre la bibliothèque — **Charger**, **Supprimer**, ou
  **exporter/importer** un morceau en fichier `.json` (pratique pour le
  sauvegarder ailleurs ou le transférer)
- **＋** : nouveau morceau vierge
- Le morceau en cours est aussi **auto-sauvegardé** : il revient tel quel au
  rechargement de la page.

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
