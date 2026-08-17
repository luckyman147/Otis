(() => {
  'use strict';

  if (window.__ytmp3Capture) return;
  window.__ytmp3Capture = true;

  const SRC = 'ytmp3-capture';
  const FALLBACK_RATE = 44100;
  const SUPPORTED_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

  let ctx = null;
  let srcNode = null;
  let procNode = null;
  let hookedVideo = null;
  let rate = 0;
  let resampler = null;
  let recording = false;

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

  function makeResampler(inRate, outRate) {
    const ratio = inRate / outRate;
    return function (input) {
      const count = Math.max(0, Math.floor(input.length / ratio));
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const p = i * ratio;
        const i0 = Math.floor(p);
        const i1 = Math.min(i0 + 1, input.length - 1);
        const frac = p - i0;
        out[i] = input[i0] * (1 - frac) + input[i1] * frac;
      }
      return out;
    };
  }

  function reportError(step, err) {
    post({ type: 'error', step, name: err && err.name, message: err && err.message });
  }

  function buildGraph(v) {
    try {
      try {
        ctx = new AudioContext({ sampleRate: FALLBACK_RATE });
      } catch (e) {
        ctx = new AudioContext();
      }
    } catch (e) {
      reportError('AudioContext', e);
      return false;
    }

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    try {
      srcNode = ctx.createMediaElementSource(v);
    } catch (e) {
      reportError('createMediaElementSource', e);
      return false;
    }

    try {
      procNode = ctx.createScriptProcessor(4096, 2, 2);
    } catch (e) {
      reportError('graph', e);
      return false;
    }

    hookedVideo = v;
    rate = ctx.sampleRate;
    if (SUPPORTED_RATES.indexOf(rate) === -1) {
      resampler = makeResampler(rate, FALLBACK_RATE);
      rate = FALLBACK_RATE;
    }
    return true;
  }

  function destroyGraph() {
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
    hookedVideo = null;
    rate = 0;
    resampler = null;
    recording = false;
  }

  function start() {
    const v = getVideo();
    if (!v) {
      reportError('video', { name: 'NotFoundError', message: 'No <video> element found on this page.' });
      return;
    }

    if (!recording) {
      if (v !== hookedVideo) destroyGraph();
      if (!ctx) {
        if (!buildGraph(v)) {
          destroyGraph();
          return;
        }
      }
      try {
        srcNode.disconnect();
        procNode.disconnect();
        procNode.onaudioprocess = onProcess;
        srcNode.connect(procNode);
        procNode.connect(ctx.destination);
        recording = true;
      } catch (e) {
        reportError('graph', e);
        destroyGraph();
        return;
      }
    }

    post({ type: 'started', rate });
  }

  function onProcess(e) {
    const inp = e.inputBuffer;
    const out = e.outputBuffer;
    for (let c = 0; c < out.numberOfChannels; c++) {
      out.getChannelData(c).set(inp.getChannelData(c));
    }
    let ch0 = inp.getChannelData(0);
    let ch1 = inp.getChannelData(1);
    if (resampler) {
      ch0 = resampler(ch0);
      ch1 = resampler(ch1);
    }
    const n = ch0.length;
    const buf = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      buf[i * 2] = f16(ch0[i]);
      buf[i * 2 + 1] = f16(ch1[i]);
    }
    post({ type: 'pcm', data: buf });
  }

  function stop() {
    if (recording) {
      if (procNode) procNode.onaudioprocess = null;
      try {
        if (srcNode) {
          srcNode.disconnect();
          if (ctx) srcNode.connect(ctx.destination);
        }
        if (procNode) procNode.disconnect();
      } catch (e) {}
      recording = false;
    }
    post({ type: 'stopped' });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const m = e.data;
    if (!m || m.source !== 'ytmp3') return;
    if (m.action === 'start') start();
    else if (m.action === 'stop') stop();
  });
})();