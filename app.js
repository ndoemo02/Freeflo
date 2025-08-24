// Minimalny „kontroler” UI.
// 1) przełączanie kategorii
// 2) pokaz panelu z błędem (gdy backend offline)
// 3) gotowe pod podmianę na realne API

const catsEl = document.getElementById('cats');
const panelEl = document.getElementById('panel');
const panelText = document.getElementById('panelText');
const panelIcon = document.getElementById('panelIcon');

// aktywacja cat buttonów
catsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.cat');
  if (!btn) return;
  document.querySelectorAll('.cat').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // demo: pokaż krótką notyfikację, że „tryb testowy”
  showInfo(`Wybrano: ${btn.textContent.trim()} — tryb testowy (mock).`, 'info');
});

// helper: panel info/err
function showInfo(text, type='info'){
  panelText.textContent = text;
  panelEl.classList.remove('hidden', 'err');
  if(type==='err'){
    panelEl.classList.add('err');
    panelIcon.textContent = '✖';
  }else{
    panelIcon.textContent = 'ℹ️';
  }
  // auto-hide po 4.5s
  clearTimeout(showInfo._t);
  showInfo._t = setTimeout(() => panelEl.classList.add('hidden'), 4500);
}

// ====== tu podpinamy backend ======
// Przykład: spróbuj odpytać zdrowie backendu. Jeśli padnie, pokaż ładny błąd.
// Zastąp URL swoim (np. z Vercel).
(async function pingBackend(){
  const url = 'https://snd-vercel.vercel.app/api/health'; // PRZYKŁAD
  try{
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, {signal: ctrl.signal});
    if(!res.ok) throw new Error('status ' + res.status);
    // jeśli OK, można w tle schować poprzedni błąd
  }catch(err){
    showInfo('Order błąd: Failed to fetch (tryb offline / mock).', 'err');
  }
})();
