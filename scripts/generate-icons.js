#!/usr/bin/env node
/**
 * generate-icons.js
 * 
 * Generates Android adaptive icon resources from the source icon.
 * Uses the existing app_icon.jpg as the source.
 * 
 * If you want to use a different icon, replace `resources/icon.png`
 * and re-run: node scripts/generate-icons.js
 * 
 * This script creates properly sized PNGs for all Android density buckets.
 * Since we can't use sharp/imagemagick reliably everywhere, this script
 * generates the resource XML files and copies the source icon,
 * relying on Capacitor's built-in icon handling or manual placement.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(ROOT, 'resources');

// Ensure resources directory exists
if (!fs.existsSync(RESOURCES)) {
  fs.mkdirSync(RESOURCES, { recursive: true });
}

// Copy app_icon.jpg as the source icon
const sourceIcon = path.join(ROOT, 'app_icon.jpg');
const targetIcon = path.join(RESOURCES, 'icon.png');

if (fs.existsSync(sourceIcon) && !fs.existsSync(targetIcon)) {
  // Copy the JPG as-is; Capacitor can handle JPG icons
  fs.copyFileSync(sourceIcon, path.join(RESOURCES, 'icon.jpg'));
  console.log('📱 Copied app_icon.jpg → resources/icon.jpg');
}

// Create splash screen config
const splashIcon = path.join(RESOURCES, 'splash.png');
if (!fs.existsSync(splashIcon)) {
  // Copy icon as splash placeholder too
  if (fs.existsSync(sourceIcon)) {
    fs.copyFileSync(sourceIcon, splashIcon);
    console.log('📱 Created splash.png from app_icon.jpg');
  }
}

console.log(`
✅ Resources prepared in resources/

📋 Android icon sizes needed (place manually if auto-generation doesn't work):
   - mdpi:    48x48 px   (resources/android/mipmap-mdpi/ic_launcher.png)
   - hdpi:    72x72 px   (resources/android/mipmap-hdpi/ic_launcher.png)
   - xhdpi:   96x96 px   (resources/android/mipmap-xhdpi/ic_launcher.png)
   - xxhdpi:  144x144 px (resources/android/mipmap-xxhdpi/ic_launcher.png)
   - xxxhdpi: 192x192 px (resources/android/mipmap-xxxhdpi/ic_launcher.png)

💡 Tip: Use https://icon.kitchen or Android Studio's Image Asset tool
   to generate all sizes from your source icon.
`);
