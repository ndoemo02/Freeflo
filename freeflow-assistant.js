/* FreeFlow Assistant – logika ASR/TTS + UI
   Wymaga: Chrome/Edge (Web Speech API)
   Autor: FreeFlow
*/
(() => {
  const $ = (s) => document.querySelector(s);
  const app = $('#app') || document.body;

  const els = {
    logoBtn:   $('#logoBtn'),
    logoWrap:  $('#logoWrap'),
    micBtn:    $('#micBtn'),
    transcript:$('#transcript'),
    dot:       $('#dot'),
    summary:   $('#summary'),
    rowDish:   $('#rowDish'),
    rowPlace:  $('#rowPlace'),
    rowTime:   $('#rowTime'),
    sumDish:   $('#sumDish'),
    sumPlace:  $('#sumPlace'),
    sumTime:   $('#sumTime'),
    tiles: {
      food:  $('#tileFood'),
      taxi:  $('#tileTaxi'),
      hotel: $('#tileHotel'),
    }
  };

  // ---------------- helpers ----------------
  const setListening = (on) => {
    app.classList.toggle('listening', on);
    if (els.dot) els.dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if (els.transcript) {
      if (on) {
        els.transcript.classList.remove('ghost');
        els.transcript.textContent = 'Słucham…';
      } else if (!els.transcript.textContent.trim()) {
        els.transcript.textContent = 'Powiedz, co chcesz zamówić…';
      }
    }
  };

  // delikatna deduplikacja powtórzeń typu "dwie dwie"
  const dedupeWords = (s) =>
    s.replace(/\b([a-ząćęłńóśżź\-]+)(?:\s+\1\b)+/gi, '$1');

  // mini-NLP: wyciągnij czas i danie
  const parseOrder = (s) => {
    const text = s.toLowerCase().trim();

    // czas: "na 18:00", "na 18", "o 19"
    const mTime = text.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    const time = mTime
      ? mTime[1].padStart(2, '0') + ':' + (mTime[2] ? mTime[2] : '00')
      : null;

    // danie: reszta (bez fragmentu czasu)
    const stripped = text.replace(/\b(?:na|o)\s*\d{1,2}(?::?\d{2})?\b/, '').trim();
    const mDish = stripped.match(
      /\b(?:jedna|jedną|dwie|trzy|cztery)?\s*([a-ząćęłńóśżź\- ]{3,})$/i
    );
    let dish = mDish ? mDish[1].replace(/\s{2,}/g, ' ').trim() : null;
    if (dish) dish = dish.replace(/\b(na|o)\b.*$/, '').trim();

    return { dish, time };
  };

  const showSummary = ({ dish, place, time }) => {
    if (!els.summary) return;

    if (dish) {
      els.sumDish.textContent = dish;
      els.rowDish.style.display = 'flex';
    } else els.rowDish.style.display = 'none';

    if (place) {
      els.sumPlace.textContent = place;
      els.rowPlace.style.display = 'flex';
    } else els.rowPlace.style.display = 'none';

    if (time) {
      els.sumTime.textContent = time;
      els.rowTime.style.display = 'flex';
    } else els.rowTime.style.display = 'none';

    els.summary.classList.add('show');
    clearTimeout(els.summary._t);
    els.summary._t = setTimeout(() => els.summary.classList.remove('show'), 5000);
  };

  // ---------------- ASR / TTS ----------------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recognizing = false;

  function startRec() {
    if (!ASR) {
      if (els.transcript)
        els.transcript.textContent = 'Rozpoznawanie mowy wymaga Chrome/Edge.';
      return;
    }
    if (recognizing) return;

    rec = new ASR();
    rec.lang = 'pl-PL';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => {
      recognizing = true;
      setListening(true);
    };
    rec.onerror = (e) => {
      recognizing = false;
      setListening(false);
      if (els.transcript)
        els.transcript.textContent = 'Błąd rozpoznawania: ' + (e.error || '');
    };
    rec.onend = () => {
      recognizing = false;
      setListening(false);
    };
    rec.onresult = (ev) => {
      let finalText = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t;
        else interim += t;
      }
      const txt = dedupeWords((finalText || interim).trim());
      if (els.transcript) els.transcript.textContent = txt || 'Słucham…';

      if (finalText) {
        const { dish, time } = parseOrder(finalText);
        showSummary({ dish, time });
        try {
          const ut = new SpeechSynthesisUtterance(
            `OK. ${dish ? `Zamawiam ${dish}` : ''} ${time ? `na ${time}` : ''}.`
          );
          ut.lang = 'pl-PL';
          speechSynthesis.speak(ut);
        } catch (_) {}
      }
    };

    try { rec.start(); } catch (_) {}
  }

  function stopRec() { try { rec && rec.stop(); } catch (_) {} }
  function toggleRec() { recognizing ? stopRec() : startRec(); }

  // ---------------- UI bind ----------------
  [els.logoBtn, els.micBtn].filter(Boolean)
    .forEach((el) => el.addEventListener('click', toggleRec, { passive: true }));

  // kafelki
  const tiles = els.tiles;
  const selectTile = (key) => {
    Object.values(tiles).forEach((t) => t && t.classList.remove('active'));
    tiles[key] && tiles[key].classList.add('active');
  };
  tiles.food  && tiles.food.addEventListener('click', () => selectTile('food'));
  tiles.taxi  && tiles.taxi.addEventListener('click', () => selectTile('taxi'));
  tiles.hotel && tiles.hotel.addEventListener('click', () => selectTile('hotel'));

  // init tekstu
  if (els.transcript) els.transcript.textContent = 'Powiedz, co chcesz zamówić…';

  // usuń niebieski overlay fokusów na logo w mobile
  document.addEventListener(
    'mousedown',
    (e) => { if (e.target === els.logoBtn) e.target.blur(); },
    { passive: true }
  );

  // sprzątanie TTS przy wyjściu
  window.addEventListener('beforeunload', () => {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  });
})();
