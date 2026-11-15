// Telegram sends the secret_token given to setWebhook in this header on every update,
// so /api/bot can reject requests that did not come from Telegram.
const crypto = require('crypto');

const HEADER = 'x-telegram-bot-api-secret-token';

// Derived from the bot token: no extra setting to manage, and a new token gives a new secret.
function webhookSecret() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  return crypto.createHmac('sha256', token).update('telegram-webhook').digest('hex');
}

function isFromTelegram(req) {
  const got = Buffer.from(String(req.headers[HEADER] || ''));
  const want = Buffer.from(webhookSecret());
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function telegramCall(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
  return data.result;
}

// Re-registers the current webhook URL with the secret (allowed_updates and pending updates are kept).
async function secureWebhook(fallbackUrl) {
  const info = await telegramCall('getWebhookInfo');
  const url = info.url || fallbackUrl;
  await telegramCall('setWebhook', { url, secret_token: webhookSecret() });
  return url;
}

module.exports = { isFromTelegram, secureWebhook, webhookSecret };
