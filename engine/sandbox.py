import subprocess
import tempfile
import os
import sys
import platform
import time
import shutil

DOCKER_IMAGE = 'python:3.12-slim'
SANDBOX_TIMEOUT = 60
SANDBOX_MEMORY = '512m'
SANDBOX_CPUS = '1'


def run_in_sandbox(code: str, test_script: str | None = None, language: str = 'python', output_dir: str | None = None) -> dict:
    """在 Docker 沙箱中执行代码并返回结果。Docker 不可用时回退到本地子进程。"""
    if not _docker_available():
        return _run_local_subprocess(code, test_script, output_dir)

    with tempfile.TemporaryDirectory() as tmpdir:
        code_path = os.path.join(tmpdir, 'solution.py')
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)

        if test_script:
            test_path = os.path.join(tmpdir, 'test.py')
            with open(test_path, 'w', encoding='utf-8') as f:
                f.write(test_script)

        # 文件收集：创建 Docker 可写工作目录
        work_dir = None
        if output_dir:
            work_dir = os.path.join(tmpdir, 'work')
            os.makedirs(work_dir, exist_ok=True)

        cmd = [
            'docker', 'run', '--rm',
            '--memory', SANDBOX_MEMORY,
            '--cpus', SANDBOX_CPUS,
            '--network', 'none',
            '--security-opt', 'no-new-privileges',
            '--cap-drop', 'ALL',
            '-v', f'{tmpdir}:/code:ro',
        ]
        if work_dir:
            cmd.extend(['-v', f'{work_dir}:/work'])
        cmd.extend([
            '-w', '/work' if work_dir else '/code',
            DOCKER_IMAGE,
            'timeout', str(SANDBOX_TIMEOUT),
            'python', '-c',
        ])

        if test_script:
            if work_dir:
                cmd[-1] = f'import sys, os; sys.path.insert(0, "/code"); os.chdir("/work"); exec(open("/code/solution.py").read()); exec(open("/code/test.py").read()); print("ALL_TESTS_PASSED")'
            else:
                cmd[-1] = f'import sys; sys.path.insert(0, "/code"); exec(open("/code/solution.py").read()); exec(open("/code/test.py").read()); print("ALL_TESTS_PASSED")'
        else:
            if work_dir:
                cmd[-1] = f'import os; os.chdir("/work"); exec(open("/code/solution.py").read())'
            else:
                cmd[-1] = f'exec(open("/code/solution.py").read())'

        try:
            start = time.time()
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=SANDBOX_TIMEOUT + 10)
            elapsed = time.time() - start

            stdout = result.stdout.strip()
            stderr = result.stderr.strip()

            # 从 Docker 可写工作目录收集生成的文件
            files = []
            if work_dir and result.returncode == 0 and ('ALL_TESTS_PASSED' in stdout if test_script else True):
                files = _collect_generated_files(work_dir, output_dir)

            return {
                'success': result.returncode == 0 and 'ALL_TESTS_PASSED' in stdout,
                'exit_code': result.returncode,
                'stdout': stdout[:5000],
                'stderr': stderr[:5000],
                'duration_s': round(elapsed, 2),
                'files': files,
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Sandbox timeout', 'duration_s': SANDBOX_TIMEOUT, 'files': []}
        except Exception as e:
            return {'success': False, 'error': str(e), 'files': []}


FILE_EXTENSIONS = {'.docx', '.xlsx', '.pptx', '.pdf', '.txt', '.csv', '.json',
                   '.html', '.md', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.py'}


def _collect_generated_files(source_dir: str, output_dir: str, skip_names: set = None) -> list:
    """从 source_dir 收集非 .py 生成文件并复制到 output_dir。"""
    if skip_names is None:
        skip_names = {'run.py', 'solution.py', 'test.py'}
    os.makedirs(output_dir, exist_ok=True)
    saved_files = []
    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for fname in files:
            if fname in skip_names:
                continue
            src = os.path.join(root, fname)
            ext = os.path.splitext(fname)[1].lower()
            if ext in FILE_EXTENSIONS or not ext:
                base, e = os.path.splitext(fname)
                ts = time.strftime('%Y%m%d_%H%M%S')
                dst = os.path.join(output_dir, f"{base}_{ts}{e}")
                shutil.copy2(src, dst)
                saved_files.append(dst)
    return saved_files


def run_and_collect_files(code: str, output_dir: str, filename_hint: str = 'output') -> dict:
    """执行 Python 代码并将生成的文件复制到 output_dir。

    优先尝试 Docker 沙箱执行，Docker 不可用时回退到本地子进程
    （带资源限制和目录隔离）。
    """
    os.makedirs(output_dir, exist_ok=True)
    tmpdir = tempfile.mkdtemp()

    try:
        code_path = os.path.join(tmpdir, 'run.py')
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)

        if _docker_available():
            # Docker 执行
            cmd = [
                'docker', 'run', '--rm',
                '--memory', SANDBOX_MEMORY,
                '--cpus', SANDBOX_CPUS,
                '--network', 'none',
                '--security-opt', 'no-new-privileges',
                '--cap-drop', 'ALL',
                '-v', f'{tmpdir}:/code',
                '-w', '/code',
                DOCKER_IMAGE,
                'timeout', str(SANDBOX_TIMEOUT),
                'python', '/code/run.py',
            ]

            start = time.time()
            result = subprocess.run(cmd, capture_output=True, text=True,
                                    timeout=SANDBOX_TIMEOUT + 10)
            elapsed = time.time() - start
        else:
            # 本地回退，带资源限制和目录隔离
            preexec_fn = _get_sandbox_preexec_fn(tmpdir)

            start = time.time()
            result = subprocess.run(
                ['python', code_path],
                capture_output=True, text=True, timeout=SANDBOX_TIMEOUT,
                cwd=tmpdir,
                preexec_fn=preexec_fn,
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
                    base, e = os.path.splitext(fname)
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


def _get_sandbox_preexec_fn(tmpdir: str):
    """返回跨平台的沙箱 preexec_fn。

    Unix/Linux: 使用 resource 模块设置进程资源限制 (内存/CPU/文件大小/NPROC)。
    Windows: resource 模块不可用，返回 None (通过 cwd + timeout 提供基本隔离)。
    """
    if sys.platform == 'win32':
        return None
    try:
        import resource

        def preexec_fn():
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (SANDBOX_TIMEOUT, SANDBOX_TIMEOUT))
            resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 10 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
            os.chdir(tmpdir)

        return preexec_fn
    except ImportError:
        return None


def _run_local_subprocess(code: str, test_script: str = None, output_dir: str = None) -> dict:
    """本地子进程执行（Docker 不可用时的回退），带资源限制和目录隔离。"""
    tmpdir = tempfile.mkdtemp()
    try:
        code_path = os.path.join(tmpdir, 'solution.py')
        with open(code_path, 'w', encoding='utf-8') as f:
            f.write(code)

        if test_script:
            test_path = os.path.join(tmpdir, 'test.py')
            # Use forward slashes in generated code to avoid Windows backslash escape issues
            _tmpdir = tmpdir.replace('\\', '/')
            _code_path = code_path.replace('\\', '/')
            with open(test_path, 'w', encoding='utf-8') as f:
                f.write(
                    f"import sys; sys.path.insert(0, '{_tmpdir}'); "
                    f"exec(open('{_code_path}').read()); {test_script}\n"
                    f"print('ALL_TESTS_PASSED')"
                )
            exec_path = test_path
        else:
            test_path = None
            exec_path = code_path

        preexec_fn = _get_sandbox_preexec_fn(tmpdir)

        start = time.time()
        result = subprocess.run(
            ['python', exec_path],
            capture_output=True, text=True, timeout=SANDBOX_TIMEOUT,
            cwd=tmpdir,
            preexec_fn=preexec_fn,
        )
        elapsed = time.time() - start

        success = result.returncode == 0
        if test_script:
            success = success and 'ALL_TESTS_PASSED' in result.stdout

        # 收集生成的文件
        files = []
        if output_dir and success:
            files = _collect_generated_files(tmpdir, output_dir, skip_names={'solution.py', 'test.py'})

        return {
            'success': success,
            'exit_code': result.returncode,
            'stdout': result.stdout[:5000],
            'stderr': result.stderr[:5000],
            'duration_s': round(elapsed, 2),
            'note': 'Executed locally (Docker not available)' + (' [tests ran]' if test_script else ''),
            'files': files,
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Execution timeout', 'files': []}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
