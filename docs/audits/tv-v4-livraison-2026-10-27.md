# Préparation de livraison SeenIt TV V4 — 27 octobre 2026

#295, demande explicite « livre l’app sur la tv », adresse confirmée .46.
Widget 0.4.0, identité SeenItTV01.SeenItTV inchangée ; mobile 1.4.231 inchangé.

Validation locale : TNR cœur d’association, routes HTTP, isolation de profils et
révocation, descripteur HDMI natif, ES5 et inventaire. Harnais du runtime réel à
1920×1080 et 1280×720 : navigation, partie basse, QR, approbation simulée,
dissociation, quatre cycles arrière-plan avec zéro timer/grille résiduelle.
Le QR du générateur de production a aussi été décodé par jsqr1.4.0, téléchargé
et vérifié en outil de test privé, sans dépendance ajoutée au produit.
TypeScript et frontières strictes verts ; dette server.ts réduite d’un any.

Limites connues : le flux sportif réel dépend encore de #738 et n’est pas simulé
sur la TV. Netflix reste noir via variante store et sans effet via low-memory,
alors qu’il fonctionne depuis Samsung ; aucun correctif n’est revendiqué.
Les réglages natifs passent par un handler découvert ou une indication Home/Réglages,
jamais le menu interne connu pour prendre la télécommande sans affichage.

La validation navigateur n’est pas une preuve matérielle. Signature, digest,
installation, contrôle visuel et API canonique restent à consigner dans le checkpoint
stable avant de déclarer la livraison. Aucun root ni changement Home/startup/services.
