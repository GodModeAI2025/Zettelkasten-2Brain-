import { ipcMain, nativeTheme, powerSaveBlocker, dialog, BrowserWindow, type OpenDialogOptions } from 'electron';
import { SettingsService, type AppSettings } from '../services/settings.service';
import { SchedulerService } from '../services/scheduler.service';
import { resetClient } from '../core/claude';
import { setDataDirectory, getDataDirectory } from '../util/paths';

let sleepBlockerId: number | null = null;

function updateSleepPrevention(prevent: boolean): void {
  if (prevent && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!prevent && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return SettingsService.get();
  });

  ipcMain.handle('settings:set', async (_event, patch: Partial<AppSettings>) => {
    await SettingsService.set(patch);
    if (patch.ui?.theme) {
      nativeTheme.themeSource = patch.ui.theme;
    }
    if (patch.system?.preventSleep !== undefined) {
      updateSleepPrevention(patch.system.preventSleep);
    }
    if (patch.system?.dataDirectory !== undefined) {
      setDataDirectory(patch.system.dataDirectory);
    }
    if (patch.schedule) {
      SchedulerService.reload();
    }
  });

  ipcMain.handle('schedule:get-status', () => SchedulerService.getStatus());
  ipcMain.handle('schedule:run-now', async () => {
    await SchedulerService.runNow();
  });

  // Beim Start: gespeicherte Sleep-Prevention wiederherstellen
  const settings = SettingsService.get();
  if (settings.system?.preventSleep) {
    updateSleepPrevention(true);
  }

  ipcMain.handle('settings:has-api-key', () => {
    return SettingsService.hasApiKey();
  });

  ipcMain.handle('settings:has-git-token', () => {
    return SettingsService.hasGitToken();
  });

  ipcMain.handle('settings:set-api-key', async (_event, key: string) => {
    await SettingsService.setApiKey(key.trim());
    resetClient();
  });

  ipcMain.handle('settings:set-git-token', async (_event, token: string) => {
    await SettingsService.setGitToken(token);
  });

  ipcMain.handle('settings:select-directory', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: 'Arbeitsverzeichnis waehlen',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getDataDirectory(),
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('settings:validate-api-key', async (_event, key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return { valid: false, error: 'Key ist leer' };
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: trimmed });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { valid: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[settings:validate-api-key]', msg);
      return { valid: false, error: msg };
    }
  });
}
