<script>
(() => {
  const hero  = document.getElementById('ff-hero');
  const logo  = hero?.querySelector('.ff-hero__logo');
  const voice = document.getElementById('ff-voice');
  if (!hero || !logo || !voice) return;

  const DROP_MS   = 1100;                 // koniec spadania
  const SQUASH_MS = 180;                  // ugięcie
  const TO_BTN_MS = DROP_MS + SQUASH_MS;  // chwila konwersji na guzik

  // Tworzymy ripples + splash (3 fale + 12 kropelek)
  const ripples = document.createElement('div');
  ripples.className = 'ff-ripples';
  ripples.innerHTML = '<span></span><span></span><span></span>';

  const splash = document.createElement('div');
  splash.className = 'ff-splash';
  splash.innerHTML = Array.from({length:12}).map(()=>'<i></i>').join('');

  hero.appendChild(ripples);
  hero.appendChild(splash);

  // 1) Impact (fale + rozprysk)
  setTimeout(() => hero.classList.add('ff-hero--impact'), DROP_MS - 20);

  // 2) Logo zamienia się w przycisk voice
  setTimeout(() => hero.classList.add('ff-hero--to-btn'), TO_BTN_MS + 80);

  // Klik przycisku — podłącz Twoje audio/voice
  voice.addEventListener('click', () => {
    if (typeof window.startVoice === 'function') {
      window.startVoice();
    } else {
      document.dispatchEvent(new CustomEvent('ff:voice:start'));
    }
  });

  // Prosty replay (klawisz "R") — resetuje fale/rozprysk
  function replay(){
    hero.classList.remove('ff-hero--impact','ff-hero--to-btn');

    // restart animacji logo
    logo.style.animation = 'none'; void logo.offsetWidth; logo.style.animation = '';

    // podmień ripples/splash by ich animacje odpaliły od zera
    const r2 = ripples.cloneNode(true);
    const s2 = splash.cloneNode(true);
    ripples.replaceWith(r2); splash.replaceWith(s2);

    setTimeout(() => hero.classList.add('ff-hero--impact'), DROP_MS - 20);
    setTimeout(() => hero.classList.add('ff-hero--to-btn'), TO_BTN_MS + 80);
  }
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'r') replay();
  });

  // Gdy obrazy cache’owane — lekki “kick”, żeby wszystko wystartowało równo
  window.addEventListener('load', () => setTimeout(()=>{}, 30));
})();
</script>
