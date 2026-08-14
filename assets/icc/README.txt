Profils ICC - Espace colorimétrique d'export
==============================================

Adobe RGB (1998) a été retiré (problème de licence sur le fichier de profil
officiel Adobe) : seuls sRGB et ProPhoto RGB sont proposés.

- sRGB ne nécessite AUCUN fichier : c'est l'espace colorimétrique implicite
  par défaut de sharp/libvips pour un buffer RGB 8 bits non taggé (ce que
  produit canvas.toDataURL() côté renderer).

- ProPhoto RGB est généré PROGRAMMATIQUEMENT (voir services/iccProfileBuilder.js),
  à partir des valeurs colorimétriques officielles ROMM RGB publiées par
  l'ICC (ISO 22028-2:2013, registry.color.org/rgb-registry/rommrgb) : primaires
  R/V/B, point blanc D50, gamma 1.8. Aucun fichier .icc externe à fournir.

  Le fichier ProPhotoRGB-generated.icc apparaissant dans ce dossier après un
  premier export en ProPhoto RGB est ce profil généré, mis en cache sur disque
  (sharp exige un chemin de fichier, pas un buffer en mémoire) — il peut être
  supprimé sans risque, il sera régénéré automatiquement au prochain export.

  Validation effectuée lors de l'implémentation : le profil généré a été
  vérifié structurellement (parseur ICC indépendant), accepté sans erreur par
  lcms2 (moteur colorimétrique utilisé par sharp, très strict sur la validité
  des profils), et utilisé pour une vraie conversion de pixels aller-retour
  sRGB -> ProPhoto -> sRGB donnant des valeurs cohérentes (pas de couleurs
  aberrantes, teintes neutres/primaires inchangées, teintes saturées décalées
  comme attendu pour un espace à gamut plus large).
