#!/usr/bin/env node
/**
 * prepare-www.js
 * 
 * Copies the pure web app files into the `www/` directory
 * that Capacitor uses as the webDir source for the Android project.
 * 
 * This avoids any build tooling (Webpack/Vite/etc.) since TreeUi
 * is a pure HTML/CSS/JS application — no compilation needed.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

// Files to copy into www/
const FILES_TO_COPY = [
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
  'app_icon.jpg'
];

console.log('📦 Preparing www/ directory for Capacitor...');

// Clean and create www/
if (fs.existsSync(WWW)) {
  fs.rmSync(WWW, { recursive: true });
}
fs.mkdirSync(WWW, { recursive: true });

// Copy each file
for (const file of FILES_TO_COPY) {
  const src = path.join(ROOT, file);
  const dest = path.join(WWW, file);
  
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✅ ${file}`);
  } else {
    console.warn(`  ⚠️  Skipped (not found): ${file}`);
  }
}

// Copy generated icon if it exists in resources/
const resourcesDir = path.join(ROOT, 'resources');
if (fs.existsSync(resourcesDir)) {
  const iconSrc = path.join(resourcesDir, 'icon.png');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(WWW, 'icon.png'));
    console.log('  ✅ icon.png (from resources/)');
  }
}

console.log(`\n✅ www/ directory ready (${FILES_TO_COPY.length} files)\n`);
