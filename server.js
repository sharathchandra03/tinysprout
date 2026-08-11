/**
 * RTBW CMS Server
 * Express + SQLite backend for blog management, media uploads, and image slot mapping.
 */
'use strict';

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const slugify = require('slugify');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'rtbw-dev-secret-change-in-prod';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ---------------------------------------------------------------------------
// DATABASE
// ---------------------------------------------------------------------------
const db = new Database(path.join(DATA_DIR, 'cms.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT DEFAULT 'Admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    alt_text TEXT DEFAULT '',
    uploaded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    excerpt TEXT DEFAULT '',
    content TEXT DEFAULT '',
    featured_image TEXT DEFAULT '',
    author TEXT DEFAULT 'Admin',
    category TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
    published_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS image_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_key TEXT UNIQUE NOT NULL,
    page TEXT NOT NULL,
    section TEXT NOT NULL,
    label TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    alt_text TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed default admin user if none exists
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
if (userCount.cnt === 0) {
  const email = process.env.ADMIN_EMAIL || 'admin@rtbw.com';
  const pass = process.env.ADMIN_PASSWORD || 'admin123';
  const hashed = bcrypt.hashSync(pass, 10);
  db.prepare('INSERT INTO users (email, password, name) VALUES (?, ?, ?)').run(email, hashed, 'Admin');
  console.log(`Default admin created: ${email}`);
}

// Seed default image slots from the existing website (with current image paths as defaults)
const slotCount = db.prepare('SELECT COUNT(*) as cnt FROM image_slots').get();
if (slotCount.cnt === 0) {
  const defaultSlots = [
    { key: 'hero_main', page: 'Homepage', section: 'Hero', label: 'Hero Main Image', image_url: '/image assets/imgi_123_b1-400.jpg', alt_text: 'Baby and kids products display' },
    { key: 'hero_side_1', page: 'Homepage', section: 'Hero', label: 'Hero Side Image 1', image_url: '/image assets/imgi_124_b2_04b6be89-d906-4fff-b3ff-5698cbdd05e0.jpg', alt_text: 'Kids essentials range' },
    { key: 'hero_side_2', page: 'Homepage', section: 'Hero', label: 'Hero Side Image 2', image_url: '/image assets/imgi_125_b3.jpg', alt_text: 'Toys and play items on display' },
    { key: 'carousel_1', page: 'Homepage', section: 'Shop Carousel', label: 'Carousel Slide 1', image_url: '/image assets/imgi_108_budhigere-shop-image-compressed.jpg', alt_text: 'Storefront entrance with product displays' },
    { key: 'carousel_2', page: 'Homepage', section: 'Shop Carousel', label: 'Carousel Slide 2', image_url: '/image assets/imgi_110_Kadugodi.jpg', alt_text: 'Store interior showing shelves of kids products' },
    { key: 'carousel_3', page: 'Homepage', section: 'Shop Carousel', label: 'Carousel Slide 3', image_url: '/image assets/imgi_5_25926.jpg', alt_text: 'Display of toys and baby products in store' },
    { key: 'carousel_4', page: 'Homepage', section: 'Shop Carousel', label: 'Carousel Slide 4', image_url: '/image assets/imgi_10_1705643989.jpg', alt_text: 'Kids clothing section inside the store' },
    { key: 'carousel_5', page: 'Homepage', section: 'Shop Carousel', label: 'Carousel Slide 5', image_url: '/image assets/imgi_11_1705737547_5565a58b-27d2-4e7b-b950-f29cdd5531de.jpg', alt_text: 'Baby gear and accessories aisle' },
    { key: 'collection_large', page: 'Homepage', section: 'Collections', label: 'Featured Collection - Large Card', image_url: '/image assets/imgi_46_RforRabbitStreetSmartStrollerGreyBlack_1_1.jpg', alt_text: 'Strollers and travel gear range' },
    { key: 'collection_top_right', page: 'Homepage', section: 'Collections', label: 'Collection - Top Right', image_url: '/image assets/imgi_17_HTE9997-HolaToyAmbulance-1.webp', alt_text: 'Toy vehicles and play sets' },
    { key: 'collection_bottom_left', page: 'Homepage', section: 'Collections', label: 'Collection - Bottom Left', image_url: '/image assets/imgi_64_01_652a2989-83ec-4d10-bd8c-21f50957e002.webp', alt_text: 'Newborn essentials range' },
    { key: 'collection_bottom_right', page: 'Homepage', section: 'Collections', label: 'Collection - Bottom Right', image_url: '/image assets/imgi_100_Foilfun_WOA9_1024x1024_24ad9ee3-493c-432f-8c5c-7c3a1c33e63e.webp', alt_text: 'Art, craft and stationery range' },
    { key: 'collection_banner', page: 'Homepage', section: 'Collections', label: 'Collection - Full Banner', image_url: '/image assets/imgi_2_b1-400.jpg', alt_text: 'School bags, bottles and back-to-school essentials' },
    { key: 'promo_left', page: 'Homepage', section: 'Promotions', label: 'Promo Banner Left', image_url: '/image assets/imgi_199_Toy_car_rc_car.jpg', alt_text: 'Remote control toys offer' },
    { key: 'location_1', page: 'Homepage', section: 'Locations', label: 'Store Photo 1', image_url: '/image assets/imgi_108_budhigere-shop-image-compressed.jpg', alt_text: 'Store entrance and window display' },
    { key: 'location_2', page: 'Homepage', section: 'Locations', label: 'Store Photo 2', image_url: '/image assets/imgi_110_Kadugodi.jpg', alt_text: 'Organised shelves inside the store' },
    { key: 'location_3', page: 'Homepage', section: 'Locations', label: 'Store Photo 3', image_url: '/image assets/imgi_8_1705662970.jpg', alt_text: 'Staff assisting a customer in store' },
    { key: 'insta_1', page: 'Homepage', section: 'Instagram', label: 'Instagram Tile 1', image_url: '/image assets/imgi_15_34.webp', alt_text: 'Instagram post' },
    { key: 'insta_2', page: 'Homepage', section: 'Instagram', label: 'Instagram Tile 2', image_url: '/image assets/imgi_21_HolaEarlyLearningFireEngine1.webp', alt_text: 'Instagram post' },
    { key: 'insta_3', page: 'Homepage', section: 'Instagram', label: 'Instagram Tile 3', image_url: '/image assets/imgi_76_bluegrey.webp', alt_text: 'Instagram post' },
    { key: 'insta_4', page: 'Homepage', section: 'Instagram', label: 'Instagram Tile 4', image_url: '/image assets/imgi_95_1032_-_Cataloguing-_Image01.webp', alt_text: 'Instagram post' },
    { key: 'insta_5', page: 'Homepage', section: 'Instagram', label: 'Instagram Tile 5', image_url: '/image assets/imgi_101_Peek-A-BooISeeYouJungle_1024x1024_0b891654-a445-4325-86bd-315883045819.webp', alt_text: 'Instagram post' },
    { key: 'insta_6', page: 'Homepage', section: 'Instagram', label: 'Instagram Tile 6', image_url: '/image assets/imgi_93_1_1_2f2b789c-eb4f-4965-9fb5-4848bf55cf3b.webp', alt_text: 'Instagram post' },
  ];

  const insertSlot = db.prepare('INSERT INTO image_slots (slot_key, page, section, label, image_url, alt_text) VALUES (?, ?, ?, ?, ?, ?)');
  const insertMany = db.transaction((slots) => {
    for (const s of slots) {
      insertSlot.run(s.key, s.page, s.section, s.label, s.image_url, s.alt_text);
    }
  });
  insertMany(defaultSlots);
  console.log('Default image slots seeded.');
} else {
  // Migration: fill any existing slots that have empty image_url with their defaults
  const defaultImages = {
    hero_main: '/image assets/imgi_123_b1-400.jpg',
    hero_side_1: '/image assets/imgi_124_b2_04b6be89-d906-4fff-b3ff-5698cbdd05e0.jpg',
    hero_side_2: '/image assets/imgi_125_b3.jpg',
    carousel_1: '/image assets/imgi_108_budhigere-shop-image-compressed.jpg',
    carousel_2: '/image assets/imgi_110_Kadugodi.jpg',
    carousel_3: '/image assets/imgi_5_25926.jpg',
    carousel_4: '/image assets/imgi_10_1705643989.jpg',
    carousel_5: '/image assets/imgi_11_1705737547_5565a58b-27d2-4e7b-b950-f29cdd5531de.jpg',
    collection_large: '/image assets/imgi_46_RforRabbitStreetSmartStrollerGreyBlack_1_1.jpg',
    collection_top_right: '/image assets/imgi_17_HTE9997-HolaToyAmbulance-1.webp',
    collection_bottom_left: '/image assets/imgi_64_01_652a2989-83ec-4d10-bd8c-21f50957e002.webp',
    collection_bottom_right: '/image assets/imgi_100_Foilfun_WOA9_1024x1024_24ad9ee3-493c-432f-8c5c-7c3a1c33e63e.webp',
    collection_banner: '/image assets/imgi_2_b1-400.jpg',
    promo_left: '/image assets/imgi_199_Toy_car_rc_car.jpg',
    location_1: '/image assets/imgi_108_budhigere-shop-image-compressed.jpg',
    location_2: '/image assets/imgi_110_Kadugodi.jpg',
    location_3: '/image assets/imgi_8_1705662970.jpg',
    insta_1: '/image assets/imgi_15_34.webp',
    insta_2: '/image assets/imgi_21_HolaEarlyLearningFireEngine1.webp',
    insta_3: '/image assets/imgi_76_bluegrey.webp',
    insta_4: '/image assets/imgi_95_1032_-_Cataloguing-_Image01.webp',
    insta_5: '/image assets/imgi_101_Peek-A-BooISeeYouJungle_1024x1024_0b891654-a445-4325-86bd-315883045819.webp',
    insta_6: '/image assets/imgi_93_1_1_2f2b789c-eb4f-4965-9fb5-4848bf55cf3b.webp',
  };
  const emptySlots = db.prepare("SELECT id, slot_key FROM image_slots WHERE image_url = '' OR image_url IS NULL").all();
  if (emptySlots.length > 0) {
    const updateStmt = db.prepare("UPDATE image_slots SET image_url = ?, alt_text = COALESCE(NULLIF(alt_text, ''), 'Website image') WHERE id = ?");
    for (const slot of emptySlots) {
      if (defaultImages[slot.slot_key]) {
        updateStmt.run(defaultImages[slot.slot_key], slot.id);
      }
    }
    console.log(`Filled ${emptySlots.length} empty image slots with defaults.`);
  }
}

// ---------------------------------------------------------------------------
// EXPRESS APP
// ---------------------------------------------------------------------------
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

// Static files
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/image assets', express.static(path.join(__dirname, 'image assets')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ---------------------------------------------------------------------------
// FILE UPLOAD CONFIG
// ---------------------------------------------------------------------------
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = slugify(path.basename(file.originalname, ext), { lower: true, strict: true });
    const uniqueName = `${name}-${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, JPEG, PNG, and WEBP are allowed.'));
    }
  }
});

// ---------------------------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/admin/login');
}

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  req.session.userId = user.id;
  req.session.userName = user.name;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user });
});

// ---------------------------------------------------------------------------
// BLOG ROUTES
// ---------------------------------------------------------------------------
// Public: get published blogs
app.get('/api/blogs', (req, res) => {
  const { page = 1, limit = 12, category, search } = req.query;
  const offset = (page - 1) * limit;
  let where = "WHERE status = 'published'";
  const params = [];

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  if (search) {
    where += ' AND (title LIKE ? OR excerpt LIKE ? OR tags LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM blogs ${where}`).get(...params).cnt;
  const blogs = db.prepare(`SELECT id, title, slug, excerpt, featured_image, author, category, tags, status, published_at, created_at FROM blogs ${where} ORDER BY COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));

  res.json({ blogs, total, page: Number(page), pages: Math.ceil(total / limit) });
});

// Public: get single blog by slug
app.get('/api/blogs/:slug', (req, res) => {
  const blog = db.prepare("SELECT * FROM blogs WHERE slug = ? AND status = 'published'").get(req.params.slug);
  if (!blog) return res.status(404).json({ error: 'Blog not found.' });
  res.json({ blog });
});

// Admin: get all blogs (including drafts)
app.get('/api/admin/blogs', requireAuth, (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE 1=1';
  const params = [];

  if (status && status !== 'all') {
    where += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    where += ' AND (title LIKE ? OR excerpt LIKE ? OR tags LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM blogs ${where}`).get(...params).cnt;
  const blogs = db.prepare(`SELECT * FROM blogs ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));

  res.json({ blogs, total, page: Number(page), pages: Math.ceil(total / limit) });
});

// Admin: get single blog by id
app.get('/api/admin/blogs/:id', requireAuth, (req, res) => {
  const blog = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!blog) return res.status(404).json({ error: 'Blog not found.' });
  res.json({ blog });
});

// Admin: create blog
app.post('/api/admin/blogs', requireAuth, (req, res) => {
  const { title, excerpt, content, featured_image, author, category, tags, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required.' });

  let slug = slugify(title, { lower: true, strict: true });
  // Ensure unique slug
  const existing = db.prepare('SELECT id FROM blogs WHERE slug = ?').get(slug);
  if (existing) slug += '-' + Date.now();

  const published_at = status === 'published' ? new Date().toISOString() : null;

  const result = db.prepare(`
    INSERT INTO blogs (title, slug, excerpt, content, featured_image, author, category, tags, status, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, slug, excerpt || '', content || '', featured_image || '', author || 'Admin', category || '', tags || '', status || 'draft', published_at);

  const blog = db.prepare('SELECT * FROM blogs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ blog });
});

// Admin: update blog
app.put('/api/admin/blogs/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Blog not found.' });

  const { title, slug, excerpt, content, featured_image, author, category, tags, status } = req.body;

  let finalSlug = slug || existing.slug;
  if (title && title !== existing.title && !slug) {
    finalSlug = slugify(title, { lower: true, strict: true });
    const dup = db.prepare('SELECT id FROM blogs WHERE slug = ? AND id != ?').get(finalSlug, req.params.id);
    if (dup) finalSlug += '-' + Date.now();
  }

  let published_at = existing.published_at;
  if (status === 'published' && existing.status !== 'published') {
    published_at = new Date().toISOString();
  }

  db.prepare(`
    UPDATE blogs SET title = ?, slug = ?, excerpt = ?, content = ?, featured_image = ?,
    author = ?, category = ?, tags = ?, status = ?, published_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || existing.title, finalSlug, excerpt ?? existing.excerpt,
    content ?? existing.content, featured_image ?? existing.featured_image,
    author || existing.author, category ?? existing.category, tags ?? existing.tags,
    status || existing.status, published_at, req.params.id
  );

  const blog = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  res.json({ blog });
});

// Admin: delete blog
app.delete('/api/admin/blogs/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Blog not found.' });
  db.prepare('DELETE FROM blogs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// MEDIA ROUTES
// ---------------------------------------------------------------------------
// Admin: list all media
app.get('/api/admin/media', requireAuth, (req, res) => {
  const { search } = req.query;
  let query = 'SELECT * FROM media';
  const params = [];
  if (search) {
    query += ' WHERE original_name LIKE ? OR alt_text LIKE ?';
    const s = `%${search}%`;
    params.push(s, s);
  }
  query += ' ORDER BY uploaded_at DESC';
  const media = db.prepare(query).all(...params);
  res.json({ media });
});

// Admin: upload media
app.post('/api/admin/media', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const fileUrl = `/uploads/${req.file.filename}`;
  const result = db.prepare(`
    INSERT INTO media (filename, original_name, file_path, file_url, file_size, mime_type, alt_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.file.filename, req.file.originalname, req.file.path,
    fileUrl, req.file.size, req.file.mimetype, req.body.alt_text || ''
  );

  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ media });
});

// Admin: update media (alt text)
app.put('/api/admin/media/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Media not found.' });

  const { alt_text } = req.body;
  db.prepare('UPDATE media SET alt_text = ? WHERE id = ?').run(alt_text || '', req.params.id);
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  res.json({ media });
});

// Admin: delete media
app.delete('/api/admin/media/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Media not found.' });

  // Delete file from disk
  if (fs.existsSync(existing.file_path)) {
    fs.unlinkSync(existing.file_path);
  }

  // Clear references in image_slots
  db.prepare("UPDATE image_slots SET image_url = '', alt_text = '', updated_at = datetime('now') WHERE image_url = ?").run(existing.file_url);

  db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// IMAGE SLOTS ROUTES
// ---------------------------------------------------------------------------
// Public: get all image slots (for the frontend to load dynamic images)
app.get('/api/image-slots', (req, res) => {
  const slots = db.prepare('SELECT slot_key, image_url, alt_text FROM image_slots').all();
  const map = {};
  slots.forEach(s => { map[s.slot_key] = { url: s.image_url, alt: s.alt_text }; });
  res.json({ slots: map });
});

// Admin: get all slots with full details
app.get('/api/admin/image-slots', requireAuth, (req, res) => {
  const slots = db.prepare('SELECT * FROM image_slots ORDER BY page, section, label').all();
  res.json({ slots });
});

// Admin: update a slot
app.put('/api/admin/image-slots/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM image_slots WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Image slot not found.' });

  const { image_url, alt_text } = req.body;
  // Support partial updates — only change fields that are explicitly provided
  const finalUrl = image_url !== undefined ? image_url : existing.image_url;
  const finalAlt = alt_text !== undefined ? alt_text : existing.alt_text;
  db.prepare("UPDATE image_slots SET image_url = ?, alt_text = ?, updated_at = datetime('now') WHERE id = ?")
    .run(finalUrl, finalAlt, req.params.id);

  const slot = db.prepare('SELECT * FROM image_slots WHERE id = ?').get(req.params.id);
  res.json({ slot });
});

// ---------------------------------------------------------------------------
// DASHBOARD STATS
// ---------------------------------------------------------------------------
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const totalBlogs = db.prepare('SELECT COUNT(*) as cnt FROM blogs').get().cnt;
  const publishedBlogs = db.prepare("SELECT COUNT(*) as cnt FROM blogs WHERE status = 'published'").get().cnt;
  const draftBlogs = db.prepare("SELECT COUNT(*) as cnt FROM blogs WHERE status = 'draft'").get().cnt;
  const totalMedia = db.prepare('SELECT COUNT(*) as cnt FROM media').get().cnt;
  const recentBlogs = db.prepare('SELECT id, title, status, updated_at FROM blogs ORDER BY updated_at DESC LIMIT 5').all();

  res.json({ totalBlogs, publishedBlogs, draftBlogs, totalMedia, recentBlogs });
});

// ---------------------------------------------------------------------------
// PAGE ROUTES
// ---------------------------------------------------------------------------
// Serve the existing public website
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Blog listing page
app.get('/blog', (req, res) => {
  res.sendFile(path.join(__dirname, 'blog.html'));
});

// Blog post page
app.get('/blog/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'blog-post.html'));
});

// Admin pages
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/admin');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/admin', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get('/admin/*', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ---------------------------------------------------------------------------
// ERROR HANDLING
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  RTBW CMS Server running at http://localhost:${PORT}`);
  console.log(`  Admin panel: http://localhost:${PORT}/admin`);
  console.log(`  Public site: http://localhost:${PORT}/\n`);
});
