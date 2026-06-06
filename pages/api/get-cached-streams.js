import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const redis = new Redis({
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  try {
    const data = await redis.get(`activity:${id}`);
    if (!data) return res.status(404).json({ error: 'Not cached' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
