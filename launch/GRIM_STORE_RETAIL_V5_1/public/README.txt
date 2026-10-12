GRIM FRONTEND STABLE V1
Version marker: 20261001-frontend-stable-1

Files included:
- index.html
- shop.html
- grim-frontend-stable.js
- grim-frontend-stable.css

Purpose:
1. Remove the duplicate checkout/auth structure from shop.html.
2. Keep one account modal and one checkout modal.
3. Require Sign In / Create Account before checkout.
4. Resume checkout automatically after successful authentication.
5. Show password rules only while creating a password.
6. Add international phone country-code selectors to registration and checkout.
7. Keep mobile form fields at 16px to prevent automatic iPhone input zoom while preserving user pinch zoom.
8. Keep Customer Care and market/currency UI.
9. Add the Google Sign-In UI, but do NOT connect Google OAuth yet.
10. Pause payment actions intentionally until the frontend is signed off.

IMPORTANT:
Do not reconnect Paystack, Supabase keys, or Google OAuth until this frontend version is tested on GitHub Pages and Vercel.
Vercel fresh build marker: 20261001-1501
