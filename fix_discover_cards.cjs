const fs = require('fs');
let c = fs.readFileSync('src/screens/DiscoverScreen.tsx', 'utf8');

// Update card props
c = c.replace(
  /function HeroCard\(\{ media, details, onShowClick, rank \}: \{ key\?: React\.Key, media: TMDBMedia, details\?: any, onShowClick: \(id: any, mediaType\?: 'tv' \| 'movie'\) => void, rank: number \}\) \{/,
  `function HeroCard({ media, details, onShowClick, rank, activeCategory }: { key?: React.Key, media: TMDBMedia, details?: any, onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void, rank: number, activeCategory?: string }) {`
);

c = c.replace(
  /function HorizontalBackdropCard\(\{ media, onShowClick, rank \}: \{ key\?: React\.Key, media: TMDBMedia, onShowClick: \(id: any, mediaType\?: 'tv' \| 'movie'\) => void, rank: number \}\) \{/,
  `function HorizontalBackdropCard({ media, onShowClick, rank, activeCategory }: { key?: React.Key, media: TMDBMedia, onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void, rank: number, activeCategory?: string }) {`
);

c = c.replace(
  /function HorizontalPosterCard\(\{ media, onShowClick \}: \{ key\?: React\.Key, media: TMDBMedia, onShowClick: \(id: any, mediaType\?: 'tv' \| 'movie'\) => void \}\) \{/,
  `function HorizontalPosterCard({ media, onShowClick, activeCategory }: { key?: React.Key, media: TMDBMedia, onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void, activeCategory?: string }) {`
);

c = c.replace(
  /function SearchMediaCard\(\{ media, onShowClick \}: \{ key\?: React\.Key, media: TMDBMedia, onShowClick: \(id: any, mediaType\?: 'tv' \| 'movie'\) => void \}\) \{/,
  `function SearchMediaCard({ media, onShowClick, activeCategory }: { key?: React.Key, media: TMDBMedia, onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void, activeCategory?: string }) {`
);

// Update activeCategory usage in cards
c = c.replace(/media\.media_type as 'tv' \| 'movie'/g, `media.media_type as 'tv' | 'movie' || (activeCategory === 'Films' ? 'movie' : 'tv')`);

// Update usages inside DiscoverScreen to pass activeCategory
c = c.replace(/<SearchMediaCard key=\{item\.id\} media=\{item\} onShowClick=\{onShowClick\} \/>/g, `<SearchMediaCard key={item.id} media={item} onShowClick={onShowClick} activeCategory={activeCategory} />`);
c = c.replace(/<HeroCard key=\{item\.id\} media=\{item\} details=\{heroDetails\[item\.id\]\} rank=\{idx \+ 1\} onShowClick=\{onShowClick\} \/>/g, `<HeroCard key={item.id} media={item} details={heroDetails[item.id]} rank={idx + 1} onShowClick={onShowClick} activeCategory={activeCategory} />`);
c = c.replace(/<HorizontalBackdropCard key=\{item\.id\} media=\{item\} rank=\{idx \+ 1\} onShowClick=\{onShowClick\} \/>/g, `<HorizontalBackdropCard key={item.id} media={item} rank={idx + 1} onShowClick={onShowClick} activeCategory={activeCategory} />`);
c = c.replace(/<HorizontalPosterCard key=\{item\.id\} media=\{item\} onShowClick=\{onShowClick\} \/>/g, `<HorizontalPosterCard key={item.id} media={item} onShowClick={onShowClick} activeCategory={activeCategory} />`);

fs.writeFileSync('src/screens/DiscoverScreen.tsx', c);
