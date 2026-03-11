window.showOverlay = false;

const AUTOMATION_INTERVAL_OPTIONS_MINUTES = [0, 5, 15, 30, 60, 120, 240, 360, 600];
const AUTOMATION_INTERVAL_KEY = "dashboard2_automation_interval_minutes";
const GPT_MODEL_KEY = "dashboard2_gpt_model";
const GPT_MODEL_OPTIONS = [
  "gpt-5.1-codex",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.1-mini",
  "gpt-5-codex"
];
const DEFAULT_GPT_MODEL = "gpt-5.1-codex";
const ORBIT_STORAGE_VERSION = "v2";
const PYR_ID_KEY = "dashboard2_pyr_id";
const PYR_ID_OPTIONS = ["reflector1", "reflector2", "reflector3", "reflector4", "reflector5"];
const MQTT_READONLY_TOKEN = "XDyuEJgC9Q7veMrn";
const CONSOLE_MAX_LINES = 1000;
const DOC_MD_URL =
  "https://docs.google.com/document/d/1aYo8FZDIZpw3B1-zRs__Ug88DhGRpVDmBOQOfAKbLQU/export?format=md";

const UI_PALETTE = ["#303030", "#383838", "#424242", "#4a4a4a", "#262626"];
const DISPLAY_MODE_KEY = "dashboard2_display_mode";

let autoFixEnabled = false;
let autoFixInProgress = false;
let automationEnabled = false;
let automationTimerId = null;
let automationIntervalMinutes = 15;
let remoteAutomationStopped = false;
let automationWasRunningBeforeRemoteStop = false;
let debugDownloadsEnabled = false;
let generationInProgress = false;
let lastPromptText = "";
let lastDescription = "";
let lastCompileErrText = "";
let lastCompileErrMs = 0;
let selectedGptModel = DEFAULT_GPT_MODEL;
let selectedPyrId = "reflector1";
let isAuthenticated = false;
const dashboardInstanceId = "dashboard2-" + Math.floor(Math.random() * 1e9) + "-" + Date.now();

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
let displayMode = "preview";
let modeToggleButton = null;
let reflectionMeasureCanvas = null;
let sidebarStatusDiv = null;
let sidebarIntervalDiv = null;
let sidebarModelSelect = null;
let sidebarPyrSelect = null;
let sidebarAuthButton = null;
let sidebarShiftrLink = null;
let sidebarReflectionLink = null;
let sidebarPromptLink = null;
let sidebarButtons = {};
let sidebarSyncTimer = null;

async function setup() {
  noCanvas();
  displayMode = loadDisplayMode();
  automationIntervalMinutes = loadAutomationIntervalMinutes();
  selectedGptModel = loadSelectedGptModel();
  selectedPyrId = loadSelectedPyrId();
  createLayout();
  initializeAuthState();

  createSidebarControls();
  createDomPanels();
  createModeToggleButton();
  initAceEditor();

  setEditorValue(defaultWrenchExample());
  logLine("Ready.");
  logLine("cmd: " + mqttCmdTopic());
  logLine("evt: " + mqttEvtTopic());
  logLine(isAuthenticated ? "Authenticated mode." : "Read-only mode.");
  renderMetrics();
  applyDisplayMode();
  updateDomLayout();
  setupPreview();
  connectMQTT();
  syncSidebarControls();
  sidebarSyncTimer = window.setInterval(syncSidebarControls, 250);
}

function draw() {
  return;
}

function createDomPanels() {
  editorEl = createDiv("");
  editorEl.parent(editorSectionEl);
  editorEl.id("editor");
  editorEl.class("panel-box");

  descriptionDiv = createDiv("");
  descriptionDiv.parent(reflectionSectionEl);
  descriptionDiv.class("panel-box");
  styleLogPanel(descriptionDiv, "#000000");

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
  styleLogPanel(consoleDiv, "#000000");
}

function createSidebarControls() {
  const wrap = createDiv("");
  wrap.parent(sidebarEl);
  wrap.class("sidebar-controls");

  const buttonSpecs = [
    ["connectToggle", "Connect", () => {
      if (client) disconnectMQTT();
      else connectMQTT();
    }],
    ["getCode", "Get Code", () => cmdGetCode()],
    ["runNow", "Run Now", () => cmdRunNow()],
    ["storeOnly", "Store Only", () => cmdSetCode()],
    ["runStore", "Run + Store", () => cmdRunAndStore()],
    ["reboot", "Reboot", () => cmdReboot()],
    ["generate", "Generate Wrench", () => generateWrenchAndRun()],
    ["debugDownloads", "Debug: OFF", () => toggleDebugDownloads()],
    ["autoFix", "Auto-fix: OFF", () => {
      autoFixEnabled = !autoFixEnabled;
      logLine("Auto-fix is now " + (autoFixEnabled ? "ON" : "OFF"));
      syncSidebarControls();
    }],
    ["automationInterval", automationIntervalLabel(), () => cycleAutomationInterval()],
    ["automation", "Automation: OFF", () => toggleAutomation()],
    ["remoteAutomation", "Remote Stop", () => toggleRemoteAutomationEverywhere()],
    ["insertExample", "Insert Example", () => {
      setEditorValue(defaultWrenchExample());
      refreshPreview();
    }],
    ["clearConsole", "Clear Console", () => {
      consoleDiv.html("");
    }]
  ];

  for (const [key, label, handler] of buttonSpecs) {
    const btn = createButton(label);
    btn.parent(wrap);
    btn.class("sidebar-button");
    btn.mousePressed(handler);
    sidebarButtons[key] = btn;
  }

  sidebarAuthButton = createButton(isAuthenticated ? "Log Out" : "Log In");
  sidebarAuthButton.parent(wrap);
  sidebarAuthButton.class("sidebar-button");
  sidebarAuthButton.mousePressed(() => {
    if (isAuthenticated) logoutAuthenticatedMode();
    else loginAuthenticatedMode();
  });

  sidebarPyrSelect = createSelect();
  sidebarPyrSelect.parent(wrap);
  sidebarPyrSelect.class("sidebar-select");
  for (const pyrId of PYR_ID_OPTIONS) {
    sidebarPyrSelect.option(pyrId, pyrId);
  }
  sidebarPyrSelect.selected(selectedPyrId);
  sidebarPyrSelect.changed(() => {
    const nextId = sidebarPyrSelect.value();
    if (nextId === selectedPyrId) return;
    const prevId = selectedPyrId;
    selectedPyrId = nextId;
    persistSelectedPyrId();
    logLine("Reflector target: " + selectedPyrId);
    logLine("cmd: " + mqttCmdTopic());
    logLine("evt: " + mqttEvtTopic());
    resetSelectedReflectorState();
    if (client && isConnected) {
      resubscribeReflectorTopics(prevId, selectedPyrId);
      if (isAuthenticated) requestSelectedReflectorCode();
    }
    syncSidebarControls();
  });

  sidebarModelSelect = createSelect();
  sidebarModelSelect.parent(wrap);
  sidebarModelSelect.class("sidebar-select");
  for (const model of GPT_MODEL_OPTIONS) {
    sidebarModelSelect.option(model, model);
  }
  sidebarModelSelect.selected(selectedGptModel);
  sidebarModelSelect.changed(() => {
    selectedGptModel = sidebarModelSelect.value();
    persistSelectedGptModel();
    logLine("GPT model: " + selectedGptModel);
    syncSidebarControls();
  });

  sidebarStatusDiv = createDiv("");
  sidebarStatusDiv.parent(wrap);
  sidebarStatusDiv.class("sidebar-status");

  sidebarIntervalDiv = createDiv("");
  sidebarIntervalDiv.parent(wrap);
  sidebarIntervalDiv.class("sidebar-meta");

  sidebarShiftrLink = createA("https://reflector.cloud.shiftr.io/", "Open Shiftr", "_blank");
  sidebarShiftrLink.parent(wrap);
  sidebarShiftrLink.class("sidebar-link");

  sidebarReflectionLink = createA(reflectionViewUrl(), "Open Reflection", "_blank");
  sidebarReflectionLink.parent(wrap);
  sidebarReflectionLink.class("sidebar-link");

  sidebarPromptLink = createA(
    "https://docs.google.com/document/d/1aYo8FZDIZpw3B1-zRs__Ug88DhGRpVDmBOQOfAKbLQU/edit?tab=t.0#heading=h.m431eoeh85xi",
    "Prompt",
    "_blank"
  );
  sidebarPromptLink.parent(wrap);
  sidebarPromptLink.class("sidebar-link");
}

function syncSidebarControls() {
  if (!sidebarStatusDiv) return;
  sidebarStatusDiv.html("Status: " + statusText);
  sidebarStatusDiv.removeClass("is-connected");
  sidebarStatusDiv.removeClass("is-disconnected");
  sidebarStatusDiv.addClass(isConnected ? "is-connected" : "is-disconnected");

  updateSidebarButton("connectToggle", {
    label: client ? "Disconnect" : "Connect",
    disabled: false,
    tone: client ? "mid" : "mid"
  });
  updateSidebarButton("getCode", { disabled: !isConnected || !isAuthenticated, tone: isConnected && isAuthenticated ? "mid" : "off" });
  updateSidebarButton("runNow", { disabled: !isConnected || !isAuthenticated, tone: isConnected && isAuthenticated ? "mid" : "off" });
  updateSidebarButton("storeOnly", { disabled: !isConnected || !isAuthenticated, tone: isConnected && isAuthenticated ? "mid" : "off" });
  updateSidebarButton("runStore", { disabled: !isConnected || !isAuthenticated, tone: isConnected && isAuthenticated ? "mid" : "off" });
  updateSidebarButton("reboot", { disabled: !isConnected || !isAuthenticated, tone: isConnected && isAuthenticated ? "low" : "off" });
  updateSidebarButton("generate", { disabled: !isConnected || generationInProgress || !isAuthenticated, tone: isConnected && !generationInProgress && isAuthenticated ? "mid" : "off" });
  updateSidebarButton("debugDownloads", { label: debugDownloadsEnabled ? "Debug: ON" : "Debug: OFF", disabled: false, tone: debugDownloadsEnabled ? "high" : "low" });
  updateSidebarButton("autoFix", { label: autoFixEnabled ? "Auto-fix: ON" : "Auto-fix: OFF", disabled: !isAuthenticated, tone: autoFixEnabled && isAuthenticated ? "high" : "off" });
  updateSidebarButton("automationInterval", { label: automationIntervalLabel(), disabled: !isAuthenticated, tone: automationIntervalMinutes === 0 && isAuthenticated ? "high" : (isAuthenticated ? "low" : "off") });
  updateSidebarButton("automation", {
    label: automationEnabled ? "Automation: ON" : "Automation: OFF",
    disabled: !isConnected || generationInProgress || !isAuthenticated || remoteAutomationStopped,
    tone: automationEnabled && isAuthenticated ? "high" : "off"
  });
  updateSidebarButton("remoteAutomation", {
    label: remoteAutomationStopped ? "Remote Start" : "Remote Stop",
    disabled: !isConnected || !isAuthenticated,
    tone: isConnected && isAuthenticated ? "low" : "off"
  });
  updateSidebarButton("insertExample", { disabled: false, tone: "low" });
  updateSidebarButton("clearConsole", { disabled: false, tone: "low" });
  if (sidebarAuthButton) {
    sidebarAuthButton.html(isAuthenticated ? "Log Out" : "Log In");
    sidebarAuthButton.removeClass("tone-high");
    sidebarAuthButton.removeClass("tone-mid");
    sidebarAuthButton.removeClass("tone-low");
    sidebarAuthButton.removeClass("tone-off");
    sidebarAuthButton.addClass(isAuthenticated ? "tone-mid" : "tone-low");
  }
  if (sidebarPyrSelect) {
    sidebarPyrSelect.value(selectedPyrId);
    sidebarPyrSelect.removeClass("tone-high");
    sidebarPyrSelect.removeClass("tone-mid");
    sidebarPyrSelect.removeClass("tone-low");
    sidebarPyrSelect.removeClass("tone-off");
    sidebarPyrSelect.addClass(isConnected ? "tone-mid" : "tone-low");
  }
  if (sidebarModelSelect) {
    sidebarModelSelect.value(selectedGptModel);
    sidebarModelSelect.removeClass("tone-high");
    sidebarModelSelect.removeClass("tone-mid");
    sidebarModelSelect.removeClass("tone-low");
    sidebarModelSelect.removeClass("tone-off");
    sidebarModelSelect.addClass(isAuthenticated ? (isConnected ? "tone-mid" : "tone-low") : "tone-off");
    sidebarModelSelect.style("display", isAuthenticated ? "block" : "none");
  }
  setPrivilegedControlsVisible(isAuthenticated);

  if (sidebarIntervalDiv) {
    sidebarIntervalDiv.html(
      isAuthenticated
        ? `${selectedPyrId} · ${selectedGptModel}`
        : `${selectedPyrId} · read-only`
    );
  }
  if (sidebarReflectionLink) {
    sidebarReflectionLink.attribute("href", reflectionViewUrl());
  }
}

function updateSidebarButton(key, { label, disabled, tone }) {
  const btn = sidebarButtons[key];
  if (!btn) return;
  if (typeof label === "string") btn.html(label);
  if (disabled) btn.attribute("disabled", "");
  else btn.removeAttribute("disabled");
  btn.removeClass("tone-high");
  btn.removeClass("tone-mid");
  btn.removeClass("tone-low");
  btn.removeClass("tone-off");
  btn.addClass(`tone-${tone || "mid"}`);
}

function setPrivilegedControlsVisible(visible) {
  const privilegedKeys = [
    "getCode",
    "runNow",
    "storeOnly",
    "runStore",
    "reboot",
    "generate",
    "debugDownloads",
    "autoFix",
    "automationInterval",
    "automation",
    "remoteAutomation"
  ];
  for (const key of privilegedKeys) {
    const btn = sidebarButtons[key];
    if (!btn) continue;
    btn.style("display", visible ? "block" : "none");
  }
}

function automationIntervalLabel() {
  if (automationIntervalMinutes >= 60) {
    const hours = automationIntervalMinutes / 60;
    return "Refresh: " + (Number.isInteger(hours) ? hours : hours.toFixed(1)) + "h";
  }
  return "Refresh: " + automationIntervalMinutes + "m";
}

function loadAutomationIntervalMinutes() {
  try {
    const raw = Number(window.localStorage.getItem(AUTOMATION_INTERVAL_KEY));
    if (AUTOMATION_INTERVAL_OPTIONS_MINUTES.includes(raw)) return raw;
  } catch (_) {}
  return 15;
}

function persistAutomationIntervalMinutes() {
  try {
    window.localStorage.setItem(AUTOMATION_INTERVAL_KEY, String(automationIntervalMinutes));
  } catch (_) {}
}

function cycleAutomationInterval() {
  const idx = AUTOMATION_INTERVAL_OPTIONS_MINUTES.indexOf(automationIntervalMinutes);
  const nextIdx = idx >= 0 ? (idx + 1) % AUTOMATION_INTERVAL_OPTIONS_MINUTES.length : 0;
  automationIntervalMinutes = AUTOMATION_INTERVAL_OPTIONS_MINUTES[nextIdx];
  persistAutomationIntervalMinutes();
  logLine(
    automationIntervalMinutes === 0
      ? "Automation refresh set to 0 minutes (rerun immediately)."
      : "Automation refresh set to " + automationIntervalMinutes + " minutes."
  );
  if (automationEnabled) {
    scheduleNextAutomationRun();
  }
  syncSidebarControls();
}

function loadSelectedGptModel() {
  try {
    const saved = window.localStorage.getItem(GPT_MODEL_KEY);
    if (saved && GPT_MODEL_OPTIONS.includes(saved)) return saved;
  } catch (_) {}
  return DEFAULT_GPT_MODEL;
}

function persistSelectedGptModel() {
  try {
    window.localStorage.setItem(GPT_MODEL_KEY, selectedGptModel);
  } catch (_) {}
}

function loadSelectedPyrId() {
  try {
    const saved = window.localStorage.getItem(PYR_ID_KEY);
    if (saved && PYR_ID_OPTIONS.includes(saved)) return saved;
  } catch (_) {}
  return "reflector1";
}

function persistSelectedPyrId() {
  try {
    window.localStorage.setItem(PYR_ID_KEY, selectedPyrId);
  } catch (_) {}
}

function initializeAuthState() {
  OPENAI_API_KEY = "";
  mqttKey = "";
  isAuthenticated = false;
  try {
    const mqttPassword = getKey("mqttKeyEncrypted");
    const gptPassword = getKey("apiKeyEncryptedGpt");
    if (!mqttPassword || !gptPassword) return;
    const nextMqttKey = decryptKey(mqttKeyEncrypted, mqttPassword);
    const nextOpenAiKey = decryptKey(apiKeyEncryptedGpt, gptPassword);
    if (!nextMqttKey || !nextOpenAiKey) return;
    mqttKey = nextMqttKey;
    OPENAI_API_KEY = nextOpenAiKey;
    isAuthenticated = true;
  } catch (_) {}
}

function clearStoredAuthPasswords() {
  try {
    window.localStorage.removeItem("mqttKeyEncrypted");
    window.localStorage.removeItem("apiKeyEncryptedGpt");
  } catch (_) {}
}

function loginAuthenticatedMode() {
  const mqttPassword = window.prompt("Please enter MQTT password (mqttKeyEncrypted):", "");
  if (!mqttPassword) return;
  const gptPassword = window.prompt("Please enter ChatGPT password (apiKeyEncryptedGpt):", "");
  if (!gptPassword) return;

  const nextMqttKey = decryptKey(mqttKeyEncrypted, mqttPassword);
  const nextOpenAiKey = decryptKey(apiKeyEncryptedGpt, gptPassword);
  if (!nextMqttKey || !nextOpenAiKey) {
    logLine("Login failed: invalid password.");
    return;
  }

  storeKey("mqttKeyEncrypted", mqttPassword);
  storeKey("apiKeyEncryptedGpt", gptPassword);
  mqttKey = nextMqttKey;
  OPENAI_API_KEY = nextOpenAiKey;
  isAuthenticated = true;
  logLine("Authenticated mode enabled.");
  reconnectForCurrentAuthMode();
  syncSidebarControls();
}

function logoutAuthenticatedMode() {
  clearStoredAuthPasswords();
  OPENAI_API_KEY = "";
  mqttKey = "";
  isAuthenticated = false;
  autoFixEnabled = false;
  automationEnabled = false;
  clearAutomationTimer();
  logLine("Logged out. Switched to read-only mode.");
  reconnectForCurrentAuthMode();
  syncSidebarControls();
}

function reconnectForCurrentAuthMode() {
  const wasConnected = !!client;
  if (client) disconnectMQTT();
  if (wasConnected || !client) connectMQTT();
}

function mqttCmdTopic(pyrId = selectedPyrId) {
  return `/glow_dk_cph/${pyrId}/cmd`;
}

function mqttEvtTopic(pyrId = selectedPyrId) {
  return `/glow_dk_cph/${pyrId}/evt`;
}

function mqttReflectionTopic(pyrId = selectedPyrId) {
  return `/glow_dk_cph/${pyrId}/reflection`;
}

function mqttCodeStateTopic(pyrId = selectedPyrId) {
  return `/glow_dk_cph/${pyrId}/code_state`;
}

function mqttDashboardSyncTopic(pyrId = selectedPyrId) {
  return `/glow_dk_cph/${pyrId}/dashboard_sync`;
}

function mqttConsoleTopic(pyrId = selectedPyrId) {
  return `/glow_dk_cph/${pyrId}/dashboard_console`;
}

function reflectionViewUrl(pyrId = selectedPyrId) {
  return `../reflection/?id=${encodeURIComponent(pyrId)}`;
}

function subscribeReflectorTopics(pyrId = selectedPyrId) {
  client.subscribe(mqttEvtTopic(pyrId), (err) => {
    if (err) logLine("Subscribe error: " + err);
    else logLine("Subscribed: " + mqttEvtTopic(pyrId));
  });
  client.subscribe(mqttReflectionTopic(pyrId), (err) => {
    if (err) logLine("Subscribe error: " + err);
    else logLine("Subscribed: " + mqttReflectionTopic(pyrId));
  });
  client.subscribe(mqttCodeStateTopic(pyrId), (err) => {
    if (err) logLine("Subscribe error: " + err);
    else logLine("Subscribed: " + mqttCodeStateTopic(pyrId));
  });
  client.subscribe(mqttDashboardSyncTopic(pyrId), (err) => {
    if (err) logLine("Subscribe error: " + err);
    else logLine("Subscribed: " + mqttDashboardSyncTopic(pyrId));
  });
  client.subscribe(mqttConsoleTopic(pyrId), (err) => {
    if (err) logLine("Subscribe error: " + err);
    else logLine("Subscribed: " + mqttConsoleTopic(pyrId));
  });
}

function unsubscribeReflectorTopics(pyrId) {
  if (!client) return;
  client.unsubscribe(mqttEvtTopic(pyrId));
  client.unsubscribe(mqttReflectionTopic(pyrId));
  client.unsubscribe(mqttCodeStateTopic(pyrId));
  client.unsubscribe(mqttDashboardSyncTopic(pyrId));
  client.unsubscribe(mqttConsoleTopic(pyrId));
}

function resubscribeReflectorTopics(prevId, nextId) {
  unsubscribeReflectorTopics(prevId);
  subscribeReflectorTopics(nextId);
}

function resetSelectedReflectorState() {
  lastDescription = "";
  descriptionDiv.html("");
  if (previewController) previewController.setReflectionText("");
  setEditorValue("");
  refreshPreview();
  deviceMetrics = {
    fps: "--",
    heap_free: "--",
    heap_largest: "--",
    wrench_stack_hw: "--",
    compile_stack_hw: "--",
    loop_stack_hw: "--"
  };
  renderMetrics();
}

function requestSelectedReflectorCode() {
  if (!client || !isConnected) return;
  pendingGetCode = true;
  publishJsonLine({ cmd: "get_code" });
}

function styleLogPanel(el, bg) {
  el.style("overflow", "auto");
  el.style("white-space", "pre-wrap");
  el.style("font-family", "monospace");
  el.style("font-size", "12px");
  el.style("padding", "12px");
  el.style("background", bg);
  el.style("color", "#dce7ee");
  el.style("border", "0");
  el.style("border-radius", "10px");
}

function loadDisplayMode() {
  try {
    const saved = window.localStorage.getItem(DISPLAY_MODE_KEY);
    return saved === "debug" ? "debug" : "preview";
  } catch (_) {
    return "preview";
  }
}

function setDisplayMode(nextMode) {
  displayMode = nextMode === "debug" ? "debug" : "preview";
  try {
    window.localStorage.setItem(DISPLAY_MODE_KEY, displayMode);
  } catch (_) {}
  applyDisplayMode();
  updateDomLayout();
  syncSidebarControls();
}

function toggleDisplayMode() {
  setDisplayMode(displayMode === "preview" ? "debug" : "preview");
}

function applyDisplayMode() {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("preview-mode", displayMode === "preview");
  document.body.classList.toggle("debug-mode", displayMode === "debug");
  if (modeToggleButton) {
    modeToggleButton.html(displayMode === "preview" ? "Debug" : "Preview");
  }
  if (previewController) {
    previewController.setReflectionText(lastDescription || descriptionDiv?.elt?.textContent || "");
  }
  updateReflectionTypography();
}

function createModeToggleButton() {
  modeToggleButton = createButton(displayMode === "preview" ? "Debug" : "Preview");
  modeToggleButton.parent(document.body);
  modeToggleButton.id("mode-toggle");
  modeToggleButton.mousePressed(toggleDisplayMode);
}

function updateReflectionTypography() {
  if (!descriptionDiv || displayMode !== "preview") return;
  const style = window.getComputedStyle(descriptionDiv.elt);
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const boxW = Math.max(120, descriptionDiv.elt.clientWidth - padX);
  const boxH = Math.max(80, descriptionDiv.elt.clientHeight - padY);
  const textValue = lastDescription || descriptionDiv.elt.textContent || "";
  const fittedSize = fitReflectionTextSize(textValue, boxW, boxH);
  descriptionDiv.style("font-family", "Georgia, Times New Roman, serif");
  descriptionDiv.style("font-size", fittedSize + "px");
  descriptionDiv.style("line-height", (fittedSize * 1.08) + "px");
}

function reflectionBaseTextSize() {
  return constrain(min(windowWidth, windowHeight) * 0.11, 42, 110);
}

function fitReflectionTextSize(content, boxW, boxH) {
  const textValue = String(content || "");
  let size = reflectionBaseTextSize();
  const minSize = 18;
  while (size > minSize) {
    const bounds = reflectionFontBoundsForBox(textValue, boxW, size);
    if (bounds.height <= boxH) return size;
    size -= 2;
  }
  return minSize;
}

function reflectionFontBoundsForBox(content, boxW, fontSize) {
  if (!reflectionMeasureCanvas) {
    reflectionMeasureCanvas = document.createElement("canvas");
  }
  const ctx = reflectionMeasureCanvas.getContext("2d");
  ctx.font = `${fontSize}px Georgia`;
  const paragraphs = String(content).split("\n");
  const leadingValue = fontSize * 1.08;
  let lineCount = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lineCount += 1;
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (ctx.measureText(candidate).width <= boxW) {
        line = candidate;
      } else {
        if (line) {
          lineCount += 1;
          line = word;
        } else {
          let chunk = "";
          for (const ch of word) {
            const nextChunk = chunk + ch;
            if (chunk && ctx.measureText(nextChunk).width > boxW) {
              lineCount += 1;
              chunk = ch;
            } else {
              chunk = nextChunk;
            }
          }
          line = chunk;
        }
      }
    }
    if (line) lineCount += 1;
  }
  return { height: lineCount * leadingValue };
}

function fitPreviewCanvasTextSize(p, content, boxW, boxH) {
  const textValue = String(content || "");
  let size = constrain(min(p.width, p.height) * 0.11, 42, 110);
  const minSize = 18;
  while (size > minSize) {
    p.textSize(size);
    p.textLeading(size * 1.08);
    const bounds = previewCanvasFontBounds(p, textValue, boxW);
    if (bounds.height <= boxH) return size;
    size -= 2;
  }
  return minSize;
}

function previewCanvasFontBounds(p, content, boxW) {
  const paragraphs = String(content).split("\n");
  const leadingValue = p.textAscent() + p.textDescent() + p.textSize() * 0.08;
  let lineCount = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lineCount += 1;
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (p.textWidth(candidate) <= boxW) {
        line = candidate;
      } else {
        if (line) {
          lineCount += 1;
          line = word;
        } else {
          let chunk = "";
          for (const ch of word) {
            const nextChunk = chunk + ch;
            if (chunk && p.textWidth(nextChunk) > boxW) {
              lineCount += 1;
              chunk = ch;
            } else {
              chunk = nextChunk;
            }
          }
          line = chunk;
        }
      }
    }
    if (line) lineCount += 1;
  }
  return { height: lineCount * leadingValue };
}

function fitPreviewGraphicsTextSize(g, content, boxW, boxH) {
  const textValue = String(content || "");
  let size = constrain(min(g.width, g.height) * 0.11, 42, 110);
  const minSize = 18;
  while (size > minSize) {
    g.textSize(size);
    g.textLeading(size * 1.08);
    const bounds = previewGraphicsFontBounds(g, textValue, boxW);
    if (bounds.height <= boxH) return size;
    size -= 2;
  }
  return minSize;
}

function previewGraphicsFontBounds(g, content, boxW) {
  const paragraphs = String(content).split("\n");
  const leadingValue = g.textAscent() + g.textDescent() + g.textSize() * 0.08;
  let lineCount = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lineCount += 1;
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (g.textWidth(candidate) <= boxW) {
        line = candidate;
      } else {
        if (line) {
          lineCount += 1;
          line = word;
        } else {
          let chunk = "";
          for (const ch of word) {
            const nextChunk = chunk + ch;
            if (chunk && g.textWidth(nextChunk) > boxW) {
              lineCount += 1;
              chunk = ch;
            } else {
              chunk = nextChunk;
            }
          }
          line = chunk;
        }
      }
    }
    if (line) lineCount += 1;
  }
  return { height: lineCount * leadingValue };
}

function updateDomLayout() {
  if (aceEditor) aceEditor.resize();
  if (previewController) previewController.resize();
  updateReflectionTypography();
}

function connectMQTT() {
  if (!window.mqtt) {
    logLine("mqtt.min.js not loaded.");
    syncSidebarControls();
    return;
  }
  if (client) {
    logLine("Already connected or connecting.");
    syncSidebarControls();
    return;
  }

  const clientId = "portal-dashboard-" + Math.floor(Math.random() * 1e9);
  statusText = "Connecting MQTT...";
  logLine("Connecting MQTT as " + clientId + "...");
  syncSidebarControls();

  const mqttToken = isAuthenticated ? mqttKey : MQTT_READONLY_TOKEN;
  client = mqtt.connect("wss://reflector:" + mqttToken + "@reflector.cloud.shiftr.io", {
    clientId,
    keepalive: 20,
    reconnectPeriod: 1000,
    connectTimeout: 5000
  });

  client.on("connect", () => {
    isConnected = true;
    statusText = isAuthenticated ? "MQTT connected" : "MQTT connected (read-only)";
    logLine(isAuthenticated ? "MQTT connected." : "MQTT connected in read-only mode.");
    syncSidebarControls();
    subscribeReflectorTopics(selectedPyrId);
    if (isAuthenticated) {
      requestSelectedReflectorCode();
    }
  });

  client.on("reconnect", () => {
    statusText = "MQTT reconnecting";
    logLine("MQTT reconnecting...");
    syncSidebarControls();
  });

  client.on("close", () => {
    isConnected = false;
    statusText = "MQTT closed";
    logLine("MQTT closed.");
    client = null;
    clearAutomationTimer();
    syncSidebarControls();
  });

  client.on("error", (err) => {
    statusText = "MQTT error";
    logLine("MQTT error: " + err);
    syncSidebarControls();
  });

  client.on("message", (topic, message) => {
    const s = message ? message.toString() : "";
    if (topic === mqttReflectionTopic()) {
      applyReflectionMessage(s);
      return;
    }
    if (topic === mqttCodeStateTopic()) {
      applyCodeStateMessage(s);
      return;
    }
    if (topic === mqttDashboardSyncTopic()) {
      applyDashboardSyncMessage(s);
      return;
    }
    if (topic === mqttConsoleTopic()) {
      applyRemoteConsoleMessage(s);
      return;
    }
    if (topic !== mqttEvtTopic()) return;
    maybeDownloadPyramidError(s);
    if (!logSummarizedEvtMessage(topic, s)) {
      logLine(topic + ": " + s);
    }
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
  syncSidebarControls();
}

function toggleAutomation() {
  automationEnabled = !automationEnabled;
  if (remoteAutomationStopped && automationEnabled) {
    automationEnabled = false;
    logLine("Automation is remotely stopped. Use Remote Start first.");
    syncSidebarControls();
    return;
  }
  syncSidebarControls();
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
  syncSidebarControls();
}

function scheduleNextAutomationRun() {
  clearAutomationTimer();
  if (!automationEnabled) return;
  const automationIntervalMs = automationIntervalMinutes * 60 * 1000;

  automationTimerId = setTimeout(() => {
    automationTimerId = null;
    if (!automationEnabled) return;
    if (!client || !isConnected) {
      logLine("Automation skipped: MQTT not connected.");
      scheduleNextAutomationRun();
      return;
    }
    generateWrenchAndRun();
  }, automationIntervalMs);
}

function publishJsonLine(obj) {
  if (!client || !isConnected) {
    logLine("MQTT not connected.");
    return;
  }
  if (!isAuthenticated) {
    logLine("Read-only mode: command not sent.");
    return;
  }
  const payload = JSON.stringify(obj) + "\n";
  client.publish(mqttCmdTopic(), payload);
  logLine(">>> " + payload.trim());
}

function publishReflectionUpdate(description, code) {
  if (!client || !isConnected) return;
  const payload = JSON.stringify({
    description: description || "",
    code: code || "",
    generated_at: new Date().toISOString(),
    dashboard_id: dashboardInstanceId
  });
  client.publish(mqttReflectionTopic(), payload, { retain: true });
  logLine("Published reflection update.");
}

function publishCodeState(code, source) {
  if (!client || !isConnected) return;
  const payload = JSON.stringify({
    code: code || "",
    source: source || "dashboard2",
    updated_at: new Date().toISOString(),
    dashboard_id: dashboardInstanceId
  });
  client.publish(mqttCodeStateTopic(), payload, { retain: true });
  logLine("Published retained code state.");
}

function publishDashboardSync(eventType, data = {}) {
  if (!client || !isConnected || !isAuthenticated) return;
  const payload = JSON.stringify({
    event: eventType,
    reflector_id: selectedPyrId,
    dashboard_id: dashboardInstanceId,
    sent_at: new Date().toISOString(),
    ...data
  });
  client.publish(mqttDashboardSyncTopic(), payload);
}

function publishConsoleLine(line) {
  if (!client || !isConnected || !automationEnabled) return;
  try {
    client.publish(mqttConsoleTopic(), JSON.stringify({
      dashboard_id: dashboardInstanceId,
      line: String(line ?? ""),
      sent_at: new Date().toISOString()
    }));
  } catch (_) {}
}

function toggleDebugDownloads() {
  debugDownloadsEnabled = !debugDownloadsEnabled;
  logLine("Debug downloads " + (debugDownloadsEnabled ? "enabled." : "disabled."));
  syncSidebarControls();
}

function downloadBrowserFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(content ?? "")], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function debugTimestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function maybeDownloadParsedPrompt(md) {
  if (!debugDownloadsEnabled) return;
  downloadBrowserFile(
    `${selectedPyrId}-prompt-${debugTimestampSlug()}.md`,
    md,
    "text/markdown;charset=utf-8"
  );
}

function maybeDownloadStructuredResponse(kind, payload) {
  if (!debugDownloadsEnabled) return;
  downloadBrowserFile(
    `${selectedPyrId}-${kind}-${debugTimestampSlug()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
}

function maybeDownloadPyramidError(msg) {
  if (!debugDownloadsEnabled || !msg || msg[0] !== "{") return;
  try {
    const obj = JSON.parse(msg);
    if (!(obj && obj.ok === false)) return;
    downloadBrowserFile(
      `${selectedPyrId}-error-${debugTimestampSlug()}.json`,
      JSON.stringify({
        reflector_id: selectedPyrId,
        received_at: new Date().toISOString(),
        error: obj,
        last_code: getEditorValue()
      }, null, 2),
      "application/json;charset=utf-8"
    );
  } catch (_) {}
}

function applyRemoteConsoleMessage(msg) {
  if (!msg) return;
  try {
    const obj = JSON.parse(msg);
    if (!obj || obj.dashboard_id === dashboardInstanceId) return;
    if (typeof obj.line !== "string" || !obj.line) return;
    appendConsoleLine("[remote] " + obj.line, false);
  } catch (_) {}
}

function maybeRotateConsole(lines) {
  if (lines.length <= CONSOLE_MAX_LINES) return lines;
  const dumped = lines.join("\n");
  downloadBrowserFile(
    `${selectedPyrId}-console-${debugTimestampSlug()}.txt`,
    dumped,
    "text/plain;charset=utf-8"
  );
  return [];
}

function applyReflectionMessage(msg) {
  if (!msg) return;
  try {
    const obj = JSON.parse(msg);
    if (typeof obj.description === "string") {
      lastDescription = obj.description;
      descriptionDiv.html(lastDescription);
      if (previewController) previewController.setReflectionText(lastDescription);
      updateReflectionTypography();
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

function applyDashboardSyncMessage(msg) {
  if (!msg) return;
  try {
    const obj = JSON.parse(msg);
    if (!obj || obj.dashboard_id === dashboardInstanceId) return;
    if (obj.event === "code_update" && typeof obj.code === "string") {
      if (getEditorValue() !== obj.code) {
        setEditorValue(obj.code);
        refreshPreview();
      }
      if (typeof obj.description === "string" && obj.description) {
        lastDescription = obj.description;
        descriptionDiv.html(lastDescription);
        if (previewController) previewController.setReflectionText(lastDescription);
        updateReflectionTypography();
      }
      logLine("Synced code from another dashboard.");
      return;
    }
    if (obj.event === "remote_stop_auto") {
      applyRemoteStopState("another dashboard");
      return;
    }
    if (obj.event === "remote_start_auto") {
      applyRemoteStartState("another dashboard");
    }
  } catch (_) {}
}

function applyRemoteStopState(sourceLabel) {
  automationWasRunningBeforeRemoteStop = automationEnabled || automationWasRunningBeforeRemoteStop;
  automationEnabled = false;
  remoteAutomationStopped = true;
  clearAutomationTimer();
  logLine("Automation stopped by " + sourceLabel + ".");
  syncSidebarControls();
}

function applyRemoteStartState(sourceLabel) {
  const shouldResume = remoteAutomationStopped && automationWasRunningBeforeRemoteStop;
  remoteAutomationStopped = false;
  automationWasRunningBeforeRemoteStop = false;
  logLine("Remote automation start from " + sourceLabel + ".");
  if (shouldResume) {
    automationEnabled = true;
    if (generationInProgress) scheduleNextAutomationRun();
    else if (isConnected) generateWrenchAndRun();
  }
  syncSidebarControls();
}

function toggleRemoteAutomationEverywhere() {
  if (remoteAutomationStopped) {
    applyRemoteStartState("this dashboard");
    publishDashboardSync("remote_start_auto");
    return;
  }
  applyRemoteStopState("this dashboard");
  publishDashboardSync("remote_stop_auto");
}

function logSummarizedEvtMessage(topic, msg) {
  if (!msg || msg[0] !== "{") return false;
  try {
    const obj = JSON.parse(msg);
    if (obj && obj.ok === true && typeof obj.code === "string") {
      logLine(`${topic}: code received (${obj.code.length} chars)`);
      return true;
    }
  } catch (_) {}
  return false;
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
  publishDashboardSync("code_update", { code });
}

function cmdSetCode() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "set_code", code });
  publishCodeState(code, "set_code");
  publishDashboardSync("code_update", { code });
}

function cmdRunAndStore() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "run_and_store", code });
  publishCodeState(code, "run_and_store");
  publishDashboardSync("code_update", { code });
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
  syncSidebarControls();
  logLine("Fetching design doc (md)...");

  try {
    const md = await fetchDocMarkdown();
    maybeDownloadParsedPrompt(md);
    logLine("Doc fetched: " + md.length + " chars");
    logLine("GPT model: " + selectedGptModel);
    logLine("Calling OpenAI...");
    const out = await openaiGenerateWrenchFromDoc(md);
    if (!out || !out.wrench_code) throw new Error("No wrench_code returned.");

    if (out.description) {
      lastDescription = out.description;
      descriptionDiv.html(lastDescription);
      if (previewController) previewController.setReflectionText(lastDescription);
      updateReflectionTypography();
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
    publishDashboardSync("code_update", { code: out.wrench_code, description: out.description || "" });
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
    syncSidebarControls();
  }
}

async function fetchDocMarkdown() {
  const res = await fetch(DOC_MD_URL, { method: "GET" });
  if (!res.ok) throw new Error("Doc fetch failed: HTTP " + res.status);
  let md = await res.text();
  md = await injectNewsIntoMarkdown(md);
  md = injectLastPromptIntoMarkdown(md);
  md = injectReflectorIdIntoMarkdown(md);
  const MAX_CHARS = 24000;
  return md.length > MAX_CHARS ? md.slice(0, MAX_CHARS) : md;
}

function injectLastPromptIntoMarkdown(md) {
  if (!md) return md;
  const placeholderRegex = /\\?\[last\\?_prompt\\?\]/i;
  return md.replace(placeholderRegex, lastPromptText || "");
}

function injectReflectorIdIntoMarkdown(md) {
  if (!md) return md;
  const placeholderRegex = /\\?\[reflectorid\\?\]/gi;
  return md.replace(placeholderRegex, selectedPyrId || "reflector1");
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
    model: selectedGptModel,
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
  maybeDownloadStructuredResponse("structured-response", data);
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
  syncSidebarControls();
  logLine("Auto-fix triggered...");
  try {
    const fixed = await openaiFixWrenchFromError(getEditorValue(), errText);
    if (!fixed || !fixed.wrench_code) throw new Error("No wrench_code returned from fixer.");
    setEditorValue(fixed.wrench_code);
    refreshPreview();
    if (fixed.description) logLine(fixed.description);
    publishJsonLine({ cmd: "run_now", code: fixed.wrench_code });
    publishCodeState(fixed.wrench_code, "auto_fix");
    publishDashboardSync("code_update", { code: fixed.wrench_code, description: fixed.description || "" });
    logLine("Sent run_now with fixed code.");
  } catch (e) {
    logLine("Auto-fix failed: " + (e && e.message ? e.message : e));
  } finally {
    autoFixInProgress = false;
    syncSidebarControls();
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
    model: selectedGptModel,
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
  maybeDownloadStructuredResponse("structured-fix", data);
  const argsStr = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("No tool call arguments returned from fix_wrench.");
  return JSON.parse(argsStr);
}

function appendConsoleLine(s, shouldBroadcast = true) {
  const consumedByMetrics = maybeUpdateMetricsFromConsoleLine(s);
  if (consumedByMetrics) return;

  const prev = consoleDiv.html();
  let lines = prev ? prev.split("\n") : [];
  lines.push(String(s));
  lines = maybeRotateConsole(lines);
  consoleDiv.html(lines.join("\n"));
  consoleDiv.elt.scrollTop = consoleDiv.elt.scrollHeight;
  if (shouldBroadcast) publishConsoleLine(s);
}

function logLine(s) {
  appendConsoleLine(s, true);
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
  consoleSectionEl.addClass("console-section");
  reflectionSectionEl.addClass("reflection-section");
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
  aceEditor.setTheme("ace/theme/chaos");
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
  previewController.setReflectionText(lastDescription || descriptionDiv?.elt?.textContent || "");
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

  setReflectionText(text) {
    this.preview3d.setState({ reflectionText: text || "" });
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
    this.reflectionText = "";
    this.appliedCameraMode = null;
    this.orbitStates = { preview: null, debug: null };
    this.isDragging = false;
    this.dragButton = "left";
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.pointerId = null;
    this.webglLayer = document.createElement("div");
    this.webglLayer.className = "preview-webgl";
    this.overlayLayer = document.createElement("div");
    this.overlayLayer.className = "preview-overlay";
    this.overlayGraphics = null;
    this.hostDiv.elt.appendChild(this.webglLayer);
    this.hostDiv.elt.appendChild(this.overlayLayer);
    this.instance = new p5((p) => this.mountSketch(p), this.webglLayer);
    this.textInstance = new p5((p) => this.mountOverlaySketch(p), this.overlayLayer);
  }

  mountSketch(p) {
    this.p = p;
    p.setup = () => {
      const { width, height } = this.getSize();
      const c = p.createCanvas(width, height, p.WEBGL);
      c.parent(this.webglLayer);
      p.setAttributes("antialias", true);
      const elt = c.elt;
      elt.style.touchAction = "none";
      elt.addEventListener("contextmenu", (e) => e.preventDefault());
      elt.addEventListener("pointerdown", (e) => {
        this.isDragging = true;
        this.pointerId = e.pointerId;
        this.dragButton = e.button === 2 ? "right" : "left";
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        elt.setPointerCapture?.(e.pointerId);
      });
      elt.addEventListener("pointermove", (e) => {
        if (!this.isDragging || this.pointerId !== e.pointerId) return;
        this.updateOrbitFromPointerDelta(e.clientX - this.lastMouseX, e.clientY - this.lastMouseY);
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      });
      elt.addEventListener("dblclick", (e) => {
        e.preventDefault();
        this.resetOrbitState(displayMode);
      });
      const releasePointer = (e) => {
        if (this.pointerId !== null && e.pointerId !== undefined && this.pointerId !== e.pointerId) return;
        this.isDragging = false;
        this.pointerId = null;
        this.saveOrbitState();
      };
      elt.addEventListener("pointerup", releasePointer);
      elt.addEventListener("pointercancel", releasePointer);
      elt.addEventListener("wheel", (e) => {
        e.preventDefault();
        const state = this.getOrbitState(displayMode);
        state.distance = constrain(state.distance * (1 + e.deltaY * 0.001), 120, 900);
        this.saveOrbitState();
      }, { passive: false });
      this.restoreOrbitState(p, displayMode);
    };

    p.draw = () => {
      if (this.appliedCameraMode !== displayMode) {
        this.restoreOrbitState(p, displayMode);
      }
      this.applyOrbitCamera(p);
      p.background("#000000");
      this.drawHorizonBackground(p);
      p.noStroke();

      p.push();
      p.scale(displayMode === "preview" ? 1.9 : 1.15);
      p.scale(1, -1, 1);
      p.rotateX(-0.25);
      this.drawGroundPlane(p);
      this.drawPyramid(p);
      p.pop();

      if (this.error) {
        this.drawErrorOverlay(p, this.error);
      }
    };

    p.windowResized = () => this.resize();
  }

  orbitStorageKey(mode) {
    return `dashboard2_orbit_${mode}_${ORBIT_STORAGE_VERSION}`;
  }

  defaultOrbitState(mode) {
    return mode === "preview"
      ? { yaw: 0.72, pitch: 0.68, distance: 680, targetX: 58, targetY: 8, targetZ: 0 }
      : { yaw: 0.62, pitch: 0.58, distance: 500, targetX: 26, targetY: 6, targetZ: 0 };
  }

  cloneOrbitState(state) {
    return {
      yaw: Number(state?.yaw) || 0,
      pitch: Number(state?.pitch) || 0,
      distance: Number(state?.distance) || 250,
      targetX: Number(state?.targetX) || 0,
      targetY: Number(state?.targetY) || 0,
      targetZ: Number(state?.targetZ) || 0
    };
  }

  getOrbitState(mode) {
    const key = mode === "debug" ? "debug" : "preview";
    if (!this.orbitStates[key]) {
      this.orbitStates[key] = this.defaultOrbitState(key);
    }
    return this.orbitStates[key];
  }

  applyOrbitCamera(p) {
    const state = this.getOrbitState(this.appliedCameraMode || displayMode);
    const cp = Math.cos(state.pitch);
    const sp = Math.sin(state.pitch);
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const eyeX = state.targetX + state.distance * cp * sy;
    const eyeY = state.targetY - state.distance * sp;
    const eyeZ = state.targetZ + state.distance * cp * cy;
    p.camera(
      eyeX, eyeY, eyeZ,
      state.targetX, state.targetY, state.targetZ,
      0, 1, 0
    );
  }

  restoreOrbitState(p, mode) {
    const key = mode === "debug" ? "debug" : "preview";
    let restored = false;
    try {
      const raw = window.localStorage.getItem(this.orbitStorageKey(key));
      if (raw) {
        const state = JSON.parse(raw);
        if (state && typeof state.yaw === "number") {
          this.orbitStates[key] = this.cloneOrbitState(state);
          restored = true;
        }
      }
    } catch (_) {}
    if (!restored) {
      this.orbitStates[key] = this.defaultOrbitState(key);
    }
    this.appliedCameraMode = key;
    this.applyOrbitCamera(p);
  }

  saveOrbitState() {
    const mode = this.appliedCameraMode || displayMode;
    const state = this.getOrbitState(mode);
    try {
      window.localStorage.setItem(this.orbitStorageKey(mode), JSON.stringify(state));
    } catch (_) {}
  }

  resetOrbitState(mode) {
    const key = mode === "debug" ? "debug" : "preview";
    this.orbitStates[key] = this.defaultOrbitState(key);
    this.appliedCameraMode = key;
    this.saveOrbitState();
  }

  updateOrbitFromPointerDelta(dx, dy) {
    if (!this.isDragging) return;
    const state = this.getOrbitState(this.appliedCameraMode || displayMode);
    if (this.dragButton === "right") {
      const panScale = state.distance * 0.0018;
      state.targetX -= dx * panScale;
      state.targetY += dy * panScale;
    } else {
      state.yaw += dx * 0.01;
      state.pitch = constrain(state.pitch + dy * 0.01, -0.18, 1.57);
    }
    this.saveOrbitState();
  }

  applyCameraState() {
    return;
  }

  saveCameraState() {
    return;
  }

  drawHorizonBackground(p) {
    p.push();
    if (p.drawingContext?.disable && p.drawingContext?.DEPTH_TEST !== undefined) {
      p.drawingContext.disable(p.drawingContext.DEPTH_TEST);
    }
    p.camera();
    p.resetMatrix();
    p.translate(-p.width / 2, -p.height / 2);
    p.noFill();
    for (let y = 0; y < p.height; y += 2) {
      const t = y / Math.max(1, p.height - 1);
      const shade = Math.round(lerp(0, 64, Math.pow(t, 1.35)));
      p.stroke(shade, shade, shade);
      p.line(0, y, p.width, y);
    }
    p.noStroke();
    p.fill(42, 42, 42, 90);
    p.rect(0, p.height * 0.62, p.width, p.height * 0.38);
    if (p.drawingContext?.enable && p.drawingContext?.DEPTH_TEST !== undefined) {
      p.drawingContext.enable(p.drawingContext.DEPTH_TEST);
    }
    p.pop();
  }

  mountOverlaySketch(p) {
    this.tp = p;
    p.setup = () => {
      const { width, height } = this.getSize();
      const c = p.createCanvas(width, height);
      c.parent(this.overlayLayer);
      this.overlayGraphics = p.createGraphics(width, height);
    };

    p.draw = () => {
      p.clear();
      if (!this.overlayGraphics) return;

      const g = this.overlayGraphics;
      g.clear();
      if (displayMode !== "preview" || !this.reflectionText) return;

      const narrow = this.isNarrowScreen();
      const boxX = g.width * 0.06;
      const boxY = g.height * (narrow ? 0.08 : 0.1);
      const boxW = g.width * (narrow ? 0.88 : 0.34);
      const boxH = g.height * (narrow ? 0.84 : 0.8);
      const fittedSize = fitPreviewGraphicsTextSize(g, this.reflectionText, boxW, boxH);

      g.push();
      g.clear();
      g.noStroke();
      g.fill(255, 245, 232, 230);
      g.textFont("Georgia");
      g.textAlign(g.LEFT, g.TOP);
      g.textSize(fittedSize);
      g.textLeading(fittedSize * 1.08);
      g.text(this.reflectionText, boxX, boxY, boxW, boxH);
      g.pop();

      p.push();
      p.image(g, 0, 0, p.width, p.height);
      p.pop();
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

  isNarrowScreen() {
    return typeof window !== "undefined" && window.innerWidth <= 900;
  }

  resize() {
    if (!this.p) return;
    const { width, height } = this.getSize();
    this.p.resizeCanvas(width, height);
    if (this.tp) this.tp.resizeCanvas(width, height);
    if (this.overlayGraphics) this.overlayGraphics.resizeCanvas(width, height);
  }

  setState({ segmentColors, error, reflectionText }) {
    if (segmentColors) this.segmentColors = segmentColors;
    if (typeof reflectionText === "string") this.reflectionText = reflectionText;
    this.error = error || "";
  }

  drawPyramid(p) {
    const narrow = this.isNarrowScreen();
    const tubes = [
      { from: [ -95,  40, -55 ], to: [  95,  40, -55 ], colors: this.segmentColors[0] || [] },
      { from: [ -95,  40, -55 ], to: [   0, 110,  55 ], colors: this.segmentColors[3] || [] },
      { from: [  95,  40, -55 ], to: [   0, 110,  55 ], colors: this.segmentColors[4] || [] },
      { from: [  95,  40, -55 ], to: [   0, -70,  85 ], colors: this.segmentColors[1] || [] },
      { from: [   0, -70,  85 ], to: [ -95,  40, -55 ], colors: this.segmentColors[2] || [] },
      { from: [   0, -70,  85 ], to: [   0, 110,  55 ], colors: this.segmentColors[5] || [] }
    ];

    p.push();
    p.translate(displayMode === "preview" ? (narrow ? 0 : 125) : 48, 0, 0);
    for (const tube of tubes) {
      this.drawSegmentedCylinder(p, tube.from, tube.to, tube.colors);
    }
    p.pop();
  }

  drawGroundPlane(p) {
    const a = [-95, 40, -55];
    const b = [95, 40, -55];
    const c = [0, -70, 85];
    const center = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3
    ];
    const u = normalizeVec3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const proj = dotVec3(ac, u);
    const vRaw = [
      ac[0] - u[0] * proj,
      ac[1] - u[1] * proj,
      ac[2] - u[2] * proj
    ];
    const v = normalizeVec3(vRaw);
    const n = normalizeVec3(crossVec3(u, v));
    const offset = 19.5;
    const shiftedCenter = [
      center[0] + n[0] * offset,
      center[1] + n[1] * offset,
      center[2] + n[2] * offset
    ];
    const radius = 1100;
    const steps = 72;

    p.push();
    p.noStroke();
    p.fill(30, 30, 30);
    p.beginShape();
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      const pt = addScaledPlaneCorner(
        shiftedCenter,
        u,
        v,
        Math.cos(ang) * radius,
        Math.sin(ang) * radius
      );
      p.vertex(pt[0], pt[1], pt[2]);
    }
    p.endShape(p.CLOSE);
    p.pop();
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
    p.camera();
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

function dotVec3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeVec3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function crossVec3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function addScaledPlaneCorner(center, u, v, su, sv) {
  return [
    center[0] + u[0] * su + v[0] * sv,
    center[1] + u[1] * su + v[1] * sv,
    center[2] + u[2] * su + v[2] * sv
  ];
}

function hexToRgb(hex) {
  const raw = String(hex || "#000000").replace("#", "").padStart(6, "0");
  const value = parseInt(raw.slice(0, 6), 16);
  const rgb = {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
  if (rgb.r <= 2 && rgb.g <= 2 && rgb.b <= 2) {
    return { r: 16, g: 16, b: 16 };
  }
  const minChannel = 10;
  if (rgb.r <= minChannel && rgb.g <= minChannel && rgb.b <= minChannel) {
    return {
      r: Math.round(rgb.r * 0.35 + 14),
      g: Math.round(rgb.g * 0.35 + 14),
      b: Math.round(rgb.b * 0.35 + 14)
    };
  }
  return rgb;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
