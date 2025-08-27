// FreeFlow - assistant (PL) — pełny script.js

(() => {
  // -------------------- CONFIG --------------------
  function pick(metaName, winKey) {
    const m = document.querySelector(`meta[name="${metaName}"]`);
    if (m && m.content) return m.content.trim();
    if (winKey && window[winKey]) return String(window[winKey]).trim();
    return null;
  }

  const C = {
    // STT: tylko Web Speech (stabilne testy). Hook pod Whisper zostaje wyłączony.
    lang: 'pl-PL',

    // Google Places
    gmapsKey: pick('gmaps-key', 'GMAPS_KEY'),
    gmapsProxy: pick('gmaps-proxy', 'GMAPS_PROXY'), // opcjonalny proxy (CORS)

    // UI
    ttsEnabled: true,
  };

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

  // -------------------- UI helpers --------------------
  let speakingId = 0; // anty-dubler TTS

  function setListening(on) {
    app.classList.toggle('listening', on);
    dot && (dot.style.background = on ? '#21d4fd' : '#86e2ff');
    if (!on && !transcript.textContent.trim()) {
      setGhost('Powiedz, co chcesz zamówić…');
    }
  }
  function setGhost(msg) {
    transcript.classList.add('ghost');
    transcript.textContent = msg;
  }
  function setText(msg) {
    transcript.classList.remove('ghost');
    transcript.textContent = msg;
  }
  function speakOnce(txt) {
    if (!C.ttsEnabled || !txt) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
    try {
      const id = ++speakingId;
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = C.lang;
      u.onend = () => { if (id === speakingId) {/* zakończone */} };
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  function selectTile(key) {
    Object.values(tiles).forEach(t => t.classList.remove('active'));
    tiles[key].classList.add('active');
  }
  tiles.food?.addEventListener('click', () => selectTile('food'));
  tiles.taxi?.addEventListener('click', () => selectTile('taxi'));
  tiles.hotel?.addEventListener('click', () => selectTile('hotel'));

  // -------------------- Normalizacja & parser --------------------
  // lekkie poprawki wymowy
  const corrections = [
    [/kaplic+oza/gi, 'capricciosa'],
    [/kapric+i?oza/gi, 'capricciosa'],
    [/kugle?l/gi, 'kugel'],
    // „w Ariel” → „w Arielu”
    /\bw\s+arielu?\b/gi, 'w Arielu',
  ];

  function normalize(s) {
    if (!s) return '';
    let out = s.replace(/\b(\w{2,})\s+\1\b/gi, '$1'); // „dwie dwie” → „dwie”
    for (let i = 0; i < corrections.length; i += 2) {
      out = out.replace(corrections[i], corrections[i + 1]);
    }
    return out.trim();
  }

  // liczebniki słowne → cyfry (podstawowy zakres)
  const polishNums = {
    'zero': 0, 'jeden': 1, 'jedną': 1, 'jedna': 1, 'dwa': 2, 'dwóch': 2, 'dwie': 2,
    'trzy': 3, 'cztery': 4, 'pięć': 5, 'sześć': 6, 'siedem': 7, 'osiem': 8, 'dziewięć': 9,
    'dziesięć': 10, 'jedenaście': 11, 'dwanaście': 12, 'trzynaście': 13, 'czternaście': 14,
    'piętnaście': 15, 'szesnaście': 16, 'siedemnaście': 17, 'osiemnaście': 18, 'dziewiętnaście': 19,
    'dwadzieścia': 20, 'trzydzieści': 30, 'czterdzieści': 40, 'pięćdziesiąt': 50
  };
  function wordsToNumber(words) {
    // prosta suma dziesiątek+jedn.
    let sum = 0;
    words.toLowerCase().split(/[\s-]+/).forEach(w => {
      if (polishNums[w] != null) sum += polishNums[w];
      else if (/^\d+$/.test(w)) sum += parseInt(w, 10);
    });
    return sum || null;
  }

  function parseTime(text) {
    // 1) „o 19”, „na 21:15”, „o 7 30”
    const m1 = text.match(/\b(?:o|na)\s*(\d{1,2})(?:[:\s\.](\d{1,2}))?\b/);
    if (m1) {
      const hh = String(Math.min(23, parseInt(m1[1], 10))).padStart(2, '0');
      const mm = String(m1[2] ? Math.min(59, parseInt(m1[2], 10)) : 0).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    // 2) słownie „na dwudziestą pierwszą”, „o siódmej trzydzieści”
    const m2 = text.match(/\b(?:o|na)\s+([a-ząćęłńóśżź\- ]{3,})(?:\s+(?:pierwszą|drugą|trzecią|czwartą))?/i);
    if (m2) {
      const n = wordsToNumber(m2[1]);
      if (n != null) return `${String(Math.min(23, n)).padStart(2, '0')}:00`;
    }
    // 3) „za kwadrans”, „na wpół do X” → uproszczone: +15m / :30
    if (/za\s+kwadrans/i.test(text)) {
      const d = new Date(Date.now() + 15 * 60000);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const half = text.match(/na\s+wpół\s+do\s+([a-ząćęłńóśżź\- ]{3,}|\d{1,2})/i);
    if (half) {
      const val = /^\d/.test(half[1]) ? parseInt(half[1], 10) : wordsToNumber(half[1]);
      if (val != null) {
        let hh = (val - 1 + 24) % 24;
        return `${String(hh).padStart(2, '0')}:30`;
      }
    }
    return null;
  }

  function parseIntent(raw) {
    const text = normalize(raw);
    const low = text.toLowerCase();

    // tryb „znajdź knajpy…”
    const askBest = /\b(znajdź|wyszukaj|pokaż)\b.*\b(najlepsze|dobre)\b.*\b(kna?jpy|restauracje|pizzerie)\b.*\bw\s*okolicy\b/i.test(low);
    const countMatch = low.match(/\b(\d+|jeden|jedną|dwie|dwa|trzy)\b/);
    const count = countMatch ? (wordsToNumber(countMatch[1]) || 2) : 2;

    // proste rozpoznanie kategorii i miasta
    let category = null;
    if (/pizza|pizz/i.test(low)) category = 'pizzeria';
    else if (/sushi|ramen/i.test(low)) category = 'sushi';
    else if (/pierogi|pieróg/i.test(low)) category = 'pierogi';
    else if (/kebab/i.test(low)) category = 'kebab';
    else if (/restaurac/i.test(low)) category = 'restauracja';

    const cityMatch = low.match(/\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\-]+)\b/);
    const city = cityMatch ? cityMatch[1] : null;

    // danie (dla „zamów”)
    let dish = null;
    if (!askBest) {
      const d = text.match(/(?:chcę|poproszę|zamówić|zamawiam|potrzebuję|i need|proszę)\s+([a-ząćęłńóśżź\- ]{3,})/i);
      if (d) dish = d[1].replace(/\s+(na|o)\s+.*$/, '').trim();
      if (!dish) {
        // fallback: pierwsze sensowne słowo kulinarne
        const k = text.match(/\b(pizza|capricciosa|margherita|carbonara|pierogi|sushi|kebab|ramen)\b/i);
        if (k) dish = k[0];
      }
    }

    const time = parseTime(low);

    return { text, askBest, count, category, city, dish, time };
  }

  // -------------------- Geolokalizacja --------------------
  function getGeo() {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve({ ok: false });
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude }),
        _err => resolve({ ok: false }),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  }

  // -------------------- Google Places --------------------
  function gmapsURL(path, params) {
    const qs = new URLSearchParams(params).toString();
    if (C.gmapsProxy) return `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${qs}`;
    return `https://maps.googleapis.com${path}?${qs}`;
  }

  async function placesTextSearch({ query, lat, lng, radius = 6000 }) {
    if (!C.gmapsKey) {
      // fallback syntetyczny
      return [
        { name: `Demo: ${query}`, rating: 4.6, formatted_address: 'ul. Testowa 1', place_id: 'demo1' },
        { name: `Demo 2: ${query}`, rating: 4.4, formatted_address: 'ul. Przykładowa 2', place_id: 'demo2' }
      ];
    }
    const params = { query, key: C.gmapsKey };
    if (lat && lng) { params.location = `${lat},${lng}`; params.radius = radius; }
    const res = await fetch(gmapsURL('/maps/api/place/textsearch/json', params));
    const json = await res.json().catch(() => ({}));
    return json.results || [];
  }

  // -------------------- FLOW --------------------
  async function handleFinalText(rawText) {
    const { text, askBest, count, category, city, dish, time } = parseIntent(rawText);

    // 1) Tryb „znajdź knajpy”
    if (askBest) {
      let geo = { ok: false };
      let note = '';
      try {
        geo = await getGeo();
        if (!geo.ok) note = ' — wyszukuję globalnie (możesz udzielić zgody w przeglądarce).';
      } catch (_) {}
      const q = city ? `${category || 'restauracja'} ${city}` : (category || 'restauracja');
      const results = await placesTextSearch({ query: q, lat: geo.lat, lng: geo.lng });

      const top = results.slice(0, Math.max(1, count));
      if (top.length) {
        const list = top.map((r, i) => `${i + 1}. ${r.name}${r.rating ? ` (${r.rating.toFixed(1)})` : ''}`).join('  •  ');
        const human = `Najlepsze w okolicy: ${list}.${note}`;
        setText(human);
        speakOnce(human);
      } else {
        const msg = `Nie znalazłem miejsc dla zapytania „${q}”.`;
        setText(msg);
        speakOnce(msg);
      }
      return;
    }

    // 2) Zamówienie (lokalne potwierdzenie)
    let confirm = 'OK.';
    if (dish) confirm += ` Zamawiam ${dish}.`;
    if (time) confirm += ` Na ${time}.`;
    if (!dish && !time) confirm = text; // nic nie wnioskowaliśmy – przeczytaj transkrypcję

    setText(confirm);
    speakOnce(confirm);
  }

  // -------------------- STT (Web Speech) --------------------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function listenOnce() {
    return new Promise((resolve, reject) => {
      if (!ASR) return reject(new Error('Brak Web Speech API (Chrome/Edge).'));
      const rec = new ASR();
      rec.lang = C.lang;
      rec.interimResults = true;
      rec.continuous = false;

      rec.onstart = () => { setListening(true); setText('Słucham…'); };
      rec.onerror = e => { setListening(false); reject(new Error(e.error || 'ASR error')); };
      rec.onend = () => { setListening(false); };
      rec.onresult = ev => {
        let finalText = '', interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const raw = (finalText || interim).trim();
        if (raw) setText(normalize(raw));
        if (finalText) resolve(finalText);
      };
      try { rec.start(); } catch (err) { reject(err); }
    });
  }

  async function startListening() {
    try {
      const txt = await listenOnce();        // Web Speech
      await handleFinalText(txt);            // pełna logika
    } catch (e) {
      setText('Nie mogę teraz słuchać. Upewnij się, że udzielono zgody na mikrofon.');
      speakOnce('Nie mogę teraz słuchać. Sprawdź zgodę na mikrofon.');
    }
  }

  [logoBtn, micBtn].forEach(el => el?.addEventListener('click', startListening, { passive: true }));
  setGhost('Powiedz, co chcesz zamówić…');

  // sprzątanie TTS przy nawigacji
  window.addEventListener('beforeunload', () => { try { window.speechSynthesis.cancel(); } catch (_) {} });
})();
