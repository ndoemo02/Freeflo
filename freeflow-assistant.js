/* freeflow-assistant.js — UI + voice → NLU → czytelne podsumowanie (demo) */

const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app', // ← twój backend
  TIMEOUT_MS: 12000,
  NLU_RETRIES: 1,
};

function $(id){ return document.getElementById(id); }
const $bubble = $('transcript');
const $micBtn = $('micBtn');

function show(t){ if($bubble) $bubble.textContent = t; }
function apip(p){ return `${CONFIG.BACKEND_URL}${p}`; }

function withTimeout(promise, ms=CONFIG.TIMEOUT_MS){
  return Promise.race([promise, new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT')),ms))]);
}
async function fetchJson(url, opts={}, {retries=0}={}){
  async function run(){
    const r = await withTimeout(fetch(url, { ...opts, headers:{ 'Content-Type':'application/json', ...(opts.headers||{}) }, cache:'no-store' }));
    if(!r.ok){ throw new Error(`HTTP ${r.status}`); }
    return r.json();
  }
  try{ return await run(); } catch(e){ if(retries>0) return fetchJson(url,opts,{retries:retries-1}); throw e; }
}

async function health(){
  try{
    const j = await fetchJson(apip('/api/health'));
    return j?.status === 'ok';
  }catch{ return false; }
}

async function callNLU(text){
  return fetchJson(apip('/api/nlu'), { method:'POST', body: JSON.stringify({ text: String(text||'').trim() }) }, { retries: CONFIG.NLU_RETRIES });
}

function renderOrderSummary(parsed){
  // Obsługa dwóch formatów (stary „danie/ilosc/godzina” i nowy „items/when”)
  const items = parsed.items?.length
    ? parsed.items.map(i=>{
        const nm = i.name || parsed.danie || 'pozycja';
        const q  = i.qty ?? parsed.ilosc ?? 1;
        const wo = i.without?.length ? ` (bez: ${i.without.join(', ')})` : '';
        return `• ${q} × ${nm}${wo}`;
      }).join('\n')
    : `• ${(parsed.ilosc??1)} × ${(parsed.danie||'pozycja')}${(parsed.opcje?.length?` (bez: ${parsed.opcje.join(', ')})`:'')}`;

  const resto = parsed.restaurant_name || parsed.restaurant_id || '-';
  const when  = parsed.when || parsed.godzina || '-';

  return `🧾 Zamówienie:
Restauracja: ${resto}
${items}
Czas: ${when}`;
}

// Publiczne API – wywołaj np. z „chipów” w UI
window.sendToAssistant = async function(text){
  if(!text || !String(text).trim()){ show('🙂 Powiedz lub kliknij pozycję…'); return; }
  show('⏳ Przetwarzam…');

  const ok = await health();
  if(!ok){ show('❌ Backend niedostępny (health)'); return; }

  try{
    const nlu = await callNLU(text);
    if(nlu?.ok){
      show(renderOrderSummary(nlu.parsed || {}));
    }else{
      show('⚠️ NLU: odpowiedź nieoczekiwana');
    }
  }catch(e){
    show(`❌ Błąd NLU: ${e.message||e}`);
  }
};

// Głos (Web Speech API; mobilny Chrome/Android działa, iOS bywa kapryśny)
(function setupMic(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!$micBtn) return;
  if(!SR){ $micBtn.onclick = ()=> show('🎤 Brak wsparcia rozpoznawania mowy w tej przeglądarce.'); return; }

  const rec = new SR();
  rec.lang = 'pl-PL'; rec.interimResults = false; rec.maxAlternatives = 1;

  let listening = false;
  function setLabel(t){ $micBtn.setAttribute('aria-label', t); }

  rec.onstart = ()=>{ listening = true; setLabel('Nasłuchiwanie…'); show('🎙️ Słucham…'); };
  rec.onerror = e => { listening = false; setLabel('Błąd mikrofonu'); show(`🎤 Błąd: ${e.error||e}`); };
  rec.onend = ()=>{ listening = false; setLabel('Naciśnij, aby mówić'); };
  rec.onresult = e => {
    const t = e.results?.[0]?.[0]?.transcript;
    if(t) window.sendToAssistant(t); else show('🙂 Nic nie zrozumiałem, spróbuj jeszcze raz.');
  };

  $micBtn.onclick = ()=>{
    if(listening){ try{ rec.stop(); }catch{}; return; }
    try{ rec.start(); }catch(e){ show(`🎤 Nie mogę uruchomić: ${e.message||e}`); }
  };
})();
