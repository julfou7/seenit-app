# Catalogue des relations médias

`catalog.json` est la source éditoriale des sagas et univers que TMDB ne fournit pas déjà comme
collection de films. Le frontend n'en dépend pas directement : `npm run relations:build` génère le
snapshot déterministe `src/features/shows/mediaRelations.generated.ts`, commun à la PWA et à l'APK.

## Ajouter ou corriger un groupe

1. Partir d'une relation structurée explicite et conserver son URL dans `provenance.reference`.
2. Résoudre chaque œuvre vers une identité exacte `movie:<tmdbId>` ou `tv:<tmdbId>`.
3. Vérifier humainement la continuité narrative, les reboots exclus, la complétude et l'ordre.
4. Modifier uniquement `catalog.json`, incrémenter la version du groupe et `catalogVersion`.
5. Lancer `npm run relations:build`, puis les tests ciblés et `npm run relations:check`.

`label`, `releaseDate` et `posterPath` servent uniquement à l'affichage. Ils ne prouvent ni ne
fusionnent une relation. Titre, année, marque, popularité, casting, studio, mot-clé et premier résultat
de recherche sont interdits comme clés de rapprochement.

## Découvrir sans publier

`npm run relations:discover` interroge hors ligne les déclarations Wikidata `narrative universe`
(`P1080`) et `part of the series` (`P179`) qui possèdent un ID TMDB Film (`P4947`) ou Série (`P4983`).
Le résultat est écrit dans
`build/media-relations-candidates.json`, répertoire ignoré par Git.

Chaque proposition est marquée `pending-review`. Le script élimine les identités typées ambiguës et
les groupes déjà identiques au catalogue, mais **ne modifie jamais le catalogue ni le snapshot**.
L'indisponibilité de Wikidata n'affecte donc jamais une fiche SeenIt. Le workflow périodique conserve
le fichier candidat comme artefact pour revue ; aucune proposition ne rejoint la production sans PR.
