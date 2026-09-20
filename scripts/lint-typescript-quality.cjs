const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'docs/specifications/typescript-quality-baseline.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const CONSOLE_METHODS = new Set(['log', 'warn', 'error', 'info', 'debug', 'trace']);

function isProductionTypeScript(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  if (normalized.endsWith('.d.ts')) return false;
  const extension = path.extname(normalized);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  return normalized === 'server.ts' || normalized.startsWith('src/');
}

function walkProductionFiles(root = ROOT) {
  const files = [];
  const visit = (absolutePath, relativePath) => {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(absolutePath, entry), relativePath ? path.join(relativePath, entry) : entry);
      }
      return;
    }
    const normalized = relativePath.split(path.sep).join('/');
    if (isProductionTypeScript(normalized)) files.push(normalized);
  };

  const src = path.join(root, 'src');
  if (fs.existsSync(src)) visit(src, 'src');
  const server = path.join(root, 'server.ts');
  if (fs.existsSync(server)) visit(server, 'server.ts');
  return files.sort();
}

function scanSource(sourceText, fileName = 'source.ts') {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  let explicitAny = 0;
  let directConsole = 0;
  const anyLines = [];
  const consoleLines = [];

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      explicitAny += 1;
      anyLines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'console'
      && CONSOLE_METHODS.has(node.expression.name.text)
    ) {
      directConsole += 1;
      consoleLines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { explicitAny, directConsole, anyLines, consoleLines };
}

function scanRepository(root = ROOT) {
  const files = {};
  let explicitAny = 0;
  let directConsole = 0;
  for (const relativePath of walkProductionFiles(root)) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const metrics = scanSource(source, relativePath);
    files[relativePath] = metrics;
    explicitAny += metrics.explicitAny;
    directConsole += metrics.directConsole;
  }
  return {
    scope: 'src/**/*.{ts,tsx} + server.ts',
    fileCount: Object.keys(files).length,
    explicitAny,
    directConsole,
    files
  };
}

function topEntries(files, key, limit = 15) {
  return Object.entries(files)
    .filter(([, metrics]) => metrics[key] > 0)
    .sort((a, b) => b[1][key] - a[1][key] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([file, metrics]) => ({ file, count: metrics[key] }));
}

function loadPolicy(policyPath = POLICY_PATH) {
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}

function resolveBaseSha(root = ROOT) {
  const explicit = String(process.env.SEENIT_LINT_BASE_SHA || '').trim();
  if (/^[0-9a-f]{40}$/i.test(explicit) && !/^0{40}$/.test(explicit)) return explicit;
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      const sha = execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: root, encoding: 'utf8' }).trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
    } catch {}
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function changedProductionFiles(baseSha, root = ROOT) {
  if (!baseSha) return [];
  const output = execFileSync('git', ['diff', '--name-only', baseSha, '--'], {
    cwd: root,
    encoding: 'utf8'
  });
  return output.split(/\r?\n/).filter(Boolean).filter(isProductionTypeScript);
}

function readBaseFile(baseSha, relativePath, root = ROOT) {
  try {
    return execFileSync('git', ['show', `${baseSha}:${relativePath}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return '';
  }
}

function compareFileDebt(current, previous) {
  const violations = [];
  if (current.explicitAny > previous.explicitAny) {
    violations.push(`any explicites ${previous.explicitAny} → ${current.explicitAny}`);
  }
  if (current.directConsole > previous.directConsole) {
    violations.push(`console directs ${previous.directConsole} → ${current.directConsole}`);
  }
  return violations;
}

function validateReport(report, policy, options = {}) {
  const violations = [];
  if (report.explicitAny > policy.ceilings.explicitAny) {
    violations.push(`Dette globale any ${report.explicitAny} > plafond ${policy.ceilings.explicitAny}`);
  }
  if (report.directConsole > policy.ceilings.directConsole) {
    violations.push(`Dette globale console ${report.directConsole} > plafond ${policy.ceilings.directConsole}`);
  }

  for (const boundary of policy.criticalBoundaries) {
    const metrics = report.files[boundary.path] || { explicitAny: 0, directConsole: 0 };
    if (metrics.explicitAny > boundary.maxExplicitAny) {
      violations.push(`${boundary.path}: ${metrics.explicitAny} any > ${boundary.maxExplicitAny}`);
    }
    if (metrics.directConsole > boundary.maxDirectConsole) {
      violations.push(`${boundary.path}: ${metrics.directConsole} console > ${boundary.maxDirectConsole}`);
    }
  }

  const baseSha = options.baseSha || null;
  const root = options.root || ROOT;
  if (baseSha) {
    for (const relativePath of changedProductionFiles(baseSha, root)) {
      const absolutePath = path.join(root, relativePath);
      if (!fs.existsSync(absolutePath)) continue;
      const current = report.files[relativePath] || scanSource(fs.readFileSync(absolutePath, 'utf8'), relativePath);
      const previous = scanSource(readBaseFile(baseSha, relativePath, root), relativePath);
      for (const reason of compareFileDebt(current, previous)) {
        violations.push(`${relativePath}: nouvelle dette interdite (${reason})`);
      }
    }
  }
  return violations;
}

function writeReport(report, policy, violations, root = ROOT) {
  const outputDir = path.join(root, 'quality-reports');
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = {
    measuredBaseline: policy.observedBaseline,
    current: {
      fileCount: report.fileCount,
      explicitAny: report.explicitAny,
      directConsole: report.directConsole
    },
    reductions: {
      explicitAny: policy.observedBaseline.explicitAny - report.explicitAny,
      directConsole: policy.observedBaseline.directConsole - report.directConsole
    },
    topExplicitAny: topEntries(report.files, 'explicitAny'),
    topDirectConsole: topEntries(report.files, 'directConsole'),
    violations
  };
  fs.writeFileSync(path.join(outputDir, 'typescript-quality.json'), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

function main() {
  const policy = loadPolicy();
  const report = scanRepository();
  const baseSha = resolveBaseSha();
  const violations = validateReport(report, policy, { baseSha });
  const payload = writeReport(report, policy, violations);
  console.log(
    `[TypeScript Quality] any=${report.explicitAny}/${policy.ceilings.explicitAny}; `
    + `console=${report.directConsole}/${policy.ceilings.directConsole}; `
    + `réductions=${payload.reductions.explicitAny}/${payload.reductions.directConsole}.`
  );
  if (violations.length > 0) {
    violations.forEach(message => console.error(`[TypeScript Quality] ❌ ${message}`));
    process.exitCode = 1;
  } else {
    console.log('[TypeScript Quality] ✅ aucune nouvelle dette et frontières critiques conformes.');
  }
}

module.exports = {
  changedProductionFiles,
  compareFileDebt,
  isProductionTypeScript,
  loadPolicy,
  scanRepository,
  scanSource,
  topEntries,
  validateReport,
  walkProductionFiles
};

if (require.main === module) main();
