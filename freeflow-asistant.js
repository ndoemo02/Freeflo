/* freeflow-assistant.js – FRONT */
const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app' // bez końcowego /
};

const $bubble = document.getElementById('transcript');
const $micBtn  = document.getElementById('micBtn');
function setBubble(t){ if($bubble) $bubble.textContent = t; }
function apip(p){ return `${CONFIG.BACKEND_URL}${p}`; }

async function healthCheck(){
  try{
    const r = await fetch(apip('/api/health'), { cache:'no-store' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if(j?.status==='ok'){ setBubble('✅ Połączono z serwerem. Kliknij logo i mów.'); return true; }
    throw new Error('Bad JSON');
  }catch(e){ setBubble('❌ Nie udało się połączyć z serwerem.'); console.error(e); return false; }
}

async function runNLU(text){
  try{
    const r = await fetch(apip('/api/nlu'),{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text })
    });
    if(!r.ok) throw new Error(`NLU ${r.status} ${await r.text()}`);
    const data = await r.json();
    setBubble('🧠 ' + JSON.stringify(data.parsed||data));
  }catch(e){ setBubble('❌ Błąd NLU: ' + e.message); console.error(e); }
}

let ready=false;
(async()=>{ ready = await healthCheck(); })();

$micBtn?.addEventListener('click', async ()=>{
  if(!ready){ ready = await healthCheck(); if(!ready) return; }
  runNLU('włoska pepperoni dwie na 18:45 bez oliwek');
});

document.querySelectorAll('[data-quick]').forEach(btn=>{
  btn.addEventListener('click', ()=> runNLU(`Zamówienie: ${btn.dataset.quick}`));
});

window.__FREEFLOW__ = { CONFIG, healthCheck, runNLU };
