const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const SAFE_JSX_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'cancelLabel',
  'confirmLabel',
  'description',
  'emptyMessage',
  'errorMessage',
  'helperText',
  'label',
  'loadingText',
  'placeholder',
  'successMessage',
  'title'
]);

const BACKEND_ONLY_FILES = new Set([
  'server.ts',
  'src/lib/firebase-admin.ts'
]);

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json'
]);

function normalizePath(file) {
  return String(file || '').trim().replace(/\\/g, '/');
}

function isProcessOnlyFile(file) {
  const normalized = normalizePath(file);
  return normalized.endsWith('.md')
    || normalized.startsWith('docs/')
    || normalized.startsWith('tests/')
    || normalized.startsWith('.github/')
    || normalized.startsWith('.agents/')
    || normalized.startsWith('scripts/')
    || normalized === 'AGENTS.md';
}

function isNonRuntimeFile(file) {
  return isProcessOnlyFile(file);
}

function isBackendOnlyFile(file) {
  const normalized = normalizePath(file);
  return BACKEND_ONLY_FILES.has(normalized)
    || normalized.startsWith('src/backend/')
    || normalized.startsWith('src/server/')
    || normalized.startsWith('src/features/runtime/');
}

function isDependencyFile(file) {
  return DEPENDENCY_FILES.has(normalizePath(file));
}

function isSourceFile(file) {
  return /^src\/.+\.tsx?$/.test(normalizePath(file));
}

function isDirectJsxString(node) {
  return ts.isStringLiteral(node)
    && ts.isJsxExpression(node.parent)
    && Boolean(node.parent.parent)
    && (ts.isJsxElement(node.parent.parent) || ts.isJsxFragment(node.parent.parent));
}

function isSafeJsxAttributeString(node) {
  if (!ts.isStringLiteral(node) || !ts.isJsxAttribute(node.parent)) return false;
  return SAFE_JSX_ATTRIBUTES.has(node.parent.name.getText());
}

function isExplicitUiCopyString(node) {
  return ts.isStringLiteral(node)
    && ts.isCallExpression(node.parent)
    && node.parent.arguments.length === 1
    && ts.isIdentifier(node.parent.expression)
    && node.parent.expression.text === 'uiCopy';
}

function analyzeSource(file, source) {
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const signature = [];
  const copy = [];

  function visit(node) {
    if (ts.isJsxText(node)
      || isDirectJsxString(node)
      || isSafeJsxAttributeString(node)
      || isExplicitUiCopyString(node)) {
      const text = ts.isStringLiteral(node) ? node.text : node.getText(sourceFile);
      signature.push(`${node.kind}:<ui-copy>`);
      copy.push({ kind: node.kind, text });
      return;
    }

    signature.push(String(node.kind));
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      signature.push(node.getText(sourceFile));
      return;
    }
    for (const child of children) visit(child);
  }

  visit(sourceFile);
  return { signature: signature.join('\u0000'), copy };
}

function isCopyOnlySourceChange(file, before, after) {
  if (!isSourceFile(file) || typeof before !== 'string' || typeof after !== 'string') return false;
  const previous = analyzeSource(file, before);
  const current = analyzeSource(file, after);
  if (previous.signature !== current.signature || previous.copy.length !== current.copy.length) {
    return false;
  }

  return previous.copy.every((entry, index) => {
    const next = current.copy[index];
    if (entry.kind !== next.kind) return false;
    return !entry.text.trim() || Boolean(next.text.trim());
  });
}

function classifyDelivery({ changes, readBefore, readAfter, forcedMode = 'auto' }) {
  if (!['auto', 'apk'].includes(forcedMode)) {
    throw new Error(`Mode de livraison forcé invalide : ${forcedMode}.`);
  }

  const dependenciesChanged = changes.some(change => isDependencyFile(change.path));
  if (forcedMode === 'apk') {
    return {
      mode: 'apk',
      dependenciesChanged,
      reasons: ['parcours APK demandé explicitement']
    };
  }

  let mode = 'light';
  const reasons = [];

  for (const change of changes) {
    const file = normalizePath(change.path);

    if (isProcessOnlyFile(file)) {
      reasons.push(`${file} : documentation, test, CI ou outillage non embarqué`);
      continue;
    }

    if (change.status === 'M' && isSourceFile(file)) {
      const before = readBefore(file);
      const after = readAfter(file);
      if (isCopyOnlySourceChange(file, before, after)) {
        reasons.push(`${file} : texte d’interface uniquement`);
        continue;
      }
    }

    if (isBackendOnlyFile(file)) {
      if (mode === 'light') mode = 'backend';
      reasons.push(`${file} : backend non embarqué dans l’APK Capacitor`);
      continue;
    }

    return {
      mode: 'apk',
      dependenciesChanged,
      reasons: [`${file} : changement du frontend embarqué, Android, dépendances ou configuration applicative`]
    };
  }

  return {
    mode,
    dependenciesChanged,
    reasons: reasons.length ? reasons : ['aucun changement livrable détecté']
  };
}

function selectBaseRef(value) {
  const normalized = String(value || '').trim();
  if (/^[0-9a-f]{40}$/i.test(normalized) && !/^0{40}$/.test(normalized)) return normalized;
  return 'HEAD^';
}

function parseNameStatus(output) {
  const fields = output.split('\u0000').filter(Boolean);
  const changes = [];

  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++];
    const status = rawStatus[0];
    if (status === 'R' || status === 'C') {
      const previousPath = normalizePath(fields[index++]);
      const currentPath = normalizePath(fields[index++]);
      changes.push({ status, path: currentPath, previousPath });
    } else {
      changes.push({ status, path: normalizePath(fields[index++]) });
    }
  }
  return changes;
}

function readGitChanges(base, head) {
  const output = execFileSync(
    'git',
    ['diff', '--name-status', '-z', `${base}..${head}`],
    { cwd: root, encoding: 'utf8' }
  );
  return parseNameStatus(output);
}

function readWorkingTreeChanges() {
  const tracked = parseNameStatus(execFileSync(
    'git',
    ['diff', '--name-status', '-z', 'HEAD'],
    { cwd: root, encoding: 'utf8' }
  ));
  const knownPaths = new Set(tracked.map(change => normalizePath(change.path)));
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\u0000')
    .map(normalizePath)
    .filter(file => file && !knownPaths.has(file))
    .map(file => ({ status: 'A', path: file }));
  return [...tracked, ...untracked];
}

function readAt(ref, file) {
  return execFileSync('git', ['show', `${ref}:${file}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function readWorkingFile(file) {
  return fs.readFileSync(path.join(root, normalizePath(file)), 'utf8');
}

function writeGithubOutput(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `DELIVERY_MODE=${result.mode}\n`, 'utf8');
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `DEPENDENCIES_CHANGED=${result.dependenciesChanged ? 'true' : 'false'}\n`,
    'utf8'
  );
}

function writeGithubSummary(result, changes) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const labels = {
    light: 'LIGHT',
    backend: 'BACKEND',
    apk: 'APK'
  };
  const lines = [
    '## Classification de livraison SeenIt',
    '',
    `**Classe : ${labels[result.mode] || result.mode.toUpperCase()}**`,
    '',
    ...result.reasons.map(reason => `- ${reason}`),
    '',
    `Dépendances modifiées : ${result.dependenciesChanged ? 'oui' : 'non'}`,
    `Fichiers examinés : ${changes.length}`,
    ''
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'), 'utf8');
}

function main() {
  try {
    const githubHead = String(process.env.GITHUB_SHA || '').trim();
    const forcedMode = String(process.env.FORCED_DELIVERY_MODE || 'auto').trim().toLowerCase();
    const base = githubHead ? selectBaseRef(process.env.DELIVERY_BASE_SHA) : 'HEAD';
    const changes = githubHead ? readGitChanges(base, githubHead) : readWorkingTreeChanges();
    const result = classifyDelivery({
      changes,
      readBefore: file => readAt(base, file),
      readAfter: file => githubHead ? readAt(githubHead, file) : readWorkingFile(file),
      forcedMode
    });

    writeGithubOutput(result);
    writeGithubSummary(result, changes);
    console.log(`[Delivery] Classe ${result.mode.toUpperCase()}.`);
    for (const reason of result.reasons) console.log(`[Delivery] ${reason}`);
  } catch (error) {
    console.error(`[Delivery] Classification impossible : ${error.message}`);
    console.error('[Delivery] Le doute conserve la classe APK.');
    writeGithubOutput({ mode: 'apk', dependenciesChanged: true });
    process.exitCode = 1;
  }
}

module.exports = {
  BACKEND_ONLY_FILES,
  DEPENDENCY_FILES,
  SAFE_JSX_ATTRIBUTES,
  analyzeSource,
  classifyDelivery,
  isBackendOnlyFile,
  isCopyOnlySourceChange,
  isDependencyFile,
  isExplicitUiCopyString,
  isNonRuntimeFile,
  isProcessOnlyFile,
  normalizePath,
  parseNameStatus,
  readAt,
  readGitChanges,
  readWorkingFile,
  readWorkingTreeChanges,
  selectBaseRef
};

if (require.main === module) main();
