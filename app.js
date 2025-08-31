// FreeFlow front — klikany nasłuch + ręczny input + wyświetlenia
// -----------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

const transcript = $('#transcript');
const micBtn     = $('#micBtn');
const logoBtn    = $('#logoBtn');
const textInput  = $('#textInput');
const sendBtn    = $('#sendBtn');
const banner     = $('#banner');
const tileFood   = $('#tileFood');
const tileTaxi   = $('#tileTaxi');
const tileHotel  = $('#tileHotel');

const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();

/* ---------- helpers UI ---------- */
function showBanner(msg, type='info'){
  if(!banner) return;
  banner.textContent = msg || '';
  banner.classList.remove('hidden');
  banner.style.background =
    type==='err' ? 'rgba(255,72,72,.15)' :
    type==='warn'? 'rgba(255,203,72,.15)' :
                   'rgba(72,179,255,.12)';
  banner.style.color =
    type==='err' ? '#ffd1d1' :
    type==='warn'? '#ffe6a3' :
                   '#dff1ff';
}
function hideBanner(){ banner?.classList.add('hidden'); banner.textContent=''; }
function setGhostText(t){ transcript.classList.add('ghost'); transcript.textContent=t; }
function setFinalText(t){ transcript.classList.remove('ghost'); transcript.textContent=t; }
function setListening(on){ document.body.classList.toggle('listening', !!on); }

/* ---------- geolokacja (na żądanie) ---------- */
async function getPositionOrNull(timeoutMs=6000){
  if(!('geolocation' in navigator)) return null;
  const once = () => new Promise((res,rej)=>{
    navigator.geolocation.getCurrentPosition(
      (pos)=>res(pos.coords),
      ()=>rej(),
      { enableHighAccuracy:true, timeout:timeoutMs, maximumAge:25000 }
    );
  });
  try { return await once(); } catch { return null; }
}

/* ---------- prosta ekstrakcja frazy ---------- */
function extractQuery(text){
  const t = (text||'').trim();
  const re = /(pizzeria|pizze|pizza|restauracja|restauracje|kebab|sushi|hotel|nocleg|taxi)(?:.*?\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+))?/i;
  const m = t.match(re);
  if(!m) return null;
  const base = (m[1]||'').toLowerCase();
  const city = m[2] ? ` w ${m[2]}` : '';
  const normalized =
    /restaurac/.test(base) ? 'restauracje' :
    /pizz/.test(base)      ? 'pizzeria'    :
    /(hotel|nocleg)/.test(base) ? 'hotel'  :
    /taxi/.test(base)      ? 'taxi'        : base;
  return (normalized + city).trim();
}

/* ---------- backend calls ---------- */
async function callPlaces(params){
  const sp = new URLSearchParams();
  if(params.query)   sp.set('query', params.query);
  if(params.lat)     sp.set('lat', params.lat);
  if(params.lng)     sp.set('lng', params.lng);
  if(params.radius)  sp.set('radius', params.radius);
  if(params.rankby)  sp.set('rankby', params.rankby);
  if(params.keyword) sp.set('keyword', params.keyword);
  if(params.n)       sp.set('n', params.n);
  sp.set('language', params.language || 'pl');

  const res = await fetch(`${GMAPS_PROXY}?${sp.toString()}`);
  if(!res.ok) throw new Error(`Places HTTP ${res.status}`);
  return res.json();
}

async function callGPT(prompt){
  try{
    const res = await fetch(GPT_PROXY, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt })
    });
    if(!res.ok) throw new Error();
    return res.json(); // { reply }
  }catch{ return null; }
}

async function callTTS(text, lang='pl-PL', voice='pl-PL-Wavenet-D'){
  try{
    const r = await fetch('/api/tts', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text, lang, voice })
    });
    const j = await r.json();
    if(!j?.audioContent) return false;
    const audio = new Audio('data:audio/mp3;base64,' + j.audioContent);
    await audio.play();
    await new Promise(res => audio.addEventListener('ended', res, { once:true }));
    return true;
  }catch{ return false; }
}

/* ---------- Web Speech fallback ---------- */
function speakWithWebSpeech(text){
  return new Promise((resolve)=>{
    try{
      if(!('speechSynthesis' in window)) return resolve(true);
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pl-PL';
      u.onend = ()=>resolve(true);
      u.onerror = ()=>resolve(true);
      const choose = ()=>{
        const vs = window.speechSynthesis.getVoices()||[];
        u.voice = vs.find(v=>/pl[-_]PL/i.test(v.lang||'')) || vs.find(v=>/polish/i.test(v.name||'')) || vs[0] || null;
        window.speechSynthesis.speak(u);
      };
      const vs = window.speechSynthesis.getVoices();
      if(!vs || vs.length===0){
        window.speechSynthesis.onvoiceschanged = ()=>{ choose(); window.speechSynthesis.onvoiceschanged=null; };
        setTimeout(()=>window.speechSynthesis.getVoices(),0);
      }else choose();
    }catch{ resolve(true); }
  });
}
const sayQueue=[]; let speaking=false;
async function speak(text){
  sayQueue.push(text); if(speaking) return;
  speaking=true;
  while(sayQueue.length){
    const msg = sayQueue.shift();
    const ok = await callTTS(msg); if(!ok) await speakWithWebSpeech(msg);
  }
  speaking=false;
}

/* ---------- główny flow ---------- */
async function handleUserQuery(userText){
  try{
    const q = extractQuery(userText);
    const coords = !q || !/ w [A-ZĄĆĘŁŃÓŚŹŻ]/.test(q) ? await getPositionOrNull(6000) : null;

    const params = { language:'pl', n:2 };
    if(coords){
      params.lat = coords.latitude.toFixed(6);
      params.lng = coords.longitude.toFixed(6);
      params.radius = 5000;
      params.keyword = q || userText;
    }else if(q){
      params.query = q;
    }else{
      showBanner('Powiedz np. „dwie najlepsze pizzerie w Krakowie”.','warn');
      await speak('Powiedz na przykład: dwie najlepsze pizzerie w Krakowie.');
      return;
    }

    showBanner('Szukam miejsc…');
    const data = await callPlaces(params);

    const list = (data?.results || data || [])
      .map(x => ({
        name: x.name,
        rating: Number(x.rating || 0),
        votes: Number(x.user_ratings_total || x.votes || 0),
        address: x.formatted_address || x.address || x.vicinity || '—'
      }))
      .sort((a,b)=> (b.rating-a.rating) || (b.votes-a.votes));

    const results = list.slice(0,2);
    if(!results.length){
      showBanner('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.','warn');
      await speak('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.');
      return;
    }

    if(results.length===1){
      const a = results[0];
      const line = `Najlepsze w pobliżu: ${a.name} (${a.rating}★, ${a.address}).`;
      showBanner(line); await speak(line);
    }else{
      const [a,b] = results;
      showBanner(`Top 2: 1) ${a.name} (${a.rating}★, ${a.address}) • 2) ${b.name} (${b.rating}★, ${b.address})`);
      await speak(`Najlepsze: ${a.name}. Alternatywa: ${b.name}.`);
    }

    const g = await callGPT(
      `Krótko po polsku (≤25 słów) poleć 1–2 miejsca z listy: ${
        results.map(r=>`${r.name} (${r.rating}★, ${r.address})`).join('; ')
      }. Zakończ CTA: „Zamów we FreeFlow.”`
    );
    if(g?.reply){
      const msg = g.reply.replace(/^echo[:\-\s]*/i,'').trim();
      showBanner(msg); await speak(msg);
    }
  }catch(e){
    console.error(e);
    showBanner('Ups, coś poszło nie tak. Spróbuj ponownie.','err');
    await speak('Coś poszło nie tak. Spróbuj ponownie.');
  }
}

/* ---------- ASR tylko po kliknięciu ---------- */
let recognition=null, listening=false;
function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const rec = new SR();
  rec.lang='pl-PL'; rec.interimResults=true; rec.maxAlternatives=1;

  rec.onstart = ()=>{ listening=true; setListening(true); setGhostText('Słucham…'); };
  rec.onerror = ()=>{ showBanner('Błąd rozpoznawania mowy. Wpisz ręcznie lub spróbuj ponownie.','warn'); };
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
    if(transcript.textContent.trim()==='' || transcript.classList.contains('ghost')){
      setGhostText('Powiedz, co chcesz zamówić…');
    }
  };
  return rec;
}

function toggleMic(){
  if(!recognition) recognition = initASR();
  if(!recognition){
    // Brak ASR w przeglądarce – fokus do inputu
    textInput?.focus();
    showBanner('ASR niedostępny. Skorzystaj z pola „Powiedz lub wpisz”.','warn');
    return;
  }
  try{
    if(listening){ recognition.stop(); }
    else { recognition.start(); }
  }catch{}
}

/* ---------- zdarzenia UI ---------- */
logoBtn?.addEventListener('click', toggleMic);
micBtn?.addEventListener('click', toggleMic);

sendBtn?.addEventListener('click', ()=>{
  const v = (textInput.value||'').trim();
  if(!v) return;
  setFinalText(v);
  textInput.value='';
  handleUserQuery(v);
});
textInput?.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){ e.preventDefault(); sendBtn.click(); }
});

/* szybkie ustawienie placeholderów po kafelkach */
tileFood?.addEventListener('click', ()=>{
  setGhostText('np. „dwie najlepsze pizzerie w Krakowie”');
  showBanner('Powiedz lub wpisz np. „dwie najlepsze pizzerie w Krakowie”.');
});
tileTaxi?.addEventListener('click', ()=>{
  setGhostText('np. „zamów taxi na 18:30 z Dworca do Kazimierza”');
  showBanner('Taxi: start → cel + godzina.');
});
tileHotel?.addEventListener('click', ()=>{
  setGhostText('np. „nocleg w Warszawie 2 noce od piątku”');
  showBanner('Hotel: miasto + daty.');
});

/* startowy tekst */
setGhostText('Powiedz, co chcesz zamówić…');
hideBanner();
