// src/database.js
// Database menggunakan JSON file — tidak perlu install library tambahan
// Mensimulasikan relational DB dengan tabel products, users, orders, query_log

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.json');

// ─── Seed data ────────────────────────────────────────────────────────────────
const SEED = {
  products: [
    { id:1,  name:'MacBook Pro 14"',    category:'laptop',     price:25999000, stock:15 },
    { id:2,  name:'iPhone 15 Pro',      category:'smartphone', price:18999000, stock:42 },
    { id:3,  name:'Samsung Galaxy S24', category:'smartphone', price:14999000, stock:38 },
    { id:4,  name:'iPad Air 5',         category:'tablet',     price:9999000,  stock:27 },
    { id:5,  name:'AirPods Pro',        category:'audio',      price:3999000,  stock:80 },
    { id:6,  name:'Dell XPS 13',        category:'laptop',     price:17999000, stock:12 },
    { id:7,  name:'Sony WH-1000XM5',   category:'audio',      price:5499000,  stock:55 },
    { id:8,  name:'Logitech MX Master', category:'peripheral', price:1299000,  stock:90 },
    { id:9,  name:'SSD Samsung 1TB',    category:'storage',    price:1599000,  stock:120 },
    { id:10, name:'Monitor LG 27"',     category:'monitor',    price:4999000,  stock:25 },
  ],
  users: [
    { id:1, username:'budi_santoso',  email:'budi@email.com',  role:'user'  },
    { id:2, username:'siti_rahma',    email:'siti@email.com',  role:'user'  },
    { id:3, username:'agus_wijaya',   email:'agus@email.com',  role:'admin' },
    { id:4, username:'dewi_lestari',  email:'dewi@email.com',  role:'user'  },
    { id:5, username:'rizky_pratama', email:'rizky@email.com', role:'user'  },
  ],
  orders: [
    { id:1, user_id:1, product_id:2,  quantity:1, status:'completed'  },
    { id:2, user_id:2, product_id:5,  quantity:2, status:'completed'  },
    { id:3, user_id:3, product_id:1,  quantity:1, status:'processing' },
    { id:4, user_id:1, product_id:8,  quantity:1, status:'completed'  },
    { id:5, user_id:4, product_id:3,  quantity:1, status:'pending'    },
    { id:6, user_id:5, product_id:9,  quantity:2, status:'completed'  },
    { id:7, user_id:2, product_id:10, quantity:1, status:'processing' },
  ],
  query_log: [],
};

// ─── Load / init DB ───────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(SEED, null, 2));
    console.log('  [DB] data.json created with seed data.');
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Simulate DB latency (50–150ms busy wait) ─────────────────────────────────
function simulateLatency() {
  const ms  = 50 + Math.floor(Math.random() * 100);
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

// ─── Query functions ──────────────────────────────────────────────────────────
function queryProduct(id) {
  simulateLatency();
  const db = loadDB();
  return db.products.find(p => p.id === parseInt(id)) || null;
}

function queryAllProducts() {
  simulateLatency();
  const db = loadDB();
  return db.products;
}

function queryUser(id) {
  simulateLatency();
  const db = loadDB();
  return db.users.find(u => u.id === parseInt(id)) || null;
}

function queryOrder(id) {
  simulateLatency();
  const db = loadDB();
  const order = db.orders.find(o => o.id === parseInt(id));
  if (!order) return null;
  const user    = db.users.find(u => u.id === order.user_id);
  const product = db.products.find(p => p.id === order.product_id);
  return {
    ...order,
    username:     user    ? user.username    : '—',
    product_name: product ? product.name     : '—',
  };
}

function updateProductStock(id, stock) {
  simulateLatency();
  const db  = loadDB();
  const idx = db.products.findIndex(p => p.id === parseInt(id));
  if (idx === -1) return null;
  db.products[idx].stock      = parseInt(stock);
  db.products[idx].updated_at = new Date().toISOString();
  saveDB(db);
  return db.products[idx];
}

// ─── Query log ────────────────────────────────────────────────────────────────
function logQuery(type, key, source, latency) {
  const db = loadDB();
  db.query_log.unshift({
    id:         (db.query_log[0]?.id || 0) + 1,
    query_type: type,
    key,
    source,
    latency_ms: latency,
    ts:         new Date().toLocaleTimeString('id-ID', { hour12: false }),
  });
  if (db.query_log.length > 100) db.query_log = db.query_log.slice(0, 100);
  saveDB(db);
}

function getQueryLog(limit = 30) {
  const db = loadDB();
  return db.query_log.slice(0, limit);
}

function getQueryStats() {
  const db       = loadDB();
  const log      = db.query_log;
  const total    = log.length;
  const fromDB   = log.filter(e => e.source === 'db').length;
  const fromCache = log.filter(e => e.source === 'cache').length;
  const avgLat   = total ? log.reduce((s, e) => s + (e.latency_ms || 0), 0) / total : 0;
  return {
    total, fromDB, fromCache,
    hitRate:    total ? Math.round(fromCache / total * 100) : 0,
    avgLatency: Math.round(avgLat * 10) / 10,
  };
}

// Init on load
loadDB();

module.exports = {
  queryProduct, queryAllProducts, queryUser, queryOrder,
  updateProductStock, logQuery, getQueryLog, getQueryStats,
};
