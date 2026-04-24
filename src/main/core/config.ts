import { readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';

const OLD_CONFIG_FILE = '2brain.config.json';

export interface BrainConfig {
  name: string;
  domain: string;
  language: string;
  models: {
    ingest: string;
    query: string;
    lint: string;
  };
  ingest: {
    tags: string[];
    entityTypes: string[];
    conceptTypes: string[];
  };
  output: {
    format: string;
  };
  syncEnabled: boolean;
}

const DEFAULT_CONFIG: BrainConfig = {
  name: 'zettelkasten',
  domain: '',
  language: 'de',
  models: {
    ingest: 'claude-sonnet-4-6',
    query: 'claude-opus-4-6',
    lint: 'claude-sonnet-4-6',
  },
  ingest: {
    tags: [],
    entityTypes: ['person', 'organization', 'product', 'tool'],
    conceptTypes: ['technique', 'framework', 'theory', 'pattern'],
  },
  output: {
    format: 'markdown',
  },
  syncEnabled: true,
};

const CONFIG_FILE = 'zettelkasten.config.json';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneDefaultConfig(): BrainConfig {
  return {
    ...DEFAULT_CONFIG,
    models: { ...DEFAULT_CONFIG.models },
    ingest: {
      tags: [...DEFAULT_CONFIG.ingest.tags],
      entityTypes: [...DEFAULT_CONFIG.ingest.entityTypes],
      conceptTypes: [...DEFAULT_CONFIG.ingest.conceptTypes],
    },
    output: { ...DEFAULT_CONFIG.output },
  };
}

function parseAndMergeConfig(rawConfig: unknown, configPath: string): BrainConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(`Ungueltige Konfiguration in ${configPath}: Root muss ein JSON-Objekt sein.`);
  }

  const merged = cloneDefaultConfig();
  const errors: string[] = [];

  if ('name' in rawConfig) {
    if (typeof rawConfig.name === 'string' && rawConfig.name.trim()) {
      merged.name = rawConfig.name;
    } else {
      errors.push('name muss ein nicht-leerer String sein.');
    }
  }

  if ('domain' in rawConfig) {
    if (typeof rawConfig.domain === 'string') {
      merged.domain = rawConfig.domain;
    } else {
      errors.push('domain muss ein String sein.');
    }
  }

  if ('language' in rawConfig) {
    if (rawConfig.language === 'de' || rawConfig.language === 'en') {
      merged.language = rawConfig.language;
    } else {
      errors.push("language muss 'de' oder 'en' sein.");
    }
  }

  if ('models' in rawConfig) {
    if (!isRecord(rawConfig.models)) {
      errors.push('models muss ein Objekt sein.');
    } else {
      for (const key of ['ingest', 'query', 'lint'] as const) {
        const value = rawConfig.models[key];
        if (value !== undefined) {
          if (typeof value === 'string' && value.trim()) {
            merged.models[key] = value;
          } else {
            errors.push(`models.${key} muss ein nicht-leerer String sein.`);
          }
        }
      }
    }
  }

  if ('ingest' in rawConfig) {
    if (!isRecord(rawConfig.ingest)) {
      errors.push('ingest muss ein Objekt sein.');
    } else {
      for (const key of ['tags', 'entityTypes', 'conceptTypes'] as const) {
        if (key in rawConfig.ingest) {
          const val = rawConfig.ingest[key];
          if (Array.isArray(val) && val.every((e) => typeof e === 'string')) {
            merged.ingest[key] = val;
          } else {
            errors.push(`ingest.${key} muss ein String-Array sein.`);
          }
        }
      }
    }
  }

  if ('syncEnabled' in rawConfig) {
    if (typeof rawConfig.syncEnabled === 'boolean') {
      merged.syncEnabled = rawConfig.syncEnabled;
    }
  }

  if (errors.length > 0) {
    throw new Error(`Ungueltige Konfiguration in ${configPath}:\n- ${errors.join('\n- ')}`);
  }

  return merged;
}

export async function loadConfig(vaultPath: string): Promise<BrainConfig> {
  const configPath = join(vaultPath, CONFIG_FILE);
  const oldConfigPath = join(vaultPath, OLD_CONFIG_FILE);
  let raw: string;

  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      // Fallback: alte 2brain.config.json suchen und umbenennen
      try {
        raw = await readFile(oldConfigPath, 'utf-8');
        await rename(oldConfigPath, configPath).catch(() => undefined);
      } catch {
        throw new Error(`Keine zettelkasten.config.json gefunden in ${vaultPath}.`);
      }
    } else {
      throw new Error(`Fehler beim Lesen von ${configPath}: ${error.message || String(error)}`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const error = err as Error;
    throw new Error(`Ungueltiges JSON in ${configPath}: ${error.message || String(error)}`);
  }

  return parseAndMergeConfig(parsed, configPath);
}

export async function saveConfig(vaultPath: string, config: BrainConfig): Promise<void> {
  const configPath = join(vaultPath, CONFIG_FILE);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function createDefaultConfig(
  name: string,
  domain: string,
  language: string,
  tags: string[]
): BrainConfig {
  return {
    ...DEFAULT_CONFIG,
    name,
    domain,
    language,
    ingest: {
      ...DEFAULT_CONFIG.ingest,
      tags,
    },
  };
}
