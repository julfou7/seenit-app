const { spawnSync } = require('node:child_process');
const { resolveNpmInvocation } = require('./validate-change.cjs');

function nativeAuditFindings(report) {
  if (!report || report.error || !report.vulnerabilities || Array.isArray(report.vulnerabilities) || typeof report.vulnerabilities !== 'object') {
    throw new Error('Rapport npm audit natif absent ou invalide.');
  }
  return Object.values(report.vulnerabilities).filter(finding =>
    ['@capacitor/android', '@capacitor/ios'].includes(finding.name)
    && ['high', 'critical'].includes(finding.severity)
  );
}

function main() {
  const invocation = resolveNpmInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix, 'audit', '--json'], {
    encoding: 'utf8', maxBuffer: 5_000_000,
  });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error(`npm audit natif indisponible (${result.status}).`);
  const findings = nativeAuditFindings(JSON.parse(result.stdout));
  if (findings.length) {
    throw new Error(findings.map(finding => `${finding.name}: ${finding.severity}`).join(', '));
  }
  console.log('[Native Audit] Aucun avis high/critical sur le runtime natif embarqué.');
}

module.exports = { nativeAuditFindings };
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[Native Audit] ${error.message}`);
    process.exitCode = 1;
  }
}
