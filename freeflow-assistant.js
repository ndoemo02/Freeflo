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
      // Google Maps Places
      gmapsKey:   pick('gmaps-key',   'GMAPS_KEY'),
      gmapsProxy: pick('gmaps-proxy', 'GMAPS_PROXY'), // jeśli masz backend proxy – najlepsza opcja
      // UI selectors (z Twojego indexa)
      ids: {
        app: 'app',
        transcript: 'transcript',
        micBtn: 'micBtn',
        logoBtn: 'logoBtn',
        dot: 'dot',
        tileFood: 'tileFood',
        tileTaxi: 'tileTaxi',
        tileHotel:'tileHotel',
      }
    };
  }
  const C = cfg();

  // -------------------- DOM --------------------
  const app        = document.getElementById(C.ids.app);
  const transcript = document.getElementById(C.ids.transcript);
  const micBtn     = document.getElementById(C.ids.micBtn);
  const logoBtn    = document.getElementById(C.ids.logoBtn);
  const dot        = document.getElementById(C.ids.dot);

  const tiles = {
    food:  document.getElementById(C.ids.tileFood),
    taxi:  document.getElementById(C.ids.tileTaxi),
    hotel: document.getElementById(C.ids.tileHotel),
  };

  // -------------------- HELPERS --------------------
  const setGhost = (msg)=>{
    if(!transcript) return;
    transcript.classList.add('ghost');
    transcript.textContent = msg;
  };
  const setText = (msg)=>{
    if(!transcript) return;
    transcript.classList.remove('ghost');
    transcript.textContent = msg;
  };
  const setListening = (on)=>{
    app && app.classList.toggle('listening', on);
    if(dot) dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if(!on && transcript && !transcript.textContent.trim()){
      setGhost('Powiedz, co chcesz zamówić…');
    }
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
    Object.values(tiles).forEach(t => t && t.classList.remove('active'));
    tiles[key] && tiles[key].classList.add('active');
  };
  tiles.food  && tiles.food.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi  && tiles.taxi.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel && tiles.hotel.addEventListener('click',()=>selectTile('hotel'));

  // odszumianie powtórzeń + poprawki nazw
  const corrections = [
    [/kaplic+oza/gi, 'capricciosa'],
    [/kapric+i?oza/gi, 'capricciosa'],
    [/kugelf?/gi, 'kugel'],
    [/\bgoogle\b/gi, 'Kugel'], // „google” → „Kugel” (Twoja uwaga)
  ];
  const normalize = (s)=>{
    let out = (s||'')
      .replace(/\b(\w{2,})\s+\1\b/gi, '$1') // „dwie dwie” → „dwie”
      .trim();
    for(const [re,to] of corrections) out = out.replace(re,to);
    return out;
  };

  // bardzo prosty parser czasu „na 18”, „o 19:30”
  const parseTime = (textLower) => {
    const m = textLower.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    if(!m) return null;
    const hh = String(m[1]).padStart(2,'0');
    const mm = m[2] ? m[2] : '00';
    return `${hh}:${mm}`;
  };

  // heurystyka: czy to w ogóle jedzenie / miejsce
  const isFoodQuery = (t) => /pizza|pizz|restaurac|kuchnia|sushi|kebab|pierog|burger|makaron|włoska|indyjsk|tajsk|japońsk/i.test(t);

  // wyciąg miasto po „w X” (prymitywnie)
  const parseCity = (t) => {
    const m = t.match(/\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\-]+)\b/);
    return m ? m[1] : '';
  };

  // -------------------- GEO --------------------
  async function getGeo(){
    if(!('geolocation' in navigator)) return null;
    return new Promise((resolve)=>{
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        _   => resolve(null), // brak zgody albo błąd – wracamy null
        { enableHighAccuracy: false, timeout: 5000 }
      );
    });
  }

  // -------------------- GOOGLE PLACES --------------------
  function gmapsURL(path, params){
    const q = new URLSearchParams(params).toString();
    if(C.gmapsProxy){
      // Twój backend powinien forwardować path i dodać własny klucz po swojej stronie
      return `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${q}`;
    }
    return `https://maps.googleapis.com${path}?${q}`;
  }

  async function placesTextSearch(query, geo, radius = 6000){
    // fallback DEMO gdy brak klucza
    if(!C.gmapsKey && !C.gmapsProxy){
      return [{ name:`Syntetyczna: ${query}`, formatted_address:'(demo)', rating:4.6 }];
    }
    const params = { query };
    if(!C.gmapsProxy) params.key = C.gmapsKey;              // direct (klient) – może zabić CORS
    if(geo){ params.location = `${geo.lat},${geo.lng}`; params.radius = radius; }

    try{
      const res = await fetch(gmapsURL('/maps/api/place/textsearch/json', params));
      if(!res.ok) throw new Error('HTTP '+res.status);
      const json = await res.json();
      return json.results?.slice(0,3) || [];
    }catch(e){
      // łagodny fallback na DEMO – nie blokujemy testów
      return [{ name:`Miejsce (demo) ${query}`, formatted_address:'—', rating:4.5 }];
    }
  }

  // -------------------- ASR (Web Speech – szybki) --------------------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listenOnce(){
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

  // -------------------- FLOW --------------------
  async function handleQuery(raw){
    const text = normalize(raw);
    setText(text);

    // czas (dla potwierdzeń przy zamówieniach)
    const time = parseTime(text.toLowerCase());

    // jeśli prosisz o knajpy – doradzamy od razu
    if (isFoodQuery(text)) {
      // 1) geolokacja (jeśli user pozwolił)
      let geo = await getGeo(); // null jeśli brak zgody
      const city = parseCity(text);
      const query = city
        ? `pizzeria ${city}` // jeśli padło „w Krakowie” → precyzujemy
        : /sushi|japońsk/i.test(text) ? 'sushi'
        : /włoska|pizza|pizz/i.test(text) ? 'pizzeria'
        : 'restauracja';

      const list = await placesTextSearch(query, geo);
      // Złóż krótką, zrozumiałą odpowiedź (max 3 propozycje)
      if(list && list.length){
        const top = list.slice(0,3).map((p,i)=>{
          const nm = p.name || 'Miejsce';
          const adr = p.formatted_address ? `, ${p.formatted_address}` : '';
          const rt  = (p.rating ? ` (${p.rating.toFixed ? p.rating.toFixed(1) : p.rating}★)` : '');
          return `${i+1}. ${nm}${rt}${adr}`;
        }).join('  ·  ');

        const voice = `Mam kilka opcji w okolicy: ${list[0].name}${list[0].rating?' – ocena '+list[0].rating.toFixed?list[0].rating.toFixed(1):list[0].rating:''}. Chcesz posłuchać reszty?`;
        setText(top);
        speak(voice);
        return;
      } else {
        setText('Nie znalazłem nic w pobliżu. Spróbuj podać miasto, np. „pizzeria w Krakowie”.');
        speak('Nie znalazłem nic w pobliżu. Podaj miasto, na przykład pizzeria w Krakowie.');
        return;
      }
    }

    // w innym wypadku – zwykłe potwierdzenie zamówienia
    let msg = 'OK. Przyjąłem.';
    if (time) msg = `OK. Przyjąłem na ${time}.`;
    speak(msg);
  }

  async function start(){
    try{
      const finalText = await listenOnce();
      await handleQuery(finalText);
    }catch(e){
      setText(e.message || 'Błąd rozpoznawania.');
    }
  }

  // -------------------- BIND UI --------------------
  if (logoBtn) logoBtn.addEventListener('click', start, { passive:true });
  if (micBtn)  micBtn .addEventListener('click', start, { passive:true });

  // pierwszy tekst
  setGhost('Powiedz, co chcesz zamówić…');

  // sprzątanie TTS przy nawigacji
  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
