const mysql = require('mysql2/promise');
const { initializeCategories } = require('./categories');

let pool;

async function initializeDatabase() {
  const database = process.env.DB_NAME || 'personal_finance';
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(database)) {
    throw new Error('DB_NAME must contain only letters, numbers, and underscores, and start with a letter.');
  }

  const options = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    dateStrings: true
  };
  const bootstrap = await mysql.createConnection(options);
  try {
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await bootstrap.end();
  }

  pool = mysql.createPool({ ...options, database, waitForConnections: true, connectionLimit: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type ENUM('Checking','Savings','Credit','Investment','Cash','Other') NOT NULL,
      color CHAR(7) NOT NULL DEFAULT '#8676f7',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_balances (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account_id INT UNSIGNED NOT NULL,
      week_start DATE NOT NULL,
      balance DECIMAL(15,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_account_week (account_id, week_start),
      CONSTRAINT fk_balance_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account_id INT UNSIGNED NULL,
      purchase_date DATE NOT NULL,
      merchant VARCHAR(120) NOT NULL,
      category VARCHAR(60) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      note VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY purchase_date_idx (purchase_date),
      CONSTRAINT fk_purchase_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
  await initializeCategories(pool);
  return pool;
}

function getPool() {
  if (!pool) throw new Error('Database is not initialized.');
  return pool;
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { initializeDatabase, getPool, closeDatabase };
