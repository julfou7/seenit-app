# Finitions du terrain226 — vidéos du26octobre

Baseline : main ee77b193, APK1.4.226, #729. Les deux vidéos fournies durent9,08s et5,91s ; décodage local, captures inspectées sans transfert des médias privés dans le dépôt.

| Retour | Cause / portée | Correction et preuve |
| --- | --- | --- |
| Fragment de coche avant le dessin | Longueur réelle42,4617 contre un masque de40, avec bouts ronds. | pathLength normalisé à1 et opacité0 pendant toute l’attente ; dessin final intégral. Vrai composant contrôlé à0/759/760/1000ms. |
| Splash par paquets | Huit animations de couleurs séparées nécessitent des peintures sur le thread principal au lancement. | Un seul calque animé en translation, huit crans160ms sur masque fixe ; positions échantillonnées à chaque cran, pas de rattrapage JS ni de huit peintures indépendantes. Maintien final−200ms,3500ms+fondu500ms. |
| Découpe du billet horizontal | Masque concave seulement sur le talon droit. | Masque miroir sur la moitié gauche, géométrie symétrique, déchirure existante conservée. |
| Vu trop grand / fin sous le titre | Action42px centrée sur le talon, heure dans les métadonnées. | Glyphe36px, cible48px, action à droite et heure à gauche du talon ; année sous le titre. |
| Acteurs décalés | Titres de hauteurs indépendantes dans le rail flex. | Rangées communes CSS subgrid : espace variable dans le titre, acteurs alignés sans mesure JS et sans imposer trois lignes vides. Titres réservés sur deux lignes en liste. |
| Dernière notification retirée | Le retrait met à jour les données, sans observer la transition de la liste vers zéro. | Fermeture sur transition non-vide→vide, focus rendu à la cloche ; Annuler restaure la dernière ligne. Une boîte déjà vide reste ouvrable explicitement. |

Parcours réels WatchListView/WatchNextSection, bouton Vu, billets et HomeNotifications à360/412/1280px. TNR d’annulation/lecture, signal calendaire et invariant de rendus précédents conservés. Les captures de fixtures contrôlent la géométrie, le téléphone privé reste le terrain de rendu final. Plex, compteurs de saison, signature/package et installateur non modifiés.

Les attentes de régression sont adaptées aux demandes nouvelles (3500ms, glyphes36px, heure dans le talon, acteurs alignés) ; aucune assertion de réussite métier, d’erreur, d’Annuler ou d’ancrage n’est supprimée. Validation canonique/CI/release : preuves finales dans le checkpoint stable#729.
