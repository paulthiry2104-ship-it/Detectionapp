// Après « expo export » : rend le site installable sur l'écran d'accueil de l'iPhone
// (plein écran, icône, nom), comme une vraie app.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const base = '/Detectionapp';
copyFileSync('assets/icon.png', join(dist, 'apple-touch-icon.png'));
copyFileSync('assets/icon.png', join(dist, 'icon-512.png'));
writeFileSync(join(dist, 'manifest.json'), JSON.stringify({
  name: 'Crypto Radar', short_name: 'Radar', start_url: `${base}/`, scope: `${base}/`, display: 'standalone',
  background_color: '#07080B', theme_color: '#07080B',
  icons: [{ src: `${base}/icon-512.png`, sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
}));
const tags = [
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Radar">',
  '<meta name="theme-color" content="#07080B">',
  `<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">`,
  `<link rel="manifest" href="${base}/manifest.json">`,
  '<style>html,body{background:#07080B}</style>',
].join('\n');
for (const f of ['index.html']) {
  const p = join(dist, f);
  let html = readFileSync(p, 'utf8');
  html = html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  if (!html.includes('apple-mobile-web-app-capable')) html = html.replace('</head>', `${tags}\n</head>`);
  writeFileSync(p, html);
}
console.log('PWA prête');
