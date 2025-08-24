/* freeflow-assistant.js
 * UI + ASR + NLU: pokazuj od razu transkrypcję, animacje start/stop.
 * Ustaw BACKEND_URL na swój backend.
 */

const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app',
  TIMEOUT_MS: 12000,
  NLU_RETRIES: 1,
};

function $(id){ return document.getElementById(id) }
const $bubble = $('transcript');
const $micBtn = $('micBtn');

function show(txt){
  if ($bubble) $bubble.textContent = txt;
}

function apip(path){ return `${CONFIG.BACKEND_URL}${path}` }

function withTimeout(promise, ms = CONFIG.TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject)=> setTimeout(()=> reject(new Error('TIMEOUT')), ms))
  ]);
}

async function fetchJson(url, opts={}, {retries=0}={}){
  const run = async ()=>{
    const res = await withTimeout(fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) },
      cache: 'no-store',
    }));
    if(!res.ok){
      const t = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${t||''}`.trim());
    }
    return res.json();
  };
  try{ return await run() }
  catch(err){ if(retries>0) return fetchJson(url, opts, {retries:retries-1}); throw err; }
}

/* Health */
async function healthCheck(){
  try{
    const data = await fetchJson(apip('/api/health'));
    if (data && (data.status === 'ok' || data.ok === true)) { show('✅ Backend: ok'); return true; }
    show('⚠️ Backend: odpowiedź nieoczekiwana'); return false;
  }catch(e){
    show(`❌ Backend niedostępny: ${e.message || e}`); return false;
  }
}

/* NLU */
async function callNLU(text){
  const body = JSON.stringify({ text: String(text||'').trim() });
  return fetchJson(apip('/api/nlu'), { method:'POST', body }, { retries: CONFIG.NLU_RETRIES });
}

/* Public API */
window.sendToAssistant = async function(text){
  if (!text || !String(text).trim()) { show('🙂 Powiedz lub wpisz, co zamówić…'); return; }

  show('⏳ Przetwarzam…');
  const ok = await healthCheck(); if (!ok) return;

  try{
    const nlu = await callNLU(text);
    if (nlu && nlu.ok) {
      const r = nlu.parsed || {};
      const resto = r.restaurant_name || r.restaurant_id || r.resto || '–';
      const when  = r.when || r.godzina || '-';
      const items = (r.items || r.pozycje || []).map(i=>{
        const nm = i.name || i.nazwa || 'pozycja';
        const q  = i.qty ?? i.ilosc ?? 1;
        const wo = (i.without?.length) ? ` (bez: ${i.without.join(', ')})` : '';
        return `• ${q} × ${nm}${wo}`;
      }).join('\n');

      show(`🧾 Zamówienie:
Restauracja: ${resto}
${items || '• (brak pozycji)'}
Czas: ${when}`);
    } else {
      show('⚠️ NLU: odpowiedź nieoczekiwana');
    }
  }catch(e){
    const msg = (e && e.message) ? e.message : String(e);
    show(`❌ Błąd NLU. ${msg.includes('Failed to fetch') ? 'Sprawdź adres BACKEND_URL i CORS.' : msg}`);
  }
};

/* Mic + animacje */
(function setupMic(){
  if (!$micBtn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $micBtn.addEventListener('click', ()=> show('🎤 Brak wsparcia rozpoznawania mowy w tej przeglądarce.'));
    return;
  }

  const rec = new SR();
  rec.lang = 'pl-PL';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  let listening = false;
  const ui = (window.uiAnimations || { onListenStart(){}, onListenStop(){} });

  rec.onstart = ()=>{
    listening = true;
    ui.onListenStart();
    show('🎙️ Słucham…');
  };
  rec.onerror = (e)=>{
    listening = false;
    ui.onListenStop();
    show(`🎤 Błąd: ${e.error || e.message || e}`);
  };
  rec.onend = ()=>{
    listening = false;
    ui.onListenStop();
  };
  rec.onresult = (e)=>{
    const t = e.results?.[0]?.[0]?.transcript;
    if (t) {
      // pokaż natychmiast transkrypcję zanim wyślemy do NLU
      show('🗣️ ' + t);
      window.sendToAssistant(t);
    } else {
      show('🙂 Nic nie zrozumiałem, spróbuj jeszcze raz.');
    }
  };

  $micBtn.addEventListener('click', ()=>{
    if (listening) { try { rec.stop(); } catch{}; return; }
    try { rec.start(); } catch (e) { show(`🎤 Nie mogę uruchomić: ${e.message || e}`); }
  });
})();

/* Auto health */
healthCheck().catch(()=>{});
