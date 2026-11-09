/**
 * InStock Radar | Separate personal iPhone Duo monitor
 * DATA SOURCE: https://instockradar.com/us/store/{store}
 *
 * This is a NEW Google Apps Script project. It does not affect the existing
 * Apple pickup-message monitor. Ask the site operator for permission (user confirmed).
 *
 * Desired device: iPhone Duo, 256 GB, Star White.
 * Stores: Evergreen Walk (South Windsor), Westfarms (Farmington).
 * Alerts: project owner + optional ADDITIONAL_ALERT_EMAILS Script Property.
 *
 * Install: testEmail -> testParser -> diagnoseRadarOnce (when needed) -> testRadarSource -> startEveryMinute.
 * No Deployment is required.
 */

const RADAR_CONFIG = {
  model: "iPhone Duo",
  variant: "256 GB Star White",
  appleShopUrl: "https://www.apple.com/shop/buy-iphone/iphone-duo",
  maxAgeSeconds: 300,
  stores: [
    {id: "R613", name: "Evergreen Walk",
     url: "https://instockradar.com/us/store/evergreenwalk"},
    {id: "R025", name: "Westfarms",
     url: "https://instockradar.com/us/store/westfarms"}
  ]
};

function radarRecipients_() {
  const primary = Session.getEffectiveUser().getEmail();
  if (!primary) throw new Error("Google account email unavailable.");
  const extras = (PropertiesService.getScriptProperties()
    .getProperty("ADDITIONAL_ALERT_EMAILS") || "")
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(Boolean);
  return Array.from(new Set([primary, ...extras])).join(",");
}

function testEmail() {
  MailApp.sendEmail({
    to: radarRecipients_(),
    subject: "[Radar TEST] iPhone Duo 双门店库存监控",
    body: "这是一封 InStock Radar 新监控的测试邮件，不代表手机有货。\n" +
          "旧版直接查询 Apple 的监控不受影响。"
  });
  console.log("Radar test email submitted to: " + radarRecipients_());
}

// Converts *server-returned* HTML into readable text. This never executes JS.
// If the website switches to client-only rendering, the parser fails safely.
function radarHtmlText_(html) {
  return html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

// Only the iPhone Duo product card is considered. Last-restock history,
// other models and advertising copy MUST NOT trigger an alert.
function parseRadarPage_(html, store) {
  const text = radarHtmlText_(html);
  if (!text.includes("iPhone stock at Apple " + store.name)) {
    throw new Error(store.name + ": store page identity not verified.");
  }
  const heading = "All models at this store";
  const start = text.indexOf(heading);
  if (start < 0) {
    throw new Error(store.name + ": inventory cards missing (possibly client-rendered HTML).");
  }
  const afterHeading = text.slice(start + heading.length);
  const end = afterHeading.indexOf("Nearby Apple Stores");
  if (end < 0) {
    throw new Error(store.name + ": end of inventory section missing.");
  }
  const inventory = afterHeading.slice(0, end);
  const match = /\biPhone\s+Duo\s*(?:\$\s*[\d,]+(?:\.\d+)?\s*\+?\s*)?(In\s+stock|Sold\s+out)\b/i.exec(inventory);
  if (!match) {
    throw new Error(store.name + ": iPhone Duo card/status not found (page changed).");
  }
  const status = match[1].replace(/\s+/g, " ").toLowerCase();
  const rest = inventory.slice(match.index + match[0].length);
  const nextProduct = /\biPhone\s+18\s+Pro\s+Max\b|\biPhone\s+18\s+Pro\b/i.exec(rest);
  if (!nextProduct) {
    throw new Error(store.name + ": next product boundary missing.");
  }
  const cardBody = rest.slice(0, nextProduct.index);
  const checked = /\bchecked\s+(now|\d+\s*(?:sec(?:onds?)?|min(?:utes?)?|hr|hours?|days?)\.?\s*ago)\b/i.exec(cardBody);
  if (!checked) {
    throw new Error(store.name + ": latest-check time missing; refusing to trust page.");
  }
  const freshnessText = checked[1].toLowerCase();
  let ageSeconds = 0;
  if (freshnessText !== "now") {
    const m = /^(\d+)\s*(sec|min|hr|hour|day)/.exec(freshnessText);
    if (!m) throw new Error(store.name + ": unrecognized checked age.");
    ageSeconds = Number(m[1]) *
      (m[2] === "sec" ? 1 : m[2] === "min" ? 60 : m[2] === "hr" || m[2] === "hour" ? 3600 : 86400);
  }
  if (ageSeconds > RADAR_CONFIG.maxAgeSeconds) {
    throw new Error(store.name + ": inventory card is stale (" + freshnessText + ").");
  }

  // A model can be "In stock" only in a *different* storage/color variant.
  // The exact 256 GB Star White option must also appear in this model's card.
  const targetAvailable =
    status === "in stock" && /\b256\s*GB\s+Star\s+White\b/i.test(cardBody);
  return {
    targetAvailable: targetAvailable,
    modelStatus: status,
    checked: freshnessText,
    variantPresent: /\b256\s*GB\s+Star\s+White\b/i.test(cardBody)
  };
}

// Pure parser checks (no network, no email, no state changes).
function testParser() {
  const store = RADAR_CONFIG.stores[0];
  const makePage = (status, variant, checked) =>
    '<html><head><title>ignored</title></head><body>' +
    '<h1>iPhone stock at Apple Evergreen Walk: iPhone Duo</h1>' +
    '<h2>All models at this store</h2>' +
    '<p>Free: you watch. Paid: we watch for you. iPhone Duo, on iPhone with Safari.</p>' +
    '<h3>iPhone Duo</h3><span>$1,999+</span><b>' + status + '</b>' +
    '<a>' + variant + '</a><span>checked ' + checked + '</span>' +
    '<h3>iPhone 18 Pro Max</h3><b>In stock</b>' +
    '<a>256 GB Star White</a><h2>Nearby Apple Stores</h2>' +
    '</body></html>';
  const tests = [
    [makePage("Sold out", "256 GB Star White", "5 sec. ago"), false],
    [makePage("In stock", "256 GB Night Sky", "10 sec. ago"), false],
    [makePage("In stock", "256 GB Star White", "2 sec. ago"), true]
  ];
  tests.forEach((test, i) => {
    const got = parseRadarPage_(test[0], store).targetAvailable;
    if (got !== test[1]) throw new Error("Parser test " + (i + 1) + " failed.");
  });
  let staleRejected = false;
  try { parseRadarPage_(makePage("In stock", "256 GB Star White", "9 min. ago"), store); }
  catch (_) { staleRejected = true; }
  if (!staleRejected) throw new Error("Stale-page test failed.");
  console.log("All four parser checks passed.");
}

function radarFetchResults_() {
  const requests = RADAR_CONFIG.stores.map(store => ({
    url: store.url,
    method: "get",
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      "Accept": "text/html",
      "Cache-Control": "no-cache"
    }
  }));
  // Fetch in parallel to reduce Apps Script trigger runtime.
  return UrlFetchApp.fetchAll(requests);
}

function radarSnapshot_(res, store) {
  const http = res.getResponseCode();
  if (http !== 200) throw new Error(store.name + ": InStock Radar HTTP " + http);
  const html = res.getContentText();
  if (html.length < 300) throw new Error(store.name + ": unusually short page.");
  return parseRadarPage_(html, store);
}

// Test website readability without altering availability history or sending stock emails.
// Run once before enabling the minute trigger.
function testRadarSource() {
  const responses = radarFetchResults_();
  RADAR_CONFIG.stores.forEach((store, i) => {
    try {
      const snapshot = radarSnapshot_(responses[i], store);
      console.log(store.name + ": target " +
                  (snapshot.targetAvailable ? "IN STOCK" : "not in stock") +
                  " / model " + snapshot.modelStatus +
                  " / site checked " + snapshot.checked);
    } catch (err) {
      console.error("RADAR SOURCE FAILED: " + String(err));
    }
  });
}

/**
 * One-request 429 diagnostic for Evergreen Walk. Manual run ONLY.
 * No retries, no state changes, no emails, no scheduler changes.
 * Used to identify normal rate-limit headers for the authorized site owner.
 */
function diagnoseRadarOnce() {
  const store = RADAR_CONFIG.stores[0]; // Evergreen Walk only
  console.log("RADAR DIAGNOSTIC: " + store.name + " (ONE request, no retry).");
  const response = UrlFetchApp.fetch(store.url, {
    method: "get",
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      "Accept": "text/html",
      "Cache-Control": "no-cache"
    }
  });
  const status = response.getResponseCode();
  console.log("HTTP status: " + status);
  const headers = response.getAllHeaders();
  const interesting = [
    "retry-after", "server", "content-type", "cf-ray",
    "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset",
    "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
    "via", "x-cache"
  ];
  const selected = {};
  Object.keys(headers).forEach(k => {
    if (interesting.indexOf(k.toLowerCase()) !== -1) {
      selected[k] = String(headers[k]).slice(0, 180);
    }
  });
  console.log("Selected response headers: " + JSON.stringify(selected));
  const raw = response.getContentText();
  console.log("Response body length: " + raw.length);
  if (status !== 200) {
    // Never log cookies, credentials, full HTML, scripts, or long URLs.
    const excerpt = raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(/[A-Z0-9_-]{32,}/gi, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    console.log("Short error-body excerpt: " + (excerpt || "[empty or HTML-only]"));
  }
  if (status === 429) {
    console.warn("HTTP 429 received. Do NOT keep rerunning the test. " +
                 "Respect Retry-After (if supplied); consult the site operator.");
  } else if (status === 200) {
    console.log("HTTP 200 received. This does NOT yet prove that the inventory parser works. " +
                "Run testRadarSource only after the site owner confirms the access conditions.");
  } else {
    console.warn("Unexpected HTTP status; provide the selected headers to the site owner.");
  }
}

function checkRadarStock() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log("Another Radar check is still running; skipped overlap.");
    return;
  }
  const props = PropertiesService.getScriptProperties();
  try {
    let responses;
    try {
      responses = radarFetchResults_();
    } catch (err) {
      // Network-wide error: still count as failed, not as "sold out".
      throw new Error("Both Radar requests failed: " + String(err));
    }
    const failures = [];
    RADAR_CONFIG.stores.forEach((store, i) => {
      try {
        const snap = radarSnapshot_(responses[i], store);
        const key = "radarWasAvailable_" + store.id;
        const old = props.getProperty(key) === "true";
        if (snap.targetAvailable && !old) {
          MailApp.sendEmail({
            to: radarRecipients_(),
            subject: "🚨 [Radar] iPhone Duo 256GB Star White — " + store.name + " 有货！",
            body: "InStock Radar 显示目标配置可在 Apple " + store.name + " 自取。\n" +
                  "机型：iPhone Duo · 256 GB · Star White\n" +
                  "门店：" + store.name + "\n" +
                  "库存页面：" + store.url + "\n\n" +
                  "请尽快在 Apple 官网确认并下单：\n" + RADAR_CONFIG.appleShopUrl +
                  "\n\nNo trade-in / Connect to any carrier later 请在 Apple 结账时确认。" +
                  "\n数据来自第三方网站，可能有延迟；本邮件不代表库存预留。"
          });
          console.log(store.name + ": [RADAR] TARGET IN STOCK — Gmail alerts sent.");
        } else {
          console.log(store.name + ": " +
            (snap.targetAvailable ? "Target still available; repeat alert suppressed."
                                  : "Target currently unavailable.") +
            " (model " + snap.modelStatus + ", checked " + snap.checked + ")");
        }
        props.setProperties({
          [key]: String(snap.targetAvailable),
          ["radarLastChecked_" + store.id]: new Date().toISOString(),
          ["radarLastModelStatus_" + store.id]: snap.modelStatus,
          ["radarLastSiteAge_" + store.id]: snap.checked
        });
      } catch (err) {
        console.error("RADAR STORE CHECK FAILED: " + String(err));
        failures.push(String(err));
      }
    });
    if (failures.length) {
      throw new Error(failures.length + " store check(s) failed: " + failures.join(" | "));
    }
    props.setProperty("radarConsecutiveErrors", "0");
  } catch (err) {
    console.error("RADAR CHECK FAILED: " + String(err));
    const errors = Number(props.getProperty("radarConsecutiveErrors") || "0") + 1;
    props.setProperty("radarConsecutiveErrors", String(errors));
    const now = Date.now();
    const last = Number(props.getProperty("radarLastErrorEmail") || "0");
    if (errors >= 3 && now - last >= 6 * 60 * 60 * 1000) {
      try {
        MailApp.sendEmail({
          to: radarRecipients_(),
          subject: "⚠️ [Radar] iPhone Duo 库存监控查询异常",
          body: "InStock Radar 独立监控连续 " + errors + " 次查询失败。\n" +
                "这不意味着没有库存；Apple 原监控仍独立运行。\n\n" +
                "最近错误：" + String(err).slice(0, 500)
        });
        props.setProperty("radarLastErrorEmail", String(now));
      } catch (mailErr) {
        console.error("Could not send Radar error mail: " + String(mailErr));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function startEveryMinute() {
  // Only touches this separate project's checkRadarStock trigger.
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "checkRadarStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("checkRadarStock").timeBased().everyMinutes(1).create();
  console.log("One-minute Radar trigger installed. Apple monitor remains unchanged.");
}

function stopMonitoring() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "checkRadarStock") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  console.log("Only the separate InStock Radar monitor was stopped.");
}

function showStatus() {
  const props = PropertiesService.getScriptProperties();
  RADAR_CONFIG.stores.forEach(store => {
    console.log(store.name + ": availability=" +
      (props.getProperty("radarWasAvailable_" + store.id) || "not checked yet") +
      "; last successful=" +
      (props.getProperty("radarLastChecked_" + store.id) || "never"));
  });
  console.log("Radar consecutive errors: " +
              (props.getProperty("radarConsecutiveErrors") || "0"));
  console.log("Radar trigger count: " +
    ScriptApp.getProjectTriggers()
      .filter(trigger => trigger.getHandlerFunction() === "checkRadarStock").length);
}
