// FreeFlow – asystent (PL) – uproszczony do: restauracja / taxi / hotel
// Wklej 1:1 jako script.js

(() => {
  // =================== CONFIG ===================
  function pick(metaName, winKey) {
    const m = document.querySelector(`meta[name="${metaName}"]`);
    if (m && m.content) return m.content.trim();
    if (winKey && window[winKey]) return String(window[winKey]).trim();
    return null;
  }

  const C = {
    lang: 'pl-PL',
    // Preferuj PROXY (Vercel API), nie wystawiaj klucza z przeglądarki
    gmapsProxy: pick('gmaps-proxy', 'GMAPS_PROXY'), // np. https://twoj-projekt.vercel.app/api/places
    gmapsKey:   pick('gmaps-key',   'GMAPS_KEY'),   // NIE używaj w prod z frontu; tylko do demo

    ids: {
      app: 'app',
      transcript: 'transcript',
      micBtn: 'micBtn',
      logoBtn: 'logoBtn',
      dot: 'dot',
      tileFood: 'tileFood',
      tileTaxi: 'tileTaxi',
      tileHotel: 'tileHotel',
    },

    // UI / limit listy miejsc
    maxList: 5,
    ttsEnabled: true,
  };

  // =================== DOM ===================
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

  // =================== HELPERS (UI) ===================
  function setGhost(msg) {
    if (!transcript) return;
    transcript.classList.add('ghost');
    transcript.textContent = msg;
  }
  function setText(msg) {
    if (!transcript) return;
    transcript.classList.remove('ghost');
    transcript.textContent = msg;
  }
  function setListening(on) {
    app && app.classList.toggle('listening', on);
    if (dot) dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if (!on && transcript && !transcript.textContent.trim()) {
      setGhost('Powiedz, co chcesz zamówić…');
    }
  }

  // =================== TTS ===================
  let speakingId = 0;
  function speakOnce(txt, lang = C.lang) {
    if (!C.ttsEnabled || !txt) return;
    try { window.speechSynthesis.cancel(); } catch (_){}
    try {
      const id = ++speakingId;
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = lang;
      u.onend = () => { if (id === speakingId) {/* nic */} };
      window.speechSynthesis.speak(u);
    } catch (_){}
  }

  // =================== Kafelki (aktywacja) ===================
  function selectTile(key) {
    Object.values(tiles).forEach(t => t && t.classList.remove('active'));
    tiles[key] && tiles[key].classList.add('active');
  }
  tiles.food  && tiles.food.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi  && tiles.taxi.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel && tiles.hotel.addEventListener('click',()=>selectTile('hotel'));

  // =================== Normalizacja mowy ===================
  const corrections = [
    [/kaplic+oza/gi, 'capricciosa'],
    [/kapric+i?oza/gi, 'capricciosa'],
    [/kugelf?/gi, 'kugel'],
    // Jeśli nie chcesz ogólnej zamiany "google" → "Kugel", usuń:
    // [/\bgoogle\b/gi, 'Kugel'],
  ];
  function normalize(s) {
    let out = (s || '')
      .replace(/\b(\w{2,})\s+\1\b/gi, '$1') // usuń powtórzenia „dwie dwie”
      .trim();
    for (const [re, to] of corrections) out = out.replace(re, to);
    return out;
  }

  // =================== Parser czasu ===================
  function parseTime(textLower) {
    const m = textLower.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    if (!m) return null;
    const hh = String(m[1]).padStart(2,'0');
    const mm = m[2] ? m[2] : '00';
    return `${hh}:${mm}`;
  }

  // =================== Liczebniki (1..10) ===================
  const numWords = {
    'jeden':1,'jedną':1,'jedno':1,'jedna':1,'jednego':1,
    'dwa':2,'dwie':2,'dwóch':2,
    'trzy':3,'cztery':4,'pięć':5,'sześć':6,'siedem':7,'osiem':8,'dziewięć':9,'dziesięć':10
  };
  function wantedCount(text) {
    const n = text.match(/\b(\d{1,2})\b/);
    if (n) { const v = parseInt(n[1],10); if (v>=1 && v<=10) return v; }
    const w = text.toLowerCase().match(/\b(jed(en|ną|no|na|nego)|dwie|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć)\b/);
    return w ? (numWords[w[0]] || 1) : 1;
  }

  // =================== KATEGORIE: tylko jedzenie / taxi / hotel ===================
  const categoryMap = [
    { re: /(pizz|pizzer|restaurac|knajp|jedzeni|obiad|kolac)/i, query: 'restauracja' },
    { re: /(taxi|taksówk|przejazd)/i,                          query: 'taxi' },
    { re: /(hotel|nocleg)/i,                                   query: 'hotel' }
  ];
  function detectCategory(text) {
    for (const c of categoryMap) if (c.re.test(text)) return c.query;
    return null;
  }

  // =================== Fraza „na / w / przy / koło …” (landmark/miasto) ===================
  function detectNearPhrase(text) {
    const m = text.match(/\b(na|w|we|przy|koło|obok)\s+([a-ząćęłńóśżź\-]+[a-ząćęłńóśżź]+)\b/iu);
    return m ? m[0] : '';
  }

  // =================== GEO ===================
  async function getGeo() {
    if (!('geolocation' in navigator)) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        _   => resolve(null),
        { enableHighAccuracy: false, timeout: 5000 }
      );
    });
  }

  // =================== Google Places (przez PROXY) ===================
  function gmapsURL(path, params) {
    const q = new URLSearchParams(params).toString();
    if (C.gmapsProxy) {
      // proxy: przekazujemy ścieżkę i parametry – backend dopnie ?key=...
      return `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${q}`;
    }
    // fallback – BEZPIECZEŃSTWO: to może ubić CORS; używaj tylko do testów
    return `https://maps.googleapis.com${path}?${q}`;
  }

  async function placesTextSearch(query, around, radius=6000) {
    // Brak proxy i klucza → demo
    if (!C.gmapsProxy && !C.gmapsKey) {
      setGhost('Tryb DEMO (brak proxy/klucza do Google Places).');
      return [{ name:`Demo: ${query}`, formatted_address:'(demo)', rating:4.5 }];
    }
    const params = { query };
    if (!C.gmapsProxy && C.gmapsKey) params.key = C.gmapsKey;
    if (around) {
      params.location = around;
      params.radius = radius;
    }
    try {
      const res = await fetch(gmapsURL('/maps/api/place/textsearch/json', params));
      if (!res.ok) throw new Error('HTTP '+res.status);
      const json = await res.json();
      return json.results?.slice(0, C.maxList) || [];
    } catch (e) {
      // łagodny fallback
      return [{ name:`Miejsce (offline): ${query}`, formatted_address:'—', rating:4.4 }];
    }
  }

  // =================== Prezentacja listy miejsc ===================
  function summarizePlaces(list, howMany=1) {
    if (!Array.isArray(list) || list.length===0) return null;
    const pick = list
      .map(r => ({name:r.name, rating: r.rating || null, vicinity: r.formatted_address || r.vicinity || ''}))
      .sort((a,b) => (b.rating||0) - (a.rating||0))
      .slice(0, howMany);

    const lines = pick.map((r,i)=> {
      const rt = typeof r.rating === 'number' ? ` (${r.rating.toFixed(1)}★)` : (r.rating ? ` (${r.rating}★)` : '');
      return `${i+1}. ${r.name}${rt}${r.vicinity ? `, ${r.vicinity}` : ''}`;
    });
    return { text: lines.join(' • '), topName: pick[0]?.name || '' };
  }

  // =================== ASR (Web Speech API) ===================
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR) return reject(new Error('Brak Web Speech API (Chrome/Edge).'));
      const rec = new ASR();
      rec.lang = C.lang;
      rec.interimResults = true;
      rec.continuous = false;

      let lastInterim = '';

      rec.onstart = ()=>{ setListening(true); setText('Słucham…'); };
      rec.onerror = (e)=>{ setListening(false); reject(new Error('ASR błąd: '+(e.error||''))); };
      rec.onend   = ()=>{
        setListening(false);
        if (lastInterim) resolve(lastInterim);
      };
      rec.onresult = (ev)=>{
        let finalText = '', interim = '';
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const t = ev.results[i][0].transcript;
          if(ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const raw = (finalText || interim).trim();
        if (interim) lastInterim = interim.trim();
        setText(normalize(raw || ''));
        if (finalText) resolve(finalText);
      };
      try { rec.start(); } catch(err) { reject(err); }
    });
  }

  // =================== FLOW ===================
  function isFoodQuery(t) {
    return /(pizz|restaurac|knajp|jedzeni|obiad|kolac)/i.test(t);
  }

  async function handleQuery(raw) {
    const text = normalize(raw);
    setText(text);

    const time = parseTime(text.toLowerCase());
    const count = wantedCount(text);
    const cat   = detectCategory(text);           // 'restauracja' | 'taxi' | 'hotel' | null
    const near  = detectNearPhrase(text);         // np. „na Mariackiej”

    let geo = null, placesSummary = null;

    if (cat) {
      geo = await getGeo(); // poprosi usera tylko gdy to ma sens
      const around = geo ? `${geo.lat},${geo.lng}` : null;

      // Budujemy zapytanie do Text Search: kategoria + ewentualny landmark/miasto
      // Drobny bias: jeśli jest pizza w tekście → "pizzeria", inaczej ogólna "restauracja"
      let q = cat;
      if (cat === 'restauracja' && /pizz/i.test(text)) q = 'pizzeria';
      if (near) q = `${q} ${near}`;

      const list = await placesTextSearch(q, around);
      placesSummary = summarizePlaces(list, Math.max(1, Math.min(count, C.maxList)));
    }

    // Składanie odpowiedzi
    let say = 'Okej.';
    if (time) say += ` Przyjmuję na ${time}.`;
    if (!cat && !time) say = 'Okej, słucham.';

    if (placesSummary) {
      if (count > 1) {
        // Pokaż listę (1..5) + powiedz top 1
        setText(placesSummary.text);
        speakOnce(`Mam ${count} propozycje. Najwyżej oceniana to ${placesSummary.topName}.`);
        return;
      } else {
        say += ` Najbliżej: ${placesSummary.topName}.`;
      }
    }

    setText(say);
    speakOnce(say);
  }

  async function start() {
    try {
      const finalText = await listenOnce();
      await handleQuery(finalText);
    } catch (e) {
      setText(e.message || 'Błąd rozpoznawania.');
    }
  }

  // =================== BIND UI ===================
  // Upewnij się, że te ID istnieją w HTML:
  // <button id="logoBtn"> ... </button>
  // <button id="micBtn"> ... </button>
  if (logoBtn) logoBtn.addEventListener('click', start, { passive:true });
  if (micBtn)  micBtn .addEventListener('click', start, { passive:true });

  // pierwszy tekst
  setGhost('Powiedz, co chcesz zamówić…');

  // sprzątanie TTS przy nawigacji
  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
