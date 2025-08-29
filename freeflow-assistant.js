// freeflow-assistant.js
// ----------------------------------------------------------
// Asystent FreeFlow: mowa → wyszukiwanie (Google Places) → feedback (baner + TTS + GPT)
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

// === TTS (Text-to-Speech) ===
function speak(text, lang = 'pl-PL') {
  if (!('speechSynthesis' in window)) return;
  try { window.speechSynthesis.cancel(); } catch {}
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
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

// === Wywołanie backendu GPT ===
async function callGPT(prompt) {
  try {
    const res = await fetch(GPT_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(`GPT HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    return null;
  }
}

// === Główna ścieżka ===
async function handleUserQuery(userText) {
  try {
    setFinalText(userText);

    const coords = await getPositionOrNull(6000);
    const q = extractQuery(userText);
    const params = { language: 'pl', n: 2 };

    if (coords) {
      params.lat    = coords.latitude.toFixed(6);
      params.lng    = coords.longitude.toFixed(6);
      params.radius = 5000;
      if (q) params.keyword = q;
    } else if (q) {
      params.query = q;
    } else {
      showBanner('Nie rozumiem frazy. Powiedz np. „dwie najlepsze restauracje w Katowicach”.', 'warn');
      return;
    }

    showBanner('Szukam miejsc w okolicy…');

    const data = await callPlaces(params);

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
      speak('Nic nie znalazłem. Spróbuj inną frazę lub włącz GPS.');
      return;
    }

    // natychmiastowy feedback + TTS
    if (results.length === 1) {
      const a = results[0];
      const msg = `Najlepsze w pobliżu: ${a.name} ${a.rating} gwiazdek.`;
      showBanner(`${msg} ${a.address}`);
      speak(msg);
    } else {
      const [a,b] = results;
      const msg = `Top dwa miejsca: ${a.name} i ${b.name}.`;
      showBanner(`Top 2: 1) ${a.name} (${a.rating}★, ${a.address}) • 2) ${b.name} (${b.rating}★, ${b.address})`);
      speak(msg);
    }

    // GPT — też czytamy
    const g = await callGPT(
      `Użytkownik: "${userText}". Miejsca: ${results.map(r => `${r.name} (${r.rating}★)`).join('; ')}.`
    );
    if (g?.reply) {
      showBanner(g.reply);
      speak(g.reply);
    }

  } catch (err) {
    console.error(err);
    showBanner('Ups, coś poszło nie tak. Spróbuj ponownie.', 'err');
    speak('Ups, coś poszło nie tak. Spróbuj ponownie.');
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
    showBanner('Błąd rozpoznawania mowy.', 'warn');
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
      setFinalText(final.trim());
      try { rec.stop(); } catch {}
      listening = false;
      setListening(false);
      handleUserQuery(final.trim());
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
  if (!recognition) {
    const typed = prompt('Rozpoznawanie mowy niedostępne. Wpisz, co chcesz zamówić:');
    if (typed && typed.trim()) {
      setFinalText(typed.trim());
      handleUserQuery(typed.trim());
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
        setFinalText(typed.trim());
        handleUserQuery(typed.trim());
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
  getPositionOrNull(3000).then(()=>{/*no-op*/});
})();
