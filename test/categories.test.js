const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');

// Exercise the HTTP contract with an isolated database substitute.
const categories = new Map([['groceries', 'Groceries'], ['other', 'Other']]);
const purchases = [];
let failPurchaseUpdate = false;
let rollbacks = 0;
let releases = 0;
const originalGetPool = db.getPool;
const pool = {
  async getConnection() {
    let snapshot;
    return {
      execute: pool.execute,
      async beginTransaction() { snapshot = { categories: [...categories], purchases: purchases.map(row => [...row]) }; },
      async commit() {},
      async rollback() {
        rollbacks++;
        categories.clear();
        snapshot.categories.forEach(([key, value]) => categories.set(key, value));
        purchases.splice(0, purchases.length, ...snapshot.purchases);
      },
      release() { releases++; }
    };
  },
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
      assert.ok(params[3]);
      purchases.push(params);
      return [{ insertId: purchases.length }];
    }
    if (sql.startsWith('UPDATE purchase_categories')) {
      const [name, previous] = params;
      if (name.toLowerCase() !== previous.toLowerCase() && categories.has(name.toLowerCase())) throw Object.assign(new Error('Duplicate category'), { code: 'ER_DUP_ENTRY' });
      categories.delete(previous.toLowerCase());
      categories.set(name.toLowerCase(), name);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE purchases')) {
      if (failPurchaseUpdate) { failPurchaseUpdate = false; throw new Error('Injected purchase update failure'); }
      let count = 0;
      for (const row of purchases) {
        if (row[3].toLowerCase() === params[1].toLowerCase()) { row[3] = params[0]; count++; }
      }
      return [{ affectedRows: count }];
    }
    if (sql.startsWith('DELETE FROM purchase_categories')) {
      categories.delete(params[0].toLowerCase());
      return [{ affectedRows: 1 }];
    }
    throw new Error('Unexpected SQL: ' + sql);
  }
};
db.getPool = () => pool;
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
    assert.deepEqual(await (await fetch(url + '/api/categories')).json(), ['Groceries', 'Other', 'Pet care']);
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

test('rename and delete update purchases atomically, protect defaults, and preserve amounts', async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (method, name, body) => fetch(url + '/api/categories/' + encodeURIComponent(name), {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  categories.set('home / pets', 'Home / Pets');
  purchases.push([null, '2024-01-01', 'Vet', 'Home / Pets', 25, null], [null, '2025-02-01', 'Vet', 'Home / Pets', 50, null]);
  const count = purchases.length;
  const total = purchases.reduce((sum, row) => sum + row[4], 0);
  try {
    for (const name of ['', '  ', 'x'.repeat(61), null, 123]) {
      assert.equal((await request('PATCH', 'Home / Pets', { name })).status, 400);
    }
    assert.equal((await request('PATCH', 'Home / Pets', { name: ' groceries ' })).status, 409);
    assert.equal(purchases.at(-1)[3], 'Home / Pets');
    assert.ok(categories.has('home / pets'));
    for (const method of ['PATCH', 'DELETE']) {
      assert.equal((await request(method, 'groceries', method === 'PATCH' ? { name: 'Changed' } : undefined)).status, 400);
      assert.equal((await request(method, 'Unknown', method === 'PATCH' ? { name: 'Changed' } : undefined)).status, 404);
    }
    const renamed = await request('PATCH', 'Home / Pets', { name: '  Animal care  ' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(await renamed.json(), { previousName: 'Home / Pets', name: 'Animal care', deleted: false, updatedPurchases: 2 });
    assert.equal(purchases.at(-1)[3], 'Animal care');
    assert.ok(!categories.has('home / pets'));
    assert.equal((await request('PATCH', 'Animal care', { name: 'ANIMAL CARE' })).status, 200);
    assert.equal(purchases.at(-1)[3], 'ANIMAL CARE');

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      for (const method of ['PATCH', 'DELETE']) {
        const rollbackCount = rollbacks;
        const releaseCount = releases;
        failPurchaseUpdate = true;
        assert.equal((await request(method, 'ANIMAL CARE', method === 'PATCH' ? { name: 'Failed rename' } : undefined)).status, 500);
        assert.equal(rollbacks, rollbackCount + 1);
        assert.equal(releases, releaseCount + 1);
        assert.equal(categories.get('animal care'), 'ANIMAL CARE');
        assert.ok(!categories.has('failed rename'));
        assert.equal(purchases.at(-1)[3], 'ANIMAL CARE');
      }
    } finally { console.error = originalConsoleError; }

    const deleted = await request('DELETE', 'ANIMAL CARE');
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).updatedPurchases, 2);
    assert.ok(!categories.has('animal care'));
    assert.equal(purchases.at(-1)[3], 'Other');
    assert.equal(purchases.at(-2)[3], 'Other');
    assert.equal(purchases.length, count);
    assert.equal(purchases.reduce((sum, row) => sum + row[4], 0), total);
    assert.equal((await request('DELETE', 'Other')).status, 400);
    categories.set('unused', 'Unused');
    assert.equal((await request('DELETE', 'Unused')).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
