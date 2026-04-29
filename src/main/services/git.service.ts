import {
  add as gitAdd,
  checkout as gitCheckout,
  clone as gitClone,
  commit as gitCommit,
  fetch as gitFetch,
  log as gitLog,
  pull as gitPull,
  push as gitPush,
  remove as gitRemove,
  resolveRef as gitResolveRef,
  statusMatrix as gitStatusMatrix,
  writeRef as gitWriteRef,
} from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { existsSync, promises as fs } from 'fs';
import { join, basename } from 'path';
import { getReposDir } from '../util/paths';
import { SettingsService } from './settings.service';
import type { GitChange, GitChangeState, GitCommitInfo } from '../../shared/api.types';

let repoDir: string | null = null;

function getAuth() {
  const token = SettingsService.getGitToken();
  return { username: 'x-access-token', password: token };
}

function ensureRepoDir(): string {
  if (!repoDir) throw new Error('Kein Repository geklont. Bitte zuerst ein Repository klonen.');
  return repoDir;
}

function projectFromPath(filepath: string): string {
  return filepath.split('/')[0] || '';
}

function areaFromPath(filepath: string): string {
  const parts = filepath.split('/');
  return parts[1] || 'root';
}

function changeState(head: number, workdir: number, stage: number): GitChangeState {
  if (head === 0 && workdir === 2) return 'added';
  if (head === 1 && workdir === 0) return 'deleted';
  if (head !== stage) return 'staged';
  if (head !== workdir || workdir !== stage) return 'modified';
  return 'unchanged';
}

function commitDate(timestamp: number, timezoneOffset: number): string {
  const offsetMs = timezoneOffset * 60 * 1000;
  return new Date((timestamp * 1000) - offsetMs).toISOString();
}

export const GitService = {
  getRepoDir(): string | null {
    return repoDir;
  },

  isCloned(): boolean {
    if (!repoDir) {
      const repoUrl = SettingsService.getRepoUrl();
      if (!repoUrl) return false;
      const name = basename(repoUrl, '.git').replace(/[^a-zA-Z0-9_-]/g, '_');
      const dir = join(getReposDir(), name);
      if (existsSync(join(dir, '.git'))) {
        repoDir = dir;
        return true;
      }
      return false;
    }
    return existsSync(join(repoDir, '.git'));
  },

  async clone(url: string, token: string): Promise<{ success: boolean; error?: string }> {
    try {
      const name = basename(url, '.git').replace(/[^a-zA-Z0-9_-]/g, '_');
      const dir = join(getReposDir(), name);
      await fs.mkdir(dir, { recursive: true });

      await gitClone({
        fs,
        http,
        dir,
        url,
        singleBranch: true,
        depth: 1,
        onAuth: () => ({ username: 'x-access-token', password: token }),
      });

      repoDir = dir;
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async pull(): Promise<{ updated: boolean; error?: string }> {
    try {
      const dir = ensureRepoDir();

      // Lokale Aenderungen sichern vor Pull
      const localChanges = await this.getLocalChangedFiles();

      try {
        await gitPull({
          fs,
          http,
          dir,
          singleBranch: true,
          onAuth: () => getAuth(),
          author: { name: '2Brain', email: '2brain@local' },
        });
      } catch (pullErr) {
        const msg = pullErr instanceof Error ? pullErr.message : String(pullErr);

        // Merge-Konflikt: Festplatte gewinnt
        if (msg.includes('merge') || msg.includes('conflict') || msg.includes('MERGE')) {
          console.log('[git] Konflikt erkannt — lokale Version wird beibehalten');
          // Hard-Reset auf lokalen Stand, dann Commit + Push
          await gitCheckout({ fs, dir, ref: 'HEAD', force: true });
          for (const filepath of localChanges) {
            try { await gitAdd({ fs, dir, filepath }); } catch { /* skip */ }
          }
          if (localChanges.length > 0) {
            await gitCommit({
              fs, dir,
              message: 'Lokale Aenderungen nach Konflikt (Festplatte gewinnt)',
              author: { name: '2Brain', email: '2brain@local' },
            });
          }
          return { updated: true };
        }

        return { updated: false, error: msg };
      }

      return { updated: true };
    } catch (err) {
      return { updated: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async getLocalChangedFiles(): Promise<string[]> {
    try {
      const dir = ensureRepoDir();
      const statusMatrix = await gitStatusMatrix({ fs, dir });
      return statusMatrix
        .filter(([, head, workdir]) => head !== workdir)
        .map(([filepath]) => filepath);
    } catch {
      return [];
    }
  },

  async listChanges(): Promise<GitChange[]> {
    try {
      const dir = ensureRepoDir();
      const statusMatrix = await gitStatusMatrix({ fs, dir });
      return statusMatrix
        .map(([filepath, head, workdir, stage]) => ({
          path: filepath,
          project: projectFromPath(filepath),
          area: areaFromPath(filepath),
          state: changeState(head, workdir, stage),
          staged: head !== stage,
        }))
        .filter((change) => change.state !== 'unchanged')
        .sort((a, b) => a.path.localeCompare(b.path));
    } catch {
      return [];
    }
  },

  async listRecentCommits(limit = 12): Promise<GitCommitInfo[]> {
    try {
      const dir = ensureRepoDir();
      const commits = await gitLog({ fs, dir, depth: Math.max(1, Math.floor(limit)) });
      return commits.map((entry) => ({
        oid: entry.oid,
        message: entry.commit.message.split('\n')[0] || '(ohne Nachricht)',
        authorName: entry.commit.author.name || '',
        authorEmail: entry.commit.author.email || '',
        date: commitDate(entry.commit.author.timestamp, entry.commit.author.timezoneOffset),
      }));
    } catch {
      return [];
    }
  },

  async push(): Promise<{ success: boolean; error?: string }> {
    try {
      const dir = ensureRepoDir();
      await gitPush({
        fs,
        http,
        dir,
        onAuth: () => getAuth(),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async addAndCommit(filepaths: string[], message: string): Promise<void> {
    const dir = ensureRepoDir();
    for (const filepath of filepaths) {
      await gitAdd({ fs, dir, filepath });
    }
    await gitCommit({
      fs,
      dir,
      message,
      author: { name: '2Brain', email: '2brain@local' },
    });
  },

  async addAll(): Promise<void> {
    const dir = ensureRepoDir();
    const status = await gitStatusMatrix({ fs, dir });
    for (const [filepath, head, workdir, stage] of status) {
      if (workdir !== head || stage !== head) {
        if (workdir === 0) {
          await gitRemove({ fs, dir, filepath });
        } else {
          await gitAdd({ fs, dir, filepath });
        }
      }
    }
  },

  /**
   * Staged nur Aenderungen unterhalb von `scope/` — verhindert, dass Dateien
   * anderer Projekte (z.B. mit syncEnabled=false) versehentlich mitcommittet
   * werden.
   */
  async addAllInScope(scope: string): Promise<void> {
    const dir = ensureRepoDir();
    const prefix = scope.endsWith('/') ? scope : `${scope}/`;
    const status = await gitStatusMatrix({ fs, dir });
    for (const [filepath, head, workdir, stage] of status) {
      if (!filepath.startsWith(prefix)) continue;
      if (workdir !== head || stage !== head) {
        if (workdir === 0) {
          await gitRemove({ fs, dir, filepath });
        } else {
          await gitAdd({ fs, dir, filepath });
        }
      }
    }
  },

  /**
   * Liefert alle untracked Dateien (workdir=2, head=0, stage=0) optional
   * gefiltert nach Pfad-Regex. Wird u.a. vor Force-Pull genutzt, um den User
   * vor Datenverlust zu warnen.
   */
  async listUntrackedFiles(pathRegex?: RegExp): Promise<string[]> {
    try {
      const dir = ensureRepoDir();
      const status = await gitStatusMatrix({ fs, dir });
      return status
        .filter(([fp, head, workdir, stage]) => {
          if (head !== 0 || workdir !== 2 || stage !== 0) return false;
          return pathRegex ? pathRegex.test(fp) : true;
        })
        .map(([fp]) => fp);
    } catch {
      return [];
    }
  },

  async commitAndPush(message: string, scope?: string): Promise<void> {
    const dir = ensureRepoDir();

    // Aenderungen stagen — wenn Scope gesetzt, nur innerhalb des Projekts
    if (scope) {
      await this.addAllInScope(scope);
    } else {
      await this.addAll();
    }

    // Pruefen ob es ueberhaupt etwas zu committen gibt (ggf. scoped)
    const staged = await gitStatusMatrix({ fs, dir });
    const scopePrefix = scope ? (scope.endsWith('/') ? scope : `${scope}/`) : null;
    const hasChanges = staged.some(([fp, head, , stage]) => {
      if (head === stage) return false;
      return scopePrefix ? fp.startsWith(scopePrefix) : true;
    });
    if (!hasChanges) {
      console.log('[git] commitAndPush: Keine Aenderungen zu committen');
      return;
    }

    const appSettings = SettingsService.get();
    await gitCommit({
      fs,
      dir,
      message,
      author: {
        name: appSettings.git?.authorName || '2Brain',
        email: appSettings.git?.authorEmail || '2brain@local',
      },
    });
    console.log(`[git] Commit: ${message}`);

    try {
      await gitPush({ fs, http, dir, onAuth: () => getAuth() });
      console.log('[git] Push erfolgreich');
    } catch (err) {
      console.error('[git] Push fehlgeschlagen (wird beim naechsten Sync nachgeholt):', err instanceof Error ? err.message : err);
    }
  },

  async forcePush(): Promise<{ success: boolean; error?: string }> {
    try {
      const dir = ensureRepoDir();
      await gitPush({
        fs,
        http,
        dir,
        force: true,
        onAuth: () => getAuth(),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async forcePull(): Promise<{ success: boolean; error?: string }> {
    try {
      const dir = ensureRepoDir();

      // Fetch latest from remote
      await gitFetch({
        fs,
        http,
        dir,
        singleBranch: true,
        onAuth: () => getAuth(),
      });

      // Resolve the remote branch ref
      const remoteBranch = await gitResolveRef({ fs, dir, ref: 'refs/remotes/origin/main' })
        .catch(() => gitResolveRef({ fs, dir, ref: 'refs/remotes/origin/master' }));

      // Point local HEAD to remote
      await gitWriteRef({ fs, dir, ref: 'refs/heads/main', value: remoteBranch, force: true });

      // Checkout to overwrite working directory
      await gitCheckout({ fs, dir, ref: 'main', force: true });

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async sync(): Promise<{ pulled: boolean; pushed: boolean; error?: string }> {
    const pullResult = await this.pull();
    if (pullResult.error) {
      return { pulled: false, pushed: false, error: pullResult.error };
    }
    const pushResult = await this.push();
    return {
      pulled: pullResult.updated,
      pushed: pushResult.success,
      error: pushResult.error,
    };
  },

  async status(): Promise<{ clean: boolean; ahead: number; behind: number }> {
    const dir = ensureRepoDir();
    const statusMatrix = await gitStatusMatrix({ fs, dir });
    const dirty = statusMatrix.some(([, head, workdir, stage]) =>
      head !== workdir || head !== stage
    );

    let ahead = 0;
    try {
      const localRef = await gitResolveRef({ fs, dir, ref: 'HEAD' });
      const remoteRef = await gitResolveRef({ fs, dir, ref: 'refs/remotes/origin/HEAD' }).catch(() => null);
      if (remoteRef && localRef !== remoteRef) ahead = 1;
    } catch {
      // Refs nicht verfuegbar
    }

    return { clean: !dirty, ahead, behind: 0 };
  },
};
