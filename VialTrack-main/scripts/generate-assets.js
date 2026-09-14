import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. SecondMedic Circular Speech Bubble Icon with ECG Wave (Vector SVG)
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="smGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00A3E0" />
      <stop offset="60%" stop-color="#0084D1" />
      <stop offset="100%" stop-color="#026AA7" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#0084D1" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Speech bubble body with talk pointer tail -->
  <path d="M 60 10 
           C 87.6 10 110 32.4 110 60 
           C 110 87.6 87.6 110 60 110 
           C 49.5 110 39.8 106.8 31.7 101.3 
           L 15 106 
           L 20.2 89.8 
           C 13.8 81.3 10 71.1 10 60 
           C 10 32.4 32.4 10 60 10 Z" 
        fill="url(#smGrad)" 
        filter="url(#glow)" />

  <!-- Smooth ECG / Pulse Line inside speech bubble -->
  <path d="M 24 60 
           L 42 60 
           L 48 48 
           L 54 74 
           L 62 30 
           L 70 86 
           L 77 54 
           L 83 65 
           L 89 60 
           L 96 60" 
        fill="none" 
        stroke="#FFFFFF" 
        stroke-width="5.5" 
        stroke-linecap="round" 
        stroke-linejoin="round" />

  <!-- Dynamic Pulse Node Point -->
  <circle cx="62" cy="30" r="3.5" fill="#38BDF8" />
  <circle cx="96" cy="60" r="3.5" fill="#38BDF8" />
</svg>`;

// 2. Full Horizontal SecondMedic Logo (Dark text for light backgrounds)
const fullLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 120" width="520" height="120">
  <defs>
    <linearGradient id="smGradFull" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00A3E0" />
      <stop offset="60%" stop-color="#0084D1" />
      <stop offset="100%" stop-color="#026AA7" />
    </linearGradient>
    <filter id="glowFull" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0084D1" flood-opacity="0.25" />
    </filter>
  </defs>

  <!-- Speech bubble Icon -->
  <g transform="translate(8, 6)">
    <path d="M 54 9 
             C 79 9 99 29 99 54 
             C 99 79 79 99 54 99 
             C 44.5 99 35.8 96.1 28.5 91.2 
             L 13.5 95.4 
             L 18.2 80.8 
             C 12.4 73.2 9 64 9 54 
             C 9 29 29 9 54 9 Z" 
          fill="url(#smGradFull)" 
          filter="url(#glowFull)" />

    <!-- ECG Line -->
    <path d="M 22 54 
             L 38 54 
             L 43 43 
             L 49 67 
             L 56 27 
             L 63 77 
             L 70 48 
             L 75 58 
             L 80 54 
             L 86 54" 
          fill="none" 
          stroke="#FFFFFF" 
          stroke-width="5" 
          stroke-linecap="round" 
          stroke-linejoin="round" />
    <circle cx="56" cy="27" r="3" fill="#38BDF8" />
  </g>

  <!-- SecondMedic Typography -->
  <g transform="translate(126, 40)">
    <text font-family="'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="46" font-weight="800" letter-spacing="-1.2">
      <tspan x="0" y="30" fill="#0F172A">Second</tspan>
      <tspan fill="#0084D1">Medic</tspan>
    </text>
    <text x="3" y="56" font-family="'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" letter-spacing="1.8" fill="#64748B" text-transform="uppercase">
      VialTrack • Diagnostic Logistics
    </text>
  </g>
</svg>`;

// 3. Full Horizontal SecondMedic Logo White (For dark backgrounds)
const fullLogoWhiteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 120" width="520" height="120">
  <defs>
    <linearGradient id="smGradWhite" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="60%" stop-color="#00A3E0" />
      <stop offset="100%" stop-color="#0084D1" />
    </linearGradient>
  </defs>

  <!-- Speech bubble Icon -->
  <g transform="translate(8, 6)">
    <path d="M 54 9 
             C 79 9 99 29 99 54 
             C 99 79 79 99 54 99 
             C 44.5 99 35.8 96.1 28.5 91.2 
             L 13.5 95.4 
             L 18.2 80.8 
             C 12.4 73.2 9 64 9 54 
             C 9 29 29 9 54 9 Z" 
          fill="url(#smGradWhite)" />

    <!-- ECG Line -->
    <path d="M 22 54 
             L 38 54 
             L 43 43 
             L 49 67 
             L 56 27 
             L 63 77 
             L 70 48 
             L 75 58 
             L 80 54 
             L 86 54" 
          fill="none" 
          stroke="#FFFFFF" 
          stroke-width="5" 
          stroke-linecap="round" 
          stroke-linejoin="round" />
    <circle cx="56" cy="27" r="3" fill="#FFFFFF" />
  </g>

  <!-- SecondMedic Typography -->
  <g transform="translate(126, 40)">
    <text font-family="'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="46" font-weight="800" letter-spacing="-1.2">
      <tspan x="0" y="30" fill="#FFFFFF">Second</tspan>
      <tspan fill="#38BDF8">Medic</tspan>
    </text>
    <text x="3" y="56" font-family="'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" letter-spacing="1.8" fill="#94A3B8" text-transform="uppercase">
      VialTrack • Diagnostic Logistics
    </text>
  </g>
</svg>`;

async function buildAssets() {
  console.log('Writing vector SVG assets to /public ...');
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), iconSvg);
  fs.writeFileSync(path.join(publicDir, 'logo-icon.svg'), iconSvg);
  fs.writeFileSync(path.join(publicDir, 'logo.svg'), fullLogoSvg);
  fs.writeFileSync(path.join(publicDir, 'logo-white.svg'), fullLogoWhiteSvg);

  console.log('Generating crisp WebP & PNG assets via sharp ...');
  
  // 1. logo.webp (High resolution 1040x240)
  await sharp(Buffer.from(fullLogoSvg), { density: 300 })
    .resize(1040, 240)
    .webp({ quality: 95, lossless: false })
    .toFile(path.join(publicDir, 'logo.webp'));

  // 2. logo-white.webp
  await sharp(Buffer.from(fullLogoWhiteSvg), { density: 300 })
    .resize(1040, 240)
    .webp({ quality: 95, lossless: false })
    .toFile(path.join(publicDir, 'logo-white.webp'));

  // 3. PWA icon-192.png
  await sharp(Buffer.from(iconSvg), { density: 300 })
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'));

  // 4. PWA icon-512.png
  await sharp(Buffer.from(iconSvg), { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'));

  // 5. apple-touch-icon.png
  await sharp(Buffer.from(iconSvg), { density: 300 })
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  console.log('Official SecondMedic assets generated successfully in /public!');
}

buildAssets().catch(err => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
