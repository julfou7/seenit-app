export function getFormattedProviderLogo(logoPath?: string | null, name?: string | null): string | null {
  if (!logoPath && !name) return null;

  const lowerName = (name || '').toLowerCase();
  const lowerPath = (logoPath || '').toLowerCase();

  // HBO / HBO Max detection only (User requested: "je voulais que corriger HBO !")
  if (
    lowerName === 'hbo' ||
    lowerName.includes('hbo max') ||
    lowerName.startsWith('hbo ') ||
    lowerPath.includes('2me1s9339')
  ) {
    // HBO Square Logo (Black square with bold white HBO)
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%23000000"/><text x="50" y="63" font-family="Arial, sans-serif" font-weight="900" font-size="34" fill="%23FFFFFF" text-anchor="middle" letter-spacing="-1">HBO</text><circle cx="68.5" cy="52.8" r="4.8" fill="%23000000"/></svg>`;
  }

  // Default TMDB image URL for all other providers (Canal+, Max, Netflix, Disney+, etc.)
  if (logoPath) {
    return logoPath.startsWith('http') ? logoPath : `https://image.tmdb.org/t/p/w92${logoPath}`;
  }

  return null;
}
