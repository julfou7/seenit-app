const { execSync } = require('child_process');
const fs = require('fs');

function fixFrenchFormatting(text) {
  if (!text) return '';
  return text
    // Missing apostrophes
    .replace(/\bd\s+([aáàâeéèêiíìîoóòôuúùûh])/gi, "d'$1")
    .replace(/\bl\s+([aáàâeéèêiíìîoóòôuúùûh])/gi, "l'$1")
    .replace(/\bc\s+est\b/gi, "c'est")
    .replace(/\bn\s+est\b/gi, "n'est")
    .replace(/\bj\s+([aáàâeéèêiíìîoóòôuúùû])/gi, "j'$1")
    .replace(/\bqu\s+([aáàâeéèêiíìîoóòôuúùûh])/gi, "qu'$1")
    .replace(/\bm\s+([aáàâeéèêiíìîoóòôuúùû])/gi, "m'$1")
    .replace(/\bs\s+([aáàâeéèêiíìîoóòôuúùû])/gi, "s'$1")
    // Missing accents & common words
    .replace(/\bpassage a la\b/gi, "passage à la")
    .replace(/\bPassage a la\b/g, "Passage à la")
    .replace(/\bmise a jour\b/gi, "mise à jour")
    .replace(/\bmises a jour\b/gi, "mises à jour")
    .replace(/\ba jour\b/gi, "à jour")
    .replace(/\bA jour\b/g, "À jour")
    .replace(/\bsynthetique\b/gi, "synthétique")
    .replace(/\bsynthetiques\b/gi, "synthétiques")
    .replace(/\becriture\b/gi, "écriture")
    .replace(/\bamelioration\b/gi, "amélioration")
    .replace(/\bameliorations\b/gi, "améliorations")
    .replace(/\bgenerale\b/gi, "générale")
    .replace(/\bgenerales\b/gi, "générales")
    .replace(/\ben-tete\b/gi, "en-tête")
    .replace(/\bentete\b/gi, "en-tête")
    .replace(/\bselecteur\b/gi, "sélecteur")
    .replace(/\bselecteurs\b/gi, "sélecteurs")
    .replace(/\belement\b/gi, "élément")
    .replace(/\belements\b/gi, "éléments")
    .replace(/\bderoulant\b/gi, "déroulant")
    .replace(/\bderoulants\b/gi, "déroulants")
    .replace(/\bfenetre\b/gi, "fenêtre")
    .replace(/\bfenetres\b/gi, "fenêtres")
    .replace(/\bselection\b/gi, "sélection")
    .replace(/\bselections\b/gi, "sélections")
    .replace(/\bprete\b/gi, "prête")
    .replace(/\bpretes\b/gi, "prêtes")
    .replace(/\bsecurite\b/gi, "sécurité")
    .replace(/\bverifier\b/gi, "vérifier")
    .replace(/\bverification\b/gi, "vérification")
    .replace(/\bverifications\b/gi, "vérifications")
    .replace(/\bdeploiement\b/gi, "déploiement")
    .replace(/\bdeploiements\b/gi, "déploiements")
    .replace(/\benregistre\b/gi, "enregistré")
    .replace(/\benregistree\b/gi, "enregistrée")
    .replace(/\benregistres\b/gi, "enregistrés")
    .replace(/\bpersonnalise\b/gi, "personnalisé")
    .replace(/\bpersonnalisee\b/gi, "personnalisée")
    .replace(/\bpersonnalises\b/gi, "personnalisés")
    .replace(/\breorganise\b/gi, "réorganisé")
    .replace(/\breorganisation\b/gi, "réorganisation")
    .replace(/\bgenere\b/gi, "généré")
    .replace(/\bgeneration\b/gi, "génération")
    .replace(/\bcle\b/gi, "clé")
    .replace(/\bcles\b/gi, "clés");
}

function generate() {
  const version = process.env.APP_VERSION || '1.2.0';
  let items = [];

  try {
    let rawLogs = '';

    try {
      // Try getting logs since last tag
      const lastTag = execSync('git describe --tags --abbrev=0', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      if (lastTag) {
        rawLogs = execSync(`git log ${lastTag}..HEAD --pretty=%s`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      }
    } catch (e) {}

    if (!rawLogs) {
      try {
        rawLogs = execSync('git log -n 5 --pretty=%s', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      } catch (e) {}
    }

    if (rawLogs) {
      const lines = rawLogs.split('\n').map(l => l.trim()).filter(Boolean);

      for (let rawMsg of lines) {
        if (/^\d+\.\d+\.\d+$/i.test(rawMsg) || /^bump/i.test(rawMsg) || rawMsg.includes('Merge branch')) continue;

        const ccRegex = /^(fix|feat|style|perf|refactor|docs|build|chore)(\(([^)]+)\))?:\s*(.*)$/i;
        const match = rawMsg.match(ccRegex);

        let type = '';
        let scope = '';
        let body = rawMsg;

        if (match) {
          type = match[1].toLowerCase();
          scope = match[3] ? match[3].toLowerCase() : '';
          body = match[4].trim();
        }

        let prefix = '- ';
        if (type === 'fix') prefix = '- **Correction** : ';
        else if (type === 'feat') prefix = '- **Nouveauté** : ';
        else if (type === 'style' || scope === 'ui') prefix = '- **Interface** : ';
        else if (type === 'perf') prefix = '- **Performance** : ';

        let text = body
          .replace(/^reorganize\s+/i, 'Réorganisation de ')
          .replace(/^reorganisation\s+/i, 'Réorganisation de ')
          .replace(/^replace\s+/i, 'Remplacement de ')
          .replace(/^modernize\s+/i, 'Modernisation de ')
          .replace(/^fix\s+/i, 'Correction de ')
          .replace(/^add\s+/i, 'Ajout de ')
          .replace(/^update\s+/i, 'Mise à jour de ')
          .replace(/^remove\s+/i, 'Suppression de ')
          .replace(/^improve\s+/i, 'Amélioration de ')
          .replace(/\bheader\b/gi, "l'en-tête")
          .replace(/\bselecteur de saison\b/gi, 'sélecteur de saison')
          .replace(/\bseason selector\b/gi, 'sélecteur de saison')
          .replace(/\bratings chart\b/gi, 'graphique des notes')
          .replace(/\bstatus bar\b/gi, 'barre de statut')
          .replace(/\bnotification\b/gi, 'notification')
          .replace(/\bselect elements\b/gi, 'menus déroulants')
          .replace(/\bmodal pickers\b/gi, 'fenêtres de sélection')
          .replace(/\balignment\b/gi, "l'alignement");

        text = text.charAt(0).toUpperCase() + text.slice(1);
        text = fixFrenchFormatting(text);
        items.push(`${prefix}${text}`);
      }
    }
  } catch (err) {
    console.error('Error generating release notes:', err);
  }

  if (items.length === 0) {
    items.push("- Améliorations générales de l'interface et de la stabilité.");
  }

  const releaseBody = `### ✨ Nouveautés de la version v${version}\n\n${items.join('\n')}`;

  if (process.env.GITHUB_OUTPUT) {
    try {
      const outputLine = `NOTES<<EOF\n${releaseBody}\nEOF\n`;
      fs.appendFileSync(process.env.GITHUB_OUTPUT, outputLine);
    } catch (e) {
      console.error('Failed to write GITHUB_OUTPUT:', e);
    }
  }

  console.log(releaseBody);
}

generate();
