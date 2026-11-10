const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function setup(purchases, categories = ['Food & Drink', 'Groceries', 'Shopping']) {
  let controller;
  let onDestroy;
  let rows = purchases;
  const pending = [];
  const charts = [];
  const module = { filter() {}, directive() {}, controller(_name, callback) { controller = callback; } };
  function Chart(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.destroyed = false;
    this.destroy = () => { this.destroyed = true; };
    charts.push(this);
  }
  const context = { angular: { module: () => module, copy: value => ({ ...value }) }, window: { Chart, confirm: () => true }, Chart, document: { getElementById: id => ({ id }) }, Intl };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context);
  const timeout = (callback, delay) => { if (!delay) pending.push(callback); };
  timeout.cancel = () => {};
  const http = {
    get: url => Promise.resolve({ data: url === '/api/purchases' ? rows : url === '/api/categories' ? [...categories] : [] }),
    post: (url, purchase) => {
      if (url === '/api/categories') {
        if (categories.some(name => name.toLowerCase() === purchase.name.toLowerCase())) return Promise.reject({ data: { error: 'A category with this name already exists.' } });
        categories.push(purchase.name);
        return Promise.resolve({ data: { name: purchase.name } });
      }
      rows = [...rows, { ...purchase, id: rows.length + 1 }];
      return Promise.resolve({ data: {} });
    },
    patch: (url, body) => {
      const previousName = decodeURIComponent(url.split('/').pop());
      if (categories.includes(body.name) && body.name !== previousName) return Promise.reject({ data: { error: 'A category with this name already exists.' } });
      categories.splice(categories.indexOf(previousName), 1, body.name);
      rows = rows.map(row => row.category === previousName ? { ...row, category: body.name } : row);
      return Promise.resolve({ data: { previousName, name: body.name, deleted: false } });
    },
    delete: url => {
      if (url.startsWith('/api/categories/')) {
        const previousName = decodeURIComponent(url.split('/').pop());
        categories.splice(categories.indexOf(previousName), 1);
        rows = rows.map(row => row.category === previousName ? { ...row, category: 'Other' } : row);
        return Promise.resolve({ data: { previousName, name: 'Other', deleted: true } });
      }
      rows = rows.filter(row => row.id !== Number(url.split('/').pop())); return Promise.resolve();
    }
  };
  const state = {};
  controller.call(state, http, timeout, { $on: (_event, callback) => { onDestroy = callback; } });
  async function flush() {
    await new Promise(resolve => setImmediate(resolve));
    while (pending.length) pending.shift()();
  }
  await flush();
  return { state, charts, flush, window: context.window, destroy: () => onDestroy() };
}

const purchases = [
  { id: 1, purchase_date: '2023-12-31', category: 'Travel', amount: '80.00' },
  { id: 2, purchase_date: '2024-01-01', category: 'Groceries', amount: '10.10' },
  { id: 3, purchase_date: '2024-01-31', category: 'Groceries', amount: '20.20' },
  { id: 4, purchase_date: '2024-01-15', category: 'Shopping', amount: '70.70' },
  { id: 5, purchase_date: '2024-02-29', category: 'Travel', amount: '49.00' },
  { id: 6, purchase_date: '2025-01-01', category: 'Shopping', amount: '50.00' }
];

test('spending groups decimal amounts and filters month, year, and all time by purchase date', async () => {
  const { state, charts, flush } = await setup(purchases);
  state.spendingYear = '2024';
  state.spendingMonth = '01';
  state.setPage('spending');
  await flush();
  assert.equal(state.spendingTotal, 101);
  assert.equal(state.spendingCount, 3);
  assert.equal(state.spendingLabel, 'January 2024');
  assert.equal(state.spendingCategories[0].name, 'Shopping');
  assert.equal(state.spendingCategories[0].percentage, 70);
  assert.equal(state.spendingCategories[1].amount, 30.3);
  assert.equal(state.spendingCategories[1].percentage, 30);
  const color = state.spendingCategories[0].color;
  const config = charts.at(-1).config;
  assert.equal(config.type, 'pie');
  assert.equal(config.options.plugins.tooltip.callbacks.label({ dataIndex: 0 }), 'Shopping: $70.70 (70.0%)');

  state.spendingPeriod = 'year';
  state.updateSpending();
  await flush();
  assert.equal(state.spendingTotal, 150);
  assert.equal(state.spendingCount, 4);
  assert.equal(state.spendingLabel, '2024');

  state.spendingPeriod = 'all';
  state.updateSpending();
  await flush();
  assert.equal(state.spendingTotal, 280);
  assert.equal(state.spendingCount, 6);
  assert.equal(state.spendingCategories.find(row => row.name === 'Shopping').color, color);
  for (const year of ['2023', '2024', '2025']) assert.ok(state.spendingYears.includes(year));
});

test('empty periods remove the old chart; single categories, navigation, and teardown work', async () => {
  const { state, charts, flush, destroy } = await setup(purchases);
  state.spendingYear = '2024';
  state.spendingMonth = '02';
  state.setPage('spending');
  await flush();
  assert.equal(state.spendingCategories[0].percentage, 100);
  const firstChart = charts.at(-1);
  state.spendingMonth = '03';
  state.updateSpending();
  await flush();
  assert.equal(firstChart.destroyed, true);
  assert.equal(state.spendingTotal, 0);
  assert.equal(state.spendingCategories.length, 0);
  assert.equal(charts.length, 1);

  state.spendingMonth = '02';
  state.updateSpending();
  await flush();
  state.setPage('overview');
  assert.equal(charts.at(-1).destroyed, true);
  await flush();
  state.setPage('spending');
  await flush();
  assert.equal(charts.at(-1).destroyed, false);
  destroy();
  assert.equal(charts.at(-1).destroyed, true);
});

test('saving and deleting purchases refresh the active breakdown, including custom categories', async () => {
  const { state, charts, flush } = await setup([]);
  state.spendingPeriod = 'all';
  state.setPage('spending');
  await flush();
  assert.equal(charts.length, 0);
  state.purchaseForm = { merchant: 'Shop', purchase_date: new Date(2024, 0, 1), category: '__proto__', amount: 0.1 };
  state.savePurchase();
  await flush();
  assert.equal(state.spendingTotal, 0.1);
  assert.equal(state.spendingCount, 1);
  assert.equal(state.spendingCategories[0].name, '__proto__');
  assert.equal(state.spendingCategories[0].percentage, 100);
  assert.ok(state.spendingCategories[0].color);
  state.deletePurchase(state.purchases[0]);
  await flush();
  assert.equal(state.spendingTotal, 0);
  assert.equal(state.spendingCount, 0);
  assert.equal(charts.at(-1).destroyed, true);
});

test('custom categories persist, select automatically, and appear in every chart period', async () => {
  const categories = ['Food & Drink', 'Groceries'];
  const { state, charts, flush } = await setup([], categories);
  state.openPurchase();
  state.purchaseForm.merchant = 'Vet';
  state.purchaseForm.amount = 25;
  state.purchaseForm.purchase_date = new Date(2024, 1, 29);
  state.creatingCategory = true;
  state.categoryName = '  Pet care  ';
  const saving = state.createCategory();
  assert.equal(state.categorySaving, true);
  state.closeModal();
  assert.equal(state.modal, 'purchase');
  await saving;
  assert.equal(state.purchaseForm.category, 'Pet care');
  assert.equal(state.purchaseForm.merchant, 'Vet');
  assert.equal(state.creatingCategory, false);
  state.savePurchase();
  await flush();
  state.spendingYear = '2024';
  state.spendingMonth = '02';
  state.setPage('spending');
  let color;
  for (const period of ['month', 'year', 'all']) {
    state.spendingPeriod = period;
    state.updateSpending();
    await flush();
    assert.equal(state.spendingCategories[0].name, 'Pet care');
    assert.equal(state.spendingCategories[0].percentage, 100);
    assert.equal(charts.at(-1).config.data.labels[0], 'Pet care');
    color = color || state.spendingCategories[0].color;
    assert.equal(state.spendingCategories[0].color, color);
  }
  state.deletePurchase(state.purchases[0]);
  await flush();
  assert.ok(state.categories.includes('Pet care'));
  const reopened = await setup([], categories);
  assert.ok(reopened.state.categories.includes('Pet care'));
});

test('category errors preserve the purchase draft and cancellation restores purchase saving', async () => {
  const { state, flush } = await setup([]);
  state.openPurchase();
  state.purchaseForm.merchant = 'Lunch';
  state.creatingCategory = true;
  for (const invalid of ['  ', 'x'.repeat(61)]) {
    state.categoryName = invalid;
    await state.createCategory();
    assert.match(state.categoryError, /up to 60/);
  }
  state.categoryName = 'groceries';
  await state.createCategory();
  assert.match(state.categoryError, /already exists/);
  assert.equal(state.categorySaving, false);
  assert.equal(state.purchaseForm.category, 'Food & Drink');
  assert.equal(state.purchaseForm.merchant, 'Lunch');
  state.savePurchase();
  await flush();
  assert.equal(state.purchases.length, 0);
  state.cancelCategory();
  assert.equal(state.creatingCategory, false);
  assert.equal(state.categoryError, '');
});

test('category management updates purchases, draft selection, and chart percentages across periods', async () => {
  const { state, charts, flush, window } = await setup([
    { id: 1, category: 'Pet / care', amount: 25, purchase_date: '2024-01-01' },
    { id: 2, category: 'Pet / care', amount: 50, purchase_date: '2025-01-01' },
    { id: 3, category: 'Other', amount: 75, purchase_date: '2024-01-01' }
  ], ['Food & Drink', 'Other', 'Pet / care']);
  state.spendingPeriod = 'all';
  state.setPage('spending');
  state.openPurchase();
  state.purchaseForm.category = 'Pet / care';
  state.purchaseForm.merchant = 'Draft purchase';
  state.openCategories();
  assert.equal(state.customCategories.length, 1);
  state.editCategory('Pet / care');
  state.categoryEdit.name = 'Other';
  await state.renameCategory();
  assert.match(state.error, /already exists/);
  assert.equal(state.purchaseForm.category, 'Pet / care');
  state.categoryEdit.name = 'Animals';
  await state.renameCategory();
  await flush();
  assert.equal(state.purchaseForm.category, 'Animals');
  assert.equal(state.purchases[0].category, 'Animals');
  assert.equal(state.purchases[1].category, 'Animals');
  assert.equal(state.spendingCategories.find(row => row.name === 'Animals').percentage, 50);
  assert.ok(charts.at(-1).config.data.labels.includes('Animals'));
  window.confirm = () => false;
  state.deleteCategory('Animals');
  assert.ok(state.categories.includes('Animals'));
  window.confirm = () => true;
  await state.deleteCategory('Animals');
  await flush();
  assert.equal(state.purchaseForm.category, 'Other');
  assert.equal(state.purchases.length, 3);
  assert.equal(state.spendingTotal, 150);
  assert.equal(state.customCategories.length, 0);
  state.spendingYear = '2024';
  state.spendingMonth = '01';
  for (const period of ['month', 'year', 'all']) {
    state.spendingPeriod = period;
    state.updateSpending();
    await flush();
    assert.equal(state.spendingCategories.length, 1);
    assert.equal(state.spendingCategories[0].name, 'Other');
    assert.equal(state.spendingCategories[0].percentage, 100);
    assert.equal(state.spendingTotal, period === 'all' ? 150 : 100);
  }
  state.closeModal();
  assert.equal(state.modal, 'purchase');
  assert.equal(state.purchaseForm.merchant, 'Draft purchase');
});
