const { Telegraf, Markup } = require('telegraf');
const { connect } = require('./db');
const sheets = require('./sheets');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const OWNER_ID = process.env.OWNER_TELEGRAM_ID
  ? Number(process.env.OWNER_TELEGRAM_ID)
  : null;
const SENDER_NAME = process.env.SENDER_NAME || '';

function isOwner(ctx) {
  if (!OWNER_ID) return true;
  return ctx.from && ctx.from.id === OWNER_ID;
}

// ─── Main Menu ───────────────────────────────────────────

const mainMenu = Markup.inlineKeyboard([
  [
    Markup.button.callback('Balance', 'bal'),
    Markup.button.callback('P&L', 'pl'),
  ],
  [
    Markup.button.callback('+ Income', 'hint_in'),
    Markup.button.callback('- Expense', 'hint_out'),
  ],
  [
    Markup.button.callback('Send Message', 'hint_send'),
    Markup.button.callback('History', 'hist'),
  ],
]);

bot.start((ctx) => {
  ctx.reply(
    'Finance Manager\n\n' +
      '/balance - Current balance\n' +
      '/in <amount> <description>\n' +
      '/out <amount> <description>\n' +
      '/send <client> <amount> <desc>\n' +
      '/pl - P&L summary\n' +
      '/addpl <desc> <revenue> <cost>\n' +
      '/history - Recent transactions\n\n' +
      'Or tap a button:',
    mainMenu
  );
});

bot.help((ctx) =>
  ctx.reply(
    'Commands:\n\n' +
      '/balance - Current balance\n' +
      '/in 5000 Client payment - Record income\n' +
      '/out 200 Office supplies - Record expense\n' +
      '/send Ahmed 3000 Invoice 42 - Payment message\n' +
      '/pl - This month P&L\n' +
      '/pl 2026-10 - Specific month\n' +
      '/addpl "Web dev" 15000 8000 - Add P&L entry\n' +
      '/history - Last 10 transactions\n' +
      '/history 20 - Last 20\n\n' +
      'Stock:\n' +
      '/add sku name qty warehouse_id\n' +
      '/update sku +/-qty\n' +
      '/inventory [warehouse_id]\n' +
      '/warehouses'
  )
);

// ─── Finance: Balance ────────────────────────────────────

async function sendBalance(ctx, edit) {
  if (!isOwner(ctx)) return ctx.reply('Not authorized.');
  try {
    await sheets.ensureSheets();
    const balance = await sheets.getBalance();
    const text = `Balance: ${sheets.fmt(balance)}`;
    return edit ? ctx.editMessageText(text) : ctx.reply(text);
  } catch (err) {
    console.error('balance:', err.message);
    ctx.reply('Could not fetch balance. Is Google Sheets configured?');
  }
}

bot.command('balance', (ctx) => sendBalance(ctx, false));
bot.action('bal', async (ctx) => {
  await ctx.answerCbQuery();
  sendBalance(ctx, true);
});

// ─── Finance: Income ─────────────────────────────────────

bot.command('in', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Not authorized.');
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 2)
    return ctx.reply('Usage: /in <amount> <description>\nExample: /in 5000 Client payment');

  const amount = parseFloat(parts[0]);
  if (isNaN(amount) || amount <= 0) return ctx.reply('Amount must be a positive number.');

  const description = parts.slice(1).join(' ');

  try {
    await sheets.ensureSheets();
    const tx = await sheets.addTransaction('IN', amount, description);
    ctx.reply(
      `Income recorded\n\n` +
        `+${sheets.fmt(amount)}\n` +
        `${description}\n` +
        `${tx.date}\n\n` +
        `Balance: ${sheets.fmt(tx.balance)}`
    );
  } catch (err) {
    console.error('in:', err.message);
    ctx.reply('Error recording income.');
  }
});

bot.action('hint_in', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('Send:\n/in 5000 Client payment from Ahmed');
});

// ─── Finance: Expense ────────────────────────────────────

bot.command('out', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Not authorized.');
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 2)
    return ctx.reply('Usage: /out <amount> <description>\nExample: /out 200 Office supplies');

  const amount = parseFloat(parts[0]);
  if (isNaN(amount) || amount <= 0) return ctx.reply('Amount must be a positive number.');

  const description = parts.slice(1).join(' ');

  try {
    await sheets.ensureSheets();
    const tx = await sheets.addTransaction('OUT', amount, description);
    ctx.reply(
      `Expense recorded\n\n` +
        `-${sheets.fmt(amount)}\n` +
        `${description}\n` +
        `${tx.date}\n\n` +
        `Balance: ${sheets.fmt(tx.balance)}`
    );
  } catch (err) {
    console.error('out:', err.message);
    ctx.reply('Error recording expense.');
  }
});

bot.action('hint_out', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('Send:\n/out 200 Office supplies');
});

// ─── Finance: Send Payment Message ───────────────────────

bot.command('send', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Not authorized.');
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 3)
    return ctx.reply(
      'Usage: /send <client> <amount> <description>\n' +
        'Example: /send Ahmed 3000 Project milestone 2'
    );

  const client = parts[0];
  const amount = parseFloat(parts[1]);
  if (isNaN(amount) || amount <= 0) return ctx.reply('Amount must be a positive number.');

  const description = parts.slice(2).join(' ');
  const date = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  try {
    await sheets.ensureSheets();
    await sheets.addTransaction('OUT', amount, description, client, 'Transfer');
    const balance = await sheets.getBalance();

    await ctx.reply(
      `Recorded: ${sheets.fmt(amount)} to ${client}\nBalance: ${sheets.fmt(balance)}\n\nForward the next message to your client:`
    );

    const sign = SENDER_NAME ? `\n${SENDER_NAME}` : '';

    await ctx.reply(
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `    PAYMENT CONFIRMATION\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `To: ${client}\n` +
        `Amount: ${sheets.fmt(amount)}\n` +
        `Reference: ${description}\n` +
        `Date: ${date}\n\n` +
        `Please confirm receipt.\n` +
        `Thank you for your business.` +
        sign +
        `\n━━━━━━━━━━━━━━━━━━━━━━`
    );
  } catch (err) {
    console.error('send:', err.message);
    ctx.reply('Error processing payment message.');
  }
});

bot.action('hint_send', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('Send:\n/send Ahmed 3000 Project milestone 2');
});

// ─── Finance: P&L ────────────────────────────────────────

async function sendPL(ctx, month, edit) {
  if (!isOwner(ctx)) return ctx.reply('Not authorized.');
  try {
    await sheets.ensureSheets();
    const target = month || new Date().toISOString().slice(0, 7);
    const pl = await sheets.getPLSummary(target);

    if (!pl.count) {
      const text = `No P&L entries for ${target}.`;
      return edit ? ctx.editMessageText(text) : ctx.reply(text);
    }

    let text =
      `P&L: ${target}\n` +
      `${'─'.repeat(24)}\n` +
      `Revenue:  ${sheets.fmt(pl.totalRevenue)}\n` +
      `Cost:     ${sheets.fmt(pl.totalCost)}\n` +
      `Profit:   ${sheets.fmt(pl.totalProfit)}\n` +
      `${'─'.repeat(24)}\n` +
      `Entries: ${pl.count}\n\n`;

    for (const r of pl.rows.slice(-10)) {
      text += `${r.date} | ${r.description} | R:${sheets.fmt(r.revenue)} C:${sheets.fmt(r.cost)}\n`;
    }
    if (pl.rows.length > 10) text += `... and ${pl.rows.length - 10} more`;

    return edit ? ctx.editMessageText(text) : ctx.reply(text);
  } catch (err) {
    console.error('pl:', err.message);
    ctx.reply('Error fetching P&L.');
  }
}

bot.command('pl', (ctx) => {
  const month = ctx.message.text.split(' ')[1] || null;
  sendPL(ctx, month, false);
});

bot.action('pl', async (ctx) => {
  await ctx.answerCbQuery();
  sendPL(ctx, null, true);
});

// ─── Finance: Add P&L Entry ─────────────────────────────

bot.command('addpl', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Not authorized.');
  const text = ctx.message.text.slice('/addpl '.length).trim();

  let description, rest;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    if (end === -1) return ctx.reply('Close the quote around description.');
    description = text.slice(1, end);
    rest = text.slice(end + 1).trim().split(/\s+/);
  } else {
    const parts = text.split(/\s+/);
    if (parts.length < 3)
      return ctx.reply(
        'Usage: /addpl <description> <revenue> <cost> [category]\n' +
          'Example: /addpl "Web Development" 15000 8000 Services'
      );
    description = parts[0];
    rest = parts.slice(1);
  }

  const revenue = parseFloat(rest[0]);
  const cost = parseFloat(rest[1]);
  const category = rest.slice(2).join(' ') || '';

  if (isNaN(revenue) || isNaN(cost))
    return ctx.reply('Revenue and cost must be numbers.');

  try {
    await sheets.ensureSheets();
    const entry = await sheets.addPLEntry(description, revenue, cost, category);
    ctx.reply(
      `P&L entry added\n\n` +
        `${entry.description}\n` +
        `Revenue: ${sheets.fmt(entry.revenue)}\n` +
        `Cost:    ${sheets.fmt(entry.cost)}\n` +
        `Profit:  ${sheets.fmt(entry.profit)}\n` +
        (entry.category ? `Category: ${entry.category}\n` : '') +
        `Date: ${entry.date}`
    );
  } catch (err) {
    console.error('addpl:', err.message);
    ctx.reply('Error adding P&L entry.');
  }
});

// ─── Finance: History ────────────────────────────────────

async function sendHistory(ctx, limit, edit) {
  if (!isOwner(ctx)) return ctx.reply('Not authorized.');
  try {
    await sheets.ensureSheets();
    const txs = await sheets.getTransactions(limit || 10);

    if (!txs.length) {
      const text = 'No transactions yet.';
      return edit ? ctx.editMessageText(text) : ctx.reply(text);
    }

    let text = `Last ${txs.length} transactions:\n${'─'.repeat(28)}\n`;
    for (const tx of txs) {
      const sign = tx.type === 'IN' ? '+' : '-';
      const client = tx.client ? ` (${tx.client})` : '';
      text += `${tx.date} | ${sign}${sheets.fmt(tx.amount)} | ${tx.description}${client}\n`;
    }

    return edit ? ctx.editMessageText(text) : ctx.reply(text);
  } catch (err) {
    console.error('history:', err.message);
    ctx.reply('Error fetching history.');
  }
}

bot.command('history', (ctx) => {
  const n = parseInt(ctx.message.text.split(' ')[1]) || 10;
  sendHistory(ctx, n, false);
});

bot.action('hist', async (ctx) => {
  await ctx.answerCbQuery();
  sendHistory(ctx, 10, true);
});

// ─── Stock Management (existing) ─────────────────────────

bot.command('warehouses', async (ctx) => {
  const db = await connect();
  const list = await db.collection('warehouses').find({}).toArray();
  if (!list.length) return ctx.reply('No warehouses yet.');
  ctx.reply(list.map((w) => `${w._id} — ${w.name}`).join('\n'));
});

bot.command('add', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 3)
    return ctx.reply('Usage: /add sku name qty [warehouseId]');
  const sku = parts[0];
  const qty = Number(parts[parts.length - 2]);
  const warehouseId = parts[parts.length - 1];
  const name = parts.slice(1, parts.length - 2).join(' ');
  const db = await connect();
  await db
    .collection('items')
    .updateOne(
      { sku },
      { $set: { sku, name, qty, warehouseId, createdAt: new Date() } },
      { upsert: true }
    );
  ctx.reply(
    `Added/Updated ${name} (sku: ${sku}) — qty: ${qty} — warehouse: ${warehouseId}`
  );
});

bot.command('update', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 2) return ctx.reply('Usage: /update sku +/-qty');
  const sku = parts[0];
  const delta = Number(parts[1]);
  const db = await connect();
  const res = await db
    .collection('items')
    .findOneAndUpdate(
      { sku },
      { $inc: { qty: delta } },
      { returnDocument: 'after' }
    );
  if (!res.value) return ctx.reply('Item not found.');
  ctx.reply(`Updated ${res.value.name} — new qty: ${res.value.qty}`);
});

bot.command('inventory', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const warehouseId = parts[0];
  const db = await connect();
  const q = warehouseId ? { warehouseId } : {};
  const items = await db.collection('items').find(q).toArray();
  if (!items.length) return ctx.reply('No items found.');
  ctx.reply(
    items
      .map(
        (it) =>
          `${it.name} (sku:${it.sku}) — ${it.qty} — w:${it.warehouseId || 'default'}`
      )
      .join('\n')
  );
});

// ─── Vercel Handler ──────────────────────────────────────

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');
    await bot.handleUpdate(req.body, res);
    return res.status(200).send('ok');
  } catch (err) {
    console.error('Bot error', err);
    return res.status(500).send('error');
  }
};
