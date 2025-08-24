<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>FreeFlow — zamów głosem</title>
  <meta name="color-scheme" content="dark light" />
  <style>
    :root{
      --glass-bg: rgba(20,20,22,.55);
      --glass-brd: rgba(255,255,255,.12);
      --glass-blur: 18px;
      --text: #f6f7fb;
      --muted: #c7c9d1;
      --brand: #ff8a30;
      --focus: #21d4fd;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0;
      color:var(--text);
      font: 500 16px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Inter, "Helvetica Neue", Arial, "Noto Color Emoji", "Apple Color Emoji";
      background:#0d0f13 url(assets/Background.png) center/cover fixed no-repeat;
      -webkit-font-smoothing:antialiased;
      -moz-osx-font-smoothing:grayscale;
    }
    .page{
      min-height:100dvh;
      display:flex;
      flex-direction:column;
      gap:16px;
      padding: clamp(12px, 2.2vw, 24px);
      padding-bottom: calc(24px + env(safe-area-inset-bottom));
      background: radial-gradient(1200px 600px at 50% -200px, rgba(255,149,64,.12), transparent 60%);
      backdrop-filter: blur(0.5px);
    }

    /* header */
    .topbar{
      display:flex; align-items:center; justify-content:space-between;
      gap:12px;
    }
    .brand{
      display:flex; align-items:baseline; gap:10px; letter-spacing:.2px;
    }
    .brand b{color:var(--brand); font-weight:800; font-size:clamp(24px, 4.5vw, 36px)}
    .brand span{font-weight:800; font-size:clamp(24px, 4.5vw, 36px)}
    .tagline{color:var(--muted); font-size:14px; opacity:.9; margin-top:2px}
    .actions{display:flex; gap:10px}
    .chip{
      width:44px; height:44px; display:grid; place-items:center;
      border-radius:14px; background:var(--glass-bg);
      border:1px solid var(--glass-brd); backdrop-filter: blur(var(--glass-blur));
    }
    .cart-badge{
      position:absolute; transform:translate(14px,-14px);
      background:#ff9e3d; color:#101217; font-weight:800;
      min-width:26px; height:26px; padding:0 6px; border-radius:999px;
      display:grid; place-items:center; font-size:13px; border:2px solid #11151b;
    }

    /* headline */
    h1{
      margin:6px 0 0;
      font-weight:900; line-height:1.05;
      font-size: clamp(28px, 7.2vw, 56px);
      text-wrap:balance;
      text-shadow: 0 2px 18px rgba(0,0,0,.45);
    }
    .subhead{color:var(--muted); margin-top:6px; font-size:clamp(14px, 2.8vw, 18px)}

    /* center: logo droplet */
    .stage{
      display:grid; place-items:center;
      margin: clamp(10px, 3vw, 20px) 0 0;
    }
    .logoWrap{
      position:relative;
      width:min(82vw, 420px); /* rozmiar logo */
      user-select:none;
      -webkit-user-drag:none;
      -webkit-tap-highlight-color: transparent;
      filter: drop-shadow(0 12px 60px rgba(0,0,0,.55));
    }
    .logoWrap img{
      width:100%; height:auto; display:block; pointer-events:none;
    }
    .hit{
      position:absolute; inset:0; border-radius:36px;
      /* niewidzialny hitbox przycisku */
    }
    /* puls całej kropli podczas nagrywania */
    .listening .logoWrap{
      animation: pulse 1.1s ease-in-out infinite;
    }
    @keyframes pulse{
      0%,100%{ filter: drop-shadow(0 10px 48px rgba(255,136,64,.36)); transform: translateZ(0) scale(1)}
      50%{    filter: drop-shadow(0 12px 88px rgba(33,212,253,.55)); transform: translateZ(0) scale(1.015)}
    }

    /* transcription directly under droplet */
    .asr{
      margin: clamp(8px, 2vw, 14px) auto 0;
      width:min(92vw, 720px);
      border-radius:20px;
      padding:18px 20px;
      background:var(--glass-bg);
      border:1px solid var(--glass-brd);
      backdrop-filter: blur(var(--glass-blur));
      display:flex; align-items:center; gap:10px;
      box-shadow: 0 12px 50px rgba(0,0,0,.35);
    }
    .dot{width:10px; height:10px; border-radius:999px; background:#86e2ff; box-shadow:0 0 16px #86e2ff}
    .ghost{color:var(--muted)}
    .text{flex:1; min-height:1.2em}
    .micBtn{
      width:46px; height:46px; border-radius:14px; border:1px solid var(--glass-brd);
      background:linear-gradient(180deg, rgba(255,143,67,.18), rgba(33,212,253,.14));
      display:grid; place-items:center; cursor:pointer;
    }

    /* bottom dock */
    .dock{
      margin-top: clamp(14px, 3.5vh, 28px);
      display:flex; gap:14px; justify-content:center; flex-wrap:wrap;
    }
    .tile{
      display:flex; align-items:center; gap:12px;
      min-width: 150px; padding:14px 18px;
      border-radius:22px; background:var(--glass-bg);
      border:1px solid var(--glass-brd); backdrop-filter: blur(var(--glass-blur));
      color:#fff; font-weight:600;
    }
    .tile .i{font-size:22px}
    .tile.active{outline:2px solid rgba(33,212,253,.6)}

    /* summary toast (wyskakujące, nie nachodzi na transkrypcję) */
    .toast{
      position: fixed; left:50%; translate:-50% 0;
      bottom: calc(92px + env(safe-area-inset-bottom));
      width:min(92vw,740px);
      border-radius:20px; padding:16px 18px;
      background:var(--glass-bg); border:1px solid var(--glass-brd);
      backdrop-filter: blur(var(--glass-blur));
      box-shadow:0 12px 60px rgba(0,0,0,.4);
      display:none;
    }
    .toast.show{display:block}
    .row{display:flex; align-items:center; gap:10px; margin:6px 0; color:#e9ecf6}
    .row .b{font-weight:700; opacity:.92}

    /* helpers */
    .hidden{display:none !important}
    a,button{color:inherit}
  </style>
</head>
<body>
  <div class="page" id="app">

    <!-- top -->
    <header class="topbar">
      <div>
        <div class="brand"><b>Free</b><span>Flow</span></div>
        <div class="tagline">Voice to order — tryb testowy, bez profilowania</div>
      </div>
      <div class="actions">
        <div class="chip" aria-label="Menu" title="Menu">≡</div>
        <div class="chip" style="position:relative" aria-label="Koszyk" title="Koszyk">
          🛒 <span class="cart-badge" id="cartCount">11</span>
        </div>
      </div>
    </header>

    <!-- headline -->
    <h1>Złóż zamówienie</h1>
    <div class="subhead">Jedzenie, Taxi albo nocleg — powiedz lub kliknij.</div>

    <!-- center: logo -->
    <section class="stage">
      <div class="logoWrap" id="logoWrap">
        <img src="assets/freeflow.png" alt="FreeFlow" width="840" height="1080" />
        <button class="hit" id="logoBtn" aria-label="Naciśnij, aby mówić"></button>
      </div>

      <!-- transcription under droplet -->
      <div class="asr" id="asrBox" role="status" aria-live="polite">
        <div class="dot" id="dot"></div>
        <div class="text ghost" id="transcript">Powiedz, co chcesz zamówić…</div>
        <button class="micBtn" id="micBtn" title="Start/Stop">🎤</button>
      </div>
    </section>

    <!-- toast summary -->
    <div class="toast" id="summary">
      <div class="row"><span>✅</span><span class="b">Status:</span><span>gotowe</span></div>
      <div class="row" id="rowDish"   ><span>🍽️</span><span class="b">Danie:</span> <span id="sumDish">—</span></div>
      <div class="row" id="rowPlace"  ><span>📍</span><span class="b">Miejsce:</span><span id="sumPlace">—</span></div>
      <div class="row" id="rowTime"   ><span>⏰</span><span class="b">Godzina:</span><span id="sumTime">—</span></div>
      <div class="row" id="rowPrice"  ><span>💲</span><span class="b">Cena:</span><span id="sumPrice">demo</span></div>
    </div>

    <!-- bottom dock -->
    <nav class="dock" aria-label="Kategorie">
      <button class="tile active" id="tileFood"><span class="i">🍽️</span> <span>Jedzenie</span></button>
      <button class="tile" id="tileTaxi"><span class="i">🚕</span> <span>Taxi</span></button>
      <button class="tile" id="tileHotel"><span class="i">🏡</span> <span>Hotel</span></button>
    </nav>

  </div>

  <script>
  ;(() => {
    const app        = document.getElementById('app');
    const logoBtn    = document.getElementById('logoBtn');
    const logoWrap   = document.getElementById('logoWrap');
    const micBtn     = document.getElementById('micBtn');
    const transcript = document.getElementById('transcript');
    const dot        = document.getElementById('dot');
    const summary    = document.getElementById('summary');
    const sumDish    = document.getElementById('sumDish');
    const sumPlace   = document.getElementById('sumPlace');
    const sumTime    = document.getElementById('sumTime');

    // --- helpers
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
    const setListening = (on)=>{
      app.classList.toggle('listening', on);
      dot.style.background = on ? '#21d4fd' : '#86e2ff';
      transcript.classList.toggle('ghost', !on && !transcript.textContent.trim());
    };

    // minimalna deduplikacja „dwie dwie” itp.
    const dedupeWords = (s)=>{
      return s.replace(/\b(\w+)(?:\s+\1){1,}\b/gi, '$1'); // usuń powtórzenia
    };

    // proste NLP (demo): wyłuskaj potrawę + godzinę
    const parseOrder = (s)=>{
      const text = s.toLowerCase();
      // czas: „na 18:00”, „na 18”, „o 19”
      const mTime = text.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
      const time  = mTime ? (mTime[1].padStart(2,'0') + ':' + (mTime[2] ? mTime[2] : '00')) : null;

      // potrawa: cokolwiek po słowie „dwie|jedną|…”
      const mDish = text.match(/\b(?:jedna|jedną|dwie|trzy|cztery)?\s*([a-ząćęłńóśżź\- ]{3,})\b/);
      let dish = null;
      if(mDish){ dish = mDish[1].trim().replace(/\b(na|o)\b.*$/,'').trim(); }
      return { dish, time };
    };

    // toast
    const showSummary = ({dish, place, time})=>{
      if(dish){ sumDish.textContent = dish; document.getElementById('rowDish').style.display='flex'; }
      else     document.getElementById('rowDish').style.display='none';

      if(place){ sumPlace.textContent = place; document.getElementById('rowPlace').style.display='flex'; }
      else      document.getElementById('rowPlace').style.display='none';

      if(time){ sumTime.textContent = time; document.getElementById('rowTime').style.display='flex'; }
      else     document.getElementById('rowTime').style.display='none';

      summary.classList.add('show');
      // auto-hide po 5s
      clearTimeout(summary._t);
      summary._t = setTimeout(()=>summary.classList.remove('show'), 5000);
    };

    // --- Web Speech API (Chrome/Edge)
    const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null, recognizing = false;

    const startRec = ()=>{
      if(!ASR){ transcript.textContent = 'Rozpoznawanie mowy wymaga Chrome/Edge.'; return; }
      if(recognizing){ stopRec(); return; }

      rec = new ASR();
      rec.lang = 'pl-PL';
      rec.interimResults = true;
      rec.continuous = false;

      rec.onstart = ()=>{ recognizing=true; setListening(true); transcript.textContent='Słucham…'; transcript.classList.remove('ghost'); };
      rec.onerror = (e)=>{ recognizing=false; setListening(false); transcript.textContent = 'Błąd rozpoznawania: '+(e.error||''); };
      rec.onend = ()=>{ recognizing=false; setListening(false); if(!transcript.textContent.trim()) transcript.textContent='Powiedz, co chcesz zamówić…'; };

      rec.onresult = (ev)=>{
        let finalText = '', interim = '';
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const t = ev.results[i][0].transcript;
          if(ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const txt = dedupeWords((finalText || interim).trim());
        transcript.textContent = txt || 'Słucham…';

        if(finalText){
          // parsowanie i podsumowanie
          const {dish, time} = parseOrder(finalText);
          showSummary({dish, time});
          // TTS potwierdzenia
          try{
            const ut = new SpeechSynthesisUtterance(`OK. ${dish?`Zamawiam ${dish}`:''} ${time?`na ${time}`:''}.`);
            ut.lang='pl-PL'; window.speechSynthesis.speak(ut);
          }catch(_){}
        }
      };

      try{ rec.start(); }catch(_){}
    };
    const stopRec = ()=>{ try{ rec && rec.stop(); }catch(_){ } };

    // UI bind
    [logoBtn, micBtn].forEach(el=>{
      el.addEventListener('click', startRec, {passive:true});
    });

    // kafelki
    const tiles = {
      food: document.getElementById('tileFood'),
      taxi: document.getElementById('tileTaxi'),
      hotel: document.getElementById('tileHotel'),
    };
    const selectTile = (key)=>{
      Object.values(tiles).forEach(t=>t.classList.remove('active'));
      tiles[key].classList.add('active');
    };
    tiles.food.addEventListener('click', ()=>selectTile('food'));
    tiles.taxi.addEventListener('click', ()=>selectTile('taxi'));
    tiles.hotel.addEventListener('click',()=>selectTile('hotel'));

    // zamknij TTS na nawigacji
    window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

    // pierwsze wejście
    transcript.textContent='Powiedz, co chcesz zamówić…';
  })();
  </script>
</body>
</html>
