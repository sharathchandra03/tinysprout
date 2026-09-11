/**
 * RTBW CMS — Setup / Environment Check
 * Run once locally to verify your environment is ready.
 * Usage: node setup.js
 *
 * The app now uses Supabase Postgres (DATABASE_URL) for all persistent data
 * and Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) for image
 * storage — nothing is stored on the local filesystem, so it is safe on
 * Render's ephemeral disk.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');

console.log('\n  RTBW CMS — Setup\n  ─────────────────\n');

// Create a starter .env if missing (local development only).
if (!fs.existsSync(ENV_PATH)) {
  const secret = crypto.randomBytes(32).toString('hex');
  const envContent =
`# ---- Persistent database: Supabase Postgres (required) ----
# Supabase -> Project Settings -> Database -> Connection string -> URI (pooler)
DATABASE_URL=
PG_POOL_MAX=5
# Set to "disable" only for a local Postgres without SSL:
# PGSSL=disable

# ---- Image storage: Supabase Storage (required) ----
# Supabase -> Project Settings -> API
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=website-images

# ---- App ----
SESSION_SECRET=${secret}
ADMIN_EMAIL=admin@rtbw.com
ADMIN_PASSWORD=admin123
PORT=3000
`;
  fs.writeFileSync(ENV_PATH, envContent);
  console.log('  ✓ Created: .env (fill in DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
} else {
  console.log('  ✓ Exists:  .env');
}

// Check node_modules
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  console.log('\n  ⚠ node_modules not found. Run: npm install\n');
} else {
  console.log('  ✓ Exists:  node_modules/');
}

console.log(`
  ─────────────────────────────────────────────
  Before starting, make sure your .env has:
    • DATABASE_URL              (Supabase Postgres URI)
    • SUPABASE_URL              (Supabase project URL)
    • SUPABASE_SERVICE_ROLE_KEY (Supabase service_role key)

  Then start the server with:

    npm start

  Public site:  http://localhost:3000
  Admin panel:  http://localhost:3000/admin

  Default admin credentials (change ADMIN_PASSWORD before production):
    Email:    admin@rtbw.com
    Password: admin123
  ─────────────────────────────────────────────
`);
