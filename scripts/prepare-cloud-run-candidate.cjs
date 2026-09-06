const fs = require('node:fs');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null) throw new Error(`Argument invalide: ${key || 'absent'}`);
    args[key.slice(2)] = value;
  }
  return args;
}

function validateRevisionName(service, revision, label) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(revision) || revision.endsWith('-') || !revision.startsWith(`${service}-`)) {
    throw new Error(`${label} Cloud Run invalide: ${revision}`);
  }
}

function deriveCandidateTag(service, candidateRevision) {
  const prefix = `${service}-gh-`;
  if (!candidateRevision.startsWith(prefix)) {
    throw new Error(`Révision candidate hors convention ${prefix}*: ${candidateRevision}`);
  }
  const suffix = candidateRevision.slice(prefix.length);
  const tag = `candidate-${suffix}`;
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(tag) || tag.endsWith('-')) {
    throw new Error(`Tag candidat Cloud Run invalide: ${tag}`);
  }
  return tag;
}

function prepareCandidateService(source, { image, service, previousRevision, candidateRevision }) {
  if (!image || !/@sha256:[0-9a-f]{64}$/.test(image)) throw new Error(`Image immuable invalide: ${image || 'absente'}`);
  if (!/^[a-z][a-z0-9-]{0,48}$/.test(service)) throw new Error(`Nom de service Cloud Run invalide: ${service}`);
  validateRevisionName(service, previousRevision, 'Révision précédente');
  validateRevisionName(service, candidateRevision, 'Révision candidate');
  if (previousRevision === candidateRevision) throw new Error('La révision candidate doit être distincte de la révision servie.');
  const candidateTag = deriveCandidateTag(service, candidateRevision);

  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let lines = source.replace(/\r\n/g, '\n').split('\n');

  const templateIndex = lines.findIndex(line => /^  template:\s*$/.test(line));
  if (templateIndex < 0) throw new Error('Bloc spec.template introuvable dans l’export Cloud Run.');
  const templateEnd = lines.findIndex((line, index) => index > templateIndex && /^  [A-Za-z0-9_-]+:\s*/.test(line));
  const effectiveTemplateEnd = templateEnd < 0 ? lines.length : templateEnd;
  const metadataIndex = lines.findIndex((line, index) => index > templateIndex && index < effectiveTemplateEnd && /^    metadata:\s*$/.test(line));
  if (metadataIndex < 0) throw new Error('Bloc spec.template.metadata introuvable dans l’export Cloud Run.');

  const metadataEndCandidate = lines.findIndex((line, index) => index > metadataIndex && index < effectiveTemplateEnd && /^    [A-Za-z0-9_-]+:\s*/.test(line));
  const metadataEnd = metadataEndCandidate < 0 ? effectiveTemplateEnd : metadataEndCandidate;
  lines = lines.filter((line, index) => !(index > metadataIndex && index < metadataEnd && /^      name:\s*/.test(line)));

  const refreshedMetadataIndex = lines.findIndex(line => /^    metadata:\s*$/.test(line));
  if (refreshedMetadataIndex < 0) throw new Error('Bloc metadata perdu pendant la préparation.');
  lines.splice(refreshedMetadataIndex + 1, 0, `      name: ${candidateRevision}`);

  lines = lines.filter(line => {
    const trimmed = line.trim();
    if (/^(?:['"])?run\.googleapis\.com\/(?:sources|base-images)(?:['"])?\s*:/.test(trimmed)) return false;
    if (trimmed === 'runtimeClassName: run.googleapis.com/linux-base-image-update') return false;
    return true;
  });

  const imageIndexes = [];
  lines.forEach((line, index) => {
    if (/^\s*(?:-\s*)?image:\s*\S+\s*$/.test(line)) imageIndexes.push(index);
  });
  if (imageIndexes.length !== 1) {
    throw new Error(`Configuration Cloud Run inattendue: ${imageIndexes.length} ligne(s) image détectée(s), 1 attendue.`);
  }
  lines[imageIndexes[0]] = lines[imageIndexes[0]].replace(/^(\s*(?:-\s*)?image:\s*)\S+\s*$/, `$1${image}`);

  const trafficIndex = lines.findIndex(line => /^  traffic:\s*$/.test(line));
  if (trafficIndex < 0) throw new Error('Bloc spec.traffic introuvable: déploiement sans garantie de trafic refusé.');
  const trafficEndCandidate = lines.findIndex((line, index) => index > trafficIndex && /^  [A-Za-z0-9_-]+:\s*/.test(line));
  const trafficEnd = trafficEndCandidate < 0 ? lines.length : trafficEndCandidate;
  const trafficText = lines.slice(trafficIndex + 1, trafficEnd).join('\n');
  if (/latestRevision:\s*true/.test(trafficText)) throw new Error('Le trafic exporté vise latestRevision=true; la candidate ne peut pas être créée sans risque.');
  if (!new RegExp(`revisionName:\\s*${previousRevision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(trafficText)) {
    throw new Error(`Le trafic exporté ne référence pas la révision servie ${previousRevision}.`);
  }
  if (!/percent:\s*100(?:\s|$)/.test(trafficText)) throw new Error('Le trafic exporté n’est pas explicitement fixé à 100 %.');

  lines.splice(
    trafficEnd,
    0,
    '  - percent: 0',
    `    revisionName: ${candidateRevision}`,
    `    tag: ${candidateTag}`
  );

  const prepared = lines.join('\n');
  if (/run\.googleapis\.com\/(?:sources|base-images)/.test(prepared)) throw new Error('Une métadonnée source Cloud Run incompatible subsiste.');
  if (/runtimeClassName:\s*run\.googleapis\.com\/linux-base-image-update/.test(prepared)) throw new Error('Le runtimeClassName de mise à jour source subsiste.');
  if (!prepared.includes(`name: ${candidateRevision}`)) throw new Error('Le nom de révision candidate n’a pas été injecté.');
  if (!prepared.includes(image)) throw new Error('Le digest d’image candidate n’a pas été injecté.');
  if (!prepared.includes(`revisionName: ${candidateRevision}`) || !prepared.includes(`tag: ${candidateTag}`)) {
    throw new Error('La cible candidate à 0 % n’a pas été injectée dans le trafic Cloud Run.');
  }

  return prepared.replace(/\n/g, newline);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['input', 'output', 'image', 'service', 'previous-revision', 'candidate-revision'];
  for (const key of required) {
    if (!args[key]) throw new Error(`Argument --${key} obligatoire.`);
  }
  const source = fs.readFileSync(args.input, 'utf8');
  const prepared = prepareCandidateService(source, {
    image: args.image,
    service: args.service,
    previousRevision: args['previous-revision'],
    candidateRevision: args['candidate-revision']
  });
  fs.writeFileSync(args.output, prepared, 'utf8');
  console.log(`[CloudRunCandidate] Service préparé: ${args['candidate-revision']} sur ${args.image}, cible 0 %=${deriveCandidateTag(args.service, args['candidate-revision'])}`);
}

module.exports = { deriveCandidateTag, parseArgs, prepareCandidateService, validateRevisionName };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[CloudRunCandidate] ${error.message}`);
    process.exit(1);
  }
}
