import { GarminConnect } from 'garmin-connect';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!email || !password) return res.status(503).json({ error: 'Garmin credentials not configured' });

  try {
    const client = new GarminConnect({ username: email, password });
    await client.login();

    // Fetch resting HR for last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }

    const results = await Promise.all(
      days.map(date =>
        client.getHeartRate(new Date(date))
          .then(data => ({ date, resting_hr: data?.restingHeartRate ?? null }))
          .catch(() => ({ date, resting_hr: null }))
      )
    );

    res.json({ days: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
