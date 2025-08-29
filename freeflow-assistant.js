// freeflow-assistant.js
// ----------------------------------------------------------
// Mowa → szukanie → krótka odpowiedź + TTS
// ----------------------------------------------------------

const $  = (s) => document.querySelector(s);
const app        = $('#app');
const transcript = $('#transcript');
const micBtn     = $('#micBtn');
const logoBtn    = $('#logoBtn');
const dot        = $('#dot');
const banner     = $('#banner');
const tileFood   = $('#tileFood');
const tileTaxi   = $('#tileTaxi');
const tileHotel  = $('#tileHotel');

const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();
const TTS_PROXY   = '/api/tts';

// ---------- UI helpers ----------
function showBanner(msg, type = 'info') {
  banner.textContent = msg;
  banner.classList.remove('hidden');
  banner.style.background = type === 'err'
    ? 'rgba(255,72,72,.15)'
    : type === 'warn'
    ? 'rgba(255,203,72,.15)'
    : 'rgba(72,179,255,.12)';
  banner.style.color = type === 'err' ? '#ffd1d1' : type === 'warn' ? '#ffe6a3' : '#dff1ff';
}
function hideBanner() { banner.classList.add('hidden'); banner.textContent=''; }

function setGhostText(msg){ transcript.classList.add('ghost'); transcript.textContent = msg; }
function setFinalText(msg){ transcript.classList.remove('ghost'); transcript.textContent = msg; }
function setListening(on){
  document.body.classList.toggle('listening', !!on);
  dot.style.boxShadow = on ? '0 0 18px #86e2ff' : '0 0 0 #0000';
}

// ---------- Geo ----------
async function getPositionOrNull(timeoutMs = 6000) {
  if (!('geolocation' in navigator)) {
    showBanner('Twoja przeglądarka nie obsługuje lokalizacji.', 'warn');
    return null;
  }
  const p = () => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos)=>resolve(pos.coords),
      (err)=>reject(err),
      { enableHighAccuracy:true, timeout:timeoutMs, maximumAge:25000 }
    );
  });
  try { const c = await p(); hideBanner(); return c; }
  catch(e){
    const map={1:'Brak zgody na lokalizację.',2:'Lokalizacja niedostępna.',3:'Przekroczono czas oczekiwania.'};
    showBanner(`${map[e.code] ?? 'Błąd lokalizacji.'} — szukam po tekście.`, 'warn');
    return null;
  }
}

// ---------- NLP (bardzo proste) ----------
function extractQuery(text) {
  const t=(text||'').trim();
  const re=/(pizzeria|pizze|pizza|restauracja|restauracje|kebab|sushi|hotel|nocleg|taxi)(.*?)(?:\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+))?/i;
  const m=t.match(re);
  if(!m) return null;
  const base=(m[1]||'').toLowerCase();
  const city=m[3]?` w ${m[3]}`:'';
  const normalized=
    /restaurac/.test(base)?'restauracje':
    /pizz/.test(base)?'pizzeria':
    /(hotel|nocleg)/.test(base)?'hotel':
    /taxi/.test(base)?'taxi':base;
  return (normalized+city).trim();
}

// ---------- API helpers ----------
async function callPlaces(params){
  const sp=new URLSearchParams();
  if(params.query) sp.set('query', params.query);
  if(params.lat)   sp.set('lat', params.lat);
  if(params.lng)   sp.set('lng', params.lng);
  if(params.radius)sp.set('radius', params.radius);
  if(params.rankby)sp.set('rankby', params.rankby);
  if(params.keyword)sp.set('keyword', params.keyword);
  if(params.n)     sp.set('n', params.n);
  sp.set('language', params.language || 'pl');
  const res=await fetch(`${GMAPS_PROXY}?${sp.toString()}`,{method:'GET'});
  if(!res.ok) throw new Error(`Places HTTP ${res.status}`);
  return res.json();
}

async function callGPTSummary(userText, results){
  // Jeżeli backend GPT jest w trybie „echo”, nie używamy odpowiedzi do UI, tylko TTS i tak ją przykryje.
  try{
    const prompt =
      `Odpowiedz jednym krótkim zdaniem po polsku (max 25 słów), bez cytowania użytkownika i bez wstępów. `+
      `Użyj danych: ${results.map(r=>`${r.name} (${r.rating}★)`).join('; ')}. `+
      `Zakończ: "Skorzystaj z aplikacji FreeFlow, aby zamówić szybko i wygodnie!"`;
    const res=await fetch(GPT_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    if(!res.ok) throw new Error('GPT HTTP '+res.status);
    const j=await res.json();
    const raw=(j.reply||'').trim();
    return raw.replace(/^echo:\s*/i,'').replace(/^użytkownik.*?:/i,'').trim();
  }catch{ return ''; }
}

async function speakTTS(text, voice='alloy'){
  if(!text) return;
  try{
    const res=await fetch(TTS_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice})});
    if(!res.ok) throw new Error('TTS HTTP '+res.status);
    const blob=await res.blob();
    const url=URL.createObjectURL(blob);
    const audio=new Audio(url);
    audio.play();
  }catch(e){
    // Fallback: Web Speech API (może kaleczyć przecinki)
    try{
      const u=new SpeechSynthesisUtterance(text);
      u.lang='pl-PL';
      speechSynthesis.speak(u);
    }catch{}
  }
}

// ---------- Główna ścieżka ----------
async function handleUserQuery(userText){
  try{
    setFinalText(userText);

    const coords = await getPositionOrNull(6000);

    const q = extractQuery(userText);
    const params = { language:'pl', n:2 };

    if (coords){
      params.lat = coords.latitude.toFixed(6);
      params.lng = coords.longitude.toFixed(6);
      params.radius = 5000;
      if(q) params.keyword = q;
    } else if(q){
      params.query = q;
    } else {
      showBanner('Powiedz np. „dwie najlepsze restauracje w Katowicach”.', 'warn');
      return;
    }

    // Krótki komunikat statusu
    showBanner('Szukam miejsc…');

    const data = await callPlaces(params);

    const list = (data?.results || data || [])
      .filter(x => x && (x.rating ?? null) !== null)
      .map(x => ({
        name: x.name,
        rating: Number(x.rating || 0),
        votes: Number(x.user_ratings_total || 0),
        address: (x.formatted_address || x.vicinity || '—')
      }))
      .sort((a,b)=>(b.rating-a.rating)||(b.votes-a.votes));

    const results = list.slice(0,2);
    if(!results.length){
      showBanner('Nic nie znalazłem. Spróbuj inną frazę.', 'warn');
      return;
    }

    // Krótki baner z wynikiem (bez „Użytkownik prosił…”)
    if(results.length===1){
      const a=results[0];
      showBanner(`Najlepsze w pobliżu: ${a.name} (${a.rating}★).`);
    }else{
      const [a,b]=results;
      showBanner(`Top 2: ${a.name} (${a.rating}★), ${b.name} (${b.rating}★).`);
    }

    // Zbuduj zwięzły tekst do TTS (nie pokazujemy go w ramce)
    let summary = await callGPTSummary(userText, results);
    if(!summary){
      // Fallback bez GPT
      summary = results.length===1
        ? `Polecam ${results[0].name}, ocena ${results[0].rating.toString().replace('.',',')} gwiazdki. Skorzystaj z aplikacji FreeFlow, aby zamówić szybko i wygodnie!`
        : `Polecam ${results[0].name} i ${results[1].name}, odpowiednio ${results[0].rating.toString().replace('.',',')} i ${results[1].rating.toString().replace('.',',')} gwiazdki. Skorzystaj z aplikacji FreeFlow, aby zamówić szybko i wygodnie!`;
    }

    // Mówimy
    speakTTS(summary, 'aria'); // „aria” zwykle ładniej czyta PL

  }catch(e){
    console.error(e);
    showBanner('Ups, coś poszło nie tak. Spróbuj ponownie.', 'err');
  }
}

// ---------- ASR ----------
let recognition=null, listening=false;

function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const rec=new SR();
  rec.lang='pl-PL'; rec.interimResults=true; rec.maxAlternatives=1;

  rec.onstart=()=>{ listening=true; setListening(true); setGhostText('Słucham…'); };
  rec.onerror=(e)=>{ console.warn('ASR error',e); showBanner('Błąd rozpoznawania mowy.', 'warn'); };
  rec.onresult=(ev)=>{
    let interim='', final='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const chunk=ev.results[i][0].transcript;
      if(ev.results[i].isFinal) final+=chunk; else interim+=chunk;
    }
    if(final){
      setFinalText(final.trim());
      try{ rec.stop(); }catch{}
      listening=false; setListening(false);
      handleUserQuery(final.trim());
    }else if(interim){ setGhostText(interim.trim()); }
  };
  rec.onend=()=>{
    listening=false; setListening(false);
    if(!transcript.textContent || transcript.classList.contains('ghost')){
      setGhostText('Powiedz, co chcesz zamówić…');
    }
  };
  return rec;
}

function toggleMic(){
  if(!recognition){
    const typed=prompt('Rozpoznawanie mowy niedostępne. Wpisz, co chcesz zamówić:');
    if(typed?.trim()){ setFinalText(typed.trim()); handleUserQuery(typed.trim()); }
    return;
  }
  if(listening){ try{recognition.stop();}catch{} }
  else{
    try{ recognition.start(); }
    catch(e){
      const typed=prompt('Nie udało się włączyć mikrofonu. Wpisz, co chcesz zamówić:');
      if(typed?.trim()){ setFinalText(typed.trim()); handleUserQuery(typed.trim()); }
    }
  }
}

// ---------- UI ----------
function bindUI(){
  micBtn?.addEventListener('click', toggleMic);
  logoBtn?.addEventListener('click', toggleMic);
  const activate=(btn)=>[tileFood,tileTaxi,tileHotel].forEach(b=>b?.classList.toggle('active', b===btn));
  tileFood?.addEventListener('click',()=>activate(tileFood));
  tileTaxi?.addEventListener('click',()=>activate(tileTaxi));
  tileHotel?.addEventListener('click',()=>activate(tileHotel));
  setGhostText('Powiedz, co chcesz zamówić…');
}

// ---------- start ----------
(function(){
  recognition=initASR();
  bindUI();
  // miękkie „rozgrzanie” geo
  getPositionOrNull(3000).then(()=>{ /*no-op*/ });
})();
