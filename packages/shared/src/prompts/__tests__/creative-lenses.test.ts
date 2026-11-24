import { describe, it, expect } from 'bun:test';
import {
  CREATIVE_LENS_IDS,
  CREATIVE_LENSES,
  isCreativeLensId,
  formatCreativeLensPrompt,
  SHIORI_CREATIVE_PERSONA_SECTION,
} from '../creative-lenses.ts';
import { getSystemPrompt } from '../system.ts';

describe('creative-lenses', () => {
  it('validates known creative lens IDs', () => {
    for (const id of CREATIVE_LENS_IDS) {
      expect(isCreativeLensId(id)).toBe(true);
      expect(CREATIVE_LENSES[id].id).toBe(id);
    }
    expect(isCreativeLensId('unknown')).toBe(false);
    expect(isCreativeLensId(undefined)).toBe(false);
  });

  it('returns empty prompt block for natural or undefined lens', () => {
    expect(formatCreativeLensPrompt(undefined)).toBe('');
    expect(formatCreativeLensPrompt('natural')).toBe('');
  });

  it('formats active lenses as <creative_lens> XML blocks', () => {
    for (const id of ['poetic', 'operatic', 'atelier', 'avant-garde'] as const) {
      const block = formatCreativeLensPrompt(id);
      expect(block).toContain(`<creative_lens id="${id}"`);
      expect(block).toContain('</creative_lens>');
    }
  });

  it('includes Shiori creative persona in default system prompt and injects creative lens', () => {
    const prompt = getSystemPrompt(
      '',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'default',
      'poetic',
    );
    expect(prompt).toContain(SHIORI_CREATIVE_PERSONA_SECTION);
    expect(prompt).toContain('<creative_lens id="poetic"');
  });

  it('does not inject creative lens into coding profile system prompt', () => {
    const prompt = getSystemPrompt(
      '',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'coding',
      'operatic',
    );
    expect(prompt).not.toContain('<creative_lens');
    expect(prompt).not.toContain(SHIORI_CREATIVE_PERSONA_SECTION);
  });
});
