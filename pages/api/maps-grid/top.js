// pages/api/maps-grid/top.js
// GET ?id=TASK_ID&limit=20  -> returns compact competitor list for that grid cell

const DFS_BASE = "https://api.dataforseo.com/v3";

function authHeader() {
  const { DFS_LOGIN, DFS_PASSWORD } = process.env;
  if (!DFS_LOGIN || !DFS_PASSWORD) return null;
  const token = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const auth = authHeader();
    if (!auth) return res.status(500).json({ error: "Missing DFS_LOGIN/DFS_PASSWORD" });

    const { id, limit = "20" } = req.query;
    if (!id) return res.status(400).json({ error: "Missing ?id=" });

    const r = await fetch(`${DFS_BASE}/serp/google/maps/task_get/advanced/${id}`, { headers: { ...auth } });
    const j = await r.json();
    if (!(r.ok && j.status_code === 20000)) {
      return res.status(r.status || 502).json({
        error: "DFS fetch failed",
        dfs_status_code: j.status_code,
        dfs_message: j.status_message,
        dfs_error: j.error
      });
    }

    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    const compact = items.slice(0, Number(limit)).map(it => ({
      rank: it.rank_group ?? it.rank_absolute ?? null,
      name: it.title || it.name || null,
      address: it.address || it.snippet || null,
      rating: it.rating ?? null,
      rating_count: it.rating_count ?? it.user_ratings_total ?? null,
      phone: it.phone || null,
      website: it.domain || it.website || null,
      place_id: it.place_id || null,
      cid: it.cid || null
    }));

    return res.status(200).json({ ok: true, total: items.length, items: compact });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0,500) });
  }
}
