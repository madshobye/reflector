// wifi mqtt
#include <time.h>

//#define pyrID reflector1
//#define pyrID madstest
//#define pyrID pyrfab

#define STR_HELPER(x) #x
#define STR(x) STR_HELPER(x)

static const char* MQTT_SUB_TOPIC = "/glow_dk_cph/" STR(pyrID) "/cmd";
static const char* MQTT_PUB_TOPIC = "/glow_dk_cph/" STR(pyrID) "/evt";

static unsigned long lastWifiAttemptMs = 0;

static volatile bool wifiConnecting = false;
static volatile bool wifiGotIP = false;

// ============================================================
// NTP time sync
// ============================================================
static const char* TIMEZONE = "CET-1CEST,M3.5.0/02,M10.5.0/03";  // Copenhagen
static volatile bool g_timeSyncRequested = false;
static bool g_timeConfigured = false;
static bool g_timeSynced = false;
static uint32_t g_timeLastAttemptMs = 0;
unsigned int wifiAttempt = 0;

static void timeConfigureOnce() {
  if (g_timeConfigured) return;
  // UTC from NTP; TZ is applied via TZ env
  configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
  setenv("TZ", TIMEZONE, 1);
  tzset();
  g_timeConfigured = true;
}

void timeSetTimezone(const char* tz) {
  if (!tz || !*tz) return;
  setenv("TZ", tz, 1);
  tzset();
  g_timeConfigured = true;
}

bool timeIsSynced() {
  return g_timeSynced;
}

void timeRequestSync() {
  g_timeSyncRequested = true;
}

void timeService() {
  if (!g_timeSyncRequested) return;
  if (WiFi.status() != WL_CONNECTED) return;

  const uint32_t nowMs = millis();
  if ((uint32_t)(nowMs - g_timeLastAttemptMs) < 2000) return;
  g_timeLastAttemptMs = nowMs;

  timeConfigureOnce();

  struct tm ti;
  if (getLocalTime(&ti, 10)) {
    g_timeSynced = true;
    g_timeSyncRequested = false;
    sendKV_bool("time", "synced", true);
  }
}

// From comm.ino (provided below)
typedef bool (*MqttPublishFn)(const char* topic, const char* payload, void* user);
extern void commAttachMqttPublisher(MqttPublishFn fn, void* user, const char* topic);

static bool mqttPublishThunk(const char* topic, const char* payload, void* user) {
  MQTTClient* c = (MQTTClient*)user;
  if (!c || !c->connected()) return false;
  return c->publish(topic, payload);
}

void onWiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      wifiConnecting = true;
      wifiGotIP = false;
      break;

    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      wifiConnecting = true;
      wifiGotIP = false;
      sendOk("got sta");
      break;

    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      wifiConnecting = false;
      wifiGotIP = true;
      sendOk("got ip");
      timeRequestSync();

      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      wifiConnecting = false;
      wifiGotIP = false;
      g_timeSynced = false;
      sendOk("wifi lost");
      wifiAttempt++;
      break;


    default:
      break;
  }
}
unsigned int mqttAttempt = 0;
bool mqttSuccess = false;
static bool ensureMqtt() {
  // Detect transition (optional debug)
  bool mqttNow = mqtt.connected();
  if (mqttNow != mqttWasConnected) {
    mqttWasConnected = mqttNow;
    sendKV_bool("mqtt", "up", mqttNow);
  }

  if (mqtt.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  // throttle reconnect attempts
  const unsigned long now = millis();
  if (now - lastReconnectAttemptMs < 2000) return false;
  lastReconnectAttemptMs = now;

  String cid = makeClientId();

  mqtt.begin("public.cloud.shiftr.io", net);

  mqtt.onMessage(messageReceived);
  mqttAttempt++;
  // connect(clientId, username, password)
  if (mqtt.connect(cid.c_str(), MQTT_USER, MQTT_TOKEN)) {
    mqtt.subscribe(MQTT_SUB_TOPIC);

    // Safe to call every time: it won't add multiple outputs,
    // it only refreshes pointers/topic.
    commAttachMqttPublisher(mqttPublishThunk, &mqtt, MQTT_PUB_TOPIC);
    mqttSuccess = true;
    return true;
  }

  /*
// hack because wifi hotspot gets ip but does not have internet (yet)
  if (primaryAttempt && millis() > 10000  && !secondaryAttempt && mqttSuccess == false && mqttAttempt > 10) {
    setupWifiBackup();
    Serial.println("trying secondary wifi");
  }
  else if(wifiAttempt > 10 && millis()<100000)
  {
setupWifiBackup();
    Serial.println("trying secondary wifi");
  }*/


  return false;
}

void messageReceived(String& topic, String& payload) {
  if (topic != MQTT_SUB_TOPIC) return;
  payload.trim();
  if (!payload.length()) return;

  // ⚠️ Don't echo raw payload with sendOk(payload) unless you want cmd->evt loops.
  // If you want debug, do something like:
  // sendKV_int("mqtt_rx", "bytes", payload.length());

  g_mqttInbox = payload;
  g_mqttInboxDirty = true;
}



void setupWifi() {
  // esp_wifi_set_max_tx_power(40); //I simply started to unsolder / disconnected an external LED from GPIO Pin 21.
  WiFi.mode(WIFI_STA);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.onEvent(onWiFiEvent);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  primaryAttempt = true;
}


void setupWifiBackup() {
  // esp_wifi_set_max_tx_power(40); //I simply started to unsolder / disconnected an external LED from GPIO Pin 21.
  WiFi.mode(WIFI_STA);
  secondaryAttempt = true;
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.onEvent(onWiFiEvent);
  WiFi.begin(WIFI_SSID2, WIFI_PASS2);
}
