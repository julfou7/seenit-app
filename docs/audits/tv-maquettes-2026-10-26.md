# AUDIT-2026-10-26-TV — Home Samsung

Baseline : branche TV `2f151398b2e7a1addc57f09429e9d07cc770c76a`, main synchronisé
`dc993071c04caf8dd42c3a532695f74c65f8e70e`. Widget0.2.0, cible QE55Q6FNA/Tizen4.
Référence : 11 planches de `SeenIt TV (2).html`, décision propriétaire du26octobre : fidélité,
moins de texte, vrais logos, apps extensibles, accès réglages, objectif RAM.
Les exports personnels restent hors dépôt ; leur runtime embarqué n'est jamais réutilisé.

## Matrice de conformité et limites

| Point | Constat baseline | Décision / preuve | Suivi |
|---|---|---|---|
| Composition | Grand Hero et matrice2×2, éloignés des planches | Dernier arbitrage Luma : quatre raccourcis compacts, apps5+1 dominantes, sources directes ; SeenIt/Sport contextuels | Corrigé, SEENIT-TV-001 |
| Focus | Réglages du header sélectionné initialement | TV après choix du profil, Retour conserve la destination | Navigateur1080p/720p |
| Logos | Monogrammes uniquement | Icône native locale, SVG Simple Icons11.15.0/CC0, initiales si inconnue | TNR sécurité URLs et rendu |
| Apps | Marques prédéfinies, pas d'édition | Toute USER épinglable par ID détecté,32pins/profil ; actualiser/reprise | 133packages,18cartes/page |
| Système | Packages conservés | USER/SYSTEM/UNKNOWN maintenus, lancement système désactivé | TNR adapter + navigateur |
| Films | Fausse reprise Slow Horses | Réouverture d'apps réussies seulement, pas de média/historique inventé | TNR succès/échec |
| Profils | Profils UI sans préférences séparées | Favoris/réouvertures séparés, Invité éphémère | TNR stockage/quota |
| Compte | Pas d'appairage sûr | Compte parent envisagé ; ne pas attribuer un Netflix partagé à quelqu'un | P1, #295, appairage restant |
| Milo | Mode enfant par noms d'apps sans protection effective | Décision propriétaire : profil simple sans code, apps explicitement choisies, système masqué ; aucun verrou parental annoncé | TNR navigateur, #295 |
| Sport | Exemples affichés aussi sur TV réelle | Exemples uniquement preview, état vide réel, aucun diffuseur codé par compétition | P2, #738, calendrier réel restant |
| Réglages | Fallback ID Samsung lancé sans vérification | Handler installé ou getAppInfo vérifié, échec visible ; Retour demande confirmation avant exit | TNR VM/navigateur ; terrain #295 |
| TNT | Viewer pouvait reprendre le dernier HDMI | SourceTV réelle sélectionnée avant viewer | Adapter simulé ; terrain #295 |
| RAM | Horloge active et grilles cachées conservées |0interval caché,3au retour, images/grilles libérées,4cycles sans accumulation | Navigateur ; mesure physique P1 #295 |
| Fond | Gros bloc sombre | Dégradés bleu/prune locaux sans bitmap plein écran, vidéo ou blur | Inspection captures1080p/720p |
| Inspiration Luma | Nouvelle demande propriétaire en cours de chantier | Thèmes statiques clair/sombre/auto, libellés au focus, appui long organisation ; aucun code, fond animé ou installation Android copié | TNR modèles et navigateur |
| Retour des logos | Vider src des SVG partagés pouvait donner un rectangle vide au retour | Vecteurs minuscules détachés intacts, rasters vidés puis grilles supprimées | Comparaison visuelle clair/sombre après navigation |
| Home par défaut | Pas de prise en charge native validée | Aucun changement startup/Home/root ; probe + rollback + accord avant écriture | P1, #295 |

## Preuves reproductibles

- `node --test tests/tvSamsungPrototype.test.ts tests/tvSamsungModel.test.ts` : 15 TNR.
- `scripts/tv-browser-checks.cjs`, appelé par le smoke canonique : télécommande,132 puis133packages,
  pagination, nouvelles apps, menus natifs simulés, exit, profil, succès/échec de lancement,
  zéro RAM/stockage libre,4cycles arrière-plan. Aucun service personnel/contact TV.
- Captures générées dans `quality-reports/tv-home-{1920,1280}.png` et `tv-apps-{1920,1280}.png`.
- `python tv-samsung/build.py` : WGT non signé, assets et module modèle inclus, identité stable.

Les tests navigateur prouvent la géométrie et le cycle applicatif, pas les FPS ou la RAM de la TV.
La V1 a été essayée sur le matériel ; cette V2 ne l'a pas encore été. PR760 reste draft.
