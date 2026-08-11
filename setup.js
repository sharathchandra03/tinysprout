/**
 * RTBW CMS — Setup Script
 * Run this once after npm install to verify the environment is ready.
 * Usage: node setup.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

console.log('\n  RTBW CMS — Setup\n  ─────────────────\n');

// 1. Ensure directories
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  ✓ Created: ${path.relative(ROOT, dir)}/`);
  } else {
    console.log(`  ✓ Exists:  ${path.relative(ROOT, dir)}/`);
  }
});

// 2. Create .env if missing
if (!fs.existsSync(ENV_PATH)) {
  const secret = crypto.randomBytes(32).toString('hex');
  const envContent = `SESSION_SECRET=${secret}\nADMIN_EMAIL=admin@rtbw.com\nADMIN_PASSWORD=admin123\nPORT=3000\n`;
  fs.writeFileSync(ENV_PATH, envContent);
  console.log('  ✓ Created: .env (with random session secret)');
} else {
  console.log('  ✓ Exists:  .env');
}

// 3. Check node_modules
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  console.log('\n  ⚠ node_modules not found. Run: npm install\n');
} else {
  console.log('  ✓ Exists:  node_modules/');
}

console.log(`
  ─────────────────────────────────────────────
  Setup complete. Start the server with:

    npm start

  Then open:
    Public site:  http://localhost:3000
    Admin panel:  http://localhost:3000/admin

  Default admin credentials:
    Email:    admin@rtbw.com
    Password: admin123

  Change these in .env before deploying to production.
  ─────────────────────────────────────────────
`);
