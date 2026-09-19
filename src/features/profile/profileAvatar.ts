export function getProfileInitials(displayName?: string | null, email?: string | null): string {
  const normalizedName = displayName?.trim();
  if (normalizedName) {
    const parts = normalizedName.split(/\s+/).filter(Boolean);
    const selected = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
    const initials = selected
      .map(part => Array.from(part)[0] || '')
      .join('')
      .toLocaleUpperCase('fr-FR')
      .slice(0, 2);
    if (initials) return initials;
  }

  const emailLocalPart = email?.split('@')[0]?.trim();
  if (emailLocalPart) {
    return (Array.from(emailLocalPart)[0] || '?').toLocaleUpperCase('fr-FR');
  }

  return '?';
}
