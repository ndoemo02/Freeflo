// app.js — minimal, pewny przepływ: tile -> geolokacja -> /api/places (POST)
// Nie wymaga zmian w index.html

// --- Helpers ---------------------------------------------------------------

function meta(name, fallback = '') {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el?.content?.trim() || fallback;
}

const PLACES_URL = meta('gmaps-proxy', 'https://freeflow-backend-vercel.vercel.app/api/places');
const GPT_URL    = meta('gpt-proxy',   'https://freeflow-backend-vercel.vercel.app/api/gpt');
const TTS_URL    = 'https://freeflow-backend-vercel.vercel.app/api/tts';

async function postJson(url, payload, opts = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function $(sel){ return document.querySelector(sel); }
function show(el){ el?.classList?.remove('hidden'); }
function hide(el){ el?.classList?.add('hidden'); }
function setText(el, txt){ if(el) el.textContent = txt; }

// --- UI refs ---------------------------------------------------------------

const transcriptEl = $('#transcript');
const bannerEl     = $('#banner');
const tileFood     = $('#tileFood');
const tileTaxi     = $('#tileTaxi');
const tileHotel    = $('#tileHotel');
const micBtn       = $('#micBtn');
const logoBtn      = $('#logoBtn');

// --- Geolokacja (pewna i szybka) ------------------------------------------

async function getLocation() {
  // 1) Spróbuj pamięci (ostatnia udana)
  try {
    const cached = JSON.parse(localStorage.getItem('ff:loc') || 'null');
    if (cached && Date.now() - cached.ts < 30 * 60 * 1000) { // 30 min
      return cached;
    }
  } catch {}

  // 2) Spróbuj navigator.geolocation
  const pos = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      ()  => resolve(null),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 }
    );
  });

  // 3) Zapisz, jeśli się udało
  if (pos) {
    localStorage.setItem('ff:loc', JSON.stringify({ ...pos, ts: Date.now() }));
    return pos;
  }

  // 4) Fallback — centrum PL (da wyniki „w pobliżu” szeroko)
  return { lat: 52.237049, lng: 21.017532 }; // Warszawa
}

// --- Wyniki & komunikaty ---------------------------------------------------

function say(msg){ setText(transcriptEl, msg); transcriptEl.classList.remove('ghost'); }
function ghost(msg){ setText(transcriptEl, msg); transcriptEl.classList.add('ghost'); }

function toast(msg, type='error') {
  bannerEl.className = `banner ${type}`;
  bannerEl.textContent = msg;
  show(bannerEl);
  setTimeout(() => hide(bannerEl), 4000);
}

// prosty renderer: pod polem asr pokażemy 2 najlepsze pozycje
function renderPlaces(list){
  // usuń poprzedni box wyników jeśli był
  let box = document.querySelector('#ff-results');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ff-results';
    box.style.marginTop = '12px';
    box.style.background = 'rgba(0,0,0,.35)';
    box.style.backdropFilter = 'blur(6px)';
    box.style.borderRadius = '18px';
    box.style.padding = '14px 16px';
    box.style.lineHeight = '1.45';
    box.style.fontSize = '15px';
    document.querySelector('.stage')?.appendChild(box);
  }
  if (!list?.length){
    box.textContent = 'Brak wyników w pobliżu.';
    return;
  }
  const top = list.slice(0,2).map((p,i)=>{
    const star = p.rating ? ` (${p.rating}★)` : '';
    const addr = p.address ? ` — ${p.address}` : '';
    return `${i+1}) ${p.name}${star}${addr}`;
  }).join(' • ');
  box.textContent = `Top 2: ${top}`;
}

// --- Szukanie kategorii (klik kafelka) ------------------------------------

async function searchCategory(cat) {
  try {
    showLoading(true);

    const loc = await getLocation();
    const qMap = {
      food:  'restauracja w okolicy',
      taxi:  'taksówka w okolicy',
      hotel: 'hotel w okolicy',
    };
    const query = qMap[cat] || 'restauracja w okolicy';
    say(query);

    const data = await postJson(PLACES_URL, { query, lat: loc.lat, lng: loc.lng });

    renderPlaces(data.results || []);
    // powiedz 1 zdanie o wynikach
    const prompt = (data.results?.[0]?.name)
      ? `Powiedz jedno krótkie zdanie po polsku o miejscu ${data.results[0].name}.`
      : `Powiedz jedno krótkie zdanie po polsku: nie znalazłem nic w pobliżu.`;
    try {
      const gpt = await postJson(GPT_URL, { prompt });
      if (gpt?.reply) {
        setHint(gpt.reply);
        speak(gpt.reply);
      }
    } catch { /* gpt opcjonalnie */ }

  } catch (e) {
    console.error(e);
    toast('Błąd podczas wyszukiwania. Spróbuj ponownie.');
  } finally {
    showLoading(false);
  }
}

// --- Voice (logo/mikrofon) -> użyjemy tych samych ścieżek ------------------

async function onLogoOrMic() {
  // Jeśli chcesz pełne ASR – włączysz później.
  // Na teraz: zachowuj się jak klik na aktywny kafelek.
  if (tileFood.classList.contains('active')) return searchCategory('food');
  if (tileTaxi.classList.contains('active')) return searchCategory('taxi');
  if (tileHotel.classList.contains('active')) return searchCategory('hotel');
  return searchCategory('food');
}

// --- TTS -------------------------------------------------------------------

async function speak(text, lang='pl-PL', format='mp3') {
  try {
    const r = await postJson(TTS_URL, { text, lang, format });
    if (!r?.audioContent) return;
    const bytes = atob(r.audioContent);
    const buf = new Uint8Array(bytes.length);
    for (let i=0;i<bytes.length;i++) buf[i] = bytes.charCodeAt(i);
    const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch(()=>{});
  } catch (e) {
    console.warn('TTS error', e);
  }
}

// --- Drobny UX -------------------------------------------------------------

function showLoading(on){
  const dot = $('#dot');
  if (!dot) return;
  dot.classList.toggle('pulse', !!on);
}
function setHint(msg){
  let hint = document.querySelector('#ff-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'ff-hint';
    hint.style.marginTop = '10px';
    hint.style.opacity = '.95';
    hint.style.fontSize = '15px';
    hint.style.lineHeight = '1.45';
    hint.style.background = 'rgba(0,0,0,.28)';
    hint.style.backdropFilter = 'blur(6px)';
    hint.style.padding = '12px 14px';
    hint.style.borderRadius = '16px';
    document.querySelector('.stage')?.appendChild(hint);
  }
  hint.textContent = msg;
}

// --- Init: podpinamy kafelki i klawisze -----------------------------------

function activate(tile){
  [tileFood, tileTaxi, tileHotel].forEach(b => b.classList.remove('active'));
  tile.classList.add('active');
}

tileFood?.addEventListener('click',  () => { activate(tileFood);  searchCategory('food');  });
tileTaxi?.addEventListener('click',  () => { activate(tileTaxi);  searchCategory('taxi');  });
tileHotel?.addEventListener('click', () => { activate(tileHotel); searchCategory('hotel'); });

logoBtn?.addEventListener('click', onLogoOrMic);
micBtn?.addEventListener('click',  onLogoOrMic);

// stan początkowy
ghost('Powiedz, co chcesz zamówić…');
activate(tileFood);
