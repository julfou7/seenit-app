const fs = require('node:fs');
const path = require('node:path');

const TARGET_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const EXPLICIT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.node'
]);
const TEST_FILE_RE = /\.test\.(?:ts|tsx)$/;

function parseArgs(argv) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') {
      if (!argv[index + 1]) throw new Error('Option --root sans chemin.');
      root = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Option inconnue : ${argv[index]}`);
  }
  return { root };
}

function listTestFiles(root) {
  const testsRoot = path.join(root, 'tests');
  if (!fs.existsSync(testsRoot)) return [];

  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) files.push(absolute);
    }
  };
  visit(testsRoot);
  return files.sort();
}

function skipQuoted(source, index, quote) {
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function skipTemplate(source, index) {
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === '`') return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function skipSpaceAndComments(source, index) {
  let cursor = index;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source.startsWith('//', cursor)) {
      const end = source.indexOf('\n', cursor + 2);
      cursor = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function readStringLiteral(source, index) {
  const quote = source[index];
  if (quote !== "'" && quote !== '"') return null;

  let value = '';
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      if (cursor + 1 >= source.length) return null;
      value += source[cursor + 1];
      cursor += 2;
      continue;
    }
    if (char === quote) return { value, end: cursor + 1, index };
    value += char;
    cursor += 1;
  }
  return null;
}

function isIdentifierChar(char) {
  return Boolean(char) && /[A-Za-z0-9_$]/.test(char);
}

function findStaticFromSpecifier(source, index) {
  let cursor = index;
  while (cursor < source.length) {
    if (source.startsWith('//', cursor) || source.startsWith('/*', cursor) || /\s/.test(source[cursor])) {
      cursor = skipSpaceAndComments(source, cursor);
      continue;
    }
    if (source[cursor] === "'" || source[cursor] === '"') {
      cursor = skipQuoted(source, cursor, source[cursor]);
      continue;
    }
    if (source[cursor] === '`') {
      cursor = skipTemplate(source, cursor);
      continue;
    }
    if (source[cursor] === ';') return null;
    if (
      source.startsWith('from', cursor)
      && !isIdentifierChar(source[cursor - 1])
      && !isIdentifierChar(source[cursor + 4])
    ) {
      const stringStart = skipSpaceAndComments(source, cursor + 4);
      return readStringLiteral(source, stringStart);
    }
    cursor += 1;
  }
  return null;
}

function findImportSpecifiers(source) {
  const imports = [];
  let cursor = 0;

  while (cursor < source.length) {
    if (source.startsWith('//', cursor) || source.startsWith('/*', cursor) || /\s/.test(source[cursor])) {
      cursor = skipSpaceAndComments(source, cursor);
      continue;
    }
    if (source[cursor] === "'" || source[cursor] === '"') {
      cursor = skipQuoted(source, cursor, source[cursor]);
      continue;
    }
    if (source[cursor] === '`') {
      cursor = skipTemplate(source, cursor);
      continue;
    }
    if (
      source.startsWith('import', cursor)
      && !isIdentifierChar(source[cursor - 1])
      && !isIdentifierChar(source[cursor + 6])
    ) {
      const importIndex = cursor;
      let afterImport = skipSpaceAndComments(source, cursor + 6);

      if (source[afterImport] === '.') {
        cursor = afterImport + 1;
        continue;
      }

      if (source[afterImport] === '(') {
        const stringStart = skipSpaceAndComments(source, afterImport + 1);
        const literal = readStringLiteral(source, stringStart);
        if (literal) imports.push({ ...literal, importIndex });
        cursor = literal?.end ?? afterImport + 1;
        continue;
      }

      const sideEffect = readStringLiteral(source, afterImport);
      if (sideEffect) {
        imports.push({ ...sideEffect, importIndex });
        cursor = sideEffect.end;
        continue;
      }

      const fromSpecifier = findStaticFromSpecifier(source, afterImport);
      if (fromSpecifier) {
        imports.push({ ...fromSpecifier, importIndex });
        cursor = fromSpecifier.end;
        continue;
      }
    }
    cursor += 1;
  }

  return imports;
}

function hasExplicitRuntimeExtension(specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  return EXPLICIT_EXTENSIONS.has(path.posix.extname(clean));
}

function resolveImplicitTypeScriptTarget(importerFile, specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  const base = path.resolve(path.dirname(importerFile), clean);

  for (const extension of TARGET_EXTENSIONS) {
    const direct = `${base}${extension}`;
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  }
  for (const extension of TARGET_EXTENSIONS) {
    const indexFile = path.join(base, `index${extension}`);
    if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return indexFile;
  }
  return null;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function findViolations(root) {
  const violations = [];
  for (const file of listTestFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const imported of findImportSpecifiers(source)) {
      if (!imported.value.startsWith('./') && !imported.value.startsWith('../')) continue;
      if (hasExplicitRuntimeExtension(imported.value)) continue;

      const target = resolveImplicitTypeScriptTarget(file, imported.value);
      if (!target) continue;

      violations.push({
        file,
        line: lineNumberAt(source, imported.importIndex),
        specifier: imported.value,
        target
      });
    }
  }
  return violations;
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function suggestedSpecifier(violation) {
  if (path.basename(violation.target).startsWith('index.')) {
    return `${violation.specifier}/index${path.extname(violation.target)}`;
  }
  return `${violation.specifier}${path.extname(violation.target)}`;
}

function formatFailure(root, violations) {
  const lines = ['Imports ESM relatifs sans extension explicite détectés dans les TNR Node :'];
  for (const violation of violations) {
    lines.push(
      `- ${relativePath(root, violation.file)}:${violation.line} importe ${JSON.stringify(violation.specifier)} ; `
      + `cible ${relativePath(root, violation.target)}. Utilisez ${JSON.stringify(suggestedSpecifier(violation))}.`
    );
  }
  return lines.join('\n');
}

function assertNoImplicitTestEsmImports(root) {
  const violations = findViolations(root);
  if (violations.length > 0) throw new Error(formatFailure(root, violations));
  return violations;
}

function run(argv = process.argv.slice(2)) {
  const { root } = parseArgs(argv);
  try {
    assertNoImplicitTestEsmImports(root);
    console.log('Imports ESM des TNR Node : OK.');
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) process.exitCode = run();

module.exports = {
  assertNoImplicitTestEsmImports,
  findImportSpecifiers,
  findViolations,
  formatFailure,
  run
};
