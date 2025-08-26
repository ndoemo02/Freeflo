;(() => {
  // -------------------- CONFIG --------------------
  function pick(metaName, winKey){
    const m = document.querySelector(`meta[name="${metaName}"]`);
    if (m && m.content) return m.content.trim();
    if (winKey && window[winKey]) return String(window[winKey]).trim();
    return '';
  }
  const C = {
    // ASR
    useWhisper : (pick('asr-provider','ASR_PROVIDER') || '').toLowerCase() === 'whisper',
    whisperUrl : pick('whisper-url','WHISPER_URL'),
    whisperAuth: pick('whisper-auth','WHISPER_AUTH'),

    // GPT proxy (bezpiecznie z backendu)
    gptProxy   : pick('gpt-proxy','GPT_PROXY'),
    openaiModel: pick('openai-model','OPENAI_MODEL') || 'gpt-4o-mini',
  };

  // -------------------- DOM --------------------
  const app        = document.getElementById('app');
  const logoBtn    = document.getElementById('logoBtn');
  const micBtn     = document.getElementById('micBtn');
  const transcript = document.getElementById('transcript');
  const dot        = document.getElementById('dot');
  const toast      = document.getElementById('toast');

  const tiles = {
    food : document.getElementById('tileFood'),
    taxi : document.getElementById('tileTaxi'),
    hotel: document.getElementById('tileHotel'),
  };

  // -------------------- HELPERS --------------------
  const setListening = (on)=>{
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if(!on && !transcript.textContent.trim()){
      setGhost('Powiedz, co chcesz zamówić…');
    }
  };
  const setGhost = (msg)=>{ transcript.classList.add('ghost'); transcript.textContent = msg; };
  const setText  = (msg)=>{ transcript.classList.remove('ghost'); transcript.textContent = msg; };

  const speak = (txt, lang='pl-PL')=>{
    try{ window.speechSynthesis.cancel(); }catch(_){}
    try{
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = lang; window.speechSynthesis.speak(u);
    }catch(_){}
  };

  const showToast = (msg, ms=2500)=>{
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(()=> toast.classList.remove('show'), ms);
  };

  const selectTile = (key)=>{
    Object.values(tiles).forEach(t=>t.classList.remove('active'));
    tiles[key].classList.add('active');
  };
  tiles.food.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel.addEventListener('click',()=>selectTile('hotel'));

  // korekty typowych ASR-błędów
  const corrections = [
    [/kaplic+oza/gi, 'capricciosa'], [/kapric+i?oza/gi, 'capricciosa'],
    [/kugelf/gi, 'kugel'], [/kugle?l/gi, 'kugel'],
    [/w\s+ariel\b/gi, 'w Arielu'], [/do\s+ariel\b/gi, 'do Ariela'],
  ];
  const normalize = (s)=>{
    let out = s.replace(/\b(\w{2,})\s+\1\b/gi, '$1'); // „dwie dwie” → „dwie”
    for(const [re, to] of corrections) out = out.replace(re,to);
    return out.trim();
  };

  const parseOrder = (s)=>{
    const text = s.toLowerCase();
    // godzina „na 18:45”/„o 18”
    const tm = text.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    const time = tm ? `${String(tm[1]).padStart(2,'0')}:${tm[2] || '00'}` : null;

    // danie (po wycięciu frazy z godziną)
    const noTime = text.replace(/\b(?:na|o)\s*\d{1,2}(?::?\d{2})?\b/, ' ').replace(/\s{2,}/g,' ').trim();
    let dish = null;
    const dm = noTime.match(/[a-ząćęłńóśżź\- ]{3,}/i);
    if(dm){
      dish = dm[0].replace(/\b(i|a|na|do|w|z|o)\b.*$/,'').replace(/\s{2,}/g,' ').trim();
    }
    return { dish, time };
  };

  // -------------------- GPT przez backend --------------------
  async function gptSumm(text, dish, time){
    if (!C.gptProxy) return ''; // brak proxy – po prostu pomiń
    const r = await fetch(C.gptProxy, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text, dish, time, model: C.openaiModel })
    });
    if(!r.ok){
      const t = await r.text().catch(()=> '');
      throw new Error(`GPT proxy ${r.status}: ${t.slice(0,120)}`);
    }
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || 'GPT proxy error');
    return j.answer || '';
  }

  // -------------------- ASR: Whisper (opcjonalnie) --------------------
  async function whisperListenOnce(){
    if(!C.whisperUrl) throw new Error('Brak konfiguracji Whisper (meta whisper-url).');
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const stopP = new Promise((resolve)=> rec.onstop = resolve);
    rec.ondataavailable = (e)=>{ if(e.data && e.data.size) chunks.push(e.data); };

    setListening(true); setText('Słucham… (Whisper)'); rec.start();
    // klik gdziekolwiek zatrzymuje jednorazowe nagranie (mobile-friendly)
    const stop = ()=>{ try{rec.stop()}catch(_){ } window.removeEventListener('click', stop, true); };
    window.addEventListener('click', stop, true);

    await stopP; setListening(false);
    const blob = new Blob(chunks, { type:'audio/webm' });

    const form = new FormData();
    form.append('audio', blob, 'speech.webm');
    const headers = C.whisperAuth ? { 'Authorization': C.whisperAuth } : {};

    const res = await fetch(C.whisperUrl, { method:'POST', headers, body: form });
    if(!res.ok) throw new Error(`Whisper ${res.status}`);
    const data = await res.json().catch(()=> ({}));
    if(!data.text) throw new Error('Whisper: brak pola "text".');
    return data.text;
  }

  // -------------------- ASR: Web Speech (domyślny) --------------------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function browserListenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR) return reject(new Error('Rozpoznawanie mowy wymaga Chrome/Edge lub użyj Whisper.'));
      const rec = new ASR();
      rec.lang = 'pl-PL'; rec.interimResults = true; rec.continuous = false;

      rec.onstart = ()=>{ setListening(true); setText('Słucham…'); };
      rec.onerror = (e)=>{ setListening(false); reject(new Error('ASR błąd: '+(e.error||''))); };
      rec.onend = ()=>{ setListening(false); };
      rec.onresult = (ev)=>{
        let finalText = '', interim = '';
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const t = ev.results[i][0].transcript;
          if(ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const raw = (finalText || interim).trim();
        setText(normalize(raw || ''));
        if(finalText) resolve(finalText);
      };
      try{ rec.start(); }catch(err){ reject(err); }
    });
  }

  // -------------------- FLOW --------------------
  async function handleFinalText(rawText){
    const text = normalize(rawText);
    setText(text);

    // parsowanie podstawowe
    const { dish, time } = parseOrder(text);

    // lokalne potwierdzenie
    let say = 'OK.';
    if(dish) say += ` Zamawiam ${dish}.`;
    if(time) say += ` Na ${time}.`;
    speak(say);

    // ładne jedno zdanie z backendowego GPT (opcjonalnie)
    if(C.gptProxy){
      try{
        const nice = await gptSumm(text, dish, time);
        if(nice){ setText(nice); speak(nice); }
      }catch(e){
        showToast('GPT chwilowo niedostępne'); // UI nie blokuje
      }
    }
  }

  async function startListening(){
    try{
      if(C.useWhisper) {
        const txt = await whisperListenOnce();
        await handleFinalText(txt);
      } else {
        const txt = await browserListenOnce();
        await handleFinalText(txt);
      }
    }catch(e){
      setText(e.message || 'Błąd rozpoznawania.');
      showToast(e.message || 'Błąd rozpoznawania.');
    }
  }

  // klik logo i przycisk mic → start
  [logoBtn, micBtn].forEach(el=> el.addEventListener('click', startListening, { passive:true }));

  // init
  setGhost('Powiedz, co chcesz zamówić…');

  // nawigacja: wyczyść TTS
  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
