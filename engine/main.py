"""AI Executor — standalone multi-AI task execution engine.
Extracted from task-assistant (https://github.com/JMS852/task-assistant).

Communicates via stdin/stdout JSON protocol (one JSON object per line).
"""
import sys
import json
import os
sys.path.insert(0, os.path.dirname(__file__))


def safe_print(obj):
    text = json.dumps(obj, ensure_ascii=False)
    print(text.encode('utf-8', errors='replace').decode('utf-8'), flush=True)


def main():
    safe_print({'status': 'ready'})

    for line in sys.stdin:
        try:
            cmd = json.loads(line.strip())
            action = cmd.get('action')

            if action == 'ping':
                safe_print({'status': 'ok'})

            elif action == 'execute_task':
                from orchestrator import execute
                import traceback
                try:
                    result = execute(cmd['data'])
                    safe_print({'event': 'task_executed', 'data': result, '_requestId': cmd.get('_requestId')})
                except Exception as e:
                    tb = traceback.format_exc()
                    safe_print({'event': 'error', 'data': f'{e}\n\n{tb[-1000:]}', '_requestId': cmd.get('_requestId')})

            elif action == 'configure_provider':
                from ai_router import configure_provider
                data = cmd['data']
                result = configure_provider(
                    provider=data['provider'],
                    api_key=data.get('api_key', ''),
                    endpoint=data.get('endpoint', ''),
                    enabled=data.get('enabled', True),
                )
                safe_print(result)

            else:
                safe_print({'event': 'error', 'data': f'Unknown action: {action}'})

        except Exception as e:
            safe_print({'event': 'error', 'data': str(e)})


if __name__ == '__main__':
    main()
