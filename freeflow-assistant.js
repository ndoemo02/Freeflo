// === KONFIG ===
const API_URL = 'https://freeflow-backend-vercel.vercel.app/api/assistant-text';

// elementy UI
const micBtn = document.getElementById('micBtn');
const transcriptBox = document.getElementById('transcript');
const player = document.getElementById('ttsPlayer');

// helper
function showText(text){ transcriptBox.textContent = text; }

// odtwarzanie MP3 (base64) + fallback Web Speech
async function playBase64Mp3(base64, fallbackText){
  try{
    const src = `data:audio/mpeg;base64,${base64}`;
    player.src = src;
    await player.play();
    return true;
  }catch(e){
    console.warn('Autoplay error, fallback to Web Speech:', e);
    speakWithWebSpeech(fallbackText);
    return false;
  }
}
function speakWithWebSpeech(text, lang='pl-PL'){
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }catch(e){ console.warn('speechSynthesis failed:', e); }
}

// wysyłka do backendu
async function sendToAssistant(userText){
  try{
    showText('… myślę …');
    const res = await fetch(API_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text: userText })
    });
    const data = await res.json();

    if(!data?.success){
      showText('Błąd serwera. Spróbuj ponownie.');
      speakWithWebSpeech('Wystąpił błąd po stronie serwera.');
      return;
    }

    const answer = data.assistantText || 'Nie mam teraz odpowiedzi.';
    showText(answer);

    if(data.audioBase64){
      await playBase64Mp3(data.audioBase64, answer);
    }else{
      speakWithWebSpeech(answer);
    }
  }catch(err){
    console.error(err);
    showText('Nie udało się połączyć z serwerem.');
    speakWithWebSpeech('Nie udało się połączyć z serwerem.');
  }
}

// rozpoznawanie mowy → Web Speech (przeglądarka)
function startDictation(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ alert('Twoja przeglądarka nie wspiera rozpoznawania mowy. Spróbuj Chrome.'); return; }

  const rec = new SR();
  rec.lang = 'pl-PL';
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = ()=> showText('Słucham…');
  rec.onresult = (e)=>{
    // pokazuj interim w czasie rzeczywistym
    let final = '';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t = e.results[i][0].transcript;
      if(e.results[i].isFinal){ final += t; } else { showText(t); }
    }
    if(final.trim()){
      showText(final.trim());
      sendToAssistant(final.trim());
    }
  };
  rec.onerror = (e)=> showText('Błąd rozpoznawania: ' + (e.error||'nieznany'));
  rec.onend = ()=> micBtn.classList.remove('recording');

  rec.start();
}

// zdarzenie na przycisku (gest dla autoplay)
if(micBtn){
  micBtn.addEventListener('click', ()=>{
    try{ window.speechSynthesis.cancel(); player.pause(); }catch{}
    micBtn.classList.add('recording');
    startDictation();
  });
}

// eksport „globalnie” dla quick actions
window.sendToAssistant = sendToAssistant;
