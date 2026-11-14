# GRIM hybrid delivery — batch 2 (admin rates UI)

Based on the provided main-branch website ZIP and previous integration package. Adds `public/grim-admin/delivery-rates.html`, `.css`, `.js`, a link from shipping admin, and a protected PATCH endpoint for updating existing zone rates. No production access attempted.

New rates default disabled unless an authenticated admin explicitly checks Enable. The customer estimate flag is still **OFF**, no payment link/quote creation is wired, and normal checkout stays as-is. Rates must be real prices verified by GRIM, not sample figures.

Before using: back up DB; review and run `migrations/*hybrid*` migration in a test DB; test admin login, rate CRUD, and mobile layout; verify `/api/checkout2/admin` route prefix (check route mount) and exact Origin handling on custom domain. No production deploy without acceptance testing and approval.

Still to implement: manual quote persistence, immutable cart snapshots and expiring server-created payment requests, idempotent payment verification, notification delivery/audit, customer tracking, end-to-end testing. No SMS sender or secrets configured by this ZIP.
