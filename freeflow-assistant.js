// freeflow-assistant.js — stabilna baza klików + nasłuch (Web Speech jeśli jest)

(function(){
  const app        = document.getElementById('app');
  const logoBtn    = document.getElementById('logoBtn');
  const micBtn     = document.getElementById('micBtn');
  const transcript = document.getElementById('transcript');
  const dot        = document.getElementById('dot');
  const dbg        = document.getElementById('debug');

  const tiles = {
    food:  document.getElementById('tileFood'),
    taxi:  document.getElementById('tileTaxi'),
    hotel: document.getElementById('tileHotel'),
  };

  // --- helpers
  const showDbg = (msg)=>{
    if(!dbg) return;
    dbg.textContent = String(msg);
    dbg.classList.add('show');
    clearTimeout(dbg._t);
    dbg._t = setTimeout(()=>dbg.classList.remove('show'), 4000);
  };
  const setGhost = (txt)=>{
    transcript.classList.add('ghost');
    transcript.textContent = txt;
  };
  const setText = (txt)=>{
    transcript.classList.remove('ghost');
    transcript.textContent = txt;
  };
  const setListening = (on)=>{
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if(!on && !transcript.textContent.trim()){
      setGhost('Powiedz, co chcesz zamówić…');
    }
  };
  const speak = (txt)=>{
    try{
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = 'pl-PL';
      window.speechSynthesis.speak(u);
    }catch(_){}
  };

  const selectTile = (key)=>{
    Object.values(tiles).forEach(t=>t.classList.remove('active'));
    tiles[key].classList.add('active');
  };

  // kafelki klikają zawsze
  tiles.food.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel.addEventListener('click',()=>selectTile('hotel'));

  // --- ASR: Web Speech (Chrome/Edge)
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function listenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR){
        setText('Ta przeglądarka nie wspiera rozpoznawania mowy. Użyj Chrome/Edge.');
        return reject(new Error('No Web Speech API'));
      }
      const rec = new ASR();
      rec.lang = 'pl-PL';
      rec.interimResults = true;
      rec.continuous = false;

      rec.onstart = ()=>{ setListening(true); setText('Słucham…'); showDbg('start ASR'); };
      rec.onerror = (e)=>{ setListening(false); showDbg('ASR error: ' + (e.error||'')); reject(new Error(e.error||'asr')); };
      rec.onend = ()=>{ setListening(false); showDbg('end ASR'); };
      rec.onresult = (ev)=>{
        let finalText = '', interim = '';
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const t = ev.results[i][0].transcript;
          if(ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const txt = (finalText || interim || '').trim();
        setText(txt || 'Słucham…');
        if(finalText) resolve(finalText);
      };

      try { rec.start(); }
      catch(err){ showDbg('rec.start() fail'); reject(err); }
    });
  }

  async function startFlow(){
    // 1) natychmiastowa reakcja UI, żebyś widział że KLIK działa
    setText('Słucham…');
    showDbg('Klik działa (logo/mic)');

    // 2) spróbuj ASR
    try{
      const text = await listenOnce(); // jeśli user pozwoli na mikrofon
      if(text){
        // proste potwierdzenie
        speak('OK. Zapisuję: ' + text);
      }
    }catch(e){
      // brak uprawnień / brak ASR → nie blokujemy UI
      showDbg(e.message || e);
    }
  }

  // klik na logo i na 🎤
  logoBtn.addEventListener('click', startFlow, { passive:true });
  micBtn .addEventListener('click', startFlow, { passive:true });

  // pierwszy widok
  setGhost('Powiedz, co chcesz zamówić…');

  // sprzątanie TTS przy wyjściu
  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
