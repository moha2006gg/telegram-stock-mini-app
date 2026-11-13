const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const DEVIS_SHEET = 'Devis UV';
const PL_SHEET = 'Profits & Pertes';

const TARIFFS = {
  'W':                    3000,
  'W-V':                  6000,
  'W-C-V':                9000,
  'ecosolvent simple':    2000,
  'ecosolvent + decoupe': 3000,
};

const TYPE_ALIASES = {
  'w':    'W',
  'wv':   'W-V',
  'wcv':  'W-C-V',
  'eco':  'ecosolvent simple',
  'ecod': 'ecosolvent + decoupe',
};

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
    throw new Error('Google credentials not configured.');
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

function resolvePrintType(input) {
  const lower = input.toLowerCase().trim();
  if (TYPE_ALIASES[lower]) return TYPE_ALIASES[lower];
  for (const key of Object.keys(TARIFFS)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

function fmtDA(n) {
  return Number(n).toLocaleString('fr-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DA';
}

// Find next empty row in a column range (1-indexed)
async function nextRow(sheet, col) {
  const s = api();
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheet}'!${col}1:${col}`,
  });
  return (data.values || []).length + 1;
}

// ─── Devis UV ────────────────────────────────────────────

async function addQuote(client, widthCm, heightCm, qty, printType, isComplete, materialCost) {
  const s = api();
  const tariff = TARIFFS[printType];
  const surface = (widthCm * heightCm) / 10000;
  const articlePrice = isComplete
    ? materialCost + surface * tariff
    : surface * tariff;
  const total = articlePrice * qty;

  const row = await nextRow(DEVIS_SHEET, 'A');

  const values = [
    client,
    widthCm,
    heightCm,
    qty,
    printType,
    isComplete ? 'Oui' : 'Non',
    isComplete ? materialCost : '',
    surface,
    tariff,
    Math.round(articlePrice * 100) / 100,
    Math.round(total * 100) / 100,
  ];

  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${DEVIS_SHEET}'!A${row}:K${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [values] },
  });

  // Add corresponding P&L profit row
  const plRow = await nextRow(PL_SHEET, 'A');
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!A${plRow}:D${plRow}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        client,
        `='${DEVIS_SHEET}'!K${row}`,
        '',
        `=IF(C${plRow}="",B${plRow},C${plRow})`,
      ]],
    },
  });

  return { client, widthCm, heightCm, qty, printType, surface, tariff, articlePrice, total, devisRow: row };
}

async function getQuotes(limit) {
  const s = api();
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${DEVIS_SHEET}'!A4:K`,
  });
  const rows = (data.values || [])
    .filter(r => r[0] && r[0].trim())
    .map(r => ({
      client: r[0] || '',
      width: r[1] || '',
      height: r[2] || '',
      qty: r[3] || '',
      type: r[4] || '',
      total: r[10] || '',
    }));
  return rows.slice(-(limit || 10)).reverse();
}

// ─── Profits & Pertes ────────────────────────────────────

async function addProfit(client, amount) {
  const s = api();
  const row = await nextRow(PL_SHEET, 'A');
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!A${row}:D${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[client, amount, '', amount]],
    },
  });
  return { client, amount, row };
}

async function addLoss(description, amount) {
  const s = api();
  // Losses go in columns F-G. Find next empty row in column G.
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!G5:G`,
  });
  const vals = data.values || [];
  // Find first empty slot
  let offset = vals.length;
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i] || !vals[i][0] || !vals[i][0].trim()) {
      offset = i;
      break;
    }
  }
  const row = 5 + offset;

  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!F${row}:G${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[description, amount]] },
  });
  return { description, amount, row };
}

async function adjustPayment(clientSearch, amount) {
  const s = api();
  const { data } = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!A5:D`,
  });
  const rows = data.values || [];
  const search = clientSearch.toLowerCase().trim();
  // Find last matching row (most recent)
  let matchIdx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((rows[i][0] || '').toLowerCase().trim().includes(search)) {
      matchIdx = i;
      break;
    }
  }
  if (matchIdx === -1) return null;

  const sheetRow = 5 + matchIdx;
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PL_SHEET}'!C${sheetRow}:D${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[amount, amount]] },
  });

  return { client: rows[matchIdx][0], originalAmount: rows[matchIdx][1], adjusted: amount, row: sheetRow };
}

async function getBalance() {
  const s = api();
  // Read profits (column D) and losses (column G)
  const [profitRes, lossRes] = await Promise.all([
    s.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PL_SHEET}'!D5:D`,
    }),
    s.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PL_SHEET}'!G5:G`,
    }),
  ]);

  const parseNum = (v) => parseFloat((v || '').toString().replace(/\s/g, '').replace(',', '.')) || 0;

  const profits = (profitRes.data.values || []).reduce((sum, r) => sum + parseNum(r[0]), 0);
  const losses = (lossRes.data.values || []).reduce((sum, r) => sum + parseNum(r[0]), 0);

  return { profits: Math.round(profits * 100) / 100, losses: Math.round(losses * 100) / 100, net: Math.round((profits - losses) * 100) / 100 };
}

async function getPLDetails() {
  const s = api();
  const [profitRes, lossRes] = await Promise.all([
    s.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PL_SHEET}'!A5:D`,
    }),
    s.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PL_SHEET}'!F5:G`,
    }),
  ]);

  const profitRows = (profitRes.data.values || [])
    .filter(r => r[0] && r[0].trim())
    .map(r => ({ client: r[0], devis: r[1] || '', adjusted: r[2] || '', profit: r[3] || '' }));

  const lossRows = (lossRes.data.values || [])
    .filter(r => r[0] && r[0].trim() || r[1] && r[1].toString().trim())
    .map(r => ({ description: r[0] || '', amount: r[1] || '' }));

  return { profitRows, lossRows };
}

module.exports = {
  resolvePrintType,
  fmtDA,
  addQuote,
  getQuotes,
  addProfit,
  addLoss,
  adjustPayment,
  getBalance,
  getPLDetails,
  TARIFFS,
  TYPE_ALIASES,
};
