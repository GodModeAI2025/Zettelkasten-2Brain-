import { BrowserWindow } from 'electron';
import { SettingsService } from './settings.service';
import { ProjectService } from './project.service';
import { GitService } from './git.service';
import { runIngest } from '../ipc/ingest.ipc';

type TrayRefresh = () => void;

interface SchedulerState {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  trayRefresh: TrayRefresh | null;
}

const state: SchedulerState = {
  timer: null,
  running: false,
  lastRunAt: null,
  lastRunSummary: null,
  trayRefresh: null,
};

function notifyStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('schedule:status', {
      running: state.running,
      lastRunAt: state.lastRunAt,
      lastRunSummary: state.lastRunSummary,
    });
  }
  state.trayRefresh?.();
}

async function runCycle(reason: 'timer' | 'manual'): Promise<void> {
  if (state.running) return;
  state.running = true;
  notifyStatus();

  let totalIngested = 0;
  let projectsTouched = 0;
  const errors: string[] = [];

  try {
    if (!GitService.getRepoDir()) {
      state.lastRunSummary = 'Kein Repository geklont — nichts zu tun.';
      return;
    }

    const projects = await ProjectService.list();
    for (const project of projects) {
      try {
        const vault = ProjectService.getVault(project.name);
        const rawFiles = await vault.listRawFiles();
        const ingested = await vault.getIngestedSources();
        const newFiles = rawFiles.filter((f) => !ingested.has(f));
        if (newFiles.length === 0) continue;

        projectsTouched++;
        await runIngest(project.name, newFiles);
        totalIngested += newFiles.length;
      } catch (err) {
        errors.push(`${project.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const parts: string[] = [];
    if (totalIngested > 0) parts.push(`${totalIngested} Datei(en) in ${projectsTouched} Projekt(en)`);
    else parts.push('keine neuen Dateien');
    if (errors.length > 0) parts.push(`${errors.length} Fehler`);
    state.lastRunSummary = `${reason === 'timer' ? 'Auto' : 'Manuell'}: ${parts.join(', ')}`;
  } catch (err) {
    state.lastRunSummary = `Fehler: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    state.lastRunAt = new Date().toISOString();
    state.running = false;
    notifyStatus();
  }
}

export const SchedulerService = {
  init(trayRefresh?: TrayRefresh): void {
    state.trayRefresh = trayRefresh ?? null;
    this.reload();
  },

  reload(): void {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    const { enabled, intervalMinutes } = SettingsService.get().schedule;
    if (!enabled) {
      notifyStatus();
      return;
    }
    const minutes = Math.max(5, intervalMinutes);
    state.timer = setInterval(() => {
      void runCycle('timer');
    }, minutes * 60 * 1000);
    notifyStatus();
  },

  async runNow(): Promise<void> {
    await runCycle('manual');
  },

  getStatus() {
    const { enabled, intervalMinutes } = SettingsService.get().schedule;
    return {
      enabled,
      intervalMinutes,
      running: state.running,
      lastRunAt: state.lastRunAt,
      lastRunSummary: state.lastRunSummary,
    };
  },

  stop(): void {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  },
};
