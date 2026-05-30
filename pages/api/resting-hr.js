import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const SECRET = process.env.RESTING_HR_SECRET;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    const values = await Promise.all(days.map(date => redis.get(`rhr:${date}`)));
    const result = days.map((date, i) => ({ date, resting_hr: values[i] ? Number(values[i]) : null }));
    return res.json({ days: result });
  }

  if (req.method === 'POST') {
    const auth = req.headers['authorization'];
    if (!SECRET || auth !== `Bearer ${SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { date, resting_hr } = req.body;
    if (!date || !resting_hr) return res.status(400).json({ error: 'Missing date or resting_hr' });
    await redis.set(`rhr:${date}`, resting_hr, { ex: 90 * 24 * 3600 });
    return res.json({ ok: true, date, resting_hr });
  }

  res.status(405).end();
}
