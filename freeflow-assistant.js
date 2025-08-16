/* FreeFlow – logo-click SR, final-only z anty-ucięciem (grace + fallback) */

(() => {
  const transcriptEl = document.getElementById("transcript");
  const micBtn = document.getElementById("micBtn");
  const ttsPlayer = document.getElementById("ttsPlayer");

  const BASE_URL = ""; // względne /api/*

  async function sendText(text) {
    const clean = (text||"").trim();
    if (!clean) return;
    setTranscript(clean);
    try {
      const r = await fetch(`${BASE_URL}/api/assistant-text`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ text: clean })
      });
      const data = await r.json();
      const reply = data?.reply || "OK.";
      setTranscript(reply);

      // TTS (opcjonalnie)
      try {
        const t = await fetch(`${BASE_URL}/api/tts`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ text: reply, voice: "pl" })
        });
        if (t.ok) {
          const { audioUrl } = await t.json();
          if (audioUrl) { ttsPlayer.src = audioUrl; ttsPlayer.play().catch(()=>{}); }
        }
      } catch {}
    } catch (e) {
      console.error(e);
      setTranscript("Błąd sieci lub backendu. Spróbuj ponownie.");
    }
  }
  window.sendToAssistant = sendText;

  function setTranscript(t){ transcriptEl.textContent = t; }

  // ===== Speech Recognition (logo-only) =====
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let finalSent = false;
  let lastFinal = "";
  let lastInterim = "";
  let stopTimer = null;

  if (SR) {
    recognition = new SR();
    recognition.lang = "pl-PL";
    recognition.continuous = false;
    recognition.interimResults = true;   // pokazujemy na żywo, ale wysyłamy final

    recognition.addEventListener("start", () => {
      listening = true; finalSent = false; lastFinal = ""; lastInterim = "";
      micBtn.classList.add("recording");
      setTranscript("Nagrywam… mów śmiało. Puść, gdy skończysz.");
    });

    recognition.addEventListener("result", (e) => {
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
      setTranscript("Błąd sieci lub backendu. Spróbuj ponownie.");
      safeStop();
    });

    recognition.addEventListener("end", () => {
      listening = false;
      micBtn.classList.remove("recording");
      // Fallback: jeśli nie zdążył nadejść final – wyślij ostatni interim
      if (!finalSent && lastInterim) {
        const maybeFull = lastInterim.replace(/[.…\s]+$/,'').trim();
        if (maybeFull) sendText(maybeFull);
      }
    });
  } else {
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

  // LOGO = start/stop. Dodajemy „grace” by zdążył dopisać ostatnie słowo
  const GRACE_MS = 250;

  micBtn.addEventListener("mousedown", () => {
    clearTimeout(stopTimer); startSR();
  });
  micBtn.addEventListener("touchstart", (e)=>{ e.preventDefault(); clearTimeout(stopTimer); startSR(); }, {passive:false});

  const scheduleStop = () => {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(safeStop, GRACE_MS);
  };
  micBtn.addEventListener("mouseup", scheduleStop);
  micBtn.addEventListener("mouseleave", scheduleStop);
  micBtn.addEventListener("touchend", scheduleStop);

})();
