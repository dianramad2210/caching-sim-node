# ⚡ Caching Strategy Simulator

**Nama:** Dian Ramadhani  
**Kelas:** RPL A  
**NIM:** 105841116323
**Mata Kuliah:** Scalable Systems Design

Simulasi strategi caching untuk mata kuliah **Scalable Systems Design**.
Mengimplementasikan cache-aside pattern dengan in-memory cache (simulasi Redis/Memcached) di depan database SQLite.

---

## 📄 Laporan

Laporan lengkap tersedia pada folder:

docs/Laporan.pdf

## 🚀 Cara Menjalankan

### 1. Install dependencies
```bash
npm install
```

### 2. Jalankan server
```bash
node src/server.js
```

### 3. Buka browser
```
http://localhost:3000
```

> `data.db` akan dibuat otomatis beserta tabel dan seed data saat server pertama kali dijalankan.

---

## 🗄️ Database (SQLite)

Tabel yang tersedia:

| Tabel | Isi |
|-------|-----|
| `products` | 10 produk elektronik dengan nama, kategori, harga, stok |
| `users` | 5 user dengan username, email, role |
| `orders` | 7 order yang menghubungkan user dan produk |
| `query_log` | Log setiap query (source: cache/db, latency) |

Setiap query ke DB disimulasikan dengan latency **50–150ms** untuk merepresentasikan I/O latency nyata.

---

## ⚙️ Fitur

### 1. Cache Engine
Mensimulasikan Redis/Memcached dengan 4 eviction policy:

| Policy | Cara Kerja |
|--------|-----------|
| **LRU** | Hapus item yang paling lama tidak diakses |
| **LFU** | Hapus item dengan frekuensi akses paling rendah |
| **FIFO** | Hapus item yang pertama kali masuk |
| **TTL** | Hapus item yang sudah melewati batas waktu |

### 2. Cache-Aside Pattern
```
Request datang
    │
    ▼
Cek cache ──── HIT ────▶ Return data (cepat, <5ms)
    │
   MISS
    │
    ▼
Query SQLite (50–150ms)
    │
    ▼
Simpan ke cache
    │
    ▼
Return data
```

### 3. Write Strategies

| Strategy | Cara Kerja | Konsistensi | Latency |
|----------|-----------|-------------|---------|
| **Write-through** | Update cache + DB bersamaan | Strong | Tinggi |
| **Write-back** | Update cache dulu, DB async | Eventual | Rendah |
| **Write-around** | Langsung ke DB, bypass cache | Eventual | Sedang |

### 4. CDN Simulator
Mensimulasikan 4 edge node dengan latency berbeda:

| Region | Edge Latency | Origin Latency |
|--------|-------------|----------------|
| Jakarta | 12–17ms | ~230ms |
| Singapore | 8–13ms | ~185ms |
| New York | 95–100ms | ~420ms |
| Frankfurt | 78–83ms | ~390ms |

TTL per tipe resource:
- `img/logo.png` → 86400s (1 hari)
- `js/app.bundle.js` → 3600s (1 jam)
- `api/user/profile` → 30s
- `css/style.css` → 7200s (2 jam)

### 5. Cache Invalidation

| Strategy | Cara Kerja |
|----------|-----------|
| **TTL sweep** | Hapus semua item yang sudah expired |
| **Tag-based** | Hapus semua item dengan tag tertentu (user/product/session/order) |
| **Key-based** | Hapus satu item berdasarkan key spesifik |
| **Write-through refresh** | Refresh item secara langsung tanpa menghapus |

---

## 🔌 API Endpoints

### Cache
| Method | Endpoint | Keterangan |
|--------|----------|-----------|
| GET | `/api/cache/stats` | Statistik cache (hit rate, slots, log) |
| POST | `/api/cache/config` | Ubah policy, maxSize, ttlMs |
| POST | `/api/cache/flush` | Hapus semua isi cache |
| DELETE | `/api/cache/:key` | Hapus key tertentu |

### Data (Cache-Aside)
| Method | Endpoint | Keterangan |
|--------|----------|-----------|
| GET | `/api/products` | Semua produk |
| GET | `/api/products/:id` | Produk by ID |
| PUT | `/api/products/:id/stock` | Update stok (dengan write strategy) |
| GET | `/api/users/:id` | User by ID |
| GET | `/api/orders/:id` | Order by ID |
| GET | `/api/db/log` | Log query + statistik |

### CDN
| Method | Endpoint | Keterangan |
|--------|----------|-----------|
| POST | `/api/cdn/request` | Simulasi request ke edge |
| POST | `/api/cdn/purge` | Purge resource dari semua edge |
| GET | `/api/cdn/status` | Status semua edge node |

### Invalidation
| Method | Endpoint | Keterangan |
|--------|----------|-----------|
| POST | `/api/inv/add` | Tambah item ke cache simulasi |
| POST | `/api/inv/tick` | Majukan waktu simulasi +5s |
| POST | `/api/inv/invalidate` | Jalankan invalidation strategy |
| POST | `/api/inv/reset` | Reset simulasi |

---

## 📊 Konsep yang Diimplementasikan

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENT                             │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP Request
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  EXPRESS SERVER                         │
│                   (server.js)                           │
└────────────┬────────────────────────┬───────────────────┘
             │                        │
             ▼                        ▼
┌────────────────────┐    ┌───────────────────────┐
│   CACHE ENGINE     │    │   SQLite DATABASE     │
│   (cache.js)       │    │   (database.js)       │
│                    │    │                       │
│ • LRU / LFU / FIFO │    │ • products            │
│ • TTL expiry       │    │ • users               │
│ • Eviction         │    │ • orders              │
│ • Invalidation     │    │ • query_log           │
└────────────────────┘    └───────────────────────┘
```

---

## 📝 Catatan

- Cache engine bersifat **in-memory** — data hilang saat server di-restart
- Database SQLite **persisten** — data tetap ada di `data.db`
- Simulasi latency DB menggunakan busy-wait loop (bukan I/O asli)
- CDN dan Invalidation simulator berjalan sepenuhnya di memory

---

## 📚 Referensi

- [Redis Documentation](https://redis.io/docs)
- [Memcached Documentation](https://memcached.org)
- [Cache-Aside Pattern](https://docs.microsoft.com/azure/architecture/patterns/cache-aside)
- [HTTP Caching (CDN)](https://web.dev/http-cache/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
