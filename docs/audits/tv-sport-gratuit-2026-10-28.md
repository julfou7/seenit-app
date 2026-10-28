# SeenIt TV — calendrier gratuit, 28 octobre 2026

Baseline : main6fd88fc, TV0.4.1 ; #295/#738. Demande ferme : calendrier utile sans
abonnement/API payante ni score requis. Le backend existant est réutilisé, aucun
service supplémentaire, secret fournisseur, écriture Firestore ou souscription.

## Sources et choix

- football-data.org : [offre gratuite](https://www.football-data.org/pricing) avec
  fixtures, calendrier retardé et dix appels/minute ; [couverture](https://www.football-data.org/coverage)
  gratuite Ligue1/UCL/Euro/Mondial, pas une preuve de couverture exhaustive France A.
  Aucun token fourni/configuré pour ce chantier ; aucune clé recherchée ou compte créé.
- Repli actif sans clé : [AS Monaco](https://www.asmonaco.com/fr/pros/calendrier) et
  [FFF France A](https://www.fff.fr/selection/2-equipe-de-france/resultats-et-calendrier.html),
  pages publiques récupérées depuis Node, données réelles normalisées côté serveur.
- Premier passage réel local : deux sources ready, 19 matchs futurs dans120jours,
  logos des adversaires Monaco, aucun score/diffuseur inféré. Ce nombre est une
  observation datée et ne devient jamais une fixture ou condition de production.

## Matrice

| Surface | Preuve / contrat |
|---|---|
| Gratuité | Deux URLs officielles fixes ; aucun token/plan payant/requête live |
| Identité d'événement | Lien éditeur exact, ou clé de ligne dérivée du snapshot officiel Monaco sans URL individuelle |
| Horaire | Décalage Monaco explicite ; France Europe/Paris ; tests été/hiver |
| Provisoire | Marqueur Monaco conservé, heure indicative masquée |
| Cache | Six heures/source, deux téléchargements max, concurrence regroupée, backoff30min, cache ancien48h max |
| Limites | HTML1Mio, timeout8s, réponse24 événements, DOM6 cartes/page |
| Profils | Sélection locale, Julian Monaco+France, Milo/Camille/Invité sans héritage ; Invité non persistant |
| Spoilers | Aucun résultat exposé ; modèle score/live optionnel horsMVP |
| TV | ClientES5, JSON normalisé, pas de secret ni parseurHTML dansWGT, annulation horsécran |
| Dégradation | Panne partielle conserve source saine, date/ancienneté et réessai explicites |
| Diffusion | Information seule tant que diffuseur gratuit fiable et cible disponible/testée non prouvés |

Difficulté réelle : la plupart des cartes Monaco n'ont pas encore de lien individuel
(billetterie ou programmation provisoire). Le premier parseur les rejetait : TNR sur
ces vrais extraits et clé de ligne sans inventer de match. Suivi dans #738.

Validation navigateur à1920/1280 : pagination7événements simulés, six cartes non coupées,
état provisoire, sélection indépendante, Home et cycles arrière-plan. Les matchs de
ce scénario sont explicitement des données de harnais, jamais servis en production.
Tests parseurs/routeHTTP/cache/concurrence et client réels. Validation canonique, CI,
déploiement et terrain restent consignés dans le checkpoint stable #738, sans confondre
le navigateur avec la TV physique. Pas d'APKmobile ni nouvelle tentativeNetflix.

## Production0.4.2 — repli France

PR780 déployée : GET réel répond200 avec17matchs Monaco, mais la source principale FFF
est `unavailable` depuis le runtime serveur, malgré sa réponse saine en local. La première
prétention de calendrier complet est donc invalidée ; aucune donnée France n'est inventée.
Le chemin TV→route→service→source est reconstitué, puis un repli officiel indépendant est
ajouté : billetterie.fff.fr/fr. Sa page publique fournit les deux prochains matchs France A,
dates et drapeaux. Filtrage exact de la sélection senior, exclusion Espoirs/Féminines/Futsal,
déduplication des cartes répétées ; son data-event149 est une catégorie répétée, pas un
identifiant unique de match. Les tests passent par la vraie route HTTP avec panne403 du
premier fournisseur. Cache et coûts inchangés, aucune clé, aucune nouvelle image WGT.
Le runtime publie l'URL retenue et un code de panne borné pour éviter un diagnostic opaque.

Terrain Films0.4.2 validé pendant ce correctif : compte/pinsCANAL/Brume conservés ; bootstrap
18affiches/18fonds, hero et quatre images réellement chargés, aucune carte app dans Films.
La capture native Page.captureScreenshot ne répond pas sur ce moteur ; helper de test
interrompu proprement, pas de capture physique revendiquée. #295/#738 gardent ces preuves.
