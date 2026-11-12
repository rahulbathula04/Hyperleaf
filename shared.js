(function (global) {
  const CONSTANTS = {
    KEY_AUTHID: "KEY_AUTHID",
    KEY_ACTIVE_TAB: "KEY_ACTIVE_TAB",
    KEY_INSTALL_TIMESTAMP: "KEY_INSTALL_TIMESTAMP",
    KEY_PHONE_NUMBER: "KEY_PHONE_NUMBER",
    KEY_CURRENT_MSG: "KEY_CURRENT_MSG",
    KEY_SINGLE_MSG_COUNTRYCODE: "KEY_SINGLE_MSG_COUNTRYCODE",
    KEY_PHONE_NUMBERS_BULK: "KEY_PHONE_NUMBERS_BULK",
    KEY_CURRENT_MSG_BULK: "KEY_CURRENT_MSG_BULK",
    KEY_ALL_CONTACTS: "KEY_ALL_CONTACTS",
    KEY_ALL_AUDIENCES: "KEY_ALL_AUDIENCES",
    KEY_AUTH_PHONENUMBER: "KEY_AUTH_PHONENUMBER",
    KEY_AUTH_NAME: "KEY_AUTH_NAME",
    KEY_IS_AUTHORIZED: "KEY_IS_AUTHORIZED",
    KEY_BULK_MSG_COUNTRYCODE: "KEY_BULK_MSG_COUNTRYCODE",
    KEY_REF_ID: "KEY_REF_ID",
    KEY_IS_PRO: "KEY_IS_PRO",
    KEY_PHONE_COLUMN_NUMBER: "KEY_PHONE_CLUMN_NUMBER",
    KEY_CSV_FILE_DATA: "KEY_CSV_FILE_DATA",
    KEY_FILE_NAME: "KEY_FILE_NAME",
    KEY_COUNTRY_ISO2_CODE: "KEY_COUNTRY_ISO2_CODE",
    KEY_DELAY: "KEY_DELAY",
    KEY_CAMPAIGN_OPTIONS: "KEY_CAMPAIGN_OPTIONS",
    KEY_SAVED_LISTS: "KEY_SAVED_LISTS",
    KEY_SAVED_AUDIENCES: "KEY_SAVED_AUDIENCES",
    KEY_SAVED_TEMPLATES: "KEY_SAVED_TEMPLATES",
    KEY_REPORTS_HISTORY: "KEY_REPORTS_HISTORY",
    KEY_SCHEDULED_CAMPAIGN: "KEY_SCHEDULED_CAMPAIGN",
    KEY_TOUR_COMPLETED: "KEY_TOUR_COMPLETED",
    KEY_SELECTED_AUDIENCES: "KEY_SELECTED_AUDIENCES",
    KEY_SELECTED_CONTACTS: "KEY_SELECTED_CONTACTS",
    KEY_RECIPIENT_SOURCE: "KEY_RECIPIENT_SOURCE",
    KEY_IS_SEND_OPERATION_RUNNING: "KEY_IS_SEND_OPERATION_RUNNING",
    KEY_IS_SEND_OPERATION_PAUSED: "KEY_IS_SEND_OPERATION_PAUSED",
    KEY_IS_FILTER_OPERATION_RUNNING: "KEY_IS_FILTER_OPERATION_RUNNING",
    KEY_IS_FILTER_OPERATION_PAUSED: "KEY_IS_FILTER_OPERATION_PAUSED",
    KEY_ATTACHMENT_DATA: "KEY_ATTACHMENT_DATA",
    KEY_PENDING_CSV: "KEY_PENDING_CSV",

    MSG_SEND_MESSAGE: "MSG_SEND_MESSAGE",
    MSG_GET_CONTACTS: "MSG_GET_CONTACTS",
    MSG_GET_CHATS_AND_GROUPS: "MSG_GET_CHATS_AND_GROUPS",
    MSG_SEARCH_CONTACTS: "MSG_SEARCH_CONTACTS",
    MSG_UPDATE_CONTACTS: "MSG_UPDATE_CONTACTS",
    MSG_GET_REF_COOKIE: "MSG_GET_REF_COOKIE",
    MSG_REF_COOKIE_VALUE: "MSG_REF_COOKIE_VALUE",
    MSG_GET_USER_PHONENUMBER: "MSG_GET_USER_PHONENUMBER",
    MSG_SHOW_WHATSAPP_TAB: "MSG_SHOW_WHATSAPP_TAB",
    MSG_GET_PAGE_URL: "MSG_GET_PAGE_URL",
    MSG_OPEN_MY_MSG_WINDOW: "MSG_OPEN_MY_MSG_WINDOW",
    MSG_IS_MY_CHAT_WINDOW: "MSG_IS_MY_CHAT_WINDOW",
    MSG_GET_MESSAGE_RESULTS: "MSG_GET_MESSAGE_RESULTS",
    MSG_MESSAGE_RESULTS: "MSG_MESSAGE_RESULTS",
    MSG_RUN_FILTER: "MSG_RUN_FILTER",
    MSG_PAUSE: "MSG_PAUSE",
    MSG_RESUME: "MSG_RESUME",
    MSG_CANCEL_OPERATION: "MSG_CANCEL_OPERATION",
    MSG_PICK_ATTACHMENT: "MSG_PICK_ATTACHMENT",
    MSG_PICK_CSV: "MSG_PICK_CSV",
    MSG_EXTRACT_GROUP_CONTACTS: "MSG_EXTRACT_GROUP_CONTACTS",
    MSG_SCHEDULE_CAMPAIGN: "MSG_SCHEDULE_CAMPAIGN",
    MSG_CANCEL_SCHEDULE: "MSG_CANCEL_SCHEDULE",
    MSG_CLOSE_AURA_VIEW: "MSG_CLOSE_AURA_VIEW",
    MSG_SUPPRESS_AUTO_CLOSE: "MSG_SUPPRESS_AUTO_CLOSE",
    MSG_PANEL_READY: "MSG_PANEL_READY"
  };

  Object.keys(CONSTANTS).forEach((k) => {
    try {
      global[k] = CONSTANTS[k];
    } catch (_) {}
  });

  function getStorageInstance() {
    function setStorage(key, value) {
      return new Promise((resolve) => {
        const obj = {};
        obj[key] = value;
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime.lastError) {
            console.warn("Storage set error:", key, chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    }

    function getStorage(key) {
      return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
          if (chrome.runtime.lastError) {
            console.warn("Storage get error:", key, chrome.runtime.lastError.message);
            resolve(undefined);
            return;
          }
          resolve(result ? result[key] : undefined);
        });
      });
    }

    function safeParseJSON(raw, fallback) {
      if (raw && typeof raw === "object") {
        return raw;
      }
      if (!raw || typeof raw !== "string") {
        return fallback;
      }
      try {
        return JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    }

    function setIsPro(flag) {
      return setStorage(CONSTANTS.KEY_IS_PRO, flag ? "true" : "false");
    }

    async function getIsPro() {
      return (await getStorage(CONSTANTS.KEY_IS_PRO)) !== "false";
    }

    function savePhoneNumber(phoneNumber) {
      return setStorage(CONSTANTS.KEY_PHONE_NUMBER, phoneNumber || "");
    }

    async function getPhoneNumber() {
      return (await getStorage(CONSTANTS.KEY_PHONE_NUMBER)) || "";
    }

    function saveCurrentMessage(currentMessage) {
      return setStorage(CONSTANTS.KEY_CURRENT_MSG, currentMessage || "");
    }

    async function getCurrentMessage() {
      return (await getStorage(CONSTANTS.KEY_CURRENT_MSG)) || "";
    }

    function savePhoneNumbersBulk(phoneNumbers) {
      return setStorage(
        CONSTANTS.KEY_PHONE_NUMBERS_BULK,
        JSON.stringify(Array.isArray(phoneNumbers) ? phoneNumbers : [])
      );
    }

    async function getPhoneNumbersBulk() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_PHONE_NUMBERS_BULK), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function saveCurrentMessageBulk(currentMessage) {
      return setStorage(CONSTANTS.KEY_CURRENT_MSG_BULK, currentMessage || "");
    }

    async function getCurrentMessageBulk() {
      const val = await getStorage(CONSTANTS.KEY_CURRENT_MSG_BULK);
      return typeof val === "string" ? val : "";
    }

    function saveActiveTab(activeTab) {
      return setStorage(CONSTANTS.KEY_ACTIVE_TAB, activeTab);
    }

    function getActiveTab() {
      return getStorage(CONSTANTS.KEY_ACTIVE_TAB);
    }

    function saveSingleMsgCountryCode(code) {
      return setStorage(CONSTANTS.KEY_SINGLE_MSG_COUNTRYCODE, code);
    }

    function getSingleMsgCountryCode() {
      return getStorage(CONSTANTS.KEY_SINGLE_MSG_COUNTRYCODE);
    }

    function saveISO2CountryCode(code) {
      return setStorage(CONSTANTS.KEY_COUNTRY_ISO2_CODE, code);
    }

    function getISO2CountryCode() {
      return getStorage(CONSTANTS.KEY_COUNTRY_ISO2_CODE);
    }

    function saveBulkMsgCountryCode(code) {
      return setStorage(CONSTANTS.KEY_BULK_MSG_COUNTRYCODE, code);
    }

    function getBulkMsgCountryCode() {
      return getStorage(CONSTANTS.KEY_BULK_MSG_COUNTRYCODE);
    }

    function setInstallTimeStamp() {
      return setStorage(CONSTANTS.KEY_INSTALL_TIMESTAMP, `${Date.now()}`);
    }

    function getInstallTimeStamp() {
      return getStorage(CONSTANTS.KEY_INSTALL_TIMESTAMP);
    }

    function saveAllContacts(allContacts) {
      return setStorage(
        CONSTANTS.KEY_ALL_CONTACTS,
        JSON.stringify(Array.isArray(allContacts) ? allContacts : [])
      );
    }

    async function getAllContacts() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_ALL_CONTACTS), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function saveAllAudiences(audiences) {
      return setStorage(
        CONSTANTS.KEY_ALL_AUDIENCES,
        JSON.stringify(Array.isArray(audiences) ? audiences : [])
      );
    }

    async function getAllAudiences() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_ALL_AUDIENCES), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    async function getCSVFileData() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_CSV_FILE_DATA), null);
      return Array.isArray(parsed) ? parsed : null;
    }

    function saveCSVFileData(data) {
      return setStorage(CONSTANTS.KEY_CSV_FILE_DATA, data ? JSON.stringify(data) : "");
    }

    async function getPhoneColumnNumber() {
      const columnStr = await getStorage(CONSTANTS.KEY_PHONE_COLUMN_NUMBER);
      if (columnStr !== undefined && columnStr !== null && columnStr !== "") {
        const parsed = parseInt(columnStr, 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return -1;
    }

    function savePhoneColumnNumber(phoneColumn) {
      return setStorage(CONSTANTS.KEY_PHONE_COLUMN_NUMBER, `${phoneColumn}`);
    }

    async function getFileName() {
      return (await getStorage(CONSTANTS.KEY_FILE_NAME)) || "";
    }

    function saveFileName(name) {
      return setStorage(CONSTANTS.KEY_FILE_NAME, name || "");
    }

    async function getDelay() {
      const delayStr = await getStorage(CONSTANTS.KEY_DELAY);
      if (delayStr !== undefined && delayStr !== null && delayStr !== "") {
        const parsed = parseInt(delayStr, 10);
        if (Number.isFinite(parsed) && parsed >= 1) {
          return parsed;
        }
      }
      return 2;
    }

    function saveDelay(delay) {
      const parsed = parseInt(delay, 10);
      const safeDelay = Number.isFinite(parsed) && parsed >= 1 ? parsed : 2;
      return setStorage(CONSTANTS.KEY_DELAY, `${safeDelay}`);
    }

    async function getCampaignOptions() {
      const def = {
        useTimeGap: true,
        minGapSec: 2,
        maxGapSec: 5,
        useBatching: false,
        batchSize: 20,
        batchPauseSec: 30,
        useSchedule: false,
        scheduledAt: ""
      };
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_CAMPAIGN_OPTIONS), null);
      return parsed && typeof parsed === "object" ? Object.assign({}, def, parsed) : def;
    }

    function saveCampaignOptions(opts) {
      return setStorage(CONSTANTS.KEY_CAMPAIGN_OPTIONS, JSON.stringify(opts || {}));
    }

    async function getSavedLists() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_SAVED_LISTS), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function saveSavedLists(lists) {
      return setStorage(CONSTANTS.KEY_SAVED_LISTS, JSON.stringify(Array.isArray(lists) ? lists : []));
    }

    async function getSavedAudiences() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_SAVED_AUDIENCES), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function saveSavedAudiences(list) {
      return setStorage(CONSTANTS.KEY_SAVED_AUDIENCES, JSON.stringify(Array.isArray(list) ? list : []));
    }

    async function getSavedTemplates() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_SAVED_TEMPLATES), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function saveSavedTemplates(templates) {
      return setStorage(
        CONSTANTS.KEY_SAVED_TEMPLATES,
        JSON.stringify(Array.isArray(templates) ? templates : [])
      );
    }

    async function getReportsHistory() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_REPORTS_HISTORY), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    async function appendReportHistory(entry) {
      if (!entry) return;
      const cur = await getReportsHistory();
      const filtered = cur.filter((x) => x && x.id !== entry.id);
      filtered.unshift(entry);
      return setStorage(CONSTANTS.KEY_REPORTS_HISTORY, JSON.stringify(filtered.slice(0, 12)));
    }

    async function getScheduledCampaign() {
      return safeParseJSON(await getStorage(CONSTANTS.KEY_SCHEDULED_CAMPAIGN), null);
    }

    function saveScheduledCampaign(obj) {
      return setStorage(CONSTANTS.KEY_SCHEDULED_CAMPAIGN, obj ? JSON.stringify(obj) : "");
    }

    async function getTourCompleted() {
      return (await getStorage(CONSTANTS.KEY_TOUR_COMPLETED)) === "true";
    }

    function setTourCompleted(flag) {
      return setStorage(CONSTANTS.KEY_TOUR_COMPLETED, flag ? "true" : "false");
    }

    async function getSelectedAudiences() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_SELECTED_AUDIENCES), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function saveSelectedAudiences(items) {
      return setStorage(
        CONSTANTS.KEY_SELECTED_AUDIENCES,
        JSON.stringify(Array.isArray(items) ? items : [])
      );
    }

    async function getSelectedContacts() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_SELECTED_CONTACTS), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function saveSelectedContacts(items) {
      return setStorage(
        CONSTANTS.KEY_SELECTED_CONTACTS,
        JSON.stringify(Array.isArray(items) ? items : [])
      );
    }

    async function getRecipientSource() {
      return (await getStorage(CONSTANTS.KEY_RECIPIENT_SOURCE)) || "numbers";
    }

    function saveRecipientSource(src) {
      return setStorage(CONSTANTS.KEY_RECIPIENT_SOURCE, src || "numbers");
    }

    function setIsFilterOperationRunning(flag) {
      return setStorage(CONSTANTS.KEY_IS_FILTER_OPERATION_RUNNING, flag ? "true" : "false");
    }

    async function getIsFilterOperationRunning() {
      return (await getStorage(CONSTANTS.KEY_IS_FILTER_OPERATION_RUNNING)) === "true";
    }

    function setIsSendOperationRunning(flag) {
      return setStorage(CONSTANTS.KEY_IS_SEND_OPERATION_RUNNING, flag ? "true" : "false");
    }

    async function getIsSendOperationRunning() {
      return (await getStorage(CONSTANTS.KEY_IS_SEND_OPERATION_RUNNING)) === "true";
    }

    function setIsSendOperationPaused(flag) {
      return setStorage(CONSTANTS.KEY_IS_SEND_OPERATION_PAUSED, flag ? "true" : "false");
    }

    async function getIsSendOperationPaused() {
      return (await getStorage(CONSTANTS.KEY_IS_SEND_OPERATION_PAUSED)) === "true";
    }

    function setIsFilterOperationPaused(flag) {
      return setStorage(CONSTANTS.KEY_IS_FILTER_OPERATION_PAUSED, flag ? "true" : "false");
    }

    async function getIsFilterOperationPaused() {
      return (await getStorage(CONSTANTS.KEY_IS_FILTER_OPERATION_PAUSED)) === "true";
    }

    function saveAttachmentData(attachmentObj) {
      return setStorage(
        CONSTANTS.KEY_ATTACHMENT_DATA,
        attachmentObj ? JSON.stringify(attachmentObj) : ""
      );
    }

    async function getAttachmentData() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_ATTACHMENT_DATA), null);
      if (parsed && parsed.dataUrl && parsed.name) {
        return parsed;
      }
      return null;
    }

    function clearAttachmentData() {
      return setStorage(CONSTANTS.KEY_ATTACHMENT_DATA, "");
    }

    function savePendingCSV(csvObj) {
      return setStorage(
        CONSTANTS.KEY_PENDING_CSV,
        csvObj ? JSON.stringify(csvObj) : ""
      );
    }

    async function getPendingCSV() {
      const parsed = safeParseJSON(await getStorage(CONSTANTS.KEY_PENDING_CSV), null);
      if (parsed && (typeof parsed.csvText === "string" || typeof parsed.base64Data === "string") && parsed.name) {
        return parsed;
      }
      return null;
    }

    function clearPendingCSV() {
      return setStorage(CONSTANTS.KEY_PENDING_CSV, "");
    }

    return {
      saveCurrentMessage,
      savePhoneNumber,
      getCurrentMessage,
      getPhoneNumber,
      saveCurrentMessageBulk,
      savePhoneNumbersBulk,
      getCurrentMessageBulk,
      getPhoneNumbersBulk,
      getActiveTab,
      saveActiveTab,
      saveSingleMsgCountryCode,
      getSingleMsgCountryCode,
      getAllContacts,
      saveAllContacts,
      getAllAudiences,
      saveAllAudiences,
      saveBulkMsgCountryCode,
      getBulkMsgCountryCode,
      getInstallTimeStamp,
      setInstallTimeStamp,
      setIsPro,
      getIsPro,
      getCSVFileData,
      saveCSVFileData,
      getPhoneColumnNumber,
      savePhoneColumnNumber,
      getFileName,
      saveFileName,
      saveISO2CountryCode,
      getISO2CountryCode,
      getDelay,
      saveDelay,
      getCampaignOptions,
      saveCampaignOptions,
      getSavedLists,
      saveSavedLists,
      getSavedAudiences,
      saveSavedAudiences,
      getSavedTemplates,
      saveSavedTemplates,
      getReportsHistory,
      appendReportHistory,
      getScheduledCampaign,
      saveScheduledCampaign,
      getTourCompleted,
      setTourCompleted,
      getSelectedAudiences,
      saveSelectedAudiences,
      getSelectedContacts,
      saveSelectedContacts,
      getRecipientSource,
      saveRecipientSource,
      setIsFilterOperationRunning,
      getIsFilterOperationRunning,
      setIsSendOperationRunning,
      getIsSendOperationRunning,
      setIsSendOperationPaused,
      getIsSendOperationPaused,
      setIsFilterOperationPaused,
      getIsFilterOperationPaused,
      saveAttachmentData,
      getAttachmentData,
      clearAttachmentData,
      savePendingCSV,
      getPendingCSV,
      clearPendingCSV
    };
  }

  function getAnalyticsInstance() {
    async function noop() {}
    return {
      logInstalls: noop,
      logRevisits: noop,
      logSingleMsgs: noop,
      logBulkMsgs: noop,
      logLogin: noop,
      logLoginFailed: noop,
      logSingleMsgDetail: noop,
      logBulkMessageDetail: noop,
      saveContactList: noop,
      saveInvitationList: noop,
      getUser: async () => ({}),
      getUserPro: async () => ({ isPro: true }),
      getIsPro: async () => true
    };
  }

  function getActiveTabInfo() {
    return new Promise((resolve) => {
      if (!chrome.tabs || !chrome.tabs.query) {
        resolve(null);
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
          resolve(null);
          return;
        }
        resolve(tabs[0]);
      });
    });
  }

  function getActiveTab() {
    return getActiveTabInfo().then((tab) => (tab ? tab.id : null));
  }

  function sendMsgToTab(tabId, msg) {
    return new Promise((resolve) => {
      if (!tabId) {
        resolve(undefined);
        return;
      }
      chrome.tabs.sendMessage(tabId, msg, (data) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(data);
      });
    });
  }

  function sendMsgToActiveTab(msg) {
    return getActiveTabInfo().then((tab) => {
      if (!tab || !tab.id) {
        return undefined;
      }
      if (tab.url && !tab.url.startsWith("https://web.whatsapp.com")) {
        return undefined;
      }
      return sendMsgToTab(tab.id, msg);
    });
  }

  function sendMsgToExtension(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  }

  try {
    global.getStorageInstance = getStorageInstance;
    global.getAnalyticsInstance = getAnalyticsInstance;
    global.getActiveTabInfo = getActiveTabInfo;
    global.getActiveTab = getActiveTab;
    global.sendMsgToTab = sendMsgToTab;
    global.sendMsgToActiveTab = sendMsgToActiveTab;
    global.sendMsgToExtension = sendMsgToExtension;
  } catch (_) {}
})(typeof globalThis !== "undefined" ? globalThis : self);
