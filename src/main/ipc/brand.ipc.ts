import { ipcMain } from 'electron';
import { BrandService, BRAND_DOC_NAMES, type BrandDocName } from '../services/brand.service';
import { ProjectService } from '../services/project.service';
import { BRAND_DEFAULTS } from '../core/brand-defaults';

function assertName(name: string): asserts name is BrandDocName {
  if (!BRAND_DOC_NAMES.includes(name as BrandDocName)) {
    throw new Error(`Unbekanntes Brand-Dokument: ${name}`);
  }
}

export function registerBrandHandlers(): void {
  ipcMain.handle('brand:list', async (_event, projectName: string) => {
    return BrandService.list(projectName);
  });

  ipcMain.handle('brand:read', async (_event, projectName: string, name: string) => {
    assertName(name);
    return BrandService.read(projectName, name);
  });

  ipcMain.handle('brand:write', async (_event, projectName: string, name: string, content: string) => {
    assertName(name);
    await BrandService.write(projectName, name, content);
    await ProjectService.commitIfNeeded(projectName, `Brand aktualisiert: ${name}`);
  });

  ipcMain.handle('brand:reset', async (_event, projectName: string, name: string) => {
    assertName(name);
    await BrandService.write(projectName, name, BRAND_DEFAULTS[name]);
    await ProjectService.commitIfNeeded(projectName, `Brand zurueckgesetzt: ${name}`);
  });
}
