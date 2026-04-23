const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.static('public'));

// ── DB ──────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '1234',
  database: process.env.DB_NAME     || 'bike_rental',
  waitForConnections: true,
  connectionLimit: 10,
});

// ── MIDDLEWARE ──────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Please login first' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'rideeasy_secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Please login as admin' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rideeasy_secret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════

// Register (users only — admin created via DB)
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password required' });
  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, "user")',
      [name, email, hash, phone || null]
    );
    const token = jwt.sign(
      { id: result.insertId, email, role: 'user' },
      process.env.JWT_SECRET || 'rideeasy_secret',
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, user: { id: result.insertId, name, email, role: 'user' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login (both user and admin use same endpoint)
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'rideeasy_secret',
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  BIKES
// ════════════════════════════════════════════════════════════════

app.get('/api/bikes', async (req, res) => {
  const { location, type } = req.query;
  let sql = 'SELECT * FROM bikes WHERE 1=1';
  const params = [];
  if (location) { sql += ' AND area = ?'; params.push(location); }
  if (type)     { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY name ASC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bikes/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM bikes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Bike not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  BOOKINGS (USER)
// ════════════════════════════════════════════════════════════════

// Create booking
app.post('/api/bookings', authMiddleware, async (req, res) => {
  const { bike_id, hours } = req.body;
  if (!bike_id || !hours) return res.status(400).json({ error: 'bike_id and hours required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [bikes] = await conn.query('SELECT * FROM bikes WHERE id = ? FOR UPDATE', [bike_id]);
    if (!bikes.length) throw new Error('Bike not found');
    if (!bikes[0].available) throw new Error('Bike is already booked');
    const total_cost = bikes[0].cost_per_hour * hours;
    const [result] = await conn.query(
      'INSERT INTO bookings (user_id, bike_id, hours, total_cost, status) VALUES (?, ?, ?, ?, "confirmed")',
      [req.user.id, bike_id, hours, total_cost]
    );
    await conn.query('UPDATE bikes SET available = FALSE WHERE id = ?', [bike_id]);
    await conn.commit();
    res.status(201).json({ message: 'Booking confirmed!', booking_id: result.insertId, total_cost });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
});

// Get my bookings
app.get('/api/bookings/my', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, bk.name AS bike_name, bk.location, bk.type,
              (SELECT COUNT(*) FROM reviews r WHERE r.booking_id = b.id) AS has_review
       FROM bookings b
       JOIN bikes bk ON b.bike_id = bk.id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Return bike
app.put('/api/bookings/:id/return', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [bookings] = await conn.query(
      'SELECT * FROM bookings WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!bookings.length) throw new Error('Booking not found');
    if (bookings[0].status === 'returned') throw new Error('Already returned');
    await conn.query('UPDATE bookings SET status = "returned" WHERE id = ?', [req.params.id]);
    await conn.query('UPDATE bikes SET available = TRUE WHERE id = ?', [bookings[0].bike_id]);
    await conn.commit();
    res.json({ message: 'Bike returned successfully!' });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
});

// ════════════════════════════════════════════════════════════════
//  REVIEWS (USER — only for booked bikes)
// ════════════════════════════════════════════════════════════════

// Get all reviews
app.get('/api/reviews', async (req, res) => {
  const { bike_id } = req.query;
  let sql = `SELECT r.*, u.name AS user_name, bk.name AS bike_name
             FROM reviews r
             JOIN users u  ON r.user_id = u.id
             JOIN bikes bk ON r.bike_id = bk.id`;
  const params = [];
  if (bike_id) { sql += ' WHERE r.bike_id = ?'; params.push(bike_id); }
  sql += ' ORDER BY r.created_at DESC LIMIT 50';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Post review (only if user has a confirmed/returned booking for that bike)
app.post('/api/reviews', authMiddleware, async (req, res) => {
  const { bike_id, booking_id, rating, comment } = req.body;
  if (!bike_id || !booking_id || !rating || !comment)
    return res.status(400).json({ error: 'All fields required' });
  try {
    // Check user actually booked this bike
    const [booking] = await pool.query(
      'SELECT * FROM bookings WHERE id = ? AND user_id = ? AND bike_id = ?',
      [booking_id, req.user.id, bike_id]
    );
    if (!booking.length) return res.status(403).json({ error: 'You can only review bikes you have booked' });
    // Check not already reviewed
    const [existing] = await pool.query(
      'SELECT id FROM reviews WHERE booking_id = ?', [booking_id]
    );
    if (existing.length) return res.status(409).json({ error: 'You already reviewed this booking' });

    await pool.query(
      'INSERT INTO reviews (user_id, bike_id, booking_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, bike_id, booking_id, rating, comment]
    );
    await pool.query(
      'UPDATE bikes SET avg_rating = (SELECT AVG(rating) FROM reviews WHERE bike_id = ?), review_count = review_count + 1 WHERE id = ?',
      [bike_id, bike_id]
    );
    res.status(201).json({ message: 'Review posted!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════════

// Dashboard summary
app.get('/api/admin/dashboard', adminMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [[bikes]]      = await pool.query('SELECT COUNT(*) AS total, SUM(available) AS available FROM bikes');
    const [[users]]      = await pool.query('SELECT COUNT(*) AS total FROM users WHERE role = "user"');
    const [[bookings]]   = await pool.query('SELECT COUNT(*) AS total FROM bookings');
    const [[todayBook]]  = await pool.query('SELECT COUNT(*) AS total FROM bookings WHERE DATE(created_at) = ?', [today]);
    const [[revenue]]    = await pool.query('SELECT COALESCE(SUM(total_cost),0) AS total FROM bookings WHERE status = "returned"');
    const [[todayRev]]   = await pool.query('SELECT COALESCE(SUM(total_cost),0) AS total FROM bookings WHERE status = "returned" AND DATE(created_at) = ?', [today]);
    const [[reviews]]    = await pool.query('SELECT COUNT(*) AS total FROM reviews');
    res.json({
      bikes:           { total: bikes.total,    available: bikes.available, booked: bikes.total - bikes.available },
      users:           { total: users.total },
      bookings:        { total: bookings.total, today: todayBook.total },
      revenue:         { total: revenue.total,  today: todayRev.total },
      reviews:         { total: reviews.total },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all bookings
app.get('/api/admin/bookings', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, u.name AS user_name, u.email AS user_email, bk.name AS bike_name, bk.location
       FROM bookings b
       JOIN users u  ON b.user_id  = u.id
       JOIN bikes bk ON b.bike_id = bk.id
       ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all users
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.created_at,
              COUNT(b.id) AS total_bookings,
              COALESCE(SUM(b.total_cost),0) AS total_spent
       FROM users u
       LEFT JOIN bookings b ON u.id = b.user_id
       WHERE u.role = 'user'
       GROUP BY u.id ORDER BY u.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all reviews (admin)
app.get('/api/admin/reviews', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, u.name AS user_name, bk.name AS bike_name
       FROM reviews r
       JOIN users u  ON r.user_id = u.id
       JOIN bikes bk ON r.bike_id = bk.id
       ORDER BY r.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle bike availability (admin)
app.put('/api/admin/bikes/:id/toggle', adminMiddleware, async (req, res) => {
  try {
    const [bikes] = await pool.query('SELECT * FROM bikes WHERE id = ?', [req.params.id]);
    if (!bikes.length) return res.status(404).json({ error: 'Bike not found' });
    const newStatus = !bikes[0].available;
    await pool.query('UPDATE bikes SET available = ? WHERE id = ?', [newStatus, req.params.id]);
    res.json({ message: `Bike marked as ${newStatus ? 'available' : 'unavailable'}`, available: newStatus });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add new bike (admin)
app.post('/api/admin/bikes', adminMiddleware, async (req, res) => {
  const { name, type, location, area, mileage, fuel, engine_cc, cost_per_hour } = req.body;
  if (!name || !type || !location || !area || !mileage || !fuel || !engine_cc || !cost_per_hour)
    return res.status(400).json({ error: 'All bike fields required' });
  try {
    const [result] = await pool.query(
      'INSERT INTO bikes (name, type, location, area, mileage, fuel, engine_cc, cost_per_hour) VALUES (?,?,?,?,?,?,?,?)',
      [name, type, location, area, mileage, fuel, engine_cc, cost_per_hour]
    );
    res.status(201).json({ message: 'Bike added!', id: result.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete bike (admin)
app.delete('/api/admin/bikes/:id', adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM bikes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Bike deleted!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete review (admin)
app.delete('/api/admin/reviews/:id', adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM reviews WHERE id = ?', [req.params.id]);
    res.json({ message: 'Review deleted!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── START ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 RideEasy running on http://localhost:${PORT}`));
