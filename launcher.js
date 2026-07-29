const { spawn, execSync } = require('child_process');
const path = require('path');

// Kill previous instances
try {
  execSync('cmd /c "taskkill /F /IM electron.exe 2>nul & exit 0"', { timeout: 3000 });
} catch {}

// Step 0: Copy xterm vendor files to public/vendor
try {
  const vendorDir = path.join(__dirname, 'public', 'vendor');
  if (!require('fs').existsSync(vendorDir)) {
    require('fs').mkdirSync(vendorDir, { recursive: true });
  }
  require('fs').copyFileSync(
    path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'),
    path.join(vendorDir, 'xterm.js'),
  );
  require('fs').copyFileSync(
    path.join(__dirname, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js'),
    path.join(vendorDir, 'addon-fit.js'),
  );
  require('fs').copyFileSync(
    path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
    path.join(vendorDir, 'xterm.css'),
  );
  console.log('[Launcher] Vendor files copied.');
} catch (e) {
  console.error('[Launcher] Failed to copy vendor files:', e.message);
  process.exit(1);
}

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
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(electronExe, ['.'], {
  cwd: __dirname,
  stdio: 'inherit',
  detached: true,
  env: env,
});
electron.unref();

console.log('[Launcher] Done! Workflow Dashboard is running.');
console.log('[Launcher] You can close this terminal.');
