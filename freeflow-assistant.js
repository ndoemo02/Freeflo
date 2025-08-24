(() => {
  const app        = document.getElementById('app');
  const logoBtn    = document.getElementById('logoBtn');
  const logoWrap   = document.getElementById('logoWrap');
  const micBtn     = document.getElementById('micBtn');
  const transcript = document.getElementById('transcript');
  const dot        = document.getElementById('dot');
  const backendMsg = document.getElementById('backendMsg');

  // --- helpers
  const setListening = (on)=>{
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if(!on && !transcript.textContent.trim()){
      transcript.classList.add('ghost');
      transcript.textContent = 'Powiedz, co chcesz zamówić…';
    }
  };

  // deduplikacja typu „dwie dwie pepperoni”
  const dedupeWords = (s)=>{
    return s.replace(/\b(\w{2,})\b(?:\s+\1\b)+/gi, '$1');
  };

  // mini-NLP: wyłuskaj danie i godzinę
  const parseOrder = (s)=>{
    const text = s.toLowerCase();

    // godzina „na 18:00 / na 18 / o 19”
    const mTime = text.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    const time  = mTime ? (mTime[1].padStart(2,'0') + ':' + (mTime[2] ? mTime[2] : '00')) : null;

    // danie: spróbuj wychwycić po kwantyfikatorze lub po słowie „zamów”
    let dish = null;
    const m1 = text.match(/\b(?:zamów|poproszę|weź)\s+([a-ząćęłńóśżź\- ]{3,})/);
    const m2 = text.match(/\b(?:jedna|jedną|dwie|trzy|cztery)?\s*([a-ząćęłńóśżź\- ]{3,})\b/);

    if(m1){ dish = m1[1]; }
    else if(m2){ dish = m2[1]; }

    if(dish){
      // utnij ogon po „na/o 18”
      dish = dish.replace(/\b(na|o)\b.*$/, '').trim();
      // kosmetyka: „pizze napoli” -> „pizze Napoli”
      dish = dish.replace(/\bnapoli\b/gi,'Napoli').replace(/\s+/g,' ').trim();
    }
    return { dish: dish || null, time };
  };

  // prosty TTS
  const speak = (txt)=>{
    try{
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = 'pl-PL';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }catch(_){}
  };

  // --- Web Speech API (Chrome/Edge)
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recognizing = false;

  const startRec = ()=>{
    if(!ASR){
      transcript.classList.remove('ghost');
      transcript.textContent = 'Rozpoznawanie mowy wymaga Chrome/Edge.';
      return;
    }
    if(recognizing){ stopRec(); return; }

    rec = new ASR();
    rec.lang = 'pl-PL';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = ()=>{
      recognizing = true;
      transcript.classList.remove('ghost');
      transcript.textContent = 'Słucham…';
      setListening(true);
    };
    rec.onerror = (e)=>{
      recognizing = false;
      setListening(false);
      transcript.classList.remove('ghost');
      transcript.textContent = 'Błąd rozpoznawania: ' + (e.error || '');
    };
    rec.onend = ()=>{
      recognizing = false;
      setListening(false);
      if(!transcript.textContent.trim()){
        transcript.classList.add('ghost');
        transcript.textContent = 'Powiedz, co chcesz zamówić…';
      }
    };
    rec.onresult = (ev)=>{
      let finalText = '', interim = '';
      for(let i=ev.resultIndex; i<ev.results.length; i++){
        const t = ev.results[i][0].transcript;
        if(ev.results[i].isFinal) finalText += t; else interim += t;
      }
      const txt = dedupeWords((finalText || interim).trim());
      transcript.classList.toggle('ghost', !txt);
      transcript.textContent = txt || 'Słucham…';

      if(finalText){
        const {dish, time} = parseOrder(finalText);
        const parts = [];
        if(dish) parts.push(`Zamawiam ${dish}`);
        if(time) parts.push(`na ${time}`);
        if(parts.length) speak('OK. ' + parts.join(' ') + '.');
      }
    };

    try{ rec.start(); }catch(_){}
  };

  const stopRec = ()=>{ try{ rec && rec.stop(); }catch(_){ } };

  // UI bind
  [logoBtn, micBtn].forEach(el=>{
    el.addEventListener('click', startRec, {passive:true});
  });

  // kafelki – tylko zaznaczenie aktywnej
  const tiles = {
    food:  document.getElementById('tileFood'),
    taxi:  document.getElementById('tileTaxi'),
    hotel: document.getElementById('tileHotel'),
  };
  const selectTile = (key)=>{
    Object.values(tiles).forEach(t=>t.classList.remove('active'));
    tiles[key].classList.add('active');
  };
  tiles.food.addEventListener('click',  ()=>selectTile('food'));
  tiles.taxi.addEventListener('click',  ()=>selectTile('taxi'));
  tiles.hotel.addEventListener('click', ()=>selectTile('hotel'));

  // backend status – na razie lokalnie „ok”
  backendMsg.textContent = 'ok';

  // porządek przy nawigacji
  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

  // start placeholder
  transcript.textContent = 'Powiedz, co chcesz zamówić…';
  transcript.classList.add('ghost');
})();
