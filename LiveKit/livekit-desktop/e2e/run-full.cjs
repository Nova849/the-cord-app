const path = require('path');
const { spawn } = require('child_process');
const electronPath = require('electron');

const appDir = path.resolve(__dirname, '..');
const args = [appDir, '--e2e-full'];

const env = { ...process.env, E2E_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env
});

child.on('exit', (code) => {
  process.exit(code == null ? 1 : code);
});
