// src/cache.js
// In-memory cache engine — mensimulasikan Redis/Memcached
// Mendukung: LRU, LFU, FIFO, TTL
// Cache-aside pattern: GET → miss? → fetch DB → store cache

class CacheEngine {
  constructor(policy = 'lru', maxSize = 8, ttlMs = 15000) {
    this.policy  = policy;
    this.maxSize = maxSize;
    this.ttlMs   = ttlMs;   // default TTL 15 detik
    this.store   = new Map();    // key → entry
    this.freq    = new Map();    // key → access count (LFU)
    this.insertOrder = [];       // insertion order (FIFO)
    this.accessOrder = [];       // recency order (LRU)
    this.hits    = 0;
    this.misses  = 0;
    this.evictions = 0;
    this.sets    = 0;
    this.log     = [];           // activity log
  }

  // ─── GET ──────────────────────────────────────────────────────────────────
  get(key) {
    // TTL check: hapus entry yang expired
    if (this.store.has(key)) {
      const entry = this.store.get(key);
      if (Date.now() - entry.ts > this.ttlMs) {
        this.store.delete(key);
        this.freq.delete(key);
        this.insertOrder = this.insertOrder.filter(k => k !== key);
        this.accessOrder = this.accessOrder.filter(k => k !== key);
        this._log('expired', `EXPIRED  key=${key}  (TTL=${this.ttlMs}ms)`);
        this.misses++;
        return null;
      }
    }

    if (!this.store.has(key)) {
      this.misses++;
      return null;
    }

    this.hits++;
    const entry = this.store.get(key);
    entry.lastAccess = Date.now();

    // Update metadata per policy
    this.freq.set(key, (this.freq.get(key) || 0) + 1);
    // LRU: pindah ke belakang (most recently used)
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);

    this._log('hit', `HIT      key=${key}  freq=${this.freq.get(key)}  age=${Math.round((Date.now()-entry.ts)/1000)}s`);
    return entry.value;
  }

  // ─── SET ──────────────────────────────────────────────────────────────────
  set(key, value) {
    // Update jika sudah ada
    if (this.store.has(key)) {
      const entry = this.store.get(key);
      entry.value = value;
      entry.ts    = Date.now();
      this._log('set', `UPDATE   key=${key}`);
      return;
    }

    // Evict jika penuh
    if (this.store.size >= this.maxSize) {
      this._evict();
    }

    this.store.set(key, { value, ts: Date.now(), lastAccess: Date.now() });
    this.freq.set(key, 1);
    this.insertOrder.push(key);
    this.accessOrder.push(key);
    this.sets++;
    this._log('set', `SET      key=${key}`);
  }

  // ─── DELETE ───────────────────────────────────────────────────────────────
  delete(key) {
    if (!this.store.has(key)) return false;
    this.store.delete(key);
    this.freq.delete(key);
    this.insertOrder = this.insertOrder.filter(k => k !== key);
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this._log('del', `DELETE   key=${key}`);
    return true;
  }

  // ─── INVALIDATE BY PREFIX ─────────────────────────────────────────────────
  invalidatePrefix(prefix) {
    let count = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.delete(key);
        count++;
      }
    }
    this._log('invalidate', `INVALIDATE prefix=${prefix}  removed=${count}`);
    return count;
  }

  // ─── FLUSH ALL ────────────────────────────────────────────────────────────
  flush() {
    const count = this.store.size;
    this.store.clear();
    this.freq.clear();
    this.insertOrder = [];
    this.accessOrder = [];
    this._log('flush', `FLUSH    cleared ${count} keys`);
    return count;
  }

  // ─── EVICTION ─────────────────────────────────────────────────────────────
  _evict() {
    let victim = null;

    if (this.policy === 'lru') {
      // Least Recently Used — kepala accessOrder
      victim = this.accessOrder[0];
    } else if (this.policy === 'lfu') {
      // Least Frequently Used — freq terendah
      let minFreq = Infinity;
      for (const [k, f] of this.freq.entries()) {
        if (this.store.has(k) && f < minFreq) { minFreq = f; victim = k; }
      }
    } else if (this.policy === 'fifo') {
      // First In First Out — kepala insertOrder
      victim = this.insertOrder[0];
    } else if (this.policy === 'ttl') {
      // Evict yang paling tua (ts terkecil)
      let oldest = Infinity;
      for (const [k, v] of this.store.entries()) {
        if (v.ts < oldest) { oldest = v.ts; victim = k; }
      }
    }

    if (victim) {
      this.store.delete(victim);
      this.freq.delete(victim);
      this.insertOrder = this.insertOrder.filter(k => k !== victim);
      this.accessOrder = this.accessOrder.filter(k => k !== victim);
      this.evictions++;
      this._log('evict', `EVICT    [${this.policy.toUpperCase()}] removed key=${victim}`);
    }
  }

  // ─── CDN EDGE CACHE ───────────────────────────────────────────────────────
  // Terpisah dari main cache, mensimulasikan edge node
  // (dikelola di server.js)

  // ─── STATS ────────────────────────────────────────────────────────────────
  getStats() {
    const total = this.hits + this.misses;
    const slots = [];
    for (const [key, entry] of this.store.entries()) {
      const age = Math.round((Date.now() - entry.ts) / 1000);
      const ttlLeft = Math.max(0, Math.round((this.ttlMs - (Date.now() - entry.ts)) / 1000));
      slots.push({
        key,
        value: typeof entry.value === 'object' ? JSON.stringify(entry.value).slice(0, 60) + '…' : String(entry.value).slice(0, 60),
        freq: this.freq.get(key) || 0,
        age,
        ttlLeft,
      });
    }
    return {
      policy:    this.policy,
      maxSize:   this.maxSize,
      ttlMs:     this.ttlMs,
      used:      this.store.size,
      hits:      this.hits,
      misses:    this.misses,
      evictions: this.evictions,
      sets:      this.sets,
      hitRate:   total ? Math.round(this.hits / total * 100) : 0,
      slots,
      log:       this.log.slice(0, 25),
    };
  }

  reconfigure(policy, maxSize, ttlMs) {
    this.policy  = policy  || this.policy;
    this.maxSize = maxSize || this.maxSize;
    this.ttlMs   = ttlMs   || this.ttlMs;
    this.flush();
    this.hits = 0; this.misses = 0; this.evictions = 0; this.sets = 0;
    this.log = [];
    this._log('config', `CONFIG   policy=${this.policy}  size=${this.maxSize}  ttl=${this.ttlMs}ms`);
  }

  _log(kind, msg) {
    this.log.unshift({
      time: new Date().toLocaleTimeString('id-ID', { hour12: false }),
      kind,
      msg,
    });
    if (this.log.length > 60) this.log.pop();
  }
}

// ─── CDN Edge Simulator ────────────────────────────────────────────────────────
class CDNEdgeCache {
  constructor() {
    this.regions = {
      'Jakarta':   { baseMs: 12, originMs: 230 },
      'Singapore': { baseMs:  8, originMs: 185 },
      'New York':  { baseMs: 95, originMs: 420 },
      'Frankfurt': { baseMs: 78, originMs: 390 },
    };
    this.resourceTTL = {
      'img/logo.png':      86400 * 1000,
      'js/app.bundle.js':   3600 * 1000,
      'api/user/profile':     30 * 1000,
      'css/style.css':      7200 * 1000,
    };
    this.edges  = {};
    for (const r of Object.keys(this.regions)) this.edges[r] = {};
    this.hits   = 0;
    this.misses = 0;
    this.log    = [];
  }

  request(resource, region) {
    const cfg = this.regions[region];
    const ttl = this.resourceTTL[resource] || 60000;
    const edge = this.edges[region];
    const now  = Date.now();
    let latency, status;

    if (edge[resource] && (now - edge[resource].ts) < ttl) {
      this.hits++;
      latency = cfg.baseMs + Math.floor(Math.random() * 5);
      status  = 'HIT';
    } else {
      this.misses++;
      latency = cfg.originMs + Math.floor(Math.random() * 40) - 20;
      edge[resource] = { ts: now };
      status = 'MISS';
    }

    const entry = {
      time: new Date().toLocaleTimeString('id-ID', { hour12: false }),
      status, region, resource, latency,
      ttlSec: Math.round(ttl / 1000),
    };
    this.log.unshift(entry);
    if (this.log.length > 40) this.log.pop();

    const total = this.hits + this.misses;
    return { ...entry, hitRate: total ? Math.round(this.hits / total * 100) : 0, originFetches: this.misses };
  }

  purge(resource) {
    let purged = 0;
    for (const region of Object.keys(this.edges)) {
      if (this.edges[region][resource]) { delete this.edges[region][resource]; purged++; }
    }
    const entry = {
      time: new Date().toLocaleTimeString('id-ID', { hour12: false }),
      status: 'PURGE', region: 'ALL', resource, latency: 0, purgedNodes: purged,
    };
    this.log.unshift(entry);
    return entry;
  }

  edgeStatus() {
    const now = Date.now();
    const result = {};
    for (const [region, cached] of Object.entries(this.edges)) {
      let fresh = 0, stale = 0;
      for (const [res, meta] of Object.entries(cached)) {
        const ttl = this.resourceTTL[res] || 60000;
        now - meta.ts < ttl ? fresh++ : stale++;
      }
      result[region] = { baseMs: this.regions[region].baseMs, total: Object.keys(cached).length, fresh, stale };
    }
    return result;
  }
}

// ─── Invalidation Simulator ───────────────────────────────────────────────────
class InvalidationSim {
  constructor() { this.reset(); }

  reset() {
    this._keys = [
      { key: 'user:profile:1',   tags: ['user'] },
      { key: 'user:profile:2',   tags: ['user'] },
      { key: 'product:detail:42',tags: ['product'] },
      { key: 'session:tok_abc',  tags: ['session'] },
      { key: 'order:status:7',   tags: ['order', 'user'] },
      { key: 'product:list',     tags: ['product'] },
      { key: 'user:avatar:1',    tags: ['user'] },
      { key: 'session:tok_xyz',  tags: ['session'] },
    ];
    this.items   = {};
    this.simTime = 0;
    this.ops     = 0;
    this.log     = [];
    this._idx    = 0;
    return this._snap();
  }

  addItem() {
    const { key, tags } = this._keys[this._idx % this._keys.length];
    this._idx++;
    const ttl = 12 + Math.floor(Math.random() * 18);
    this.items[key] = { ts: this.simTime, ttl, tags, fresh: true };
    this.log.unshift({ time: `t+${this.simTime}s`, kind: 'store', msg: `STORE  ${key}  TTL=${ttl}s  tags=[${tags}]` });
    return this._snap();
  }

  tick(sec = 5) {
    this.simTime += sec;
    for (const v of Object.values(this.items)) {
      if (this.simTime - v.ts >= v.ttl) v.fresh = false;
    }
    this.log.unshift({ time: `t+${this.simTime}s`, kind: 'tick', msg: `TICK  +${sec}s  sim_time=${this.simTime}s` });
    return this._snap();
  }

  invalidate(strategy, tag = null, key = null) {
    this.ops++;
    let affected = [];
    if (strategy === 'ttl') {
      affected = Object.keys(this.items).filter(k => !this.items[k].fresh);
      affected.forEach(k => delete this.items[k]);
      this.log.unshift({ time: `t+${this.simTime}s`, kind: 'invalidate', msg: `TTL SWEEP  removed=${affected.length}` });
    } else if (strategy === 'tag' && tag) {
      affected = Object.keys(this.items).filter(k => this.items[k].tags.includes(tag));
      affected.forEach(k => delete this.items[k]);
      this.log.unshift({ time: `t+${this.simTime}s`, kind: 'invalidate', msg: `TAG "${tag}"  removed=${affected.length}` });
    } else if (strategy === 'key' && key) {
      if (this.items[key]) { delete this.items[key]; affected.push(key); }
      this.log.unshift({ time: `t+${this.simTime}s`, kind: 'invalidate', msg: `KEY "${key}"  deleted` });
    } else if (strategy === 'write') {
      const keys = Object.keys(this.items);
      if (keys.length) {
        const k = keys[Math.floor(Math.random() * keys.length)];
        this.items[k].fresh = true; this.items[k].ts = this.simTime;
        affected.push(k);
        this.log.unshift({ time: `t+${this.simTime}s`, kind: 'invalidate', msg: `WRITE-THROUGH  refreshed "${k}"` });
      }
    }
    return this._snap();
  }

  _snap() {
    const items = Object.entries(this.items).map(([key, v]) => ({
      key, ...v, age: this.simTime - v.ts,
    }));
    return {
      items, simTime: this.simTime,
      total: items.length,
      stale: items.filter(i => !i.fresh).length,
      ops: this.ops,
      log: this.log.slice(0, 25),
    };
  }
}

module.exports = { CacheEngine, CDNEdgeCache, InvalidationSim };
