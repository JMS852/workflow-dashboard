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
        with self._lock:
            return self._connected

    @property
    def broker(self) -> str:
        with self._lock:
            return f"{self._broker_host}:{self._broker_port}"

    @property
    def broker_host(self) -> str:
        with self._lock:
            return self._broker_host

    @property
    def broker_port(self) -> int:
        with self._lock:
            return self._broker_port

    def configure(self, host: str = "localhost", port: int = 1883,
                  task_topic: str = "workflow/tasks/#",
                  result_topic: str = "workflow/results"):
        with self._lock:
            self._broker_host = host
            self._broker_port = port
            self._task_topic = task_topic
            self._result_topic = result_topic

    def set_handlers(self, on_task: Callable | None = None,
                     on_status: Callable | None = None):
        with self._lock:
            self._on_task = on_task
            self._on_status = on_status

    def _emit_status(self, status: str, detail: str = ""):
        with self._lock:
            handler = self._on_status
        if handler:
            handler({"status": status, "detail": detail, "ts": time.time()})

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            with self._lock:
                self._connected = True
                task_topic = self._task_topic
            self._emit_status("connected", f"Broker: {self.broker}")
            client.subscribe(task_topic)
            self._emit_status("subscribed", task_topic)
        else:
            self._emit_status("error", f"Connection failed: rc={reason_code}")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        with self._lock:
            self._connected = False
        self._emit_status("disconnected", f"rc={reason_code}")

    def _on_message(self, client, userdata, msg):
        try:
            payload = msg.payload.decode("utf-8")
            data = json.loads(payload)
            task_id = data.get("id", str(uuid.uuid4())[:8])
            self._emit_status("task_received", task_id)

            with self._lock:
                handler = self._on_task
            if handler:
                handler({
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
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            client.on_connect = self._on_connect
            client.on_disconnect = self._on_disconnect
            client.on_message = self._on_message

            with self._lock:
                self._client = client
                host = self._broker_host
                port = self._broker_port

            client.connect_async(host, port, 60)
            client.loop_start()
            return True
        except Exception as e:
            self._emit_status("error", f"Connection error: {e}")
            return False

    def disconnect(self):
        with self._lock:
            client = self._client
            self._client = None
            self._connected = False
        if client:
            client.loop_stop()
            client.disconnect()

    def publish_result(self, task_id: str, result: dict):
        with self._lock:
            client = self._client
            connected = self._connected
            result_topic = self._result_topic
        if not client or not connected:
            return False
        try:
            payload = json.dumps({
                "id": task_id,
                "result": result,
                "ts": time.time(),
            }, ensure_ascii=False)
            client.publish(f"{result_topic}/{task_id}", payload)
            return True
        except Exception:
            return False

    def publish_status(self, task_id: str, status: str, progress: float = 0.0):
        """Publish task execution progress."""
        with self._lock:
            client = self._client
            connected = self._connected
            result_topic = self._result_topic
        if not client or not connected:
            return
        try:
            payload = json.dumps({
                "id": task_id,
                "status": status,
                "progress": progress,
                "ts": time.time(),
            })
            client.publish(f"{result_topic}/{task_id}/status", payload)
        except Exception:
            pass

    def publish_message(self, topic: str, payload: str) -> bool:
        """Publish an arbitrary message to a topic."""
        with self._lock:
            client = self._client
            connected = self._connected
        if not client or not connected:
            return False
        try:
            client.publish(topic, payload)
            return True
        except Exception:
            return False

    def publish_raw(self, topic: str, payload: str) -> bool:
        """Publish an arbitrary payload to a given topic. Returns success."""
        with self._lock:
            client = self._client
            connected = self._connected
        if not client or not connected:
            return False
        try:
            client.publish(topic, payload)
            return True
        except Exception:
            return False


# Singleton
_instance_lock = threading.Lock()
_client_instance: MQTTTaskClient | None = None


def get_mqtt_client() -> MQTTTaskClient:
    global _client_instance
    if _client_instance is None:
        with _instance_lock:
            if _client_instance is None:
                _client_instance = MQTTTaskClient()
    return _client_instance
