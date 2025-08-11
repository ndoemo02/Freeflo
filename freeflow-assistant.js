/** freeflow-assistant.js
 * Łączy Web Speech (ASR) -> Twój backend -> TTS w przeglądarce.
 * Backend: https://freeflow-backend-vercel.vercel.app/api/assistant-text
 */
(() => {
  const CFG = {
    backendUrl: 'https://freeflow-backend-vercel.vercel.app/api/assistant-text',
    lang: 'pl-PL',
    tts: { rate: 1.0, pitch: 1.0, volume: 1.0, preferName: 'Polski' },
    ids: { mic: 'micBtn', dot: 'statusDot', text: 'transcript' }
  };

  const $id = (id) => document.getElementById(id);
  const micBtn = $id(CFG.ids.mic);
  const dot    = $id(CFG.ids.dot);
  const input  = $id(CFG.ids.text);

  if (!micBtn || !dot || !input) {
    console.warn('[FreeFlow] Brak któregoś z elementów #micBtn / #statusDot / #transcript');
  }

  const setState = (s) => {
    const m = { idle:'#2ecc71', listen:'#f1c40f', think:'#3498db', err:'#e74c3c' };
    if (dot) dot.style.background = m[s] || m.idle;
    if (micBtn) {
      micBtn.style.transition = 'transform .18s ease';
      micBtn.style.transform  = (s === 'listen') ? 'scale(1.05)' : 'scale(1)';
      micBtn.dataset.state = s;
    }
  };

  // --- ASR (Android Chrome = webkit*)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;

  function startListen() {
    if (!SR) { console.warn('Brak SpeechRecognition'); return; }
    if (listening) return;
    rec = new SR();
    rec.lang = CFG.lang; rec.interimResults = true; rec.continuous = false;
    let finalText = '';
    setState('listen'); listening = true;

    rec.onresult = (e) => {
      let interim = '';
      for (let i=e.resultIndex; i<e.results.length; i++) {
        const t = e.results[i][0].transcript;
        e.results[i].isFinal ? finalText += t+' ' : interim += t;
      }
      if (input) input.value = (finalText || interim).trim();
    };
    rec.onerror = () => { setState('err'); listening=false; };
    rec.onend = async () => {
      listening = false;
      const userText = (input?.value || '').trim();
      if (!userText) { setState('idle'); return; }
      setState('think');
      try {
        const reply = await ask(userText);
        if (input) input.value = reply;
        speak(reply);
        setState('idle');
      } catch { setState('err'); }
    };

    rec.start();
  }

  function stopListen(){ if (rec && listening) rec.stop(); }

  async function ask(text) {
    const r = await fetch(CFG.backendUrl, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text })
    });
    if (!r.ok) throw new Error('API error');
    const j = await r.json();
    return j.assistantText || j.reply || j.answer || '';
  }

  function speak(text){
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = CFG.lang; u.rate = CFG.tts.rate; u.pitch = CFG.tts.pitch; u.volume = CFG.tts.volume;

      const pick = () => {
        const vs = speechSynthesis.getVoices();
        const v = vs.find(v => v.lang?.startsWith('pl') || v.name?.includes(CFG.tts.preferName));
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      };
      if (speechSynthesis.getVoices().length) pick();
      else speechSynthesis.onvoiceschanged = pick;
    } catch(e){ console.warn('TTS error', e); }
  }

  if (micBtn) micBtn.addEventListener('click', () => listening ? stopListen() : startListen());
  if (input)  input.addEventListener('keydown', async (e)=>{
    if (e.key==='Enter' && !e.shiftKey){
      e.preventDefault();
      const t=(input.value||'').trim(); if(!t) return;
      setState('think');
      try { const r=await ask(t); input.value=r; speak(r); setState('idle'); }
      catch{ setState('err'); }
    }
  });

  setState('idle');
})();
