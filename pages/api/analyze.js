const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { activities, weekActs } = req.body;
  const HR_MAX = 179;

  function zone(hr) {
    if (!hr) return null;
    const p = hr / HR_MAX * 100;
    if (p < 60) return 1;
    if (p < 70) return 2;
    if (p < 80) return 3;
    if (p < 90) return 4;
    return 5;
  }

  const counts = {1:0,2:0,3:0,4:0,5:0};
  let total = 0;
  activities.filter(a=>a.type==='Ride'||a.type==='VirtualRide').forEach(a=>{
    if (a.average_heartrate) {
      const z = zone(a.average_heartrate);
      if (z) { counts[z] += a.moving_time; total += a.moving_time; }
    }
  });

  const zonePcts = {};
  for (let i=1;i<=5;i++) {
    zonePcts['S'+i] = total > 0 ? Math.round(counts[i]/total*100) : 0;
  }

  const weekSummary = (weekActs||[]).map(a=>({
    name:a.name, type:a.type, date:a.start_date_local,
    duration_min:Math.round(a.moving_time/60),
    distance_km:(a.distance/1000).toFixed(1),
    avg_hr:a.average_heartrate?Math.round(a.average_heartrate):null,
    max_hr:a.max_heartrate?Math.round(a.max_heartrate):null,
    avg_watts:a.average_watts?Math.round(a.average_watts):null,
  }));

  const recentSummary = activities.slice(0,10).map(a=>({
    name:a.name, type:a.type, date:a.start_date_local,
    duration_min:Math.round(a.moving_time/60),
    distance_km:(a.distance/1000).toFixed(1),
    avg_hr:a.average_heartrate?Math.round(a.average_heartrate):null,
    avg_watts:a.average_watts?Math.round(a.average_watts):null,
  }));

  const today = new Date().toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'});

  const prompt = `Jesteś trenerem kolarskim analizującym dane treningowe Piotra.

PROFIL PIOTRA:
- Wiek: 43 lata, waga: 82kg, HRmax: 179 BPM, FTP: ~209W (2.55 W/kg)
- Cel: trening spolaryzowany, jechać szybciej
- Historia: zerwany achilles XII 2023, powrót wiosna 2024, siłownia Pon/Pt
- STREFY HR: S1 <107, S2 107-125, S3 125-143, S4 143-161, S5 >161 BPM

PLAN (Cze-Sie 2025):
- Wtorek: interwały 4-5×4min >160 BPM
- Czwartek: łatwa S2, MAX 138 BPM, 60-90min
- Sobota: długa S2, 2-3h

ROZKŁAD STREF HR (ostatnie aktywności rowerowe): ${JSON.stringify(zonePcts)}
AKTYWNOŚCI Z TEGO TYGODNIA: ${JSON.stringify(weekSummary)}
OSTATNIE 10 AKTYWNOŚCI: ${JSON.stringify(recentSummary)}
Dzisiaj: ${today}

Odpowiedz TYLKO w JSON (bez markdown):
{"overall_score":<0-100>,"polarization_score":<0-100>,"plan_score":<0-100>,"recovery_score":<0-100>,"summary":"<2-3 zdania>","polarization_assessment":"<ocena>","plan_assessment":"<ocena>","recovery_assessment":"<ocena>","key_issues":["<problem>"],"recommendations":["<zalecenie1>","<zalecenie2>","<zalecenie3>"],"next_workout":"<co robić następnie>"}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{role:'user', content: prompt}]
      })
    });
    const data = await r.json();
    const text = data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
    const analysis = JSON.parse(text.replace(/```json|```/g,'').trim());
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(analysis);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
}
