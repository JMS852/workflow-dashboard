const { spawn, execSync } = require('child_process');
const path = require('path');

// Kill previous instances
try {
  execSync('cmd /c "taskkill /F /IM electron.exe 2>nul & exit 0"', { timeout: 3000 });
} catch {}

// Step 1: Compile Electron TypeScript
console.log('[Launcher] Compiling Electron TypeScript...');
try {
  execSync('npx tsc -p tsconfig.electron.json', {
    cwd: __dirname,
    shell: true,
    stdio: 'inherit',
    timeout: 30000,
  });
  console.log('[Launcher] Electron TS compiled successfully.');
} catch (e) {
  console.error('[Launcher] Electron TS compilation failed!');
  process.exit(1);
}

// Step 2: Build Vite frontend
console.log('[Launcher] Building Vite frontend...');
try {
  execSync('npx vite build', {
    cwd: __dirname,
    shell: true,
    stdio: 'inherit',
    timeout: 30000,
  });
} catch (e) {
  console.error('[Launcher] Vite build failed!');
  process.exit(1);
}

// Step 3: Launch Electron
console.log('[Launcher] Starting Electron...');
const electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
const electron = spawn(electronExe, ['.'], {
  cwd: __dirname,
  stdio: 'inherit',
  detached: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
electron.unref();

console.log('[Launcher] Done! Workflow Dashboard is running.');
console.log('[Launcher] You can close this terminal.');
