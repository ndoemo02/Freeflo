// --- ASR (nagrywanie i wysyłka) ---
let mediaStream, mediaRecorder, chunks = [], recording = false;

function pickMime(){
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    '' // pozwól przeglądarce wybrać
  ];
  for (const t of candidates){
    try{
      if (!t || MediaRecorder.isTypeSupported(t)) return t;
    }catch{}
  }
  return ''; // fallback
}

async function ensureMic(){
  if (mediaStream) return mediaStream;
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return mediaStream;
}

function stopRec(){
  if (mediaRecorder && recording){
    mediaRecorder.stop();
    recording = false;
    say('⏹️ Nagrywanie zatrzymane, wysyłam…');
  }
}

async function startRec(){
  try{
    await ensureMic();
    chunks = [];

    const mimeType = pickMime();
    const opts = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(mediaStream, opts);

    mediaRecorder.ondataavailable = (e)=>{ if (e.data?.size) chunks.push(e.data); };
    mediaRecorder.onerror = (e)=> { console.error('MediaRecorder error', e); say('❌ Błąd nagrywania.'); };
    mediaRecorder.onstop = onStopSend;

    mediaRecorder.start();
    recording = true;
    say('🎙️ Nagrywam… (auto stop za ~6s)');
    setTimeout(()=> recording && stopRec(), 6000);
  }catch(err){
    console.error(err);
    if (err.name === 'NotAllowedError') say('❌ Brak zgody na mikrofon.');
    else say('❌ Brak wsparcia dla nagrywania audio.');
  }
}

async function onStopSend(){
  try{
    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    if (!blob.size){ say('😕 Nie wykryto dźwięku (0 B). Spróbuj mówić bliżej mikrofonu.'); return; }

    // 1) ASR
    const asr = await fetch(apip('/api/asr'), {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob
    });

    const asrText = await asr.text();
    if (!asr.ok) throw new Error(`ASR ${asr.status} ${asrText}`);

    const asrJson = JSON.parse(asrText);
    const text = asrJson?.text || '';
    if (!text){ say('😕 ASR nic nie rozpoznał. Powiedz wyraźnie 2–3 sekundy.'); return; }

    say('🗣️ ' + text);

    // 2) NLU
    const nlu = await fetch(apip('/api/nlu'), {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ text })
    });
    const nluRaw = await nlu.text();
    if (!nlu.ok) throw new Error(`NLU ${nlu.status} ${nluRaw}`);
    const nluJson = JSON.parse(nluRaw);

    say('🧠 ' + JSON.stringify(nluJson.parsed || nluJson));

    // 3) opcjonalny TTS
    const summary = nluJson?.summary || 'Zamówienie przyjęte.';
    try{
      const tts = await fetch(apip('/api/tts'), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text: summary })
      });
      if (tts.ok && $tts){
        const buf = await tts.arrayBuffer();
        $tts.src = URL.createObjectURL(new Blob([buf]));
        $tts.play().catch(()=>{});
      }
    }catch{}

  }catch(e){
    console.error(e);
    say('❌ Błąd podczas przetwarzania: ' + e.message);
  }
}
