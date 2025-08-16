export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { keyword, location } = req.body;
    if (!keyword || !location) {
      return res.status(400).json({ error: "Missing keyword or location" });
    }

    const auth = "Basic " + Buffer.from(
      `${process.env.DFS_LOGIN}:${process.env.DFS_PASSWORD}`
    ).toString("base64");

    const base = "https://api.dataforseo.com/v3/serp/google/maps/task_post";
    const payload = [{ keyword, location_name: location, language_name: "English" }];

    const r = await fetch(base, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({ error: data });
    }

    res.status(200).json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

