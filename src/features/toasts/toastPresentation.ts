export function isDownloadToastPresentation(
  type: string,
  ...texts: Array<string | undefined | null>
): boolean {
  if (type === 'download') return true;
  return texts.some((text) => typeof text === 'string' && /téléchargement/i.test(text));
}
