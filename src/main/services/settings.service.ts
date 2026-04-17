import { safeStorage, app } from 'electron';
import { readFile, writeFile, mkdir, rename, access } from 'fs/promises';
import { dirname, join } from 'path';
import { getSettingsPath } from '../util/paths';

export interface AppSettings {
  git: {
    repoUrl: string;
    authorName: string;
    authorEmail: string;
  };
  ui: {
    theme: 'light' | 'dark' | 'system';
    language: 'de' | 'en';
    sidebarCollapsed: boolean;
  };
  ai: {
    model: string;
  };
  system: {
    preventSleep: boolean;
    dataDirectory: string;
  };
  schedule: {
    enabled: boolean;
    intervalMinutes: number;
  };
  activeProjectName: string | null;
}

interface PersistedSettings extends AppSettings {
  _encryptedApiKey?: string;
  _encryptedGitToken?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  git: {
    repoUrl: '',
    authorName: '',
    authorEmail: '',
  },
  ui: {
    theme: 'system',
    language: 'de',
    sidebarCollapsed: false,
  },
  ai: {
    model: 'claude-sonnet-4-6',
  },
  system: {
    preventSleep: false,
    dataDirectory: '',
  },
  schedule: {
    enabled: false,
    intervalMinutes: 120,
  },
  activeProjectName: null,
};

let settings: PersistedSettings = { ...DEFAULT_SETTINGS };

// Prefix um verschluesselte von Klartext-Werten zu unterscheiden
const ENCRYPTED_PREFIX = 'enc:';
const PLAIN_PREFIX = 'plain:';

function encryptString(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return PLAIN_PREFIX + value;
  }
  try {
    const encrypted = safeStorage.encryptString(value).toString('base64');
    // Verifikation: Roundtrip pruefen
    const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    if (decrypted !== value) {
      console.warn('[SettingsService] safeStorage Roundtrip fehlgeschlagen, speichere im Klartext');
      return PLAIN_PREFIX + value;
    }
    return ENCRYPTED_PREFIX + encrypted;
  } catch (err) {
    console.warn('[SettingsService] safeStorage encrypt fehlgeschlagen, speichere im Klartext:', err);
    return PLAIN_PREFIX + value;
  }
}

function decryptString(encoded: string): string {
  // Klartext-Wert
  if (encoded.startsWith(PLAIN_PREFIX)) {
    return encoded.slice(PLAIN_PREFIX.length);
  }
  // Verschluesselter Wert
  if (encoded.startsWith(ENCRYPTED_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(encoded.slice(ENCRYPTED_PREFIX.length), 'base64'));
    } catch (err) {
      console.error('[SettingsService] safeStorage decrypt fehlgeschlagen:', err);
      return '';
    }
  }
  // Legacy-Format (kein Prefix) — versuche als verschluesselt
  if (!safeStorage.isEncryptionAvailable()) return encoded;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    // Koennte Klartext sein, versuche direkt
    return encoded;
  }
}

async function save(): Promise<void> {
  const settingsPath = getSettingsPath();
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export const SettingsService = {
  async init(): Promise<void> {
    // Migration: alten 2brain-desktop userData-Ordner übernehmen
    await this._migrateFromOldName();

    const settingsPath = getSettingsPath();
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }

    // Secrets pruefen — Legacy-Werte (ohne Prefix) migrieren
    let needsSave = false;
    if (settings._encryptedApiKey) {
      const val = decryptString(settings._encryptedApiKey);
      if (!val) {
        // Nicht entschluesselbar — User muss Key neu eingeben
        console.warn('[SettingsService] API-Key nicht entschluesselbar, wird entfernt');
        settings._encryptedApiKey = undefined;
        needsSave = true;
      } else if (!settings._encryptedApiKey.startsWith(ENCRYPTED_PREFIX) &&
                 !settings._encryptedApiKey.startsWith(PLAIN_PREFIX)) {
        // Legacy-Format — neu speichern mit Prefix
        settings._encryptedApiKey = encryptString(val);
        needsSave = true;
      }
    }
    if (settings._encryptedGitToken) {
      const val = decryptString(settings._encryptedGitToken);
      if (!val) {
        console.warn('[SettingsService] Git-Token nicht entschluesselbar, wird entfernt');
        settings._encryptedGitToken = undefined;
        needsSave = true;
      } else if (!settings._encryptedGitToken.startsWith(ENCRYPTED_PREFIX) &&
                 !settings._encryptedGitToken.startsWith(PLAIN_PREFIX)) {
        settings._encryptedGitToken = encryptString(val);
        needsSave = true;
      }
    }
    if (needsSave) {
      await save();
    }
  },

  async _migrateFromOldName(): Promise<void> {
    const currentUserData = app.getPath('userData');
    const parentDir = dirname(currentUserData);
    const oldDir = join(parentDir, '2brain-desktop');

    // Nur migrieren wenn alter Ordner existiert und neuer noch nicht
    try {
      await access(oldDir);
    } catch {
      return; // Alter Ordner existiert nicht → nichts zu tun
    }

    try {
      await access(currentUserData);
      // Neuer Ordner existiert bereits → alte Settings-Datei kopieren falls nötig
      const newSettings = join(currentUserData, 'settings.json');
      try {
        await access(newSettings);
      } catch {
        // Neue Settings fehlen → aus altem Ordner kopieren
        const oldSettings = join(oldDir, 'settings.json');
        try {
          const data = await readFile(oldSettings, 'utf-8');
          await writeFile(newSettings, data, 'utf-8');
        } catch { /* Alte Settings auch nicht vorhanden */ }
      }

      // Repos-Ordner verlinken/kopieren falls nötig
      const newRepos = join(currentUserData, 'repos');
      try {
        await access(newRepos);
      } catch {
        const oldRepos = join(oldDir, 'repos');
        try {
          await access(oldRepos);
          await rename(oldRepos, newRepos);
        } catch { /* Keine alten Repos */ }
      }
    } catch {
      // Neuer Ordner existiert noch nicht → alten komplett umbenennen
      try {
        await rename(oldDir, currentUserData);
      } catch { /* Rename fehlgeschlagen, ignorieren */ }
    }
  },

  get(): AppSettings {
    const { _encryptedApiKey, _encryptedGitToken, ...publicSettings } = settings;
    return publicSettings;
  },

  async set(patch: Partial<AppSettings>): Promise<void> {
    if (patch.git) settings.git = { ...settings.git, ...patch.git };
    if (patch.ui) settings.ui = { ...settings.ui, ...patch.ui };
    if (patch.ai) settings.ai = { ...settings.ai, ...patch.ai };
    if (patch.system) settings.system = { ...settings.system, ...patch.system };
    if (patch.schedule) settings.schedule = { ...settings.schedule, ...patch.schedule };
    if (patch.activeProjectName !== undefined) settings.activeProjectName = patch.activeProjectName;
    await save();
  },

  getModel(): string {
    return settings.ai?.model || 'claude-sonnet-4-6';
  },

  hasApiKey(): boolean {
    if (!settings._encryptedApiKey) return false;
    return !!decryptString(settings._encryptedApiKey);
  },

  getApiKey(): string {
    if (!settings._encryptedApiKey) return '';
    return decryptString(settings._encryptedApiKey);
  },

  async setApiKey(key: string): Promise<void> {
    settings._encryptedApiKey = encryptString(key);
    await save();
  },

  hasGitToken(): boolean {
    if (!settings._encryptedGitToken) return false;
    return !!decryptString(settings._encryptedGitToken);
  },

  getGitToken(): string {
    if (!settings._encryptedGitToken) return '';
    return decryptString(settings._encryptedGitToken);
  },

  async setGitToken(token: string): Promise<void> {
    settings._encryptedGitToken = encryptString(token);
    await save();
  },

  getRepoUrl(): string {
    return settings.git.repoUrl;
  },
};
