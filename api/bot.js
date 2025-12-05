/**
 * Vercel serverless function (api/bot.js)
 * Uses Telegraf in webhook mode: Vercel calls this with Telegram updates.
 *
 * Environment variables required:
 * - TELEGRAM_BOT_TOKEN
 * - MONGO_URI
 * - BASE_URL (optional)
 *
 * Note: Keep functions lightweight. For production, add proper validation and auth.
 */
const { Telegraf } = require('telegraf');
const { connect } = require('./db');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Simple admin check - replace with real user IDs
const ADMINS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean).map(x => Number(x));

bot.start((ctx) => ctx.reply('Welcome to Stock Manager. Use /help for commands.'));
bot.help((ctx) => ctx.reply('/add sku name qty warehouse_id\n/update sku +/-qty\n/inventory [warehouse_id]\n/warehouses'));

bot.command('warehouses', async (ctx) => {
  const db = await connect();
  const list = await db.collection('warehouses').find({}).toArray();
  if (!list.length) return ctx.reply('No warehouses yet.');
  const text = list.map(w => `• ${w._id} — ${w.name}`).join('\n');
  ctx.reply(text);
});

bot.command('add', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  // expected: sku name qty warehouseId (name may have underscores)
  if (parts.length < 3) return ctx.reply('Usage: /add sku name qty [warehouseId]');
  const sku = parts[0];
  const qty = Number(parts[parts.length-2]);
  const warehouseId = parts[parts.length-1];
  const name = parts.slice(1, parts.length-2).join(' ');
  const db = await connect();
  const item = {
    sku, name, qty, warehouseId, createdAt: new Date()
  };
  await db.collection('items').updateOne({ sku }, { $set: item }, { upsert: true });
  ctx.reply(`Added/Updated item ${name} (sku: ${sku}) — qty: ${qty} — warehouse: ${warehouseId}`);
});

bot.command('update', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 2) return ctx.reply('Usage: /update sku +/-qty');
  const sku = parts[0];
  const delta = Number(parts[1]);
  const db = await connect();
  const res = await db.collection('items').findOneAndUpdate({ sku }, { $inc: { qty: delta } }, { returnDocument: 'after' });
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
  const text = items.map(it => `${it.name} (sku:${it.sku}) — ${it.qty} — w:${it.warehouseId || 'default'}`).join('\n');
  ctx.reply(text);
});

// Vercel serverless handler
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
