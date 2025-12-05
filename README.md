# Telegram Stock Management — Starter Repo
A starter project for a Telegram-based stock management system with a chic Chinese-like UI (English/Arabic/Chinese) and scanning features (2D barcode/QR scanning and 3D model preview). Designed to be deployed to **Vercel** (serverless API) and includes a React web UI.

## What's included
- `api/bot.js` — Vercel serverless function that handles Telegram webhook using Telegraf (webhook mode).
- `api/db.js` — MongoDB connection helper.
- `web/` — React (Vite) frontend with inventory UI, multi-warehouse support, language toggle (EN/AR/CN), QR/barcode scanning page (uses `html5-qrcode`) and 3D preview using `<model-viewer>`.
- `README.md` — this file with instructions.

## Quick setup
1. Create a Telegram bot via BotFather → get `TELEGRAM_BOT_TOKEN`.
2. Create a MongoDB Atlas cluster → get `MONGO_URI`.
3. Deploy to Vercel:
   - Add environment variables: `TELEGRAM_BOT_TOKEN`, `MONGO_URI`, `BASE_URL` (your Vercel domain)
   - Push this repo to GitHub and import on Vercel OR use `vercel` CLI.
4. Set the Telegram webhook:
```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<YOUR_BASE_URL>/api/bot
```

## Notes & next steps
- This is a starter. Security (auth & role checks), validations, and production hardening are left for you to extend.
- 3D scanning: we provide a *3D model-preview* flow (if product metadata contains `modelUrl`, the frontend shows it using `<model-viewer>`). Full AR scanning requires extra libraries and mobile device support.
- For multi-warehouse: create warehouses in DB and assign items to warehouses.

Enjoy! If you want, I can extend this to a full GitHub repo with CI, role-based access, and extra features.
