(() => {
  const app        = document.getElementById("app");
  const transcript = document.getElementById("transcript");
  const micBtn     = document.getElementById("micBtn");
  const logoBtn    = document.getElementById("logoBtn");
  const dot        = document.getElementById("dot");

  function setGhost(msg) {
    transcript.classList.add("ghost");
    transcript.textContent = msg;
  }
  function setText(msg) {
    transcript.classList.remove("ghost");
    transcript.textContent = msg;
  }
  function setListening(on) {
    app.classList.toggle("listening", on);
    dot.style.background = on ? "#21d4fd" : "#86e2ff";
    if (!on && !transcript.textContent.trim()) {
      setGhost("Powiedz, co chcesz zamówić…");
    }
  }

  // TTS
  function speakOnce(txt, lang = "pl-PL") {
    if (!txt) return;
    try { window.speechSynthesis.cancel(); } catch(_){}
    try {
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = lang;
      window.speechSynthesis.speak(u);
    } catch(_){}
  }

  // ASR
  const ASR = window.SpeechRecognition || window.webkitSpeechRecognition;
  async function listenOnce(){
    return new Promise((resolve, reject)=>{
      if(!ASR) return reject(new Error("Brak wsparcia Web Speech API."));
      const rec = new ASR();
      rec.lang = "pl-PL";
      rec.interimResults = true;
      rec.continuous = false;

      rec.onstart = ()=>{ setListening(true); setText("Słucham…"); };
      rec.onerror = (e)=>{ setListening(false); reject(e); };
      rec.onend   = ()=>{ setListening(false); };
      rec.onresult = (ev)=>{
        let finalText = "";
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          if(ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
        }
        if(finalText){
          setText(finalText);
          resolve(finalText);
        }
      };
      rec.start();
    });
  }

  async function start() {
    try {
      const finalText = await listenOnce();
      speakOnce("Okej, " + finalText);
    } catch (e) {
      setText("Błąd: " + e.message);
    }
  }

  if (logoBtn) logoBtn.addEventListener("click", start);
  if (micBtn)  micBtn.addEventListener("click", start);

  setGhost("Powiedz, co chcesz zamówić…");
})();
