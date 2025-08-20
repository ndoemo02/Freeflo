/* FREEFLOW minimal ASR client */
const CONFIG = {
  BACKEND_URL: (window.FREEFLOW_BACKEND || 'https://freeflow-backend-vercel.vercel.app').replace(/\/+$/,'')
};

const el = {
  micBtn: document.getElementById('micBtn'),
  console: document.getElementById('console'),
  pills: Array.from(document.querySelectorAll('.pill')),
  cartCount: document.getElementById('cartCount')
};

function log(role, text){
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="role">${role}:</span> ${text}`;
  el.console.appendChild(row);
  el.console.scrollTop = el.console.scrollHeight;
}
log('Asystent', 'Kliknij logo, aby mówić. Sprawdzam backend…');

// Health check
(async () => {
  try{
    const r = await fetch(`${CONFIG.BACKEND_URL}/api/health`, { cache:'no-store' });
    const j = await r.json().catch(()=>({}));
    if(r.ok && j?.ok) log('Asystent', `Backend OK (${new Date(j.ts||Date.now()).toLocaleTimeString()})`);
    else log('Asystent', 'Backend działa, ale odpowiedź niepełna.');
  }catch(e){
    log('Asystent', 'Nie mogę dotrzeć do /api/health – sprawdź domenę.');
  }
})();

// --- Recording (WebAudio/MediaRecorder) ---
let media, recorder, chunks = [], recActive = false;

async function ensureStream(){
  if(media) return media;
  media = await navigator.mediaDevices.getUserMedia({ audio: true });
  return media;
}

function stopRec(){
  if(recorder && recActive){
    recorder.stop();
    recActive = false;
    log('Asystent', 'Nagrywanie wyłączone.');
  }
}

async function startRec(){
  try{
    const stream = await ensureStream();
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e)=> { if(e.data?.size) chunks.push(e.data); };
    recorder.onstop = onStopSend;
    recorder.start();
    recActive = true;
    log('Asystent', 'Nagrywanie włączone.');
    // auto stop after 4.5s to reduce payload
    setTimeout(() => { if(recActive) stopRec(); }, 4500);
  }catch(err){
    log('Asystent', 'Brak uprawnień do mikrofonu lub przeglądarka nie wspiera.');
    console.error(err);
  }
}

async function onStopSend(){
  try{
    const blob = new Blob(chunks, { type: 'audio/webm' });
    if(!blob.size){ log('Asystent', 'Brak dźwięku.'); return; }
    const resp = await fetch(`${CONFIG.BACKEND_URL}/api/asr`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob
    });
    if(!resp.ok){
      const t = await resp.text();
      log('Asystent', `ASR błąd: ${resp.status} ${t.slice(0,140)}`);
      return;
    }
    const data = await resp.json();
    const text = data?.text || '';
    if(text) log('Ty', text);
    else log('Asystent', 'Nie udało się rozpoznać mowy.');
  }catch(e){
    log('Asystent', 'ASR błąd sieci: ' + e.message);
  }
}

// UI wiring
el.micBtn.addEventListener('click', () => {
  if(recActive) stopRec(); else startRec();
});

for(const p of el.pills){
  p.addEventListener('click', ()=>{
    // for now just log the intent; you can hook to /api/chat or /api/order
    log('Ty', p.dataset.intent);
  });
}

// Optional: expose config on window for quick override in console
window.__FREEFLOW__ = { CONFIG };


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
