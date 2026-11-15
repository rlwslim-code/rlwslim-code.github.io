-- GRIM Chapter I: READ-ONLY verification after running the update.
WITH plan(id, name, type, old_price, launch_price) AS (
 VALUES
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
  (26, 'Rose Reaper', 'Hoodie', 28000, 45000)
)
SELECT plan.id, p.name, p.type, p.price AS live_price_ngn, plan.launch_price,
       CASE WHEN p.id IS NULL THEN 'NOT IN LIVE CATALOGUE'
            WHEN p.name <> plan.name OR p.type <> plan.type THEN 'DIFFERENT PRODUCT'
            WHEN p.price = plan.launch_price THEN 'OK'
            ELSE 'NOT UPDATED' END AS status
FROM plan LEFT JOIN public.products p ON p.id=plan.id
ORDER BY plan.id;
