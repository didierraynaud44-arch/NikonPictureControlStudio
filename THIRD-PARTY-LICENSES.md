# Bibliothèques et ressources tierces — Pixel RAW

Pixel RAW s'appuie sur plusieurs bibliothèques, modèles et bases de données
open source. Un grand merci à leurs auteurs et contributeurs.

---

## A. Traitement RAW et images

| Composant | Rôle | Licence | Source |
|---|---|---|---|
| `nikon-flexible-color-picture-control` (ssssota) | Lecture/écriture des fichiers Picture Control Nikon (NP3) — la base sur laquelle ce projet a démarré | MIT | https://github.com/ssssota/nikon-flexible-color-picture-control |
| `libraw-wasm` | Décodage RAW pleine résolution (démosaïçage) | *(à vérifier — voir package.json)* | https://github.com/EmilyGraceSeville7cf/libraw-wasm |
| `sharp` | Traitement et conversion d'images (redimensionnement, encodage JPEG/TIFF) | Apache 2.0 | https://github.com/lovell/sharp |
| `exifr` | Lecture des métadonnées EXIF | MIT | https://github.com/MikeKovarik/exifr |
| `exiftool-vendored` | Lecture/écriture EXIF avancée (ShutterCount, etc.) | MIT | https://github.com/photostructure/exiftool-vendored.js |
| ExifTool (Phil Harvey) | Moteur sous-jacent d'exiftool-vendored | Perl Artistic License / GPL au choix | https://exiftool.org |
| `dcraw_emu` (LibRaw) | Décodage RAW en repli | LGPL 2.1 / CDDL au choix | https://www.libraw.org |

## B. Modèles réseaux de neurones & vision (ONNX)

| Composant | Rôle | Licence | Source |
|---|---|---|---|
| `mobilesam-encoder.onnx` / `mobilesam-decoder.onnx` | Détection de sujet / arrière-plan (masques IA) | Apache 2.0 | https://github.com/ChaoningZhang/MobileSAM |
| `skyseg.onnx` | Détection automatique du ciel (masques IA) | MIT | https://github.com/xiongzhu666/Sky-Segmentation-and-Post-processing |
| `onnxruntime-web` | Moteur d'inférence exécutant les modèles ci-dessus | MIT | https://github.com/microsoft/onnxruntime |

## C. Gestion des LUTs (Hald-CLUT)

| Composant | Rôle | Licence |
|---|---|---|
| Format Hald-CLUT | Simulation de rendus pellicule via table de correspondance couleur | Domaine public / CC0 |

## D. Gestion des couleurs

| Composant | Rôle | Licence |
|---|---|---|
| `ProPhotoRGB-generated.icc` | Profil ICC ProPhoto RGB, généré à partir des valeurs colorimétriques officielles publiques | Licence ouverte ICC |

## E. Base de données d'objectifs (correction géométrique, vignettage, aberration chromatique)

| Composant | Rôle | Licence | Source |
|---|---|---|---|
| Base de calibration Lensfun (fichiers XML, dossier `lensfun/`) | Correction d'objectif (distorsion, vignettage, aberration chromatique) | **CC-BY-SA 3.0** (Creative Commons Attribution-ShareAlike 3.0 Unported) | https://github.com/lensfun/lensfun |

> ⚠️ La base de données Lensfun est sous licence CC-BY-SA 3.0 — toute
> redistribution ou modification de ces fichiers de calibration doit
> conserver la même licence et mentionner le projet Lensfun comme source.
> Cette obligation concerne uniquement les fichiers de données eux-mêmes,
> pas le reste du code de Pixel RAW.

## F. Environnement d'exécution

| Composant | Rôle | Licence |
|---|---|---|
| Electron | Socle applicatif (Chromium + Node.js) | MIT |
| electron-builder | Génération de l'installeur Windows | MIT |
| electron-store | Sauvegarde des préférences utilisateur | MIT |
| sqlite3 (node) | Base de données du catalogue | MIT (binding) / Domaine public (SQLite) |

---

*Cette liste sera mise à jour à mesure que de nouvelles bibliothèques sont
intégrées au projet. Les licences marquées "à vérifier" doivent être
confirmées directement dans le `package.json` ou le dépôt d'origine avant
publication officielle.*
