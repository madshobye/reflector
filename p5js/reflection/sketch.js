let mqttKeyEncrypted = "U2FsdGVkX1+f60bzOgPSBUTFJpFtLdWNgjs5QTNiW9BsDukPIRX8VtphcNDQ/bqS";
let mqttKey = "";

const PYR_ID = "reflector1";
const MQTT_REFLECTION_TOPIC = `/glow_dk_cph/${PYR_ID}/reflection`;

let client = null;
let isConnected = false;
let statusP;
let connectBtn;
let disconnectBtn;

let latestReflection = "Waiting for a generated reflection.";
let latestCode = "";
let latestGeneratedAt = "";
let reflectionMeta = "No MQTT message received yet.";

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("Georgia");
  textAlign(LEFT, TOP);

  try {
    mqttKey = storedDecrypt({ mqttKeyEncrypted });
  } catch (e) {
    latestReflection = "MQTT key could not be loaded.";
    reflectionMeta = "Check storedDecrypt credentials.";
  }

  statusP = createP("Status: MQTT not connected");
  statusP.position(20, 12);
  statusP.style("margin", "0");
  statusP.style("color", "#f5f1e8");
  statusP.style("font-family", "monospace");
  statusP.style("font-size", "13px");

  connectBtn = createButton("Connect MQTT");
  connectBtn.position(20, 42);
  connectBtn.mousePressed(connectMQTT);

  disconnectBtn = createButton("Disconnect");
  disconnectBtn.position(128, 42);
  disconnectBtn.mousePressed(disconnectMQTT);
  disconnectBtn.attribute("disabled", "");

  connectMQTT();
}

function draw() {
  drawBackground();

  noStroke();
  fill(255, 245, 232, 230);
  textSize(clampWidth(28, 54));
  textLeading(clampWidth(34, 64));
  text(latestReflection, 48, 110, width - 96, height - 250);

  fill(173, 214, 255, 220);
  textSize(16);
  textLeading(24);
  text(reflectionMeta, 48, height - 110, width - 96, 32);

  fill(255, 245, 232, 150);
  textSize(13);
  const codeInfo = latestCode
    ? "Code length: " + latestCode.length + " chars"
    : "No code received yet.";
  text(codeInfo, 48, height - 72, width - 96, 24);
}

function drawBackground() {
  const t = millis() * 0.00015;
  background(8, 10, 18);

  for (let y = 0; y < height; y += 4) {
    const n = noise(y * 0.003, t);
    const r = 8 + 22 * n;
    const g = 10 + 30 * n;
    const b = 18 + 60 * n;
    stroke(r, g, b, 130);
    line(0, y, width, y);
  }

  noStroke();
  fill(80, 150, 255, 24);
  ellipse(width * 0.18, height * 0.24, width * 0.4, width * 0.4);
  fill(255, 120, 90, 16);
  ellipse(width * 0.82, height * 0.72, width * 0.32, width * 0.32);
}

function connectMQTT() {
  if (!window.mqtt) {
    latestReflection = "mqtt.min.js not loaded.";
    return;
  }

  if (client) return;

  const clientId = "p5js-reflection-" + Math.floor(Math.random() * 1e9);
  client = mqtt.connect("wss://reflector:" + mqttKey + "@reflector.cloud.shiftr.io", {
    clientId,
    keepalive: 20,
    reconnectPeriod: 1000,
    connectTimeout: 5000
  });

  client.on("connect", () => {
    isConnected = true;
    statusP.html("Status: MQTT connected");
    connectBtn.attribute("disabled", "");
    disconnectBtn.removeAttribute("disabled");

    client.subscribe(MQTT_REFLECTION_TOPIC, (err) => {
      if (err) {
        reflectionMeta = "Subscribe error: " + err;
      } else {
        reflectionMeta = "Listening on " + MQTT_REFLECTION_TOPIC;
      }
    });
  });

  client.on("reconnect", () => {
    statusP.html("Status: MQTT reconnecting");
  });

  client.on("close", () => {
    isConnected = false;
    statusP.html("Status: MQTT closed");
    connectBtn.removeAttribute("disabled");
    disconnectBtn.attribute("disabled", "");
    client = null;
  });

  client.on("error", (err) => {
    reflectionMeta = "MQTT error: " + err;
  });

  client.on("message", (topic, message) => {
    if (topic !== MQTT_REFLECTION_TOPIC) return;
    applyReflectionPayload(message ? message.toString() : "");
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
  connectBtn.removeAttribute("disabled");
  disconnectBtn.attribute("disabled", "");
}

function applyReflectionPayload(payload) {
  if (!payload) return;

  try {
    const data = JSON.parse(payload);
    latestReflection = data.description || "No reflection text provided.";
    latestCode = data.code || "";
    latestGeneratedAt = data.generated_at || "";
    reflectionMeta = latestGeneratedAt
      ? "Updated " + formatTimestamp(latestGeneratedAt)
      : "Updated from MQTT.";
  } catch (err) {
    latestReflection = payload;
    latestCode = "";
    latestGeneratedAt = "";
    reflectionMeta = "Received non-JSON reflection payload.";
  }
}

function formatTimestamp(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString();
}

function clampWidth(minSize, maxSize) {
  return constrain(width * 0.035, minSize, maxSize);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
