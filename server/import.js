const ExcelJS = require('exceljs');

function parseDate(value) {
  if (value && typeof value === 'object' && 'result' in value) value = value.result;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1 || value > 2958465) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const date = new Date(`${value.trim()}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value.trim()) return date;
  }
  return null;
}

function mondayOf(value) {
  const date = parseDate(value);
  if (!date) return null;
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function parseMoney(value) {
  if (value && typeof value === 'object' && 'result' in value) value = value.result;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    value = Number(value.replace(/[$,\s]/g, ''));
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 9999999999999.99) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function parseBalanceWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The spreadsheet has no worksheet.');
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => {
    headers.set(String(cell.text).trim().toLowerCase(), column);
  });
  const dateColumn = headers.get('week') || headers.get('date') || headers.get('week start');
  const balanceColumn = headers.get('balance') || headers.get('amount');
  if (!dateColumn || !balanceColumn) throw new Error('Row 1 must contain Week and Balance columns.');

  const balances = new Map();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const dateValue = row.getCell(dateColumn).value;
    const balanceValue = row.getCell(balanceColumn).value;
    if ((dateValue === null || dateValue === undefined || dateValue === '') &&
        (balanceValue === null || balanceValue === undefined || balanceValue === '')) continue;
    const week = mondayOf(dateValue);
    const balance = parseMoney(balanceValue);
    if (!week || balance === null) throw new Error(`Invalid week or balance in spreadsheet row ${rowNumber}.`);
    balances.set(week, balance);
    if (balances.size > 2000) throw new Error('The spreadsheet can contain at most 2,000 weekly balances.');
  }
  if (!balances.size) throw new Error('The spreadsheet has no balance rows.');
  return [...balances].map(([week_start, balance]) => ({ week_start, balance })).sort((a, b) => a.week_start.localeCompare(b.week_start));
}

module.exports = { mondayOf, parseMoney, parseBalanceWorkbook };
