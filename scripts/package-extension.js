/**
 * Packaging script for PhishTank Browser Extension (Manifest V3)
 * Compresses extension/ into dist/phishtank-extension.zip ready for upload
 * to Mozilla Add-ons (addons.mozilla.org) and Chrome Web Store.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');
const distDir = path.join(rootDir, 'dist');
const zipFile = path.join(distDir, 'phishtank-extension.zip');

console.log('📦 Packaging PhishTank Browser Extension...');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

try {
  // Use PowerShell Compress-Archive on Windows
  const psCommand = `powershell -NoProfile -Command "Compress-Archive -Path '${extensionDir}\\*' -DestinationPath '${zipFile}' -Force"`;
  execSync(psCommand, { stdio: 'inherit' });

  const stats = fs.statSync(zipFile);
  console.log(`\n🎉 Successfully packaged extension!`);
  console.log(`📍 File: ${zipFile}`);
  console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`\n🚀 Upload this .zip to:`);
  console.log(`- Firefox: https://addons.mozilla.org/developers/addon/submit/distribution`);
  console.log(`- Chrome:  https://chrome.google.com/webstore/devconsole`);
} catch (error) {
  console.error('❌ Failed to package extension:', error.message);
  process.exit(1);
}
