/* freeflow-assistant.js — klient: health + AGENT (Places + menu fallback) + TTS */
const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app', // ← Twój backend
  TIMEOUT_MS: 12000,
};

function $(id){ return document.getElementById(id); }
const $bubble = $('transcript');         // pole transkrypcji
const $micBtn = $('micBtn');             // przycisk mic
const $logoBtn = $('logoBtn');           // klikalna „kropla”
const $app = $('app');
const $toast = $('summary');             // jeśli masz toasta — opcjonalne

function show(txt){ if ($bubble) $bubble.textContent = txt; }
function apip(path){ return `${CONFIG.BACKEND_URL}${path}`; }

function withTimeout(promise, ms = CONFIG.TIMEOUT_MS){
  return Promise.race([
    promise,
    new Promise((_,rej)=> setTimeout(()=>rej(new Error('TIMEOUT')), ms))
  ]);
}
async function fetchJson(url, opts = {}){
  const res = await withTimeout(fetch(url, {
    ...opts,
    headers: { 'Content-Type':'application/json', ...(opts.headers||{}) },
    cache: 'no-store'
  }));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// geolokalizacja (opcjonalnie do Places)
function getGeo(){
  return new Promise(resolve=>{
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      _   => resolve(null),
      { enableHighAccuracy:true, timeout:3500, maximumAge:10000 }
    );
  });
}

// --------- AGENT CALL ---------
async function callAgent(text){
  const geo = await getGeo();
  const body = { text };
  if (geo) { body.lat = geo.lat; body.lng = geo.lng; }
  return fetchJson(apip('/api/agent'), { method:'POST', body: JSON.stringify(body) });
}

function speak(line){
  try{
    const u = new SpeechSynthesisUtterance(line);
    u.lang = 'pl-PL';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }catch(_){}
}

// Publiczne API z UI: wywołaj głosem lub klikami
window.sendToAssistant = async function(text){
  if (!text || !String(text).trim()){
    show('🙂 Powiedz lub wpisz, co zamówić…');
    return;
  }
  show('⏳ Przetwarzam…');

  try{
    const data = await callAgent(text);
    if (!data || !data.ok){
      show('⚠️ Agent: błąd odpowiedzi.');
      return;
    }

    // Follow-ups → pokaż w polu transkrypcji i przeczytaj
    if (data.followups && data.followups.length){
      const line = '🔎 ' + data.followups.join(' ');
      show(line);
      speak(line);
      return;
    }

    // Brak follow-ups → podsumowanie zamówienia
    const s = data.summary || {};
    const parts = [];
    if (s.restaurant?.name) parts.push(`Restauracja: ${s.restaurant.name}`);
    if (s.item?.name){
      const wo = (s.item.without && s.item.without.length) ? ` (bez: ${s.item.without.join(', ')})` : '';
      parts.push(`Pozycja: ${s.qty||1} × ${s.item.name}${wo}`);
    }
    if (s.when) parts.push(`Godzina: ${s.when}`);
    show('🧾 ' + (parts.join(' • ') || 'Brak danych'));
    if (data.tts) speak(data.tts);

  }catch(e){
    const msg = e?.message || String(e);
    show(`❌ Błąd: ${msg.includes('Failed to fetch')?'Sprawdź BACKEND_URL i CORS.':msg}`);
  }
};

// --------- MIKROFON (Web Speech API) ---------
(function setupMic(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recognizing = false;

  function setListening(on){
    if ($app) $app.classList.toggle('listening', on);
  }

  const start = ()=>{
    if (!SR){ show('🎤 Wymagany Chrome/Edge (Web Speech API).'); return; }
    if (recognizing){ try{ rec.stop(); }catch(_){}; return; }

    rec = new SR();
    rec.lang = 'pl-PL';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = ()=>{ recognizing=true; setListening(true); show('🎙️ Słucham…'); };
    rec.onerror = (e)=>{ recognizing=false; setListening(false); show('🎤 Błąd: ' + (e.error||'')); };
    rec.onend   = ()=>{ recognizing=false; setListening(false); if (!$bubble.textContent.trim()) show('Powiedz, co chcesz zamówić…'); };

    rec.onresult = (ev)=>{
      let finalText = '', interim = '';
      for(let i=ev.resultIndex;i<ev.results.length;i++){
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      const txt = (finalText || interim || '').trim().replace(/\b(\w+)(?:\s+\1){1,}\b/gi, '$1');
      show(txt || 'Słucham…');

      if (finalText){
        window.sendToAssistant(finalText);
      }
    };

    try{ rec.start(); }catch(_){}
  };

  if ($micBtn)  $micBtn.addEventListener('click', start, {passive:true});
  if ($logoBtn) $logoBtn.addEventListener('click', start, {passive:true});
})();
