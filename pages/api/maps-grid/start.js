// pages/api/maps-grid/start.js
// Creates DataForSEO tasks for each grid cell.

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

// build symmetric grid (n x n) around center with given spacing (meters)
function buildGrid(centerLat, centerLng, n, spacingM) {
  const out = [];
  const R = 6378137; // earth radius (m)
  const dLat = spacingM / R;
  const dLng = (spacingM / (R * Math.cos((centerLat * Math.PI) / 180)));

  const half = Math.floor(n / 2);
  for (let row = -half; row <= half; row++) {
    for (let col = -half; col <= half; col++) {
      const lat = centerLat + (row * dLat * 180) / Math.PI;
      const lng = centerLng + (col * dLng * 180) / Math.PI;
      out.push({ row: row + half, col: col + half, lat, lng });
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const {
      keyword,
      centerLat,
      centerLng,
      gridSize = 5,
      spacingM = 804.672, // ~0.5mi
      language_code = "en",
      device = "desktop",
      zoom = "15z",
    } = body;

    if (!keyword || typeof centerLat !== "number" || typeof centerLng !== "number") {
      return res.status(400).json({ error: "Missing keyword or centerLat/centerLng" });
    }

    const auth = authHeader();
    if (!auth) return res.status(500).json({ error: "Missing DFS_LOGIN/DFS_PASSWORD env vars" });

    const cells = buildGrid(Number(centerLat), Number(centerLng), Number(gridSize), Number(spacingM));

    // Prepare DFS tasks with higher depth for stable Top 3
    const tasks = cells.map((c) => ({
      keyword,
      location_coordinate: `${c.lat},${c.lng}`,
      device,
      language_code,
      // Important bits
      depth: 50,
      loc_name_canonical: false,
      // These two can help DFS cluster properly
      search_param: `hl=${language_code}&gl=us&num=50`,
      tag: `grid_${gridSize}_${spacingM}`
    }));

    const r = await fetch("https://api.dataforseo.com/v3/serp/google/maps/task_post", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(tasks),
    });
    const j = await r.json();

    if (!(r.ok && j.status_code === 20000)) {
      return res.status(r.status || 502).json({
        error: "DFS task_post failed",
        dfs_status_code: j.status_code,
        dfs_message: j.status_message,
        dfs_error: j.error,
      });
    }

    // Collect task ids in the same order as cells
    const results = j.tasks?.[0]?.result || j.tasks?.flatMap(t => t.result || []) || [];
    // Some responses return results array aligned with tasks; be defensive:
    const ids = results.map(r => r.id) || [];

    return res.status(200).json({ ok: true, cells, ids, zoom, device, language_code });
  } catch (e) {
    console.error("start.js error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 500) });
  }
}
