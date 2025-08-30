/* FreeFlow assistant — debug + audio unlock + solid fallbacks */
const $ = (s)=>document.querySelector(s);

/* ---------- DEBUG ---------- */
const DEBUG = true;
const log = (...a)=>{ if(DEBUG) console.log('[FF]', ...a); };

/* ---------- DOM refs ---------- */
const banner   = $('#banner');
const dot      = $('#dot');
const micBtn   = $('#micBtn');
const logoBtn  = $('#logoBtn');
const transcript = $('#transcript');
const tileFood  = $('#tileFood');
const tileTaxi  = $('#tileTaxi');
const tileHotel = $('#tileHotel');

/* ---------- Endpoints from <meta> ---------- */
const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();

/* ---------- UI helpers ---------- */
function showBanner(msg, type='info'){
  if(!banner) return;
  banner.textContent = msg || '';
  banner.classList.remove('hidden');
  banner.style.background =
    type==='err'  ? 'rgba(255,72,72,.15)' :
    type==='warn' ? 'rgba(255,203,72,.15)' : 'rgba(72,179,255,.12)';
  banner.style.color =
    type==='err'  ? '#ffd1d1' :
    type==='warn' ? '#ffe6a3' : '#dff1ff';
}
function hideBanner(){ banner?.classList.add('hidden'); if(banner) banner.textContent=''; }
function setGhostText(t){ transcript?.classList.add('ghost'); if(transcript) transcript.textContent=t; }
function setFinalText(t){ transcript?.classList.remove('ghost'); if(transcript) transcript.textContent=t; }
function setListening(on){
  document.body.classList.toggle('listening', !!on);
  if(dot) dot.style.boxShadow = on ? '0 0 18px #86e2ff' : '0 0 0 #0000';
}

/* ---------- Audio unlock (autoplay policy) ---------- */
let audioUnlocked = false;
function unlockAudioOnce(){
  if(audioUnlocked) return;
  try{
    const a = new Audio();
    a.src = 'data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    a.volume = 0.0001;
    a.play().catch(()=>{});
    audioUnlocked = true;
    log('Audio unlocked');
  }catch(e){ log('Audio unlock fail', e); }
}

/* ---------- GEO ---------- */
async function getPositionOrNull(timeoutMs=6000){
  if(!('geolocation' in navigator)) { showBanner('Twoja przeglądarka nie obsługuje lokalizacji.','warn'); return null; }
  const once = () => new Promise((res,rej)=>{
    navigator.geolocation.getCurrentPosition(
      (pos)=>res(pos.coords),
      (err)=>rej(err),
      { enableHighAccuracy:true, timeout:timeoutMs, maximumAge:25_000 }
    );
  });
  try{
    const c = await once();
    hideBanner();
    log('GPS', c);
    return c;
  }catch(e){
    const map={1:'Brak zgody na lokalizację.',2:'Lokalizacja niedostępna.',3:'Przekroczono czas oczekiwania.'};
    showBanner(`${map[e.code] ?? 'Błąd lokalizacji.'} — szukam po tekście.`, 'warn');
    log('GPS error', e);
    return null;
  }
}

/* ---------- Intent parsing ---------- */
function extractQuery(text){
  const t = (text||'').trim();
  // obsługa „w okolicy”, „w Krakowie”, itp.
  const re = /(pizzeria|pizze|pizza|restauracja|restauracje|kebab|sushi|hotel|nocleg|taxi)(.*?)(?:\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\-]+))?/i;
  const m = t.match(re);
  let base, city;
  if(m){
    base = (m[1]||'').toLowerCase();
    city = m[3] ? ` w ${m[3]}` : '';
  }
  if(!base){
    // Jeśli user powiedział tylko „w okolicy” itp. — użyj aktywnej kategorii
    if(tileTaxi?.classList.contains('active')) base = 'taxi';
    else if(tileHotel?.classList.contains('active')) base = 'hotel';
    else base = 'restauracje';
  }
  const normalized =
    /restaurac/.test(base) ? 'restauracje' :
    /pizz/.test(base)      ? 'pizzeria'    :
    /(hotel|nocleg)/.test(base) ? 'hotel'  :
    /taxi/.test(base)      ? 'taxi'        : base;

  return (normalized + (city || '')).trim();
}

/* ---------- Backend calls ---------- */
async function callPlaces(params){
  const sp = new URLSearchParams();
  if(params.query)  sp.set('query', params.query);
  if(params.lat)    sp.set('lat', params.lat);
  if(params.lng)    sp.set('lng', params.lng);
  if(params.radius) sp.set('radius', params.radius);
  if(params.rankby) sp.set('rankby', params.rankby);
  if(params.keyword)sp.set('keyword', params.keyword);
  if(params.n)      sp.set('n', params.n);
  sp.set('language', params.language || 'pl');

  const url = `${GMAPS_PROXY}?${sp.toString()}`;
  log('Places GET', url);
  const res = await fetch(url, { method:'GET' });
  if(!res.ok){
    const txt = await res.text().catch(()=>String(res.status));
    throw new Error(`Places HTTP ${res.status} – ${txt}`);
  }
  const j = await res.json();
  log('Places data', j);
  return j;
}

async function callGPT(prompt){
  try{
    const res = await fetch(GPT_PROXY, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt })
    });
    if(!res.ok){
      const t = await res.text().catch(()=>String(res.status));
      throw new Error(`GPT HTTP ${res.status} – ${t}`);
    }
    const j = await res.json();
    log('GPT data', j);
    return j;
  }catch(e){ log('GPT error', e); return null; }
}

/* ---------- TTS: Google → WebSpeech fallback ---------- */
const sayQueue = []; let speaking=false;

async function speakEnqueue(text){
  if(!text) return;
  sayQueue.push(text);
  if(speaking) return;
  speaking = true;
  while(sayQueue.length){
    const t = sayQueue.shift();
    const okCloud = await speakWithGoogleTTS(t);
    if(!okCloud) await speakWithWebSpeech(t);
  }
  speaking = false;
}

async function speakWithGoogleTTS(text){
  try{
    const r = await fetch('/api/tts', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text, lang:'pl-PL' })
    });
    const j = await r.json().catch(()=>null);
    if(!j?.audioContent){ log('TTS: no audioContent', j); return false; }
    const a = new Audio('data:audio/mp3;base64,'+j.audioContent);
    await a.play().catch((e)=>{ log('TTS play err', e); throw e; });
    await new Promise(res=>a.addEventListener('ended', res, {once:true}));
    return true;
  }catch(e){ return false; }
}

function speakWithWebSpeech(text){
  return new Promise((resolve)=>{
    try{
      if(!('speechSynthesis' in window)) return resolve(true);
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
      if(!vs || vs.length===0){
        window.speechSynthesis.onvoiceschanged = ()=>{ choose(); window.speechSynthesis.onvoiceschanged=null; };
        setTimeout(()=>window.speechSynthesis.getVoices(),0);
      }else choose();
    }catch{ resolve(true); }
  });
}

/* ---------- Core flow ---------- */
async function handleUserQuery(userText){
  try{
    unlockAudioOnce();
    setFinalText(userText);

    const coords = await getPositionOrNull(6000);
    const q = extractQuery(userText);
    const params = { language:'pl', n:2 };

    if(coords){
      params.lat = coords.latitude.toFixed(6);
      params.lng = coords.longitude.toFixed(6);
      params.radius = 5000;
      // jeżeli user podał miasto w tekście, Google i tak priorytetyzuje location przy distance,
      // ale niech keyword zawęzi typ:
      params.keyword = q;
      params.rankby  = 'distance';
    }else{
      // tryb tekstowy
      params.query = q; // np. „pizzeria w Krakowie”
    }

    showBanner('Szukam…');

    const data = await callPlaces(params);
    const list = (data?.results || data || [])
      .filter(x => x && (x.rating ?? null) !== null)
      .map(x => ({
        name: x.name,
        rating: Number(x.rating||0),
        votes: Number(x.user_ratings_total||0),
        address: (x.formatted_address || x.vicinity || '—')
      }))
      .sort((a,b)=> (b.rating-a.rating) || (b.votes-a.votes));

    const results = list.slice(0,2);

    if(!results.length){
      showBanner('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.','warn');
      await speakEnqueue('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.');
      return;
    }

    if(results.length===1){
      const a = results[0];
      const line = `Najlepsze w pobliżu: ${a.name} (${a.rating} gwiazdki, ${a.address}).`;
      showBanner(line);
      await speakEnqueue(line);
    }else{
      const [a,b] = results;
      showBanner(`Top 2: 1) ${a.name} (${a.rating}★, ${a.address}) • 2) ${b.name} (${b.rating}★, ${b.address})`);
      await speakEnqueue(`Najbliżej masz ${a.name}. Druga opcja to ${b.name}. Wolisz tę pierwszą czy drugą?`);
    }

    // opcjonalny „ładny” tekst z GPT
    const g = await callGPT(
      `Jednym, naturalnym zdaniem po polsku (maks 25 słów) poleć 1–2 miejsca z listy: ` +
      results.map(r=>`${r.name} (${r.rating}★, ${r.address})`).join('; ') +
      `. Zakończ CTA: Skorzystaj z aplikacji FreeFlow, aby zamówić szybko i wygodnie!`
    );
    if(g?.reply){
      const txt = String(g.reply).replace(/^\s*(echo|odp(?:owiedź)?)[:\-\s]*/i,'').trim();
      if(txt){ showBanner(txt); await speakEnqueue(txt); }
    }

  }catch(e){
    log('Flow error', e);
    showBanner('Ups, coś poszło nie tak. Sprawdź połączenie lub spróbuj ponownie.','err');
    await speakEnqueue('Coś poszło nie tak. Spróbuj ponownie.');
  }
}

/* ---------- ASR ---------- */
let recognition=null, listening=false;

function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ log('ASR not available'); return null; }
  const rec = new SR();
  rec.lang='pl-PL'; rec.interimResults=true; rec.maxAlternatives=1;

  rec.onstart = ()=>{ listening=true; setListening(true); setGhostText('Słucham…'); };
  rec.onerror = (e)=>{ log('ASR error', e); showBanner('Błąd rozpoznawania mowy. Spróbuj ponownie lub wpisz ręcznie.','warn'); };
  rec.onresult = (ev)=>{
    let interim='', final='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const chunk = ev.results[i][0].transcript;
      if(ev.results[i].isFinal) final += chunk; else interim += chunk;
    }
    if(final){
      setFinalText(final.trim());
      try{ rec.stop(); }catch{}
      listening=false; setListening(false);
      handleUserQuery(final.trim());
    }else if(interim){ setGhostText(interim.trim()); }
  };
  rec.onend = ()=>{
    listening=false; setListening(false);
    if(!transcript || transcript.textContent.trim()==='' || transcript.classList.contains('ghost')){
      setGhostText('Powiedz, co chcesz zamówić…');
    }
  };
  return rec;
}

function toggleMic(){
  unlockAudioOnce();
  if(!recognition){
    const typed = prompt('Rozpoznawanie mowy niedostępne. Wpisz, co chcesz zamówić:');
    if(typed && typed.trim()){ setFinalText(typed.trim()); handleUserQuery(typed.trim()); }
    return;
  }
  if(listening){ try{ recognition.stop(); }catch{} }
  else{
    try{ recognition.start(); }
    catch(e){
      log('ASR start error', e);
      const typed = prompt('Nie udało się włączyć mikrofonu. Wpisz, co chcesz zamówić:');
      if(typed && typed.trim()){ setFinalText(typed.trim()); handleUserQuery(typed.trim()); }
    }
  }
}

/* ---------- Bind UI ---------- */
function bindUI(){
  micBtn?.addEventListener('click', toggleMic);
  logoBtn?.addEventListener('click', toggleMic);
  // „odblokuj” audio przy pierwszym geście, nawet jeśli nie startujemy od razu ASR
  micBtn?.addEventListener('click', unlockAudioOnce, { once:true });
  logoBtn?.addEventListener('click', unlockAudioOnce, { once:true });

  const activate = (el)=>[tileFood,tileTaxi,tileHotel].forEach(b=>b?.classList.toggle('active', b===el));
  tileFood?.addEventListener('click', ()=>activate(tileFood));
  tileTaxi?.addEventListener('click', ()=>activate(tileTaxi));
  tileHotel?.addEventListener('click', ()=>activate(tileHotel));

  setGhostText('Powiedz, co chcesz zamówić…');
}

/* ---------- Boot ---------- */
(function bootstrap(){
  recognition = initASR();
  bindUI();
  // rozgrzej geo „po cichu”
  getPositionOrNull(3000).catch(()=>{});
  log('Assistant booted', { GMAPS_PROXY, GPT_PROXY });
})();
