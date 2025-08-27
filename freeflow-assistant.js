// FreeFlow – asystent (PL) – ASR → parser → GPT → Places → TTS
(() => {
  // ============ CONFIG ============
  function pick(metaName, winKey) {
    const m = document.querySelector(`meta[name="${metaName}"]`);
    if (m && m.content) return m.content.trim();
    if (winKey && window[winKey]) return String(window[winKey]).trim();
    return null;
  }
  const C = {
    lang: 'pl-PL',
    useWhisper: (pick('asr-provider','ASR_PROVIDER') || 'browser').toLowerCase()==='whisper',
    whisperUrl: pick('whisper-url','WHISPER_URL'),
    whisperAuth: pick('whisper-auth','WHISPER_AUTH'),
    gmapsProxy: pick('gmaps-proxy','GMAPS_PROXY'),
    gptProxy:   pick('gpt-proxy','GPT_PROXY'),
    maxList: 5,
    tts: true,
  };

  // ============ DOM ============
  const app        = document.getElementById('app');
  const transcript = document.getElementById('transcript');
  const micBtn     = document.getElementById('micBtn');
  const logoBtn    = document.getElementById('logoBtn');
  const dot        = document.getElementById('dot');
  const banner     = document.getElementById('banner');

  const tiles = {
    food:  document.getElementById('tileFood'),
    taxi:  document.getElementById('tileTaxi'),
    hotel: document.getElementById('tileHotel'),
  };

  // ============ UI helpers ============
  function setGhost(msg){ transcript.classList.add('ghost'); transcript.textContent = msg; }
  function setText(msg){ transcript.classList.remove('ghost'); transcript.textContent = msg; }
  function setListening(on){
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if(!on && !transcript.textContent.trim()){ setGhost('Powiedz, co chcesz zamówić…'); }
  }
  function speak(txt, lang=C.lang){
    if(!C.tts || !txt) return;
    try{ window.speechSynthesis.cancel(); }catch(_){}
    try{ const u = new SpeechSynthesisUtterance(txt); u.lang = lang; window.speechSynthesis.speak(u); }catch(_){}
  }
  function showInfo(msg){ if(!banner) return; banner.textContent = msg; banner.classList.remove('hidden'); }
  function hideInfo(){ if(!banner) return; banner.classList.add('hidden'); banner.textContent=''; }

  function selectTile(key){ Object.values(tiles).forEach(t=>t&&t.classList.remove('active')); tiles[key]&&tiles[key].classList.add('active'); }
  tiles.food?.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi?.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel?.addEventListener('click',()=>selectTile('hotel'));

  // ============ Normalizacja / Parser ============
  const corrections = [
    [/kaplic+oza/gi, 'capricciosa'],
    [/kapric+i?oza/gi, 'capricciosa'],
    [/kugelf?/gi, 'kugel'],
  ];
  function normalize(s){
    let out = (s||'').replace(/\b(\w{2,})\s+\1\b/gi,'$1').trim();
    for(const [re,to] of corrections) out = out.replace(re,to);
    return out;
  }
  function parseTime(textLower){
    const m = textLower.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    if(!m) return null;
    const hh = String(m[1]).padStart(2,'0');
    const mm = m[2] ? m[2] : '00';
    return `${hh}:${mm}`;
  }
  const numWords = {'jeden':1,'jedną':1,'jedno':1,'jedna':1,'jednego':1,'dwa':2,'dwie':2,'dwóch':2,'trzy':3,'cztery':4,'pięć':5,'sześć':6,'siedem':7,'osiem':8,'dziewięć':9,'dziesięć':10};
  function wantedCount(text){
    const n = text.match(/\b(\d{1,2})\b/); if(n){ const v=parseInt(n[1],10); if(v>=1&&v<=10) return v; }
    const w = text.toLowerCase().match(/\b(jed(en|ną|no|na|nego)|dwie|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć)\b/);
    return w ? (numWords[w[0]]||1) : 1;
  }
  const categoryMap = [
    { re: /(pizz|pizzer|restaurac|knajp|jedzeni|obiad|kolac)/i, query: 'restauracja' },
    { re: /(taxi|taksówk|przejazd)/i,                           query: 'taxi' },
    { re: /(hotel|nocleg)/i,                                    query: 'hotel' }
  ];
  function detectCategory(text){ for(const c of categoryMap) if(c.re.test(text)) return c.query; return null; }
  function detectNearPhrase(text){ const m = text.match(/\b(na|w|we|przy|koło|obok)\s+([a-ząćęłńóśżź\-]+[a-ząćęłńóśżź]+)\b/iu); return m ? m[0] : ''; }

  // ============ GEO ============
  async function getGeo(){
    if(!('geolocation' in navigator)) return null;
    return new Promise(resolve=>{
      navigator.geolocation.getCurrentPosition(
        pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude}),
        _=>resolve(null),
        {enableHighAccuracy:false, timeout:5000}
      );
    });
  }

  // ============ Places via PROXY ============
  function gmapsURL(path, params){
    const q = new URLSearchParams(params).toString();
    if(C.gmapsProxy){ return `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${q}`; }
    return `https://maps.googleapis.com${path}?${q}`; // tylko demo
  }
  async function placesTextSearch(query, around, radius=6000){
    if(!C.gmapsProxy){
      setGhost('Tryb DEMO (brak proxy Places).'); return [{ name:`Demo: ${query}`, formatted_address:'(demo)', rating:4.5 }];
    }
    const params = { query };
    if(around){ params.location = around; params.radius = radius; }
    try{
      const res = await fetch(gmapsURL('/maps/api/place/textsearch/json', params));
      if(!res.ok) throw new Error('HTTP '+res.status);
      const json = await res.json();
      return json.results?.slice(0, C.maxList) || [];
    }catch(e){ return [{ name:`Miejsce (offline): ${query}`, formatted_address:'—', rating:4.4 }]; }
  }
  function summarizePlaces(list, howMany=1){
    if(!Array.isArray(list) || !list.length) return null;
    const pick = list
      .map(r=>({name:r.name, rating:r.rating||null, vicinity:r.formatted_address||r.vicinity||''}))
      .sort((a,b)=>(b.rating||0)-(a.rating||0))
      .slice(0, howMany);
    const lines = pick.map((r,i)=>{
      const rt = typeof r.rating==='number' ? ` (${r.rating.toFixed(1)}★)` : (r.rating?` (${r.rating}★)`:'');
      return `${i+1}. ${r.name}${rt}${r.vicinity ? `, ${r.vicinity}`:''}`;
    });
    return { text: lines.join(' • '), topName: pick[0]?.name || '' };
  }

  // ============ GPT via PROXY ============
  async function askGPT(prompt){
    if(!C.gptProxy){ return null; }
    try{
      const res = await fetch(C.gptProxy, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt }) });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.reply || null;
    }catch(e){
      setText('Błąd GPT: '+e.message);
      return null;
    }
  }

  // ============ ASR ============
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listenOnce(){
    return new Promise((resolve,reject)=>{
      if(!ASR) return reject(new Error('Rozpoznawanie mowy wymaga Chrome/Edge (lub Whisper).'));
      const rec = new ASR();
      rec.lang = C.lang; rec.interimResults = true; rec.continuous = false;
      let interimLast = '';
      rec.onstart = ()=>{ setListening(true); setText('Słucham…'); hideInfo(); };
      rec.onerror = (e)=>{ setListening(false); reject(new Error('ASR błąd: '+(e.error||''))); };
      rec.onend   = ()=>{ setListening(false); if(interimLast) resolve(interimLast); };
      rec.onresult = (ev)=>{
        let finalText='', interim='';
        for(let i=ev.resultIndex;i<ev.results.length;i++){
          const t = ev.results[i][0].transcript;
          if(ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const raw = (finalText||interim).trim();
        if(interim) interimLast = interim.trim();
        setText(normalize(raw||''));
        if(finalText) resolve(finalText);
      };
      try{ rec.start(); }catch(err){ reject(err); }
    });
  }

  // ============ FLOW ============
  async function handleQuery(raw){
    const text = normalize(raw); setText(text);

    // dopytanie / rozumowanie (krótka korekta stylistyczna przez GPT)
    const time  = parseTime(text.toLowerCase());
    const count = wantedCount(text);
    const cat   = detectCategory(text);
    const near  = detectNearPhrase(text);

    let say = 'Okej.';
    if(time) say += ` Przyjmuję na ${time}.`;

    let geo = null, placesSummary = null;
    if(cat){
      geo = await getGeo(); // spyta o dostęp tylko przy potrzebie
      if(!geo) showInfo('Brak dostępu do lokalizacji — szukam ogólnie (możesz włączyć dostęp).');
      const around = geo ? `${geo.lat},${geo.lng}` : null;

      let q = cat;
      if (cat === 'restauracja' && /pizz/i.test(text)) q = 'pizzeria';
      if (near) q = `${q} ${near}`;

      const list = await placesTextSearch(q, around);
      placesSummary = summarizePlaces(list, Math.max(1, Math.min(count, C.maxList)));
    }

    // ładna 1-linijkowa odpowiedź GPT (opcjonalnie)
    if(C.gptProxy){
      const prompt = `Użytkownik powiedział: "${text}". Jeśli dotyczy jedzenia/taxi/hotelu i godziny "${time||'-'}", odpowiedz jednym krótkim zdaniem po polsku (maks 18 słów), z potwierdzeniem kontekstu.`;
      try{
        const nice = await askGPT(prompt);
        if(nice){ setText(nice); speak(nice); }
      }catch(_){}
    }

    if(placesSummary){
      if(count>1){
        setText(placesSummary.text);
        speak(`Mam ${count} propozycje. Najwyżej oceniana to ${placesSummary.topName}.`);
        return;
      }else{
        say += ` Najbliżej: ${placesSummary.topName}.`;
      }
    }

    setText(say);
    speak(say);
  }

  async function start(){
    try{
      const finalText = await listenOnce();
      await handleQuery(finalText);
    }catch(e){
      setText(e.message || 'Błąd rozpoznawania.');
    }
  }

  // bind
  logoBtn?.addEventListener('click', start, {passive:true});
  micBtn ?.addEventListener('click', start, {passive:true});
  setGhost('Powiedz, co chcesz zamówić…');

  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}})
})();
