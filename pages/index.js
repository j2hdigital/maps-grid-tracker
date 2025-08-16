// pages/index.js
import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";

// helpers for matching & safe display
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function hostOf(u) {
  if (!u) return null;
  try {
    const x = new URL(u.startsWith("http") ? u : `https://${u}`);
    return x.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(u)
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
  }
}
function matchesTarget(item, target) {
  if (!item || !target) return false;
  if (target.place_id && item.place_id && target.place_id === item.place_id) return true;
  const tHost = hostOf(target.website);
  const iHost = hostOf(item.website);
  if (tHost && iHost && tHost === iHost) return true;
  const tPhone = String(target.phone || "").replace(/[^\d]/g, "");
  const iPhone = String(item.phone || "").replace(/[^\d]/g, "");
  if (tPhone && iPhone && tPhone === iPhone) return true;
  const strip = (x) =>
    x.replace(/\b(llc|inc|co|company|corp|corporation|pllc|plc|ltd)\b/g, "").replace(/\b&\b/g, " and ").trim();
  const a = strip(normName(target.name));
  const b = strip(normName(item.name));
  if (a && b && (a === b || a.includes(b) || b.includes(a))) return true;
  return false;
}
const field = { width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8 };

export default function Home() {
  // Google readiness
  const [mapsReady, setMapsReady] = useState(false);

  // Selection
  const placeInputRef = useRef(null);
  const autoRef = useRef(null);
  const acServiceRef = useRef(null);
  const placeServiceRef = useRef(null);
  const [preds, setPreds] = useState([]);
  const [predOpen, setPredOpen] = useState(false);
  const [resolved, setResolved] = useState(null); // {place_id,name,address,phone,website,rating,rating_count,lat,lng}

  // Hidden center (auto-snap)
  const [centerLat, setCenterLat] = useState(41.671);
  const [centerLng, setCenterLng] = useState(-73.12);

  // UI params
  const [keyword, setKeyword] = useState("");
  const [gridSize, setGridSize] = useState(7);
  const [spacingM, setSpacingM] = useState(804.672); // 0.5 mi
  const device = "desktop";
  const zoom = "15z";
  const language = "en";

  // Job state
  const [cells, setCells] = useState([]);
  const [ids, setIds] = useState([]);
  const [ranks, setRanks] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Competitor panel
  const [topItems, setTopItems] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  // Map
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  // load Google Maps
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.google?.maps) { setMapsReady(true); return; }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) { console.warn("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"); return; }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    s.async = true;
    s.onload = () => setMapsReady(!!window.google?.maps);
    s.onerror = () => console.error("Failed to load Google Maps script");
    document.head.appendChild(s);
  }, []);

  // init map
  useEffect(() => {
    if (!mapsReady || !mapDiv.current || mapRef.current) return;
    mapRef.current = new window.google.maps.Map(mapDiv.current, {
      center: { lat: Number(centerLat), lng: Number(centerLng) },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    setTimeout(() => window.google?.maps?.event?.trigger(mapRef.current, "resize"), 300);
    if (window.google.maps.places?.PlacesService) {
      placeServiceRef.current = new window.google.maps.places.PlacesService(mapRef.current);
    }
  }, [mapsReady, centerLat, centerLng]);

  // recenter
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setCenter({ lat: Number(centerLat), lng: Number(centerLng) });
    }
  }, [centerLat, centerLng]);

  // Autocomplete + fallback
  useEffect(() => {
    if (!mapsReady) return;
    const g = window.google.maps;
    if (placeInputRef.current && g.places?.Autocomplete) {
      const ac = new g.places.Autocomplete(placeInputRef.current, {
        fields: [
          "place_id","name","geometry","formatted_address",
          "formatted_phone_number","international_phone_number","website",
          "rating","user_ratings_total"
        ],
        types: ["establishment"],
      });
      autoRef.current = ac;
      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (!p || !p.place_id || !p.geometry) return;
        const lat = p.geometry.location.lat();
        const lng = p.geometry.location.lng();
        setResolved({
          place_id: p.place_id,
          name: p.name,
          address: p.formatted_address || null,
          phone: p.formatted_phone_number || p.international_phone_number || null,
          website: p.website || null,
          rating: typeof p.rating === "number" ? p.rating : null,
          rating_count: typeof p.user_ratings_total === "number" ? p.user_ratings_total : null,
          lat, lng,
        });
        setCenterLat(lat); setCenterLng(lng);
        mapRef.current?.setCenter({ lat, lng });
        setPreds([]); setPredOpen(false);
      });
    }
    if (g.places?.AutocompleteService) acServiceRef.current = new g.places.AutocompleteService();
    if (!placeServiceRef.current && mapRef.current && g.places?.PlacesService) {
      placeServiceRef.current = new g.places.PlacesService(mapRef.current);
    }
  }, [mapsReady]);

  function onPlaceInput(e) {
    const q = e.target.value || "";
    if (autoRef.current) return;
    if (!acServiceRef.current) return;
    if (q.length < 2) { setPreds([]); setPredOpen(false); return; }
    const center = mapRef.current?.getCenter();
    const locationBias = center ? { location: center, radius: 10000 } : undefined;
    acServiceRef.current.getPlacePredictions(
      { input: q, types: ["establishment"], ...(locationBias ? { locationBias } : {}) },
      (res, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !res?.length) {
          setPreds([]); setPredOpen(false); return;
        }
        setPreds(res.slice(0, 8)); setPredOpen(true);
      }
    );
  }
  function pickPrediction(pred) {
    if (!placeServiceRef.current) return;
    placeServiceRef.current.getDetails(
      {
        placeId: pred.place_id,
        fields: [
          "place_id","name","geometry","formatted_address",
          "formatted_phone_number","international_phone_number","website",
          "rating","user_ratings_total"
        ],
      },
      (p, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !p?.geometry) return;
        const lat = p.geometry.location.lat();
        const lng = p.geometry.location.lng();
        setResolved({
          place_id: p.place_id,
          name: p.name,
          address: p.formatted_address || pred.description || null,
          phone: p.formatted_phone_number || p.international_phone_number || null,
          website: p.website || null,
          rating: typeof p.rating === "number" ? p.rating : null,
          rating_count: typeof p.user_ratings_total === "number" ? p.user_ratings_total : null,
          lat, lng,
        });
        setCenterLat(lat); setCenterLng(lng);
        mapRef.current?.setCenter({ lat, lng });
        if (placeInputRef.current) placeInputRef.current.value = p.name;
        setPreds([]); setPredOpen(false);
      }
    );
  }

  const colorFor = (rank) => {
    if (rank === "pending") return "#94a3b8";
    if (rank == null) return "#ef4444";
    if (rank === 1) return "#f59e0b";
    if (rank <= 3) return "#22c55e";
    if (rank <= 10) return "#0ea5e9";
    if (rank <= 20) return "#a855f7";
    return "#ef4444";
  };

  const tiles = useMemo(() => {
    if (!cells.length || !ids.length) return [];
    return cells.map((cell, idx) => ({ ...cell, id: ids[idx], rank: ranks[ids[idx]] }));
  }, [cells, ids, ranks]);

  // markers + loadTopFor
  useEffect(() => {
    if (!mapsReady || !mapRef.current || !window.google?.maps) return;
    const g = window.google.maps;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (!tiles.length) return;
    const bounds = new g.LatLngBounds();

    const loadTopFor = async (taskId) => {
      if (!taskId) return;
      setSelectedTaskId(taskId);
      try {
        const rr = await fetch(`/api/maps-grid/top?id=${encodeURIComponent(taskId)}`);
        const jj = await rr.json();
        if (rr.ok && jj.ok) {
          const items = Array.isArray(jj.items) ? jj.items : [];
          // exactly Top 3 already padded by API; still guard:
          const top3 = (items.slice(0, 3).length === 3) ? items.slice(0, 3) : [
            items[0] || { rank: null, name: "—", address: "" },
            items[1] || { rank: null, name: "—", address: "" },
            items[2] || { rank: null, name: "—", address: "" },
          ];
          setTopItems(top3);
          // self-correct rank if our listing appears
          if (resolved?.name || resolved?.place_id) {
            const hit = items.find((it) =>
              matchesTarget(it, {
                place_id: resolved.place_id,
                name: resolved.name,
                website: resolved.website,
                phone: resolved.phone,
              })
            );
            if (hit && hit.rank != null) {
              setRanks((prev) => (prev[taskId] === hit.rank ? prev : { ...prev, [taskId]: hit.rank }));
            }
          }
        } else {
          setTopItems([
            { rank: null, name: "—", address: "" },
            { rank: null, name: "—", address: "" },
            { rank: null, name: "—", address: "" },
          ]);
        }
      } catch {
        setTopItems([
          { rank: null, name: "—", address: "" },
          { rank: null, name: "—", address: "" },
          { rank: null, name: "—", address: "" },
        ]);
      }
    };

    tiles.forEach((t) => {
      const rank = t.rank;
      const color = colorFor(rank);
      const label = rank === "pending" ? "…" : rank == null ? "—" : String(rank);
      const marker = new g.Marker({
        position: { lat: t.lat, lng: t.lng },
        map: mapRef.current,
        icon: {
          path: g.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "rgba(0,0,0,0.25)",
          strokeWeight: 1.5,
          scale: 12,
          labelOrigin: new g.Point(0, -0.5),
        },
        label: { text: label, color: "#111", fontWeight: "700", fontSize: "12px" },
        title:
          rank === "pending"
            ? `(${t.row + 1},${t.col + 1}) Awaiting results…`
            : rank == null
            ? `(${t.row + 1},${t.col + 1}) Not found in top results`
            : `(${t.row + 1},${t.col + 1}) Rank: ${rank}`,
      });
      marker.addListener("mouseover", () => loadTopFor(t.id));
      marker.addListener("click", () => loadTopFor(t.id));
      markersRef.current.push(marker);
      bounds.extend(marker.getPosition());
    });

    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 60);
  }, [tiles, mapsReady, resolved?.name, resolved?.place_id, resolved?.website, resolved?.phone]);

  async function startGrid(e) {
    e?.preventDefault?.();
    if (!resolved?.place_id) { alert("Pick your business from Google first."); return; }
    setLoading(true);
    setCells([]); setIds([]); setRanks({}); setProgress({ done: 0, total: 0 });
    setTopItems([]); setSelectedTaskId(null);

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
          device, zoom,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Start failed");

      setCells(j.cells || []);
      setIds(j.ids || []);
      setRanks(Object.fromEntries((j.ids || []).map((id) => [id, "pending"])));
      setProgress({ done: 0, total: (j.ids || []).length });

      // preload center cell competitors
      const centerIndex = Math.floor((j.ids || []).length / 2);
      const centerId = (j.ids || [])[centerIndex] || null;
      if (centerId) {
        setSelectedTaskId(centerId);
        try {
          const rr = await fetch(`/api/maps-grid/top?id=${encodeURIComponent(centerId)}`);
          const jj = await rr.json();
          if (rr.ok && jj.ok) {
            const items = jj.items || [];
            const top3 = (items.slice(0, 3).length === 3) ? items.slice(0, 3) : [
              items[0] || { rank: null, name: "—", address: "" },
              items[1] || { rank: null, name: "—", address: "" },
              items[2] || { rank: null, name: "—", address: "" },
            ];
            setTopItems(top3);
            // self-correct center
            const hit = items.find((it) =>
              matchesTarget(it, {
                place_id: resolved.place_id, name: resolved.name,
                website: resolved.website, phone: resolved.phone,
              })
            );
            if (hit && hit.rank != null) {
              setRanks((prev) => (prev[centerId] === hit.rank ? prev : { ...prev, [centerId]: hit.rank }));
            }
          }
        } catch {}
      }
    } catch (err) {
      alert(err.message);
      setLoading(false);
    }
  }

  // Polling
  useEffect(() => {
    if (!ids.length || !resolved?.place_id) return;
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
              name: resolved?.name || undefined,
              website: resolved?.website || undefined,
              phone: resolved?.phone || undefined,
            },
          }),
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
        if (done < ids.length) setTimeout(tick, 2200);
        else setLoading(false);
      } catch {
        setTimeout(tick, 2500);
      }
    }
    tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, resolved?.place_id, resolved?.website, resolved?.phone]);

  // UI
  const mileOptions = [0.1, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const milesToMeters = (mi) => mi * 1609.344;

  return (
    <>
      <Head>
        <title>Google Maps Grid Rank Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", minHeight: "100vh" }}>
        {/* Sidebar */}
        <aside style={{ borderRight: "1px solid #e5e7eb", padding: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Maps Grid Rank Tracker</h2>

          {/* Find listing */}
          <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #e5e7eb", paddingTop: 10, marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Find your listing using Google:</div>
            <input ref={placeInputRef} onInput={onPlaceInput} placeholder="Start typing your business name…" style={field} />
            {predOpen && preds.length > 0 && !autoRef.current ? (
              <div style={{ position: "relative", zIndex: 10, marginTop: 4, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", boxShadow: "0 6px 18px rgba(0,0,0,0.08)" }}>
                {preds.map((p) => (
                  <div key={p.place_id}
                    onMouseDown={(e) => { e.preventDefault(); pickPrediction(p); }}
                    style={{ padding: "8px 10px", cursor: "pointer", fontSize: 14, borderTop: "1px solid #eef2f7" }}>
                    {p.structured_formatting?.main_text || p.description}
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {p.structured_formatting?.secondary_text || ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {resolved ? (
              <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>
                Selected: <b>{typeof resolved.name === "string" ? resolved.name : ""}</b>
                {typeof resolved.address === "string" && resolved.address ? <> — {resolved.address}</> : null}
                {(resolved.rating || resolved.rating_count) ? (
                  <div style={{ marginTop: 4 }}>
                    {resolved.rating ? `★ ${resolved.rating} ` : ""}
                    {resolved.rating_count ? `(${resolved.rating_count})` : ""}
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
                Pick from Google suggestions to lock exact place_id + coordinates.
              </div>
            )}
          </div>

          {/* Map Criteria */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Map Criteria</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div>
                <label>Distance between Grid Points:</label>
                <select
                  value={(spacingM / 1609.344).toString()}
                  onChange={(e) => setSpacingM(milesToMeters(parseFloat(e.target.value)))}
                  style={field}
                >
                  {mileOptions.map((mi) => (
                    <option key={mi} value={mi}>{mi} miles</option>
                  ))}
                </select>
              </div>

              <div>
                <label>Grid size template:</label>
                <select value={gridSize} onChange={(e) => setGridSize(parseInt(e.target.value, 10))} style={field}>
                  <option value={3}>3x3</option>
                  <option value={5}>5x5</option>
                  <option value={7}>7x7</option>
                </select>
              </div>
            </div>
          </div>

          {/* Keyword + Start */}
          <form onSubmit={startGrid} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 14 }}>
            <div>
              <label>Add Keyword</label>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} style={field} placeholder="e.g., plumber" />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="submit" disabled={loading || !resolved?.place_id}
                style={{ background: "#47943b", color: "#fff", border: 0, borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 700 }}>
                {loading ? "Working…" : "Start Grid"}
              </button>
              <span style={{ fontSize: 12, color: "#475569" }}>
                {progress.total ? `Progress: ${progress.done}/${progress.total}` : null}
              </span>
            </div>
          </form>

          {/* Legend */}
          <div style={{ marginTop: 16, fontSize: 13, color: "#334155" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>
            <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8, alignItems: "center" }}>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#f59e0b", display: "inline-block" }}></span><span>#1</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#22c55e", display: "inline-block" }}></span><span>#2–3</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#0ea5e9", display: "inline-block" }}></span><span>#4–10</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#a855f7", display: "inline-block" }}></span><span>#11–20</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#ef4444", display: "inline-block" }}></span><span>#21+ / Not found</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#94a3b8", display: "inline-block" }}></span><span>Pending</span>
            </div>
          </div>

          {/* Competitor panel (hidden until first scan) */}
          {ids.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700 }}>Competitors {selectedTaskId ? "(cell)" : "(center cell)"}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {selectedTaskId ? (
                    <button type="button"
                      onClick={async () => {
                        try {
                          const rr = await fetch(`/api/maps-grid/top?id=${encodeURIComponent(selectedTaskId)}`);
                          const jj = await rr.json();
                          if (rr.ok && jj.ok) setTopItems(jj.items || []);
                        } catch {}
                      }}
                      style={{ fontSize: 12, background: "transparent", border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 8px", cursor: "pointer" }}>
                      Refresh
                    </button>
                  ) : null}

                  <button type="button"
                    onClick={() => {
                      const rows = [["Rank","Name","Address","Rating","Rating Count","Website"]];
                      (topItems || []).forEach((it) => {
                        rows.push([
                          it.rank ?? "",
                          typeof it.name === "string" ? it.name : "",
                          typeof it.address === "string" ? it.address : "",
                          it.rating ?? "",
                          it.rating_count ?? "",
                          typeof it.website === "string" ? it.website : "",
                        ]);
                      });
                      const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
                      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = "competitors.csv"; a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={{ fontSize: 12, background: "transparent", border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 8px", cursor: "pointer" }}>
                    Export CSV
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
                {topItems.length === 0 ? (
                  <div style={{ padding: 10, color: "#64748b", fontSize: 13 }}>Hover or click a dot to see that cell’s results.</div>
                ) : (
                  topItems.map((it, i) => {
                    const safeName = typeof it.name === "string" ? it.name : "";
                    const safeAddr = typeof it.address === "string" ? it.address : "";
                    const safeWeb  = typeof it.website === "string" ? it.website : "";
                    const isYou = matchesTarget(it, {
                      place_id: resolved?.place_id, name: resolved?.name, website: resolved?.website, phone: resolved?.phone
                    });
                    const bg = it.rank == null ? "#ef4444" : it.rank === 1 ? "#f59e0b" : it.rank <= 3 ? "#22c55e" : it.rank <= 10 ? "#0ea5e9" : it.rank <= 20 ? "#a855f7" : "#ef4444";
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: 10, padding: "10px 12px", borderTop: i ? "1px solid #eef2f7" : "none", alignItems: "center" }}>
                        <div style={{ width: 28, height: 28, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: bg, color: "#111", fontWeight: 700, fontSize: 12, border: "1px solid rgba(0,0,0,0.15)" }}>
                          {it.rank ?? "–"}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: "18px" }}>
                            {safeName || "—"} {isYou ? <span style={{ marginLeft: 6, fontSize: 11, padding: "2px 6px", border: "1px solid #16a34a", color: "#16a34a", borderRadius: 999 }}>You</span> : null}
                          </div>
                          {safeAddr ? <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{safeAddr}</div> : null}
                          {(it.rating || it.rating_count || safeWeb) ? (
                            <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                              {it.rating ? `★ ${it.rating} ` : ""}{it.rating_count ? `(${it.rating_count})` : ""}{safeWeb ? <> • <span style={{ color: "#0ea5e9" }}>{safeWeb}</span></> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Map */}
        <main style={{ position: "relative", minHeight: "100vh" }}>
          <div ref={mapDiv} style={{ position: "absolute", inset: 0, minHeight: "600px" }} />
        </main>
      </div>
    </>
  );
}
