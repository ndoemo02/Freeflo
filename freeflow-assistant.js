/* FreeFlow – assistant (final-only speech + przezroczyste UI)
   Wysyła do backendu TYLKO finalny tekst, nie ucina w połowie.
   Działa z Web Speech API (Chrome/Android). */

(() => {
  const transcriptEl = document.getElementById("transcript");
  const micBtn = document.getElementById("micBtn");
  const ttsPlayer = document.getElementById("ttsPlayer");

  // jeśli masz własny backend pod inną domeną – ustaw tutaj:
  const BASE_URL = ""; // pusty = względne /api/*

  // ===== Text → Assistant → (opcjonalnie TTS) =====
  async function sendText(text) {
    if (!text || !text.trim()) return;
    setTranscript(text);

    try {
      // 1) odpowiedź asystenta (tekst)
      const r = await fetch(`${BASE_URL}/api/assistant-text`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ text })
      });
      const data = await r.json();
      const reply = data?.reply || "OK.";

      setTranscript(reply);

      // 2) mowa zwrotna (jeśli endpoint istnieje)
      try {
        const t = await fetch(`${BASE_URL}/api/tts`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ text: reply, voice: "pl" })
        });
        if (t.ok) {
          const { audioUrl } = await t.json();
          if (audioUrl) {
            ttsPlayer.src = audioUrl;
            ttsPlayer.play().catch(()=>{});
          }
        }
      } catch {}
    } catch (err) {
      setTranscript("Błąd sieci lub backendu. Spróbuj ponownie.");
      console.error(err);
    }
  }
  window.sendToAssistant = sendText;

  function setTranscript(text) { transcriptEl.textContent = text; }

  // ===== Speech Recognition (tylko final) =====
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (SR) {
    recognition = new SR();
    recognition.lang = "pl-PL";
    recognition.continuous = false;        // jedna wypowiedź = jedno nagranie
    recognition.interimResults = false;    // <— KLUCZOWE: tylko wynik finalny

    recognition.addEventListener("start", () => {
      listening = true;
      micBtn.classList.add("recording");
      setTranscript("Nagrywam… mów śmiało. Zwolnij przycisk, aby wysłać.");
    });

    // pokazuj na żywo (opcjonalnie), ale nie wysyłaj jeszcze
    recognition.addEventListener("result", (e) => {
      const txt = Array.from(e.results).map(r => r[0].transcript).join("");
      if (!e.results[0].isFinal) {
        setTranscript(txt + " …");
      } else {
        // final – dopiero teraz wysyłamy
        setTranscript(txt);
        sendText(txt);
      }
    });

    recognition.addEventListener("error", (e) => {
      console.warn("SR error:", e.error);
      setTranscript("Błąd sieci lub backendu. Spróbuj ponownie.");
      stopSR();
    });

    recognition.addEventListener("end", () => {
      listening = false;
      micBtn.classList.remove("recording");
    });
  } else {
    micBtn.disabled = true;
    micBtn.textContent = "🎤 Brak wsparcia mowy w tej przeglądarce";
  }

  function startSR() {
    if (!recognition || listening) return;
    try { recognition.start(); } catch {}
  }
  function stopSR() {
    if (!recognition) return;
    try { recognition.stop(); } catch {}
  }

  // Kliknięcie – start/stop
  micBtn.addEventListener("mousedown", startSR);
  micBtn.addEventListener("touchstart", (e)=>{ e.preventDefault(); startSR(); }, {passive:false});
  micBtn.addEventListener("mouseup", stopSR);
  micBtn.addEventListener("mouseleave", ()=> listening && stopSR());
  micBtn.addEventListener("touchend", stopSR);

})();
