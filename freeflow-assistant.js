// freeflow-assistant.js
(() => {
  const app        = document.getElementById('app');
  const logoBtn    = document.getElementById('logoBtn');
  const micBtn     = document.getElementById('micBtn');
  const transcript = document.getElementById('transcript');
  const dot        = document.getElementById('dot');

  let media, recorder, chunks = [], listening = false;

  // --- TTS unlock (mobile Chrome wymaga gestu)
  let ttsUnlocked = false;
  function unlockTTS() {
    if (ttsUnlocked || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0; // bezgłośne "piknięcie"
      window.speechSynthesis.speak(u);
      ttsUnlocked = true;
    } catch(_) {}
  }
  ['pointerdown','keydown','touchstart'].forEach(ev =>
    window.addEventListener(ev, unlockTTS, { once:true, passive:true })
  );

  function pickPolishVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find(v => v.lang?.toLowerCase().startsWith('pl'))
        || voices.find(v => /pol/i.test(v.name||''));
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pl-PL';
      const v = pickPolishVoice();
      if (v) u.voice = v;
      window.speechSynthesis.cancel(); // wyczyść kolejkę
      window.speechSynthesis.speak(u);
    } catch(_) {}
  }

  const setListening = (on) => {
    listening = on;
    app.classList.toggle('listening', on);
    dot.style.background = on ? '#21d4fd' : '#86e2ff';
    if (on) transcript.classList.remove('ghost');
  };

  const startRecording = async () => {
    unlockTTS(); // odblokuj przy pierwszym kliknięciu
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

    transcript.textContent = 'Przetwarzam…';

    try {
      const res = await fetch('/api/voice', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json(); // { transcript, intent, dish, time, place, reply }
      transcript.textContent = normalisePhonetics(data.transcript || '—');
      if (data.reply) speak(data.reply);
      console.log('AI parsed:', data);
    } catch (err) {
      transcript.textContent = 'Błąd: ' + (err.message || 'nieznany');
    }
  }

  // lekkie korekty fonetyczne dla wyświetlanego tekstu
  function normalisePhonetics(s) {
    let x = ' ' + (s||'') + ' ';
    x = x.replace(/\bkaplic(?:io|o|ó|a)sa\b/gi, ' capricciosa ');
    x = x.replace(/\bcapriciosa\b/gi, ' capricciosa ');
    x = x.replace(/\bgoogle\b/gi, ' kugel ');
    x = x.replace(/\barial\b/gi, ' ariel ');
    return x.trim().replace(/\s{2,}/g,' ');
  }

  [logoBtn, micBtn].forEach(el => el.addEventListener('click', startRecording, { passive:true }));

  // preload głosów (niektóre przeglądarki ładują asynchronicznie)
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
    // delikatny "resume" hack na niektórych Androidach
    document.addEventListener('visibilitychange', () => {
      try { if (!document.hidden) window.speechSynthesis.resume(); } catch(_) {}
    });
  }

  window.addEventListener('beforeunload', ()=>{ try{window.speechSynthesis.cancel()}catch(_){}});

  transcript.textContent='Powiedz, co chcesz zamówić…';
})();
