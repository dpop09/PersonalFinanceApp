const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');

// Exercise the HTTP contract with an isolated database substitute.
const categories = new Map([['groceries', 'Groceries']]);
const purchases = [];
const originalGetPool = db.getPool;
db.getPool = () => ({
  async query(sql) {
    assert.equal(sql, 'SELECT name FROM purchase_categories ORDER BY name');
    return [[...categories.values()].sort().map(name => ({ name }))];
  },
  async execute(sql, params) {
    if (sql.startsWith('INSERT INTO purchase_categories')) {
      const key = params[0].toLowerCase();
      if (categories.has(key)) throw Object.assign(new Error('Duplicate category'), { code: 'ER_DUP_ENTRY' });
      categories.set(key, params[0]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT name FROM purchase_categories')) {
      const name = categories.get(params[0].toLowerCase());
      return [name ? [{ name }] : []];
    }
    if (sql.startsWith('INSERT INTO purchases')) {
      purchases.push(params);
      return [{ insertId: purchases.length }];
    }
    throw new Error('Unexpected SQL: ' + sql);
  }
});
const app = require('../server/app');
db.getPool = originalGetPool;

test('category API validates, saves, lists, and uses canonical categories for purchases', async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const name of ['', '   ', 'x'.repeat(61), 123, null]) {
      assert.equal((await post('/api/categories', { name })).status, 400);
    }
    const created = await post('/api/categories', { name: '  Pet care  ' });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { name: 'Pet care' });
    for (const name of ['pet CARE', ' groceries ']) {
      const duplicate = await post('/api/categories', { name });
      assert.equal(duplicate.status, 409);
      assert.match((await duplicate.json()).error, /already exists/);
    }
    assert.deepEqual(await (await fetch(url + '/api/categories')).json(), ['Groceries', 'Pet care']);
    const purchase = { merchant: 'Vet', amount: 25, purchase_date: '2024-02-29', category: 'pet care' };
    assert.equal((await post('/api/purchases', purchase)).status, 201);
    assert.equal(purchases[0][3], 'Pet care');
    assert.equal((await post('/api/purchases', { ...purchase, category: 'Unknown' })).status, 400);
    assert.equal(purchases.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
