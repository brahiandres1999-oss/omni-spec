import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderWithStudio } from '@/test/render';
import { SkillsView } from '@/views/SkillsView';
import { FakeTransport } from '@/test/fake-transport';
import { defaultSkills, installLayoutStub, scriptStudio, skill, skills } from '@/test/fixtures';

/** Skills contract: root `[data-view="skills"]`; one row per skill `[data-skill="<name>"]`. */
let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
});
afterEach(() => restoreLayout());

async function readySkills(): Promise<HTMLElement> {
  return waitFor(() => {
    const root = document.querySelector<HTMLElement>('[data-view="skills"][data-state="ready"]');
    if (!root) throw new Error('skills never became ready');
    return root;
  });
}

const order = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-skill]')].map(row => row.dataset.skill);

function row(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-skill="${name}"]`);
  if (!element) throw new Error(`skill row ${name} is not rendered`);
  return element;
}

describe('VS skills view', () => {
  test('VS-01 rows show name, origin and estimated weight, sortable by weight', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<SkillsView />, { transport: fake });
    const root = await readySkills();
    expect(order(root)).toEqual(['broken', 'house-style', 'omni-audit', 'omni-specify']);

    const specify = row('omni-specify');
    expect(within(specify).getByText('omni-specify')).toBeInTheDocument();
    expect(within(specify).getByText('Integrada')).toBeInTheDocument();
    expect(within(row('house-style')).getByText('Proyecto')).toBeInTheDocument();
    expect(within(specify).getByText(/25\.000/)).toBeInTheDocument();
    expect(specify.textContent).toMatch(/est/i);

    await user.click(within(root).getByRole('button', { name: 'Ordenar por peso' }));
    expect(order(root)).toEqual(['house-style', 'omni-specify', 'omni-audit', 'broken']);
  });

  test('VS-02 the toggle calls skills.toggle and its state comes from the server', async () => {
    const disabledAudit = defaultSkills().map(entry =>
      entry.name === 'omni-audit' ? { ...entry, enabled: false } : entry,
    );
    const fake = scriptStudio(new FakeTransport()).respondOnce('skills.list', skills());
    fake.respond('skills.list', skills(disabledAudit));
    const user = userEvent.setup();
    renderWithStudio(<SkillsView />, { transport: fake });
    await readySkills();

    const slot = fake.defer('skills.toggle');
    const toggle = () => within(row('omni-audit')).getByRole('switch', { name: /omni-audit/ });
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle());
    expect(fake.lastCall('skills.toggle')).toEqual({ name: 'omni-audit', enabled: false });
    // No optimistic flip while the server has not answered.
    expect(toggle()).toHaveAttribute('aria-checked', 'true');

    slot.resolve({ name: 'omni-audit', enabled: false });
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'false'));
  });

  test('VS-03 active total and budget share are exact', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<SkillsView />, { transport: fake });
    const root = await readySkills();
    const meter = within(root).getByRole('meter', { name: 'Presupuesto de contexto' });
    expect(meter).toHaveAttribute('aria-valuenow', '37500');
    expect(meter).toHaveAttribute('aria-valuemax', '200000');
    expect(root.textContent).toContain('37.500');
    expect(root.textContent).toMatch(/18,8\s?%/);
  });

  test('VS-04 a row with a problem stays visible with its reason', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<SkillsView />, { transport: fake });
    await readySkills();
    const problem = row('broken').querySelector<HTMLElement>('[data-problem="FRONTMATTER_MISSING"]');
    expect(problem).not.toBeNull();
    expect(problem?.textContent?.trim().length).toBeGreaterThan(0);
  });

  test('VS-05 an exceeded budget shows an inline warning without blocking', async () => {
    const heavy = [
      skill({ name: 'omni-audit', weight: { tokens: 150_000, estimated: true } }),
      skill({ name: 'omni-specify', weight: { tokens: 100_000, estimated: true } }),
    ];
    const fake = scriptStudio(new FakeTransport()).respond('skills.list', skills(heavy));
    renderWithStudio(<SkillsView />, { transport: fake });
    const root = await readySkills();
    expect(within(root).getByRole('status')).toHaveTextContent(/presupuesto/i);
    for (const toggle of within(root).getAllByRole('switch')) expect(toggle).toBeEnabled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
