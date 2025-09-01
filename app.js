(() => {
  // ---- Konfiguracja z <meta> w index.html ----
  const GMAPS_PROXY = document.querySelector('meta[name="gmaps-proxy"]')?.content?.trim();
  const GPT_PROXY   = document.querySelector('meta[name="gpt-proxy"]')?.content?.trim();
  // tts – ten sam backend co wyżej, stała ścieżka:
  const TTS_URL     = 'https://freeflow-backend-vercel.vercel.app/api/tts';

  // ---- Elementy UI (z Twojego index.html) ----
  const $ = (sel) => document.querySelector(sel);
  const asrBox      = $('#asrBox');
  const transcript  = $('#transcript');
  const micBtn      = $('#micBtn');
  const logoBtn     = $('#logoBtn');
  const banner      = $('#banner');

  const tileFood    = $('#tileFood');
  const tileTaxi    = $('#tileTaxi');
  const tileHotel   = $('#tileHotel');

  // ---- Stan aplikacji ----
  let mode = 'food'; // 'food' | 'taxi' | 'hotel'
  let speaking = false;

  // ---- Helpers UI ----
  function setMode(next) {
    mode = next;
    [tileFood, tileTaxi, tileHotel].forEach(b => b.classList.remove('active'));
    ({ food: tileFood, taxi: tileTaxi, hotel: tileHotel }[mode])?.classList.add('active');

    const hint = {
      food:  'Powiedz, co chcesz zamówić… (np. „dwie pizze w Krakowie”)',
      taxi:  'Powiedz, skąd i dokąd… (np. „taxi z Ursusa do Śródmieścia”)',
      hotel: 'Powiedz, jakiego hotelu szukasz… (np. „hotel w Krakowie na dziś”)'
    }[mode];

    transcript.textContent = hint;
    transcript.classList.add('ghost');
  }

  function showBanner(html, kind = 'info') {
    banner.innerHTML = html;
    banner.classList.remove('hidden');
    banner.dataset.kind = kind;
  }
  function hideBanner() {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }

  // ---- HTTP helpers ----
  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }
  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) {
      const text = await r.text().catch(()=>'');
      throw new Error(`POST ${r.status}: ${text || r.statusText}`);
    }
    return await r.json();
  }

  // ---- TTS ----
  async function speak(text, { lang = 'pl-PL', format = 'mp3' } = {}) {
    try {
      speaking = true;
      const { audioContent } = await postJSON(TTS_URL, { text, lang, format });
      if (!audioContent) return;

      const mime = format === 'wav' ? 'audio/wav' : (format === 'ogg' ? 'audio/ogg' : 'audio/mpeg');
      const audio = new Audio(`data:${mime};base64,${audioContent}`);
      audio.play().catch(() => {/* mobile autoplay limits */});
      audio.onended = () => { speaking = false; };
    } catch (e) {
      speaking = false;
      console.error('TTS error:', e);
    }
  }

  // ---- GPT (krótkie zdanie do banera) ----
  async function askGpt(prompt) {
    if (!GPT_PROXY) return '';
    try {
      const { reply } = await postJSON(GPT_PROXY, { prompt, system: 'Odpowiadaj krótko po polsku.' });
      return (reply || '').trim();
    } catch (e) {
      console.warn('GPT error:', e.message);
      return '';
    }
  }

  // ---- Places (GMAPS) ----
  async function searchPlaces(query) {
    if (!GMAPS_PROXY) return [];
    const url = `${GMAPS_PROXY}?q=${encodeURIComponent(query)}&near=auto&limit=5`;
    try {
      const data = await getJSON(url);
      return Array.isArray(data?.results) ? data.results : [];
    } catch (e) {
      console.warn('Places error:', e.message);
      return [];
    }
  }

  // ---- ASR (Web Speech API) z fallbackiem ----
  function supportedASR() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  function startASR() {
    if (!supportedASR()) {
      // Fallback – ręczny prompt (na mobilkach bez ASR)
      const typed = prompt('Powiedz/napisz zapytanie:');
      if (typed && typed.trim()) onUserQuery(typed.trim());
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'pl-PL';
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    transcript.classList.remove('ghost');
    transcript.textContent = '🎤 Słucham…';

    rec.onresult = (ev) => {
      let text = '';
      for (const res of ev.results) text += res[0].transcript;
      transcript.textContent = text;
    };
    rec.onerror = () => { transcript.textContent = 'Nie usłyszałem. Spróbuj ponownie.'; };
    rec.onend = () => {
      const finalText = transcript.textContent.trim();
      if (finalText && !finalText.startsWith('🎤')) onUserQuery(finalText);
      else setMode(mode); // przywróć hint
    };
    rec.start();
  }

  // ---- Główny przepływ po uzyskaniu tekstu od użytkownika ----
  async function onUserQuery(text) {
    hideBanner();
    transcript.classList.remove('ghost');
    transcript.textContent = text;

    let placesQuery = '';
    if (mode === 'food') {
      placesQuery = text; // np. „pizza w Krakowie”
    } else if (mode === 'taxi') {
      placesQuery = `taxi ${text}`; // np. „taxi z A do B”
    } else if (mode === 'hotel') {
      placesQuery = `hotel ${text}`;
    }

    // 1) Miejsca (Top 2)
    const places = await searchPlaces(placesQuery);
    const top = places.slice(0, 2);
    let topLine = '';
    if (top.length) {
      topLine = top
        .map((p, i) => {
          const name = p.name ?? 'Miejsce';
          const rating = p.rating ? `(${p.rating}★)` : '';
          const addr = p.address ?? '';
          return `${i + 1}) ${name} ${rating}${addr ? `, ${addr}` : ''}`;
        })
        .join(' • ');
    }

    // 2) Krótki opis GPT (jedno zdanie)
    const gptPrompt = {
      food:  `Napisz jedno krótkie zdanie po polsku do klienta o jedzeniu, kontekst: "${text}".`,
      taxi:  `Napisz jedno krótkie zdanie po polsku do klienta o przejeździe taxi, kontekst: "${text}".`,
      hotel: `Napisz jedno krótkie zdanie po polsku do klienta o hotelu/rezerwacji, kontekst: "${text}".`
    }[mode];
    const oneLine = await askGpt(gptPrompt);

    // 3) Baner
    const html = `
      ${topLine ? `<div><b>Top 2:</b> ${topLine}</div>` : ''}
      ${oneLine ? `<div style="margin-top:.4rem">${oneLine}</div>` : ''}
    `;
    showBanner(html || 'Brak wyników dla zapytania.');

    // 4) TTS – przeczytaj zwięzłą odpowiedź
    if (oneLine) await speak(oneLine, { lang: 'pl-PL', format: 'mp3' });
  }

  // ---- Zdarzenia UI ----
  micBtn.addEventListener('click', () => {
    if (speaking) return; // nie przecinaj TTS
    startASR();
  });
  logoBtn.addEventListener('click', () => {
    if (speaking) return;
    startASR();
  });

  tileFood.addEventListener('click', () => setMode('food'));
  tileTaxi.addEventListener('click', () => setMode('taxi'));
  tileHotel.addEventListener('click', () => setMode('hotel'));

  // start
  setMode('food');
})();
