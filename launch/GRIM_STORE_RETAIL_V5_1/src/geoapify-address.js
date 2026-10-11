import express from "express";
const router = express.Router();
// Geoapify autocomplete proxy: API key remains server-side, never returned to browsers.
// Does not log customer-entered addresses. If Geoapify rejects server requests because
// of HTTP-referrer restrictions, configure a separate backend key in Geoapify.
const addressLookupBuckets = new Map();
router.get('/autocomplete', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) return res.status(503).json({ message: 'Address suggestions are not configured.' });
  const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
  const country = typeof req.query.country === 'string' ? req.query.country.toLowerCase() : 'ng';
  if (text.length < 3 || text.length > 140 || !/^[a-z]{2}$/.test(country))
    return res.status(400).json({ message: 'Invalid address search.' });
  const ip = req.ip || 'unknown';
  const now = Date.now();
  if (addressLookupBuckets.size > 2500) addressLookupBuckets.clear();
  const bucket = addressLookupBuckets.get(ip) || { at: now, count: 0 };
  if (now - bucket.at > 60_000) { bucket.at = now; bucket.count = 0; }
  if (++bucket.count > 25) return res.status(429).json({ message: 'Too many searches. Try again shortly.' });
  addressLookupBuckets.set(ip,bucket);
   const params = new URLSearchParams({
  text,
  format: 'json',
  limit: '5',
  filter: `countrycode:${country}`,
  apiKey: key
});
  // Suggest addresses internationally, bias toward selected country where possible.
  // Preserve worldwide searches. Clients may specify country for future filtering.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const upstream = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!upstream.ok) return res.status(502).json({ message: 'Address provider unavailable. Enter address manually.' });
    const body = await upstream.json();
    const results = (Array.isArray(body.results) ? body.results : [])
  .filter(a => String(a.country_code || '').toLowerCase() === country)
  .slice(0, 5)
  .map(a => ({
      formatted: String(a.formatted || '').slice(0,300),
      address: String(a.address_line1 || [a.housenumber,a.street].filter(Boolean).join(' ') || a.formatted || '').slice(0,250),
      city: String(a.city || a.town || a.village || a.county || '').slice(0,100),
      state: String(a.state || '').slice(0,100),
      postal: String(a.postcode || '').slice(0,30),
      country: String(a.country_code || '').toUpperCase()
    }));
    return res.json({ results });
  } catch { return res.status(502).json({ message: 'Address provider unavailable. Enter address manually.' }); }
  finally { clearTimeout(timeout); }
});


export default router;
