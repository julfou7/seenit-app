#!/usr/bin/env node
/**
 * Audit des dépendances de production (`npm audit --omit=dev`), seuil high. Décision du propriétaire du 17/11/2026
 * (`USR-2026-11-17-002`) : un avis sans version corrigée peut être accepté temporairement, nommé, motivé et daté dans
 * `scripts/accepted-advisories.json`. Une acceptation expirée ou un autre avis high/critical bloque toujours.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BLOCKING = new Set(['high', 'critical']);
const advisoryId = advisory => /GHSA-[a-z0-9-]+/i.exec(String(advisory.url || ''))?.[0]?.toUpperCase() || String(advisory.source || advisory.title || '');

/** Avis high/critical d'un rapport `npm audit --json`, dédupliqués par identifiant GHSA. */
function blockingAdvisories(report) {
  if (!report || report.error || !report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    throw new Error('Rapport npm audit absent ou invalide.');
  }
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via || []) {
      if (!via || typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via);
      if (!found.has(id)) found.set(id, { id, package: via.name || vulnerability.name, severity: via.severity, title: via.title || '', url: via.url || '' });
    }
  }
  return [...found.values()];
}

/** Avis encore bloquants une fois les acceptations valides (non expirées, même paquet) retirées. */
function unacceptedAdvisories(advisories, accepted, today = new Date().toISOString().slice(0, 10)) {
  return advisories.filter(advisory => !accepted.some(entry =>
    String(entry.id).toUpperCase() === advisory.id && entry.package === advisory.package && today <= entry.expiresOn));
}

function main() {
  const accepted = JSON.parse(fs.readFileSync(path.join(__dirname, 'accepted-advisories.json'), 'utf8'));
  const { resolveNpmInvocation } = require('./validate-change.cjs');
  const invocation = resolveNpmInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix, 'audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 20_000_000 });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error(`npm audit indisponible (${result.status}).`);
  const advisories = blockingAdvisories(JSON.parse(result.stdout));
  const blocking = unacceptedAdvisories(advisories, accepted);
  for (const advisory of advisories.filter(item => !blocking.includes(item))) {
    const entry = accepted.find(item => String(item.id).toUpperCase() === advisory.id);
    console.log(`[Audit production] ⚠️ ${advisory.id} (${advisory.package}, ${advisory.severity}) accepté jusqu'au ${entry.expiresOn} : ${entry.decision}.`);
  }
  if (blocking.length) {
    throw new Error(blocking.map(item => `${item.id} ${item.package} (${item.severity}) ${item.title}`).join(' ; '));
  }
  console.log('[Audit production] ✅ Aucun avis high/critical non accepté.');
}

module.exports = { blockingAdvisories, unacceptedAdvisories };
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[Audit production] ❌ ${error.message}`);
    process.exitCode = 1;
  }
}
