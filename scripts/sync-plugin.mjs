import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const targetDir = join(homedir(), '.gemini', 'config', 'plugins', 'omni-spec');
const sourceDir = process.cwd();

console.log(`[SYNC] Deploying plugin ${sourceDir} -> ${targetDir}...`);

try {
  await mkdir(join(homedir(), '.gemini', 'config', 'plugins'), { recursive: true });

  try {
    const existing = await stat(targetDir);
    if (existing) {
      await rm(targetDir, { recursive: true, force: true });
    }
  } catch {}

  await mkdir(targetDir, { recursive: true });

  // Copy plugin bundle elements (Language Server on Windows does not enumerate reparse points/junctions)
  const itemsToCopy = ['plugin.json', 'README.md', 'rules', 'skills', 'agents', 'assets'];

  for (const item of itemsToCopy) {
    const srcPath = join(sourceDir, item);
    const destPath = join(targetDir, item);
    try {
      await cp(srcPath, destPath, { recursive: true });
    } catch (e) {
      // Ignore if optional asset does not exist
    }
  }

  console.log(`[SUCCESS] OmniSpec Antigravity plugin synced successfully at: ${targetDir}`);
  console.log(`[NOTE] In Antigravity, the plugin is active immediately for new prompts, or run /plugin to inspect.`);
} catch (err) {
  console.error(`[ERROR] Failed to sync plugin: ${err.message}`);
  process.exit(1);
}
