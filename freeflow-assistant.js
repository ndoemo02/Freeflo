/* freeflow-assistant.js — Voice + NLU + Confirm Modal (test mode) */

const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app', // ← PODMIEŃ na swój backend
  TIMEOUT_MS: 12000,
  NLU_RETRIES: 1,
};

function $(id){ return document.getElementById(id); }
const $bubble = $('transcript');
const $micBtn = $('micBtn');
const $tts    = $('ttsPlayer');

function show(txt){ if ($bubble) $bubble.textContent = txt; }
function apip(path){ return `${CONFIG.BACKEND_URL}${path}`; }

function withTimeout(p, ms = CONFIG.TIMEOUT_MS){
  return Promise.race([ p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT')), ms)) ]);
}
async function fetchJson(url, opts={}, {retries=0}={}){
  const run = async ()=>{
    const res = await withTimeout(fetch(url, {
      ...opts, headers:{ 'Content-Type':'application/json', ...(opts.headers||{}) }, cache:'no-store'
    }));
    if(!res.ok){ const t = await res.text().catch(()=> ''); throw new Error(`HTTP ${res.status} ${res.statusText} ${t}`.trim()); }
    return res.json();
  };
  try { return await run(); } catch(e){ if(retries>0) return fetchJson(url,opts,{retries:retries-1}); throw e; }
}

async function healthCheck(){
  try{
    const data = await fetchJson(apip('/api/health'));
    if(data && (data.status==='ok' || data.ok)) { show('✅ Backend: ok'); return true; }
    show('⚠️ Backend: odpowiedź nieoczekiwana'); return false;
  }catch(e){ show(`❌ Backend niedostępny: ${e.message||e}`); return false; }
}

// --- ASR sanity filters (śmieci, cisza, fantomy) ---
const BAD_PHRASES = [
  'napisy stworzone przez społeczność amara.org',
  'amara.org',
  'napisy stworzone przez społeczność amara',
];
function cleanTranscript(t){
  let s = (t || '').toLowerCase().trim();
  for(const bad of BAD_PHRASES){ if(s.includes(bad)) s = s.replaceAll(bad,'').trim(); }
  if(!s || s.length < 2) return '';
  return s;
}

// --- NLU ---
async function callNLU(text){
  const body = JSON.stringify({ text: String(text||'').trim() });
  return fetchJson(apip('/api/nlu'), { method:'POST', body }, { retries: CONFIG.NLU_RETRIES });
}

// --- ORDER (test mode) ---
async function sendOrder(payload){
  return fetchJson(apip('/api/order'), { method:'POST', body: JSON.stringify(payload) });
}

// Public API
window.sendToAssistant = async function(text){
  const cleaned = cleanTranscript(text);
  if(!cleaned){ show('🤫 Cisza — nic nie wysyłam.'); return; }
  show(cleaned); // szybkie echo

  const ok = await healthCheck(); if(!ok) return;

  try{
    const nlu = await callNLU(cleaned);
    if(!(nlu && nlu.ok)){ show('⚠️ NLU: odpowiedź nieoczekiwana'); return; }
    const r = nlu.parsed || {};

    const items = (r.items || []).map(i=>{
      const nm = i.name || 'pozycja';
      const q  = i.qty ?? 1;
      const wo = (i.without && i.without.length) ? ` (bez: ${i.without.join(', ')})` : '';
      return `• ${q} × ${nm}${wo}`;
    }).join('\n');

    show(`🧾 Zamówienie (podgląd)
Restauracja: ${r.restaurant_name || r.restaurant_id || '–'}
${items || '• (brak pozycji)'}
Czas: ${r.when || '–'}`);

    openConfirm(r);
  }catch(e){
    const msg = e?.message || String(e);
    show(`❌ Błąd NLU. ${msg.includes('Failed to fetch') ? 'Sprawdź BACKEND_URL i CORS.' : msg}`);
  }
};

// --- Confirm modal ---
function openConfirm(r){
  const modal = $('confirmModal');
  if(!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');

  $('m_rest').textContent  = r.restaurant_name || r.restaurant_id || '–';
  $('m_items').textContent = (r.items||[]).map(i=>{
    const wo = (i.without && i.without.length) ? ` (bez: ${i.without.join(', ')})` : '';
    return `${i.qty ?? 1} × ${i.name || 'pozycja'}${wo}`;
  }).join('\n') || '—';
  $('m_when').textContent  = r.when || '—';
  $('m_note').textContent  = r.note || '—';

  const close = ()=> { modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); };
  modal.querySelectorAll('[data-close]').forEach(el=> el.onclick = close);

  $('confirmBtn').onclick = async ()=>{
    try{
      const keep = !!$('keepData').checked;
      const payload = {
        restaurant_id: r.restaurant_id || null,
        restaurant_name: r.restaurant_name || null,
        items: r.items || [],
        when: r.when || null,
        note: r.note || '-',
        keep_data: keep
      };
      const res = await sendOrder(payload);
      if(res && res.ok){
        show(`✅ Przyjęto (tryb testowy). ID: ${res.id || '—'}`);
      }else{
        show('⚠️ Order: odpowiedź nieoczekiwana');
      }
    }catch(e){
      show('❌ Order błąd: ' + (e?.message || e));
    }finally{
      close();
    }
  };
}

// --- Mic setup ---
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
  rec.maxAlternatives = 3;

  let listening=false, heardSpeech=false, silenceTimer=null;
  const SILENCE_MS=2200, MIN_CONF=0.65;
  const setLabel = (t)=> $micBtn.setAttribute('aria-label', t);
  const armSilence = ()=>{
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(()=>{
      if(listening && !heardSpeech){ try{ rec.stop(); }catch{}; show('🤫 Cisza — nic nie wysyłam.'); }
    }, SILENCE_MS);
  };

  rec.onaudiostart = ()=>{ heardSpeech=false; armSilence(); };
  rec.onsoundstart = ()=> armSilence();
  rec.onspeechstart= ()=>{ heardSpeech=true; clearTimeout(silenceTimer); };
  rec.onaudioend   = ()=> clearTimeout(silenceTimer);

  rec.onstart = ()=>{ listening=true; setLabel('Nasłuchiwanie…'); show('🎙️ Słucham…'); };
  rec.onerror= (e)=>{ listening=false; setLabel('Błąd mikrofonu'); show(`🎤 Błąd: ${e.error||e.message||e}`); };
  rec.onend  = ()=>{ listening=false; setLabel('Naciśnij, aby mówić'); };

  rec.onresult = (e)=>{
    if(!heardSpeech){ show('🤫 Cisza — nic nie wysyłam.'); return; }
    const alts = Array.from(e.results?.[0] || []);
    let chosen='';
    for(const alt of alts){
      const orig = alt.transcript || '';
      const conf = typeof alt.confidence==='number' ? alt.confidence : 1.0;
      const cleaned = cleanTranscript(orig);
      const hasBad = BAD_PHRASES.some(p => orig.toLowerCase().includes(p));
      if(cleaned && !hasBad && conf >= MIN_CONF){ chosen = cleaned; break; }
      if(!chosen && cleaned && !hasBad) chosen = cleaned;
    }
    if(chosen) window.sendToAssistant(chosen);
    else show('🙂 Nic sensownego nie usłyszałem, spróbuj jeszcze raz.');
  };

  $micBtn.addEventListener('click', ()=>{
    if(listening){ try{ rec.stop(); }catch{}; return; }
    try{ heardSpeech=false; clearTimeout(silenceTimer); rec.start(); armSilence(); }
    catch(e){ show(`🎤 Nie mogę uruchomić: ${e.message||e}`); }
  });
})();

// Auto health
healthCheck().catch(()=>{});


/* FF hooks – nasłuch */
function ffOnSpeechStart(){
  try{ document.documentElement.classList.add('listening'); }catch(e){}
  if (window._ff && _ff.show) _ff.show('🎙️ Słucham…');
}
function ffOnSpeechEnd(){
  try{ document.documentElement.classList.remove('listening'); }catch(e){}
}
function ffOnPartialTranscript(t){
  if (window._ff && _ff.show) _ff.show(t||'');
}
function ffOnFinalTranscript(t){
  if (window._ff && _ff.show) _ff.show(t||'');
}
