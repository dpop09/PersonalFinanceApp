const defaultCategories = ['Food & Drink', 'Groceries', 'Shopping', 'Transport', 'Bills & Utilities', 'Housing', 'Health', 'Entertainment', 'Travel', 'Education', 'Other'];

async function initializeCategories(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_categories (
      name VARCHAR(60) NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  for (const name of defaultCategories) {
    await pool.execute('INSERT IGNORE INTO purchase_categories (name) VALUES (?)', [name]);
  }
  await pool.query('INSERT IGNORE INTO purchase_categories (name) SELECT DISTINCT category FROM purchases');
}

module.exports = { initializeCategories };
