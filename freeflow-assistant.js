/* freeflow-assistant.js — wersja diagnostyczna */

const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app'
};

const $bubble =
  document.getElementById('transcript') ||
  document.querySelector('.bubble') ||
  document.body;

function say(t){ if($bubble?.textContent !== undefined) $bubble.textContent = t; else alert(t); }
function apip(p){ return `${CONFIG.BACKEND_URL}${p}`; }

async function healthCheck(){
  try{
    say('Łączenie: ' + apip('/api/health'));
    const r = await fetch(apip('/api/health'), { cache:'no-store' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if(j?.status === 'ok'){ say('✅ Połączono z serwerem. Kliknij logo aby wysłać test do NLU.'); return true; }
    throw new Error('Zła odpowiedź: ' + JSON.stringify(j));
  }catch(e){ say('❌ Nie udało się połączyć z serwerem: ' + e.message); console.error(e); return false; }
}

async function runNLU(text){
  try{
    say('Wysyłam do NLU…');
    const r = await fetch(apip('/api/nlu'), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text })
    });
    const raw = await r.text();
    if(!r.ok) throw new Error(`NLU ${r.status} ${raw}`);
    const data = JSON.parse(raw);
    say('🧠 ' + JSON.stringify(data.parsed || data));
  }catch(e){ say('❌ Błąd NLU: ' + e.message); console.error(e); }
}

let ready = false;
window.addEventListener('load', async ()=>{ ready = await healthCheck(); });

document.getElementById('micBtn')?.addEventListener('click', async ()=>{
  if(!ready){ ready = await healthCheck(); if(!ready) return; }
  runNLU('włoska pepperoni dwie na 18:45 bez oliwek');
});

document.querySelectorAll('[data-quick]').forEach(b=>{
  b.addEventListener('click', ()=> runNLU(`Zamówienie: ${b.dataset.quick}`));
});

window.__FREEFLOW__ = { CONFIG, healthCheck, runNLU };
