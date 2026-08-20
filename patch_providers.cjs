const fs = require('fs');
let code = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf-8');

const oldCode = `{providers === null && plexMediaInfo === null ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="h-8 w-28 bg-zinc-800/80 rounded-xl border border-white/5 animate-pulse" />
                  <div className="h-8 w-24 bg-zinc-800/80 rounded-xl border border-white/5 animate-pulse" />
                </div>
              ) : sortedProviders.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {sortedProviders.map((provider: any) => {
                    if (provider.isPlex) {
                      return (
                        <a
                          key="plex-provider-item"
                          href={provider.plexUrl || "https://app.plex.tv/desktop"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E5A93D]/40 bg-[#E5A93D]/10 text-[#E5A93D] hover:bg-[#E5A93D]/20 text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-[0_0_12px_rgba(229,169,61,0.2)]"
                          title={\`Disponible sur Plex : \${provider.serverName || 'Serveur'}\`}
                        >
                          <img 
                            src={PLEX_LOGO_SVG}
                            alt="Plex"
                            className="w-4 h-4 object-contain rounded shrink-0"
                          />
                          <span>Disponible sur Plex {provider.serverName ? \`(\${provider.serverName})\` : ''}</span>
                        </a>
                      );
                    }

                    const isSubscribed = userPlatforms.includes(provider.provider_id);
                    const directLink = getProviderDirectLink(provider.provider_id, title, watchLink);
                    const logo = getFormattedProviderLogo(provider.logo_path, provider.provider_name);

                    return (
                      <a
                        key={provider.provider_id}
                        href={directLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={\`inline-flex items-center gap-2 px-2 py-1.5 rounded-xl border transition-all active:scale-95 cursor-pointer \${
                          isSubscribed
                            ? 'bg-white/10 border-white/20 hover:bg-white/20'
                            : 'bg-zinc-800/50 border-white/5 hover:bg-zinc-700/50 opacity-70'
                        }\`}
                        title={\`Regarder sur \${provider.provider_name}\`}
                      >
                        <img 
                          src={logo}
                          alt={provider.provider_name}
                          className="w-5 h-5 rounded-md object-cover"
                        />
                        <span className="text-xs font-semibold text-white/90 truncate max-w-[120px]">
                          {provider.provider_name}
                        </span>
                      </a>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Aucune disponibilité connue.</p>
              )}`;

const newCode = `{providers === null ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="h-8 w-28 bg-zinc-800/80 rounded-xl border border-white/5 animate-pulse" />
                  <div className="h-8 w-24 bg-zinc-800/80 rounded-xl border border-white/5 animate-pulse" />
                </div>
              ) : sortedProviders.length > 0 || plexMediaInfo === null ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {sortedProviders.map((provider: any) => {
                    if (provider.isPlex) {
                      return (
                        <a
                          key="plex-provider-item"
                          href={provider.plexUrl || "https://app.plex.tv/desktop"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E5A93D]/40 bg-[#E5A93D]/10 text-[#E5A93D] hover:bg-[#E5A93D]/20 text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-[0_0_12px_rgba(229,169,61,0.2)]"
                          title={\`Disponible sur Plex : \${provider.serverName || 'Serveur'}\`}
                        >
                          <img 
                            src={PLEX_LOGO_SVG}
                            alt="Plex"
                            className="w-4 h-4 object-contain rounded shrink-0"
                          />
                          <span>Disponible sur Plex {provider.serverName ? \`(\${provider.serverName})\` : ''}</span>
                        </a>
                      );
                    }

                    const isSubscribed = userPlatforms.includes(provider.provider_id);
                    const directLink = getProviderDirectLink(provider.provider_id, title, watchLink);
                    const logo = getFormattedProviderLogo(provider.logo_path, provider.provider_name);

                    return (
                      <a
                        key={provider.provider_id}
                        href={directLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={\`inline-flex items-center gap-2 px-2 py-1.5 rounded-xl border transition-all active:scale-95 cursor-pointer \${
                          isSubscribed
                            ? 'bg-white/10 border-white/20 hover:bg-white/20'
                            : 'bg-zinc-800/50 border-white/5 hover:bg-zinc-700/50 opacity-70'
                        }\`}
                        title={\`Regarder sur \${provider.provider_name}\`}
                      >
                        <img 
                          src={logo}
                          alt={provider.provider_name}
                          className="w-5 h-5 rounded-md object-cover"
                        />
                        <span className="text-xs font-semibold text-white/90 truncate max-w-[120px]">
                          {provider.provider_name}
                        </span>
                      </a>
                    );
                  })}
                  
                  {plexMediaInfo === null && (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/5 bg-zinc-800/30 animate-pulse text-xs font-bold text-zinc-500 cursor-wait">
                      <img src={PLEX_LOGO_SVG} className="w-4 h-4 opacity-40 grayscale" alt="Plex" />
                      <span>Recherche Plex...</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Aucune disponibilité connue.</p>
              )}`;

if (code.includes('providers === null && plexMediaInfo === null')) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('src/screens/ShowDetailScreen.tsx', code);
  console.log('Successfully patched providers UI');
} else {
  console.log('Could not find target code snippet');
}
