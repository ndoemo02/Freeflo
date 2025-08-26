/* freeflow-assistant.js
   FreeFlow — parser + stan + TTS + ASR (Web Speech / Whisper)
   Wymagane elementy w HTML: #app, #logoBtn, #micBtn, #transcript, #dot,
   kafelki #tileFood #tileTaxi #tileHotel, licznik #cartCount (opcjonalny)
*/
;(() => {
  // ---------------- CONFIG ----------------
  function pick(metaName, winKey) {
    const m = document.querySelector(`meta[name="${metaName}"]`);
    if (m && m.content) return m.content.trim();
    if (winKey && window[winKey]) return String(window[winKey]).trim();
    return null;
  }
  const CFG = {
    useWhisper: (pick('asr-provider', 'ASR_PROVIDER') || '').toLowerCase() === 'whisper',
    whisperUrl: pick('whisper-url', 'WHISPER_URL'),
    whisperAuth: pick('whisper-auth', 'WHISPER_AUTH'),

    openaiKey: pick('openai-key', 'OPENAI_API_KEY'),
    openaiModel: pick('openai-model', 'OPENAI_MODEL') || 'gpt-4o-mini',

    gmapsKey: pick('gmaps-key', 'GMAPS_KEY'),
    gmapsProxy: pick('gmaps-proxy', 'GMAPS_PROXY'),

    lang: 'pl-PL',
  };

  // --------------- DOM --------------------
  const $ = (id) => document.getElementById(id);
  const app        = $('app');
  const logoBtn    = $('logoBtn');
  const micBtn     = $('micBtn');
  const transcript = $('transcript');
  const dot        = $('dot');
  const cartCount  = $('cartCount');

  const tiles = {
    food:  $('tileFood'),
    taxi:  $('tileTaxi'),
    hotel: $('tileHotel'),
  };

  // --------------- STATE ------------------
  const state = {
    intent: 'food',    // 'food' | 'taxi' | 'hotel'
    items: [],
    last: null,        // ostatnia komenda po parsingu
  };

  function updateCartBadge() {
    if (!cartCount) return;
    cartCount.textContent = String(state.items.length);
  }

  function addItemToCart(parsed) {
    state.items.push(parsed);
    updateCartBadge();
  }

  // --------------- UI helpers ------------
  function setListening(on) {
    app.classList.toggle('listening', on);
    if (dot) dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if (!on && !transcript.textContent.trim()) setGhost(placeholderByIntent());
  }
  function setGhost(msg) {
    transcript.classList.add('ghost');
    transcript.textContent = msg;
  }
  function setText(msg) {
    transcript.classList.remove('ghost');
    transcript.textContent = msg;
  }
  function speak(txt, lang = CFG.lang) {
    try { window.speechSynthesis.cancel(); } catch(_){}
    try {
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = lang;
      window.speechSynthesis.speak(u);
    } catch(_){}
  }
  function selectTile(key) {
    state.intent = key;
    Object.values(tiles).forEach(t => t.classList.remove('active'));
    tiles[key].classList.add('active');
    // placeholder
    if (!transcript.textContent.trim() || transcript.classList.contains('ghost')) {
      setGhost(placeholderByIntent());
    }
  }
  function placeholderByIntent() {
    switch (state.intent) {
      case 'food':  return 'Jaką potrawę wybierasz?';
      case 'taxi':  return 'Taxi skąd–dokąd lub na kiedy?';
      case 'hotel': return 'Nocleg: miasto, termin, liczba osób?';
      default:      return 'Powiedz, co chcesz zamówić…';
    }
  }
  tiles.food && tiles.food.addEventListener('click', () => selectTile('food'));
  tiles.taxi && tiles.taxi.addEventListener('click', () => selectTile('taxi'));
  tiles.hotel && tiles.hotel.addEventListener('click', () => selectTile('hotel'));

  // --------------- NORMALIZACJA ----------
  const corrections = [
    [/kaplic+oza/gi, 'capricciosa'],
    [/kapric+i?oza/gi, 'capricciosa'],
    [/kugelf/gi, 'kugel'], [/kugle?l/gi, 'kugel'],
    [/w\s+ariel\b/gi, 'w Arielu'], [/do\s+ariel\b/gi, 'do Ariela'],
    // powtórzenia
  ];
  function normalize(s) {
    let out = s.replace(/\b(\w{2,})\s+\1\b/gi, '$1');
    for (const [re, to] of corrections) out = out.replace(re, to);
    return out.trim();
  }

  // --------------- PARSER SLOTÓW ---------
  // Prosty, ale skuteczny parser dla food/taxi/hotel.
  const MONTHS_PL = 'stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października listopada grudnia'.split(' ');

  function parseTime(text) {
    // "na 18" / "na 18:30" / "o 19" / "jutro o 12"
    const m = text.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    if (m) return `${String(m[1]).padStart(2,'0')}:${m[2] || '00'}`;
    if (/jutro/i.test(text)) return 'jutro';
    if (/pojutrze/i.test(text)) return 'pojutrze';
    // data dzienna: "15 sierpnia"
    const md = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS_PL.join('|')})\\b`, 'i'));
    if (md) return `${md[1]} ${md[2]}`;
    return null;
  }

  function parseCity(text) {
    // "w Krakowie", "w Bytomiu", "w Gdańsku"
    const m = text.match(/\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\-]+)\b/);
    return m ? m[1] : null;
  }

  function parsePlace(text) {
    // "w Arielu / do Ariela / z Ariela"
    const m = text.match(/\b(?:w|do|z)\s+([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\-]+)\b/);
    return m ? m[1] : null;
  }

  function parseQty(text) {
    // "dwie", "2", "trzy", "x2"
    const map = { jeden:1, jedna:1, jedno:1, dwa:2, dwie:2, trzy:3, cztery:4, pięć:5, szesc:6, sześć:6 };
    const w = text.toLowerCase().match(/\b(jeden|jedna|jedno|dwie|dwa|trzy|cztery|pięć|szesc|sześć)\b/);
    if (w) return map[w[1]] || 1;
    const d = text.match(/\b(\d{1,2})\b/);
    if (d) return parseInt(d[1],10);
    const x = text.match(/\bx\s*(\d{1,2})\b/i);
    if (x) return parseInt(x[1],10);
    return 1;
  }

  function parseDish(text, intent) {
    if (intent !== 'food') return null;
    // usuń fragmenty czasu/miejsca
    const stripped = text
      .replace(/\b(?:na|o)\s*\d{1,2}(?::?\d{2})?\b/gi, ' ')
      .replace(/\b(jutro|pojutrze)\b/gi, ' ')
      .replace(/\b(w|do|z)\s+[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\-]+\b/g, ' ')
      .replace(/\s{2,}/g,' ')
      .trim();
    if (!stripped) return null;
    // weź sensowne słowa (pizza capricciosa, carbonara, ramen itd.)
    const m = stripped.match(/[a-ząćęłńóśżź0-9\- ]{3,}/i);
    return m ? m[0].trim() : null;
  }

  function parseTaxi(text) {
    // "taxi z Mariackiej do lotniska na 18"
    const from = (text.match(/\bz\s+([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\- ]+)/i) || [])[1];
    const to   = (text.match(/\bdo\s+([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż\- ]+)/i) || [])[1];
    return { from: from?.trim() || null, to: to?.trim() || null };
  }

  function parseHotel(text) {
    // "hotel w Gdańsku 15 sierpnia na dwie noce"
    const nights = (text.match(/\b(\d{1,2})\s+noc(e|y)?\b/i) || [])[1];
    return { nights: nights ? parseInt(nights,10) : null };
  }

  function parseIntent(text) {
    // z aktywnego kafelka, ale pozwól słowom kluczowym przesterować
    if (/hotel|nocleg|apartament/i.test(text)) return 'hotel';
    if (/taxi|taks|uber|bolt/i.test(text))    return 'taxi';
    if (/jedzen|pizza|makaron|sushi|kebab|burger|pierog/i.test(text)) return 'food';
    return state.intent; // domyślnie aktywny
  }

  function parseCommand(raw) {
    const text = normalize(raw);
    const intent = parseIntent(text);
    const time = parseTime(text);
    const city = parseCity(text);
    const place = parsePlace(text);
    const qty = parseQty(text);

    if (intent === 'food') {
      return {
        intent, text, time, city, place, qty,
        dish: parseDish(text, intent),
      };
    }
    if (intent === 'taxi') {
      const { from, to } = parseTaxi(text);
      return { intent, text, time, city, from, to };
    }
    if (intent === 'hotel') {
      const { nights } = parseHotel(text);
      return { intent, text, time, city, nights };
    }
    return { intent, text };
  }

  // ------------- SYNTHETIC MENU (fallback) --------------
  function synthMenu(cuisine = 'włoska') {
    if (/włosk/.test(cuisine)) return [
      { name:'Margherita', price: 26 },
      { name:'Capricciosa', price: 32 },
      { name:'Diavola',     price: 34 },
      { name:'Carbonara',   price: 35 },
    ];
    if (/sushi|japoń/.test(cuisine)) return [
      { name:'California roll', price: 28 },
      { name:'Nigiri łosoś',    price: 24 },
      { name:'Ramen shoyu',     price: 36 },
    ];
    return [
      { name:'Pierogi ruskie', price: 24 },
      { name:'Schabowy',       price: 38 },
      { name:'Żurek',          price: 19 },
    ];
  }

  // ------------- GPT krótkie potwierdzenie (opcjonalnie) ----
  async function gptConfirm(text, parsed) {
    if (!CFG.openaiKey) return null;
    const body = {
      model: CFG.openaiModel,
      messages: [
        { role:'system', content:'Jesteś asystentem zamówień FreeFlow. Odpowiadasz krótko, naturalnie, po polsku. Jedno zdanie, max 18 słów.' },
        { role:'user', content:`Transkrypcja: "${text}". Dane: ${JSON.stringify(parsed)}. Zwróć zwięzłe potwierdzenie bez listy punktów.` }
      ],
      temperature: 0.3, max_tokens: 60
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Authorization':`Bearer ${CFG.openaiKey}`,'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    const data = await res.json().catch(()=> ({}));
    return data.choices?.[0]?.message?.content?.trim() || null;
  }

  // ------------- ASR (Web Speech / Whisper) -----------------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function browserListenOnce() {
    return new Promise((resolve, reject) => {
      if (!ASR) return reject(new Error('Brak Web Speech API (użyj Chrome/Edge lub włącz Whisper).'));
      const rec = new ASR();
      rec.lang = CFG.lang;
      rec.interimResults = true; rec.continuous = false;

      rec.onstart = () => { setListening(true); setText('Słucham…'); };
      rec.onerror = (e) => { setListening(false); reject(new Error('ASR błąd: '+(e.error||''))); };
      rec.onend   = () => { setListening(false); };
      rec.onresult = (ev) => {
        let finalText = '', interim = '';
        for (let i=ev.resultIndex; i<ev.results.length; i++){
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const raw = (finalText || interim).trim();
        setText(normalize(raw || ''));
        if (finalText) resolve(finalText);
      };
      try { rec.start(); } catch(err) { reject(err); }
    });
  }

  async function whisperListenOnce() {
    if (!CFG.whisperUrl) throw new Error('Brak whisper-url w <meta>.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType:'audio/webm' });
    const stopPromise = new Promise((ok)=> rec.onstop = ok);
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

    setListening(true); setText('Słucham… (Whisper)');
    rec.start();

    const stop = ()=>{ try{rec.stop()}catch(_){ } window.removeEventListener('click', stop, true); };
    window.addEventListener('click', stop, true);
    await stopPromise;
    setListening(false);

    const blob = new Blob(chunks, { type:'audio/webm' });
    const form = new FormData();
    form.append('audio', blob, 'speech.webm');
    const headers = CFG.whisperAuth ? { 'Authorization': CFG.whisperAuth } : {};
    const res = await fetch(CFG.whisperUrl, { method:'POST', headers, body: form });
    if (!res.ok) throw new Error(`Whisper ${res.status}`);
    const data = await res.json().catch(()=> ({}));
    if (!data || !data.text) throw new Error('Whisper: brak pola "text"');
    return data.text;
  }

  async function startListening() {
    try {
      const raw = CFG.useWhisper ? await whisperListenOnce() : await browserListenOnce();
      await handleText(raw);
    } catch(e) {
      setText(e.message || 'Błąd rozpoznawania.');
      speak('Nie dosłyszałem. Powtórz proszę.');
    }
  }

  // ------------- GŁÓWNY FLOW -----------------
  async function handleText(raw) {
    const text = normalize(raw);
    setText(text);

    const parsed = parseCommand(text);
    state.last = parsed;

    // dodaj do "koszyka" tylko sensowne przypadki
    if (parsed.intent === 'food' && parsed.dish) addItemToCart(parsed);
    if (parsed.intent === 'taxi' && (parsed.from || parsed.to)) addItemToCart(parsed);
    if (parsed.intent === 'hotel' && (parsed.city || parsed.nights)) addItemToCart(parsed);

    // lokalne, krótkie potwierdzenie
    let local = 'OK.';
    if (parsed.intent === 'food') {
      if (parsed.dish) local = `Zamawiam ${parsed.qty||1} × ${parsed.dish}${parsed.city?' w '+parsed.city:''}${parsed.time? ' na '+parsed.time:''}.`;
      else local = 'Jasne, powiedz nazwę dania.';
    } else if (parsed.intent === 'taxi') {
      local = `Taxi ${parsed.from?'z '+parsed.from+' ':''}${parsed.to?'do '+parsed.to+' ':''}${parsed.time?'na '+parsed.time:''}`.trim() + '.';
    } else if (parsed.intent === 'hotel') {
      local = `Nocleg ${parsed.city? 'w '+parsed.city+' ':''}${parsed.time? parsed.time+' ':''}${parsed.nights? parsed.nights+' noce':''}`.trim() + '.';
    }
    speak(local);

    // (opcjonalnie) ładniejsze zdanie z GPT
    try {
      const nice = await gptConfirm(text, parsed);
      if (nice) { setText(nice); speak(nice); }
    } catch(_) { /* cicho */ }

    // Fallback menu do loga/insightów (tu tylko konsola)
    if (parsed.intent === 'food' && !parsed.city) {
      console.debug('Menu DEMO:', synthMenu('włoska'));
    }
  }

  // ------------- INIT -----------------------
  [logoBtn, micBtn].forEach(el => el && el.addEventListener('click', startListening, { passive:true }));
  setGhost(placeholderByIntent());
  updateCartBadge();

  // sprzątanie TTS
  window.addEventListener('beforeunload', () => { try { window.speechSynthesis.cancel(); } catch(_){ } });

  // mały skrót: długi przytrzymanie logo → przełącz źródło ASR (do porównań)
  let pressTimer;
  if (logoBtn) {
    logoBtn.addEventListener('mousedown', () => { pressTimer = setTimeout(toggleASR, 900); });
    logoBtn.addEventListener('mouseup',   () => clearTimeout(pressTimer));
    logoBtn.addEventListener('touchstart',() => { pressTimer = setTimeout(toggleASR, 900); }, {passive:true});
    logoBtn.addEventListener('touchend',  () => clearTimeout(pressTimer));
  }
  function toggleASR() {
    CFG.useWhisper = !CFG.useWhisper;
    const mode = CFG.useWhisper ? 'Whisper' : 'Przeglądarka';
    setText(`Tryb rozpoznawania: ${mode}`);
    speak(`Tryb: ${mode}`);
  }
})();
