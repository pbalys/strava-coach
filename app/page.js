'use client';
import { useState, useEffect } from 'react';

const CLIENT_ID     = '56411';
const CLIENT_SECRET = 'd8d9277b2fc3f3dad0325fadd0648fddcb54474e';
const REFRESH_TOKEN = 'e0d5c0f51fe8e29afbc2ec64357acb073eb47aa0';
const HR_MAX        = 179;
const PLAN          = { 2:'intervals', 4:'easy', 6:'long' };

export default function Home() {
  const [status, setStatus]       = useState({ state:'loading', text:'Łączenie...' });
  const [athlete, setAthlete]     = useState(null);
  const [activities, setActivities] = useState([]);
  const [analysis, setAnalysis]   = useState(null);
  const [filter, setFilter]       = useState('all');
  const [page, setPage]           = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => { init(); }, []);

  async function stravaProxy(body) {
    const res = await fetch('/api/strava', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    return res.json();
  }

  async function init() {
    try {
      setStatus({state:'loading', text:'Odświeżanie tokenu...'});
      const td = await stravaProxy({ tokenBody:{ client_id:CLIENT_ID, client_secret:CLIENT_SECRET, refresh_token:REFRESH_TOKEN, grant_type:'refresh_token' }});
      const tok = td.access_token;

      setStatus({state:'loading', text:'Pobieranie aktywności...'});
      const [ath, acts] = await Promise.all([
        stravaProxy({ accessToken:tok, path:'/athlete' }),
        stravaProxy({ accessToken:tok, path:'/athlete/activities?per_page=30&page=1' })
      ]);

      setAthlete(ath);
      setActivities(acts || []);

      setStatus({state:'loading', text:'Analiza AI...'});
      const weekActs = getWeekActs(acts || []);
      const res = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ activities: acts||[], weekActivities: weekActs })});
      const ai = await res.json();
      if (!ai.error) setAnalysis(ai);

      setStatus({state:'ok', text:`Połączono ✓  |  ${new Date().toLocaleTimeString('pl-PL')}`});
    } catch(e) {
      setError(e.message);
      setStatus({state:'err', text:'Błąd połączenia'});
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const td = await stravaProxy({ tokenBody:{ client_id:CLIENT_ID, client_secret:CLIENT_SECRET, refresh_token:REFRESH_TOKEN, grant_type:'refresh_token' }});
      const more = await stravaProxy({ accessToken:td.access_token, path:`/athlete/activities?per_page=20&page=${page+1}` });
      if (more && more.length) { setActivities(a=>[...a,...more]); setPage(p=>p+1); }
    } finally { setLoadingMore(false); }
  }

  function getWeekActs(acts) {
    const now = new Date();
    const mon = new Date(now); mon.setDate(now.getDate()-((now.getDay()+6)%7)); mon.setHours(0,0,0,0);
    return acts.filter(a=>new Date(a.start_date_local)>=mon);
  }

  function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}h ${m}m`:`${m}min`;}
  function fmtD(m){return (m/1000).toFixed(1)+' km';}
  function fmtDate(s){return new Date(s).toLocaleDateString('pl-PL',{day:'numeric',month:'short'});}
  function ico(t){return {Ride:'🚴',VirtualRide:'🖥️',Run:'🏃',Walk:'🚶',Swim:'🏊',WeightTraining:'🏋️',Workout:'💪'}[t]||'🏅';}
  function zone(hr){ if(!hr)return null; const p=hr/HR_MAX*100; if(p<60)return{l:'S1',n:1};if(p<70)return{l:'S2',n:2};if(p<80)return{l:'S3',n:3};if(p<90)return{l:'S4',n:4};return{l:'S5',n:5}; }

  const zoneColors = {1:'#4da6ff',2:'#00d4aa',3:'#ffa500',4:'#ff6666',5:'#ff4444'};
  const zoneBg     = {1:'#1a3a4a',2:'#1a4a2a',3:'#4a3a1a',4:'#4a1a1a',5:'#5a0a0a'};

  function calcZonePcts(acts) {
    const c={1:0,2:0,3:0,4:0,5:0}; let t=0;
    acts.filter(a=>a.type==='Ride'||a.type==='VirtualRide').forEach(a=>{
      if(a.average_heartrate){const z=zone(a.average_heartrate);if(z){c[z.n]+=a.moving_time;t+=a.moving_time;}}
    });
    return {1:t?Math.round(c[1]/t*100):0,2:t?Math.round(c[2]/t*100):0,3:t?Math.round(c[3]/t*100):0,4:t?Math.round(c[4]/t*100):0,5:t?Math.round(c[5]/t*100):0};
  }

  function scoreColor(s){return s>=75?'#00d4aa':s>=50?'#f5c518':'#ff4444';}

  const weekActs = getWeekActs(activities);
  const zonePcts = calcZonePcts(activities);
  const rides = activities.filter(a=>a.type==='Ride'||a.type==='VirtualRide');
  const totalDist = rides.reduce((s,a)=>s+a.distance,0);
  const totalTime = rides.reduce((s,a)=>s+a.moving_time,0);
  const totalElev = rides.reduce((s,a)=>s+(a.total_elevation_gain||0),0);
  const pws = rides.filter(a=>a.average_watts).map(a=>a.average_watts);
  const avgPow = pws.length?Math.round(pws.reduce((a,b)=>a+b)/pws.length):null;

  const filtered = filter==='all'?activities:activities.filter(a=>filter==='ride'?(a.type==='Ride'||a.type==='VirtualRide'):a.type==='Run');

  // Week plan
  const actsByDay = {};
  weekActs.forEach(a=>{const d=new Date(a.start_date_local).getDay();if(!actsByDay[d])actsByDay[d]=[];actsByDay[d].push(a);});
  const dayNames=['Nd','Pn','Wt','Śr','Cz','Pt','Sb'];
  const todayDow = new Date().getDay();

  return (
    <div style={{background:'#0f0f0f',minHeight:'100vh',color:'#f0f0f0',fontFamily:"'Barlow',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{background:'#1a1a1a',borderBottom:'2px solid #FC4C02',padding:'14px 24px',display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:32,height:32,background:'#FC4C02',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Barlow Condensed'",fontWeight:900,fontSize:18,color:'#fff'}}>S</div>
        <h1 style={{fontFamily:"'Barlow Condensed'",fontSize:20,fontWeight:700,letterSpacing:1,textTransform:'uppercase'}}>Coach Dashboard</h1>
        <span style={{marginLeft:'auto',fontSize:12,color:'#777'}}>{athlete?.firstname} {athlete?.lastname}</span>
      </div>

      {/* Status */}
      <div style={{background:'#1a1a1a',borderBottom:'1px solid #2a2a2a',padding:'7px 24px',fontSize:11,color:'#777',display:'flex',alignItems:'center',gap:7}}>
        <div style={{width:7,height:7,borderRadius:'50%',background:status.state==='ok'?'#00d4aa':status.state==='err'?'#ff4444':'#f5c518'}}/>
        {status.text}
      </div>

      <div style={{padding:'20px 24px',maxWidth:1200,margin:'0 auto'}}>
        {error && <div style={{background:'#2a1010',border:'1px solid #5a2020',borderRadius:8,padding:14,color:'#f88',fontSize:12,marginBottom:16}}>❌ {error}</div>}

        {/* AI Scores */}
        {analysis && (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:20}}>
              {[
                {label:'Ocena tygodnia',val:analysis.overall_score},
                {label:'Polaryzacja',val:analysis.polarization_score},
                {label:'Plan Wt/Czw/Sob',val:analysis.plan_score},
                {label:'Regeneracja',val:analysis.recovery_score},
              ].map(({label,val})=>(
                <div key={label} style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:10,padding:14,textAlign:'center',borderTop:`3px solid ${scoreColor(val)}`}}>
                  <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'1.5px',color:'#777',marginBottom:8,fontFamily:"'Barlow Condensed'",fontWeight:600}}>{label}</div>
                  <div style={{fontFamily:"'Barlow Condensed'",fontSize:36,fontWeight:900,color:scoreColor(val),lineHeight:1}}>{val}</div>
                  <div style={{fontSize:10,color:'#777',marginTop:4}}>/ 100</div>
                </div>
              ))}
            </div>

            {/* Coach Panel */}
            <div style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:12,marginBottom:20,overflow:'hidden'}}>
              <div style={{background:'#1a1500',borderBottom:'1px solid #3a2a00',padding:'14px 20px',display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:22}}>🧠</span>
                <span style={{fontFamily:"'Barlow Condensed'",fontSize:16,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'#f5c518'}}>Analiza trenera AI</span>
                <span style={{fontSize:11,color:'#777',marginLeft:'auto'}}>Aktualizacja przy każdym otwarciu</span>
              </div>
              <div style={{padding:20,fontSize:14,lineHeight:1.9,whiteSpace:'pre-wrap'}}>
                {[
                  ['📋 Podsumowanie', analysis.summary],
                  ['🎯 Polaryzacja treningu', analysis.polarization_assessment],
                  ['📅 Realizacja planu', analysis.plan_assessment],
                  ['😴 Regeneracja', analysis.recovery_assessment],
                  analysis.key_issues?.length ? ['⚠️ Problemy', analysis.key_issues.map(i=>`• ${i}`).join('\n')] : null,
                  ['✅ Zalecenia', analysis.recommendations.map((r,i)=>`${i+1}. ${r}`).join('\n')],
                  ['🚴 Następny trening', analysis.next_workout],
                ].filter(Boolean).map(([title,content])=>(
                  <div key={title} style={{marginBottom:16}}>
                    <div style={{color:'#f5c518',fontWeight:600,marginBottom:4}}>{title}</div>
                    <div style={{color:'#ccc'}}>{content}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Stats */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:20}}>
          {[
            {label:'Dystans',val:`${(totalDist/1000).toFixed(0)}`,unit:'km'},
            {label:'Czas w siodle',val:`${Math.floor(totalTime/3600)}`,unit:'h'},
            {label:'Przewyższenie',val:`${Math.round(totalElev)}`,unit:'m'},
            {label:'Śr. moc',val:avgPow||'—',unit:avgPow?'W':''},
          ].map(({label,val,unit})=>(
            <div key={label} style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:10,padding:14,borderTop:'3px solid #FC4C02'}}>
              <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'1.5px',color:'#777',marginBottom:6,fontFamily:"'Barlow Condensed'",fontWeight:600}}>{label}</div>
              <div style={{fontFamily:"'Barlow Condensed'",fontSize:28,fontWeight:900}}>{val}<span style={{fontSize:12,color:'#777',marginLeft:3}}>{unit}</span></div>
            </div>
          ))}
        </div>

        {/* Zone chart + Week plan */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
          <div style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:10,padding:16}}>
            <div style={{fontFamily:"'Barlow Condensed'",fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:2,color:'#777',marginBottom:14,paddingBottom:8,borderBottom:'1px solid #2a2a2a'}}>Rozkład stref HR (rower)</div>
            {[1,2,3,4,5].map(n=>(
              <div key={n} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                <div style={{fontFamily:"'Barlow Condensed'",fontSize:12,fontWeight:700,width:24,color:zoneColors[n]}}>S{n}</div>
                <div style={{flex:1,background:'#2a2a2a',borderRadius:4,height:10,overflow:'hidden'}}>
                  <div style={{width:`${zonePcts[n]}%`,height:'100%',background:zoneColors[n],borderRadius:4,transition:'width .6s'}}/>
                </div>
                <div style={{fontSize:11,color:'#777',width:32,textAlign:'right'}}>{zonePcts[n]}%</div>
              </div>
            ))}
            <div style={{marginTop:10,fontSize:10,color:'#777'}}>Cel: S1+S2 ≥80% · S3 ≤5% · S4+S5 ~15-20%</div>
          </div>

          <div style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:10,padding:16}}>
            <div style={{fontFamily:"'Barlow Condensed'",fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:2,color:'#777',marginBottom:14,paddingBottom:8,borderBottom:'1px solid #2a2a2a'}}>Plan tygodnia</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:5}}>
              {dayNames.map((name,dow)=>{
                const isPast = dow < todayDow || dow === todayDow;
                const isPlanned = PLAN[dow];
                const hasRide = actsByDay[dow]?.some(a=>a.type==='Ride'||a.type==='VirtualRide');
                const hasAct = actsByDay[dow]?.length > 0;
                let bg='#1a1a1a', border='#2a2a2a', dayIco='—', label='';
                if(isPlanned){
                  if(hasRide){bg='#0a1f0a';border='#00d4aa';dayIco=ico('Ride');label=isPlanned==='intervals'?'Interw. ✓':isPlanned==='easy'?'S2 ✓':'Długa ✓';}
                  else if(isPast){bg='#1f0000';border='#ff4444';dayIco='❌';label=isPlanned==='intervals'?'Interwały?':isPlanned==='easy'?'S2?':'Długa?';}
                  else{bg='#1f0a00';border='#FC4C02';dayIco='📋';label=isPlanned==='intervals'?'Interwały':isPlanned==='easy'?'S2':'Długa';}
                } else if(hasAct){bg='#0a1f0a';border='#00d4aa';dayIco=ico(actsByDay[dow][0].type);label='Aktywność';}
                return(
                  <div key={dow} style={{background:bg,border:`1px solid ${border}`,borderRadius:6,padding:'8px 3px',textAlign:'center'}}>
                    <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:1,color:'#777',marginBottom:5,fontFamily:"'Barlow Condensed'"}}>{name}</div>
                    <div style={{fontSize:16,marginBottom:3}}>{dayIco}</div>
                    <div style={{fontSize:9,color:'#777'}}>{label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{marginTop:10,fontSize:10,color:'#777'}}>🟠 Zaplanowany · 🟢 Wykonany · 🔴 Pominięty</div>
          </div>
        </div>

        {/* Activities */}
        <div style={{fontFamily:"'Barlow Condensed'",fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:2,color:'#777',marginBottom:10,paddingBottom:7,borderBottom:'1px solid #2a2a2a'}}>Ostatnie aktywności</div>
        <div style={{display:'flex',gap:7,marginBottom:12,flexWrap:'wrap'}}>
          {[['all','Wszystkie'],['ride','🚴 Rower'],['run','🏃 Bieg']].map(([f,label])=>(
            <button key={f} onClick={()=>setFilter(f)} style={{padding:'5px 13px',background:filter===f?'#FC4C02':'#1e1e1e',border:`1px solid ${filter===f?'#FC4C02':'#2a2a2a'}`,borderRadius:20,color:filter===f?'#fff':'#777',fontSize:11,cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>
              {label}
            </button>
          ))}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:7}}>
          {filtered.map(a=>{
            const z=zone(a.average_heartrate);
            return(
              <div key={a.id} onClick={()=>window.open(`https://www.strava.com/activities/${a.id}`,'_blank')} style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:8,padding:14,display:'grid',gridTemplateColumns:'40px 1fr auto',gap:14,alignItems:'center',cursor:'pointer',transition:'border-color .2s'}} onMouseEnter={e=>e.currentTarget.style.borderColor='#FC4C02'} onMouseLeave={e=>e.currentTarget.style.borderColor='#2a2a2a'}>
                <div style={{width:40,height:40,background:'#111',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:19}}>{ico(a.type)}</div>
                <div>
                  <div style={{fontSize:14,fontWeight:500,marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name}</div>
                  <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:11,color:'#777'}}>
                    <span>📅 {fmtDate(a.start_date_local)}</span>
                    <span>⏱ {fmt(a.moving_time)}</span>
                    {a.average_heartrate&&<span>❤️ {Math.round(a.average_heartrate)} BPM</span>}
                    {a.max_heartrate&&<span>🔴 max {Math.round(a.max_heartrate)}</span>}
                    {a.average_watts&&<span>⚡ {Math.round(a.average_watts)}W</span>}
                    {a.total_elevation_gain?<span>⛰ {Math.round(a.total_elevation_gain)}m</span>:null}
                    {z&&<span><span style={{background:zoneBg[z.n],color:zoneColors[z.n],padding:'2px 7px',borderRadius:3,fontSize:9,fontWeight:600,textTransform:'uppercase',letterSpacing:1,fontFamily:"'Barlow Condensed'"}}>{z.l}</span></span>}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3,minWidth:75}}>
                  <div style={{fontFamily:"'Barlow Condensed'",fontSize:22,fontWeight:700,color:'#FC4C02'}}>{a.distance>0?fmtD(a.distance):fmt(a.moving_time)}</div>
                  <div style={{fontSize:9,color:'#777',textTransform:'uppercase'}}>{a.distance>0?'dystans':'czas'}</div>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={loadMore} disabled={loadingMore} style={{marginTop:14,width:'100%',padding:11,background:'transparent',border:'1px solid #2a2a2a',borderRadius:8,color:'#777',fontFamily:"'Barlow Condensed'",fontSize:13,letterSpacing:1,textTransform:'uppercase',cursor:loadingMore?'not-allowed':'pointer',opacity:loadingMore?.5:1}}>
          {loadingMore?'Ładowanie...':'Załaduj więcej'}
        </button>
      </div>
    </div>
  );
}
