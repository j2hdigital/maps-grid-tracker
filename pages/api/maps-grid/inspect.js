// pages/api/maps-grid/inspect.js
const DFS_BASE = "https://api.dataforseo.com/v3";

function authHeader() {
  const { DFS_LOGIN, DFS_PASSWORD } = process.env;
  if (!DFS_LOGIN || !DFS_PASSWORD) {
    return null;
  }
  const token = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = authHeader();
  if (!auth) {
    return res.status(500).json({ error: "Missing DFS_LOGIN / DFS_PASSWORD on server" });
  }
  const { id, top = "15" } = req.query;
  if (!id) return res.status(400).json({ error: "Missing ?id=" });

  try {
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
    // Return a compact view: rank, title/name, place_id, phone, domain
    const compact = items.slice(0, Number(top)).map(it => ({
      rank: it.rank_group ?? it.rank_absolute ?? null,
      title: it.title || it.name || null,
      place_id: it.place_id || null,
      phone: it.phone || null,
      domain: it.domain || it.website || null
    }));
    return res.status(200).json({ ok: true, total: items.length, items: compact });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0,500) });
  }
}
