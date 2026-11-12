(function () {
  "use strict";

  const urlParams = new URLSearchParams(window.location.search);
  const isWindowMode = urlParams.get("mode") === "window";
  const storage = getStorageInstance();

  const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
  const MAX_LOG_VISIBLE = 150;
  const TOUR_STEPS = [
    {
      targetId: "tourTargetRecipients",
      title: "Input Recipient Numbers",
      body: "Enter the contact numbers, upload Excel/CSV, or choose WhatsApp groups and contacts to deliver your message."
    },
    {
      targetId: "tourTargetMessage",
      title: "Compose Your Message",
      body: "Write the message you'd like to send with bold, italic, emojis, {{variables}}, reusable templates, or attachments."
    },
    {
      targetId: "tourTargetDispatch",
      title: "Initiate Message Dispatch",
      body: "Click the Send button to begin the message-sending process. Aura will pace and track delivery automatically."
    }
  ];

  const GUIDE_CONTENT = {
    attach: {
      title: "How to send attachments?",
      html: `
        <p><strong>1. Attach a file:</strong> Click the paperclip icon inside the Message box (or drag &amp; drop or paste an image with <code>Ctrl+V</code>).</p>
        <p><strong>2. Choose delivery type:</strong> Toggle <strong>Media</strong> to send with inline preview + caption, or <strong>Doc</strong> to send uncompressed files up to 16 MB.</p>
        <p><strong>3. Caption personalization:</strong> Any text and <code>{{Variables}}</code> in the Message box will be attached as your caption cleanly.</p>
      `
    },
    groups: {
      title: "How to send messages to groups?",
      html: `
        <p><strong>1. Open Audiences tab:</strong> Select <strong>Audiences</strong> above the composer to load your active WhatsApp groups &amp; chats.</p>
        <p><strong>2. Pick or save groups:</strong> Check one or more groups, search by name, or save reusable selections under <strong>Saved Audiences</strong>.</p>
        <p><strong>3. Group Member Extractor:</strong> Want to message members individually? Open a group in WhatsApp Web and pick <em>Extract Group Contacts</em> from Campaign Numbers or the Features tab.</p>
      `
    }
  };

  const state = {
    waTabId: null,
    waConnected: false,
    waQR: false,
    activeNav: "sender",
    recipientSource: "numbers",
    isdDigits: "91",
    iso2: "in",
    manualNumbers: [],
    csvFileData: null,
    csvFileName: "",
    phoneColumnIndex: 0,
    allAudiences: [],
    selectedAudiences: [],
    allContacts: [],
    selectedContacts: [],
    savedLists: [],
    selectedListIds: [],
    savedAudiences: [],
    savedTemplates: [],
    reportsHistory: [],
    scheduledCampaign: null,
    attachment: null,
    previewOpen: false,
    campaignOptions: {
      useTimeGap: false,
      minGapSec: 5,
      maxGapSec: 12,
      useBatching: false,
      batchSize: 25,
      batchPauseSec: 30
    },
    isRunning: false,
    isPaused: false,
    latestResults: [],
    tourIndex: -1,
    saveModalMode: null,
    pollTimer: null
  };

  const els = {};
  let itiInstance = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setVisible(el, show) {
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  function isVisible(el) {
    return Boolean(el && !el.classList.contains("hidden"));
  }

  function cacheElements() {
    const ids = [
      "navSenderBtn", "navFeaturesBtn", "statusPill", "statusText",
      "startTourBtn", "clearAllBtn", "popoutBtn",
      "launchView", "launchWhatsappBtn", "senderWorkspace", "featuresWorkspace",
      "csvFileInput", "attachmentFileInput",
      "srcNumbersBtn", "srcAudiencesBtn", "srcContactsBtn", "srcListsBtn",
      "panelNumbers", "panelAudiences", "panelContacts", "panelLists",
      "tourTargetRecipients", "recipientCountBadge", "manualRecipientsWrap",
      "isdCode", "chipsContainer", "numberTextInput",
      "csvSummaryBar", "csvFileName", "phoneColumnSelect", "replaceCsvBtn", "removeCsvBtn",
      "downloadExampleBtn", "uploadCsvBtn", "campaignQuickSelect", "csvError", "csvNotice",
      "audienceCountBadge", "selectedAudiencesTray", "audienceSearchInput",
      "selectAllAudiencesChk", "refreshAudiencesBtn", "savedAudiencesSelect", "audiencesList",
      "contactsCountBadge", "contactSearchInput", "selectAllContactsChk", "refreshContactsBtn", "contactsList",
      "saveNewListBtn", "savedListsContainer",
      "tourTargetMessage", "fmtBoldBtn", "fmtItalicBtn", "fmtStrikeBtn", "fmtMonoBtn",
      "emojiBarBtn", "previewToggleBtn", "charCount", "messageInput",
      "variableChipsWrap", "variableChipsList", "previewBubble", "previewContent",
      "attachedChipBar", "attachmentThumb", "attachmentFileBadge", "attachmentName", "attachmentSize",
      "sendAsRow", "sendAsMediaBtn", "sendAsDocBtn", "removeAttachmentBtn", "attachmentError",
      "emojiPopover", "composerEmojiBtn", "composerAttachBtn", "templateSelect",
      "tourTargetDispatch", "sendCampaignBtn", "sendCampaignLabel", "checkNumbersBtn",
      "deliveryReportBtn", "deliveryCaret", "actionError", "deliveryDrawer",
      "progressPanel", "progressLabel", "progressPercent", "progressFill",
      "sentCount", "failedCount", "pauseBtn", "resumeBtn", "stopBtn",
      "reportBar", "finalSentCount", "finalFailedCount", "downloadReportBtn", "dismissReportBtn",
      "deliveryLogList",
      "optTimeGap", "optTimeGapBody", "minGapInput", "maxGapInput",
      "optBatching", "optBatchingBody", "batchSizeInput", "batchPauseInput",
      "optSchedule", "optScheduleBody", "scheduleAtInput",
      "activeScheduleBanner", "activeScheduleText", "cancelScheduleBtn",
      "guideUseBtn", "guideAttachBtn", "guideGroupsBtn",
      "guideSheet", "guideSheetTitle", "guideSheetBody", "closeGuideSheetBtn",
      "featExtractGroupBtn", "featVerifyBtn", "historyCountBadge", "reportsHistoryList",
      "saveModalOverlay", "saveModalTitle", "saveModalInput", "saveModalCancelBtn", "saveModalConfirmBtn",
      "tourOverlay", "tourTitle", "tourBody", "tourStepLabel", "tourPrevBtn", "tourNextBtn", "tourCloseBtn"
    ];
    for (const id of ids) {
      els[id] = $(id);
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeDigits(val) {
    return String(val || "").replace(/[^\d]/g, "");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function normalizePhoneWithIsd(rawToken) {
    const trimmed = String(rawToken || "").trim();
    if (!trimmed) return "";
    const hasPlus = trimmed.startsWith("+");
    let digits = sanitizeDigits(trimmed);
    if (!digits) return "";
    if (digits.startsWith("00") && digits.length > 7) {
      digits = digits.slice(2);
    } else if (!hasPlus && digits.startsWith("0") && digits.length >= 8 && digits.length <= 12) {
      digits = digits.slice(1);
    }
    const isd = sanitizeDigits(state.isdDigits || "91");
    if (!hasPlus && isd) {
      if (digits.length === 10 || (isd.length >= 1 && digits.length <= 10 && !digits.startsWith(isd))) {
        digits = isd + digits;
      }
    }
    if (digits.length < 7 || digits.length > 15) return "";
    return digits;
  }

  function setError(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
    setVisible(el, Boolean(msg));
  }

  function setNotice(msg) {
    if (!els.csvNotice) return;
    els.csvNotice.textContent = msg || "";
    setVisible(els.csvNotice, Boolean(msg));
  }

  // =========================================================================
  // Chrome Messaging & Auto-Injection Recovery
  // =========================================================================

  function sendTabMessage(tabId, subject, data = {}) {
    return new Promise((resolve) => {
      const msg = typeof subject === "object" && subject !== null
        ? Object.assign({ from: "popup.js", subject: subject.subject || subject.type }, subject)
        : { from: "popup.js", subject, data };
      try {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ __error: chrome.runtime.lastError.message });
          } else {
            resolve(resp === undefined ? {} : resp);
          }
        });
      } catch (err) {
        resolve({ __error: err.message || String(err) });
      }
    });
  }

  function sendRuntimeMessage(subject, data = {}, extra = {}) {
    return new Promise((resolve) => {
      const msg = typeof subject === "object" && subject !== null
        ? Object.assign({ from: "popup.js", subject: subject.subject || subject.type }, subject)
        : Object.assign({ from: "popup.js", subject, data }, extra);
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ __error: chrome.runtime.lastError.message });
          } else {
            resolve(resp === undefined ? {} : resp);
          }
        });
      } catch (err) {
        resolve({ __error: err.message || String(err) });
      }
    });
  }

  async function findWhatsAppTab() {
    try {
      const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
      if (!tabs || tabs.length === 0) return null;
      const activeCurrent = tabs.find((t) => t.active);
      return activeCurrent || tabs[0];
    } catch (_) {
      return null;
    }
  }

  async function ensureContentScriptOnWhatsApp(tabId) {
    if (!tabId) return null;
    let resp = await sendTabMessage(tabId, MSG_GET_PAGE_URL);
    if (resp && !resp.__error) return resp;

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["attach_bridge.js"],
        world: "MAIN"
      });
    } catch (_) {}

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["shared.js", "content.js"]
      });
    } catch (err) {
      return { __error: err.message || String(err) };
    }

    await new Promise((r) => setTimeout(r, 120));
    resp = await sendTabMessage(tabId, MSG_GET_PAGE_URL);
    return resp;
  }

  async function refreshWhatsAppStatus() {
    const waTab = await findWhatsAppTab();
    if (!waTab) {
      state.waTabId = null;
      state.waConnected = false;
      state.waQR = false;
      renderConnectionState();
      return;
    }
    state.waTabId = waTab.id;
    const ping = await ensureContentScriptOnWhatsApp(waTab.id);
    if (!ping || ping.__error) {
      state.waConnected = false;
      state.waQR = false;
    } else {
      const statusResp = await sendTabMessage(waTab.id, MSG_GET_MESSAGE_RESULTS);
      if (statusResp && !statusResp.__error) {
        state.waConnected = Boolean(statusResp.loggedIn);
        state.waQR = !state.waConnected;
      } else {
        state.waConnected = false;
        state.waQR = false;
      }
    }
    renderConnectionState();
  }

  function renderConnectionState() {
    if (els.statusPill && els.statusText) {
      els.statusPill.classList.remove("connected", "qr");
      if (state.waTabId && state.waConnected) {
        els.statusPill.classList.add("connected");
        els.statusText.textContent = "WhatsApp Ready";
      } else if (state.waTabId && state.waQR) {
        els.statusPill.classList.add("qr");
        els.statusText.textContent = "Scan QR to Login";
      } else if (state.waTabId) {
        els.statusPill.classList.add("qr");
        els.statusText.textContent = "WhatsApp Loading";
      } else {
        els.statusText.textContent = "Not Connected";
      }
    }

    const hasWa = Boolean(state.waTabId);
    setVisible(els.clearAllBtn, hasWa);
    setVisible(els.launchView, !hasWa && state.activeNav === "sender");
    setVisible(els.senderWorkspace, hasWa && state.activeNav === "sender");
    setVisible(els.featuresWorkspace, state.activeNav === "features");
  }

  // =========================================================================
  // Navigation & Clear All & Popout
  // =========================================================================

  function switchMainNav(nav) {
    state.activeNav = nav === "features" ? "features" : "sender";
    if (els.navSenderBtn) els.navSenderBtn.classList.toggle("active", state.activeNav === "sender");
    if (els.navFeaturesBtn) els.navFeaturesBtn.classList.toggle("active", state.activeNav === "features");
    if (state.activeNav === "features") {
      renderReportsHistory();
      storage.getReportsHistory().then((latest) => {
        state.reportsHistory = Array.isArray(latest) ? latest : [];
        if (state.activeNav === "features") renderReportsHistory();
      });
    }
    renderConnectionState();
  }

  async function openOrFocusWhatsApp() {
    if (!isWindowMode) {
      await sendRuntimeMessage(MSG_SUPPRESS_AUTO_CLOSE, {}, { ms: 3000 });
    }
    const existing = await findWhatsAppTab();
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      await refreshWhatsAppStatus();
    } else {
      await chrome.tabs.create({ url: "https://web.whatsapp.com/", active: true });
    }
  }

  async function handlePopout() {
    await sendRuntimeMessage(MSG_SUPPRESS_AUTO_CLOSE, {}, { ms: 2500 });
    const url = chrome.runtime.getURL("popup.html?mode=window");
    chrome.windows.create({
      url,
      type: "popup",
      width: 810,
      height: 645
    });
    if (!isWindowMode) {
      window.close();
    }
  }

  async function handleClearAll() {
    setError(els.actionError, "");
    setError(els.csvError, "");
    setError(els.attachmentError, "");
    setNotice("");

    state.manualNumbers = [];
    state.csvFileData = null;
    state.csvFileName = "";
    state.phoneColumnIndex = 0;
    state.selectedAudiences = [];
    state.selectedContacts = [];
    state.selectedListIds = [];
    state.attachment = null;
    state.latestResults = [];
    if (els.messageInput) els.messageInput.value = "";
    if (els.numberTextInput) els.numberTextInput.value = "";

    await Promise.all([
      storage.savePhoneNumbersBulk(""),
      storage.saveCurrentMessageBulk(""),
      storage.saveCSVFileData(null),
      storage.saveFileName(""),
      storage.savePhoneColumnNumber(0),
      storage.saveSelectedAudiences([]),
      storage.saveSelectedContacts([]),
      storage.clearAttachmentData(),
      storage.clearPendingCSV()
    ]);

    renderNumbersPanel();
    renderAudiencesPanel();
    renderContactsPanel();
    renderListsPanel();
    renderComposer();
    renderAttachment();
    updateRecipientCounters();
  }

  // =========================================================================
  // Recipient Sources
  // =========================================================================

  async function switchRecipientSource(src) {
    const valid = ["numbers", "audiences", "contacts", "lists"];
    state.recipientSource = valid.includes(src) ? src : "numbers";
    await storage.saveRecipientSource(state.recipientSource);

    const map = [
      ["numbers", els.srcNumbersBtn, els.panelNumbers],
      ["audiences", els.srcAudiencesBtn, els.panelAudiences],
      ["contacts", els.srcContactsBtn, els.panelContacts],
      ["lists", els.srcListsBtn, els.panelLists]
    ];
    for (const [key, btn, panel] of map) {
      const on = key === state.recipientSource;
      if (btn) btn.classList.toggle("active", on);
      setVisible(panel, on);
    }

    if (state.recipientSource === "audiences" && state.allAudiences.length === 0) {
      await fetchAudiencesFromWA();
    } else if (state.recipientSource === "contacts" && state.allContacts.length === 0) {
      await fetchContactsFromWA();
    }
    renderVariableChips();
    updateRecipientCounters();
  }

  // --- Numbers Source ---
  function initIsdInput() {
    if (!els.isdCode) return;
    if (typeof window.intlTelInput === "function") {
      try {
        itiInstance = window.intlTelInput(els.isdCode, {
          initialCountry: state.iso2 || "in",
          separateDialCode: false,
          nationalMode: false,
          autoPlaceholder: "off",
          utilsScript: ""
        });
        els.isdCode.value = `+${state.isdDigits || "91"}`;
        els.isdCode.addEventListener("countrychange", () => {
          const data = itiInstance.getSelectedCountryData();
          if (data && data.dialCode) {
            state.isdDigits = sanitizeDigits(data.dialCode);
            state.iso2 = data.iso2 || state.iso2;
            els.isdCode.value = `+${state.isdDigits}`;
            storage.saveBulkMsgCountryCode(state.isdDigits);
            storage.saveISO2CountryCode(state.iso2);
          }
        });
      } catch (_) {
        els.isdCode.value = `+${state.isdDigits || "91"}`;
      }
    } else {
      els.isdCode.value = `+${state.isdDigits || "91"}`;
    }

    els.isdCode.addEventListener("input", () => {
      const d = sanitizeDigits(els.isdCode.value);
      if (d) {
        state.isdDigits = d;
        storage.saveBulkMsgCountryCode(d);
      }
    });
  }

  function addManualTokens(rawText) {
    setError(els.csvError, "");
    const parts = String(rawText || "")
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;

    const existing = new Set(state.manualNumbers);
    let added = 0;
    let invalidCount = 0;
    for (const part of parts) {
      const normalized = normalizePhoneWithIsd(part);
      if (!normalized) {
        invalidCount++;
        continue;
      }
      if (!existing.has(normalized)) {
        existing.add(normalized);
        state.manualNumbers.push(normalized);
        added++;
      }
    }
    if (invalidCount > 0 && added === 0) {
      setError(els.csvError, "Enter valid phone numbers (7 to 15 digits).");
    }
    storage.savePhoneNumbersBulk(state.manualNumbers.join(","));
    renderNumbersPanel();
    updateRecipientCounters();
  }

  function removeManualNumber(num) {
    state.manualNumbers = state.manualNumbers.filter((n) => n !== num);
    storage.savePhoneNumbersBulk(state.manualNumbers.join(","));
    renderNumbersPanel();
    updateRecipientCounters();
  }

  function renderNumbersPanel() {
    const hasCsv = Boolean(state.csvFileData && Array.isArray(state.csvFileData.rows) && state.csvFileData.rows.length > 0);
    setVisible(els.manualRecipientsWrap, !hasCsv);
    setVisible(els.csvSummaryBar, hasCsv);

    if (hasCsv) {
      if (els.csvFileName) els.csvFileName.textContent = state.csvFileName || "recipients.csv";
      if (els.phoneColumnSelect) {
        const headers = state.csvFileData.headers || [];
        els.phoneColumnSelect.innerHTML = "";
        headers.forEach((h, idx) => {
          const opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = h || `Column ${idx + 1}`;
          els.phoneColumnSelect.appendChild(opt);
        });
        if (state.phoneColumnIndex >= headers.length) state.phoneColumnIndex = 0;
        els.phoneColumnSelect.value = String(state.phoneColumnIndex);
      }
    } else if (els.chipsContainer) {
      // B15: Cap chip rendering at 100 visible chips for DOM performance with large lists (1000+ rows)
      const MAX_VISIBLE_CHIPS = 100;
      els.chipsContainer.querySelectorAll(".aura-chip, .aura-chip-overflow").forEach((el) => el.remove());
      const numsToRender = state.manualNumbers.slice(0, MAX_VISIBLE_CHIPS);
      const overflow = state.manualNumbers.length - numsToRender.length;
      for (const num of numsToRender) {
        const chip = document.createElement("span");
        chip.className = "aura-chip";
        const label = document.createElement("span");
        label.textContent = `+${num}`;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "aura-chip-remove";
        del.setAttribute("aria-label", `Remove ${num}`);
        del.textContent = "×";
        del.addEventListener("click", () => removeManualNumber(num));
        chip.appendChild(label);
        chip.appendChild(del);
        if (els.numberTextInput && els.numberTextInput.parentElement === els.chipsContainer) {
          els.chipsContainer.insertBefore(chip, els.numberTextInput);
        } else {
          els.chipsContainer.appendChild(chip);
        }
      }
      if (overflow > 0) {
        const badge = document.createElement("span");
        badge.className = "aura-chip aura-chip-overflow";
        badge.title = `${overflow} more numbers not shown (use CSV for large lists)`;
        badge.textContent = `+${overflow} more`;
        if (els.numberTextInput && els.numberTextInput.parentElement === els.chipsContainer) {
          els.chipsContainer.insertBefore(badge, els.numberTextInput);
        } else {
          els.chipsContainer.appendChild(badge);
        }
      }
    }
    renderVariableChips();
  }

  // --- Offline CSV & OOXML (.xlsx) Parsing ---
  function looksLikeHeaderRow(cells) {
    if (!cells || !cells.length) return false;
    const joined = cells.map((c) => String(c || "").trim()).filter(Boolean);
    if (!joined.length) return false;
    return joined.some((c) => /[a-zA-Z]/.test(c));
  }

  function detectPhoneColumn(headers, rows) {
    const keywordRe = /^(phone|mobile|cell|whatsapp|wa|number|tel|telephone|contact|msisdn)$/i;
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || "").trim().replace(/[^a-zA-Z0-9]/g, "");
      if (keywordRe.test(h)) return i;
    }
    for (let i = 0; i < headers.length; i++) {
      if (/phone|mobile|number|whatsapp/i.test(String(headers[i] || ""))) return i;
    }
    for (let c = 0; c < headers.length; c++) {
      let matches = 0;
      const sample = rows.slice(0, 5);
      for (const r of sample) {
        const d = sanitizeDigits(r[c]);
        if (d.length >= 7 && d.length <= 15) matches++;
      }
      if (sample.length > 0 && matches === sample.length) return c;
    }
    return 0;
  }

  function buildSpreadsheetDataset(rawMatrix) {
    const cleanRows = (rawMatrix || [])
      .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []))
      .filter((row) => row.some((cell) => cell.length > 0));

    if (!cleanRows.length) {
      throw new Error("The selected spreadsheet is empty.");
    }

    const colCount = Math.max(...cleanRows.map((r) => r.length));
    let headers;
    let dataRows;
    if (cleanRows.length > 1 && looksLikeHeaderRow(cleanRows[0])) {
      headers = Array.from({ length: colCount }, (_, i) => cleanRows[0][i] || `Column ${i + 1}`);
      dataRows = cleanRows.slice(1);
    } else if (cleanRows.length === 1 && looksLikeHeaderRow(cleanRows[0])) {
      throw new Error("Spreadsheet has headers only and no recipient rows.");
    } else {
      headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
      dataRows = cleanRows;
    }

    const normalizedRows = dataRows.map((r) =>
      Array.from({ length: colCount }, (_, i) => String(r[i] ?? "").trim())
    );

    return { headers, rows: normalizedRows };
  }

  function parseCsvText(csvText) {
    const stripped = String(csvText || "").replace(/^\uFEFF/, "");
    if (typeof Papa !== "undefined" && typeof Papa.parse === "function") {
      const res = Papa.parse(stripped, { skipEmptyLines: "greedy" });
      return buildSpreadsheetDataset(res.data || []);
    }
    const lines = stripped.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const matrix = lines.map((line) => line.split(",").map((c) => c.trim()));
    return buildSpreadsheetDataset(matrix);
  }

  function colLettersToIndex(ref) {
    const letters = String(ref || "").replace(/[^A-Z]/gi, "").toUpperCase();
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return Math.max(0, idx - 1);
  }

  async function inflateDeflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("DecompressionStream is unavailable for .xlsx files in this browser.");
    }
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function unzipOoxmlEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let eocdPos = -1;
    const minPos = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos < 0) {
      throw new Error("Invalid .xlsx archive (missing End of Central Directory).");
    }

    const totalEntries = view.getUint16(eocdPos + 10, true);
    const cdOffset = view.getUint32(eocdPos + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder("utf-8");
    let pos = cdOffset;

    for (let i = 0; i < totalEntries && pos + 46 <= bytes.length; i++) {
      if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4b || bytes[pos + 2] !== 0x01 || bytes[pos + 3] !== 0x02) {
        break;
      }
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);

      const fileName = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      pos += 46 + nameLen + extraLen + commentLen;

      if (fileName.endsWith("/")) continue;
      if (localOffset + 30 > bytes.length) continue;
      if (bytes[localOffset] !== 0x50 || bytes[localOffset + 1] !== 0x4b || bytes[localOffset + 2] !== 0x03 || bytes[localOffset + 3] !== 0x04) {
        continue;
      }
      const lfNameLen = view.getUint16(localOffset + 26, true);
      const lfExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lfNameLen + lfExtraLen;
      const compSlice = bytes.subarray(dataStart, dataStart + compSize);

      entries.set(fileName, async () => {
        if (method === 0) return decoder.decode(compSlice);
        if (method === 8) {
          const out = await inflateDeflateRaw(compSlice);
          return decoder.decode(out);
        }
        throw new Error(`Unsupported .xlsx compression method (${method}).`);
      });
    }

    return entries;
  }

  async function parseXlsxBuffer(arrayBuffer) {
    const entries = await unzipOoxmlEntries(arrayBuffer);
    const parser = new DOMParser();

    const sharedStrings = [];
    const ssLoader = entries.get("xl/sharedStrings.xml");
    if (ssLoader) {
      const ssXml = await ssLoader();
      const ssDoc = parser.parseFromString(ssXml, "application/xml");
      const sis = ssDoc.getElementsByTagName("si");
      for (let i = 0; i < sis.length; i++) {
        const ts = sis[i].getElementsByTagName("t");
        let combined = "";
        for (let j = 0; j < ts.length; j++) {
          combined += ts[j].textContent || "";
        }
        sharedStrings.push(combined);
      }
    }

    let sheetKey = entries.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : null;
    if (!sheetKey) {
      for (const k of entries.keys()) {
        if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(k)) {
          sheetKey = k;
          break;
        }
      }
    }
    if (!sheetKey) {
      throw new Error("No worksheet found inside .xlsx file.");
    }

    const sheetXml = await entries.get(sheetKey)();
    const sheetDoc = parser.parseFromString(sheetXml, "application/xml");
    const rowNodes = sheetDoc.getElementsByTagName("row");
    const matrix = [];

    for (let r = 0; r < rowNodes.length; r++) {
      const rowArr = [];
      const cells = rowNodes[r].getElementsByTagName("c");
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        const ref = cell.getAttribute("r") || "";
        const colIdx = ref ? colLettersToIndex(ref) : c;
        const type = cell.getAttribute("t") || "";
        let value = "";
        if (type === "inlineStr") {
          const ts = cell.getElementsByTagName("t");
          for (let j = 0; j < ts.length; j++) value += ts[j].textContent || "";
        } else {
          const vNode = cell.getElementsByTagName("v")[0];
          const rawVal = vNode ? (vNode.textContent || "") : "";
          if (type === "s") {
            const idx = parseInt(rawVal, 10);
            value = Number.isFinite(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : "";
          } else {
            value = rawVal;
          }
        }
        rowArr[colIdx] = value;
      }
      matrix.push(rowArr);
    }

    return buildSpreadsheetDataset(matrix);
  }

  function base64ToArrayBuffer(b64) {
    const clean = String(b64 || "").replace(/^data:[^;]+;base64,/, "");
    const bin = atob(clean);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function applyImportedSpreadsheet(rawInput) {
    setError(els.csvError, "");
    setNotice("");
    let parsedInput = rawInput;
    if (typeof rawInput === "string") {
      try {
        parsedInput = JSON.parse(rawInput);
      } catch (_) {
        parsedInput = { csvText: rawInput };
      }
    }
    const { name: rawName, fileName, csvText, base64Data, arrayBuffer } = parsedInput || {};
    const name = fileName || rawName || "recipients.csv";
    try {
      let dataset;
      if (/\.xlsx$/i.test(name)) {
        const buf = arrayBuffer || base64ToArrayBuffer(base64Data);
        dataset = await parseXlsxBuffer(buf);
      } else {
        const text =
          csvText ||
          (arrayBuffer
            ? new TextDecoder("utf-8").decode(arrayBuffer)
            : new TextDecoder("utf-8").decode(base64ToArrayBuffer(base64Data)));
        dataset = parseCsvText(text);
      }
      state.csvFileData = dataset;
      state.csvFileName = name;
      state.phoneColumnIndex = detectPhoneColumn(dataset.headers, dataset.rows);

      await Promise.all([
        storage.saveCSVFileData(dataset),
        storage.saveFileName(name),
        storage.savePhoneColumnNumber(state.phoneColumnIndex),
        storage.clearPendingCSV()
      ]);

      renderNumbersPanel();
      renderPreviewBubble();
      updateRecipientCounters();
      setNotice(`Loaded ${dataset.rows.length} rows from ${name}.`);
    } catch (err) {
      setError(els.csvError, err.message || "Failed to parse spreadsheet.");
    }
  }

  function downloadExampleCsv() {
    const csv = "Phone,Name,OrderID,City\n919876543210,Aarav Sharma,ORD-1042,Bengaluru\n919812345678,Meera Nair,ORD-1043,Mumbai\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aura_example_recipients.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function triggerCsvImport() {
    setError(els.csvError, "");
    if (!isWindowMode && state.waTabId) {
      setNotice("Opening file picker on WhatsApp Web...");
      const resp = await sendTabMessage(state.waTabId, MSG_PICK_CSV);
      if (resp && (resp.csvText || resp.base64Data)) {
        await applyImportedSpreadsheet(resp);
        return;
      }
      if (resp && resp.ok) {
        try {
          const tab = await chrome.tabs.get(state.waTabId);
          await chrome.tabs.update(state.waTabId, { active: true });
          if (tab && tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
        } catch (_) {}
        setNotice("Choose your CSV or Excel file in the WhatsApp Web picker, then reopen Aura.");
        return;
      }
    }
    if (els.csvFileInput) {
      els.csvFileInput.value = "";
      els.csvFileInput.click();
    }
  }

  // --- Audiences Source (Groups & Chats) ---
  async function fetchAudiencesFromWA() {
    if (!state.waTabId) return;
    if (els.audiencesList) {
      els.audiencesList.innerHTML = `<div class="aura-list-empty">Loading WhatsApp groups &amp; chats...</div>`;
    }
    const resp = await sendTabMessage(state.waTabId, MSG_GET_CHATS_AND_GROUPS);
    const rawItems = Array.isArray(resp && resp.items) ? resp.items : Array.isArray(resp && resp.audiences) ? resp.audiences : null;
    if (rawItems) {
      state.allAudiences = rawItems.map((it) => ({
        title: String(it.title || it.name || "").trim(),
        kind: it.kind || (it.isGroup ? "group" : "chat")
      })).filter((it) => Boolean(it.title));
      await storage.saveAllAudiences(state.allAudiences);
    } else if (resp && resp.__error) {
      if (els.audiencesList) {
        els.audiencesList.innerHTML = `<div class="aura-list-empty">Could not read chats. Ensure WhatsApp Web is loaded and logged in.</div>`;
      }
      return;
    }
    renderAudiencesPanel();
    updateRecipientCounters();
  }

  function renderAudiencesPanel() {
    if (!els.selectedAudiencesTray || !els.audiencesList) return;

    els.selectedAudiencesTray.innerHTML = "";
    if (!state.selectedAudiences.length) {
      const empty = document.createElement("span");
      empty.className = "aura-tray-empty";
      empty.textContent = "Nothing to show!";
      els.selectedAudiencesTray.appendChild(empty);
    } else {
      state.selectedAudiences.forEach((aud) => {
        const chip = document.createElement("span");
        chip.className = "aura-chip";
        const span = document.createElement("span");
        span.textContent = aud.title;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "aura-chip-remove";
        del.textContent = "×";
        del.addEventListener("click", () => toggleAudienceSelection(aud, false));
        chip.appendChild(span);
        chip.appendChild(del);
        els.selectedAudiencesTray.appendChild(chip);
      });
    }

    const q = (els.audienceSearchInput ? els.audienceSearchInput.value : "").trim().toLowerCase();
    const filtered = state.allAudiences.filter((a) => !q || String(a.title || "").toLowerCase().includes(q));
    const selectedSet = new Set(state.selectedAudiences.map((a) => a.title));

    els.audiencesList.innerHTML = "";
    if (!filtered.length) {
      els.audiencesList.innerHTML = `<div class="aura-list-empty">${
        state.allAudiences.length ? "No matching groups or chats." : "Click Refresh to load active chats &amp; groups from WhatsApp Web."
      }</div>`;
    } else {
      const frag = document.createDocumentFragment();
      for (const item of filtered) {
        const row = document.createElement("label");
        row.className = "aura-pick-row";

        const left = document.createElement("span");
        left.className = "aura-pick-left";
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = selectedSet.has(item.title);
        chk.addEventListener("change", () => toggleAudienceSelection(item, chk.checked));
        const nameSpan = document.createElement("span");
        nameSpan.className = "aura-pick-name";
        nameSpan.textContent = item.title;
        left.appendChild(chk);
        left.appendChild(nameSpan);

        const kindTag = document.createElement("span");
        const isGroup = /group/i.test(item.kind || "");
        kindTag.className = `aura-pick-kind${isGroup ? " group" : ""}`;
        kindTag.textContent = isGroup ? "Group" : "Chat";

        row.appendChild(left);
        row.appendChild(kindTag);
        frag.appendChild(row);
      }
      els.audiencesList.appendChild(frag);
    }

    if (els.selectAllAudiencesChk) {
      els.selectAllAudiencesChk.checked =
        filtered.length > 0 && filtered.every((a) => selectedSet.has(a.title));
    }

    if (els.savedAudiencesSelect) {
      const currentVal = els.savedAudiencesSelect.value;
      els.savedAudiencesSelect.innerHTML = `
        <option value="">Saved Audiences</option>
        <option value="__save__">+ Save Current Selection...</option>
      `;
      state.savedAudiences.forEach((sa) => {
        const opt = document.createElement("option");
        opt.value = sa.name;
        opt.textContent = `${sa.name} (${(sa.items || []).length})`;
        els.savedAudiencesSelect.appendChild(opt);
      });
      if (currentVal && Array.from(els.savedAudiencesSelect.options).some((o) => o.value === currentVal)) {
        els.savedAudiencesSelect.value = currentVal;
      } else {
        els.savedAudiencesSelect.value = "";
      }
    }
  }

  async function toggleAudienceSelection(aud, checked) {
    const map = new Map(state.selectedAudiences.map((a) => [a.title, a]));
    if (checked) map.set(aud.title, { title: aud.title, kind: aud.kind || "chat" });
    else map.delete(aud.title);
    state.selectedAudiences = Array.from(map.values());
    await storage.saveSelectedAudiences(state.selectedAudiences);
    renderAudiencesPanel();
    updateRecipientCounters();
  }

  // --- Contacts Source ---
  async function fetchContactsFromWA() {
    if (!state.waTabId) return;
    if (els.contactsList) {
      els.contactsList.innerHTML = `<div class="aura-list-empty">Loading WhatsApp contacts...</div>`;
    }
    const resp = await sendTabMessage(state.waTabId, MSG_GET_CONTACTS);
    const rawItems = Array.isArray(resp && resp.items) ? resp.items : Array.isArray(resp && resp.contacts) ? resp.contacts : null;
    if (rawItems) {
      state.allContacts = rawItems.map((c) => ({
        name: String(c.name || c.title || "").trim(),
        phone: String(c.phone || c.phoneNumber || "").trim()
      })).filter((c) => Boolean(c.name || c.phone));
      await storage.saveAllContacts(state.allContacts);
    } else if (resp && resp.__error) {
      if (els.contactsList) {
        els.contactsList.innerHTML = `<div class="aura-list-empty">Could not read contacts from WhatsApp Web.</div>`;
      }
      return;
    }
    renderContactsPanel();
    updateRecipientCounters();
  }

  function renderContactsPanel() {
    if (!els.contactsList) return;
    const q = (els.contactSearchInput ? els.contactSearchInput.value : "").trim().toLowerCase();
    const filtered = state.allContacts.filter((c) => {
      if (!q) return true;
      return String(c.name || "").toLowerCase().includes(q) || String(c.phone || "").toLowerCase().includes(q);
    });
    const selectedKeys = new Set(state.selectedContacts.map((c) => c.phone || c.name));

    els.contactsList.innerHTML = "";
    if (!filtered.length) {
      els.contactsList.innerHTML = `<div class="aura-list-empty">${
        state.allContacts.length ? "No matching contacts." : "Click Refresh to load contacts from WhatsApp Web."
      }</div>`;
    } else {
      const frag = document.createDocumentFragment();
      for (const item of filtered) {
        const key = item.phone || item.name;
        const row = document.createElement("label");
        row.className = "aura-pick-row";
        const left = document.createElement("span");
        left.className = "aura-pick-left";
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = selectedKeys.has(key);
        chk.addEventListener("change", () => toggleContactSelection(item, chk.checked));
        const nameSpan = document.createElement("span");
        nameSpan.className = "aura-pick-name";
        nameSpan.textContent = item.phone && item.name !== item.phone ? `${item.name} (+${item.phone})` : item.name;
        left.appendChild(chk);
        left.appendChild(nameSpan);
        row.appendChild(left);
        frag.appendChild(row);
      }
      els.contactsList.appendChild(frag);
    }

    if (els.selectAllContactsChk) {
      els.selectAllContactsChk.checked =
        filtered.length > 0 && filtered.every((c) => selectedKeys.has(c.phone || c.name));
    }
  }

  async function toggleContactSelection(item, checked) {
    const keyFn = (c) => c.phone || c.name;
    const map = new Map(state.selectedContacts.map((c) => [keyFn(c), c]));
    if (checked) map.set(keyFn(item), { name: item.name, phone: item.phone || "" });
    else map.delete(keyFn(item));
    state.selectedContacts = Array.from(map.values());
    await storage.saveSelectedContacts(state.selectedContacts);
    renderContactsPanel();
    updateRecipientCounters();
  }

  // --- Lists Source ---
  function renderListsPanel() {
    if (!els.savedListsContainer) return;
    els.savedListsContainer.innerHTML = "";
    if (!state.savedLists.length) {
      els.savedListsContainer.innerHTML = `<div class="aura-list-empty">No saved recipient lists yet. Add numbers or import Excel/CSV and click <strong>Save Current</strong>.</div>`;
      return;
    }

    const selectedIds = new Set(state.selectedListIds);
    for (const list of state.savedLists) {
      const row = document.createElement("div");
      row.className = "aura-pick-row";

      const left = document.createElement("label");
      left.className = "aura-pick-left";
      left.style.cursor = "pointer";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = selectedIds.has(list.id);
      chk.addEventListener("change", () => {
        if (chk.checked) {
          if (!state.selectedListIds.includes(list.id)) state.selectedListIds.push(list.id);
        } else {
          state.selectedListIds = state.selectedListIds.filter((id) => id !== list.id);
        }
        updateRecipientCounters();
      });
      const nameSpan = document.createElement("span");
      nameSpan.className = "aura-pick-name";
      nameSpan.textContent = `${list.name} (${(list.numbers || []).length})`;
      left.appendChild(chk);
      left.appendChild(nameSpan);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "5px";
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "aura-link-btn";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", async () => {
        state.manualNumbers = Array.from(new Set([...state.manualNumbers, ...(list.numbers || [])]));
        state.csvFileData = null;
        state.csvFileName = "";
        await Promise.all([
          storage.savePhoneNumbersBulk(state.manualNumbers.join(",")),
          storage.saveCSVFileData(null),
          storage.saveFileName("")
        ]);
        renderNumbersPanel();
        await switchRecipientSource("numbers");
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "aura-link-btn danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        state.savedLists = state.savedLists.filter((l) => l.id !== list.id);
        state.selectedListIds = state.selectedListIds.filter((id) => id !== list.id);
        await storage.saveSavedLists(state.savedLists);
        renderListsPanel();
        updateRecipientCounters();
      });

      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);
      row.appendChild(left);
      row.appendChild(actions);
      els.savedListsContainer.appendChild(row);
    }
  }

  // =========================================================================
  // Target Builder & Counters
  // =========================================================================

  function resolveMessageVariables(templateText, rowObj) {
    return String(templateText || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, key) => {
      const k = key.trim();
      if (rowObj && Object.prototype.hasOwnProperty.call(rowObj, k)) {
        return rowObj[k];
      }
      if (rowObj) {
        const lower = k.toLowerCase();
        for (const [colName, val] of Object.entries(rowObj)) {
          if (colName.toLowerCase() === lower) return val;
        }
      }
      return "";
    });
  }

  function buildDispatchPayload() {
    const rawMsg = els.messageInput ? els.messageInput.value : "";
    const targets = [];
    const numbers = [];
    const messages = [];

    if (state.recipientSource === "numbers") {
      if (state.csvFileData && state.csvFileData.rows.length > 0) {
        const headers = state.csvFileData.headers || [];
        const colIdx = state.phoneColumnIndex || 0;
        const seen = new Set();
        for (const row of state.csvFileData.rows) {
          const norm = normalizePhoneWithIsd(row[colIdx]);
          if (!norm || seen.has(norm)) continue;
          seen.add(norm);
          const rowMap = {};
          headers.forEach((h, i) => {
            rowMap[h] = String(row[i] ?? "");
          });
          targets.push({ kind: "phone", value: norm, label: norm });
          numbers.push(norm);
          messages.push(resolveMessageVariables(rawMsg, rowMap));
        }
      } else {
        for (const num of state.manualNumbers) {
          targets.push({ kind: "phone", value: num, label: num });
          numbers.push(num);
          messages.push(rawMsg);
        }
      }
    } else if (state.recipientSource === "audiences") {
      for (const aud of state.selectedAudiences) {
        targets.push({ kind: "chat", value: aud.title, label: aud.title });
        numbers.push(aud.title);
        messages.push(resolveMessageVariables(rawMsg, { Name: aud.title }));
      }
    } else if (state.recipientSource === "contacts") {
      for (const c of state.selectedContacts) {
        const kind = c.phone ? "phone" : "chat";
        const val = c.phone || c.name;
        const label = c.name || c.phone;
        targets.push({ kind, value: val, label });
        numbers.push(val);
        messages.push(resolveMessageVariables(rawMsg, { Name: label, Phone: c.phone || "" }));
      }
    } else if (state.recipientSource === "lists") {
      const seen = new Set();
      for (const list of state.savedLists) {
        if (!state.selectedListIds.includes(list.id)) continue;
        for (const num of list.numbers || []) {
          const norm = normalizePhoneWithIsd(num);
          if (!norm || seen.has(norm)) continue;
          seen.add(norm);
          targets.push({ kind: "phone", value: norm, label: norm });
          numbers.push(norm);
          messages.push(resolveMessageVariables(rawMsg, { Phone: norm }));
        }
      }
    }

    const useTimeGap = Boolean(state.campaignOptions.useTimeGap);
    const minGap = Math.max(1, parseInt(state.campaignOptions.minGapSec, 10) || 5);
    const maxGap = Math.max(minGap, parseInt(state.campaignOptions.maxGapSec, 10) || minGap);
    const useBatch = Boolean(state.campaignOptions.useBatching);

    // B14: Warn on cross-source duplicates (manual number already in CSV or lists)
    // Surface as a non-blocking notice so user is aware but campaign still runs
    const finalNums = new Set(numbers);
    if (finalNums.size < numbers.length && els.csvNotice) {
      setNotice(`⚠ ${numbers.length - finalNums.size} duplicate number(s) removed from campaign targets.`);
    }

    return {
      targets,
      numbers,
      messages,
      message: rawMsg,
      minGapSec: useTimeGap ? minGap : 3,
      maxGapSec: useTimeGap ? maxGap : 5,
      batchSize: useBatch ? Math.max(1, parseInt(state.campaignOptions.batchSize, 10) || 25) : 0,
      batchPauseSec: useBatch ? Math.max(5, parseInt(state.campaignOptions.batchPauseSec, 10) || 30) : 0,
      useAttachment: Boolean(state.attachment && (state.attachment.dataUrl || state.attachment.base64Data))
    };
  }

  function updateRecipientCounters() {
    const numCount =
      state.csvFileData && state.csvFileData.rows.length > 0
        ? state.csvFileData.rows.length
        : state.manualNumbers.length;
    if (els.recipientCountBadge) els.recipientCountBadge.textContent = String(numCount);
    if (els.audienceCountBadge) els.audienceCountBadge.textContent = String(state.selectedAudiences.length);
    if (els.contactsCountBadge) els.contactsCountBadge.textContent = String(state.selectedContacts.length);

    const payload = buildDispatchPayload();
    const total = payload.targets.length;
    const hasContent = Boolean(payload.message.trim() || payload.useAttachment);
    const hasPhones = payload.targets.some((t) => t.kind === "phone");

    if (els.sendCampaignBtn) {
      els.sendCampaignBtn.disabled = !(total > 0 && hasContent);
    }
    if (els.checkNumbersBtn) {
      els.checkNumbersBtn.disabled = !hasPhones;
    }
    if (els.sendCampaignLabel) {
      if (els.optSchedule && els.optSchedule.checked) {
        els.sendCampaignLabel.textContent = total > 0 ? `Schedule (${total})` : "Schedule";
      } else {
        els.sendCampaignLabel.textContent = total > 0 ? `Send (${total})` : "Send";
      }
    }
  }

  // =========================================================================
  // Message Composer, Formatting, Preview, Variables, Templates, Attachments
  // =========================================================================

  function insertAtCursor(textarea, insertion) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const val = textarea.value;
    textarea.value = val.slice(0, start) + insertion + val.slice(end);
    const nextPos = start + insertion.length;
    textarea.focus();
    textarea.setSelectionRange(nextPos, nextPos);
    onMessageChanged();
  }

  function wrapSelection(marker) {
    const ta = els.messageInput;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = ta.value.slice(start, end);
    const wrapped = selected ? `${marker}${selected}${marker}` : `${marker}text${marker}`;
    ta.value = ta.value.slice(0, start) + wrapped + ta.value.slice(end);
    const selStart = start + marker.length;
    const selEnd = selected ? start + wrapped.length - marker.length : selStart + 4;
    ta.focus();
    ta.setSelectionRange(selStart, selEnd);
    onMessageChanged();
  }

  function formatWhatsAppPreviewHtml(text) {
    let html = escapeHtml(text || "");
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
    html = html.replace(/_([^_\n]+)_/g, "<em>$1</em>");
    html = html.replace(/~([^~\n]+)~/g, "<del>$1</del>");
    return html.replace(/\n/g, "<br>") || "Empty message";
  }

  function renderVariableChips() {
    if (!els.variableChipsWrap || !els.variableChipsList) return;
    const hasHeaders = Boolean(state.csvFileData && state.csvFileData.headers && state.csvFileData.headers.length);
    const showVars = state.recipientSource === "numbers" && hasHeaders;
    setVisible(els.variableChipsWrap, showVars);

    if (els.previewToggleBtn) {
      const hasMsg = Boolean(els.messageInput && els.messageInput.value.trim());
      setVisible(els.previewToggleBtn, hasHeaders || hasMsg);
    }

    if (!showVars) return;
    els.variableChipsList.innerHTML = "";
    state.csvFileData.headers.forEach((hdr) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aura-var-chip";
      btn.textContent = `{{${hdr}}}`;
      btn.addEventListener("click", () => insertAtCursor(els.messageInput, `{{${hdr}}}`));
      els.variableChipsList.appendChild(btn);
    });
  }

  function renderPreviewBubble() {
    if (!els.previewBubble || !els.previewContent) return;
    setVisible(els.previewBubble, state.previewOpen);
    if (!state.previewOpen) return;
    let raw = els.messageInput ? els.messageInput.value : "";
    if (state.csvFileData && state.csvFileData.rows.length > 0) {
      const rowMap = {};
      state.csvFileData.headers.forEach((h, idx) => {
        rowMap[h] = String(state.csvFileData.rows[0][idx] ?? "");
      });
      raw = resolveMessageVariables(raw, rowMap);
    }
    els.previewContent.innerHTML = formatWhatsAppPreviewHtml(raw);
  }

  function onMessageChanged() {
    const val = els.messageInput ? els.messageInput.value : "";
    if (els.charCount) els.charCount.textContent = `${val.length} chars`;
    storage.saveCurrentMessageBulk(val);
    renderVariableChips();
    renderPreviewBubble();
    updateRecipientCounters();
  }

  function renderComposer() {
    const val = els.messageInput ? els.messageInput.value : "";
    if (els.charCount) els.charCount.textContent = `${val.length} chars`;
    renderVariableChips();
    renderPreviewBubble();
    renderTemplatesSelect();
  }

  function renderTemplatesSelect() {
    if (!els.templateSelect) return;
    els.templateSelect.innerHTML = `
      <option value="">Template</option>
      <option value="__save__">+ Save Current Message...</option>
    `;
    state.savedTemplates.forEach((tpl, idx) => {
      const opt = document.createElement("option");
      opt.value = `tpl:${idx}`;
      opt.textContent = tpl.name;
      els.templateSelect.appendChild(opt);
    });
    if (state.savedTemplates.length > 0) {
      const delGroup = document.createElement("optgroup");
      delGroup.label = "Delete Template";
      state.savedTemplates.forEach((tpl, idx) => {
        const opt = document.createElement("option");
        opt.value = `del:${idx}`;
        opt.textContent = `Delete: ${tpl.name}`;
        delGroup.appendChild(opt);
      });
      els.templateSelect.appendChild(delGroup);
    }
    els.templateSelect.value = "";
  }

  // --- Attachment Handling ---
  function renderAttachment() {
    if (!els.attachedChipBar) return;
    const att = state.attachment;
    const attUrl = att ? (att.dataUrl || att.base64Data) : "";
    const hasAtt = Boolean(att && attUrl);
    setVisible(els.attachedChipBar, hasAtt);
    if (!hasAtt) {
      updateRecipientCounters();
      return;
    }

    const isImage = /^image\//i.test(att.type || "");
    if (els.attachmentThumb && els.attachmentFileBadge) {
      setVisible(els.attachmentThumb, isImage);
      setVisible(els.attachmentFileBadge, !isImage);
      if (isImage) {
        els.attachmentThumb.src = attUrl;
      } else {
        els.attachmentThumb.src = "";
        const ext = (att.name || "").split(".").pop().toUpperCase().slice(0, 4) || "FILE";
        els.attachmentFileBadge.textContent = ext;
      }
    }
    if (els.attachmentName) els.attachmentName.textContent = att.name || "Attachment";
    if (els.attachmentSize) els.attachmentSize.textContent = formatBytes(att.size || 0);

    const isMediaCapable = /^(image|video)\//i.test(att.type || "");
    setVisible(els.sendAsRow, isMediaCapable);
    if (els.sendAsMediaBtn) els.sendAsMediaBtn.classList.toggle("active", att.sendAs !== "document");
    if (els.sendAsDocBtn) els.sendAsDocBtn.classList.toggle("active", att.sendAs === "document");
    updateRecipientCounters();
  }

  async function saveLocalAttachmentFile(file) {
    setError(els.attachmentError, "");
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(els.attachmentError, "File exceeds 16 MB limit.");
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsDataURL(file);
    });
    const isMedia = /^(image|video)\//i.test(file.type || "");
    const att = {
      name: file.name || "attachment",
      type: file.type || "application/octet-stream",
      size: file.size || 0,
      sendAs: isMedia ? "media" : "document",
      dataUrl
    };
    state.attachment = att;
    await storage.saveAttachmentData(att);
    renderAttachment();
  }

  async function triggerAttachmentPick() {
    setError(els.attachmentError, "");
    if (!isWindowMode && state.waTabId) {
      const resp = await sendTabMessage(state.waTabId, MSG_PICK_ATTACHMENT);
      if (resp && resp.attachment) {
        state.attachment = resp.attachment;
        renderAttachment();
        return;
      }
      if (resp && resp.ok) {
        try {
          const tab = await chrome.tabs.get(state.waTabId);
          await chrome.tabs.update(state.waTabId, { active: true });
          if (tab && tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
        } catch (_) {}
        return;
      }
    }
    if (els.attachmentFileInput) {
      els.attachmentFileInput.value = "";
      els.attachmentFileInput.click();
    }
  }

  // =========================================================================
  // More Options & Scheduled Campaigns
  // =========================================================================

  function syncOptionsUI() {
    const o = state.campaignOptions;
    if (els.optTimeGap) els.optTimeGap.checked = Boolean(o.useTimeGap);
    setVisible(els.optTimeGapBody, Boolean(o.useTimeGap));
    if (els.minGapInput) els.minGapInput.value = String(o.minGapSec || 5);
    if (els.maxGapInput) els.maxGapInput.value = String(o.maxGapSec || 12);

    if (els.optBatching) els.optBatching.checked = Boolean(o.useBatching);
    setVisible(els.optBatchingBody, Boolean(o.useBatching));
    if (els.batchSizeInput) els.batchSizeInput.value = String(o.batchSize || 25);
    if (els.batchPauseInput) els.batchPauseInput.value = String(o.batchPauseSec || 30);
  }

  async function persistOptionsFromInputs() {
    const minG = Math.max(1, parseInt(els.minGapInput ? els.minGapInput.value : 5, 10) || 5);
    const maxG = Math.max(minG, parseInt(els.maxGapInput ? els.maxGapInput.value : 12, 10) || minG);
    const bSize = Math.max(1, parseInt(els.batchSizeInput ? els.batchSizeInput.value : 25, 10) || 25);
    const bPause = Math.max(5, parseInt(els.batchPauseInput ? els.batchPauseInput.value : 30, 10) || 30);

    state.campaignOptions = {
      useTimeGap: Boolean(els.optTimeGap && els.optTimeGap.checked),
      minGapSec: minG,
      maxGapSec: maxG,
      useBatching: Boolean(els.optBatching && els.optBatching.checked),
      batchSize: bSize,
      batchPauseSec: bPause
    };
    await storage.saveCampaignOptions(state.campaignOptions);
  }

  function renderScheduleBanner() {
    if (!els.activeScheduleBanner || !els.activeScheduleText) return;
    const sc = state.scheduledCampaign;
    const hasSched = Boolean(sc && sc.whenMs);
    setVisible(els.activeScheduleBanner, hasSched);
    if (!hasSched) return;
    const dt = new Date(sc.whenMs);
    const count = (sc.payload && sc.payload.targets && sc.payload.targets.length) || 0;
    els.activeScheduleText.textContent = `Scheduled for ${dt.toLocaleString()} (${count})`;
  }

  // =========================================================================
  // Campaign Dispatch, Number Filter, Pause/Resume/Stop, Delivery Drawer
  // =========================================================================

  function setDrawerOpen(open) {
    if (!els.deliveryDrawer || !els.deliveryCaret) return;
    setVisible(els.deliveryDrawer, open);
    els.deliveryCaret.textContent = open ? "▲" : "▼";
  }

  function normalizeStatusLabel(rawStatus) {
    if (rawStatus === "STATUS_SENT") return "Sent";
    if (rawStatus === "STATUS_FAILED") return "Failed";
    if (rawStatus === "STATUS_PENDING") return "Pending";
    return String(rawStatus || "Pending");
  }

  function renderDeliveryStatus(raw) {
    let results = [];
    if (Array.isArray(raw && raw.results)) {
      results = raw.results;
    } else if (raw && Array.isArray(raw.numbers)) {
      const statuses = Array.isArray(raw.status) ? raw.status : [];
      results = raw.numbers.map((num, idx) => ({
        label: num,
        number: num,
        status: normalizeStatusLabel(statuses[idx])
      }));
    }

    state.latestResults = results;
    const total = raw?.total || results.length || 0;
    const sent = results.filter((r) => /^sent|valid$/i.test(r.status)).length;
    const failed = results.filter((r) => /^fail|invalid|error|stop$/i.test(r.status)).length;
    const completedCount = sent + failed;
    const pct = total > 0 ? Math.min(100, Math.round((completedCount / total) * 100)) : 0;

    if (els.sentCount) els.sentCount.textContent = String(sent);
    if (els.failedCount) els.failedCount.textContent = String(failed);
    if (els.progressPercent) els.progressPercent.textContent = `${pct}%`;
    if (els.progressFill) els.progressFill.style.width = `${pct}%`;

    const paused = Boolean(raw?.isPaused ?? raw?.paused);
    const running = Boolean(raw?.isRunning ?? raw?.running);
    const hasPending = total > 0 && completedCount < total;
    const isPausedWithPending = paused && hasPending;
    const isFilterMode = raw?.mode === "filter" || raw?.lastOperation === "OPERATION_FILTER";
    state.isRunning = running;
    state.isPaused = paused;

    setVisible(els.progressPanel, running || isPausedWithPending || results.length > 0);
    setVisible(els.pauseBtn, running && !paused);
    setVisible(els.resumeBtn, isPausedWithPending);
    setVisible(els.stopBtn, running || isPausedWithPending);

    if (els.progressLabel) {
      if (raw?.sessionDisconnected) {
        els.progressLabel.textContent = "WhatsApp Disconnected (Paused)";
      } else if (isPausedWithPending) {
        els.progressLabel.textContent = `Paused (${completedCount}/${total})`;
      } else if (running) {
        els.progressLabel.textContent = isFilterMode
          ? `Checking (${completedCount}/${total})`
          : `Sending (${completedCount}/${total})`;
      } else {
        els.progressLabel.textContent = "Completed";
      }
    }

    const doneReport = !running && !isPausedWithPending && results.length > 0;
    setVisible(els.reportBar, doneReport);
    if (doneReport) {
      if (els.finalSentCount) els.finalSentCount.textContent = String(sent);
      if (els.finalFailedCount) els.finalFailedCount.textContent = String(failed);
    }

    if (els.deliveryLogList) {
      els.deliveryLogList.innerHTML = "";
      const visible = results.slice(-MAX_LOG_VISIBLE);
      if (!visible.length) {
        els.deliveryLogList.innerHTML = `<div class="aura-log-note">No delivery events yet.</div>`;
      } else {
        if (results.length > MAX_LOG_VISIBLE) {
          const note = document.createElement("div");
          note.className = "aura-log-note";
          note.textContent = `Showing latest ${MAX_LOG_VISIBLE} of ${results.length} rows (Download CSV for full log)`;
          els.deliveryLogList.appendChild(note);
        }
        for (const row of visible) {
          const item = document.createElement("div");
          item.className = "aura-log-row";
          const ok = /sent|valid/i.test(row.status);
          const pending = /pending|queue/i.test(row.status);
          const numSpan = document.createElement("span");
          numSpan.className = "aura-log-num";
          numSpan.textContent = row.label || row.number || "";
          const tagSpan = document.createElement("span");
          tagSpan.className = `aura-log-tag ${ok ? "sent" : pending ? "pending" : "failed"}`;
          tagSpan.textContent = row.status || "";
          tagSpan.title = row.reason || "";
          item.appendChild(numSpan);
          item.appendChild(tagSpan);
          els.deliveryLogList.appendChild(item);
        }
      }
    }
  }

  function downloadCsvReport(results, filename) {
    const rows = [["Target", "Status", "Reason", "Timestamp"]];
    for (const r of results || []) {
      rows.push([
        r.label || r.number || "",
        r.status || "",
        r.reason || "",
        r.timestamp || ""
      ]);
    }
    const csvText = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `aura_delivery_report_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function syncOperationStatus() {
    if (!state.waTabId) return;
    try {
      const resp = await sendTabMessage(state.waTabId, MSG_GET_MESSAGE_RESULTS);
      if (resp && !resp.__error && (Array.isArray(resp.numbers) || Array.isArray(resp.results))) {
        renderDeliveryStatus(resp);
        if (!(resp.isRunning ?? resp.running) && state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
        }
      } else if (resp && resp.__error) {
        // B16: Surface content.js fatal errors to user instead of silently failing
        console.warn("[Aura] syncOperationStatus error response:", resp.__error);
        if (state.isRunning && resp.__error.includes("Could not establish connection")) {
          // Content script disconnected — stop polling and show error
          if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
          state.isRunning = false;
          setError(els.actionError, "Connection to WhatsApp Web lost. Please refresh WhatsApp Web and try again.");
        }
      }
    } catch (err) {
      console.warn("[Aura] syncOperationStatus threw:", err && err.message);
    }
  }

  function startOperationPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(syncOperationStatus, 900);
  }

  async function handleSendCampaign() {
    setError(els.actionError, "");
    if (!state.waTabId || !state.waConnected) {
      setError(els.actionError, "WhatsApp Web is not ready. Open WhatsApp Web and scan the QR code first.");
      return;
    }
    if (state.isRunning) {
      setDrawerOpen(true);
      setError(els.actionError, "A campaign is already running. Pause or stop it first.");
      return;
    }

    const payload = buildDispatchPayload();
    if (!payload.targets.length) {
      setError(els.actionError, "Add at least one valid recipient, audience, or contact first.");
      return;
    }
    if (!payload.message.trim() && !payload.useAttachment) {
      setError(els.actionError, "Enter a message or attach a file before sending.");
      return;
    }

    if (els.optSchedule && els.optSchedule.checked) {
      const rawDt = els.scheduleAtInput ? els.scheduleAtInput.value : "";
      const whenMs = rawDt ? new Date(rawDt).getTime() : 0;
      if (!Number.isFinite(whenMs) || whenMs <= Date.now() + 15000) {
        setError(els.actionError, "Choose a schedule date/time at least 1 minute in the future.");
        return;
      }
      const res = await sendRuntimeMessage(MSG_SCHEDULE_CAMPAIGN, { whenMs, payload });
      if (!res || !res.ok) {
        setError(els.actionError, (res && res.error) || "Failed to schedule campaign.");
        return;
      }
      state.scheduledCampaign = { whenMs, payload };
      els.optSchedule.checked = false;
      setVisible(els.optScheduleBody, false);
      renderScheduleBanner();
      updateRecipientCounters();
      return;
    }

    setDrawerOpen(true);
    setVisible(els.progressPanel, true);
    setVisible(els.reportBar, false);

    const resp = await sendTabMessage(state.waTabId, MSG_SEND_MESSAGE, payload);
    if (resp && (resp.__error || resp.error || resp.notLoggedIn)) {
      setError(els.actionError, resp.__error || resp.error || "WhatsApp Web is not logged in.");
      return;
    }
    state.isRunning = true;
    startOperationPolling();
    syncOperationStatus();
  }

  async function handleCheckNumbers() {
    setError(els.actionError, "");
    if (!state.waTabId || !state.waConnected) {
      setError(els.actionError, "WhatsApp Web is not ready.");
      return;
    }
    if (state.isRunning) {
      setDrawerOpen(true);
      setError(els.actionError, "An operation is already running. Pause or stop it first.");
      return;
    }
    const payload = buildDispatchPayload();
    const phoneTargets = payload.targets.filter((t) => t.kind === "phone");
    if (!phoneTargets.length) {
      setError(els.actionError, "Number verification only applies to phone numbers (not group chat titles).");
      return;
    }
    setDrawerOpen(true);
    const resp = await sendTabMessage(state.waTabId, MSG_RUN_FILTER, {
      targets: phoneTargets,
      numbers: phoneTargets.map((t) => t.value),
      minGapSec: payload.minGapSec,
      maxGapSec: payload.maxGapSec
    });
    if (resp && (resp.__error || resp.error || resp.notLoggedIn)) {
      setError(els.actionError, resp.__error || resp.error || "WhatsApp Web is not logged in.");
      return;
    }
    state.isRunning = true;
    startOperationPolling();
    syncOperationStatus();
  }

  async function handleExtractGroupContacts() {
    setError(els.actionError, "");
    if (!state.waTabId || !state.waConnected) {
      setError(els.actionError, "Open WhatsApp Web and click into a Group chat first.");
      return;
    }
    const resp = await sendTabMessage(state.waTabId, MSG_EXTRACT_GROUP_CONTACTS);
    if (!resp || !resp.ok || !resp.csvText) {
      const code = resp && (resp.error || resp.__error);
      const friendly =
        code === "no_group"
          ? "Open a WhatsApp Group chat first to extract members."
          : code === "empty_group"
            ? "No group member numbers are visible yet. Click the group header to open Group Info in WhatsApp Web, then try again."
            : code || "Open a Group chat in WhatsApp Web to extract members.";
      setError(els.actionError, friendly);
      return;
    }
    const dlName = resp.filename || resp.fileName || "whatsapp_group_contacts.csv";
    const count = (resp.entries && resp.entries.length) || resp.count || 0;
    const blob = new Blob([resp.csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dlName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${count} group contacts to ${dlName}.`);
  }

  // =========================================================================
  // Features Tab: Reports History
  // =========================================================================

  function renderReportsHistory() {
    if (!els.reportsHistoryList) return;
    if (els.historyCountBadge) els.historyCountBadge.textContent = String(state.reportsHistory.length);
    els.reportsHistoryList.innerHTML = "";
    if (!state.reportsHistory.length) {
      els.reportsHistoryList.innerHTML = `<div class="aura-list-empty">No completed campaigns logged yet.</div>`;
      return;
    }
    for (const rep of state.reportsHistory) {
      const row = document.createElement("div");
      row.className = "aura-pick-row";
      const left = document.createElement("div");
      left.style.minWidth = "0";
      const ts = rep.ts || rep.timestamp || Date.now();
      const dt = new Date(ts).toLocaleString();
      const isFilter = rep.mode === "OPERATION_FILTER" || rep.mode === "filter";
      left.innerHTML = `
        <div class="aura-pick-name">${escapeHtml(isFilter ? "Number Check" : "Campaign Dispatch")}</div>
        <div style="font-size:10.5px;color:#6E6E73;">${escapeHtml(dt)} · Sent ${rep.sent || 0} / Failed ${rep.failed || 0}</div>
      `;
      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "aura-link-btn";
      dl.textContent = "Download CSV";
      dl.addEventListener("click", () => {
        const rows = Array.isArray(rep.results)
          ? rep.results
          : (rep.numbers || []).map((n, i) => ({
              label: n,
              status: normalizeStatusLabel(rep.status && rep.status[i]),
              reason: "",
              timestamp: new Date(ts).toISOString()
            }));
        downloadCsvReport(rows, `aura_report_${ts}.csv`);
      });
      row.appendChild(left);
      row.appendChild(dl);
      els.reportsHistoryList.appendChild(row);
    }
  }

  // =========================================================================
  // Inline Save Modal & Guides Sheet
  // =========================================================================

  function openSaveModal(mode, title, placeholder) {
    state.saveModalMode = mode;
    if (els.saveModalTitle) els.saveModalTitle.textContent = title;
    if (els.saveModalInput) {
      els.saveModalInput.value = "";
      els.saveModalInput.placeholder = placeholder || "Enter name...";
    }
    setVisible(els.saveModalOverlay, true);
    setTimeout(() => els.saveModalInput && els.saveModalInput.focus(), 20);
  }

  function closeSaveModal() {
    state.saveModalMode = null;
    setVisible(els.saveModalOverlay, false);
  }

  async function confirmSaveModal() {
    const name = (els.saveModalInput ? els.saveModalInput.value : "").trim();
    if (!name) return;

    if (state.saveModalMode === "list") {
      const payload = buildDispatchPayload();
      const nums = payload.targets.filter((t) => t.kind === "phone").map((t) => t.value);
      const finalNums = nums.length ? nums : state.manualNumbers.slice();
      if (!finalNums.length) {
        setError(els.csvError, "Add at least one phone number or import CSV/Excel before saving a list.");
        closeSaveModal();
        return;
      }
      const listObj = {
        id: `list_${Date.now()}`,
        name,
        numbers: finalNums,
        createdAt: Date.now()
      };
      state.savedLists = [listObj, ...state.savedLists];
      await storage.saveSavedLists(state.savedLists);
      renderListsPanel();
    } else if (state.saveModalMode === "audience") {
      if (state.selectedAudiences.length > 0) {
        const filtered = state.savedAudiences.filter((s) => s.name.toLowerCase() !== name.toLowerCase());
        state.savedAudiences = [{ name, items: state.selectedAudiences.slice() }, ...filtered];
        await storage.saveSavedAudiences(state.savedAudiences);
        renderAudiencesPanel();
      }
    } else if (state.saveModalMode === "template") {
      const text = els.messageInput ? els.messageInput.value : "";
      if (text.trim()) {
        const filtered = state.savedTemplates.filter((t) => t.name.toLowerCase() !== name.toLowerCase());
        state.savedTemplates = [{ name, text }, ...filtered];
        await storage.saveSavedTemplates(state.savedTemplates);
        renderTemplatesSelect();
      }
    }
    closeSaveModal();
  }

  function openGuideSheet(key) {
    const item = GUIDE_CONTENT[key];
    if (!item || !els.guideSheet) return;
    if (els.guideSheetTitle) els.guideSheetTitle.textContent = item.title;
    if (els.guideSheetBody) els.guideSheetBody.innerHTML = item.html;
    setVisible(els.guideSheet, true);
  }

  // =========================================================================
  // 3-Step Interactive Spotlight Tour
  // =========================================================================

  function clearTourSpotlights() {
    document.querySelectorAll(".aura-tour-spotlight").forEach((el) => {
      el.classList.remove("aura-tour-spotlight");
    });
  }

  function renderTourStep() {
    if (!els.tourOverlay) return;
    if (state.tourIndex < 0 || state.tourIndex >= TOUR_STEPS.length) {
      clearTourSpotlights();
      setVisible(els.tourOverlay, false);
      return;
    }

    const step = TOUR_STEPS[state.tourIndex];
    const target = $(step.targetId);
    clearTourSpotlights();
    if (target) {
      target.classList.add("aura-tour-spotlight");
    }

    if (els.tourTitle) els.tourTitle.textContent = step.title;
    if (els.tourBody) els.tourBody.textContent = step.body;
    if (els.tourStepLabel) els.tourStepLabel.textContent = `${state.tourIndex + 1} of ${TOUR_STEPS.length}`;
    if (els.tourPrevBtn) els.tourPrevBtn.disabled = state.tourIndex === 0;
    if (els.tourNextBtn) {
      els.tourNextBtn.textContent = state.tourIndex === TOUR_STEPS.length - 1 ? "Done" : "Next →";
    }

    setVisible(els.tourOverlay, true);

    const card = els.tourOverlay.querySelector(".aura-tour-card");
    if (card && target) {
      const rect = target.getBoundingClientRect();
      const vw = document.documentElement.clientWidth || 780;
      const vh = document.documentElement.clientHeight || 585;
      const cw = card.offsetWidth || 310;
      const ch = card.offsetHeight || 155;
      const pad = 12;

      let left;
      let top;
      if (rect.right + pad + cw <= vw - pad) {
        left = rect.right + pad;
        top = rect.top;
      } else if (rect.left - pad - cw >= pad) {
        left = rect.left - pad - cw;
        top = rect.top;
      } else if (rect.bottom + pad + ch <= vh - pad) {
        left = rect.left + Math.max(0, (rect.width - cw) / 2);
        top = rect.bottom + pad;
      } else {
        left = rect.left + Math.max(0, (rect.width - cw) / 2);
        top = rect.top - pad - ch;
      }

      left = Math.max(pad, Math.min(vw - cw - pad, left));
      top = Math.max(pad, Math.min(vh - ch - pad, top));
      card.style.left = `${Math.round(left)}px`;
      card.style.top = `${Math.round(top)}px`;
    }
  }

  async function startTour(stepIdx = 0) {
    if (!state.waTabId) return;
    if (state.activeNav !== "sender") switchMainNav("sender");
    state.tourIndex = stepIdx;
    renderTourStep();
  }

  async function closeTour(markCompleted = true) {
    state.tourIndex = -1;
    clearTourSpotlights();
    setVisible(els.tourOverlay, false);
    if (markCompleted) {
      await storage.setTourCompleted(true);
    }
  }

  // =========================================================================
  // Event Binding & Hydration
  // =========================================================================

  function bindEvents() {
    if (els.navSenderBtn) els.navSenderBtn.addEventListener("click", () => switchMainNav("sender"));
    if (els.navFeaturesBtn) els.navFeaturesBtn.addEventListener("click", () => switchMainNav("features"));
    if (els.launchWhatsappBtn) els.launchWhatsappBtn.addEventListener("click", openOrFocusWhatsApp);
    if (els.popoutBtn) els.popoutBtn.addEventListener("click", handlePopout);
    if (els.clearAllBtn) els.clearAllBtn.addEventListener("click", handleClearAll);
    if (els.startTourBtn) els.startTourBtn.addEventListener("click", () => startTour(0));

    if (els.srcNumbersBtn) els.srcNumbersBtn.addEventListener("click", () => switchRecipientSource("numbers"));
    if (els.srcAudiencesBtn) els.srcAudiencesBtn.addEventListener("click", () => switchRecipientSource("audiences"));
    if (els.srcContactsBtn) els.srcContactsBtn.addEventListener("click", () => switchRecipientSource("contacts"));
    if (els.srcListsBtn) els.srcListsBtn.addEventListener("click", () => switchRecipientSource("lists"));

    if (els.numberTextInput) {
      const flushInput = () => {
        const val = els.numberTextInput.value;
        if (val.trim()) {
          addManualTokens(val);
          els.numberTextInput.value = "";
        }
      };
      els.numberTextInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "," || e.key === ";") {
          e.preventDefault();
          flushInput();
        } else if (e.key === "Backspace" && !els.numberTextInput.value && state.manualNumbers.length) {
          removeManualNumber(state.manualNumbers[state.manualNumbers.length - 1]);
        }
      });
      els.numberTextInput.addEventListener("blur", flushInput);
      els.numberTextInput.addEventListener("paste", (e) => {
        const txt = e.clipboardData ? e.clipboardData.getData("text") : "";
        if (txt && /[\n,;]/.test(txt)) {
          e.preventDefault();
          addManualTokens(txt);
        }
      });
    }

    if (els.downloadExampleBtn) els.downloadExampleBtn.addEventListener("click", downloadExampleCsv);
    if (els.uploadCsvBtn) els.uploadCsvBtn.addEventListener("click", triggerCsvImport);
    if (els.replaceCsvBtn) els.replaceCsvBtn.addEventListener("click", triggerCsvImport);
    if (els.removeCsvBtn) {
      els.removeCsvBtn.addEventListener("click", async () => {
        state.csvFileData = null;
        state.csvFileName = "";
        state.phoneColumnIndex = 0;
        await Promise.all([
          storage.saveCSVFileData(null),
          storage.saveFileName(""),
          storage.savePhoneColumnNumber(0)
        ]);
        setNotice("");
        setError(els.csvError, "");
        renderNumbersPanel();
        updateRecipientCounters();
      });
    }
    if (els.phoneColumnSelect) {
      els.phoneColumnSelect.addEventListener("change", async () => {
        state.phoneColumnIndex = parseInt(els.phoneColumnSelect.value, 10) || 0;
        await storage.savePhoneColumnNumber(state.phoneColumnIndex);
        updateRecipientCounters();
      });
    }
    if (els.csvFileInput) {
      els.csvFileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const buf = await file.arrayBuffer();
        await applyImportedSpreadsheet({ fileName: file.name, arrayBuffer: buf });
      });
    }
    if (els.campaignQuickSelect) {
      els.campaignQuickSelect.addEventListener("change", async () => {
        const val = els.campaignQuickSelect.value;
        els.campaignQuickSelect.value = "";
        if (val === "extract_group") {
          await handleExtractGroupContacts();
        } else if (val === "save_list") {
          openSaveModal("list", "Save Numbers as List", "e.g., VIP Customers");
        }
      });
    }

    if (els.audienceSearchInput) els.audienceSearchInput.addEventListener("input", renderAudiencesPanel);
    if (els.refreshAudiencesBtn) els.refreshAudiencesBtn.addEventListener("click", fetchAudiencesFromWA);
    if (els.selectAllAudiencesChk) {
      els.selectAllAudiencesChk.addEventListener("change", async () => {
        const q = (els.audienceSearchInput ? els.audienceSearchInput.value : "").trim().toLowerCase();
        const visible = state.allAudiences.filter((a) => !q || String(a.title || "").toLowerCase().includes(q));
        const map = new Map(state.selectedAudiences.map((a) => [a.title, a]));
        for (const item of visible) {
          if (els.selectAllAudiencesChk.checked) map.set(item.title, { title: item.title, kind: item.kind || "chat" });
          else map.delete(item.title);
        }
        state.selectedAudiences = Array.from(map.values());
        await storage.saveSelectedAudiences(state.selectedAudiences);
        renderAudiencesPanel();
        updateRecipientCounters();
      });
    }
    if (els.savedAudiencesSelect) {
      els.savedAudiencesSelect.addEventListener("change", async () => {
        const val = els.savedAudiencesSelect.value;
        els.savedAudiencesSelect.value = "";
        if (val === "__save__") {
          openSaveModal("audience", "Save Selected Audiences", "e.g., Marketing Groups");
        } else if (val) {
          const found = state.savedAudiences.find((s) => s.name === val);
          if (found) {
            state.selectedAudiences = (found.items || []).slice();
            await storage.saveSelectedAudiences(state.selectedAudiences);
            renderAudiencesPanel();
            updateRecipientCounters();
          }
        }
      });
    }

    if (els.contactSearchInput) els.contactSearchInput.addEventListener("input", renderContactsPanel);
    if (els.refreshContactsBtn) els.refreshContactsBtn.addEventListener("click", fetchContactsFromWA);
    if (els.selectAllContactsChk) {
      els.selectAllContactsChk.addEventListener("change", async () => {
        const q = (els.contactSearchInput ? els.contactSearchInput.value : "").trim().toLowerCase();
        const visible = state.allContacts.filter(
          (c) => !q || String(c.name || "").toLowerCase().includes(q) || String(c.phone || "").toLowerCase().includes(q)
        );
        const keyFn = (c) => c.phone || c.name;
        const map = new Map(state.selectedContacts.map((c) => [keyFn(c), c]));
        for (const item of visible) {
          if (els.selectAllContactsChk.checked) map.set(keyFn(item), { name: item.name, phone: item.phone || "" });
          else map.delete(keyFn(item));
        }
        state.selectedContacts = Array.from(map.values());
        await storage.saveSelectedContacts(state.selectedContacts);
        renderContactsPanel();
        updateRecipientCounters();
      });
    }

    if (els.saveNewListBtn) {
      els.saveNewListBtn.addEventListener("click", () => {
        openSaveModal("list", "Save Current Numbers as List", "e.g., Q4 Leads");
      });
    }

    if (els.fmtBoldBtn) els.fmtBoldBtn.addEventListener("click", () => wrapSelection("*"));
    if (els.fmtItalicBtn) els.fmtItalicBtn.addEventListener("click", () => wrapSelection("_"));
    if (els.fmtStrikeBtn) els.fmtStrikeBtn.addEventListener("click", () => wrapSelection("~"));
    if (els.fmtMonoBtn) els.fmtMonoBtn.addEventListener("click", () => wrapSelection("`"));
    if (els.messageInput) els.messageInput.addEventListener("input", onMessageChanged);

    const toggleEmoji = (e) => {
      e.stopPropagation();
      setVisible(els.emojiPopover, !isVisible(els.emojiPopover));
    };
    if (els.emojiBarBtn) els.emojiBarBtn.addEventListener("click", toggleEmoji);
    if (els.composerEmojiBtn) els.composerEmojiBtn.addEventListener("click", toggleEmoji);
    if (els.emojiPopover) {
      els.emojiPopover.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-emoji]");
        if (!btn) return;
        insertAtCursor(els.messageInput, btn.getAttribute("data-emoji"));
        setVisible(els.emojiPopover, false);
      });
    }
    document.addEventListener("click", (e) => {
      if (
        els.emojiPopover &&
        isVisible(els.emojiPopover) &&
        !els.emojiPopover.contains(e.target) &&
        e.target !== els.emojiBarBtn &&
        e.target !== els.composerEmojiBtn
      ) {
        setVisible(els.emojiPopover, false);
      }
    });

    if (els.previewToggleBtn) {
      els.previewToggleBtn.addEventListener("click", () => {
        state.previewOpen = !state.previewOpen;
        els.previewToggleBtn.classList.toggle("active", state.previewOpen);
        renderPreviewBubble();
      });
    }

    if (els.templateSelect) {
      els.templateSelect.addEventListener("change", async () => {
        const val = els.templateSelect.value;
        els.templateSelect.value = "";
        if (val === "__save__") {
          openSaveModal("template", "Save Message Template", "e.g., Follow-up Greeting");
        } else if (val.startsWith("tpl:")) {
          const idx = parseInt(val.slice(4), 10);
          if (state.savedTemplates[idx] && els.messageInput) {
            els.messageInput.value = state.savedTemplates[idx].text;
            onMessageChanged();
          }
        } else if (val.startsWith("del:")) {
          const idx = parseInt(val.slice(4), 10);
          state.savedTemplates.splice(idx, 1);
          await storage.saveSavedTemplates(state.savedTemplates);
          renderTemplatesSelect();
        }
      });
    }

    if (els.composerAttachBtn) els.composerAttachBtn.addEventListener("click", triggerAttachmentPick);
    if (els.attachmentFileInput) {
      els.attachmentFileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) await saveLocalAttachmentFile(file);
      });
    }
    if (els.removeAttachmentBtn) {
      els.removeAttachmentBtn.addEventListener("click", async () => {
        state.attachment = null;
        await storage.clearAttachmentData();
        renderAttachment();
      });
    }
    const setSendAs = async (sendAs) => {
      if (!state.attachment) return;
      state.attachment.sendAs = sendAs;
      await storage.saveAttachmentData(state.attachment);
      renderAttachment();
    };
    if (els.sendAsMediaBtn) els.sendAsMediaBtn.addEventListener("click", () => setSendAs("media"));
    if (els.sendAsDocBtn) els.sendAsDocBtn.addEventListener("click", () => setSendAs("document"));

    if (els.senderWorkspace) {
      els.senderWorkspace.addEventListener("dragover", (e) => {
        e.preventDefault();
      });
      els.senderWorkspace.addEventListener("drop", async (e) => {
        e.preventDefault();
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        if (/\.(csv|xlsx)$/i.test(file.name)) {
          const buf = await file.arrayBuffer();
          await applyImportedSpreadsheet({ fileName: file.name, arrayBuffer: buf });
        } else {
          await saveLocalAttachmentFile(file);
        }
      });
    }
    document.addEventListener("paste", async (e) => {
      const items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
      const imgItem = items.find((i) => /^image\//i.test(i.type));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) await saveLocalAttachmentFile(file);
      }
    });

    if (els.optTimeGap) {
      els.optTimeGap.addEventListener("change", async () => {
        setVisible(els.optTimeGapBody, els.optTimeGap.checked);
        await persistOptionsFromInputs();
      });
    }
    if (els.optBatching) {
      els.optBatching.addEventListener("change", async () => {
        setVisible(els.optBatchingBody, els.optBatching.checked);
        await persistOptionsFromInputs();
      });
    }
    [els.minGapInput, els.maxGapInput, els.batchSizeInput, els.batchPauseInput].forEach((inp) => {
      if (inp) inp.addEventListener("change", persistOptionsFromInputs);
    });
    if (els.optSchedule) {
      els.optSchedule.addEventListener("change", () => {
        setVisible(els.optScheduleBody, els.optSchedule.checked);
        if (els.optSchedule.checked && els.scheduleAtInput && !els.scheduleAtInput.value) {
          const d = new Date(Date.now() + 5 * 60000);
          const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          els.scheduleAtInput.value = local;
        }
        updateRecipientCounters();
      });
    }
    if (els.cancelScheduleBtn) {
      els.cancelScheduleBtn.addEventListener("click", async () => {
        await sendRuntimeMessage(MSG_CANCEL_SCHEDULE);
        state.scheduledCampaign = null;
        renderScheduleBanner();
      });
    }

    if (els.guideUseBtn) els.guideUseBtn.addEventListener("click", () => startTour(0));
    if (els.guideAttachBtn) els.guideAttachBtn.addEventListener("click", () => openGuideSheet("attach"));
    if (els.guideGroupsBtn) els.guideGroupsBtn.addEventListener("click", () => openGuideSheet("groups"));
    if (els.closeGuideSheetBtn) {
      els.closeGuideSheetBtn.addEventListener("click", () => setVisible(els.guideSheet, false));
    }

    if (els.sendCampaignBtn) els.sendCampaignBtn.addEventListener("click", handleSendCampaign);
    if (els.checkNumbersBtn) els.checkNumbersBtn.addEventListener("click", handleCheckNumbers);
    if (els.deliveryReportBtn) {
      els.deliveryReportBtn.addEventListener("click", () => {
        setDrawerOpen(!isVisible(els.deliveryDrawer));
      });
    }
    if (els.pauseBtn) {
      els.pauseBtn.addEventListener("click", async () => {
        if (state.waTabId) await sendTabMessage(state.waTabId, MSG_PAUSE);
        syncOperationStatus();
      });
    }
    if (els.resumeBtn) {
      els.resumeBtn.addEventListener("click", async () => {
        if (state.waTabId) await sendTabMessage(state.waTabId, MSG_RESUME);
        startOperationPolling();
        syncOperationStatus();
      });
    }
    if (els.stopBtn) {
      els.stopBtn.addEventListener("click", async () => {
        if (state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
        }
        if (state.waTabId) await sendTabMessage(state.waTabId, MSG_CANCEL_OPERATION);
        syncOperationStatus();
      });
    }
    if (els.downloadReportBtn) {
      els.downloadReportBtn.addEventListener("click", () => downloadCsvReport(state.latestResults));
    }
    if (els.dismissReportBtn) {
      els.dismissReportBtn.addEventListener("click", () => setVisible(els.reportBar, false));
    }

    if (els.featExtractGroupBtn) els.featExtractGroupBtn.addEventListener("click", handleExtractGroupContacts);
    if (els.featVerifyBtn) {
      els.featVerifyBtn.addEventListener("click", async () => {
        switchMainNav("sender");
        if (!buildDispatchPayload().targets.length) {
          setError(els.actionError, "Enter phone numbers or import CSV/Excel, then click Check.");
        } else {
          await handleCheckNumbers();
        }
      });
    }

    if (els.saveModalCancelBtn) els.saveModalCancelBtn.addEventListener("click", closeSaveModal);
    if (els.saveModalConfirmBtn) els.saveModalConfirmBtn.addEventListener("click", confirmSaveModal);
    if (els.saveModalInput) {
      els.saveModalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmSaveModal();
        } else if (e.key === "Escape") {
          closeSaveModal();
        }
      });
    }

    if (els.tourCloseBtn) els.tourCloseBtn.addEventListener("click", () => closeTour(true));
    if (els.tourPrevBtn) {
      els.tourPrevBtn.addEventListener("click", () => {
        if (state.tourIndex > 0) {
          state.tourIndex--;
          renderTourStep();
        }
      });
    }
    if (els.tourNextBtn) {
      els.tourNextBtn.addEventListener("click", () => {
        if (state.tourIndex < TOUR_STEPS.length - 1) {
          state.tourIndex++;
          renderTourStep();
        } else {
          closeTour(true);
        }
      });
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      const subj = msg.subject || msg.type;
      if (subj === MSG_MESSAGE_RESULTS) {
        renderDeliveryStatus(msg.data || msg);
      }
    });

    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[KEY_ATTACHMENT_DATA]) {
        state.attachment = await storage.getAttachmentData();
        renderAttachment();
      }
      if (changes[KEY_PENDING_CSV] && changes[KEY_PENDING_CSV].newValue) {
        const pending = await storage.getPendingCSV();
        if (pending) await applyImportedSpreadsheet(pending);
      }
      if (changes[KEY_REPORTS_HISTORY]) {
        state.reportsHistory = await storage.getReportsHistory();
        if (state.activeNav === "features") renderReportsHistory();
      }
    });
  }

  async function hydrateState() {
    setVisible(els.reportBar, false);

    const [
      bulkNums,
      bulkMsg,
      isdCode,
      iso2,
      csvData,
      csvName,
      phoneCol,
      allAud,
      selAud,
      allContacts,
      selContacts,
      savedLists,
      savedAudiences,
      savedTemplates,
      reportsHistory,
      scheduledCampaign,
      options,
      source,
      attachment,
      pendingCsv,
      tourCompleted
    ] = await Promise.all([
      storage.getPhoneNumbersBulk(),
      storage.getCurrentMessageBulk(),
      storage.getBulkMsgCountryCode(),
      storage.getISO2CountryCode(),
      storage.getCSVFileData(),
      storage.getFileName(),
      storage.getPhoneColumnNumber(),
      storage.getAllAudiences(),
      storage.getSelectedAudiences(),
      storage.getAllContacts(),
      storage.getSelectedContacts(),
      storage.getSavedLists(),
      storage.getSavedAudiences(),
      storage.getSavedTemplates(),
      storage.getReportsHistory(),
      storage.getScheduledCampaign(),
      storage.getCampaignOptions(),
      storage.getRecipientSource(),
      storage.getAttachmentData(),
      storage.getPendingCSV(),
      storage.getTourCompleted()
    ]);

    state.isdDigits = sanitizeDigits(isdCode || "91") || "91";
    state.iso2 = iso2 || "in";
    state.manualNumbers = String(bulkNums || "")
      .split(",")
      .map((s) => sanitizeDigits(s))
      .filter((s) => s.length >= 7);
    if (els.messageInput) els.messageInput.value = bulkMsg || "";
    state.csvFileData = csvData || null;
    state.csvFileName = csvName || "";
    state.phoneColumnIndex = Number.isFinite(phoneCol) ? phoneCol : 0;
    state.allAudiences = Array.isArray(allAud) ? allAud : [];
    state.selectedAudiences = Array.isArray(selAud) ? selAud : [];
    state.allContacts = Array.isArray(allContacts) ? allContacts : [];
    state.selectedContacts = Array.isArray(selContacts) ? selContacts : [];
    state.savedLists = Array.isArray(savedLists) ? savedLists : [];
    state.savedAudiences = Array.isArray(savedAudiences) ? savedAudiences : [];
    state.savedTemplates = Array.isArray(savedTemplates) ? savedTemplates : [];
    state.reportsHistory = Array.isArray(reportsHistory) ? reportsHistory : [];
    state.scheduledCampaign = scheduledCampaign || null;
    if (options && typeof options === "object") {
      state.campaignOptions = { ...state.campaignOptions, ...options };
    }
    state.attachment = attachment || null;

    initIsdInput();
    syncOptionsUI();
    renderNumbersPanel();
    renderAudiencesPanel();
    renderContactsPanel();
    renderListsPanel();
    renderComposer();
    renderAttachment();
    renderScheduleBanner();
    renderReportsHistory();
    await refreshWhatsAppStatus();
    await switchRecipientSource(source || "numbers");

    if (pendingCsv && (pendingCsv.csvText || pendingCsv.base64Data)) {
      await applyImportedSpreadsheet(pendingCsv);
    }

    if (state.waTabId) {
      await syncOperationStatus();
      if (state.isRunning) startOperationPolling();
    }

    if (state.waTabId && !tourCompleted) {
      await startTour(0);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    cacheElements();
    bindEvents();
    await hydrateState();
  });
})();
