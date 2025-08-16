// pages/api/maps-grid/poll.js
// ...keep your imports and DFS auth as-is

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ") // drop punctuation/symbols
    .replace(/\s+/g, " ")
    .trim();
}

function hostnameOf(u) {
  if (!u) return null;
  try {
    const x = new URL(u.startsWith("http") ? u : `https://${u}`);
    return x.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(u).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
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

    if (tPlace && place && tPlace === place) return true;     // exact place_id
    if (tCid && cid && tCid === cid) return true;             // exact CID
    if (tPhone && phone && tPhone && tPhone === phone) return true; // phone match
    if (tHost && host && tHost === host) return true;         // website host match

    // fuzzy name: allow small edits (“&” vs “and”, LLC, punctuation)
    if (tName && name) {
      const a = tName.replace(/\b(llc|inc|co|company|corp|corporation|pllc|plc|ltd)\b/g, "").trim();
      const b = name.replace(/\b(llc|inc|co|company|corp|corporation|pllc|plc|ltd)\b/g, "").trim();
      if (a && b && (a === b || a.includes(b) || b.includes(a))) return true;
    }
    return false;
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { ids = [], target = {} } = body;

    // fetch all tasks in small batches
    const auth = /* your DFS auth header here */;
    const base = "https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced";
    const matcher = makeMatcher(target);

    const results = [];
    for (const id of ids) {
      const r = await fetch(`${base}/${id}`, { headers: auth });
      const j = await r.json();

      if (!(r.ok && j.status_code === 20000)) {
        results.push({ id, status: "error", error: j.status_message || "DFS error" });
        continue;
      }

      const items = j?.tasks?.[0]?.result?.[0]?.items || [];
      if (!items.length) {
        const isPending = j?.tasks?.[0]?.status_message?.toLowerCase?.().includes("in queue") ||
                          j?.status_message?.toLowerCase?.().includes("in queue");
        results.push({ id, status: isPending ? "pending" : "ok", rank: null });
        continue;
      }

      // rank_group is DataForSEO’s grouped rank (1-based). Fall back to array index.
      let foundRank = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (matcher(it)) {
          foundRank = it.rank_group ?? it.rank_absolute ?? (i + 1);
          break;
        }
      }
      results.push({ id, status: "ok", rank: foundRank });
    }

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 500) });
  }
}
