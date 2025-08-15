import { buildGrid } from "../../../../lib/geo";
const DFS_BASE = "https://api.dataforseo.com/v3";

function authHeader() {
  const { DFS_LOGIN, DFS_PASSWORD } = process.env;
  const token = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { keyword, centerLat, centerLng, gridSize=9, spacingM=500, language_code="en", device="desktop", zoom="15z", tag="" } = body;
    if (!keyword || centerLat == null || centerLng == null) return res.status(400).json({ error: "Missing keyword/centerLat/centerLng" });

    const cells = buildGrid({ centerLat:+centerLat, centerLng:+centerLng, gridSize:+gridSize, spacingM:+spacingM });
    const tasks = cells.map(cell => ({ keyword, language_code, device, location_coordinate: `${cell.lat},${cell.lng},${zoom}`, tag: tag || `grid-${Date.now()}` }));
    const payload = tasks.reduce((acc, t, i) => (acc[i]=t, acc), {});

    const r = await fetch(`${DFS_BASE}/serp/google/maps/task_post`, { method:"POST", headers:{ "Content-Type":"application/json", ...authHeader() }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok || j.status_code !== 20000) return res.status(r.status||502).json({ error:"DFS task_post failed", detail:j });

    const ids = (j.tasks||[]).filter(t=>t.status_code===20100).map(t=>t.id);
    const n = Math.min(ids.length, cells.length);
    return res.status(200).json({ ok:true, ids: ids.slice(0,n), cells: cells.slice(0,n) });
  } catch (e) {
    return res.status(500).json({ error:"Server error", detail:String(e).slice(0,500) });
  }
}
