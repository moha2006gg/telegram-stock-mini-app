const crypto = require('crypto');
const { Telegram } = require('telegraf');
const sheets = require('./sheets');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);
const MAX_AGE_S = 7 * 24 * 3600;

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!initData || !TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (expected.length !== hash.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date')) > MAX_AGE_S) return null;
  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const num = (v) => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
const str = (v) => String(v ?? '').trim();

const actions = {
  async summary() {
    const [balance, pl] = await Promise.all([sheets.getBalance(), sheets.getPLDetails()]);
    return { balance, orders: pl.profitRows, losses: pl.lossRows, tariffs: sheets.TARIFFS };
  },

  async devis(b) {
    const description = str(b.description);
    const client = description ? `${str(b.client)} / ${description}` : str(b.client);
    const width = num(b.width);
    const height = num(b.height);
    const qty = parseInt(b.qty, 10);
    const type = sheets.resolvePrintType(str(b.type));
    const complete = Boolean(b.complete);
    const material = complete ? num(b.material) || 0 : 0;
    if (!str(b.client)) throw bad('Client requis');
    if (!(width > 0) || !(height > 0) || !(qty > 0)) throw bad('Dimensions et quantite invalides');
    if (!type) throw bad('Type inconnu');
    return sheets.addQuote(client, width, height, qty, type, complete, material, Boolean(b.paid));
  },

  async profit(b) {
    const client = str(b.client);
    const amount = num(b.amount);
    if (!client || !(amount > 0)) throw bad('Client et montant requis');
    return sheets.addProfit(client, amount, b.paid !== false);
  },

  async payer(b) {
    if (!Array.isArray(b.rows) || !b.rows.length) throw bad('Aucune commande choisie');
    return sheets.setPaid(b.rows, b.paid !== false);
  },

  async perte(b) {
    const description = str(b.description);
    const amount = num(b.amount);
    if (!description || !(amount > 0)) throw bad('Description et montant requis');
    return sheets.addLoss(description, amount);
  },

  async ajuster(b) {
    const client = str(b.client);
    const amount = num(b.amount);
    if (!client || !Number.isFinite(amount)) throw bad('Client et montant requis');
    const r = await sheets.adjustPayment(client, amount);
    if (!r) throw bad(`Client "${client}" non trouve dans P&L`);
    return r;
  },

  // Posts the previewed text into the owner's own chat so it can be forwarded to the client.
  async envoyer(b) {
    const text = str(b.text);
    if (!text) throw bad('Message vide');
    if (text.length > 4000) throw bad('Message trop long');
    await new Telegram(TOKEN).sendMessage(OWNER_ID, text);
    return { ok: true };
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const body = req.body || {};
  const user = verifyInitData(body.initData);
  if (!user || user.id !== OWNER_ID) return res.status(401).json({ error: 'Non autorise' });

  const action = Object.hasOwn(actions, body.action) ? actions[body.action] : null;
  if (!action) return res.status(400).json({ error: 'Action inconnue' });

  try {
    return res.status(200).json(await action(body));
  } catch (err) {
    console.error(`app ${body.action}:`, err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
