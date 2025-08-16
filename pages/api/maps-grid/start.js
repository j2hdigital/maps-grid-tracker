// pages/api/maps-grid/start.js
// Creates DataForSEO tasks for each grid cell with correct location_coordinate: "lat,lng,zoom"

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

// symmetric grid (n x n), spacing in meters
function buildGrid(centerLat, centerLng, n, spacingM) {
  const out = [];
  const R = 6378137; // meters
  const dLat = spacingM / R;
  const dLng = spacingM / (R * Math.cos((centerLat * Math.PI) / 180));
  const half = Math.floor(n / 2);
  for (let r = -half; r <= half; r++) {
    for (let c = -half; c <= half; c++) {
      const lat = centerLat + (r * dLat * 180) / Math.PI;
      const lng = centerLng + (c * dLng * 180) / Math.PI;
      out.push({ row: r + half, col: c + half, lat, lng });
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const {
      keyword,
      centerLat,
      centerLng,
      gridSize = 5,
      spacingM = 804.672,
      language_code = "en",
      device = "desktop",
      zoom = "15z", // IMPORTANT for Maps: location_coordinate requires zoom suffix like "15z"
    } = body;

    if (!keyword || typeof centerLat !== "number" || typeof centerLng !== "number") {
      return res.status(400).json({ ok: false, error: "Missing keyword or centerLat/centerLng" });
    }

    const auth = authHeader();
    if (!auth) {
      return res.status(500).json({
        ok: false,
        error: "Missing DFS_LOGIN/DFS_PASSWORD env vars",
      });
    }

    const cells = buildGrid(Number(centerLat), Number(centerLng), Number(gridSize), Number(spacingM));

    // Build DFS tasks — NOTE the correct location_coordinate format: "lat,lng,zoom"
    const tasks = cells.map((c, i) => ({
      keyword,
      location_coordinate: `${c.lat},${c.lng},${zoom}`, // ← FIXED
      device,
      language_code,
      depth: 50,                         // ensure enough results for Top 3
      loc_name_canonical: false,
      search_param: `hl=${language_code}&gl=us&num=50`,
      tag: `grid_${gridSize}_${Math.round(spacingM)}_${i}`,
    }));

    const postUrl = "https://api.dataforseo.com/v3/serp/google/maps/task_post";
    const r = await fetch(postUrl, { method: "POST", headers: auth, body: JSON.stringify(tasks) });
    const j = await r.json().catch(() => ({}));

    if (!(r.ok && j && j.status_code === 20000)) {
      return res.status(r.status || 502).json({
        ok: false,
        error: "DataForSEO task_post failed",
        dfs_status_code: j?.status_code,
        dfs_message: j?.status_message,
        dfs_error: j?.error,
      });
    }

    // Extract task IDs robustly
    const ids = [];
    if (Array.isArray(j.tasks)) {
      for (const t of j.tasks) {
        if (Array.isArray(t.result)) {
          for (const rr of t.result) if (rr?.id) ids.push(rr.id);
        } else if (t?.result?.id) {
          ids.push(t.result.id);
        }
      }
    }

    if (ids.length === 0) {
      return res.status(200).json({
        ok: false,
        error: "No task IDs were returned by DataForSEO.",
        debug: { got_tasks: Array.isArray(j.tasks) ? j.tasks.length : 0, raw_status: j?.status_code },
      });
    }

    return res.status(200).json({ ok: true, cells, ids, zoom, device, language_code });
  } catch (e) {
    console.error("start.js error:", e);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(e).slice(0, 500) });
  }
}
