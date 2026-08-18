const fs = require('fs');

function updateFile(file, replacer) {
  let content = fs.readFileSync(file, 'utf8');
  content = replacer(content);
  fs.writeFileSync(file, content);
}

// 1. useNavigation.ts
updateFile('src/features/navigation/useNavigation.ts', (c) => {
  let text = c.replace(
    /const \[selectedShow, setSelectedShow\] = useState<\{ id: any, type: 'local' \| 'tmdb' \} \| null>\(null\);/,
    `const [selectedShow, setSelectedShow] = useState<{ id: any, type: 'local' | 'tmdb', mediaType?: 'tv' | 'movie' } | null>(null);`
  );
  text = text.replace(
    /const openShow = useCallback\(\(id: any, type: 'local' \| 'tmdb' = 'local'\) => \{/,
    `const openShow = useCallback((id: any, type: 'local' | 'tmdb' = 'local', mediaType?: 'tv' | 'movie') => {`
  );
  text = text.replace(
    /const showState = \{ id, type \};/,
    `const showState = { id, type, mediaType };`
  );
  return text;
});

// 2. App.tsx
updateFile('src/App.tsx', (c) => {
  let text = c.replace(
    /onShowClick=\{id => openShow\(id, 'tmdb'\)\}/g,
    `onShowClick={(id, mediaType) => openShow(id, 'tmdb', mediaType)}`
  );
  text = text.replace(
    /onShowClick=\{id => openShow\(id, 'local'\)\}/g,
    `onShowClick={(id, mediaType) => openShow(id, 'local', mediaType)}`
  );
  text = text.replace(
    /<ShowDetailScreen \n              showId=\{selectedShow\.type === 'local' \? selectedShow\.id : undefined\}\n              tmdbId=\{selectedShow\.type === 'tmdb' \? selectedShow\.id : undefined\}/,
    `<ShowDetailScreen \n              showId={selectedShow.type === 'local' ? selectedShow.id : undefined}\n              tmdbId={selectedShow.type === 'tmdb' ? selectedShow.id : undefined}\n              mediaType={selectedShow.mediaType}`
  );
  return text;
});
