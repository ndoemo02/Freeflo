/* freeflow-assistant.js
 * Frontend-klient: health-check + NLU z obsługą timeout/retry.
 * Wymaga w HTML elementów: #transcript, #micBtn (opcjonalnie)
 */

const CONFIG = {
  // ← Podmień, jeśli masz inny backend:
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app',
  TIMEOUT_MS: 12000,
  NLU_RETRIES: 1
};

// ---------- helpers ----------
const $ = (id)=> document.getElementById(id);
const $bubble = $('transcript');
const $micBtn = $('micBtn');

const show = (txt)=> { if ($bubble) $bubble.textContent = txt; };
const apip = (path)=> `${CONFIG.BACKEND_URL}${path}`;

function withTimeout(promise, ms = CONFIG.TIMEOUT_MS){
  return Promise.race([
    promise,
    new Promise((_,rej)=> setTimeout(()=> rej(new Error('TIMEOUT')), ms))
  ]);
}

async function fetchJson(url, opts={}, {retries=0}={}){
  const run = async ()=>{
    const res = await withTimeout(fetch(url,{
      ...opts,
      headers: {'Content-Type':'application/json', ...(opts.headers||{})},
      cache:'no-store'
    }));
    if(!res.ok){
      const t = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${t||''}`.trim());
    }
    return res.json();
  };
  try { return await run(); }
  catch(e){ if(retries>0) return fetchJson(url,opts,{retries:retries-1}); throw e; }
}

// ---------- API ----------
async function healthCheck(){
  try{
    const j = await fetchJson(apip('/api/health'));
    if(j && j.status==='ok'){ return true; }
    return false;
  }catch{ return false; }
}

async function callNLU(text){
  const body = JSON.stringify({ text: String(text||'').trim() });
  return fetchJson(apip('/api/nlu'), { method:'POST', body }, { retries: CONFIG.NLU_RETRIES });
}

// ---------- render ----------
function renderParsed(nlu){
  // Obsłuż nowy i stary kształt
  const p = nlu.parsed || nlu || {};
  let resto = p.restaurant_name || p.restaurant_id || '–';
  let when  = p.when || p.godzina || '–';

  let items = [];
  if (Array.isArray(p.items) && p.items.length){
    items = p.items.map(i=>{
      const name = i.name || 'pozycja';
      const qty  = i.qty ?? 1;
      const wo   = (i.without && i.without.length) ? ` (bez: ${i.without.join(', ')})` : '';
      return `• ${qty} × ${name}${wo}`;
    });
  } else {
    // fallback do starego pola danie/ilosc/opcje
    if (p.danie){
      const wo = (p.opcje && p.opcje.length) ? ` (bez: ${p.opcje.join(', ')})` : '';
      const qty = p.ilosc ?? 1;
      items = [`• ${qty} × ${p.danie}${wo}`];
    }
  }

  show(`🧾 Zamówienie:
Restauracja: ${resto}
${items.length ? items.join('\n') : '• (brak pozycji)'}
Czas: ${when}`);
}

// Publiczne API
window.sendToAssistant = async function(text){
  if(!text || !String(text).trim()){ show('🙂 Powiedz lub kliknij, co zamówić…'); return; }
  show('⏳ Przetwarzam…');
  const ok = await healthCheck();
  if(!ok){ show('❌ Backend niedostępny (health).'); return; }

  try{
    const nlu = await callNLU(text);
    if(nlu && (nlu.ok || nlu.parsed)) renderParsed(nlu);
    else show('⚠️ NLU: odpowiedź nieoczekiwana.');
  }catch(e){
    const msg = e?.message || String(e);
    show(`❌ Błąd NLU. ${msg.includes('Failed to fetch') ? 'Sprawdź BACKEND_URL i CORS.' : msg}`);
  }
};

// ---------- Mic (opcjonalnie) ----------
(function setupMic(){
  if(!$micBtn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    $micBtn.addEventListener('click', ()=> show('🎤 Brak wsparcia rozpoznawania mowy w tej przeglądarce.'));
    return;
  }
  const rec = new SR();
  rec.lang = 'pl-PL';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  let listening = false;
  const setLbl = (t)=> $micBtn.setAttribute('aria-label', t);

  rec.onstart = ()=> { listening=true; setLbl('Nasłuchiwanie…'); show('🎙️ Słucham…'); };
  rec.onerror = (e)=> { listening=false; setLbl('Błąd mikrofonu'); show(`🎤 Błąd: ${e.error||e.message||e}`); };
  rec.onend = ()=> { listening=false; setLbl('Naciśnij, aby mówić'); };
  rec.onresult = (e)=> {
    const t = e.results?.[0]?.[0]?.transcript;
    if(t) window.sendToAssistant(t); else show('🙂 Nic nie zrozumiałem, spróbuj jeszcze raz.');
  };

  $micBtn.addEventListener('click', ()=>{
    if(listening){ try{ rec.stop(); }catch{}; return; }
    try{ rec.start(); }catch(err){ show(`🎤 Nie mogę uruchomić: ${err?.message||err}`); }
  });
})();

// ---------- start ----------
(async ()=> {
  const ok = await healthCheck();
  show(ok ? 'Powiedz lub kliknij pozycję z menu…' : '❌ Backend niedostępny (health).');
})();
