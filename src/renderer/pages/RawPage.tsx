import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { DropZone } from '../components/raw/DropZone';
import { FileCard } from '../components/raw/FileCard';
import { formatFileSize } from '../utils/format';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { useWikiStore } from '../stores/wiki.store';
import type { RawFileInfo } from '../../shared/api.types';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function isImageFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

interface FileProgress {
  name: string;
  size: number;
  step: 'pending' | 'reading' | 'converting' | 'saving' | 'done' | 'error' | 'committing';
  message: string;
}

const STEP_LABELS: Record<string, string> = {
  pending: 'Wartend',
  reading: 'Lesen',
  converting: 'Konvertieren',
  saving: 'Speichern',
  done: 'Fertig',
  error: 'Fehler',
  committing: 'Git-Commit',
};

const STEP_ICONS: Record<string, string> = {
  pending: '\u23F3',
  reading: '\uD83D\uDCC2',
  converting: '\u2699\uFE0F',
  saving: '\uD83D\uDCBE',
  done: '\u2705',
  error: '\u274C',
  committing: '\uD83D\uDD04',
};

export function RawPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeStatus = useProjectStore((s) => s.activeStatus);
  const addNotification = useAppStore((s) => s.addNotification);
  const [files, setFiles] = useState<RawFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
  const [overallPhase, setOverallPhase] = useState<string>('');
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [forgettingFile, setForgettingFile] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [confirmAction, setConfirmAction] = useState<{
    filename: string;
    affectedPages: number;
  } | null>(null);
  const refreshStatus = useProjectStore((s) => s.refreshStatus);
  const refreshWikiPages = useWikiStore((s) => s.refreshPages);
  const progressRef = useRef<FileProgress[]>([]);

  const loadFiles = useCallback(async () => {
    if (!activeProject) return;
    try {
      const list = await api.files.listRawWithStatus(activeProject);
      setFiles(list);
    } catch {
      addNotification('error', 'Dateiliste konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeProject, addNotification]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Progress-Events vom Main-Prozess empfangen
  useEffect(() => {
    const unsub = api.on('files:upload-progress', (...args: unknown[]) => {
      const data = args[0] as {
        filename: string;
        step: string;
        message: string;
        fileIndex: number;
        totalFiles: number;
      };

      if (data.step === 'committing') {
        setOverallPhase('Git-Commit...');
        return;
      }

      const updated = [...progressRef.current];
      if (updated[data.fileIndex]) {
        updated[data.fileIndex] = {
          ...updated[data.fileIndex],
          step: data.step as FileProgress['step'],
          message: data.message,
        };
        progressRef.current = updated;
        setFileProgress([...updated]);
      }

      // Gesamtphase aktualisieren
      const doneCount = updated.filter((f) => f.step === 'done').length;
      const errorCount = updated.filter((f) => f.step === 'error').length;
      const convertingCount = updated.filter((f) => f.step === 'converting').length;
      const total = updated.length;

      if (convertingCount > 0) {
        setOverallPhase(`Konvertiere... (${doneCount + errorCount}/${total})`);
      } else if (doneCount + errorCount < total) {
        setOverallPhase(`Verarbeite... (${doneCount + errorCount}/${total})`);
      } else {
        setOverallPhase(`Abgeschlossen: ${doneCount} erfolgreich, ${errorCount} Fehler`);
      }
    });
    return unsub;
  }, []);

  const handleUpload = async (selectedFiles: File[]) => {
    if (!activeProject) return;
    setUploading(true);
    setOverallPhase('Vorbereitung...');

    // Progress-State initialisieren
    const initial: FileProgress[] = selectedFiles.map((f) => ({
      name: f.name,
      size: f.size,
      step: 'pending',
      message: 'Wartet...',
    }));
    progressRef.current = initial;
    setFileProgress([...initial]);

    try {
      // Alle Dateien auf einmal senden — Main-Prozess konvertiert + speichert + committed
      const fileData = await Promise.all(
        selectedFiles.map(async (f) => ({
          name: f.name,
          data: await f.arrayBuffer(),
        })),
      );

      setOverallPhase('Konvertierung läuft...');
      const results = await api.files.upload(activeProject, fileData);

      const successCount = results.filter((r) => !r.error).length;
      const failedCount = results.filter((r) => r.error).length;

      if (successCount > 0) {
        addNotification('success', `${successCount} Datei(en) verarbeitet und hochgeladen.`);
        await loadFiles();
        await refreshStatus();
      }
      if (failedCount > 0) {
        addNotification('error', `${failedCount} Datei(en) fehlgeschlagen.`);
      }

      setOverallPhase(`Fertig: ${successCount} erfolgreich${failedCount > 0 ? `, ${failedCount} Fehler` : ''}`);
    } catch (err) {
      addNotification('error', `Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      setOverallPhase('Fehler beim Upload');
    } finally {
      setUploading(false);
      // Progress nach 5s ausblenden
      setTimeout(() => {
        setFileProgress([]);
        setOverallPhase('');
      }, 5000);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!activeProject) return;
    setDeletingFile(filename);
    try {
      const preview = await api.forget.preview(activeProject, filename);
      setConfirmAction({
        filename,
        affectedPages: preview.affectedPages.length,
      });
    } catch {
      setConfirmAction({ filename, affectedPages: 0 });
    } finally {
      setDeletingFile(null);
    }
  };

  const executeDelete = async () => {
    if (!activeProject || !confirmAction) return;
    const { filename, affectedPages } = confirmAction;
    setConfirmAction(null);
    setDeletingFile(filename);

    try {
      // Wiki-Seiten aufraeumen, falls betroffen
      if (affectedPages > 0) {
        await api.forget.execute(activeProject, filename);
      }
      // Rohdatei loeschen
      await api.files.deleteRaw(activeProject, filename);
      addNotification(
        'success',
        affectedPages > 0
          ? `"${filename}" gelöscht. ${affectedPages} Wiki-Seite(n) angepasst.`
          : `"${filename}" gelöscht.`,
      );
      setFiles((prev) => prev.filter((f) => f.name !== filename));
      if (previewFile === filename) {
        setPreviewFile(null);
        setPreviewContent('');
      }
      await Promise.all([refreshStatus(), refreshWikiPages()]);
    } catch (err) {
      addNotification(
        'error',
        `Löschen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDeletingFile(null);
    }
  };

  const handleForget = async (filename: string) => {
    if (!activeProject) return;
    setForgettingFile(filename);
    try {
      await api.forget.reset(activeProject, filename);
      setFiles((prev) =>
        prev.map((f) => (f.name === filename ? { ...f, ingested: false } : f)),
      );
      addNotification('success', `"${filename}" vergessen — wird beim naechsten Ingest erneut angeboten.`);
      await refreshStatus();
    } catch (err) {
      addNotification(
        'error',
        `Vergessen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setForgettingFile(null);
    }
  };

  const handleView = async (filename: string) => {
    if (!activeProject) return;
    try {
      if (isImageFile(filename)) {
        const base64 = await api.files.readRawBase64(activeProject, filename);
        const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.gif': 'image/gif', '.webp': 'image/webp',
        };
        const mime = mimeMap[ext] || 'image/jpeg';
        setPreviewFile(filename);
        setPreviewContent(`data:${mime};base64,${base64}`);
      } else {
        const content = await api.files.readRaw(activeProject, filename);
        setPreviewFile(filename);
        setPreviewContent(content);
      }
    } catch {
      addNotification('error', 'Datei konnte nicht geladen werden.');
    }
  };

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Rohdaten</h1>
          <p>Kein Projekt ausgewaehlt.</p>
        </div>
      </div>
    );
  }

  const overallPercent =
    fileProgress.length > 0
      ? Math.round(
          (fileProgress.filter((f) => f.step === 'done' || f.step === 'error').length /
            fileProgress.length) *
            100,
        )
      : 0;

  return (
    <div>
      <div className="page-header">
        <h1>Rohdaten</h1>
        <p>Dateien hochladen und verwalten &mdash; {files.length} Datei(en), davon {files.filter((f) => !f.ingested).length} neu</p>
      </div>

      <DropZone onUpload={handleUpload} uploading={uploading} />

      {/* === Konvertierungs- & Upload-Fortschritt === */}
      {fileProgress.length > 0 && (
        <div className="card convert-progress-card" style={{ marginTop: 16 }}>
          <div className="convert-progress-header">
            <h3>
              {uploading ? 'Verarbeitung läuft...' : overallPhase}
            </h3>
            {uploading && (
              <span className="convert-progress-percent">{overallPercent}%</span>
            )}
          </div>

          {/* Gesamtfortschrittsbalken */}
          <div className="convert-progress-bar-track">
            <div
              className={`convert-progress-bar-fill ${uploading ? 'active' : 'complete'}`}
              style={{ width: `${overallPercent}%` }}
            />
          </div>

          {/* Phasen-Indikator */}
          <div className="convert-progress-phases">
            <span className={`convert-phase ${fileProgress.some((f) => f.step === 'reading') ? 'active' : overallPercent > 0 ? 'done' : ''}`}>
              Lesen
            </span>
            <span className="convert-phase-arrow">&rarr;</span>
            <span className={`convert-phase ${fileProgress.some((f) => f.step === 'converting') ? 'active' : overallPercent > 30 ? 'done' : ''}`}>
              Konvertieren
            </span>
            <span className="convert-phase-arrow">&rarr;</span>
            <span className={`convert-phase ${fileProgress.some((f) => f.step === 'saving') ? 'active' : overallPercent > 60 ? 'done' : ''}`}>
              Speichern
            </span>
            <span className="convert-phase-arrow">&rarr;</span>
            <span className={`convert-phase ${fileProgress.some((f) => f.step === 'committing') || (!uploading && overallPercent === 100) ? 'active' : ''}`}>
              Git
            </span>
          </div>

          {/* Per-File-Status */}
          <div className="convert-file-list">
            {fileProgress.map((item, idx) => (
              <div
                key={idx}
                className={`convert-file-item convert-file-${item.step}`}
              >
                <span className="convert-file-icon">
                  {STEP_ICONS[item.step] || '\u23F3'}
                </span>
                <span className="convert-file-name" title={item.name}>
                  {item.name}
                </span>
                <span className="convert-file-size">
                  {formatFileSize(item.size)}
                </span>
                <span className="convert-file-status">
                  {item.step === 'error' ? (
                    <span className="convert-file-error" title={item.message}>
                      {item.message}
                    </span>
                  ) : (
                    <span className="convert-file-step">
                      {STEP_LABELS[item.step]}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeStatus && activeStatus.rawNew > 0 && !uploading && (
        <div
          className="card"
          style={{
            marginTop: 16,
            borderLeft: '3px solid var(--accent)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            <strong>{activeStatus.rawNew} neue Datei(en)</strong> warten auf
            Verarbeitung.
          </span>
          <Link to="/ingest" className="btn btn-primary btn-sm">
            Jetzt ingesten!
          </Link>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Lade Dateien...</p>
        </div>
      ) : files.length === 0 ? (
        <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>
            Noch keine Rohdaten vorhanden. Lade Dateien über die DropZone hoch.
          </p>
        </div>
      ) : (
        <div className="file-list">
          {files.map((file) => (
            <FileCard
              key={file.name}
              filename={file.name}
              ingested={file.ingested}
              onDelete={handleDelete}
              onForget={handleForget}
              onView={handleView}
              deleting={deletingFile === file.name}
              forgetting={forgettingFile === file.name}
            />
          ))}
        </div>
      )}

      {previewFile && (
        <div className="preview-overlay" onClick={() => setPreviewFile(null)}>
          <div
            className="preview-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="preview-header">
              <h3>{previewFile}</h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPreviewFile(null)}
              >
                Schliessen
              </button>
            </div>
            {previewFile && isImageFile(previewFile) ? (
              <div className="preview-content" style={{ textAlign: 'center', padding: '1rem' }}>
                <img
                  src={previewContent}
                  alt={previewFile}
                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                />
              </div>
            ) : (
              <pre className="preview-content">{previewContent}</pre>
            )}
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          title="Datei löschen"
          message={
            confirmAction.affectedPages > 0
              ? `"${confirmAction.filename}" löschen? ${confirmAction.affectedPages} Wiki-Seite(n) werden dabei angepasst — Informationen die ausschließlich aus dieser Quelle stammen, werden entfernt.`
              : `"${confirmAction.filename}" unwiderruflich löschen?`
          }
          confirmLabel="Löschen"
          danger
          onConfirm={executeDelete}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
