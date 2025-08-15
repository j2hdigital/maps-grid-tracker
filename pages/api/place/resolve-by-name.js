// pages/api/place/resolve-by-name.js
// Input: { name: string, locationText?: string, radiusM?: number }
// Strategy:
//  1) Geocode locationText -> lat/lng (for bias & scoring)
//  2) Find Place (with bias). If none, try without bias.
//  3) If still none, Text Search with query "name locationText"
//  4) Pick best candidate by distance to geocoded center + ratings volume.

const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_BASE  = "https://maps.googleapis.com/maps/api/place";

async function geocode(text, key) {
  const url = `${GEOCODE_BASE}?address=${encodeURIComponent(text)}&key=${key}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status !== "OK" || !j.results?.length) return null;
  const { lat, lng } = j.results[0].geometry.location;
  return { lat, lng };
}

function distMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat/2)**2 +
             Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s1));
}

function pickBest(cands, center) {
  if (!cands?.length) return null;
  // Score by: closer to center (if available) and more ratings
  return [...cands].map(c => {
    const here = { lat: c.geometry?.location?.lat, lng: c.geometry?.location?.lng };
    const d = (center && here?.lat && here?.lng) ? distMeters(center, here) : 1e9;
    const ratings = (c.user_ratings_total ?? c.rating_count ?? 0);
    const score = (1000000 / (1 + d)) + (ratings * 10); // tweakable
    return { cand: c, score };
  }).sort((a,b) => b.score - a.score)[0].cand;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) return res.status(500).json({ error: "Missing GOOGLE_PLACES_API_KEY" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { name, locationText = "", radiusM = 25000 } = body;
    if (!name?.trim()) return res.status(400).json({ error: "Missing business name" });

    // 1) Geocode the city/state (if provided) for bias & scoring
    let center = null, biasParam = "";
    if (locationText.trim()) {
      center = await geocode(locationText.trim(), key);
      if (center) {
        const r = Math.max(1000, Math.min(50000, +radiusM || 25000));
        biasParam = `&locationbias=circle:${r}@${center.lat},${center.lng}`;
      }
    }

    // Helper to shape output
    const shape = c => ({
      place_id: c.place_id,
      name: c.name,
      address: c.formatted_address || c.vicinity || null,
      lat: c.geometry?.location?.lat,
      lng: c.geometry?.location?.lng,
      rating: c.rating ?? null,
      rating_count: c.user_ratings_total ?? c.rating_count ?? null
    });

    // 2) Try Find Place (with bias)
    const fpURL1 = `${PLACES_BASE}/findplacefromtext/json?inputtype=textquery&fields=place_id,name,geometry,formatted_address,rating,user_ratings_total&input=${encodeURIComponent(name)}${biasParam}&key=${key}`;
    let r = await fetch(fpURL1);
    let j = await r.json();

    // 2b) If none, try without bias
    if (!(j.status === "OK" && j.candidates?.length)) {
      const fpURL2 = `${PLACES_BASE}/findplacefromtext/json?inputtype=textquery&fields=place_id,name,geometry,formatted_address,rating,user_ratings_total&input=${encodeURIComponent(name)}&key=${key}`;
      r = await fetch(fpURL2);
      j = await r.json();
    }

    // 3) If still none, try Text Search with "name + city"
    let candidates = [];
    let attempts = [];
    if (j.status === "OK" && j.candidates?.length) {
      candidates = j.candidates;
      attempts.push({ method: "findplace", count: candidates.length, status: j.status });
    } else {
      const query = locationText.trim() ? `${name} ${locationText}` : name;
      const tsURL = `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}${center ? `&location=${center.lat},${center.lng}&radius=${Math.max(1000, Math.min(50000, +radiusM || 25000))}` : ""}&key=${key}`;
      const tr = await fetch(tsURL);
      const tj = await tr.json();
      attempts.push({ method: "textsearch", count: (tj.results || []).length, status: tj.status });
      if (tj.status === "OK" || tj.status === "ZERO_RESULTS") {
        candidates = (tj.results || []);
      }
    }

    if (!candidates.length) {
      return res.status(404).json({
        error: "No candidates",
        attempts,
        hint: "Try adding a city/state, tweaking the name (LLC/Inc), or confirm the business is verified on Maps."
      });
    }

    const best = pickBest(candidates, center) || candidates[0];
    return res.status(200).json({
      ok: true,
      best: shape(best),
      candidates: candidates.slice(0, 10).map(shape),
      attempts
    });

  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0,500) });
  }
}
