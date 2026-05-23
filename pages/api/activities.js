const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;

async function getAccessToken() {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  return data.access_token;
}

module.exports = async function handler(req, res) {
  try {
    const page = req.query.page || 1;
    const token = await getAccessToken();
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=20&page=${page}`, {
      headers: {'Authorization': 'Bearer ' + token}
    });
    const data = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
}
