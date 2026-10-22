import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OMNI_SKILLS } from '../src/workflows.mjs';
import { HOST_RULE } from '../src/protocols.mjs';

const skillsDir = join(process.cwd(), 'skills');

for (const skill of OMNI_SKILLS) {
  const dir = join(skillsDir, skill.name);
  await mkdir(dir, { recursive: true });
  const content = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions}\n`;
  await writeFile(join(dir, 'SKILL.md'), content, 'utf-8');
}

const rulesDir = join(process.cwd(), 'rules');
await mkdir(rulesDir, { recursive: true });
await writeFile(
  join(rulesDir, 'constitution.md'),
  `---\ntrigger: always_on\ndescription: OmniSpec project workflow and evidence boundaries\n---\n<!-- OMNI-SPEC-START -->\n## OmniSpec engineering protocol\n\n${HOST_RULE}\n\nUse the installed OmniSpec CLI and the project's selected workflow for detailed setup, technology and design procedures.\n<!-- OMNI-SPEC-END -->\n`,
  'utf8',
);
console.log(`[OK] Generated ${OMNI_SKILLS.length} plugin skills in ${skillsDir} and the shared plugin rule`);
