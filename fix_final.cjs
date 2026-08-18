const fs = require('fs');
let content = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

// Fix unclosed div from section-casting at the very end of the main content
// The main content ends with Similar Titles which is inside `<div className="p-4 min-h-[400px] pb-32">` wrapper.
// So I need to find the end of Similar Titles and add a `</div>` for section-casting.

const castingEndStr = `                  </div>
                )}
             </div>
          </div>
        )}`;
        
const castingEndReplace = `                  </div>
                )}
             </div>
          </div>
        )}
        </div>`; // close section-casting
        
content = content.replace(castingEndStr, castingEndReplace);

// Let's also fix the providers IIFE syntax completely
const providerIIFE = `{(() => {
                  const uniqueProviders = providers?.flatrate 
                    ? Array.from(new Map(providers.flatrate.map((p: any) => [p.provider_name.split(' ')[0], p])).values())
                    : [];
                  return uniqueProviders.map((provider: any) => (`;
                  
const providerMap = `{providers?.flatrate && Array.from(new Map(providers.flatrate.map((p: any) => [p.provider_name.split(' ')[0], p])).values()).map((provider: any) => (`;

content = content.replace(providerIIFE, providerMap);

// And fix its ending
content = content.replace(`                  )))})()}`, `                  ))}`);
content = content.replace(`                  ))})()}`, `                  ))}`);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', content);
