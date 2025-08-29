// freeflow-assistant.js
// ----------------------------------------------------------
// Asystent: mowa → (geo + Places + GPT) → wynik → TTS
// ----------------------------------------------------------

// === skróty do DOM ===
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const app         = $('#app');
const transcript  = $('#transcript');
const micBtn      = $('#micBtn');
const logoBtn     = $('#logoBtn');
const dot         = $('#dot');
const banner      = $('#banner');
const tileFood    = $('#tileFood');
const tileTaxi    = $('#tileTaxi');
const tileHotel   = $('#tileHotel');

// meta-konfiguracja endpointów (zgodnie z index.html)
const GMAPS_PROXY = (document.querySelector('meta[name="gmaps-proxy"]')?.content || '/api/places').trim();
const GPT_PROXY   = (document.querySelector('meta[name="gpt-proxy"]')?.content   || '/api/gpt').trim();

// === helpers UI ===
function showBanner(msg, type = 'info') {
  banner.textContent = msg;
  banner.classList.remove('hidden');
  if (type === 'warn') {
    banner.style.background = 'rgba(255,203,72,.15)';
    banner.style.color = '#ffe6a3';
  } else if (type === 'err') {
    banner.style.background = 'rgba(255,72,72,.15)';
    banner.style.color = '#ffd1d1';
  } else {
    banner.style.background = 'rgba(72,179,255,.12)';
    banner.style.color = '#dff1ff';
  }
}
function hideBanner() {
  banner.classList.add('hidden');
  banner.textContent = '';
}
function setGhostText(msg) {
  transcript.classList.add('ghost');
  transcript.textContent = msg;
}
function setFinalText(msg) {
  transcript.classList.remove('ghost');
  transcript.textContent = msg;
}
function setListening(on) {
  document.body.classList.toggle('listening', !!on);
  dot.style.boxShadow = on ? '0 0 18px #86e2ff' : '0 0 0 #0000';
}

// === TTS (mowa) ============================================================
let voices = [];
let lastUtterance = null;

function initVoices() {
  try {
    voices = speechSynthesis.getVoices();
  } catch {}
}
initVoices();
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => initVoices();
}

/** Mów po podanym języku (domyślnie PL). Wywołuj po interakcji użytkownika. */
function speak(text, lang = 'pl-PL') {
  try {
    if (!('speechSynthesis' in window)) return;
    if (!text || !text.trim()) return;

    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    if (lastUtterance) lastUtterance = null;

    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;

    if (voices && voices.length) {
      const exact = voices.find(v => v.lang === lang);
      const same  = voices.find(v => v.lang?.startsWith(lang.split('-')[0]));
      u.voice = exact || same || voices[0];
    }
    u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;

    lastUtterance = u;
    window.speechSynthesis.speak(u);
  } catch (e) {
    console.warn('TTS error', e);
  }
}

// === GEO: stabilna lokalizacja z timeoutem i komunikatami ===
async function getPositionOrNull(timeoutMs = 6000) {
  if (!('geolocation' in navigator)) {
    showBanner('Twoja przeglądarka nie obsługuje lokalizacji.', 'err');
    return null;
  }
  const getPos = () => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 25_000 }
    );
  });

  try {
    const coords = await getPos();
    hideBanner();
    return coords; // { latitude, longitude, accuracy }
  } catch (e) {
    const map = {
      1: 'Brak zgody na lokalizację.',
      2: 'Lokalizacja niedostępna (GPS/wi-fi).',
      3: 'Przekroczono czas oczekiwania na lokalizację.'
    };
    showBanner(`${map[e.code] ?? 'Błąd lokalizacji.'} — szukam po tekście.`, 'warn');
    return null;
  }
}

// === Ekstrakcja intencji: „pizzeria|restauracje … (w Mieście)” ===
function extractQuery(text) {
  const t = (text || '').trim();
  // np.: „dwie najlepsze restauracje w Katowicach”, „pizzeria w Gdańsku”, „hotel”
  const re = /(pizzeria|pizze|pizza|restauracja|restauracje|kebab|sushi|hotel|nocleg|taxi)(.*?)(?:\bw\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+))?/i;
  const m = t.match(re);
  if (!m) return null;

  const base = (m[1] || '').toLowerCase();
  const city = m[3] ? ` w ${m[3]}` : '';
  const normalized =
    /restaurac/.test(base)       ? 'restauracje' :
    /pizz/.test(base)            ? 'pizzeria'    :
    /(hotel|nocleg)/.test(base)  ? 'hotel'       :
    /taxi/.test(base)            ? 'taxi'        :
    base;

  return (normalized + city).trim();
}

// === Wywołanie backendu Places ===
async function callPlaces(params) {
  const sp = new URLSearchParams();
  if (params.query)  sp.set('query', params.query);
  if (params.lat)    sp.set('lat', params.lat);
  if (params.lng)    sp.set('lng', params.lng);
  if (params.radius) sp.set('radius', params.radius);
  if (params.rankby) sp.set('rankby', params.rankby);
  if (params.keyword) sp.set('keyword', params.keyword);
  if (params.n)       sp.set('n', params.n);
  sp.set('language', params.language || 'pl');

  const url = `${GMAPS_PROXY}?${sp.toString()}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  return res.json();
}

// === Wywołanie backendu GPT (opcjonalne) ===
async function callGPT(prompt) {
  try {
    const res = await fetch(GPT_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(`GPT HTTP ${res.status}`);
    return res.json();
  } catch {
    return null;
  }
}

// === Główna ścieżka: obsługa zapytania użytkownika ===
async function handleUserQuery(userText) {
  try {
    setFinalText(userText);

    // 1) Najpierw spróbujmy wziąć GPS; jeśli się nie uda, będzie fallback
    const coords = await getPositionOrNull(6000);

    // 2) Przygotuj parametry /api/places
    const q = extractQuery(userText);
    const params = { language: 'pl', n: 2 };

    if (coords) {
      params.lat    = coords.latitude.toFixed(6);
      params.lng    = coords.longitude.toFixed(6);
      params.radius = 5000;
      if (q) params.keyword = q; // keyword zawęża (np. pizzeria)
    } else if (q) {
      params.query = q;          // tryb tekstowy (np. „restauracje w Katowicach”)
    } else {
      showBanner('Nie rozumiem frazy. Powiedz np. „dwie najlepsze restauracje w Katowicach”.', 'warn');
      return;
    }

    showBanner('Szukam miejsc w okolicy…');

    // 3) Pobierz z backendu
    const data = await callPlaces(params);

    // 4) Ujednolicenie i sortowanie (gdyby backend nie posortował)
    const list = (data?.results || data || [])
      .filter(x => x && (x.rating ?? null) !== null)
      .map(x => ({
        name: x.name,
        rating: Number(x.rating || 0),
        votes: Number(x.user_ratings_total || 0),
        address: (x.formatted_address || x.vicinity || '—')
      }))
      .sort((a,b) => (b.rating - a.rating) || (b.votes - a.votes));

    const results = list.slice(0, 2);

    if (!results.length) {
      showBanner('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.', 'warn');
      speak('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.', 'pl-PL');
      return;
    }

    // 5) Feedback + TTS
    let speechText = '';
    if (results.length === 1) {
      const a = results[0];
      const msg = `Najlepsze w pobliżu: ${a.name} — ${a.rating} gwiazdki. Adres: ${a.address}.`;
      showBanner(msg);
      speechText = msg;
    } else {
      const [a,b] = results;
      const msg = `Polecam: ${a.name} — ${a.rating} gwiazdki oraz ${b.name} — ${b.rating} gwiazdki. Skorzystaj z aplikacji FreeFlow, aby zamówić szybko i wygodnie.`;
      showBanner(msg);
      speechText = msg;
    }
    speak(speechText, 'pl-PL');

    // 6) Króciutka odpowiedź GPT (opcjonalnie)
    const g = await callGPT(
      `Użytkownik poprosił: "${userText}". \
Wyświetl krótko i po polsku maksymalnie dwa najlepsze miejsca. \
Na końcu dodaj jedno zdanie call-to-action o skorzystaniu z aplikacji FreeFlow. \
Dane: ${results.map(r => `${r.name} (${r.rating}★, ${r.address})`).join('; ')}.`
    );
    if (g?.reply) {
      showBanner(g.reply);
      speak(g.reply, 'pl-PL');
    }

  } catch (err) {
    console.error(err);
    const msg = 'Ups, coś poszło nie tak. Spróbuj ponownie.';
    showBanner(msg, 'err');
    speak(msg, 'pl-PL');
  }
}

// === Rozpoznawanie mowy (Web Speech API) ===
let recognition = null;
let listening   = false;

function initASR() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.lang = 'pl-PL';
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    listening = true;
    setListening(true);
    setGhostText('Słucham…');
  };

  rec.onerror = (e) => {
    console.warn('ASR error:', e.error);
    showBanner('Błąd rozpoznawania mowy. Spróbuj ponownie lub wpisz ręcznie.', 'warn');
    speak('Błąd rozpoznawania mowy. Spróbuj ponownie lub wpisz ręcznie.', 'pl-PL');
  };

  rec.onresult = (ev) => {
    let interim = '';
    let final   = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const chunk = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) final += chunk;
      else interim += chunk;
    }
    if (final) {
      const txt = final.trim();
      setFinalText(txt);
      try { rec.stop(); } catch {}
      listening = false;
      setListening(false);
      handleUserQuery(txt);
    } else if (interim) {
      setGhostText(interim.trim());
    }
  };

  rec.onend = () => {
    listening = false;
    setListening(false);
    if (transcript.textContent.trim() === '' || transcript.classList.contains('ghost')) {
      setGhostText('Powiedz, co chcesz zamówić…');
    }
  };

  return rec;
}

function toggleMic() {
  // próba „odblokowania” TTS na mobile (po interakcji)
  try { speak(''); window.speechSynthesis.cancel(); } catch {}

  if (!recognition) {
    const typed = prompt('Rozpoznawanie mowy niedostępne. Wpisz, co chcesz zamówić:');
    if (typed && typed.trim()) {
      const txt = typed.trim();
      setFinalText(txt);
      handleUserQuery(txt);
    }
    return;
  }
  if (listening) {
    try { recognition.stop(); } catch {}
  } else {
    try { recognition.start(); } catch (e) {
      console.warn(e);
      const typed = prompt('Nie udało się włączyć mikrofonu. Wpisz, co chcesz zamówić:');
      if (typed && typed.trim()) {
        const txt = typed.trim();
        setFinalText(txt);
        handleUserQuery(txt);
      }
    }
  }
}

// === Zdarzenia UI ===
function bindUI() {
  micBtn?.addEventListener('click', toggleMic);
  logoBtn?.addEventListener('click', toggleMic);

  function activateTile(active) {
    [tileFood, tileTaxi, tileHotel].forEach(btn => btn?.classList.remove('active'));
    active?.classList.add('active');
  }
  tileFood?.addEventListener('click', () => activateTile(tileFood));
  tileTaxi?.addEventListener('click', () => activateTile(tileTaxi));
  tileHotel?.addEventListener('click', () => activateTile(tileHotel));

  setGhostText('Powiedz, co chcesz zamówić…');
}

// === Autostart ===
(function bootstrap(){
  recognition = initASR();
  bindUI();

  // delikatne „rozgrzanie” geo (bez wymuszania promptu)
  getPositionOrNull(3000).then(()=>{/* no-op */});
})();
