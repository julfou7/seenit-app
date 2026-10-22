# Navigation 13j

Demande du 22 octobre 2026, #721, handoff `Connexion du repository seenit-app (5).zip`.
Le prototype final `SeenIt Prototype.dc.html` et la colonne 13j de `SeenIt Nav v2.dc.html`
fixent l'îlot 58 px, les boutons 46 × 68 px, le verre, l'or, le fondu inférieur 96 px et l'ordre
À Voir · Explorer · Moi │ Télécharger. Les autres variantes, les autres écrans du prototype
et la sidebar desktop restent hors de cette livraison par composants.

Le contrat de production est UX-017 et les resets locaux UX-005 : seuil 350 ms, changement
d'onglet exclu du premier tap, paire consommée après reset, appui long sans clic résiduel.
Le tap simple ferme un niveau existant, puis à la racine remonte sans vider les filtres.
Un mouvement de plus de 8 px, pointercancel/leave, perte de fenêtre ou démontage annule le long.
480 ms, clic droit et Maj+F10 partagent les mêmes raccourcis ; vibration facultative 12 ms.

Ce soir suit exactement le raccourci du prototype : ouvrir À Regarder. Aucun nouveau moteur
de recommandations ou planificateur n'est créé. Explorer révèle et focalise sa vraie saisie,
Moi ouvre une feuille de réglages rapides (fonctionnalité Téléchargements et accès Réglages),
Télécharger ouvre sa vraie Recherche C411. Les boutons existants ou ajoutés rendent les
fonctions accessibles sans geste caché. Aucun reset ne modifie la bibliothèque ou les transferts.

L'état du badge est une présentation des données live existantes. Actif or > action rouge >
terminé non consulté vert ; acquittement UI local par identité technique et compte courant,
sans écriture cloud ni nouvelle boucle de polling. Un nouveau transfert terminé reste signalé
même si d'autres ont déjà été consultés. Les téléchargements en attente de disponibilité ne
sont jamais présentés comme terminés. Hors fonctionnalité : aucune souscription/polling du badge.

Barre masquée sur fiche/dialogue plein écran ; elle conserve sa place et son état au retour.
Le toast global réserve 80 px + safe area avec barre, 24 px sans barre ; le contenu 84 px.
Le fondu et l'îlot suivent la safe area sans masquer les cibles finales ; pas de flou supérieur
supplémentaire, pas d'animation imposée avec reduced-motion. PWA et APK partagent ce composant.
