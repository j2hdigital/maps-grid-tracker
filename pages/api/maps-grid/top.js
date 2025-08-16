// pages/api/maps-grid/top.js
// GET /api/maps-grid/top?id=TASK_ID

function authHeader() {
  const login = process.env.DFS_LOGIN;
  const password = process.env.DFS_PASSWORD;
  if (!login || !password) return null;
  const token = Buffer.from(`${login}:${password}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
function asString(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
function formatAddress(it) {
  if (typeof it.address === "string" && it.address.trim()) return it.address.trim();
  const ai = it.address_info;
  if (ai && typeof ai === "object") {
    const parts = [ai.street_address, ai.city, ai.region, ai.zip, ai.country_code].filter(Boolean);
    if (parts.length) return parts.join(", ");
  }
  if (typeof it.snippet === "string" && it.snippet.trim()) return it.snippet.trim();
  return null;
}
function formatWebsite(it) {
  const w = it.domain || it.website || it.url;
  if (!w) return null;
  const s = String(w);
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET ?id=" });

  try {
    const auth = authHeader();
    if (!auth) return res.status(500).json({ error: "Missing DFS_LOGIN/DFS_PASSWORD" });

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing ?id=" });

    const url = `https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced/${encodeURIComponent(id)}`;
    const r = await fetch(url, { headers: auth });
    const j = await r.json();

    if (!(r.ok && j.status_code === 20000)) {
      return res.status(r.status || 502).json({
        error: "DFS fetch failed",
        dfs_status_code: j.status_code,
        dfs_message: j.status_message,
        dfs_error: j.error,
      });
    }

    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    const sorted = items
      .filter((x) => x && (x.rank_group != null || x.rank_absolute != null))
      .sort(
        (a, b) =>
          (a.rank_group ?? a.rank_absolute ?? 9999) -
          (b.rank_group ?? b.rank_absolute ?? 9999)
      );

    const top3 = sorted.slice(0, 3).map((it) => ({
      rank: it.rank_group ?? it.rank_absolute ?? null,
      name: (asString(it.title || it.name || "") || "").trim() || "—",
      address: (asString(formatAddress(it) || "") || "").trim() || null,
      rating: it.rating ?? null,
      rating_count: it.user_ratings_total ?? it.rating_count ?? null,
      website: (asString(formatWebsite(it) || "") || "").trim() || null,
      phone: (asString(it.phone || it.phone_number || "") || "").trim() || null,
      place_id: (asString(it.place_id || "") || "").trim() || null,
      cid: (asString(it.cid || "") || "").trim() || null,
    }));

    while (top3.length < 3) {
      top3.push({
        rank: null,
        name: "—",
        address: "",
        rating: null,
        rating_count: null,
        website: null,
        phone: null,
        place_id: null,
        cid: null,
      });
    }

    return res.status(200).json({ ok: true, total: items.length, items: top3 });
  } catch (e) {
    console.error("top.js error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 500) });
  }
}
