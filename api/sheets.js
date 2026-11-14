const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

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

async function callScript(action, params) {
  if (!APPS_SCRIPT_URL) throw new Error('APPS_SCRIPT_URL not configured');
  // Apps Script runs doPost on the POST, then 302-redirects to the result, which must be fetched with GET (fetch's default).
  let res;
  try {
    res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, action, ...params }),
    });
  } catch (err) {
    throw new Error(`Apps Script injoignable: ${err.cause?.message || err.message}`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  if (data.error) throw new Error(data.error);
  return data;
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

async function nextRow(sheet, col) {
  const res = await callScript('get', { sheet, range: `${col}1:${col}` });
  return (res.values || []).length + 1;
}

// ─── Devis UV ────────────────────────────────────────────

async function addQuote(client, widthCm, heightCm, qty, printType, isComplete, materialCost) {
  const tariff = TARIFFS[printType];
  const surface = (widthCm * heightCm) / 10000;
  const articlePrice = isComplete
    ? materialCost + surface * tariff
    : surface * tariff;
  const total = articlePrice * qty;

  const row = await nextRow(DEVIS_SHEET, 'A');

  await callScript('update', {
    sheet: DEVIS_SHEET,
    range: `A${row}:K${row}`,
    values: [[
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
    ]],
  });

  const plRow = await nextRow(PL_SHEET, 'A');
  await callScript('update', {
    sheet: PL_SHEET,
    range: `A${plRow}:D${plRow}`,
    values: [[
      client,
      `='Devis UV'!K${row}`,
      '',
      `=IF(C${plRow}="",B${plRow},C${plRow})`,
    ]],
  });

  return { client, widthCm, heightCm, qty, printType, surface, tariff, articlePrice, total, devisRow: row };
}

async function getQuotes(limit) {
  const res = await callScript('get', { sheet: DEVIS_SHEET, range: 'A4:K' });
  const rows = (res.values || [])
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
  const row = await nextRow(PL_SHEET, 'A');
  await callScript('update', {
    sheet: PL_SHEET,
    range: `A${row}:D${row}`,
    values: [[client, amount, '', amount]],
  });
  return { client, amount, row };
}

async function addLoss(description, amount) {
  const res = await callScript('get', { sheet: PL_SHEET, range: 'G5:G' });
  const vals = res.values || [];
  let offset = vals.length;
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i] || !vals[i][0] || !vals[i][0].trim()) {
      offset = i;
      break;
    }
  }
  const row = 5 + offset;

  await callScript('update', {
    sheet: PL_SHEET,
    range: `F${row}:G${row}`,
    values: [[description, amount]],
  });
  return { description, amount, row };
}

async function adjustPayment(clientSearch, amount) {
  const res = await callScript('get', { sheet: PL_SHEET, range: 'A5:D' });
  const rows = res.values || [];
  const search = clientSearch.toLowerCase().trim();
  let matchIdx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((rows[i][0] || '').toLowerCase().trim().includes(search)) {
      matchIdx = i;
      break;
    }
  }
  if (matchIdx === -1) return null;

  const sheetRow = 5 + matchIdx;
  await callScript('update', {
    sheet: PL_SHEET,
    range: `C${sheetRow}:D${sheetRow}`,
    values: [[amount, amount]],
  });

  return { client: rows[matchIdx][0], originalAmount: rows[matchIdx][1], adjusted: amount, row: sheetRow };
}

async function getBalance() {
  const [profitRes, lossRes] = await Promise.all([
    callScript('get', { sheet: PL_SHEET, range: 'D5:D' }),
    callScript('get', { sheet: PL_SHEET, range: 'G5:G' }),
  ]);

  const parseNum = (v) => parseFloat((v || '').toString().replace(/\s/g, '').replace(',', '.')) || 0;

  const profits = (profitRes.values || []).reduce((sum, r) => sum + parseNum(r[0]), 0);
  const losses = (lossRes.values || []).reduce((sum, r) => sum + parseNum(r[0]), 0);

  return {
    profits: Math.round(profits * 100) / 100,
    losses: Math.round(losses * 100) / 100,
    net: Math.round((profits - losses) * 100) / 100,
  };
}

async function getPLDetails() {
  const [profitRes, lossRes] = await Promise.all([
    callScript('get', { sheet: PL_SHEET, range: 'A5:D' }),
    callScript('get', { sheet: PL_SHEET, range: 'F5:G' }),
  ]);

  const profitRows = (profitRes.values || [])
    .filter(r => r[0] && r[0].trim())
    .map(r => ({ client: r[0], devis: r[1] || '', adjusted: r[2] || '', profit: r[3] || '' }));

  const lossRows = (lossRes.values || [])
    .filter(r => (r[0] && r[0].trim()) || (r[1] && r[1].toString().trim()))
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
