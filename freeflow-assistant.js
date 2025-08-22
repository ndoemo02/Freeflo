/* freeflow-assistant.js v4 – natychmiastowa transkrypcja, NLU, Google Places, potwierdzenie i testowe zamówienie */

const CONFIG = {
  BACKEND_URL: (window.FREEFLOW_BACKEND || 'https://freeflow-backend-vercel.vercel.app').replace(/\/+$/,''),
  TIMEOUT_MS: 12000
};

const $t = id => document.getElementById(id);
const $bubble = $t('transcript');
const $results = $t('results');
const $micBtn = $t('micBtn');
const $logo = document.querySelector('.logo');

function showTranscript(txt){ if($bubble){ $bubble.textContent = txt; } }
function showResults(html){ if($results){ $results.style.display='block'; $results.innerHTML = html; } }
function apip(p){ return `${CONFIG.BACKEND_URL}${p}`; }

async function fetchJson(url, opts={}, timeout=CONFIG.TIMEOUT_MS){
  const res = await Promise.race([
    fetch(url, { ...opts, headers:{ 'Content-Type':'application/json', ...(opts.headers||{}) }, cache:'no-store' }),
    new Promise((_,rej)=> setTimeout(()=>rej(new Error('TIMEOUT')), timeout))
  ]);
  if(!res.ok){
    const text = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} ${res.statusText} ${text||''}`);
  }
  return res.json();
}

async function callNLU(text){
  return fetchJson(apip('/api/nlu'), { method:'POST', body: JSON.stringify({ text }) });
}
async function searchPlaces(q, city, limit=3){
  const u = new URL(apip('/api/places'));
  u.searchParams.set('q', q||'pizza');
  if(city) u.searchParams.set('city', city);
  u.searchParams.set('limit', String(limit));
  return fetchJson(u.toString());
}
async function sendOrderTest(payload){
  return fetchJson(apip('/api/order-test'), { method:'POST', body: JSON.stringify(payload) });
}

function renderPlaceList(items){
  if(!items || !items.length) return '<div>Brak propozycji miejsc.</div>';
  return `
    <div>Wybierz lokal (powiedz lub kliknij):</div>
    ${items.map((it,idx)=>`
      <div class="option" data-idx="${idx+1}">
        ${idx+1}. <strong>${it.name}</strong> — ${it.address || 'adres —'}
        ${it.score ? ` ★${it.score}` : ''}
      </div>
    `).join('')}
    <div style="opacity:.7;margin-top:6px">Powiedz „jedynka/dwójka/trójka” lub kliknij.</div>
  `;
}

function renderSummary(o){
  const lines = [];
  lines.push(`🧾 <strong>Podsumowanie</strong>`);
  if(o.restaurant) lines.push(`Lokal: ${o.restaurant}`);
  if(o.city) lines.push(`Miasto: ${o.city}`);
  if(o.items?.length){
    lines.push('Pozycje:');
    for(const it of o.items){
      const wo = it.without?.length ? ` (bez: ${it.without.join(', ')})` : '';
      lines.push(`• ${it.qty||1} × ${it.name}${wo}`);
    }
  }
  lines.push(`Czas: ${o.time || '-'}`);
  lines.push(`<button id="confirmBtn">Potwierdź (TEST)</button> <button id="editBtn">Popraw</button>`);
  return lines.join('<br>');
}

function pickNumberFromText(t){
  t = ` ${t.toLowerCase()} `;
  if(t.includes('jedyn')) return 1;
  if(t.includes('dwój') || t.includes('dwa')) return 2;
  if(t.includes('trój') || t.includes('trzy')) return 3;
  const m = t.match(/(?:^|\s)([1-3])(?:\s|$)/); 
  return m ? parseInt(m[1],10) : null;
}

async function handleTextFlow(rawText){
  showTranscript(rawText);

  // 1) NLU
  let nlu;
  try {
    nlu = await callNLU(rawText);
  } catch(e){
    showResults(`<div>❌ NLU błąd: ${e.message}</div>`);
    return;
  }
  if(!nlu.ok){ showResults(`<div>⚠️ NLU problem: ${nlu.error||'?'}</div>`); return; }

  const r = nlu.parsed || {};
  const dish = r.dish || 'Danie';
  const qty  = r.qty || 1;
  const without = r.without || [];
  const time = r.time || null;
  const city = r.city || 'Katowice';

  // 2) Places
  let places = [];
  try{
    const p = await searchPlaces(dish.includes('Pizza')?'pizza':dish, city, 3);
    places = (p && p.items) || [];
  }catch(e){
    places = [];
  }
  showResults(renderPlaceList(places));

  // 3) Poczekaj na wybór lokalu / liczby
  const pick = await waitForPlacePick(places);
  if(!pick){ showResults(`<div>Przerwano wybór lokalu.</div>`); return; }

  const order = {
    restaurant: pick.name,
    city,
    time: time || 'jak najszybciej',
    items: [{ name: dish, qty, without }]
  };
  showResults(renderSummary(order));
  wireSummaryActions(order);
}

function waitForPlacePick(places){
  return new Promise(resolve=>{
    const handler = (ev)=>{
      const t = ev.target.closest('.option');
      if(t){
        const idx = parseInt(t.getAttribute('data-idx'),10)-1;
        document.removeEventListener('click', handler);
        resolve(places[idx] || null);
      }
    };
    document.addEventListener('click', handler, { passive:true });

    // dodatkowo nasłuchaj krótkiego rozpoznania mowy na „1/2/3”
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return; // brak mowy – tylko klik
    const rec = new SR();
    rec.lang = 'pl-PL'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e)=>{
      const t = e.results?.[0]?.[0]?.transcript || '';
      const n = pickNumberFromText(t);
      try { rec.stop(); } catch(_){}
      document.removeEventListener('click', handler);
      resolve(places[(n||0)-1] || null);
    };
    try { rec.start(); } catch(_){}
    setTimeout(()=> { try{rec.stop();}catch(_){ } }, 6000);
  });
}

function wireSummaryActions(order){
  const c = document.getElementById('confirmBtn');
  const e = document.getElementById('editBtn');
  if(c) c.addEventListener('click', async ()=>{
    try{
      const r = await sendOrderTest({ ...order, debugEmail: null });
      showResults(`<div>✅ Zamówienie (TEST) przyjęte: ${r.ok ? 'OK' : 'NIE'}</div>`);
    }catch(err){
      showResults(`<div>❌ Błąd wysyłki: ${err.message}</div>`);
    }
  });
  if(e) e.addEventListener('click', ()=>{
    showResults(`<div>OK, powiedz jeszcze raz co chcesz zamówić…</div>`);
  });
}

// --- Mikrofon z natychmiastową transkrypcją
(function setupMic(){
  if(!$micBtn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    $micBtn.addEventListener('click', ()=> showTranscript('🎤 Brak wsparcia rozpoznawania mowy w tej przeglądarce.'));
    return;
  }
  const rec = new SR();
  rec.lang = 'pl-PL'; rec.interimResults = true; rec.maxAlternatives = 1;

  rec.onstart = ()=> { $logo && $logo.classList.add('listening'); showTranscript('🎙️ Słucham…'); };
  rec.onend = ()=>   { $logo && $logo.classList.remove('listening'); };
  rec.onerror = (e)=> { $logo && $logo.classList.remove('listening'); showTranscript(`🎤 Błąd: ${e.error||e.message||e}`); };
  rec.onresult = (e)=>{
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      const txt = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        handleTextFlow(txt);
      } else {
        interim += txt + ' ';
      }
    }
    if (interim) showTranscript(interim);
  };

  $micBtn.addEventListener('click', ()=>{
    try { rec.start(); } catch(_) {}
  });
})();
