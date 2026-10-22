# À Regarder 18c : spec d'implémentation (SeenIt)

Contrat `SEENIT-UX-016`, suivi #712. Handoff propriétaire du 21 octobre 2026,
archive `Connexion du repository seenit-app (4).zip`. Cette vue remplace les trois rails
séries de À Regarder, en conservant leurs règles d'éligibilité et leur ordre interne :
Continuer, Nouveautés, séries anciennes, dédupliquées par document/identité canonique.
La provenance du groupe ancien reste utilisée pour son badge de récence.
Le fil d'actualités, À Venir et Historique conservent leurs parcours séparés.

Les cartes qui viennent d'être cochées restent dans la session pour permettre le retour
inverse et Annuler. Le retour dans À Regarder après un autre onglet, la réouverture de
l'écran ou sa réinitialisation explicite rafraîchit la liste. Aucun délai ne supprime une
donnée métier. Un changement de compte vide cet état visuel local. L'ordre des films se
fige pendant cette session dès la première coche, le temps et les métadonnées continuent
de se mettre à jour ; une durée inconnue est classée après les durées connues.
Le rail réduit rend au plus huit films puis sa tuile terminale ; Voir tout rend une grille
par lots de huit. Les compléments de durée manquants passent par les enrichissements
passifs bornés existants. Les heures proposées sont Maintenant, 20:30, 21:00, 22:30 et une
heure libre ; une heure passée désigne le prochain lancement à cette heure. L'orange
signale le franchissement du minuit suivant le lancement, pas seulement un nombre d'heure.

L'animation confirme une action métier aboutie, jamais le simple appui. La coche à jour
retire uniquement le dernier épisode explicitement marqué dans cette session ; aucune
soustraction arithmétique ne crée de faux épisode. Le retour Non vu d'un film et d'une
série préserve les autres records et offre le même toast Annuler. Les cibles de Réduire,
Voir tout et du sélecteur ont une surface interactive d'au moins 44 px.
Une écriture échouée restaure l'optimisme et n'anime aucun succès ; un changement d'UID
pendant une action ou avant Annuler interdit d'appliquer son résultat au nouveau compte.
Une écriture Firestore lente reste en attente : aucun délai local non annulable ne peut
annoncer un échec ou restaurer l'épisode pendant que cette écriture peut encore réussir.
Le TNR Chromium suspend la vraie façade plus de quatre secondes, puis confirme son succès.

Référence visuelle : `SeenIt Cartes Films.dc.html` → colonne **#18c** (Tour 18, tout en haut). Ouvrir dans un navigateur et cliquer : coches, « Afficher plus », sélecteur « Je lance à ».
Specs liées (dans ce dossier) : `SPEC-CARTE-8F.md` (carte série), `SPEC-EPISODES-INCONNUS.md`, `SPEC-HISTORIQUE-16D.md`.

L'écran À Regarder contient 3 blocs : **Continuer à regarder** (cartes séries 8f), **Charger plus** (bouton en verre), **Films à voir** (rail de tickets déchirables).

---

## 1. Continuer à regarder (séries)

- Titre de section : « Continuer à regarder », 17/700, suivi du total en `#71717A` (13/600).
- **3 cartes 8f visibles au départ.** Spec complète de la carte : `SPEC-CARTE-8F.md` v2. Pour rappel : titre en or `#F2C36B`, code `S05 · E04` en blanc, épisode en `#F4F4F5`.
- Ordre : celui de la section actuelle de l'app (dernier visionnage ou nouveauté), inchangé.

### Animation « marquer vu » (série)
Déclenchée par un tap sur la coche de la carte (cible 48×48).
1. **Vibration** de 15 ms (`navigator.vibrate(15)` ou l'équivalent Capacitor Haptics).
2. **L'épisode vu part** : un « fantôme » du bloc code et épisode, placé en absolu par-dessus, avec le code en or préfixé de `✓` et le titre barré (`line-through`, couleur `rgba(229,169,61,.7)`). Animation `srOut` 0,6 s `cubic-bezier(.45,0,.75,.35)` forwards, `transform-origin: left top` :
   - 0 % : `none`, opacité 1 ;
   - 30 % : `rotate(-2deg) translateX(-4px)` ;
   - 100 % : `translate(-40px,26px) rotate(-10deg)`, opacité 0.
3. **L'épisode suivant arrive** : bloc réel, animation `srIn` 0,4 s, délai 0,25 s, `both`. De `translateX(30px)` avec opacité 0, jusqu'à `none` avec opacité 1.
4. **Le segment de saison s'allume** : le segment de l'épisode vu passe en or, animation `sgPop` 0,5 s, délai 0,22 s. À 40 % : `scaleY(2.3)` + `box-shadow 0 0 0 3px rgba(242,195,107,.45)`.
5. **Tampon SeenIt** sur l'affiche inclinée, centré, à `top:44px` de l'affiche : bordure 2,5 px `#E5A93D`, fond `rgba(9,9,11,.6)`, radius 8, hauteur 32, symbole anneau 18 px + « VU » 14/900, interlettrage .1em, or `#F2C36B`. Animation `st` 1,5 s `both` :
   - 0 % : `rotate(-12deg) scale(1.8)`, opacité 0 ;
   - 22 % : `scale(1)`, opacité 1 ;
   - 78 % : opacité 1 ;
   - 100 % : opacité 0.
6. Ensuite : **toast avec « Annuler »**, comme dans le reste de l'app.

**Rejouer l'animation** à chaque tap : alterner deux noms de keyframes identiques (A/B, selon la parité du nombre de taps) ou changer la `key` React. Sinon l'animation ne repart pas.

**Série à jour** (plus d'épisode sorti non vu) : code `S05 · à jour`, ligne épisode « Prochain épisode bientôt », coche pleine en or. Tap : revient d'un épisode (pas d'animation).
Pour une fin/annulation officielle, la ligne indique « Série terminée »/« Série annulée », sans
promettre un prochain épisode. La cible inverse reste le dernier épisode explicitement marqué.
**Réduire les animations** : durées ramenées à 0,01 s, l'état final reste identique.

---

## 2. Charger plus (bouton en verre), retenu

- Affiché sous la 3e carte si d'autres séries existent.
- Pilule de 52 px de haut, radius 26, fond `rgba(24,24,27,.7)`, `inset 0 0 0 1px rgba(255,255,255,.1)` et `inset 0 1px 0 rgba(255,255,255,.08)`. Padding `0 16px 0 10px`, gap 12.
- Contenu, de gauche à droite :
  1. **3 mini-affiches rondes** des séries suivantes : 30×30, chevauchement −8 px, contour 2 px de la couleur de fond (`#08080C`).
  2. Libellé 14/700 : « Afficher 3 de plus ». S'il en reste moins : « Afficher les 2 » ou « Afficher la dernière ».
  3. À droite, 12/600 `#71717A` : « 5 en attente ». **Le nombre ne s'affiche qu'à cet endroit**, jamais dans le libellé.
- Tap : ajoute **3 cartes**, et le bouton se met à jour. Quand tout est affiché, le bouton disparaît.
- Sous le bouton (ou à sa place), un lien « Réduire ⌃ » (12/700 `#71717A`, hauteur 36) dès qu'il y a plus de 3 cartes. Il ramène à 3.

---

## 3. Films à voir : ticket déchirable

### Section
- Titre « 🎬 Films à voir » 17/700, suivi du nombre de films non vus et de « Voir tout » à droite (13/700 or).
- Rail horizontal : `gap:12px`, débord sur les bords de l'écran, `scroll-snap` conseillé. Environ 2,5 tickets visibles.
- **Ordre : par heure de fin croissante.** Un film marqué vu **reste à sa place** (pas de réorganisation pendant l'animation). On le retire au prochain rafraîchissement de la liste.
- Dernière tuile, 118×252, radius 14, fond `#111114` : 3 mini-affiches en éventail (−8°, 0°, 8°) et « Voir les N films » en or.

### Ticket (largeur 144)
- **Affiche** : 144×212, radius `14 14 4 4`, ombre `0 12px 22px rgba(0,0,0,.45)`.
  - Logo du diffuseur en haut à droite : 26×26, radius 7. Priorité : plateforme favorite, puis Plex (en précisant « Plex · Thomas » pour un serveur d'ami), puis autre.
  - Coche en bas à droite : cible 44×44, pastille de verre 36 px (`rgba(9,9,11,.7)` + `backdrop-filter: blur(8px)`), icône SeenIt de 24 px.
  - Sans affiche : dégradé de la teinte H + initiales.
- **Talon** (2 px sous l'affiche) : hauteur **36**, radius `4 4 12 12`. Fond `linear-gradient(180deg, oklch(0.3 0.07 H), oklch(0.2 0.04 H))`, avec H la teinte dominante de l'affiche, la même que pour la carte 8f.
  - Pointillé en haut : `border-top: 2px dashed rgba(255,255,255,.2)`, inset 10 px.
  - 2 encoches de 14 px (couleur du fond de l'écran), centrées sur le bord haut, à gauche et à droite (−7 px).
  - Contenu : **année** (11/600 `#D4D4D8`) à gauche, **« fin 23:26 »** (13/800) à droite : blanc, orange `#FDBA74` si la fin dépasse minuit.
- **Titre** sous le ticket : 13/800 or `#F2C36B`, 2 lignes max, hauteur fixe de 32.

### Heure de fin
`fin = heure actuelle + durée du film`, recalculée à l'ouverture de l'écran et chaque minute. Durée inconnue : afficher l'année seule, sans « fin ».

### Animation « marquer vu » (film)
1. Vibration de 15 ms.
2. **Le talon se déchire** : animation `tkTear` 0,75 s `cubic-bezier(.45,0,.75,.35)` forwards, `transform-origin: left top` :
   - 0 % : `none`, opacité 1 ;
   - 16 % : `rotate(-3deg) translateY(1px)` ;
   - 32 % : `rotate(5deg) translate(3px,4px)` ;
   - 100 % : `translate(30px,80px) rotate(24deg)`, opacité 0.
3. **Le bas de l'affiche devient dentelé** (masque CSS, dents de 9×6 px) :
   `mask: linear-gradient(#000 0 0) top/100% calc(100% - 6px) no-repeat, linear-gradient(135deg,#000 4.3px,transparent 4.4px) bottom left/9px 6px repeat-x, linear-gradient(225deg,#000 4.3px,transparent 4.4px) bottom left/9px 6px repeat-x` (avec le préfixe `-webkit-mask`).
4. L'affiche s'assombrit (opacité .4, transition .4 s, délai .3 s).
5. **Tampon** centré à `top:78px` : bordure 2,5 px `#E5A93D`, fond `rgba(9,9,11,.55)`, radius 8, hauteur 34, **symbole SeenIt (anneau) 22 px + « VU »** 16/900, interlettrage .12em, rotation −9°. Animation `tkStamp` 0,28 s, délai 0,42 s, `both` : de `scale(1.7)` avec opacité 0 jusqu'à `scale(1)` avec opacité 1. **Le tampon reste affiché.**
6. Toast avec « Annuler ».

**Annuler ou retoucher la coche** : le masque est retiré, et le talon revient avec `tkBack` 0,35 s ease-out (de `translateY(16px)` avec opacité 0 jusqu'à `none`).
**Film déjà vu au chargement** : afficher directement l'état final (talon masqué, bas dentelé, tampon), **sans rejouer** l'animation.

### Symbole SeenIt du tampon (SVG, viewBox 0 0 100 100)
```svg
<circle cx="50" cy="50" r="38" stroke="rgba(229,169,61,.3)" stroke-width="11" fill="none"/>
<circle cx="50" cy="50" r="38" stroke="#E5A93D" stroke-width="11" stroke-linecap="round" stroke-dasharray="196 239" transform="rotate(-90 50 50)" fill="none"/>
<path d="M36 51 L46 61 L65 40" stroke="#F2C36B" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
```
À remplacer par l'asset définitif du logo si un autre symbole est retenu.

---

## 4. Accessibilité
- Coches : `aria-label` « Marquer [titre] comme vu » ou « Marquer comme non vu ». Après l'animation, annoncer « [titre] marqué vu » (`aria-live="polite"`).
- « Charger plus » : `aria-label` « Afficher 3 séries de plus, 5 en attente ».
- Cibles tactiles ≥ 44 px. `prefers-reduced-motion` : animations quasi instantanées.

## 5. Cas limites
Titre de film très long (2 lignes, puis « … ») · film sans affiche · durée inconnue · fin après minuit (orange) · aucune série au-delà de 3 (pas de bouton) · moins de 3 séries en cours · tous les films vus · série sans épisode suivant sorti · nombre d'épisodes inconnu (voir la spec dédiée).

## 6. Tokens
Fond de l'app `#08080C` · surface `#111114` · or `#E5A93D` · or clair `#F2C36B` · orange `#FDBA74` · textes `#FFFFFF` / `#F4F4F5` / `#D4D4D8` / `#A1A1AA` / `#71717A` · police Plus Jakarta Sans.
