"""Workflow Dashboard Bridge — the single Python process spawned by Electron.

Handles:
- MQTT task ingestion
- AI task execution (delegates to orchestrator)
- stdin/stdout JSON communication with Electron main process
- File output to .multi-ai-workflow/
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
import uuid

# Ensure engine/ is on the path for absolute imports
sys.path.insert(0, os.path.dirname(__file__))

from mqtt_client import get_mqtt_client
from orchestrator import execute as execute_task


def safe_print(obj: dict):
    """Write a JSON line to stdout with surrogate protection."""
    text = json.dumps(obj, ensure_ascii=False)
    print(text.encode("utf-8", errors="replace").decode("utf-8"), flush=True)


def write_workflow_file(project_dir: str, filename: str, content: str):
    """Write a markdown file into .multi-ai-workflow/ for the dashboard to display."""
    wf_dir = os.path.join(project_dir, ".multi-ai-workflow")
    os.makedirs(wf_dir, exist_ok=True)
    filepath = os.path.join(wf_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    return filepath


class Bridge:
    """Manages MQTT + AI orchestration, reports to Electron via stdout."""

    def __init__(self):
        self.mqtt = get_mqtt_client()
        self.project_dir = ""
        self._pending_tasks: dict[str, dict] = {}

        # Wire MQTT callbacks
        self.mqtt.set_handlers(
            on_task=self._on_mqtt_task,
            on_status=self._on_mqtt_status,
        )

    # ── MQTT callbacks ──────────────────────────────────────────

    def _on_mqtt_task(self, task: dict):
        """Called when a task arrives via MQTT."""
        safe_print({"event": "mqtt_task_received", "data": task})

        # Write task to workflow directory
        if self.project_dir:
            ts = time.strftime("%Y%m%d_%H%M%S")
            filename = f"task_{task.get('id', 'unknown')}_{ts}.md"
            content = self._format_task_md(task)
            filepath = write_workflow_file(self.project_dir, filename, content)
            safe_print({"event": "task_file_written", "data": {
                "task_id": task["id"],
                "file": filepath,
                "filename": filename,
            }})

    def _on_mqtt_status(self, status: dict):
        """Called on MQTT connection status changes."""
        safe_print({"event": "mqtt_status", "data": status})

    # ── Task formatting ─────────────────────────────────────────

    def _format_task_md(self, task: dict) -> str:
        """Format a task as a markdown checkpoint-style file."""
        priority_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}
        emoji = priority_emoji.get(task.get("priority", "medium"), "🟡")
        topic = task.get("topic", "unknown")
        title = task.get("title", "Untitled")
        desc = task.get("description", "")
        task_id = task.get("id", "?")
        received = task.get("received_at", time.time())
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(received))

        return f"""# {emoji} MQTT Task: {title}

- **Task ID**: `{task_id}`
- **Topic**: `{topic}`
- **Priority**: {task.get('priority', 'medium')}
- **Received**: {ts}
- **Status**: ⏳ pending

## Description

{desc}

## Execution Log

<!-- Execution results will be appended here -->

"""

    def _format_result_md(self, task: dict, result: dict) -> str:
        """Format execution result as markdown to append."""
        status = "✅ completed" if result.get("status") == "completed" else "❌ failed"
        level = result.get("level", "?")
        duration = result.get("duration_ms", 0)
        final = result.get("final_result", "No result")

        return f"""

---

## Execution Result

- **Status**: {status}
- **Level**: {level}
- **Duration**: {duration}ms
- **AI Providers**: {result.get('reference_results', 0)}

### Final Output

{final}

### Generated Files

{json.dumps(result.get('generated_files', []), ensure_ascii=False, indent=2)}
"""

    # ── Command handlers ────────────────────────────────────────

    def handle_start_mqtt(self, data: dict):
        """Start the MQTT client."""
        host = data.get("broker", "localhost")
        port = data.get("port", 1883)
        task_topic = data.get("task_topic", "workflow/tasks/#")
        result_topic = data.get("result_topic", "workflow/results")

        self.mqtt.configure(
            host=host, port=port,
            task_topic=task_topic,
            result_topic=result_topic,
        )
        ok = self.mqtt.connect()
        safe_print({
            "event": "mqtt_started" if ok else "mqtt_error",
            "data": {"broker": f"{host}:{port}", "connected": ok},
        })

    def handle_stop_mqtt(self, _data: dict = None):
        self.mqtt.disconnect()
        safe_print({"event": "mqtt_stopped", "data": {}})

    def handle_set_project(self, data: dict):
        self.project_dir = data.get("project_dir", "")
        safe_print({"event": "project_set", "data": {"dir": self.project_dir}})

    def handle_execute_task(self, data: dict):
        """Execute a task via the AI orchestrator with progress reporting."""
        task_id = data.get("id", str(uuid.uuid4())[:8])
        safe_print({"event": "task_execution_started", "data": {"task_id": task_id}})

        # Progress: analyzing
        safe_print({"event": "task_progress", "data": {
            "task_id": task_id, "stage": "analyzing", "progress": 0.1,
            "message": "正在分析任务...",
        }})
        if self.mqtt.connected:
            self.mqtt.publish_status(task_id, "analyzing", 0.1)

        try:
            result = execute_task(data)

            # Progress: done
            safe_print({"event": "task_progress", "data": {
                "task_id": task_id, "stage": "completed", "progress": 1.0,
                "message": f"完成 (L{result.get('level','?')}, {result.get('duration_ms',0)}ms)",
            }})
            safe_print({"event": "task_executed", "data": {**result, "task_id": task_id}})

            # Publish result to MQTT if connected
            if self.mqtt.connected:
                self.mqtt.publish_result(task_id, result)

            # Write result files
            if self.project_dir:
                ts = time.strftime("%Y%m%d_%H%M%S")
                filename = f"task_{task_id}_{ts}.md"
                content = self._format_task_md(data) + self._format_result_md(data, result)
                write_workflow_file(self.project_dir, filename, content)

                report = self._format_handoff_md(task_id, data, result)
                write_workflow_file(
                    self.project_dir,
                    f"handoff_{task_id}_{ts}.md",
                    report,
                )

        except Exception as e:
            tb = traceback.format_exc()
            safe_print({"event": "task_error", "data": {
                "task_id": task_id,
                "error": str(e),
                "traceback": tb[-2000:],
            }})

    def _format_handoff_md(self, task_id: str, task: dict, result: dict) -> str:
        """Format a CC#2-style handoff report."""
        return f"""# [CC#2 → CC#1] Task Execution Report

- **Task ID**: `{task_id}`
- **Title**: {task.get('title', 'Untitled')}
- **Result**: {result.get('status', 'unknown')}
- **Level**: {result.get('level', '?')}
- **Duration**: {result.get('duration_ms', 0)}ms

## Final Result

{result.get('final_result', 'No result')}

## Evidence

- AI providers used: {result.get('reference_results', 0)}
- Passed: {result.get('passed', 0)}
- Generated files: {json.dumps(result.get('generated_files', []), ensure_ascii=False)}
- Output directory: {result.get('output_dir', 'N/A')}

## Risks

<!-- Add any risks identified during execution -->

## Decision Needed

<!-- CC#1: approve / revise / reject -->
"""

    def handle_publish_mqtt(self, data: dict):
        """Manually publish a task via MQTT."""
        topic = data.get("topic", "workflow/tasks/manual")
        payload = json.dumps(data.get("payload", {}), ensure_ascii=False)
        if self.mqtt.connected:
            # Use paho directly
            import paho.mqtt.publish as pub
            pub.single(topic, payload, hostname=self.mqtt._broker_host, port=self.mqtt._broker_port)
            safe_print({"event": "mqtt_published", "data": {"topic": topic}})
        else:
            safe_print({"event": "mqtt_error", "data": {"error": "Not connected"}})


def main():
    bridge = Bridge()
    safe_print({"event": "bridge_ready", "data": {"version": "0.2.0"}})

    for line in sys.stdin:
        try:
            cmd = json.loads(line.strip())
            action = cmd.get("action", "")
            data = cmd.get("data", {})

            if action == "ping":
                safe_print({"event": "pong", "data": {}})

            elif action == "start_mqtt":
                bridge.handle_start_mqtt(data)

            elif action == "stop_mqtt":
                bridge.handle_stop_mqtt(data)

            elif action == "set_project":
                bridge.handle_set_project(data)

            elif action == "execute_task":
                bridge.handle_execute_task(data)

            elif action == "publish_mqtt":
                bridge.handle_publish_mqtt(data)

            elif action == "configure_provider":
                from ai_router import configure_provider
                result = configure_provider(
                    provider=data.get("provider", ""),
                    api_key=data.get("api_key", ""),
                    endpoint=data.get("endpoint", ""),
                    enabled=data.get("enabled", True),
                )
                safe_print({"event": "provider_configured", "data": result})

            else:
                safe_print({"event": "error", "data": f"Unknown action: {action}"})

        except json.JSONDecodeError:
            safe_print({"event": "error", "data": "Invalid JSON"})
        except Exception as e:
            safe_print({"event": "error", "data": str(e)})

    # Cleanup on stdin close
    bridge.handle_stop_mqtt()


if __name__ == "__main__":
    main()
