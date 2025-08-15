// pages/index.js
import { useEffect, useRef, useState } from "react";
import Head from "next/head";

export default function Home() {
  // --- locate business by NAME ---
  const [bizName, setBizName] = useState("Your Business Name");
  const [cityText, setCityText] = useState("Torrington, CT");
  const [resolved, setResolved] = useState(null); // {place_id,name,lat,lng,address}

  // --- grid params ---
  const [keyword, setKeyword] = useState("plumber");
  const [centerLat, setCenterLat] = useState(41.671);
  const [centerLng, setCenterLng] = useState(-73.12);
  const [gridSize, setGridSize] = useState(9);
  const [spacingM, setSpacingM] = useState(500);
  const [zoom, setZoom] = useState("15z");
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("desktop");

  // --- job state ---
  const [cells, setCells] = useState([]);
  const [ids, setIds] = useState([]);
  const [ranks, setRanks] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // --- Google Map ---
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  const colorFor = (rank) => {
    if (rank === "pending") return "#94a3b8";
    if (rank == null) return "#9ca3af";
    if (rank <= 3) return "#22c55e";
    if (rank <= 10) return "#eab308";
    if (rank <= 20) return "#f97316";
    return "#ef4444";
  };

  // load Google Maps JS
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.google?.maps) return; // already loaded
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}`;
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // init map
  useEffect(() => {
    if (!mapDiv.current || !window.google?.maps || mapRef.current) return;
    mapRef.current = new window.google.maps.Map(mapDiv.current, {
      center: { lat: Number(centerLat), lng: Number(centerLng) },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
  }, [centerLat, centerLng]);

  // recenter
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setCenter({ lat: Number(centerLat), lng: Number(centerLng) });
    }
  }, [centerLat, centerLng]);

  // draw grid markers
  useEffect(() => {
    if (!mapRef.current) return;
    const g = window.google.maps;
    // clear old
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    if (!cells.length || !ids.length) return;

    const bounds = new g.LatLngBounds();
    cells.forEach((cell, idx) => {
      const id = ids[idx];
      const rank = ranks[id];
      const color = colorFor(rank);
      const label = rank === "pending" ? "…" : (rank ?? "–").toString();

      const marker = new g.Marker({
        position: { lat: cell.lat, lng: cell.lng },
        map: mapRef.current,
        icon: {
          path: g.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "rgba(0,0,0,0.25)",
          strokeWeight: 1.5,
          scale: 12, // ~ px radius
          labelOrigin: new g.Point(0, -0.5)
        },
        label: { text: label, color: "#111", fontWeight: "700", fontSize: "12px" },
        title: `(${cell.row+1},${cell.col+1}) ${cell.lat}, ${cell.lng} • rank: ${rank ?? "—"}`
      });
      markersRef.current.push(marker);
      bounds.extend(marker.getPosition());
    });
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 60);
  }, [cells, ids, ranks]);

  // find business by NAME (no manual place_id)
  async function resolveByName(e) {
    e?.preventDefault?.();
    try {
      const r = await fetch("/api/place/resolve-by-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bizName.trim(), locationText: cityText.trim(), radiusM: 25000 })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Resolve failed");
      setResolved(j.best);
      setCenterLat(j.best.lat);
      setCenterLng(j.best.lng);
      // use exact place_id for matching:
      setDevice("desktop");
      // keep your grid defaults or tweak here:
    } catch (err) {
      alert(err.message);
    }
  }

  // start grid run (uses current center & params)
  async function startGrid(e) {
    e?.preventDefault?.();
    setLoading(true);
    setCells([]); setIds([]); setRanks({}); setProgress({ done:0, total:0 });

    try {
      const r = await fetch("/api/maps-grid/start", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
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

  // poll ranks (uses exact place_id if we’ve resolved the business)
  useEffect(() => {
    if (!ids.length) return;
    let stop = false;
    async function tick() {
      if (stop) return;
      try {
        const r = await fetch("/api/maps-grid/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids,
            target: {
              place_id: resolved?.place_id || undefined,
              name: resolved?.name || undefined
            }
          })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error("Poll failed");
        const next = { ...ranks }; let done = 0;
        for (const row of j.results || []) {
          if (row.status === "ok") next[row.id] = row.rank;
          else if (row.status === "pending") next[row.id] = "pending";
          else next[row.id] = null;
        }
        for (const id of ids) if (next[id] !== "pending") done++;
        setRanks(next); setProgress({ done, total: ids.length });
        if (done < ids.length) setTimeout(tick, 2200);
        else setLoading(false);
      } catch {
        setTimeout(tick, 2500);
      }
    }
    tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, resolved?.place_id]);

  const field = { width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8 };

  return (
    <>
      <Head>
        <title>Grid Rank Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", minHeight: "100vh" }}>
        {/* Sidebar */}
        <aside style={{ borderRight: "1px solid #e5e7eb", padding: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Maps Grid Rank Tracker</h2>
          <p style={{ color: "#475569", marginTop: 6 }}>Find by <b>Business Name</b>, not place_id. Map = Google Maps.</p>

          {/* Resolve by NAME */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:10, paddingTop:10, borderTop:"1px solid #e5e7eb" }}>
            <div style={{ gridColumn:"1 / -1" }}><label>Business Name</label>
              <input value={bizName} onChange={e=>setBizName(e.target.value)} style={field} placeholder="e.g., Acme Plumbing LLC" />
            </div>
            <div style={{ gridColumn:"1 / -1" }}><label>City/State (bias)</label>
              <input value={cityText} onChange={e=>setCityText(e.target.value)} style={field} placeholder="City, ST" />
            </div>
            <div style={{ gridColumn:"1 / -1", display:"flex", gap:8 }}>
              <button type="button" onClick={resolveByName}
                style={{ background:"#111", color:"#fff", border:0, borderRadius:10, padding:"8px 12px", cursor:"pointer", fontWeight:700 }}>
                Find Business & Center Map
              </button>
              {resolved ? <span style={{ fontSize:12, color:"#475569" }}>Found: <b>{resolved.name}</b></span> : null}
            </div>
          </div>

          {/* Grid params */}
          <form onSubmit={startGrid} style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:14 }}>
            <div style={{ gridColumn:"1 / -1" }}>
              <label>Keyword</label><input value={keyword} onChange={e=>setKeyword(e.target.value)} style={field} />
            </div>
            <div><label>Center Lat</label><input value={centerLat} onChange={e=>setCenterLat(e.target.value)} style={field} /></div>
            <div><label>Center Lng</label><input value={centerLng} onChange={e=>setCenterLng(e.target.value)} style={field} /></div>
            <div><label>Grid Size</label><input type="number" min="3" step="2" value={gridSize} onChange={e=>setGridSize(e.target.value)} style={field} /></div>
            <div><label>Spacing (m)</label><input type="number" min="100" step="50" value={spacingM} onChange={e=>setSpacingM(e.target.value)} style={field} /></div>
            <div><label>Zoom</label><input value={zoom} onChange={e=>setZoom(e.target.value)} style={field} /></div>
            <div><label>Language</label><input value={language} onChange={e=>setLanguage(e.target.value)} style={field} /></div>
            <div><label>Device</label>
              <select value={device} onChange={e=>setDevice(e.target.value)} style={field}>
                <option value="desktop">desktop</option>
                <option value="mobile">mobile</option>
              </select>
            </div>
            <div style={{ gridColumn:"1 / -1", display:"flex", gap:8, alignItems:"center" }}>
              <button type="submit" disabled={loading}
                style={{ background:"#47943b", color:"#fff", border:0, borderRadius:10, padding:"10px 14px", cursor:"pointer", fontWeight:700 }}>
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
        <main style={{ position:"relative" }}>
          <div ref={mapDiv} style={{ position:"absolute", inset:0 }} />
        </main>
      </div>
    </>
  );
}

