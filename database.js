const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'luxora.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    en TEXT NOT NULL DEFAULT '',
    fr TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL CHECK(price > 0),
    category TEXT NOT NULL CHECK(category IN ('fashion','tech','accessories','home')),
    image TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const count = db.prepare('SELECT COUNT(*) AS total FROM products').get().total;
if (count === 0) {
  const seed = [
    ['حقيبة أنيقة','Elegant handbag','Sac élégant',8500,'accessories','https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600'],
    ['ساعة عصرية','Modern watch','Montre moderne',12500,'accessories','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600'],
    ['سماعات لاسلكية','Wireless headphones','Écouteurs sans fil',6500,'tech','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600'],
    ['حذاء رياضي','Sport sneakers','Chaussures sport',9800,'fashion','https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600'],
    ['نظارات شمسية','Sunglasses','Lunettes de soleil',4200,'accessories','https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600'],
    ['مصباح ديكوري','Decorative lamp','Lampe décorative',5700,'home','https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600'],
    ['كاميرا صغيرة','Compact camera','Appareil photo compact',24500,'tech','https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600'],
    ['سترة أنيقة','Stylish jacket','Veste élégante',11000,'fashion','https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600']
  ];
  const insert = db.prepare(`INSERT INTO products (name,en,fr,price,category,image) VALUES (?,?,?,?,?,?)`);
  const seedAll = db.transaction(rows => rows.forEach(row => insert.run(...row)));
  seedAll(seed);
}

module.exports = db;
