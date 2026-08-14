## Modèle de détection du ciel (requis pour le masque "Ciel")

Le fichier `skyseg.onnx` (167 Mo) dépasse la limite de taille de GitHub et 
n'est donc pas inclus dans ce dépôt.

Pour activer la détection automatique du ciel :
1. Téléchargez `skyseg.onnx` depuis : https://huggingface.co/JianyuanWang/skyseg
   (licence MIT — modèle original : xiongzhu666/Sky-Segmentation-and-Post-processing)
2. Placez-le dans `assets/ai-models/skyseg.onnx`
3. Recompilez l'application (`npm run dist`)

Sans ce fichier, les autres fonctionnalités de masques IA (Sujet/Arrière-plan, 
via MobileSAM) restent pleinement fonctionnelles — seul le bouton "Ciel" 
sera inopérant.

## Modèle de débruitage neuronal (requis pour "Débruitage neuronal (expérimental)")

Le fichier `denoise-nafnet.onnx` (112 Mo) dépasse la limite de taille de GitHub 
et n'est donc pas inclus dans ce dépôt.

Pour activer le débruitage neuronal :
1. Téléchargez `denoise-nafnet.dtmodel` depuis :
   https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/denoise-nafnet.dtmodel
   (licence MIT — modèle original : megvii-research/NAFNet)
2. C'est une archive ZIP : extrayez-la, elle contient `denoise-nafnet/model.onnx`
   et `denoise-nafnet/config.json`.
3. Renommez `model.onnx` en `denoise-nafnet.onnx` et placez-le dans 
   `assets/ai-models/denoise-nafnet.onnx`
4. Recompilez l'application (`npm run dist`)

Sans ce fichier, le reste de l'application reste pleinement fonctionnel — seule 
la section "Débruitage neuronal (expérimental)" du panneau Picture Control 
sera inopérante.
