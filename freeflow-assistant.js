/* === DOM === */
const $ = s => document.querySelector(s);
const transcript = $('#transcript');
const micBtn = $('#micBtn');
const logoBtn = $('#logoBtn');
const dot = $('#dot');
const banner = $('#banner');
const ctaRow = $('#ctaRow');
const btnOrder = $('#btnOrder');
const btnAlt = $('#btnAlt');

/* === Meta (z <meta ...>) === */
const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();

/* === UI helpers === */
const showBanner = (msg, type='info')=>{
  if (!banner) return;
  banner.textContent = msg || '';
  banner.classList.remove('hidden');
  banner.style.background =
    type==='err' ? 'rgba(255,72,72,.15)' :
    type==='warn'? 'rgba(255,203,72,.15)' : 'rgba(72,179,255,.12)';
};
const hideBanner = ()=>{ banner?.classList.add('hidden'); banner && (banner.textContent=''); };
const setGhost = t=>{ transcript?.classList.add('ghost'); if (transcript) transcript.textContent=t; };
const setFinal = t=>{ transcript?.classList.remove('ghost'); if (transcript) transcript.textContent=t; };
const setListening = on=>{ document.body.classList.toggle('listening', !!on); if (dot) dot.style.boxShadow = on?'0 0 18px #86e2ff':'0 0 0 #0000'; };

/* === GEO === */
async function getPositionOrNull(timeoutMs=6000){
  if (!('geolocation' in navigator)) return null;
  const once = () => new Promise((res,rej)=>{
    navigator.geolocation.getCurrentPosition(
      p=>res(p.coords),
      e=>rej(e),
      {enableHighAccuracy:true,timeout:timeoutMs,maximumAge:25000}
    );
  });
  try { return await once(); } catch { return null; }
}

/* === Intencja → „pizzeria|restauracje … w Mieście” === */
function extractQuery(text){
  const t=(text||'').trim();
  const re=/(pizzeria|pizze|pizza|restauracja|restauracje|kebab|sushi)(.*?)(?:\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+))?/i;
  const m=t.match(re); if(!m) return null;
  const base=(m[1]||'').toLowerCase();
  const city=m[3]?` w ${m[3]}`:'';
  const norm=/restaurac/.test(base)?'restauracje':/pizz/.test(base)?'pizzeria':base;
  return (norm+city).trim();
}

/* === Backend calls === */
async function callPlaces(params){
  const sp=new URLSearchParams();
  if (params.query) sp.set('query', params.query);
  if (params.lat) sp.set('lat', params.lat);
  if (params.lng) sp.set('lng', params.lng);
  if (params.rankby) sp.set('rankby', params.rankby);
  sp.set('language', 'pl');
  sp.set('n', String(params.n||2));
  const r=await fetch(`${GMAPS_PROXY}?${sp.toString()}`); 
  if(!r.ok) throw new Error('Places '+r.status);
  return r.json();
}

/* === TTS kolejka === */
const q=[]; let busy=false;
async function speak(text){
  q.push(text); if (busy) return; busy=true;
  while(q.length){
    const t=q.shift();
    const ok=await speakCloud(t);
    if(!ok) await speakWeb(t);
  }
  busy=false;
}
async function speakCloud(text){
  try{
    const r=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,lang:'pl-PL',voice:'pl-PL-Wavenet-D'})});
    const j=await r.json(); if(!j?.audioContent) return false;
    const a=new Audio('data:audio/mp3;base64,'+j.audioContent);
    await a.play(); await new Promise(res=>a.addEventListener('ended',res,{once:true}));
    return true;
  }catch{return false}
}
function speakWeb(text){
  return new Promise(res=>{
    try{
      if(!('speechSynthesis' in window)) return res(true);
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text); u.lang='pl-PL';
      const choose=()=>{const v=window.speechSynthesis.getVoices()||[];
        u.voice=v.find(x=>/pl[-_]PL/i.test(x.lang||''))||v.find(x=>/polish/i.test(x.name||''))||v[0]||null;
        window.speechSynthesis.speak(u);
      };
      u.onend=()=>res(true); u.onerror=()=>res(true);
      const vs=window.speechSynthesis.getVoices();
      if(!vs||vs.length===0){ window.speechSynthesis.onvoiceschanged=()=>{choose(); window.speechSynthesis.onvoiceschanged=null}; setTimeout(()=>window.speechSynthesis.getVoices(),0);}
      else choose();
    }catch{res(true)}
  });
}

/* === Flow główny === */
let lastResults=null;
async function handleUserQuery(userText){
  setFinal(userText);
  const coords = await getPositionOrNull(6000);
  const q = extractQuery(userText);
  const params = { n:2 };

  if (coords && !/ w [A-ZĄĆĘŁŃÓŚŹŻ]/.test(userText)) {
    params.lat = coords.latitude.toFixed(6);
    params.lng = coords.longitude.toFixed(6);
    params.rankby = 'distance';
    if (q) params.query = q;
  } else if (q) {
    params.query = q;
  } else {
    showBanner('Powiedz np. „najlepsza pizzeria w Krakowie”.','warn');
    await speak('Powiedz na przykład: najlepsza pizzeria w Krakowie.');
    return;
  }

  showBanner('Szukam…'); lastResults=null; ctaRow?.classList.add('hidden');

  const data = await callPlaces(params);
  const list = (data?.results||[])
    .map(x=>({
      name:x.name, rating:x.rating ?? null,
      address:x.address ?? x.formatted_address ?? x.vicinity ?? '',
      distanceText:x.distanceText ?? null
    }))
    .slice(0,2);

  if (!list.length){ showBanner('Brak wyników. Spróbuj inną frazę.','warn'); await speak('Nie znalazłem nic w pobliżu. Spróbuj inną frazę.'); return; }

  lastResults = list;

  if (list.length===1){
    const a=list[0];
    const line = a.distanceText ? `Najbliżej masz do ${a.name}, około ${a.distanceText}. Złożyć zamówienie w FreeFlow?`
                                : `Polecam ${a.name}. Złożyć zamówienie w FreeFlow?`;
    showBanner(`${line} ${a.address?`(${a.address})`:''}`);
    await speak(line);
  }else{
    const [a,b]=list;
    const line = (a.distanceText||b.distanceText)
      ? `Najbliżej masz do ${a.name} — ${a.distanceText}. Druga opcja: ${b.name}, ${b.distanceText}. Wolisz złożyć zamówienie, czy wybrać alternatywę w FreeFlow?`
      : `Top dwa: ${a.name} i ${b.name}. Wolisz złożyć zamówienie, czy alternatywę w FreeFlow?`;
    showBanner(`Top 2: 1) ${a.name} (${a.rating??'–'}★) • 2) ${b.name} (${b.rating??'–'}★)`);
    await speak(line);
  }
  ctaRow?.classList.remove('hidden');
}

/* === ASR === */
let recognition=null, listening=false;
function initASR(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return null;
  const rec=new SR(); rec.lang='pl-PL'; rec.interimResults=true; rec.maxAlternatives=1;
  rec.onstart=()=>{listening=true; setListening(true); setGhost('Słucham…');};
  rec.onresult=e=>{
    let interim='', final=''; for(let i=e.resultIndex;i<e.results.length;i++){const ch=e.results[i][0].transcript; e.results[i].isFinal?final+=ch:interim+=ch;}
    if(final){ setFinal(final.trim()); try{rec.stop()}catch{} listening=false; setListening(false); handleUserQuery(final.trim()); }
    else if(interim){ setGhost(interim.trim()); }
  };
  rec.onerror=()=>{ showBanner('Błąd rozpoznawania mowy. Spróbuj ponownie.','warn'); };
  rec.onend=()=>{ listening=false; setListening(false); if(transcript?.classList.contains('ghost')||!transcript?.textContent?.trim()) setGhost('Powiedz, co chcesz zamówić…'); };
  return rec;
}
function toggleMic(){
  if(!recognition){
    const typed=prompt('Wpisz, co chcesz zamówić:'); if(typed?.trim()){ setFinal(typed.trim()); handleUserQuery(typed.trim()); }
    return;
  }
  if(listening){ try{recognition.stop()}catch{} } else { try{recognition.start()}catch{
    const typed=prompt('Nie udało się włączyć mikrofonu. Wpisz, co chcesz zamówić:'); if(typed?.trim()){ setFinal(typed.trim()); handleUserQuery(typed.trim()); }
  }}
}

/* === CTA (placeholders) === */
btnOrder?.addEventListener('click', async ()=>{
  if(!lastResults?.length) return;
  const pick = lastResults[0];
  showBanner(`Zaczynam składanie zamówienia w ${pick.name}…`);
  await speak(`Zaczynam składanie zamówienia w ${pick.name}.`);
  // TODO: tu wywołasz swój koszyk / integrację z partnerem
});
btnAlt?.addEventListener('click', async ()=>{
  if(!lastResults?.[1]) return;
  const alt = lastResults[1];
  showBanner(`Alternatywa: ${alt.name}.`);
  await speak(`Alternatywa: ${alt.name}.`);
});

/* === Start === */
(function(){
  recognition = initASR();
  $('#micBtn')?.addEventListener('click', toggleMic);
  $('#logoBtn')?.addEventListener('click', toggleMic);
  setGhost('Powiedz, co chcesz zamówić…');
})();
