import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OMNI_SKILLS } from '../src/workflows.mjs';

const skillsDir = join(process.cwd(), 'skills');

for (const skill of OMNI_SKILLS) {
  const dir = join(skillsDir, skill.name);
  await mkdir(dir, { recursive: true });
  const content = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions}\n`;
  await writeFile(join(dir, 'SKILL.md'), content, 'utf-8');
}

console.log(`[OK] Generated ${OMNI_SKILLS.length} plugin skills in ${skillsDir}`);
