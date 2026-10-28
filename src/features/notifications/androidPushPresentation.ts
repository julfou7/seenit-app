import { createHash } from 'node:crypto';

export function androidPushPresentation(uid: string, data: Record<string, string>) {
  const download = data.type === 'DOWNLOAD_EVENT' || data.notificationKind === 'download_failure';
  const identity = data.eventKey || data.requestId;
  return {
    icon: 'ic_stat_seenit',
    color: '#E5A93D',
    channelId: download ? 'seenit_downloads' : data.type === 'EPISODE_REMINDER' ? 'seenit_episodes' : 'seenit_app',
    ...(download && identity ? { tag: `seenit_download_${createHash('sha256').update(JSON.stringify([uid, identity])).digest('hex').slice(0, 32)}` } : {}),
  };
}
