import { registerSettingsHandlers } from './settings.ipc';
import { registerGitHandlers } from './git.ipc';
import { registerProjectHandlers } from './project.ipc';
import { registerFilesHandlers } from './files.ipc';
import { registerWikiHandlers } from './wiki.ipc';
import { registerIngestHandlers } from './ingest.ipc';
import { registerQueryHandlers } from './query.ipc';
import { registerLintHandlers } from './lint.ipc';
import { registerForgetHandlers } from './forget.ipc';
import { registerOutputHandlers } from './output.ipc';
import { registerTakeawayHandlers } from './takeaway.ipc';
import { registerBrandHandlers } from './brand.ipc';

export function registerAllIpcHandlers(): void {
  registerSettingsHandlers();
  registerGitHandlers();
  registerProjectHandlers();
  registerFilesHandlers();
  registerWikiHandlers();
  registerIngestHandlers();
  registerQueryHandlers();
  registerLintHandlers();
  registerForgetHandlers();
  registerOutputHandlers();
  registerTakeawayHandlers();
  registerBrandHandlers();
}
