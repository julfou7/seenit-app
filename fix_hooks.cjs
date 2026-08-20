const fs = require('fs');
let code = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf-8');

const sortedProvidersCode = `  const sortedProviders = useMemo(() => {
    const list: any[] = [...uniqueProviders];
    if (plexMediaInfo?.available) {
      list.push({
        provider_id: 999999,
        provider_name: plexMediaInfo.serverName ? \`Plex (\${plexMediaInfo.serverName})\` : 'Plex',
        logo_path: 'PLEX_CUSTOM_SVG',
        isPlex: true,
        serverName: plexMediaInfo.serverName,
        plexUrl: plexMediaInfo.plexUrl || 'https://app.plex.tv/desktop'
      });
    }
    return list.sort((a: any, b: any) => {
      // Les diffuseurs officiels restent prioritaires
      if (a.isPlex && !b.isPlex) return 1;
      if (!a.isPlex && b.isPlex) return -1;

      const aHas = userPlatforms.includes(a.provider_id);
      const bHas = userPlatforms.includes(b.provider_id);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });
  }, [uniqueProviders, plexMediaInfo, userPlatforms]);`;

// Remove the existing sortedProviders block
code = code.replace(sortedProvidersCode, "");

// Add it after uniqueProviders
const uniqueProvidersEnd = "  }, [providers]);\n";
code = code.replace(uniqueProvidersEnd, uniqueProvidersEnd + "\n" + sortedProvidersCode + "\n");

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', code);
console.log('Fixed hooks issue');
