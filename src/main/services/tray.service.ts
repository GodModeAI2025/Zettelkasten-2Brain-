import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { SettingsService } from './settings.service';
import { SchedulerService } from './scheduler.service';

let tray: Tray | null = null;

function showWindow(): void {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    wins[0].show();
    wins[0].focus();
  }
}

function formatLastRun(iso: string | null): string {
  if (!iso) return 'noch nie';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('de', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function refreshTrayMenu(): void {
  if (!tray) return;
  const status = SchedulerService.getStatus();

  const intervals = [30, 60, 120, 240, 720];

  const menu = Menu.buildFromTemplate([
    { label: '2brain', enabled: false },
    { type: 'separator' },
    {
      label: status.running
        ? 'Ingest laeuft...'
        : `Letzter Lauf: ${formatLastRun(status.lastRunAt)}`,
      enabled: false,
    },
    ...(status.lastRunSummary
      ? [{ label: status.lastRunSummary, enabled: false } as Electron.MenuItemConstructorOptions]
      : []),
    { type: 'separator' },
    {
      label: 'Jetzt ingesten',
      enabled: !status.running,
      click: () => { void SchedulerService.runNow(); },
    },
    {
      label: 'Auto-Ingest aktiv',
      type: 'checkbox',
      checked: status.enabled,
      click: async () => {
        await SettingsService.set({ schedule: { enabled: !status.enabled, intervalMinutes: status.intervalMinutes } });
        SchedulerService.reload();
      },
    },
    {
      label: 'Intervall',
      submenu: intervals.map((mins) => ({
        label: mins >= 60 ? `${mins / 60} h` : `${mins} min`,
        type: 'radio' as const,
        checked: status.intervalMinutes === mins,
        click: async () => {
          await SettingsService.set({ schedule: { enabled: status.enabled, intervalMinutes: mins } });
          SchedulerService.reload();
        },
      })),
    },
    { type: 'separator' },
    { label: 'Fenster oeffnen', click: showWindow },
    { label: 'Beenden', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(
    status.enabled
      ? `2brain — Auto-Ingest alle ${status.intervalMinutes} min`
      : '2brain — Auto-Ingest aus',
  );
  tray.setTitle(status.running ? '⟳' : status.enabled ? '●' : '○');
}

export function initTray(): void {
  if (tray) return;
  // Leeres Template-Bild — auf macOS ersetzt setTitle den Platz komplett.
  const emptyIcon = nativeImage.createEmpty();
  tray = new Tray(emptyIcon);
  tray.on('click', () => {
    if (process.platform !== 'darwin') showWindow();
  });
  refreshTrayMenu();
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
