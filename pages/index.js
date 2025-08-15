// pages/index.js
import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";

export default function Home() {
  // --- form state ---
  const [keyword, setKeyword] = useState("plumber");
  const [centerLat, setCenterLat] = useState(41.671);
  const [centerLng, setCenterLng] = useState(-73.12);
  const [gridSize, setGridSize] = useState(9);
  const [spacingM, setSpacingM] = useState(500);
  const [zoom, setZoom] = useState("15z");
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("desktop");
  const [targetName, setTargetName] = useState("");
  const [targetPlace, setTargetPlace] = useState("");

  // --- job state ---
  const [cells, setCells] = useState([]);
  const [ids, setIds] = useState([]);
  const [ranks, setRanks] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // ---- Leaflet refs ----
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // CDN-loaded Leaflet will attach window.L
  const Lready = typeof window !== "undefined" && typeof window.L !== "undefined";

  // color + size
  function colorFor(rank) {
    if (rank === "pending") return "#94a3b8"; // slate-400
    if (rank == null) return "#9ca3af";       // gray-400
    if (rank <= 3) return "#22c55e";          // green-500
    if (rank <= 10) return "#eab308";         // yellow-500
    if (rank <= 20) return "#f97316";         // orange-500
    return "#ef4444";                         // red-500
  }

  // Init Leaflet map once
  useEffect(() => {
    if (!Lready || mapRef.current) return;
    const L = window.L;

    const map = L.map("gridmap", { zoomControl: true });
    map.setView([Number(centerLat) || 0, Number(centerLng) || 0], 12);

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "&copy; OpenStreetMap" }
    ).addTo(map);

    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;

    // Resize observer to keep map sized
    setTimeout(() => map.invalidateSize(), 300);
  }, [Lready]);

  // Re-center map when user changes the center
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView([Number(centerLat) || 0, Number(centerLng) || 0], 12);
  }, [centerLat, centerLng]);

  // Draw / update markers whenever results change
  const tiles = useMemo(() => {
    if (!cells.length || !ids.length) return [];
    return cells.map((cell, idx) => ({ ...cell, id: ids[idx], rank: ranks[ids[idx]] }));
  }, [cells, ids, ranks]);

  useEffect(() => {
    if (!Lready || !layerRef.current) return;
    const L = window.L;
    const layer = layerRef.current;
    layer.clearLayers();

    // circle size in pixels (looks nice on all zooms)
    const pxRadius = 16;

    tiles.forEach(t => {
      const html = `
        <div class="rank-dot" style="
          width:${pxRadius*2}px;height:${pxRadius*2}px;
          background:${colorFor(t.rank)};
          border-radius:999px;border:2px solid rgba(0,0,0,0.15);
          display:flex;align-items:center;justify-content:center;
          color:#111;font-weight:700;font-size:13px;
          box-shadow:0 1px 3px rgba(0,0,0,0.15);
        ">${t.rank === "pending" ? "…" : (t.rank ?? "–")}</div>
      `;

      const icon = L.divIcon({
        html,
        className: "rank-divicon",
        iconSize: [pxRadius*2, pxRadius*2],
        iconAnchor: [pxRadius, pxRadius]
      });

      const m = L.marker([t.lat, t.lng], { icon }).addTo(layer);
      m.bindTooltip(
        `(${t.row+1},${t.col+1}) • ${t.lat}, ${t.lng} • rank: ${t.rank ?? "—"}`,
        { direction: "top", offset: [0, -pxRadius], sticky: true }
      );
    });

    if (tiles.length && mapRef.current) {
      const bounds = window.L.latLngBounds(tiles.map(t => [t.lat, t.lng]));
      mapRef.current.fitBounds(bounds.pad(0.2));
    }
  }, [tiles, Lready]);

  // Start → create DFS tasks
  async function startGrid(e) {
    e?.preventDefault?.();
    setLoading(true);
    setCells([]); setIds([]); setRanks({}); setProgress({ done: 0, total: 0 });

    try {
      const r = await fetch("/api/maps-grid/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          centerLat: Number(centerLat),
          centerLng: Number(centerLng),
          gridSize: Number(gridSize),
          spacingM: Number(spacingM),
          language_code: language,
          device,
          zoom
        })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Start failed");
      setCells(j.cells || []);
      setIds(j.ids || []);
      setRanks(Object.fromEntries((j.ids || []).map(id => [id, "pending"])));
      setProgress({ done: 0, total: (j.ids || []).length });
    } catch (err) {
      alert(err.message);
      setLoading(false);
    }
  }

  // Poll → update ranks
  useEffect(() => {
    if (!ids.length) return;
    let stop = false;

    async function poll() {
      if (stop) return;
      try {
        const r = await fetch("/api/maps-grid/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids,
            target: {
              place_id: targetPlace.trim() || undefined,
              name: targetName.trim() || undefined
            }
          })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error("Poll failed");

        const next = { ...ranks };
        let done = 0;
        for (const row of j.results || []) {
          if (row.status === "ok") next[row.id] = row.rank;
          else if (row.status === "pending") next[row.id] = "pending";
          else next[row.id] = null;
        }
        for (const id of ids) if (next[id] !== "pending") done++;
        setRanks(next);
        setProgress({ done, total: ids.length });

        if (done < ids.length) setTimeout(poll, 2200);
        else setLoading(false);
      } catch {
        setTimeout(poll, 2500);
      }
    }

    poll();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, targetName, targetPlace]);

  const field = { width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8 };

  return (
    <>
      <Head>
        {/* Leaflet CDN */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />
        <script
          src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          defer
        ></script>
        <title>Grid Rank Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", minHeight: "100vh" }}>
        {/* Sidebar */}
        <aside style={{ borderRight: "1px solid #e5e7eb", padding: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Maps Grid Rank Tracker</h2>
          <p style={{ color: "#475569", marginTop: 6, marginBottom: 12 }}>
            Enter your params, then click <b>Start Grid</b>. Use your exact <b>place_id</b> for best matching.
          </p>

          <form onSubmit={startGrid} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Keyword</label>
              <input value={keyword} onChange={e=>setKeyword(e.target.value)} style={field} />
            </div>

            <div>
              <label>Center Lat</label>
              <input value={centerLat} onChange={e=>setCenterLat(e.target.value)} style={field} />
            </div>
            <div>
              <label>Center Lng</label>
              <input value={centerLng} onChange={e=>setCenterLng(e.target.value)} style={field} />
            </div>

            <div>
              <label>Grid Size</label>
              <input type="number" min="3" step="2" value={gridSize} onChange={e=>setGridSize(e.target.value)} style={field} />
            </div>
            <div>
              <label>Spacing (m)</label>
              <input type="number" min="100" step="50" value={spacingM} onChange={e=>setSpacingM(e.target.value)} style={field} />
            </div>

            <div>
              <label>Language</label>
              <input value={language} onChange={e=>setLanguage(e.target.value)} style={field} />
            </div>
            <div>
              <label>Device</label>
              <select value={device} onChange={e=>setDevice(e.target.value)} style={field}>
                <option value="desktop">desktop</option>
                <option value="mobile">mobile</option>
              </select>
            </div>

            <div>
              <label>Zoom</label>
              <input value={zoom} onChange={e=>setZoom(e.target.value)} style={field} />
            </div>
            <div></div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label>Target Name (optional)</label>
              <input value={targetName} onChange={e=>setTargetName(e.target.value)} style={field} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Target place_id (best)</label>
              <input value={targetPlace} onChange={e=>setTargetPlace(e.target.value)} style={field} />
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <button type="submit" disabled={loading} style={{ background:"#47943b", color:"#fff", border:0, borderRadius:10, padding:"10px 14px", cursor:"pointer", fontWeight:700 }}>
                {loading ? "Working…" : "Start Grid"}
              </button>
              <span style={{ fontSize:12, color:"#475569" }}>
                {progress.total ? `Progress: ${progress.done}/${progress.total}` : null}
              </span>
            </div>
          </form>

          {/* Legend */}
          <div style={{ marginTop: 16, fontSize: 13, color: "#334155" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>
            <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8, alignItems: "center" }}>
              <span style={{ width:14, height:14, borderRadius:8, background:"#22c55e", display:"inline-block" }}></span><span>#1–3</span>
              <span style={{ width:14, height:14, borderRadius:8, background:"#eab308", display:"inline-block" }}></span><span>#4–10</span>
              <span style={{ width:14, height:14, borderRadius:8, background:"#f97316", display:"inline-block" }}></span><span>#11–20</span>
              <span style={{ width:14, height:14, borderRadius:8, background:"#ef4444", display:"inline-block" }}></span><span>#21+</span>
              <span style={{ width:14, height:14, borderRadius:8, background:"#9ca3af", display:"inline-block" }}></span><span>Not found</span>
              <span style={{ width:14, height:14, borderRadius:8, background:"#94a3b8", display:"inline-block" }}></span><span>Pending</span>
            </div>
          </div>
        </aside>

        {/* Map */}
        <main style={{ position: "relative" }}>
          <div id="gridmap" style={{ position: "absolute", inset: 0 }} />
        </main>
      </div>
    </>
  );
}
