const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { mondayOf, parseMoney, parseBalanceWorkbook } = require('../server/import');

test('dates are assigned to their Monday week', () => {
  assert.equal(mondayOf('2026-09-20'), '2026-09-14');
  assert.equal(mondayOf('2026-09-21'), '2026-09-21');
  assert.equal(mondayOf('2026-02-30'), null);
});

test('money rejects missing and nonnumeric values', () => {
  assert.equal(parseMoney('$1,234.50'), 1234.5);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('not a number'), null);
});

test('spreadsheet import normalizes weeks and keeps the last duplicate', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Balances');
  sheet.addRow(['Week', 'Balance']);
  sheet.addRow(['2026-09-15', 4000]);
  sheet.addRow(['2026-09-20', 4200]);
  sheet.addRow([new Date('2026-09-21T00:00:00Z'), '$4,312.45']);
  const rows = await parseBalanceWorkbook(await book.xlsx.writeBuffer());
  assert.deepEqual(rows, [
    { week_start: '2026-09-14', balance: 4200 },
    { week_start: '2026-09-21', balance: 4312.45 }
  ]);
});

test('spreadsheet import rejects malformed rows', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Balances');
  sheet.addRow(['Week', 'Balance']);
  sheet.addRow(['2026-09-14', '']);
  await assert.rejects(parseBalanceWorkbook(await book.xlsx.writeBuffer()), /row 2/);
});
