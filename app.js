// === CONFIG ===
const PLACES_URL = document.querySelector('meta[name="gmaps-proxy"]')?.content?.trim();
const GPT_URL    = document.querySelector('meta[name="gpt-proxy"]')?.content?.trim();
// jeśli frontend stoi na GitHub Pages, a backend na Vercel – podaj pełny URL:
const TTS_URL    = 'https://freeflow-backend-vercel.vercel.app/api/tts';

if (!PLACES_URL || !GPT_URL) {
  console.warn('Brak meta gmaps-proxy / gpt-proxy w <head>.');
}

// === DOM ===
const transcriptEl = document.getElementById('transcript');
const asrBox       = document.getElementById('asrBox');
const micBtn       = document.getElementById('micBtn');
const logoBtn      = document.getElementById('logoBtn');
const banner       = document.getElementById('banner');

const tileFood  = document.getElementById('tileFood');
const tileTaxi  = document.getElementById('tileTaxi');
const tileHotel = document.getElementById('tileHotel');

// === UI helpers ===
function say(msg) {
  transcriptEl.classList.remove('ghost');
  transcriptEl.textContent = msg;
}
function toast(msg) {
  banner.textContent = msg;
  banner.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => banner.classList.add('hidden'), 3000);
}

// === HTTP helpers ===
async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json();
}

// === GEO ===
async function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolokacja niedostępna.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// === RENDER ===
function renderPlaces(list) {
  const box = document.createElement('div');
  box.className = 'resultsBox';
  box.innerHTML = list.length
    ? list.slice(0, 5).map((p, i) => {
        const dist = p.distanceText ? ` • ${p.distanceText}` : '';
        const addr = p.address ? `, ${p.address}` : '';
        return `<div class="placeRow">
          <b>${i + 1}) ${p.name || 'Miejsce'}</b>
          <span class="muted"> (${p.rating || '—'}★${p.votes ? ', ' + p.votes : ''}${dist})</span><br/>
          <span class="muted small">${(p.address || '').replace(/, Polska$/,'')}</span>
        </div>`;
      }).join('')
    : `<div class="muted">Brak wyników w pobliżu.</div>`;

  // wstaw pod polem transkrypcji – prosto i czytelnie
  // usuwamy poprzednie
  document.querySelectorAll('.resultsBox').forEach(n => n.remove());
  asrBox.insertAdjacentElement('afterend', box);
}

// === TTS ===
async function speak(text, lang = 'pl-PL', format = 'mp3') {
  try {
    const r = await postJson(TTS_URL, { text, lang, format });
    const b64 = r.audioContent;
    if (!b64) return;
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.play().catch(() => {});
  } catch (e) {
    console.warn('TTS error', e);
  }
}

// === VOICE (logo/mic) ===
async function onVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast('ASR niedostępne w tej przeglądarce.');
    return;
  }

  const rec = new SpeechRecognition();
  rec.lang = 'pl-PL';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onstart  = () => say('🎙️ Słucham…');
  rec.onerror  = () => toast('Błąd mikrofonu.');
  rec.onresult = async (ev) => {
    const phrase = ev.results[0][0].transcript;
    say(phrase);

    // 1) doprecyzuj przez GPT do zapytania
    try {
      const g = await postJson(GPT_URL, {
        prompt: `Zamień poniższą frazę użytkownika na krótkie zapytanie do wyszukiwarki miejsc (PL), np. 'restauracja włoska', 'pizza', 'hotel 4 gwiazdki', 'taxi':\n\n"${phrase}"`
      });
      const query = (g && g.reply) ? String(g.reply).trim() : phrase;

      // 2) pobierz geo i szukaj
      const loc = await getLocation();
      const data = await postJson(PLACES_URL, { query, lat: loc.lat, lng: loc.lng });
      renderPlaces(data.results || []);

      if (data.results?.length) {
        const first = data.results[0];
        await speak(`Polecam ${first.name}.`);
      } else {
        await speak('Nie znalazłem nic w pobliżu.');
      }
    } catch (e) {
      console.error(e);
      toast('Błąd podczas wyszukiwania.');
      await speak('Wystąpił błąd wyszukiwania.');
    }
  };

  rec.start();
}

// === QUICK SEARCH (kafelki) ===
async function quickSearch(query) {
  try {
    say(`${query} w okolicy`);
    const loc = await getLocation();
    const data = await postJson(PLACES_URL, { query, lat: loc.lat, lng: loc.lng });
    renderPlaces(data.results || []);
    if (data.results?.length) speak(`Najbliżej: ${data.results[0].name}`);
  } catch (e) {
    console.error(e);
    toast('Błąd podczas wyszukiwania. Spróbuj ponownie.');
  }
}

// === EVENTS ===
logoBtn?.addEventListener('click', onVoice);
micBtn?.addEventListener('click', onVoice);

tileFood?.addEventListener('click',  () => quickSearch('restauracja'));
tileTaxi?.addEventListener('click',  () => quickSearch('taxi'));
tileHotel?.addEventListener('click', () => quickSearch('hotel'));

// Stan startowy
say('Powiedz, co chcesz zamówić…');
