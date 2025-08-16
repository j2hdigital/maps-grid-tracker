// pages/index.js
import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";

export default function Home() {
  // ---------- Google Maps / Places readiness ----------
  const [mapsReady, setMapsReady] = useState(false);

  // ---------- Business selection ----------
  const placeInputRef = useRef(null);     // <input> element
  const autoRef = useRef(null);           // Autocomplete widget (if available)
  const acServiceRef = useRef(null);      // Fallback AutocompleteService
  const placeServiceRef = useRef(null);   // Fallback PlacesService
  const [preds, setPreds] = useState([]); // Fallback predictions list
  const [predOpen, setPredOpen] = useState(false);
  const [resolved, setResolved] = useState(null); // { place_id, name, address, lat, lng }
  const [snapToBusiness, setSnapToBusiness] = useState(true);

  // ---------- Grid params ----------
  const [keyword, setKeyword] = useState("plumber");
  const [centerLat, setCenterLat] = useState(41.671);
  const [centerLng, setCenterLng] = useState(-73.12);
  const [gridSize, setGridSize] = useState(9);      // odd: 5/7/9/11...
  const [spacingM, setSpacingM] = useState(500);    // meters between cells
  const [zoom, setZoom] = useState("15z");
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("desktop");  // desktop returns up to 100 results

  // ---------- Job state ----------
  const [cells, setCells] = useState([]);
  const [ids, setIds] = useState([]);
  const [ranks, setRanks] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // ---------- Competitor list panel ----------
  const [topItems, setTopItems] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  // ---------- Map ----------
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  // ---------- Load Google Maps JS (with Places library) ----------
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.google?.maps) { setMapsReady(true); return; }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) { console.warn("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"); return; }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    s.async = true;
    s.onerror = () => console.error("Failed to load Google Maps script");
    s.onload = () => {
      if (window.google?.maps) setMapsReady(true);
      else console.error("Google Maps loaded but window.google.maps is missing");
    };
    document.head.appendChild(s);
  }, []);

  // ---------- Init map once Google is ready ----------
  useEffect(() => {
    if (!mapsReady) return;
    if (!mapDiv.current || mapRef.current) return;

    mapRef.current = new window.google.maps.Map(mapDiv.current, {
      center: { lat: Number(centerLat), lng: Number(centerLng) },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    // Ensure it renders after layout
    setTimeout(() => window.google?.maps?.event?.trigger(mapRef.current, "resize"), 300);

    // Create fallback PlacesService bound to this map
    if (window.google.maps.places?.PlacesService) {
      placeServiceRef.current = new window.google.maps.places.PlacesService(mapRef.current);
    }
  }, [mapsReady]);

  // ---------- Re-center map if center changes ----------
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setCenter({ lat: Number(centerLat), lng: Number(centerLng) });
    }
  }, [centerLat, centerLng]);

  // ---------- Autocomplete widget + fallback services ----------
  useEffect(() => {
    if (!mapsReady) return;
    const g = window.google.maps;

    // Standard widget (shows Google's dropdown)
    if (placeInputRef.current && g.places?.Autocomplete) {
      const ac = new g.places.Autocomplete(placeInputRef.current, {
        fields: ["place_id", "name", "geometry", "formatted_address"],
        types: ["establishment"], // businesses
      });
      autoRef.current = ac;

      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (!p || !p.place_id || !p.geometry) return;
        const lat = p.geometry.location.lat();
        const lng = p.geometry.location.lng();
        setResolved({ place_id: p.place_id, name: p.name, address: p.formatted_address || null, lat, lng });
        if (snapToBusiness) {
          setCenterLat(lat); setCenterLng(lng);
          mapRef.current?.setCenter({ lat, lng });
        }
        setPreds([]); setPredOpen(false);
        setDevice("desktop");
      });
    }

    // Fallback services (used if widget is unavailable or blocked)
    if (g.places?.AutocompleteService) {
      acServiceRef.current = new g.places.AutocompleteService();
    }
    if (!placeServiceRef.current && mapRef.current && g.places?.PlacesService) {
      placeServiceRef.current = new g.places.PlacesService(mapRef.current);
    }
  }, [mapsReady, snapToBusiness]);

  // ---------- Fallback: fetch predictions when typing (if widget didn't attach) ----------
  function onPlaceInput(e) {
    const q = e.target.value || "";
    if (autoRef.current) return; // widget will handle its own dropdown

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

  // ---------- Fallback: pick a prediction and resolve details ----------
  function pickPrediction(pred) {
    if (!placeServiceRef.current) return;
    placeServiceRef.current.getDetails(
      { placeId: pred.place_id, fields: ["place_id","name","geometry","formatted_address"] },
      (p, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !p?.geometry) return;
        const lat = p.geometry.location.lat();
        const lng = p.geometry.location.lng();
        setResolved({ place_id: p.place_id, name: p.name, address: p.formatted_address || pred.description || null, lat, lng });
        if (snapToBusiness) {
          setCenterLat(lat); setCenterLng(lng);
          mapRef.current?.setCenter({ lat, lng });
        }
        if (placeInputRef.current) placeInputRef.current.value = p.name;
        setPreds([]); setPredOpen(false);
        setDevice("desktop");
      }
    );
  }

  // ---------- Color helper ----------
  const colorFor = (rank) => {
    if (rank === "pending") return "#94a3b8"; // slate-400
    if (rank == null) return "#9ca3af";       // gray-400
    if (rank <= 3) return "#22c55e";          // green-500
    if (rank <= 10) return "#eab308";         // yellow-500
    if (rank <= 20) return "#f97316";         // orange-500
    return "#ef4444";                          // red-500
  };

  // ---------- Prepare tiles ----------
  const tiles = useMemo(() => {
    if (!cells.length || !ids.length) return [];
    return cells.map((cell, idx) => ({ ...cell, id: ids[idx], rank: ranks[ids[idx]] }));
  }, [cells, ids, ranks]);

  // ---------- Draw markers ----------
  useEffect(() => {
    if (!mapsReady || !mapRef.current || !window.google?.maps) return;
    const g = window.google.maps;

    // Clear old markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    if (!tiles.length) return;

    const bounds = new g.LatLngBounds();

    tiles.forEach((t) => {
      const rank = t.rank;
      const color = colorFor(rank);
      const label = rank === "pending" ? "…" : (rank ?? "–").toString();

      const marker = new g.Marker({
        position: { lat: t.lat, lng: t.lng },
        map: mapRef.current,
        icon: {
          path: g.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "rgba(0,0,0,0.25)",
          strokeWeight: 1.5,
          scale: 12, // ≈ px radius
          labelOrigin: new g.Point(0, -0.5),
        },
        label: { text: label, color: "#111", fontWeight: "700", fontSize: "12px" },
        title: `(${t.row + 1},${t.col + 1}) ${t.lat}, ${t.lng} • rank: ${rank ?? "—"}`,
      });

      // Hover/click → load that cell’s competitor list
      const loadTopFor = async (taskId) => {
        if (!taskId) return;
        setSelectedTaskId(taskId);
        try {
          const rr = await fetch(`/api/maps-grid/top?id=${encodeURIComponent(taskId)}&limit=20`);
          const jj = await rr.json();
          if (rr.ok && jj.ok) setTopItems(jj.items || []);
        } catch { /* ignore */ }
      };
      marker.addListener("mouseover", () => loadTopFor(t.id));
      marker.addListener("click", () => loadTopFor(t.id));

      markersRef.current.push(marker);
      bounds.extend(marker.getPosition());
    });

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, 60);
    }
  }, [tiles, mapsReady]);

  // ---------- Start grid ----------
  async function startGrid(e) {
    e?.preventDefault?.();
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
          device,
          zoom,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Start failed");

      setCells(j.cells || []);
      setIds(j.ids || []);
      setRanks(Object.fromEntries((j.ids || []).map((id) => [id, "pending"])));
      setProgress({ done: 0, total: (j.ids || []).length });

      // Default competitor panel → center cell
      const centerIndex = Math.floor((j.ids || []).length / 2);
      const centerId = (j.ids || [])[centerIndex] || null;
      if (centerId) {
        setSelectedTaskId(centerId);
        try {
          const rr = await fetch(`/api/maps-grid/top?id=${encodeURIComponent(centerId)}&limit=20`);
          const jj = await rr.json();
          if (rr.ok && jj.ok) setTopItems(jj.items || []);
        } catch { /* ignore */ }
      }
    } catch (err) {
      alert(err.message);
      setLoading(false);
    }
  }

  // ---------- Poll ranks ----------
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
              name: resolved?.name || undefined,
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
  }, [ids, resolved?.place_id]);

  // ---------- Use my location ----------
  async function useMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCenterLat(lat);
        setCenterLng(lng);
        if (mapRef.current) {
          const g = window.google.maps;
          mapRef.current.setCenter({ lat, lng });
          // Bias fallback predictions to ~10km radius around user
          if (acServiceRef.current && g.Circle && placeInputRef.current && !autoRef.current) {
            // We already use locationBias when querying predictions; this just ensures center is up-to-date
          }
        }
      },
      () => alert("Couldn’t get your location")
    );
  }

  const field = { width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8 };

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
          <p style={{ color: "#475569", marginTop: 6 }}>
            Find your business via <b>Google Places</b>, then run the grid.
          </p>

          {/* Find Business */}
          <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #e5e7eb", paddingTop: 10, marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Find Business</div>
            <input
              ref={placeInputRef}
              onInput={onPlaceInput} // fallback predictions if widget blocked
              placeholder="Start typing business name…"
              style={field}
            />
            {/* Fallback predictions dropdown (only shows if widget didn't attach) */}
            {predOpen && preds.length > 0 && !autoRef.current ? (
              <div style={{
                position: "relative", zIndex: 10, marginTop: 4,
                border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff",
                boxShadow: "0 6px 18px rgba(0,0,0,0.08)"
              }}>
                {preds.map(p => (
                  <div
                    key={p.place_id}
                    onMouseDown={(e) => { e.preventDefault(); pickPrediction(p); }}
                    style={{ padding: "8px 10px", cursor: "pointer", fontSize: 14, borderTop: "1px solid #f1f5f9" }}
                  >
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
                Selected: <b>{resolved.name}</b>
                {resolved.address ? <> — {resolved.address}</> : null}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
                Pick from Google suggestions to lock exact place_id + coordinates.
              </div>
            )}

            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={useMyLocation}
                style={{ background: "#111", color: "#fff", border: 0, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 700 }}
              >
                Use my location
              </button>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334155" }}>
                <input type="checkbox" checked={snapToBusiness} onChange={e => setSnapToBusiness(e.target.checked)} />
                Snap center to selected business
              </label>
            </div>
          </div>

          {/* Grid params */}
          <form onSubmit={startGrid} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Keyword</label>
              <input value={keyword} onChange={e => setKeyword(e.target.value)} style={field} />
            </div>
            <div>
              <label>Center Lat</label>
              <input value={centerLat} onChange={e => setCenterLat(e.target.value)} style={field} />
            </div>
            <div>
              <label>Center Lng</label>
              <input value={centerLng} onChange={e => setCenterLng(e.target.value)} style={field} />
            </div>
            <div>
              <label>Grid Size</label>
              <input type="number" min="3" step="2" value={gridSize} onChange={e => setGridSize(e.target.value)} style={field} />
            </div>
            <div>
              <label>Spacing (m)</label>
              <input type="number" min="100" step="50" value={spacingM} onChange={e => setSpacingM(e.target.value)} style={field} />
            </div>
            <div>
              <label>Zoom</label>
              <input value={zoom} onChange={e => setZoom(e.target.value)} style={field} />
            </div>
            <div>
              <label>Language</label>
              <input value={language} onChange={e => setLanguage(e.target.value)} style={field} />
            </div>
            <div>
              <label>Device</label>
              <select value={device} onChange={e => setDevice(e.target.value)} style={field}>
                <option value="desktop">desktop</option>
                <option value="mobile">mobile</option>
              </select>
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="submit"
                disabled={loading}
                style={{ background: "#47943b", color: "#fff", border: 0, borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 700 }}
              >
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
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#22c55e", display: "inline-block" }}></span><span>#1–3</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#eab308", display: "inline-block" }}></span><span>#4–10</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#f97316", display: "inline-block" }}></span><span>#11–20</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#ef4444", display: "inline-block" }}></span><span>#21+</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#9ca3af", display: "inline-block" }}></span><span>Not found</span>
              <span style={{ width: 14, height: 14, borderRadius: 8, background: "#94a3b8", display: "inline-block" }}></span><span>Pending</span>
            </div>
          </div>

          {/* Competitor list panel */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700 }}>Competitors {selectedTaskId ? "(cell)" : "(center cell)"}</div>
              {selectedTaskId ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const rr = await fetch(`/api/maps-grid/top?id=${encodeURIComponent(selectedTaskId)}&limit=20`);
                      const jj = await rr.json();
                      if (rr.ok && jj.ok) setTopItems(jj.items || []);
                    } catch { /* ignore */ }
                  }}
                  style={{ fontSize: 12, background: "transparent", border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 8px", cursor: "pointer" }}
                >
                  Refresh
                </button>
              ) : null}
            </div>

            <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
              {topItems.length === 0 ? (
                <div style={{ padding: 10, color: "#64748b", fontSize: 13 }}>Hover or click a dot to see that cell’s results.</div>
              ) : topItems.map((it, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: 10, padding: "10px 12px", borderTop: i ? "1px solid #eef2f7" : "none", alignItems: "center" }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
                    background: (() => { const r = it.rank; if (r == null) return "#9ca3af"; if (r <= 3) return "#22c55e"; if (r <= 10) return "#eab308"; if (r <= 20) return "#f97316"; return "#ef4444"; })(),
                    color: "#111", fontWeight: 700, fontSize: 12, border: "1px solid rgba(0,0,0,0.15)"
                  }}>
                    {it.rank ?? "–"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: "18px" }}>{it.name || "—"}</div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{it.address || ""}</div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                      {it.rating ? `★ ${it.rating} ` : ""}{it.rating_count ? `(${it.rating_count})` : ""}
                      {it.website ? <> • <span style={{ color: "#0ea5e9" }}>{String(it.website).replace(/^https?:\/\//, "").replace(/\/$/, "")}</span></> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Map */}
        <main style={{ position: "relative", minHeight: "100vh" }}>
          <div ref={mapDiv} style={{ position: "absolute", inset: 0, minHeight: "600px" }} />
        </main>
      </div>
    </>
  );
}
