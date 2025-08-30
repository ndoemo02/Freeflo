// freeflow-assistant.js — Google TTS (priority) + dystans + ciepłe komunikaty

/* ----------------- skróty do DOM ----------------- */
const $  = (sel) => document.querySelector(sel);
const app         = $('#app');
const transcript  = $('#transcript');
const micBtn      = $('#micBtn');
const logoBtn     = $('#logoBtn');
const dot         = $('#dot');
const banner      = $('#banner');
const tileFood    = $('#tileFood');
const tileTaxi    = $('#tileTaxi');
const tileHotel   = $('#tileHotel');

/* ----------------- meta-konfiguracja ----------------- */
const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();

/* ----------------- UI helpers ----------------- */
function showBanner(msg, type = 'info') {
  if (!banner) return;
  banner.textContent = msg || '';
  banner.classList.remove('hidden');
  banner.style.background =
    type === 'err'  ? 'rgba(255,72,72,.15)'  :
    type === 'warn' ? 'rgba(255,203,72,.15)' : 'rgba(72,179,255,.12)';
  banner.style.color =
    type === 'err'  ? '#ffd1d1' :
    type === 'warn' ? '#ffe6a3' : '#dff1ff';
}
function hideBanner(){ banner?.classList.add('hidden'); banner && (banner.textContent = ''); }
function setGhostText(t){ transcript?.classList.add('ghost'); if (transcript) transcript.textContent = t; }
function setFinalText(t){ transcript?.classList.remove('ghost'); if (transcript) transcript.textContent = t; }
function setListening(on){ document.body.classList.toggle('listening', !!on); if (dot) dot.style.boxShadow = on ? '0 0 18px #86e2ff' : '0 0 0 #0000'; }

/* ----------------- GEO z timeoutem ----------------- */
async function getPositionOrNull(timeoutMs = 6000){
  if (!('geolocation' in navigator)) { showBanner('Twoja przeglądarka nie obsługuje lokalizacji.', 'warn'); return null; }
  const once = () => new Promise((res, rej) => {
    navigator.geolocation.getCurrentPosition(
      (pos)=>res(pos.coords),
      (err)=>rej(err),
      { enableHighAccuracy:true, timeout:timeoutMs, maximumAge:25_000 }
    );
  });
  try { const c = await once(); hideBanner(); return c; }
  catch(e){
    const map = {1:'Brak zgody na lokalizację.',2:'Lokalizacja niedostępna.',3:'Przekroczono czas oczekiwania.'};
    showBanner(`${map[e.code] ?? 'Błąd lokalizacji.'} — szukam po tekście.`, 'warn');
    return null;
  }
}

/* ----------------- Intencja/miasto (proste) ----------------- */
function extractQuery(text){
  const t = (text||'').trim();
  const re = /(pizzeria|pizze|pizza|restauracja|restauracje|kebab|sushi|hotel|nocleg|taxi)(.*?)(?:\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+))?/i;
  const m = t.match(re);
  if (!m) return null;
  const base = (m[1]||'').toLowerCase();
  const city = m[3] ? ` w ${m[3]}` : '';
  const normalized =
    /restaurac/.test(base) ? 'restauracje' :
    /pizz/.test(base)      ? 'pizzeria'    :
    /(hotel|nocleg)/.test(base) ? 'hotel'  :
    /taxi/.test(base)      ? 'taxi'        : base;
  return (normalized + city).trim();
}

/* ----------------- Backend calls ----------------- */
async function callPlaces(params){
  const sp = new URLSearchParams();
  if (params.query)  sp.set('query', params.query);
  if (params.lat)    sp.set('lat', params.lat);
  if (params.lng)    sp.set('lng', params.lng);
  if (params.radius) sp.set('radius', params.radius);
  if (params.rankby) sp.set('rankby', params.rankby);
  if (params.keyword)sp.set('keyword', params.keyword);
  if (params.n)      sp.set('n', params.n);
  sp.set('language', params.language || 'pl');

  const res = await fetch(`${GMAPS_PROXY}?${sp.toString()}`, { method:'GET' });
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  return res.json();
}

async function callGPT(prompt){
  try{
    const res = await fetch(GPT_PROXY, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(`GPT HTTP ${res.status}`);
    return res.json();
  }catch{ return null; }
}

/* ----------------- TTS: Google → fallback Web Speech ----------------- */
const sayQueue = [];
let speaking = false;

async function speakEnqueue(text){
  if (!text) return;
  sayQueue.push(text);
  if (speaking) return;
  speaking = true;
  while (sayQueue.length){
    const t = sayQueue.shift();
    const okCloud = await speakWithGoogleTTS(t);
    if (!okCloud){ await speakWithWebSpeech(t); }
  }
  speaking = false;
}

async function speakWithGoogleTTS(text){
  try{
    const r = await fetch('/api/tts', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text, lang:'pl-PL', voice:'pl-PL-Wavenet-D' })
    });
    const j = await r.json();
    if (!j?.audioContent) return false;
    const audio = new Audio('data:audio/mp3;base64,'+j.audioContent);
    await audio.play();
    await new Promise(res => audio.addEventListener('ended', res, { once:true }));
    return true;
  }catch{ return false; }
}

function speakWithWebSpeech(text){
  return new Promise((resolve)=>{
    try{
      if (!('speechSynthesis' in window)) return resolve(true);
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pl-PL';
      const choose = ()=>{
        const vs = window.speechSynthesis.getVoices()||[];
        u.voice =
          vs.find(v=>/pl[-_]PL/i.test(v.lang||'')) ||
          vs.find(v=>/polish/i.test(v.name||''))   ||
          vs[0] || null;
        window.speechSynthesis.speak(u);
      };
      u.onend = ()=>resolve(true);
      u.onerror = ()=>resolve(true);
      const vs = window.speechSynthesis.getVoices();
      if (!vs || vs.length===0){
        window.speechSynthesis.onvoiceschanged = ()=>{ choose(); window.speechSynthesis.onvoiceschanged=null; };
        setTimeout(()=>window.speechSynthesis.getVoices(),0);
      }else{ choose(); }
    }catch{ resolve(true); }
  });
}

/* ----------------- Dystans (Haversine) ----------------- */
const R_EARTH = 6371e3; // m
function haversineMeters(lat1, lon1, lat2, lon2){
  const toRad = (d)=> (d*Math.PI/180);
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2-lat1), Δλ = toRad(lon2-lon1);
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R_EARTH*c;
}
function fmtDist(m){
  if (m < 50)  return `${Math.round(m)} m`;
  if (m < 950) return `${Math.round(m/10)*10} m`;
  return `${(m/1000).toFixed(m<1500?1:1)} km`;
}

/* ----------------- Główna obsługa zapytań ----------------- */
async function handleUserQuery(userText){
  try{
    setFinalText(userText);
    const coords = await getPositionOrNull(6000);

    const q = extractQuery(userText);
    const params = { language:'pl', n:4 }; // weźmy do 4, potem i tak wybierzemy 2

    if (coords){
      params.lat    = coords.latitude.toFixed(6);
      params.lng    = coords.longitude.toFixed(6);
      params.radius = 5000;
      if (q) params.keyword = q;
    }else if (q){
      params.query = q;
    }else{
      const msg = 'Nie rozumiem. Powiedz np. „najbliższa pizzeria w Katowicach”.';
      showBanner(msg,'warn'); await speakEnqueue(msg); return;
    }

    showBanner('Szukam miejsc w okolicy…');

    const data = await callPlaces(params);

    let list = (data?.results || data || [])
      .filter(x => x && (x.rating ?? null) !== null)
      .map(x => ({
        name: x.name,
        rating: Number(x.rating||0),
        votes: Number(x.user_ratings_total||0),
        address: (x.formatted_address || x.vicinity || '—'),
        lat: x.geometry?.location?.lat ?? null,
        lng: x.geometry?.location?.lng ?? null
      }));

    // dystanse jeśli mamy gps i współrzędne lokalu
    if (coords){
      list = list.map(x=>{
        if (x.lat!=null && x.lng!=null){
          x.meters = haversineMeters(coords.latitude, coords.longitude, x.lat, x.lng);
        } else {
          x.meters = Number.POSITIVE_INFINITY;
        }
        return x;
      }).sort((a,b)=>{
        // preferuj bliższe, a potem lepiej oceniane
        const d = (a.meters - b.meters);
        if (isFinite(d) && Math.abs(d) > 1) return d;
        return (b.rating - a.rating) || (b.votes - a.votes);
      });
    } else {
      list = list.sort((a,b)=> (b.rating-a.rating) || (b.votes-a.votes));
    }

    const results = list.slice(0,2);

    if (!results.length){
      const msg = 'Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.';
      showBanner(msg,'warn'); await speakEnqueue(msg); return;
    }

    // Przyjazny komunikat z dystansem
    let spoken;
    if (results.length===1){
      const a = results[0];
      const near = (a.meters!=null && isFinite(a.meters)) ? ` — ${fmtDist(a.meters)} od Ciebie` : '';
      spoken = `Najbliżej masz ${a.name}${near}. Chcesz tam zamówić, czy szukać dalej?`;
      showBanner(`Najbliżej: ${a.name} (${a.rating}★, ${a.address})`);
    }else{
      const [a,b] = results;
      const nearA = (a.meters!=null && isFinite(a.meters)) ? ` — ${fmtDist(a.meters)} od Ciebie` : '';
      const nearB = (b.meters!=null && isFinite(b.meters)) ? ` — ${fmtDist(b.meters)} dalej` : '';
      spoken = `Najbliżej masz ${a.name}${nearA}. Alternatywa: ${b.name}${nearB}. Którą wybierasz?`;
      showBanner(`Top 2: 1) ${a.name} (${a.rating}★, ${a.address}) • 2) ${b.name} (${b.rating}★, ${b.address})`);
    }
    await speakEnqueue(spoken);

    // Krótka wersja marketingowa z GPT (opcjonalnie)
    const g = await callGPT(
      `Krótko po polsku (max 22 słowa) poleć 1–2 miejsca z listy: ` +
      results.map(r=>`${r.name} (${r.rating}★, ${r.address})`).join('; ') +
      `. Zakończ jednym zdaniem: „Skorzystaj z FreeFlow, aby zamówić szybko i wygodnie!”.`
    );
    if (g?.reply){
      const trimmed = String(g.reply).replace(/^echo[:\-\s]*/i,'').trim();
      if (trimmed) { showBanner(trimmed); await speakEnqueue(trimmed); }
    }

  }catch(err){
    console.error(err);
    const msg = 'Ups, coś poszło nie tak. Sprawdź połączenie i spróbuj ponownie.';
    showBanner(msg,'err'); await speakEnqueue(msg);
  }
}

/* ----------------- ASR (Web Speech) ----------------- */
let recognition = null;
let listening = false;

function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'pl-PL';
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = ()=>{ listening=true; setListening(true); setGhostText('Słucham…'); };
  rec.onerror = ()=>{ showBanner('Błąd rozpoznawania mowy. Spróbuj ponownie lub wpisz ręcznie.','warn'); };
  rec.onresult = (ev)=>{
    let interim='', final='';
    for (let i=ev.resultIndex; i<ev.results.length; i++){
      const chunk = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) final += chunk; else interim += chunk;
    }
    if (final){
      setFinalText(final.trim());
      try{ rec.stop(); }catch{}
      listening=false; setListening(false);
      handleUserQuery(final.trim());
    }else if (interim){ setGhostText(interim.trim()); }
  };
  rec.onend = ()=>{
    listening=false; setListening(false);
    if (!transcript || transcript.textContent.trim()==='' || transcript.classList.contains('ghost')){
      setGhostText('Powiedz, co chcesz zamówić…');
    }
  };
  return rec;
}

function toggleMic(){
  if (!recognition){
    const typed = prompt('Rozpoznawanie mowy niedostępne. Wpisz, co chcesz zamówić:');
    if (typed && typed.trim()) { setFinalText(typed.trim()); handleUserQuery(typed.trim()); }
    return;
  }
  if (listening){ try{ recognition.stop(); }catch{} }
  else{
    try{ recognition.start(); }
    catch{
      const typed = prompt('Nie udało się włączyć mikrofonu. Wpisz, co chcesz zamówić:');
      if (typed && typed.trim()) { setFinalText(typed.trim()); handleUserQuery(typed.trim()); }
    }
  }
}

/* ----------------- UI binding ----------------- */
function bindUI(){
  micBtn?.addEventListener('click', toggleMic);
  logoBtn?.addEventListener('click', toggleMic);
  const activate = (el)=>[tileFood,tileTaxi,tileHotel].forEach(b=>b?.classList.toggle('active', b===el));
  tileFood?.addEventListener('click', ()=>activate(tileFood));
  tileTaxi?.addEventListener('click', ()=>activate(tileTaxi));
  tileHotel?.addEventListener('click', ()=>activate(tileHotel));
  setGhostText('Powiedz, co chcesz zamówić…');
}

/* ----------------- start ----------------- */
(function bootstrap(){
  recognition = initASR();
  bindUI();
  getPositionOrNull(3000).catch(()=>{});
})();
