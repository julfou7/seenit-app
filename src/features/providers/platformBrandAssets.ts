function svgData(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Visuels de marque stables utilisés sur toutes les surfaces SeenIt.
 * Ils reprennent les variantes compactes validées sur le téléphone propriétaire le 31/10/2026.
 */
export const PLATFORM_BRAND_ASSETS = {
  netflix: svgData('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="38" fill="#050505"/><path fill="#E50914" d="M69 43h31v170H69zM156 43h31v170h-31z"/><path fill="#B20710" d="M100 43h32l55 170h-31z"/><path fill="#E50914" d="M100 43h31l56 170h-31z"/></svg>'),
  canal: svgData('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b4b4b"/><stop offset="1" stop-color="#1b1b1b"/></linearGradient></defs><rect width="256" height="256" rx="34" fill="url(#g)"/><path fill="#fff" d="M111 48h34v63h63v34h-63v63h-34v-63H48v-34h63z"/></svg>'),
  hbo: svgData('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="34" fill="#0b0b0b"/><text x="128" y="159" text-anchor="middle" fill="#fff" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="82" letter-spacing="-7">HBO</text></svg>'),
  franceTv: svgData('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="34" fill="#111"/><circle cx="54" cy="132" r="22" fill="#ff5a4f"/><text x="82" y="157" fill="#ff6b57" font-family="Arial,sans-serif" font-weight="700" font-size="96">t</text><text x="130" y="157" fill="#46a9cf" font-family="Arial,sans-serif" font-weight="700" font-size="96">v</text><path d="M104 90h22" stroke="#ffbd4a" stroke-width="14" stroke-linecap="round"/></svg>'),
} as const;
