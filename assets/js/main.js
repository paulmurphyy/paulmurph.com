(() => {
  const root = document.documentElement,
        bg   = document.getElementById('bg'),
        vid  = document.getElementById('bgvid'),
        img  = document.getElementById('bgimg'),
        btn  = document.getElementById('bgtoggle'),
        still = matchMedia('(prefers-reduced-motion: reduce)'),
        ls   = (k, v) => {
          try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); }
          catch (e) {}
        };

  // fallback for browsers without scroll-driven animations; the CSS handles the rest.
  // both paths must honour reduced motion, and both use the --parallax travel distance.
  if (!CSS.supports('animation-timeline: scroll()') && !still.matches) {
    const PARALLAX = 0.4;
    addEventListener('scroll', () => {
      const max = root.scrollHeight - innerHeight;
      const y = (max > 0 ? scrollY / max : 0) * innerHeight * PARALLAX;
      bg.style.transform = `translate3d(0, ${-y}px, 0)`;
    }, { passive: true });
  }

  const poster = document.getElementById('bgposter');
  const hide = () => poster.classList.add('gone');
  vid.addEventListener('playing', hide);
  vid.addEventListener('seeked', hide);

  // one frame, one snapshot: the toggle, pause, visibilitychange and pagehide
  // paths all fire back-to-back for the same frame, and each capture costs a
  // readback off the decoder plus a synchronous JPEG encode.
  const POSTER_W = 1280;
  let snappedAt = -1;
  const snap = () => {
    if (vid.readyState < 2 || !vid.videoWidth || vid.currentTime === snappedAt) return;
    try {
      const c = document.createElement('canvas');
      c.width = POSTER_W;
      c.height = Math.round(POSTER_W * vid.videoHeight / vid.videoWidth);
      c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
      ls('bg-poster', c.toDataURL('image/jpeg', 0.8));
      snappedAt = vid.currentTime;
    } catch (e) {}
  };

  const saveTime = () => { if (vid.duration) ls('bg-time', vid.currentTime); };
  let last = 0, lastSnap = 0;
  vid.addEventListener('loadedmetadata', () => {
    const t = parseFloat(ls('bg-time'));
    if (t > 0 && t < vid.duration - 0.25) vid.currentTime = t;
  });
  vid.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - last > 1000) { last = now; saveTime(); }
    if (now - lastSnap > 15000) { lastSnap = now; snap(); }
  });
  const store = () => { saveTime(); snap(); };
  addEventListener('pagehide', store);
  document.addEventListener('visibilitychange', () => { if (document.hidden) store(); });
  vid.addEventListener('pause', () => { if (!document.hidden) snap(); });

  const ready = () => img.decode().then(() => img.naturalWidth > 0, () => false);
  addEventListener('load', () => setTimeout(ready, 1200));
  btn.addEventListener('pointerenter', ready);
  btn.addEventListener('focus', ready);

  const apply = (mode) => {
    root.dataset.bg = mode;
    ls('bg-mode', mode);
    if (mode === 'photo') { store(); vid.pause(); } else vid.play().catch(() => {});
    btn.setAttribute('aria-label', `show the background ${mode === 'photo' ? 'video' : 'photo'}`);
  };
  const setMode = (mode) => mode === 'photo'
    ? ready().then((ok) => apply(ok ? 'photo' : 'video'))
    : apply('video');

  setMode(root.dataset.bg);
  btn.addEventListener('click', () => setMode(root.dataset.bg === 'photo' ? 'video' : 'photo'));

  const audio = document.getElementById('bgmusic'),
        mbtn  = document.getElementById('musictoggle'),
        ask   = document.getElementById('musicask');

  const FADE_MS = 3000, DEFAULT_VOLUME = 0.55;
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  const stored = parseFloat(ls('music-volume'));
  let target = isFinite(stored) ? clamp01(stored) : DEFAULT_VOLUME;

  audio.volume = target;
  audio.muted = ls('music-muted') === 'on';

  let fadeRaf = 0;
  const fadeIn = () => {
    cancelAnimationFrame(fadeRaf);
    const from = audio.volume, t0 = performance.now();   // ramp over FADE_MS so it never starts abruptly
    const step = (t) => {
      const p = Math.min((t - t0) / FADE_MS, 1);
      audio.volume = from + (target - from) * p;
      fadeRaf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    fadeRaf = requestAnimationFrame(step);
  };

  // the record player mirrors mute and volume, and the element's own
  // volumechange fires on every frame of the fade — too noisy to listen to
  const announce = () => audio.dispatchEvent(new CustomEvent('musicstate'));

  // button state follows the element, not our guess about what play() did
  const reflect = () => {
    mbtn.classList.toggle('muted', audio.muted);
    mbtn.setAttribute('aria-label', `${audio.muted ? 'unmute' : 'mute'} background music`);
  };

  const setMuted = (m) => {
    audio.muted = m;
    ls('music-muted', m ? 'on' : 'off');
    reflect();
    announce();
  };

  const setVolume = (v) => {
    target = clamp01(v);
    ls('music-volume', target);
    cancelAnimationFrame(fadeRaf); fadeRaf = 0;   // a live drag beats the fade
    audio.volume = target;
    announce();
  };

  const play = () => { audio.volume = 0; return audio.play().then(fadeIn); };

  // sole writer of music-pref, so the stored preference can't disagree with the element
  const setMusic = (on) => {
    ls('music-pref', on ? 'on' : 'off');
    if (on) return play().catch(() => {});
    cancelAnimationFrame(fadeRaf); fadeRaf = 0; audio.pause();
  };

  // a mute toggle, not a transport control — but unmuting a track that was
  // never started would be a button that does nothing, so it starts it too
  mbtn.addEventListener('click', () => {
    const muted = !audio.muted;
    setMuted(muted);
    if (!muted && audio.paused) setMusic(true);
  });

  // retry on the next real gesture; only stop listening once it actually plays.
  // touchend/click grant activation on mobile — pointerdown does not.
  const arm = () => {
    const evts = ['click', 'touchend', 'keydown'];
    const off = () => evts.forEach((e) => removeEventListener(e, go));
    const go = () => play().then(off).catch(() => {});
    evts.forEach((e) => addEventListener(e, go));
  };

  const closeAsk = () => {
    ask.removeAttribute('data-shown');
    setTimeout(() => { ask.hidden = true; }, 400);   // matches #musicask transition (.4s)
  };
  // saying yes has to be audible, whatever the mute state was left at
  const answerAsk = (on) => { closeAsk(); if (on) setMuted(false); setMusic(on); };
  document.getElementById('musicyes').addEventListener('click', () => answerAsk(true));
  document.getElementById('musicno').addEventListener('click', () => answerAsk(false));
  // data-shown is set once the prompt is visible and cleared the moment it's
  // answered, so escape can't re-answer a prompt that's already on its way out
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ask.hasAttribute('data-shown')) answerAsk(false);
  });

  // the record player drives this same element. it goes through setMusic so the
  // fade-in and the stored preference stay in one place, and so hitting play
  // down the page answers the prompt instead of leaving it hanging.
  window.siteMusic = {
    audio,
    set: (on) => { if (ask.hasAttribute('data-shown')) closeAsk(); setMusic(on); },
    mute: setMuted,
    setVolume,
    get volume() { return target; },   // the fade target, not the live value
  };

  const musicPref = ls('music-pref');
  if (musicPref === 'on') {
    play().catch(arm);          // returning listener: no prompt, just resume
  } else if (!musicPref) {
    ask.hidden = false;         // first visit: ask
    setTimeout(() => ask.setAttribute('data-shown', ''), 900);
  }
  reflect();

  document.querySelectorAll('.rail').forEach((rail) => {
    let x = 0, left = 0, moved = 0, down = false;
    let vx = 0, lastX = 0, lastT = 0, raf = 0;

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0; vx = 0;
      rail.classList.remove('momentum');
    };

    const step = () => {
      vx *= 0.95;
      if (Math.abs(vx) < 0.5) { stop(); return; }
      rail.scrollLeft += vx;
      raf = requestAnimationFrame(step);
    };

    rail.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button) return;
      stop();
      down = true; moved = 0; x = e.clientX; left = rail.scrollLeft;
      lastX = e.clientX; lastT = performance.now();
      rail.classList.add('dragging');
      e.preventDefault();
    });
    // tracked on the document rather than through setPointerCapture: a captured
    // pointer retargets the click to the rail, so links inside it never activate.
    // buttons === 0 covers the release that capture used to catch — one that
    // happens outside the window, where no pointerup ever reaches us.
    document.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (!e.buttons) { end(); return; }
      const d = e.clientX - x;
      moved = Math.max(moved, Math.abs(d));
      rail.scrollLeft = left - d;
      const now = performance.now(), dt = now - lastT;
      if (dt > 0) vx = -(e.clientX - lastX) / dt * 16.67; // scroll px per 60fps frame
      lastX = e.clientX; lastT = now;
    });
    const end = () => {
      if (!down) return;
      down = false;
      rail.classList.remove('dragging');
      if (Math.abs(vx) > 1.5) {
        if (Math.abs(vx) > 40) vx = Math.sign(vx) * 40; // clamp fling speed
        rail.classList.add('momentum');
        raf = requestAnimationFrame(step);
      }
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    rail.addEventListener('wheel', stop, { passive: true });
    rail.addEventListener('click', (e) => {
      if (moved > 5) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  });

  if (matchMedia('(pointer: fine)').matches && !still.matches) {
    const MAX = 14;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const step = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      // set on #bg, not :root — an inherited custom property changing on the root
      // invalidates style for every element on the page, every frame
      bg.style.setProperty('--mx', cx.toFixed(2) + 'px');
      bg.style.setProperty('--my', cy.toFixed(2) + 'px');
      raf = Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1 ? requestAnimationFrame(step) : 0;
    };
    addEventListener('pointermove', (e) => {
      tx = (0.5 - e.clientX / innerWidth)  * 2 * MAX;
      ty = (0.5 - e.clientY / innerHeight) * 2 * MAX;
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });
  }
})();
