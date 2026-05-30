export default async function handler(req, res) {
  const { ids } = req.query;
  if (!ids) return res.status(400).json({ error: 'Missing ids' });

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: process.env.STRAVA_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });
    const { access_token } = await tokenRes.json();

    const idList = ids.split(',').filter(Boolean).slice(0, 10);
    const results = await Promise.all(
      idList.map(id =>
        Promise.all([
          fetch(`https://www.strava.com/api/v3/activities/${id}/streams?keys=heartrate,time&key_by_type=true`,
            { headers: { Authorization: 'Bearer ' + access_token } }
          ).then(r => r.json()).catch(() => null),
          fetch(`https://www.strava.com/api/v3/activities/${id}`,
            { headers: { Authorization: 'Bearer ' + access_token } }
          ).then(r => r.json()).then(d => d?.device_name || null).catch(() => null)
        ])
      )
    );

    const out = {};
    idList.forEach((id, i) => {
      out[id] = results[i][0];
      if (results[i][1]) out[id] = { ...out[id], _device_name: results[i][1] };
    });
    res.json(out);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
