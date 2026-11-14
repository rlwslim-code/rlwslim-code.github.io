# GRIM — RAV’KAEL Chapter I Arrival / Storefront Update
Date: 14 November 2026
Source: User-supplied GitHub `main` archive (archived source files dated approximately 12 October 2026).

## Scope
This is a presentation and navigation upgrade for the **existing** GRIM Store.

- Replaces Preorder homepage and shop banners with **Chapter I Has Arrived**.
- Adds a full luxury launch landing page with original GRIM artwork, clear purchase navigation, category entrances (Hoodie / Tee / Complete GRIM Outfit), a brand story, Customer Care link, House of GRIM, and the existing newsletter endpoint.
- Adds a live read-only featured-catalogue section (`GET /api/products`), which uses active catalogued products and their listed prices. If that API is unavailable, the section shows a clear link to the shop instead of invented stock or price data.
- Adds homepage category links supported by `shop.html?category=...` and optional `shop.html?search=...` links.
- Preserves original GRIM design and logo image files byte-for-byte. Existing mockup imagery is used until actual launch product photography is provided.
- Enhances desktop and mobile styling, including fixing dark-on-dark header links on the changed pages.

## Exactly which original files changed

- `public/index.html`
- `public/shop.html`
- `public/story.html` (old preorder labels only)
- `public/app.js` (shop query-string filters only)

## New files

- `public/grim-launch.css`
- `public/grim-launch.js`
- `tests/launch/storefront.test.cjs`
- `CHAPTER_I_LAUNCH_RELEASE.md`

## Not changed
Backend, customer accounts, payment providers, wallet, shipping, admin, Supabase SQL, package configuration, checkout API routes, and original logos/mockups remain untouched. No inventory quantities, discounts, shipping rates, or customer reviews are invented.

**Important limitation:** `GET /api/products` in this archive exposes active products but not verified on-hand quantity or size-by-size inventory. The arrival announcement applies to the collection; it is **not** a certification that every item and size is available. Confirm availability and fulfilment before selling pieces. Current media assets are design mockups, not photos of delivered stock.

## Testing performed

- `node scripts/check-syntax.cjs` — all JavaScript files passed syntax checks.
- `node --test tests/launch/storefront.test.cjs` — four tests passed.
- Desktop 1440px and mobile 390px visual layout checks using the existing asset files — no horizontal overflow observed.
- Live payment, physical shipping and existing production deployments were **not** exercised. This update does not certify those systems.

## Safe merge/deploy procedure (recommended)

1. In your PC GitHub repository, back up or commit the currently checked-out `main` before editing; verify that it is synced with the deployed Vercel project.
2. If using the small **UPDATE_ONLY ZIP**, extract and merge the `launch/GRIM_STORE_RETAIL_V5_1/` directory into the same path in the existing repository. **Copy/overwrite only the files in the patch, without deleting anything**.
3. If using the full project reference ZIP instead, avoid blindly replacing newer live code. Its source baseline is the archive provided to this chat. Prefer cherry-picking the files named under "Exactly which original files changed" plus the new CSS/JS.
4. Ensure Vercel uses the existing GRIM project with Root Directory `launch/GRIM_STORE_RETAIL_V5_1`, as in the existing setup. Do not create a new Vercel project or replace environment variables.
5. Verify before promotion: desktop/mobile homepage and category links; live `GET /api/products` and active products; real product photos and quantities; log-in, cart, all checkout options, shipping quote, order/admin recording, and customer confirmation on a safe preview/test environment. No live debit is part of this patch.
6. Push only after your existing normal deployment checks succeed; keep your existing rollback checkpoint.

## Remaining launch actions

- Supply actual GRIM product photos and packaging videos (not included in this archive); upload and associate them with live products.
- Confirm SKU, size, colour, stock count and retail prices in the existing admin/catalogue.
- Verify delivery setup and the real payment pathways end-to-end before promoting the sales launch.
