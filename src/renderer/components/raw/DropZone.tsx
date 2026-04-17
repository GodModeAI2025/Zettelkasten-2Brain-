import { useState, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/app.store';

const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx', '.html', '.json', '.csv', '.log',
  '.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ACCEPT_STRING = ACCEPTED_EXTENSIONS.concat(['image/jpeg', 'image/png', 'image/gif', 'image/webp']).join(',');
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (Bilder koennen groesser sein)

interface DropZoneProps {
  onUpload: (files: File[]) => void;
  uploading: boolean;
}

function isAcceptedFile(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
  return ACCEPTED_EXTENSIONS.includes(ext);
}

async function readEntriesRecursive(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (f) => resolve(isAcceptedFile(f) ? [f] : []),
        () => resolve([]),
      );
    });
  }
  if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await new Promise<FileSystemEntry[]>((resolve) => {
      dirReader.readEntries(
        (results) => resolve(results),
        () => resolve([]),
      );
    });
    const nested = await Promise.all(entries.map(readEntriesRecursive));
    return nested.flat();
  }
  return [];
}

export function DropZone({ onUpload, uploading }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const addNotification = useAppStore((s) => s.addNotification);

  const validateAndFilter = useCallback(
    (files: File[]): File[] => {
      const valid: File[] = [];
      const tooLarge: string[] = [];
      const wrongType: string[] = [];

      for (const file of files) {
        if (!isAcceptedFile(file)) {
          wrongType.push(file.name);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          tooLarge.push(file.name);
          continue;
        }
        valid.push(file);
      }

      if (wrongType.length > 0) {
        addNotification(
          'info',
          `${wrongType.length} Datei(en) übersprungen (nicht unterstütztes Format): ${wrongType.slice(0, 3).join(', ')}${wrongType.length > 3 ? ` und ${wrongType.length - 3} weitere` : ''}`,
        );
      }
      if (tooLarge.length > 0) {
        addNotification(
          'info',
          `${tooLarge.length} Datei(en) übersprungen (größer als 10 MB): ${tooLarge.slice(0, 3).join(', ')}${tooLarge.length > 3 ? ` und ${tooLarge.length - 3} weitere` : ''}`,
        );
      }

      return valid;
    },
    [addNotification],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (uploading) return;

      const items = Array.from(e.dataTransfer.items);
      const allFiles: File[] = [];

      // Check for directory entries (webkitGetAsEntry)
      const entries = items
        .map((item) => item.webkitGetAsEntry?.())
        .filter((entry): entry is FileSystemEntry => entry != null);

      if (entries.length > 0) {
        const nested = await Promise.all(entries.map(readEntriesRecursive));
        allFiles.push(...nested.flat());
      } else {
        // Fallback: plain file list
        allFiles.push(...Array.from(e.dataTransfer.files));
      }

      const valid = validateAndFilter(allFiles);
      if (valid.length > 0) {
        setSelectedCount(valid.length);
        onUpload(valid);
      }
    },
    [onUpload, uploading, validateAndFilter],
  );

  const handleClick = () => {
    if (!uploading) inputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    const valid = validateAndFilter(selected);
    if (valid.length > 0) {
      setSelectedCount(valid.length);
      onUpload(valid);
    }
    e.target.value = '';
  };

  return (
    <div
      className={`dropzone ${dragOver ? 'dropzone-active' : ''} ${uploading ? 'dropzone-uploading' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_STRING}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      <div className="dropzone-content">
        <div className="dropzone-icon">{uploading ? '\u21BB' : '\u2B06'}</div>
        <p className="dropzone-text">
          {uploading
            ? `${selectedCount} Datei(en) werden hochgeladen...`
            : dragOver
              ? 'Dateien oder Ordner hier ablegen'
              : 'Dateien oder Ordner hierher ziehen oder klicken'}
        </p>
        <p className="dropzone-hint">
          Unterstützte Formate: TXT, MD, PDF, DOCX, HTML, JSON, CSV, JPG, PNG, GIF, WEBP (max. 20 MB pro Datei)
        </p>
      </div>
    </div>
  );
}
