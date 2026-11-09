/**
 * PickupChecker iPhone Duo stock watch (INDEPENDENT from original Apple monitor).
 *
 * Free documented API: https://pickupchecker.com/iphone-duo-stock-api
 * Endpoint: one US-wide stock request per minute; no API key required.
 *
 * Product: iPhone Duo · 256GB · Star White.
 * Stores: R613 Evergreen Walk, R025 Westfarms.
 * Emails: project owner + ADDITIONAL_ALERT_EMAILS Script Property.
 *
 * Usage in NEW / second Google Apps Script project:
 *   testEmail -> testParser -> testPickupChecker -> startEveryMinute
 * DO NOT overwrite the original Apple-monitor project.
 */

const PC_CONFIG = {
  apiUrl: "https://pickupchecker.com/api/v1/us/stock?model=duo",
  sourceUrl: "https://pickupchecker.com/iphone-duo-stock-api",
  appleBuyUrl: "https://www.apple.com/shop/buy-iphone/iphone-duo",
  storage: "256GB",
  color: "Star White",
  maxDataAgeSeconds: 180,
  stores: [
    {number: "R613", name: "Evergreen Walk", city: "South Windsor"},
    {number: "R025", name: "Westfarms", city: "Farmington"}
  ]
};

function pcProps_() {
  return PropertiesService.getScriptProperties();
}

function pcRecipients_() {
  const owner = Session.getEffectiveUser().getEmail();
  if (!owner) throw new Error("Cannot determine owner Gmail.");
  const additional = (pcProps_().getProperty("ADDITIONAL_ALERT_EMAILS") || "")
    .split(/[;,]/)
    .map(v => v.trim())
    .filter(Boolean);
  return Array.from(new Set([owner, ...additional])).join(",");
}

function testEmail() {
  MailApp.sendEmail({
    to: pcRecipients_(),
    subject: "[PickupChecker TEST] iPhone Duo 双门店库存监控",
    body: "仅为测试邮件，不代表有货。\n" +
          "新监控读取 PickupChecker 免费 API；旧 Apple 直查监控不受影响。\n\n" +
          "Source: PickupChecker — https://pickupchecker.com/"
  });
  console.log("PickupChecker test email submitted.");
}

function pcNormalize_(x) {
  return String(x == null ? "" : x).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pcValidDate_(value, label) {
  if (typeof value !== "string") throw new Error(label + " timestamp missing.");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(label + " timestamp malformed.");
  const ageSeconds = (Date.now() - ms) / 1000;
  if (ageSeconds > PC_CONFIG.maxDataAgeSeconds || ageSeconds < -300) {
    throw new Error(label + " data is too old or future-dated (" +
                    Math.round(ageSeconds) + " seconds from now).");
  }
  return ms;
}

function pcParseStore_(payload, config) {
  if (!payload || !Array.isArray(payload.stores)) {
    throw new Error("PickupChecker payload has no stores array.");
  }
  const matches = payload.stores.filter(s => s.store_number === config.number);
  if (matches.length !== 1) {
    throw new Error(config.name + " (" + config.number + ") missing or duplicated in API.");
  }
  const s = matches[0];
  if (typeof s.in_stock !== "boolean" || !Array.isArray(s.available)) {
    throw new Error(config.name + ": inventory fields absent or malformed.");
  }
  pcValidDate_(s.last_checked_at, config.name + " last_checked_at");
  if (s.in_stock === false && s.available.length > 0) {
    throw new Error(config.name + ": inconsistent in_stock and available fields.");
  }

  const matching = s.available.filter(a =>
    a && typeof a === "object" &&
    pcNormalize_(a.storage) === pcNormalize_(PC_CONFIG.storage) &&
    pcNormalize_(a.color) === pcNormalize_(PC_CONFIG.color)
  );
  const available = s.in_stock === true && matching.length > 0;
  return {
    store: config,
    available: available,
    lastChecked: s.last_checked_at,
    partNumber: available ? String(matching[0].part_number || "") : "",
    otherConfigurations: s.available.length
  };
}

function pcReadApi_() {
  const props = pcProps_();
  const until = Number(props.getProperty("pcRetryAfterUntil") || "0");
  if (Date.now() < until) {
    throw new Error("PickupChecker API requested a pause until " +
                    new Date(until).toISOString() + " (Retry-After).");
  }

  // Public documented endpoint; contact identifier lets the API operator find this project.
  const contact = props.getProperty("PICKUPCHECKER_CONTACT") ||
                  "https://github.com/williamccc7/duo-stock-watch";
  const response = UrlFetchApp.fetch(PC_CONFIG.apiUrl, {
    method: "get",
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "Accept": "application/json",
      "User-Agent": "DuoStockWatch/1.0 (contact: " + contact + ")"
    }
  });
  const http = response.getResponseCode();
  if (http === 429) {
    const headers = response.getAllHeaders();
    let retryValue = "";
    Object.keys(headers).forEach(k => {
      if (k.toLowerCase() === "retry-after") retryValue = String(headers[k]);
    });
    let pauseSeconds = 60;
    if (/^\d+$/.test(retryValue)) {
      pauseSeconds = Math.max(30, Number(retryValue));
    } else if (retryValue) {
      const retryAt = Date.parse(retryValue);
      if (Number.isFinite(retryAt)) {
        pauseSeconds = Math.max(30, Math.ceil((retryAt - Date.now()) / 1000));
      }
    }
    props.setProperty("pcRetryAfterUntil", String(Date.now() + pauseSeconds * 1000));
    throw new Error("PickupChecker HTTP 429; respecting Retry-After " +
                    pauseSeconds + " seconds.");
  }
  if (http !== 200) {
    throw new Error("PickupChecker HTTP " + http + "; this is not an out-of-stock result.");
  }
  let payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error("PickupChecker did not return valid JSON.");
  }
  if (!payload || !Array.isArray(payload.stores)) {
    throw new Error("PickupChecker response missing stores array.");
  }
  // API documentation promises generated_at + US model=duo inventory.
  pcValidDate_(payload.generated_at, "PickupChecker generated_at");
  if (payload.country && payload.country.code &&
      String(payload.country.code).toLowerCase() !== "us") {
    throw new Error("Unexpected API country: " + payload.country.code);
  }
  return payload;
}

// Offline simulated cases: available exact match, wrong color, sold out,
// and store identity. No network, emails or saved state used.
function testParser() {
  const now = new Date().toISOString();
  const make = (stock, products) => ({
    generated_at: now,
    country: {code: "us"},
    stores: [{store_number: "R613", name: "Evergreen Walk",
              in_stock: stock, last_checked_at: now, available: products}]
  });
  const target = {storage:"256GB", color:"Star White", part_number:"example"};
  const wrong = {storage:"256GB", color:"Night Sky", part_number:"other"};
  const store = PC_CONFIG.stores[0];
  if (!pcParseStore_(make(true,[target]),store).available) throw new Error("Exact-match test failed.");
  if (pcParseStore_(make(true,[wrong]),store).available) throw new Error("Wrong-color test failed.");
  if (pcParseStore_(make(false,[]),store).available) throw new Error("Sold-out test failed.");
  let missingRejected = false;
  try {pcParseStore_(make(false,[]),PC_CONFIG.stores[1]);}
  catch (e) {missingRejected = true;}
  if (!missingRejected) throw new Error("Missing-store test failed.");
  console.log("PickupChecker parser: all four offline tests passed.");
}

// Test actual JSON without sending stock alerts or changing stock history.
function testPickupChecker() {
  const data = pcReadApi_();
  console.log("Source: PickupChecker — " + PC_CONFIG.sourceUrl);
  console.log("API generated_at: " + data.generated_at);
  for (const store of PC_CONFIG.stores) {
    try {
      const info = pcParseStore_(data,store);
      console.log(store.name + " (" + store.number + "): " +
        (info.available ? "TARGET IN STOCK" : "Target currently unavailable") +
        "; other available Duo configurations=" + info.otherConfigurations +
        "; last checked=" + info.lastChecked);
    } catch (err) {
      console.error("STORE VALIDATION FAILED: " + String(err));
      throw err;
    }
  }
  console.log("Both stores successfully validated. No state changes or emails.");
}

function checkPickupStock() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log("PickupChecker previous run still active; skipping overlap.");
    return;
  }
  const props = pcProps_();
  try {
    const payload = pcReadApi_();
    const failures = [];
    for (const store of PC_CONFIG.stores) {
      try {
        const info = pcParseStore_(payload,store);
        const key = "pcWasAvailable_" + store.number;
        const last = props.getProperty(key) === "true";

        if (info.available && !last) {
          MailApp.sendEmail({
            to: pcRecipients_(),
            subject: "🚨 [PickupChecker] iPhone Duo 白色 256GB — " + store.name + " 有货！",
            body: "PickupChecker 显示 Apple " + store.name + " 的目标配置有货：\n" +
                  "iPhone Duo · 256GB · Star White\n" +
                  "门店：" + store.name + " (" + store.number + ")，" + store.city + "\n" +
                  "最后查询时间 (UTC)：" + info.lastChecked + "\n\n" +
                  "请尽快到 Apple 官网确认并下单：\n" +
                  PC_CONFIG.appleBuyUrl + "\n\n" +
                  "No trade-in / Connect to any carrier later 请在结账时确认。\n" +
                  "第三方数据可能延迟，不代表已预留库存。\n\n" +
                  "Source: PickupChecker — https://pickupchecker.com/"
          });
          console.log(store.name + ": TARGET IN STOCK — Gmail submitted.");
        } else {
          console.log(store.name + ": " +
            (info.available ? "Still available; repeated email suppressed." :
                              "Target currently unavailable.") +
            " (last checked " + info.lastChecked + ")");
        }

        // Only commit after a trustworthy parse and any required email succeeds.
        props.setProperties({
          [key]: String(info.available),
          ["pcLastChecked_" + store.number]: info.lastChecked,
          ["pcLastRun_" + store.number]: new Date().toISOString()
        });
      } catch (err) {
        console.error("PickupChecker store failure: " + String(err));
        failures.push(String(err));
      }
    }
    if (failures.length) {
      throw new Error(failures.length + " store(s) failed: " + failures.join(" | "));
    }
    props.setProperty("pcConsecutiveErrors","0");
    props.deleteProperty("pcRetryAfterUntil");
  } catch (err) {
    console.error("PickupChecker inventory check failed: " + String(err));
    // Do not change prior stock state on HTTP errors, bad JSON or stale data.
    const count = Number(props.getProperty("pcConsecutiveErrors") || "0") + 1;
    props.setProperty("pcConsecutiveErrors",String(count));
    const now = Date.now();
    const lastMail = Number(props.getProperty("pcLastErrorEmail") || "0");
    if (count >= 3 && now - lastMail > 6 * 60 * 60 * 1000) {
      try {
        MailApp.sendEmail({
          to: pcRecipients_(),
          subject: "⚠️ [PickupChecker] iPhone Duo 库存查询异常",
          body: "PickupChecker 连续 " + count + " 次执行无法获取完整、可靠的库存数据。\n" +
                "不能视为缺货；Apple 原监控仍独立运行。\n" +
                "最近错误：" + String(err).slice(0,500) + "\n\n" +
                "Source: PickupChecker — https://pickupchecker.com/"
        });
        props.setProperty("pcLastErrorEmail",String(now));
      } catch (emailErr) {
        console.error("Could not send error email: " + String(emailErr));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function startEveryMinute() {
  // Only modifies triggers in THIS PickupChecker project, never the Apple project.
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === "checkPickupStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger("checkPickupStock").timeBased().everyMinutes(1).create();
  console.log("PickupChecker: one-minute time-based trigger installed.");
}

function stopMonitoring() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === "checkPickupStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  console.log("PickupChecker trigger stopped; Apple original monitor untouched.");
}

function showStatus() {
  const props = pcProps_();
  for (const store of PC_CONFIG.stores) {
    console.log(store.name + ": previously available=" +
      (props.getProperty("pcWasAvailable_" + store.number) || "unknown") +
      "; last checked=" +
      (props.getProperty("pcLastChecked_" + store.number) || "never"));
  }
  console.log("Consecutive errors: " +
              (props.getProperty("pcConsecutiveErrors") || "0"));
  console.log("Source: PickupChecker — https://pickupchecker.com/");
  console.log("PickupChecker trigger count: " +
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === "checkPickupStock").length);
}
