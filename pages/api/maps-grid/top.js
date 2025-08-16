// pages/api/maps-grid/top.js
// GET /api/maps-grid/top?id=TASK_ID&limit=20
// Returns compact competitor list for a single DFS task.

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

function formatAddress(it) {
  // DataForSEO items can have either a string or structured address
  if (typeof it.address === "string" && it.address.trim()) return it.address.trim();
  const ai = it.address_info;
  if (ai && typeof ai === "object") {
    const parts = [
      ai.street_address,
      ai.city,
      ai.region,
      ai.zip,
      ai.country_code,
    ].filter(Boolean);
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
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET ?id=" });
  }

  try {
    const auth = authHeader();
    if (!auth) {
      return res.status(500).json({ error: "Missing DFS_LOGIN/DFS_PASSWORD env vars" });
    }

    const { id, limit = "20" } = req.query;
    if (!id) {
      return res.status(400).json({ error: "Missing ?id=" });
    }

    const url = `https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced/${encodeURIComponent(id)}`;
    const r = await fetch(url, { headers: auth });
    const j = await r.json();

    if (!(r.ok && j.status_code === 20000)) {
      // Bubble up DFS info so you can see what's wrong in Network tab
      return res.status(r.status || 502).json({
        error: "DFS fetch failed",
        dfs_status_code: j.status_code,
        dfs_message: j.status_message,
        dfs_error: j.error,
      });
    }

    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    const compact = items.slice(0, Number(limit)).map((it) => ({
      rank: it.rank_group ?? it.rank_absolute ?? null,
      name: it.title || it.name || null,
      address: formatAddress(it),
      rating: it.rating ?? null,
      rating_count: it.user_ratings_total ?? it.rating_count ?? null,
      website: formatWebsite(it),
      place_id: it.place_id || null,
      cid: it.cid || null,
    }));

    return res.status(200).json({ ok: true, total: items.length, items: compact });
  } catch (e) {
    console.error("top.js error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 500) });
  }
}
