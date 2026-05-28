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
  const { activities, weekActs, singleActivity, zoneStats, weekZonePcts, trainingLoad } = req.body;

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

    const DAY_PL_SA = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
    const dayName = DAY_PL_SA[new Date(a.start_date_local).getDay()];
    const durationMin = Math.round(a.moving_time/60);
    const maxHr = a.max_heartrate ? Math.round(a.max_heartrate) : null;
    const isInterval = durationMin < 90 && maxHr && maxHr > 156;

    const userPrompt = `Aktywność do analizy:
- Nazwa: ${a.name}
- Typ: ${a.type}
- Data: ${a.start_date_local} (${dayName})
- Czas: ${durationMin} min
- Dystans: ${a.distance>0?(a.distance/1000).toFixed(1)+' km':'—'}
${isInterval ? '' : `- Śr. HR: ${a.average_heartrate?Math.round(a.average_heartrate)+' BPM':'brak'}\n`}- Max HR: ${maxHr?maxHr+' BPM':'brak'}
- Moc: ${a.type==='VirtualRide'&&a.average_watts?Math.round(a.weighted_average_watts||a.average_watts)+' W (trenazer)':'brak miernika'}
- Urządzenie: ${a.device_name||'nieznane'}
${zoneStr?`- Rozkład stref (dane sekundowe): ${zoneStr}`:''}
${isInterval?'- TYP: TRENING INTERWAŁOWY — oceniaj TYLKO po max_hr i % czasu w S4+S5, NIE po avg_hr':''}

Napisz analizę PO POLSKU w max 3 zdaniach: oceń intensywność względem planu, co konkretnie zrobił dobrze i co poprawić. Bez wstępu, bez powtarzania danych.
WAŻNE: Przy treningu interwałowym (krótki czas <90min, max_hr >156) niska średnia HR (120-140) jest NORMALNA i OCZEKIWANA - to efekt przerw regeneracyjnych. Oceniaj interwały TYLKO po: max_hr, % czasu w S4+S5, i strukturze treningu.`;

    try {
      const text = await callClaude(userPrompt, 400);
      return res.json({ activity_analysis: text });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Weekly analysis — NOTE: no zone distribution from avg_hr (misleading — avg_hr 142 = all time in S3,
  // hiding real S4/S5 spikes visible only in second-by-second stream data). Use avg_hr + max_hr per activity.
  const DAY_PL = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
  const actSummary = (acts, n) => acts.slice(0, n).map(a => {
    const durMin = Math.round(a.moving_time/60);
    const maxHr = a.max_heartrate ? Math.round(a.max_heartrate) : null;
    const isInterval = durMin < 90 && maxHr && maxHr > 156;
    return {
      name: a.name, type: a.type,
      date: a.start_date_local,
      day: DAY_PL[new Date(a.start_date_local).getDay()],
      duration_min: durMin,
      distance_km: a.distance > 0 ? (a.distance/1000).toFixed(1) : '0',
      // avg_hr excluded for interval sessions — misleadingly low due to recovery intervals
      ...(isInterval ? {avg_hr_NOTE:'interval_session_avg_hr_irrelevant'} : {avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null}),
      max_hr: maxHr,
      is_interval: isInterval || undefined,
      avg_watts: (a.type==='VirtualRide' && a.average_watts) ? Math.round(a.average_watts) : null,
      device: a.device_name
    };
  });

  const today = new Date().toLocaleDateString('pl-PL', {weekday:'long', day:'numeric', month:'long'});

  const zonesLine = weekZonePcts
    ? `ROZKŁAD STREF HR ostatnie 7 dni (dane sekundowe, dokładne — używaj do oceny polaryzacji): ${JSON.stringify(weekZonePcts)}`
    : `UWAGA: brak dokładnych danych stref. Używaj max_hr do oceny intensywności — avg_hr to tylko średnia i jest NIEUŻYTECZNA dla oceny polaryzacji przy treningach interwałowych.`;

  const loadLine = trainingLoad
    ? `OBCIĄŻENIE TRENINGOWE: CTL(fitness)=${trainingLoad.ctl}, ATL(zmęczenie)=${trainingLoad.atl}, TSB(forma)=${trainingLoad.tsb>0?'+':''}${trainingLoad.tsb}. ${trainingLoad.tsb>10?'Piotr jest świeży — dobry moment na mocny trening.':trainingLoad.tsb>-10?'Forma neutralna.':trainingLoad.tsb>-25?'Zmęczony — unikaj kolejnych mocnych sesji bez regeneracji.':'MOCNO PRZECIĄŻONY — priorytet to regeneracja przed kolejnym interwałowym.'}`
    : '';

  const userPrompt = `${loadLine ? loadLine+'\n' : ''}${zonesLine}
ZASADY OCENY: Przy treningach interwałowych (is_interval=true) avg_hr jest nieistotna — niska średnia HR (120-140) jest NORMALNA bo przerwy regeneracyjne zaniżają średnią. Polaryzację oceniaj WYŁĄCZNIE na podstawie danych sekundowych stref (powyżej), NIE na podstawie avg_hr z poszczególnych aktywności.
TEN TYDZIEŃ: ${JSON.stringify(actSummary(weekActs||[], 20))}
OSTATNIE 10 AKTYWNOŚCI: ${JSON.stringify(actSummary(activities, 10))}
Dziś: ${today}

Odpowiedz TYLKO JSON bez markdown:
{"overall_score":<0-100>,"polarization_score":<0-100>,"plan_score":<0-100>,"recovery_score":<0-100>,"summary":"<2-3 zdania>","polarization_assessment":"<ocena>","plan_assessment":"<ocena>","recovery_assessment":"<ocena>","key_issues":["<problem>"],"recommendations":["<zal1>","<zal2>","<zal3>"],"next_workout":"<co robić>"}`;

  try {
    const text = await callClaude(userPrompt, 2000);
    const analysis = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(analysis);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
