// freeflow-assistant.js — trial: privacy-first, Places via backend, TTS via backend

const $ = (s)=>document.querySelector(s);
const app = $('#app'), transcript = $('#transcript'), micBtn = $('#micBtn'),
      logoBtn = $('#logoBtn'), dot = $('#dot'), banner = $('#banner'),
      tileFood = $('#tileFood'), tileTaxi = $('#tileTaxi'), tileHotel = $('#tileHotel');

const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();

function showBanner(msg, type='info'){
  if(!banner) return;
  banner.textContent = msg || '';
  banner.classList.remove('hidden');
  banner.style.background =
    type==='err' ? 'rgba(255,72,72,.15)' : type==='warn' ? 'rgba(255,203,72,.15)' : 'rgba(72,179,255,.12)';
  banner.style.color = type==='err' ? '#ffd1d1' : type==='warn' ? '#ffe6a3' : '#dff1ff';
}
function hideBanner(){ banner?.classList.add('hidden'); if(banner) banner.textContent=''; }
function setGhost(t){ transcript?.classList.add('ghost'); if(transcript) transcript.textContent=t; }
function setText(t){ transcript?.classList.remove('ghost'); if(transcript) transcript.textContent=t; }
function setListening(on){ document.body.classList.toggle('listening', !!on); if(dot) dot.style.boxShadow = on?'0 0 18px #86e2ff':'0 0 0 #0000'; }

async function getGeo(timeoutMs=5000){
  if(!('geolocation' in navigator)) return null;
  const once = ()=>new Promise((res,rej)=>{
    navigator.geolocation.getCurrentPosition(
      pos=>res(pos.coords),
      err=>rej(err),
      { enableHighAccuracy:false, timeout:timeoutMs, maximumAge:25000 }
    );
  });
  try{
    const c = await once();
    return c; // {latitude,longitude}
  }catch(e){
    // nie spamujemy: cichy fallback na zapytanie tekstowe
    return null;
  }
}

// prosty extractor: rodzaj + ewentualne miasto
function extractQuery(text){
  const t=(text||'').trim();
  const re=/(pizzeria|pizza|restauracja|restauracje|sushi|kebab|hotel|nocleg|taxi)(?:.*?\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+))?/i;
  const m=t.match(re); if(!m) return null;
  const base=m[1].toLowerCase(); const city=m[2]?` w ${m[2]}`:'';
  const norm = /restaurac/.test(base)?'restauracje':/pizz/.test(base)?'pizzeria':/(hotel|nocleg)/.test(base)?'hotel':/taxi/.test(base)?'taxi':base;
  return (norm+city).trim();
}

async function callPlaces(params){
  const sp = new URLSearchParams();
  if(params.query)  sp.set('query', params.query);
  if(params.lat)    sp.set('lat', params.lat);
  if(params.lng)    sp.set('lng', params.lng);
  if(params.radius) sp.set('radius', params.radius);
  if(params.rankby) sp.set('rankby', params.rankby);
  if(params.keyword)sp.set('keyword', params.keyword);
  if(params.n)      sp.set('n', params.n);
  sp.set('language', params.language||'pl');

  const r = await fetch(`${GMAPS_PROXY}?${sp.toString()}`, { method:'GET', credentials:'omit' });
  if(!r.ok) throw new Error(`Places HTTP ${r.status}`);
  return r.json();
}

async function callGPT(prompt){
  try{
    const r = await fetch(GPT_PROXY, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ prompt }),
      credentials:'omit'
    });
    if(!r.ok) return null;
    return r.json();
  }catch{ return null; }
}

// ---------- TTS: Google → fallback Web Speech ----------
const queue=[]; let speaking=false;
async function speak(text){ queue.push(text); if(speaking) return; speaking=true;
  while(queue.length){
    const t=queue.shift();
    const okCloud = await ttsGoogle(t);
    if(!okCloud) await ttsWebSpeech(t);
  }
  speaking=false;
}
async function ttsGoogle(text){
  try{
    const r = await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,lang:'pl-PL'})});
    const j = await r.json(); if(!j?.audioContent) return false;
    const audio = new Audio('data:audio/mp3;base64,'+j.audioContent);
    await audio.play();
    await new Promise(res=>audio.addEventListener('ended',res,{once:true}));
    return true;
  }catch{ return false; }
}
function ttsWebSpeech(text){
  return new Promise(resolve=>{
    try{
      if(!('speechSynthesis' in window)) return resolve(true);
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text); u.lang='pl-PL';
      const pick=()=>{
        const v=window.speechSynthesis.getVoices()||[];
        u.voice = v.find(x=>/pl[-_]PL/i.test(x.lang||'')) || v.find(x=>/polish/i.test(x.name||'')) || null;
        window.speechSynthesis.speak(u);
      };
      u.onend = ()=>resolve(true);
      u.onerror= ()=>resolve(true);
      const v=window.speechSynthesis.getVoices();
      if(!v || v.length===0){ window.speechSynthesis.onvoiceschanged=()=>{pick(); window.speechSynthesis.onvoiceschanged=null;}; setTimeout(()=>window.speechSynthesis.getVoices(),0); }
      else pick();
    }catch{ resolve(true); }
  });
}

// ---------- główny flow ----------
async function handleUserQuery(text){
  setText(text);

  // Nie prosimy o geo, jeśli jest wskazane miasto → minimalizacja danych
  const q = extractQuery(text);
  let coords = null;
  if(!q) coords = await getGeo(5000); // brak miasta → spróbuj lokalnie

  const params = { language:'pl', n:2 };
  if(coords){
    params.lat = coords.latitude.toFixed(6);
    params.lng = coords.longitude.toFixed(6);
    params.radius = 5000;
    if(q) params.keyword = q;
  }else if(q){
    params.query = q; // tekstowe, bez GPS
  }else{
    showBanner('Powiedz np. „dwie najlepsze restauracje w Katowicach”.','warn');
    await speak('Powiedz: dwie najlepsze restauracje w Katowicach.');
    return;
  }

  showBanner('Szukam miejsc…');
  let data;
  try{ data = await callPlaces(params); }
  catch{ showBanner('Błąd wyszukiwania. Spróbuj ponownie.','err'); await speak('Coś poszło nie tak. Spróbuj ponownie.'); return; }

  const list = (data?.results||[])
    .filter(x=>x && x.name)
    .map(x=>({name:x.name, rating: Number(x.rating||0), votes: Number(x.votes||x.user_ratings_total||0), address: x.address || x.formatted_address || x.vicinity || '—'}))
    .sort((a,b)=> (b.rating-a.rating) || (b.votes-a.votes))
    .slice(0,2);

  if(!list.length){
    showBanner('Brak wyników. Zmień frazę lub włącz lokalizację.','warn');
    await speak('Brak wyników. Zmień frazę lub włącz lokalizację.');
    return;
  }

  const lineUI = list.length===2
    ? `Top 2: 1) ${list[0].name} (${list[0].rating}★, ${list[0].address}) • 2) ${list[1].name} (${list[1].rating}★, ${list[1].address})`
    : `Najlepsze: ${list[0].name} (${list[0].rating}★, ${list[0].address})`;
  showBanner(lineUI);

  const sayShort = list.length===2
    ? `Najbliżej masz ${list[0].name}. Druga opcja: ${list[1].name}. Wolisz złożyć zamówienie, czy wybrać alternatywę we FreeFlow?`
    : `Najbliżej masz ${list[0].name}. Złożyć zamówienie we FreeFlow?`;
  await speak(sayShort);

  // Krótkie CTA z GPT (opcjonalne)
  const g = await callGPT(
    `Krótko po polsku, max 22 słowa: zaproponuj wybór i CTA. Miejsca: ` +
    list.map(r=>`${r.name} (${r.rating}★, ${r.address})`).join('; ')
  );
  if(g?.reply){ showBanner(g.reply); await speak(g.reply); }
}

// ---------- ASR ----------
let recognition=null, listening=false;
function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const rec = new SR();
  rec.lang = 'pl-PL'; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.onstart=()=>{listening=true; setListening(true); setGhost('Słucham…');};
  rec.onerror=()=>{showBanner('Błąd rozpoznawania mowy. Spróbuj ponownie.','warn');};
  rec.onresult=(ev)=>{
    let final='', interim='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const t=ev.results[i][0].transcript;
      if(ev.results[i].isFinal) final+=t; else interim+=t;
    }
    if(final){
      setText(final.trim()); try{rec.stop();}catch{}
      listening=false; setListening(false);
      handleUserQuery(final.trim());
    }else if(interim){ setGhost(interim.trim()); }
  };
  rec.onend=()=>{listening=false; setListening(false); if(!transcript?.textContent?.trim()||transcript.classList.contains('ghost')) setGhost('Powiedz, co chcesz zamówić…');};
  return rec;
}
function toggleMic(){
  if(!recognition){
    const typed = prompt('Wpisz, co chcesz zamówić:');
    if(typed && typed.trim()) { setText(typed.trim()); handleUserQuery(typed.trim()); }
    return;
  }
  if(listening){ try{recognition.stop();}catch{} }
  else{
    try{ recognition.start(); }
    catch{
      const typed = prompt('Wpisz, co chcesz zamówić:');
      if(typed && typed.trim()) { setText(typed.trim()); handleUserQuery(typed.trim()); }
    }
  }
}
function bindUI(){
  micBtn?.addEventListener('click', toggleMic);
  logoBtn?.addEventListener('click', toggleMic);
  const activate = (el)=>[tileFood,tileTaxi,tileHotel].forEach(b=>b?.classList.toggle('active', b===el));
  tileFood?.addEventListener('click', ()=>activate(tileFood));
  tileTaxi?.addEventListener('click', ()=>activate(tileTaxi));
  tileHotel?.addEventListener('click', ()=>activate(tileHotel));
  setGhost('Powiedz, co chcesz zamówić…');
}
(function bootstrap(){
  recognition = initASR();
  bindUI();
  // „rozgrzanie” geolokalizacji nie pokazuje promptu, po prostu szybki call
  getGeo(2000).catch(()=>{});
})();
