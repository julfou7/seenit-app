#!/bin/bash

FILES="src/screens/WatchListScreen.tsx src/components/EpisodeCard.tsx src/components/HistoryFeed.tsx src/components/cards/UpcomingShowCard.tsx"

for file in $FILES; do
  sed -i 's/className="relative w-\[72px\] sm:w-\[84px\] shrink-0 bg-zinc-950 rounded-l-2xl overflow-hidden/className="w-\[76px\] sm:w-\[88px\] shrink-0 bg-zinc-950 rounded-l-2xl overflow-hidden flex items-center justify-center relative z-20/' "$file"
  sed -i 's/className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"/className="w-full h-auto block object-cover transition-transform duration-500 group-hover:scale-105"/' "$file"
done
