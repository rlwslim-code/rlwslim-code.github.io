# GRIM — Living ABYSS Blue Fluid Touch Restoration

This package REPLACES `GRIM_CHAPTER_I_LIQUID_GLASS_AND_PRICING_UPDATE.zip`.

## What was wrong
The previous `grim-liquid.js` was a **card/button hover and tap ripple effect**. The user requested the original *screen-wide interactive blue liquid*.

## What this patch changes
- Replaces `public/grim-liquid.js` and `.css` with a full-window, transparent 2D canvas.
- Touching ANYWHERE on the page injects luminous blue dye with velocities; dragging advects the fluid with semi-Lagrangian motion, expansion and turbulence. The liquid fades after interaction.
- Preserves interaction on desktop (click and drag), touchscreen (tap, drag, scroll), and mobile with passive listeners and pointer-events:none.
- Installs on the complete home, shop and story surfaces, including blank areas. Checkout and admin HTML are deliberately untouched to protect ongoing payments; the script can be added to other customer pages separately after verification.
- Retains all prior Chapter I launch and **proposed pricing** files and Supabase preview/apply/verify SQL unchanged. Existing live prices DO NOT change until the approved SQL step is run.
- No third-party dependencies or WebGL. Reduced motion supported.

## How to apply
1. Back up/commit existing work, then merge this update into the existing GitHub repository root, keeping the ZIP's folder structure.
2. This update replaces older Chapter I update ZIPs. Do not apply them afterward.
3. Test the interactive blue fluid on desktop and phone before deployment. Effects use canvas on top of UI but do not intercept taps or gestures.
4. Do not run the Supabase SQL without confirming prices and IDs in the read-only preview.

The original `GRIM_Living_Bloodline_Abyss_Liquid_Touch.zip` was referenced in a past conversation but not present in the uploaded repository; this is a faithful reimplementation of the documented interaction, not the original source bytes.
