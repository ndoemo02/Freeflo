// FreeFlow – pełny script.js (PL) – UI + ASR + TTS + GEO + PLACES + GPT
(() => {
  // =================== CONFIG ===================
  function pick(metaName, winKey) {
    const m = document.querySelector(`meta[name="${metaName}"]`);
    if (m?.content) return m.content.trim();
    if (winKey && window[winKey]) return String(window[winKey]).trim();
    return null;
  }

  const C = {
    lang: 'pl-PL',
    gmapsProxy: pick('gmaps-proxy', 'GMAPS_PROXY') || '/api/places',
    gptProxy:   pick('gpt-proxy',   'GPT_PROXY')   || '/api/gpt',
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
    maxList: 5,
    ttsEnabled: true,
    searchRadius: 6000,     // 6 km domyślnie
    healthPath: '/api/health'
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
      u.onend = () => { if (id === speakingId) {/* no-op */} };
      window.speechSynthesis.speak(u);
    } catch (_){}
  }

  // =================== Kafelki ===================
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
  ];
  function normalize(s) {
    let out = (s || '')
      .replace(/\b(\w{2,})\s+\1\b/gi, '$1') // usuń powtórzenia
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

  // =================== Liczebniki (1..10) + „najlepsze” ===================
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
  function wantsBest(text) {
    return /\bnajlepsze?\b/i.test(text); // „najlepsze”, „najlepsza” itp.
  }

  // =================== KATEGORIE ===================
  const categoryMap = [
    { re: /(pizz|pizzer|restaurac|knajp|jedzeni|obiad|kolac)/i, query: 'restauracja' },
    { re: /(taxi|taksówk|przejazd)/i,                          query: 'taxi' },
    { re: /(hotel|nocleg)/i,                                   query: 'hotel' }
  ];
  function detectCategory(text) {
    for (const c of categoryMap) if (c.re.test(text)) return c.query;
    return null;
  }

  // =================== Fraza „na / w / przy …” ===================
  function detectNearPhrase(text) {
    const m = text.match(/\b(na|w|we|przy|koło|obok)\s+([a-ząćęłńóśżź\-]+[a-ząćęłńóśżź]+)\b/iu);
    return m ? m[0] : '';
  }

  // =================== GEO (diag + czytelne błędy) ===================
  async function getGeo() {
    if (!('geolocation' in navigator)) {
      setText('🔒 Brak geolokalizacji w tej przeglądarce (HTTPS wymagany).');
      return null;
    }
    return new Promise((resolve) => {
      const started = Date.now();
      const opts = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 };
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const secs = ((Date.now() - started) / 1000).toFixed(1);
          const lat = Number(pos.coords.latitude.toFixed(5));
          const lng = Number(pos.coords.longitude.toFixed(5));
          setGhost(`📍 Lokalizacja OK (${lat}, ${lng}) • ${secs}s`);
          resolve({ lat, lng });
        },
        (err) => {
          let why = 'Nieznany błąd geolokalizacji.';
          switch (err.code) {
            case err.PERMISSION_DENIED:
              why = 'Odmowa dostępu do lokalizacji. Włącz: kłódka → Uprawnienia → Lokalizacja: Zezwól.';
              break;
            case err.POSITION_UNAVAILABLE:
              why = 'Pozycja niedostępna. Włącz “Dokładna lokalizacja” i GPS.';
              break;
            case err.TIMEOUT:
              why = 'Przekroczono czas oczekiwania. Spróbuj ponownie.';
              break;
          }
          setText(`⚠️ ${why}`);
          resolve(null);
        },
        opts
      );
    });
  }

  // =================== BACKEND: Google Places (proxy) ===================
  // /api/places obsługuje tryb: ?path=/maps/api/place/textsearch/json&query=...&location=lat,lng&radius=...
  function gmapsURL(path, params) {
    const q = new URLSearchParams(params).toString();
    return `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${q}`;
  }

  async function placesTextSearch(query, around, radius=C.searchRadius) {
    const params = { query };
    if (around) { params.location = around; params.radius = radius; }
    try {
      const url = gmapsURL('/maps/api/place/textsearch/json', params);
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP '+res.status);
      const json = await res.json();
      return json.results?.slice(0, C.maxList) || [];
    } catch (e) {
      // łagodny fallback – offline
      return [{ name:`Miejsce (offline): ${query}`, formatted_address:'—', rating:4.4 }];
    }
  }

  function summarizePlaces(list, howMany=1, preferBest=false) {
    if (!Array.isArray(list) || list.length===0) return null;
    const sorted = [...list].sort((a,b) => (b.rating||0) - (a.rating||0));
    const pick = sorted.slice(0, Math.max(1, Math.min(howMany, C.maxList)))
      .map(r => ({
        name: r.name,
        rating: typeof r.rating === 'number' ? r.rating : null,
        vicinity: r.formatted_address || r.vicinity || '',
      }));
    const lines = pick.map((r,i)=> {
      const rt = (r.rating!=null) ? ` (${r.rating.toFixed(1)}★)` : '';
      return `${i+1}. ${r.name}${rt}${r.vicinity ? `, ${r.vicinity}` : ''}`;
    });
    return {
      text: lines.join(' • '),
      topName: (preferBest ? pick[0]?.name : (list[0]?.name || pick[0]?.name)) || ''
    };
  }

  // =================== BACKEND: GPT ===================
  async function askGPT(prompt) {
    try {
      const r = await fetch(C.gptProxy, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ prompt })
      });
      if (!r.ok) {
        const txt = await r.text().catch(()=> '');
        throw new Error(`GPT ${r.status}: ${txt}`);
      }
      const data = await r.json();
      return (data?.reply || '').trim();
    } catch (e) {
      return ''; // nie blokuj głównego flow
    }
  }

  // =================== ASR (Web Speech API) ===================
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR) return reject(new Error('Brak Web Speech API (użyj Chrome/Edge).'));
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
  async function handleQuery(raw) {
    const text = normalize(raw);
    setText(text);

    const lower = text.toLowerCase();
    const time  = parseTime(lower);
    const count = wantedCount(lower);
    const best  = wantsBest(lower);
    const cat   = detectCategory(lower); // 'restauracja' | 'taxi' | 'hotel' | null
    const near  = detectNearPhrase(lower);

    let geo = null, placesSummary = null;

    if (cat) {
      geo = await getGeo(); // poprosi usera tylko gdy ma sens
      const around = geo ? `${geo.lat},${geo.lng}` : null;

      let q = cat;
      if (cat === 'restauracja' && /pizz/i.test(lower)) q = 'pizzeria';
      if (near) q = `${q} ${near}`;

      const list = await placesTextSearch(q, around);
      const howMany = Math.max(1, Math.min(count, C.maxList));
      placesSummary = summarizePlaces(list, howMany, best);
    }

    // Składanie odpowiedzi (lokalnie)
    let say = 'Okej.';
    if (time) say += ` Przyjmuję na ${time}.`;
    if (!cat && !time) say = 'Okej, słucham.';

    // Krótki prompt do GPT – dopasowanie odpowiedzi do listy
    if (placesSummary) {
      const gptMsg =
        `Użytkownik powiedział: "${text}". Mamy listę: ${placesSummary.text}. ` +
        `Odpowiedz krótko po polsku (max 18 słów), naturalnie. ` +
        `Jeśli proszono o kilka najlepszych, powiedz że wyświetlam listę, a wymień top 1.`;
      const gptReply = await askGPT(gptMsg);

      if (count > 1 || best) {
        setText(placesSummary.text);
        speakOnce(gptReply || `Mam ${count} propozycje. Najwyżej oceniana to ${placesSummary.topName}.`);
        return;
      } else {
        say = gptReply || (say + ` Najbliżej: ${placesSummary.topName}.`);
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
  if (logoBtn) logoBtn.addEventListener('click', start, { passive:true });
  if (micBtn)  micBtn .addEventListener('click', start, { passive:true });

  // Pierwszy tekst + szybki healthcheck backendu (niewymagane)
  setGhost('Powiedz, co chcesz zamówić…');
  (async () => {
    try {
      const r = await fetch(C.healthPath).catch(()=>null);
      if (r?.ok) { /* opcjonalnie: setGhost('System gotowy.'); */ }
    } catch (_){}
  })();

  // Sprzątanie TTS przy nawigacji
  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
