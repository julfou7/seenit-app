const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value, 'utf8');

function replaceOnce(path, before, after, label) {
  const source = read(path);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: ${label}, 1 occurrence attendue, ${count} trouvée(s)`);
  write(path, source.replace(before, after));
}

replaceOnce(
  'tests/mediaRelationsSpecification.test.ts',
  "/libellé d'une liste[\\s\\S]*uniquement[\\s\\S]*qualifier sa nature/",
  "/libellé d'une liste[\\s\\S]*uniquement[\\s\\S]*qualifier sa[\\s\\S]*nature/",
  'assertion libellé TVDB',
);
replaceOnce(
  'tests/mediaRelationsSpecification.test.ts',
  "/Un média déjà présent dans l'Ordre de visionnage est retiré de la section TVDB/",
  "/Un média déjà présent dans l'Ordre[\\s\\S]*de visionnage est retiré de la section TVDB/",
  'assertion déduplication',
);
replaceOnce(
  'tests/mediaRelationsSpecification.test.ts',
  "/pipeline relationnel historique n'est plus une source runtime/",
  "/pipeline relationnel[\\s\\S]*historique n'est plus une source runtime/",
  'assertion pipeline historique',
);

replaceOnce(
  'docs/specifications/functional-reference.md',
  'Dernière vérification : 6 septembre 2026  \nBaseline observée : **1.4.120**, `main` `ec707bd971673b5bd7f2c10aaea70b7e592dca61`',
  'Dernière vérification : 7 septembre 2026  \nBaseline observée : **1.4.120**, `main` `4923896aa68225021cf7e12d5df30d10f2c7f4a4`',
  'baseline fonctionnelle',
);
replaceOnce(
  'docs/specifications/functional-reference.md',
  '| P1 | Le runtime actuel conserve encore le catalogue relationnel SeenIt, le détecteur/pipeline hors ligne et les sections Films/Séries similaires ; TVDB n\'est pas encore le résolveur normal de franchise/univers. | Migrer vers la décision TMDB + TVDB de `SEENIT-RELATION-001` et supprimer les similaires des fiches : [#130](https://github.com/julfou7/seenit-app/issues/130). |\n',
  '',
  'écart connu #130 devenu obsolète',
);
replaceOnce(
  'docs/specifications/seenit.md',
  'encyclopédie SeenIt des univers ne font plus partie de la stratégie normale des fiches. Le catalogue\nrelationnel SeenIt existant est **legacy pendant la migration**. Un éventuel override futur ne peut\nêtre qu\'une exception rare, versionnée, fondée sur des `mediaKey` exactes et tracée dans une issue ; il\nne redevient jamais une stratégie d\'enrichissement continu.',
  'encyclopédie SeenIt des univers ne font plus partie de la stratégie normale des fiches. Le catalogue\nrelationnel SeenIt historique est **hors du chemin runtime normal**. Un éventuel override futur ne peut\nêtre qu\'une exception rare, versionnée, fondée sur des `mediaKey` exactes et tracée dans une issue ; il\nne redevient jamais une stratégie d\'enrichissement continu.',
  'statut catalogue relationnel',
);

console.log('Corrections finales #130 appliquées.');
