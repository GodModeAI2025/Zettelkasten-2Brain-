import { ipcMain } from 'electron';
import { GitService } from '../services/git.service';
import { SettingsService } from '../services/settings.service';
import { toIpcError } from '../util/errors';

export function registerGitHandlers(): void {
  ipcMain.handle('git:clone', async (_event, url: string, token: string) => {
    try {
      const result = await GitService.clone(url, token);
      if (result.success) {
        await SettingsService.set({ git: { repoUrl: url, authorName: '', authorEmail: '' } });
        await SettingsService.setGitToken(token);
      }
      return result;
    } catch (err) {
      return { success: false, error: toIpcError(err, 'GIT_AUTH_FAILED').message };
    }
  });

  ipcMain.handle('git:pull', async () => {
    return GitService.pull();
  });

  ipcMain.handle('git:push', async () => {
    return GitService.push();
  });

  ipcMain.handle('git:sync', async () => {
    return GitService.sync();
  });

  ipcMain.handle('git:force-push', async () => {
    return GitService.forcePush();
  });

  ipcMain.handle('git:force-pull', async () => {
    return GitService.forcePull();
  });

  /**
   * Liefert untracked Dateien, die durch einen Force-Pull verloren gingen.
   * Fokus auf raw/ und wiki/ — dort liegen die nutzergepflegten Inhalte.
   */
  ipcMain.handle('git:at-risk-files', async () => {
    if (!GitService.isCloned()) return { files: [] };
    const untracked = await GitService.listUntrackedFiles(/^[^/]+\/(raw|wiki)\//);
    const files = untracked.map((fp) => {
      const [project, ...rest] = fp.split('/');
      return { project, path: rest.join('/'), full: fp };
    });
    return { files };
  });

  ipcMain.handle('git:status', async () => {
    if (!GitService.isCloned()) {
      throw new Error('GIT_NOT_CLONED');
    }
    return GitService.status();
  });
}
