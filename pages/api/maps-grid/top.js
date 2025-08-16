// ...keep your imports and authHeader()

function formatAddress(it) {
  // DataForSEO sometimes returns structured address
  const ai = it.address_info;
  if (typeof it.address === "string" && it.address.trim()) return it.address.trim();
  if (ai && typeof ai === "object") {
    const parts = [
      ai.street_address,
      ai.city,
      ai.region,
      ai.zip,
      ai.country_code
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
  // return a short hostname for display
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const auth = authHeader();
    if (!auth) return res.status(500).json({ error: "Missing DFS_LOGIN/DFS_PASSWORD" });

    const { id, limit = "20" } = req.query;
    if (!id) return res.status(400).json({ error: "Missing ?id=" });

    const r = await fetch(`https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced/${id}`, { headers: { ...auth } });
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
      address: formatAddress(it),
      rating: it.rating ?? null,
      rating_count: it.user_ratings_total ?? it.rating_count ?? null,
      website: formatWebsite(it),
      place_id: it.place_id || null,
      cid: it.cid || null
    }));

    return res.status(200).json({ ok: true, total: items.length, items: compact });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 500) });
  }
}
