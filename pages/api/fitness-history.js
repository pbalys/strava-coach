// Pobiera aktywności z ostatnich 6 miesięcy i oblicza CTL/ATL/TSB
// na podstawie pełnej historii (nie tylko ostatnie 100 aktywności)

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

function calcTSS(a) {
  // Przybliżony TSS z moving_time i average_heartrate
  // Bez miernika mocy używamy HR-based TSS
  const durationHr = a.moving_time / 3600;
  if (!durationHr) return 0;
  const avgHr = a.average_heartrate || 0;
  const hrMax = 177;
  // Intensywność względna: (avgHr/hrMax)^2 * 100
  const intensity = avgHr > 0 ? Math.pow(avgHr / hrMax, 2) : 0.3;
  return Math.round(durationHr * intensity * 100);
}

export default async function handler(req, res) {
  try {
    const token = await getStravaToken();

    // 6 miesięcy temu jako timestamp Unix
    const sixMonthsAgo = Math.floor(Date.now() / 1000) - 6 * 30 * 24 * 3600;

    // Pobierz wszystkie strony aktywności z ostatnich 6 miesięcy
    let allActs = [];
    let page = 1;
    while (true) {
      const r = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}&after=${sixMonthsAgo}`,
        { headers: { 'Authorization': 'Bearer ' + token } }
      );
      const batch = await r.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      allActs = allActs.concat(batch);
      if (batch.length < 100) break;
      page++;
    }

    // Sortuj od najstarszych
    allActs.sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));

    // Oblicz CTL/ATL dzień po dniu (PMC)
    // CTL = fitness, stała czasowa 42 dni
    // ATL = zmęczenie, stała czasowa 7 dni
    const CTL_TC = 42, ATL_TC = 7;
    const ctlDecay = 1 - 1 / CTL_TC;
    const atlDecay = 1 - 1 / ATL_TC;

    let ctl = 0, atl = 0;

    // Buduj mapę TSS per dzień
    const tssPerDay = {};
    allActs.forEach(a => {
      const day = a.start_date_local.slice(0, 10);
      tssPerDay[day] = (tssPerDay[day] || 0) + calcTSS(a);
    });

    // Iteruj przez każdy dzień od najstarszej aktywności do dziś
    const startDate = new Date(allActs[0]?.start_date_local?.slice(0, 10) || new Date());
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dayStr = d.toISOString().slice(0, 10);
      const tss = tssPerDay[dayStr] || 0;
      ctl = ctl * ctlDecay + tss / CTL_TC;
      atl = atl * atlDecay + tss / ATL_TC;
    }

    const tsb = ctl - atl;

    res.json({
      ctl: Math.round(ctl),
      atl: Math.round(atl),
      tsb: Math.round(tsb),
      activities_count: allActs.length,
      history_days: Math.round((today - startDate) / (24 * 3600 * 1000))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
