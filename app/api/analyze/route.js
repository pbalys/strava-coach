export async function POST(request) {
  const { activities, weekActivities } = await request.json();

  const HR_MAX = 179;
  const FTP = 209;

  // Oblicz strefy HR
  const zoneCounts = {1:0,2:0,3:0,4:0,5:0};
  let totalTime = 0;
  activities.filter(a => a.type==='Ride'||a.type==='VirtualRide').forEach(a => {
    if (a.average_heartrate) {
      const p = a.average_heartrate / HR_MAX * 100;
      const z = p<60?1:p<70?2:p<80?3:p<90?4:5;
      zoneCounts[z] += a.moving_time;
      totalTime += a.moving_time;
    }
  });
  const zonePcts = {};
  for (let i=1;i<=5;i++) zonePcts['S'+i] = totalTime>0 ? Math.round(zoneCounts[i]/totalTime*100) : 0;

  const weekSummary = weekActivities.map(a => ({
    name: a.name, type: a.type,
    date: a.start_date_local,
    duration_min: Math.round(a.moving_time/60),
    distance_km: +(a.distance/1000).toFixed(1),
    avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
  }));

  const recentSummary = activities.slice(0,10).map(a => ({
    name: a.name, type: a.type,
    date: a.start_date_local,
    duration_min: Math.round(a.moving_time/60),
    distance_km: +(a.distance/1000).toFixed(1),
    avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
  }));

  const today = new Date().toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'});

  const prompt = `Jesteś trenerem kolarskim analizującym dane treningowe Piotra.

PROFIL PIOTRA:
- Wiek: 43 lata, waga: 82kg, HRmax: 179 BPM, FTP: ~209W (2.55 W/kg)
- Cel: trening spolaryzowany, jechać szybciej
- Historia: zerwany achilles XII 2023, powrót wiosna 2024, siłownia Pon/Pt

STREFY HR (od HRmax 179):
S1 <107 BPM | S2 107-125 BPM | S3 125-143 BPM | S4 143-161 BPM | S5 >161 BPM

PLAN TRENINGOWY:
- Wtorek: interwały 4-5×4min >160 BPM
- Czwartek: spokojna S2, MAX 138 BPM, 60-90min
- Sobota: długa jazda S2, 2-3h

ROZKŁAD STREF HR (ostatnie aktywności rowerowe): ${JSON.stringify(zonePcts)}
Cel polaryzacji: S1+S2 ≥80%, S3 ≤5%, S4+S5 ~15-20%

AKTYWNOŚCI Z TEGO TYGODNIA: ${JSON.stringify(weekSummary,null,2)}
OSTATNIE 10 AKTYWNOŚCI: ${JSON.stringify(recentSummary,null,2)}
Dzisiaj: ${today}

Odpowiedz TYLKO jako JSON (bez markdown):
{
  "overall_score": <0-100>,
  "polarization_score": <0-100>,
  "plan_score": <0-100>,
  "recovery_score": <0-100>,
  "summary": "<2-3 zdania podsumowania>",
  "polarization_assessment": "<ocena polaryzacji>",
  "plan_assessment": "<ocena realizacji planu>",
  "recovery_assessment": "<ocena regeneracji>",
  "key_issues": ["<problem 1>", "<problem 2>"],
  "recommendations": ["<zalecenie 1>", "<zalecenie 2>", "<zalecenie 3>"],
  "next_workout": "<co zrobić na następnym treningu>"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content?.filter(b=>b.type==='text').map(b=>b.text).join('') || '';
    const clean = text.replace(/```json|```/g,'').trim();
    const analysis = JSON.parse(clean);
    return Response.json(analysis);
  } catch(e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
