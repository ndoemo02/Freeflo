// freeflow-assistant.js
// ----------------------------------------------------------
// Mowa → Places → GPT → TTS (server) → odtwórz
// ----------------------------------------------------------

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

// meta endpoints
const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();
const TTS_PROXY   = (document.querySelector('meta[name="tts-proxy"]')?.content   || '/api/tts').trim();

// --- UI helpers
function showBanner(msg, type = 'info') {
  banner.textContent = msg;
  banner.classList.remove('hidden');
  if (type === 'warn') {
    banner.style.background = 'rgba(255,203,72,.15)';
    banner.style.color = '#ffe6a3';
  } else if (type === 'err') {
    banner.style.background = 'rgba(255,72,72,.15)';
    banner.style.color = '#ffd1d1';
  } else {
    banner.style.background = 'rgba(72,179,255,.12)';
    banner.style.color = '#dff1ff';
  }
}
function hideBanner(){ banner.classList.add('hidden'); banner.textContent=''; }
function setGhostText(msg){ transcript.classList.add('ghost'); transcript.textContent = msg; }
function setFinalText(msg){ transcript.classList.remove('ghost'); transcript.textContent = msg; }
function setListening(on){
  document.body.classList.toggle('listening', !!on);
  dot.style.boxShadow = on ? '0 0 18px #86e2ff' : '0 0 0 #0000';
}

// --- GEO
async function getPositionOrNull(timeoutMs = 6000) {
  if (!('geolocation' in navigator)) {
    showBanner('Twoja przeglądarka nie obsługuje lokalizacji.', 'err');
    return null;
  }
  const getPos = () => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 25000 }
    );
  });
  try { const coords = await getPos(); hideBanner(); return coords; }
  catch(e){
    const map = {1:'Brak zgody na lokalizację.',2:'Lokalizacja niedostępna.',3:'Przekroczono czas oczekiwania.'};
    showBanner(`${map[e.code] ?? 'Błąd lokalizacji.'} — szukam po tekście.`, 'warn');
    return null;
  }
}

// --- Intencja
function extractQuery(text) {
  const t = (text || '').trim();
  const re = /(pizzeria|pizze|pizza|restauracja|restauracje|kebab|sushi|hotel|nocleg|taxi)(.*?)(?:\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+))?/i;
  const m = t.match(re);
  if (!m) return null;
  const base = (m[1] || '').toLowerCase();
  const city = m[3] ? ` w ${m[3]}` : '';
  const normalized =
    /restaurac/.test(base)       ? 'restauracje' :
    /pizz/.test(base)            ? 'pizzeria'    :
    /(hotel|nocleg)/.test(base)  ? 'hotel'       :
    /taxi/.test(base)            ? 'taxi'        :
    base;
  return (normalized + city).trim();
}

// --- Places
async function callPlaces(params) {
  const sp = new URLSearchParams();
  if (params.query)  sp.set('query', params.query);
  if (params.lat)    sp.set('lat', params.lat);
  if (params.lng)    sp.set('lng', params.lng);
  if (params.radius) sp.set('radius', params.radius);
  if (params.rankby) sp.set('rankby', params.rankby);
  if (params.keyword) sp.set('keyword', params.keyword);
  if (params.n)       sp.set('n', params.n);
  sp.set('language', params.language || 'pl');

  const url = `${GMAPS_PROXY}?${sp.toString()}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  return res.json();
}

// --- GPT
async function callGPT(prompt) {
  try {
    const res = await fetch(GPT_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(`GPT HTTP ${res.status}`);
    return res.json();
  } catch { return null; }
}

// --- TTS server (MP3)
async function speakServer(text, voice='alloy') {
  try {
    const r = await fetch(TTS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ text, voice, format:'mp3' })
    });
    if(!r.ok) throw new Error(`TTS HTTP ${r.status}`);
    const blob = await r.blob(); // audio/mpeg
    const url = URL.createObjectURL(blob);
    await playAudio(url);
    URL.revokeObjectURL(url);
    return true;
  } catch(e){
    console.debug('Server TTS fail → fallback Web Speech', e);
    return false;
  }
}

// --- Web Speech fallback
function speakWeb(text, lang='pl-PL'){
  return new Promise((resolve)=>{
    try{
      if(!('speechSynthesis' in window)) return resolve(false);
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const pickVoice = () => {
        const voices = window.speechSynthesis.getVoices() || [];
        const plPriority = voices.find(v=>/pl[-_]PL/i.test(v.lang||''));
        const anyPL = voices.find(v=>/pl/i.test(v.lang||''));
        u.voice = plPriority || anyPL || voices[0] || null;
        window.speechSynthesis.speak(u);
      };
      u.onend = ()=>resolve(true);
      u.onerror = ()=>resolve(false);
      const v = window.speechSynthesis.getVoices();
      if(!v || v.length===0){
        window.speechSynthesis.onvoiceschanged = ()=>{ pickVoice(); window.speechSynthesis.onvoiceschanged=null; };
        setTimeout(()=>window.speechSynthesis.getVoices(),0);
      }else pickVoice();
    }catch(_){ resolve(false); }
  });
}

// --- Odtwarzacz
function playAudio(url){
  return new Promise((resolve, reject)=>{
    const a = new Audio();
    a.src = url;
    a.onended = ()=>resolve();
    a.onerror = ()=>reject(new Error('audio error'));
    a.play().catch(reject);
  });
}

// --- Format zwięzłej odpowiedzi (usuń śmieci, ogranicz słowa)
function polishShort(s, max=22){
  if(!s) return '';
  let t = s.replace(/\n+/g,' ').replace(/^\s*(Odpowiedź|Answer|Response)[:\-]?\s*/i,'').trim();
  t = t.replace(/\b(w\s*\d+\s*słowach|krótko|do\s*\d+\s*słów)\b.*$/i,'').trim();
  const words = t.split(/\s+/);
  if(words.length>max) t = words.slice(0,max).join(' ')+'…';
  return t;
}

// --- GŁÓWNY FLOW
async function handleUserQuery(userText){
  try{
    setFinalText(userText);
    const coords = await getPositionOrNull(6000);

    const q = extractQuery(userText);
    const params = { language:'pl', n: 2 };
    if (coords) {
      params.lat = coords.latitude.toFixed(6);
      params.lng = coords.longitude.toFixed(6);
      params.radius = 5000;
      if (q) params.keyword = q;
    } else if (q) {
      params.query = q;
    } else {
      showBanner('Powiedz np. „dwie najlepsze restauracje w Katowicach”.', 'warn');
      return;
    }

    showBanner('Szukam miejsc w okolicy…');

    const data = await callPlaces(params);
    const list = (data?.results || data || []).map(x=>({
      name: x.name,
      rating: Number(x.rating ?? 0),
      votes: Number(x.votes ?? x.user_ratings_total ?? 0),
      address: x.address || x.formatted_address || x.vicinity || '—'
    })).sort((a,b)=>(b.rating-a.rating)||(b.votes-a.votes));

    const pick = list.slice(0,2);
    if (pick.length===0){ showBanner('Nic nie znalazłem. Spróbuj inną frazę.', 'warn'); return; }

    // Tekst do UI
    const ui = (pick.length===1)
      ? `Najlepsze w pobliżu: ${pick[0].name} (${pick[0].rating.toFixed(1)}★, ${pick[0].address}).`
      : `Top 2: 1) ${pick[0].name} (${pick[0].rating.toFixed(1)}★, ${pick[0].address}) • 2) ${pick[1].name} (${pick[1].rating.toFixed(1)}★, ${pick[1].address}).`;

    showBanner(ui);

    // Krótsze, „radiowe” zdanie do TTS
    const ttsText = (pick.length===1)
      ? `${pick[0].name}, ocena ${pick[0].rating.toFixed(1)} gwiazdki, adres ${pick[0].address}.`
      : `${pick[0].name} i ${pick[1].name}. Najwyższe oceny w pobliżu.`;

    // Spróbuj serwerowego TTS; w razie wtopy fallback do Web Speech
    const ok = await speakServer(polishShort(ttsText, 20));
    if (!ok) await speakWeb(polishShort(ttsText, 20), 'pl-PL');

    // Opcjonalnie: ładna 1-zdaniowa odpowiedź z GPT do banera
    const g = await callGPT(
      `Zwięźle, po polsku (max 18 słów): rekomenduj top miejsca z listy: ${pick.map(r=>`${r.name} (${r.rating.toFixed(1)}★, ${r.address})`).join('; ')}.`
    );
    if (g?.reply) showBanner(polishShort(g.reply, 18));
  }catch(e){
    console.error(e);
    showBanner('Ups, coś poszło nie tak. Spróbuj ponownie.', 'err');
  }
}

// --- ASR (Web Speech)
let recognition=null, listening=false;
function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const rec = new SR();
  rec.lang='pl-PL'; rec.interimResults=true; rec.maxAlternatives=1;
  rec.onstart=()=>{ listening=true; setListening(true); setGhostText('Słucham…'); };
  rec.onerror=(e)=>{ showBanner('Błąd rozpoznawania mowy. Spróbuj ponownie.', 'warn'); };
  rec.onresult=(ev)=>{
    let interim='', final='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const t=ev.results[i][0].transcript;
      if(ev.results[i].isFinal) final+=t; else interim+=t;
    }
    if(final){
      setFinalText(final.trim());
      try{ rec.stop(); }catch{}
      listening=false; setListening(false);
      handleUserQuery(final.trim());
    }else if(interim){
      setGhostText(interim.trim());
    }
  };
  rec.onend=()=>{ listening=false; setListening(false); if(!transcript.textContent.trim()||transcript.classList.contains('ghost')) setGhostText('Powiedz, co chcesz zamówić…'); };
  return rec;
}
function toggleMic(){
  if(!recognition){
    const typed = prompt('Mikrofon niedostępny. Wpisz, co chcesz zamówić:');
    if(typed && typed.trim()){ setFinalText(typed.trim()); handleUserQuery(typed.trim()); }
    return;
  }
  if(listening){ try{ recognition.stop(); }catch{} }
  else { try{ recognition.start(); }catch{ const typed = prompt('Nie udało się włączyć mikrofonu. Wpisz zapytanie:'); if(typed && typed.trim()){ setFinalText(typed.trim()); handleUserQuery(typed.trim()); } } }
}

// --- UI bind
function bindUI(){
  micBtn?.addEventListener('click', toggleMic);
  logoBtn?.addEventListener('click', toggleMic);
  const activate=(el)=>{ [tileFood,tileTaxi,tileHotel].forEach(b=>b?.classList.remove('active')); el?.classList.add('active'); };
  tileFood?.addEventListener('click',()=>activate(tileFood));
  tileTaxi?.addEventListener('click',()=>activate(tileTaxi));
  tileHotel?.addEventListener('click',()=>activate(tileHotel));
  setGhostText('Powiedz, co chcesz zamówić…');
}

// --- bootstrap
(function(){
  recognition = initASR();
  bindUI();
  getPositionOrNull(3000).then(()=>{});
})();
