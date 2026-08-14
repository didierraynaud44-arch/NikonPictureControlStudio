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
