import { Redis } from '@upstash/redis';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const SYSTEM_PROFILE = `Jesteś trenerem kolarskim Piotra. Styl: konkretny, bezpośredni, po polsku, z liczbami. Nie pochwalaj bez powodu.

PROFIL: Piotr, 43 lata, 82kg, HRmax 177 BPM, FTP 211W (2.55 W/kg)
BRAK MIERNIKA MOCY — nigdy nie wspominaj o watach, avg_watts, braku danych mocy. Oceniaj wyłącznie na podstawie HR i stref.
STREFY HR (Strava/Wahoo): S1 <104, S2 105-138, S3 139-155, S4 156-172, S5 >173

SPRZĘT I WIARYGODNOŚĆ DANYCH:
- Specialized Roubaix + Wahoo ELEMNT BOLT + pasek piersiowy = dane HR w 100% wiarygodne
- Cube Attain + Garmin Instinct 2 zegarek = HR zaniżone o ~10 BPM (dojazdówki do pracy)
- Bieganie + Garmin Instinct 2 zegarek = HR zaniżone o ~10 BPM
- device_name "Wahoo ELEMNT BOLT" = Roubaix, dokładne dane z paska
- device_name "Garmin Instinct 2" = Cube lub bieganie, dane HR zaniżone
- device_name null/undefined/brak = NIE ZAKŁADAJ urządzenia ani dokładności — napisz "urządzenie nieznane", nie koryguj HR o 10 BPM

PLAN TRENINGOWY:
- Wtorek (lub środa/czwartek — dzień może się przesunąć): interwały 4-5×4min, cel >156 BPM (S4/S5), przerwy <123 BPM (S1/S2), Roubaix z paskiem. NIGDY nie krytykuj za dzień tygodnia — liczy się czy interwały były zrobione w danym tygodniu.
- Czwartek: łatwa jazda S2, MAX 138 BPM, 60-90 min, Roubaix. Jazda >90 min to WIĘCEJ niż plan — nie krytykuj za dystans ani czas jeśli czas ≥60 min i HR w S2. NIE porównuj dystansu do czasu planu.
- Sobota: długa jazda S2, 2-3h, MAX 138 BPM, Roubaix. Jazda >3h to WIĘCEJ niż plan — nie krytykuj.
CEL: trening spolaryzowany — S1+S2 ≥80% czasu, S3 ≤5%, S4+S5 ~5-8% całości tygodnia (przy 3-4h S2 + 20min interwałów więcej matematycznie niemożliwe) — ale interwały muszą być jakościowe: max HR >156, wyraźna struktura pików

ZASADY OCENY INTERWAŁÓW:
- NIE oceniaj po avg_hr — przy interwałach średnia zawsze niska przez przerwy
- Oceniaj po: max_hr, % czasu w S4+S5, strukturze (widoczne piki)
- max_hr >156 + wyraźna struktura = dobry trening interwałowy
- S3 przy interwałach to naturalne przejście między strefami, nie błąd

ZASADY OCENY DŁUGIEJ JAZDY S2 (sobota/czwartek):
- Wahoo ELEMNT BOLT + avg_hr < 138 BPM + dystans > 50 km = WZOROWA realizacja planu, napisz to wprost
- Wahoo ELEMNT BOLT + avg_hr < 138 BPM + czas > 90 min = WZOROWA realizacja planu
- NIE używaj określeń "przyzwoity", "niezły", "w porządku" — to jest dokładnie to czego plan wymaga
- avg_hr 120-135 BPM na Roubaix z paskiem to idealne tempo S2, nie za wolno — to cel

ZASADY OCENY DOJAZDÓWEK I TSB:
- Garmin Instinct 2 + dystans < 15 km + avg_hr < 110 BPM = DOJAZDÓWKA do pracy — ignoruj przy ocenie zmęczenia i obciążenia treningowego, nie traktuj jako dodatkowy trening
- TSB spadający (ATL maleje) to regeneracja w toku — NIE alarmuj, opisz pozytywnie
PROGI TSB (bezwzględne — nie modyfikuj):
- TSB > -15: forma optymalna, trenuj normalnie
- TSB -15 do -25: zmęczony, trenuj ostrożnie bez dodatkowej intensywności — S2 OK
- TSB -25 do -35: wyraźne zmęczenie, ogranicz intensywność — S2 nadal dozwolone, NIE zalecaj pełnego odpoczynku
- TSB < -35: dopiero wtedy zalecaj pełny odpoczynek
- NIGDY nie używaj słowa "przeciążony" gdy TSB > -30
- Przy TSB -26 pisz "zmęczony", NIE "wyraźne zmęczenie wymagające odpoczynku"
- Słowo "przetrenowanie" WYŁĄCZNIE gdy TSB < -35 przez 3+ dni z rzędu

HISTORIA I POSTĘPY:
- Zerwanie Achillesa: grudzień 2023, powrót do treningu: wiosna 2024
- Plan spolaryzowany wystartował: 25 maja 2026 (tydzień 1)
- Przed kontuzją FTP: 221W, obecne FTP: 211W (cel: wrócić do 221W+)
- Zawsze podaj "Tydzień X planu" licząc od 25 maja 2026

MIERNIKI POSTĘPÓW (śledź i porównuj tydzień do tygodnia):
1. Polaryzacja: % czasu S1+S2 na Roubaix (cel ≥80%)
2. Interwały: max HR i liczba powtórzeń >156 BPM (cel 4-5×4min)
3. Długa jazda: avg HR na Roubaix w sobotę (cel <138 BPM przy rosnącym dystansie)
NIE sugeruj zapisywania tętna spoczynkowego rano — Piotr tego nie robi i nie zamierza.`;

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
- Urządzenie: ${a.device_name||'nieznane'}
${zoneStr?`- Rozkład stref (dane sekundowe): ${zoneStr}`:''}
${isInterval?'- TYP: TRENING INTERWAŁOWY — oceniaj TYLKO po max_hr i % czasu w S4+S5, NIE po avg_hr':''}

Napisz analizę PO POLSKU w max 3 zdaniach: oceń intensywność względem planu, co konkretnie zrobił dobrze i co poprawić. Bez wstępu, bez powtarzania danych.
WAŻNE: Przy treningu interwałowym (krótki czas <90min, max_hr >156) niska średnia HR (120-140) jest NORMALNA i OCZEKIWANA - to efekt przerw regeneracyjnych. Oceniaj interwały TYLKO po: max_hr, % czasu w S4+S5, i strukturze treningu.
WAŻNE: Jeśli wykres HR pokazuje wyraźne powtarzające się piki powyżej 156 BPM z przerwami powracającymi do S2 - to są interwały, niezależnie od dnia tygodnia. Nie krytykuj za dzień tygodnia jeśli struktura treningu jest prawidłowa. Piotr czasem przesuwa wtorek na środę lub czwartek z powodów życiowych.
WAŻNE: Czas w S3 podczas przerw między interwałami NIE jest błędem - to naturalny efekt opadającego tętna po wysiłku. Szybkość opadania HR jest miarą wydolności aerobowej. Nie krytykuj S3 przy treningach interwałowych jeśli HR wyraźnie opada w kierunku S2. Krytykuj S3 tylko przy jazdach długich/regeneracyjnych gdzie HR powinno być stabilnie w S2.`;

    try {
      const text = await callClaude(userPrompt, 400);
      return res.json({ activity_analysis: text });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Weekly analysis — NOTE: no zone distribution from avg_hr (misleading — avg_hr 142 = all time in S3,
  // hiding real S4/S5 spikes visible only in second-by-second stream data). Use avg_hr + max_hr per activity.

  // Enrich activities with accurate zone data from KV cache (weekActs + last 10 for context)
  const kvZones = {};
  const redis = getRedis();
  if (redis) {
    const toEnrich = (activities || [])
      .filter((a, i, arr) => arr.findIndex(b => b.id === a.id) === i);
    if (toEnrich.length) {
      try {
        await Promise.all(toEnrich.map(async a => {
          const cached = await redis.get(`activity:${a.id}`);
          if (cached) kvZones[a.id] = cached;
        }));
      } catch(e) { /* KV unavailable, continue without cache */ }
    }
  }

  // Fetch previous week (7–14 days ago) Wahoo zone data from KV for comparison
  let prevWeekZonePcts = null;
  const PLAN_START = new Date('2026-05-25T00:00:00');
  const daysSincePlanStart = Math.floor((Date.now() - PLAN_START) / (24*3600*1000));
  const currentWeekNum = Math.floor(daysSincePlanStart / 7) + 1;
  const currentWeekStart = new Date(PLAN_START.getTime() + Math.floor(daysSincePlanStart / 7) * 7 * 24*3600*1000);
  const prevWeekStart = new Date(currentWeekStart.getTime() - 7*24*3600*1000);

  if (redis && activities && activities.length) {
    const prevActs = activities.filter(a => {
      const d = new Date(a.start_date_local);
      return d >= prevWeekStart && d < currentWeekStart;
    });
    if (prevActs.length) {
      try {
        const prevKv = {};
        await Promise.all(prevActs.map(async a => {
          const cached = await redis.get(`activity:${a.id}`);
          if (cached) prevKv[a.id] = cached;
        }));
        const counts = {1:0,2:0,3:0,4:0,5:0};
        let total = 0;
        Object.values(prevKv).forEach(d => {
          [1,2,3,4,5].forEach(n => { counts[n] += d.zones?.['S'+n]?.seconds || 0; });
          total += d.total_seconds || 0;
        });
        if (total > 0) {
          prevWeekZonePcts = {};
          [1,2,3,4,5].forEach(n => {
            prevWeekZonePcts['S'+n] = { pct: Math.round(counts[n]/total*100), mins: Math.round(counts[n]/60) };
          });
        }
      } catch(e) {}
    }
  }

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
      device: a.device_name,
      ...(kvZones[a.id] ? {
        zones_kv: kvZones[a.id].zones,
        interval_peaks_kv: kvZones[a.id].interval_peaks,
        interval_count_kv: kvZones[a.id].interval_count,
      } : {})
    };
  });

  const today = new Date().toLocaleDateString('pl-PL', {weekday:'long', day:'numeric', month:'long'});

  const zonesLine = weekZonePcts
    ? `ROZKŁAD STREF HR ostatnie 7 dni (dane sekundowe, dokładne — używaj do oceny polaryzacji): ${JSON.stringify(weekZonePcts)}`
    : `UWAGA: brak dokładnych danych stref. Używaj max_hr do oceny intensywności — avg_hr jest NIEUŻYTECZNA dla polaryzacji przy interwałach.`;

  const prevZonesLine = prevWeekZonePcts
    ? `ROZKŁAD STREF HR poprzedni tydzień 7–14 dni temu (dane sekundowe z KV cache, używaj do porównania tydzień-do-tygodnia): ${JSON.stringify(prevWeekZonePcts)}`
    : '';

  const tsbComment = !trainingLoad ? '' :
    trainingLoad.tsb > -15 ? 'Forma optymalna — dobry moment na mocny trening.' :
    trainingLoad.tsb > -25 ? 'Zmęczony — trenuj ostrożnie, bez dodatkowej intensywności.' :
    trainingLoad.tsb > -35 ? 'Wyraźne zmęczenie — ogranicz intensywność, ale trening S2 jest OK.' :
    'Duże zmęczenie — wskazany pełny odpoczynek lub bardzo lekka jazda.';
  const loadLine = trainingLoad
    ? `OBCIĄŻENIE TRENINGOWE: CTL(fitness)=${trainingLoad.ctl}, ATL(zmęczenie)=${trainingLoad.atl}, TSB(forma)=${trainingLoad.tsb>0?'+':''}${trainingLoad.tsb}. ${tsbComment}
ZASADY TSB: NIE używaj słowa "przeciążony" gdy TSB > -30. Przy TSB -26 pisz "zmęczony". Słowo "przetrenowanie" tylko gdy TSB < -35 przez 3+ dni z rzędu.`
    : '';

  const weekNum = currentWeekNum;

  const fmtDate = d => d.toISOString().slice(0,10);
  const currentWeekEnd = new Date(currentWeekStart.getTime() + 7*24*3600*1000);
  const weekRangeStr = `${fmtDate(currentWeekStart)} – ${fmtDate(new Date(currentWeekEnd.getTime()-1))}`;
  const prevWeekEnd = currentWeekStart;
  const prevWeekRangeStr = `${fmtDate(prevWeekStart)} – ${fmtDate(new Date(prevWeekEnd.getTime()-1))}`;

  const prevWeekActs = (activities || []).filter(a => {
    const d = new Date(a.start_date_local);
    return d >= prevWeekStart && d < currentWeekStart;
  });

  const prev2WeekStart = new Date(prevWeekStart.getTime() - 7*24*3600*1000);
  const prev2WeekRangeStr = `${fmtDate(prev2WeekStart)} – ${fmtDate(new Date(prevWeekStart.getTime()-1))}`;
  const prev2WeekActs = weekNum > 2 ? (activities || []).filter(a => {
    const d = new Date(a.start_date_local);
    return d >= prev2WeekStart && d < prevWeekStart;
  }) : [];

  // Count previous week sessions in code — don't rely on Claude to count
  function classifyWahooActs(acts) {
    const wahoo = acts.filter(a => a.device_name === 'Wahoo ELEMNT BOLT');
    const intervals = wahoo.filter(a => {
      const dur = Math.round(a.moving_time/60);
      const maxHr = a.max_heartrate ? Math.round(a.max_heartrate) : 0;
      return dur < 120 && maxHr > 156;
    });
    const s2rides = wahoo.filter(a => {
      const dur = Math.round(a.moving_time/60);
      const maxHr = a.max_heartrate ? Math.round(a.max_heartrate) : 0;
      const avgHr = a.average_heartrate ? Math.round(a.average_heartrate) : 999;
      return !(dur < 120 && maxHr > 156) && avgHr < 138 && dur >= 60;
    });
    const longS2 = s2rides.filter(a => Math.round(a.moving_time/60) > 90);
    const shortS2 = s2rides.filter(a => Math.round(a.moving_time/60) <= 90);
    return { intervals, longS2, shortS2 };
  }
  const prevWeekSessions = classifyWahooActs(prevWeekActs);
  const prevWeekSessionSummary = [
    prevWeekSessions.intervals.length > 0 ? `interwały ✓ (${prevWeekSessions.intervals.length}x, max HR ${Math.max(...prevWeekSessions.intervals.map(a => a.max_heartrate||0))} BPM)` : 'interwały ✗',
    prevWeekSessions.longS2.length > 0 ? `długa S2 ✓ (${prevWeekSessions.longS2.length}x)` : prevWeekSessions.shortS2.length > 0 ? `łatwa S2 ✓ (${prevWeekSessions.shortS2.length}x, brak długiej)` : 'S2 ✗',
  ].join(', ');
  const prevWeekScore = (prevWeekSessions.intervals.length > 0 ? 1 : 0) + (prevWeekSessions.shortS2.length > 0 ? 1 : 0) + (prevWeekSessions.longS2.length > 0 ? 1 : 0);
  const prevWeekScoreStr = `${Math.min(prevWeekScore, 3)}/3 sesji`;

  const restingHRLine = restingHR && restingHR.some(d => d.resting_hr)
    ? `TĘTNO SPOCZYNKOWE (Garmin, ostatnie 7 dni): ${restingHR.filter(d=>d.resting_hr).map(d=>`${d.date}: ${d.resting_hr} BPM`).join(', ')} — trend: ${restingHR.filter(d=>d.resting_hr).length > 1 ? (restingHR.filter(d=>d.resting_hr).at(-1).resting_hr <= restingHR.filter(d=>d.resting_hr)[0].resting_hr ? 'malejący ✓ (dobry sygnał)' : 'rosnący ⚠ (zmęczenie)') : 'za mało danych'}`
    : '';

  const userPrompt = `KONTEKST
Piotr, 43 lata, 82kg, HRmax 177, FTP 211W, cel: wróć do 221W+. Plan spolaryzowany od 25 maja 2026. Zerwanie Achillesa grudzień 2023, powrót wiosna 2024. Dziś: ${today}, Tydzień ${weekNum} planu.

SPRZĘT
- Wahoo ELEMNT BOLT = Specialized Roubaix + pasek piersiowy = dane HR wiarygodne w 100%
- Garmin Instinct 2 = Cube (dojazdówki do pracy) lub bieganie = HR zaniżone ~10 BPM, nie liczy się jako trening
- Dojazdówka = Garmin + dystans <15 km + avg HR <115 BPM: ignoruj przy ocenie planu i zmęczenia

STREFY HR: S1 <104, S2 105-138, S3 139-155, S4 156-172, S5 >173

PLAN TYGODNIOWY (oceniaj po typie sesji, NIE po dniu tygodnia — każdy dzień tygodnia jest OK)
- INTERWAŁY: jazda Wahoo, max HR >156, czas <2h
- ŁATWA S2: jazda Wahoo, avg HR <138, 60-120 min (jazda >90 min też się liczy jako łatwa S2 jeśli HR w normie)
- DŁUGA S2: jazda Wahoo, avg HR <138, >90 min
Uwaga: jedna jazda może pełnić rolę łatwej S2 LUB długiej S2 — nie wymagaj obu osobno jeśli są tylko 2 jazdy Wahoo w tygodniu.
Realizacja: policz ile różnych typów sesji było (interwały / S2 krótka / S2 długa). Jeśli TSB < -25: pominięte sesje nie są błędem.

OCENA INTERWAŁÓW
- Oceniaj po: liczbie pików >156 BPM i max HR. NIE oceniaj po avg HR.
- Jeśli zones_kv dostępne: użyj interval_count_kv jako liczby pików.
- S3 podczas opadania HR między interwałami = fizjologia, nie błąd.
- Przerwy <123 BPM = poprawna regeneracja.

POLARYZACJA (tylko jazdy Wahoo, dane sekundowe z zones_kv)
Cel: S1+S2 ≥ 80%, S3 ≤ 5%, S4+S5 ~5-8%
${zonesLine}
${prevZonesLine ? prevZonesLine : ''}
OBCIĄŻENIE: ${trainingLoad ? `CTL=${trainingLoad.ctl}, ATL=${trainingLoad.atl}, TSB=${trainingLoad.tsb>0?'+':''}${trainingLoad.tsb}. ${tsbComment}` : 'brak danych.'}
Progi TSB: >-15 optymalna | -15/-25 zmęczony | -25/-35 ogranicz intensywność S2 dozwolone | <-35 odpoczynek. Nie używaj "przeciążony" przy TSB >-30.
${restingHRLine ? restingHRLine+'\n' : ''}
REALIZACJA T${weekNum-1} (WYLICZONA W KODZIE — używaj tej liczby, nie licz sam):
${prevWeekScoreStr}: ${prevWeekSessionSummary}

DANE AKTYWNOŚCI (przypisuj do tygodnia wyłącznie na podstawie dat poniżej)
TYDZIEŃ ${weekNum} — BIEŻĄCY (${weekRangeStr}): ${JSON.stringify(actSummary(weekActs||[], 20))}
TYDZIEŃ ${weekNum-1} — POPRZEDNI (${prevWeekRangeStr}): ${JSON.stringify(actSummary(prevWeekActs, 20))}
${weekNum > 2 ? `TYDZIEŃ ${weekNum-2} (${prev2WeekRangeStr}): ${JSON.stringify(actSummary(prev2WeekActs, 20))}` : ''}

ZASADY
- Oceniaj wyłącznie minione dni. Nie krytykuj za brak sesji w dniu który jeszcze nie nastąpił.
- next_workout musi być spójny z recommendations — zero sprzeczności.
- Nie wspominaj o mocy ani watach.

Odpowiedz TYLKO JSON bez markdown:
{"overall_score":<0-100>,"polarization_score":<0-100>,"plan_score":<0-100>,"recovery_score":<0-100>,"summary":"<2-3 zdania z numerem tygodnia>","polarization_assessment":"<ocena>","plan_assessment":"<ocena>","recovery_assessment":"<ocena z TSB i CTL>","key_issues":["<konkretny problem z liczbami>"],"recommendations":["<zal1>","<zal2>","<zal3>"],"next_workout":"<co konkretnie robić>","progress":"<bullet points:\n• Realizacja T${weekNum-1}: ${prevWeekScoreStr} — ${prevWeekSessionSummary}\n• Polaryzacja S1+S2: X% → Y% — komentarz\n• Interwały: X BPM / X pików → Y BPM / Y pików — komentarz\n• Długa jazda: X BPM / X km → Y BPM / Y km — komentarz\n• Wniosek: jedno zdanie>"}`;

  try {
    const text = await callClaude(userPrompt, 2000);
    const analysis = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(analysis);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
