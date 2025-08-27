;(() => {
  // -------------------- CONFIG --------------------
  function cfg() {
    const pick = (metaName, winKey) => {
      const m = document.querySelector(`meta[name="${metaName}"]`);
      if (m && m.content) return m.content.trim();
      if (winKey && window[winKey]) return String(window[winKey]).trim();
      return null;
    };
    return {
      // ASR
      useWhisper: (pick('asr-provider', 'ASR_PROVIDER') || '').toLowerCase() === 'whisper',
      whisperUrl: pick('whisper-url', 'WHISPER_URL'),     // np. https://twoj-vercel.app/api/whisper
      whisperAuth: pick('whisper-auth', 'WHISPER_AUTH'),  // opcjonalnie (Bearer ...)

      // OpenAI (opcjonalnie ładna odpowiedź)
      openaiKey: pick('openai-key', 'OPENAI_API_KEY'),
      openaiModel: pick('openai-model', 'OPENAI_MODEL') || 'gpt-4o-mini',

      // Google Places
      gmapsKey: pick('gmaps-key', 'GMAPS_KEY'),
      gmapsProxy: pick('gmaps-proxy', 'GMAPS_PROXY'), // jeśli używasz proxy na backendzie
    };
  }
  const C = cfg();

  // -------------------- DOM --------------------
  const app        = document.getElementById('app');
  const logoBtn    = document.getElementById('logoBtn');
  const micBtn     = document.getElementById('micBtn');
  const transcript = document.getElementById('transcript');
  const dot        = document.getElementById('dot');

  const tiles = {
    food:  document.getElementById('tileFood'),
    taxi:  document.getElementById('tileTaxi'),
    hotel: document.getElementById('tileHotel'),
  };

  // -------------------- UI HELPERS --------------------
  const toastBoxId = 'ff-toast';
  function ensureToastBox(){
    if(document.getElementById(toastBoxId)) return;
    const box = document.createElement('div');
    box.id = toastBoxId;
    box.style.cssText = `
      position:fixed; left:16px; right:16px; bottom:16px; z-index:9999;
      padding:14px 16px; border-radius:16px; color:#fff; font:500 14px/1.4 system-ui,Segoe UI,Roboto;
      background:rgba(20,20,22,.75); border:1px solid rgba(255,255,255,.12); backdrop-filter:blur(10px);
      display:none;
    `;
    document.body.appendChild(box);
  }
  function toast(msg, ms=3800){
    ensureToastBox();
    const box = document.getElementById(toastBoxId);
    box.textContent = msg;
    box.style.display = 'block';
    clearTimeout(box._t);
    box._t = setTimeout(()=> box.style.display='none', ms);
  }

  const setListening = (on)=>{
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if(!on && !transcript.textContent.trim()){
      setGhost('Powiedz, co chcesz zamówić…');
    }
  };
  const setGhost = (msg)=>{ transcript.classList.add('ghost');  transcript.textContent = msg; };
  const setText  = (msg)=>{ transcript.classList.remove('ghost'); transcript.textContent = msg; };

  const speak = (txt, lang='pl-PL')=>{
    try{ window.speechSynthesis.cancel(); }catch(_){}
    try{
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = lang;
      window.speechSynthesis.speak(u);
    }catch(_){}
  };
  const fmtTime = (hhmm)=> {
    // wymuś odczyt cyfrowy – TTS nie odmienia "osiemnastej", tylko czyta "18:00"
    if(!hhmm) return '';
    const [h,m] = hhmm.split(':');
    return `${String(h).padStart(2,'0')}:${String(m||'00').padStart(2,'0')}`;
  };
  const niceSay = (dish, time) => {
    if (dish && time)  return `OK, ${dish} na ${fmtTime(time)}.`;
    if (dish)          return `OK, ${dish}.`;
    if (time)          return `OK, na ${fmtTime(time)}.`;
    return 'OK.';
  };

  const selectTile = (key)=>{
    Object.values(tiles).forEach(t=>t.classList.remove('active'));
    tiles[key].classList.add('active');
  };
  tiles.food.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel.addEventListener('click',()=>selectTile('hotel'));

  // -------------------- NORMALIZACJE --------------------
  const corrections = [
    [/kaplic+oza/gi, 'capricciosa'],
    [/kapric+i?oza/gi, 'capricciosa'],
    [/kugelf/gi, 'kugel'], [/kugle?l/gi, 'kugel'],
    [/w\s+ariel\b/gi, 'w Arielu'], [/do\s+ariel\b/gi, 'do Ariela'],
  ];
  const normalize = (s)=>{
    let out = s.replace(/\b(\w{2,})\s+\1\b/gi, '$1'); // duplikaty
    for(const [re, to] of corrections) out = out.replace(re,to);
    return out.trim();
  };

  const parseOrder = (s)=>{
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
  };

  // -------------------- ASR: Whisper (opcjonalnie) --------------------
  async function whisperListenOnce(){
    if(!C.whisperUrl){
      throw new Error('Whisper nie skonfigurowany (meta[name="whisper-url"]).');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const stopPromise = new Promise((resolve)=>{ rec.onstop = resolve; });
    rec.ondataavailable = (e)=>{ if(e.data && e.data.size) chunks.push(e.data); };

    setListening(true); setText('Słucham… (Whisper)');
    rec.start();

    const stop = ()=>{ try{rec.stop()}catch(_){ } window.removeEventListener('click', stop, true); };
    window.addEventListener('click', stop, true);

    await stopPromise;
    setListening(false);

    const blob = new Blob(chunks, { type: 'audio/webm' });
    const headers = C.whisperAuth ? { 'Authorization': C.whisperAuth } : {};
    const form = new FormData();
    form.append('audio', blob, 'speech.webm');

    const res = await fetch(C.whisperUrl, { method: 'POST', headers, body: blob }); // serwer akceptuje surowe body
    if(!res.ok){
      const t = await res.text().catch(()=> '');
      throw new Error(`Whisper ${res.status}: ${t}`);
    }
    const data = await res.json().catch(()=> ({}));
    if(!data || !data.text) throw new Error('Whisper: brak pola "text" w odpowiedzi.');
    return data.text;
  }

  // -------------------- ASR: Web Speech (domyślny) --------------------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function browserListenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR) return reject(new Error('Brak Web Speech API (użyj Chrome/Edge lub przełącz na Whisper).'));
      const rec = new ASR();
      rec.lang = 'pl-PL';
      rec.interimResults = true;
      rec.continuous = false;

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

  // -------------------- GPT (ładne jedno zdanie – opcjonalnie) --------------------
  async function gptSumm(apiKey, text, dish, time){
    const body = {
      model: C.openaiModel,
      messages: [
        { role: 'system', content:
          'Jesteś asystentem zamówień FreeFlow. Po polsku, krótko (≤18 słów). Używaj godzin w formacie 18:00.' },
        { role: 'user', content:
          `Transkrypcja: "${text}". ${dish?`Danie: ${dish}. `:''}${time?`Godzina: ${fmtTime(time)}. `:''}Zwróć zwięzłe potwierdzenie.` }
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

  // -------------------- Google Places + GEO --------------------
  function gmapsURL(path, params){
    const query = new URLSearchParams(params).toString();
    if(C.gmapsProxy){
      return `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${query}`;
    }
    return `https://maps.googleapis.com${path}?${query}`;
  }

  async function getGeoMaybe(){
    if(!('geolocation' in navigator)) return null;
    try{
      // Permissions API – pokaż użytkownikowi wskazówkę
      if (navigator.permissions?.query) {
        try {
          const p = await navigator.permissions.query({ name: 'geolocation' });
          if (p.state === 'prompt') {
            toast('Pozwól na lokalizację, aby szukać miejsc w pobliżu.');
          }
          if (p.state === 'denied') {
            toast('Lokalizacja zablokowana w przeglądarce – wyszukam globalnie.');
            return null;
          }
        } catch(_) {}
      }

      const pos = await new Promise((res, rej)=>
        navigator.geolocation.getCurrentPosition(
          p => res([p.coords.latitude, p.coords.longitude]),
          e => rej(e),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        )
      );
      return pos; // [lat, lng]
    }catch(e){
      toast('Nie mam dostępu do lokalizacji — wyszukuję globalnie (możesz włączyć w ustawieniach).');
      return null;
    }
  }

  async function placesTextSearch(query, location /* [lat,lng] */, radiusMeters = 6000){
    if(!C.gmapsKey){
      console.debug('GMAPS: brak klucza – demo wyniki.');
      return [{ name: `Syntetyczna knajpa: ${query}`, place_id: 'demo_'+Date.now() }];
    }
    const params = { query, key: C.gmapsKey };
    if(location) params.location = location.join(',');
    if(radiusMeters) params.radius = radiusMeters;

    const url = gmapsURL('/maps/api/place/textsearch/json', params);
    const res = await fetch(url);
    if(!res.ok){
      console.debug('GMAPS error', res.status);
      return [{ name: `Knajpa (demo, ${res.status})`, place_id:'demo_'+Date.now() }];
    }
    const json = await res.json();
    return json.results || [];
  }

  async function placeDetails(place_id){
    if(!C.gmapsKey){
      return {
        name: 'Syntetyczna Restauracja',
        formatted_address: 'ul. Testowa 1',
        opening_hours: { open_now: true },
        freeflow_menu_demo: synthMenu('włoska')
      };
    }
    const url = gmapsURL('/maps/api/place/details/json', {
      place_id, key: C.gmapsKey, fields: 'name,formatted_address,opening_hours,website'
    });
    const res = await fetch(url);
    if(!res.ok){
      console.debug('GMAPS details error', res.status);
      return { name:'Restauracja (demo)', freeflow_menu_demo: synthMenu('włoska') };
    }
    const json = await res.json();
    return json.result || {};
  }

  function synthMenu(cuisine='włoska'){
    if(/włosk/.test(cuisine)) return [
      { name:'Margherita', price: 26 },
      { name:'Capricciosa', price: 32 },
      { name:'Diavola',     price: 34 },
      { name:'Carbonara',   price: 35 }
    ];
    if(/sushi|japoń/.test(cuisine)) return [
      { name:'California roll', price: 28 },
      { name:'Nigiri łosoś',    price: 24 },
      { name:'Ramen shoyu',     price: 36 }
    ];
    return [
      { name:'Pierogi ruskie', price: 24 },
      { name:'Schabowy',       price: 38 },
      { name:'Żurek',          price: 19 }
    ];
  }

  // -------------------- FLOW --------------------
  async function handleFinalText(rawText){
    const text = normalize(rawText);
    setText(text);

    // parsowanie
    const { dish, time } = parseOrder(text);

    // lokalne potwierdzenie – wymuszamy format 18:00
    speak(niceSay(dish, time));

    // (opcjonalnie) GPT
    if(C.openaiKey){
      try{
        const nice = await gptSumm(C.openaiKey, text, dish, time);
        if(nice){
          setText(nice);
          speak(nice);
        }
      }catch(e){ console.debug('OpenAI err', e); }
    }

    // (opcjonalnie) Google Places – z GEO
    if(/pizza|pizz|restaurac|kuchnia|sushi|kebab|pierog/i.test(text)){
      try{
        const cityMatch = text.match(/\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\-]+)\b/); // np. "w Krakowie"
        const city = cityMatch ? cityMatch[1] : '';
        const geo = await getGeoMaybe(); // [lat,lng] albo null
        const query = city ? `restauracja ${city}` : (dish ? `${dish} restauracja` : 'restauracja');

        const places = await placesTextSearch(query, geo);
        const top = places[0];
        if(top){
          const det = await placeDetails(top.place_id || '');
          console.debug('Place:', det);
        }
      }catch(e){ console.debug('Places err', e); }
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
    }
  }

  [logoBtn, micBtn].forEach(el=> el.addEventListener('click', startListening, { passive:true }));
  setGhost('Powiedz, co chcesz zamówić…');

  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
