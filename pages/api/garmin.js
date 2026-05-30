export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const jwt = process.env.JWT_WEB;
  const session = process.env.GARMIN_SESSION;
  if (!jwt) return res.status(503).json({ error: 'Garmin credentials not configured' });

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const cookieHeader = [
    `JWT_WEB=${jwt}`,
    session ? `SESSIONID=${session}` : ''
  ].filter(Boolean).join('; ');

  const results = await Promise.all(
    days.map(async date => {
      try {
        const r = await fetch(
          `https://connect.garmin.com/modern/proxy/wellness-service/wellness/dailyHeartRate?date=${date}`,
          {
            headers: {
              'Cookie': cookieHeader,
              'NK': 'NT',
              'X-app-ver': '4.40.0.0',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            }
          }
        );
        if (!r.ok) {
          console.error(`Garmin ${date}: HTTP ${r.status}`);
          return { date, resting_hr: null };
        }
        const data = await r.json();
        return { date, resting_hr: data?.restingHeartRate ?? null };
      } catch (e) {
        console.error(`Garmin ${date}:`, e.message);
        return { date, resting_hr: null };
      }
    })
  );

  res.json({ days: results });
}
