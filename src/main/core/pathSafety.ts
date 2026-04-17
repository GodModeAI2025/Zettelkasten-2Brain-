import { isAbsolute, posix } from 'path';

function normalizeInputPath(input: string): string {
  return input.trim().replace(/\\/g, '/');
}

export function sanitizeRelativePath(input: string): string {
  const normalizedInput = normalizeInputPath(input);
  if (!normalizedInput) {
    throw new Error('Leerer Pfad ist nicht erlaubt.');
  }

  if (normalizedInput.startsWith('/') || isAbsolute(normalizedInput)) {
    throw new Error(`Absolute Pfade sind nicht erlaubt: ${input}`);
  }

  const normalized = posix.normalize(normalizedInput).replace(/^\.\//, '');
  if (!normalized || normalized === '.') {
    throw new Error(`Ungueltiger relativer Pfad: ${input}`);
  }

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Pfad ausserhalb des erlaubten Bereichs: ${input}`);
  }

  return normalized;
}

export function toScopedRelativePath(scope: string, input: string): string {
  const normalizedScope = sanitizeRelativePath(scope).replace(/\/+$/, '');
  const normalizedInput = sanitizeRelativePath(input);
  const scopedPath = posix.normalize(`${normalizedScope}/${normalizedInput}`);

  if (
    scopedPath === normalizedScope ||
    !scopedPath.startsWith(`${normalizedScope}/`)
  ) {
    throw new Error(
      `Pfad ausserhalb von "${normalizedScope}/" nicht erlaubt: ${input}`
    );
  }

  return scopedPath;
}

export function requireRootPrefix(
  relativePath: string,
  rootPrefix: string
): string {
  const normalizedPath = sanitizeRelativePath(relativePath);
  const normalizedPrefix = sanitizeRelativePath(rootPrefix).replace(/\/+$/, '');

  if (
    normalizedPath === normalizedPrefix ||
    normalizedPath.startsWith(`${normalizedPrefix}/`)
  ) {
    return normalizedPath;
  }

  throw new Error(
    `Pfad ausserhalb von "${normalizedPrefix}/" nicht erlaubt: ${relativePath}`
  );
}
