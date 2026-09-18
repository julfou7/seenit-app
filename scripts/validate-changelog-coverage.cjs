const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { extractCommitNotes } = require('./generate-release-notes.cjs');

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

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet && isEmptyMarker(bullet[1])) return [];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[^:]{1,80}:\s*$/.test(trimmed)) break;
    if (!bullet) break;
  }

  throw new Error(`${label} possède un bloc Changelog: vide ou invalide.`);
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

function main() {
  try {
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
  validateCommitMessage
};

if (require.main === module) main();
