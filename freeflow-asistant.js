/* ===== FreeFlow – skin override (bez zmian w HTML) ===== */

/* Tokeny kolorów */
:root{
  --ff-bg:#0b0f14;
  --ff-bg-2:#10151d;
  --ff-text:#e8eef6;
  --ff-muted:#9fb0c2;
  --ff-accent:#ff7a1a;        /* pomarańcz FreeFlow */
  --ff-accent-2:#ffae3a;
  --ff-glow: rgba(255,122,26,.35);
  --ff-card:#121823;
  --ff-border:rgba(255,255,255,.07);
  --ff-success:#2ecc71;
  --ff-warn:#f1c40f;
  --ff-info:#3498db;
  --ff-danger:#e74c3c;
}

/* Tło i typografia */
html,body{background: radial-gradient(1200px 900px at 50% 0%, #0e141d 0%, var(--ff-bg) 60%) fixed !important;}
body{color:var(--ff-text);font-synthesis-weight:none;font-feature-settings:"cv02","cv03", "liga";}

/* H1 / lead */
h1, .hero-title{
  font-size: clamp(36px, 5.5vw, 64px) !important;
  line-height: 1.05;
  letter-spacing: .3px;
  font-weight: 800;
  text-shadow: 0 2px 24px rgba(0,0,0,.35);
}
h1 .brand, .brand{color:var(--ff-accent)}

/* Karta transkrypcji */
.transcript, .transcript-box, [class*="transkrypcja"], [placeholder*="Transkrypcja"]{
  background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
  border:1px solid var(--ff-border);
  border-radius: 18px;
  box-shadow: 0 6px 36px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.02) inset;
  backdrop-filter: blur(6px);
  color:var(--ff-text);
}

/* Zielona kropka statusu */
#statusDot, .status-dot, .dot{
  width:12px;height:12px;border-radius:50%;
  background:var(--ff-success);
  box-shadow: 0 0 0 6px rgba(46,204,113,.12), 0 0 18px var(--ff-success);
  display:inline-block;
}

/* Pastylki akcji (Jedzenie/Taxi/Hotel) */
.chip, .pill, .btn-pill{
  background: var(--ff-card);
  border: 1px solid var(--ff-border);
  color: var(--ff-text);
  padding: 12px 18px;
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
}
.chip:hover, .pill:hover, .btn-pill:hover{
  transform: translateY(-1px);
  border-color: rgba(255,255,255,.16);
  box-shadow: 0 12px 32px rgba(0,0,0,.45);
}
.chip--active, .pill--active, .btn-pill--active{outline:2px solid var(--ff-glow)}

/* Pastylka „Dotknij, aby zamówić / mówić” (mikrofon) */
#micBtn, .cta-badge, .listen-pill{
  background: radial-gradient(120% 120% at 30% 20%, rgba(255,122,26,.16), rgba(255,122,26,.06) 50%, rgba(255,255,255,.01));
  color:var(--ff-text);
  border:1px solid var(--ff-border);
  border-radius: 18px;
  padding:16px 22px;
  box-shadow: 0 12px 48px rgba(0,0,0,.55), 0 0 40px var(--ff-glow) inset;
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
#micBtn:hover{ transform: translateY(-1px) scale(1.01); border-color: rgba(255,122,26,.35); }
#micBtn[data-state="listen"]{
  border-color: var(--ff-warn);
  box-shadow: 0 0 0 2px rgba(241,196,15,.18) inset, 0 12px 48px rgba(0,0,0,.55);
}
#micBtn[data-state="think"]{
  border-color: var(--ff-info);
  box-shadow: 0 0 0 2px rgba(52,152,219,.20) inset, 0 12px 48px rgba(0,0,0,.55);
}

/* Hero z mikrofonem – delikatna obwódka i poświata */
.hero, .logo-circle, .micro-hero{
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(255,255,255,.04) inset, 0 0 120px rgba(255,122,26,.08);
}

/* Przyciski „Dodaj do koszyka / menu / burger” – pomarańczowy akcent */
button, .btn, .action{
  --btnBg: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
  background: var(--btnBg);
  border: 1px solid var(--ff-border);
  color: var(--ff-text);
  border-radius: 14px;
}
button.primary, .btn--primary{
  background: linear-gradient(180deg, var(--ff-accent), var(--ff-accent-2));
  color:#0b0f14;
  border:none;
  box-shadow: 0 8px 30px var(--ff-glow);
}

/* Placeholdery i drobny tekst */
::placeholder{color:var(--ff-muted); opacity:.9}
.small, .helper{color:var(--ff-muted)}

/* Responsywne marginesy sekcji z transkrypcją */
.section-transcript{ margin-top: clamp(14px, 2vw, 22px); }
