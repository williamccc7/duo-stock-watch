/**
 * iPhone Duo 256GB Star White | Evergreen Walk + Westfarms
 *
 * One inventory request checks both stores. Alerts are tracked separately.
 * Uses the existing checkStock time-driven trigger; NO extra trigger is needed.
 */
const CONFIG = {
  sku: "MK1E4LL/A",
  title: "iPhone Duo 256GB Star White",
  zipCode: "06032",
  purchaseUrl: "https://www.apple.com/shop/buy-iphone/iphone-duo",
  appleUrl: "https://www.apple.com/shop/retail/pickup-message",
  stores: [
    { number: "R613", name: "Evergreen Walk",
      address: "401 Evergreen Walk, South Windsor, CT 06074" },
    { number: "R025", name: "Westfarms",
      address: "500 Westfarms Mall, Farmington, CT 06032" }
  ]
};

function recipient_() {
  const email = Session.getEffectiveUser().getEmail();
  if (!email) throw new Error("Cannot determine Gmail account.");
  return email;
}

// Use a private Apps Script property rather than publishing recipients in a public repository.
// Set ADDITIONAL_ALERT_EMAILS in Apps Script Project Settings -> Script Properties.
function recipients_() {
  const primary = recipient_();
  const extras = (PropertiesService.getScriptProperties()
    .getProperty("ADDITIONAL_ALERT_EMAILS") || "")
    .split(/[;,]/)
    .map(email => email.trim())
    .filter(Boolean);
  return Array.from(new Set([primary, ...extras])).join(",");
}

function testEmail() {
  MailApp.sendEmail({
    to: recipients_(),
    subject: "TEST — iPhone Duo two-store stock monitor",
    body: "Test only. Evergreen Walk and Westfarms are now configured. This is not a stock alert."
  });
  console.log("Test email submitted.");
}

function readAppleInventory_() {
  // Apple returns Westfarms AND Evergreen Walk in the same response for 06032.
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
  const http = res.getResponseCode();
  if (http !== 200) {
    throw new Error("Apple returned HTTP " + http + ". Do not interpret as out of stock.");
  }
  let data;
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    throw new Error("Apple returned invalid JSON.");
  }
  if (!data || !data.head || String(data.head.status) !== "200" ||
      !data.body || !Array.isArray(data.body.stores)) {
    throw new Error("Apple response structure changed or is incomplete.");
  }
  return data.body.stores;
}

function evaluateStore_(stores, config, props) {
  const matches = stores.filter(s => s.storeNumber === config.number);
  if (matches.length !== 1 || matches[0].storeName !== config.name) {
    throw new Error(config.name + " missing or mismatched in Apple inventory response.");
  }
  const item = matches[0].partsAvailability &&
               matches[0].partsAvailability[CONFIG.sku];
  if (!item) throw new Error(config.name + ": requested SKU missing.");
  const title = item.messageTypes && item.messageTypes.regular &&
                item.messageTypes.regular.storePickupProductTitle;
  if (title && title.trim().toLowerCase() !== CONFIG.title.toLowerCase()) {
    throw new Error(config.name + ": product title mismatch: " + title);
  }
  const display = item.pickupDisplay;
  if (display !== "available" && display !== "unavailable") {
    throw new Error(config.name + ": unexpected pickup status: " + display);
  }
  if (display === "available" && item.storePickEligible !== true) {
    throw new Error(config.name + ": pickup eligibility not confirmed.");
  }

  const available = display === "available";
  const key = "wasAvailable_" + config.number;
  const previous = props.getProperty(key);
  // Keep the original Evergreen Walk status when upgrading from the old script.
  const wasAvailable = previous === null && config.number === "R613"
    ? props.getProperty("wasAvailable") === "true"
    : previous === "true";

  if (available && !wasAvailable) {
    MailApp.sendEmail({
      to: recipients_(),
      subject: "🚨 iPhone Duo 白色 256GB — Apple " + config.name + " 有货！",
      body: "Apple " + config.name + " 可能有以下配置可到店自取：\n" +
            CONFIG.title + "\n" +
            "No Trade-in · Connect to any carrier later（购买时确认）\n" +
            "门店：" + config.address + "\n\n" +
            "立即前往 Apple 官网确认：\n" + CONFIG.purchaseUrl + "\n\n" +
            "库存随时可能变化，本提醒不等于已经预留。"
    });
    console.log(config.name + ": NEW STOCK — Gmail alert sent!");
  } else {
    console.log(config.name + ": " +
      (available ? "Still available; repeat email suppressed." : "Currently unavailable."));
  }
  // Persist each store independently; one store cannot overwrite the other.
  props.setProperties({
    [key]: String(available),
    ["lastPickupDisplay_" + config.number]: display,
    ["lastSuccessfulCheck_" + config.number]: new Date().toISOString()
  });
}

function checkStock() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log("Previous check still running; skip overlapping execution.");
    return;
  }
  const props = PropertiesService.getScriptProperties();
  try {
    const until = Number(props.getProperty("cooldownUntil") || "0");
    if (Date.now() < until) {
      console.warn("Apple HTTP 541 cooldown active until " +
                   new Date(until).toISOString());
      return;
    }
    const stores = readAppleInventory_();
    const errors = [];
    for (const store of CONFIG.stores) {
      try {
        evaluateStore_(stores, store, props);
      } catch (err) {
        console.error("Store error: " + String(err));
        errors.push(String(err));
      }
    }
    if (errors.length) {
      // Successful stores were updated. An unknown store is not treated as out of stock.
      throw new Error("Incomplete store checks: " + errors.join("; "));
    }
    props.setProperties({
      lastSuccessfulCheck: new Date().toISOString(),
      consecutiveErrors: "0",
      consecutive541: "0",
      cooldownUntil: "0"
    });
  } catch (err) {
    console.error("Inventory check failed: " + String(err));
    const errors = Number(props.getProperty("consecutiveErrors") || "0") + 1;
    props.setProperty("consecutiveErrors", String(errors));
    const now = Date.now();
    const is541 = String(err).includes("Apple returned HTTP 541");
    const consecutive541 = is541
      ? Number(props.getProperty("consecutive541") || "0") + 1 : 0;
    props.setProperty("consecutive541", String(consecutive541));
    if (consecutive541 >= 2) {
      const minutes = Math.min(15, 5 * Math.pow(2, consecutive541 - 2));
      const until = now + minutes * 60000;
      props.setProperty("cooldownUntil", String(until));
      console.warn("HTTP 541 repeated " + consecutive541 +
                   " times; pausing for " + minutes + " minutes.");
    }
    const lastAlert = Number(props.getProperty("lastErrorMail") || "0");
    if (errors >= 3 && now - lastAlert > 6 * 60 * 60 * 1000) {
      try {
        MailApp.sendEmail({
          to: recipients_(),
          subject: "⚠️ iPhone Duo 两店库存监控遇到错误",
          body: "连续 " + errors + " 次检查出现错误。这不意味着没有库存。\n" +
                "请在 Google Apps Script 查看执行日志。\n\n" +
                "错误：" + String(err).slice(0, 500)
        });
        props.setProperty("lastErrorMail", String(now));
      } catch (mailErr) {
        console.error("Could not send error email: " + String(mailErr));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function startEveryMinute() {
  // Optional reinstall; NOT needed when an existing checkStock trigger works.
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === "checkStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger("checkStock").timeBased().everyMinutes(1).create();
  console.log("One-minute stock trigger installed.");
}

function stopMonitoring() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === "checkStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  console.log("Monitoring stopped.");
}

function showStatus() {
  const p = PropertiesService.getScriptProperties().getProperties();
  for (const store of CONFIG.stores) {
    console.log(store.name + ": " +
      (p["lastPickupDisplay_" + store.number] || "not yet checked") +
      " / last checked " + (p["lastSuccessfulCheck_" + store.number] || "never"));
  }
  console.log("Consecutive errors: " + (p.consecutiveErrors || "0"));
  console.log("Consecutive 541: " + (p.consecutive541 || "0"));
  const until = Number(p.cooldownUntil || "0");
  console.log("Cooldown: " +
    (until > Date.now() ? "until " + new Date(until).toISOString() : "not active"));
  console.log("Number of checkStock triggers: " +
    ScriptApp.getProjectTriggers().filter(
      t => t.getHandlerFunction() === "checkStock").length);
}
