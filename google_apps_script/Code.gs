/**
 * iPhone Duo · Apple Evergreen Walk · 1-minute pickup stock watch
 *
 * Paste into a private Google Apps Script project linked to your Gmail account.
 * Uses no passwords and never attempts to purchase a phone.
 *
 * After pasting:
 *   1. Run testEmail() and authorize Google permissions.
 *   2. Run checkStock() once; review Execution log.
 *   3. Run startEveryMinute() once to install a 1-minute trigger.
 *   4. Later, run stopMonitoring() to stop.
 */

const CONFIG = {
  sku: "MK1E4LL/A",
  storeNumber: "R613",
  storeName: "Evergreen Walk",
  title: "iPhone Duo 256GB Star White",
  zipCode: "06066",
  purchaseUrl: "https://www.apple.com/shop/buy-iphone/iphone-duo",
  appleUrl: "https://www.apple.com/shop/retail/pickup-message"
};

function recipient_() {
  // A time-triggered script runs as the Google user who installed it.
  const email = Session.getEffectiveUser().getEmail();
  if (!email) {
    throw new Error("Could not identify your Gmail address. Sign in to the intended Google account.");
  }
  return email;
}

function testEmail() {
  MailApp.sendEmail({
    to: recipient_(),
    subject: "TEST — iPhone Duo 1-minute monitor",
    body: "This is a test message only. The phone has NOT been confirmed in stock.\n" +
          "After receiving this, run checkStock() once, then startEveryMinute()."
  });
  console.log("Test email submitted to Gmail.");
}

function checkStock() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log("Previous check is still running. Skipped to avoid overlap.");
    return;
  }
  const state = PropertiesService.getScriptProperties();
  try {
    const query = "?pl=true&location=" + encodeURIComponent(CONFIG.zipCode) +
                  "&parts.0=" + encodeURIComponent(CONFIG.sku);
    const res = UrlFetchApp.fetch(CONFIG.appleUrl + query, {
      method: "get",
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": CONFIG.purchaseUrl
      }
    });

    const code = res.getResponseCode();
    if (code !== 200) {
      throw new Error("Apple returned HTTP " + code + ". Do not interpret as out of stock.");
    }

    let data;
    try {
      data = JSON.parse(res.getContentText());
    } catch (e) {
      throw new Error("Apple returned non-JSON data; its endpoint may have changed.");
    }
    if (!data || !data.head || String(data.head.status) !== "200" ||
        !data.body || !Array.isArray(data.body.stores)) {
      throw new Error("Apple inventory response structure is unexpected.");
    }

    const stores = data.body.stores.filter(s => s.storeNumber === CONFIG.storeNumber);
    if (stores.length !== 1 || stores[0].storeName !== CONFIG.storeName) {
      throw new Error("Target Apple Evergreen Walk store not found or mismatched.");
    }

    const store = stores[0];
    const item = store.partsAvailability && store.partsAvailability[CONFIG.sku];
    if (!item) {
      throw new Error("Requested SKU missing from store inventory response.");
    }
    const title = item.messageTypes &&
                  item.messageTypes.regular &&
                  item.messageTypes.regular.storePickupProductTitle;
    if (title && title.trim().toLowerCase() !== CONFIG.title.toLowerCase()) {
      throw new Error("SKU product title mismatch: " + title);
    }

    if (item.pickupDisplay !== "available" && item.pickupDisplay !== "unavailable") {
      throw new Error("Unrecognized pickup status: " + item.pickupDisplay);
    }
    if (item.pickupDisplay === "available" && item.storePickEligible !== true) {
      throw new Error("Available status without Store Pickup eligibility.");
    }

    const available = item.pickupDisplay === "available";
    const wasAvailable = state.getProperty("wasAvailable") === "true";

    if (available && !wasAvailable) {
      MailApp.sendEmail({
        to: recipient_(),
        subject: "🚨 iPhone Duo 白色 256GB — Evergreen Walk 有货！",
        body: "Apple Evergreen Walk 可能有以下配置可到店自取：\n" +
              "iPhone Duo · Star White · 256GB\n" +
              "No Trade-in · Connect to any carrier later（购买时确认）\n" +
              "门店：Apple Evergreen Walk · R613\n\n" +
              "请尽快通过 Apple 官网确认并下单：\n" + CONFIG.purchaseUrl +
              "\n\n库存可能很快变化；本邮件不代表已经预留商品。"
      });
      console.log("New stock found; Gmail alert sent.");
    } else {
      console.log(available ? "Still available; repeated alert suppressed." : "Currently unavailable.");
    }

    state.setProperties({
      wasAvailable: String(available),
      lastSuccessfulCheck: new Date().toISOString(),
      lastPickupDisplay: item.pickupDisplay,
      consecutiveErrors: "0"
    });
  } catch (err) {
    console.error("Inventory check failed: " + String(err));
    const errors = Number(state.getProperty("consecutiveErrors") || 0) + 1;
    state.setProperty("consecutiveErrors", String(errors));
    const now = Date.now();
    const lastAlert = Number(state.getProperty("lastErrorMail") || "0");

    // If Apple changes the endpoint, explain the outage without spamming Gmail.
    if (errors >= 3 && now - lastAlert > 6 * 60 * 60 * 1000) {
      try {
        MailApp.sendEmail({
          to: recipient_(),
          subject: "⚠️ iPhone Duo 库存监控遇到错误",
          body: "连续 " + errors + " 次库存查询失败。\n" +
                "这不意味着没有库存，请检查 Google Apps Script 的运行记录。\n\n" +
                "最新错误：" + String(err).slice(0, 450)
        });
        state.setProperty("lastErrorMail", String(now));
      } catch (mailError) {
        console.error("Could not send error email: " + String(mailError));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function startEveryMinute() {
  // Idempotent: delete any previous copy so it cannot alert twice per minute.
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === "checkStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger("checkStock").timeBased().everyMinutes(1).create();
  console.log("1-minute Google Apps Script trigger installed.");
}

function stopMonitoring() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === "checkStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  console.log("1-minute monitor stopped.");
}

function showStatus() {
  const props = PropertiesService.getScriptProperties().getProperties();
  console.log("Last successful check: " + (props.lastSuccessfulCheck || "never"));
  console.log("Pickup status: " + (props.lastPickupDisplay || "unknown"));
  console.log("Consecutive errors: " + (props.consecutiveErrors || "0"));
  console.log("Triggers installed: " + ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "checkStock").length);
}
