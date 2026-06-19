// src/server.js
// Express server — menghubungkan CacheEngine + SQLite database
// Cache-aside pattern: GET → cache? → DB → simpan cache

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const db  = require('./database');
const { CacheEngine, CDNEdgeCache, InvalidationSim } = require('./cache');

const app  = express();
const PORT = 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Global instances ─────────────────────────────────────────────────────────
let cache = new CacheEngine('lru', 8, 15000);
let cdn   = new CDNEdgeCache();
let inv   = new InvalidationSim();

// Inisialisasi DB saat startup


// ─── CACHE-ASIDE: Products ────────────────────────────────────────────────────

// GET /api/products — ambil semua produk (cache-aside)
app.get('/api/products', (req, res) => {
  const key   = 'products:all';
  const start = Date.now();
  let source  = 'cache';

  let data = cache.get(key);
  if (!data) {
    source = 'db';
    data   = db.queryAllProducts();
    cache.set(key, data);
  }

  const latency = Date.now() - start;
  db.logQuery('GET', key, source, latency);
  res.json({ data, source, latency_ms: latency, cache: cache.getStats() });
});

// GET /api/products/:id — ambil produk by ID (cache-aside)
app.get('/api/products/:id', (req, res) => {
  const id    = parseInt(req.params.id);
  const key   = `product:${id}`;
  const start = Date.now();
  let source  = 'cache';

  let data = cache.get(key);
  if (!data) {
    source = 'db';
    data   = db.queryProduct(id);
    if (data) cache.set(key, data);
  }

  const latency = Date.now() - start;
  db.logQuery('GET', key, source, latency);

  if (!data) return res.status(404).json({ error: 'Product not found' });
  res.json({ data, source, latency_ms: latency, cache: cache.getStats() });
});

// PUT /api/products/:id/stock — update stock (write-through ke DB + cache)
app.put('/api/products/:id/stock', (req, res) => {
  const id    = parseInt(req.params.id);
  const { stock, strategy } = req.body;
  const key   = `product:${id}`;
  const start = Date.now();

  let data;
  if (strategy === 'write-through') {
    // Update DB dulu, lalu update cache
    data = db.updateProductStock(id, stock);
    if (data) cache.set(key, data);
    // Invalidasi products:all karena data berubah
    cache.invalidatePrefix('products:all');
  } else if (strategy === 'write-back') {
    // Update cache dulu, DB "later" (disimulasikan)
    data = db.queryProduct(id);
    if (data) { data.stock = stock; cache.set(key, data); }
    // DB update dijadwalkan (simulasi async)
    setTimeout(() => { db.updateProductStock(id, stock); }, 500);
  } else if (strategy === 'write-around') {
    // Langsung ke DB, bypass cache (cache akan miss pada read berikutnya)
    data = db.updateProductStock(id, stock);
    cache.delete(key); // hapus dari cache supaya read berikutnya ambil dari DB
    cache.invalidatePrefix('products:all');
  }

  const latency = Date.now() - start;
  db.logQuery('PUT', key, strategy || 'write-through', latency);
  res.json({ data, strategy, latency_ms: latency, cache: cache.getStats() });
});

// ─── CACHE-ASIDE: Users ───────────────────────────────────────────────────────

app.get('/api/users/:id', (req, res) => {
  const id    = parseInt(req.params.id);
  const key   = `user:${id}`;
  const start = Date.now();
  let source  = 'cache';

  let data = cache.get(key);
  if (!data) {
    source = 'db';
    data   = db.queryUser(id);
    if (data) cache.set(key, data);
  }

  const latency = Date.now() - start;
  db.logQuery('GET', key, source, latency);

  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json({ data, source, latency_ms: latency, cache: cache.getStats() });
});

// ─── CACHE-ASIDE: Orders ──────────────────────────────────────────────────────

app.get('/api/orders/:id', (req, res) => {
  const id    = parseInt(req.params.id);
  const key   = `order:${id}`;
  const start = Date.now();
  let source  = 'cache';

  let data = cache.get(key);
  if (!data) {
    source = 'db';
    data   = db.queryOrder(id);
    if (data) cache.set(key, data);
  }

  const latency = Date.now() - start;
  db.logQuery('GET', key, source, latency);

  if (!data) return res.status(404).json({ error: 'Order not found' });
  res.json({ data, source, latency_ms: latency, cache: cache.getStats() });
});

// ─── CACHE MANAGEMENT ─────────────────────────────────────────────────────────

app.get('/api/cache/stats', (req, res) => {
  res.json(cache.getStats());
});

app.post('/api/cache/config', (req, res) => {
  const { policy, maxSize, ttlMs } = req.body;
  cache.reconfigure(policy, parseInt(maxSize), parseInt(ttlMs));
  res.json({ ok: true, stats: cache.getStats() });
});

app.post('/api/cache/flush', (req, res) => {
  const count = cache.flush();
  res.json({ ok: true, flushed: count });
});

app.delete('/api/cache/:key', (req, res) => {
  const deleted = cache.delete(req.params.key);
  res.json({ deleted });
});

// ─── DB LOG ───────────────────────────────────────────────────────────────────

app.get('/api/db/log', (req, res) => {
  res.json({
    log:   db.getQueryLog(),
    stats: db.getQueryStats(),
  });
});

// ─── CDN ──────────────────────────────────────────────────────────────────────

app.post('/api/cdn/request', (req, res) => {
  const { resource, region } = req.body;
  res.json(cdn.request(resource, region));
});

app.post('/api/cdn/purge', (req, res) => {
  res.json(cdn.purge(req.body.resource));
});

app.get('/api/cdn/status', (req, res) => {
  const total = cdn.hits + cdn.misses;
  res.json({
    edges: cdn.edgeStatus(),
    hitRate: total ? Math.round(cdn.hits / total * 100) : 0,
    originFetches: cdn.misses,
    log: cdn.log.slice(0, 20),
  });
});

// ─── INVALIDATION ─────────────────────────────────────────────────────────────

app.post('/api/inv/add',        (req, res) => res.json(inv.addItem()));
app.post('/api/inv/tick',       (req, res) => res.json(inv.tick()));
app.post('/api/inv/reset',      (req, res) => res.json(inv.reset()));
app.post('/api/inv/invalidate', (req, res) => {
  const { strategy, tag, key } = req.body;
  res.json(inv.invalidate(strategy, tag, key));
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Caching Strategy Simulator             ║');
  console.log(`║   http://localhost:${PORT}                   ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('  Database : SQLite (data.db)');
  console.log('  Cache    : In-memory (LRU/LFU/FIFO/TTL)');
  console.log('  CDN      : Edge cache simulator\n');
});
