const fs = require('fs');
const file = 'src/lib/utils.ts';
let content = fs.readFileSync(file, 'utf8');

const replacement = `
  if (Capacitor.isNativePlatform()) {
    // 1. Gestion Plex : Deep Link Universel via AppLauncher / Browser au lieu de location.href
    if ((targetUrl.includes('plex.tv') || targetUrl.startsWith('plex://')) && !targetUrl.includes('/auth')) {
      appLogger.info('plex', \`[Plex DeepLink] Redirection via intent système : \${targetUrl}\`);
      try {
        const res = await AppLauncher.openUrl({ url: targetUrl });
        if (res && res.completed) return;
      } catch (err) {
        // Fallback
      }
      try {
        await Browser.open({ url: targetUrl, windowName: '_system' });
        return;
      } catch (e) {
        window.location.href = targetUrl;
      }
      return;
    }
`;

content = content.replace(
  /\n  if \(Capacitor\.isNativePlatform\(\)\) \{\n    \/\/ 1\. Gestion Plex.*?return;\n    \}/s,
  replacement
);

fs.writeFileSync(file, content);
