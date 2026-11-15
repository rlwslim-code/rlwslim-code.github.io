-- GRIM Chapter I: update LIVE SUPABASE CATALOGUE prices once approved.
-- FIRST run the matching PRICE_PREVIEW_READ_ONLY.sql.
-- Scope: only 25 exact existing product IDs, names and types in the October source.
-- Only price is updated. No user, checkout, stock, wallet, shipping or order rows touched.
-- Safe to rerun: already updated prices are left unchanged.
-- ABORTS on changed names, types or unexpected existing prices (no partial updates).
BEGIN;
CREATE TEMP TABLE grim_chapter_i_price_plan (
  id BIGINT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
  previous_price NUMERIC NOT NULL, launch_price NUMERIC NOT NULL
) ON COMMIT DROP;
INSERT INTO grim_chapter_i_price_plan(id,name,type,previous_price,launch_price) VALUES
  (1, 'Rose Reaper', 'Hoodie', 28000, 45000),
  (2, 'Veil', 'Hoodie', 28000, 45000),
  (3, 'Abyss', 'Hoodie', 28000, 45000),
  (4, 'Eclipse Gold', 'Hoodie', 28000, 45000),
  (5, 'Rose Reaper', 'Hoodie', 28000, 45000),
  (6, 'Eclipse Gold', 'Armless', 15000, 20000),
  (7, 'Bloodline', 'Hoodie', 28000, 45000),
  (8, 'Obsidian', 'Armless', 15000, 20000),
  (10, 'Obsidian / Veil', 'Tee', 18000, 25000),
  (11, 'Veil / Abyss', 'Hoodie', 28000, 45000),
  (12, 'Veil', 'Tee', 18000, 25000),
  (13, 'Veil / Abyss / Obsidian', 'Armless', 15000, 20000),
  (14, 'Void Violet', 'Hoodie', 28000, 45000),
  (15, 'Veil / Obsidian', 'Hoodie', 28000, 45000),
  (16, 'Obsidian / Veil', 'Hoodie', 28000, 45000),
  (17, 'Rose Reaper', 'Hoodie', 28000, 45000),
  (18, 'Obsidian', 'Hoodie', 28000, 45000),
  (19, 'Abyss', 'Hoodie', 28000, 45000),
  (20, 'Void Violet', 'Hoodie', 28000, 45000),
  (21, 'Rose Reaper', 'Tee', 18000, 25000),
  (22, 'Veil', 'Hoodie', 28000, 45000),
  (23, 'Obsidian', 'Tee', 18000, 25000),
  (24, 'Veil / Obsidian', 'Complete GRIM Outfit', 90000, 100000),
  (25, 'Obsidian', 'Hoodie', 28000, 45000),
  (26, 'Rose Reaper', 'Hoodie', 28000, 45000);
DO $grim_price_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products p
    JOIN grim_chapter_i_price_plan t ON p.id = t.id
    WHERE p.name IS DISTINCT FROM t.name
       OR p.type IS DISTINCT FROM t.type
       OR (p.price IS DISTINCT FROM t.previous_price AND p.price IS DISTINCT FROM t.launch_price)
  ) THEN
    RAISE EXCEPTION 'GRIM price update stopped: catalogue identity or current prices differ from the archived source. Inspect the read-only preview before changing any price.';
  END IF;
END
$grim_price_guard$;
UPDATE public.products AS p
SET price = t.launch_price
FROM grim_chapter_i_price_plan t
WHERE p.id = t.id
  AND p.name = t.name
  AND p.type = t.type
  AND p.price = t.previous_price;
COMMIT;
-- Then run PRICE_VERIFY_READ_ONLY.sql to confirm prices on live catalogue.
