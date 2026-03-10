/**
 * p5.js Wrench Editor over MQTT (Shiftr public broker)
 * - Code editor textarea
 * - Buttons: Connect, Get Code, Run Now, Store, Run+Store, Reboot
 * - Console output from /evt topic
 *
 * Requires in index.html:
 * <script crossorigin="anonymous" src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>
 */

// ------------------------------------------------------------
// OpenAI + Doc fetch
// ------------------------------------------------------------
// ------------------------------------------------------------
// Auto-fix Wrench compile errors via GPT
// ------------------------------------------------------------

let autoFixEnabled = true;
let autoFixInProgress = false;
let autoFixBtn;
let lastCompileErrText = "";
let lastCompileErrMs = 0;
const AUTOMATION_INTERVAL_MS = 3 * 60 * 1000;
let automationEnabled = false;
let automationBtn;
let automationTimerId = null;
let generationInProgress = false;
let lastPromptText = "";

const DOC_MD_URL =
  "https://docs.google.com/document/d/1aYo8FZDIZpw3B1-zRs__Ug88DhGRpVDmBOQOfAKbLQU/export?format=md";


var lastDescription = "";
// If you use your own helper like storedDecrypt(), keep it.
// Otherwise replace with: const OPENAI_API_KEY = "sk-...";
let OPENAI_API_KEY = "";
let apiKeyEncryptedGpt =
  "U2FsdGVkX18ufo+Jv5eV1uiVVu23Jjvr8SaHfqG2rnsUq75hmr1av/B4KStyhTJtJwMgyyM6CP9gKXuUEu8F2m52Ey+wyLSiuI34pcMYOnPOVrngAAE3EMJg1Sx52sdns3JzqQHJgma6chold+TcfgeYqG/4O8wdRiKLz64Ic+v9uB+xDrzxJ2Cazu4En9yWPTKskgvccEn3ls0+zVGacW1zLaNyJXmzm+yHE0mkro+a/5lWzZFRT6UX6+HVEgqi";

 let mqttKeyEncrypted ="U2FsdGVkX1+f60bzOgPSBUTFJpFtLdWNgjs5QTNiW9BsDukPIRX8VtphcNDQ/bqS"
 // let mqttKeyEncrypted =""
  let mqttKey =""
let genBtn;
let client = null;
let isConnected = false;

const PYR_ID = "reflector1"; // change if needed
const MQTT_CMD_TOPIC = `/glow_dk_cph/${PYR_ID}/cmd`;
const MQTT_EVT_TOPIC = `/glow_dk_cph/${PYR_ID}/evt`;
const MQTT_REFLECTION_TOPIC = `/glow_dk_cph/${PYR_ID}/reflection`;

// UI
let statusP;
let connectBtn, disconnectBtn;
let getCodeBtn, runNowBtn, storeBtn, runStoreBtn, rebootBtn;
let clearConsoleBtn, fillExampleBtn;
let editorTA, consoleDiv,descriptionDiv;

// Request tracking
let lastRequestId = 0;
let pendingGetCode = false;

function setup() {
  createCanvas(1000, 60);
  noLoop();
  textFont("monospace");
  // Load OpenAI key (you said you have helpers; keep this shape)
  // Example: OPENAI_API_KEY = storedDecrypt({ apiKeyEncryptedGpt });
  try {
    OPENAI_API_KEY = storedDecrypt({ apiKeyEncryptedGpt });
     mqttKey = storedDecrypt({ mqttKeyEncrypted });
  } catch (e) {
    // It’s ok if you wire this later
    logLine("OpenAI key not loaded yet (wire storedDecrypt + apiKeyEncryptedGpt).");
  }
  statusP = createP("Status: MQTT not connected");
  statusP.style("margin", "8px 0 6px 0");

  connectBtn = createButton("Connect MQTT");
  connectBtn.mousePressed(connectMQTT);

  disconnectBtn = createButton("Disconnect");
  disconnectBtn.mousePressed(disconnectMQTT);
  disconnectBtn.attribute("disabled", "");

  createSpan("  ");

  getCodeBtn = createButton("Get code");
  getCodeBtn.mousePressed(cmdGetCode);
  getCodeBtn.attribute("disabled", "");

  runNowBtn = createButton("Run now");
  runNowBtn.mousePressed(cmdRunNow);
  runNowBtn.attribute("disabled", "");

  storeBtn = createButton("Store only");
  storeBtn.mousePressed(cmdSetCode);
  storeBtn.attribute("disabled", "");

  runStoreBtn = createButton("Run + store");
  runStoreBtn.mousePressed(cmdRunAndStore);
  runStoreBtn.attribute("disabled", "");

  rebootBtn = createButton("Reboot");
  rebootBtn.mousePressed(cmdReboot);
  rebootBtn.attribute("disabled", "");
 

  createSpan("  ");

  genBtn = createButton("Ask ChatGPT → Generate Wrench (Run)");
  genBtn.mousePressed(generateWrenchAndRun);
  genBtn.attribute("disabled", "");
  createSpan("  ");

  automationBtn = createButton("Automation: OFF");
  automationBtn.mousePressed(toggleAutomation);
  automationBtn.attribute("disabled", "");
  createSpan("  ");

  autoFixBtn = createButton("Auto-fix: ON");
  autoFixBtn.mousePressed(() => {
    autoFixEnabled = !autoFixEnabled;
    autoFixBtn.html(autoFixEnabled ? "Auto-fix: ON" : "Auto-fix: OFF");
    logLine("Auto-fix is now " + (autoFixEnabled ? "ON" : "OFF"));
  });

  createSpan("  ");

  clearConsoleBtn = createButton("Clear console");
  clearConsoleBtn.mousePressed(() => consoleDiv.html(""));

  fillExampleBtn = createButton("Insert example");
  fillExampleBtn.mousePressed(() => editorTA.value(defaultWrenchExample()));

  createP("Wrench code editor:").style("margin", "10px 0 6px 0");

  editorTA = createElement("textarea");
  editorTA.attribute("rows", "16");
  editorTA.attribute("cols", "120");
  editorTA.style("width", "980px");
  editorTA.style("height", "250px");
  editorTA.style("font-family", "monospace");
  editorTA.style("font-size", "13px");
  editorTA.value(defaultWrenchExample());

  createP("Console (/evt):").style("margin", "10px 0 6px 0");

  consoleDiv = createDiv("");
  consoleDiv.style("width", "980px");
  consoleDiv.style("height", "150px");
  consoleDiv.style("overflow", "auto");
  consoleDiv.style("white-space", "pre-wrap");
  consoleDiv.style("font-family", "monospace");
  consoleDiv.style("font-size", "12px");
  consoleDiv.style("border", "1px solid #444");
  consoleDiv.style("padding", "8px");
  consoleDiv.style("background", "#111");
  consoleDiv.style("color", "#eee");

  
   descriptionDiv = createDiv("");
  descriptionDiv.style("width", "980px");
  descriptionDiv.style("height", "150px");
  descriptionDiv.style("overflow", "auto");
  descriptionDiv.style("white-space", "pre-wrap");
  descriptionDiv.style("font-family", "monospace");
  descriptionDiv.style("font-size", "12px");
  descriptionDiv.style("border", "1px solid #444");
  descriptionDiv.style("padding", "8px");
  descriptionDiv.style("background", "#111");
  descriptionDiv.style("color", "#eee");
  
  logLine("Ready. Click Connect MQTT.");
  logLine("Topics:");
  logLine("  cmd: " + MQTT_CMD_TOPIC);
  logLine("  evt: " + MQTT_EVT_TOPIC);
}

function draw() {
  background(30);
  fill(220);
  text("Wrench MQTT Editor (p5.js)", 10, height - 15);
}

// ------------------------------------------------------------
// MQTT
// ------------------------------------------------------------

function connectMQTT() {
  if (!window.mqtt) {
    alert("mqtt.min.js not loaded. Add it in index.html header.");
    return;
  }

  if (client) {
    logLine("Already have a client object. Disconnect first.");
    return;
  }

  const clientId = "p5js-" + Math.floor(Math.random() * 1e9);

  logLine("Connecting MQTT as " + clientId + "...");

  client = mqtt.connect("wss://reflector:" +mqttKey + "@reflector.cloud.shiftr.io", {
    clientId,
    keepalive: 20,
    reconnectPeriod: 1000,
    connectTimeout: 5000,
  });

  client.on("connect", () => {
    isConnected = true;
    statusP.html("Status: MQTT connected ✅");
    logLine("MQTT connected.");
   
    client.subscribe(MQTT_EVT_TOPIC, (err) => {
      if (err) logLine("Subscribe error: " + err);
      else logLine("Subscribed: " + MQTT_EVT_TOPIC);
    });

    setUiConnected(true);
  });

  client.on("reconnect", () => {
    statusP.html("Status: MQTT reconnecting…");
    logLine("MQTT reconnecting…");
  });

  client.on("close", () => {
    isConnected = false;
    statusP.html("Status: MQTT closed");
    logLine("MQTT closed.");
    setUiConnected(false);
  });

  client.on("error", (err) => {
    logLine("MQTT error: " + err);
  });

  client.on("message", (topic, message) => {
    const s = message ? message.toString() : "";
    logLine(topic + ": " + s);
 // Auto-fix if this looks like a Wrench compile error
    maybeAutoFixFromEvt(s);

    // Optional: if we requested get_code, try to detect it and load into editor
    tryAutoFillEditorFromGetCode(s);
  });
}

function disconnectMQTT() {
  if (!client) return;

  try {
    client.end(true);
  } catch (_) {}

  client = null;
  isConnected = false;
  statusP.html("Status: MQTT not connected");
  setUiConnected(false);
  logLine("Disconnected.");
}
function setUiConnected(yes) {
  if (yes) {
    connectBtn.attribute("disabled", "");
    disconnectBtn.removeAttribute("disabled");

    getCodeBtn.removeAttribute("disabled");
    runNowBtn.removeAttribute("disabled");
    storeBtn.removeAttribute("disabled");
    runStoreBtn.removeAttribute("disabled");
    rebootBtn.removeAttribute("disabled");

    genBtn.removeAttribute("disabled"); // <-- add this
    automationBtn.removeAttribute("disabled");
  } else {
    connectBtn.removeAttribute("disabled");
    disconnectBtn.attribute("disabled", "");

    getCodeBtn.attribute("disabled", "");
    runNowBtn.attribute("disabled", "");
    storeBtn.attribute("disabled", "");
    runStoreBtn.attribute("disabled", "");
    rebootBtn.attribute("disabled", "");

    genBtn.attribute("disabled", ""); // <-- add this
    automationBtn.attribute("disabled", "");
    clearAutomationTimer();
  }
}

function toggleAutomation() {
  automationEnabled = !automationEnabled;
  automationBtn.html(automationEnabled ? "Automation: ON" : "Automation: OFF");

  if (!automationEnabled) {
    clearAutomationTimer();
    logLine("Automation is now OFF.");
    return;
  }

  logLine("Automation is now ON. Starting generation now.");
  if (generationInProgress) {
    logLine("Automation start skipped: generation already in progress.");
    scheduleNextAutomationRun();
    return;
  }

  generateWrenchAndRun();
}

function clearAutomationTimer() {
  if (automationTimerId !== null) {
    clearTimeout(automationTimerId);
    automationTimerId = null;
  }
}

function scheduleNextAutomationRun() {
  clearAutomationTimer();
  if (!automationEnabled) return;

  automationTimerId = setTimeout(() => {
    automationTimerId = null;

    if (!automationEnabled) return;
    if (!client || !isConnected) {
      logLine("Automation skipped: MQTT not connected.");
      scheduleNextAutomationRun();
      return;
    }

    generateWrenchAndRun();
  }, AUTOMATION_INTERVAL_MS);
}

// ------------------------------------------------------------
// Commands
// ------------------------------------------------------------

function publishJsonLine(obj) {
  if (!client || !isConnected) {
    alert("MQTT not connected.");
    return;
  }

  // Always send ONE JSON line
  const payload = JSON.stringify(obj) + "\n";
  client.publish(MQTT_CMD_TOPIC, payload);
  logLine(">>> " + payload.trim());
}

function publishReflectionUpdate(description, code) {
  if (!client || !isConnected) return;

  const payload = JSON.stringify({
    description: description || "",
    code: code || "",
    generated_at: new Date().toISOString()
  });
  client.publish(MQTT_REFLECTION_TOPIC, payload, { retain: true });
  logLine("Published reflection update.");
}

function cmdGetCode() {
  pendingGetCode = true;
  lastRequestId++;
  publishJsonLine({ cmd: "get_code" });
}

function cmdRunNow() {
  const code = editorTA.value();
  publishJsonLine({ cmd: "run_now", code });
}

function cmdSetCode() {
  const code = editorTA.value();
  publishJsonLine({ cmd: "set_code", code });
}

function cmdRunAndStore() {
  const code = editorTA.value();
  publishJsonLine({ cmd: "run_and_store", code });
}

function cmdReboot() {
  publishJsonLine({ cmd: "reboot" });
}

// ------------------------------------------------------------
// ChatGPT → generate Wrench (structured) → put in editor → run_now
// ------------------------------------------------------------

async function generateWrenchAndRun() {
  if (generationInProgress) {
    logLine("Generation already in progress.");
    return;
  }
  if (!client || !isConnected) {
    alert("MQTT not connected.");
    return;
  }
  if (!OPENAI_API_KEY) {
    alert("OpenAI API key not loaded yet.");
    return;
  }

  generationInProgress = true;
  genBtn.attribute("disabled", "");
  automationBtn.attribute("disabled", "");
  logLine("Fetching design doc (md)…");

  try {
    const md = await fetchDocMarkdown();
    logLine("Doc fetched: " + md.length + " chars");

    logLine("Calling OpenAI (structured tool output)…");
    const out = await openaiGenerateWrenchFromDoc(md);

    if (!out || !out.wrench_code) {
      throw new Error("No wrench_code returned.");
    }

    // Show description in console
    if (out.description) {
      lastDescription = out.description;
     descriptionDiv.html(lastDescription);
      logLine("— ChatGPT description —");
      logLine(out.description);
      logLine("— end description —");
    }

    // Put code in editor
    editorTA.value(out.wrench_code);
    lastPromptText = md;

    // Run now (do NOT store)
    publishJsonLine({ cmd: "run_now", code: out.wrench_code });
    publishReflectionUpdate(out.description, out.wrench_code);
    logLine("✅ Sent run_now with generated code (" + out.wrench_code.length + " chars).");
    if (automationEnabled) {
      scheduleNextAutomationRun();
      logLine(
        "Automation rescheduled for " +
          Math.round(AUTOMATION_INTERVAL_MS / 1000) +
          " seconds from now."
      );
    }
  } catch (err) {
    logLine("❌ Generate failed: " + (err && err.message ? err.message : err));
    if (automationEnabled) {
      scheduleNextAutomationRun();
    }
  } finally {
    generationInProgress = false;
    // Re-enable if still connected
    if (client && isConnected) genBtn.removeAttribute("disabled");
    if (client && isConnected) automationBtn.removeAttribute("disabled");
  }
}

async function fetchDocMarkdown() {
  const res = await fetch(DOC_MD_URL, { method: "GET" });
  if (!res.ok) throw new Error("Doc fetch failed: HTTP " + res.status);
  let md = await res.text();
  md = await injectNewsIntoMarkdown(md);
  md = injectLastPromptIntoMarkdown(md);

  // Optional safety: cap the amount to avoid huge prompts
  // (tweak as needed)
  const MAX_CHARS = 24000;
  return md.length > MAX_CHARS ? md.slice(0, MAX_CHARS) : md;
}

function injectLastPromptIntoMarkdown(md) {
  if (!md) return md;

  const placeholderRegex = /\\?\[last\\?_prompt\\?\]/i;
  return md.replace(placeholderRegex, lastPromptText || "");
}

async function injectNewsIntoMarkdown(md) {
  if (!md) return md;

  const markerRegex = /\[news_start\][\s\S]*?\[news_end\]/i;
  const placeholderRegex = /\\?\[news\\?\]/i;
  const feeds = extractNewsFeedUrls(md);
  if (!feeds.length) {
    logLine("News debug: no feed URLs found between [news_start] and [news_end].");
    debugNewsMarkerContext(md);
    return md.replace(markerRegex, "").replace(placeholderRegex, "");
  }

  logLine("News debug: found " + feeds.length + " feed source(s).");
  const sections = [];
  let successCount = 0;
  for (const feedUrl of feeds) {
    logLine("News debug: fetching " + feedUrl);
    try {
      const feedXml = await fetchFeedText(feedUrl);
      const items = parseRssItems(feedXml, 10);
      if (!items.length) {
        logLine("News debug [" + feedUrl + "]: no items found.");
        sections.push("## " + feedUrl + "\nNo items found.");
        continue;
      }

      logLine(
        "News debug [" + feedUrl + "]: parsed " + items.length + " items."
      );
      logLine(
        "News debug [" +
          feedUrl +
          "]: " +
          items[0].title +
          " | " +
          items[0].description
      );

      const lines = ["## " + feedUrl];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        lines.push(
          `${i + 1}. ${item.title}\n${item.description}`
        );
      }
      sections.push(lines.join("\n\n"));
      successCount++;
    } catch (err) {
      sections.push(
        "## " +
          feedUrl +
          "\nFailed to load feed: " +
          (err && err.message ? err.message : err)
      );
      logLine(
        "News debug [" +
          feedUrl +
          "]: failed to load feed: " +
          (err && err.message ? err.message : err)
      );
    }
  }

  if (successCount === 0) {
    throw new Error("No news feeds could be loaded. Skipping ChatGPT generation.");
  }

  const newsBlock = "# News\n\n" + sections.join("\n\n");
  return md.replace(markerRegex, "").replace(placeholderRegex, newsBlock);
}

function extractNewsFeedUrls(md) {
  const block = extractNewsMarkerBlock(md);
  if (!block) return [];

  return block
    .split("\n")
    .map((line) => extractUrlFromMarkdownLine(line))
    .filter((line) => line && /^https?:\/\//i.test(line));
}

function extractNewsMarkerBlock(md) {
  if (!md) return "";

  const exactMatch = md.match(/\\?\[news\\?_start\\?\]([\s\S]*?)\\?\[news\\?_end\\?\]/i);
  if (exactMatch) return exactMatch[1];

  const normalized = md.toLowerCase().replace(/\\_/g, "_");
  const startToken = "[news_start]";
  const endToken = "[news_end]";
  const startIdx = normalized.indexOf(startToken);
  const endIdx = normalized.indexOf(endToken);

  if (startIdx >= 0 && endIdx > startIdx) {
    return md.slice(startIdx + startToken.length, endIdx);
  }

  return "";
}

function extractUrlFromMarkdownLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return "";

  const markdownLinkMatch = trimmed.match(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/i);
  if (markdownLinkMatch) return markdownLinkMatch[1].trim();

  const plainUrlMatch = trimmed.match(/https?:\/\/\S+/i);
  return plainUrlMatch ? plainUrlMatch[0].trim() : "";
}

function debugNewsMarkerContext(md) {
  if (!md) {
    logLine("News debug: markdown is empty.");
    return;
  }

  const normalized = md.toLowerCase();
  const newsIdx = normalized.indexOf("news");
  if (newsIdx < 0) {
    logLine("News debug: no 'news' substring found in markdown.");
    return;
  }

  const start = Math.max(0, newsIdx - 180);
  const end = Math.min(md.length, newsIdx + 420);
  const snippet = md.slice(start, end).replace(/\s+/g, " ").trim();
  logLine("News debug context: " + snippet);
}

async function fetchFeedText(url) {
  const attempts = [
    {
      label: "allorigins-get",
      requestUrl: "https://api.allorigins.win/get?url=" + encodeURIComponent(url),
      parse: async (res) => {
        const data = await res.json();
        return data && data.contents ? data.contents : "";
      }
    },
    {
      label: "corsproxy",
      requestUrl: "https://corsproxy.io/?" + encodeURIComponent(url),
      parse: async (res) => await res.text()
    },
    {
      label: "allorigins-raw",
      requestUrl: "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
      parse: async (res) => await res.text()
    }
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    logLine("News debug: trying " + attempt.label + " for " + url);
    try {
      const res = await fetch(attempt.requestUrl, { method: "GET" });
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }

      const text = await attempt.parse(res);
      if (!text) {
        throw new Error("Empty response");
      }

      logLine("News debug: fetch success via " + attempt.label + " for " + url);
      return text;
    } catch (err) {
      lastErr = err;
      logLine(
        "News debug: " +
          attempt.label +
          " failed for " +
          url +
          ": " +
          (err && err.message ? err.message : err)
      );
    }
  }

  throw lastErr || new Error("Feed fetch failed");
}

function parseRssItems(xmlText, maxItems) {
  if (!xmlText) return [];

  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    throw new Error("RSS parse failed");
  }

  const items = Array.from(xml.querySelectorAll("item")).slice(0, maxItems);
  return items.map((item) => ({
    title: cleanNewsText(getXmlNodeText(item, "title") || "Untitled"),
    description: cleanNewsText(
      getXmlNodeText(item, "description") || "No description."
    )
  }));
}

function getXmlNodeText(parent, tagName) {
  const node = parent.querySelector(tagName);
  return node ? node.textContent : "";
}

function cleanNewsText(text) {
  const div = document.createElement("div");
  div.innerHTML = text || "";
  return (div.textContent || div.innerText || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function openaiGenerateWrenchFromDoc(docMd) {
  const url = "https://api.openai.com/v1/chat/completions";

  // Modern structured output via tool-calling (functions → tools)
  // functions is deprecated; tools + tool_choice is the replacement. :contentReference[oaicite:1]{index=1}
  const tools = [
    {
      type: "function",
      function: {
        name: "generate_wrench",
        description:
          "Return a concise description of the concept and valid Wrench code implementing it.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            wrench_code: { type: "string" }
          },
          required: ["description", "wrench_code"]
        }
      }
    }
  ];

  // Prompt composition: your doc is the “spec”
  // plus a tiny reminder about your environment and constraints.
  const system = [
    "You write Wrench (embedded scripting language) for an ESP32-S3 LED sculpture.",
    "Output MUST be valid Wrench code compatible with a simple parser:",
    "- no ternary (a ? b : c)",
    "- no nested functions",
    "- declare variables before use",
    "- prefer while loops",
    "- keep tick() bounded (avoid huge heavy loops if possible).",
    "Return results ONLY via the generate_wrench tool call."
  ].join("\n");

  const user = [
    "Use the following design doc as the authoritative instructions.",
    "Generate a new Wrench sketch that follows it closely.",
    "",
    "DESIGN DOC (markdown):",
    "```",
    docMd,
    "```",
    "",
    "Deliver:",
    "1) a short description of what you generated",
    "2) the full Wrench code",
    "",
    "The code should be ready to run now (not storing)."
  ].join("\n");
//"gpt-5.2",gpt-5.1-instant
  const body = {
    model: "gpt-5.2",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    tools,
    tool_choice: { type: "function", function: { name: "generate_wrench" } },
    temperature: 1.9
  //  max_tokens: 1200
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error("OpenAI error: " + (data && data.error ? data.error.message : res.status));
  }

  // Tool call path: choices[0].message.tool_calls[0].function.arguments
  const msg = data.choices?.[0]?.message;
  const tc = msg?.tool_calls?.[0];
  const argsStr = tc?.function?.arguments;

  if (!argsStr) {
    throw new Error("No tool call arguments returned.");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(argsStr);
  } catch (e) {
    // Some models can return slightly invalid JSON in arguments; guard it.
    throw new Error("Tool arguments JSON parse failed: " + e.message + "\n" + argsStr);
  }

  return parsed;
}


// ------------------------------------------------------------
// Parse evt JSON
// ------------------------------------------------------------

function tryAutoFillEditorFromGetCode(msg) {
  // We only try this if user pressed "Get code"
  if (!pendingGetCode) return;

  // Your firmware sends:
  // {"ok":true,"code":"...."}
  // But it might also send other events in between.
  if (!msg || msg[0] !== "{") return;

  let obj = null;
  try {
    obj = JSON.parse(msg);
  } catch (_) {
    return;
  }

  if (!obj) return;

  if (obj.ok === true && typeof obj.code === "string") {
    editorTA.value(obj.code);
    pendingGetCode = false;
    logLine("<<< Loaded code into editor (" + obj.code.length + " chars).");
  }
}

// ------------------------------------------------------------
// Utils
// ------------------------------------------------------------

function logLine(s) {
  const prev = consoleDiv.html();
  const next = prev + (prev ? "\n" : "") + s;
  consoleDiv.html(next);
  const el = consoleDiv.elt;
  el.scrollTop = el.scrollHeight;
}

function escapeForJsonString(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function defaultWrenchExample() {
  return (
`var pos = 0;
var frames = 0;
var lastMs = 0;

function setup(){
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);
  leds_clear();
  leds_show();
  lastMs = millis();
}

function tick(){
  var total = TOTAL_LEDS;
  var i = 0;
  while(i < total){
    if(i % 10 == 0){
      leds_set_pixel(i, 255, 0, 0);
    } else {
      leds_set_pixel(i, 0, 0, 0);
    }
    i = i + 1;
  }

  pos = pos + 1;
  if(pos >= 20) pos = 0;

  leds_show();

}`
  );
}

function isWrenchCompileErrorObj(obj) {
  if (!obj) return false;
  if (obj.ok !== false) return false;
  if (typeof obj.err !== "string") return false;

  // Your firmware emits things like:
  // "wrench compile: line:85\nerr: WR_ERR_bad_expression[9]\n85      var base;\n               ^\n"
  return obj.err.includes("wrench compile:");
}

function maybeAutoFixFromEvt(msg) {
  if (!autoFixEnabled) return;
  if (autoFixInProgress) return;

  if (!msg || msg[0] !== "{") return;

  let obj = null;
  try {
    obj = JSON.parse(msg);
  } catch (_) {
    return;
  }

  if (!isWrenchCompileErrorObj(obj)) return;

  // simple spam protection: ignore identical error for 2 seconds
  const now = millis();
  if (obj.err === lastCompileErrText && now - lastCompileErrMs < 2000) {
    return;
  }
  lastCompileErrText = obj.err;
  lastCompileErrMs = now;

  // Kick off async fix
  autoFixWrenchAndRun(obj.err);
}

async function autoFixWrenchAndRun(errText) {
  if (!OPENAI_API_KEY) {
    logLine("❌ Auto-fix skipped: OpenAI API key not loaded.");
    return;
  }
  if (!client || !isConnected) {
    logLine("❌ Auto-fix skipped: MQTT not connected.");
    return;
  }

  autoFixInProgress = true;
  logLine("🛠️ Auto-fix triggered. Sending error + code to GPT…");

  try {
    const brokenCode = editorTA.value();
    const fixed = await openaiFixWrenchFromError(brokenCode, errText);

    if (!fixed || !fixed.wrench_code) {
      throw new Error("No wrench_code returned from fixer.");
    }

    // Put fixed code into editor
    editorTA.value(fixed.wrench_code);

    // Log short explanation
    if (fixed.description) {
      logLine("— Fix summary —");
      logLine(fixed.description);
      logLine("— end summary —");
    }

    // Run again
    publishJsonLine({ cmd: "run_now", code: fixed.wrench_code });
    logLine("✅ Sent run_now with fixed code (" + fixed.wrench_code.length + " chars).");
  } catch (e) {
    logLine("❌ Auto-fix failed: " + (e && e.message ? e.message : e));
  } finally {
    autoFixInProgress = false;
  }
}


async function openaiFixWrenchFromError(brokenCode, errText) {
  const url = "https://api.openai.com/v1/chat/completions";

  const tools = [
    {
      type: "function",
      function: {
        name: "fix_wrench",
        description:
          "Fix Wrench code so it compiles. Return a brief summary and the corrected full code.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            wrench_code: { type: "string" }
          },
          required: ["description", "wrench_code"]
        }
      }
    }
  ];

  const system = [
    "You are an expert Wrench developer for embedded ESP32 LED sculptures.",
    "Fix syntax/parse errors so the code compiles in Wrench.",
    "",
    "Hard rules:",
    "- NO ternary operator (a ? b : c)",
    "- NO nested functions",
    "- Declare variables before use",
    "- Prefer while loops",
    "- Keep tick() bounded",
    "- Preserve the original intent as much as possible",
    "",
    "Return ONLY via tool call fix_wrench."
  ].join("\n");

  const user = [
    "This Wrench code fails to compile.",
    "Fix it and return the full corrected code.",
    "",
    "COMPILER ERROR:",
    "```",
    errText,
    "```",
    "",
    "BROKEN CODE:",
    "```",
    brokenCode,
    "```"
  ].join("\n");

  const body = {
    model: "gpt-5.2",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    tools,
    tool_choice: { type: "function", function: { name: "fix_wrench" } },
    temperature: 0.2
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error("OpenAI error: " + (data?.error?.message || res.status));
  }

  const msg = data.choices?.[0]?.message;
  const tc = msg?.tool_calls?.[0];
  const argsStr = tc?.function?.arguments;

  if (!argsStr) {
    throw new Error("No tool call arguments returned from fix_wrench.");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(argsStr);
  } catch (e) {
    throw new Error("Fix tool JSON parse failed: " + e.message + "\n" + argsStr);
  }

  return parsed;
}
