# GRIM production deployment

This package is prepared for Render as a Node web service.

## Required secrets
- ADMIN_PASSWORD: private Owner Studio password
- STORE_OWNER_EMAIL: inbox for orders/support
- SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM: add when order email is ready

## Persistent data
DATA_DIR is `/var/data`. Attach the included 1 GB persistent disk at `/var/data` so `grim.db` and Owner Studio image uploads survive redeploys.

## URLs
- Store: `/`
- Shop: `/shop.html`
- Owner Studio: `/admin.html`
- Health check: `/health`

The server trusts Render's first reverse proxy so secure production sessions work behind HTTPS.
