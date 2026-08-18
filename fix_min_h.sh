#!/bin/bash

FILES="src/screens/WatchListScreen.tsx src/components/EpisodeCard.tsx src/components/HistoryFeed.tsx src/components/cards/UpcomingShowCard.tsx"

for file in $FILES; do
  sed -i 's/className="w-\[76px\] sm:w-\[88px\] shrink-0 bg-zinc-950 rounded-l-2xl/className="w-\[76px\] sm:w-\[88px\] min-h-[114px] sm:min-h-[132px] shrink-0 bg-zinc-950 rounded-l-2xl/' "$file"
done
