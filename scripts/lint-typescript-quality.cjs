const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
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

function main() {
  const report = scanRepository();
  const summary = {
    scope: report.scope,
    fileCount: report.fileCount,
    explicitAny: report.explicitAny,
    directConsole: report.directConsole,
    topExplicitAny: topEntries(report.files, 'explicitAny'),
    topDirectConsole: topEntries(report.files, 'directConsole')
  };
  console.log('[TypeScript Quality Baseline]');
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = {
  isProductionTypeScript,
  scanRepository,
  scanSource,
  topEntries,
  walkProductionFiles
};

if (require.main === module) main();
