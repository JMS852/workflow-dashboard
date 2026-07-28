"""MQTT client module for Workflow Dashboard.
Connects to an MQTT broker, subscribes to task-flow topics,
and publishes results back.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Callable

try:
    import paho.mqtt.client as mqtt
    HAS_PAHO = True
except ImportError:
    HAS_PAHO = False


class MQTTTaskClient:
    """MQTT client that receives tasks and publishes results."""

    def __init__(self):
        self._client: "mqtt.Client | None" = None
        self._connected = False
        self._broker_host = "localhost"
        self._broker_port = 1883
        self._task_topic = "workflow/tasks/#"
        self._result_topic = "workflow/results"
        self._on_task: Callable | None = None
        self._on_status: Callable | None = None
        self._lock = threading.Lock()

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def broker(self) -> str:
        return f"{self._broker_host}:{self._broker_port}"

    def configure(self, host: str = "localhost", port: int = 1883,
                  task_topic: str = "workflow/tasks/#",
                  result_topic: str = "workflow/results"):
        self._broker_host = host
        self._broker_port = port
        self._task_topic = task_topic
        self._result_topic = result_topic

    def set_handlers(self, on_task: Callable | None = None,
                     on_status: Callable | None = None):
        self._on_task = on_task
        self._on_status = on_status

    def _emit_status(self, status: str, detail: str = ""):
        if self._on_status:
            self._on_status({"status": status, "detail": detail, "ts": time.time()})

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            self._connected = True
            self._emit_status("connected", f"Broker: {self.broker}")
            client.subscribe(self._task_topic)
            self._emit_status("subscribed", self._task_topic)
        else:
            self._emit_status("error", f"Connection failed: rc={reason_code}")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        self._connected = False
        self._emit_status("disconnected", f"rc={reason_code}")

    def _on_message(self, client, userdata, msg):
        try:
            payload = msg.payload.decode("utf-8")
            data = json.loads(payload)
            task_id = data.get("id", str(uuid.uuid4())[:8])
            self._emit_status("task_received", task_id)

            if self._on_task:
                self._on_task({
                    "id": task_id,
                    "topic": msg.topic,
                    "title": data.get("title", "Untitled"),
                    "description": data.get("description", ""),
                    "priority": data.get("priority", "medium"),
                    "raw": data,
                    "received_at": time.time(),
                })
        except json.JSONDecodeError:
            self._emit_status("error", f"Invalid JSON on {msg.topic}")
        except Exception as e:
            self._emit_status("error", str(e))

    def connect(self) -> bool:
        if not HAS_PAHO:
            self._emit_status("error", "paho-mqtt not installed")
            return False

        try:
            self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            self._client.on_connect = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            self._client.on_message = self._on_message
            self._client.connect_async(self._broker_host, self._broker_port, 60)
            self._client.loop_start()
            return True
        except Exception as e:
            self._emit_status("error", f"Connection error: {e}")
            return False

    def disconnect(self):
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()
            self._connected = False

    def publish_result(self, task_id: str, result: dict):
        if not self._client or not self._connected:
            return False
        try:
            payload = json.dumps({
                "id": task_id,
                "result": result,
                "ts": time.time(),
            }, ensure_ascii=False)
            self._client.publish(f"{self._result_topic}/{task_id}", payload)
            return True
        except Exception:
            return False

    def publish_status(self, task_id: str, status: str, progress: float = 0.0):
        """Publish task execution progress."""
        if not self._client or not self._connected:
            return
        try:
            payload = json.dumps({
                "id": task_id,
                "status": status,
                "progress": progress,
                "ts": time.time(),
            })
            self._client.publish(f"{self._result_topic}/{task_id}/status", payload)
        except Exception:
            pass


# Singleton
_client_instance: MQTTTaskClient | None = None


def get_mqtt_client() -> MQTTTaskClient:
    global _client_instance
    if _client_instance is None:
        _client_instance = MQTTTaskClient()
    return _client_instance
