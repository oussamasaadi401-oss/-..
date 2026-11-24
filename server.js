const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// قراءة إعدادات .env دون الحاجة إلى مكتبات خارجية.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const db = require('./database');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const adminTokens = new Set();
const INDEX_FILE = path.join(__dirname, 'public', 'index.html');

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('حجم البيانات كبير جداً'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('بيانات JSON غير صالحة')); }
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return Boolean(token && adminTokens.has(token));
}

function validProduct(body) {
  const categories = ['fashion', 'tech', 'accessories', 'home'];
  return body && typeof body.name === 'string' && body.name.trim() &&
    Number.isFinite(Number(body.price)) && Number(body.price) > 0 &&
    categories.includes(body.category) && typeof body.image === 'string' && /^https?:\/\//i.test(body.image);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  const method = req.method;

  if (method === 'GET' && route === '/') {
    if (!fs.existsSync(INDEX_FILE)) return sendJson(res, 500, { error: 'ملف public/index.html غير موجود' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(INDEX_FILE).pipe(res);
  }

  if (method === 'GET' && route === '/api/health') return sendJson(res, 200, { ok: true, service: 'LUXORA API' });

  if (method === 'GET' && route === '/api/products') {
    return sendJson(res, 200, db.prepare('SELECT id,name,en,fr,price,category,image FROM products ORDER BY id ASC').all());
  }

  if (method === 'POST' && route === '/api/admin/login') {
    const body = await readJson(req);
    if (body.password !== ADMIN_PASSWORD) return sendJson(res, 401, { error: 'كلمة المرور غير صحيحة' });
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    return sendJson(res, 200, { token });
  }

  if (method === 'POST' && route === '/api/products') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: 'يلزم تسجيل دخول الإدارة' });
    const p = await readJson(req);
    if (!validProduct(p)) return sendJson(res, 400, { error: 'بيانات المنتج غير صالحة' });
    const result = db.prepare('INSERT INTO products (name,en,fr,price,category,image) VALUES (?,?,?,?,?,?)')
      .run(p.name.trim(), String(p.en || ''), String(p.fr || ''), Number(p.price), p.category, p.image.trim());
    const product = db.prepare('SELECT id,name,en,fr,price,category,image FROM products WHERE id=?').get(Number(result.lastInsertRowid));
    return sendJson(res, 201, product);
  }

  const deleteMatch = route.match(/^\/api\/products\/(\d+)$/);
  if (method === 'DELETE' && deleteMatch) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: 'يلزم تسجيل دخول الإدارة' });
    const result = db.prepare('DELETE FROM products WHERE id=?').run(Number(deleteMatch[1]));
    if (!result.changes) return sendJson(res, 404, { error: 'المنتج غير موجود' });
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && route === '/api/orders') {
    const { customer, items, discountCode } = await readJson(req);
    if (!customer || !String(customer.name || '').trim() || !String(customer.phone || '').trim() ||
        !String(customer.address || '').trim() || !Array.isArray(items) || items.length === 0) {
      return sendJson(res, 400, { error: 'يرجى إدخال بيانات الطلب كاملة' });
    }
    const cleanItems = [];
    let calculatedTotal = 0;
    for (const item of items) {
      const product = db.prepare('SELECT id,name,price FROM products WHERE id=?').get(Number(item.id));
      const qty = Math.floor(Number(item.qty));
      if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99) return sendJson(res, 400, { error: 'يوجد منتج أو كمية غير صالحة' });
      cleanItems.push({ id: product.id, name: product.name, price: product.price, qty });
      calculatedTotal += product.price * qty;
    }
    const finalTotal = discountCode === 'LUXORA10' ? calculatedTotal * 0.90 : calculatedTotal;
    const result = db.prepare('INSERT INTO orders (customer_name,phone,address,items_json,total) VALUES (?,?,?,?,?)')
      .run(String(customer.name).trim(), String(customer.phone).trim(), String(customer.address).trim(), JSON.stringify(cleanItems), finalTotal);
    return sendJson(res, 201, { ok: true, orderId: Number(result.lastInsertRowid), total: finalTotal });
  }

  if (method === 'POST' && route === '/api/subscribe') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'البريد الإلكتروني غير صالح' });
    try {
      db.prepare('INSERT INTO subscribers (email) VALUES (?)').run(email);
      return sendJson(res, 201, { ok: true });
    } catch (err) {
      if (/UNIQUE|constraint/i.test(String(err.message))) return sendJson(res, 200, { ok: true, alreadySubscribed: true });
      throw err;
    }
  }

  if (method === 'GET' && route === '/api/admin/orders') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: 'يلزم تسجيل دخول الإدارة' });
    const orders = db.prepare('SELECT id,customer_name,phone,address,items_json,total,created_at FROM orders ORDER BY id DESC').all()
      .map(o => ({ ...o, items: JSON.parse(o.items_json) }));
    return sendJson(res, 200, orders);
  }

  return sendJson(res, 404, { error: 'المسار غير موجود' });
}

if (ADMIN_PASSWORD.length < 12) {
  console.error('خطأ: أنشئ ملف .env واجعل ADMIN_PASSWORD كلمة مرور خاصة من 12 حرفاً على الأقل.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'حدث خطأ داخلي في السيرفر' });
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`LUXORA يعمل على http://${HOST}:${PORT}`);
  console.log('قاعدة البيانات: luxora.sqlite (SQLite المدمجة في Node.js)');
  console.log('افتح الرابط في Chrome واترك نافذة Terminal مفتوحة.');
});
