# GRIM Real Store

This is a deployable full-stack starter, not just a visual mockup.

## Working features
- Create customer accounts
- Log in with hashed passwords
- Persistent server sessions
- Product catalog and cart
- Customer checkout form
- Orders stored in SQLite
- Automatic owner email for every order when SMTP is configured
- Exact GRIM logo/art assets uploaded in the conversation
- Mobile-responsive storefront

## Start locally
1. Install Node.js 20+
2. Rename `.env.example` to `.env`
3. Set `SESSION_SECRET`
4. Set `STORE_OWNER_EMAIL` to the inbox that should receive order notifications
5. Add your SMTP settings
6. Run `npm install`
7. Run `npm start`
8. Open `http://localhost:3000`

## Before taking real money
A payment processor is intentionally not hard-coded because your merchant account/payment provider has not been supplied. Connect a supported payment gateway and verify successful payment server-side before marking an order paid.

For a public production launch also enable HTTPS/secure cookies, add password-reset email, rate limiting, CSRF protection, shipping rules, returns/privacy/terms, backups, and an owner admin dashboard.


V3: retail multi-page UX, paginated shop, category navigation, corrected pricing: Hoodie ₦28,000; Tee ₦18,000; Armless ₦15,000; Complete GRIM Outfit ₦90,000. House of GRIM links to WhatsApp.
