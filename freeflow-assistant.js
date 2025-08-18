/* freeflow-assistant.js — produkcyjny (ASR -> NLU -> TTS) */

const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app'
};

// --- Helpers ---
const $bubble = document.getElementById('transcript') || document.body;
const $tts = document.getElementById('ttsPlayer');
const apip = p => `${CONFIG.BACKEND_URL}${p}`;
const say = t => { if ($bubble?.textContent !== undefined) $bubble.textContent = t; };

// --- Health check, żeby UI pokazał status ---
async function healthCheck(){
  try{
    const r = await fetch(apip('/api/health'), { cache:'no-store' });
    const j = await r.json();
    if (j?.status === 'ok'){ say('✅ Połączono z serwerem. Kliknij logo i powiedz zamówienie.'); return true; }
    throw new Error('Zła odpowiedź health');
  }catch(e){
    say('❌ Nie udało się połączyć z serwerem.');
    console.error(e);
    return false;
  }
}

// --- ASR (nagrywanie i wysyłka) ---
let mediaStream, mediaRecorder, chunks = [], recording = false;

async function ensureMic(){
  if (mediaStream) return mediaStream;
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return mediaStream;
}
function stopRec(){
  if (mediaRecorder && recording){ mediaRecorder.stop(); recording = false; say('⏹️ Nagrywanie zatrzymane, wysyłam…'); }
}
async function startRec(){
  try{
    await ensureMic();
    chunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = (e)=>{ if(e.data?.size) chunks.push(e.data); };
    mediaRecorder.onstop = onStopSend;
    mediaRecorder.start();
    recording = true;
    say('🎙️ Nagrywam… (auto stop za ~4.5s)');
    setTimeout(()=> recording && stopRec(), 4500);
  }catch(err){
    say('❌ Brak uprawnień do mikrofonu lub brak wsparcia.');
    console.error(err);
  }
}

async function onStopSend(){
  try{
    const blob = new Blob(chunks, { type:'audio/webm' });
    if (!blob.size){ say('😕 Nie wykryto dźwięku.'); return; }

    // 1) ASR
    const asr = await fetch(apip('/api/asr'), { method:'POST', headers:{'Content-Type':'audio/webm'}, body: blob });
    const asrJson = await asr.json();
    const text = asrJson?.text || '';
    if (!text){ say('😕 ASR nic nie rozpoznał.'); return; }
    say('🗣️ ' + text);

    // 2) NLU
    const nlu = await fetch(apip('/api/nlu'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text })});
    const nluText = await nlu.text(); // czytamy jako text, żeby ładnie logować błędy
    if (!nlu.ok) throw new Error(`NLU ${nlu.status} ${nluText}`);
    const nluJson = JSON.parse(nluText);
    say('🧠 ' + JSON.stringify(nluJson.parsed || nluJson));

    // 3) (opcjonalnie) TTS z podsumowaniem
    const summary = nluJson?.summary || 'Zamówienie przyjęte.';
    try{
      const tts = await fetch(apip('/api/tts'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: summary })});
      if (tts.ok && $tts){ const buf = await tts.arrayBuffer(); $tts.src = URL.createObjectURL(new Blob([buf])); $tts.play().catch(()=>{}); }
    }catch(e){ /* TTS opcjonalny */ }

  }catch(e){
    say('❌ Błąd podczas przetwarzania: ' + e.message);
    console.error(e);
  }
}

// --- UI: przycisk mikrofonu na logo ---
document.getElementById('micBtn')?.addEventListener('click', ()=>{
  if (recording) stopRec(); else startRec();
});

// --- Quick actions => od razu NLU ---
document.querySelectorAll('[data-quick]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const t = `Zamówienie: ${btn.dataset.quick}. Pomóż dokończyć szczegóły.`;
    try{
      const r = await fetch(apip('/api/nlu'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: t })});
      const raw = await r.text();
      if (!r.ok) throw new Error(raw);
      const j = JSON.parse(raw);
      say('🧠 ' + JSON.stringify(j.parsed || j));
    }catch(e){ say('❌ Błąd NLU: ' + e.message); }
  });
});

// start
window.addEventListener('load', healthCheck);
