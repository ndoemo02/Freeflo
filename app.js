// ---------- KONFIG ----------
const BASE_URL = 'https://freeflow-backend-vercel.vercel.app'; // <— TWÓJ backend
const ENDPOINTS = {
  plan:   `${BASE_URL}/api/plan`,
  places: `${BASE_URL}/api/places`,
  gpt:    `${BASE_URL}/api/gpt`,
  tts:    `${BASE_URL}/api/tts`,
};

// ---------- POMOCNICZE ----------
const $ = (s)=>document.querySelector(s);
const banner = $('#banner');       // pasek komunikatów
const transcript = $('#transcript');
const micBtn = $('#micBtn');
const logoBtn = $('#logoBtn');
const dot = $('#dot');

function show(msg, type='info'){
  if(!banner) return;
  banner.textContent = msg;
  banner.classList.remove('hidden');
  banner.style.background =
    type==='err' ? 'rgba(255,72,72,.15)' :
    type==='warn'? 'rgba(255,203,72,.15)' : 'rgba(72,179,255,.12)';
  banner.style.color =
    type==='err' ? '#ffd1d1' :
    type==='warn'? '#ffe6a3' : '#dff1ff';
}
function hide(){ banner?.classList.add('hidden'); if(banner) banner.textContent=''; }
function ghost(t){ transcript.classList.add('ghost'); transcript.textContent=t; }
function final(t){ transcript.classList.remove('ghost'); transcript.textContent=t; }
function listening(on){
  document.body.classList.toggle('listening', !!on);
  if(dot) dot.style.boxShadow = on ? '0 0 18px #86e2ff' : '0 0 0 #0000';
}

// ---------- FETCH (timeout + JSON) ----------
async function jfetch(url, opts={}, timeoutMs=12000){
  const ctrl = new AbortController();
  const to = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(url, {...opts, signal: ctrl.signal});
    if(!res.ok) throw new Error(`${res.status}`);
    const ct = res.headers.get('content-type')||'';
    return ct.includes('application/json') ? res.json() : res.text();
  }finally{ clearTimeout(to); }
}

// ---------- INTEGRACJA BACKENDU ----------
async function apiPlan(query){
  return jfetch(ENDPOINTS.plan, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ query })
  });
}
async function apiPlaces(params){
  const sp = new URLSearchParams(params);
  return jfetch(`${ENDPOINTS.places}?${sp.toString()}`, { method:'GET' });
}
async function apiGPT(prompt){
  try{
    return await jfetch(ENDPOINTS.gpt, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt })
    });
  }catch{ return null; }
}
async function apiTTS(text, lang='pl-PL', voice='pl-PL-Wavenet-D'){
  try{
    const j = await jfetch(ENDPOINTS.tts, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text, lang, voice })
    });
    if(!j?.audioContent) return false;
    const a = new Audio('data:audio/mp3;base64,' + j.audioContent);
    await a.play(); await new Promise(r=>a.addEventListener('ended', r, {once:true}));
    return true;
  }catch{ return false; }
}

// fallback: Web Speech TTS
async function say(text){
  const ok = await apiTTS(text);
  if(ok) return;
  try{
    if(!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL';
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find(v=>/pl[-_]PL/i.test(v.lang)) || voices[0] || null;
    window.speechSynthesis.speak(u);
  }catch{}
}

// ---------- PRZEPŁYW ----------
async function handleUserQuery(userText){
  try{
    final(userText);
    show('Planuję…');
    const plan = await apiPlan(userText);

    if(plan.status!=='ok'){
      show('Ups, coś poszło nie tak. Spróbuj ponownie.', 'err'); await say('Coś poszło nie tak.'); return;
    }

    // krok 1: jeśli intent = food → places
    if(plan.intent === 'food'){
      const q = plan?.entities?.cities?.[0] ? `pizzeria w ${plan.entities.cities[0]}` : 'pizzeria';
      const timeRaw = plan?.entities?.time?.raw || null;
      const count = plan?.count || 1;

      show('Szukam pizzerii…');
      const data = await apiPlaces({ query: q, n: 5, language: 'pl' });
      const list = (data?.results||data||[])
        .filter(r => r?.rating != null)
        .map(r => ({
          name: r.name,
          rating: Number(r.rating || 0),
          votes: Number(r.user_ratings_total || r.votes || 0),
          address: r.formatted_address || r.address || r.vicinity || '—'
        }))
        .sort((a,b)=> (b.rating-a.rating) || (b.votes-a.votes))
        .slice(0, Math.max(2, Math.min(3, count)));

      if(!list.length){ show('Nic nie znalazłem. Zmień frazę lub dodaj miasto.', 'warn'); await say('Nic nie znalazłem.'); return; }

      const line = list.map((x,i)=>`${i+1}) ${x.name} (${x.rating}★, ${x.address})`).join(' • ');
      show(`Top: ${line}`);
      await say(`Polecam: ${list[0].name}${list[1] ? ' oraz ' + list[1].name : ''}.`);

      // krótka podpowiedź z GPT (opcjonalnie)
      const g = await apiGPT(`Krótko (≤25 słów) zarekomenduj: ${line}. Zakończ CTA „Zamów we FreeFlow.”`);
      if(g?.reply){ show(g.reply); await say(g.reply); }
      return;
    }

    // krok 2: taxi → wyświetl, co brakuje
    if(plan.intent === 'taxi'){
      const f = plan.from || 'start';
      const t = plan.to || 'cel';
      const tt = plan?.entities?.time?.raw ? ` o ${plan.entities.time.raw}` : '';
      const msg = `Taxi: ${f} → ${t}${tt}.`;
      show(msg); await say(msg);
      return;
    }

    // krok 3: hotel
    if(plan.intent === 'hotel'){
      const c = plan?.entities?.cities?.[0] || '(miasto?)';
      const n = plan?.nights || 1;
      const d = plan?.entities?.date || '(data startu?)';
      const msg = `Hotel: ${c}, ${n} noce, od ${d}.`;
      show(msg); await say(msg);
      return;
    }

    // fallback – komunikat z plan.steps[0].message
    const next = plan?.steps?.[0]?.message || 'Powiedz: „dwie pizze w Krakowie”, „zamów taxi”, „nocleg w Warszawie”.';
    show(next, 'warn'); await say(next);
  }catch(e){
    console.error(e);
    show('Ups, coś poszło nie tak. Spróbuj ponownie.', 'err'); await say('Coś poszło nie tak.');
  }
}

// ---------- ASR (tylko po kliknięciu) ----------
let recognition=null, listeningState=false;
function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const rec = new SR();
  rec.lang = 'pl-PL'; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.onstart = ()=>{ listeningState=true; listening(true); ghost('Słucham… powiedz zamówienie.'); };
  rec.onresult = (ev)=>{
    let interim='', finalText='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const chunk = ev.results[i][0].transcript;
      if(ev.results[i].isFinal) finalText+=chunk; else interim+=chunk;
    }
    if(finalText){ rec.stop(); listeningState=false; listening(false); handleUserQuery(finalText.trim()); }
    else if(interim) ghost(interim.trim());
  };
  rec.onend = ()=>{
    listeningState=false; listening(false);
    if(!transcript.textContent.trim() || transcript.classList.contains('ghost')){
      ghost('Powiedz, co chcesz zamówić…');
    }
  };
  rec.onerror = ()=>{ show('Błąd rozpoznawania mowy — możesz wpisać ręcznie.', 'warn'); };
  return rec;
}
function toggleMic(){
  if(!recognition){
    const typed = prompt('Rozpoznawanie mowy niedostępne. Wpisz zamówienie:');
    if(typed && typed.trim()) handleUserQuery(typed.trim());
    return;
  }
  if(listeningState){ try{ recognition.stop(); }catch{} return; }
  try{ recognition.start(); }catch{}
}

// UI bindy
micBtn?.addEventListener('click', toggleMic);
logoBtn?.addEventListener('click', toggleMic);
document.addEventListener('DOMContentLoaded', ()=>{
  recognition = initASR();
  ghost('Powiedz, czego potrzebujesz…');
});
