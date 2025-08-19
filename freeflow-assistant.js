/* Frontend-klient: health-check + NLU z obsługą timeout/retry. */

const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app', // <- podmień jeśli inna domena
  TIMEOUT_MS: 12000,
  NLU_RETRIES: 1,
};

function $(id){ return document.getElementById(id); }
const $bubble = $('transcript');
const $micBtn = $('micBtn');
const $tts = $('ttsPlayer');

function show(t){ if($bubble) $bubble.textContent = t; }
function apip(p){ return `${CONFIG.BACKEND_URL}${p}`; }

function withTimeout(p, ms=CONFIG.TIMEOUT_MS){
  return Promise.race([ p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT')), ms)) ]);
}

async function fetchJson(url, opts={}, {retries=0}={}){
  const run = async ()=>{
    const res = await withTimeout(fetch(url, {
      ...opts,
      headers: { 'Content-Type':'application/json', ...(opts.headers||{}) },
      cache: 'no-store',
    }));
    if(!res.ok){
      const text = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text || ''}`.trim());
    }
    return res.json();
  };
  try { return await run(); }
  catch(e){ if(retries>0) return fetchJson(url, opts, {retries:retries-1}); throw e; }
}

// Health
async function healthCheck(){
  try{
    const data = await fetchJson(apip('/api/health'));
    if(data && data.status === 'ok'){ show('✅ Backend: ok'); return true; }
    show('⚠️ Backend: odpowiedź nieoczekiwana'); return false;
  }catch(e){
    show(`❌ Backend niedostępny: ${e.message||e}`); return false;
  }
}

// NLU
async function callNLU(text){
  const body = JSON.stringify({ text: String(text||'').trim() });
  return fetchJson(apip('/api/nlu'), { method:'POST', body }, { retries: CONFIG.NLU_RETRIES });
}

function pretty(o){ try{return JSON.stringify(o,null,2)}catch{return String(o)} }

// Public API
window.sendToAssistant = async function(text){
  if(!text || !String(text).trim()){ show('🙂 Powiedz lub wpisz, co zamówić…'); return; }
  show('⏳ Przetwarzam…');

  const ok = await healthCheck();
  if(!ok) return;

  try{
    const nlu = await callNLU(text);
    if(nlu && nlu.ok){
      const r = nlu.parsed || {};
      const resto = r.restaurant_name || r.restaurant_id || r.danie || '–';
      const when  = r.when || r.godzina || '–';
      const items = (r.items || []).map(i=>{
        const nm = i.name || r.danie || 'pozycja';
        const q  = i.qty ?? r.ilosc ?? 1;
        const wo = (i.without && i.without.length) ? ` (bez: ${i.without.join(', ')})` :
                   (r.opcje && r.opcje.length) ? ` (bez: ${r.opcje.join(', ')})` : '';
        return `• ${q} × ${nm}${wo}`;
      }).join('\n') || `• ${(r.ilosc ?? 1)} × ${(r.danie || 'pozycja')}` + ((r.opcje?.length)?` (bez: ${r.opcje.join(', ')})`:'');
      show(`🧾 Zamówienie:
Restauracja: ${resto}
${items}
Czas: ${when}`);
      // show('🧠 ' + pretty(nlu.parsed)); // debug
    }else{
      show('⚠️ NLU: odpowiedź nieoczekiwana');
    }
  }catch(e){
    const msg = e?.message || String(e);
    show(`❌ Błąd NLU. ${msg.includes('Failed to fetch') ? 'Sprawdź adres BACKEND_URL i CORS.' : msg}`);
  }
};

// Mic (opcjonalnie)
(function setupMic(){
  if(!$micBtn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    $micBtn.addEventListener('click', ()=> show('🎤 Brak wsparcia rozpoznawania mowy w tej przeglądarce.'));
    return;
  }
  const rec = new SR();
  rec.lang = 'pl-PL'; rec.interimResults = false; rec.maxAlternatives = 1;
  let listening = false;
  const setLabel = t => $micBtn.setAttribute('aria-label', t);

  rec.onstart = ()=>{ listening=true; setLabel('Nasłuchiwanie…'); show('🎙️ Słucham…'); };
  rec.onerror = e => { listening=false; setLabel('Błąd mikrofonu'); show(`🎤 Błąd: ${e.error||e.message||e}`); };
  rec.onend   = ()=>{ listening=false; setLabel('Naciśnij, aby mówić'); };
  rec.onresult= e => {
    const t = e.results?.[0]?.[0]?.transcript;
    if(t) window.sendToAssistant(t); else show('🙂 Nic nie zrozumiałem, spróbuj jeszcze raz.');
  };

  $micBtn.addEventListener('click', ()=>{
    if(listening){ try{ rec.stop(); }catch{} return; }
    try{ rec.start(); }catch(e){ show(`🎤 Nie mogę uruchomić: ${e.message||e}`); }
  });
})();

// Auto-health
healthCheck().catch(()=>{});
