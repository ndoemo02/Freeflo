;(() => {
  // ---------- CONFIG ----------
  function pick(metaName){ const m=document.querySelector(`meta[name="${metaName}"]`); return m?.content?.trim()||''; }
  const C = {
    asrProvider: (pick('asr-provider')||'browser').toLowerCase(),
    gmapsProxy: pick('gmaps-proxy') || '',     // Vercel: /api/places
    gptProxy:   pick('gpt-proxy')   || '',     // Vercel: /api/gpt
  };

  // ---------- DOM ----------
  const app        = document.getElementById('app');
  const logoBtn    = document.getElementById('logoBtn');
  const micBtn     = document.getElementById('micBtn');
  const transcript = document.getElementById('transcript');
  const dot        = document.getElementById('dot');
  const banner     = document.getElementById('banner');
  const tiles = {
    food:  document.getElementById('tileFood'),
    taxi:  document.getElementById('tileTaxi'),
    hotel: document.getElementById('tileHotel'),
  };

  // ---------- UI helpers ----------
  const showBanner = (msg)=>{ banner.textContent = msg; banner.classList.remove('hidden'); };
  const hideBanner = ()=> banner.classList.add('hidden');

  const setListening = (on)=>{
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if(!on && !transcript.textContent.trim()) setGhost('Powiedz, co chcesz zamówić…');
  };
  const setGhost = (msg)=>{ transcript.classList.add('ghost'); transcript.textContent = msg; };
  const setText  = (msg)=>{ transcript.classList.remove('ghost'); transcript.textContent = msg; };

  const speak = (txt)=>{
    try{ speechSynthesis.cancel(); }catch(_){}
    try{
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = 'pl-PL';
      const pl = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('pl'));
      if (pl) u.voice = pl;
      speechSynthesis.speak(u);
    }catch(_){}
  };

  const selectTile = (key)=>{
    Object.values(tiles).forEach(t=>t.classList.remove('active'));
    tiles[key].classList.add('active');
  };
  tiles.food.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel.addEventListener('click',()=>selectTile('hotel'));

  // ---------- Normalizacja PL ----------
  const correctionsPL = [
    [/kaplic+oza/gi,'capricciosa'], [/kapryc+i?oza/gi,'capricciosa'], [/kapric+i?osa/gi,'capricciosa'],
    [/kugelf/gi,'kugel'], [/kugle?l/gi,'kugel'],
    [/\bw\s+arielu\b/gi,'w Arielu'], [/\bw\s+ariel\b/gi,'w Arielu'], [/\bdo\s+ariel\b/gi,'do Ariela'],
    [/\bna\s+wpół\s+do\b/gi,'na 30 po'],
    [/\bkwadrans\s+po\b/gi,'15 po'], [/\bza\s+kwadrans\b/gi,'za 15'],
  ];
  function normalize(s){
    let out = s.replace(/\b(\w{2,})\s+\1\b/gi,'$1');
    for (const [re,to] of correctionsPL) out = out.replace(re,to);
    return out.trim();
  }

  // ---------- Parser ----------
  function parseOrder(s){
    const text = s.toLowerCase();

    // godzina HH:MM lub HH
    const m = text.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    const time = m ? `${String(m[1]).padStart(2,'0')}:${m[2]||'00'}` : null;

    // „za 15” → +15 minut (tylko do komunikatu)
    const rel = text.match(/\bza\s+(\d{1,2})\b/);
    const relMin = rel ? parseInt(rel[1],10) : null;

    // danie – cokolwiek sensownego, bez przyimków ogonowych
    const noTime = text.replace(/\b(?:na|o)\s*\d{1,2}(?::?\d{2})?\b/,' ').replace(/\s{2,}/g,' ');
    const dm = noTime.match(/[a-ząćęłńóśżź0-9\- ]{3,}/i);
    const dish = dm ? dm[0].replace(/\b(i|a|na|do|w|z|o)\b.*$/,'').trim() : null;

    return { dish, time, relMin };
  }

  // ---------- Geolokalizacja ----------
  let geo = null;   // {lat,lng}
  async function ensureGeoloc(){
    if (geo) return geo;
    if (!('geolocation' in navigator)) {
      showBanner('Brak geolokalizacji: przeglądarka nie wspiera. Użyję zapytań ogólnych.');
      return null;
    }
    try{
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:8000}));
      geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hideBanner();
      return geo;
    }catch(err){
      showBanner('Nie mam dostępu do lokalizacji — wyszukuję globalnie (możesz udzielić zgody w przeglądarce).');
      return null;
    }
  }

  // ---------- ASR (browser) ----------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function browserListenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR) return reject(new Error('Brak Web Speech API (Chrome/Edge).'));
      const rec = new ASR();
      rec.lang = 'pl-PL';
      rec.interimResults = true;
      rec.continuous = false;

      rec.onstart = ()=>{ setListening(true); setText('Słucham…'); };
      rec.onerror = (e)=>{ setListening(false); reject(new Error('ASR błąd: '+(e.error||''))); };
      rec.onend   = ()=>{ setListening(false); };
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

  // ---------- GPT nice summary (proxy) ----------
  async function niceReply(input, dish, time){
    if(!C.gptProxy) return '';
    const res = await fetch(C.gptProxy, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ input, dish, time })
    });
    if(!res.ok) return '';
    const data = await res.json().catch(()=>({}));
    return data.text || '';
  }

  // ---------- Places (proxy) ----------
  function q(obj){ return new URLSearchParams(obj).toString(); }

  async function placesTextSearch({query, lat, lng, radius=6000}){
    if(!C.gmapsProxy){
      // demo fallback (bez klucza/proxy)
      return [{ name:`Syntetyczna knajpa: ${query}`, place_id:`demo_${Date.now()}` }];
    }
    const url = `${C.gmapsProxy}?type=textsearch&${q({query,lat,lng,radius})}`;
    const res = await fetch(url);
    if(!res.ok) return [{ name:`Knajpa (demo ${res.status})`, place_id:`demo_${Date.now()}` }];
    const json = await res.json().catch(()=>({results:[]}));
    return json.results || [];
  }

  async function placeDetails(place_id){
    if(!C.gmapsProxy){
      return { name:'Syntetyczna Restauracja', formatted_address:'ul. Testowa 1',
               opening_hours:{open_now:true}, freeflow_menu_demo: synthMenu('włoska') };
    }
    const url = `${C.gmapsProxy}?type=details&${q({place_id})}`;
    const res = await fetch(url);
    if(!res.ok) return { name:'Restauracja (demo)', freeflow_menu_demo: synthMenu('włoska') };
    const json = await res.json().catch(()=>({}));
    return json.result || {};
  }

  function synthMenu(kind='włoska'){
    if(/włosk/.test(kind)) return [
      { name:'Margherita', price:26 }, { name:'Capricciosa', price:32 },
      { name:'Diavola', price:34 }, { name:'Carbonara', price:35 },
    ];
    return [
      { name:'Pierogi ruskie', price:24 }, { name:'Schabowy', price:38 }, { name:'Żurek', price:19 },
    ];
  }

  // ---------- FLOW ----------
  function sayConfirm({dish,time,relMin}){
    let msg = 'OK.';
    if (dish) msg += ` Zamawiam ${dish}.`;
    if (time) msg += ` Na ${time}.`;
    else if (relMin) msg += ` Za ${relMin} minut.`;
    return msg;
  }

  async function handleFinalText(rawText){
    const text = normalize(rawText);
    setText(text);

    // geolokalizacja (poproś jeżeli brak)
    await ensureGeoloc();

    const { dish, time, relMin } = parseOrder(text);

    // lokalne, szybkie potwierdzenie
    const fallback = sayConfirm({dish,time,relMin});
    speak(fallback);

    // ładna odpowiedź (proxy → OpenAI)
    try{
      const pretty = await niceReply(text, dish, time);
      if(pretty){
        setText(pretty);
        speak(pretty);
      }
    }catch(_){ /* cicho, mamy lokalny fallback */ }

    // przykładowe użycie Places z biasem lokalnym
    if (/pizza|pizz|restaurac|sushi|kebab|pierog|kuchni|kuchnia/i.test(text)){
      try{
        let query = 'restauracja';
        if (/pizza|pizz/i.test(text)) query = 'pizzeria';
        if (/sushi/i.test(text))     query = 'sushi';
        const coords = geo ? {lat:geo.lat,lng:geo.lng} : {};
        const places = await placesTextSearch({query, ...coords});
        const top = places[0];
        if(top){
          const det = await placeDetails(top.place_id || '');
          // nic nie wypisujemy do UI; to hook pod dalszą integrację koszyka
          console.debug('Places:', top, det);
        }
      }catch(e){ console.debug('Places error', e); }
    }
  }

  async function startListening(){
    try{
      const txt = await browserListenOnce();
      await handleFinalText(txt);
    }catch(e){
      setText(e.message || 'Błąd rozpoznawania.');
    }
  }

  [logoBtn, micBtn].forEach(el=> el.addEventListener('click', startListening, { passive:true }));
  setGhost('Powiedz, co chcesz zamówić…');

  // sprzątanie TTS przy nawigacji
  window.addEventListener('beforeunload', ()=>{ try{speechSynthesis.cancel()}catch(_){}});

})();
