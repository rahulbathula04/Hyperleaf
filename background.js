importScripts("shared.js");

const storageInstance = getStorageInstance();
const ALARM_SCHEDULED_CAMPAIGN = "AURA_SCHEDULED_CAMPAIGN";
const anchorTabByWindow = new Map();
let suppressAutoCloseUntil = 0;

function isAuraExtensionUrl(url) {
  try {
    const extUrl = chrome.runtime.getURL("popup.html");
    return typeof url === "string" && url.startsWith(extUrl);
  } catch (_) {
    return false;
  }
}

function suppressAutoClose(ms = 2500) {
  suppressAutoCloseUntil = Math.max(suppressAutoCloseUntil, Date.now() + ms);
}

function isSuppressActiveForUrl(url) {
  if (Date.now() >= suppressAutoCloseUntil) {
    return false;
  }
  const u = String(url || "");
  return !u || u.startsWith("https://web.whatsapp.com");
}

function applyActionBrandAndBehavior() {
  if (chrome.action && chrome.action.setIcon) {
    chrome.action.setIcon({
      path: {
        16: "img/aura-16.png",
        32: "img/aura-32.png",
        48: "img/aura-48.png",
        128: "img/aura-128.png"
      }
    }).catch(() => {});
  }
}

async function closeAuraWindowsAndPanel(targetWindowId) {
  if (typeof targetWindowId === "number") {
    anchorTabByWindow.delete(targetWindowId);
  } else {
    anchorTabByWindow.clear();
  }

  if (chrome.windows && chrome.windows.getAll) {
    chrome.windows.getAll({ populate: true }, (wins) => {
      if (chrome.runtime.lastError || !Array.isArray(wins)) return;
      const popoutBase = chrome.runtime.getURL("popup.html?mode=window");
      for (const win of wins) {
        const tabs = Array.isArray(win.tabs) ? win.tabs : [];
        const popoutTabs = tabs.filter((t) => String(t.url || t.pendingUrl || "").startsWith(popoutBase));
        if (!popoutTabs.length) continue;
        if (win.type === "popup") {
          chrome.windows.remove(win.id).catch(() => {});
        } else {
          for (const pt of popoutTabs) {
            if (typeof pt.id === "number") chrome.tabs.remove(pt.id).catch(() => {});
          }
        }
      }
    });
  }

  sendMsgToExtension({
    subject: MSG_CLOSE_AURA_VIEW,
    windowId: typeof targetWindowId === "number" ? targetWindowId : null
  });
}

applyActionBrandAndBehavior();

if (chrome.tabs && chrome.tabs.onCreated) {
  chrome.tabs.onCreated.addListener((tab) => {
    if (!tab) return;
    const url = tab.url || tab.pendingUrl || "";
    if (isAuraExtensionUrl(url)) {
      return;
    }
    if (isSuppressActiveForUrl(url)) {
      if (typeof tab.windowId === "number") {
        anchorTabByWindow.set(tab.windowId, tab.id);
      }
      return;
    }
    closeAuraWindowsAndPanel(tab.windowId);
  });
}

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (!activeInfo || typeof activeInfo.tabId !== "number") return;
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        closeAuraWindowsAndPanel(activeInfo.windowId);
        return;
      }
      const url = tab.url || tab.pendingUrl || "";
      if (isAuraExtensionUrl(url)) {
        return;
      }
      if (isSuppressActiveForUrl(url)) {
        anchorTabByWindow.set(activeInfo.windowId, activeInfo.tabId);
        return;
      }
      const anchor = anchorTabByWindow.get(activeInfo.windowId);
      if (anchor !== undefined && anchor === activeInfo.tabId) {
        return;
      }
      closeAuraWindowsAndPanel(activeInfo.windowId);
    });
  });
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm || alarm.name !== ALARM_SCHEDULED_CAMPAIGN) {
      return;
    }
    const scheduled = await storageInstance.getScheduledCampaign();
    await storageInstance.saveScheduledCampaign(null);
    if (!scheduled || !scheduled.payload) {
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
      if (!tabs || tabs.length === 0) {
        await chrome.notifications.create({
          type: "basic",
          iconUrl: "img/aura-128.png",
          title: "Scheduled Campaign Missed",
          message: "No WhatsApp Web tab was open to dispatch your scheduled Aura campaign."
        }).catch(() => {});
        return;
      }
      const tab = tabs[0];
      let ping = await sendMsgToTab(tab.id, { from: "background.js", subject: MSG_GET_PAGE_URL, data: "" });
      if (!ping && chrome.scripting && chrome.scripting.executeScript) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["attach_bridge.js"] }).catch(() => {});
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["shared.js", "content.js"] }).catch(() => {});
      }
      await storageInstance.setIsSendOperationRunning(true);
      await storageInstance.setIsSendOperationPaused(false);
      const sendResp = await sendMsgToTab(tab.id, {
        from: "background.js",
        subject: MSG_SEND_MESSAGE,
        data: scheduled.payload
      });
      if (!sendResp || sendResp.notLoggedIn) {
        await storageInstance.setIsSendOperationRunning(false);
        await chrome.notifications.create({
          type: "basic",
          iconUrl: "img/aura-128.png",
          title: "Scheduled Campaign Not Sent",
          message: "WhatsApp Web is not signed in. Please scan the QR code to send campaigns."
        }).catch(() => {});
        return;
      }
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "img/aura-128.png",
        title: "Aura Scheduled Campaign Started",
        message: `Dispatching to ${Array.isArray(scheduled.payload.targets) ? scheduled.payload.targets.length : (scheduled.payload.numbers || []).length} recipients.`
      }).catch(() => {});
    } catch (err) {
      console.warn("Scheduled campaign launch failed:", err);
    }
  });
}

chrome.runtime.onStartup.addListener(() => {
  applyActionBrandAndBehavior();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  applyActionBrandAndBehavior();

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "img/aura-128.png",
      title: "Aura Messaging Installed",
      message: "Click the Aura icon in your toolbar to launch WhatsApp Sender."
    });
  } catch (err) {
    console.warn("Could not show install notification:", err);
  }

  if (details.reason === "install") {
    try {
      await storageInstance.setInstallTimeStamp();
      const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
      if (tabs && tabs.length > 0) {
        suppressAutoClose(2500);
        await chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId) {
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        suppressAutoClose(2500);
        await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
      }
    } catch (err) {
      console.warn("Could not open WhatsApp Web tab:", err);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.subject) {
    return false;
  }

  if (msg.subject === MSG_SUPPRESS_AUTO_CLOSE) {
    suppressAutoClose(Math.min(10000, Math.max(500, Number(msg.ms) || 2500)));
    sendResponse && sendResponse({ ok: true });
    return false;
  }

  if (msg.subject === MSG_PANEL_READY && typeof msg.windowId === "number" && typeof msg.tabId === "number") {
    anchorTabByWindow.set(msg.windowId, msg.tabId);
    sendResponse && sendResponse({ ok: true });
    return false;
  }

  if (msg.subject === MSG_SCHEDULE_CAMPAIGN && msg.data) {
    const when = Number(msg.data.whenMs);
    (async () => {
      await storageInstance.saveScheduledCampaign(msg.data);
      if (chrome.alarms) {
        await chrome.alarms.clear(ALARM_SCHEDULED_CAMPAIGN);
        if (Number.isFinite(when) && when > Date.now()) {
          chrome.alarms.create(ALARM_SCHEDULED_CAMPAIGN, { when });
        }
      }
      sendResponse && sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.subject === MSG_CANCEL_SCHEDULE) {
    (async () => {
      await storageInstance.saveScheduledCampaign(null);
      if (chrome.alarms) {
        await chrome.alarms.clear(ALARM_SCHEDULED_CAMPAIGN);
      }
      sendResponse && sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.subject === MSG_MESSAGE_RESULTS && msg.data && Array.isArray(msg.data.status)) {
    const total = Array.isArray(msg.data.numbers) ? msg.data.numbers.length : 0;
    const sent = msg.data.status.filter((s) => s === "STATUS_SENT").length;
    const failed = msg.data.status.filter((s) => s === "STATUS_FAILED").length;
    const done = sent + failed;

    if (total > 0 && done >= total) {
      storageInstance.setIsSendOperationRunning(false);
      storageInstance.setIsSendOperationPaused(false);
      storageInstance.setIsFilterOperationRunning(false);
      storageInstance.setIsFilterOperationPaused(false);
      storageInstance.appendReportHistory({
        id: msg.data.runTag || String(Date.now()),
        ts: Date.now(),
        mode: msg.data.lastOperation || "OPERATION_SEND_MESSAGE",
        total,
        sent,
        failed,
        numbers: msg.data.numbers.slice(),
        status: msg.data.status.slice(),
        messages: Array.isArray(msg.data.messages) ? msg.data.messages.slice() : []
      });
    }
  }

  return false;
});
