import { resolveCanalProviderTarget } from '../shows/canalProviderLink.ts';

export const getProviderDirectLink = (providerId: number, title: string, fallbackLink: string) => {
  const query = encodeURIComponent(title);
  switch (providerId) {
    case 8: return `https://www.netflix.com/search?q=${query}`;
    case 119: return `https://www.primevideo.com/search/ref=atv_sr_sug_1?phrase=${query}`;
    case 337: return `https://www.disneyplus.com/search?q=${query}`;
    case 381: return 'https://www.canalplus.com/';
    case 350: return `https://tv.apple.com/fr/search?q=${query}`;
    case 531: return `https://www.paramountplus.com/search/?q=${query}`;
    case 1899: return `https://www.max.com/search?q=${query}`;
    case 236: return `https://www.france.tv/recherche/?q=${query}`;
    case 234: return `https://www.arte.tv/fr/search/?q=${query}`;
    default: return fallbackLink || '#';
  }
};

export type ProviderLinkKind = 'provider-link' | 'provider-app-home';

export interface ProviderLinkPresentation {
  url: string | null;
  label: string;
  title: string;
  kind: ProviderLinkKind;
}

export const getProviderLinkPresentation = ({
  providerId,
  providerName,
  title,
  fallbackLink,
}: {
  providerId: number;
  providerName: string;
  title: string;
  fallbackLink: string;
}): ProviderLinkPresentation => {
  if (providerId === 381) {
    const canalTarget = resolveCanalProviderTarget();
    return {
      url: canalTarget.url,
      label: 'Canal',
      title: 'Ouvrir Canal',
      kind: canalTarget.kind,
    };
  }

  return {
    url: getProviderDirectLink(providerId, title, fallbackLink),
    label: providerName,
    title: `Ouvrir ${providerName}`,
    kind: 'provider-link',
  };
};
