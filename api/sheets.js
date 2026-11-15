const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

const DEVIS_SHEET = 'Devis UV';
const PL_SHEET = 'Profits & Pertes';
const PL_FIRST_ROW = 5;
// P&L column E: "Oui" = paid, "Non" = still owed (credit), blank = not tracked (counted as paid).
const paidCell = (paid) => (paid ? 'Oui' : 'Non');
const isUnpaid = (v) => /^non$/i.test(String(v || '').trim());
const parseNum = (v) => parseFloat((v || '').toString().replace(/\s/g, '').replace(',', '.')) || 0;

// Price table on the Devis UV tab: code (M), description (N), DA/m² (O), from row 5 down to the first blank code.
const TARIFF_FIRST_ROW = 5;
const DEVIS_FIRST_ROW = 4;

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
  // Connections to Google occasionally drop (e.g. TLS reset), so network failures are retried.
  // Safe for writes too: every update targets a fixed range, so sending it twice writes the same cells.
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, action, ...params }),
      });
      break;
    } catch (err) {
      if (attempt >= 3) throw new Error(`Apps Script injoignable: ${err.cause?.message || err.message}`);
      console.warn(`Apps Script attempt ${attempt} failed: ${err.cause?.message || err.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
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

async function getTariffs() {
  const range = `M${TARIFF_FIRST_ROW}:O${TARIFF_FIRST_ROW + 19}`;
  const rows = (await callScript('get', { sheet: DEVIS_SHEET, range })).values || [];
  const tariffs = [];
  for (const [i, r] of rows.entries()) {
    const code = String(r[0] || '').trim();
    if (!code) break;
    tariffs.push({ row: TARIFF_FIRST_ROW + i, code, label: String(r[1] || '').trim(), rate: parseNum(r[2]) });
  }
  return tariffs;
}

// Existing quotes look their price up from the table, so they are pinned at today's price before the table changes.
async function setTariffs(updates) {
  const tariffs = await getTariffs();
  const changed = tariffs.filter((t) => Object.hasOwn(updates, t.code) && updates[t.code] !== t.rate);
  if (!changed.length) return { changed: 0, pinned: 0 };

  const codes = new Set(changed.map((t) => t.code.toLowerCase()));
  const quotes = (await callScript('get', { sheet: DEVIS_SHEET, range: `A${DEVIS_FIRST_ROW}:I` })).values || [];
  const pins = [];
  quotes.forEach((r, i) => {
    const isQuote = String(r[0] || '').trim() && codes.has(String(r[4] || '').trim().toLowerCase());
    if (isQuote && String(r[8] || '').trim() !== '') pins.push({ row: DEVIS_FIRST_ROW + i, rate: parseNum(r[8]) });
  });
  await Promise.all(pins.map((p) => callScript('update', { sheet: DEVIS_SHEET, range: `I${p.row}:I${p.row}`, values: [[p.rate]] })));

  const first = tariffs[0].row;
  const last = tariffs[tariffs.length - 1].row;
  await callScript('update', {
    sheet: DEVIS_SHEET,
    range: `O${first}:O${last}`,
    values: tariffs.map((t) => [Object.hasOwn(updates, t.code) ? updates[t.code] : t.rate]),
  });
  return { changed: changed.length, pinned: pins.length };
}

// ─── Matériaux (plaques) ─────────────────────────────────
const MAT_SHEET = 'Matériaux';
const MAT_FIRST_ROW = 4;
const MAT_LAST_ROW = 60;

async function getMaterials() {
  let rows;
  try {
    rows = (await callScript('get', { sheet: MAT_SHEET, range: `A${MAT_FIRST_ROW}:D${MAT_LAST_ROW}` })).values || [];
  } catch (err) {
    if (/sheet not found/i.test(err.message)) return [];
    throw err;
  }
  return rows
    .map((r, i) => ({ row: MAT_FIRST_ROW + i, name: String(r[0] || '').trim(), width: parseNum(r[1]), height: parseNum(r[2]), price: parseNum(r[3]) }))
    .filter((m) => m.name);
}

async function saveMaterial({ row, name, width, height, price }) {
  let target = Number(row) || 0;
  if (!target) {
    const names = (await callScript('get', { sheet: MAT_SHEET, range: `A${MAT_FIRST_ROW}:A${MAT_LAST_ROW}` })).values || [];
    const free = names.findIndex((r) => !String(r[0] || '').trim());
    target = MAT_FIRST_ROW + (free === -1 ? names.length : free);
  }
  if (!Number.isInteger(target) || target < MAT_FIRST_ROW || target > MAT_LAST_ROW) return null;
  await callScript('update', { sheet: MAT_SHEET, range: `A${target}:D${target}`, values: [[name, width, height, price]] });
  return { row: target, name, width, height, price };
}

async function deleteMaterial(row) {
  const r = Number(row);
  if (!Number.isInteger(r) || r < MAT_FIRST_ROW || r > MAT_LAST_ROW) return null;
  await callScript('update', { sheet: MAT_SHEET, range: `A${r}:D${r}`, values: [['', '', '', '']] });
  return { row: r };
}

function resolvePrintType(input, tariffs) {
  const lower = String(input || '').toLowerCase().trim();
  const code = (TYPE_ALIASES[lower] || lower).toLowerCase();
  return tariffs.find((t) => t.code.toLowerCase() === code) || null;
}

function fmtDA(n) {
  return Number(n).toLocaleString('fr-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DA';
}

function paymentMessage(client, amount, reference) {
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const line = '━'.repeat(22);
  return (
    `${line}\n  CONFIRMATION DE PAIEMENT\n${line}\n\n` +
    `Destinataire : ${client}\n` +
    `Montant : ${fmtDA(amount)}\n` +
    `Ref : ${reference}\n` +
    `Date : ${date}\n\n` +
    `Merci de confirmer la reception.\n${line}`
  );
}

async function nextRow(sheet, col) {
  const res = await callScript('get', { sheet, range: `${col}1:${col}` });
  return (res.values || []).length + 1;
}

// ─── Devis UV ────────────────────────────────────────────

async function addQuote(client, widthCm, heightCm, qty, printTariff, isComplete, materialCost, paid = false, finalPrice = null) {
  const printType = printTariff.code;
  const tariff = printTariff.rate;
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
    range: `A${plRow}:E${plRow}`,
    values: [[
      client,
      `='Devis UV'!K${row}`,
      finalPrice ?? '',
      `=IF(C${plRow}="",B${plRow},C${plRow})`,
      paidCell(paid),
    ]],
  });

  return { client, widthCm, heightCm, qty, printType, surface, tariff, articlePrice, total, finalPrice, devisRow: row };
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

async function addProfit(client, amount, paid = true) {
  const row = await nextRow(PL_SHEET, 'A');
  await callScript('update', {
    sheet: PL_SHEET,
    range: `A${row}:E${row}`,
    values: [[client, amount, '', amount, paidCell(paid)]],
  });
  return { client, amount, row };
}

async function setPaid(rows, paid) {
  const targets = new Set(rows.map(Number).filter((r) => Number.isInteger(r) && r >= PL_FIRST_ROW && r < 100000));
  if (!targets.size) return { updated: 0 };
  const last = Math.max(...targets);
  const range = `E${PL_FIRST_ROW}:E${last}`;
  const current = (await callScript('get', { sheet: PL_SHEET, range })).values || [];
  const values = [];
  for (let r = PL_FIRST_ROW; r <= last; r++) {
    const existing = current[r - PL_FIRST_ROW] ? current[r - PL_FIRST_ROW][0] : '';
    values.push([targets.has(r) ? paidCell(paid) : existing]);
  }
  await callScript('update', { sheet: PL_SHEET, range, values });
  return { updated: targets.size };
}

// Writes the agreed amount into "Ajusté" (C) for one P&L row; null clears it so the devis price applies again.
async function setOrderAmount(row, amount) {
  const r = Number(row);
  if (!Number.isInteger(r) || r < PL_FIRST_ROW) return null;
  const current = (await callScript('get', { sheet: PL_SHEET, range: `A${r}:A${r}` })).values || [];
  if (!current[0] || !String(current[0][0] || '').trim()) return null;
  await callScript('update', {
    sheet: PL_SHEET,
    range: `C${r}:D${r}`,
    values: [[amount ?? '', `=IF(C${r}="",B${r},C${r})`]],
  });
  return { row: r, client: current[0][0], amount };
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
    callScript('get', { sheet: PL_SHEET, range: 'D5:E' }),
    callScript('get', { sheet: PL_SHEET, range: 'G5:G' }),
  ]);

  const profitRows = profitRes.values || [];
  const profits = profitRows.reduce((sum, r) => sum + parseNum(r[0]), 0);
  const credit = profitRows.reduce((sum, r) => sum + (isUnpaid(r[1]) ? parseNum(r[0]) : 0), 0);
  const losses = (lossRes.values || []).reduce((sum, r) => sum + parseNum(r[0]), 0);
  const round = (n) => Math.round(n * 100) / 100;

  return { profits: round(profits), losses: round(losses), net: round(profits - losses), credit: round(credit) };
}

async function getPLDetails() {
  const [profitRes, lossRes] = await Promise.all([
    callScript('get', { sheet: PL_SHEET, range: 'A5:E' }),
    callScript('get', { sheet: PL_SHEET, range: 'F5:G' }),
  ]);

  const profitRows = (profitRes.values || [])
    .map((r, i) => ({
      row: PL_FIRST_ROW + i,
      client: r[0] || '',
      devis: r[1] || '',
      adjusted: r[2] || '',
      profit: r[3] || '',
      paid: isUnpaid(r[4]) ? 'Non' : String(r[4] || '').trim(),
    }))
    .filter(r => r.client.trim());

  const lossRows = (lossRes.values || [])
    .filter(r => (r[0] && r[0].trim()) || (r[1] && r[1].toString().trim()))
    .map(r => ({ description: r[0] || '', amount: r[1] || '' }));

  return { profitRows, lossRows };
}

module.exports = {
  resolvePrintType,
  fmtDA,
  paymentMessage,
  addQuote,
  getQuotes,
  addProfit,
  setPaid,
  setOrderAmount,
  addLoss,
  adjustPayment,
  getBalance,
  getPLDetails,
  getTariffs,
  setTariffs,
  getMaterials,
  saveMaterial,
  deleteMaterial,
  TYPE_ALIASES,
};
