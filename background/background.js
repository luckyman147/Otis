'use strict';

const browser = globalThis.browser || globalThis.chrome;

browser.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    browser.tabs.sendMessage(tab.id, { action: 'showPanel' }).catch(() => {});
  }
});

browser.runtime.onMessage.addListener(async (msg) => {
  if (!msg) return;

  if (msg.action === 'saveMp3') {
    try {
      const bytes = msg.data;
      let url;
      if (typeof URL.createObjectURL === 'function') {
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        url = URL.createObjectURL(blob);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        url = 'data:audio/mpeg;base64,' + btoa(binary);
      }
      const id = await browser.downloads.download({
        url,
        filename: msg.filename,
        saveAs: false
      });
      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  if (msg.action === 'recording') {
    if (msg.on) {
      await browser.action.setBadgeText({ text: 'REC' });
      await browser.action.setBadgeBackgroundColor({ color: '#e62117' });
    } else {
      await browser.action.setBadgeText({ text: '' });
    }
  }
});