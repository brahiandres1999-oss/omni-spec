import { rename, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Windows antivirus, indexers and sync clients (OneDrive, Dropbox) briefly hold handles on
// recently written files. Those transient errors are retried; anything else fails at once.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = ms => new Promise(done => setTimeout(done, ms));

/**
 * Rename with bounded retries for transient Windows file-handle errors.
 * @param {string} from Source path.
 * @param {string} to Destination path (replaced atomically).
 * @param {number} attempts Maximum attempts before the original error is thrown.
 */
export async function renameWithRetry(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (!TRANSIENT.has(error.code) || attempt >= attempts) throw error;
      await pause(25 * 2 ** (attempt - 1));
    }
  }
}

/**
 * Write a file through a unique temporary sibling and an atomic rename.
 * @param {string} path Destination path, already validated by the caller.
 * @param {string|Buffer} content Complete file content.
 */
export async function writeFileAtomic(path, content) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx' });
  try {
    await renameWithRetry(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
