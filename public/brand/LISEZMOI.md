# SeenIt · kit de marque (25/10/2026)

Décisions : logo 10b réaligné, icône et animation 11b, splash 12b à 8 épisodes avec le logo complet, logo TV 9e. Signature : « Chaque visionnage compte. »
Référence visuelle complète : page « SeenIt Marque », section Tour 13.

## Démo
- `seenit-marque-demo.html` : page autonome (HTML, CSS, SVG, sans dépendance) avec le logo, l'animation « marquer vu » cliquable, le splash animé, le logo TV et la barre de navigation. Le code du bouton coche est dans la page.

## app/
- `seenit-logo-sombre.svg` / `.png` : logo principal (anneau + « seenit » + point or), fond nuit.
- `seenit-logo-clair` : sur fond blanc (« it » et point en or foncé #B37812).
- `seenit-logo-blanc`, `seenit-logo-noir` : monochromes, fond transparent.
- `seenit-logo-empile-sombre`, `seenit-logo-empile-blanc` : version empilée (anneau au-dessus de « seenit »), celle du splash.
- `seenit-anneau.svg` / `-512.png` : le symbole seul, fond transparent.
- `seenit-icone.svg` / `-512.png` : icône d'app (Play Store 512 × 512). L'anneau occupe 62 % : il reste dans la zone sûre des icônes adaptatives.
- `seenit-icone-monochrome.svg` : icône thémée Android 13+ (une couleur, viewBox 108).
- `seenit-notification-24.svg` : icône de notification, blanc plein.
- `favicon-32.png`, `favicon-16.png`.

## tv/
- `seenit-tv-logo-sombre`, `seenit-tv-logo-blanc` : logo SeenIt TV (écran 9e + « seenit.tv »), pour l'en-tête du launcher.
- `samsung-icone-512x423.png` : icône Samsung (PNG RGB, sans transparence).
- `samsung-logo-1920x1080.png` (transparent) + `samsung-fond-1920x1080.png` : la paire 1920 × 1080 demandée par la Seller Office.
- `androidtv-banniere-320x180.png` (xhdpi) et `-640x360.png` (xxxhdpi) : bannière Google TV / Chromecast, avec le texte comme l'exige Google.
- `androidtv-icone-160.png` / `-320.png` : icône de lanceur Android TV.

## Règles
- Couleurs : or #E5A93D (actif, « it », point), dégradé or #FFF2B8 → #F5C518 → #E5A93D → #B37812 réservé au symbole, nuit #08080C, texte #F4F4F5.
- Police : Plus Jakarta Sans 800, interlettrage −5 %. Le logotype est livré en tracés (licence OFL de la police).
- Alignement : le milieu de la hauteur d'x de « seenit » est sur le centre de l'anneau. Ne pas recomposer le logo en texte.
- Espace de protection : la hauteur du point or, tout autour. Taille mini du logo : 20 px de haut (en dessous, l'anneau seul).
- « tv » : même police, même corps, même interlettrage que « seenit », placé juste après le point or. Le logo de l'app reste intact.
- Anneau : cercle or complet, avec la coche.

## Splash
- Logo empilé, barre de 8 épisodes (un toutes les 300 ms), puis l'anneau se ferme en 420 ms, la coche pop, le point or apparaît (+620 ms) et la signature (+900 ms).
- En vrai, on s'arrête sur l'image finale dès que les données sont prêtes.

## Animation « marquer vu » (anneau 11b)
- 0 → 420 ms : l'anneau or fait le tour complet dans le sens horaire (stroke-dashoffset, cubic-bezier(.6,0,.3,1)).
- 360 → 580 ms : la coche passe de gris à or et « pop » (échelle 0,5 → 1,12 → 1).
- 580 ms : vibration légère et toast « Vu · S05 | E04 ».
- Démarquer : l'anneau se vide en 200 ms, sans pop. « Réduire les animations » : état final direct.

## Navigation
- À voir (cartes en cours), Explorer (boussole), Moi (silhouette) : trait 2 px, glyphes 28 px, cible 44 px.
- Actif : glyphe plein or et point or sous le libellé. Inactif : #71717A.

## Sources (tailles TV)
- Samsung : https://developer.samsung.com/smarttv/design/app-icons-and-screenshots.html
- Android TV / Google TV : https://developer.android.com/design/ui/tv/guides/system/tv-app-icon-guidelines
