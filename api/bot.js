const { Telegraf, Markup } = require('telegraf');
const sheets = require('./sheets');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const OWNER_ID = process.env.OWNER_TELEGRAM_ID
  ? Number(process.env.OWNER_TELEGRAM_ID)
  : null;

function isOwner(ctx) {
  if (!OWNER_ID) return true;
  return ctx.from && ctx.from.id === OWNER_ID;
}

function fail(ctx, label, err) {
  console.error(`${label}:`, err.message);
  return ctx.reply(`Erreur (${label}) : ${err.message}`);
}

// ─── Main Menu ───────────────────────────────────────────

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://telegram-stock-vercel.vercel.app/';

const homeText = 'UV Printing\n\nOuvrez l\'app pour tout gerer, ou utilisez le bouton "App" a cote du champ de message.';

const menu = Markup.inlineKeyboard([
  [Markup.button.webApp('Ouvrir l\'app', WEBAPP_URL)],
  [Markup.button.callback('Solde', 'bal'), Markup.button.callback('P&L', 'pl')],
  [Markup.button.callback('Derniers devis', 'list'), Markup.button.callback('Aide', 'help')],
]);

const back = Markup.inlineKeyboard([[Markup.button.callback('« Menu', 'home')]]);

bot.start(async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
  if (isOwner(ctx)) {
    await ctx.telegram
      .setChatMenuButton({
        chatId: ctx.chat.id,
        menuButton: { type: 'web_app', text: 'App', web_app: { url: WEBAPP_URL } },
      })
      .catch((err) => console.error('menu button:', err.message));
  }
  return ctx.reply(homeText, menu);
});

bot.action('home', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.editMessageText(homeText, menu).catch(() => {});
});

// ─── Help ────────────────────────────────────────────────

const helpText =
  'Commandes :\n\n' +
  '/solde - Solde net (profits - pertes)\n\n' +
  '/devis <client> <larg_cm> <haut_cm> <qte> <type>\n' +
  '  Types : w, wv, wcv, eco, ecod\n' +
  '  Produit complet : ajouter oui <cout_materiau>\n' +
  '  Ex: /devis sami 23 10 53 wcv oui 155\n\n' +
  '/profit <client> <montant>\n' +
  '  Ex: /profit imed 4000\n\n' +
  '/perte <description> <montant>\n' +
  '  Ex: /perte "encre vernis" 13400\n\n' +
  '/ajuster <client> <montant>\n' +
  '  Ajuster le paiement recu\n' +
  '  Ex: /ajuster sami 1580\n\n' +
  '/envoyer <client> <montant> <reference>\n' +
  '  Generer message de paiement\n' +
  '  Ex: /envoyer Ahmed 18550 Impression UV boites\n\n' +
  '/pl - Bilan complet\n' +
  '/liste [n] - Derniers devis\n' +
  '/tarifs - Grille tarifaire';

bot.command('aide', (ctx) => ctx.reply(helpText));
bot.command('help', (ctx) => ctx.reply(helpText));
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.editMessageText(helpText, back).catch(() => {});
});

// ─── Balance / Solde ─────────────────────────────────────

async function sendBalance(ctx, edit) {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  try {
    const b = await sheets.getBalance();
    const text =
      `Solde\n` +
      `${'─'.repeat(22)}\n` +
      `Profits :  ${sheets.fmtDA(b.profits)}\n` +
      `Pertes :   ${sheets.fmtDA(b.losses)}\n` +
      `${'─'.repeat(22)}\n` +
      `Net :      ${sheets.fmtDA(b.net)}`;
    return edit ? ctx.editMessageText(text, back) : ctx.reply(text);
  } catch (err) {
    fail(ctx, 'balance', err);
  }
}

bot.command('solde', (ctx) => sendBalance(ctx, false));
bot.command('balance', (ctx) => sendBalance(ctx, false));
bot.action('bal', async (ctx) => {
  await ctx.answerCbQuery();
  sendBalance(ctx, true);
});

// ─── Devis ───────────────────────────────────────────────

bot.command('devis', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  const parts = ctx.message.text.split(/\s+/).slice(1);

  if (parts.length < 5) {
    return ctx.reply(
      'Usage : /devis <client> <larg_cm> <haut_cm> <qte> <type> [oui <cout>]\n\n' +
        'Types : w, wv, wcv, eco, ecod\n' +
        'Ex: /devis sami 23 10 53 wcv\n' +
        'Ex: /devis sami 23 10 53 wcv oui 155'
    );
  }

  const client = parts[0];
  const width = parseFloat(parts[1]);
  const height = parseFloat(parts[2]);
  const qty = parseInt(parts[3]);
  const typeInput = parts[4];

  if (isNaN(width) || isNaN(height) || isNaN(qty)) return ctx.reply('Dimensions et quantite doivent etre des nombres.');

  const printType = sheets.resolvePrintType(typeInput);
  if (!printType) {
    return ctx.reply(
      `Type inconnu : ${typeInput}\n` +
        'Types valides : w, wv, wcv, eco, ecod'
    );
  }

  let isComplete = false;
  let materialCost = 0;
  if (parts[5] && parts[5].toLowerCase() === 'oui') {
    isComplete = true;
    materialCost = parseFloat(parts[6]) || 0;
  }

  try {
    const q = await sheets.addQuote(client, width, height, qty, printType, isComplete, materialCost);
    ctx.reply(
      `Devis ajoute\n` +
        `${'─'.repeat(22)}\n` +
        `Client : ${q.client}\n` +
        `${q.widthCm}x${q.heightCm} cm x${q.qty}\n` +
        `Type : ${q.printType}\n` +
        `Surface : ${q.surface.toFixed(4)} m2\n` +
        `Tarif : ${sheets.fmtDA(q.tariff)}/m2\n` +
        `Article : ${sheets.fmtDA(q.articlePrice)}\n` +
        `${'─'.repeat(22)}\n` +
        `Total : ${sheets.fmtDA(q.total)}`
    );
  } catch (err) {
    fail(ctx, 'devis', err);
  }
});


// ─── Tarifs ──────────────────────────────────────────────

bot.command('tarifs', (ctx) => {
  let text = 'Tarifs DA/m2\n' + '─'.repeat(22) + '\n';
  for (const [code, rate] of Object.entries(sheets.TARIFFS)) {
    text += `${code} : ${sheets.fmtDA(rate)}\n`;
  }
  text += '─'.repeat(22) + '\n';
  text += 'Raccourcis : w, wv, wcv, eco, ecod';
  ctx.reply(text);
});

// ─── Profit ──────────────────────────────────────────────

bot.command('profit', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) return ctx.reply('Usage : /profit <client> <montant>\nEx: /profit imed 4000');

  const client = parts[0];
  const amount = parseFloat(parts[1]);
  if (isNaN(amount) || amount <= 0) return ctx.reply('Montant invalide.');

  try {
    const r = await sheets.addProfit(client, amount);
    const b = await sheets.getBalance();
    ctx.reply(
      `Profit ajoute\n\n` +
        `${r.client} : +${sheets.fmtDA(r.amount)}\n\n` +
        `Solde net : ${sheets.fmtDA(b.net)}`
    );
  } catch (err) {
    fail(ctx, 'profit', err);
  }
});


// ─── Perte ───────────────────────────────────────────────

bot.command('perte', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  const text = ctx.message.text.slice('/perte '.length).trim();

  let description, amountStr;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    if (end === -1) return ctx.reply('Fermez les guillemets.');
    description = text.slice(1, end);
    amountStr = text.slice(end + 1).trim();
  } else {
    const parts = text.split(/\s+/);
    if (parts.length < 2) return ctx.reply('Usage : /perte <description> <montant>\nEx: /perte "encre vernis" 13400');
    amountStr = parts.pop();
    description = parts.join(' ');
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return ctx.reply('Montant invalide.');

  try {
    const r = await sheets.addLoss(description, amount);
    const b = await sheets.getBalance();
    ctx.reply(
      `Perte ajoutee\n\n` +
        `${r.description} : -${sheets.fmtDA(r.amount)}\n\n` +
        `Solde net : ${sheets.fmtDA(b.net)}`
    );
  } catch (err) {
    fail(ctx, 'perte', err);
  }
});

bot.command('loss', (ctx) => {
  const newText = ctx.message.text.replace(/^\/loss/, '/perte');
  ctx.message.text = newText;
  return bot.handleUpdate({ message: ctx.message });
});


// ─── Ajuster ─────────────────────────────────────────────

bot.command('ajuster', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) return ctx.reply('Usage : /ajuster <client> <montant>\nEx: /ajuster sami 1580');

  const client = parts[0];
  const amount = parseFloat(parts[1]);
  if (isNaN(amount)) return ctx.reply('Montant invalide.');

  try {
    const r = await sheets.adjustPayment(client, amount);
    if (!r) return ctx.reply(`Client "${client}" non trouve dans P&L.`);
    ctx.reply(
      `Paiement ajuste\n\n` +
        `Client : ${r.client}\n` +
        `Devis : ${r.originalAmount} DA\n` +
        `Ajuste : ${sheets.fmtDA(r.adjusted)}`
    );
  } catch (err) {
    fail(ctx, 'ajuster', err);
  }
});
bot.command('adjust', (ctx) => {
  ctx.message.text = ctx.message.text.replace(/^\/adjust/, '/ajuster');
  return bot.handleUpdate({ message: ctx.message });
});

// ─── Envoyer message client ──────────────────────────────

bot.command('envoyer', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 3) {
    return ctx.reply(
      'Usage : /envoyer <client> <montant> <reference>\n' +
        'Ex: /envoyer Ahmed 18550 Impression UV boites'
    );
  }

  const client = parts[0];
  const amount = parseFloat(parts[1]);
  if (isNaN(amount) || amount <= 0) return ctx.reply('Montant invalide.');
  const reference = parts.slice(2).join(' ');

  await ctx.reply('Transférez le message suivant :');
  await ctx.reply(sheets.paymentMessage(client, amount, reference));
});

bot.command('send', (ctx) => {
  ctx.message.text = ctx.message.text.replace(/^\/send/, '/envoyer');
  return bot.handleUpdate({ message: ctx.message });
});


// ─── P&L ─────────────────────────────────────────────────

async function sendPL(ctx, edit) {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  try {
    const b = await sheets.getBalance();
    const details = await sheets.getPLDetails();

    let text =
      `BILAN P&L\n` +
      `${'═'.repeat(24)}\n` +
      `Profits :  ${sheets.fmtDA(b.profits)}\n` +
      `Pertes :   ${sheets.fmtDA(b.losses)}\n` +
      `Net :      ${sheets.fmtDA(b.net)}\n` +
      `${'═'.repeat(24)}\n\n`;

    if (details.profitRows.length) {
      text += `Profits (${details.profitRows.length})\n` + '─'.repeat(22) + '\n';
      for (const r of details.profitRows.slice(-8)) {
        const adj = r.adjusted ? ` → ${r.adjusted}` : '';
        text += `${r.client} : ${r.profit} DA${adj}\n`;
      }
      if (details.profitRows.length > 8) text += `... +${details.profitRows.length - 8} autres\n`;
      text += '\n';
    }

    if (details.lossRows.length) {
      text += `Pertes (${details.lossRows.length})\n` + '─'.repeat(22) + '\n';
      for (const r of details.lossRows) {
        text += `${r.description || '—'} : ${r.amount} DA\n`;
      }
    }

    return edit ? ctx.editMessageText(text, back) : ctx.reply(text);
  } catch (err) {
    fail(ctx, 'pl', err);
  }
}

bot.command('pl', (ctx) => sendPL(ctx, false));
bot.action('pl', async (ctx) => {
  await ctx.answerCbQuery();
  sendPL(ctx, true);
});

// ─── Liste devis ─────────────────────────────────────────

async function sendList(ctx, limit, edit) {
  if (!isOwner(ctx)) return ctx.reply('Non autorise.');
  try {
    const quotes = await sheets.getQuotes(limit || 10);
    if (!quotes.length) {
      const text = 'Aucun devis.';
      return edit ? ctx.editMessageText(text, back) : ctx.reply(text);
    }
    let text = `Derniers ${quotes.length} devis\n` + '─'.repeat(24) + '\n';
    for (const q of quotes) {
      text += `${q.client} | ${q.width}x${q.height} x${q.qty} | ${q.type} | ${q.total} DA\n`;
    }
    return edit ? ctx.editMessageText(text, back) : ctx.reply(text);
  } catch (err) {
    fail(ctx, 'list', err);
  }
}

bot.command('liste', (ctx) => {
  const n = parseInt(ctx.message.text.split(/\s+/)[1]) || 10;
  sendList(ctx, n, false);
});
bot.command('list', (ctx) => {
  const n = parseInt(ctx.message.text.split(/\s+/)[1]) || 10;
  sendList(ctx, n, false);
});
bot.action('list', async (ctx) => {
  await ctx.answerCbQuery();
  sendList(ctx, 10, true);
});

// ─── Vercel Handler ──────────────────────────────────────

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');
    await bot.handleUpdate(req.body);
    return res.status(200).send('ok');
  } catch (err) {
    console.error('Bot error', err);
    if (!res.headersSent) res.status(500).send('error');
  }
};
