(() => {
  'use strict';

  if (window.__ytmp3Capture) return;
  window.__ytmp3Capture = true;

  const OUT_RATE = 44100;
  const SRC = 'ytmp3-capture';

  let ctx = null;
  let srcNode = null;
  let procNode = null;

  function post(data) {
    data.source = SRC;
    window.postMessage(data, '*');
  }

  function f16(v) {
    let s = v * 32768;
    if (s > 32767) s = 32767;
    else if (s < -32768) s = -32768;
    return s;
  }

  function getVideo() {
    return document.querySelector('video');
  }

  function start() {
    if (ctx) {
      post({ type: 'started' });
      return;
    }
    const v = getVideo();
    if (!v) {
      post({ type: 'error', name: 'NotFoundError', message: 'No <video> element found on this page.' });
      return;
    }
    try {
      ctx = new AudioContext({ sampleRate: OUT_RATE });
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      srcNode = ctx.createMediaElementSource(v);
      procNode = ctx.createScriptProcessor(4096, 2, 2);
      procNode.onaudioprocess = (e) => {
        const inp = e.inputBuffer;
        const out = e.outputBuffer;
        for (let c = 0; c < out.numberOfChannels; c++) {
          out.getChannelData(c).set(inp.getChannelData(c));
        }
        const ch0 = inp.getChannelData(0);
        const ch1 = inp.getChannelData(1);
        const n = ch0.length;
        const buf = new Int16Array(n * 2);
        for (let i = 0; i < n; i++) {
          buf[i * 2] = f16(ch0[i]);
          buf[i * 2 + 1] = f16(ch1[i]);
        }
        post({ type: 'pcm', data: buf });
      };
      srcNode.connect(procNode);
      procNode.connect(ctx.destination);
      post({ type: 'started' });
    } catch (err) {
      post({ type: 'error', name: err && err.name, message: err && err.message });
      cleanup();
    }
  }

  function stop() {
    cleanup();
    post({ type: 'stopped' });
  }

  function cleanup() {
    if (procNode) {
      procNode.onaudioprocess = null;
      try { procNode.disconnect(); } catch (e) {}
    }
    if (srcNode) {
      try { srcNode.disconnect(); } catch (e) {}
    }
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
    srcNode = null;
    procNode = null;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const m = e.data;
    if (!m || m.source !== 'ytmp3') return;
    if (m.action === 'start') start();
    else if (m.action === 'stop') stop();
  });
})();