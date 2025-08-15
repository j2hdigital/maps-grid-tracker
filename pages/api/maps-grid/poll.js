// pages/api/maps-grid/poll.js
const DFS_BASE = "https://api.dataforseo.com/v3";

function authHeader() {
  const { DFS_LOGIN, DFS_PASSWORD } = process.env;
  if (!DFS_LOGIN || !DFS_PASSWORD) {
    throw new Error("Missing DFS_LOGIN or DFS_PASSWORD env vars");
  }
  const token = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

function findRank(items, target) {
  const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const wantPlace = (target?.place_id || "").trim();
  const wantName = norm(target?.name || "");

  // 1) Prefer exact place_id
  for (const it of (items || [])) {
    if (wantPlace && it.place_id === wantPlace) {
      return it.rank_group ?? it.rank_absolute ?? null;
    }
  }

  // 2) Fallback name match
  if (wantName) {
    for (const it of (items || [])) {
      const title = norm(it.title || it.name || "");
      if (title && (title === wantName || title.includes(wantName))) {
        return it.rank_group ?? it.rank_absolute ?? null;
      }
    }
  }

  // 3) NEW: if no target provided, return the top result's rank
  if (!wantPlace && !wantName && items?.length) {
    return items[0].rank_group ?? items[0].rank_absolute ?? 1;
  }

  return null;
}


export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { ids = [], target = null } = body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "Missing ids[]" });
    }

    const out = [];
    for (const id of ids) {
      const r = await fetch(`${DFS_BASE}/serp/google/maps/task_get/advanced/${id}`, {
        headers: { ...authHeader() }
      });
      const j = await r.json();

      if (r.ok && j.status_code === 20000) {
        const items = j?.tasks?.[0]?.result?.[0]?.items || [];
        out.push({ id, status: "ok", rank: findRank(items, target), itemsCount: items.length });
      } else if (j.status_code === 40404 || j.status_message?.includes("not found")) {
        out.push({ id, status: "pending" });
      } else {
        out.push({ id, status: "error", detail: j });
      }
    }

    return res.status(200).json({ ok: true, results: out });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 500) });
  }
}
