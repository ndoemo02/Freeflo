;(() => {
// =============== CONFIG z <meta> lub window.* =================
function pick(metaName, winKey){
  const m = document.querySelector(`meta[name="${metaName}"]`);
  if (m && m.content) return m.content.trim();
  if (winKey && window[winKey]) return String(window[winKey]).trim();
  return '';
}
const C = {
  // ASR
  useWhisper : (pick('asr-provider','ASR_PROVIDER').toLowerCase()==='whisper'),
  whisperUrl : pick('whisper-url','WHISPER_URL'),
  whisperAuth: pick('whisper-auth','WHISPER_AUTH'),

  // OpenAI (opcjonalnie)
  openaiKey  : pick('openai-key','OPENAI_API_KEY'),
  openaiModel: pick('openai-model','OPENAI_MODEL') || 'gpt-4o-mini',

  // Google Places (opcjonalnie)
  gmapsKey   : pick('gmaps-key','GMAPS_KEY'),
  gmapsProxy : pick('gmaps-proxy','GMAPS_PROXY'),

  // OSM Overpass
  overpass   : pick('osm-overpass','OSM_OVERPASS') || 'https://overpass.kumi.systems/api/interpreter',
};

// =============== DOM =================
const app        = document.getElementById('app');
const logoBtn    = document.getElementById('logoBtn');
const micBtn     = document.getElementById('micBtn');
const transcript = document.getElementById('transcript');
const dot        = document.getElementById('dot');
const debugToast = document.getElementById('debugToast');

const tiles = {
  food : document.getElementById('tileFood'),
  taxi : document.getElementById('tileTaxi'),
  hotel: document.getElementById('tileHotel'),
};

// =============== UI helpers =================
let toastTimer = null;
function setDebug(msg, ms=2500){
  if(!debugToast) return;
  debugToast.textContent = msg;
  debugToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>debugToast.classList.remove('show'), ms);
}
const setListening = (on)=>{
  app.classList.toggle('listening', on);
  dot.style.background = on ? '#21d4fd' : '#86e2ff';
  if(!on && !transcript.textContent.trim()){
    setGhost('Powiedz, co chcesz zamówić…');
  }
};
const setGhost = (msg)=>{
  transcript.classList.add('ghost');
  transcript.textContent = msg;
};
const setText = (msg)=>{
  transcript.classList.remove('ghost');
  transcript.textContent = msg;
};
const speak = (txt, lang='pl-PL')=>{
  try{ window.speechSynthesis.cancel(); }catch(_){}
  try{
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = lang;
    window.speechSynthesis.speak(u);
  }catch(_){}
};
const selectTile = (key)=>{
  Object.values(tiles).forEach(t=>t.classList.remove('active'));
  tiles[key].classList.add('active');
};
tiles.food .addEventListener('click', ()=>selectTile('food'));
tiles.taxi .addEventListener('click', ()=>selectTile('taxi'));
tiles.hotel.addEventListener('click', ()=>selectTile('hotel'));

// =============== Normalizacja & parser =================
const corrections = [
  [/kaplic+oza/gi, 'capricciosa'],
  [/kapric+i?oza/gi, 'capricciosa'],
  [/kugelf/gi, 'kugel'], [/kugle?l/gi, 'kugel'],
  [/w\s+ariel\b/gi, 'w Arielu'], [/do\s+ariel\b/gi, 'do Ariela'],
];
function normalize(s){
  let out = s.replace(/\b(\w{2,})\s+\1\b/gi, '$1'); // "dwie dwie" → "dwie"
  for(const [re,to] of corrections) out = out.replace(re,to);
  return out.trim();
}
function parseOrder(s){
  const text = s.toLowerCase();
  const timeMatch = text.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
  const time = timeMatch ? `${String(timeMatch[1]).padStart(2,'0')}:${timeMatch[2]||'00'}` : null;
  const noTime = text.replace(/\b(?:na|o)\s*\d{1,2}(?::?\d{2})?\b/, ' ').replace(/\s{2,}/g,' ').trim();
  let dish = null;
  const dm = noTime.match(/[a-ząćęłńóśżź\- ]{3,}/i);
  if(dm){
    dish = dm[0].replace(/\b(i|a|na|do|w|z|o)\b.*$/,'').replace(/\s{2,}/g,' ').trim();
  }
  return { dish, time };
}

// =============== ASR: Whisper (opcjonalnie) =================
async function whisperListenOnce(){
  if(!C.whisperUrl) throw new Error('Brak konfiguracji Whisper.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  const stopPromise = new Promise((resolve)=>{ rec.onstop = resolve; });
  rec.ondataavailable = (e)=>{ if(e.data && e.data.size) chunks.push(e.data); };
  setListening(true); setText('Słucham… (Whisper)');
  rec.start();
  const stop = ()=>{ try{rec.stop()}catch(_){ } window.removeEventListener('click', stop, true); };
  window.addEventListener('click', stop, true);
  await stopPromise; setListening(false);
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const form = new FormData(); form.append('audio', blob, 'speech.webm');
  const headers = C.whisperAuth ? { 'Authorization': C.whisperAuth } : {};
  const res = await fetch(C.whisperUrl, { method:'POST', headers, body: form });
  if(!res.ok){ const t = await res.text().catch(()=> ''); throw new Error(`Whisper ${res.status}: ${t}`); }
  const data = await res.json().catch(()=> ({}));
  if(!data || !data.text) throw new Error('Whisper: brak pola "text" w odpowiedzi.');
  return data.text;
}

// =============== ASR: Web Speech (domyślnie) =================
const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
function browserListenOnce(){
  return new Promise((resolve, reject)=>{
    if(!ASR) return reject(new Error('Brak Web Speech API (użyj Chrome/Edge albo Whisper).'));
    const rec = new ASR();
    rec.lang = 'pl-PL'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = ()=>{ setListening(true); setText('Słucham…'); };
    rec.onerror = (e)=>{ setListening(false); reject(new Error('ASR błąd: '+(e.error||''))); };
    rec.onend = ()=>{ setListening(false); };
    rec.onresult = (ev)=>{
      let finalText = '', interim = '';
      for(let i=ev.resultIndex; i<ev.results.length; i++){
        const t = ev.results[i][0].transcript;
        if(ev.results[i].isFinal) finalText += t; else interim += t;
      }
      const raw = (finalText || interim).trim();
      setText(normalize(raw || ''));
      if(finalText) resolve(finalText);
    };
    try{ rec.start(); }catch(err){ reject(err); }
  });
}

// =============== OpenAI (opcjonalnie) =================
async function gptSumm(apiKey, text, dish, time){
  const body = {
    model: C.openaiModel,
    messages: [
      { role: 'system', content:
        'Jesteś asystentem zamówień FreeFlow. Odpowiadasz po polsku, krótko i naturalnie. Jedno zdanie, max 18 słów.' },
      { role: 'user', content:
        `Transkrypcja: "${text}". ${dish?`Danie: ${dish}. `:''}${time?`Godzina: ${time}. `:''}Zwróć zwięzłe potwierdzenie.` }
    ],
    temperature: 0.3, max_tokens: 60
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// =============== OSM / Google HYBRYDA =================
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const cacheGet = (k,maxAgeMs=86400000)=>{
  try{ const o=JSON.parse(localStorage.getItem(k)||'null'); if(!o) return null;
       if(Date.now()-o.t>maxAgeMs) return null; return o.v; }catch(_){ return null;}
};
const cacheSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify({t:Date.now(),v})) }catch(_){} };

function synthMenu(cuisine='włoska'){
  const CUI = (cuisine||'').toLowerCase();
  if(CUI.includes('włos')) return [
    {name:'Margherita', price:26},{name:'Capricciosa', price:32},{name:'Diavola', price:34},{name:'Carbonara', price:35}
  ];
  if(CUI.includes('sushi')||CUI.includes('japo')) return [
    {name:'California roll', price:28},{name:'Nigiri łosoś', price:24},{name:'Ramen shoyu', price:36}
  ];
  if(CUI.includes('indyj')) return [
    {name:'Butter Chicken', price:39},{name:'Paneer Tikka', price:34},{name:'Garlic Naan', price:12}
  ];
  return [{name:'Pierogi ruskie', price:24},{name:'Schabowy', price:38},{name:'Żurek', price:19}];
}

// OSM
async function osmSearchRestaurants(query){
  const radius = query.radiusM || 6000;
  let around = '';
  if(query.lat && query.lon){
    around = `around:${radius},${query.lat},${query.lon}`;
  }else if(query.city){
    const geores = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query.city)}`);
    const g = (await geores.json())[0];
    if(!g) return [];
    around = `around:${radius},${g.lat},${g.lon}`;
    query.lat=g.lat; query.lon=g.lon;
    await sleep(400);
  }
  const nameFilter = query.name ? `["name"~"${query.name}",i]` : '';
  const cuisineFilter = query.cuisine ? `["cuisine"~"${query.cuisine}",i]` : '';
  const overpassQL = `
    [out:json][timeout:25];
    (
      node["amenity"~"restaurant|fast_food|cafe"]${nameFilter}${cuisineFilter}(${around});
      way ["amenity"~"restaurant|fast_food|cafe"]${nameFilter}${cuisineFilter}(${around});
    );
    out center 50;`.trim();

  const body = new URLSearchParams({ data: overpassQL });
  const res = await fetch(C.overpass, { method:'POST', body });
  if(!res.ok) return [];
  const json = await res.json();
  return (json.elements||[]).map(e=>({
    provider: 'OSM',
    id: `osm_${e.id}`,
    name: e.tags?.name || 'Restauracja',
    cuisine: e.tags?.cuisine || '',
    address: e.tags?.['addr:full'] || [e.tags?.['addr:street'], e.tags?.['addr:housenumber'], e.tags?.['addr:city']].filter(Boolean).join(' '),
    lat: e.lat || e.center?.lat, lon: e.lon || e.center?.lon,
    opening_hours: e.tags?.opening_hours || null
  }));
}

// Google Places
function gmapsURL(path, params){
  const q = new URLSearchParams(params).toString();
  return C.gmapsProxy
    ? `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${q}`
    : `https://maps.googleapis.com${path}?${q}`;
}
async function gmapsTextSearch(q){
  if(!C.gmapsKey) return [];
  const url = gmapsURL('/maps/api/place/textsearch/json', { query:q, key:C.gmapsKey });
  const r = await fetch(url); if(!r.ok) return [];
  const j = await r.json();
  return (j.results||[]).map(x=>({
    provider:'GOOGLE',
    id: x.place_id,
    name: x.name,
    address: x.formatted_address,
    lat: x.geometry?.location?.lat,
    lon: x.geometry?.location?.lng,
    open_now: x.opening_hours?.open_now ?? null
  }));
}
async function gmapsDetails(place_id){
  if(!C.gmapsKey) return null;
  const url = gmapsURL('/maps/api/place/details/json', {
    place_id, key:C.gmapsKey, fields:'name,formatted_address,opening_hours,website'
  });
  const r = await fetch(url); if(!r.ok) return null;
  const j = await r.json();
  return j.result || null;
}

// HYBRYDA
async function findRestaurantsHybrid({city, cuisine, name, lat, lon}){
  const cacheKey = `find|${city||''}|${cuisine||''}|${name||''}|${lat||''}|${lon||''}`;
  const cached = cacheGet(cacheKey);
  if(cached) return cached;

  let list = await osmSearchRestaurants({city,cuisine,name,lat,lon});
  const needGoogle = !list.length || (name && list.length < 3);

  if(needGoogle && C.gmapsKey){
    const q = [name, cuisine, 'restaurant', city].filter(Boolean).join(' ');
    const g = await gmapsTextSearch(q);
    list = [...g.slice(0,3), ...list].slice(0,10);
  }
  if(!list.length){
    list = [{
      provider:'DEMO',
      id:'demo_'+Date.now(),
      name:`Syntetyczna ${cuisine||'Restauracja'}`,
      address: city || 'Twoja okolica',
      lat, lon
    }];
  }
  cacheSet(cacheKey, list);
  return list;
}

async function getMenuForPlace(p){
  if(p.provider==='GOOGLE' && p.id){
    const det = await gmapsDetails(p.id);
    if(det && det.website){
      // tu można dodać własny backend scraper menu
      // np. const menu = await fetch(`/api/scrape?url=${encodeURIComponent(det.website)}`).then(r=>r.json());
      // if(menu && menu.length) return menu;
    }
  }
  const cui = p.cuisine || (p.name?.toLowerCase().includes('pizza') ? 'włoska' : '');
  return synthMenu(cui || 'polska');
}

// =============== FLOW =================
async function handleFinalText(rawText){
  const text = normalize(rawText);
  setText(text);

  const { dish, time } = parseOrder(text);

  // lokalne potwierdzenie
  let say = 'OK.';
  if(dish) say += ` Zamawiam ${dish}.`;
  if(time) say += ` Na ${time}.`;
  speak(say);

  // GPT – ładne zdanie (opcjonalnie)
  if(C.openaiKey){
    try{
      const nice = await gptSumm(C.openaiKey, text, dish, time);
      if(nice){ setText(nice); speak(nice); }
    }catch(e){ /* cicho */ }
  }

  // heurystyka: czy szukamy restauracji?
  if(/pizza|pizz|restaurac|kuchnia|sushi|kebab|pierog|burger/i.test(text)){
    try{
      // proste wydłubanie nazwy/miasta
      const name = (text.match(/w\s+([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\-]+)/i)||[])[1] || '';
      const city = (text.match(/\b(?:w|na)\s+([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\-]+)\b/)||[])[1] || '';
      const cuisine = /włos|pizza/i.test(text) ? 'italian'
                     : /sushi|japoń/i.test(text) ? 'japanese'
                     : /kebab|tureck/i.test(text) ? 'turkish' : '';

      const places = await findRestaurantsHybrid({ city, cuisine, name });
      const top = places[0];
      const menu = await getMenuForPlace(top);

      setDebug(`Źródło: ${top.provider}. ${top.name}${top.address?`, ${top.address}`:''}`);
      speak(`Najbliżej masz ${top.name}. Proponuję ${menu[0].name}. Zamawiam?`);
    }catch(e){
      setDebug('Szukam, ale wystąpił błąd. Spróbuj doprecyzować.', 3000);
    }
  }
}

async function startListening(){
  try{
    if(C.useWhisper){
      const txt = await whisperListenOnce();
      await handleFinalText(txt);
    }else{
      const txt = await browserListenOnce();
      await handleFinalText(txt);
    }
  }catch(e){
    setText(e.message || 'Błąd rozpoznawania.');
    setDebug('ASR: '+(e.message||'błąd'), 2500);
  }
}

[logoBtn, micBtn].forEach(el=> el.addEventListener('click', startListening, { passive:true }));
setGhost('Powiedz, co chcesz zamówić…');

// sprzątanie TTS przy wyjściu
window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
