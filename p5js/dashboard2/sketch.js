window.showOverlay = false;

const AUTOMATION_INTERVAL_MS = 3 * 60 * 1000;
const DOC_MD_URL =
  "https://docs.google.com/document/d/1aYo8FZDIZpw3B1-zRs__Ug88DhGRpVDmBOQOfAKbLQU/export?format=md";

const PYR_ID = "reflector1";
const MQTT_CMD_TOPIC = `/glow_dk_cph/${PYR_ID}/cmd`;
const MQTT_EVT_TOPIC = `/glow_dk_cph/${PYR_ID}/evt`;
const MQTT_REFLECTION_TOPIC = `/glow_dk_cph/${PYR_ID}/reflection`;
const MQTT_CODE_STATE_TOPIC = `/glow_dk_cph/${PYR_ID}/code_state`;
const UI_PALETTE = ["#edae49", "#d1495b", "#00798c", "#30638e", "#003d5b"];

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
let previewDiv;
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
let previewController = null;
let previewRefreshTimer = null;

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
  setupPreview();
  connectMQTT();
}

function draw() {
  background(0, 25, 42);
  drawSidebar();
}

function drawSidebar() {
  noStroke();
  fill(0, 25, 42);
  rect(0, 0, width, height);
  fill(17, 50, 72);
  rect(width - 1, 0, 1, height);

  const sideMargin = 16;
  const innerW = width - sideMargin * 2;
  const innerX = sideMargin;
  let y = 20;
  const gap = 8;

  uiText("Reflector Dashboard", {
    x: innerX,
    y,
    width: innerW,
    height: 32,
    fontSize: 20,
    textStyle: BOLD,
    hAlign: "left",
    bgColor: "transparent",
    textColor: "#f4f7fb"
  });
  y += 32 + gap;

  uiText("Status: " + statusText, {
    x: innerX,
    y,
    width: innerW,
    height: 32,
    fontSize: 12,
    textStyle: BOLD,
    padding: 7,
    bgColor: isConnected ? "#0f3f48" : "#4a1f30",
    textColor: "#f4f7fb",
    vAlign: "middle"
  });
  y += 32 + gap;

  if (uiActionButton("Connect MQTT", !client, UI_PALETTE[2], innerX, y, innerW).clicked) connectMQTT();
  y += 32 + gap;
  if (uiActionButton("Disconnect", !!client, UI_PALETTE[1], innerX, y, innerW).clicked) disconnectMQTT();
  y += 32 + gap;
  if (uiActionButton("Get Code", isConnected, UI_PALETTE[3], innerX, y, innerW).clicked) cmdGetCode();
  y += 32 + gap;
  if (uiActionButton("Run Now", isConnected, UI_PALETTE[3], innerX, y, innerW).clicked) cmdRunNow();
  y += 32 + gap;
  if (uiActionButton("Store Only", isConnected, UI_PALETTE[3], innerX, y, innerW).clicked) cmdSetCode();
  y += 32 + gap;
  if (uiActionButton("Run + Store", isConnected, UI_PALETTE[3], innerX, y, innerW).clicked) cmdRunAndStore();
  y += 32 + gap;
  if (uiActionButton("Reboot", isConnected, UI_PALETTE[0], innerX, y, innerW).clicked) cmdReboot();
  y += 32 + gap;
  if (uiActionButton("Generate Wrench", isConnected && !generationInProgress, UI_PALETTE[1], innerX, y, innerW).clicked) {
    generateWrenchAndRun();
  }
  y += 32 + gap;
  if (uiActionButton(autoFixEnabled ? "Auto-fix: ON" : "Auto-fix: OFF", true, autoFixEnabled ? UI_PALETTE[2] : "#243847", innerX, y, innerW).clicked) {
    autoFixEnabled = !autoFixEnabled;
    logLine("Auto-fix is now " + (autoFixEnabled ? "ON" : "OFF"));
  }
  y += 32 + gap;
  if (uiActionButton(automationEnabled ? "Automation: ON" : "Automation: OFF", isConnected && !generationInProgress, automationEnabled ? UI_PALETTE[0] : "#243847", innerX, y, innerW).clicked) {
    toggleAutomation();
  }
  y += 32 + gap;
  if (uiActionButton("Insert Example", true, UI_PALETTE[4], innerX, y, innerW).clicked) {
    setEditorValue(defaultWrenchExample());
    refreshPreview();
  }
  y += 32 + gap;
  if (uiActionButton("Clear Console", true, UI_PALETTE[4], innerX, y, innerW).clicked) consoleDiv.html("");
  y += 32 + gap;

  uiText("Automation interval: " + Math.round(AUTOMATION_INTERVAL_MS / 1000) + "s", {
    x: innerX,
    y,
    width: innerW,
    height: 34,
    bgColor: "#092333",
    textColor: "#9db9c9"
  });
}

function uiActionButton(label, enabled, activeColor, x, y, buttonWidth) {
  return uiButton(label, {
    x,
    y,
    width: buttonWidth,
    height: 32,
    fontSize: 13,
    textStyle: BOLD,
    padding: 7,
    bgColor: enabled ? activeColor : "#173042",
    textColor: enabled ? "#f7f9fb" : "#6f8796",
    hover: { bgColor: enabled ? lightenHex(activeColor, 14) : "#173042" },
    pressed: { bgColor: enabled ? darkenHex(activeColor, 14) : "#173042" }
  });
}

function applyBaseUiStyle() {
  uiSetBaseStyle({
    common: {
      fontSize: 15,
      padding: 10,
      rounding: 10,
      bgColor: "#0c2432",
      textColor: "#eaf0f4",
      hover: { bgColor: "#133246" },
      pressed: { bgColor: "#071a25" }
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
  styleLogPanel(descriptionDiv, "#0a1f2d");

  metricsDiv = createDiv("");
  metricsDiv.parent(metricsSectionEl);
  metricsDiv.class("panel-box");
  metricsDiv.style("overflow", "auto");

  emptyDiv = createDiv("");
  emptyDiv.parent(emptySectionEl);
  emptyDiv.class("panel-box");
  emptyDiv.style("background", "#000000");
  emptyDiv.style("padding", "0");
  emptyDiv.style("overflow", "hidden");
  previewDiv = createDiv("");
  previewDiv.parent(emptyDiv);
  previewDiv.class("preview-wrap");

  consoleDiv = createDiv("");
  consoleDiv.parent(consoleSectionEl);
  consoleDiv.class("panel-box");
  styleLogPanel(consoleDiv, "#091520");
}

function styleLogPanel(el, bg) {
  el.style("overflow", "auto");
  el.style("white-space", "pre-wrap");
  el.style("font-family", "monospace");
  el.style("font-size", "12px");
  el.style("padding", "12px");
  el.style("background", bg);
  el.style("color", "#dce7ee");
  el.style("border", "1px solid #18435e");
  el.style("border-radius", "10px");
}

function updateDomLayout() {
  resizeCanvas(sidebarEl.elt.clientWidth, windowHeight);
  if (aceEditor) aceEditor.resize();
  if (previewController) previewController.resize();
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
    client.subscribe(MQTT_REFLECTION_TOPIC, (err) => {
      if (err) logLine("Subscribe error: " + err);
      else logLine("Subscribed: " + MQTT_REFLECTION_TOPIC);
    });
    client.subscribe(MQTT_CODE_STATE_TOPIC, (err) => {
      if (err) logLine("Subscribe error: " + err);
      else logLine("Subscribed: " + MQTT_CODE_STATE_TOPIC);
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
    if (topic === MQTT_REFLECTION_TOPIC) {
      applyReflectionMessage(s);
      return;
    }
    if (topic === MQTT_CODE_STATE_TOPIC) {
      applyCodeStateMessage(s);
      return;
    }
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

function publishCodeState(code, source) {
  if (!client || !isConnected) return;
  const payload = JSON.stringify({
    code: code || "",
    source: source || "dashboard2",
    updated_at: new Date().toISOString()
  });
  client.publish(MQTT_CODE_STATE_TOPIC, payload, { retain: true });
  logLine("Published retained code state.");
}

function applyReflectionMessage(msg) {
  if (!msg) return;
  try {
    const obj = JSON.parse(msg);
    if (typeof obj.description === "string") {
      lastDescription = obj.description;
      descriptionDiv.html(lastDescription);
    }
    if (typeof obj.code === "string" && !getEditorValue().trim()) {
      setEditorValue(obj.code);
      refreshPreview();
    }
    logLine("Loaded retained reflection.");
  } catch (err) {
    logLine("Reflection parse error: " + (err && err.message ? err.message : err));
  }
}

function applyCodeStateMessage(msg) {
  if (!msg) return;
  try {
    const obj = JSON.parse(msg);
    if (typeof obj.code !== "string") return;
    if (getEditorValue() !== obj.code) {
      setEditorValue(obj.code);
      refreshPreview();
    }
    logLine("Loaded retained code state.");
  } catch (err) {
    logLine("Code state parse error: " + (err && err.message ? err.message : err));
  }
}

function cmdGetCode() {
  pendingGetCode = true;
  lastRequestId++;
  publishJsonLine({ cmd: "get_code" });
}

function cmdRunNow() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "run_now", code });
  publishCodeState(code, "run_now");
}

function cmdSetCode() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "set_code", code });
  publishCodeState(code, "set_code");
}

function cmdRunAndStore() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "run_and_store", code });
  publishCodeState(code, "run_and_store");
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
    refreshPreview();
    publishJsonLine({ cmd: "run_now", code: out.wrench_code });
    publishReflectionUpdate(out.description, out.wrench_code);
    publishCodeState(out.wrench_code, "generate");
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
      refreshPreview();
      publishCodeState(obj.code, "get_code");
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
    refreshPreview();
    if (fixed.description) logLine(fixed.description);
    publishJsonLine({ cmd: "run_now", code: fixed.wrench_code });
    publishCodeState(fixed.wrench_code, "auto_fix");
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
  emptySectionEl = createSection(infoColumnEl, "third", "Preview");
  metricsSectionEl.addClass("device-info");
  emptySectionEl.addClass("preview-section");
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
  return 224;
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
  aceEditor.session.on("change", () => {
    refreshPreviewSoon();
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

function setupPreview() {
  previewController = new WrenchPreviewController(previewDiv);
  refreshPreview();
}

function refreshPreviewSoon() {
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer);
  previewRefreshTimer = setTimeout(() => {
    previewRefreshTimer = null;
    refreshPreview();
  }, 180);
}

function refreshPreview() {
  if (!previewController) return;
  previewController.setSource(getEditorValue());
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

const PREVIEW_TUBE_ENDPOINTS = [
  [{ x: -77.75, y: -38.784, z: -54.848 }, { x: 77.75, y: -38.784, z: -54.848 }],
  [{ x: 86.375, y: -38.784, z: -39.909 }, { x: 8.625, y: -38.784, z: 94.758 }],
  [{ x: -8.625, y: -38.784, z: 94.758 }, { x: -86.375, y: -38.784, z: -39.909 }],
  [{ x: -86.375, y: -24.699, z: -49.869 }, { x: -8.625, y: 102.266, z: -4.98 }],
  [{ x: 8.625, y: 102.266, z: -4.98 }, { x: 86.375, y: -24.699, z: -49.869 }],
  [{ x: 0.0, y: -24.699, z: 99.737 }, { x: 0.0, y: 102.266, z: 9.959 }]
];

class WrenchPreviewController {
  constructor(hostDiv) {
    this.hostDiv = hostDiv;
    this.runtime = null;
    this.instance = null;
    this.lastSource = "";
    this.error = "";
    this.loopStarted = false;
    this.segmentColors = Array.from({ length: 6 }, () => Array.from({ length: 40 }, () => "#000000"));
    this.preview3d = new WrenchPreview3D(hostDiv);
    this.startLoop();
  }

  setSource(source) {
    const next = String(source || "");
    if (next === this.lastSource) return;
    this.lastSource = next;
    this.compile(next);
  }

  compile(source) {
    this.error = "";
    try {
      this.runtime = new WrenchPreviewRuntime();
      const translated = translateWrenchToJs(source);
      const scope = this.runtime.createScope();
      const factory = new Function(
        "scope",
        `with(scope){ ${translated}\nreturn { setup: (typeof setup === "function") ? setup : null, tick: (typeof tick === "function") ? tick : null }; }`
      );
      this.instance = factory(scope);
      if (this.instance.setup) this.instance.setup();
      this.render();
    } catch (err) {
      this.instance = null;
      this.runtime = null;
      this.error = err && err.message ? err.message : String(err);
      this.renderError();
    }
  }

  startLoop() {
    if (this.loopStarted) return;
    this.loopStarted = true;
    const step = () => {
      if (this.instance && this.instance.tick && this.runtime) {
        try {
          this.instance.tick();
          this.runtime.sdf_render();
          this.render();
        } catch (err) {
          this.error = err && err.message ? err.message : String(err);
          this.instance = null;
          this.runtime = null;
          this.renderError();
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  render() {
    if (!this.runtime) {
      this.renderError();
      return;
    }
    this.error = "";
    this.segmentColors = this.runtime.getTubeSegmentHexColors();
    this.preview3d.setState({ segmentColors: this.segmentColors, error: "" });
  }

  renderError() {
    this.preview3d.setState({
      segmentColors: this.segmentColors,
      error: this.error || "Preview unavailable"
    });
  }

  resize() {
    if (this.preview3d) this.preview3d.resize();
  }
}

class WrenchPreview3D {
  constructor(hostDiv) {
    this.hostDiv = hostDiv;
    this.segmentColors = Array.from({ length: 6 }, () => Array.from({ length: 40 }, () => "#000000"));
    this.error = "";
    this.instance = new p5((p) => this.mountSketch(p), hostDiv.elt);
  }

  mountSketch(p) {
    this.p = p;
    p.setup = () => {
      const { width, height } = this.getSize();
      const c = p.createCanvas(width, height, p.WEBGL);
      c.parent(this.hostDiv.elt);
      p.setAttributes("antialias", true);
    };

    p.draw = () => {
      p.background(0);
      p.orbitControl(1.2, 1.2, 0.15);
      p.noStroke();

      p.push();
      p.scale(1.55);
      p.rotateX(-0.25);
      this.drawPyramid(p);
      p.pop();

      if (this.error) {
        this.drawErrorOverlay(p, this.error);
      }
    };

    p.windowResized = () => this.resize();
  }

  getSize() {
    const rect = this.hostDiv.elt.getBoundingClientRect();
    return {
      width: Math.max(80, Math.floor(rect.width || 320)),
      height: Math.max(80, Math.floor(rect.height || 260))
    };
  }

  resize() {
    if (!this.p) return;
    const { width, height } = this.getSize();
    this.p.resizeCanvas(width, height);
  }

  setState({ segmentColors, error }) {
    if (segmentColors) this.segmentColors = segmentColors;
    this.error = error || "";
  }

  drawPyramid(p) {
    const tubes = [
      { from: [ -95,  40, -55 ], to: [  95,  40, -55 ], colors: this.segmentColors[0] || [] },
      { from: [ -95,  40, -55 ], to: [   0, 110,  55 ], colors: this.segmentColors[3] || [] },
      { from: [  95,  40, -55 ], to: [   0, 110,  55 ], colors: this.segmentColors[4] || [] },
      { from: [  95,  40, -55 ], to: [   0, -70,  85 ], colors: this.segmentColors[1] || [] },
      { from: [   0, -70,  85 ], to: [ -95,  40, -55 ], colors: this.segmentColors[2] || [] },
      { from: [   0, -70,  85 ], to: [   0, 110,  55 ], colors: this.segmentColors[5] || [] }
    ];

    for (const tube of tubes) {
      this.drawSegmentedCylinder(p, tube.from, tube.to, tube.colors);
    }
  }

  drawSegmentedCylinder(p, from, to, colors) {
    const segments = Math.max(1, colors.length || 40);
    const radius = 6.5;
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const a = t0;
      const b = t1;
      const start = lerpVec3(from, to, a);
      const end = lerpVec3(from, to, b);
      this.drawCylinderBetween(p, start, end, colors[i] || "#202020", radius);
    }
  }

  drawCylinderBetween(p, start, end, hexColor, radius) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len <= 0.0001) return;

    const midX = (start[0] + end[0]) * 0.5;
    const midY = (start[1] + end[1]) * 0.5;
    const midZ = (start[2] + end[2]) * 0.5;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
    const c = hexToRgb(hexColor);

    p.push();
    p.translate(midX, midY, midZ);
    p.rotateY(yaw);
    p.rotateX(pitch);
    p.emissiveMaterial(c.r, c.g, c.b);
    p.cylinder(radius, len, 10, 1, false, false);
    p.pop();
  }

  drawErrorOverlay(p, message) {
    p.push();
    p.resetMatrix();
    p.translate(-p.width / 2, -p.height / 2);
    p.noStroke();
    p.fill(0, 0, 0, 170);
    p.rect(0, p.height - 42, p.width, 42);
    p.fill(237, 174, 73);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(12);
    p.text(message, 12, p.height - 21);
    p.pop();
  }
}

class WrenchPreviewRuntime {
  constructor() {
    this.startMs = performance.now();
    this.brightness = 255;
    this.shapes = [];
    this.palettes = {};
    this.tubeColors = Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0 }));
    this.directTubeTouched = Array.from({ length: 6 }, () => false);
    this.directAccum = Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0, count: 0, maxR: 0, maxG: 0, maxB: 0 }));
    this.noiseSeedValue = 1;
  }

  createScope() {
    const runtime = this;
    return {
      STRIPS: 6,
      TUBES: 6,
      TOTAL_LEDS: 5352,
      math: Math,
      int: (v) => Math.trunc(Number(v) || 0),
      millis: () => runtime.millis(),
      leds_begin: () => 1,
      leds_set_brightness: (b) => { runtime.brightness = Number(b) || 0; return 0; },
      leds_clear: () => runtime.leds_clear(),
      leds_set_pixel: (...args) => runtime.leds_set_pixel(...args),
      leds_show: () => runtime.leds_show(),
      sdf_set_count: (n) => runtime.sdf_set_count(n),
      sdf_palette_hsv3: (...args) => runtime.sdf_palette_hsv3(...args),
      sdf_set_sphere: (...args) => runtime.sdf_set_sphere(...args),
      sdf_set_palette: (...args) => runtime.sdf_set_palette(...args),
      sdf_set_material: (...args) => runtime.sdf_set_material(...args),
      sdf_set_tex_time: (...args) => runtime.sdf_set_tex_time(...args),
      sdf_render: () => runtime.sdf_render(),
      noise_seed: (seed) => runtime.noise_seed(seed),
      randomSeed: (seed) => runtime.randomSeed(seed),
      simplex3: (x, y, z) => runtime.simplex3(x, y, z),
      simplex3_01: (x, y, z) => runtime.simplex3_01(x, y, z),
      tube_lerp: (tube, t01, which) => runtime.tube_lerp(tube, t01, which),
      print: () => 0,
      println: () => 0
    };
  }

  millis() {
    return performance.now() - this.startMs;
  }

  leds_clear() {
    this.tubeColors = Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0 }));
    this.directTubeTouched = Array.from({ length: 6 }, () => false);
    this.directAccum = Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0, count: 0, maxR: 0, maxG: 0, maxB: 0 }));
    return 0;
  }

  leds_set_pixel(...args) {
    if (args.length >= 5) {
      const strip = clampIndex(args[0], 6);
      this.addDirectPixel(strip, args[2], args[3], args[4]);
    } else if (args.length >= 4) {
      const perTube = 5352 / 6;
      const strip = clampIndex(Math.floor((Number(args[0]) || 0) / perTube), 6);
      this.addDirectPixel(strip, args[1], args[2], args[3]);
    }
    return 0;
  }

  addDirectPixel(strip, r, g, b) {
    const bucket = this.directAccum[strip];
    const rr = Number(r) || 0;
    const gg = Number(g) || 0;
    const bb = Number(b) || 0;
    if (rr > 0 || gg > 0 || bb > 0) {
      bucket.r += rr;
      bucket.g += gg;
      bucket.b += bb;
      bucket.count += 1;
      bucket.maxR = Math.max(bucket.maxR, rr);
      bucket.maxG = Math.max(bucket.maxG, gg);
      bucket.maxB = Math.max(bucket.maxB, bb);
    }
    this.directTubeTouched[strip] = true;
  }

  leds_show() {
    for (let i = 0; i < 6; i++) {
      const bucket = this.directAccum[i];
      if (!bucket.count) {
        this.tubeColors[i] = { r: 0, g: 0, b: 0 };
        continue;
      }
      const avg = {
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count
      };
      const visible = {
        r: Math.max(avg.r, bucket.maxR * 0.55),
        g: Math.max(avg.g, bucket.maxG * 0.55),
        b: Math.max(avg.b, bucket.maxB * 0.55)
      };
      this.tubeColors[i] = applyBrightness({
        r: visible.r,
        g: visible.g,
        b: visible.b
      }, this.brightness);
    }
    return 0;
  }

  sdf_set_count(n) {
    this.shapes.length = Math.max(0, Math.floor(Number(n) || 0));
    return 0;
  }

  sdf_palette_hsv3(id, h1, s1, v1, h2, s2, v2, h3, s3, v3) {
    this.palettes[id] = [
      hsvToRgb(h1, s1, v1),
      hsvToRgb(h2, s2, v2),
      hsvToRgb(h3, s3, v3)
    ];
    return 0;
  }

  sdf_set_sphere(i, x, y, z, r, hue, sat, val, alpha) {
    this.shapes[i] = {
      type: "sphere",
      x: Number(x) || 0,
      y: Number(y) || 0,
      z: Number(z) || 0,
      r: Math.max(1, Number(r) || 1),
      color: hsvToRgb(hue, sat, val),
      alpha: Number(alpha) || 0.6,
      paletteId: null
    };
    return 0;
  }

  sdf_set_palette(i, paletteId) {
    if (this.shapes[i]) this.shapes[i].paletteId = paletteId;
    return 0;
  }

  sdf_set_material() {
    return 0;
  }

  noise_seed(seed) {
    this.noiseSeedValue = Number(seed) || 1;
    if (typeof noiseSeed === "function") noiseSeed(this.noiseSeedValue);
    return 0;
  }

  randomSeed(seed) {
    this.noiseSeedValue = Number(seed) || 1;
    if (typeof randomSeed === "function") randomSeed(this.noiseSeedValue);
    return 0;
  }

  sdf_set_tex_time() {
    return 0;
  }

  simplex3(x, y, z) {
    return this.simplex3_01(x, y, z) * 2 - 1;
  }

  simplex3_01(x, y, z) {
    if (typeof noise === "function") {
      const seedOffset = this.noiseSeedValue * 0.001;
      return noise(
        (Number(x) || 0) + seedOffset,
        (Number(y) || 0) + seedOffset * 2,
        (Number(z) || 0) + seedOffset * 3
      );
    }
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + this.noiseSeedValue * 0.1234) * 43758.5453;
    return n - Math.floor(n);
  }

  tube_lerp(tube, t01, which) {
    const pair = PREVIEW_TUBE_ENDPOINTS[clampIndex(tube, 6)] || PREVIEW_TUBE_ENDPOINTS[0];
    const t = Math.max(0, Math.min(1, Number(t01) || 0));
    const p = {
      x: pair[0].x + (pair[1].x - pair[0].x) * t,
      y: pair[0].y + (pair[1].y - pair[0].y) * t,
      z: pair[0].z + (pair[1].z - pair[0].z) * t
    };
    if (which === 1) return p.y;
    if (which === 2) return p.z;
    return p.x;
  }

  sdf_render() {
    for (let t = 0; t < 6; t++) {
      if (this.directTubeTouched[t]) continue;

      let accum = { r: 0, g: 0, b: 0 };
      for (let s = 0; s < 12; s++) {
        const u = s / 11;
        const p = this.samplePoint(t, u);
        const c = this.sampleSceneAt(p.x, p.y, p.z);
        accum.r += c.r;
        accum.g += c.g;
        accum.b += c.b;
      }
      this.tubeColors[t] = applyBrightness({
        r: accum.r / 12,
        g: accum.g / 12,
        b: accum.b / 12
      }, this.brightness);
    }
    return 0;
  }

  samplePoint(tube, u) {
    return {
      x: this.tube_lerp(tube, u, 0),
      y: this.tube_lerp(tube, u, 1),
      z: this.tube_lerp(tube, u, 2)
    };
  }

  sampleSceneAt(x, y, z) {
    let accum = { r: 0, g: 0, b: 0 };
    for (const shape of this.shapes) {
      if (!shape) continue;
      const dx = x - shape.x;
      const dy = y - shape.y;
      const dz = z - shape.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const falloff = Math.max(0, 1 - d / shape.r);
      if (falloff <= 0) continue;
      const c = this.pickShapeColor(shape, falloff);
      const strength = falloff * Math.max(0.18, shape.alpha);
      accum.r += c.r * strength;
      accum.g += c.g * strength;
      accum.b += c.b * strength;
    }
    return {
      r: Math.min(255, accum.r),
      g: Math.min(255, accum.g),
      b: Math.min(255, accum.b)
    };
  }

  pickShapeColor(shape, falloff) {
    if (!shape.paletteId || !this.palettes[shape.paletteId]) return shape.color;
    const pal = this.palettes[shape.paletteId];
    const idx = Math.max(0, Math.min(2, Math.floor(falloff * 2.99)));
    return mixRgb(shape.color, pal[idx], 0.55);
  }

  getTubeHexColors() {
    return this.tubeColors.map((c) => rgbToHex(c));
  }

  getTubeSegmentHexColors() {
    const segmentsPerTube = 40;
    const out = [];
    for (let tube = 0; tube < 6; tube++) {
      const row = [];
      if (this.directTubeTouched[tube]) {
        const hex = rgbToHex(this.tubeColors[tube]);
        for (let s = 0; s < segmentsPerTube; s++) row.push(hex);
        out.push(row);
        continue;
      }

      for (let s = 0; s < segmentsPerTube; s++) {
        const u0 = s / segmentsPerTube;
        const u1 = (s + 1) / segmentsPerTube;
        const c0 = this.sampleSceneAtTube(tube, u0 + (u1 - u0) * 0.25);
        const c1 = this.sampleSceneAtTube(tube, u0 + (u1 - u0) * 0.75);
        row.push(rgbToHex(applyBrightness({
          r: (c0.r + c1.r) * 0.5,
          g: (c0.g + c1.g) * 0.5,
          b: (c0.b + c1.b) * 0.5
        }, this.brightness)));
      }
      out.push(row);
    }
    return out;
  }

  sampleSceneAtTube(tube, u) {
    const p = this.samplePoint(tube, u);
    return this.sampleSceneAt(p.x, p.y, p.z);
  }
}

function translateWrenchToJs(src) {
  let out = String(src || "");
  out = out.replace(/\bvar\s+([A-Za-z_]\w*)\[\]\s*;/g, "var $1 = [];");
  out = out.replace(/math::/g, "math.");
  out = out.replace(/\(int\)\s*\(([^)]+)\)/g, "int($1)");
  return out;
}

function hsvToRgb(h, s, v) {
  const hh = ((((Number(h) || 0) % 256) + 256) % 256) / 255 * 360;
  const ss = Math.max(0, Math.min(1, (Number(s) || 0) / 255));
  const vv = Math.max(0, Math.min(1, (Number(v) || 0) / 255));
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function mixRgb(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k
  };
}

function applyBrightness(color, brightness) {
  const k = Math.max(0, Math.min(1, (Number(brightness) || 0) / 255));
  const boost = 0.55 + 0.9 * k;
  return {
    r: Math.round(Math.min(255, (color.r || 0) * boost)),
    g: Math.round(Math.min(255, (color.g || 0) * boost)),
    b: Math.round(Math.min(255, (color.b || 0) * boost))
  };
}

function rgbToHex(c) {
  return "#" + [c.r, c.g, c.b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");
}

function clampIndex(v, max) {
  return Math.max(0, Math.min(max - 1, Math.floor(Number(v) || 0)));
}

function lerpVec3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function hexToRgb(hex) {
  const raw = String(hex || "#000000").replace("#", "").padStart(6, "0");
  const value = parseInt(raw.slice(0, 6), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
