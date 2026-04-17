import { app } from 'electron';
import { join } from 'path';

/** Ueberschreibbares Arbeitsverzeichnis — wird beim App-Start aus den Settings gesetzt. */
let customDataDir = '';

export function setDataDirectory(dir: string): void {
  customDataDir = dir;
}

export function getDataDirectory(): string {
  return customDataDir || join(app.getPath('userData'), 'repos');
}

export function getReposDir(): string {
  return getDataDirectory();
}

export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function getLogsDir(): string {
  return app.getPath('logs');
}
