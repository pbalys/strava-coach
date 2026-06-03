const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROFILE = `Jesteś trenerem kolarskim Piotra. Styl: konkretny, bezpośredni, po polsku, z liczbami. Nie pochwalaj bez powodu.

PROFIL: Piotr, 43 lata, 82kg, HRmax 177 BPM, FTP 211W (2.55 W/kg)
STREFY HR (Strava/Wahoo): S1 <104, S2 105-138, S3 139-155, S4 156-172, S5 >173

SPRZĘT I WIARYGODNOŚĆ DANYCH:
- Specialized Roubaix + Wahoo ELEMNT BOLT + pasek piersiowy = dane HR w 100% wiarygodne
- Cube Attain + Garmin Instinct 2 zegarek = HR zaniżone o ~10 BPM (dojazdówki do pracy)
- Bieganie + Garmin Instinct 2 zegarek = HR zaniżone o ~10 BPM
- device_name "Wahoo ELEMNT BOLT" = Roubaix, dokładne dane z paska
- device_name "Garmin Instinct 2" = Cube lub bieganie, dane HR zaniżone
- device_name null/undefined/brak = NIE ZAKŁADAJ urządzenia ani dokładności — napisz "urządzenie nieznane", nie koryguj HR o 10 BPM

PLAN TRENINGOWY:
- Wtorek: interwały 4-5×4min, cel >156 BPM (S4/S5), przerwy <123 BPM (S1/S2), Roubaix z paskiem
- Czwartek: łatwa jazda S2, MAX 138 BPM, 60-90 min, Roubaix
- Sobota: długa jazda S2, 2-3h, MAX 138 BPM, Roubaix
CEL: trening spolaryzowany — S1+S2 ≥80% czasu, S3 ≤5%, S4+S5 ~15-20%

ZASADY OCENY INTERWAŁÓW:
- NIE oceniaj po avg_hr — przy interwałach średnia zawsze niska przez przerwy
- Oceniaj po: max_hr, % czasu w S4+S5, strukturze (widoczne piki)
- max_hr >156 + wyraźna struktura = dobry trening interwałowy
- S3 przy interwałach to naturalne przejście między strefami, nie błąd

HISTORIA I POSTĘPY:
- Zerwanie Achillesa: grudzień 2023, powrót do treningu: wiosna 2024
- Plan spolaryzowany wystartował: 25 maja 2026 (tydzień 1)
- Przed kontuzją FTP: 221W, obecne FTP: 211W (cel: wrócić do 221W+)
- Zawsze podaj "Tydzień X planu" licząc od 25 maja 2026

MIERNIKI POSTĘPÓW (śledź i porównuj tydzień do tygodnia):
1. Polaryzacja: % czasu S1+S2 na Roubaix (cel ≥80%)
2. Interwały: max HR i liczba powtórzeń >156 BPM (cel 4-5×4min)
3. Długa jazda: avg HR na Roubaix w sobotę (cel <138 BPM przy rosnącym dystansie)
4. Tętno spoczynkowe (trend — niższe = lepsza forma)`;

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
  const { activities, weekActs, singleActivity, zoneStats, weekZonePcts, trainingLoad, restingHR } = req.body;

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
WAŻNE: Przy treningu interwałowym (krótki czas <90min, max_hr >156) niska średnia HR (120-140) jest NORMALNA i OCZEKIWANA - to efekt przerw regeneracyjnych. Oceniaj interwały TYLKO po: max_hr, % czasu w S4+S5, i strukturze treningu.
WAŻNE: Jeśli wykres HR pokazuje wyraźne powtarzające się piki powyżej 156 BPM z przerwami powracającymi do S2 - to są interwały, niezależnie od dnia tygodnia. Nie krytykuj za dzień tygodnia jeśli struktura treningu jest prawidłowa. Piotr czasem przesuwa wtorek na środę lub czwartek z powodów życiowych.`;

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
      ...(a.interval_peaks ? {interval_peaks_min: a.interval_peaks, interval_count: a.interval_count} : {}),
      avg_watts: (a.type==='VirtualRide' && a.average_watts) ? Math.round(a.average_watts) : null,
      device: a.device_name
    };
  });

  const today = new Date().toLocaleDateString('pl-PL', {weekday:'long', day:'numeric', month:'long'});

  const zonesLine = weekZonePcts
    ? `ROZKŁAD STREF HR ostatnie 7 dni (dane sekundowe, dokładne — używaj do oceny polaryzacji): ${JSON.stringify(weekZonePcts)}`
    : `UWAGA: brak dokładnych danych stref. Używaj max_hr do oceny intensywności — avg_hr jest NIEUŻYTECZNA dla polaryzacji przy interwałach.`;

  const loadLine = trainingLoad
    ? `OBCIĄŻENIE TRENINGOWE: CTL(fitness)=${trainingLoad.ctl}, ATL(zmęczenie)=${trainingLoad.atl}, TSB(forma)=${trainingLoad.tsb>0?'+':''}${trainingLoad.tsb}. ${trainingLoad.tsb>10?'Świeży — dobry moment na mocny trening.':trainingLoad.tsb>-10?'Forma neutralna.':trainingLoad.tsb>-25?'Zmęczony — zaplanuj regenerację.':'MOCNO PRZECIĄŻONY — priorytet: regeneracja.'}`
    : '';

  const weekNum = Math.max(1, Math.ceil((new Date() - new Date('2026-05-25')) / (7*24*3600*1000)));

  const restingHRLine = restingHR && restingHR.some(d => d.resting_hr)
    ? `TĘTNO SPOCZYNKOWE (Garmin, ostatnie 7 dni): ${restingHR.filter(d=>d.resting_hr).map(d=>`${d.date}: ${d.resting_hr} BPM`).join(', ')} — trend: ${restingHR.filter(d=>d.resting_hr).length > 1 ? (restingHR.filter(d=>d.resting_hr).at(-1).resting_hr <= restingHR.filter(d=>d.resting_hr)[0].resting_hr ? 'malejący ✓ (dobry sygnał)' : 'rosnący ⚠ (zmęczenie)') : 'za mało danych'}`
    : '';

  const userPrompt = `${loadLine ? loadLine+'\n' : ''}${restingHRLine ? restingHRLine+'\n' : ''}${zonesLine}
ZASADY OCENY: Przy treningach interwałowych (is_interval=true) avg_hr jest nieistotna. Polaryzację oceniaj WYŁĄCZNIE z danych sekundowych stref.
WAŻNE: Jeśli aktywność ma wyraźne piki HR >156 BPM z przerwami do S2 — to interwały, niezależnie od dnia tygodnia. Nie krytykuj za dzień tygodnia jeśli struktura jest prawidłowa. Piotr czasem przesuwa wtorek na środę lub czwartek z powodów życiowych.
TEN TYDZIEŃ (Tydzień ${weekNum} planu): ${JSON.stringify(actSummary(weekActs||[], 20))}
OSTATNIE 10 AKTYWNOŚCI (kontekst): ${JSON.stringify(actSummary(activities, 10))}
Dziś: ${today}

Odpowiedz TYLKO JSON bez markdown:
{"overall_score":<0-100>,"polarization_score":<0-100>,"plan_score":<0-100>,"recovery_score":<0-100>,"summary":"<2-3 zdania z numerem tygodnia planu>","polarization_assessment":"<ocena>","plan_assessment":"<ocena>","recovery_assessment":"<ocena z TSB>","key_issues":["<problem>"],"recommendations":["<zal1>","<zal2>","<zal3>"],"next_workout":"<co robić>","progress":"<sekcja Postępy: porównaj mierniki z poprzednim tygodniem — polaryzacja S1+S2%, max HR na interwałach, avg HR na długiej jeździe>"}`;

  try {
    const text = await callClaude(userPrompt, 2000);
    const analysis = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(analysis);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
