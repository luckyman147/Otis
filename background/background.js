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
      const blob = new Blob([msg.data], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const id = await browser.downloads.download({
        url,
        filename: msg.filename,
        saveAs: false
      });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
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