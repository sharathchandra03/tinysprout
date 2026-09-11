/**
 * RTBW CMS Server (production-safe)
 * ---------------------------------------------------------------------------
 * Express backend for blog management, media uploads and image/text slots.
 *
 * PERSISTENCE (fixes data loss on Render):
 *   - All admin-managed data (blogs, image-slot URLs, editable text, media
 *     references, admin user) is stored in PostgreSQL via ./db.js.
 *   - Uploaded images are stored in Supabase Storage (persistent object
 *     storage), NOT on Render's ephemeral local disk. The database stores the
 *     permanent public URL and the storage path.
 *   - Sessions are stored in PostgreSQL (connect-pg-simple), so admin logins
 *     survive restarts and work across multiple instances.
 *
 * Nothing that the Admin Panel writes touches Render's local filesystem, so
 * data survives redeploys, restarts, crashes, instance replacement and rebuilds.
 */
'use strict';

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');

const db = require('./db');
const storage = require('./storage');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'rtbw-dev-secret-change-in-prod';
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// IMAGE STORAGE (Supabase Storage — configured in ./storage.js)
// ---------------------------------------------------------------------------
if (!storage.isConfigured()) {
  console.warn('\n  WARNING: Supabase Storage is not configured. Image uploads will fail.');
  console.warn('  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n');
}

// ---------------------------------------------------------------------------
// FILE UPLOAD CONFIG (memory storage — nothing written to local disk)
// ---------------------------------------------------------------------------
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, JPEG, PNG, and WEBP are allowed.'));
    }
  },
});

// ---------------------------------------------------------------------------
// EXPRESS APP
// ---------------------------------------------------------------------------
const app = express();

// Behind Render's proxy — needed for secure cookies.
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
  },
}));

// Static assets that ship with the repo (these are part of the code, not
// admin-managed data, so serving them from disk is fine and persistent).
app.use('/image assets', express.static(path.join(__dirname, 'image assets')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ---------------------------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/admin/login');
}

// Wrap async route handlers so rejected promises hit the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await db.one('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  req.session.userId = user.id;
  req.session.userName = user.name;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const user = await db.one('SELECT id, email, name FROM users WHERE id = $1', [req.session.userId]);
  res.json({ user });
}));

// ---------------------------------------------------------------------------
// BLOG ROUTES
// ---------------------------------------------------------------------------
// Public: get published blogs
app.get('/api/blogs', wrap(async (req, res) => {
  const { page = 1, limit = 12, category, search } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  let where = "WHERE status = 'published'";
  const params = [];

  if (category) {
    params.push(category);
    where += ` AND category = $${params.length}`;
  }
  if (search) {
    const s = `%${search}%`;
    params.push(s, s, s);
    where += ` AND (title ILIKE $${params.length - 2} OR excerpt ILIKE $${params.length - 1} OR tags ILIKE $${params.length})`;
  }

  const total = (await db.one(`SELECT COUNT(*)::int AS cnt FROM blogs ${where}`, params)).cnt;
  params.push(Number(limit), Number(offset));
  const blogs = (await db.query(
    `SELECT id, title, slug, excerpt, featured_image, author, category, tags, status, published_at, created_at
     FROM blogs ${where} ORDER BY COALESCE(published_at, created_at) DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )).rows;

  res.json({ blogs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
}));

// Public: get single blog by slug
app.get('/api/blogs/:slug', wrap(async (req, res) => {
  const blog = await db.one("SELECT * FROM blogs WHERE slug = $1 AND status = 'published'", [req.params.slug]);
  if (!blog) return res.status(404).json({ error: 'Blog not found.' });
  res.json({ blog });
}));

// Admin: get all blogs (including drafts)
app.get('/api/admin/blogs', requireAuth, wrap(async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  let where = 'WHERE 1=1';
  const params = [];

  if (status && status !== 'all') {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  if (search) {
    const s = `%${search}%`;
    params.push(s, s, s);
    where += ` AND (title ILIKE $${params.length - 2} OR excerpt ILIKE $${params.length - 1} OR tags ILIKE $${params.length})`;
  }

  const total = (await db.one(`SELECT COUNT(*)::int AS cnt FROM blogs ${where}`, params)).cnt;
  params.push(Number(limit), Number(offset));
  const blogs = (await db.query(
    `SELECT * FROM blogs ${where} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )).rows;

  res.json({ blogs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
}));

// Admin: get single blog by id
app.get('/api/admin/blogs/:id', requireAuth, wrap(async (req, res) => {
  const blog = await db.one('SELECT * FROM blogs WHERE id = $1', [req.params.id]);
  if (!blog) return res.status(404).json({ error: 'Blog not found.' });
  res.json({ blog });
}));

// Admin: create blog
app.post('/api/admin/blogs', requireAuth, wrap(async (req, res) => {
  const { title, excerpt, content, featured_image, author, category, tags, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required.' });

  let slug = slugify(title, { lower: true, strict: true });
  const existing = await db.one('SELECT id FROM blogs WHERE slug = $1', [slug]);
  if (existing) slug += '-' + Date.now();

  const published_at = status === 'published' ? new Date().toISOString() : null;

  const inserted = await db.one(
    `INSERT INTO blogs (title, slug, excerpt, content, featured_image, author, category, tags, status, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [title, slug, excerpt || '', content || '', featured_image || '', author || 'Admin',
     category || '', tags || '', status || 'draft', published_at]
  );
  res.status(201).json({ blog: inserted });
}));

// Admin: update blog
app.put('/api/admin/blogs/:id', requireAuth, wrap(async (req, res) => {
  const existing = await db.one('SELECT * FROM blogs WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Blog not found.' });

  const { title, slug, excerpt, content, featured_image, author, category, tags, status } = req.body;

  let finalSlug = slug || existing.slug;
  if (title && title !== existing.title && !slug) {
    finalSlug = slugify(title, { lower: true, strict: true });
    const dup = await db.one('SELECT id FROM blogs WHERE slug = $1 AND id <> $2', [finalSlug, req.params.id]);
    if (dup) finalSlug += '-' + Date.now();
  }

  let published_at = existing.published_at;
  if (status === 'published' && existing.status !== 'published') {
    published_at = new Date().toISOString();
  }

  const blog = await db.one(
    `UPDATE blogs SET title=$1, slug=$2, excerpt=$3, content=$4, featured_image=$5,
       author=$6, category=$7, tags=$8, status=$9, published_at=$10, updated_at=now()
     WHERE id=$11 RETURNING *`,
    [
      title || existing.title, finalSlug, excerpt ?? existing.excerpt,
      content ?? existing.content, featured_image ?? existing.featured_image,
      author || existing.author, category ?? existing.category, tags ?? existing.tags,
      status || existing.status, published_at, req.params.id,
    ]
  );
  res.json({ blog });
}));

// Admin: delete blog
app.delete('/api/admin/blogs/:id', requireAuth, wrap(async (req, res) => {
  const existing = await db.one('SELECT id FROM blogs WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Blog not found.' });
  await db.query('DELETE FROM blogs WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// MEDIA ROUTES
// ---------------------------------------------------------------------------
// Admin: list all media
app.get('/api/admin/media', requireAuth, wrap(async (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM media';
  const params = [];
  if (search) {
    const s = `%${search}%`;
    params.push(s, s);
    sql += ' WHERE original_name ILIKE $1 OR alt_text ILIKE $2';
  }
  sql += ' ORDER BY uploaded_at DESC';
  const media = (await db.query(sql, params)).rows;
  res.json({ media });
}));

// Admin: upload media -> Supabase Storage -> store permanent URL in Postgres
app.post('/api/admin/media', requireAuth, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!storage.isConfigured()) {
    return res.status(500).json({ error: 'Image storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.' });
  }

  // Upload to Supabase Storage FIRST. Only write a DB row if the upload
  // succeeded, so we never store a broken reference.
  let result;
  try {
    result = await storage.uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  } catch (err) {
    console.error('Supabase Storage upload failed:', err && err.message ? err.message : err);
    return res.status(502).json({ error: 'Image upload to storage failed. Please try again.' });
  }

  // result.url  -> permanent public URL (stored as file_url)
  // result.path -> storage object path (stored as storage_id, used for deletion)
  const media = await db.one(
    `INSERT INTO media (filename, original_name, file_path, file_url, file_size, mime_type, alt_text, storage_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      result.path, req.file.originalname, result.url, result.url,
      req.file.size || 0, req.file.mimetype, req.body.alt_text || '', result.path,
    ]
  );
  res.status(201).json({ media });
}));

// Admin: update media (alt text)
app.put('/api/admin/media/:id', requireAuth, wrap(async (req, res) => {
  const existing = await db.one('SELECT id FROM media WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Media not found.' });

  const media = await db.one(
    'UPDATE media SET alt_text = $1 WHERE id = $2 RETURNING *',
    [req.body.alt_text || '', req.params.id]
  );
  res.json({ media });
}));

// Admin: delete media (removes DB row, the Supabase object, and any slot refs)
app.delete('/api/admin/media/:id', requireAuth, wrap(async (req, res) => {
  const existing = await db.one('SELECT * FROM media WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Media not found.' });

  // Remove the object from Supabase Storage so obsolete images don't linger.
  if (existing.storage_id && storage.isConfigured()) {
    try {
      await storage.deleteObject(existing.storage_id);
    } catch (err) {
      // Log but don't block DB cleanup — the reference must still be removed.
      console.warn('Supabase Storage delete failed for', existing.storage_id, err && err.message);
    }
  }

  // Clear references in image_slots that pointed at this file.
  await db.query(
    "UPDATE image_slots SET image_url = '', alt_text = '', updated_at = now() WHERE image_url = $1",
    [existing.file_url]
  );

  await db.query('DELETE FROM media WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// IMAGE SLOTS ROUTES
// ---------------------------------------------------------------------------
// Public: get all image slots (for the frontend to load dynamic images)
app.get('/api/image-slots', wrap(async (req, res) => {
  const slots = (await db.query('SELECT slot_key, image_url, alt_text FROM image_slots')).rows;
  const map = {};
  slots.forEach((s) => { map[s.slot_key] = { url: s.image_url, alt: s.alt_text }; });
  res.json({ slots: map });
}));

// Admin: get all slots with full details
app.get('/api/admin/image-slots', requireAuth, wrap(async (req, res) => {
  const slots = (await db.query('SELECT * FROM image_slots ORDER BY page, section, label')).rows;
  res.json({ slots });
}));

// Admin: update a slot
app.put('/api/admin/image-slots/:id', requireAuth, wrap(async (req, res) => {
  const existing = await db.one('SELECT * FROM image_slots WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Image slot not found.' });

  const { image_url, alt_text } = req.body;
  const finalUrl = image_url !== undefined ? image_url : existing.image_url;
  const finalAlt = alt_text !== undefined ? alt_text : existing.alt_text;
  const slot = await db.one(
    'UPDATE image_slots SET image_url = $1, alt_text = $2, updated_at = now() WHERE id = $3 RETURNING *',
    [finalUrl, finalAlt, req.params.id]
  );
  res.json({ slot });
}));

// ---------------------------------------------------------------------------
// TEXT SLOTS ROUTES
// ---------------------------------------------------------------------------
// Public: get all text slots as a { key: content } map (front-end applies them)
app.get('/api/text-slots', wrap(async (req, res) => {
  const slots = (await db.query('SELECT slot_key, content FROM text_slots')).rows;
  const map = {};
  slots.forEach((s) => { map[s.slot_key] = s.content; });
  res.json({ slots: map });
}));

// Admin: get all text slots with full details
app.get('/api/admin/text-slots', requireAuth, wrap(async (req, res) => {
  const slots = (await db.query('SELECT * FROM text_slots ORDER BY page, section, slot_key')).rows;
  res.json({ slots });
}));

// Admin: update a text slot's content
app.put('/api/admin/text-slots/:id', requireAuth, wrap(async (req, res) => {
  const existing = await db.one('SELECT id FROM text_slots WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Text slot not found.' });

  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content is required.' });

  const slot = await db.one(
    'UPDATE text_slots SET content = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [String(content), req.params.id]
  );
  res.json({ slot });
}));

// ---------------------------------------------------------------------------
// DASHBOARD STATS
// ---------------------------------------------------------------------------
app.get('/api/admin/stats', requireAuth, wrap(async (req, res) => {
  const totalBlogs = (await db.one('SELECT COUNT(*)::int AS cnt FROM blogs')).cnt;
  const publishedBlogs = (await db.one("SELECT COUNT(*)::int AS cnt FROM blogs WHERE status = 'published'")).cnt;
  const draftBlogs = (await db.one("SELECT COUNT(*)::int AS cnt FROM blogs WHERE status = 'draft'")).cnt;
  const totalMedia = (await db.one('SELECT COUNT(*)::int AS cnt FROM media')).cnt;
  const recentBlogs = (await db.query('SELECT id, title, status, updated_at FROM blogs ORDER BY updated_at DESC LIMIT 5')).rows;

  res.json({ totalBlogs, publishedBlogs, draftBlogs, totalMedia, recentBlogs });
}));

// ---------------------------------------------------------------------------
// PAGE ROUTES
// ---------------------------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, 'blog.html')));
app.get('/blog/:slug', (req, res) => res.sendFile(path.join(__dirname, 'blog-post.html')));

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
(async () => {
  try {
    await db.initDb();
    app.listen(PORT, () => {
      console.log(`\n  RTBW CMS Server running at http://localhost:${PORT}`);
      console.log(`  Admin panel: http://localhost:${PORT}/admin`);
      console.log(`  Public site: http://localhost:${PORT}/\n`);
    });
  } catch (err) {
    console.error('\n  FATAL: Failed to initialise the database.');
    console.error('  Check DATABASE_URL and that PostgreSQL is reachable.\n');
    console.error(err);
    process.exit(1);
  }
})();
