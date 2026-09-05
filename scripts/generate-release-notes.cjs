const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function fixFrenchFormatting(text) {
  if (!text) return '';
  return text
    .replace(
      /(^|[\s(«“])((?:qu)|[dlcjnms])\s+([aáàâeéèêiíìîoóòôuúùûh])/gi,
      (_match, prefix, pronoun, vowel) => `${prefix}${pronoun}'${vowel}`
    )
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

function cleanConventionalSubject(subject) {
  return String(subject || '')
    .replace(/^(fix|feat|perf|style|chore|refactor|docs|build|ci|test)(\([^)]+\))?:\s*/i, '')
    .trim();
}

function formatPublicNote(value) {
  let sentence = fixFrenchFormatting(
    String(value || '')
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
  if (!sentence) return '';

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
  const headerIndex = lines.findIndex(line => /^\s*changelog\s*:/i.test(line));
  if (headerIndex < 0) return null;

  const header = lines[headerIndex].match(/^\s*changelog\s*:\s*(.*)$/i);
  const inline = String(header?.[1] || '').trim();
  if (isEmptyChangelogMarker(inline)) return [];

  const items = inline ? [inline] : [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      items.push(bullet[1].trim());
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[^:]{1,80}:\s*$/.test(trimmed) || items.length > 0) break;
  }

  return items
    .filter(item => !isEmptyChangelogMarker(item))
    .map(formatPublicNote)
    .filter(Boolean);
}

function extractCommitNotes(message) {
  const normalized = normalizeCommitMessage(message);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const subject = (lines.shift() || '').trim();
  const explicitNotes = extractExplicitChangelog(lines);
  if (explicitNotes !== null) return explicitNotes;

  const bulletItems = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (!match) continue;
    const item = formatPublicNote(match[1]);
    if (item) bulletItems.push(item);
  }

  if (bulletItems.length > 0) return bulletItems;
  if (
    /^Merge\b/i.test(subject) ||
    /^(?:chore|docs|build|ci|test)(?:\([^)]+\))?:/i.test(subject) ||
    /^chore\(release\):\s*(?:aligner|valider)\b/i.test(subject)
  ) return [];

  const cleaned = cleanConventionalSubject(subject);
  const note = formatPublicNote(cleaned);
  return note ? [note] : [];
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
  try {
    const { commits } = collectReleaseCommits(version, cwd);
    const body = buildReleaseBody(commits);
    if (body) return body;

    let latestCommit = '';
    try {
      latestCommit = runGit(['log', '-n', '1', '--pretty=%B'], cwd);
    } catch {}
    const fallbackBody = buildReleaseBody([{ hash: '', message: latestCommit }]);
    if (fallbackBody) return fallbackBody;
  } catch (error) {
    console.error('Error generating release notes:', error);
  }

  return `### 🛠️ Ce qui a été fait\n\n- Améliorations générales de l'interface, stabilité et optimisations.`;
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
  const releaseBody = generateReleaseNotes();
  writeGithubOutput(releaseBody);
  console.log(releaseBody);
}

module.exports = {
  buildReleaseBody,
  collectReleaseCommits,
  extractCommitNotes,
  formatPublicNote,
  findPreviousReleaseTag,
  generateReleaseNotes
};

if (require.main === module) main();
