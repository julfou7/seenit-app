const fs = require('fs');

function replaceOnce(content, before, after, label) {
  const index = content.indexOf(before);
  if (index < 0) throw new Error(`Motif introuvable: ${label}`);
  if (content.indexOf(before, index + before.length) >= 0) throw new Error(`Motif non unique: ${label}`);
  return content.slice(0, index) + after + content.slice(index + before.length);
}

const path = 'src/store/liveDownloadStore.ts';
let content = fs.readFileSync(path, 'utf8');

content = replaceOnce(
  content,
  `            const completed = isTerminalDownload(a) || isTerminalDownload(b);\n            const hasError = !completed && (a.status === 'error' || b.status === 'error' || Boolean(a.errorMessage) || Boolean(b.errorMessage));\n            const errorSource = a.status === 'error' || a.errorMessage ? a : b;\n            const progress = completed ? 100 : Math.max(Number(a.progress || 0), Number(b.progress || 0));\n            const liveWithBestProgress = Number(a.progress || 0) > Number(b.progress || 0) ? a : live;`,
  `            const cancelled = isCancelledDownload(a) || isCancelledDownload(b);\n            const cancelledSource = isCancelledDownload(a) ? a : b;\n            const completed = !cancelled && (\n              a.status === 'completed' || Number(a.progress || 0) >= 100\n              || b.status === 'completed' || Number(b.progress || 0) >= 100\n            );\n            const hasError = !cancelled && !completed && (a.status === 'error' || b.status === 'error' || Boolean(a.errorMessage) || Boolean(b.errorMessage));\n            const errorSource = a.status === 'error' || a.errorMessage ? a : b;\n            const progress = completed\n              ? 100\n              : cancelled\n                ? Number(cancelledSource.progress || 0)\n                : Math.max(Number(a.progress || 0), Number(b.progress || 0));\n            const liveWithBestProgress = Number(a.progress || 0) > Number(b.progress || 0) ? a : live;`,
  'merge cancelled state'
);

content = replaceOnce(
  content,
  `              sizeleft: completed ? 0 : liveWithBestProgress.sizeleft,\n              progress,\n              speedBytesPerSec: completed ? 0 : live.speedBytesPerSec,\n              speedFormatted: completed ? '' : live.speedFormatted,\n              timeleft: completed ? '' : live.timeleft,\n              timeleftSeconds: completed ? 0 : live.timeleftSeconds,\n              status: completed ? 'completed' : hasError ? errorSource.status : live.status,\n              statusText: completed ? 'Téléchargement terminé 🍿' : hasError ? errorSource.statusText : live.statusText,\n              errorMessage: completed ? undefined : hasError ? errorSource.errorMessage : undefined,`,
  `              sizeleft: completed ? 0 : cancelled ? cancelledSource.sizeleft : liveWithBestProgress.sizeleft,\n              progress,\n              speedBytesPerSec: completed || cancelled ? 0 : live.speedBytesPerSec,\n              speedFormatted: completed || cancelled ? '' : live.speedFormatted,\n              timeleft: completed || cancelled ? '' : live.timeleft,\n              timeleftSeconds: completed || cancelled ? 0 : live.timeleftSeconds,\n              status: cancelled ? 'cancelled' : completed ? 'completed' : hasError ? errorSource.status : live.status,\n              statusText: cancelled ? 'Téléchargement annulé' : completed ? 'Téléchargement terminé 🍿' : hasError ? errorSource.statusText : live.statusText,\n              errorMessage: cancelled || completed ? undefined : hasError ? errorSource.errorMessage : undefined,`,
  'merge cancelled telemetry'
);

content = replaceOnce(
  content,
  `            if (isTerminalDownload(oldItem)) {\n              preservedItems.push({\n                ...oldItem,\n                progress: 100,\n                status: 'completed',\n                statusText: 'Téléchargement terminé 🍿',\n                sizeleft: 0,\n                speedBytesPerSec: 0,\n                speedFormatted: '',\n                timeleft: '',\n                timeleftSeconds: 0,\n                isRestored: false\n              });\n              continue;\n            }`,
  `            if (isCancelledDownload(oldItem)) {\n              preservedItems.push({\n                ...oldItem,\n                status: 'cancelled',\n                statusText: 'Téléchargement annulé',\n                errorMessage: undefined,\n                speedBytesPerSec: 0,\n                speedFormatted: '',\n                timeleft: '',\n                timeleftSeconds: 0,\n                isRestored: false\n              });\n              continue;\n            }\n\n            if (isTerminalDownload(oldItem)) {\n              preservedItems.push({\n                ...oldItem,\n                progress: 100,\n                status: 'completed',\n                statusText: 'Téléchargement terminé 🍿',\n                sizeleft: 0,\n                speedBytesPerSec: 0,\n                speedFormatted: '',\n                timeleft: '',\n                timeleftSeconds: 0,\n                isRestored: false\n              });\n              continue;\n            }`,
  'preserve cancelled item'
);

content = replaceOnce(
  content,
  `          for (const finalItem of finalItems) {\n            if (!isTerminalDownload(finalItem)) continue;\n            const previous = currentDownloads.find(oldItem => sameDownloadIdentity(oldItem, finalItem));`,
  `          for (const finalItem of finalItems) {\n            if (isCancelledDownload(finalItem)) {\n              consumeCompletionNotificationEligibility(finalItem);\n              continue;\n            }\n            if (!isTerminalDownload(finalItem)) continue;\n            const previous = currentDownloads.find(oldItem => sameDownloadIdentity(oldItem, finalItem));`,
  'no completion notification on cancel'
);

content = replaceOnce(
  content,
  `          const hasActive = downloads.some(item =>\n            item.status !== 'completed' && item.status !== 'error' && item.progress < 100\n          );`,
  `          const hasActive = downloads.some(item =>\n            item.status !== 'completed'\n            && item.status !== 'cancelled'\n            && item.status !== 'error'\n            && item.progress < 100\n          );`,
  'cancelled not active polling'
);

fs.writeFileSync(path, content);
console.log('Persistance Annulé 1.4.60 corrigée.');
