/* FreeFlow – logo-click SR
   - Po kliknięciu logo mówi: "Czy mogę przyjąć zamówienie?"
   - Rozpoznawanie mowy: interim na żywo, wysyłka DOPIERO po final
   - Grace 250ms, fallback: jeśli brak final → wyślij ostatni interim
*/

(() => {
  const transcriptEl = document.getElementById("transcript");
  const micBtn = document.getElementById("micBtn");
  const ttsPlayer = document.getElementById("ttsPlayer");

  // Ustaw tu, jeśli backend stoi na innej domenie. Pusty = względne /api/*
  const BASE_URL = "";

  function setTranscript(t){ transcriptEl.textContent = t; }

  // ====== Browser TTS (proste i bez kosztów) ======
  function speak(text, lang="pl-PL", rate=1.0, pitch=1.0){
    try{
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang; u.rate = rate; u.pitch = pitch;
      const list = speechSynthesis.getVoices();
      const v = list.find(v => v.lang?.startsWith('pl'));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    }catch{}
  }

  // ====== Dialog z backendem ======
  async function sendText(text) {
    const clean = (text||"").trim();
    if (!clean) return;
    setTranscript(clean);

    try {
      // odpowiedź asystenta
      const r = await fetch(`${BASE_URL}/api/assistant-text`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ text: clean })
      });
      const data = await r.json();
      const reply = data?.reply || "OK.";
      setTranscript(reply);

      // opcjonalny TTS backendowy (jeśli masz endpoint /api/tts zwracający url)
      try {
        const t = await fetch(`${BASE_URL}/api/tts`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ text: reply, voice: "pl" })
        });
        if (t.ok) {
          const j = await t.json();
          if (j?.audioUrl) { ttsPlayer.src = j.audioUrl; ttsPlayer.play().catch(()=>{}); }
        } else {
          // fallback: TTS w przeglądarce
          speak(reply);
        }
      } catch {
        speak(reply);
      }
    } catch (e) {
      console.error(e);
      setTranscript("Błąd sieci lub backendu. Spróbuj ponownie.");
    }
  }
  window.sendToAssistant = sendText;

  // ====== Speech Recognition (Chrome/Android) ======
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let finalSent = false;
  let lastFinal = "";
  let lastInterim = "";
  let stopTimer = null;

  const GRACE_MS = 250; // margines, żeby nie ucinało ostatniego słowa

  if (SR) {
    recognition = new SR();
    recognition.lang = "pl-PL";
    recognition.continuous = false;
    recognition.interimResults = true; // pokazujemy na żywo (…)
    // final-only wysyłka w onresult

    recognition.addEventListener("start", () => {
      listening = true; finalSent = false; lastFinal = ""; lastInterim = "";
      setTranscript("Nagrywam… mów śmiało. Puść, gdy skończysz.");
    });

    recognition.addEventListener("result", (e) => {
      // scal wszystko z bufora
      let combined = "";
      for (const res of e.results) combined += res[0].transcript;
      const isFinal = e.results[e.results.length-1].isFinal;

      if (isFinal) {
        lastFinal = combined.trim();
        setTranscript(lastFinal);
        finalSent = true;
        sendText(lastFinal);
      } else {
        lastInterim = combined.trim();
        setTranscript(lastInterim + " …");
      }
    });

    recognition.addEventListener("error", (e) => {
      console.warn("SR error:", e.error);
      setTranscript("Błąd rozpoznawania mowy. Spróbuj ponownie.");
      safeStop();
    });

    recognition.addEventListener("end", () => {
      listening = false;
      // Fallback: jeżeli final nie spłynął – wyślij ostatni interim
      if (!finalSent && lastInterim) {
        const maybeFull = lastInterim.replace(/[.…\s]+$/,'').trim();
        if (maybeFull) sendText(maybeFull);
      }
    });
  } else {
    // Brak wsparcia SR
    micBtn.disabled = true;
    micBtn.title = "Brak wsparcia rozpoznawania mowy w tej przeglądarce";
  }

  function startSR(){
    if (!recognition || listening) return;
    try { recognition.start(); } catch {}
  }
  function safeStop(){
    if (!recognition) return;
    try { recognition.stop(); } catch {}
  }

  // Klik na logo: najpierw komunikat TTS, potem start SR
  const startFlow = () => {
    speak("Czy mogę przyjąć zamówienie?", "pl-PL", 1.0, 1.0);
    // mała pauza, żeby nie „wciął” pierwszego słowa użytkownika
    setTimeout(() => { startSR(); }, 300);
  };

  micBtn.addEventListener("mousedown", () => {
    clearTimeout(stopTimer);
    startFlow();
  });
  micBtn.addEventListener("touchstart", (e)=>{ e.preventDefault(); clearTimeout(stopTimer); startFlow(); }, {passive:false});

  // Po zwolnieniu palca – poczekaj GRACE_MS i zatrzymaj SR
  const scheduleStop = () => {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(safeStop, GRACE_MS);
  };
  micBtn.addEventListener("mouseup", scheduleStop);
  micBtn.addEventListener("mouseleave", scheduleStop);
  micBtn.addEventListener("touchend", scheduleStop);

})();
