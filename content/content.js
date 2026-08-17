(() => {
  'use strict';

  if (window.__ytmp3) return;
  window.__ytmp3 = true;

  const browser = globalThis.browser || globalThis.chrome;

  const OUT_RATE = 44100;
  const ID = 'ytmp3';
  const CAPTURE_SRC = 'ytmp3-capture';

  let state = 'idle';
  let encoder = null;
  let mp3Chunks = [];
  let capturedVideo = null;
  let startedAt = 0;
  let tickId = null;
  let saveRequested = true;
  let recTitle = '';
  let recChannel = '';

  let panel = null;
  let statusEl = null;
  let timerEl = null;
  let recordBtn = null;
  let stopBtn = null;
  let cancelBtn = null;
  let bitrateSel = null;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragPanelLeft = 0;
  let dragPanelTop = 0;

  function $(sel) {
    return document.querySelector(sel);
  }

  function getVideo() {
    return $('video');
  }

  function getTitle() {
    const h1 = $('h1 yt-formatted-string');
    const t = h1 && h1.textContent ? h1.textContent.trim() : '';
    if (t) return t;
    return (document.title || '').replace(/ - YouTube$/, '').trim();
  }

  function getChannel() {
    const el = $('#channel-name a, #owner yt-formatted-string a, ytd-video-owner-renderer a');
    return el ? el.textContent.trim() : '';
  }

  function sanitize(name) {
    return name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'recording';
  }

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const x = s % 60;
    if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
    return m + ':' + String(x).padStart(2, '0');
  }

  function fmtTag(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const x = s % 60;
    if (h) return h + 'h' + String(m).padStart(2, '0') + 'm' + String(x).padStart(2, '0') + 's';
    if (m) return m + 'm' + String(x).padStart(2, '0') + 's';
    return x + 's';
  }

  function pushChunk(data) {
    if (data && data.length) mp3Chunks.push(data);
  }

  function concatChunks(chunks) {
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function makeFrame(id, text) {
    const bodyBytes = new TextEncoder().encode(text);
    const body = new Uint8Array(bodyBytes.length + 1);
    body[0] = 0x03;
    body.set(bodyBytes, 1);
    const frame = new Uint8Array(10 + body.length);
    frame.set(new TextEncoder().encode(id), 0);
    frame[4] = (body.length >> 24) & 0xff;
    frame[5] = (body.length >> 16) & 0xff;
    frame[6] = (body.length >> 8) & 0xff;
    frame[7] = body.length & 0xff;
    frame.set(body, 10);
    return frame;
  }

  function buildId3(title, artist) {
    const frames = [];
    if (title) frames.push(makeFrame('TIT2', title));
    if (artist) frames.push(makeFrame('TPE1', artist));
    if (!frames.length) return new Uint8Array(0);
    const body = concatChunks(frames);
    const out = new Uint8Array(10 + body.length);
    out.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00], 0);
    out[6] = (body.length >> 21) & 0x7f;
    out[7] = (body.length >> 14) & 0x7f;
    out[8] = (body.length >> 7) & 0x7f;
    out[9] = body.length & 0x7f;
    out.set(body, 10);
    return out;
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = ID + '-panel';

    const head = document.createElement('div');
    head.className = ID + '-head';
    const headTitle = document.createElement('span');
    headTitle.textContent = 'Otis \u00b7 YouTube \u2192 MP3';
    const closeBtn = document.createElement('button');
    closeBtn.id = ID + '-close';
    closeBtn.className = ID + '-close';
    closeBtn.title = 'Hide panel (reopen via the toolbar button)';
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
      panel.hidden = true;
      browser.storage.local.set({ panelHidden: true });
    });
    head.append(headTitle, closeBtn);
    head.addEventListener('mousedown', onDragStart);

    const body = document.createElement('div');
    body.className = ID + '-body';

    recordBtn = document.createElement('button');
    recordBtn.id = ID + '-record';
    recordBtn.className = ID + '-btn ' + ID + '-primary';
    recordBtn.title = 'Start recording';
    recordBtn.textContent = '\u25B6 Record';

    stopBtn = document.createElement('button');
    stopBtn.id = ID + '-stop';
    stopBtn.className = ID + '-btn';
    stopBtn.title = 'Stop and save as MP3';
    stopBtn.textContent = '\u25A0 Stop & Save';

    cancelBtn = document.createElement('button');
    cancelBtn.id = ID + '-cancel';
    cancelBtn.className = ID + '-btn';
    cancelBtn.title = 'Discard recording';
    cancelBtn.textContent = 'Discard';

    bitrateSel = document.createElement('select');
    bitrateSel.id = ID + '-bitrate';
    bitrateSel.title = 'MP3 bitrate';
    [128, 192, 320].forEach((kbps) => {
      const opt = document.createElement('option');
      opt.value = String(kbps);
      opt.textContent = kbps + ' kbps';
      if (kbps === 192) opt.selected = true;
      bitrateSel.appendChild(opt);
    });

    const statusRow = document.createElement('div');
    statusRow.className = ID + '-status';
    statusEl = document.createElement('span');
    statusEl.id = ID + '-status';
    statusEl.textContent = 'Ready';
    timerEl = document.createElement('span');
    timerEl.id = ID + '-timer';
    timerEl.textContent = '0:00';

    body.append(recordBtn, stopBtn, cancelBtn, bitrateSel);
    statusRow.append(statusEl, timerEl);
    panel.append(head, body, statusRow);
    document.documentElement.appendChild(panel);

    recordBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', () => stopRecording(true));
    cancelBtn.addEventListener('click', () => stopRecording(false));

    bitrateSel.addEventListener('change', () => {
      browser.storage.local.set({ bitrate: Number(bitrateSel.value) });
    });
    browser.storage.local
      .get('bitrate')
      .then((res) => {
        if (res.bitrate && ['128', '192', '320'].includes(String(res.bitrate))) {
          bitrateSel.value = String(res.bitrate);
        }
      })
      .catch(() => {});
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || '';
  }

  function onDragStart(e) {
    if (e.button !== 0 || e.target.id === ID + '-close') return;
    const rect = panel.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragPanelLeft = rect.left;
    dragPanelTop = rect.top;
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.right = 'auto';
    dragging = true;
    e.preventDefault();
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragging) return;
    let x = dragPanelLeft + (e.clientX - dragStartX);
    let y = dragPanelTop + (e.clientY - dragStartY);
    x = Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - panel.offsetHeight));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    browser.storage.local
      .set({ panelPos: { left: panel.style.left, top: panel.style.top } })
      .catch(() => {});
  }

  function setUI() {
    const busy = state === 'recording' || state === 'stopping' || state === 'encoding';
    recordBtn.disabled = busy;
    stopBtn.disabled = !(state === 'recording');
    cancelBtn.disabled = !(state === 'recording');
    bitrateSel.disabled = busy;
  }

  function updateTimer() {
    timerEl.textContent = fmtClock((Date.now() - startedAt) / 1000);
  }

  function ensureCaptureScript() {
    if (document.getElementById(ID + '-capture')) return;
    const s = document.createElement('script');
    s.id = ID + '-capture';
    s.src = browser.runtime.getURL('content/capture.js');
    (document.head || document.documentElement).appendChild(s);
  }

  function resetEncoder() {
    encoder = null;
    mp3Chunks = [];
  }

  function startRecording() {
    if (state !== 'idle') return;
    const video = getVideo();
    if (!video) {
      setStatus('No video found on this page.', 'warn');
      return;
    }
    if (video.paused) video.play().catch(() => {});

    resetEncoder();
    capturedVideo = video;
    recTitle = getTitle();
    recChannel = getChannel();
    startedAt = Date.now();
    state = 'recording';
    setUI();
    updateTimer();
    tickId = setInterval(tick, 1000);
    setStatus('Starting capture…');
    window.postMessage({ source: 'ytmp3', action: 'start' }, '*');
    browser.runtime.sendMessage({ action: 'recording', on: true }).catch(() => {});
    setTimeout(() => {
      if (state === 'recording' && !encoder) {
        setStatus('Capture did not start (see browser console for errors).', 'warn');
      }
    }, 5000);
  }

  function tick() {
    if (state !== 'recording') return;
    updateTimer();
    if (getVideo() !== capturedVideo) {
      setStatus('Video changed - stopping and saving.', 'warn');
      stopRecording(true);
    }
  }

  function stopRecording(save) {
    if (state !== 'recording') return;
    state = 'stopping';
    saveRequested = save;
    setUI();
    clearInterval(tickId);
    tickId = null;
    setStatus('Stopping…');
    window.postMessage({ source: 'ytmp3', action: 'stop' }, '*');
    setTimeout(() => {
      if (state === 'stopping') finishRecording();
    }, 3000);
  }

  function finishRecording() {
    if (state !== 'stopping') return;
    state = 'encoding';
    setUI();
    setStatus('Encoding MP3…');

    const duration = (Date.now() - startedAt) / 1000;

    try {
      pushChunk(encoder.flush());
    } catch (e) {}

    const mp3 = concatChunks(mp3Chunks);
    const id3 = buildId3(recTitle, recChannel);
    const full = new Uint8Array(id3.length + mp3.length);
    full.set(id3, 0);
    full.set(mp3, id3.length);

    resetEncoder();

    if (!saveRequested || full.length <= id3.length + 1) {
      setStatus(saveRequested ? 'Nothing recorded (silence).' : 'Recording discarded.', 'warn');
      state = 'idle';
      setUI();
      return;
    }

    const filename = sanitize(recTitle) + ' [0s-' + fmtTag(duration) + '].mp3';

    setStatus('Saving ' + filename + '…');
    browser.runtime
      .sendMessage({ action: 'saveMp3', data: full, filename })
      .then((resp) => {
        state = 'idle';
        setUI();
        updateTimer();
        if (resp && resp.ok) {
          setStatus('Saved: ' + filename, 'ok');
        } else {
          const err = resp && resp.error ? String(resp.error).slice(0, 120) : '';
          setStatus('Save failed' + (err ? ' - ' + err : '') + '.', 'warn');
        }
      })
      .catch((e) => {
        state = 'idle';
        setUI();
        setStatus('Save failed - ' + String(e).slice(0, 120), 'warn');
      });
    browser.runtime.sendMessage({ action: 'recording', on: false }).catch(() => {});
  }

  function onPcm(interleaved) {
    if (state !== 'recording') return;
    const n = interleaved.length >> 1;
    const left = new Int16Array(n);
    const right = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      left[i] = interleaved[i * 2];
      right[i] = interleaved[i * 2 + 1];
    }
    pushChunk(encoder.encodeBuffer(left, right));
  }

  function onCaptureError(m) {
    const hint = /already connected|connected previously/i.test(m.message || '')
      ? ' Another extension may already be using this video\'s audio.'
      : '';
    clearInterval(tickId);
    tickId = null;
    resetEncoder();
    state = 'idle';
    setUI();
    updateTimer();
    setStatus(
      'Capture failed' +
        (m.step ? ' at ' + m.step : '') +
        ': ' +
        (m.name || 'Error') +
        (m.message ? ' - ' + m.message : '') +
        hint,
      'warn'
    );
    browser.runtime.sendMessage({ action: 'recording', on: false }).catch(() => {});
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const m = e.data;
    if (!m || m.source !== CAPTURE_SRC) return;
    if (m.type === 'pcm') onPcm(m.data);
    else if (m.type === 'started') {
      if (state === 'recording') {
        if (!encoder) {
          const rate = m.rate && [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].indexOf(m.rate) !== -1
            ? m.rate
            : OUT_RATE;
          encoder = new lamejs.Mp3Encoder(2, rate, Number(bitrateSel.value));
        }
        setStatus(
          capturedVideo && capturedVideo.mediaKeys
            ? 'Recording (DRM video - MP3 may be silent)…'
            : 'Recording…'
        );
      }
    } else if (m.type === 'error') onCaptureError(m);
    else if (m.type === 'stopped') finishRecording();
  });

  function init() {
    buildPanel();
    setUI();
    ensureCaptureScript();
    browser.runtime.onMessage.addListener((msg) => {
      if (msg && msg.action === 'showPanel') {
        const show = panel.hidden || panel.style.display === 'none';
        panel.style.display = show ? 'block' : 'none';
        panel.hidden = !show;
        browser.storage.local.set({ panelHidden: !show });
      }
    });

    browser.storage.local
      .get('panelHidden')
      .then((res) => {
        if (res.panelHidden) {
          panel.style.display = 'none';
          panel.hidden = true;
        }
      })
      .catch(() => {});
    browser.storage.local
      .get('panelPos')
      .then((res) => {
        if (res.panelPos && res.panelPos.left && res.panelPos.top) {
          panel.style.left = res.panelPos.left;
          panel.style.top = res.panelPos.top;
          panel.style.right = 'auto';
        }
      })
      .catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();