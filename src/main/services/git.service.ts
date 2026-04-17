import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { getReposDir } from '../util/paths';
import { SettingsService } from './settings.service';

let repoDir: string | null = null;

function getAuth() {
  const token = SettingsService.getGitToken();
  return { username: 'x-access-token', password: token };
}

function ensureRepoDir(): string {
  if (!repoDir) throw new Error('Kein Repository geklont. Bitte zuerst ein Repository klonen.');
  return repoDir;
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

      await git.clone({
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
        await git.pull({
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
          await git.checkout({ fs, dir, ref: 'HEAD', force: true });
          for (const filepath of localChanges) {
            try { await git.add({ fs, dir, filepath }); } catch { /* skip */ }
          }
          if (localChanges.length > 0) {
            await git.commit({
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
      const statusMatrix = await git.statusMatrix({ fs, dir });
      return statusMatrix
        .filter(([, head, workdir]) => head !== workdir)
        .map(([filepath]) => filepath);
    } catch {
      return [];
    }
  },

  async push(): Promise<{ success: boolean; error?: string }> {
    try {
      const dir = ensureRepoDir();
      await git.push({
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
      await git.add({ fs, dir, filepath });
    }
    await git.commit({
      fs,
      dir,
      message,
      author: { name: '2Brain', email: '2brain@local' },
    });
  },

  async addAll(): Promise<void> {
    const dir = ensureRepoDir();
    const status = await git.statusMatrix({ fs, dir });
    for (const [filepath, head, workdir, stage] of status) {
      if (workdir !== head || stage !== head) {
        if (workdir === 0) {
          await git.remove({ fs, dir, filepath });
        } else {
          await git.add({ fs, dir, filepath });
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
    const status = await git.statusMatrix({ fs, dir });
    for (const [filepath, head, workdir, stage] of status) {
      if (!filepath.startsWith(prefix)) continue;
      if (workdir !== head || stage !== head) {
        if (workdir === 0) {
          await git.remove({ fs, dir, filepath });
        } else {
          await git.add({ fs, dir, filepath });
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
      const status = await git.statusMatrix({ fs, dir });
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
    const staged = await git.statusMatrix({ fs, dir });
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
    await git.commit({
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
      await git.push({ fs, http, dir, onAuth: () => getAuth() });
      console.log('[git] Push erfolgreich');
    } catch (err) {
      console.error('[git] Push fehlgeschlagen (wird beim naechsten Sync nachgeholt):', err instanceof Error ? err.message : err);
    }
  },

  async forcePush(): Promise<{ success: boolean; error?: string }> {
    try {
      const dir = ensureRepoDir();
      await git.push({
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
      await git.fetch({
        fs,
        http,
        dir,
        singleBranch: true,
        onAuth: () => getAuth(),
      });

      // Resolve the remote branch ref
      const remoteBranch = await git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/main' })
        .catch(() => git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/master' }));

      // Point local HEAD to remote
      await git.writeRef({ fs, dir, ref: 'refs/heads/main', value: remoteBranch, force: true });

      // Checkout to overwrite working directory
      await git.checkout({ fs, dir, ref: 'main', force: true });

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
    const statusMatrix = await git.statusMatrix({ fs, dir });
    const dirty = statusMatrix.some(([, head, workdir, stage]) =>
      head !== workdir || head !== stage
    );

    let ahead = 0;
    try {
      const localRef = await git.resolveRef({ fs, dir, ref: 'HEAD' });
      const remoteRef = await git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/HEAD' }).catch(() => null);
      if (remoteRef && localRef !== remoteRef) ahead = 1;
    } catch {
      // Refs nicht verfuegbar
    }

    return { clean: !dirty, ahead, behind: 0 };
  },
};
