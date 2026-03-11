const MQTT_READONLY_TOKEN = "XDyuEJgC9Q7veMrn";

const PYR_ID_OPTIONS = ["reflector1", "reflector2", "reflector3", "reflector4", "reflector5"];

const PYR_ID = getReflectionPyrId();
const MQTT_REFLECTION_TOPIC = `/glow_dk_cph/${PYR_ID}/reflection`;

let client = null;
let isConnected = false;

let latestReflection = "Waiting for a generated reflection.";
let connectionState = "Connecting...";

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("Georgia");
  textAlign(LEFT, TOP);

  connectMQTT();
}

function draw() {
  drawBackground();

  const boxX = width * 0.06;
  const boxY = height * 0.08;
  const boxW = width * 0.88;
  const boxH = height * 0.84;
  const fittedSize = fitTextSize(latestReflection, boxW, boxH);

  noStroke();
  fill(255, 245, 232, 230);
  textSize(fittedSize);
  textLeading(fittedSize * 1.08);
  text(latestReflection, boxX, boxY, boxW, boxH);

  fill(255, 245, 232, 150);
  textSize(metaTextSize());
  text(connectionState, width * 0.06, height * 0.93, width * 0.88, height * 0.04);
}

function drawBackground() {
  background(0);
}

function connectMQTT() {
  if (!window.mqtt) {
    latestReflection = "mqtt.min.js not loaded.";
    return;
  }

  if (client) return;

  const clientId = "p5js-reflection-" + Math.floor(Math.random() * 1e9);
  client = mqtt.connect("wss://reflector:" + MQTT_READONLY_TOKEN + "@reflector.cloud.shiftr.io", {
    clientId,
    keepalive: 20,
    reconnectPeriod: 1000,
    connectTimeout: 5000
  });

  client.on("connect", () => {
    isConnected = true;
    connectionState = "Connected";

    client.subscribe(MQTT_REFLECTION_TOPIC, (err) => {
      if (err) {
        connectionState = "Subscribe error: " + err;
      } else {
        connectionState = "Listening";
      }
    });
  });

  client.on("reconnect", () => {
    connectionState = "Reconnecting...";
  });

  client.on("close", () => {
    isConnected = false;
    connectionState = "Connection lost";
    client = null;
    setTimeout(connectMQTT, 1000);
  });

  client.on("error", (err) => {
    connectionState = "MQTT error";
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
    connectionState = "Connected";
  } catch (err) {
    latestReflection = payload;
    connectionState = "Connected";
  }
}

function reflectionTextSize() {
  return constrain(min(width, height) * 0.09, 34, 88);
}

function reflectionLeading() {
  return reflectionTextSize() * 1.08;
}

function metaTextSize() {
  return constrain(min(width, height) * 0.022, 12, 18);
}

function fitTextSize(content, boxW, boxH) {
  const textValue = content || "";
  let size = reflectionTextSize();
  const minSize = 18;

  while (size > minSize) {
    textSize(size);
    textLeading(size * 1.08);
    const bounds = fontBoundsForBox(textValue, boxW);
    if (bounds.height <= boxH) {
      return size;
    }
    size -= 2;
  }

  return minSize;
}

function fontBoundsForBox(content, boxW) {
  const paragraphs = String(content).split("\n");
  const leadingValue = textAscent() + textDescent() + textSize() * 0.08;
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
      if (textWidth(candidate) <= boxW) {
        line = candidate;
      } else {
        if (line) {
          lineCount += 1;
        }
        line = word;
      }
    }

    if (line) {
      lineCount += 1;
    }
  }

  return {
    height: lineCount * leadingValue
  };
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function getReflectionPyrId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id && PYR_ID_OPTIONS.includes(id)) return id;
  } catch (_) {}
  return "reflector1";
}
