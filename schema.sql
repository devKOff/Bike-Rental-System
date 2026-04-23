CREATE DATABASE IF NOT EXISTS bike_rental;
USE bike_rental;

-- ── USERS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)        NOT NULL,
  email         VARCHAR(150)        NOT NULL UNIQUE,
  password_hash VARCHAR(255)        NOT NULL,
  phone         VARCHAR(15),
  role          ENUM('user','admin') DEFAULT 'user',
  created_at    DATETIME            DEFAULT CURRENT_TIMESTAMP
);

-- ── BIKES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bikes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)        NOT NULL,
  type          ENUM('city','mountain','electric','sports') NOT NULL,
  location      VARCHAR(100)        NOT NULL,
  area          VARCHAR(50)         NOT NULL,
  icon          VARCHAR(10)         DEFAULT '🏍️',
  mileage       VARCHAR(30)         NOT NULL,
  fuel          VARCHAR(30)         NOT NULL,
  engine_cc     VARCHAR(30)         NOT NULL,
  cost_per_hour DECIMAL(8,2)        NOT NULL,
  available     BOOLEAN             DEFAULT TRUE,
  avg_rating    DECIMAL(3,2)        DEFAULT 0.00,
  review_count  INT                 DEFAULT 0,
  created_at    DATETIME            DEFAULT CURRENT_TIMESTAMP
);

-- ── BOOKINGS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT             NOT NULL,
  bike_id     INT             NOT NULL,
  hours       INT             NOT NULL,
  total_cost  DECIMAL(10,2)   NOT NULL,
  status      ENUM('confirmed','returned','cancelled') DEFAULT 'confirmed',
  created_at  DATETIME        DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bike_id) REFERENCES bikes(id) ON DELETE CASCADE
);

-- ── REVIEWS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT             NOT NULL,
  bike_id     INT             NOT NULL,
  booking_id  INT             NOT NULL,
  rating      TINYINT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT            NOT NULL,
  created_at  DATETIME        DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (bike_id)    REFERENCES bikes(id)    ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

-- ── SEED: BIKES ─────────────────────────────────────────────────
INSERT INTO bikes (name, type, location, area, icon, mileage, fuel, engine_cc, cost_per_hour, available, avg_rating, review_count) VALUES
('Hero Splendor+',           'city',     'Meerut, UP',  'meerut',  '🛵', '70 km/l',      'Petrol',   '100cc',       50.00, TRUE,  4.50, 38),
('Bajaj Pulsar 150',         'sports',   'Delhi, NCR',  'delhi',   '🏍️', '55 km/l',      'Petrol',   '150cc',       90.00, TRUE,  4.70, 61),
('TVS Apache 160',           'sports',   'Noida, UP',   'noida',   '🏍️', '50 km/l',      'Petrol',   '160cc',      110.00, FALSE, 4.30, 29),
('Hero Electric Optima',     'electric', 'Gurgaon, HR', 'gurgaon', '⚡', '80 km/charge', 'Electric', 'Hub Motor',   70.00, TRUE,  4.60, 44),
('Royal Enfield Classic 350','mountain', 'Agra, UP',    'agra',    '🛺', '35 km/l',      'Petrol',   '350cc',      200.00, TRUE,  4.90,112),
('Honda CB Shine',           'city',     'Lucknow, UP', 'lucknow', '🛵', '65 km/l',      'Petrol',   '125cc',       60.00, TRUE,  4.40, 33),
('KTM Duke 200',             'sports',   'Delhi, NCR',  'delhi',   '🏍️', '30 km/l',      'Petrol',   '200cc',      180.00, TRUE,  4.80, 77),
('Ather 450X',               'electric', 'Noida, UP',   'noida',   '⚡', '85 km/charge', 'Electric', 'Electric',   120.00, FALSE, 4.70, 55),
('Jawa 42',                  'mountain', 'Meerut, UP',  'meerut',  '🛺', '30 km/l',      'Petrol',   '294cc',      160.00, TRUE,  4.50, 41);

-- ── SEED: ADMIN USER (password: admin123) ───────────────────────
INSERT INTO users (name, email, password_hash, phone, role) VALUES
('Admin', 'admin@rideeasy.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '9999999999', 'admin');

-- Note: default password hash above is 'password' from bcrypt
-- Run this in Node to generate your own:
-- const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('admin123', 10));
