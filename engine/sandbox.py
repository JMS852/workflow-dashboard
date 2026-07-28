import subprocess
import tempfile
import os
import time
import shutil

DOCKER_IMAGE = 'python:3.12-slim'
SANDBOX_TIMEOUT = 60
SANDBOX_MEMORY = '512m'
SANDBOX_CPUS = '1'


def run_in_sandbox(code: str, test_script: str | None = None, language: str = 'python') -> dict:
    """在 Docker 沙箱中执行代码并返回结果。Docker 不可用时回退到本地子进程。"""
    if not _docker_available():
        return _run_local_subprocess(code, test_script)

    with tempfile.TemporaryDirectory() as tmpdir:
        code_path = os.path.join(tmpdir, 'solution.py')
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)

        if test_script:
            test_path = os.path.join(tmpdir, 'test.py')
            with open(test_path, 'w', encoding='utf-8') as f:
                f.write(test_script)

        cmd = [
            'docker', 'run', '--rm',
            '--memory', SANDBOX_MEMORY,
            '--cpus', SANDBOX_CPUS,
            '--network', 'none',
            '--security-opt', 'no-new-privileges',
            '--cap-drop', 'ALL',
            '-v', f'{tmpdir}:/code:ro',
            '-w', '/code',
            DOCKER_IMAGE,
            'timeout', str(SANDBOX_TIMEOUT),
            'python', '-c',
        ]

        if test_script:
            cmd[-1] = f'import sys; sys.path.insert(0, "/code"); exec(open("/code/solution.py").read()); exec(open("/code/test.py").read()); print("ALL_TESTS_PASSED")'
        else:
            cmd[-1] = f'exec(open("/code/solution.py").read())'

        try:
            start = time.time()
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=SANDBOX_TIMEOUT + 10)
            elapsed = time.time() - start

            stdout = result.stdout.strip()
            stderr = result.stderr.strip()

            return {
                'success': result.returncode == 0 and 'ALL_TESTS_PASSED' in stdout,
                'exit_code': result.returncode,
                'stdout': stdout[:5000],
                'stderr': stderr[:5000],
                'duration_s': round(elapsed, 2),
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Sandbox timeout', 'duration_s': SANDBOX_TIMEOUT}
        except Exception as e:
            return {'success': False, 'error': str(e)}


FILE_EXTENSIONS = {'.docx', '.xlsx', '.pptx', '.pdf', '.txt', '.csv', '.json',
                   '.html', '.md', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.py'}


def run_and_collect_files(code: str, output_dir: str, filename_hint: str = 'output') -> dict:
    """执行 Python 代码并将生成的文件复制到 output_dir。

    代码在临时目录中执行，执行后所有生成的文件（非 .py 源文件）
    会被复制到 output_dir。返回生成的文件路径列表。
    """
    os.makedirs(output_dir, exist_ok=True)
    tmpdir = tempfile.mkdtemp()

    try:
        code_path = os.path.join(tmpdir, 'run.py')
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)

        start = time.time()
        result = subprocess.run(
            ['python', code_path],
            capture_output=True, text=True, timeout=SANDBOX_TIMEOUT,
            cwd=tmpdir,
        )
        elapsed = time.time() - start

        # Collect generated files (non-.py files)
        saved_files = []
        for root, dirs, files in os.walk(tmpdir):
            dirs[:] = [d for d in dirs if d != '__pycache__']
            for fname in files:
                if fname == 'run.py':
                    continue
                src = os.path.join(root, fname)
                ext = os.path.splitext(fname)[1].lower()
                if ext in FILE_EXTENSIONS or not ext:
                    dst = os.path.join(output_dir, fname)
                    # Avoid overwriting: append number if needed
                    base, e = os.path.splitext(fname)
                    # Use timestamp to avoid confusing name collisions (e.g. report_1 → report_1_1)
                    ts = time.strftime('%Y%m%d_%H%M%S')
                    dst = os.path.join(output_dir, f"{base}_{ts}{e}")
                    shutil.copy2(src, dst)
                    saved_files.append(dst)

        return {
            'success': result.returncode == 0,
            'exit_code': result.returncode,
            'stdout': result.stdout[:5000],
            'stderr': result.stderr[:5000],
            'duration_s': round(elapsed, 2),
            'files': saved_files,
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Execution timeout', 'files': []}
    except Exception as e:
        return {'success': False, 'error': str(e), 'files': []}
    finally:
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass


def _docker_available() -> bool:
    try:
        result = subprocess.run(['docker', 'info'], capture_output=True, timeout=5)
        return result.returncode == 0
    except Exception:
        return False


def _run_local_subprocess(code: str, test_script: str = None) -> dict:
    """本地子进程执行（Docker 不可用时的回退）"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(code)
        code_path = f.name

    try:
        start = time.time()
        result = subprocess.run(
            ['python', code_path],
            capture_output=True, text=True, timeout=SANDBOX_TIMEOUT
        )
        elapsed = time.time() - start

        return {
            'success': result.returncode == 0,
            'exit_code': result.returncode,
            'stdout': result.stdout[:5000],
            'stderr': result.stderr[:5000],
            'duration_s': round(elapsed, 2),
            'note': 'Executed locally (Docker not available)',
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Execution timeout'}
    finally:
        try:
            os.unlink(code_path)
        except Exception:
            pass
