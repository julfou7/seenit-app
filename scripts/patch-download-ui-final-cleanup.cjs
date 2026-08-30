const fs = require('node:fs');

function replaceExact(path, from, to) {
  const input = fs.readFileSync(path, 'utf8');
  if (!input.includes(from)) throw new Error(`Pattern introuvable dans ${path}: ${from}`);
  fs.writeFileSync(path, input.replace(from, to));
}

replaceExact(
  'src/screens/DownloadsScreen.tsx',
  "        showToast(result.message, 'success');",
  "        showToast('Téléchargement lancé.', 'success');"
);

replaceExact(
  'src/components/DownloadModal.tsx',
`        setActionMessage({ text: result.message, type: 'success' });
        if (onSuccessToast) onSuccessToast(result.message);
        else showToast(result.message, 'success');`,
`        const successMessage = 'Téléchargement lancé.';
        setActionMessage({ text: successMessage, type: 'success' });
        if (onSuccessToast) onSuccessToast(successMessage);
        else showToast(successMessage, 'success');`
);

replaceExact(
  'src/services/sonarrRadarr.ts',
  "          const qbitErrorMsg = isQbitError ? 'Erreur qBittorrent (espace disque insuffisant ou fichier manquant)' : undefined;",
  "          const qbitErrorMsg = isQbitError ? 'Erreur de téléchargement (espace disque insuffisant ou fichier manquant)' : undefined;"
);

console.log('Nettoyage UX final appliqué.');
