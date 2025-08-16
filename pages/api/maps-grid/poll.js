// pages/api/maps-grid/poll.js
// Poll DataForSEO tasks and determine the rank of the target business
// using robust matching: place_id → cid → phone → website → fuzzy name.

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostnameOf(u) {
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

function makeMatcher(target) {
  const t = target || {};
  const tPlace = t.place_id || null;
  const tCid   = t.cid || null;
  const tPhone = (t.phone || "").replace(/[^\d]/g, "");
  const tHost  = hostnameOf(t.website || t.domain);
  const tName  = normalizeName(t.name);

  return (it) => {
    const place = it.place_id || null;
    const cid   = it.cid || null;
    const phone = (it.phone || "").replace(/[^\d]/g, "");
    const host  = hostnameOf(it.website || it.domain || it.url);
    const name  = normalizeName(it.title || it.name);

    if (tPlace && place && tPlace === place) return true;       // exact place_id
    if (tCid && cid && tCid === cid) return true;               // exact CID
    if (tPhone && phone && tPhone === phone) return true;       // phone match
    if (tHost && host && tHost === host) return true;           // website host match

    // fuzzy: ignore corporate suffixes, punctuation, &/and
    if (tName && name) {
      const strip = (x) =>
        x.replace(/\b(llc|inc|co|company|corp|corporation|pllc|plc|ltd)\b/g, "")
         .replace(/\b&\b/g, " and ")
         .trim();
      const a = strip(tName);
      const b = strip(name);
      if (a && b && (a === b || a.includes(b) || b.includes(a))) return true;
    }
    return false;
  };
}

// Build Basic auth header for DataForSEO
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { ids = [], target = {} } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Missing ids[]" });
    }

    const auth = authHeader();
    if (!auth) {
      return res.status(500).json({ error: "Missing DFS_LOGIN/DFS_PASSWORD env vars" });
    }

    const base = "https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced";
    const matcher = makeMatcher(target);

    const results = [];

    // Fetch each task (you could batch, but this is simple & clear)
    for (const id of ids) {
      try {
        const r = await fetch(`${base}/${encodeURIComponent(id)}`, { headers: auth });
        const j = await r.json();

        if (!(r.ok && j.status_code === 20000)) {
          // If queueing, mark pending; otherwise error
          const msg = j.status_message || j.error || "DFS error";
          const pending =
            /in queue|queued|processing/i.test(msg) ||
            /in queue|queued|processing/i.test(j?.tasks?.[0]?.status_message || "");
          results.push({ id, status: pending ? "pending" : "error", error: msg });
          continue;
        }

        const items = j?.tasks?.[0]?.result?.[0]?.items || [];
        if (!items.length) {
          results.push({ id, status: "ok", rank: null });
          continue;
        }

        let foundRank = null;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (matcher(it)) {
            foundRank = it.rank_group ?? it.rank_absolute ?? (i + 1);
            break;
          }
        }

        results.push({ id, status: "ok", rank: foundRank });
      } catch (err) {
        results.push({ id, status: "error", error: String(err).slice(0, 200) });
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 500) });
  }
}

