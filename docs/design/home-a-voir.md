# Accueil « À Voir » — spec d'implémentation iso maquette (v3, décisions terrain du 23 octobre 2026)

Référence vivante : `SeenIt Prototype.dc.html`, onglet À Voir, mobile 412 px. Composants : `SeenIt Card8f.dc.html` (carte série) et `SeenIt Row.dc.html` (ligne). Toujours valables : `SPEC-CARTE-8F.md`, nav 13j (déjà en dev), films 16d/18c.
En cas de doute, **la maquette fait foi** sur cette spec.

---

## 0. Commun aux 3 onglets

**Header**
- Logotype `seenit●` (10b) à gauche, cloche à droite.
- Le point or sur la cloche signale des notifications non lues. Un tap ouvre la feuille Notifications.
- Pendant une synchro Plex, une pastille anneau apparaît à gauche de la cloche.
- Pas d'avatar dans le header : le profil est dans l'onglet Moi.

**Segmented À regarder · À venir · Historique**
- Hauteur 44, pilule active or plat `#E5A93D` avec texte `#000` 700. Onglets inactifs en `#A1A1AA` 600.
- Texte centré verticalement : `line-height:1` et `text-box:trim-both cap alphabetic`.
- **Pas de compteurs** dans les onglets.
- Pas de swipe entre onglets ni de bascule automatique au scroll. Ces deux options ont été testées puis retirées (pas fluide).

**Gestes**
- Appui long (480 ms, ou clic droit sur desktop) : ouvre la feuille d'actions.
- Double tap sur l'onglet de nav : réinitialise l'onglet.
- **Tap sur une ligne d'épisode : ouvre l'épisode, pas la série.** Cela vaut dans À venir, Historique et Nouveautés.

**Couleurs fonctionnelles**
- Or : action et priorité.
- Vert : à jour ou terminé.
- Rouge : erreur.
- Le reste est en neutres. Aucune information banale n'est colorée (pas de « il y a 3 jours » en couleur).

---

## 1. À regarder

Les sections s'affichent dans cet ordre. Une section vide est masquée.

1. **Continuer à regarder** : carte 8f en rail horizontal, 3 cartes.
   - L'icône liste dans l'en-tête de section bascule en liste verticale ; un chevron or « Revenir en carrousel » ramène au rail.
   - Pas de carte « Voir tout » en fin de rail.
2. **Nouveautés** : même carte et même comportement.
3. **Films à voir** : billet horizontal.
   - Image qui remplit la gauche, fondu sans ligne visible vers la partie texte.
   - **Heure de fin en gros** sous la forme « fin à 23:28 ». Si la fin tombe après minuit, afficher « après minuit » en `#FDBA74`.
   - Ni année ni mention « Film ».
   - La même icône liste que les séries bascule entre rail et liste.
   - Tri par durée croissante. 3 visibles, puis « Afficher N de plus » (18c).

4. **Pas vu depuis un moment** (plus de 60 jours) : toujours en dernier, après les films, selon la dernière consigne utilisateur. Carte 8f de poids visuel inférieur, « Pas vu depuis N jours » en neutre.

**Carte série 8f — rappels**
- Titre de la série en or, code `S05 · E04` en blanc 800, titre de l'épisode en dessous.
- Barre de saison en segments.
- Coche « vu » centrée verticalement dans la colonne droite.

**Badge de statut**
- Placé **à côté du numéro d’épisode**, selon la dernière consigne utilisateur prioritaire sur le ZIP v3. Le badge ne change pas la hauteur de carte (corps 150 px).
- Pilule « écran SeenIt » de 24 px : dégradé vertical, reflet de verre, contour 2 px `#0B0B0F`, glyphe custom, texte 12 px/800 sombre. **Aucun emoji.**
- Un seul badge par carte, et pas de « X restants » (l'info est déjà dans la barre).

| Statut | Dégradé |
|---|---|
| Aujourd'hui (pulse 1,6 s) | `#FDBA74 → #FB7185` |
| Nouveau | `#6EE7B7 → #34D399` |
| Plus que N | `#C4B5FD → #A78BFA` |
| Dispo | `#7DD3FC → #38BDF8` |
| Final / fin de saison | `#FDE68A → #E5A93D` |
| Délaissé | `#E2E8F0 → #94A3B8` |

**Swipe gauche** (Nouveautés et Pas vu depuis)
- Fait apparaître Archiver et Supprimer, avec un toast Annuler.
- Le fond des actions est invisible tant qu'on ne glisse pas.

**Billet film « vu »**
- Un tap sur le talon l'arrache : animation `hzTear` de 0,7 s.
- Le bord du billet devient dentelé (mask zigzag), les pointillés disparaissent, et un tampon « VU » avec le logo SeenIt apparaît.
- **Les dents doivent rester visibles après la déchirure**, y compris en vue horizontale. C'était un bug corrigé.
- Une fois l'animation finie, le talon passe en `visibility:hidden`.
- **Annuler = tap sur le tampon VU** : le talon est recollé avec `hzBack`, 0,3 s.
- Le titre a 10 px de marge au-dessus de la zone déchirée et ne la touche pas.

---

## 2. À venir

**Groupes** : Aujourd'hui · Cette semaine (7 jours ou moins) · Plus tard. Un groupe vide est masqué.

**Carte** : 8f, même hauteur que dans À regarder.
- **Pas de badge de statut** dans cet onglet.
- Pas d'espace vide en haut de la carte.
- Le titre de la série et le reste du texte gardent la même hiérarchie que dans À regarder.
- La ligne code est « `S05 · E06` · 22 oct. ». La date courte est déjà là, donc **pas de jour de la semaine**.
- La colonne droite affiche le **bloc J-X** à la place de la coche.

**Bloc J-X** (à la place de la coche)
- Conteneur tactile de 52×48. Pastille d'au moins 48×40, padding 0 8 px, `border-radius:12px`, fond `rgba(12,12,16,.92)`, ombre `0 4px 14px rgba(0,0,0,.45)`.
- Texte `J-4`, `J-19`, `J-132` : 800, letter-spacing −0,04em, `tabular-nums`, couleur `#FFF`. Taille 17 px, ou 15 px à partir de 100 jours.
- Le jour même, le texte devient « auj. » en `#F2C36B` 14 px avec un halo `jGlow` de 1,8 s. Le halo est coupé si l'utilisateur a demandé de réduire les animations.
- Bord : `inset 0 0 0 1px rgba(255,255,255,.14)`, ou `rgba(229,169,61,.55)` si le rappel est actif.
- Pastille cloche de 18 px en haut à droite (décalée de −6 px) : or `#E5A93D` si le rappel est actif, `#27272A` sinon.
- **Un tap active ou coupe le rappel** et affiche un toast. aria-label : « Dans N jours · rappel activé/désactivé ».
- Le cercle de progression est abandonné (jugé « random »).

**Cas particuliers**
- Film en salle : la ligne code devient « Film · salle », avec le logo cinéma.
- Nombre d'épisodes de la saison inconnu (par exemple Harry Potter) : segments ouverts et « ? ». Voir la spec 8f.
- Le logo du diffuseur est affiché sur l'image.

---

## 3. Historique

**Liste simplifiée**
- Films et séries sont mélangés **dans une seule liste homogène**, triée de la plus récente à la plus ancienne.
- **Pas d'en-têtes de date au-dessus des cartes** : la date est déjà dans chaque ligne.
- **Pas de barre de progression**, ce qui rend films et séries identiques.
- 10 lignes par défaut, puis un bouton « Voir plus » (le nombre restant en `#71717A`).

**Conteneur** : un seul bloc arrondi de 20 px, fond `rgba(20,20,24,.72)`, contour `inset 0 0 0 1px rgba(255,255,255,.07)`. Les lignes sont séparées par `1px rgba(255,255,255,.06)`.

**Ligne**
- Hauteur minimale 76, padding 10 12 10 10, gap 12.
- **Vignette** : 92×52, radius 9. Pour une série, la miniature de l'épisode ; pour un film, le backdrop.
- **Ligne 1** : titre en or `#F2C36B` 15 px/800, sur une ligne avec ellipse.
- **Ligne 2** : 13 px. Pour une série, « **S05·E13** · 13 oct. » (code en blanc 800, date en `#A1A1AA` 600). Pour un film, la date seule, sans année ni « Film ».
- **Ligne 3** (séries seulement) : titre de l'épisode, 13 px `#D4D4D8`, 2 lignes au maximum.
- **Droite** : pastille or de 26 px avec le logo SeenIt sombre.
- Ce qui a été vu aujourd'hui affiche « ce soir » en or et la pastille apparaît avec un effet tampon `hdStamp` de 0,32 s.
- **Tap** : ouvre l'épisode, ou la fiche du film. **Appui long** : feuille d'actions (marquer non vu, ouvrir la série…).

---

## États à gérer (les 3 onglets)

- Chargement froid : skeleton aux dimensions exactes des cartes, pour éviter tout layout shift.
- Contenu en cache, puis rafraîchissement silencieux.
- Hors ligne : bandeau discret ; les actions sont mises en file d'attente.
- Synchro Plex en cours : pastille dans le header, disponibilités en cache conservées.
- Section vide : masquée. Onglet entièrement vide : empty state avec un CTA vers Explorer.
- Image manquante : teinte de l'affiche et initiales. Titre long : 2 lignes au maximum, jamais coupé sur une seule.

## Mis de côté

- **« Un film ce soir ? » et l'organisateur de soirée** : retirés de l'accueil en attendant ta validation. Le code est conservé dans `old/Soiree-film-bloc.html` et dans l'overlay `night` du prototype.
- Prototypes d'accueil A, B, C et D : refusés, rangés dans `old/`.

## Données

Le prototype utilise des données de démo : vraies images TMDB, épisodes de Breaking Bad réels, et le reste générique. Les dates, les J-X et les heures de fin sont calculées à partir d'une heure fixe, 21:40.

## Provenance et décisions prioritaires

Source reçue : `Connexion du repository seenit-app (8).zip`, `SPEC-ACCUEIL.md` v3 et `SeenIt Prototype.dc.html` actualisé. Les décisions utilisateur du 23 octobre priment pour badge près du code et séries anciennes en dernier. Le prototype prime en cas de contradiction interne : le billet horizontal conserve ses métadonnées année/durée et son talon de fin 96 px, conformément à son rendu.

Le header sticky se prolonge par un fondu de flou 26 px sous les filtres, sans intercepter les gestes. Les notifications illustrées se retirent individuellement par swipe gauche ou bouton accessible, avec Annuler et persistance par compte.

Un count TMDB provisoire ne suffit pas à confirmer un total : finale, saison terminée/antérieure, planning entièrement daté ou total annoncé au-delà de la liste le confirment. Sinon segments ouverts et « ? » (Harry Potter), sans exception par titre ; MobLand au total confirmé conserve 10.

Aucune génération ni publication d’APK pendant la collecte des retours, jusqu’à nouvelle demande utilisateur.
