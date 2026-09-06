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

function getSingleContainerBounds(lines, imageIndex) {
  let containerStart = imageIndex;
  while (containerStart >= 0 && !/^      - [A-Za-z0-9_-]+:\s*/.test(lines[containerStart] || '')) {
    containerStart -= 1;
  }
  if (containerStart < 0) throw new Error('Début du conteneur Cloud Run introuvable.');

  let containerEnd = lines.length;
  for (let index = containerStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^      - [A-Za-z0-9_-]+:\s*/.test(line) || /^      [A-Za-z0-9_-]+:\s*/.test(line)) {
      containerEnd = index;
      break;
    }
  }
  return { containerStart, containerEnd };
}

function normalizeSingleContainerLaunch(lines, imageIndex) {
  const { containerStart, containerEnd } = getSingleContainerBounds(lines, imageIndex);
  const containerLines = lines.slice(containerStart, containerEnd);
  containerLines[0] = containerLines[0].replace(/^      - /, '        ');

  const fields = [];
  for (let index = 0; index < containerLines.length; index += 1) {
    const match = containerLines[index].match(/^        ([A-Za-z0-9_-]+):\s*/);
    if (match) fields.push({ index, key: match[1] });
  }
  if (!fields.length) throw new Error('Aucun champ du conteneur Cloud Run détecté.');

  const kept = [];
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
    const field = fields[fieldIndex];
    const end = fields[fieldIndex + 1]?.index ?? containerLines.length;
    if (field.key === 'command' || field.key === 'args') continue;
    kept.push(...containerLines.slice(field.index, end));
  }
  if (!kept.length) throw new Error('Le conteneur Cloud Run serait vide après normalisation du lancement.');

  kept[0] = kept[0].replace(/^        /, '      - ');
  lines.splice(containerStart, containerEnd - containerStart, ...kept);
}

function forceSingleContainerEnv(lines, imageIndex, name, value) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const { containerStart, containerEnd } = getSingleContainerBounds(lines, imageIndex);

  const envIndex = lines.findIndex((line, index) => (
    index >= containerStart
    && index < containerEnd
    && /^(?:      - |        )env:\s*$/.test(line)
  ));

  if (envIndex >= 0) {
    let envEnd = containerEnd;
    for (let index = envIndex + 1; index < containerEnd; index += 1) {
      if (/^        [A-Za-z0-9_-]+:\s*/.test(lines[index])) {
        envEnd = index;
        break;
      }
    }

    const nameIndexes = [];
    for (let index = envIndex + 1; index < envEnd; index += 1) {
      if (new RegExp(`^        - name:\\s*['\"]?${escapedName}['\"]?\\s*$`).test(lines[index])) {
        nameIndexes.push(index);
      }
    }
    if (nameIndexes.length > 1) throw new Error(`Variable runtime ${name} dupliquée dans l'export Cloud Run.`);
    if (nameIndexes.length === 1) {
      const nameIndex = nameIndexes[0];
      const valueIndex = nameIndex + 1;
      if (!/^          value:\s*/.test(lines[valueIndex] || '')) {
        throw new Error(`Valeur runtime ${name} introuvable dans l'export Cloud Run.`);
      }
      lines[valueIndex] = `          value: ${value}`;
      return;
    }

    lines.splice(envIndex + 1, 0, `        - name: ${name}`, `          value: ${value}`);
    return;
  }

  if (/^      - image:\s*/.test(lines[imageIndex])) {
    lines[imageIndex] = lines[imageIndex].replace(/^      - image:/, '        image:');
    lines.splice(imageIndex, 0, '      - env:', `        - name: ${name}`, `          value: ${value}`);
    return;
  }

  if (/^        image:\s*/.test(lines[imageIndex])) {
    lines.splice(imageIndex, 0, '        env:', `        - name: ${name}`, `          value: ${value}`);
    return;
  }

  throw new Error(`Bloc env du conteneur introuvable pour forcer ${name}.`);
}

function normalizeTraffic(lines, trafficIndex, trafficEnd, previousRevision, candidateRevision, candidateTag) {
  const trafficLines = lines.slice(trafficIndex + 1, trafficEnd);
  const trafficText = trafficLines.join('\n');
  if (/latestRevision:\s*true/.test(trafficText)) {
    throw new Error('Le trafic exporté vise latestRevision=true; la candidate ne peut pas être créée sans risque.');
  }

  const entries = [];
  let current = null;
  for (const line of trafficLines) {
    if (/^  - /.test(line)) {
      if (current) entries.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    } else if (line.trim()) {
      throw new Error(`Bloc traffic Cloud Run inattendu: ${line.trim()}`);
    }
  }
  if (current) entries.push(current);
  if (!entries.length) throw new Error('Aucune cible de trafic Cloud Run exportée.');

  const parsed = entries.map(entryLines => {
    const entryText = entryLines.join('\n');
    const percentMatch = entryText.match(/(?:^|\n)\s*(?:-\s*)?percent:\s*(\d+)(?:\s|$)/);
    const revisionMatch = entryText.match(/(?:^|\n)\s*(?:-\s*)?revisionName:\s*([^\s]+)(?:\s|$)/);
    const tagMatch = entryText.match(/(?:^|\n)\s*(?:-\s*)?tag:\s*([^\s]+)(?:\s|$)/);
    const revisionName = revisionMatch?.[1] || '';
    const tag = tagMatch?.[1] || '';
    if (!percentMatch && (!revisionName || !tag)) {
      throw new Error(`Cible de trafic sans pourcentage explicite: ${entryText.replace(/\s+/g, ' ').trim()}`);
    }
    return {
      percent: percentMatch ? Number(percentMatch[1]) : 0,
      revisionName,
      tag
    };
  });

  const active = parsed.filter(entry => entry.percent > 0);
  if (active.length !== 1 || active[0].percent !== 100 || active[0].revisionName !== previousRevision) {
    throw new Error(`Le trafic exporté n'est pas exclusivement fixé à ${previousRevision} à 100 %.`);
  }

  const normalized = [
    '  traffic:',
    '  - percent: 100',
    `    revisionName: ${previousRevision}`,
    '  - percent: 0',
    `    revisionName: ${candidateRevision}`,
    `    tag: ${candidateTag}`
  ];
  lines.splice(trafficIndex, trafficEnd - trafficIndex, ...normalized);
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

  let imageIndexes = [];
  lines.forEach((line, index) => {
    if (/^\s*(?:-\s*)?image:\s*\S+\s*$/.test(line)) imageIndexes.push(index);
  });
  if (imageIndexes.length !== 1) {
    throw new Error(`Configuration Cloud Run inattendue: ${imageIndexes.length} ligne(s) image détectée(s), 1 attendue.`);
  }

  normalizeSingleContainerLaunch(lines, imageIndexes[0]);
  imageIndexes = [];
  lines.forEach((line, index) => {
    if (/^\s*(?:-\s*)?image:\s*\S+\s*$/.test(line)) imageIndexes.push(index);
  });
  if (imageIndexes.length !== 1) throw new Error('Ligne image perdue pendant la normalisation du lancement.');

  forceSingleContainerEnv(lines, imageIndexes[0], 'NODE_ENV', 'production');
  const refreshedImageIndex = lines.findIndex(line => /^\s*(?:-\s*)?image:\s*\S+\s*$/.test(line));
  if (refreshedImageIndex < 0) throw new Error('Ligne image perdue pendant la préparation du runtime.');
  lines[refreshedImageIndex] = lines[refreshedImageIndex].replace(/^(\s*(?:-\s*)?image:\s*)\S+\s*$/, `$1${image}`);

  const trafficIndex = lines.findIndex(line => /^  traffic:\s*$/.test(line));
  if (trafficIndex < 0) throw new Error('Bloc spec.traffic introuvable: déploiement sans garantie de trafic refusé.');
  const trafficEndCandidate = lines.findIndex((line, index) => index > trafficIndex && /^  [A-Za-z0-9_-]+:\s*/.test(line));
  const trafficEnd = trafficEndCandidate < 0 ? lines.length : trafficEndCandidate;
  normalizeTraffic(lines, trafficIndex, trafficEnd, previousRevision, candidateRevision, candidateTag);

  const prepared = lines.join('\n');
  if (/run\.googleapis\.com\/(?:sources|base-images)/.test(prepared)) throw new Error('Une métadonnée source Cloud Run incompatible subsiste.');
  if (/runtimeClassName:\s*run\.googleapis\.com\/linux-base-image-update/.test(prepared)) throw new Error('Le runtimeClassName de mise à jour source subsiste.');
  if (!prepared.includes(`name: ${candidateRevision}`)) throw new Error('Le nom de révision candidate n’a pas été injecté.');
  if (!prepared.includes(image)) throw new Error('Le digest d’image candidate n’a pas été injecté.');
  if (!/name:\s*NODE_ENV\s*\n\s*value:\s*production/.test(prepared)) throw new Error('NODE_ENV=production n’a pas été forcé sur le runtime candidat.');
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
  console.log(`[CloudRunCandidate] Service préparé: ${args['previous-revision']} -> ${args['candidate-revision']} sur ${args.image}, entrypoint image conservé, NODE_ENV=production, trafic normalisé et cible 0 %=${deriveCandidateTag(args.service, args['candidate-revision'])}`);
}

module.exports = { deriveCandidateTag, forceSingleContainerEnv, getSingleContainerBounds, normalizeSingleContainerLaunch, normalizeTraffic, parseArgs, prepareCandidateService, validateRevisionName };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[CloudRunCandidate] ${error.message}`);
    process.exit(1);
  }
}
