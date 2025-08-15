// pages/api/place/resolve-by-name.js
// Input: { name: string, locationText?: string, radiusM?: number }
// 1) Geocode locationText (e.g., "Torrington, CT") -> lat/lng (if provided)
// 2) Places "find place from text" with fields=place_id,geometry,name
// 3) If multiple candidates, return top + list

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) return res.status(500).json({ error: "Missing GOOGLE_PLACES_API_KEY" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { name, locationText = "", radiusM = 25000 } = body;
    if (!name?.trim()) return res.status(400).json({ error: "Missing business name" });

    let bias = "";
    if (locationText.trim()) {
      const loc = await geocode(locationText.trim(), key);
      if (loc) bias = `&locationbias=circle:${Math.max(1000, Math.min(50000, +radiusM || 25000))}@${loc.lat},${loc.lng}`;
    }

    // Prefer Find Place From Text (accurate + returns geometry)
    const url = `${PLACES_BASE}/findplacefromtext/json?inputtype=textquery&fields=place_id,name,geometry,formatted_address&input=${encodeURIComponent(name)}${bias}&key=${key}`;
    const r = await fetch(url);
    const j = await r.json();

    if (j.status !== "OK" || !j.candidates?.length) {
      return res.status(404).json({ error: "No candidates", details_status: j.status, details_error: j.error_message });
    }

    const best = j.candidates[0];
    const out = {
      ok: true,
      best: {
        place_id: best.place_id,
        name: best.name,
        address: best.formatted_address || null,
        lat: best.geometry?.location?.lat,
        lng: best.geometry?.location?.lng
      },
      candidates: j.candidates.map(c => ({
        place_id: c.place_id,
        name: c.name,
        address: c.formatted_address || null,
        lat: c.geometry?.location?.lat,
        lng: c.geometry?.location?.lng
      }))
    };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0,500) });
  }
}
