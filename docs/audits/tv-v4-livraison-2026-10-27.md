# Préparation de livraison SeenIt TV V4 — 27 octobre 2026

#295, demande explicite « livre l’app sur la tv », adresse confirmée .46.
Widget 0.4.0, identité SeenItTV01.SeenItTV inchangée ; mobile 1.4.231 inchangé.

Contrôle réel après installation 0.4.0 : thème Brume conservé, Home V4 active,
mais les suggestions complétaient les apps connues par AgingApp/AmbientApp. Le
correctif 0.4.1 classe ces utilitaires système et exige un choix explicite pour
les apps inconnues, sans supprimer aucun ID de l'inventaire. CANAL+ détecté peut
utiliser son repère typographique local ; aucun ID de lancement n'est inventé.

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

## Terrain du28octobre — compte et Films & séries

Le service d'association779 est déployé. QR réellement créé sur la TV puis approbation
confirmée par le propriétaire ; phase linked/online,18contenus reçus, code masqué.
Le terrain révèle une seule affiche et des apps sans rapport dans Films. Cause code
confirmée : certains chemins stockés par le mobile sont des URLs TMDB complètes, rejetées
par le bootstrap qui n'acceptait que les chemins relatifs. Normalisation des deux formes,
refus des hôtes/secrets/query/chemins traversants et TNR sur readTvLibrary de production,
sans fetch externe supplémentaire ni modification de compte.

Composition V3-06 reprise en ES5 : fond/hero, filtres locaux, rail paysage quatre cartes,
fiche en lecture seule. Les apps restent sur Home ; pas de faux Reprendre ni progression
de maquette. Images cinq maximum, sources retirées au changement de hero/écran ; navigation,
chargement réel des images simulées et restauration de focus vérifiés dans le harnais
1920/1280. Le réseau du harnais ne laisse passer aucune image extérieure : seules deux
URLs de fixtures explicites sont satisfaites par un SVG local de test. Cette illustration
est hors WGT et ne remplace aucune affiche de production. Prochaine preuve : API/visuels
réels après déploiement et installation0.4.2. Suivi #295 / PR780.
