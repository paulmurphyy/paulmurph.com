(() => {
  const player = document.querySelector('.player');
  if (!player) return;

  // main.js owns the element and the music-pref write; we only borrow it.
  // both scripts are deferred and main.js is first, so siteMusic is already there.
  const music = window.siteMusic,
        audio = (music && music.audio) || document.getElementById('bgmusic');
  if (!audio) return;

  // one entry today — the site has one track. adding a second re-enables the
  // next button and hands looping over to the ended handler below.
  const TRACKS = [
    { name: 'driving my love', artist: 'anri', src: 'assets/audio/driving-my-love.mp3' },
  ];

  const q = (s) => player.querySelector(s),
        slider  = q('.seek-slider'),
        vol     = q('.volume-slider'),
        curEl   = q('.current-time'),
        totalEl = q('.total-duration'),
        playBtn = q('.playpause-track'),
        icon    = playBtn.querySelector('i'),
        prevBtn = q('.prev-track'),
        nextBtn = q('.next-track'),
        nameEl  = q('.track-name'),
        artistEl = q('.track-artist'),
        volIcon = q('.volume-icon');

  let i = 0;
  const many = TRACKS.length > 1;

  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const setPlay = (on) => music
    ? music.set(on)
    : (on ? audio.play().catch(() => {}) : audio.pause());

  // state follows the element, not our guess about what play() did — the header
  // toggle and the prompt can both move it out from under us
  const reflect = () => {
    const on = !audio.paused;
    player.classList.toggle('playing', on);
    icon.classList.toggle('fa-play', !on);
    icon.classList.toggle('fa-pause', on);
    playBtn.setAttribute('aria-label', on ? 'pause' : 'play');
  };
  audio.addEventListener('play', reflect);
  audio.addEventListener('pause', reflect);

  // both fractions live on .player: the CSS that draws them sits on the rails'
  // wrappers, which are the inputs' parents and so can't read the inputs
  const fill = (t, d) => player.style.setProperty('--p', d > 0 ? t / d : 0);

  // the speaker lights one more arc per third of the rail, and drops all three
  // for a cross once muted — the level it would return to is still on the rail
  const levelFor = (v) => audio.muted ? 'mute'
    : v === 0 ? '0'
    : v < 34 ? '1'
    : v < 67 ? '2'
    : '3';

  // volume reads from the fade target, so the rail doesn't crawl up during a fade
  const paintVol = () => {
    const v = Math.round((music ? music.volume : audio.volume) * 100);
    if (document.activeElement !== vol) vol.value = v;   // don't fight a drag
    player.style.setProperty('--v', v / 100);
    player.classList.toggle('muted', audio.muted);
    // guarded: paintVol runs during init, and throwing here would take the
    // rest of it — including the seek's first paint — down with it
    if (volIcon) volIcon.dataset.level = levelFor(v);
  };
  vol.addEventListener('input', () => {
    const v = Number(vol.value) / 100;
    if (music) music.setVolume(v); else audio.volume = v;
    if (audio.muted && v > 0) music ? music.mute(false) : (audio.muted = false);
    paintVol();
  });
  audio.addEventListener('musicstate', paintVol);

  // the icon is a readout that also toggles the same mute the header owns —
  // player.js keeps no mute state of its own, so the two can't disagree.
  // keyboard path included because the svg is now a focusable button.
  const toggleMute = () => {
    if (music) music.mute(!audio.muted);
    else { audio.muted = !audio.muted; paintVol(); }
  };
  volIcon.addEventListener('click', toggleMute);
  volIcon.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMute(); }
  });

  // while a drag is live the element owns the handle: seeking snaps currentTime
  // to what the decoder can actually give us, and writing that back on every
  // timeupdate is what made the handle stutter under the cursor
  let scrubbing = false;
  slider.addEventListener('pointerdown', () => { scrubbing = true; });
  addEventListener('pointerup', () => { scrubbing = false; });
  addEventListener('pointercancel', () => { scrubbing = false; });

  const paint = () => {
    const d = audio.duration;
    if (!scrubbing && isFinite(d) && d > 0) slider.value = audio.currentTime;
    // one source of truth per state, so the fill and the clock can't disagree
    // with where the handle is sitting
    const t = scrubbing ? Number(slider.value) : audio.currentTime;
    curEl.textContent = fmt(t);
    fill(t, d);
  };

  const onMeta = () => {
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    slider.max = d;
    totalEl.textContent = fmt(d);
    paint();
  };
  audio.addEventListener('loadedmetadata', onMeta);
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('durationchange', onMeta);

  // live scrub: seeking fires timeupdate, which repaints with the same value
  slider.addEventListener('input', () => {
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) { slider.value = 0; return; }
    audio.currentTime = Math.min(Number(slider.value), d);
    paint();
  });

  // never touches audio.src on load: main.js may already be playing this file
  const render = () => {
    nameEl.textContent = TRACKS[i].name;
    artistEl.textContent = TRACKS[i].artist;
  };
  const load = (n, resume) => {
    i = (n + TRACKS.length) % TRACKS.length;
    render();
    audio.src = TRACKS[i].src;
    slider.value = 0;
    curEl.textContent = totalEl.textContent = '0:00';
    fill(0, 0);
    audio.load();
    if (resume) setPlay(true);
  };

  playBtn.addEventListener('click', () => setPlay(audio.paused));

  // with a single track there is nowhere to go back to, so prev just restarts
  prevBtn.addEventListener('click', () => {
    if (!many || audio.currentTime > 3) { audio.currentTime = 0; paint(); return; }
    load(i - 1, !audio.paused);
  });
  nextBtn.addEventListener('click', () => load(i + 1, !audio.paused));

  nextBtn.disabled = !many;
  if (many) {
    audio.loop = false;   // the markup loops the single track; a playlist advances instead
    audio.addEventListener('ended', () => load(i + 1, true));
  }

  render();
  reflect();
  paintVol();
  if (audio.readyState >= 1) onMeta();   // metadata can beat us to it
})();
