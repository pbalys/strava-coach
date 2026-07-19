import { Redis } from '@upstash/redis';

const ZONES = [
  { n:1, min:0,   max:104 },
  { n:2, min:105, max:138 },
  { n:3, min:139, max:155 },
  { n:4, min:156, max:172 },
  { n:5, min:173, max:999 },
];

function zoneForHR(hr) {
  return ZONES.find(z => hr >= z.min && hr <= z.max) || null;
}

function calcZonesFromStreams(hrData, timeData) {
  const counts = {1:0,2:0,3:0,4:0,5:0};
  let total = 0;
  for (let i = 1; i < hrData.length; i++) {
    const hr = hrData[i];
    const dt = timeData[i] - timeData[i-1];
    const z = zoneForHR(hr);
    if (z && dt > 0 && dt < 30) { counts[z.n] += dt; total += dt; }
  }
  return { counts, total };
}

const RECOVERY_HR = 123;

function countPeaks(hrData, timeData, threshold=156, minDurSec=60, graceSec=15) {
  let peaks = [], inPeak = false, peakStart = 0, belowSince = null;
  let valleys = []; // {minHr, secBelow123} per rest between peaks
  let valleyMin = null, valleyRecovStart = null, valleyRecovSec = 0;

  const flushValley = () => {
    if (valleyMin !== null) {
      valleys.push({ minHr: valleyMin, secBelow123: Math.round(valleyRecovSec) });
    }
    valleyMin = null; valleyRecovStart = null; valleyRecovSec = 0;
  };

  for (let i = 0; i < hrData.length; i++) {
    const t = timeData[i], hr = hrData[i];
    const dt = i > 0 ? Math.min(t - timeData[i-1], 10) : 0; // cap gap at 10s
    if (!inPeak) {
      if (hr >= threshold) {
        flushValley();
        inPeak = true; peakStart = t; belowSince = null;
      } else {
        valleyMin = valleyMin === null ? hr : Math.min(valleyMin, hr);
        if (hr < RECOVERY_HR) valleyRecovSec += dt;
      }
    } else {
      if (hr >= threshold) {
        belowSince = null;
      } else {
        if (belowSince === null) belowSince = t;
        if (t - belowSince >= graceSec) {
          const dur = belowSince - peakStart;
          if (dur >= minDurSec) peaks.push(Math.round(dur / 60));
          inPeak = false; belowSince = null;
          valleyMin = hr; valleyRecovSec = hr < RECOVERY_HR ? dt : 0; valleyRecovStart = t;
        }
      }
    }
  }
  if (inPeak) {
    const endT = belowSince || timeData[timeData.length - 1];
    const dur = endT - peakStart;
    if (dur >= minDurSec) peaks.push(Math.round(dur / 60));
  }
  // valleys[i] = rest between peaks[i] and peaks[i+1]
  return { peaks, valleys };
}

async function getStravaToken() {
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const { access_token } = await r.json();
  return access_token;
}

export default async function handler(req, res) {
  const redis = new Redis({
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  try {
    const token = await getStravaToken();
    let idsToProcess = [];

    if (req.query.ids) {
      idsToProcess = req.query.ids.split(',').filter(Boolean).slice(0, 20);
    } else {
      const PLAN_START_TS = Math.floor(new Date('2026-05-25T00:00:00').getTime() / 1000);
      const actsRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=100&page=1&after=${PLAN_START_TS}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const acts = await actsRes.json();
      idsToProcess = (Array.isArray(acts) ? acts : [])
        .filter(a => a.type === 'Ride' || a.type === 'VirtualRide')
        .map(a => String(a.id));
    }

    const results = await Promise.allSettled(
      idsToProcess.map(async id => {
        const [detailRes, streamsRes] = await Promise.all([
          fetch(`https://www.strava.com/api/v3/activities/${id}`, {
            headers: { 'Authorization': 'Bearer ' + token }
          }),
          fetch(`https://www.strava.com/api/v3/activities/${id}/streams?keys=heartrate,time&key_by_type=true`, {
            headers: { 'Authorization': 'Bearer ' + token }
          })
        ]);

        const [detail, streams] = await Promise.all([detailRes.json(), streamsRes.json()]);

        if (detail.device_name !== 'Wahoo ELEMNT BOLT') {
          return { id, skipped: true, device: detail.device_name || 'unknown' };
        }

        if (!streams.heartrate || !streams.time) {
          return { id, skipped: true, reason: 'no HR data' };
        }

        const hrData = streams.heartrate.data;
        const timeData = streams.time.data;
        const { counts, total } = calcZonesFromStreams(hrData, timeData);
        const { peaks, valleys } = countPeaks(hrData, timeData);

        const zones = {};
        ZONES.forEach(z => {
          zones['S' + z.n] = {
            seconds: Math.round(counts[z.n]),
            pct: total > 0 ? Math.round(counts[z.n] / total * 100) : 0
          };
        });

        const payload = {
          id,
          name: detail.name,
          date: detail.start_date_local,
          device: detail.device_name,
          zones,
          total_seconds: Math.round(total),
          interval_peaks: peaks,
          interval_valleys: valleys,
          interval_count: peaks.length,
          avg_hr: detail.average_heartrate ? Math.round(detail.average_heartrate) : null,
          max_hr: detail.max_heartrate ? Math.round(detail.max_heartrate) : null,
          cached_at: new Date().toISOString()
        };

        await redis.set(`activity:${id}`, payload, { ex: 30 * 24 * 3600 });
        return { id, name: detail.name, cached: true, peaks: peaks.length };
      })
    );

    const summary = results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    res.json({
      ok: true,
      cached: summary.filter(r => r.cached).length,
      skipped: summary.filter(r => r.skipped).length,
      errors: summary.filter(r => r.error).length,
      results: summary
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
