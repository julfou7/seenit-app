# Espaces et affiches — publication228

Baseline : main30b4decc, deux retours après APK227, suivi#729 / publication#102 / PR768.

| Constat | Cause confirmée | Correction et preuve |
| --- | --- | --- |
| Haut des affiches incliné rogné | Le rail défilant coupe les quelques pixels de rotation au-dessus de son contenu. | Garde de rendu4px ; contrôle réel des bornes de toutes les affiches à360/412/1280. |
| Afficher plus loin des cartes et collé à la section suivante | Liste films avec marge basse28px, bouton avec marge basse10px. | Distance12px au-dessus et28px dessous ; contrôle des rectangles réels, y compris la section suivante. |
| Bascule rail/liste décalée de4px lors de la première CI candidate40311782262 | La marge basse6px de l’en-tête fusionne avec la marge haute2px du rail : le padding ajouté n’est pas compensé. Même principe pour le sous-titre des séries délaissées. | Marge de l’en-tête adjacent2px et du sous-titre adjacent8px ; la garde4px laisse les cartes au même repère. TNR220 existant inchangé : première carte, en-tête, section précédente et scroll tous fixes, aux trois largeurs ; nouveaux contrôles227 également verts. |
| Garde de changement arrêtée avant le navigateur sur les commits directs | Le validateur ne reconnaît que tests/*.test.ts, pas un TNR navigateur pourtant branché. | Limite tracée#769 ; tests Node des prédicats de rejet du rognage/espacement et de leur branchement canonique ajoutés. Le navigateur réel reste la preuve de rendu ; aucune assertion ancienne supprimée. |

La candidate228 non publiée est réutilisée sans nouveau numéro, force-push ou commande de préparation doublée. Nettoyage boy-scout des deux surfaces de version TypeScript : catch unknown sans mutation métier ; retrait d’un console.error redondant avec appLogger.error, qui conserve le diagnostic. Aucun changement de signature, package, installateur, transport Plex, identité média ou Firestore.

Preuves ciblées : terrain228-targeted.log, Node3/3, parcours réels220+227 verts360/412/1280. Validation canonique complète et navigateur frais requis avant push ; CI et livraison enregistrées dans le checkpoint stable#102. Rendu sur téléphone privé après installation encore à confirmer.
