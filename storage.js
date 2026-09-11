/**
 * RTBW CMS — Image Storage Layer (Supabase Storage)
 * ---------------------------------------------------------------------------
 * Server-side access to Supabase Storage using the plain Storage REST API and
 * Node's built-in fetch (Node 18+). No Supabase JS SDK is required.
 *
 * The service-role key is used ONLY here, on the server. It is never sent to
 * the browser, never included in API responses, and never exposed in frontend
 * code. Uploaded files get a permanent public URL that is stored in Postgres.
 *
 * Public API:
 *   isConfigured()                     -> boolean
 *   uploadBuffer(buffer, name, mime)   -> { url, path }  (throws on failure)
 *   deleteObject(path)                 -> void           (best-effort)
 */
'use strict';

const path = require('path');
const slugify = require('slugify');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'website-images';

function isConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

// Build a storage object path like "rtbw/shape-sorting-bus-1699999999.webp".
function buildObjectPath(originalName) {
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  const base = slugify(path.basename(originalName, path.extname(originalName)), { lower: true, strict: true }) || 'image';
  return `${base}-${Date.now()}${ext}`;
}

// Public URL for an object in a public bucket.
function publicUrl(objectPath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURI(objectPath)}`;
}

/**
 * Upload a file buffer to Supabase Storage.
 * Resolves with { url, path }. Rejects (throws) if the upload fails, so the
 * caller never stores a broken database reference.
 */
async function uploadBuffer(buffer, originalName, mimeType) {
  if (!isConfigured()) {
    throw new Error('Supabase Storage is not configured.');
  }

  const objectPath = buildObjectPath(originalName);
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(objectPath)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': mimeType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'false',
    },
    body: buffer,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (_) { /* ignore */ }
    throw new Error(`Supabase Storage upload failed (${res.status}): ${detail}`);
  }

  return { url: publicUrl(objectPath), path: objectPath };
}

/**
 * Delete an object from Supabase Storage (best-effort).
 * Does not throw on a missing object — callers still need to clean up the DB.
 */
async function deleteObject(objectPath) {
  if (!isConfigured() || !objectPath) return;

  const endpoint = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(objectPath)}`;
  const res = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
  });

  if (!res.ok && res.status !== 404) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (_) { /* ignore */ }
    throw new Error(`Supabase Storage delete failed (${res.status}): ${detail}`);
  }
}

module.exports = { isConfigured, uploadBuffer, deleteObject, BUCKET };
