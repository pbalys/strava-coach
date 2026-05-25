const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Static trainer profile — cached on first request
const SYSTEM_PROFILE = `Jesteś trenerem kolarskim Piotra.
PROFIL: 43 lat, 82kg, HRmax 177, FTP 211W (2.55 W/kg)
STREFY HR: S1 <104, S2 105-138, S3 139-155, S4 156-172, S5 >173
PLAN: Wt=interwały 4-5×4min S4/S5 (>156 BPM), Czw=łatwa S2 max 138 BPM 60-90min, Sob=długa S2 2-3h max 138 BPM
WAŻNE: Roubaix+Wahoo ELEMNT BOLT+pasek piersiowy=dokładne HR. Cube+Garmin zegarek=HR zaniżone ~10 BPM. Bieganie+zegarek=HR zaniżone ~10 BPM.
CEL POLARYZACJI: S1+S2 ≥80%, S3 ≤5%, S4+S5 ~15-20%`;

async function callClaude(userPrompt, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: SYSTEM_PROFILE,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { activities, weekActs, singleActivity, zoneStats } = req.body;

  const ZONES = [
    { n:1, min:0,   max:104 },
    { n:2, min:105, max:138 },
    { n:3, min:139, max:155 },
    { n:4, min:156, max:172 },
    { n:5, min:173, max:999 },
  ];
  function zoneForHR(hr) { return ZONES.find(z => hr >= z.min && hr <= z.max); }

  if (singleActivity && activities && activities[0]) {
    const a = activities[0];
    let zoneStr = '';
    if (zoneStats) {
      zoneStr = Object.entries(zoneStats).map(([zone, {pct, mins}]) => `${zone}: ${pct}% (${mins}min)`).join(', ');
    }

    const userPrompt = `Aktywność do analizy:
- Nazwa: ${a.name}
- Typ: ${a.type}
- Data: ${a.start_date_local}
- Czas: ${Math.round(a.moving_time/60)} min
- Dystans: ${a.distance>0?(a.distance/1000).toFixed(1)+' km':'—'}
- Śr. HR: ${a.average_heartrate?Math.round(a.average_heartrate)+' BPM':'brak'}
- Max HR: ${a.max_heartrate?Math.round(a.max_heartrate)+' BPM':'brak'}
- Śr. moc: ${a.average_watts?Math.round(a.average_watts)+' W':'brak'}
- Moc norm.: ${a.weighted_average_watts?a.weighted_average_watts+' W':'brak'}
- Urządzenie: ${a.device_name||'nieznane'}
${zoneStr?`- Rozkład stref: ${zoneStr}`:''}

Napisz analizę PO POLSKU w max 3 zdaniach: oceń intensywność względem planu, co konkretnie zrobił dobrze i co poprawić. Bez wstępu, bez powtarzania danych.`;

    try {
      const text = await callClaude(userPrompt, 220);
      return res.json({ activity_analysis: text });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Weekly analysis
  const counts = {1:0,2:0,3:0,4:0,5:0}; let total = 0;
  activities.filter(a => a.type==='Ride'||a.type==='VirtualRide').forEach(a => {
    if (a.average_heartrate) { const z = zoneForHR(a.average_heartrate); if (z) { counts[z.n] += a.moving_time; total += a.moving_time; } }
  });
  const zonePcts = {};
  for (let i = 1; i <= 5; i++) zonePcts['S'+i] = total > 0 ? Math.round(counts[i]/total*100) : 0;

  const weekSummary = (weekActs||[]).map(a => ({
    name: a.name, type: a.type, date: a.start_date_local,
    duration_min: Math.round(a.moving_time/60),
    distance_km: a.distance > 0 ? (a.distance/1000).toFixed(1) : '0',
    avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
    device: a.device_name
  }));

  const recentSummary = activities.slice(0, 10).map(a => ({
    name: a.name, type: a.type, date: a.start_date_local,
    duration_min: Math.round(a.moving_time/60),
    distance_km: a.distance > 0 ? (a.distance/1000).toFixed(1) : '0',
    avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
    device: a.device_name
  }));

  const today = new Date().toLocaleDateString('pl-PL', {weekday:'long', day:'numeric', month:'long'});

  const userPrompt = `ROZKŁAD STREF HR (rower, ostatnie aktywności): ${JSON.stringify(zonePcts)}
TEN TYDZIEŃ: ${JSON.stringify(weekSummary)}
OSTATNIE 10 AKTYWNOŚCI: ${JSON.stringify(recentSummary)}
Dziś: ${today}

Odpowiedz TYLKO JSON bez markdown:
{"overall_score":<0-100>,"polarization_score":<0-100>,"plan_score":<0-100>,"recovery_score":<0-100>,"summary":"<2-3 zdania>","polarization_assessment":"<ocena>","plan_assessment":"<ocena>","recovery_assessment":"<ocena>","key_issues":["<problem>"],"recommendations":["<zal1>","<zal2>","<zal3>"],"next_workout":"<co robić>"}`;

  try {
    const text = await callClaude(userPrompt, 1000);
    const analysis = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(analysis);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
