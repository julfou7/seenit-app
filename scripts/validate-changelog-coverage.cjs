const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { extractCommitNotes, readChangelogBlock } = require('./generate-release-notes.cjs');

const root = path.resolve(__dirname, '..');

function runGit(args, cwd = root) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  }).trim();
}

function normalizeMessage(message) {
  return String(message || '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

function isEmptyMarker(value) {
  return /^(?:aucun(?:e|s|es)?|néant|none|n\/?a)[.!?…]*$/i.test(String(value || '').trim());
}

function validateCommitMessage(message, label = 'commit') {
  const normalized = normalizeMessage(message);
  const lines = normalized.split('\n');
  const headerIndex = lines.findIndex(line => /^\s*changelog\s*:/i.test(line));
  if (headerIndex < 0) {
    throw new Error(`${label} sans bloc Changelog: explicite.`);
  }

  const header = lines[headerIndex].match(/^\s*changelog\s*:\s*(.*)$/i);
  const inline = String(header?.[1] || '').trim();
  if (isEmptyMarker(inline)) return [];

  const notes = extractCommitNotes(normalized);
  if (notes.length > 0) return notes;

  // Même grammaire que le générateur : « aucun » est accepté en puce ou en phrase.
  if (readChangelogBlock(lines, headerIndex + 1).some(isEmptyMarker)) return [];

  throw new Error(`${label} possède un bloc Changelog: vide ou invalide. Formes acceptées : « Changelog: Une phrase. », « Changelog: » suivi de puces « - … » ou d'une phrase, ou « Changelog: aucun ».`);
}

function collectCommits(baseSha, head = 'HEAD', cwd = root) {
  if (!/^[0-9a-f]{40}$/i.test(String(baseSha || ''))) {
    throw new Error(`Baseline Git invalide pour le garde Changelog: ${baseSha || '(absente)'}.`);
  }

  const output = runGit(['log', '--reverse', '--format=%H%x1f%P%x1f%B%x1e', `${baseSha}..${head}`], cwd);
  if (!output) return [];

  return output
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [hash = '', parentsRaw = '', ...messageParts] = record.split('\x1f');
      return {
        hash: hash.trim(),
        parents: parentsRaw.trim().split(/\s+/).filter(Boolean),
        message: messageParts.join('\x1f').trim()
      };
    });
}

function validateChangelogRange({ baseSha, head = 'HEAD', cwd = root } = {}) {
  const commits = collectCommits(baseSha, head, cwd);
  const checked = [];
  for (const commit of commits) {
    if (commit.parents.length > 1) continue;
    validateCommitMessage(commit.message, `Commit ${commit.hash.slice(0, 12)}`);
    checked.push(commit.hash);
  }
  return checked;
}

/** Préflight d'un message préparé (fichier ou `-` pour l'entrée standard), avant toute écriture distante. */
function validateMessageFile(file) {
  const message = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  const notes = validateCommitMessage(message, 'Message');
  console.log(`[Changelog] ✅ message valide : ${notes.length ? notes.join(' ') : 'Changelog: aucun'}`);
  return notes;
}

function main() {
  try {
    if (process.argv[2] === '--message') {
      validateMessageFile(process.argv[3] || '-');
      return;
    }
    const baseSha = process.argv[2]
      || process.env.SEENIT_VALIDATE_BASE_SHA
      || process.env.SPEC_BASE_SHA;
    const checked = validateChangelogRange({ baseSha });
    console.log(`[Changelog] ✅ ${checked.length} commit(s) non-merge vérifié(s).`);
  } catch (error) {
    console.error(`[Changelog] ❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectCommits,
  validateChangelogRange,
  validateCommitMessage,
  validateMessageFile
};

if (require.main === module) main();
