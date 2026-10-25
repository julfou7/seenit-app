# SeenIt TV Samsung — SPEC prototype V1

Statut : prototype terrain, non fusionnable comme plateforme stable avant validation Q6F réelle.
Issue canonique : #295. Sport : #738.
Cible : Samsung QE55Q6F 2017, Tizen 3.0.

## Contrat V1

1. Le launcher démarre par `Qui regarde ?` puis utilise un profil actif explicite : Julian, Camille, Milo ou Invité.
2. Une Home adulte garde quatre destinations stables : `TV`, `Films`, `Sport`, `Réglages`.
3. `TV` signifie tuner/antenne TNT Samsung, jamais HDMI, box ou application.
4. Les applications favorites réellement détectées sont lançables directement depuis le premier viewport.
5. Le Sport peut remonter Monaco sur la Home mais reste agnostique du diffuseur : le fournisseur est une donnée et non
   une structure d'interface.
6. Milo possède une Home simplifiée et ne doit pas hériter silencieusement des préférences adultes.
7. Le launcher reste utilisable hors ligne pour la navigation locale, les apps détectées et les sources ; les données
   réseau SeenIt/Sport sont dégradables.
8. Aucun visionnage n'est marqué depuis ce prototype : sans appairage foyer/profil authentifié, aucune mutation SeenIt.
9. Aucune capacité Samsung non prouvée sur la Q6F n'est présentée comme garantie. TV tuner, HDMI, app launch, autorun,
   SDR/HDR et Home takeover sont validés séparément sur le matériel réel.
10. Le runtime Tizen 3 reste ES5, sans framework lourd, sans iframe, sans CSS Grid, sans blur temps réel et sans polling
    permanent.

## Critère de passage à la V2

Sur la Q6F réelle : launcher installable, navigation télécommande fluide, retour fiable, apps listées/lancées,
TV antenne et au moins une entrée HDMI validées ou explicitement dégradées. Après cette preuve seulement : appairage
foyer, données Sport réelles, Plex exact, SDR/HDR et exploration prudente du bouton Home.
