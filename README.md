# Telegram UV Printing Bot

Telegram bot that manages a Google Sheet for a UV printing business. Deployed on Vercel.

## Features

- **Devis** — Add UV print quotes with auto-calculated prices (by type and surface area)
- **P&L** — Track profits and losses, view balance
- **Payment messages** — Generate payment confirmations to forward to clients
- **Adjust** — Record adjusted payments when they differ from the quote

## Commands

| Command | Description |
|---------|-------------|
| `/solde` | Net balance (profits - losses) |
| `/devis <client> <w_cm> <h_cm> <qty> <type>` | Add quote (types: w, wv, wcv, eco, ecod) |
| `/profit <client> <montant>` | Add standalone profit |
| `/perte <desc> <montant>` | Add loss (ink, materials, etc.) |
| `/ajuster <client> <montant>` | Adjust a client's payment |
| `/envoyer <client> <montant> <ref>` | Generate payment message |
| `/pl` | Full P&L breakdown |
| `/liste` | Recent quotes |
| `/tarifs` | Print rate card |

## Setup

1. **Telegram bot** — Create via [@BotFather](https://t.me/BotFather), copy the token.

2. **Google service account** — In [Google Cloud Console](https://console.cloud.google.com):
   - Enable **Google Sheets API**
   - Create a service account, download the JSON key
   - Share the spreadsheet with the service account email (Editor access)
   - Base64-encode the JSON: `base64 -i key.json`

3. **Deploy to Vercel** — Add env vars: `TELEGRAM_BOT_TOKEN`, `GOOGLE_CREDENTIALS_BASE64`, `SPREADSHEET_ID`, `OWNER_TELEGRAM_ID`.

4. **Set webhook**:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<VERCEL_URL>/api/bot
   ```
