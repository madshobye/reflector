window.showOverlay = false;

const AUTOMATION_INTERVAL_MS = 3 * 60 * 1000;
const DOC_MD_URL =
  "https://docs.google.com/document/d/1aYo8FZDIZpw3B1-zRs__Ug88DhGRpVDmBOQOfAKbLQU/export?format=md";

const PYR_ID = "reflector1";
const MQTT_CMD_TOPIC = `/glow_dk_cph/${PYR_ID}/cmd`;
const MQTT_EVT_TOPIC = `/glow_dk_cph/${PYR_ID}/evt`;
const MQTT_REFLECTION_TOPIC = `/glow_dk_cph/${PYR_ID}/reflection`;

let autoFixEnabled = false;
let autoFixInProgress = false;
let automationEnabled = false;
let automationTimerId = null;
let generationInProgress = false;
let lastPromptText = "";
let lastDescription = "";
let lastCompileErrText = "";
let lastCompileErrMs = 0;

let OPENAI_API_KEY = "";
let mqttKey = "";
let apiKeyEncryptedGpt =
  "U2FsdGVkX18ufo+Jv5eV1uiVVu23Jjvr8SaHfqG2rnsUq75hmr1av/B4KStyhTJtJwMgyyM6CP9gKXuUEu8F2m52Ey+wyLSiuI34pcMYOnPOVrngAAE3EMJg1Sx52sdns3JzqQHJgma6chold+TcfgeYqG/4O8wdRiKLz64Ic+v9uB+xDrzxJ2Cazu4En9yWPTKskgvccEn3ls0+zVGacW1zLaNyJXmzm+yHE0mkro+a/5lWzZFRT6UX6+HVEgqi";
let mqttKeyEncrypted = "U2FsdGVkX1+f60bzOgPSBUTFJpFtLdWNgjs5QTNiW9BsDukPIRX8VtphcNDQ/bqS";

let client = null;
let isConnected = false;
let pendingGetCode = false;
let lastRequestId = 0;

let editorEl;
let aceEditor = null;
let consoleDiv;
let descriptionDiv;
let metricsDiv;
let emptyDiv;
let statusText = "MQTT not connected";
let appEl;
let sidebarEl;
let contentEl;
let editorColumnEl;
let infoColumnEl;
let editorSectionEl;
let consoleSectionEl;
let reflectionSectionEl;
let metricsSectionEl;
let emptySectionEl;
let deviceMetrics = {
  fps: "--",
  heap_free: "--",
  heap_largest: "--",
  wrench_stack_hw: "--",
  compile_stack_hw: "--",
  loop_stack_hw: "--"
};

async function setup() {
  createLayout();
  const sidebarW = computeSidebarWidth();
  const c = createCanvas(sidebarW, windowHeight);
  c.parent(sidebarEl);
  textFont("monospace");

  try {
    OPENAI_API_KEY = storedDecrypt({ apiKeyEncryptedGpt });
    mqttKey = storedDecrypt({ mqttKeyEncrypted });
  } catch (e) {
    statusText = "Missing encrypted key/password";
  }

  createDomPanels();
  applyBaseUiStyle();
  initAceEditor();

  setEditorValue(defaultWrenchExample());
  logLine("Ready.");
  logLine("cmd: " + MQTT_CMD_TOPIC);
  logLine("evt: " + MQTT_EVT_TOPIC);
  renderMetrics();
  updateDomLayout();
  connectMQTT();
}

function draw() {
  background(8, 10, 14);
  drawSidebar();
}

function drawSidebar() {
  noStroke();
  fill(16, 22, 28);
  rect(0, 0, width, height);
  fill(28, 37, 46);
  rect(width - 1, 0, 1, height);

  const innerW = 220;
  const innerX = (width - innerW) * 0.5;
  uiListStart({ x: innerX, y: 20, width: innerW, dir: "vertical", margin: 8 });
  uiText("Reflector Dashboard", {
    height: 44,
    fontSize: 20,
    hAlign: "center",
    bgColor: "#14212b",
    textColor: "#f3ede2"
  });

  uiText("Status: " + statusText, {
    height: 52,
    bgColor: isConnected ? "#163321" : "#311b1b",
    textColor: "#f3ede2",
    vAlign: "middle"
  });

  if (uiActionButton("Connect MQTT", !client, "#2f7f64").clicked) connectMQTT();
  if (uiActionButton("Disconnect", !!client, "#7c3f3f").clicked) disconnectMQTT();
  if (uiActionButton("Get Code", isConnected, "#355d84").clicked) cmdGetCode();
  if (uiActionButton("Run Now", isConnected, "#355d84").clicked) cmdRunNow();
  if (uiActionButton("Store Only", isConnected, "#355d84").clicked) cmdSetCode();
  if (uiActionButton("Run + Store", isConnected, "#355d84").clicked) cmdRunAndStore();
  if (uiActionButton("Reboot", isConnected, "#6c4d2b").clicked) cmdReboot();
  if (uiActionButton("Generate Wrench", isConnected && !generationInProgress, "#7d5bd2").clicked) {
    generateWrenchAndRun();
  }
  if (uiActionButton(autoFixEnabled ? "Auto-fix: ON" : "Auto-fix: OFF", true, autoFixEnabled ? "#2f7f64" : "#5c5454").clicked) {
    autoFixEnabled = !autoFixEnabled;
    logLine("Auto-fix is now " + (autoFixEnabled ? "ON" : "OFF"));
  }
  if (uiActionButton(automationEnabled ? "Automation: ON" : "Automation: OFF", isConnected && !generationInProgress, automationEnabled ? "#2f7f64" : "#5c5454").clicked) {
    toggleAutomation();
  }
  if (uiActionButton("Insert Example", true, "#425064").clicked) setEditorValue(defaultWrenchExample());
  if (uiActionButton("Clear Console", true, "#425064").clicked) consoleDiv.html("");

  uiText("Automation interval: " + Math.round(AUTOMATION_INTERVAL_MS / 1000) + "s", {
    height: 34,
    bgColor: "#12171d",
    textColor: "#a9bacb"
  });
  uiListEnd();
}

function uiActionButton(label, enabled, activeColor) {
  return uiButton(label, {
    height: 32,
    bgColor: enabled ? activeColor : "#2a2f35",
    textColor: enabled ? "#f7f1e6" : "#78838e",
    hover: { bgColor: enabled ? lightenHex(activeColor, 18) : "#2a2f35" },
    pressed: { bgColor: enabled ? darkenHex(activeColor, 18) : "#2a2f35" }
  });
}

function applyBaseUiStyle() {
  uiSetBaseStyle({
    common: {
      fontSize: 15,
      padding: 10,
      rounding: 10,
      bgColor: "#1d2832",
      textColor: "#f3ede2",
      hover: { bgColor: "#293746" },
      pressed: { bgColor: "#141c24" }
    },
    button: { height: 38 },
    text: { height: 36 },
    list: { x: 20, y: 20, width: 280, dir: "vertical" }
  });
}

function createDomPanels() {
  editorEl = createDiv("");
  editorEl.parent(editorSectionEl);
  editorEl.id("editor");
  editorEl.class("panel-box");

  descriptionDiv = createDiv("");
  descriptionDiv.parent(reflectionSectionEl);
  descriptionDiv.class("panel-box");
  styleLogPanel(descriptionDiv, "#131922");

  metricsDiv = createDiv("");
  metricsDiv.parent(metricsSectionEl);
  metricsDiv.class("panel-box");
  metricsDiv.style("overflow", "auto");

  emptyDiv = createDiv("");
  emptyDiv.parent(emptySectionEl);
  emptyDiv.class("panel-box");
  emptyDiv.style("background", "#0e1318");

  consoleDiv = createDiv("");
  consoleDiv.parent(consoleSectionEl);
  consoleDiv.class("panel-box");
  styleLogPanel(consoleDiv, "#101417");
}

function styleLogPanel(el, bg) {
  el.style("overflow", "auto");
  el.style("white-space", "pre-wrap");
  el.style("font-family", "monospace");
  el.style("font-size", "12px");
  el.style("padding", "12px");
  el.style("background", bg);
  el.style("color", "#d7dfeb");
  el.style("border", "1px solid #263341");
  el.style("border-radius", "10px");
}

function updateDomLayout() {
  resizeCanvas(sidebarEl.elt.clientWidth, windowHeight);
  if (aceEditor) aceEditor.resize();
}

function connectMQTT() {
  if (!window.mqtt) {
    logLine("mqtt.min.js not loaded.");
    return;
  }
  if (client) {
    logLine("Already connected or connecting.");
    return;
  }

  const clientId = "portal-dashboard-" + Math.floor(Math.random() * 1e9);
  statusText = "Connecting MQTT...";
  logLine("Connecting MQTT as " + clientId + "...");

  client = mqtt.connect("wss://reflector:" + mqttKey + "@reflector.cloud.shiftr.io", {
    clientId,
    keepalive: 20,
    reconnectPeriod: 1000,
    connectTimeout: 5000
  });

  client.on("connect", () => {
    isConnected = true;
    statusText = "MQTT connected";
    logLine("MQTT connected.");
    client.subscribe(MQTT_EVT_TOPIC, (err) => {
      if (err) logLine("Subscribe error: " + err);
      else logLine("Subscribed: " + MQTT_EVT_TOPIC);
    });
  });

  client.on("reconnect", () => {
    statusText = "MQTT reconnecting";
    logLine("MQTT reconnecting...");
  });

  client.on("close", () => {
    isConnected = false;
    statusText = "MQTT closed";
    logLine("MQTT closed.");
    client = null;
    clearAutomationTimer();
  });

  client.on("error", (err) => {
    statusText = "MQTT error";
    logLine("MQTT error: " + err);
  });

  client.on("message", (topic, message) => {
    const s = message ? message.toString() : "";
    logLine(topic + ": " + s);
    maybeAutoFixFromEvt(s);
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
  statusText = "MQTT not connected";
  clearAutomationTimer();
  logLine("Disconnected.");
}

function toggleAutomation() {
  automationEnabled = !automationEnabled;
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

function publishJsonLine(obj) {
  if (!client || !isConnected) {
    logLine("MQTT not connected.");
    return;
  }
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
  publishJsonLine({ cmd: "run_now", code: getEditorValue() });
}

function cmdSetCode() {
  publishJsonLine({ cmd: "set_code", code: getEditorValue() });
}

function cmdRunAndStore() {
  publishJsonLine({ cmd: "run_and_store", code: getEditorValue() });
}

function cmdReboot() {
  publishJsonLine({ cmd: "reboot" });
}

async function generateWrenchAndRun() {
  if (generationInProgress) {
    logLine("Generation already in progress.");
    return;
  }
  if (!client || !isConnected) {
    logLine("MQTT not connected.");
    return;
  }
  if (!OPENAI_API_KEY) {
    logLine("OpenAI API key not loaded.");
    return;
  }

  generationInProgress = true;
  logLine("Fetching design doc (md)...");

  try {
    const md = await fetchDocMarkdown();
    logLine("Doc fetched: " + md.length + " chars");
    logLine("Calling OpenAI...");
    const out = await openaiGenerateWrenchFromDoc(md);
    if (!out || !out.wrench_code) throw new Error("No wrench_code returned.");

    if (out.description) {
      lastDescription = out.description;
      descriptionDiv.html(lastDescription);
      logLine("— ChatGPT description —");
      logLine(out.description);
      logLine("— end description —");
    }

    setEditorValue(out.wrench_code);
    lastPromptText = md;
    publishJsonLine({ cmd: "run_now", code: out.wrench_code });
    publishReflectionUpdate(out.description, out.wrench_code);
    logLine("Sent run_now with generated code (" + out.wrench_code.length + " chars).");

    if (automationEnabled) {
      scheduleNextAutomationRun();
      logLine("Automation rescheduled.");
    }
  } catch (err) {
    logLine("Generate failed: " + (err && err.message ? err.message : err));
    if (automationEnabled) scheduleNextAutomationRun();
  } finally {
    generationInProgress = false;
  }
}

async function fetchDocMarkdown() {
  const res = await fetch(DOC_MD_URL, { method: "GET" });
  if (!res.ok) throw new Error("Doc fetch failed: HTTP " + res.status);
  let md = await res.text();
  md = await injectNewsIntoMarkdown(md);
  md = injectLastPromptIntoMarkdown(md);
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
    logLine("News debug: no feed URLs found.");
    return md.replace(markerRegex, "").replace(placeholderRegex, "");
  }

  const sections = [];
  let successCount = 0;
  for (const feedUrl of feeds) {
    logLine("News debug: fetching " + feedUrl);
    try {
      const feedXml = await fetchFeedText(feedUrl);
      const items = parseRssItems(feedXml, 10);
      if (!items.length) continue;
      logLine("News debug [" + feedUrl + "]: " + items[0].title + " | " + items[0].description);
      const lines = ["## " + feedUrl];
      for (let i = 0; i < items.length; i++) {
        lines.push(`${i + 1}. ${items[i].title}\n${items[i].description}`);
      }
      sections.push(lines.join("\n\n"));
      successCount++;
    } catch (err) {
      logLine("News debug [" + feedUrl + "]: failed: " + (err && err.message ? err.message : err));
    }
  }

  if (successCount === 0) {
    throw new Error("No news feeds could be loaded. Skipping ChatGPT generation.");
  }

  return md.replace(markerRegex, "").replace(placeholderRegex, "# News\n\n" + sections.join("\n\n"));
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
  const startIdx = normalized.indexOf("[news_start]");
  const endIdx = normalized.indexOf("[news_end]");
  if (startIdx >= 0 && endIdx > startIdx) {
    return md.slice(startIdx + "[news_start]".length, endIdx);
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
    try {
      const res = await fetch(attempt.requestUrl, { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await attempt.parse(res);
      if (!text) throw new Error("Empty response");
      return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Feed fetch failed");
}

function parseRssItems(xmlText, maxItems) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) throw new Error("RSS parse failed");
  return Array.from(xml.querySelectorAll("item"))
    .slice(0, maxItems)
    .map((item) => ({
      title: cleanNewsText(getXmlNodeText(item, "title") || "Untitled"),
      description: cleanNewsText(getXmlNodeText(item, "description") || "No description.")
    }));
}

function getXmlNodeText(parent, tagName) {
  const node = parent.querySelector(tagName);
  return node ? node.textContent : "";
}

function cleanNewsText(text) {
  const div = document.createElement("div");
  div.innerHTML = text || "";
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
}

async function openaiGenerateWrenchFromDoc(docMd) {
  const tools = [
    {
      type: "function",
      function: {
        name: "generate_wrench",
        description: "Return a concise description of the concept and valid Wrench code implementing it.",
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

  const body = {
    model: "gpt-5.2",
    messages: [
      {
        role: "system",
        content: [
          "You write Wrench for an ESP32-S3 LED sculpture.",
          "Output MUST be valid Wrench code.",
          "- no ternary",
          "- no nested functions",
          "- declare variables before use",
          "- prefer while loops",
          "Return results ONLY via the generate_wrench tool call."
        ].join("\n")
      },
      {
        role: "user",
        content: [
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
          "2) the full Wrench code"
        ].join("\n")
      }
    ],
    tools,
    tool_choice: { type: "function", function: { name: "generate_wrench" } },
    temperature: 1.9
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error("OpenAI error: " + (data?.error?.message || res.status));
  const argsStr = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("No tool call arguments returned.");
  return JSON.parse(argsStr);
}

function tryAutoFillEditorFromGetCode(msg) {
  if (!pendingGetCode || !msg || msg[0] !== "{") return;
  try {
    const obj = JSON.parse(msg);
    if (obj.ok === true && typeof obj.code === "string") {
      setEditorValue(obj.code);
      pendingGetCode = false;
      logLine("Loaded code into editor (" + obj.code.length + " chars).");
    }
  } catch (_) {}
}

function isWrenchCompileErrorObj(obj) {
  return !!(obj && obj.ok === false && typeof obj.err === "string" && obj.err.includes("wrench compile:"));
}

function maybeAutoFixFromEvt(msg) {
  if (!autoFixEnabled || autoFixInProgress || !msg || msg[0] !== "{") return;
  try {
    const obj = JSON.parse(msg);
    if (!isWrenchCompileErrorObj(obj)) return;
    const now = millis();
    if (obj.err === lastCompileErrText && now - lastCompileErrMs < 2000) return;
    lastCompileErrText = obj.err;
    lastCompileErrMs = now;
    autoFixWrenchAndRun(obj.err);
  } catch (_) {}
}

async function autoFixWrenchAndRun(errText) {
  if (!OPENAI_API_KEY || !client || !isConnected) return;
  autoFixInProgress = true;
  logLine("Auto-fix triggered...");
  try {
    const fixed = await openaiFixWrenchFromError(getEditorValue(), errText);
    if (!fixed || !fixed.wrench_code) throw new Error("No wrench_code returned from fixer.");
    setEditorValue(fixed.wrench_code);
    if (fixed.description) logLine(fixed.description);
    publishJsonLine({ cmd: "run_now", code: fixed.wrench_code });
    logLine("Sent run_now with fixed code.");
  } catch (e) {
    logLine("Auto-fix failed: " + (e && e.message ? e.message : e));
  } finally {
    autoFixInProgress = false;
  }
}

async function openaiFixWrenchFromError(brokenCode, errText) {
  const tools = [
    {
      type: "function",
      function: {
        name: "fix_wrench",
        description: "Fix Wrench code so it compiles. Return a brief summary and the corrected full code.",
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

  const body = {
    model: "gpt-5.2",
    messages: [
      {
        role: "system",
        content: [
          "You are an expert Wrench developer.",
          "Fix syntax/parse errors so the code compiles.",
          "No ternary, no nested functions, prefer while loops.",
          "Return ONLY via tool call fix_wrench."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "This Wrench code fails to compile.",
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
        ].join("\n")
      }
    ],
    tools,
    tool_choice: { type: "function", function: { name: "fix_wrench" } },
    temperature: 0.2
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error("OpenAI error: " + (data?.error?.message || res.status));
  const argsStr = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("No tool call arguments returned from fix_wrench.");
  return JSON.parse(argsStr);
}

function logLine(s) {
  const consumedByMetrics = maybeUpdateMetricsFromConsoleLine(s);
  if (consumedByMetrics) return;

  const prev = consoleDiv.html();
  const next = prev + (prev ? "\n" : "") + s;
  consoleDiv.html(next);
  consoleDiv.elt.scrollTop = consoleDiv.elt.scrollHeight;
}

function defaultWrenchExample() {
  return `var pos = 0;
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
}`;
}

function lightenHex(hex, delta) {
  return shiftHex(hex, delta);
}

function darkenHex(hex, delta) {
  return shiftHex(hex, -delta);
}

function shiftHex(hex, delta) {
  const raw = hex.replace("#", "");
  const num = parseInt(raw, 16);
  const r = constrain(((num >> 16) & 255) + delta, 0, 255);
  const g = constrain(((num >> 8) & 255) + delta, 0, 255);
  const b = constrain((num & 255) + delta, 0, 255);
  return "#" + [r, g, b].map((v) => hexByte(v)).join("");
}

function hexByte(v) {
  return Number(v).toString(16).padStart(2, "0");
}

function windowResized() {
  updateDomLayout();
}

function createLayout() {
  appEl = select("#app");

  sidebarEl = createDiv("");
  sidebarEl.id("sidebar-panel");
  sidebarEl.parent(appEl);

  contentEl = createDiv("");
  contentEl.id("content-panel");
  contentEl.parent(appEl);

  editorColumnEl = createDiv("");
  editorColumnEl.id("editor-column");
  editorColumnEl.class("content-column");
  editorColumnEl.parent(contentEl);

  infoColumnEl = createDiv("");
  infoColumnEl.id("info-column");
  infoColumnEl.class("content-column");
  infoColumnEl.parent(contentEl);

  editorSectionEl = createSection(editorColumnEl, "editor", "Wrench Code");
  consoleSectionEl = createSection(editorColumnEl, "console", "Console");
  reflectionSectionEl = createSection(infoColumnEl, "third", "Reflection");
  metricsSectionEl = createSection(infoColumnEl, "third", "Device Info");
  emptySectionEl = createSection(infoColumnEl, "third", "");
}

function createSection(parentEl, kind, title) {
  const section = createDiv("");
  section.parent(parentEl);
  section.class(`panel-section ${kind}`);

  if (title) {
    const heading = createP(title);
    heading.parent(section);
    heading.class("panel-title");
  }

  return section;
}

function computeSidebarWidth() {
  return 320;
}

function initAceEditor() {
  if (!window.ace || !editorEl) return;
  aceEditor = ace.edit(editorEl.elt);
  aceEditor.setTheme("ace/theme/monokai");
  aceEditor.session.setMode("ace/mode/javascript");
  aceEditor.session.setUseWrapMode(true);
  aceEditor.setShowPrintMargin(false);
  aceEditor.setOptions({
    fontSize: "13px",
    tabSize: 2,
    useSoftTabs: true
  });
}

function getEditorValue() {
  if (aceEditor) return aceEditor.getValue();
  return "";
}

function setEditorValue(value) {
  if (aceEditor) {
    aceEditor.setValue(value || "", -1);
  }
}

function maybeUpdateMetricsFromConsoleLine(line) {
  const match = String(line || "").match(/\{.*\}$/);
  if (!match) return false;
  try {
    const obj = JSON.parse(match[0]);
    if (!obj || typeof obj.event !== "string") return false;
    if (!(obj.event in deviceMetrics)) return false;
    const val = obj.fps ?? obj.bytes ?? obj.words;
    if (typeof val === "undefined") return false;
    deviceMetrics[obj.event] = formatMetricValue(obj.event, val);
    renderMetrics();
    return true;
  } catch (_) {}
  return false;
}

function renderMetrics() {
  if (!metricsDiv) return;
  const cards = [
    metricCard("FPS", deviceMetrics.fps),
    metricCard("Heap Free", deviceMetrics.heap_free),
    metricCard("Heap Largest", deviceMetrics.heap_largest),
    metricCard("Wrench Stack", deviceMetrics.wrench_stack_hw),
    metricCard("Compile Stack", deviceMetrics.compile_stack_hw),
    metricCard("Loop Stack", deviceMetrics.loop_stack_hw)
  ];
  metricsDiv.html(`<div class="metrics-grid">${cards.join("")}</div>`);
}

function metricCard(label, value) {
  return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`;
}

function formatMetricValue(name, value) {
  if (name === "fps") return String(value);
  if (name.includes("heap")) return formatBytes(value);
  return String(value);
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return String(n) + " B";
}
