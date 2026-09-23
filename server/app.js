const path = require('path');
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { getPool } = require('./db');
const { mondayOf, parseMoney, parseBalanceWorkbook } = require('./import');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.disable('x-powered-by');
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return res.status(403).json({ error: 'Local requests only.' });
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return res.status(403).json({ error: 'Local requests only.' });
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '100kb' }));
app.get('/vendor/angular.js', (_req, res) => res.sendFile(require.resolve('angular/angular.js')));
app.get('/vendor/chart.umd.js', (_req, res) => res.sendFile(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js')));
app.use(express.static(publicDir));

function fail(res, status, message) { return res.status(status).json({ error: message }); }
function positiveId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function cleanString(value, max) { return typeof value === 'string' ? value.trim().slice(0, max + 1) : ''; }
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res)).catch(next); }

app.get('/api/accounts', asyncRoute(async (_req, res) => {
  const [rows] = await getPool().query(`
    SELECT a.id, a.name, a.type, a.color, a.created_at,
      (SELECT b.balance FROM weekly_balances b WHERE b.account_id = a.id ORDER BY b.week_start DESC LIMIT 1) AS latest_balance,
      (SELECT b.week_start FROM weekly_balances b WHERE b.account_id = a.id ORDER BY b.week_start DESC LIMIT 1) AS latest_week
    FROM accounts a ORDER BY a.created_at ASC, a.id ASC
  `);
  res.json(rows);
}));

app.post('/api/accounts', upload.single('spreadsheet'), asyncRoute(async (req, res) => {
  const name = cleanString(req.body.name, 100);
  const type = req.body.type;
  const color = req.body.color || '#8676f7';
  if (!name || name.length > 100) return fail(res, 400, 'Enter an account name (up to 100 characters).');
  if (!['Checking', 'Savings', 'Credit', 'Investment', 'Cash', 'Other'].includes(type)) return fail(res, 400, 'Choose a valid account type.');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, 'Choose a valid account color.');
  if (req.file && !/\.xlsx$/i.test(req.file.originalname)) return fail(res, 400, 'Choose an .xlsx spreadsheet.');

  let balances = [];
  if (req.file) {
    try { balances = await parseBalanceWorkbook(req.file.buffer); }
    catch (error) { return fail(res, 400, error.message); }
  }
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO accounts (name, type, color) VALUES (?, ?, ?)', [name, type, color]);
    for (const row of balances) {
      await connection.execute('INSERT INTO weekly_balances (account_id, week_start, balance) VALUES (?, ?, ?)', [result.insertId, row.week_start, row.balance]);
    }
    await connection.commit();
    res.status(201).json({ id: result.insertId, imported: balances.length });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}));

app.get('/api/balances', asyncRoute(async (_req, res) => {
  const [rows] = await getPool().query('SELECT account_id, week_start, balance FROM weekly_balances ORDER BY week_start ASC, account_id ASC');
  res.json(rows);
}));

app.get('/api/template', asyncRoute(async (_req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Weekly balances');
  sheet.columns = [{ header: 'Week', key: 'week', width: 18 }, { header: 'Balance', key: 'balance', width: 18 }];
  sheet.addRow({ week: '2026-09-14', balance: 4250.00 });
  sheet.addRow({ week: '2026-09-21', balance: 4312.45 });
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment('weekly-balances-template.xlsx');
  res.send(Buffer.from(buffer));
}));

app.post('/api/accounts/:id/balances', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const week = mondayOf(req.body.week);
  const balance = parseMoney(req.body.balance);
  if (!id || !week || balance === null) return fail(res, 400, 'Enter a valid week and balance.');
  const [accounts] = await getPool().execute('SELECT id FROM accounts WHERE id = ?', [id]);
  if (!accounts.length) return fail(res, 404, 'Account not found.');
  await getPool().execute(`INSERT INTO weekly_balances (account_id, week_start, balance) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE balance = VALUES(balance)`, [id, week, balance]);
  res.status(201).json({ account_id: id, week_start: week, balance });
}));

app.get('/api/purchases', asyncRoute(async (_req, res) => {
  const [rows] = await getPool().query(`SELECT p.id, p.account_id, p.purchase_date, p.merchant, p.category, p.amount, p.note, a.name AS account_name
    FROM purchases p LEFT JOIN accounts a ON a.id = p.account_id ORDER BY p.purchase_date DESC, p.id DESC`);
  res.json(rows);
}));

app.post('/api/purchases', asyncRoute(async (req, res) => {
  const merchant = cleanString(req.body.merchant, 120);
  const category = cleanString(req.body.category, 60);
  const note = cleanString(req.body.note, 500);
  const amount = parseMoney(req.body.amount);
  const date = req.body.purchase_date;
  const accountId = req.body.account_id === null || req.body.account_id === undefined || req.body.account_id === '' ? null : positiveId(req.body.account_id);
  if (!merchant || merchant.length > 120 || !category || category.length > 60 || note.length > 500 || !validDate(date) || amount === null || amount <= 0) {
    return fail(res, 400, 'Enter a date, merchant, category, and positive amount.');
  }
  if (req.body.account_id && !accountId) return fail(res, 400, 'Choose a valid account.');
  if (accountId) {
    const [accounts] = await getPool().execute('SELECT id FROM accounts WHERE id = ?', [accountId]);
    if (!accounts.length) return fail(res, 400, 'Choose an existing account.');
  }
  const [result] = await getPool().execute(`INSERT INTO purchases (account_id, purchase_date, merchant, category, amount, note)
    VALUES (?, ?, ?, ?, ?, ?)`, [accountId, date, merchant, category, amount, note || null]);
  res.status(201).json({ id: result.insertId });
}));

app.delete('/api/purchases/:id', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid purchase ID.');
  const [result] = await getPool().execute('DELETE FROM purchases WHERE id = ?', [id]);
  if (!result.affectedRows) return fail(res, 404, 'Purchase not found.');
  res.status(204).end();
}));

app.use('/api', (_req, res) => fail(res, 404, 'API route not found.'));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return fail(res, 400, 'Spreadsheet must be 5 MB or smaller.');
  console.error(error);
  return fail(res, 500, 'Something went wrong. Check the local server console.');
});

module.exports = app;
