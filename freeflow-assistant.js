// freeflow-assistant.js
(() => {
  const app        = document.getElementById('app');
  const logoBtn    = document.getElementById('logoBtn');
  const micBtn     = document.getElementById('micBtn');
  const transcript = document.getElementById('transcript');
  const dot        = document.getElementById('dot');

  let media, recorder, chunks = [], listening = false;

  const setListening = (on) => {
    listening = on;
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if (on) transcript.classList.remove('ghost');
  };

  const startRecording = async () => {
    if (listening) return stopRecording();
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(media, { mimeType: 'audio/webm' });
      chunks = [];
      recorder.ondataavailable = (e)=> { if(e.data.size) chunks.push(e.data); };
      recorder.onstop = onStop;
      recorder.start();
      setListening(true);
      transcript.textContent = 'Słucham…';
    } catch (e) {
      transcript.textContent = 'Brak dostępu do mikrofonu.';
    }
  };

  const stopRecording = () => {
    try { recorder && recorder.stop(); } catch(_) {}
    try { media && media.getTracks().forEach(t=>t.stop()); } catch(_) {}
    setListening(false);
  };

  async function onStop() {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const fd = new FormData();
    fd.append('audio', blob, 'voice.webm');
    // opcjonalne meta:
    // fd.append('city', 'Kraków'); fd.append('mode', 'food');

    transcript.textContent = 'Przetwarzam…';

    try {
      const res = await fetch('/api/voice', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // data: { transcript, intent, dish, time, place, reply }
      transcript.textContent = data.transcript || '—';
      speak(data.reply || 'OK.');
      // tu możesz uzupełniać UI (sumę, kafelki itd.)
      console.log('AI parsed:', data);
    } catch (err) {
      transcript.textContent = 'Błąd: ' + (err.message || 'nieznany');
    }
  }

  function speak(text) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pl-PL'; window.speechSynthesis.speak(u);
    } catch(_) {}
  }

  [logoBtn, micBtn].forEach(el => el.addEventListener('click', startRecording, { passive:true }));

  // lekkie poprawki fonetyczne po stronie klienta (na żywo)
  const phonFix = (s) => {
    let x = ' ' + s + ' ';
    x = x.replace(/\bkaplic(?:io|o|ó|a)sa\b/gi, ' capricciosa ');
    x = x.replace(/\bcapriciosa\b/gi, ' capricciosa ');
    x = x.replace(/\bgoogle\b/gi, ' kugel ');
    x = x.replace(/\barial\b/gi, ' ariel ');
    return x.trim().replace(/\s{2,}/g,' ');
  };

  const obs = new MutationObserver(() => {
    transcript.textContent = phonFix(transcript.textContent || '');
  });
  obs.observe(transcript, { childList: true });

  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

  transcript.textContent='Powiedz, co chcesz zamówić…';
})();
