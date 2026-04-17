import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import { registerAllIpcHandlers } from './ipc/registry';
import { SettingsService } from './services/settings.service';
import { SchedulerService } from './services/scheduler.service';
import { initTray, refreshTrayMenu, destroyTray } from './services/tray.service';
import { setDataDirectory } from './util/paths';

// EPIPE bei console.log/error verhindern (Electron hat keinen stdout in Prod-Builds)
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return;
    throw err;
  });
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

app.whenReady().then(async () => {
  await SettingsService.init();
  const dataDir = SettingsService.get().system?.dataDirectory;
  if (dataDir) setDataDirectory(dataDir);
  const savedTheme = SettingsService.get().ui?.theme || 'system';
  nativeTheme.themeSource = savedTheme;
  registerAllIpcHandlers();
  createWindow();
  initTray();
  SchedulerService.init(refreshTrayMenu);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  SchedulerService.stop();
  destroyTray();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
