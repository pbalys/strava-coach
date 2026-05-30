export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const jwt = process.env.GARMIN_JWT;
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
          `https://connectapi.garmin.com/wellness-service/wellness/dailyHeartRate?date=${date}`,
          {
            headers: {
              'Authorization': `Bearer ${jwt}`,
              'Cookie': cookieHeader,
              'NK': 'NT',
              'DI-Backend': 'connectapi.garmin.com',
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
