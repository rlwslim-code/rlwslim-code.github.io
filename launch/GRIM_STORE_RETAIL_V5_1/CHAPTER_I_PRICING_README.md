# GRIM Chapter I — Liquid Glass + Product Pricing Correction

This ZIP **replaces** the previous GRIM_CHAPTER_I_LIQUID_GLASS_RESTORED_UPDATE.zip.

## New launch prices (NGN)

| Type | Launch (active charge) | Regular (reference only) |
|---|---:|---:|
| Tee | ₦25,000 | ₦28,000 |
| Hoodie | ₦45,000 | ₦48,000 |
| Sweat Jacket | ₦32,000 | ₦35,000 |
| Armless | ₦20,000 | ₦25,000 |
| Cap | ₦16,000 | ₦18,000 |
| Beanie | ₦16,000 | ₦18,000 |
| Complete GRIM Outfit | ₦100,000 | ₦105,000 |

This is the **latest proposed price schedule** from our November planning. No automatic discount banners or crossed-out regular prices are enabled until pricing is confirmed.

## Why the SQL step is necessary

The GRIM website gets real, chargeable prices from `GET /api/products`, backed by Supabase `public.products`. **The browser fallback cannot alter that live database or the checkout price.** Updating `public/app.js` alone would only change the fallback numbers used if the API fails.

## Safe order of operations

1. Commit/back up the current site before merging this ZIP. Use `launch/GRIM_STORE_RETAIL_V5_1` for the existing project. Copy only files from this ZIP; do not overwrite other files or production environment variables.
2. Preserve the liquid-glass `grim-liquid.css` and `grim-liquid.js` (both included) together with the launch pages.
3. Before making ANY price changes, open Supabase SQL Editor on the database used by GRIM production and run `sql/CHAPTER_I_PRICE_PREVIEW_READ_ONLY.sql`. Review all rows. This reports missing products, product type/name mismatches and edited prices.
4. Only if the preview shows `READY TO UPDATE` and/or `ALREADY UPDATED` for the intended products, run `sql/CHAPTER_I_PRICE_APPLY_SUPABASE.sql`. This updates **only `price`**, targets 25 IDs with exact name+type matches, and refuses any unexpected price or identity differences. It does not create missing products or change other tables.
5. Run `sql/CHAPTER_I_PRICE_VERIFY_READ_ONLY.sql` and verify all intended live product prices. Check `https://www.grimwear.store/api/products` after changes and preview the storefront. Confirm cart/subtotal and checkout server amounts, but do not initiate a real charge merely to test.
6. Complete real stock/size checks, delivery setup, and a controlled end-to-end payment test before promoting sales. Launch source derives from a 12 October 2026 archive; diff against any newer production changes first.

## Changes in this package

- `public/app.js` — old *fallback* catalogue prices updated (Tee 18k → 25k; Hoodie 28k → 45k; Armless 15k → 20k; Complete GRIM Outfit 90k → 100k). Live catalogue always takes priority.
- `sql/CHAPTER_I_PRICE_PREVIEW_READ_ONLY.sql` — inspect the database before updating.
- `sql/CHAPTER_I_PRICE_APPLY_SUPABASE.sql` — guarded production price update, **manual execution only**.
- `sql/CHAPTER_I_PRICE_VERIFY_READ_ONLY.sql` — verify after update.
- `CHAPTER_I_PRICES.json` — complete proposed launch and regular price schedule, including types not yet in the archived product list.
- Previous launch and liquid-glass frontend styling/scripts included unchanged.

**Important:** No production database has been changed by preparing this ZIP. Prices will not change in real checkout until an authorized Supabase update is applied. No payment, wallet, shipping or admin backend file is replaced in this package.
