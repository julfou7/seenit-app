sed -i '/migrateMovies();/a \
    async function migrateNetworks() {\
      const shows = await db.shows.where('\''mediaType'\'').equals('\''tv'\'').toArray();\
      const updates = shows.filter(s => s.detailsSyncedAt && !s.networks).map(s => ({ ...s, detailsSyncedAt: 0 }));\
      if (updates.length > 0) {\
        await db.shows.bulkPut(updates);\
      }\
    }\
    migrateNetworks();' src/App.tsx
