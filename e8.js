/* egz8.polskinaklik.pl: bramka (rola + e-mail) i zapis wyników arkuszy w Supabase.
   Klucz publiczny można trzymać w stronie: RLS pozwala tylko dopisać osobę (pnk_e8_osoby)
   i zapisać wynik funkcją pnk_e8_zapisz_wynik. SQL: Podręcznik matura/backend/supabase/e8.sql */
(function(){
  var SUPA_URL = 'https://lzcsfhyrilcufcsltzpo.supabase.co';
  var SUPA_KEY = 'sb_publishable_eFdojqCF96tqwNM_WFURhQ_NWLDP5DS';
  var K_MAIL = 'e8-email', K_ROLA = 'e8-rola', K_KOLEJKA = 'e8-osoba-do-wyslania';
  var MAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var ROLE = ['rodzic', 'uczen', 'nauczyciel'];

  function ls(k, v){
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch(e){ return null; }
  }
  function supa(sciezka, dane){
    if (!window.fetch) return Promise.resolve({ ok: false, status: 0 });
    return fetch(SUPA_URL + sciezka, {
      method: 'POST', keepalive: true,
      headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(dane)
    }).catch(function(){ return { ok: false, status: 0 }; });
  }

  /* Osoba z bramki; przy błędzie sieci czeka w kolejce i wraca przy następnej wizycie */
  function wyslijOsobe(o){
    ls(K_KOLEJKA, JSON.stringify(o));
    return supa('/rest/v1/pnk_e8_osoby', o).then(function(r){
      if (r.ok || r.status === 409) { ls(K_KOLEJKA, null); return true; }
      return false;
    });
  }
  try { var q = JSON.parse(ls(K_KOLEJKA) || 'null'); if (q) wyslijOsobe(q); } catch(e){}

  var email = ls(K_MAIL), rola = ls(K_ROLA);
  var zalogowany = !!(email && MAIL_OK.test(email) && ROLE.indexOf(rola) >= 0);

  /* ——— Strona główna: bramka ——— */
  var bramka = document.getElementById('bramka');
  if (bramka) {
    var wyloguj = document.getElementById('wyloguj');
    function idzDalej(){
      var m = location.search.match(/[?&]next=([^&]+)/);
      var next = m ? decodeURIComponent(m[1]) : '';
      if (/^arkusz-[\w-]+\.html$/.test(next)) { location.replace(next); return true; }
      return false;
    }
    function otworz(){
      if (idzDalej()) return;
      document.documentElement.classList.remove('gated');
      if (wyloguj) wyloguj.hidden = false;
    }
    if (wyloguj) wyloguj.addEventListener('click', function(ev){
      ev.preventDefault();
      ls(K_MAIL, null); ls(K_ROLA, null);
      location.reload();
    });
    if (zalogowany) { otworz(); }
    else {
      var form = document.getElementById('bramkaForm'), err = document.getElementById('bramkaErr'),
          pole = document.getElementById('bEmail'), zgoda = document.getElementById('bZgoda'),
          btn = form.querySelector('button[type="submit"]'), wysylanie = false;
      document.documentElement.classList.add('gated');
      pole.focus();
      form.addEventListener('submit', function(ev){
        ev.preventDefault();
        if (wysylanie) return;
        var r = form.querySelector('input[name="rola"]:checked');
        var adres = pole.value.trim();
        if (!r) { err.textContent = 'Zaznacz, kim jesteś.'; return; }
        if (!MAIL_OK.test(adres) || adres.length > 254) {
          err.textContent = adres ? 'Sprawdź adres e-mail.' : 'Wpisz adres e-mail.';
          pole.focus(); return;
        }
        if (!zgoda.checked) { err.textContent = 'Zaakceptuj politykę prywatności.'; return; }
        err.textContent = '';
        wysylanie = true; btn.disabled = true; btn.textContent = 'Chwileczkę…';
        ls(K_MAIL, adres); ls(K_ROLA, r.value);
        var tekstZgody = (document.getElementById('bZgodaTekst') || {}).textContent || '';
        /* Czekamy na zapis najwyżej 4 s, potem wpuszczamy (osoba zostaje w kolejce) */
        var wpusc = function(){ if (wysylanie) { wysylanie = false; otworz(); } };
        wyslijOsobe({ email: adres, rola: r.value, zgoda: tekstZgody.replace(/\s+/g, ' ').trim(), zrodlo: location.hostname || 'lokalnie' }).then(wpusc);
        setTimeout(wpusc, 4000);
      });
    }
    return;
  }

  /* ——— Arkusz: wynik do Supabase przy każdej zmianie (postep.js wysyła 'pnk:postep' z opóźnieniem 1,5 s) ——— */
  if (!zalogowany) return;
  var plik = decodeURIComponent(location.pathname.split('/').pop() || '');
  if (!/^arkusz-[\w-]+\.html$/.test(plik)) return;

  /* Jedno podejście = jedna sesja; po powrocie na stronę wynik aktualizuje ten sam wiersz */
  function sesja(){
    var k = 'e8-sesja:' + plik, s = ls(k);
    if (!s || !/^[0-9a-f-]{36}$/.test(s)) {
      s = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){ var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
      ls(k, s);
    }
    return s;
  }
  function czas(){
    var tm = document.querySelector('.timer');
    if (!tm) return null;
    try {
      var st = JSON.parse(ls('zegar-' + (tm.dataset.key || location.pathname)) || 'null');
      if (!st) return null;
      return Math.min(86400, Math.round(((st.acc || 0) + (st.since ? Date.now() - st.since : 0)) / 1000));
    } catch(e){ return null; }
  }
  var ostatni = '';
  document.addEventListener('pnk:postep', function(ev){
    var s = ev.detail || {};
    var max = Number(s.max) || 0, pkt = Math.max(0, Math.min(max, Number(s.pkt) || 0));
    var klucz = pkt + '/' + max + '/' + !!s.ukonczona;
    if (klucz === ostatni) return;
    supa('/rest/v1/rpc/pnk_e8_zapisz_wynik', {
      p_sesja: sesja(), p_email: email, p_rola: rola, p_arkusz: plik,
      p_pkt: pkt, p_max: max, p_ukonczony: !!s.ukonczona, p_czas_s: czas()
    }).then(function(r){ if (r.ok) ostatni = klucz; });
  });
})();
