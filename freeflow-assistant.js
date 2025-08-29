/* ----- DOM ----- */
const $ = (s)=>document.querySelector(s);
const transcript = $('#transcript');
const banner = $('#banner');
const micBtn = $('#micBtn');
const logoBtn = $('#logoBtn');
const dot = document.createElement('div'); // tylko dla klasy .listening

/* ----- proxies from <meta> ----- */
const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();
const TTS_PROXY   = (document.querySelector('meta[name="tts-proxy"]')?.content   || '/api/tts').trim();

/* ----- UI helpers ----- */
function showBanner(msg, type='info'){
  if (!banner) return;
  banner.textContent = msg || '';
  banner.classList.remove('hidden');
  if (type==='err'){ banner.style.background='rgba(255,72,72,.15)'; banner.style.color='#ffd1d1'; }
  else if (type==='warn'){ banner.style.background='rgba(255,203,72,.15)'; banner.style.color='#ffe6a3'; }
  else { banner.style.background='rgba(72,179,255,.12)'; banner.style.color='#dff1ff'; }
}
function hideBanner(){ banner?.classList.add('hidden'); if (banner) banner.textContent=''; }
function setGhost(t){ transcript?.classList.add('ghost'); if (transcript) transcript.textContent=t; }
function setText(t){ transcript?.classList.remove('ghost'); if (transcript) transcript.textContent=t; }
function setListening(on){ document.body.classList.toggle('listening', !!on); }

/* ----- GEO ----- */
async function getPositionOrNull(timeout=6000){
  if (!('geolocation' in navigator)) return null;
  const p = () => new Promise((res,rej)=>{
    navigator.geolocation.getCurrentPosition(
      (pos)=>res(pos.coords), (err)=>rej(err),
      {enableHighAccuracy:true, timeout, maximumAge:25000}
    );
  });
  try{ return await p(); }catch{ return null; }
}

/* ----- intent / city ----- */
function parseIntent(text){
  const t = (text||'').trim();
  const re = /(pizzeria|pizza|restauracja|restauracje|kebab|sushi|hotel|nocleg|taxi)(?:.*?(?:\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)))?/i;
  const m = t.match(re);
  if (!m) return {keyword:null, city:null};
  const base = m[1].toLowerCase();
  const keyword =
    /restaurac/.test(base) ? 'restauracje' :
    /pizz/.test(base)      ? 'pizzeria'    :
    /(hotel|nocleg)/.test(base) ? 'hotel'   :
    /taxi/.test(base)      ? 'taxi'        : base;
  const city = m[2] || null;
  return { keyword, city };
}

/* ----- backend calls ----- */
async function callPlaces(params){
  const sp=new URLSearchParams();
  for (const [k,v] of Object.entries(params)) if (v!=null && v!=='') sp.set(k,String(v));
  const r = await fetch(`${GMAPS_PROXY}?${sp.toString()}`);
  if (!r.ok) throw new Error(`Places ${r.status}`);
  return r.json();
}
async function callGPT(prompt){
  try{
    const r = await fetch(GPT_PROXY, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt})});
    if (!r.ok) return null;
    return r.json();
  }catch{ return null; }
}

/* ----- TTS (Google → fallback Web Speech) ----- */
const sayQ=[]; let speaking=false;
async function speak(text){ sayQ.push(text); if (speaking) return; speaking=true;
  while (sayQ.length){
    const t=sayQ.shift();
    const ok = await speakGoogle(t);
    if (!ok) await speakWeb(t);
  } speaking=false;
}
async function speakGoogle(text){
  try{
    const r=await fetch(TTS_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,lang:'pl-PL',voice:'pl-PL-Wavenet-D'})});
    const j=await r.json(); if (!j?.audioContent) return false;
    const audio=new Audio(`data:audio/mp3;base64,${j.audioContent}`); await audio.play();
    await new Promise(res=>audio.addEventListener('ended',res,{once:true}));
    return true;
  }catch{ return false; }
}
function speakWeb(text){
  return new Promise((res)=>{
    try{
      if (!('speechSynthesis' in window)) return res(true);
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text); u.lang='pl-PL';
      const go=()=>{const v=window.speechSynthesis.getVoices()||[]; u.voice=v.find(x=>/pl[-_]PL/i.test(x.lang||''))||v.find(x=>/polish/i.test(x.name||''))||null; window.speechSynthesis.speak(u);};
      u.onend=()=>res(true); u.onerror=()=>res(true);
      const v=window.speechSynthesis.getVoices(); if(!v.length){window.speechSynthesis.onvoiceschanged=()=>{go(); window.speechSynthesis.onvoiceschanged=null;}; setTimeout(()=>window.speechSynthesis.getVoices(),0);} else go();
    }catch{ res(true); }
  });
}

/* ----- main flow ----- */
async function handleQuery(userText){
  setText(userText);
  const {keyword, city}=parseIntent(userText);
  const coords = await getPositionOrNull(6000);

  const params={ language:'pl', n:2 };
  if (city){                 // użytkownik podał miasto → ignorujemy GPS
    params.query = `${keyword||''} w ${city}`.trim();
    showBanner(`Szukam w ${city}…`);
  } else if (coords){        // bez miasta → użyj GPS
    params.lat = coords.latitude.toFixed(6);
    params.lng = coords.longitude.toFixed(6);
    params.rankby = 'distance';
    if (keyword) params.keyword = keyword;
    showBanner('Szukam w okolicy…');
  } else if (keyword){       // brak GPS → tekstowe wyszukiwanie
    params.query = keyword;
    showBanner('Szukam…');
  } else {
    showBanner('Nie rozumiem. Spróbuj: „najlepsza pizzeria w Krakowie”.','warn');
    await speak('Nie rozumiem. Powiedz na przykład: najlepsza pizzeria w Krakowie.');
    return;
  }

  try{
    const data = await callPlaces(params);
    const rows = (data?.results||[])
      .map(x=>({name:x.name, rating:x.rating??null, address:x.address||x.formatted_address||x.vicinity||'—'}))
      .filter(x=>x.name)
      .sort((a,b)=> (b.rating??0)-(a.rating??0));

    if (!rows.length){
      showBanner('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.','warn');
      await speak('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.');
      return;
    }

    // UI + mowa – krótko, naturalnie
    if (rows.length===1){
      const a=rows[0];
      const line=`Najlepsze w pobliżu: ${a.name} (${(a.rating??'–')} gw.).`;
      showBanner(line); await speak(line);
    } else {
      const [a,b]=rows;
      showBanner(`Top 2: 1) ${a.name} (${a.rating??'–'}★) • 2) ${b.name} (${b.rating??'–'}★)`);
      await speak(`Top dwa: ${a.name} i ${b.name}.`);
    }

    // krótkie CTA z GPT (jeśli backend działa)
    const short = await callGPT(
      `Krótko po polsku (max 25 słów) poleć 1–2 miejsc(a) z: ${
        rows.slice(0,2).map(r=>`${r.name} (${r.rating??'–'}★)`).join('; ')
      }. Zakończ: "Skorzystaj z aplikacji FreeFlow, aby zamówić szybko i wygodnie!".`
    );
    if (short?.reply){
      const t = String(short.reply).replace(/^echo[:\-\s]*/i,'').trim();
      if (t) { showBanner(t); await speak(t); }
    }
  }catch(e){
    console.error(e);
    showBanner('Ups, coś poszło nie tak. Spróbuj ponownie.','err');
    await speak('Coś poszło nie tak. Spróbuj ponownie.');
  }
}

/* ----- ASR ----- */
let recognition=null, listening=false;
function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec=new SR(); rec.lang='pl-PL'; rec.interimResults=true; rec.maxAlternatives=1;
  rec.onstart=()=>{listening=true; setListening(true); setGhost('Słucham…');};
  rec.onresult=(ev)=>{
    let interim='',final='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const ch=ev.results[i][0].transcript;
      if(ev.results[i].isFinal) final+=ch; else interim+=ch;
    }
    if(final){ setText(final.trim()); try{rec.stop();}catch{} listening=false; setListening(false); handleQuery(final.trim()); }
    else if(interim){ setGhost(interim.trim()); }
  };
  rec.onerror=()=>{ showBanner('Błąd rozpoznawania mowy. Spróbuj ponownie lub wpisz ręcznie.','warn'); };
  rec.onend=()=>{ listening=false; setListening(false); if(!transcript.textContent || transcript.classList.contains('ghost')) setGhost('Powiedz, co chcesz zamówić…'); };
  return rec;
}
function toggleMic(){
  if(!recognition){
    const typed=prompt('Rozpoznawanie mowy niedostępne. Wpisz, co chcesz zamówić:');
    if(typed && typed.trim()) { setText(typed.trim()); handleQuery(typed.trim()); }
    return;
  }
  if(listening){ try{recognition.stop();}catch{} }
  else{
    try{recognition.start();}
    catch{
      const typed=prompt('Nie udało się włączyć mikrofonu. Wpisz, co chcesz zamówić:');
      if(typed && typed.trim()) { setText(typed.trim()); handleQuery(typed.trim()); }
    }
  }
}

/* ----- bind + boot ----- */
function bindUI(){
  $('#tileFood')?.classList.add('active');
  $('#tileFood')?.addEventListener('click', ()=>['#tileFood','#tileTaxi','#tileHotel'].forEach(s=>$(s)?.classList.toggle('active', s==='#tileFood')));
  $('#tileTaxi')?.addEventListener('click', ()=>['#tileFood','#tileTaxi','#tileHotel'].forEach(s=>$(s)?.classList.toggle('active', s==='#tileTaxi')));
  $('#tileHotel')?.addEventListener('click',()=>['#tileFood','#tileTaxi','#tileHotel'].forEach(s=>$(s)?.classList.toggle('active', s==='#tileHotel')));

  micBtn?.addEventListener('click', toggleMic);
  logoBtn?.addEventListener('click', toggleMic);
  setGhost('Powiedz, co chcesz zamówić…');
}
(function bootstrap(){
  recognition=initASR();
  bindUI();
  getPositionOrNull(3000).catch(()=>{});
})();
