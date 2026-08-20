const { execSync } = require('child_process');
const fs = require('fs');

function generate() {
  const version = process.env.APP_VERSION || '1.2.0';

  let rawLogs = '';
  try {
    const lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null').toString().trim();
    if (lastTag) {
      rawLogs = execSync(`git log ${lastTag}..HEAD --pretty=%s`).toString().trim();
    }
  } catch (e) {}

  if (!rawLogs) {
    try {
      rawLogs = execSync('git log -n 3 --pretty=%s').toString().trim();
    } catch (e) {}
  }

  const lines = rawLogs.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];

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

    let prefix = '• ';
    if (type === 'fix') prefix = '• **Correction** : ';
    else if (type === 'feat') prefix = '• **Nouveauté** : ';
    else if (type === 'style' || scope === 'ui') prefix = '• **Interface** : ';
    else if (type === 'perf') prefix = '• **Performance** : ';

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
    items.push(`${prefix}${text}`);
  }

  if (items.length === 0) {
    items.push('• Améliorations générales et optimisations.');
  }

  const releaseBody = `### ✨ Nouveautés de la version v${version}\n\n${items.join('\n')}`;
  
  if (process.env.GITHUB_OUTPUT) {
    const outputLine = `NOTES<<EOF\n${releaseBody}\nEOF\n`;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, outputLine);
  }
  console.log(releaseBody);
}

generate();
