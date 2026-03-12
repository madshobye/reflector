window.showOverlay = false;

const AUTOMATION_INTERVAL_OPTIONS_MINUTES = [0, 5, 15, 30, 60, 120, 240, 360, 600];
const AUTOMATION_INTERVAL_KEY = "dashboard2_automation_interval_minutes";
const GPT_MODEL_KEY = "dashboard2_gpt_model";
const GPT_TEMPERATURE_KEY = "dashboard2_gpt_temperature";
const GPT_TEMPERATURE_OPTIONS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
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
const DASHBOARD2_VERSION = "v63";
const TOTAL_NEWS_ITEMS = 20;
const RSS_CACHE_TTL_MS = 20 * 60 * 1000;
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
let lastPromptHistory = [];
let lastDescription = "";
let lastDesignRationale = "";
let lastLocation = "";
let lastCompileErrText = "";
let lastCompileErrMs = 0;
let lastCodeUpdateAt = 0;
let selectedGptModel = DEFAULT_GPT_MODEL;
let selectedGptTemperature = 0.6;
let selectedPyrId = "reflector1";
let isAuthenticated = false;
const dashboardInstanceId = "dashboard2-" + Math.floor(Math.random() * 1e9) + "-" + Date.now();

let OPENAI_API_KEY = "";
let mqttKey = "";
let apiKeyEncryptedGpt ="U2FsdGVkX18009lW4clpttBLCMAsuBYgQZRiEWcsqhqoPwnEL0ka5JbJOwVlkKco88ToU9L42cPy5j++dtaCm1KgO8vV/dMe6bpMDrWs0IXjElBPml1tj8jUIj+oeLXzZuMTtYgGQfyPW+PxU+VtINE4kAvccUD2vXYgym3SYYUm0rD2RNguEmSzU+660DXYPix5qEnRFAHRUSnDdISYulwc8WNBF3gUQl1VEpUg7Ku9G2gCG6dTZ/JoJ6ZELr8W"
let mqttKeyEncrypted = "U2FsdGVkX1+f60bzOgPSBUTFJpFtLdWNgjs5QTNiW9BsDukPIRX8VtphcNDQ/bqS";

let client = null;
let isConnected = false;
let mqttDisconnectRequested = false;
let pendingGetCode = false;
let lastRequestId = 0;

let editorEl;
let aceEditor = null;
let consoleDiv;
let descriptionDiv;
let reflectionToggleWrap = null;
let reflectionTextToggleButton = null;
let reflectionRationaleToggleButton = null;
let metricsDiv;
let deviceStatusDiv;
let monitorDiv;
let monitorCircleDiv;
let monitorCountdownDiv;
let monitorStatsDiv;
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
let monitorSectionEl;
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
let sidebarIntervalDiv = null;
let sidebarModelSelect = null;
let sidebarTempSelect = null;
let sidebarAutomationSelect = null;
let sidebarActionSelect = null;
let sidebarActionSignature = "";
let sidebarPyrSelect = null;
let sidebarAuthButton = null;
let sidebarVersionDiv = null;
let sidebarShiftrLink = null;
let sidebarReflectionLink = null;
let sidebarPromptLink = null;
let sidebarButtons = {};
let sidebarSyncTimer = null;
let reflectionPanelMode = "reflection";
let automationNextRunAt = 0;
let previewIndicatorCompact = loadPreviewIndicatorCompact();
let pyramidMonitor = createInitialPyramidMonitor();

async function setup() {
  noCanvas();
  displayMode = loadDisplayMode();
  automationIntervalMinutes = loadAutomationIntervalMinutes();
  selectedGptModel = loadSelectedGptModel();
  selectedGptTemperature = loadSelectedGptTemperature();
  selectedPyrId = loadSelectedPyrId();
  syncReflectorUrl();
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
  updatePyramidMonitorUi();
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

  reflectionToggleWrap = createDiv("");
  reflectionToggleWrap.parent(reflectionSectionEl);
  reflectionToggleWrap.class("reflection-toggle-wrap");

  reflectionTextToggleButton = createButton("Reflection");
  reflectionTextToggleButton.parent(reflectionToggleWrap);
  reflectionTextToggleButton.class("reflection-toggle is-active");
  reflectionTextToggleButton.mousePressed(() => setReflectionPanelMode("reflection"));

  reflectionRationaleToggleButton = createButton("Rationale");
  reflectionRationaleToggleButton.parent(reflectionToggleWrap);
  reflectionRationaleToggleButton.class("reflection-toggle");
  reflectionRationaleToggleButton.mousePressed(() => setReflectionPanelMode("rationale"));

  descriptionDiv = createDiv("");
  descriptionDiv.parent(reflectionSectionEl);
  descriptionDiv.class("panel-box");
  styleLogPanel(descriptionDiv, "#000000");
  descriptionDiv.style("font-size", "21px");
  descriptionDiv.style("line-height", "1.7");
  descriptionDiv.style("font-family", "\"IBM Plex Sans\", sans-serif");
  descriptionDiv.style("font-weight", "400");

  monitorDiv = createDiv("");
  monitorDiv.parent(monitorSectionEl);
  monitorDiv.class("panel-box monitor-box");

  monitorCircleDiv = createDiv("");
  monitorCircleDiv.parent(monitorDiv);
  monitorCircleDiv.class("monitor-circle");

  monitorCountdownDiv = createDiv("");
  monitorCountdownDiv.parent(monitorDiv);
  monitorCountdownDiv.class("monitor-countdown");

  monitorStatsDiv = createDiv("");
  monitorStatsDiv.parent(monitorDiv);
  monitorStatsDiv.class("monitor-stats");

  metricsDiv = createDiv("");
  metricsDiv.parent(metricsSectionEl);
  metricsDiv.class("panel-box");
  metricsDiv.style("overflow", "auto");

  deviceStatusDiv = createDiv("Awaiting");
  const metricsTitle = metricsSectionEl.elt.querySelector(".panel-title");
  if (metricsTitle) deviceStatusDiv.parent(metricsTitle);
  else deviceStatusDiv.parent(metricsSectionEl);
  deviceStatusDiv.class("device-status is-warning");

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

  sidebarVersionDiv = createDiv("Version " + DASHBOARD2_VERSION);
  sidebarVersionDiv.parent(wrap);
  sidebarVersionDiv.class("sidebar-version");

  const buttonSpecs = [
    ["connectToggle", "Connect", () => {
      if (client) disconnectMQTT();
      else connectMQTT();
    }],
    ["runNow", "Run Now", () => cmdRunNow()],
    ["generate", "Generate Wrench", () => generateWrenchAndRun()],
    ["debugDownloads", "Debug: OFF", () => toggleDebugDownloads()],
    ["autoFix", "Auto-fix: OFF", () => {
      autoFixEnabled = !autoFixEnabled;
      logLine("Auto-fix is now " + (autoFixEnabled ? "ON" : "OFF"));
      syncSidebarControls();
    }],
    ["automation", "Automation: OFF", () => toggleAutomation()]
  ];

  for (const [key, label, handler] of buttonSpecs) {
    const btn = createButton(label);
    btn.parent(wrap);
    btn.class("sidebar-button");
    btn.addClass("tone-low");
    btn.mousePressed(handler);
    sidebarButtons[key] = btn;
  }

  sidebarAuthButton = createButton(isAuthenticated ? "Log Out" : "Log In");
  sidebarAuthButton.parent(wrap);
  sidebarAuthButton.class("sidebar-button");
  sidebarAuthButton.addClass("tone-low");
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
  sidebarPyrSelect.addClass("tone-low");
  sidebarPyrSelect.changed(() => {
    const nextId = sidebarPyrSelect.value();
    if (nextId === selectedPyrId) return;
    const prevId = selectedPyrId;
    selectedPyrId = nextId;
    persistSelectedPyrId();
    syncReflectorUrl();
    syncSectionTitles();
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
  sidebarModelSelect.addClass("tone-low");
  sidebarModelSelect.changed(() => {
    selectedGptModel = sidebarModelSelect.value();
    persistSelectedGptModel();
    logLine("GPT model: " + selectedGptModel);
    syncSidebarControls();
  });

  sidebarTempSelect = createSelect();
  sidebarTempSelect.parent(wrap);
  sidebarTempSelect.class("sidebar-select");
  for (const temp of GPT_TEMPERATURE_OPTIONS) {
    sidebarTempSelect.option("Temp: " + temp.toFixed(1), String(temp));
  }
  sidebarTempSelect.selected(String(selectedGptTemperature));
  sidebarTempSelect.addClass("tone-low");
  sidebarTempSelect.changed(() => {
    selectedGptTemperature = Number(sidebarTempSelect.value());
    persistSelectedGptTemperature();
    logLine("GPT temperature: " + selectedGptTemperature.toFixed(1));
    syncSidebarControls();
  });

  sidebarAutomationSelect = createSelect();
  sidebarAutomationSelect.parent(wrap);
  sidebarAutomationSelect.class("sidebar-select");
  for (const mins of AUTOMATION_INTERVAL_OPTIONS_MINUTES) {
    const label = mins >= 60
      ? "Refresh: " + ((mins / 60) % 1 === 0 ? (mins / 60) : (mins / 60).toFixed(1)) + "h"
      : "Refresh: " + mins + "m";
    sidebarAutomationSelect.option(label, String(mins));
  }
  sidebarAutomationSelect.selected(String(automationIntervalMinutes));
  sidebarAutomationSelect.addClass("tone-low");
  sidebarAutomationSelect.changed(() => {
    automationIntervalMinutes = Number(sidebarAutomationSelect.value());
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
  });

  sidebarActionSelect = createSelect();
  sidebarActionSelect.parent(wrap);
  sidebarActionSelect.class("sidebar-select");
  rebuildActionsDropdown();
  sidebarActionSelect.addClass("tone-low");
  sidebarActionSelect.changed(() => {
    const action = sidebarActionSelect.value();
    sidebarActionSelect.selected("");
    if (!action) return;
    if (action === "getCode") cmdGetCode();
    if (action === "storeOnly") cmdSetCode();
    if (action === "runStore") cmdRunAndStore();
    if (action === "reboot") cmdReboot();
    if (action === "testRss") testRssFeeds();
    if (action === "remoteAutomation") toggleRemoteAutomationEverywhere();
    if (action === "insertExample") {
      setEditorValue(defaultWrenchExample());
      refreshPreview();
    }
    if (action === "clearConsole") {
      consoleDiv.html("");
    }
  });

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
  updateSidebarButton("connectToggle", {
    label: client ? "Disconnect" : "Connect",
    disabled: false,
    tone: client ? "mid" : "mid"
  });
  updateSidebarButton("runNow", { disabled: !isConnected || !isAuthenticated, tone: isConnected && isAuthenticated ? "mid" : "off" });
  updateSidebarButton("generate", { disabled: !isConnected || generationInProgress || !isAuthenticated, tone: isConnected && !generationInProgress && isAuthenticated ? "amber" : "off" });
  updateSidebarButton("debugDownloads", { label: debugDownloadsEnabled ? "Debug: ON" : "Debug: OFF", disabled: false, tone: debugDownloadsEnabled ? "high" : "low" });
  updateSidebarButton("autoFix", { label: autoFixEnabled ? "Auto-fix: ON" : "Auto-fix: OFF", disabled: !isAuthenticated, tone: autoFixEnabled && isAuthenticated ? "high" : "off" });
  updateSidebarButton("automation", {
    label: automationEnabled ? "Automation: ON" : "Automation: OFF",
    disabled: !isConnected || generationInProgress || !isAuthenticated || remoteAutomationStopped,
    tone: automationEnabled && isAuthenticated ? "high" : "off"
  });
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
  if (sidebarTempSelect) {
    sidebarTempSelect.value(String(selectedGptTemperature));
    sidebarTempSelect.removeClass("tone-high");
    sidebarTempSelect.removeClass("tone-mid");
    sidebarTempSelect.removeClass("tone-low");
    sidebarTempSelect.removeClass("tone-off");
    sidebarTempSelect.addClass(isAuthenticated ? "tone-low" : "tone-off");
    if (isAuthenticated) sidebarTempSelect.removeAttribute("disabled");
    else sidebarTempSelect.attribute("disabled", "");
    sidebarTempSelect.style("display", isAuthenticated ? "block" : "none");
  }
  if (sidebarAutomationSelect) {
    sidebarAutomationSelect.value(String(automationIntervalMinutes));
    sidebarAutomationSelect.removeClass("tone-high");
    sidebarAutomationSelect.removeClass("tone-mid");
    sidebarAutomationSelect.removeClass("tone-low");
    sidebarAutomationSelect.removeClass("tone-off");
    sidebarAutomationSelect.addClass(isAuthenticated ? (automationIntervalMinutes === 0 ? "tone-high" : "tone-low") : "tone-off");
    if (isAuthenticated) sidebarAutomationSelect.removeAttribute("disabled");
    else sidebarAutomationSelect.attribute("disabled", "");
    sidebarAutomationSelect.style("display", isAuthenticated ? "block" : "none");
  }
  if (sidebarActionSelect) {
    sidebarActionSelect.removeClass("tone-high");
    sidebarActionSelect.removeClass("tone-mid");
    sidebarActionSelect.removeClass("tone-low");
    sidebarActionSelect.removeClass("tone-off");
    sidebarActionSelect.addClass(generationInProgress ? "tone-off" : "tone-low");
    if (generationInProgress) sidebarActionSelect.attribute("disabled", "");
    else sidebarActionSelect.removeAttribute("disabled");
  }
  setPrivilegedControlsVisible(isAuthenticated);

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
    "runNow",
    "generate",
    "debugDownloads",
    "autoFix",
    "automation"
  ];
  for (const key of privilegedKeys) {
    const btn = sidebarButtons[key];
    if (!btn) continue;
    btn.style("display", visible ? "block" : "none");
  }
  if (sidebarTempSelect) sidebarTempSelect.style("display", visible ? "block" : "none");
  if (sidebarAutomationSelect) sidebarAutomationSelect.style("display", visible ? "block" : "none");
}

function rebuildActionsDropdown() {
  if (!sidebarActionSelect) return;
  const signature = remoteAutomationStopped ? "remote-start" : "remote-stop";
  if (signature === sidebarActionSignature) return;
  sidebarActionSignature = signature;
  sidebarActionSelect.elt.innerHTML = "";
  sidebarActionSelect.option("Actions", "");
  sidebarActionSelect.option("Get Code", "getCode");
  sidebarActionSelect.option("Store Only", "storeOnly");
  sidebarActionSelect.option("Run + Store", "runStore");
  sidebarActionSelect.option("Reboot", "reboot");
  sidebarActionSelect.option("Test RSS", "testRss");
  sidebarActionSelect.option(remoteAutomationStopped ? "Remote Start" : "Remote Stop", "remoteAutomation");
  sidebarActionSelect.option("Insert Example", "insertExample");
  sidebarActionSelect.option("Clear Console", "clearConsole");
  sidebarActionSelect.selected("");
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

function gptTemperatureLabel() {
  return "Temp: " + selectedGptTemperature.toFixed(1);
}

function loadSelectedGptTemperature() {
  try {
    const saved = Number(window.localStorage.getItem(GPT_TEMPERATURE_KEY));
    if (GPT_TEMPERATURE_OPTIONS.includes(saved)) return saved;
  } catch (_) {}
  return 0.6;
}

function persistSelectedGptTemperature() {
  try {
    window.localStorage.setItem(GPT_TEMPERATURE_KEY, String(selectedGptTemperature));
  } catch (_) {}
}

function cycleGptTemperature() {
  const idx = GPT_TEMPERATURE_OPTIONS.indexOf(selectedGptTemperature);
  const nextIdx = idx >= 0 ? (idx + 1) % GPT_TEMPERATURE_OPTIONS.length : 0;
  selectedGptTemperature = GPT_TEMPERATURE_OPTIONS[nextIdx];
  persistSelectedGptTemperature();
  logLine("GPT temperature: " + selectedGptTemperature.toFixed(1));
  syncSidebarControls();
}

function loadSelectedPyrId() {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("id");
    if (fromUrl && PYR_ID_OPTIONS.includes(fromUrl)) return fromUrl;
  } catch (_) {}
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

function syncReflectorUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("id", selectedPyrId || "reflector1");
    window.history.replaceState({}, "", url.toString());
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

function bootstrapEncryptedSecret(secretName) {
  const rawKey = window.prompt("Please enter key:", "");
  if (!rawKey) return null;
  const password = window.prompt("Please enter password for " + secretName + ":", "");
  if (!password) return null;
  const encryptedKey = encryptKey(rawKey, password);
  const encryptedText = String(encryptedKey || "");
  const snippet = 'let ' + secretName + ' ="' + encryptedText + '"';
  console.log("##### INSERT THE CODE BELOW IN YOUR SKETCH ###");
  console.log(snippet);
  logLine("Generated encrypted key for " + secretName + ". Check the browser console for the code snippet.");
  return {
    encryptedText,
    password,
    rawKey
  };
}

function loginAuthenticatedMode() {
  let mqttPassword = "";
  let gptPassword = "";
  let nextMqttKey = "";
  let nextOpenAiKey = "";

  if (!mqttKeyEncrypted) {
    const boot = bootstrapEncryptedSecret("mqttKeyEncrypted");
    if (!boot) return;
    mqttKeyEncrypted = boot.encryptedText;
    mqttPassword = boot.password;
    nextMqttKey = boot.rawKey;
  } else {
    mqttPassword = window.prompt("Please enter MQTT password (mqttKeyEncrypted):", "");
    if (!mqttPassword) return;
    nextMqttKey = decryptKey(mqttKeyEncrypted, mqttPassword);
  }

  if (!apiKeyEncryptedGpt) {
    const boot = bootstrapEncryptedSecret("apiKeyEncryptedGpt");
    if (!boot) return;
    apiKeyEncryptedGpt = boot.encryptedText;
    gptPassword = boot.password;
    nextOpenAiKey = boot.rawKey;
  } else {
    gptPassword = window.prompt("Please enter ChatGPT password (apiKeyEncryptedGpt):", "");
    if (!gptPassword) return;
    nextOpenAiKey = decryptKey(apiKeyEncryptedGpt, gptPassword);
  }

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
  if (!client) return;
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
  lastPromptHistory = [];
  lastDescription = "";
  lastDesignRationale = "";
  lastLocation = "";
  lastCodeUpdateAt = 0;
  resetPyramidMonitorForReflector();
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

function rememberPromptReflection(text) {
  const next = String(text || "").trim();
  if (!next) return;
  if (lastPromptHistory[0] === next) return;
  lastPromptHistory = [next, ...lastPromptHistory.filter((item) => item !== next)].slice(0, 20);
}

function lastPromptHistoryText() {
  return lastPromptHistory
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n\n");
}

function reflectionWithLocation(reflectionText, locationText) {
  const reflection = String(reflectionText || "").trim();
  const location = String(locationText || "").trim();
  const prefixedLocation = location ? `${selectedPyrId}: ${location}` : "";
  if (!prefixedLocation) return reflection;
  if (!reflection) return prefixedLocation;
  return reflection + "\n\n" + prefixedLocation;
}

function currentReflectionPanelText() {
  if (reflectionPanelMode === "rationale") return lastDesignRationale || "";
  return reflectionWithLocation(lastDescription, lastLocation);
}

function setReflectionPanelText() {
  if (!descriptionDiv || !descriptionDiv.elt) return;
  descriptionDiv.elt.textContent = currentReflectionPanelText();
}

function setReflectionPanelMode(nextMode) {
  reflectionPanelMode = nextMode === "rationale" ? "rationale" : "reflection";
  if (reflectionTextToggleButton) {
    reflectionTextToggleButton.toggleClass("is-active", reflectionPanelMode === "reflection");
  }
  if (reflectionRationaleToggleButton) {
    reflectionRationaleToggleButton.toggleClass("is-active", reflectionPanelMode === "rationale");
  }
  setReflectionPanelText();
  updateReflectionTypography();
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
    previewController.setReflectionText(reflectionWithLocation(lastDescription, lastLocation));
  }
  updateReflectionTypography();
}

function createModeToggleButton() {
  modeToggleButton = createButton(displayMode === "preview" ? "Debug" : "Preview");
  modeToggleButton.parent(document.body);
  modeToggleButton.id("mode-toggle");
  modeToggleButton.mousePressed(toggleDisplayMode);
}

function createInitialPyramidMonitor() {
  return {
    lastFpsAt: 0,
    prevFpsAt: 0,
    avgFpsIntervalMs: 1000,
    latestFps: 0,
    hasEverBeenOnline: false,
    offlineSince: 0,
    stats: {
      wrenchErrors: 0,
      rssErrors: 0,
      otherErrors: 0,
      reboots: 0
    }
  };
}

function loadPreviewIndicatorCompact() {
  try {
    return window.localStorage.getItem("dashboard2_preview_indicator_compact") === "1";
  } catch (_) {
    return false;
  }
}

function persistPreviewIndicatorCompact() {
  try {
    window.localStorage.setItem("dashboard2_preview_indicator_compact", previewIndicatorCompact ? "1" : "0");
  } catch (_) {}
}

function togglePreviewIndicatorCompact() {
  previewIndicatorCompact = !previewIndicatorCompact;
  persistPreviewIndicatorCompact();
  updatePyramidMonitorUi();
}

function notePyramidFpsHeartbeat(fpsValue) {
  const now = millis();
  pyramidMonitor.latestFps = Number(fpsValue) || 0;
  if (pyramidMonitor.lastFpsAt > 0) {
    const dt = now - pyramidMonitor.lastFpsAt;
    if (dt > 150 && dt < 300000) {
      pyramidMonitor.avgFpsIntervalMs = pyramidMonitor.avgFpsIntervalMs * 0.7 + dt * 0.3;
    }
  }
  pyramidMonitor.prevFpsAt = pyramidMonitor.lastFpsAt;
  pyramidMonitor.lastFpsAt = now;
  pyramidMonitor.hasEverBeenOnline = true;
  pyramidMonitor.offlineSince = 0;
  updatePyramidMonitorUi();
}

function noteWrenchError() {
  pyramidMonitor.stats.wrenchErrors += 1;
  updatePyramidMonitorUi();
}

function noteRssError() {
  pyramidMonitor.stats.rssErrors += 1;
  updatePyramidMonitorUi();
}

function noteOtherError() {
  pyramidMonitor.stats.otherErrors += 1;
  updatePyramidMonitorUi();
}

function noteReboot() {
  pyramidMonitor.stats.reboots += 1;
  updatePyramidMonitorUi();
}

function resetPyramidMonitorForReflector() {
  pyramidMonitor = createInitialPyramidMonitor();
  updatePyramidMonitorUi();
}

function currentAutomationRemainingMs() {
  if (!automationEnabled || !automationNextRunAt) return 0;
  return Math.max(0, automationNextRunAt - Date.now());
}

function formatRefreshCountdown(ms) {
  if (!ms || ms <= 0) return "";
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  return `${totalHours}:${String(remMinutes).padStart(2, "0")}h`;
}

function currentAutomationProgress() {
  if (!automationEnabled || !automationNextRunAt) return 0;
  const totalMs = automationIntervalMinutes * 60 * 1000;
  if (totalMs <= 0) return 1;
  const remaining = currentAutomationRemainingMs();
  return Math.max(0, Math.min(1, 1 - remaining / totalMs));
}

function getPyramidMonitorState() {
  const now = millis();
  const avgIntervalMs = Math.max(5000, pyramidMonitor.avgFpsIntervalMs || 5000);
  const warnMs = avgIntervalMs * 10;
  const offlineMs = avgIntervalMs * 20;
  const ageMs = pyramidMonitor.lastFpsAt ? now - pyramidMonitor.lastFpsAt : Infinity;
  let state = "unknown";

  if (pyramidMonitor.latestFps > 100 && ageMs <= offlineMs) {
    state = "purple";
  } else if (ageMs <= warnMs) {
    state = "online";
  } else if (!pyramidMonitor.hasEverBeenOnline || ageMs <= offlineMs) {
    state = "warning";
  } else {
    state = "offline";
  }

  if (state === "offline" && pyramidMonitor.hasEverBeenOnline && !pyramidMonitor.offlineSince) {
    pyramidMonitor.offlineSince = now;
  }
  if (state !== "offline") {
    pyramidMonitor.offlineSince = 0;
  }

  const blinkOffline = state === "offline" &&
    pyramidMonitor.hasEverBeenOnline &&
    pyramidMonitor.offlineSince > 0 &&
    now - pyramidMonitor.offlineSince <= 10 * 60 * 1000;

  return {
    state,
    hasEverBeenOnline: pyramidMonitor.hasEverBeenOnline,
    latestFps: pyramidMonitor.latestFps,
    avgFpsIntervalMs: avgIntervalMs,
    warnMs,
    offlineMs,
    ageMs,
    blinkOffline,
    warningPulse: 0.5 + 0.5 * Math.sin(now * 0.004),
    blinkOn: Math.floor(now / 500) % 2 === 0,
    progress: currentAutomationProgress(),
    countdownLabel: formatRefreshCountdown(currentAutomationRemainingMs()),
    compact: previewIndicatorCompact,
    stats: { ...pyramidMonitor.stats }
  };
}

function updatePyramidMonitorUi() {
  const monitor = getPyramidMonitorState();
  renderDeviceStatus(monitor);
  renderDebugMonitorPanel(monitor);
  renderMetrics();
  if (previewController) {
    previewController.setMonitorState(monitor);
  }
}

function renderDeviceStatus(monitor = getPyramidMonitorState()) {
  if (!deviceStatusDiv) return;
  let label = monitor.hasEverBeenOnline ? "Warning" : "Awaiting";
  let cls = "is-warning";
  if (monitor.state === "online") {
    label = "Online";
    cls = "is-online";
  } else if (monitor.state === "purple") {
    label = "High FPS";
    cls = "is-purple";
  } else if (monitor.state === "offline") {
    label = "Offline";
    cls = "is-offline";
  }
  deviceStatusDiv.html(label);
  deviceStatusDiv.removeClass("is-online");
  deviceStatusDiv.removeClass("is-warning");
  deviceStatusDiv.removeClass("is-offline");
  deviceStatusDiv.removeClass("is-purple");
  deviceStatusDiv.removeClass("is-blink");
  deviceStatusDiv.addClass(cls);
  if ((monitor.state === "offline" && monitor.blinkOffline) || monitor.state === "purple") {
    deviceStatusDiv.addClass("is-blink");
  }
}

function renderDebugMonitorPanel(monitor = getPyramidMonitorState()) {
  if (!monitorDiv || displayMode === "preview") return;
  if (!monitorCircleDiv || !monitorCountdownDiv || !monitorStatsDiv) return;

  monitorCircleDiv.removeClass("is-online", "is-warning", "is-offline", "is-purple", "is-blink");
  monitorCircleDiv.addClass(`is-${monitor.state}`);
  if ((monitor.state === "offline" && monitor.blinkOffline) || monitor.state === "purple") {
    monitorCircleDiv.addClass("is-blink");
  }

  const stateLabel = monitor.state === "online"
    ? "Online"
    : monitor.state === "purple"
      ? "High FPS"
      : monitor.state === "offline"
        ? "Offline"
        : (monitor.hasEverBeenOnline ? "Warning" : "Awaiting");
  const nextRefresh = automationEnabled ? (monitor.countdownLabel || "--") : "--";
  const codeAge = formatElapsedSinceCodeUpdate();

  if (monitor.state === "online" && automationEnabled) {
    const pct = Math.max(0, Math.min(1, monitor.progress || 0));
    monitorCircleDiv.elt.style.background =
      `conic-gradient(rgba(245,238,224,0.9) ${pct * 360}deg, rgba(255,255,255,0.06) 0deg)`;
  } else {
    monitorCircleDiv.elt.style.background = "";
  }

  monitorCircleDiv.parent(monitorDiv);
  monitorCountdownDiv.html(
    `<div class="monitor-grid monitor-grid-top">
      <div class="monitor-card monitor-circle-card"></div>
      <div class="monitor-card">
        <div class="monitor-label">State</div>
        <div class="monitor-value">${stateLabel}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Next</div>
        <div class="monitor-value">${nextRefresh}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Code</div>
        <div class="monitor-value">${codeAge}</div>
      </div>
    </div>`
  );
  const circleSlot = monitorCountdownDiv.elt.querySelector(".monitor-circle-card");
  if (circleSlot) {
    monitorCircleDiv.parent(circleSlot);
  }
  monitorStatsDiv.html(
    `<div class="monitor-grid monitor-grid-stats">
      <div class="monitor-card">
        <div class="monitor-label">Wrench</div>
        <div class="monitor-value">${monitor.stats.wrenchErrors}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">RSS</div>
        <div class="monitor-value">${monitor.stats.rssErrors}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Other</div>
        <div class="monitor-value">${monitor.stats.otherErrors}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Reboots</div>
        <div class="monitor-value">${monitor.stats.reboots}</div>
      </div>
    </div>`
  );
}

function formatElapsedSinceCodeUpdate() {
  if (!lastCodeUpdateAt) return "--";
  const ms = Math.max(0, Date.now() - lastCodeUpdateAt);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function updateReflectionTypography() {
  if (!descriptionDiv || displayMode !== "preview") return;
  const style = window.getComputedStyle(descriptionDiv.elt);
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const boxW = Math.max(120, descriptionDiv.elt.clientWidth - padX);
  const boxH = Math.max(80, descriptionDiv.elt.clientHeight - padY);
  const textValue = currentReflectionPanelText() || descriptionDiv.elt.textContent || "";
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
  const parts = splitReflectionLocationText(content);
  const textValue = parts.main;
  let size = constrain(min(g.width, g.height) * 0.11, 42, 110);
  const minSize = 18;
  while (size > minSize) {
    const bounds = previewGraphicsCombinedBounds(g, textValue, parts.location, boxW, size);
    if (bounds.height <= boxH) return size;
    size -= 2;
  }
  return minSize;
}

function previewGraphicsCombinedBounds(g, mainText, locationText, boxW, fontSize) {
  g.textSize(fontSize);
  g.textLeading(fontSize * 1.08);
  const mainBounds = previewGraphicsFontBounds(g, mainText, boxW);
  if (!locationText) return mainBounds;
  const locationSize = Math.max(14, fontSize * 0.5);
  g.textSize(locationSize);
  g.textLeading(locationSize * 1.15);
  const locationBounds = previewGraphicsFontBounds(g, locationText, boxW);
  return {
    height: mainBounds.height + fontSize * 0.7 + locationBounds.height
  };
}

function splitReflectionLocationText(content) {
  const raw = String(content || "").trim();
  const match = raw.match(/^(.*?)(?:\n\s*\n)?([^\n]+)$/s);
  if (!match) return { main: raw, location: "" };
  return {
    main: (match[1] || "").trim(),
    location: (match[2] || "").trim()
  };
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
  mqttDisconnectRequested = false;
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
  const socket = client;

  socket.on("connect", () => {
    if (client !== socket || !socket) return;
    isConnected = true;
    statusText = isAuthenticated ? "MQTT connected" : "MQTT connected (read-only)";
    logLine(isAuthenticated ? "MQTT connected." : "MQTT connected in read-only mode.");
    syncSidebarControls();
    subscribeReflectorTopics(selectedPyrId);
    if (isAuthenticated) {
      requestSelectedReflectorCode();
    }
  });

  socket.on("reconnect", () => {
    if (client !== socket || !socket) return;
    statusText = "MQTT reconnecting";
    logLine("MQTT reconnecting...");
    syncSidebarControls();
  });

  socket.on("close", () => {
    if (client !== socket) return;
    isConnected = false;
    statusText = "MQTT closed";
    logLine("MQTT closed.");
    clearAutomationTimer();
    if (mqttDisconnectRequested) {
      client = null;
      mqttDisconnectRequested = false;
    }
    syncSidebarControls();
  });

  socket.on("error", (err) => {
    if (client !== socket && client !== null) return;
    statusText = "MQTT error";
    noteOtherError();
    logLine("MQTT error: " + err);
    syncSidebarControls();
  });

  socket.on("message", (topic, message) => {
    if (client !== socket) return;
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
      appendConsoleLine(topic + ": " + s, false);
    }
    maybeAutoFixFromEvt(s);
    tryAutoFillEditorFromGetCode(s);
  });
}

function disconnectMQTT() {
  if (!client) return;
  mqttDisconnectRequested = true;
  try {
    client.end(true);
  } catch (_) {}
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
  automationNextRunAt = 0;
  syncSidebarControls();
  updatePyramidMonitorUi();
}

function scheduleNextAutomationRun() {
  clearAutomationTimer();
  if (!automationEnabled) return;
  const automationIntervalMs = automationIntervalMinutes * 60 * 1000;
  automationNextRunAt = Date.now() + automationIntervalMs;
  updatePyramidMonitorUi();

  automationTimerId = setTimeout(() => {
    automationTimerId = null;
    automationNextRunAt = 0;
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
  logLine(formatOutgoingCommandForConsole(obj));
}

function formatOutgoingCommandForConsole(obj) {
  if (!obj || typeof obj !== "object") return ">>> " + String(obj ?? "");
  const cmd = typeof obj.cmd === "string" ? obj.cmd : "cmd";
  if (typeof obj.code === "string") {
    return `>>> ${cmd} (${obj.code.length} chars)`;
  }
  return ">>> " + JSON.stringify(obj);
}

function shouldBroadcastConsoleLine(line) {
  const s = String(line || "");
  if (!s) return false;
  if (s.startsWith("[remote] ")) return false;
  if (s.includes('"code":"')) return false;
  if (s.includes("/evt:")) return false;
  return true;
}

function publishReflectionUpdate(reflection, code, designRationale, location) {
  if (!client || !isConnected) return;
  const payload = JSON.stringify({
    reflection: reflection || "",
    design_rationale: designRationale || "",
    location: location || "",
    code: code || "",
    generated_at: new Date().toISOString(),
    dashboard_id: dashboardInstanceId
  });
  client.publish(mqttReflectionTopic(), payload, { retain: true });
  logLine("Published reflection update.");
}

function publishCodeState(code, source, meta = {}) {
  if (!client || !isConnected) return;
  lastCodeUpdateAt = Date.now();
  const payload = JSON.stringify({
    code: code || "",
    source: source || "dashboard2",
    reflection: meta.reflection || "",
    design_rationale: meta.design_rationale || "",
    location: meta.location || "",
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

function maybeDownloadRssFailure(feedUrl, stage, payload, err) {
  if (!debugDownloadsEnabled) return;
  const safeName = String(feedUrl || "feed")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .slice(0, 80);
  downloadBrowserFile(
    `${selectedPyrId}-rss-${stage}-${safeName}-${debugTimestampSlug()}.txt`,
    [
      "feed_url: " + (feedUrl || ""),
      "stage: " + (stage || "unknown"),
      "error: " + (err && err.message ? err.message : String(err || "")),
      "",
      String(payload || "")
    ].join("\n"),
    "text/plain;charset=utf-8"
  );
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
    const reflectionText =
      typeof obj.reflection === "string" ? obj.reflection :
      (typeof obj.description === "string" ? obj.description : "");
    if (typeof reflectionText === "string") {
      lastDescription = reflectionText;
      rememberPromptReflection(reflectionText);
      lastDesignRationale = typeof obj.design_rationale === "string" ? obj.design_rationale : "";
      lastLocation = typeof obj.location === "string" ? obj.location : "";
      setReflectionPanelText();
      if (previewController) previewController.setReflectionText(reflectionWithLocation(lastDescription, lastLocation));
      updateReflectionTypography();
    }
    if (typeof obj.code === "string" && !getEditorValue().trim()) {
      setEditorValue(obj.code);
      refreshPreview();
    }
    logLine("Loaded retained reflection.");
  } catch (err) {
    noteOtherError();
    logLine("Reflection parse error: " + (err && err.message ? err.message : err));
  }
}

function applyCodeStateMessage(msg) {
  if (!msg) return;
  try {
    const obj = JSON.parse(msg);
    if (typeof obj.code !== "string") return;
    const updatedAt = Date.parse(obj.updated_at || "");
    lastCodeUpdateAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    if (typeof obj.reflection === "string") {
      lastDescription = obj.reflection;
      rememberPromptReflection(obj.reflection);
    }
    if (typeof obj.design_rationale === "string") {
      lastDesignRationale = obj.design_rationale;
    }
    if (typeof obj.location === "string") {
      lastLocation = obj.location;
    }
    if (getEditorValue() !== obj.code) {
      setEditorValue(obj.code);
      refreshPreview();
    }
    setReflectionPanelText();
    if (previewController) previewController.setReflectionText(reflectionWithLocation(lastDescription, lastLocation));
    updateReflectionTypography();
    logLine("Loaded retained code state.");
  } catch (err) {
    noteOtherError();
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
      const reflectionText =
        typeof obj.reflection === "string" ? obj.reflection :
        (typeof obj.description === "string" ? obj.description : "");
      if (typeof reflectionText === "string" && reflectionText) {
        lastDescription = reflectionText;
        rememberPromptReflection(reflectionText);
        lastDesignRationale = typeof obj.design_rationale === "string" ? obj.design_rationale : lastDesignRationale;
        lastLocation = typeof obj.location === "string" ? obj.location : lastLocation;
        setReflectionPanelText();
        if (previewController) previewController.setReflectionText(reflectionWithLocation(lastDescription, lastLocation));
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
    if (consumeEvtObjectSilently(obj)) return true;
    const formatted = formatEvtObjectForConsole(topic, obj);
    if (!formatted) return false;
    appendConsoleLine(formatted, false);
    return true;
  } catch (_) {}
  return false;
}

function consumeEvtObjectSilently(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.event === "string" && obj.event in deviceMetrics) {
    const val = obj.fps ?? obj.bytes ?? obj.words;
    if (typeof val !== "undefined") {
      deviceMetrics[obj.event] = formatMetricValue(obj.event, val);
      if (obj.event === "fps") notePyramidFpsHeartbeat(val);
      renderMetrics();
      return true;
    }
  }
  if (obj.dbg === "code_rx") {
    return true;
  }
  return false;
}

function formatEvtObjectForConsole(topic, obj) {
  if (!obj || typeof obj !== "object") return "";

  if (obj.ok === true && typeof obj.code === "string") {
    return `${topic}: code received (${obj.code.length} chars)`;
  }

  if (obj.ok === false && typeof obj.err === "string") {
    noteWrenchError();
    const lower = obj.err.toLowerCase();
    if (lower.startsWith("wrench warn:")) {
      return `${topic}: warning: ${obj.err.slice("wrench warn:".length).trim()}`;
    }
    if (lower.startsWith("wrench compile:")) {
      return `${topic}: compile error: ${obj.err.slice("wrench compile:".length).trim()}`;
    }
    return `${topic}: error: ${obj.err}`;
  }

  if (obj.ok === true && typeof obj.msg === "string") {
    if (obj.msg.toLowerCase().includes("reboot")) {
      noteReboot();
    }
    return `${topic}: ${obj.msg}`;
  }

  if (typeof obj.event === "string") {
    const valueKey = Object.keys(obj).find((k) => k !== "event");
    if (!valueKey) return `${topic}: event ${obj.event}`;
    const valueLabel = formatEvtValueKey(valueKey);
    return `${topic}: ${obj.event}${valueLabel ? " " + valueLabel : ""} ${obj[valueKey]}`;
  }

  if (
    obj.ok === true &&
    typeof obj.hasProgram === "boolean" &&
    typeof obj.tickExists === "boolean" &&
    typeof obj.onMsgExists === "boolean"
  ) {
    const parts = [
      `program ${obj.hasProgram ? "loaded" : "empty"}`,
      `tick ${obj.tickExists ? "yes" : "no"}`,
      `onMsg ${obj.onMsgExists ? "yes" : "no"}`
    ];
    if (typeof obj.brightness !== "undefined") parts.push(`brightness ${obj.brightness}`);
    if (typeof obj.codeBytes !== "undefined") parts.push(`code ${obj.codeBytes}B`);
    if (typeof obj.spheres !== "undefined") parts.push(`shapes ${obj.spheres}`);
    return `${topic}: ${parts.join(" · ")}`;
  }

  if (typeof obj.dbg === "string") {
    const parts = [obj.dbg];
    if (typeof obj.len !== "undefined") parts.push(`len ${obj.len}`);
    if (typeof obj.fnv !== "undefined") parts.push(`fnv ${obj.fnv}`);
    return `${topic}: ${parts.join(" · ")}`;
  }

  return "";
}

function formatEvtValueKey(key) {
  if (key === "bytes") return "bytes";
  if (key === "words") return "words";
  if (key === "value") return "";
  return key;
}

function cmdGetCode() {
  pendingGetCode = true;
  lastRequestId++;
  publishJsonLine({ cmd: "get_code" });
}

function cmdRunNow() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "run_now", code });
  publishCodeState(code, "run_now", {
    reflection: lastDescription,
    design_rationale: lastDesignRationale,
    location: lastLocation
  });
  publishDashboardSync("code_update", {
    code,
    reflection: lastDescription,
    design_rationale: lastDesignRationale,
    location: lastLocation
  });
}

function cmdSetCode() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "set_code", code });
  publishCodeState(code, "set_code", {
    reflection: lastDescription,
    design_rationale: lastDesignRationale,
    location: lastLocation
  });
  publishDashboardSync("code_update", {
    code,
    reflection: lastDescription,
    design_rationale: lastDesignRationale,
    location: lastLocation
  });
}

function cmdRunAndStore() {
  const code = getEditorValue();
  publishJsonLine({ cmd: "run_and_store", code });
  publishCodeState(code, "run_and_store", {
    reflection: lastDescription,
    design_rationale: lastDesignRationale,
    location: lastLocation
  });
  publishDashboardSync("code_update", {
    code,
    reflection: lastDescription,
    design_rationale: lastDesignRationale,
    location: lastLocation
  });
}

function cmdReboot() {
  noteReboot();
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

    if (out.reflection) {
      lastDescription = out.reflection;
      rememberPromptReflection(out.reflection);
      lastDesignRationale = out.design_rationale || "";
      lastLocation = out.location || "";
      setReflectionPanelText();
      if (previewController) previewController.setReflectionText(reflectionWithLocation(lastDescription, lastLocation));
      updateReflectionTypography();
      logLine("— ChatGPT reflection —");
      logLine(out.reflection);
      logLine("— end reflection —");
    }

    setEditorValue(out.wrench_code);
    refreshPreview();
    publishJsonLine({ cmd: "run_now", code: out.wrench_code });
    publishReflectionUpdate(out.reflection, out.wrench_code, out.design_rationale || "", out.location || "");
    publishCodeState(out.wrench_code, "generate", {
      reflection: out.reflection || "",
      design_rationale: out.design_rationale || "",
      location: out.location || ""
    });
    publishDashboardSync("code_update", {
      code: out.wrench_code,
      reflection: out.reflection || "",
      design_rationale: out.design_rationale || "",
      location: out.location || ""
    });
    logLine("Sent run_now with generated code (" + out.wrench_code.length + " chars).");

    if (automationEnabled) {
      scheduleNextAutomationRun();
      logLine("Automation rescheduled.");
    }
  } catch (err) {
    noteOtherError();
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
  md = injectCurrentTimeDateIntoMarkdown(md);
  const MAX_CHARS = 40000;
  if (md.length > MAX_CHARS) {
    logLine(`Prompt warning: capped at ${MAX_CHARS} chars (from ${md.length}).`);
    return md.slice(0, MAX_CHARS);
  }
  return md;
}

async function testRssFeeds() {
  try {
    logLine("RSS test: fetching design doc (md)...");
    const res = await fetch(DOC_MD_URL, { method: "GET" });
    if (!res.ok) throw new Error("Doc fetch failed: HTTP " + res.status);
    const md = await res.text();
    const feeds = extractNewsFeedUrls(md);
    if (!feeds.length) {
      logLine("RSS test: no feed URLs found.");
      return;
    }

    logLine("RSS test: found " + feeds.length + " feed(s).");
    const allItems = [];
    let successCount = 0;

    for (const feedUrl of feeds) {
      logLine("RSS test: fetching " + feedUrl);
      try {
        const feedXml = await fetchFeedText(feedUrl, { bypassCache: true });
        const items = parseRssItems(feedXml, TOTAL_NEWS_ITEMS);
        if (!items.length) {
          logLine("RSS test [" + feedUrl + "]: parsed 0 items.");
          continue;
        }
        successCount++;
        logLine("RSS test [" + feedUrl + "]: parsed " + items.length + " items.");
        logLine(
          "RSS test [" +
            feedUrl +
            "]: latest: " +
            items[0].title +
            " | " +
            items[0].description +
            " | publishedAt=" +
            formatNewsTimestamp(items[0].publishedAt)
        );
        for (const item of items) {
          allItems.push({ ...item, feedUrl });
        }
      } catch (err) {
        noteRssError();
        if (err && err.feedXml) {
          maybeDownloadRssFailure(feedUrl, "parse", err.feedXml, err);
        }
        logLine("RSS test [" + feedUrl + "]: failed: " + (err && err.message ? err.message : err));
      }
    }

    if (!successCount) {
      logLine("RSS test: no feeds loaded successfully.");
      return;
    }

    allItems.sort((a, b) => {
      const at = Number.isFinite(a.publishedAt) ? a.publishedAt : -Infinity;
      const bt = Number.isFinite(b.publishedAt) ? b.publishedAt : -Infinity;
      return bt - at;
    });

    const selectedItems = allItems.slice(0, TOTAL_NEWS_ITEMS);
    logLine("RSS test: newest " + selectedItems.length + " total item(s):");
    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];
      logLine(
        "RSS test " +
          (i + 1) +
          ": " +
          item.title +
          " | " +
          item.description +
          " | publishedAt=" +
          formatNewsTimestamp(item.publishedAt) +
          " | Source: " +
          item.feedUrl
      );
    }
  } catch (err) {
    logLine("RSS test failed: " + (err && err.message ? err.message : err));
  }
}

function injectLastPromptIntoMarkdown(md) {
  if (!md) return md;
  const placeholderRegex = /\\?\[last\\?_prompt\\?\]/i;
  return md.replace(placeholderRegex, lastPromptHistoryText());
}

function injectReflectorIdIntoMarkdown(md) {
  if (!md) return md;
  const placeholderRegex = /\\?\[reflectorid\\?\]/gi;
  return md.replace(placeholderRegex, selectedPyrId || "reflector1");
}

function injectCurrentTimeDateIntoMarkdown(md) {
  if (!md) return md;
  const placeholderRegex = /\\?\[current\\?_time\\?_date\\?\]/gi;
  return md.replace(placeholderRegex, currentTimeDateString());
}

function currentTimeDateString() {
  try {
    return new Date().toLocaleString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    });
  } catch (_) {
    return new Date().toString();
  }
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

  const feedResults = [];
  let successCount = 0;
  for (const feedUrl of feeds) {
    logLine("News debug: fetching " + feedUrl);
    try {
      const feedXml = await fetchFeedText(feedUrl);
      const items = parseRssItems(feedXml, TOTAL_NEWS_ITEMS);
      if (!items.length) continue;
      logLine("News debug [" + feedUrl + "]: " + items[0].title + " | " + items[0].description);
      feedResults.push({ feedUrl, items });
      successCount++;
    } catch (err) {
      noteRssError();
      if (err && err.feedXml) {
        maybeDownloadRssFailure(feedUrl, "parse", err.feedXml, err);
      }
      logLine("News debug [" + feedUrl + "]: failed: " + (err && err.message ? err.message : err));
    }
  }

  if (successCount === 0) {
    throw new Error("No news feeds could be loaded. Skipping ChatGPT generation.");
  }

  for (const result of feedResults) {
    result.items.sort((a, b) => {
      const at = Number.isFinite(a.publishedAt) ? a.publishedAt : -Infinity;
      const bt = Number.isFinite(b.publishedAt) ? b.publishedAt : -Infinity;
      return bt - at;
    });
  }

  const selectedItems = [];
  const baseShare = Math.floor(TOTAL_NEWS_ITEMS / feedResults.length);
  let remainder = TOTAL_NEWS_ITEMS % feedResults.length;

  for (const result of feedResults) {
    const takeCount = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    for (const item of result.items.slice(0, takeCount)) {
      selectedItems.push({
        ...item,
        feedUrl: result.feedUrl
      });
    }
  }

  selectedItems.sort((a, b) => {
    const at = Number.isFinite(a.publishedAt) ? a.publishedAt : -Infinity;
    const bt = Number.isFinite(b.publishedAt) ? b.publishedAt : -Infinity;
    return bt - at;
  });
  const sections = ["# News"];
  for (let i = 0; i < selectedItems.length; i++) {
    sections.push(
      `${i + 1}. ${selectedItems[i].title}\n${selectedItems[i].description}\nSource: ${selectedItems[i].feedUrl}`
    );
  }

  return md.replace(markerRegex, "").replace(placeholderRegex, sections.join("\n\n"));
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

async function fetchFeedText(url, options = {}) {
  const bypassCache = !!options.bypassCache;
  const cached = bypassCache ? "" : getCachedFeedText(url);
  if (cached) {
    logLine("News debug: cache hit " + url);
    return cached;
  }
  if (bypassCache) {
    logLine("News debug: cache bypass " + url);
  }

  const attempts = [
    {
      label: "corsproxy",
      requestUrl: "https://corsproxy.io/?url=" + encodeURIComponent(url),
      parse: async (res) => await res.text()
    },
    {
      label: "allorigins-get",
      requestUrl: "https://api.allorigins.win/get?url=" + encodeURIComponent(url),
      parse: async (res) => {
        const data = await res.json();
        return data && data.contents ? data.contents : "";
      }
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
      logLine(`News debug [${url}]: trying ${attempt.label}`);
      const res = await fetch(attempt.requestUrl, { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await attempt.parse(res);
      if (!text) throw new Error("Empty response");
      logLine(`News debug [${url}]: success via ${attempt.label} (${text.length} chars)`);
      setCachedFeedText(url, text);
      return text;
    } catch (err) {
      const detail =
        err && err.message ? err.message :
        (typeof err === "string" ? err : JSON.stringify(err));
      logLine(`News debug [${url}]: ${attempt.label} failed: ${detail}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error("Feed fetch failed");
}

function feedCacheKey(url) {
  return "dashboard2_rss_cache_" + String(url || "");
}

function getCachedFeedText(url) {
  try {
    const raw = window.localStorage.getItem(feedCacheKey(url));
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.text !== "string" || typeof parsed.cached_at !== "number") return "";
    if (Date.now() - parsed.cached_at > RSS_CACHE_TTL_MS) return "";
    return parsed.text;
  } catch (_) {
    return "";
  }
}

function setCachedFeedText(url, text) {
  try {
    window.localStorage.setItem(
      feedCacheKey(url),
      JSON.stringify({
        cached_at: Date.now(),
        text: String(text || "")
      })
    );
  } catch (_) {}
}

function parseRssItems(xmlText, maxItems) {
  const normalizedXmlText = normalizeFeedXml(xmlText);
  const parser = new DOMParser();
  const xml = parser.parseFromString(normalizedXmlText, "text/xml");
  if (xml.querySelector("parsererror")) {
    const err = new Error("RSS parse failed");
    err.feedXml = normalizedXmlText;
    throw err;
  }
  return Array.from(xml.querySelectorAll("item"))
    .slice(0, maxItems)
    .map((item) => ({
      title: cleanNewsText(getXmlNodeText(item, "title") || "Untitled"),
      description: cleanNewsText(getXmlNodeText(item, "description") || "No description."),
      publishedAt: parseNewsTimestamp(
        getXmlNodeText(item, "pubDate") ||
        getXmlNodeText(item, "published") ||
        getXmlNodeText(item, "updated")
      )
    }));
}

function parseNewsTimestamp(value) {
  const t = Date.parse(String(value || "").trim());
  return Number.isFinite(t) ? t : NaN;
}

function formatNewsTimestamp(value) {
  if (!Number.isFinite(value)) return "invalid";
  try {
    return new Date(value).toISOString();
  } catch (_) {
    return String(value);
  }
}

function getXmlNodeText(parent, tagName) {
  const node = parent.querySelector(tagName);
  return node ? node.textContent : "";
}

function normalizeFeedXml(xmlText) {
  const text = String(xmlText || "").trim();
  if (!text.startsWith("data:")) return text;

  const commaIdx = text.indexOf(",");
  if (commaIdx < 0) return text;
  const meta = text.slice(5, commaIdx).toLowerCase();
  const body = text.slice(commaIdx + 1);

  try {
    if (meta.includes(";base64")) {
      return decodeBase64Utf8(body);
    }
    return decodeURIComponent(body);
  } catch (_) {
    return text;
  }
}

function decodeBase64Utf8(base64Text) {
  const binary = atob(base64Text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let escaped = "";
  for (let i = 0; i < bytes.length; i++) {
    escaped += "%" + bytes[i].toString(16).padStart(2, "0");
  }
  return decodeURIComponent(escaped);
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
        description: "Return a concise reflection on the concept and valid Wrench code implementing it.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            reflection: { type: "string" },
            design_rationale: { type: "string" },
            location: { type: "string" },
            wrench_code: { type: "string" }
          },
          required: ["reflection", "design_rationale", "location", "wrench_code"]
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
          "1) a short reflection on what you generated",
          "2) a short design rationale explaining the design choices",
          "3) the location as a short string",
          "4) the full Wrench code"
        ].join("\n")
      }
    ],
    tools,
    tool_choice: { type: "function", function: { name: "generate_wrench" } },
    temperature: selectedGptTemperature
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
      lastCodeUpdateAt = Date.now();
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
    publishCodeState(fixed.wrench_code, "auto_fix", {
      reflection: fixed.description || "",
      design_rationale: lastDesignRationale,
      location: lastLocation
    });
    publishDashboardSync("code_update", {
      code: fixed.wrench_code,
      reflection: fixed.description || "",
      design_rationale: lastDesignRationale,
      location: lastLocation
    });
    logLine("Sent run_now with fixed code.");
  } catch (e) {
    noteOtherError();
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

  const line = String(s);
  const prev = consoleDiv.html();
  let lines = prev ? prev.split("\n") : [];
  lines.push(line);
  lines = maybeRotateConsole(lines);
  consoleDiv.html(lines.join("\n"));
  consoleDiv.elt.scrollTop = consoleDiv.elt.scrollHeight;
  if (shouldBroadcast && shouldBroadcastConsoleLine(line)) publishConsoleLine(line);
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
  var m = 0;
  while(i < total){
    m = i;
    while (m >= 10) {
      m = m - 10;
    }
    if(m == 0){
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

  emptySectionEl = createSection(editorColumnEl, "editor", "Preview");
  reflectionSectionEl = createSection(editorColumnEl, "console", "Reflection");
  monitorSectionEl = createSection(infoColumnEl, "third", "Status");
  metricsSectionEl = createSection(infoColumnEl, "third", "Device Info");
  editorSectionEl = createSection(infoColumnEl, "third", "Wrench Code");
  consoleSectionEl = createSection(infoColumnEl, "third", "Console");
  consoleSectionEl.addClass("console-section");
  reflectionSectionEl.addClass("reflection-section");
  monitorSectionEl.addClass("monitor-section");
  metricsSectionEl.addClass("device-info");
  emptySectionEl.addClass("preview-section");
  syncSectionTitles();
}

function syncSectionTitles() {
  const previewTitle = emptySectionEl?.elt?.querySelector(".panel-title");
  if (previewTitle) {
    previewTitle.textContent = "Preview " + selectedPyrId;
  }
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
  previewController.setReflectionText(reflectionWithLocation(lastDescription, lastLocation) || descriptionDiv?.elt?.textContent || "");
  previewController.setMonitorState(getPyramidMonitorState());
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
    if (obj.event === "fps") notePyramidFpsHeartbeat(val);
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
const TOTAL_PREVIEW_LEDS = 5352;
const PREVIEW_SEGMENTS_PER_TUBE = 200;

function createBuiltinPreviewPalettes() {
  return {
    0: [hsvToRgb(0, 255, 255), hsvToRgb(96, 255, 255), hsvToRgb(170, 255, 255)],
    1: [hsvToRgb(0, 255, 80), hsvToRgb(18, 255, 180), hsvToRgb(32, 255, 255)],
    2: [hsvToRgb(140, 255, 80), hsvToRgb(170, 255, 180), hsvToRgb(190, 80, 255)],
    3: [hsvToRgb(70, 255, 50), hsvToRgb(90, 255, 120), hsvToRgb(120, 180, 220)],
    4: [hsvToRgb(200, 255, 255), hsvToRgb(20, 255, 255), hsvToRgb(140, 255, 255)],
    5: [hsvToRgb(4, 255, 50), hsvToRgb(24, 255, 180), hsvToRgb(42, 40, 255)],
    6: [hsvToRgb(18, 255, 40), hsvToRgb(28, 220, 120), hsvToRgb(38, 180, 220)]
  };
}

class WrenchPreviewController {
  constructor(hostDiv) {
    this.hostDiv = hostDiv;
    this.runtime = null;
    this.instance = null;
    this.lastSource = "";
    this.error = "";
    this.loopStarted = false;
    this.segmentColors = Array.from({ length: 6 }, () => Array.from({ length: PREVIEW_SEGMENTS_PER_TUBE }, () => "#000000"));
    this.preview3d = new WrenchPreview3D(hostDiv);
    this.startLoop();
  }

  setReflectionText(text) {
    this.preview3d.setState({ reflectionText: text || "" });
  }

  setMonitorState(monitor) {
    this.preview3d.setState({ monitor });
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
    this.segmentColors = Array.from({ length: 6 }, () => Array.from({ length: PREVIEW_SEGMENTS_PER_TUBE }, () => "#000000"));
    this.error = "";
    this.reflectionText = "";
    this.monitor = getPyramidMonitorState();
    this.indicatorBounds = null;
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
    this.hostDiv.elt.addEventListener("click", (e) => this.handleHostClick(e));
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
      p.scale(-1, -1, 1);
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
      const parts = splitReflectionLocationText(this.reflectionText);
      const fittedSize = fitPreviewGraphicsTextSize(g, this.reflectionText, boxW, boxH);
      const locationSize = Math.max(14, fittedSize * 0.5);

      g.push();
      g.clear();
      g.noStroke();
      g.fill(255, 245, 232, 230);
      g.textFont("Georgia");
      g.textAlign(g.LEFT, g.TOP);
      g.textSize(fittedSize);
      g.textLeading(fittedSize * 1.08);
      const mainBounds = previewGraphicsFontBounds(g, parts.main, boxW);
      g.text(parts.main, boxX, boxY, boxW, boxH);
      if (parts.location) {
        g.fill(255, 245, 232, 175);
        g.textStyle(g.ITALIC);
        g.textSize(locationSize);
        g.textLeading(locationSize * 1.15);
        g.text(parts.location, boxX, boxY + mainBounds.height + fittedSize * 0.7, boxW, boxH);
        g.textStyle(g.NORMAL);
      }
      g.pop();

      p.push();
      p.image(g, 0, 0, p.width, p.height);
      this.drawPreviewIndicator(p);
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

  setState({ segmentColors, error, reflectionText, monitor }) {
    if (segmentColors) this.segmentColors = segmentColors;
    if (typeof reflectionText === "string") this.reflectionText = reflectionText;
    if (monitor) this.monitor = monitor;
    this.error = error || "";
  }

  handleHostClick(event) {
    if (displayMode !== "preview" || !this.indicatorBounds) return;
    const rect = this.hostDiv.elt.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - this.indicatorBounds.cx;
    const dy = y - this.indicatorBounds.cy;
    if (dx * dx + dy * dy <= this.indicatorBounds.r * this.indicatorBounds.r) {
      togglePreviewIndicatorCompact();
      event.stopPropagation();
    }
  }

  drawPreviewIndicator(p) {
    if (displayMode !== "preview") {
      return;
    }
    const monitor = this.monitor || getPyramidMonitorState();
    const showAutomationDetails = automationEnabled;
    const compact = !!monitor.compact;
    const size = compact ? 10 : 100;
    const cx = compact ? p.width - 16 : p.width - 78;
    const cy = compact ? 34 : 138;
    const radius = size * 0.5;
    this.indicatorBounds = { cx, cy, r: radius + 8 };

    p.push();
    p.noStroke();
    if (monitor.state === "online") {
      p.stroke(245, 238, 224, 220);
      p.strokeWeight(compact ? 1.5 : 2.5);
      p.noFill();
      p.circle(cx, cy, size);
      if (showAutomationDetails) {
        p.noStroke();
        p.fill(245, 238, 224, 170);
        p.arc(cx, cy, size - 6, size - 6, -p.HALF_PI, -p.HALF_PI + p.TWO_PI * monitor.progress, p.PIE);
      }
    } else if (monitor.state === "purple") {
      if (monitor.blinkOn) {
        p.fill(164, 106, 255, 220);
        p.circle(cx, cy, size);
      }
    } else if (monitor.state === "offline") {
      const alpha = monitor.blinkOffline ? (monitor.blinkOn ? 235 : 50) : 220;
      p.fill(220, 42, 42, alpha);
      p.circle(cx, cy, size);
    } else {
      p.fill(232, 182, 52, 90 + 100 * monitor.warningPulse);
      p.circle(cx, cy, size);
    }

    if (!compact && showAutomationDetails) {
      if (monitor.countdownLabel) {
        p.fill(245, 238, 224, 210);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(14);
        p.text(monitor.countdownLabel, cx, cy + radius + 10);
      }
      const stats = [
        `W ${monitor.stats.wrenchErrors}`,
        `R ${monitor.stats.rssErrors}`,
        `O ${monitor.stats.otherErrors}`,
        `RB ${monitor.stats.reboots}`
      ];
      p.fill(245, 238, 224, 150);
      p.textAlign(p.LEFT, p.TOP);
      p.textSize(10);
      const statsX = cx - radius;
      let statsY = cy + radius + 30;
      if (monitor.countdownLabel) statsY += 12;
      for (const line of stats) {
        p.text(line, statsX, statsY);
        statsY += 11;
      }
    }
    p.pop();
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
    const glowColors = [
      averageHexColor(this.segmentColors[0] || []),
      averageHexColor(this.segmentColors[1] || []),
      averageHexColor(this.segmentColors[2] || []),
      averageHexColor(this.segmentColors[3] || []),
      averageHexColor(this.segmentColors[4] || []),
      averageHexColor(this.segmentColors[5] || [])
    ];
    const glowAnchors = [
      center,
      [-47.5, 38.784, -27.425],
      [47.5, 38.784, -27.425],
      [0.0, 38.784, 54.848]
    ];

    p.push();
    p.noStroke();
    p.fill(18, 18, 18);
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

    if (p.drawingContext?.disable && p.drawingContext?.DEPTH_TEST !== undefined) {
      p.drawingContext.disable(p.drawingContext.DEPTH_TEST);
    }
    for (let i = 0; i < glowAnchors.length; i++) {
      const src = glowColors[i] || { r: 0, g: 0, b: 0 };
      const anchor = glowAnchors[i];
      const alpha = Math.max(src.r, src.g, src.b) * 0.2;
      if (alpha <= 1) continue;
      const projected = projectPointToPlane(anchor, shiftedCenter, u, v);
      const baseW = 180 + i * 28;
      const baseH = 90 + i * 18;
      for (let layer = 11; layer >= 0; layer--) {
        const layerScale = 1.35 + layer * 0.42;
        const layerAlpha = alpha * (0.42 - layer * 0.022);
        if (layerAlpha <= 1) continue;
        p.fill(
          Math.min(255, src.r * 1.08),
          Math.min(255, src.g * 1.08),
          Math.min(255, src.b * 1.08),
          layerAlpha
        );
        p.beginShape();
        for (let j = 0; j < 28; j++) {
          const ang = (j / 28) * Math.PI * 2;
          const pt = addScaledPlaneCorner(
            projected,
            u,
            v,
            Math.cos(ang) * baseW * 0.5 * layerScale,
            Math.sin(ang) * baseH * 0.5 * layerScale
          );
          p.vertex(pt[0], pt[1], pt[2]);
        }
        p.endShape(p.CLOSE);
      }
    }
    if (p.drawingContext?.enable && p.drawingContext?.DEPTH_TEST !== undefined) {
      p.drawingContext.enable(p.drawingContext.DEPTH_TEST);
    }

    p.pop();
  }

  drawSegmentedCylinder(p, from, to, colors) {
    const segments = Math.max(1, colors.length || PREVIEW_SEGMENTS_PER_TUBE);
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
    const glowAlpha = Math.max(c.r, c.g, c.b) * 0.09;

    p.push();
    p.translate(midX, midY, midZ);
    p.rotateY(yaw);
    p.rotateX(pitch);

    if (glowAlpha > 1) {
      if (p.drawingContext?.disable && p.drawingContext?.DEPTH_TEST !== undefined) {
        p.drawingContext.disable(p.drawingContext.DEPTH_TEST);
      }
      for (let layer = 0; layer < 6; layer++) {
        const layerScale = 1.35 + layer * 0.22;
        const layerAlpha = glowAlpha * (0.34 - layer * 0.04);
        if (layerAlpha <= 1) continue;
        p.push();
        p.fill(c.r, c.g, c.b, layerAlpha);
        p.cylinder(radius * layerScale, len * (1.015 + layer * 0.015), 12, 1, false, false);
        p.pop();
      }
      if (p.drawingContext?.enable && p.drawingContext?.DEPTH_TEST !== undefined) {
        p.drawingContext.enable(p.drawingContext.DEPTH_TEST);
      }
    }

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
    this.palettes = createBuiltinPreviewPalettes();
    this.tubeColors = Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0 }));
    this.directTubeTouched = Array.from({ length: 6 }, () => false);
    this.directAccum = Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0, count: 0, maxR: 0, maxG: 0, maxB: 0 }));
    this.directPixels = Array.from({ length: TOTAL_PREVIEW_LEDS }, () => ({ r: 0, g: 0, b: 0 }));
    this.noiseSeedValue = 1;
    this.tempVecA = { x: 0, y: 0, z: 0 };
    this.tempVecB = { x: 0, y: 0, z: 0 };
    this.tempVecC = { x: 0, y: 0, z: 0 };
    this.tempTime = { valid: 1, epoch: 0, ymd: 0, h: 0, m: 0, s: 0, seconds: 0 };
    this.lastTexTimeMs = 0;
  }

  createScope() {
    const runtime = this;
    return {
      STRIPS: 6,
      TUBES: 6,
      STRIPS_PER_TUBE: 4,
      SDF_STRIP_BITS: 24,
      STRIP_LEN: 223,
      TOTAL_LEDS: 5352,
      SDF_SPHERE: 0,
      SDF_BOX: 1,
      SDF_UNITS: "cm",
      SDF_STEP_MM: 0.25,
      Vec3: function Vec3() {
        this.x = 0;
        this.y = 0;
        this.z = 0;
      },
      math: createPreviewMathScope(),
      int: (v) => Math.trunc(Number(v) || 0),
      millis: () => runtime.millis(),
      leds_begin: () => 1,
      leds_total: () => TOTAL_PREVIEW_LEDS,
      leds_strip_count: () => 6,
      leds_strip_len: () => 223,
      leds_set_brightness: (b) => { runtime.brightness = Number(b) || 0; return 0; },
      leds_get_brightness: () => runtime.brightness,
      leds_clear: () => runtime.leds_clear(),
      leds_set_pixel: (...args) => runtime.leds_set_pixel(...args),
      leds_set_pixel_c: (...args) => runtime.leds_set_pixel(...args),
      leds_get_pixel_c: (...args) => runtime.leds_get_pixel_c(...args),
      leds_show: () => runtime.leds_show(),
      create_Color: () => ({ r: 0, g: 0, b: 0 }),
      sdf_set_count: (n) => runtime.sdf_set_count(n),
      sdf_palette_hsv3: (...args) => runtime.sdf_palette_hsv3(...args),
      sdf_palette_rgb3: (...args) => runtime.sdf_palette_rgb3(...args),
      sdf_set_sphere: (...args) => runtime.sdf_set_sphere(...args),
      create_Sphere: () => runtime.create_Sphere(),
      sdf_update_sphere: (shape) => runtime.sdf_update_sphere(shape),
      sdf_set_box: (...args) => runtime.sdf_set_box(...args),
      create_Box: () => runtime.create_Box(),
      sdf_update_box: (shape) => runtime.sdf_update_box(shape),
      sdf_set_shape: (...args) => runtime.sdf_set_shape(...args),
      sdf_set_palette: (...args) => runtime.sdf_set_palette(...args),
      sdf_set_material: (...args) => runtime.sdf_set_material(...args),
      sdf_set_tex_time: (...args) => runtime.sdf_set_tex_time(...args),
      sdf_get_count: () => runtime.shapes.length,
      sdf_render: () => runtime.sdf_render(),
      noise_seed: (seed) => runtime.noise_seed(seed),
      randomSeed: (seed) => runtime.randomSeed(seed),
      simplex3: (x, y, z) => runtime.simplex3(x, y, z),
      simplex3_01: (x, y, z) => runtime.simplex3_01(x, y, z),
      tube_endpoints: (...args) => runtime.tube_endpoints(...args),
      tube_endpoints3: (tube) => runtime.tube_endpoints(tube, 1),
      tube_endpoints_out: (tube, outA, outB) => runtime.tube_endpoints_out(tube, outA, outB),
      tube_xyz: (...args) => runtime.tube_xyz(...args),
      tube_xyz3: (tube, t01) => runtime.tube_xyz(tube, t01, 1),
      tube_xyz_out: (tube, t01, outVec3) => runtime.tube_xyz_out(tube, t01, outVec3),
      tube_lerp: (tube, t01, which) => runtime.tube_lerp(tube, t01, which),
      lerp: (a, b, t) => runtime.lerp(a, b, t),
      lerp3: (a, b, t) => runtime.lerp3(a, b, t),
      lerp_color: (a, b, t) => runtime.lerp_color(a, b, t),
      time_get: () => runtime.time_get(),
      time_is_valid: () => 1,
      time_now: () => runtime.time_now(),
      time_local_seconds: () => runtime.time_local_seconds(),
      time_local_hour: () => runtime.time_get().h,
      time_local_minute: () => runtime.time_get().m,
      time_local_second: () => runtime.time_get().s,
      time_local_ymd: () => runtime.time_get().ymd,
      time_set_timezone: () => 1,
      time_sync: () => 1,
      inbox_has: () => 0,
      inbox_get: () => "",
      number: (v) => Number(v) || 0,
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
    this.directPixels = Array.from({ length: TOTAL_PREVIEW_LEDS }, () => ({ r: 0, g: 0, b: 0 }));
    return 0;
  }

  leds_set_pixel(...args) {
    if (args.length >= 5) {
      const strip = clampIndex(args[0], 6);
      const idx = clampIndex(args[1], 892);
      this.addDirectPixel(strip, idx, args[2], args[3], args[4]);
    } else if (args.length >= 4) {
      if (typeof args[1] === "object") {
        const pos = clampIndex(args[0], TOTAL_PREVIEW_LEDS);
        const strip = clampIndex(Math.floor(pos / 892), 6);
        const idx = pos - strip * 892;
        this.addDirectPixel(strip, idx, args[1].r, args[1].g, args[1].b);
      } else {
        const pos = clampIndex(args[0], TOTAL_PREVIEW_LEDS);
        const strip = clampIndex(Math.floor(pos / 892), 6);
        const idx = pos - strip * 892;
        this.addDirectPixel(strip, idx, args[1], args[2], args[3]);
      }
    } else if (args.length >= 3 && typeof args[2] === "object") {
      const strip = clampIndex(args[0], 6);
      const idx = clampIndex(args[1], 892);
      this.addDirectPixel(strip, idx, args[2].r, args[2].g, args[2].b);
    }
    return 0;
  }

  leds_get_pixel_c(...args) {
    let pos = 0;
    if (args.length >= 2) {
      pos = clampIndex(args[0], 6) * 892 + clampIndex(args[1], 892);
    } else {
      pos = clampIndex(args[0], TOTAL_PREVIEW_LEDS);
    }
    const c = this.directPixels[pos] || { r: 0, g: 0, b: 0 };
    return { r: c.r, g: c.g, b: c.b };
  }

  addDirectPixel(strip, idx, r, g, b) {
    const bucket = this.directAccum[strip];
    const rr = Number(r) || 0;
    const gg = Number(g) || 0;
    const bb = Number(b) || 0;
    this.directPixels[strip * 892 + idx] = { r: rr, g: gg, b: bb };
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

  sdf_palette_rgb3(id, r1, g1, b1, r2, g2, b2, r3, g3, b3) {
    this.palettes[id] = [
      { r: Number(r1) || 0, g: Number(g1) || 0, b: Number(b1) || 0 },
      { r: Number(r2) || 0, g: Number(g2) || 0, b: Number(b2) || 0 },
      { r: Number(r3) || 0, g: Number(g3) || 0, b: Number(b3) || 0 }
    ];
    return 0;
  }

  sdf_set_sphere(i, x, y, z, r, hue, sat, val, alpha) {
    if (typeof i === "object") return this.sdf_update_sphere(i);
    const prev = this.shapes[i] || {};
    this.shapes[i] = {
      type: "sphere",
      idx: clampIndex(i, Math.max(this.shapes.length || 1, clampIndex(i, 9999) + 1)),
      x: Number(x) || 0,
      y: Number(y) || 0,
      z: Number(z) || 0,
      r: Math.max(1, Number(r) || 1),
      color: hsvToRgb(hue, sat, val),
      alpha: Number(alpha) || 0.6,
      bias: Number(arguments[9]) || 0.5,
      paletteId: typeof prev.paletteId === "undefined" ? null : prev.paletteId,
      paletteMix: typeof prev.paletteMix === "undefined" ? 255 : prev.paletteMix,
      paletteScroll: typeof prev.paletteScroll === "undefined" ? 0 : prev.paletteScroll,
      paletteBright: typeof prev.paletteBright === "undefined" ? 255 : prev.paletteBright,
      paletteBlend: typeof prev.paletteBlend === "undefined" ? 1 : prev.paletteBlend,
      material: prev.material || null
    };
    return 0;
  }

  sdf_set_box(i, x, y, z, w, h, d, hue, sat, val, alpha) {
    if (typeof i === "object") return this.sdf_update_box(i);
    const prev = this.shapes[i] || {};
    this.shapes[i] = {
      type: "box",
      idx: clampIndex(i, Math.max(this.shapes.length || 1, clampIndex(i, 9999) + 1)),
      x: Number(x) || 0,
      y: Number(y) || 0,
      z: Number(z) || 0,
      w: Math.max(1, Number(w) || 1),
      h: Math.max(1, Number(h) || 1),
      d: Math.max(1, Number(d) || 1),
      color: hsvToRgb(hue, sat, val),
      alpha: Number(alpha) || 0.6,
      bias: Number(arguments[10]) || 0.5,
      power: Number(arguments[11]) || 2,
      paletteId: typeof prev.paletteId === "undefined" ? null : prev.paletteId,
      paletteMix: typeof prev.paletteMix === "undefined" ? 255 : prev.paletteMix,
      paletteScroll: typeof prev.paletteScroll === "undefined" ? 0 : prev.paletteScroll,
      paletteBright: typeof prev.paletteBright === "undefined" ? 255 : prev.paletteBright,
      paletteBlend: typeof prev.paletteBlend === "undefined" ? 1 : prev.paletteBlend,
      material: prev.material || null
    };
    return 0;
  }

  create_Sphere() {
    return { idx: this.shapes.length, type: "sphere", x: 0, y: 0, z: 0, r: 1, hue: 0, sat: 0, val: 0, alpha: 1, bias: 0.5 };
  }

  sdf_update_sphere(shape) {
    return this.sdf_set_sphere(shape.idx, shape.x, shape.y, shape.z, shape.r, shape.hue, shape.sat, shape.val, shape.alpha, shape.bias);
  }

  create_Box() {
    return { idx: this.shapes.length, type: "box", x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, hue: 0, sat: 0, val: 0, alpha: 1, bias: 0.5, power: 2 };
  }

  sdf_update_box(shape) {
    return this.sdf_set_box(shape.idx, shape.x, shape.y, shape.z, shape.w, shape.h, shape.d, shape.hue, shape.sat, shape.val, shape.alpha, shape.bias, shape.power);
  }

  sdf_set_shape(i, type, x, y, z, a, b, c, hue, sat, val, alpha, bias, power) {
    return Number(type) === 1
      ? this.sdf_set_box(i, x, y, z, a, b, c, hue, sat, val, alpha, bias, power)
      : this.sdf_set_sphere(i, x, y, z, a, hue, sat, val, alpha, bias);
  }

  sdf_set_palette(i, paletteId, mix, scroll, bright, blend) {
    if (!this.shapes[i]) {
      this.shapes[i] = { idx: clampIndex(i, Math.max(this.shapes.length || 1, clampIndex(i, 9999) + 1)) };
    }
    this.shapes[i].paletteId = paletteId;
    this.shapes[i].paletteMix = Number(mix) || 0;
    this.shapes[i].paletteScroll = Number(scroll) || 0;
    this.shapes[i].paletteBright = typeof bright === "undefined" ? 255 : Number(bright) || 0;
    this.shapes[i].paletteBlend = typeof blend === "undefined" ? 1 : Number(blend) || 0;
    return 0;
  }

  sdf_set_material(i, texId, cellCm, strength, seed, mode) {
    if (!this.shapes[i]) {
      this.shapes[i] = { idx: clampIndex(i, Math.max(this.shapes.length || 1, clampIndex(i, 9999) + 1)) };
    }
    this.shapes[i].material = {
      texId: Number(texId) || 0,
      cellCm: Math.max(0.001, Number(cellCm) || 1),
      strength: Number(strength) || 0,
      seed: Number(seed) || 0,
      mode: Number(mode) || 0
    };
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
    this.lastTexTimeMs = this.millis();
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
    const t = normalizePreviewTubeT(tube, t01);
    const p = {
      x: pair[0].x + (pair[1].x - pair[0].x) * t,
      y: pair[0].y + (pair[1].y - pair[0].y) * t,
      z: pair[0].z + (pair[1].z - pair[0].z) * t
    };
    if (which === 1) return p.y;
    if (which === 2) return p.z;
    return p.x;
  }

  tube_endpoints(tube, mode) {
    const pair = PREVIEW_TUBE_ENDPOINTS[clampIndex(tube, 6)] || PREVIEW_TUBE_ENDPOINTS[0];
    if (Number(mode) === 1) {
      this.tempVecA.x = pair[0].x; this.tempVecA.y = pair[0].y; this.tempVecA.z = pair[0].z;
      this.tempVecB.x = pair[1].x; this.tempVecB.y = pair[1].y; this.tempVecB.z = pair[1].z;
      return { a: this.tempVecA, b: this.tempVecB };
    }
    return `${pair[0].x} ${pair[0].y} ${pair[0].z} ${pair[1].x} ${pair[1].y} ${pair[1].z}`;
  }

  tube_endpoints_out(tube, outA, outB) {
    const pair = PREVIEW_TUBE_ENDPOINTS[clampIndex(tube, 6)] || PREVIEW_TUBE_ENDPOINTS[0];
    if (!outA || !outB) return 0;
    outA.x = pair[0].x; outA.y = pair[0].y; outA.z = pair[0].z;
    outB.x = pair[1].x; outB.y = pair[1].y; outB.z = pair[1].z;
    return 1;
  }

  tube_xyz(tube, t01, mode) {
    const x = this.tube_lerp(tube, t01, 0);
    const y = this.tube_lerp(tube, t01, 1);
    const z = this.tube_lerp(tube, t01, 2);
    if (Number(mode) === 1) {
      this.tempVecC.x = x; this.tempVecC.y = y; this.tempVecC.z = z;
      return this.tempVecC;
    }
    return `${x} ${y} ${z}`;
  }

  tube_xyz_out(tube, t01, outVec3) {
    if (!outVec3) return 0;
    outVec3.x = this.tube_lerp(tube, t01, 0);
    outVec3.y = this.tube_lerp(tube, t01, 1);
    outVec3.z = this.tube_lerp(tube, t01, 2);
    return 1;
  }

  lerp(a, b, t) {
    const aa = Number(a) || 0;
    const bb = Number(b) || 0;
    const k = Math.max(0, Math.min(1, Number(t) || 0));
    return aa + (bb - aa) * k;
  }

  lerp3(a, b, t) {
    const k = Math.max(0, Math.min(1, Number(t) || 0));
    this.tempVecC.x = (a.x || 0) + ((b.x || 0) - (a.x || 0)) * k;
    this.tempVecC.y = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * k;
    this.tempVecC.z = (a.z || 0) + ((b.z || 0) - (a.z || 0)) * k;
    return this.tempVecC;
  }

  lerp_color(a, b, t) {
    const k = Math.max(0, Math.min(1, Number(t) || 0));
    return {
      r: (a.r || 0) + ((b.r || 0) - (a.r || 0)) * k,
      g: (a.g || 0) + ((b.g || 0) - (a.g || 0)) * k,
      b: (a.b || 0) + ((b.b || 0) - (a.b || 0)) * k
    };
  }

  time_now() {
    return Math.floor(Date.now() / 1000);
  }

  time_local_seconds() {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  time_get() {
    const d = new Date();
    this.tempTime.epoch = Math.floor(d.getTime() / 1000);
    this.tempTime.h = d.getHours();
    this.tempTime.m = d.getMinutes();
    this.tempTime.s = d.getSeconds();
    this.tempTime.seconds = this.time_local_seconds();
    this.tempTime.ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return this.tempTime;
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
      let falloff = 0;
      if (shape.type === "sphere") {
        const dx = x - shape.x;
        const dy = y - shape.y;
        const dz = z - shape.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        falloff = Math.max(0, 1 - d / shape.r);
      } else if (shape.type === "box") {
        const dx = Math.max(0, Math.abs(x - shape.x) - shape.w * 0.5);
        const dy = Math.max(0, Math.abs(y - shape.y) - shape.h * 0.5);
        const dz = Math.max(0, Math.abs(z - shape.z) - shape.d * 0.5);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const edge = Math.max(4, Math.min(shape.w, shape.h, shape.d) * 0.45);
        falloff = Math.max(0, 1 - d / edge);
      }
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
    if (shape.paletteId === null || typeof shape.paletteId === "undefined" || !this.palettes[shape.paletteId]) {
      return shape.color;
    }
    const pal = this.palettes[shape.paletteId];
    const scroll = ((shape.paletteScroll || 0) + this.lastTexTimeMs * 0.001) * 0.01;
    const idxF = ((1 - falloff) * 2 + scroll) % 3;
    const idx0 = Math.max(0, Math.min(2, Math.floor((idxF + 3) % 3)));
    const idx1 = (idx0 + 1) % 3;
    const frac = ((idxF % 1) + 1) % 1;
    const palColor = mixRgb(pal[idx0], pal[idx1], frac);
    const mixAmt = normalizePreviewPaletteScalar(shape.paletteMix, 0);
    const bright = normalizePreviewPaletteScalar(shape.paletteBright, 1);
    const blend = normalizePreviewPaletteScalar(shape.paletteBlend, 1);
    const mixed = mixRgb(shape.color, palColor, mixAmt * blend);
    return {
      r: Math.min(255, mixed.r * bright),
      g: Math.min(255, mixed.g * bright),
      b: Math.min(255, mixed.b * bright)
    };
  }

  getTubeHexColors() {
    return this.tubeColors.map((c) => rgbToHex(c));
  }

  getTubeSegmentHexColors() {
    const segmentsPerTube = PREVIEW_SEGMENTS_PER_TUBE;
    const out = [];
    for (let tube = 0; tube < 6; tube++) {
      const row = [];
      for (let s = 0; s < segmentsPerTube; s++) {
        const u0 = s / segmentsPerTube;
        const u1 = (s + 1) / segmentsPerTube;
        const c0 = this.sampleSceneAtTube(tube, u0 + (u1 - u0) * 0.25);
        const c1 = this.sampleSceneAtTube(tube, u0 + (u1 - u0) * 0.75);
        const baseColor = {
          r: (c0.r + c1.r) * 0.5,
          g: (c0.g + c1.g) * 0.5,
          b: (c0.b + c1.b) * 0.5
        };
        const directColor = this.sampleDirectTubeSegment(tube, u0, u1);
        row.push(
          rgbToHex(
            applyBrightness(
              {
                r: Math.min(255, baseColor.r + directColor.r),
                g: Math.min(255, baseColor.g + directColor.g),
                b: Math.min(255, baseColor.b + directColor.b)
              },
              this.brightness
            )
          )
        );
      }
      out.push(row);
    }
    return out;
  }

  sampleSceneAtTube(tube, u) {
    const p = this.samplePoint(tube, u);
    return this.sampleSceneAt(p.x, p.y, p.z);
  }

  sampleDirectTubeSegment(tube, u0, u1) {
    const start = clampIndex(Math.floor(u0 * 892), 892);
    const end = clampIndex(Math.ceil(u1 * 892), 892);
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    let maxR = 0;
    let maxG = 0;
    let maxB = 0;
    for (let idx = start; idx <= end; idx++) {
      const c = this.directPixels[tube * 892 + idx];
      if (!c) continue;
      if ((c.r || 0) <= 0 && (c.g || 0) <= 0 && (c.b || 0) <= 0) continue;
      sumR += c.r || 0;
      sumG += c.g || 0;
      sumB += c.b || 0;
      count += 1;
      maxR = Math.max(maxR, c.r || 0);
      maxG = Math.max(maxG, c.g || 0);
      maxB = Math.max(maxB, c.b || 0);
    }
    if (!count) return { r: 0, g: 0, b: 0 };
    return {
      r: Math.max(sumR / count, maxR * 0.65),
      g: Math.max(sumG / count, maxG * 0.65),
      b: Math.max(sumB / count, maxB * 0.65)
    };
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

function averageHexColor(hexList) {
  if (!hexList || !hexList.length) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const hex of hexList) {
    const c = hexToRgb(hex);
    r += c.r;
    g += c.g;
    b += c.b;
    count += 1;
  }
  if (!count) return { r: 0, g: 0, b: 0 };
  return {
    r: r / count,
    g: g / count,
    b: b / count
  };
}

function createPreviewMathScope() {
  const mathScope = Object.create(Math);
  mathScope.fmod = (a, b) => {
    const aa = Number(a) || 0;
    const bb = Number(b) || 0;
    if (!bb) return 0;
    return aa - Math.trunc(aa / bb) * bb;
  };
  return mathScope;
}

function normalizePreviewPaletteScalar(value, defaultValue) {
  if (value === null || typeof value === "undefined") return defaultValue;
  const n = Number(value);
  if (Number.isNaN(n)) return defaultValue;
  if (n <= 1.4) return Math.max(0, n);
  return Math.max(0, n / 255);
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

function normalizePreviewTubeT(tube, t01) {
  const t = Math.max(0, Math.min(1, Number(t01) || 0));
  return Number(tube) === 4 ? 1 - t : t;
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

function projectPointToPlane(point, planeOrigin, u, v) {
  const rel = [
    point[0] - planeOrigin[0],
    point[1] - planeOrigin[1],
    point[2] - planeOrigin[2]
  ];
  return addScaledPlaneCorner(
    planeOrigin,
    u,
    v,
    dotVec3(rel, u),
    dotVec3(rel, v)
  );
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
