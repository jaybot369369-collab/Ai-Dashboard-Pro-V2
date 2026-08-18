/* Pearl — theme + text size. Load in <head> with the "defer"-less plain tag,
   BEFORE your stylesheets, so there is no white flash and no size jump.

     <script src="pearl-boot.js"></script>
     <link rel="stylesheet" href="pearl.css">

   Reads and writes localStorage keys jp3_theme and jp3_size, the same keys the
   dashboard uses — so both stay in sync if they share an origin. */
(function () {
  var R = document.documentElement;

  /* ── 1. Boot: runs immediately, before first paint ── */
  try {
    var t = localStorage.getItem('jp3_theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
    R.setAttribute('data-theme', t);
    R.setAttribute('data-font', 'd');
    R.setAttribute('data-size', localStorage.getItem('jp3_size') || 'm');
  } catch (e) {}

  /* ── 2. Optional: inject the header controls ──
     Put <div class="head-right" data-pearl-controls></div> wherever you want
     them and this fills it in. Skip the element and you just get the skin. */
  function build() {
    var host = document.querySelector('[data-pearl-controls]');
    if (host && !host.querySelector('.theme-tog')) {
      host.classList.add('head-right');
      host.innerHTML =
        '<div class="size-tog" title="Text size">' +
          '<button data-size-set="s">A</button>' +
          '<button data-size-set="m">A</button>' +
          '<button data-size-set="l">A</button>' +
          '<button data-size-set="xl">A</button>' +
        '</div>' +
        '<div class="theme-tog">' +
          '<button data-theme-set="day">Day</button>' +
          '<button data-theme-set="night">Night</button>' +
        '</div>';
    }
    sync();
  }

  /* ── 3. Keep the pressed states honest ── */
  function sync() {
    var s = R.getAttribute('data-size') || 'm';
    var t = R.getAttribute('data-theme') || 'day';
    document.querySelectorAll('[data-size-set]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-size-set') === s);
    });
    document.querySelectorAll('[data-theme-set]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-theme-set') === t);
    });
  }

  /* ── 4. One delegated listener handles both switchers ── */
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var s = e.target.closest('[data-size-set]');
    if (s) {
      var sv = s.getAttribute('data-size-set');
      R.setAttribute('data-size', sv);
      try { localStorage.setItem('jp3_size', sv); } catch (_) {}
      return sync();
    }
    var t = e.target.closest('[data-theme-set]');
    if (t) {
      var tv = t.getAttribute('data-theme-set');
      R.setAttribute('data-theme', tv);
      try { localStorage.setItem('jp3_theme', tv); } catch (_) {}
      return sync();
    }
  });

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', build);
  else build();
})();
