const { spawnSync } = require('node:child_process');
const { resolveNpmInvocation } = require('./validate-change.cjs');

const NATIVE_AUDIT_TIMEOUT_MS = 120_000;
// Ne jamais recopier les messages npm : ils peuvent contenir URL privée, identifiants ou jetons.
const AUDIT_ERRORS = {
  ETIMEDOUT: 'délai dépassé',
  ESOCKETTIMEDOUT: 'délai réseau dépassé',
  EAI_AGAIN: 'résolution DNS temporairement indisponible',
  ENOTFOUND: 'registre introuvable',
  ECONNRESET: 'connexion interrompue',
  ECONNREFUSED: 'connexion refusée',
  ENETUNREACH: 'réseau inaccessible',
  EHOSTUNREACH: 'hôte inaccessible',
  E401: 'authentification au registre refusée',
  E403: 'accès au registre refusé',
  E404: 'endpoint du registre introuvable',
  E429: 'limite du registre atteinte',
  E500: 'erreur interne du registre',
  E502: 'passerelle du registre indisponible',
  E503: 'registre temporairement indisponible',
  ENOAUDIT: 'audit non pris en charge par le registre',
  ENOENT: 'exécutable npm introuvable',
  EACCES: 'exécution npm refusée',
  ENOBUFS: 'sortie npm trop volumineuse',
};

function auditErrorDetail(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return Object.hasOwn(AUDIT_ERRORS, code)
    ? `${code} : ${AUDIT_ERRORS[code]}`
    : 'erreur npm non reconnue (détail externe masqué)';
}

function nativeAuditFindings(report) {
  if (report?.error) {
    throw new Error(`Rapport npm audit natif invalide — ${auditErrorDetail(report.error)}.`);
  }
  if (!report || report.error || !report.vulnerabilities || Array.isArray(report.vulnerabilities) || typeof report.vulnerabilities !== 'object') {
    throw new Error('Rapport npm audit natif absent ou invalide.');
  }
  return Object.values(report.vulnerabilities).filter(finding =>
    ['@capacitor/android', '@capacitor/ios'].includes(finding.name)
    && ['high', 'critical'].includes(finding.severity)
  );
}

function main(run = spawnSync) {
  const invocation = resolveNpmInvocation();
  const result = run(invocation.command, [...invocation.prefix, 'audit', '--json'], {
    encoding: 'utf8', maxBuffer: 5_000_000,
    timeout: NATIVE_AUDIT_TIMEOUT_MS, killSignal: 'SIGKILL',
  });
  if (result.error) {
    const timeout = result.error.code === 'ETIMEDOUT' ? ` après ${NATIVE_AUDIT_TIMEOUT_MS / 1000} s` : '';
    throw new Error(`npm audit natif indisponible${timeout} — ${auditErrorDetail(result.error)}.`);
  }
  let report;
  try { report = JSON.parse(result.stdout); } catch {
    throw new Error('Rapport npm audit natif invalide — JSON absent ou illisible.');
  }
  // Conserver le diagnostic structuré du registre, même si npm termine avec un code inhabituel.
  const findings = nativeAuditFindings(report);
  if (![0, 1].includes(result.status)) {
    const status = Number.isInteger(result.status) ? result.status : 'interrompu';
    throw new Error(`npm audit natif indisponible (code ${status}).`);
  }
  if (findings.length) {
    throw new Error(findings.map(finding => `${finding.name}: ${finding.severity}`).join(', '));
  }
  console.log('[Native Audit] Aucun avis high/critical sur le runtime natif embarqué.');
}

module.exports = { nativeAuditFindings, main, NATIVE_AUDIT_TIMEOUT_MS };
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[Native Audit] ${error.message}`);
    process.exitCode = 1;
  }
}
