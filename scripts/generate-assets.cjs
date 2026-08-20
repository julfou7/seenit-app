const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 1. Adaptive Foreground SVG (108x108 viewBox, centered in safe-zone)
// Drawing: TV + Stand (X span: 14 to 86 -> center 50, Y span: 17 to 79 -> center 48)
// Scale: 0.70 => Scaled X center: 35.0, Scaled Y center: 33.6
// Canvas center: (54, 54) => tx = 54 - 35 = 19.0, ty = 54 - 33.6 = 20.4
const foregroundSvg = `
<svg width="432" height="432" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fg-gold-grad" x1="10%" y1="10%" x2="90%" y2="90%">
      <stop offset="0%" stop-color="#FFF2B8" />
      <stop offset="30%" stop-color="#F5C518" />
      <stop offset="70%" stop-color="#E5A93D" />
      <stop offset="100%" stop-color="#B37812" />
    </linearGradient>
    <linearGradient id="fg-check-grad" x1="15%" y1="15%" x2="85%" y2="85%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="25%" stop-color="#FFEAA0" />
      <stop offset="65%" stop-color="#F5C518" />
      <stop offset="100%" stop-color="#D98A11" />
    </linearGradient>
    <linearGradient id="fg-glass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.28" />
      <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.05" />
      <stop offset="70%" stop-color="#000000" stop-opacity="0" />
    </linearGradient>
  </defs>

  <g transform="translate(19, 20.4) scale(0.70)">
    <circle cx="50" cy="43" r="22" fill="#E5A93D" opacity="0.35" />
    <rect x="14" y="17" width="72" height="52" rx="10" fill="#0B0B0F" stroke="url(#fg-gold-grad)" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 16 26 L 68 18 L 16 60 Z" fill="url(#fg-glass-grad)" />
    <!-- SeenIt Official Verification Checkmark Symbol -->
    <path d="M 38 44 L 46 52 L 62 34" fill="none" stroke="url(#fg-check-grad)" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 50 69 L 50 78.5" stroke="url(#fg-gold-grad)" stroke-width="4.2" stroke-linecap="round" />
    <path d="M 32 79 C 32 79 41 78 50 78 C 59 78 68 79 68 79" stroke="url(#fg-gold-grad)" stroke-width="4.2" stroke-linecap="round" />
  </g>
</svg>
`;

// 2. Full Square / Rounded Icon SVG (512x512)
// Drawing: TV + Stand (X center: 50, Y center: 48)
// Scale: 4.0 => Scaled X center: 200, Scaled Y center: 192
// Canvas center: (256, 256) => tx = 256 - 200 = 56, ty = 256 - 192 = 64
const fullIconSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sq-bg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#18181D" />
      <stop offset="50%" stop-color="#101014" />
      <stop offset="100%" stop-color="#040406" />
    </linearGradient>
    <linearGradient id="sq-gold-grad" x1="10%" y1="10%" x2="90%" y2="90%">
      <stop offset="0%" stop-color="#FFF2B8" />
      <stop offset="30%" stop-color="#F5C518" />
      <stop offset="70%" stop-color="#E5A93D" />
      <stop offset="100%" stop-color="#B37812" />
    </linearGradient>
    <linearGradient id="sq-check-grad" x1="15%" y1="15%" x2="85%" y2="85%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="25%" stop-color="#FFEAA0" />
      <stop offset="65%" stop-color="#F5C518" />
      <stop offset="100%" stop-color="#D98A11" />
    </linearGradient>
    <linearGradient id="sq-glass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.25" />
      <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.05" />
      <stop offset="70%" stop-color="#000000" stop-opacity="0" />
    </linearGradient>
    <radialGradient id="sq-ambient-glow" cx="50%" cy="48%" r="50%">
      <stop offset="0%" stop-color="#E5A93D" stop-opacity="0.25" />
      <stop offset="100%" stop-color="#E5A93D" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="512" height="512" fill="url(#sq-bg-grad)" />
  <rect width="512" height="512" fill="url(#sq-ambient-glow)" />

  <g transform="translate(56, 64) scale(4.0)">
    <circle cx="50" cy="43" r="22" fill="#E5A93D" opacity="0.35" />
    <rect x="14" y="17" width="72" height="52" rx="10" fill="#0B0B0F" stroke="url(#sq-gold-grad)" stroke-width="4.0" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 16 26 L 68 18 L 16 60 Z" fill="url(#sq-glass-grad)" />
    <!-- SeenIt Official Verification Checkmark Symbol -->
    <path d="M 38 44 L 46 52 L 62 34" fill="none" stroke="url(#sq-check-grad)" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 50 69 L 50 78.5" stroke="url(#sq-gold-grad)" stroke-width="4.0" stroke-linecap="round" />
    <path d="M 32 79 C 32 79 41 78 50 78 C 59 78 68 79 68 79" stroke="url(#sq-gold-grad)" stroke-width="4.0" stroke-linecap="round" />
  </g>
</svg>
`;

// 3. Round Icon SVG (512x512 Circle)
const roundIconSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="circle-clip">
      <circle cx="256" cy="256" r="256" />
    </clipPath>
    <linearGradient id="rd-bg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#18181D" />
      <stop offset="50%" stop-color="#101014" />
      <stop offset="100%" stop-color="#040406" />
    </linearGradient>
    <linearGradient id="rd-gold-grad" x1="10%" y1="10%" x2="90%" y2="90%">
      <stop offset="0%" stop-color="#FFF2B8" />
      <stop offset="30%" stop-color="#F5C518" />
      <stop offset="70%" stop-color="#E5A93D" />
      <stop offset="100%" stop-color="#B37812" />
    </linearGradient>
    <linearGradient id="rd-check-grad" x1="15%" y1="15%" x2="85%" y2="85%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="25%" stop-color="#FFEAA0" />
      <stop offset="65%" stop-color="#F5C518" />
      <stop offset="100%" stop-color="#D98A11" />
    </linearGradient>
    <linearGradient id="rd-glass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.25" />
      <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.05" />
      <stop offset="70%" stop-color="#000000" stop-opacity="0" />
    </linearGradient>
    <radialGradient id="rd-ambient-glow" cx="50%" cy="48%" r="50%">
      <stop offset="0%" stop-color="#E5A93D" stop-opacity="0.25" />
      <stop offset="100%" stop-color="#E5A93D" stop-opacity="0" />
    </radialGradient>
  </defs>

  <g clip-path="url(#circle-clip)">
    <rect width="512" height="512" fill="url(#rd-bg-grad)" />
    <rect width="512" height="512" fill="url(#rd-ambient-glow)" />

    <g transform="translate(56, 64) scale(4.0)">
      <circle cx="50" cy="43" r="22" fill="#E5A93D" opacity="0.35" />
      <rect x="14" y="17" width="72" height="52" rx="10" fill="#0B0B0F" stroke="url(#rd-gold-grad)" stroke-width="4.0" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 16 26 L 68 18 L 16 60 Z" fill="url(#rd-glass-grad)" />
      <!-- SeenIt Official Verification Checkmark Symbol -->
      <path d="M 38 44 L 46 52 L 62 34" fill="none" stroke="url(#rd-check-grad)" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 50 69 L 50 78.5" stroke="url(#rd-gold-grad)" stroke-width="4.0" stroke-linecap="round" />
      <path d="M 32 79 C 32 79 41 78 50 78 C 59 78 68 79 68 79" stroke="url(#rd-gold-grad)" stroke-width="4.0" stroke-linecap="round" />
    </g>
  </g>
</svg>
`;

// 4. Background Solid SVG
const bgSolidSvg = `
<svg width="432" height="432" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="108" height="108" fill="#040406" />
</svg>
`;

async function generateAll() {
  console.log('Generating Android & Web assets...');

  const mipmapDensities = [
    { folder: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
    { folder: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
    { folder: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
    { folder: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
    { folder: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 },
  ];

  for (const d of mipmapDensities) {
    const dir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', d.folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // ic_launcher_foreground.png
    await sharp(Buffer.from(foregroundSvg))
      .resize(d.fgSize, d.fgSize)
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    // ic_launcher.png (Square / legacy)
    await sharp(Buffer.from(fullIconSvg))
      .resize(d.iconSize, d.iconSize)
      .png()
      .toFile(path.join(dir, 'ic_launcher.png'));

    // ic_launcher_round.png (Circular)
    await sharp(Buffer.from(roundIconSvg))
      .resize(d.iconSize, d.iconSize)
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    // ic_launcher_background.png
    await sharp(Buffer.from(bgSolidSvg))
      .resize(d.fgSize, d.fgSize)
      .png()
      .toFile(path.join(dir, 'ic_launcher_background.png'));

    console.log(`Generated mipmaps for ${d.folder}`);
  }

  // Generate Web Assets in public/
  const publicDir = path.join(__dirname, '..', 'public');
  await sharp(Buffer.from(fullIconSvg)).resize(512, 512).png().toFile(path.join(publicDir, 'icon-512.png'));
  await sharp(Buffer.from(fullIconSvg)).resize(512, 512).png().toFile(path.join(publicDir, 'icon-maskable-512.png'));
  await sharp(Buffer.from(fullIconSvg)).resize(192, 192).png().toFile(path.join(publicDir, 'icon-192.png'));
  await sharp(Buffer.from(fullIconSvg)).resize(192, 192).png().toFile(path.join(publicDir, 'icon-maskable-192.png'));
  await sharp(Buffer.from(fullIconSvg)).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
  await sharp(Buffer.from(fullIconSvg)).resize(64, 64).png().toFile(path.join(publicDir, 'favicon.png'));
  await sharp(Buffer.from(fullIconSvg)).resize(512, 512).png().toFile(path.join(publicDir, 'logo.png'));

  // Generate splash image in android/app/src/main/res/drawable/splash.png
  const drawableDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'drawable');
  if (!fs.existsSync(drawableDir)) fs.mkdirSync(drawableDir, { recursive: true });
  await sharp(Buffer.from(fullIconSvg)).resize(480, 480).png().toFile(path.join(drawableDir, 'splash.png'));

  console.log('All assets generated successfully!');
}

generateAll().catch(console.error);

