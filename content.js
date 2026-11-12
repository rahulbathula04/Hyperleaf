(function () {
  if (typeof window.__auraTeardown === "function") {
    try {
      window.__auraTeardown();
    } catch (_) {}
  }

  const STATUS_PENDING = "STATUS_PENDING";
  const STATUS_SENT = "STATUS_SENT";
  const STATUS_FAILED = "STATUS_FAILED";
  const OPERATION_FILTER = "OPERATION_FILTER";
  const OPERATION_SEND_MESSAGE = "OPERATION_SEND_MESSAGE";
  const OPERATION_FORWARD_ATTACHMENT = "OPERATION_FORWARD_ATTACHMENT";

  const storageProvider = getStorageInstance();

  let messageStatus = [];
  let phoneNumbers = [];
  let campaignTargets = [];
  let messagesToSend = [];
  let delayMinSec = 2;
  let delayMaxSec = 5;
  let batchSize = 0;
  let batchPauseSec = 30;
  let defaultText = "";
  let useAttachmentFlag = false;
  let inlineAttachment = null;
  let lastOperation = "";
  let runTag = "";
  let pauseOperation = false;
  let activeRunId = 0;
  let isLoopActive = false;
  let currentLoopPromise = null;
  let lastConfirmedTargetKey = "";
  let sessionDisconnectedFlag = false;
  let groupObserver = null;
  let groupCheckTimeout = null;
  let groupClickListener = null;

  function sleep(ms, shouldAbort = null) {
    if (!shouldAbort || ms <= 100) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    return new Promise((resolve) => {
      const end = Date.now() + ms;
      const tick = () => {
        if (shouldAbort()) {
          resolve();
          return;
        }
        const rem = end - Date.now();
        if (rem <= 0) {
          resolve();
          return;
        }
        setTimeout(tick, Math.min(100, rem));
      };
      setTimeout(tick, Math.min(100, ms));
    });
  }

  async function waitForCondition(checkFn, timeoutMs, intervalMs = 200, shouldAbort = null) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (shouldAbort && shouldAbort()) {
        return null;
      }
      const result = checkFn();
      if (result) {
        return result;
      }
      await sleep(intervalMs);
    }
    return null;
  }

  function clickElementFully(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch (_) {}
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    try { el.dispatchEvent(new PointerEvent("pointerup", opts)); } catch (_) {}
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    if (typeof el.click === "function") {
      el.click();
    }
  }

  function csvCell(val) {
    const s = String(val ?? "");
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function download(filename, text) {
    try {
      // Preferred: Blob URL — works in MV3 content scripts, correct MIME type
      const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
    } catch (_) {
      // Fallback: data URI
      const pom = document.createElement("a");
      pom.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + text));
      pom.setAttribute("download", filename);
      document.body.appendChild(pom);
      pom.click();
      pom.remove();
    }
  }

  function getGroupHeaderSpans() {
    const header = document.querySelector("#main header");
    if (!header) return null;

    // All title-bearing spans in the header
    const titleSpans = Array.from(header.querySelectorAll("span[title]"));
    if (titleSpans.length === 0) return null;

    // The group name is always the first span with a non-empty title
    const groupNameNode = titleSpans.find(el => (el.getAttribute("title") || "").trim().length > 0);
    if (!groupNameNode) return null;

    // Subtitle: a span whose title/text has 2+ commas (member list like "~A, ~B, ~C")
    // or contains "~" (WhatsApp name prefix), or "you, " pattern, or N members text
    const subTitleNode = titleSpans.find((el, idx) => {
      if (el === groupNameNode) return false;
      const t = (el.getAttribute("title") || el.textContent || "").trim();
      if (!t) return false;
      // Multiple comma-separated names (member subtitle)
      if (t.split(",").length >= 2) return true;
      // WhatsApp uses ~ prefix for contacts not in phonebook
      if (t.includes("~")) return true;
      return false;
    }) || Array.from(header.querySelectorAll("span, div")).find(el => {
      if (el === groupNameNode || el.childElementCount > 0) return false;
      const t = (el.getAttribute("title") || el.textContent || "").trim();
      // "click/tap here for group info" or "N members/participants"
      return /^(click|tap) here for group info$/i.test(t)
        || /^\d+\s+(members?|participants?)$/i.test(t)
        || (t.includes(",") && t.split(",").length >= 2);
    }) || null;

    // Confirm it's a group: either has subtitle, or has group icon/indicator
    const hasGroupIcon = Boolean(
      header.querySelector('[data-icon*="group" i], [aria-label*="group info" i], [title*="group info" i]')
    );
    // Also check if the subtitle-like text is in any child span without [title]
    const plainSubSpan = !subTitleNode ? Array.from(header.querySelectorAll("span")).find(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.textContent || "").trim();
      return t.split(",").length >= 2 || (t.includes("~") && t.length > 2);
    }) : null;

    if (groupNameNode && (subTitleNode || plainSubSpan || hasGroupIcon)) {
      return { header, groupNameNode, subTitleNode: subTitleNode || plainSubSpan };
    }
    return null;
  }

  function extractGroupContactsData() {
    const live = getGroupHeaderSpans();

    // Multiple selectors for Group Info drawer across WA versions
    const drawer =
      document.querySelector('[data-testid="group-info-drawer"]') ||
      document.querySelector('[data-animate-drawer-right="true"]') ||
      document.querySelector('[data-testid="drawer-right"]') ||
      null;

    const rawGroupName = live
      ? (live.groupNameNode.getAttribute("title") || live.groupNameNode.textContent || "WhatsApp Group").trim()
      : (drawer?.querySelector("span[title]")?.getAttribute("title") || "WhatsApp Group").trim();

    const rawCandidates = [];

    // Source 1: Header subtitle (comma-separated names like "~Aaditya, ~Ajay...")
    if (live && live.subTitleNode) {
      const subText = (live.subTitleNode.getAttribute("title") || live.subTitleNode.textContent || "").trim();
      for (const token of subText.split(",")) {
        const clean = token.trim().replace(/^~/, ""); // strip WA ~ tilde prefix
        if (clean) rawCandidates.push({ label: clean, sub: "", source: "header" });
      }
    }

    // Source 2: Group Info drawer rows
    if (drawer) {
      // Also search inside the scrollable panel body for lazy-rendered rows
      const drawerBody = drawer.querySelector('[data-testid="list-panel"]') ||
        drawer.querySelector('[data-testid="drawer-body"]') ||
        drawer;
      const drawerRows = Array.from(
        drawerBody.querySelectorAll(
          '[role="listitem"], [data-testid="cell-frame-container"], [data-testid="cell-frame"]'
        )
      );
      for (const row of drawerRows) {
        const primaryEl =
          row.querySelector('[data-testid="cell-frame-title"] span[title]') ||
          row.querySelector('[data-testid="cell-frame-title"] span') ||
          row.querySelector('span[dir="auto"][title]') ||
          row.querySelector('span[title]');
        const secondaryEl =
          row.querySelector('[data-testid="cell-frame-secondary"] span') ||
          row.querySelector('[data-testid="cell-frame-secondary"]') ||
          row.querySelector('span[dir="ltr"]') ||
          row.querySelector('[data-testid="cell-frame-secondary-detail"]') ||
          // Some WA versions render phone as a plain span after the name span
          Array.from(row.querySelectorAll('span')).find(sp => {
            const t = (sp.textContent || '').trim();
            return /^+?d[ds-().]{5,}d$/.test(t);
          }) || null;
        const label = primaryEl
          ? (primaryEl.getAttribute("title") || primaryEl.textContent || "").trim().replace(/^~/, "")
          : "";
        const sub = secondaryEl ? (secondaryEl.textContent || "").trim() : "";
        if (label || sub) {
          rawCandidates.push({ label: label || sub, sub, source: "drawer" });
        }
      }
      // Fallback: scrape phone numbers from raw text if no structured rows found
      if (drawerRows.length === 0) {
        const allText = drawer.innerText || "";
        const phoneRegex = /\+?\d[\d\s\-().]{7,}\d/g;
        let m;
        while ((m = phoneRegex.exec(allText)) !== null) {
          rawCandidates.push({ label: m[0].trim(), sub: "", source: "drawer-text" });
        }
      }
    }

    if (!live && rawCandidates.length === 0) {
      return { ok: false, isGroup: false, error: "no_group" };
    }

    const ignoredPattern =
      /^(you|click here for group info|tap here for group info|typing\.\.\.|\.recording audio\.\.\.|^\+?\d+\s+more$|\d+\s+(members?|participants?)|group info|message|mute|search|disappearing messages|report|exit group|add participant|invite via link|notifications|media|links|docs|starred)$/i;

    const seenKeys = new Set();
    const entries = [];
    const phones = [];

    for (const item of rawCandidates) {
      const candidateText = (item.label || item.sub || "").trim();
      if (!candidateText || ignoredPattern.test(candidateText)) continue;

      const phoneMatch =
        candidateText.match(/(\+?\d[\d\s\-()+.]{5,}\d)/) ||
        (item.sub || "").match(/(\+?\d[\d\s\-()+.]{5,}\d)/);
      const digits = phoneMatch ? phoneMatch[1].replace(/\D/g, "") : "";
      const phone = phoneMatch
        ? (phoneMatch[1].trim().startsWith("+")
            ? `+${digits}`
            : digits.length >= 7
            ? `+${digits}`
            : "")
        : "";

      const isLabelPhone = phoneMatch && candidateText.replace(/\D/g, "") === digits && digits.length >= 7;
      const name = isLabelPhone ? "" : candidateText.replace(/^~/, "");

      const dedupeKey = phone || candidateText.toLowerCase();
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      entries.push({ raw: candidateText, name, phone });
      if (phone && !phones.includes(phone)) phones.push(phone);
    }

    if (entries.length === 0) {
      return { ok: false, isGroup: Boolean(live || drawer), groupName: rawGroupName, error: "empty_group" };
    }

    const safeFilename = (rawGroupName || "whatsapp-group").replace(/[\\\//:*?"<>|]/g, "_");
    const headerRow = `${csvCell("Name")},${csvCell("Phone Number")}`;
    const csvRows = entries.map((e) => `${csvCell(e.name || e.raw)},${csvCell(e.phone)}`);
    const csvText = `${headerRow}\n${csvRows.join("\n")}`;

    return {
      ok: true,
      isGroup: true,
      groupName: rawGroupName,
      entries,
      count: entries.length,
      phones,
      csvText,
      filename: `${safeFilename}.csv`
    };
  }

  function setupGroupDownloader() {
    const checkHeader = () => {
      const resolved = getGroupHeaderSpans();
      const existingBtn = document.querySelector("#groupDownloaderWrapper");
      if (!resolved) {
        if (existingBtn) existingBtn.remove();
        return;
      }
      if (existingBtn && resolved.header.contains(existingBtn)) return;
      if (existingBtn) existingBtn.remove();

      const actionButtons = Array.from(resolved.header.querySelectorAll("button, [role='button']"));
      const lastActionContainer = actionButtons.length > 0
        ? actionButtons[actionButtons.length - 1].parentElement
        : null;
      const targetContainer = lastActionContainer || resolved.header;

      const wrapper = document.createElement("div");
      wrapper.id = "groupDownloaderWrapper";
      wrapper.style.cssText = "display:inline-flex;align-items:center;margin-right:4px;flex-shrink:0;";

      const btn = document.createElement("button");
      btn.id = "groupDownloader";
      btn.type = "button";
      btn.setAttribute("title", "Aura: Export Group Contacts CSV");
      btn.style.cssText =
        "cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,0.92);border:1px solid rgba(0,122,255,0.3);box-shadow:0 1px 4px rgba(0,0,0,0.08);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;outline:none;user-select:none;transition:background 0.15s,box-shadow 0.15s;";
      btn.innerHTML =
        "<svg viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='#007AFF' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/></svg>" +
        "<span style='color:#007AFF;font-size:11.5px;font-weight:600;letter-spacing:-0.01em;'>CSV</span>";

      // Visual hover feedback
      btn.addEventListener("mouseover", () => {
        btn.style.background = "rgba(0,122,255,0.08)";
        btn.style.boxShadow = "0 2px 6px rgba(0,122,255,0.15)";
      });
      btn.addEventListener("mouseout", () => {
        btn.style.background = "rgba(255,255,255,0.92)";
        btn.style.boxShadow = "0 1px 4px rgba(0,0,0,0.08)";
      });

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const originalHTML = btn.innerHTML;
        const setStatus = (html) => { btn.innerHTML = html; };

        btn.style.pointerEvents = "none";
        btn.style.opacity = "0.75";
        setStatus("<span style='color:#007AFF;font-size:11px;font-weight:600;'>Opening…</span>");

        try {
          // ── Step 1: Always open Group Info drawer to get phone numbers ──────
          // The header subtitle only shows truncated names, NOT phone numbers.
          // Phone numbers only appear in the full Group Info panel.

          const getDrawer = () =>
            document.querySelector('[data-testid="group-info-drawer"]') ||
            document.querySelector('[data-animate-drawer-right="true"]') ||
            document.querySelector('[data-testid="drawer-right"]') ||
            document.querySelector('[data-side="right"] [role="region"]') ||
            null;

          let drawer = getDrawer();

          if (!drawer) {
            // Click group header to open Group Info
            const infoTrigger =
              resolved.header.querySelector('[data-testid="conversation-info-header"]') ||
              resolved.header.querySelector('header > div') ||
              resolved.groupNameNode;
            if (infoTrigger) clickElementFully(infoTrigger);

            // Wait for drawer to appear (up to 4s)
            drawer = await waitForCondition(getDrawer, 4000, 150);
          }

          if (!drawer) {
            setStatus("<span style='color:#FF3B30;font-size:10.5px;font-weight:600;'>Click group name first</span>");
            setTimeout(() => { btn.innerHTML = originalHTML; }, 2800);
            return;
          }

          // ── Step 2: Scroll drawer to load ALL members (lazy loading) ────────
          setStatus("<span style='color:#007AFF;font-size:11px;font-weight:600;'>Loading…</span>");

          // Scroll the drawer panel to trigger lazy-load of all members
          const scrollContainer = drawer.querySelector('[data-testid="list-panel"]') ||
            drawer.querySelector('[data-testid="drawer-body"]') ||
            drawer.querySelector('[role="region"]') ||
            drawer;

          let prevCount = 0;
          let stableRounds = 0;
          const MAX_SCROLL_ATTEMPTS = 15; // up to ~3s of scrolling
          for (let i = 0; i < MAX_SCROLL_ATTEMPTS; i++) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            await sleep(200);
            const rows = scrollContainer.querySelectorAll(
              '[role="listitem"], [data-testid="cell-frame-container"], [data-testid="cell-frame"]'
            );
            if (rows.length === prevCount) {
              stableRounds++;
              if (stableRounds >= 3) break; // stable for 600ms = done loading
            } else {
              stableRounds = 0;
              prevCount = rows.length;
            }
          }

          // ── Step 3: Extract all member data ─────────────────────────────────
          const extracted = extractGroupContactsData();

          if (!extracted || !extracted.ok || extracted.entries.length === 0) {
            setStatus("<span style='color:#FF3B30;font-size:10.5px;font-weight:600;'>No contacts found</span>");
            setTimeout(() => { btn.innerHTML = originalHTML; }, 2500);
            return;
          }

          // ── Step 4: Download CSV ─────────────────────────────────────────────
          download(extracted.filename, extracted.csvText);

          const count = extracted.count || extracted.entries.length;
          const hasPhones = extracted.phones && extracted.phones.length > 0;
          setStatus(
            "<svg viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='#34C759' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>" +
            "<polyline points='20 6 9 17 4 12'/></svg>" +
            `<span style='color:#34C759;font-size:11.5px;font-weight:600;'>${count}${hasPhones ? " contacts" : " names"}</span>`
          );
          setTimeout(() => { btn.innerHTML = originalHTML; }, 2500);

        } finally {
          btn.style.pointerEvents = "";
          btn.style.opacity = "";
        }
      });

      wrapper.appendChild(btn);
      if (targetContainer.firstChild) {
        targetContainer.insertBefore(wrapper, targetContainer.firstChild);
      } else {
        targetContainer.appendChild(wrapper);
      }
    };

    const scheduleCheck = () => {
      if (groupCheckTimeout) clearTimeout(groupCheckTimeout);
      groupCheckTimeout = setTimeout(checkHeader, 400);
    };

    if (groupObserver) groupObserver.disconnect();
    groupObserver = new MutationObserver(scheduleCheck);
    const root = document.querySelector("#app") || document.body;
    if (root) {
      groupObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["title"]
      });
    }
    if (groupClickListener) document.removeEventListener("click", groupClickListener, true);
    groupClickListener = scheduleCheck;
    document.addEventListener("click", groupClickListener, true);
    scheduleCheck();
  }

  function isWhatsAppLoggedIn() {
    return Boolean(
      document.querySelector(
        '#side, #main, [data-testid="chatlist-header"], [data-icon="new-chat-outline"]'
      )
    );
  }

  function initContentScript() {
    try {
      chrome.runtime.onMessage.addListener(msgListener);
    } catch (_) {}
    setupGroupDownloader();
  }

  window.__auraTeardown = () => {
    activeRunId++;
    pauseOperation = true;
    isLoopActive = false;
    document.removeEventListener("DOMContentLoaded", initContentScript);
    if (groupClickListener) {
      document.removeEventListener("click", groupClickListener, true);
      groupClickListener = null;
    }
    try {
      chrome.runtime.onMessage.removeListener(msgListener);
    } catch (_) {}
    if (groupObserver) {
      groupObserver.disconnect();
      groupObserver = null;
    }
    if (groupCheckTimeout) {
      clearTimeout(groupCheckTimeout);
      groupCheckTimeout = null;
    }
    const existingWrapper = document.getElementById("groupDownloaderWrapper");
    if (existingWrapper) existingWrapper.remove();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initContentScript);
  } else {
    initContentScript();
  }

  function normalizeTargetsFromMsg(data) {
    if (Array.isArray(data?.targets) && data.targets.length > 0) {
      return data.targets.map((t) => ({
        kind: t.kind === "chat" ? "chat" : "phone",
        value: String(t.value || ""),
        label: String(t.label || t.value || "")
      }));
    }
    const nums = Array.isArray(data?.numbers) ? data.numbers : [];
    return nums.map((n) => ({ kind: "phone", value: String(n), label: String(n) }));
  }

  function msgListener(msg, _sender, sendResponse) {
    if (!msg || !msg.subject) return false;

    switch (msg.subject) {
      case MSG_SEND_MESSAGE: {
        if (!isWhatsAppLoggedIn()) {
          sendResponse({ ok: false, notLoggedIn: true });
          return false;
        }
        activeRunId++;
        pauseOperation = false;
        sessionDisconnectedFlag = false;
        lastConfirmedTargetKey = "";
        isLoopActive = true;
        useAttachmentFlag = Boolean(msg.data?.useAttachment);
        inlineAttachment = msg.data?.attachment || null;
        lastOperation = useAttachmentFlag ? OPERATION_FORWARD_ATTACHMENT : OPERATION_SEND_MESSAGE;
        runTag = String(msg.data?.runTag || Date.now());
        delayMinSec = Math.max(1, parseInt(msg.data?.minGapSec ?? msg.data?.delay, 10) || 2);
        delayMaxSec = Math.max(delayMinSec, parseInt(msg.data?.maxGapSec ?? msg.data?.delay, 10) || delayMinSec);
        batchSize = Math.max(0, parseInt(msg.data?.batchSize, 10) || 0);
        batchPauseSec = Math.max(1, parseInt(msg.data?.batchPauseSec, 10) || 30);

        campaignTargets = normalizeTargetsFromMsg(msg.data);
        phoneNumbers = campaignTargets.map((t) => t.label || t.value);
        messagesToSend = Array.isArray(msg.data?.messages) ? msg.data.messages.slice() : [];
        defaultText = typeof msg.data?.message === "string" ? msg.data.message : "";
        messageStatus = campaignTargets.map(() => STATUS_PENDING);

        runOperationLoop(lastOperation, activeRunId);
        sendResponse({ ok: true });
        return false;
      }

      case MSG_RUN_FILTER: {
        if (!isWhatsAppLoggedIn()) {
          sendResponse({ ok: false, notLoggedIn: true });
          return false;
        }
        activeRunId++;
        pauseOperation = false;
        sessionDisconnectedFlag = false;
        lastConfirmedTargetKey = "";
        isLoopActive = true;
        useAttachmentFlag = false;
        inlineAttachment = null;
        lastOperation = OPERATION_FILTER;
        runTag = String(msg.data?.runTag || Date.now());
        campaignTargets = normalizeTargetsFromMsg(msg.data);
        phoneNumbers = campaignTargets.map((t) => t.label || t.value);
        messagesToSend = [];
        defaultText = "";
        messageStatus = campaignTargets.map(() => STATUS_PENDING);
        runOperationLoop(OPERATION_FILTER, activeRunId);
        sendResponse({ ok: true });
        return false;
      }

      case MSG_PICK_ATTACHMENT: {
        openAuraFilePicker("attachment");
        sendResponse({ ok: true });
        return false;
      }

      case MSG_PICK_CSV: {
        openAuraFilePicker("csv");
        sendResponse({ ok: true });
        return false;
      }

      case MSG_EXTRACT_GROUP_CONTACTS: {
        sendResponse(extractGroupContactsData());
        return false;
      }

      case MSG_GET_CHATS_AND_GROUPS: {
        if (!isWhatsAppLoggedIn()) {
          sendResponse({ ok: false, notLoggedIn: true, items: [] });
          return false;
        }
        scrapePaneSideItems().then((items) => sendResponse({ ok: true, items }));
        return true;
      }

      case MSG_GET_CONTACTS: {
        getAllContacts().then((items) => sendResponse({ ok: true, items }));
        return true;
      }

      case MSG_GET_USER_PHONENUMBER: {
        sendResponse(getMyPhoneNumber());
        return false;
      }

      case MSG_GET_PAGE_URL: {
        sendResponse(window.location.href);
        return false;
      }

      case MSG_IS_MY_CHAT_WINDOW: {
        sendResponse(true);
        return false;
      }

      case MSG_GET_MESSAGE_RESULTS: {
        sendResponse({
          numbers: phoneNumbers.slice(),
          messages: messagesToSend.slice(),
          status: messageStatus.slice(),
          isRunning: isLoopActive,
          isPaused: pauseOperation,
          lastOperation,
          runTag,
          loggedIn: isWhatsAppLoggedIn(),
          sessionDisconnected: sessionDisconnectedFlag
        });
        return false;
      }

      case MSG_PAUSE: {
        pauseOperation = true;
        activeRunId++;
        isLoopActive = false;
        sendResponse({ ok: true });
        return false;
      }

      case MSG_CANCEL_OPERATION: {
        pauseOperation = true;
        sessionDisconnectedFlag = false;
        lastConfirmedTargetKey = "";
        activeRunId++;
        isLoopActive = false;
        messageStatus = [];
        phoneNumbers = [];
        campaignTargets = [];
        messagesToSend = [];
        delayMinSec = 2;
        delayMaxSec = 5;
        batchSize = 0;
        defaultText = "";
        useAttachmentFlag = false;
        inlineAttachment = null;
        lastOperation = "";
        sendResponse({ ok: true });
        return false;
      }

      case MSG_RESUME: {
        if (!isWhatsAppLoggedIn()) {
          sendResponse({ ok: false, notLoggedIn: true });
          return false;
        }
        const wasPaused = pauseOperation;
        pauseOperation = false;
        sessionDisconnectedFlag = false;
        if ((wasPaused || !isLoopActive) && lastOperation) {
          activeRunId++;
          isLoopActive = true;
          runOperationLoop(lastOperation, activeRunId);
        }
        sendResponse({ ok: true });
        return false;
      }

      default:
        return false;
    }
  }

  function getMyPhoneNumber() {
    try {
      const raw = window.localStorage.getItem("last-wid-md") || window.localStorage.getItem("last-wid") || "";
      if (raw) {
        const match = raw.replace(/^"+|"+$/g, "").match(/^(\d+)(?::\d+)?@/);
        if (match && match[1]) return match[1];
      }
    } catch (_) {}
    const profileImage = document.querySelector("#side header img");
    if (profileImage) {
      const src = profileImage.getAttribute("src") || "";
      const match = src.match(/[?&]u=([0-9]+)/);
      if (match && match[1]) return match[1];
    }
    return "";
  }

  function openAuraFilePicker(mode) {
    const existing = document.getElementById("auraAttachmentPickerOverlay");
    if (existing) existing.remove();

    const isCsv = mode === "csv";
    const overlay = document.createElement("div");
    overlay.id = "auraAttachmentPickerOverlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif;";

    const card = document.createElement("div");
    card.style.cssText =
      "background:#ffffff;border-radius:16px;padding:24px;width:360px;max-width:92vw;box-shadow:0 24px 48px rgba(0,0,0,0.22);text-align:center;position:relative;color:#1D1D1F;";

    const title = isCsv ? "Import Contacts (CSV / Excel)" : "Attach File to Aura";
    const subtitle = isCsv
      ? "Select a .csv or .xlsx workbook containing phone numbers and personalization columns."
      : "Select an image, video, PDF, or document (max 16 MB). Then click the Aura icon to send.";
    const acceptAttr = isCsv
      ? ".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,*/*";
    const btnText = isCsv ? "Choose CSV / Excel File" : "Choose File from Computer";

    card.innerHTML =
      "<button id='auraPickerClose' type='button' style='position:absolute;top:12px;right:12px;border:none;background:#F2F2F7;color:#6E6E73;width:28px;height:28px;border-radius:999px;cursor:pointer;font-size:16px;line-height:28px;'>&times;</button>" +
      `<h3 style='margin:0 0 6px;font-size:17px;font-weight:600;letter-spacing:-0.02em;'>${title}</h3>` +
      `<p style='margin:0 0 16px;font-size:12.5px;color:#6E6E73;'>${subtitle}</p>` +
      `<input id='auraPageFileInput' type='file' accept='${acceptAttr}' style='display:none;'>` +
      `<button id='auraChooseFileBtn' type='button' style='width:100%;padding:11px 16px;border:none;border-radius:11px;background:#007AFF;color:#fff;font-weight:600;font-size:13.5px;cursor:pointer;'>${btnText}</button>` +
      "<div id='auraPickerStatus' style='margin-top:12px;font-size:12px;color:#6E6E73;min-height:18px;'></div>";

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById("auraPickerClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const input = document.getElementById("auraPageFileInput");
    const statusEl = document.getElementById("auraPickerStatus");

    document.getElementById("auraChooseFileBtn").addEventListener("click", () => input.click());

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!isCsv && file.size > 16 * 1024 * 1024) {
        statusEl.style.color = "#D70015";
        statusEl.textContent = "File is too large (max 16 MB).";
        return;
      }
      statusEl.style.color = "#007AFF";
      statusEl.textContent = isCsv ? "Importing file..." : "Saving attachment...";
      const reader = new FileReader();
      reader.onload = async () => {
        if (isCsv) {
          if (/\.xlsx$/i.test(file.name)) {
            const bytes = new Uint8Array(reader.result);
            let bin = "";
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            await storageProvider.savePendingCSV({ name: file.name, base64Data: btoa(bin) });
          } else {
            await storageProvider.savePendingCSV({ name: file.name, csvText: String(reader.result || "") });
          }
          statusEl.style.color = "#248A3D";
          statusEl.textContent = `Imported "${file.name}". Re-open Aura to review and send.`;
        } else {
          await storageProvider.saveAttachmentData({
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            sendAs: /^image\/|^video\//i.test(file.type || "") ? "media" : "document",
            dataUrl: reader.result
          });
          statusEl.style.color = "#248A3D";
          statusEl.textContent = `Attached "${file.name}". Re-open Aura to send.`;
        }
        setTimeout(close, 1200);
      };
      reader.onerror = () => {
        statusEl.style.color = "#D70015";
        statusEl.textContent = "Failed to read the selected file.";
      };
      if (isCsv) {
        if (/\.xlsx$/i.test(file.name)) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    });
  }

  function dataUrlToFile(dataUrl, fileName, mimeType) {
    const parts = String(dataUrl || "").split(",");
    const header = parts[0] || "";
    const b64 = parts[1] || "";
    const mimeMatch = header.match(/data:([^;]+);/i);
    const resolvedType = mimeType || (mimeMatch ? mimeMatch[1] : "application/octet-stream");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName || "attachment", { type: resolvedType });
  }

  function convertWebpFileToPng(file) {
    return new Promise((resolve) => {
      if (!/webp/i.test(file.type || "") && !/\.webp$/i.test(file.name || "")) {
        resolve(file);
        return;
      }
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(objUrl);
            if (blob) {
              const pngName = (file.name || "image.webp").replace(/\.webp$/i, ".png");
              resolve(new File([blob], pngName, { type: "image/png" }));
            } else {
              resolve(file);
            }
          }, "image/png");
        } catch (_) {
          URL.revokeObjectURL(objUrl);
          resolve(file);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        resolve(file);
      };
      img.src = objUrl;
    });
  }

  function findAttachButton() {
    const footer = document.querySelector("#main footer");
    if (!footer) return null;
    const selectors = [
      '[data-testid="conversation-clip"]',
      '[data-testid="attach_icon"]',
      '[data-icon="ic-add"]',
      '[data-testid="attach-menu-plus"]',
      '[data-testid="clip"]',
      'button[aria-label="Attach"]',
      'button[title="Attach"]',
      'div[role="button"][aria-label="Attach"]',
      '[data-icon="plus-rounded"]',
      '[data-icon="wds-ic-plus"]',
      '[data-icon="plus"]',
      '[data-icon="clip"]',
      '[data-icon*="plus" i]',
      '[data-icon*="attach" i]'
    ];
    for (const sel of selectors) {
      const el = footer.querySelector(sel);
      if (el) {
        return el.closest("button, [role='button']") || el.querySelector("button, [role='button']") || el;
      }
    }
    const buttons = Array.from(footer.querySelectorAll("button, [role='button']"));
    return (
      buttons.find((b) => {
        const lbl = (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase();
        if (/emoji|smiley|gif|sticker|voice|ptt|record|send|expressions|meta ai|ai/i.test(lbl)) return false;
        if (b.querySelector('[data-icon*="smiley" i], [data-icon*="emoji" i], [data-icon*="ptt" i], [data-icon*="mic" i], [data-icon*="send" i], [data-testid*="send" i], [data-testid*="ptt" i]')) return false;
        return Boolean(b.querySelector("svg, span[data-icon]"));
      }) || null
    );
  }

  function isStickerMenuOrInput(node) {
    if (!node) return false;
    if (node.getAttribute && node.getAttribute("data-testid") === "mi-attach-sticker") return true;
    const row = node.closest ? (node.closest('li, [role="menuitem"], [role="button"], button, div[tabindex]') || node) : node;
    if (row.getAttribute && row.getAttribute("data-testid") === "mi-attach-sticker") return true;
    const rowText = (row.textContent || "").trim();
    if (/sticker|figurinha|autocollant|pegatina|adesivo|aufkleber/i.test(rowText)) return true;
    return Boolean(row.querySelector && row.querySelector('[data-icon*="sticker" i], [data-testid*="sticker" i]'));
  }

  function isStickerInput(inp) {
    const accept = (inp.getAttribute("accept") || "").toLowerCase();
    return isStickerMenuOrInput(inp) || (accept.includes("webp") && !accept.includes("video"));
  }

  function findAttachMenuItem(sendAs) {
    if (sendAs === "document") {
      const docDirect = Array.from(document.querySelectorAll('[data-testid="mi-attach-document"]')).find(
        (el) => el.offsetParent !== null && !isStickerMenuOrInput(el)
      );
      if (docDirect) return docDirect;
      const docItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] li, ul li, [role="application"] button, [role="application"] [role="button"]'));
      return (
        docItems.find((el) => {
          if (el.offsetParent === null || isStickerMenuOrInput(el)) return false;
          const txt = (el.textContent || "").trim();
          return /\bdocument\b/i.test(txt) || Boolean(el.querySelector('[data-icon*="document" i], [data-icon*="description" i]'));
        }) || null
      );
    }

    const mediaDirects = Array.from(document.querySelectorAll('[data-testid="mi-attach-media"]')).filter(
      (el) => el.offsetParent !== null && !isStickerMenuOrInput(el)
    );
    if (mediaDirects.length > 0) {
      const preferred = mediaDirects.find((el) => {
        const txt = (el.textContent || "").trim();
        if (/^audio$/i.test(txt) || el.querySelector('[data-icon*="headphone" i], [data-icon*="audio" i]')) return false;
        return /photo|video|media|gallery/i.test(txt) || Boolean(el.querySelector('[data-icon*="filter" i], [data-icon*="image" i], [data-icon*="photo" i]'));
      });
      if (preferred) return preferred;
      const nonAudio = mediaDirects.find((el) => !/^audio$/i.test((el.textContent || "").trim()) && !el.querySelector('[data-icon*="headphone" i], [data-icon*="audio" i]'));
      if (nonAudio) return nonAudio;
    }

    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] li, ul li'));
    return (
      menuItems.find((el) => {
        if (el.offsetParent === null || isStickerMenuOrInput(el)) return false;
        const txt = (el.textContent || "").trim();
        if (/^audio$/i.test(txt)) return false;
        return /photo|video|gallery/i.test(txt) || Boolean(el.querySelector('[data-icon*="filter" i], [data-icon*="image" i], [data-icon*="photo" i]'));
      }) || null
    );
  }

  function findStrictAttachmentInput(sendAs) {
    const allInputs = Array.from(document.querySelectorAll("input[type='file']"));
    if (allInputs.length === 0) return null;

    if (sendAs === "document") {
      return (
        allInputs.find((inp) => !isStickerInput(inp) && (inp.getAttribute("accept") || "").trim() === "*") ||
        allInputs.find((inp) => {
          if (isStickerInput(inp)) return false;
          const row = inp.closest('li, [role="menuitem"], [role="button"], button');
          const txt = (row ? row.textContent : "") || "";
          return /document|file/i.test(txt) || Boolean(row && row.querySelector('[data-icon*="document" i]'));
        }) ||
        null
      );
    }

    const photoAndVideoInput = allInputs.find((inp) => {
      if (isStickerInput(inp)) return false;
      const acc = (inp.getAttribute("accept") || "").toLowerCase();
      return acc.includes("image") && acc.includes("video");
    });
    if (photoAndVideoInput) return photoAndVideoInput;

    return (
      allInputs.find((inp) => {
        if (isStickerInput(inp)) return false;
        const row = inp.closest('li, [role="menuitem"], [role="button"], button');
        const txt = (row ? row.textContent : "") || "";
        return /photo|video|media|gallery/i.test(txt) || Boolean(row && row.querySelector('[data-icon*="image" i], [data-icon*="media" i], [data-icon*="photo" i]'));
      }) || null
    );
  }

  function isButtonEnabled(el) {
    if (!el || el.offsetParent === null) return false;
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  function findAllVisibleSendButtons() {
    const selectors = [
      '[data-testid="wds-ic-send-filled"]',
      '[data-testid="send"]',
      '[data-testid="compose-btn-send"]',
      'span[data-icon="wds-ic-send-filled"]',
      'span[data-icon="ic-send-filled"]',
      'span[data-icon="send"]',
      'span[data-icon="send-filled"]',
      'button[aria-label="Send"]',
      'div[role="button"][aria-label="Send"]',
      'button[data-tab="11"]'
    ];
    const results = [];
    const seen = new Set();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const clickable = el.closest("button, [role='button']") || el;
        if (clickable && isButtonEnabled(clickable) && !seen.has(clickable)) {
          seen.add(clickable);
          results.push(clickable);
        }
      }
    }
    const legacy = document.getElementsByClassName("_35EW6")[0];
    if (legacy && isButtonEnabled(legacy) && !seen.has(legacy)) results.push(legacy);
    return results;
  }

  function findSendButtonElement() {
    return findAllVisibleSendButtons()[0] || null;
  }

  function isInChatComposeFooter(el) {
    if (!el || !el.closest) return false;
    const footer = el.closest("footer");
    if (!footer) return false;
    if (footer.querySelector('[data-testid="conversation-clip"], [data-testid="attach-menu-plus"], [data-testid="attach_icon"], [data-testid="clip"]')) return true;
    return Boolean(el.closest("#main > footer"));
  }

  function findMediaPreviewSendButton() {
    const buttons = findAllVisibleSendButtons();
    const overlayBtn = buttons.find((el) => !isInChatComposeFooter(el));
    if (overlayBtn) return overlayBtn;
    const hasPreviewEvidence = Boolean(
      findMediaCaptionBox() ||
      document.querySelector('#main img[src^="blob:"], #main video[src^="blob:"], [data-testid*="media-editor"], [data-testid*="send-file"]')
    );
    return hasPreviewEvidence && buttons.length > 0 ? buttons[0] : null;
  }

  function isStickerEditorOpen() {
    const dialogs = Array.from(document.querySelectorAll('#app [role="dialog"], #app [data-animate-modal-popup="true"]'));
    return dialogs.some((d) => /create sticker|edit sticker|make a sticker/i.test(d.textContent || ""));
  }

  function findMediaCaptionBox() {
    const explicit = document.querySelector(
      '[aria-label*="caption" i][contenteditable="true"], [aria-placeholder*="caption" i][contenteditable="true"], [data-placeholder*="caption" i][contenteditable="true"], [placeholder*="caption" i][contenteditable="true"]'
    );
    if (explicit && explicit.offsetParent !== null) return explicit;
    const allEditable = Array.from(document.querySelectorAll('#app [contenteditable="true"]')).filter(
      (el) => el.offsetParent !== null && !el.closest("#side") && !isInChatComposeFooter(el)
    );
    return allEditable.length > 0 ? allEditable[allEditable.length - 1] : null;
  }

  function readEditableText(el) {
    if (!el) return "";
    return (el.innerText !== undefined && el.innerText !== "" ? el.innerText : el.textContent) || "";
  }

  function insertTextIntoEditable(el, text) {
    if (!el || !text) return false;
    const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    try {
      el.click();
      el.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      if ((el.textContent || "").length > 0) {
        document.execCommand("delete", false, null);
      }

      if (!normalized.includes("\n")) {
        document.execCommand("insertText", false, normalized);
        if (!readEditableText(el).trim()) {
          const dt = new DataTransfer();
          dt.setData("text/plain", normalized);
          el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
        }
        if (!readEditableText(el).trim()) {
          document.execCommand("insertText", false, normalized);
        }
        if (!readEditableText(el).trim()) {
          el.textContent = normalized;
        }
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: normalized, inputType: "insertText" }));
        return Boolean(readEditableText(el).trim());
      }

      const lines = normalized.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 0) {
          const beforeLen = readEditableText(el).length;
          document.execCommand("insertText", false, line);
          if (readEditableText(el).length === beforeLen) {
            el.appendChild(document.createTextNode(line));
          }
        }
        if (i < lines.length - 1) {
          const preBreakText = readEditableText(el);
          const shiftEnterOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true };
          el.dispatchEvent(new KeyboardEvent("keydown", shiftEnterOpts));
          el.dispatchEvent(new KeyboardEvent("keypress", shiftEnterOpts));
          if (readEditableText(el) === preBreakText) {
            let broke = false;
            try { broke = document.execCommand("insertLineBreak", false, null); } catch (_) {}
            if (!broke && readEditableText(el) === preBreakText) {
              el.appendChild(document.createElement("br"));
            }
          }
          el.dispatchEvent(new KeyboardEvent("keyup", shiftEnterOpts));
        }
      }

      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: normalized, inputType: "insertText" }));
      return Boolean(readEditableText(el).trim());
    } catch (_) {
      return false;
    }
  }

  function assignFileToInput(fileInput, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    try { dt.dropEffect = "copy"; } catch (_) {}
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
    if (desc && desc.set) desc.set.call(fileInput, dt.files);
    else fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function dispatchDropFile(mainPane, file) {
    const target = document.querySelector('[data-testid="conversation-panel-wrapper"]') || mainPane || document.querySelector("#main");
    if (!target) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    try { dt.dropEffect = "copy"; } catch (_) {}
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await sleep(180);
    const dropOverlay = document.querySelector('[data-testid="drag-drop-overlay"]') || document.querySelector('[data-testid="conversation-panel-wrapper"]') || target;
    dropOverlay.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    dropOverlay.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }

  async function armMainWorldFilePicker(file) {
    const token = "aura_" + Math.random().toString(36).slice(2) + "_" + Date.now();
    const rawOrigin = window.location && window.location.origin;
    const origin = rawOrigin && rawOrigin !== "null" ? rawOrigin : "*";
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (_) {
      return { armed: false, injectedPromise: Promise.resolve(false), disarm: () => {} };
    }

    let ackResolve;
    let injectResolve;
    const ackPromise = new Promise((r) => { ackResolve = r; });
    const injectedPromise = new Promise((r) => { injectResolve = r; });

    const onMsg = (ev) => {
      if (!ev || ev.source !== window || !ev.data || ev.data.token !== token) return;
      if (ev.data.__auraBridge === "ARMED_ACK") ackResolve(true);
      else if (ev.data.__auraBridge === "ARM_ERROR") ackResolve(false);
      else if (ev.data.__auraBridge === "FILE_INJECTED") injectResolve(true);
      else if (ev.data.__auraBridge === "INJECT_ERROR") injectResolve(false);
    };
    window.addEventListener("message", onMsg);

    const cleanup = () => {
      window.removeEventListener("message", onMsg);
      try { window.postMessage({ __auraBridge: "DISARM", token }, origin); } catch (_) {}
    };

    try {
      window.postMessage(
        {
          __auraBridge: "ARM_FILE",
          token,
          buffer,
          name: file.name,
          mime: file.type,
          lastModified: file.lastModified || Date.now(),
          ttlMs: 5000
        },
        origin,
        [buffer]
      );
    } catch (_) {
      cleanup();
      return { armed: false, injectedPromise: Promise.resolve(false), disarm: () => {} };
    }

    const armed = await Promise.race([ackPromise, sleep(400).then(() => false)]);
    if (!armed) {
      cleanup();
      return { armed: false, injectedPromise: Promise.resolve(false), disarm: () => {} };
    }

    return {
      armed: true,
      injectedPromise: Promise.race([injectedPromise, sleep(1500).then(() => false)]),
      disarm: cleanup
    };
  }

  function dismissAttachMenuIfOpen() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    const main = document.querySelector("#main");
    if (main) main.click();
  }

  async function prepareAttachmentPayload(attachmentData) {
    if (!attachmentData || !attachmentData.dataUrl) return null;
    let file = dataUrlToFile(attachmentData.dataUrl, attachmentData.name, attachmentData.type);
    const mimeOrExtIsMedia =
      /^image\/(jpeg|jpg|png|gif|webp|bmp)$|^video\/(mp4|webm|quicktime|3gpp|x-m4v)$/i.test(file.type || "") ||
      /\.(jpe?g|png|gif|webp|bmp|mp4|m4v|mov|webm)$/i.test(file.name || "");
    const sendAs =
      attachmentData.sendAs === "document"
        ? "document"
        : mimeOrExtIsMedia
          ? "media"
          : "document";
    if (sendAs === "media") file = await convertWebpFileToPng(file);
    return { file, sendAs };
  }

  function computeRandomizedGapMs() {
    const minMs = Math.max(1, delayMinSec) * 1000;
    const maxMs = Math.max(minMs, delayMaxSec * 1000);
    return Math.round(minMs + Math.random() * (maxMs - minMs));
  }

  async function runOperationLoop(mode, runId) {
    if (currentLoopPromise) {
      try { await currentLoopPromise; } catch (_) {}
    }
    if (pauseOperation || runId !== activeRunId) {
      if (runId === activeRunId) isLoopActive = false;
      return;
    }

    isLoopActive = true;
    const loopTask = (async () => {
      try {
        let cachedAttachment = inlineAttachment;
        if (mode === OPERATION_FORWARD_ATTACHMENT && !cachedAttachment) {
          cachedAttachment = await storageProvider.getAttachmentData();
        }
        const preparedAttachment =
          mode === OPERATION_FORWARD_ATTACHMENT && cachedAttachment
            ? await prepareAttachmentPayload(cachedAttachment)
            : null;

        let sentSinceBatch = 0;

        for (let index = 0; index < campaignTargets.length; index++) {
          const shouldAbort = () => pauseOperation || runId !== activeRunId;
          if (shouldAbort()) break;
          if (messageStatus[index] !== STATUS_PENDING) continue;

          if (!isWhatsAppLoggedIn()) {
            sessionDisconnectedFlag = true;
            pauseOperation = true;
            isLoopActive = false;
            sendMsgToExtension({
              from: "category-content",
              subject: MSG_MESSAGE_RESULTS,
              data: {
                numbers: phoneNumbers.slice(),
                messages: messagesToSend.slice(),
                status: messageStatus.slice(),
                lastOperation: mode,
                runTag,
                loggedIn: false,
                sessionDisconnected: true,
                isRunning: false,
                isPaused: true
              }
            });
            break;
          }

          const target = campaignTargets[index];
          const perRecipientText =
            messagesToSend && messagesToSend.length === campaignTargets.length
              ? messagesToSend[index]
              : defaultText;

          let success = false;
          try {
            if (mode === OPERATION_FILTER) {
              success = target.kind === "phone" ? await validateNumber(target.value, shouldAbort) : false;
            } else if (mode === OPERATION_FORWARD_ATTACHMENT && preparedAttachment) {
              success = await sendAttachmentToTarget(target, perRecipientText, preparedAttachment, shouldAbort);
            } else {
              success = await sendToTarget(target, perRecipientText, shouldAbort);
            }
          } catch (err) {
            console.error("Operation error for", target, err);
            success = false;
          }

          if (success) {
            messageStatus[index] = STATUS_SENT;
            sentSinceBatch++;
          } else if (shouldAbort()) {
            break;
          } else {
            messageStatus[index] = STATUS_FAILED;
            sentSinceBatch++;
          }

          const hasMore = messageStatus.slice(index + 1).some((s) => s === STATUS_PENDING);
          sendMsgToExtension({
            from: "category-content",
            subject: MSG_MESSAGE_RESULTS,
            data: {
              numbers: phoneNumbers.slice(),
              messages: messagesToSend.slice(),
              status: messageStatus.slice(),
              lastOperation: mode,
              runTag,
              isRunning: hasMore && !shouldAbort(),
              isPaused: pauseOperation
            }
          });

          if (shouldAbort()) break;

          if (hasMore) {
            let waitMs;
            if (mode === OPERATION_FILTER) {
              waitMs = 1000;
            } else if (batchSize > 0 && sentSinceBatch >= batchSize) {
              sentSinceBatch = 0;
              waitMs = batchPauseSec * 1000;
            } else {
              waitMs = computeRandomizedGapMs();
            }
            await sleep(waitMs, shouldAbort);
          }
        }
      } finally {
        if (runId === activeRunId) isLoopActive = false;
        if (currentLoopPromise === loopTask) currentLoopPromise = null;
      }
    })();

    currentLoopPromise = loopTask;
    await loopTask;
  }

  function getMainHeaderText() {
    const header = document.querySelector("#main header");
    if (!header) return "";
    const titleSpans = Array.from(header.querySelectorAll("span[title]"))
      .map((el) => el.getAttribute("title") || "")
      .filter(Boolean);
    const textBody = (header.textContent || "").trim();
    if (titleSpans.length > 0 && textBody) return `${titleSpans.join("|")}|${textBody}`;
    return titleSpans.join("|") || textBody;
  }

  function isStartingChatModalOpen() {
    const dialogs = Array.from(document.querySelectorAll('[data-animate-modal-popup="true"], [role="dialog"]'));
    return dialogs.some((d) => /starting chat|looking up|loading chat|connecting/i.test(d.textContent || ""));
  }

  function findInvalidNumberModal() {
    const dialogs = Array.from(document.querySelectorAll('[data-animate-modal-popup="true"], [role="dialog"]'));
    for (const dialog of dialogs) {
      const txt = (dialog.textContent || "").toLowerCase();
      if (
        txt.includes("invalid") ||
        txt.includes("not on whatsapp") ||
        txt.includes("isn't on whatsapp") ||
        txt.includes("url is invalid") ||
        txt.includes("couldn't find")
      ) {
        return dialog;
      }
      const hasOk = Boolean(dialog.querySelector('[data-testid="popup-controls-ok"]'));
      const hasCancel = Boolean(dialog.querySelector('[data-testid="popup-controls-cancel"]'));
      if (hasOk && !hasCancel && !isStartingChatModalOpen()) return dialog;
    }
    if (document.querySelector(".aymnx") && !document.querySelector("._13HPh")) {
      return document.querySelector(".aymnx");
    }
    return null;
  }

  function dismissInvalidNumberModal(dialog) {
    const root = dialog || findInvalidNumberModal();
    if (!root) return false;
    const okBtn = root.querySelector('[data-testid="popup-controls-ok"]') || root.querySelector("button") || root.querySelector('[role="button"]');
    if (okBtn) okBtn.click();
    return true;
  }

  function createMessageLink(number, text) {
    return new Promise((resolve) => {
      const cleanNumber = String(number || "").replace(/\D/g, "");
      if (!cleanNumber) {
        resolve({ clicked: false, intercepted: false });
        return;
      }
      const encodedText = encodeURIComponent(text || "");
      const href = `https://wa.me/${cleanNumber}?text=${encodedText}`;
      let link = document.getElementById("auraWhatsappLink");
      if (!link) {
        link = document.createElement("a");
        link.id = "auraWhatsappLink";
        link.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
      }
      const preferredHost =
        document.querySelector("#main .copyable-area") ||
        document.querySelector("#app .app-wrapper-web") ||
        document.querySelector("#app") ||
        document.body;
      if (!preferredHost) {
        resolve({ clicked: false, intercepted: false });
        return;
      }
      if (link.parentElement !== preferredHost) preferredHost.appendChild(link);
      link.setAttribute("href", href);
      setTimeout(() => {
        let wasInterceptedByApp = false;
        const guard = (e) => {
          if (e.target === link || (link.contains && link.contains(e.target))) {
            wasInterceptedByApp = e.defaultPrevented;
            if (!e.defaultPrevented) e.preventDefault();
          }
        };
        document.addEventListener("click", guard, false);
        try { link.click(); } finally { document.removeEventListener("click", guard, false); }
        resolve({ clicked: true, intercepted: wasInterceptedByApp });
      }, 150);
    });
  }

  function findSideSearchInput() {
    return (
      document.querySelector('#side [data-testid="chat-list-search"] [contenteditable="true"]') ||
      document.querySelector('#side [contenteditable="true"][role="textbox"]') ||
      document.querySelector('#side [contenteditable="true"]') ||
      document.querySelector('#side input[type="text"]') ||
      null
    );
  }

  function clearSideSearchInput(searchEl) {
    if (!searchEl) return;
    try {
      if (searchEl.tagName === "INPUT") {
        searchEl.value = "";
        searchEl.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        searchEl.focus();
        const sel = window.getSelection();
        if (sel) {
          const r = document.createRange();
          r.selectNodeContents(searchEl);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        document.execCommand("delete", false, null);
        searchEl.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      }
    } catch (_) {}
  }

  async function openChatByTitleAndWait(chatTitle, text, shouldAbort = null) {
    const cleanTitle = String(chatTitle || "").trim();
    if (!cleanTitle) return { ok: false };

    const targetKey = `chat:${cleanTitle.toLowerCase()}`;
    const currHeader = getMainHeaderText().toLowerCase();
    if (currHeader.includes(cleanTitle.toLowerCase()) && document.querySelector('#main footer [contenteditable="true"]')) {
      lastConfirmedTargetKey = targetKey;
      const comp = document.querySelector('#main footer [contenteditable="true"]');
      if (text && text.length > 0) {
        insertTextIntoEditable(comp, text);
        await sleep(160);
        const btn = await waitForCondition(() => findSendButtonElement(), 4000, 150, shouldAbort);
        return btn ? { ok: true, sendBtn: btn } : { ok: false };
      }
      return { ok: true, compose: comp };
    }

    const searchEl = findSideSearchInput();
    if (!searchEl) return { ok: false };

    const prevMainEl = document.querySelector("#main");
    const prevHeaderText = getMainHeaderText();

    if (searchEl.tagName === "INPUT") {
      searchEl.focus();
      searchEl.value = cleanTitle;
      searchEl.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      insertTextIntoEditable(searchEl, cleanTitle);
    }

    await sleep(600);

    const lowerTarget = cleanTitle.toLowerCase();
    const matchedRow = await waitForCondition(
      () => {
        const pane = document.getElementById("pane-side") || document.querySelector("#side");
        if (!pane) return null;
        const rows = Array.from(pane.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]')).filter(
          (r) => r.offsetParent !== null
        );
        const exact = rows.find((r) => {
          const tEl = r.querySelector("span[title]");
          const t = (tEl ? tEl.getAttribute("title") || tEl.textContent : r.textContent || "").trim().toLowerCase();
          return t === lowerTarget;
        });
        if (exact) return exact;
        return (
          rows.find((r) => {
            const tEl = r.querySelector("span[title]");
            const t = (tEl ? tEl.getAttribute("title") || tEl.textContent : r.textContent || "").trim().toLowerCase();
            return t.includes(lowerTarget);
          }) || null
        );
      },
      8000, // B13: increased from 5s to 8s for large chat lists (500+ chats)
      200,
      shouldAbort
    );

    if (!matchedRow) {
      clearSideSearchInput(searchEl);
      return { ok: false };
    }

    clickElementFully(matchedRow);

    const switchedCompose = await waitForCondition(
      () => {
        const comp = document.querySelector('#main footer [contenteditable="true"]');
        if (!comp) return null;
        const hdr = getMainHeaderText();
        const currMainEl = document.querySelector("#main");
        if (hdr.toLowerCase().includes(lowerTarget) || !prevMainEl || currMainEl !== prevMainEl || (hdr !== prevHeaderText && hdr !== "")) {
          return comp;
        }
        return null;
      },
      6000,
      200,
      shouldAbort
    );

    clearSideSearchInput(searchEl);

    if (!switchedCompose) return { ok: false };
    lastConfirmedTargetKey = targetKey;

    if (text && text.length > 0) {
      insertTextIntoEditable(switchedCompose, text);
      await sleep(180);
      const sendBtn = await waitForCondition(() => findSendButtonElement(), 4000, 150, shouldAbort);
      return sendBtn ? { ok: true, sendBtn } : { ok: false };
    }
    return { ok: true, compose: switchedCompose };
  }

  async function openChatViaNewChatUI(cleanNumber, text, shouldAbort = null) {
    const newChatTrigger =
      document.querySelector('[data-testid="new-chat-outline"]') ||
      document.querySelector('[data-icon="new-chat-outline"]') ||
      document.querySelector('button[aria-label="New chat"]') ||
      document.querySelector('[title="New chat"]') ||
      document.querySelector('[data-testid="chatlist-header-new-chat-button"]');
    if (!newChatTrigger) return false;

    const closeDrawer = () => {
      const drawerBack = document.querySelector('[data-animate-drawer-left="true"] [data-icon*="back" i], [data-animate-drawer-left="true"] button[aria-label="Back"]');
      if (drawerBack) clickElementFully(drawerBack.closest("button, [role='button']") || drawerBack);
      else dismissAttachMenuIfOpen();
    };

    clickElementFully(newChatTrigger.closest("button, [role='button']") || newChatTrigger);
    await sleep(400);

    const searchBox = await waitForCondition(
      () => {
        const drawerInput = Array.from(
          document.querySelectorAll('[data-animate-drawer-left="true"] [contenteditable="true"], [data-animate-drawer-left="true"] input[type="text"]')
        ).find((el) => el.offsetParent !== null);
        if (drawerInput) return drawerInput;
        const active = document.activeElement;
        if (active && active.offsetParent !== null && !active.closest("#main footer") && (active.isContentEditable || active.tagName === "INPUT")) return active;
        const inputs = Array.from(
          document.querySelectorAll('#side [contenteditable="true"], #side input[type="text"], #app [contenteditable="true"], #app input[type="text"]')
        ).filter((el) => el.offsetParent !== null && !el.closest("#main footer"));
        return inputs.length > 0 ? inputs[inputs.length - 1] : null;
      },
      3000,
      150,
      shouldAbort
    );
    if (!searchBox) return false;

    if (searchBox.tagName === "INPUT") {
      searchBox.focus();
      searchBox.value = cleanNumber;
      searchBox.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      insertTextIntoEditable(searchBox, cleanNumber);
    }

    await sleep(900);

    const lookupOutcome = await waitForCondition(
      () => {
        const drawer = searchBox.closest('[data-animate-drawer-left], #side, div[tabindex]') || document;
        const drawerText = drawer.textContent || "";
        if (/no results found|not on whatsapp/i.test(drawerText)) return { notFound: true };
        const rows = Array.from(drawer.querySelectorAll('[role="listitem"], [role="button"]')).filter(
          (r) => r.offsetParent !== null && !r.querySelector("header") && !/^new (group|community|contact)$/i.test((r.textContent || "").trim())
        );
        const match =
          rows.find((r) => {
            const txt = (r.textContent || "").replace(/\D/g, "");
            return (cleanNumber.length >= 6 && txt.includes(cleanNumber)) || /chat with/i.test(r.textContent || "");
          }) ||
          (cleanNumber.length >= 10
            ? rows.find((r) => (r.textContent || "").replace(/\D/g, "").includes(cleanNumber.slice(-10)))
            : null);
        return match ? { row: match } : null;
      },
      4500,
      200,
      shouldAbort
    );

    if (!lookupOutcome || lookupOutcome.notFound || !lookupOutcome.row) {
      closeDrawer();
      return false;
    }

    const prevMainEl = document.querySelector("#main");
    const prevHeaderText = getMainHeaderText();
    const targetKey = `phone:${cleanNumber}`;
    clickElementFully(lookupOutcome.row);
    const compose = await waitForCondition(
      () => {
        const comp = document.querySelector('#main footer [contenteditable="true"]');
        if (!comp) return null;
        const currMainEl = document.querySelector("#main");
        const currHeaderText = getMainHeaderText();
        const currDigits = currHeaderText.replace(/\D/g, "");
        const switched =
          !prevMainEl ||
          currMainEl !== prevMainEl ||
          (currHeaderText !== prevHeaderText && currHeaderText !== "") ||
          (cleanNumber.length >= 6 && currDigits.includes(cleanNumber)) ||
          (cleanNumber.length >= 10 && currDigits.includes(cleanNumber.slice(-10)));
        if (switched || targetKey === lastConfirmedTargetKey) return comp;
        return null;
      },
      5000,
      200,
      shouldAbort
    );
    if (!compose) {
      closeDrawer();
      return false;
    }
    lastConfirmedTargetKey = targetKey;
    if (text && text.length > 0) {
      insertTextIntoEditable(compose, text);
      await sleep(150);
    }
    return true;
  }

  async function openChatAndWait(number, text, shouldAbort = null) {
    dismissInvalidNumberModal();
    const cleanNumber = String(number || "").replace(/\D/g, "");
    if (!cleanNumber) return { ok: false };

    const targetKey = `phone:${cleanNumber}`;
    const prevMainEl = document.querySelector("#main");
    const prevHeaderText = getMainHeaderText();
    const hadSendBtnBefore = Boolean(findSendButtonElement());
    const trimmedExpected = typeof text === "string" ? text.trim() : "";

    const linkResult = await createMessageLink(cleanNumber, text || "");
    if (!linkResult || !linkResult.clicked) return { ok: false };

    if (!linkResult.intercepted) {
      const openedViaUI = await openChatViaNewChatUI(cleanNumber, text || "", shouldAbort);
      if (!openedViaUI) return { ok: false };
      if (text && text.length > 0) {
        const sendBtn = await waitForCondition(() => findSendButtonElement(), 4000, 150, shouldAbort);
        return sendBtn ? { ok: true, sendBtn } : { ok: false };
      }
      const compose = document.querySelector('#main footer [contenteditable="true"]');
      return compose ? { ok: true, compose } : { ok: false };
    }

    const clickedAt = Date.now();
    await sleep(450);

    const hasText = typeof text === "string" && text.length > 0;
    const outcome = await waitForCondition(
      () => {
        if (!isWhatsAppLoggedIn()) return { ok: false, disconnected: true };
        const invalidModal = findInvalidNumberModal();
        if (invalidModal) return { ok: false, modal: invalidModal };
        if (isStartingChatModalOpen()) return null;

        const readyEl = hasText ? findSendButtonElement() : document.querySelector('#main footer [contenteditable="true"]');
        if (!readyEl) return null;

        const currMainEl = document.querySelector("#main");
        const currHeaderText = getMainHeaderText();
        const currDigits = currHeaderText.replace(/\D/g, "");
        const headerMatchesNumber =
          (cleanNumber.length >= 6 && currDigits.includes(cleanNumber)) ||
          (cleanNumber.length >= 10 && currDigits.includes(cleanNumber.slice(-10)));
        const switched =
          !prevMainEl ||
          currMainEl !== prevMainEl ||
          (currHeaderText !== prevHeaderText && currHeaderText !== "") ||
          headerMatchesNumber;

        const composeEl = document.querySelector('#main footer [contenteditable="true"]');
        const composeMatchesExpected = Boolean(
          hasText && trimmedExpected && composeEl && readEditableText(composeEl).trim().includes(trimmedExpected)
        );
        const sameNumberRepeat = Boolean(lastConfirmedTargetKey && targetKey === lastConfirmedTargetKey);
        const sameSavedFirstChat = Boolean(
          !lastConfirmedTargetKey && hasText && !hadSendBtnBefore && composeMatchesExpected && Date.now() - clickedAt >= 900
        );
        const sameSavedNoText = Boolean(!lastConfirmedTargetKey && !hasText && Date.now() - clickedAt >= 1500);

        const settled = switched || (sameNumberRepeat && Date.now() - clickedAt >= 350) || sameSavedFirstChat || sameSavedNoText;
        if (!settled) return null;
        return hasText ? { ok: true, sendBtn: readyEl } : { ok: true, compose: readyEl };
      },
      15000,
      200,
      shouldAbort
    );

    if (!outcome) return { ok: false };
    if (!outcome.ok) {
      if (outcome.modal) {
        dismissInvalidNumberModal(outcome.modal);
        await sleep(250);
      }
      return { ok: false };
    }
    lastConfirmedTargetKey = targetKey;
    return outcome;
  }

  async function openTargetAndWait(target, text, shouldAbort = null) {
    if (target && target.kind === "chat") {
      return openChatByTitleAndWait(target.value, text, shouldAbort);
    }
    return openChatAndWait(target ? target.value : "", text, shouldAbort);
  }

  async function validateNumber(number, shouldAbort = null) {
    const res = await openChatAndWait(number, "", shouldAbort);
    return Boolean(res && res.ok);
  }

  async function sendToTarget(target, text, shouldAbort = null) {
    const hasText = typeof text === "string" && text.length > 0;
    const outcome = await openTargetAndWait(target, text || "", shouldAbort);
    if (!outcome || !outcome.ok) return false;
    if (!hasText) return true;

    await sleep(150);
    if (shouldAbort && shouldAbort()) return false;
    const activeSendBtn = findSendButtonElement() || outcome.sendBtn;
    if (!activeSendBtn) return false;
    clickElementFully(activeSendBtn);
    await sleep(300);
    return true;
  }

  async function sendAttachmentToTarget(target, captionText, preparedOrRaw, shouldAbort = null) {
    const chatRes = await openTargetAndWait(target, "", shouldAbort);
    if (!chatRes || !chatRes.ok) return false;
    await sleep(300);

    const resolvedPayload = preparedOrRaw && preparedOrRaw.file ? preparedOrRaw : await prepareAttachmentPayload(preparedOrRaw);
    if (!resolvedPayload || !resolvedPayload.file) return false;
    const { file, sendAs } = resolvedPayload;

    let previewSendBtn = null;
    const attachBtn = findAttachButton();
    if (attachBtn) {
      clickElementFully(attachBtn);
      const attachTarget = await waitForCondition(
        () => {
          const legacyInput = findStrictAttachmentInput(sendAs);
          if (legacyInput) return { kind: "input", el: legacyInput };
          const menuItem = findAttachMenuItem(sendAs);
          if (menuItem) return { kind: "menu", el: menuItem };
          return null;
        },
        3000,
        100,
        shouldAbort
      );

      if (attachTarget && attachTarget.kind === "input") {
        assignFileToInput(attachTarget.el, file);
        previewSendBtn = await waitForCondition(() => findMediaPreviewSendButton(), 10000, 150, shouldAbort);
      } else if (attachTarget && attachTarget.kind === "menu") {
        const bridge = await armMainWorldFilePicker(file);
        try {
          if (bridge.armed) {
            clickElementFully(attachTarget.el);
            const injected = await bridge.injectedPromise;
            if (injected) previewSendBtn = await waitForCondition(() => findMediaPreviewSendButton(), 10000, 150, shouldAbort);
          }
        } finally {
          bridge.disarm();
        }
      }
    }

    const isRasterImage = /^image\//i.test(file.type || "");
    if (!previewSendBtn && (sendAs === "media" || !isRasterImage) && !(shouldAbort && shouldAbort())) {
      dismissAttachMenuIfOpen();
      await sleep(200);
      const mainPane = document.querySelector("#main");
      if (mainPane) {
        await dispatchDropFile(mainPane, file);
        previewSendBtn = await waitForCondition(() => findMediaPreviewSendButton(), 8000, 150, shouldAbort);
      }
    }

    if (!previewSendBtn || isStickerEditorOpen()) {
      dismissAttachMenuIfOpen();
      return false;
    }

    await sleep(400);

    let captionSentInOverlay = false;
    if (captionText && captionText.trim().length > 0) {
      const captionBox = findMediaCaptionBox();
      if (captionBox) {
        captionSentInOverlay = insertTextIntoEditable(captionBox, captionText) || Boolean(readEditableText(captionBox).trim());
        await sleep(220);
      }
    }

    const finalSendBtn = findMediaPreviewSendButton() || previewSendBtn;
    if (!finalSendBtn || (shouldAbort && shouldAbort())) return false;
    clickElementFully(finalSendBtn);
    await waitForCondition(() => !findMediaPreviewSendButton(), 6000, 150, shouldAbort);
    await sleep(400);

    if (captionText && captionText.trim().length > 0 && !captionSentInOverlay) {
      const footerCompose = document.querySelector('#main footer [contenteditable="true"]');
      if (footerCompose && insertTextIntoEditable(footerCompose, captionText)) {
        await sleep(180);
        const chatSendBtn = findSendButtonElement();
        if (chatSendBtn) {
          clickElementFully(chatSendBtn);
          await sleep(300);
          return true;
        }
      }
      await sendToTarget(target, captionText, shouldAbort);
    }
    return true;
  }

  async function scrapePaneSideItems() {
    const pane = document.getElementById("pane-side");
    if (!pane) return [];
    const results = [];
    const seen = new Set();
    const prevScroll = pane.scrollTop;
    pane.scrollTop = 0;

    for (let pass = 0; pass < 15; pass++) {
      let addedThisPass = 0;
      pane.querySelectorAll('[role="listitem"]').forEach((node) => {
        const img = node.querySelector("img");
        const image = img ? img.getAttribute("src") || "" : "";
        let phoneNumber = "";
        const match = image.match(/[?&]u=([0-9]+)/);
        if (match && match[1]) phoneNumber = match[1];
        const nameEl = node.querySelector("span[title]");
        const name = (nameEl ? (nameEl.getAttribute("title") || nameEl.textContent || "") : "").trim();
        if (!phoneNumber && /^[+\d\s()-]{6,}$/.test(name)) {
          phoneNumber = name.replace(/\D/g, "");
        }
        const isGroupHint =
          Boolean(node.querySelector('[data-icon*="group" i], [data-icon*="community" i], [data-icon*="newsletter" i]')) ||
          (!phoneNumber && Boolean(name) && !/^[+\d\s()-]{6,}$/.test(name));

        const key = (phoneNumber || name).toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        addedThisPass++;
        results.push({
          id: key,
          name: name || (phoneNumber ? `+${phoneNumber}` : "Unnamed"),
          phoneNumber,
          isGroup: isGroupHint,
          image
        });
      });

      const beforeTop = pane.scrollTop;
      const step = Math.max(200, Math.floor((pane.offsetHeight || 400) * 0.75));
      pane.scrollTop = pane.scrollTop + step;
      await sleep(300);
      if (pane.scrollTop === beforeTop && addedThisPass === 0) break;
    }

    pane.scrollTop = prevScroll;
    await storageProvider.saveAllAudiences(results);
    return results;
  }

  async function getAllContacts() {
    const items = await scrapePaneSideItems();
    const contacts = items.filter((item) => Boolean(item.phoneNumber));
    await storageProvider.saveAllContacts(contacts);
    sendMsgToExtension({ from: "category-content", subject: MSG_UPDATE_CONTACTS, data: contacts });
    return contacts;
  }
})();
