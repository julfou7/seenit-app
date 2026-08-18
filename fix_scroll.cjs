const fs = require('fs');
let c = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

c = c.replace(/onClick=\{\(\) => document\.getElementById\('section-about'\)\?\.scrollIntoView\(\{ behavior: 'smooth' \}\)\}/g, 
  `onClick={() => {\n            const el = document.getElementById('section-about');\n            if (el && mainScrollRef.current) {\n              mainScrollRef.current.scrollTo({ top: el.offsetTop - 150, behavior: 'smooth' });\n            }\n          }}`);

c = c.replace(/onClick=\{\(\) => document\.getElementById\('section-episodes'\)\?\.scrollIntoView\(\{ behavior: 'smooth' \}\)\}/g, 
  `onClick={() => {\n            const el = document.getElementById('section-episodes');\n            if (el && mainScrollRef.current) {\n              mainScrollRef.current.scrollTo({ top: el.offsetTop - 150, behavior: 'smooth' });\n            }\n          }}`);

c = c.replace(/onClick=\{\(\) => document\.getElementById\('section-casting'\)\?\.scrollIntoView\(\{ behavior: 'smooth' \}\)\}/g, 
  `onClick={() => {\n            const el = document.getElementById('section-casting');\n            if (el && mainScrollRef.current) {\n              mainScrollRef.current.scrollTo({ top: el.offsetTop - 150, behavior: 'smooth' });\n            }\n          }}`);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', c);
