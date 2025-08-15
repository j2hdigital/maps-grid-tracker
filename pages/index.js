import { useState, useMemo, useEffect } from "react";

export default function Home() {
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

  const [cells, setCells] = useState([]);
  const [ids, setIds] = useState([]);
  const [ranks, setRanks] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const gridTemplate = useMemo(() => `repeat(${gridSize}, minmax(34px, 1fr))`, [gridSize]);
  const field = { width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8 };

  function colorFor(rank) {
    if (rank === "pending") return "#cbd5e1";
    if (rank == null) return "#9ca3af";
    if (rank <= 3) return "#22c55e";
    if (rank <= 10) return "#eab308";
    if (rank <= 20) return "#f97316";
    return "#ef4444";
  }

  async function startGrid(e) {
    e?.preventDefault?.();
    setLoading(true);
    setCells([]); setIds([]); setRanks({}); setProgress({ done:0, total:0 });

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
    if (!r.ok || !j.ok) { alert("Start failed: " + (j.error || r.statusText)); setLoading(false); return; }
    setCells(j.cells || []); setIds(j.ids || []);
    setRanks(Object.fromEntries((j.ids || []).map(id => [id, "pending"])));
    setProgress({ done: 0, total: (j.ids || []).length });
  }

  useEffect(() => {
    if (!ids.length) return;
    let stop = false;
    async function poll() {
      if (stop) return;
      const r = await fetch("/api/maps-grid/poll", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ ids, target: { place_id: targetPlace.trim() || undefined, name: targetName.trim() || undefined } })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setTimeout(poll, 2500); return; }

      const next = { ...ranks }; let done = 0;
      for (const row of j.results || []) {
        if (row.status === "ok") next[row.id] = row.rank;
        else if (row.status === "pending") next[row.id] = "pending";
        else next[row.id] = null;
      }
      for (const id of ids) if (next[id] !== "pending") done++;
      setRanks(next); setProgress({ done, total: ids.length });
      if (done < ids.length) setTimeout(poll, 2500); else setLoading(false);
    }
    poll();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, targetName, targetPlace]);

  const tiles = useMemo(() => {
    if (!cells.length || !ids.length) return [];
    return cells.map((cell, idx) => ({ ...cell, id: ids[idx], rank: ranks[ids[idx]] }));
  }, [cells, ids, ranks]);

  return (
    <div style={{ maxWidth: 980, margin: "24px auto", padding: "0 12px", fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial" }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Google Maps Grid Rank Tracker</h1>
      <p style={{ marginTop: 6, color: "#475569" }}>Separate project • powered by DataForSEO</p>

      <form onSubmit={startGrid} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginTop: 10 }}>
        <div><label>Keyword</label><input value={keyword} onChange={e=>setKeyword(e.target.value)} style={field} /></div>
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
        <div><label>Target Name (optional)</label><input value={targetName} onChange={e=>setTargetName(e.target.value)} style={field} /></div>
        <div><label>Target place_id (optional)</label><input value={targetPlace} onChange={e=>setTargetPlace(e.target.value)} style={field} /></div>
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
          <button type="submit" disabled={loading} style={{ background:"#47943b", color:"#fff", border:0, borderRadius:10, padding:"10px 14px", cursor:"pointer", fontWeight:700 }}>
            {loading ? "Working…" : "Start Grid"}
          </button>
          <span style={{ fontSize:13, color:"#475569" }}>
            {progress.total ? `Progress: ${progress.done}/${progress.total}` : null}
          </span>
        </div>
      </form>

      <div style={{ marginTop: 16, display:"grid", gridTemplateColumns: gridTemplate, gap: 6, alignItems:"center", justifyItems:"center" }}>
        {tiles.map((t, i) => (
          <div key={t.id || i}
            title={`(${t.row+1},${t.col+1})  ${t.lat},${t.lng}  rank: ${t.rank ?? "—"}`}
            style={{ width:36, height:36, borderRadius:6, background: (()=>{ if(t.rank==="pending")return"#cbd5e1"; if(t.rank==null)return"#9ca3af"; if(t.rank<=3)return"#22c55e"; if(t.rank<=10)return"#eab308"; if(t.rank<=20)return"#f97316"; return"#ef4444";})(), color:"#111", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", border:"1px solid rgba(0,0,0,0.08)" }}>
            {t.rank === "pending" ? "…" : (t.rank ?? "—")}
          </div>
        ))}
      </div>
    </div>
  );
}
