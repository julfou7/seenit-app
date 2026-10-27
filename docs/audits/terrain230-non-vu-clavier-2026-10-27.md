# Terrain230 — non vu historique et recherche au clavier

Baseline : main701054d16c0d3e50a88ef5eb90439e5d05308a8f, APK1.4.230. Issues #729 et #774.

## Observations et frontières prouvées

Le propriétaire signale un carrousel « Pas vu depuis un moment » et « Afficher plus » inopérants,
après des bascules entre trois onglets. Il précise ensuite que le défaut ne se reproduit plus et
qu'il avait auparavant passé S01E01 de A Knight of the Seven Kingdoms en non vu depuis l'historique,
puis retrouvé l'épisode vu. Ces observations ne prouvent pas une réimportation Plex : aucun changement
de synchronisation ni de priorité des sources n'est effectué sur cette hypothèse seule.

Chemin reconstitué : WatchListScreen → WatchListView → HistoryFeed → confirmation → useShows.updateShow.
La confirmation attendait getEpisodeDetails avant toute écriture. Le TNR sur le composant réel, avec
cette réponse délibérément bloquée, échoue : un appel détails, seenEpisodes reste [1x1], aucune erreur
visible. La mutation utilisateur dépendait donc indûment d'une source de métadonnées. Le pointeur
recréé retirait aussi les compteurs du pointeur déjà connu pour la même saison.

Explorer : DiscoverScreen → DiscoverViewCore → dock de recherche. Le padding90px réservé à la nav
était conservé en saisie, sans compensation visualViewport ni masquage de la nav. La vidéo Samsung
085947 confirme la cible : champ juste au-dessus du clavier.

## Correction et portée

| Surface | Correction | Preuve |
| --- | --- | --- |
| Historique Non vu | Enregistrement sans appel TMDB, métadonnées locales facultatives, compteurs de la même saison conservés, erreur d'écriture explicite. | TNR rouge puis vert avec fournisseur bloqué, reprise1/6 et erreur de transport. |
| Suivi après Non vu | Même écran de production et store simulé, vingt séries anciennes, neuf bascules puis swipe tactile et deux Afficher6deplus. | Interactions CDP réelles ; aucune preuve de panne permanente ni de réimport Plex sur appareil. |
| Bouton fin de liste | Scroll-padding inférieur respecte l'îlot lors d'un scrollIntoView/focus, sans ajouter de marge visible. | Appui tactile réel après alignement bas, cible accessible au-dessus de la nav. |
| Explorer clavier | Dock partagé à8px, nav et fondu masqués, viewport Android redimensionné ou PWA recouvert, fermeture/Entrée sans effacer texte/filtres. | Rendu360/412 et géométrie, retour nav, clavier matériel. |

Scénarios exécutés par le gate PWA canonique : home-unseen-browser-checks et
search-keyboard-browser-checks. Le scénario Non vu passe par les dialogues réels et le véritable
WatchListScreen, avec seuls les ports réseau/stockage remplacés pour isoler les interactions.

## Difficultés et limites

Le premier harness utilisait des groupes préparés : il ne couvrait pas la catégorisation de l'écran.
Il est désormais complété par l'entrée de production, avec identitésTMDB distinctes. Les gestes tactiles
attendent la fin du snap avant le prochain appui ; un test qui téléporte le rail pendant l'inertie
ne représente pas un carrousel stabilisé. Les éditions Python ont changé les fins de ligne de quatre
fichiers ; celles-ci ont été rétablies pour conserver un diff ciblé.

Le blocage intermittent de la vidéo reste à confirmer sur téléphone après livraison. La correction
prouvée porte sur l'attente réseau injustifiée du Non vu et sur le placement clavier ; elle ne prouve
pas que Plex a rétabli le vu ni que toute cause possible d'un blocage tactile a été éliminée.
