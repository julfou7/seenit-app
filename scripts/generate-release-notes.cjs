const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const ENGLISH_LANGUAGE_SIGNALS = new Set([
  'add', 'added', 'adds', 'allow', 'allows', 'and', 'better', 'button', 'deliver', 'delivers',
  'directory', 'distinguish', 'distinguishes', 'due', 'ensure', 'ensures', 'field', 'first',
  'fix', 'fixed', 'fixes', 'for', 'from', 'immediate', 'immediately', 'improve', 'improved',
  'improves', 'in', 'inside', 'is', 'isolate', 'isolates', 'loading', 'materialize', 'materializes',
  'new', 'of', 'on', 'prevent', 'prevents', 'progressive', 'regression', 'reminder', 'reminders',
  'remove', 'removed', 'removes', 'restore', 'restored', 'restores', 'result', 'results', 'safe',
  'scheduled', 'search', 'show', 'shows', 'smoother', 'support', 'supports', 'test', 'tests',
  'the', 'this', 'to', 'unblock', 'unblocks', 'update', 'updated', 'updates', 'use', 'uses',
  'when', 'while', 'with', 'within', 'without'
]);

const FRENCH_LANGUAGE_SIGNALS = new Set([
  'a', 'affiche', 'affichent', 'ajoute', 'ajoutent', 'ameliore', 'ameliorent', 'apres', 'avec',
  'avant', 'ce', 'cette', 'ces', 'conserve', 'conservent', 'corrige', 'corrigent', 'dans', 'de',
  'des', 'du', 'et', 'est', 'etre', 'filtre', 'la', 'le', 'les', 'lorsque', 'maintenant', 'mise',
  'moins', 'plus', 'pour', 'retrouve', 'retrouvent', 'sans', 'serie', 'series', 'sont', 'sur', 'un',
  'une', 'vu', 'vus'
]);

function fixFrenchFormatting(text) {
  if (!text) return '';
  return text
    .replace(
      /(^|[\s(«“])((?:qu)|[dlcjnms])\s+([aáàâeéèêiíìîoóòôuúùûh])/gi,
      (_match, prefix, pronoun, vowel) => `${prefix}${pronoun}'${vowel}`
    )
    .replace(/\bpassage a la\b/gi, 'passage à la')
    .replace(/\bPassage a la\b/g, 'Passage à la')
    .replace(/\bmise a jour\b/gi, 'mise à jour')
    .replace(/\bmises a jour\b/gi, 'mises à jour')
    .replace(/\ba jour\b/gi, 'à jour')
    .replace(/\bA jour\b/g, 'À jour')
    .replace(/\bsynthetique\b/gi, 'synthétique')
    .replace(/\bsynthetiques\b/gi, 'synthétiques')
    .replace(/\becriture\b/gi, 'écriture')
    .replace(/\bamelioration\b/gi, 'amélioration')
    .replace(/\bameliorations\b/gi, 'améliorations')
    .replace(/\bgenerale\b/gi, 'générale')
    .replace(/\bgenerales\b/gi, 'générales')
    .replace(/\ben-tete\b/gi, 'en-tête')
    .replace(/\bentete\b/gi, 'en-tête')
    .replace(/\bselecteur\b/gi, 'sélecteur')
    .replace(/\bselecteurs\b/gi, 'sélecteurs')
    .replace(/\belement\b/gi, 'élément')
    .replace(/\belements\b/gi, 'éléments')
    .replace(/\bderoulant\b/gi, 'déroulant')
    .replace(/\bderoulants\b/gi, 'déroulants')
    .replace(/\bfenetre\b/gi, 'fenêtre')
    .replace(/\bfenetres\b/gi, 'fenêtres')
    .replace(/\bselection\b/gi, 'sélection')
    .replace(/\bselections\b/gi, 'sélections')
    .replace(/\bprete\b/gi, 'prête')
    .replace(/\bpretes\b/gi, 'prêtes')
    .replace(/\bsecurite\b/gi, 'sécurité')
    .replace(/\bverifier\b/gi, 'vérifier')
    .replace(/\bverification\b/gi, 'vérification')
    .replace(/\bverifications\b/gi, 'vérifications')
    .replace(/\bdeploiement\b/gi, 'déploiement')
    .replace(/\bdeploiements\b/gi, 'déploiements')
    .replace(/\benregistre\b/gi, 'enregistré')
    .replace(/\benregistree\b/gi, 'enregistrée')
    .replace(/\benregistres\b/gi, 'enregistrés')
    .replace(/\bpersonnalise\b/gi, 'personnalisé')
    .replace(/\bpersonnalisee\b/gi, 'personnalisée')
    .replace(/\bpersonnalises\b/gi, 'personnalisés')
    .replace(/\breorganise\b/gi, 'réorganisé')
    .replace(/\breorganisation\b/gi, 'réorganisation')
    .replace(/\bgenere\b/gi, 'généré')
    .replace(/\bgeneration\b/gi, 'génération')
    .replace(/\bcle\b/gi, 'clé')
    .replace(/\bcles\b/gi, 'clés');
}

function runGit(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8'
  }).trim();
}

function parseSemver(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareSemver(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function findPreviousReleaseTag(version, cwd = process.cwd()) {
  const target = parseSemver(version);
  if (!target) return null;

  let tags = '';
  try {
    tags = runGit(['tag', '--list', 'v*', '--sort=-v:refname'], cwd);
  } catch {
    return null;
  }

  for (const tag of tags.split('\n').map(value => value.trim()).filter(Boolean)) {
    const parsed = parseSemver(tag);
    if (parsed && compareSemver(parsed, target) < 0) return tag;
  }
  return null;
}

function normalizeCommitMessage(message) {
  return String(message || '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function collectReleaseCommits(version, cwd = process.cwd()) {
  const previousTag = findPreviousReleaseTag(version, cwd);
  let output = '';

  try {
    const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
    const args = previousTag
      ? ['log', '--reverse', '--format=%H%x1f%B%x1e', range]
      : ['log', '-n', '10', '--reverse', '--format=%H%x1f%B%x1e', range];
    output = runGit(args, cwd);
  } catch {
    return { previousTag, commits: [] };
  }

  const commits = output
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const separatorIndex = record.indexOf('\x1f');
      if (separatorIndex < 0) return null;
      return {
        hash: record.slice(0, separatorIndex).trim(),
        message: normalizeCommitMessage(record.slice(separatorIndex + 1))
      };
    })
    .filter(Boolean);

  return { previousTag, commits };
}

function normalizeLanguageToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR');
}

function getLanguageSignals(value) {
  const tokens = String(value || '')
    .match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g)
    ?.map(normalizeLanguageToken) || [];

  let english = 0;
  let french = 0;
  for (const token of tokens) {
    if (ENGLISH_LANGUAGE_SIGNALS.has(token)) english += 1;
    if (FRENCH_LANGUAGE_SIGNALS.has(token)) french += 1;
  }
  return { tokens, english, french };
}

function assertPublicNoteQuality(value) {
  const sentence = String(value || '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sentence) return;

  const { tokens, english, french } = getLanguageSignals(sentence);
  if (english >= 2 && english > french) {
    throw new Error(`Note de version refusée : elle doit être rédigée en français (« ${sentence} »).`);
  }

  if (tokens.length < 4) {
    throw new Error(`Note de version refusée : formulation trop vague (« ${sentence} »).`);
  }

  if (/\b(?:améliorations? générales?|diverses? corrections?|corrections? diverses?|optimisations? diverses?)\b/i.test(sentence)) {
    throw new Error(`Note de version refusée : formulation trop vague (« ${sentence} »).`);
  }

  if (/(?:^|\s)#\d+\b/.test(sentence)) {
    throw new Error(`Note de version refusée : une référence d'issue ne doit pas être exposée au public (« ${sentence} »).`);
  }
}

function formatPublicNote(value) {
  let sentence = fixFrenchFormatting(
    String(value || '')
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
  if (!sentence) return '';

  assertPublicNoteQuality(sentence);
  sentence = sentence.charAt(0).toLocaleUpperCase('fr-FR') + sentence.slice(1);
  if (!/[.!?…]$/.test(sentence)) sentence += '.';
  return `- ${sentence}`;
}

function isEmptyChangelogMarker(value) {
  const normalized = String(value || '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .trim()
    .replace(/[.!?…]+$/, '')
    .trim();
  return /^(?:aucun(?:e|s|es)?|néant|none|n\/?a)$/i.test(normalized);
}

function extractExplicitChangelog(lines) {
  const items = [];
  let foundHeader = false;

  for (let headerIndex = 0; headerIndex < lines.length; headerIndex += 1) {
    const header = lines[headerIndex].match(/^\s*changelog\s*:\s*(.*)$/i);
    if (!header) continue;
    foundHeader = true;

    const inline = String(header[1] || '').trim();
    if (inline && !isEmptyChangelogMarker(inline)) items.push(inline);
    if (inline) continue;

    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*changelog\s*:/i.test(line)) break;
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
      if (bullet) {
        items.push(bullet[1].trim());
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^[^:]{1,80}:\s*$/.test(trimmed) || items.length > 0) break;
    }
  }

  if (!foundHeader) return null;
  return items
    .filter(item => !isEmptyChangelogMarker(item))
    .map(formatPublicNote)
    .filter(Boolean);
}

function extractCommitNotes(message) {
  const normalized = normalizeCommitMessage(message);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  lines.shift();
  const explicitNotes = extractExplicitChangelog(lines);
  return explicitNotes === null ? [] : explicitNotes;
}

function deduplicateNotes(notes) {
  const seen = new Set();
  const result = [];
  for (const note of notes) {
    const key = note
      .replace(/^[-*•]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('fr-FR');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(note);
  }
  return result;
}

function buildReleaseBody(commits) {
  const notes = deduplicateNotes(commits.flatMap(commit => extractCommitNotes(commit.message)));
  if (!notes.length) return '';
  return `### 🛠️ Ce qui a été fait\n\n${notes.join('\n')}`;
}

function generateReleaseNotes({ version = process.env.APP_VERSION || '1.2.0', cwd = process.cwd() } = {}) {
  const { commits } = collectReleaseCommits(version, cwd);
  const body = buildReleaseBody(commits);
  if (body) return body;

  throw new Error(
    'Aucune note de version publique valide : ajoutez un bloc Changelog: en français sur chaque changement visible, ou Changelog: aucun pour un commit sans effet utilisateur.'
  );
}

function writeGithubOutput(releaseBody) {
  if (!process.env.GITHUB_OUTPUT) return;
  try {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `NOTES<<EOF\n${releaseBody}\nEOF\n`);
  } catch (error) {
    console.error('Failed to write GITHUB_OUTPUT:', error);
  }
}

function main() {
  try {
    const releaseBody = generateReleaseNotes();
    writeGithubOutput(releaseBody);
    console.log(releaseBody);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  assertPublicNoteQuality,
  buildReleaseBody,
  collectReleaseCommits,
  extractCommitNotes,
  formatPublicNote,
  findPreviousReleaseTag,
  generateReleaseNotes
};

if (require.main === module) main();
