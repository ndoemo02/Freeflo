// freeflow-assistant.js — wersja minimal+diagnostyka

const CONFIG = {
  BACKEND_URL: 'https://freeflow-backend-vercel.vercel.app'
};

const $bubble = document.getElementById('transcript');
const $mic    = document.getElementById('micBtn');
const $tts    = document.getElementById('ttsPlayer');

function say(t){ if($bubble) $bubble.textContent = t; }
function apip(p){ return `${CONFIG.BACKEND_URL}${p}`; }

// 0) Health-check — czy backend żyje
(async()=>{
  try{
    const r = await fetch(apip('/api/health'), {cache: 'no-store'});
    const j = await r.json().catch(()=>({}));
    say(j?.status ? `✅ Backend: ${j.status}` : '✅ Backend OK');
  }catch(e){
    console.error(e);
    say('❌ Nie udało się połączyć z serwerem.');
  }
})();

// 1) ASR
let mediaStream, mediaRecorder, chunks=[], recording=false;

function pickMime(){
  const cands=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus',''];
  for(const t of cands){ try{ if(!t || MediaRecorder.isTypeSupported(t)) return t; }catch{} }
  return '';
}
async function ensureMic(){
  if (mediaStream) return mediaStream;
  mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
  return mediaStream;
}
function stopRec(){
  if(mediaRecorder && recording){ mediaRecorder.stop(); recording=false; say('⏹️ Wysyłam…'); }
}
async function startRec(){
  try{
    await ensureMic();
    chunks=[];
    const mime=pickMime(), opts=mime?{mimeType:mime}:{};
    mediaRecorder = new MediaRecorder(mediaStream, opts);
    mediaRecorder.ondataavailable = e=>{ if(e.data?.size) chunks.push(e.data); };
    mediaRecorder.onerror = e=>{ console.error('MediaRecorder error', e); say('❌ Błąd nagrywania.'); };
    mediaRecorder.onstop = onStopSend;
    mediaRecorder.start();
    recording=true;
    say('🎙️ Nagrywam… (auto stop ~6s)');
    setTimeout(()=> recording && stopRec(), 6000);
  }catch(err){
    console.error(err);
    if (err?.name === 'NotAllowedError') say('❌ Brak zgody na mikrofon.');
    else say('❌ Ta przeglądarka nie wspiera nagrywania.');
  }
}
async function onStopSend(){
  try{
    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    if(!blob.size){ say('😕 Cisza. Spróbuj mówić bliżej mikrofonu.'); return; }

    // 2) ASR
    const asr = await fetch(apip('/api/asr'), {
      method:'POST',
      headers:{ 'Content-Type': blob.type || 'audio/webm' },
      body: blob
    });
    const asrText = await asr.text();
    if(!asr.ok) throw new Error(`ASR ${asr.status} ${asrText}`);
    const asrJson = JSON.parse(asrText);
    const text = asrJson?.text || '';
    if(!text){ say('😕 ASR nic nie rozpoznał.'); return; }
    say('🗣️ ' + text);

    // 3) NLU
    const nlu = await fetch(apip('/api/nlu'), {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ text })
    });
    const nluText = await nlu.text();
    if(!nlu.ok) throw new Error(`NLU ${nlu.status} ${nluText}`);
    const nluJson = JSON.parse(nluText);
    say('🧠 ' + JSON.stringify(nluJson.parsed || nluJson));

    // 4) TTS (opcjonalnie)
    const summary = nluJson?.summary || 'Zamówienie przyjęte.';
    try{
      const tts = await fetch(apip('/api/tts'), {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text: summary })
      });
      if(tts.ok && $tts){
        const buf=await tts.arrayBuffer();
        $tts.src = URL.createObjectURL(new Blob([buf]));
        $tts.play().catch(()=>{});
      }
    }catch(e){ console.debug('TTS skipped', e); }

  }catch(e){
    console.error(e);
    say('❌ Błąd: ' + e.message);
  }
}

// 5) Podpięcie do przycisku (fallback jeśli nie ma innego kodu)
$mic?.addEventListener('click', ()=> recording ? stopRec() : startRec() );

// 6) Eksport do debugowania
window._ff = { startRec, stopRec };
window.sendToAssistant = (txt)=>{
  (async()=>{
    try{
      say('🗣️ ' + txt);
      const r = await fetch(apip('/api/nlu'), {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text: txt })
      });
      const t = await r.text();
      if(!r.ok) throw new Error(`NLU ${r.status} ${t}`);
      const j = JSON.parse(t);
      say('🧠 ' + JSON.stringify(j.parsed || j));
    }catch(e){ say('❌ ' + e.message); }
  })();
};
