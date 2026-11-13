const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TX_SHEET = process.env.TRANSACTIONS_SHEET || 'Transactions';
const PL_SHEET = process.env.PL_SHEET || 'P&L';
const CURRENCY = process.env.CURRENCY || '$';

let authClient = null;

function getAuth() {
  if (authClient) return authClient;

  let credentials;
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString()
    );
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  } else {
    throw new Error(
      'Google credentials not configured.\n' +
      'Set GOOGLE_CREDENTIALS_BASE64 (base64 of service account JSON)\n' +
      'or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.'
    );
  }

  authClient = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return authClient;
}

function api() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

async function ensureSheets() {
  if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID not set.');

  const s = api();
  const { data } = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const names = data.sheets.map(sh => sh.properties.title);
  const requests = [];

  if (!names.includes(TX_SHEET)) {
    requests.push({ addSheet: { properties: { title: TX_SHEET } } });
  }
  if (!names.includes(PL_SHEET)) {
    requests.push({ addSheet: { properties: { title: PL_SHEET } } });
  }

  if (requests.length) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests },
    });
  }

  await ensureHeaders(s, TX_SHEET, ['Date', 'Type', 'Amount', 'Description', 'Client', 'Category']);
  await ensureHeaders(s, PL_SHEET, ['Date', 'Description', 'Revenue', 'Cost', 'Profit', 'Category']);
}

async function ensureHeaders(s, sheet, headers) {
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheet}'!A1:${String.fromCharCode(64 + headers.length)}1`,
  });
  if (!data.values || !data.values.length) {
    await s.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheet}'!A1`,
      valueInputOption: 'RAW',
      resource: { values: [headers] },
    });
  }
}

async function addTransaction(type, amount, description, client, category) {
  const s = api();
  const date = new Date().toLocaleDateString('en-CA');

  await s.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TX_SHEET}'!A:F`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[date, type, amount, description, client || '', category || '']],
    },
  });

  const balance = await getBalance();
  return { date, type, amount, description, client, category, balance };
}

async function getBalance() {
  const s = api();
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TX_SHEET}'!B2:C`,
  });

  let balance = 0;
  for (const row of data.values || []) {
    const type = (row[0] || '').toUpperCase();
    const amt = parseFloat(row[1]) || 0;
    if (type === 'IN') balance += amt;
    else if (type === 'OUT') balance -= amt;
  }
  return Math.round(balance * 100) / 100;
}

async function getTransactions(limit) {
  const s = api();
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TX_SHEET}'!A2:F`,
  });

  const rows = (data.values || []).map(r => ({
    date: r[0] || '',
    type: r[1] || '',
    amount: parseFloat(r[2]) || 0,
    description: r[3] || '',
    client: r[4] || '',
    category: r[5] || '',
  }));

  return rows.slice(-(limit || 10)).reverse();
}

async function addPLEntry(description, revenue, cost, category) {
  const s = api();
  const date = new Date().toLocaleDateString('en-CA');
  const profit = revenue - cost;

  await s.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!A:F`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[date, description, revenue, cost, profit, category || '']],
    },
  });

  return { date, description, revenue, cost, profit, category };
}

async function getPLSummary(month) {
  const s = api();
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!A2:F`,
  });

  let rows = (data.values || []).map(r => ({
    date: r[0] || '',
    description: r[1] || '',
    revenue: parseFloat(r[2]) || 0,
    cost: parseFloat(r[3]) || 0,
    profit: parseFloat(r[4]) || 0,
    category: r[5] || '',
  }));

  if (month) {
    rows = rows.filter(r => r.date.startsWith(month));
  }

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);

  return {
    rows,
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    count: rows.length,
  };
}

function fmt(amount) {
  const num = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${CURRENCY}${num}`;
}

module.exports = {
  ensureSheets,
  addTransaction,
  getBalance,
  getTransactions,
  addPLEntry,
  getPLSummary,
  fmt,
  CURRENCY,
};
