# SeenIt TV Samsung — SPEC prototype V1

Statut : **prototype terrain validé pour installation/lancement**, puis prolongé par la V2 UX.
Issue canonique : #295. Sport : #738.
Matériel réel : **Samsung QE55Q6FNA, gamme 2018, Tizen 4.0**.
Compatibilité widget : `required_version="3.0"` reste le minimum supporté par le package, pas la version du téléviseur terrain.

## Contrat V1

1. Le launcher démarre par `Qui regarde ?` puis utilise un profil actif explicite : Julian, Camille, Milo ou Invité.
2. Une Home adulte garde quatre destinations stables : `TV`, `Films`, `Sport`, `Réglages`.
3. `TV` signifie tuner/antenne TNT Samsung, jamais HDMI, box ou application.
4. Les applications favorites réellement détectées sont lançables directement depuis le premier viewport.
5. Le Sport peut remonter Monaco sur la Home mais reste agnostique du diffuseur : le fournisseur est une donnée et non une structure d'interface.
6. Milo possède une Home simplifiée et ne doit pas hériter silencieusement des préférences adultes.
7. Le launcher reste utilisable hors ligne pour la navigation locale, les apps détectées et les sources ; les données réseau SeenIt/Sport sont dégradables.
8. Aucun visionnage n'est marqué depuis ce prototype : sans appairage foyer/profil authentifié, aucune mutation SeenIt.
9. Aucune capacité Samsung non prouvée sur la Q6FNA n'est présentée comme garantie. TV tuner, HDMI, app launch, autorun, SDR/HDR et Home takeover sont validés séparément sur le matériel réel.
10. Le runtime reste ES5, sans framework lourd, sans iframe, sans CSS Grid, sans blur temps réel et sans polling réseau permanent.

## Preuve terrain acquise le 25/10/2026

Sur la QE55Q6FNA / Tizen 4 réelle :

- SDB connecté ;
- package `SeenItTV01` ;
- app `SeenItTV01.SeenItTV` ;
- WGT signé avec auteur `CN=SeenIt TV` ;
- chaîne distributeur legacy `Tizen Public Distributor Signer` ;
- installation répondant explicitement `install completed` ;
- lancement réussi ;
- application jugée fluide par le propriétaire ;
- UX V1 jugée trop brute / trop noire par rapport aux maquettes, sans remise en cause de la preuve technique.

La chaîne plus récente `Tizen Studio Public Signer` avait auparavant échoué avec `118012` sur cette TV ; ne pas confondre cette preuve de signature terrain avec une règle universelle pour toutes les générations Samsung.

## Validation restant à compléter pour la couche matériel

Avant merge stable de la plateforme TV :

- navigation/focus télécommande complète ;
- inventaire réel des apps et lancement d'au moins une app utile ;
- TNT ;
- au moins une entrée HDMI ;
- Retour depuis les sous-écrans et depuis une app tierce ;
- comportement après mise à jour du WGT avec la même identité auteur.

## Passage à la V2

La V2 UX est désormais spécifiée dans :

`docs/specifications/tv-samsung-launcher-v2.md`

Elle ajoute notamment :

- fond « salle obscure » moins noir ;
- Home éditoriale ;
- gestion bornée de 100+ packages avec classification `USER | SYSTEM | UNKNOWN` ;
- RAM et stockage libre en lecture seule ;
- pagination Apps ;
- préparation explicite au rôle de Home principal.

Le takeover Home/startup/root reste un chantier séparé : probe read-only, backup, rollback et accord propriétaire sont obligatoires avant toute écriture native.
