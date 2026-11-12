/**
 * Aura Messaging - Main World File Picker Bridge
 * Intercepts ephemeral <input type="file">.click() calls triggered by WhatsApp Web's
 * WAWebAttachMenuFilePicker ONLY while armed by Aura's content script.
 */
(function () {
  if (typeof window.__auraAttachBridgeTeardown === "function") {
    try {
      window.__auraAttachBridgeTeardown();
    } catch (_) {}
  }

  let pending = null;
  const origClick = HTMLInputElement.prototype.click;
  const filesDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");

  function getTargetOrigin() {
    const o = window.location && window.location.origin;
    return o && o !== "null" ? o : "*";
  }

  function postReply(type, token, extra = {}) {
    try {
      window.postMessage(
        Object.assign({ __auraBridge: type, token }, extra),
        getTargetOrigin()
      );
    } catch (_) {}
  }

  function onWindowMessage(event) {
    if (!event || event.source !== window || !event.data) {
      return;
    }
    const msg = event.data;
    if (msg.__auraBridge === "PING" && msg.token) {
      postReply("PONG", msg.token);
      return;
    }
    if (msg.__auraBridge === "DISARM") {
      if (!msg.token || (pending && pending.token === msg.token)) {
        pending = null;
      }
      return;
    }
    if (msg.__auraBridge === "ARM_FILE" && msg.token && msg.buffer) {
      try {
        const blobOrBytes = new Uint8Array(msg.buffer);
        const file = new File([blobOrBytes], msg.name || "attachment", {
          type: msg.mime || "application/octet-stream",
          lastModified: Number(msg.lastModified) || Date.now()
        });
        pending = {
          token: msg.token,
          file,
          expiresAt: Date.now() + (Number(msg.ttlMs) || 5000)
        };
        postReply("ARMED_ACK", msg.token);
      } catch (err) {
        pending = null;
        postReply("ARM_ERROR", msg.token, { error: String(err && err.message || err) });
      }
    }
  }

  HTMLInputElement.prototype.click = function () {
    if (pending && Date.now() <= pending.expiresAt && String(this.type || "").toLowerCase() === "file") {
      const consumed = pending;
      pending = null;
      try {
        const dt = new DataTransfer();
        dt.items.add(consumed.file);
        if (filesDescriptor && filesDescriptor.set) {
          filesDescriptor.set.call(this, dt.files);
        } else {
          this.files = dt.files;
        }
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        postReply("FILE_INJECTED", consumed.token, { name: consumed.file.name, type: consumed.file.type });
        return;
      } catch (err) {
        postReply("INJECT_ERROR", consumed.token, { error: String(err && err.message || err) });
      }
    }
    return origClick.apply(this, arguments);
  };

  window.addEventListener("message", onWindowMessage);

  window.__auraAttachBridgeTeardown = function () {
    pending = null;
    window.removeEventListener("message", onWindowMessage);
    if (HTMLInputElement.prototype.click !== origClick) {
      HTMLInputElement.prototype.click = origClick;
    }
  };
})();
