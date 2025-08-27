// freeflow-assistant.js — wersja z GPT (proxy) i Places (proxy)
// wklej 1:1

(() => {
  // ---------- CONFIG ----------
  const pick = (meta, winKey) => {
    const m = document.querySelector(`meta[name="${meta}"]`);
    if (m && m.content) return m.content.trim();
    if (winKey && window[winKey]) return String(window[winKey]).trim();
    return null;
  };
  const C = {
    lang: 'pl-PL',
    gptProxy:   pick('gpt-proxy',   'GPT_PROXY'),     // /api/gpt
    gmapsProxy: pick('gmaps-proxy', 'GMAPS_PROXY'),   // /api/places (już masz)
    gmapsKey:   pick('gmaps-key',   'GMAPS_KEY'),     // tylko do demo (front)
    maxList: 5,
    tts: true,
  };

  // ---------- DOM ----------
  const app        = document.getElementById('app');
  const transcript = document.getElementById('transcript');
  const micBtn     = document.getElementById('micBtn');
  const logoBtn    = document.getElementById('logoBtn');
  const dot        = document.getElementById('dot');
  const tiles = {
    food:  document.getElementById('tileFood'),
    taxi:  document.getElementById('tileTaxi'),
    hotel: document.getElementById('tileHotel'),
  };

  // ---------- UI helpers ----------
  const setGhost = (msg)=>{ transcript.classList.add('ghost'); transcript.textContent = msg; };
  const setText  = (msg)=>{ transcript.classList.remove('ghost'); transcript.textContent = msg; };
  const setListening = (on)=>{
    app?.classList.toggle('listening', on);
    if (dot) dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if (!on && !transcript.textContent.trim()) setGhost('Powiedz, co chcesz zamówić…');
  };
  let speakId=0;
  const speak = (txt)=>{
    if(!C.tts || !txt) return;
    try{ window.speechSynthesis.cancel(); }catch(_){}
    try{
      const id = ++speakId;
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = C.lang;
      u.onend = ()=>{ if(id===speakId){} };
      window.speechSynthesis.speak(u);
    }catch(_){}
  };

  // kafelki
  const selectTile=(key)=>{ Object.values(tiles).forEach(t=>t?.classList.remove('active')); tiles[key]?.classList.add('active'); };
  tiles.food?.addEventListener('click', ()=>selectTile('food'));
  tiles.taxi?.addEventListener('click', ()=>selectTile('taxi'));
  tiles.hotel?.addEventListener('click', ()=>selectTile('hotel'));

  // ---------- ASR (browser) ----------
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR) return reject(new Error('Włącz Chrome/Edge (Web Speech API).'));
      const rec = new ASR();
      rec.lang = C.lang; rec.interimResults = true; rec.continuous = false;
      let interimLast = '';
      rec.onstart = ()=>{ setListening(true); setText('Słucham…'); };
      rec.onerror = e =>{ setListening(false); reject(new Error('ASR błąd: '+(e.error||''))); };
      rec.onend   = ()=>{ setListening(false); if(interimLast) resolve(interimLast); };
      rec.onresult= ev=>{
        let final='', interim='';
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const t = ev.results[i][0].transcript;
          if(ev.results[i].isFinal) final+=t; else interim+=t;
        }
        const raw=(final||interim||'').trim();
        if(interim) interimLast=interim.trim();
        setText(normalize(raw));
        if(final) resolve(final);
      };
      try{ rec.start(); }catch(err){ reject(err); }
    });
  }

  // ---------- Normalize / parse ----------
  const corrections = [
    [/kaplic+oza/gi,'capricciosa'],[/kapric+i?oza/gi,'capricciosa'],
    [/kugelf?/gi,'kugel'],
  ];
  function normalize(s){
    let out=(s||'').replace(/\b(\w{2,})\s+\1\b/gi,'$1').trim();
    for(const [re,to] of corrections) out=out.replace(re,to);
    return out;
  }
  function parseTime(textLower){
    const m = textLower.match(/\b(?:na|o)\s*(\d{1,2})(?::?(\d{2}))?\b/);
    if(!m) return null;
    const hh = String(m[1]).padStart(2,'0'), mm = m[2]||'00';
    return `${hh}:${mm}`;
  }
  function parseDish(t){
    // bardzo prosto: złap typowe dania; przy demo wystarczy
    const m = t.match(/\b(margherita|capricciosa|diavola|carbonara|kugel|pierogi|ramen|sushi|burger|kebab)\b/i);
    return m ? m[0] : null;
  }

  // ---------- Places ----------
  function gmapsURL(path, params){
    const q = new URLSearchParams(params||{}).toString();
    if(C.gmapsProxy) return `${C.gmapsProxy}?path=${encodeURIComponent(path)}&${q}`;
    return `https://maps.googleapis.com${path}?${q}`; // tylko do demo
  }
  async function getGeo(){
    if(!('geolocation' in navigator)) return null;
    return new Promise(r=>{
      navigator.geolocation.getCurrentPosition(
        pos=>r({lat:pos.coords.latitude, lng:pos.coords.longitude}),
        _=>r(null), {timeout:5000}
      );
    });
  }
  async function placesTextSearch(query, around, radius=6000){
    if(!C.gmapsProxy && !C.gmapsKey){
      return [{ name:`Demo: ${query}`, formatted_address:'(demo)', rating:4.5 }];
    }
    const p = { query }; if(!C.gmapsProxy && C.gmapsKey) p.key=C.gmapsKey;
    if(around){ p.location=around; p.radius=radius; }
    try{
      const res = await fetch(gmapsURL('/maps/api/place/textsearch/json', p));
      if(!res.ok) throw 0;
      const j = await res.json();
      return j.results?.slice(0,C.maxList)||[];
    }catch{
      return [{ name:`Miejsce (offline): ${query}`, formatted_address:'—', rating:4.4 }];
    }
  }
  function summarizePlaces(list, howMany=1){
    if(!list||!list.length) return null;
    const pick = list.map(r=>({name:r.name, rating:r.rating||null, addr:r.formatted_address||r.vicinity||''}))
                     .sort((a,b)=>(b.rating||0)-(a.rating||0))
                     .slice(0,howMany);
    const lines = pick.map((r,i)=>{
      const rt = typeof r.rating==='number'?` (${r.rating.toFixed(1)}★)`: (r.rating?` (${r.rating}★)`: '');
      return `${i+1}. ${r.name}${rt}${r.addr?`, ${r.addr}`:''}`;
    });
    return { text: lines.join(' • '), topName: pick[0]?.name||'' };
  }

  // ---------- GPT (proxy) ----------
  async function gptConfirm(text, dish, time){
    if(!C.gptProxy) return null;
    try{
      const r = await fetch(C.gptProxy, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text, dish, time })
      });
      if(!r.ok) return null;
      const j = await r.json();
      return j?.message || null;
    }catch{ return null; }
  }

  // ---------- FLOW ----------
  function detectCategory(t){
    if (/(taxi|taksówk|przejazd|kurs)/i.test(t)) return 'taxi';
    if (/(hotel|nocleg|pokój)/i.test(t))        return 'hotel';
    if (/(pizz|restaurac|knajp|jedzen|obiad|kolac|sushi|pierog|kebab|burger)/i.test(t)) return 'restauracja';
    return null;
  }
  function detectNearPhrase(t){
    const m = t.match(/\b(na|w|we|przy|koło|obok)\s+([a-ząćęłńóśżź\-]+[a-ząćęłńóśżź]+)\b/iu);
    return m ? m[0] : '';
  }

  async function handleFinal(raw){
    const text = normalize(raw);
    setText(text);

    const tl = text.toLowerCase();
    const dish = parseDish(tl);
    const time = parseTime(tl);
    const cat  = detectCategory(tl);
    const near = detectNearPhrase(tl);

    let baseReply = 'Okej.';
    if (dish) baseReply += ` Zamawiam ${dish}.`;
    if (time) baseReply += ` Na ${time}.`;

    // Places (dla restauracji/taxi/hotel)
    if (cat){
      const geo = await getGeo();
      let q = cat;
      if (cat==='restauracja' && /pizz/i.test(tl)) q='pizzeria';
      if (near) q = `${q} ${near}`;
      const around = geo ? `${geo.lat},${geo.lng}` : null;
      const list = await placesTextSearch(q, around);
      const sum  = summarizePlaces(list, 1);
      if(sum?.topName) baseReply += ` Najbliżej: ${sum.topName}.`;
    }

    // GPT potwierdzenie (opcjonalnie)
    const gpt = await gptConfirm(text, dish, time);
    const say = gpt || baseReply;

    setText(say);
    speak(say);
  }

  async function start(){
    try{
      const finalText = await listenOnce();
      await handleFinal(finalText);
    }catch(e){
      setText(e.message || 'Błąd rozpoznawania.');
    }
  }

  // ---------- BIND ----------
  logoBtn?.addEventListener('click', start, {passive:true});
  micBtn ?.addEventListener('click', start, {passive:true});
  setGhost('Powiedz, co chcesz zamówić…');
  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

})();
