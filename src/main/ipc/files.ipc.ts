import { ipcMain, BrowserWindow, app } from 'electron';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { randomBytes } from 'crypto';
import { ProjectService } from '../services/project.service';
import { ConvertService, type ConvertResult } from '../services/convert.service';
import type { UploadResult } from '../../shared/api.types';

/** Erzeugt einen eindeutigen Dateinamen falls der gewünschte Name schon existiert. */
function uniqueName(desired: string, existing: Set<string>): string {
  if (!existing.has(desired)) return desired;
  const ext = extname(desired);
  const base = desired.slice(0, desired.length - ext.length);
  const suffix = randomBytes(3).toString('hex'); // 6 Hex-Zeichen
  return `${base}-${suffix}${ext}`;
}

/** Temporärer Ordner für Konvertierung (wird nach Erfolg gelöscht) */
function getTmpDir(): string {
  return join(app.getPath('temp'), 'zettelkasten-convert');
}

function sendProgress(data: {
  filename: string;
  step: 'reading' | 'converting' | 'saving' | 'done' | 'error' | 'committing';
  message: string;
  fileIndex: number;
  totalFiles: number;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('files:upload-progress', data);
  }
}

export function registerFilesHandlers(): void {
  ipcMain.handle(
    'files:upload',
    async (
      _event,
      projectName: string,
      files: Array<{ name: string; data: ArrayBuffer }>,
    ) => {
      const vault = ProjectService.getVault(projectName);
      const tmpDir = getTmpDir();
      await mkdir(tmpDir, { recursive: true });

      // Bestehende Dateinamen laden für Duplikat-Erkennung
      const existingFiles = new Set(await vault.listRawFiles());

      const results: UploadResult[] = [];
      const totalFiles = files.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = extname(file.name).toLowerCase();
        const baseName = file.name.replace(/\.[^.]+$/, '');

        sendProgress({
          filename: file.name,
          step: 'reading',
          message: `Lese ${file.name}...`,
          fileIndex: i,
          totalFiles,
        });

        const buffer = Buffer.from(file.data);
        const result: UploadResult = { filename: file.name, converted: false };

        const isAlreadyMarkdown = ['.md', '.markdown'].includes(ext);
        const isPlainText = ext === '.txt';
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        const needsConversion = ['.pdf', '.docx', '.html', '.htm', '.csv', '.json', '.log'].includes(ext);

        if (isAlreadyMarkdown) {
          const safeName = uniqueName(file.name, existingFiles);
          existingFiles.add(safeName);

          sendProgress({
            filename: file.name,
            step: 'saving',
            message: `Speichere ${safeName}...`,
            fileIndex: i,
            totalFiles,
          });

          await vault.writeFile(`raw/${safeName}`, buffer.toString('utf-8'));
          result.filename = safeName;
          result.converted = false;
        } else if (isPlainText) {
          sendProgress({
            filename: file.name,
            step: 'converting',
            message: `Konvertiere ${file.name} zu Markdown...`,
            fileIndex: i,
            totalFiles,
          });

          const mdName = uniqueName(`${baseName}.md`, existingFiles);
          existingFiles.add(mdName);
          await vault.writeFile(`raw/${mdName}`, buffer.toString('utf-8'));
          result.converted = true;
          result.convertedName = mdName;
        } else if (isImage) {
          sendProgress({
            filename: file.name,
            step: 'saving',
            message: `Speichere Bild ${file.name}...`,
            fileIndex: i,
            totalFiles,
          });

          // Bilder als Binärdatei speichern (nicht konvertieren)
          const safeName = uniqueName(file.name, existingFiles);
          existingFiles.add(safeName);
          await vault.writeBinary(`raw/${safeName}`, buffer);
          result.filename = safeName;
          result.converted = false;
        } else if (needsConversion) {
          sendProgress({
            filename: file.name,
            step: 'converting',
            message: `Konvertiere ${file.name} zu Markdown...`,
            fileIndex: i,
            totalFiles,
          });

          // Temporär auf Disk schreiben für ConvertService
          const tmpPath = join(tmpDir, file.name);
          await mkdir(dirname(tmpPath), { recursive: true });
          await writeFile(tmpPath, buffer);

          let conversion: ConvertResult;
          try {
            conversion = await ConvertService.toMarkdown(tmpPath);
          } catch (err) {
            result.error = `Konvertierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`;
            sendProgress({ filename: file.name, step: 'error', message: result.error, fileIndex: i, totalFiles });
            // Temp-Datei aufräumen
            await rm(tmpPath, { force: true }).catch(() => {});
            results.push(result);
            continue;
          }

          // Temp-Datei sofort löschen — wird nicht mehr gebraucht
          await rm(tmpPath, { force: true }).catch(() => {});

          if (!conversion.converted || !conversion.markdown) {
            result.error = conversion.error || 'Konvertierung ergab keinen Inhalt';
            sendProgress({ filename: file.name, step: 'error', message: result.error, fileIndex: i, totalFiles });
            results.push(result);
            continue;
          }

          sendProgress({
            filename: file.name,
            step: 'saving',
            message: `Speichere konvertierte Version...`,
            fileIndex: i,
            totalFiles,
          });

          const mdName = uniqueName(`${baseName}.md`, existingFiles);
          existingFiles.add(mdName);
          await vault.writeFile(`raw/${mdName}`, conversion.markdown);
          result.converted = true;
          result.convertedName = mdName;
        } else {
          result.error = `Format "${ext}" wird nicht unterstützt`;
          sendProgress({ filename: file.name, step: 'error', message: result.error, fileIndex: i, totalFiles });
          results.push(result);
          continue;
        }

        sendProgress({
          filename: file.name,
          step: 'done',
          message: result.converted
            ? `${file.name} → ${result.convertedName}`
            : `${file.name} gespeichert`,
          fileIndex: i,
          totalFiles,
        });

        results.push(result);
      }

      // Temp-Ordner aufräumen
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});

      // Git Commit (nur .md Dateien im Vault)
      const successful = results.filter((r) => !r.error);
      if (successful.length > 0) {
        sendProgress({
          filename: '',
          step: 'committing',
          message: 'Git-Commit wird erstellt...',
          fileIndex: totalFiles - 1,
          totalFiles,
        });

        const names = successful.map((r) => r.convertedName || r.filename);
        await ProjectService.commitIfNeeded(projectName, `Upload: ${names.join(', ')}`);
      }

      return results;
    },
  );

  ipcMain.handle('files:list-raw', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    return vault.listRawFiles();
  });

  ipcMain.handle('files:list-raw-with-status', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    const [files, ingested] = await Promise.all([
      vault.listRawFiles(),
      vault.getIngestedSources(),
    ]);
    return files.map((name) => ({ name, ingested: ingested.has(name) }));
  });

  ipcMain.handle(
    'files:read-raw',
    async (_event, projectName: string, filename: string) => {
      const vault = ProjectService.getVault(projectName);
      return vault.readFile(`raw/${filename}`);
    },
  );

  ipcMain.handle(
    'files:read-raw-base64',
    async (_event, projectName: string, filename: string) => {
      const vault = ProjectService.getVault(projectName);
      const buffer = await vault.readBinary(`raw/${filename}`);
      return buffer.toString('base64');
    },
  );

  ipcMain.handle(
    'files:delete-raw',
    async (_event, projectName: string, filename: string) => {
      const vault = ProjectService.getVault(projectName);
      await vault.deleteFile(`raw/${filename}`);
      await ProjectService.commitIfNeeded(projectName, `Gelöscht: ${filename}`);
    },
  );
}
