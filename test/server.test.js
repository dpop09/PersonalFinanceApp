const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/app');
const { parseBalanceWorkbook } = require('../server/import');

test('local app serves its UI, scripts, and Excel template', async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Atlas Finance/);
    for (const path of ['/styles.css', '/app.js', '/vendor/angular.js', '/vendor/chart.umd.js']) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200, path);
    }
    const template = await fetch(url + '/api/template');
    assert.equal(template.status, 200);
    const balances = await parseBalanceWorkbook(Buffer.from(await template.arrayBuffer()));
    assert.equal(balances.length, 2);
    const foreignOrigin = await fetch(url, { headers: { Origin: 'https://example.com' } });
    assert.equal(foreignOrigin.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
