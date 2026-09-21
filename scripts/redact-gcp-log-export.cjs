const fs = require('node:fs');
const path = require('node:path');
const { sanitizeValue } = require('./audit-structured-logs.cjs');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(item);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function redactCloudRunEnvValues(value, depth = 0) {
  if (depth > 20 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 10000).map(entry => redactCloudRunEnvValues(entry, depth + 1));

  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 500)) {
    if (key === 'env' && Array.isArray(entry)) {
      output[key] = entry.slice(0, 500).map(binding => {
        if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return redactCloudRunEnvValues(binding, depth + 1);
        const sanitizedBinding = redactCloudRunEnvValues(binding, depth + 1);
        if (Object.prototype.hasOwnProperty.call(binding, 'value')) sanitizedBinding.value = '[MASQUÉ_ENV]';
        return sanitizedBinding;
      });
      continue;
    }
    output[key] = redactCloudRunEnvValues(entry, depth + 1);
  }
  return output;
}

function redactGcpLogExport(payload) {
  return sanitizeValue(redactCloudRunEnvValues(payload));
}

function readInput(input) {
  if (input === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(path.resolve(input), 'utf8');
}

function writeOutput(output, content) {
  if (output === '-') {
    process.stdout.write(content);
    return;
  }
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    throw new Error('Usage: node scripts/redact-gcp-log-export.cjs --input=<json|-> --output=<json|->');
  }
  const payload = JSON.parse(readInput(args.input));
  const redacted = redactGcpLogExport(payload);
  writeOutput(args.output, `${JSON.stringify(redacted, null, 2)}\n`);
  if (args.output !== '-') console.log('[GcpLogRedaction] Export redigé écrit sans valeur env Cloud Run.');
}

module.exports = { parseArgs, redactCloudRunEnvValues, redactGcpLogExport };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('[GcpLogRedaction] Échec de redaction.');
    process.exit(1);
  }
}
