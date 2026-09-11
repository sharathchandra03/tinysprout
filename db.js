/**
 * RTBW CMS — Database Layer (PostgreSQL)
 * -------------------------------------------------------------
 * Replaces the previous local SQLite storage with a persistent
 * PostgreSQL database (Render PostgreSQL / Supabase / any DATABASE_URL).
 *
 * Everything the Admin Panel writes — image-slot URLs, editable text,
 * blogs, media references and the admin user — now lives in Postgres,
 * so it survives Render redeploys, restarts, crashes and instance swaps.
 *
 * The public API of this module is intentionally small and async:
 *   pool          -> the underlying pg Pool (used by the session store)
 *   query(sql, p) -> run a parameterised query, returns { rows }
 *   one(sql, p)   -> returns the first row or undefined
 *   initDb()      -> creates tables + seeds defaults (idempotent)
 */
'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('\n  FATAL: DATABASE_URL is not set.');
  console.error('  Set it to your PostgreSQL connection string (Render PostgreSQL / Supabase).\n');
  process.exit(1);
}

// Render/Supabase managed Postgres require SSL. Local dev usually doesn't.
// PGSSL=disable turns it off explicitly for local Postgres without SSL.
const useSsl = process.env.PGSSL !== 'disable' &&
  !/localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  // Fail fast instead of hanging forever if the DB is unreachable.
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 15000),
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// SCHEMA
// ---------------------------------------------------------------------------
async function createTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT DEFAULT 'Admin',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT,
      alt_text TEXT DEFAULT '',
      storage_id TEXT DEFAULT '',
      uploaded_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS blogs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      excerpt TEXT DEFAULT '',
      content TEXT DEFAULT '',
      featured_image TEXT DEFAULT '',
      author TEXT DEFAULT 'Admin',
      category TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published')),
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS image_slots (
      id SERIAL PRIMARY KEY,
      slot_key TEXT UNIQUE NOT NULL,
      page TEXT NOT NULL,
      section TEXT NOT NULL,
      label TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      alt_text TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS text_slots (
      id SERIAL PRIMARY KEY,
      slot_key TEXT UNIQUE NOT NULL,
      page TEXT NOT NULL,
      section TEXT NOT NULL,
      label TEXT DEFAULT '',
      content TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Older databases may not have the storage_id column — add it if missing.
  await query(`ALTER TABLE media ADD COLUMN IF NOT EXISTS storage_id TEXT DEFAULT '';`);
}

// ---------------------------------------------------------------------------
// SEED DATA (ported verbatim from the original SQLite server)
// ---------------------------------------------------------------------------
const DEFAULT_IMAGE_SLOTS = [
  { key: 'hero_main', page: 'Homepage', section: 'Hero', label: 'Hero — Big Main Photo (top-left banner)', image_url: '/image assets/imgi_123_b1-400.jpg', alt_text: 'Baby and kids products display' },
  { key: 'hero_side_1', page: 'Homepage', section: 'Hero', label: 'Hero — Small Photo 1 (top-right, upper)', image_url: '/image assets/imgi_124_b2_04b6be89-d906-4fff-b3ff-5698cbdd05e0.jpg', alt_text: 'Kids essentials range' },
  { key: 'hero_side_2', page: 'Homepage', section: 'Hero', label: 'Hero — Small Photo 2 (top-right, lower)', image_url: '/image assets/imgi_125_b3.jpg', alt_text: 'Toys and play items on display' },
  { key: 'carousel_1', page: 'Homepage', section: 'Shop Carousel', label: 'Inside Our Store — Slide 1 "Walk In, Browse Freely"', image_url: '/image assets/imgi_108_budhigere-shop-image-compressed.jpg', alt_text: 'Storefront entrance with product displays' },
  { key: 'carousel_2', page: 'Homepage', section: 'Shop Carousel', label: 'Inside Our Store — Slide 2 "Stocked Floor to Ceiling"', image_url: '/image assets/imgi_110_Kadugodi.jpg', alt_text: 'Store interior showing shelves of kids products' },
  { key: 'carousel_3', page: 'Homepage', section: 'Shop Carousel', label: 'Inside Our Store — Slide 3 "See It Before You Buy"', image_url: '/image assets/imgi_5_25926.jpg', alt_text: 'Display of toys and baby products in store' },
  { key: 'carousel_4', page: 'Homepage', section: 'Shop Carousel', label: 'Inside Our Store — Slide 4 "Party Wear & Daily Wear"', image_url: '/image assets/imgi_10_1705643989.jpg', alt_text: 'Kids clothing section inside the store' },
  { key: 'carousel_5', page: 'Homepage', section: 'Shop Carousel', label: 'Inside Our Store — Slide 5 "Gear That Lasts"', image_url: '/image assets/imgi_11_1705737547_5565a58b-27d2-4e7b-b950-f29cdd5531de.jpg', alt_text: 'Baby gear and accessories aisle' },
  { key: 'collection_large', page: 'Homepage', section: 'Collections', label: 'Shop by Interest — Large card "Strollers, Carriers & Travel Gear"', image_url: '/image assets/imgi_46_RforRabbitStreetSmartStrollerGreyBlack_1_1.jpg', alt_text: 'Strollers and travel gear range' },
  { key: 'collection_top_right', page: 'Homepage', section: 'Collections', label: 'Shop by Interest — "Toy Vehicles & Play Sets"', image_url: '/image assets/imgi_17_HTE9997-HolaToyAmbulance-1.webp', alt_text: 'Toy vehicles and play sets' },
  { key: 'collection_bottom_left', page: 'Homepage', section: 'Collections', label: 'Shop by Interest — "Newborn Starter Essentials"', image_url: '/image assets/imgi_64_01_652a2989-83ec-4d10-bd8c-21f50957e002.webp', alt_text: 'Newborn essentials range' },
  { key: 'collection_bottom_right', page: 'Homepage', section: 'Collections', label: 'Shop by Interest — "Stationery, Art & Craft"', image_url: '/image assets/imgi_100_Foilfun_WOA9_1024x1024_24ad9ee3-493c-432f-8c5c-7c3a1c33e63e.webp', alt_text: 'Art, craft and stationery range' },
  { key: 'collection_extra', page: 'Homepage', section: 'Collections', label: 'Shop by Interest — "Learning & Puzzle Toys"', image_url: '/image assets/imgi_87_City3_1024x1024_e7baab53-da12-4fa7-8e59-79081a7c52a4.webp', alt_text: 'Learning and puzzle toys range' },
  { key: 'collection_banner', page: 'Homepage', section: 'Collections', label: 'Shop by Interest — Wide banner (not shown on site right now)', image_url: '/image assets/imgi_2_b1-400.jpg', alt_text: 'School bags, bottles and back-to-school essentials' },
  { key: 'promo_left', page: 'Homepage', section: 'Promotions', label: 'Promotions banner (not shown on site right now)', image_url: '/image assets/imgi_199_Toy_car_rc_car.jpg', alt_text: 'Remote control toys offer' },
  { key: 'location_1', page: 'Homepage', section: 'Locations', label: 'Come See It In Person — "Easy to Find"', image_url: '/image assets/imgi_108_budhigere-shop-image-compressed.jpg', alt_text: 'Store entrance and window display' },
  { key: 'location_2', page: 'Homepage', section: 'Locations', label: 'Come See It In Person — "Organised Aisles"', image_url: '/image assets/imgi_110_Kadugodi.jpg', alt_text: 'Organised shelves inside the store' },
  { key: 'location_3', page: 'Homepage', section: 'Locations', label: 'Come See It In Person — "Help On Hand"', image_url: '/image assets/imgi_8_1705662970.jpg', alt_text: 'Staff assisting a customer in store' },
  { key: 'insta_1', page: 'Homepage', section: 'Instagram', label: 'Instagram Grid — Post 1 (top-left)', image_url: '/image assets/imgi_15_34.webp', alt_text: 'Instagram post' },
  { key: 'insta_2', page: 'Homepage', section: 'Instagram', label: 'Instagram Grid — Post 2', image_url: '/image assets/imgi_21_HolaEarlyLearningFireEngine1.webp', alt_text: 'Instagram post' },
  { key: 'insta_3', page: 'Homepage', section: 'Instagram', label: 'Instagram Grid — Post 3', image_url: '/image assets/imgi_76_bluegrey.webp', alt_text: 'Instagram post' },
  { key: 'insta_4', page: 'Homepage', section: 'Instagram', label: 'Instagram Grid — Post 4', image_url: '/image assets/imgi_95_1032_-_Cataloguing-_Image01.webp', alt_text: 'Instagram post' },
  { key: 'insta_5', page: 'Homepage', section: 'Instagram', label: 'Instagram Grid — Post 5', image_url: '/image assets/imgi_101_Peek-A-BooISeeYouJungle_1024x1024_0b891654-a445-4325-86bd-315883045819.webp', alt_text: 'Instagram post' },
  { key: 'insta_6', page: 'Homepage', section: 'Instagram', label: 'Instagram Grid — Post 6 (bottom-right)', image_url: '/image assets/imgi_93_1_1_2f2b789c-eb4f-4965-9fb5-4848bf55cf3b.webp', alt_text: 'Instagram post' },
];

// Slots that were added after the very first seed in the original app.
const ADDED_SLOTS = [
  { key: 'collection_extra', page: 'Homepage', section: 'Collections', label: 'Shop by Interest — "Learning & Puzzle Toys"', image_url: '/image assets/imgi_87_City3_1024x1024_e7baab53-da12-4fa7-8e59-79081a7c52a4.webp', alt_text: 'Learning and puzzle toys range' },
  { key: 'product_1', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 1 "Shape Sorting Bus"', image_url: '/image assets/imgi_19_HolaShapeSortingBus1.webp', alt_text: 'Shape sorting bus toy with coloured blocks' },
  { key: 'product_2', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 2 "Dancing Musical Goose"', image_url: '/image assets/imgi_15_34.webp', alt_text: 'Musical dancing goose toy with lights' },
  { key: 'product_3', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 3 "4-in-1 Multipurpose Carry Cot"', image_url: '/image assets/imgi_74_PicabooGrand4in1MultipurposeBabyCarryCotCumCarSeat_1.webp', alt_text: 'Multipurpose baby carry cot and carrier' },
  { key: 'product_4', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 4 "RC Stunt Car"', image_url: '/image assets/imgi_84_Toy_car_rc_car.jpg', alt_text: 'Remote control stunt car toy' },
  { key: 'product_5', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 5 "India Map Jigsaw Puzzle"', image_url: '/image assets/imgi_89_IndiaMapPuzzle8_1024x1024_eeec2a79-c695-4488-9eb9-9a279a4834ef.webp', alt_text: 'India map jigsaw puzzle for children' },
  { key: 'product_6', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 6 "DIY Music Machine Kit"', image_url: '/image assets/imgi_95_1032_-_Cataloguing-_Image01.webp', alt_text: 'DIY wooden music machine STEM building kit' },
  { key: 'product_7', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 7 "DIY Kaleidoscope Kit"', image_url: '/image assets/imgi_93_1_1_2f2b789c-eb4f-4965-9fb5-4848bf55cf3b.webp', alt_text: 'DIY kaleidoscope building kit for children' },
  { key: 'product_8', page: 'Homepage', section: 'Featured Products', label: 'Featured Products — Card 8 "Foil Art Activity Kit"', image_url: '/image assets/imgi_100_Foilfun_WOA9_1024x1024_24ad9ee3-493c-432f-8c5c-7c3a1c33e63e.webp', alt_text: 'Foil art and craft activity kit' },
];

const SLOT_LABELS = {
  hero_main:               'Hero — Big Main Photo (top-left banner)',
  hero_side_1:             'Hero — Small Photo 1 (top-right, upper)',
  hero_side_2:             'Hero — Small Photo 2 (top-right, lower)',
  carousel_1:              'Inside Our Store — Slide 1 "Walk In, Browse Freely"',
  carousel_2:              'Inside Our Store — Slide 2 "Stocked Floor to Ceiling"',
  carousel_3:              'Inside Our Store — Slide 3 "See It Before You Buy"',
  carousel_4:              'Inside Our Store — Slide 4 "Party Wear & Daily Wear"',
  carousel_5:              'Inside Our Store — Slide 5 "Gear That Lasts"',
  collection_large:        'Shop by Interest — Large card "Strollers, Carriers & Travel Gear"',
  collection_top_right:    'Shop by Interest — "Toy Vehicles & Play Sets"',
  collection_bottom_left:  'Shop by Interest — "Newborn Starter Essentials"',
  collection_bottom_right: 'Shop by Interest — "Stationery, Art & Craft"',
  collection_extra:        'Shop by Interest — "Learning & Puzzle Toys"',
  collection_banner:       'Shop by Interest — Wide banner (not shown on site right now)',
  product_1:               'Featured Products — Card 1 "Shape Sorting Bus"',
  product_2:               'Featured Products — Card 2 "Dancing Musical Goose"',
  product_3:               'Featured Products — Card 3 "4-in-1 Multipurpose Carry Cot"',
  product_4:               'Featured Products — Card 4 "RC Stunt Car"',
  product_5:               'Featured Products — Card 5 "India Map Jigsaw Puzzle"',
  product_6:               'Featured Products — Card 6 "DIY Music Machine Kit"',
  product_7:               'Featured Products — Card 7 "DIY Kaleidoscope Kit"',
  product_8:               'Featured Products — Card 8 "Foil Art Activity Kit"',
  promo_left:              'Promotions banner (not shown on site right now)',
  location_1:              'Come See It In Person — "Easy to Find"',
  location_2:              'Come See It In Person — "Organised Aisles"',
  location_3:              'Come See It In Person — "Help On Hand"',
  insta_1:                 'Instagram Grid — Post 1 (top-left)',
  insta_2:                 'Instagram Grid — Post 2',
  insta_3:                 'Instagram Grid — Post 3',
  insta_4:                 'Instagram Grid — Post 4',
  insta_5:                 'Instagram Grid — Post 5',
  insta_6:                 'Instagram Grid — Post 6 (bottom-right)',
};

const TEXT_SLOTS = [
  { key: 'product_1_badge', section: 'Featured Products', label: 'Card 1 — Badge (corner tag)', content: 'Popular' },
  { key: 'product_1_brand', section: 'Featured Products', label: 'Card 1 — Category',           content: 'Toys' },
  { key: 'product_1_name',  section: 'Featured Products', label: 'Card 1 — Product name',       content: 'Shape Sorting Bus' },
  { key: 'product_1_desc',  section: 'Featured Products', label: 'Card 1 — Description',         content: 'Colour and shape recognition play for toddlers, with chunky easy-grip blocks.' },
  { key: 'product_2_badge', section: 'Featured Products', label: 'Card 2 — Badge (corner tag)', content: 'New In' },
  { key: 'product_2_brand', section: 'Featured Products', label: 'Card 2 — Category',           content: 'Toys' },
  { key: 'product_2_name',  section: 'Featured Products', label: 'Card 2 — Product name',       content: 'Dancing Musical Goose' },
  { key: 'product_2_desc',  section: 'Featured Products', label: 'Card 2 — Description',         content: 'Music, flashing lights and dance moves that keep little ones entertained.' },
  { key: 'product_3_badge', section: 'Featured Products', label: 'Card 3 — Badge (corner tag)', content: 'Parent Favourite' },
  { key: 'product_3_brand', section: 'Featured Products', label: 'Card 3 — Category',           content: 'Baby Carriers' },
  { key: 'product_3_name',  section: 'Featured Products', label: 'Card 3 — Product name',       content: '4-in-1 Multipurpose Carry Cot' },
  { key: 'product_3_desc',  section: 'Featured Products', label: 'Card 3 — Description',         content: 'Carry cot, rocker and carrier in one. Padded interior with a secure harness.' },
  { key: 'product_4_badge', section: 'Featured Products', label: 'Card 4 — Badge (corner tag)', content: 'Age 3+' },
  { key: 'product_4_brand', section: 'Featured Products', label: 'Card 4 — Category',           content: 'Toys' },
  { key: 'product_4_name',  section: 'Featured Products', label: 'Card 4 — Product name',       content: 'RC Stunt Car' },
  { key: 'product_4_desc',  section: 'Featured Products', label: 'Card 4 — Description',         content: 'Full-function remote control with rechargeable battery and grippy tyres.' },
  { key: 'product_5_badge', section: 'Featured Products', label: 'Card 5 — Badge (corner tag)', content: 'Trending' },
  { key: 'product_5_brand', section: 'Featured Products', label: 'Card 5 — Category',           content: 'Learning' },
  { key: 'product_5_name',  section: 'Featured Products', label: 'Card 5 — Product name',       content: 'India Map Jigsaw Puzzle' },
  { key: 'product_5_desc',  section: 'Featured Products', label: 'Card 5 — Description',         content: 'Learn states and capitals through play. Thick pieces that hold up to daily use.' },
  { key: 'product_6_badge', section: 'Featured Products', label: 'Card 6 — Badge (corner tag)', content: 'Staff Pick' },
  { key: 'product_6_brand', section: 'Featured Products', label: 'Card 6 — Category',           content: 'Learning' },
  { key: 'product_6_name',  section: 'Featured Products', label: 'Card 6 — Product name',       content: 'DIY Music Machine Kit' },
  { key: 'product_6_desc',  section: 'Featured Products', label: 'Card 6 — Description',         content: 'Build-it-yourself wooden STEM kit. No glue or tools needed, ages 8 and up.' },
  { key: 'product_7_badge', section: 'Featured Products', label: 'Card 7 — Badge (corner tag)', content: 'Bestselling' },
  { key: 'product_7_brand', section: 'Featured Products', label: 'Card 7 — Category',           content: 'Learning' },
  { key: 'product_7_name',  section: 'Featured Products', label: 'Card 7 — Product name',       content: 'DIY Kaleidoscope Kit' },
  { key: 'product_7_desc',  section: 'Featured Products', label: 'Card 7 — Description',         content: 'Assemble it, then explore colour and reflection. A favourite for ages 6 and up.' },
  { key: 'product_8_badge', section: 'Featured Products', label: 'Card 8 — Badge (corner tag)', content: 'New Arrival' },
  { key: 'product_8_brand', section: 'Featured Products', label: 'Card 8 — Category',           content: 'Art & Craft' },
  { key: 'product_8_name',  section: 'Featured Products', label: 'Card 8 — Product name',       content: 'Foil Art Activity Kit' },
  { key: 'product_8_desc',  section: 'Featured Products', label: 'Card 8 — Description',         content: 'Peel-and-stick foil sheets for mess-free creative afternoons. Everything included.' },

  // Shop by Interest — the 5 image cards in the "Shop by Interest" gallery.
  // Each card has an eyebrow tag (small label) and a title.
  { key: 'coll_1_tag',   section: 'Shop by Interest', label: 'Card 1 (large) — Eyebrow tag', content: 'Out & About' },
  { key: 'coll_1_title', section: 'Shop by Interest', label: 'Card 1 (large) — Title',       content: 'Strollers, Carriers & Travel Gear' },
  { key: 'coll_2_tag',   section: 'Shop by Interest', label: 'Card 2 — Eyebrow tag',         content: 'Toddler Picks' },
  { key: 'coll_2_title', section: 'Shop by Interest', label: 'Card 2 — Title',               content: 'Toy Vehicles & Play Sets' },
  { key: 'coll_3_tag',   section: 'Shop by Interest', label: 'Card 3 — Eyebrow tag',         content: '0–6 Months' },
  { key: 'coll_3_title', section: 'Shop by Interest', label: 'Card 3 — Title',               content: 'Newborn Starter Essentials' },
  { key: 'coll_4_tag',   section: 'Shop by Interest', label: 'Card 4 — Eyebrow tag',         content: 'Creative Play' },
  { key: 'coll_4_title', section: 'Shop by Interest', label: 'Card 4 — Title',               content: 'Stationery, Art & Craft' },
  { key: 'coll_5_tag',   section: 'Shop by Interest', label: 'Card 5 — Eyebrow tag',         content: 'Kids Favourites' },
  { key: 'coll_5_title', section: 'Shop by Interest', label: 'Card 5 — Title',               content: 'Learning & Puzzle Toys' },
];

async function seed() {
  // --- Admin user (only if none exists) ---
  const userCount = await one('SELECT COUNT(*)::int AS cnt FROM users');
  if (userCount.cnt === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@rtbw.com';
    const pass = process.env.ADMIN_PASSWORD || 'admin123';
    const hashed = bcrypt.hashSync(pass, 10);
    await query('INSERT INTO users (email, password, name) VALUES ($1, $2, $3)', [email, hashed, 'Admin']);
    console.log(`Default admin created: ${email}`);
  }

  // --- Image slots: insert any missing (idempotent, never overwrites) ---
  // Done as a single set-based statement (one round-trip) so startup stays
  // fast even over a connection pooler where each round-trip is expensive.
  const allSlots = [...DEFAULT_IMAGE_SLOTS, ...ADDED_SLOTS]
    // De-duplicate by key (collection_extra appears twice); first wins.
    .filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)
    .map((s) => ({
      slot_key: s.key, page: s.page, section: s.section,
      label: s.label, image_url: s.image_url, alt_text: s.alt_text,
    }));

  const addedSlots = (await query(
    `INSERT INTO image_slots (slot_key, page, section, label, image_url, alt_text)
     SELECT slot_key, page, section, label, image_url, alt_text
     FROM json_to_recordset($1::json)
       AS x(slot_key text, page text, section text, label text, image_url text, alt_text text)
     ON CONFLICT (slot_key) DO NOTHING`,
    [JSON.stringify(allSlots)]
  )).rowCount;
  if (addedSlots > 0) console.log(`Seeded ${addedSlots} image slot(s).`);

  // Fill any slot that somehow has an empty image_url with its default.
  const filled = (await query(
    `UPDATE image_slots AS s
     SET image_url = d.image_url,
         alt_text = COALESCE(NULLIF(s.alt_text, ''), 'Website image')
     FROM json_to_recordset($1::json) AS d(slot_key text, image_url text)
     WHERE s.slot_key = d.slot_key AND (s.image_url = '' OR s.image_url IS NULL)`,
    [JSON.stringify(allSlots.map((s) => ({ slot_key: s.slot_key, image_url: s.image_url })))]
  )).rowCount;
  if (filled > 0) console.log(`Filled ${filled} empty image slot(s) with defaults.`);

  // Keep admin labels in sync with the website (labels only — never image_url).
  const labelRows = Object.keys(SLOT_LABELS).map((k) => ({ slot_key: k, label: SLOT_LABELS[k] }));
  const relabelled = (await query(
    `UPDATE image_slots AS s
     SET label = d.label
     FROM json_to_recordset($1::json) AS d(slot_key text, label text)
     WHERE s.slot_key = d.slot_key AND s.label <> d.label`,
    [JSON.stringify(labelRows)]
  )).rowCount;
  if (relabelled > 0) console.log(`Renamed ${relabelled} image slot label(s).`);

  // --- Text slots: insert any missing (never overwrites edited content) ---
  const textRows = TEXT_SLOTS.map((t) => ({
    slot_key: t.key, page: 'Homepage', section: t.section, label: t.label, content: t.content,
  }));
  const addedText = (await query(
    `INSERT INTO text_slots (slot_key, page, section, label, content)
     SELECT slot_key, page, section, label, content
     FROM json_to_recordset($1::json)
       AS x(slot_key text, page text, section text, label text, content text)
     ON CONFLICT (slot_key) DO NOTHING`,
    [JSON.stringify(textRows)]
  )).rowCount;
  if (addedText > 0) console.log(`Seeded ${addedText} text slot(s).`);

  // Keep text-slot labels in sync (labels only — never touches content).
  const relabelledText = (await query(
    `UPDATE text_slots AS s
     SET label = d.label
     FROM json_to_recordset($1::json) AS d(slot_key text, label text)
     WHERE s.slot_key = d.slot_key AND s.label <> d.label`,
    [JSON.stringify(TEXT_SLOTS.map((t) => ({ slot_key: t.key, label: t.label })))]
  )).rowCount;
  if (relabelledText > 0) console.log(`Renamed ${relabelledText} text slot label(s).`);
}

async function initDb() {
  await createTables();
  await seed();
}

module.exports = { pool, query, one, initDb };
