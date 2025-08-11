/** freeflow-assistant.js – auto-bind do starego UI
 * Łańcuch: WebSpeech -> backend -> TTS (przeglądarka)
 * Backend: https://freeflow-backend-vercel.vercel.app/api/assistant-text
 */
(() => {
  const CFG = {
    backendUrl: 'https://freeflow-backend-vercel.vercel.app/api/assistant-text',
    lang: 'pl-PL',
    tts: { rate: 1.0, pitch: 1.0, volume: 1.0, preferName: 'Polski' },
    ids: { mic: 'micBtn', dot: 'statusDot', text: 'transcript' }
  };

  // --- AUTOBIND: znajdź elementy po treści/klasach i nadaj ID, jeśli ich brak
  function autoBind() {
    // 1) Mic button: „Dotknij ... mów”
    if (!document.getElementById(CFG.ids.mic)) {
      const micCand = [...document.querySelectorAll('button,div,span,a')]
        .find(el => /dotknij.*m(ó|o)w/i.test(el.textContent || ''));
      if (micCand) micCand.id = CFG.ids.mic;
    }
    // 2) Zielona kropka w pasku transkrypcji
    if (!document.getElementById(CFG.ids.dot)) {
      const dotCand = document.querySelector('.dot, .status-dot, .indicator, [role="status"]');
      if (dotCand) dotCand.id = CFG.ids.dot;
    }
    // 3) Pole transkrypcji (input/textarea z placeholderem)
    if (!document.getElementById(CFG.ids.text)) {
      const txtCand =
        document.querySelector('input[placeholder*="Transkrypcja"],textarea[placeholder*="Transkrypcja"]') ||
        document.querySelector('input[type="text"].search-input, .transcript input, .transcript textarea') ||
        document.querySelector('input[type="text"], textarea');
      if (txtCand) txtCand.id = CFG.ids.text;
    }
  }
  document.addEventListener('DOMContentLoaded', autoBind);

  // --- Helpers
  const $id = (id) => document.getElementById(id);
  const setState = (s) => {
    const dot = $id(CFG.ids.dot);
    const micBtn = $id(CFG.ids.mic);
    const colors = { idle:'#2ecc71', listen:'#f1c40f', think:'#3498db', err:'#e74c3c' };
    if (dot) dot.style.background = colors[s] || colors.idle;
    if (micBtn) {
      micBtn.style.transition = 'transform .18s ease';
      micBtn.style.transform  = (s === 'listen') ? 'scale(1.05)' : 'scale(1)';
      micBtn.dataset.state = s;
    }
  };

  // --- ASR (SpeechRecognition)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;

  function startListen() {
    if (!SR) { console.warn('[FreeFlow] Brak SpeechRecognition'); return; }
    if (listening) return;
    const input = $id(CFG.ids.text);
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

  // Podpięcie zdarzeń po pełnym zbudowaniu DOM + autobind
  function wire() {
    const micBtn = $id(CFG.ids.mic);
    const input  = $id(CFG.ids.text);
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
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(wire, 0));
})();
