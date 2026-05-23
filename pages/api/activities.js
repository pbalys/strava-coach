export default async function handler(req, res) {
  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: process.env.STRAVA_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });
    const { access_token } = await tokenRes.json();
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=20&page=${req.query.page||1}`, {
      headers: {'Authorization': 'Bearer ' + access_token}
    });
    const data = await r.json();
    res.json(Array.isArray(data) ? data : []);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
}
