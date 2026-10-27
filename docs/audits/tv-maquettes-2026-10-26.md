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
| Logos | Monogrammes, puis icônes natives disparates au terrain919a109 | SVG Simple Icons11.15.0/CC0 prioritaire, icône native puis initiales si inconnue | TNR sécurité URLs et rendu |
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
La V1 a été essayée sur le matériel ; le premier terrain V2 est KO, voir ci-dessous. PR760 reste draft.

## Réévaluation après installation919a109 — terrain KO

La photo du propriétaire invalide la fidélité annoncée à partir de Chrome desktop : fond bleu vif,
trois Netflix, logos minuscules/disparates et interface trop fine. Le chemin de production réel a
été reconstitué par Web Inspector sur `SeenItTV01.SeenItTV` : Tizen4/M56,1920×1080/dpr1,
254résultats réels de `tizen.application.getAppsInfo`, puis `TVDevice.listApps` → `TVModel.favorites`
→ `appButton`. Aucune donnée personnelle SeenIt n'est lue ou modifiée.

| Constat terrain | Cause / portée | Correction et preuve | État / critère de fin |
|---|---|---|---|
| Trois Netflix | `show:true` et même nom pour app installée et variantes intégrées ; sélection automatique par ID sans regroupement | Présentation regroupée par nom exact normalisé, épingle prioritaire, installation locale préférée, ID stable à égalité. Tous les IDs conservés en avancé. Cas voisin Kids distinct et inversion de l'ordre d'inventaire | P2 #295 ; adapter réel couvert par fixture13formes natives puis harnais136packages,130apps distinctes et6entrées avancées |
| Logos natifs incohérents | Priorité native charge des icônes historiques, tailles internes hétérogènes | SVG embarqués connus prioritaires, fallback générique conservé, logos et tuiles agrandis | TNR navigateur1080p/720p ; acceptation visuelle physique restante |
| Réglages sous forme de carré emoji | Glyphes Unicode dépendants de la police Tizen | SVG de navigation locaux ; libellés et sources agrandis, bordures hors focus allégées | Aucun élément coupé1080p/720p ; lecture à distance à confirmer |
| Fond bleu vif | Styles calculés corrects : rgb(17,20,27), gradients sombres ; viewport correct. Ce relevé ne prouve pas les pixels réellement affichés | Aplat temporaire rgb(25,28,34) appliqué ; propriétaire répond « toujours bleu vif ». Repère gris/bord rouge « TEST ÉCRAN26 » confirmé visible avec ses bonnes couleurs : page inspectée bien identifiée. Capture CDP non répondante, arrêt borné | P2 #295 OUVERT ; cause interne à la page/couches à isoler, aucune correction CSS prétendue. TV éteinte ensuite ; propriétaire annonce la rallumer, reconnexion encore indisponible |
| Preuve navigateur insuffisante | Ancien harnais130apps ordinaires ne reproduisait pas le catalogue réel ni le moteur matériel | Sous-ensemble réel natif dans `tests/fixtures/tv-samsung-tizen4-apps.json`, injecté par le vrai `TVDevice.listApps`, puis rendu Home/bibliothèque/fallback/launch du harnais canonique |17TNR ciblés ; zéro interval caché,4cycles retour ; ne vaut pas preuve RAM/FPS physique |

Le correctif0.2.1 conserve l'identité d'application et l'auteur de signature. Il ne change ni Home,
ni startup, ni firmware, ni réglage d'image Samsung. Tant que le fond n'est pas validé sur la TV,
le chantier reste ouvert et aucun gain global de RAM n'est annoncé.

### Reprise matérielle et demandes complémentaires

La TV a été retrouvée à192.168.1.45 ; le PC à deux interfaces requiert le chemin source192.168.1.30
pour SDB. Un relais local temporaire suffit, sans modifier le réseau ou Developer Mode.0.2.1 a été
installé/lancé (pid4743), version et logos SVG vérifiés dans Tizen. Le propriétaire a choisi Brume
et envoyé une photo du fond clair : cette préférence est conservée. L'ancien rendu bleu en Crépuscule
ne doit pas être attribué à une cause GPU/gradient non prouvée ; les tests temporaires ont disparu
avec la mise à jour. Tous les relevés sont faits dans le widget réel, pas dans le simulateur.

La demande suivante ajoute les logos d'équipes et le dépassement des deux HDMI de Home : le natif
remonte bien HDMI1à4. Le correctif0.2.2 rend quatre sources, conserve Tout et prépare le renderer
Sport avec logos/noms explicites et fallback. Le calendrier réel reste #738, aucun faux match sur TV.
Le relevé RAM/services est dans [l'audit dédié](tv-ram-services-2026-10-26.md) :610MiB disponibles,
38contextes, propositions conditionnelles et aucune désactivation.
