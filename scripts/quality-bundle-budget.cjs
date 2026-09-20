const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const DEFAULT_DIST = path.join(root, 'dist');
const DEFAULT_CONFIG = path.join(root, 'docs', 'specifications', 'quality-gates.json');
const DEFAULT_REPORT_DIR = path.join(root, 'quality-reports');

function round(value) {
  return Math.round(value * 100) / 100;
}

function gzipKiB(filePath) {
  const compressed = zlib.gzipSync(fs.readFileSync(filePath), { level: 9 });
  return compressed.length / 1024;
}

function normalizeAssetPath(distDir, asset) {
  const clean = asset.split(/[?#]/, 1)[0];
  if (clean.startsWith('/')) return path.join(distDir, clean.slice(1));
  return path.join(distDir, clean);
}

function parseEntryAssets(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1]);
  const styles = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1]);
  return { scripts, styles };
}

function staticJsImports(source) {
  const imports = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+\.js(?:[?#][^"']*)?)["']/g,
    /\bimport\s*["']([^"']+\.js(?:[?#][^"']*)?)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.add(match[1]);
  }
  return [...imports];
}

function resolveJsImport(currentFile, specifier, distDir) {
  const clean = specifier.split(/[?#]/, 1)[0];
  const resolved = clean.startsWith('/')
    ? path.join(distDir, clean.slice(1))
    : path.resolve(path.dirname(currentFile), clean);
  const relative = path.relative(distDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Import JS hors dist refusé : ${specifier}`);
  }
  return resolved;
}

function collectInitialJs(entryFiles, distDir) {
  const visited = new Set();
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    if (!fs.existsSync(file)) throw new Error(`Chunk initial introuvable : ${path.relative(distDir, file)}`);
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of staticJsImports(source)) {
      const imported = resolveJsImport(file, specifier, distDir);
      if (!visited.has(imported)) queue.push(imported);
    }
  }
  return [...visited];
}

function listFilesRecursive(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function analyzeDist(distDir = DEFAULT_DIST) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error(`Build Vite absent : ${indexPath}`);
  const html = fs.readFileSync(indexPath, 'utf8');
  const { scripts, styles } = parseEntryAssets(html);
  if (scripts.length !== 1) {
    throw new Error(`Un unique entrypoint module Vite est attendu, trouvé : ${scripts.length}.`);
  }

  const entryFile = normalizeAssetPath(distDir, scripts[0]);
  const styleFiles = styles.map(style => normalizeAssetPath(distDir, style));
  for (const file of [entryFile, ...styleFiles]) {
    if (!fs.existsSync(file)) throw new Error(`Asset déclaré dans index.html introuvable : ${path.relative(distDir, file)}`);
  }

  const initialJsFiles = collectInitialJs([entryFile], distDir);
  const assetsDir = path.join(distDir, 'assets');
  const allJsFiles = (fs.existsSync(assetsDir) ? listFilesRecursive(assetsDir) : listFilesRecursive(distDir))
    .filter(file => file.endsWith('.js'));
  const initialSet = new Set(initialJsFiles.map(file => path.resolve(file)));
  const lazyFiles = allJsFiles.filter(file => !initialSet.has(path.resolve(file)));

  const toItem = file => ({
    file: path.relative(distDir, file).replaceAll(path.sep, '/'),
    gzipKiB: round(gzipKiB(file)),
  });
  const initialItems = initialJsFiles.map(toItem).sort((a, b) => a.file.localeCompare(b.file));
  const lazyItems = lazyFiles.map(toItem).sort((a, b) => b.gzipKiB - a.gzipKiB || a.file.localeCompare(b.file));
  const cssItems = styleFiles.map(toItem).sort((a, b) => a.file.localeCompare(b.file));
  const entryItem = toItem(entryFile);

  return {
    entry: entryItem,
    initialJs: {
      gzipKiB: round(initialItems.reduce((sum, item) => sum + item.gzipKiB, 0)),
      files: initialItems,
    },
    initialCss: {
      gzipKiB: round(cssItems.reduce((sum, item) => sum + item.gzipKiB, 0)),
      files: cssItems,
    },
    largestLazyChunk: lazyItems[0] || null,
    lazyChunks: lazyItems,
  };
}

function enforceBudgets(report, config) {
  const budget = config.budgets.bundle;
  const failures = [];
  const checks = [
    ['entry gzip', report.entry.gzipKiB, budget.entryGzipKiB],
    ['JS initial gzip', report.initialJs.gzipKiB, budget.initialJsGzipKiB],
    ['CSS initial gzip', report.initialCss.gzipKiB, budget.initialCssGzipKiB],
    ['plus gros chunk lazy gzip', report.largestLazyChunk?.gzipKiB || 0, budget.lazyChunkGzipKiB],
  ];
  for (const [label, actual, limit] of checks) {
    if (actual > limit) failures.push(`${label}: ${actual} KiB > budget ${limit} KiB`);
  }
  return { checks, failures };
}

function writeReports(report, budgetResult, config, reportDir = DEFAULT_REPORT_DIR) {
  fs.mkdirSync(reportDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    issue: config.issue,
    budgets: config.budgets.bundle,
    ...report,
    status: budgetResult.failures.length === 0 ? 'pass' : 'fail',
    failures: budgetResult.failures,
  };
  fs.writeFileSync(path.join(reportDir, 'bundle-budget.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const rows = budgetResult.checks.map(([label, actual, limit]) =>
    `| ${label} | ${actual} KiB | ${limit} KiB | ${actual <= limit ? '✅' : '❌'} |`
  );
  const lazyDetails = report.lazyChunks.slice(0, 10).map(item => `- ${item.file}: ${item.gzipKiB} KiB gzip`).join('\n') || '- aucun';
  const markdown = [
    '# Budget bundle SeenIt',
    '',
    '| Mesure | Observé | Budget | État |',
    '|---|---:|---:|:---:|',
    ...rows,
    '',
    '## Chunks lazy les plus lourds',
    '',
    lazyDetails,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(reportDir, 'bundle-budget.md'), markdown, 'utf8');
}

function main() {
  const config = JSON.parse(fs.readFileSync(DEFAULT_CONFIG, 'utf8'));
  const report = analyzeDist(DEFAULT_DIST);
  const budgetResult = enforceBudgets(report, config);
  writeReports(report, budgetResult, config);

  console.log(`[Quality] Entry ${report.entry.gzipKiB} KiB gzip ; JS initial ${report.initialJs.gzipKiB} KiB ; CSS ${report.initialCss.gzipKiB} KiB ; lazy max ${report.largestLazyChunk?.gzipKiB || 0} KiB.`);
  if (budgetResult.failures.length > 0) {
    for (const failure of budgetResult.failures) console.error(`[Quality] ❌ ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('[Quality] ✅ Budgets bundle respectés.');
}

module.exports = {
  analyzeDist,
  collectInitialJs,
  enforceBudgets,
  gzipKiB,
  parseEntryAssets,
  staticJsImports,
  writeReports,
};

if (require.main === module) main();
