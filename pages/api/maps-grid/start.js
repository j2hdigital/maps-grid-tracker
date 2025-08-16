// pages/api/maps-grid/start.js
// DataForSEO Google Maps task_post — minimal, spec-accurate payload.
// Returns task IDs or clear DFS error details.

function dfsAuthHeaders() {
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

// Build n×n grid around center; spacing in meters
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
      spacingM = 804.672,        // ≈ 0.5 miles
      language_code = "en",
      device = "desktop",
      zoom = "17z"               // per DFS, maps accepts lat,lng,zoom; 17z is default if omitted
    } = body;

    if (!keyword || typeof centerLat !== "number" || typeof centerLng !== "number") {
      return res.status(400).json({ ok: false, error: "Missing keyword or centerLat/centerLng" });
    }

    const headers = dfsAuthHeaders();
    if (!headers) {
      return res.status(500).json({
        ok: false,
        error: "Missing DFS_LOGIN/DFS_PASSWORD env vars on this Vercel project.",
      });
    }

    // Build grid and a minimal, supported payload for each cell
    const cells = buildGrid(Number(centerLat), Number(centerLng), Number(gridSize), Number(spacingM));

    // IMPORTANT: DataForSEO samples show a number-keyed object, not a JSON array.
    // We'll mirror that to avoid any ambiguity.
    const postBody = {};
    cells.forEach((c, i) => {
      postBody[i] = {
        keyword,
        // maps task_post expects "lat,lng,zoom" (e.g., 52.6178549,-155.352142,20z)
        location_coordinate: `${c.lat.toFixed(7)},${c.lng.toFixed(7)},${zoom}`,
        language_code,
        device,
        depth: 50,        // ensure enough results for Top 3 in each cell
        tag: `grid_${gridSize}_${Math.round(spacingM)}_${i}`
      };
    });

    // Never send more than 100 tasks per call (DFS limit) — split if needed.
    // (Your grids are 3×3/5×5/7×7 so you’re fine; this is just future proofing.)
    const taskEntries = Object.entries(postBody);
    const chunkSize = 100;
    const allIds = [];
    const rawResponses = [];

    for (let i = 0; i < taskEntries.length; i += chunkSize) {
      const chunkObj = Object.fromEntries(taskEntries.slice(i, i + chunkSize));
      const r = await fetch("https://api.dataforseo.com/v3/serp/google/maps/task_post", {
        method: "POST",
        headers,
        body: JSON.stringify(chunkObj),
      });
      const j = await r.json().catch(() => ({}));
      rawResponses.push({ status: r.status, body: j });

      if (!(r.ok && j?.status_code === 20000)) {
        return res.status(r.status || 502).json({
          ok: false,
          error: "DataForSEO task_post failed",
          dfs_status_code: j?.status_code,
          dfs_message: j?.status_message,
          dfs_error: j?.error,
          raw: j,
        });
      }
      // Extract task IDs from this chunk
      if (Array.isArray(j.tasks)) {
        for (const t of j.tasks) {
          // t.result is null for task_post; the actual ID is t.id
          if (t?.id) allIds.push(t.id);
        }
      }
    }

    if (allIds.length === 0) {
      // Show exactly what DFS returned so we can diagnose quickly
      return res.status(200).json({
        ok: false,
        error: "No task IDs were returned by DataForSEO.",
        hint: "Double-check payload fields; keyword and location_coordinate are required.",
        debug: rawResponses,
      });
    }

    return res.status(200).json({
      ok: true,
      cells,
      ids: allIds,
      zoom,
      device,
      language_code
    });
  } catch (e) {
    console.error("start.js error:", e);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(e).slice(0, 500) });
  }
}
