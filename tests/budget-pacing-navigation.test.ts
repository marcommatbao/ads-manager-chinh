import { describe, expect, it } from 'vitest';
import { isHiddenPage } from '@/lib/hidden-pages';

describe('P6 browser entry point', () => {
  it('allows the pacing page while preserving unrelated hidden pages', () => {
    expect(isHiddenPage('/toolkit/budget-pacing')).toBe(false);
    expect(isHiddenPage('/toolkit/budget-pacing/details')).toBe(false);
    expect(isHiddenPage('/toolkit/ngram')).toBe(true);
    expect(isHiddenPage('/toolkit/ad-group-structure')).toBe(true);
  });
});
