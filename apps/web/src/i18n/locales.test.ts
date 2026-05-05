import { describe, expect, it } from 'vitest';
import { en } from './locales/en';
import { LOCALES, LOCALE_LABEL, RTL_LOCALES, type Dict, type Locale } from './types';

const EXPECTED_LOCALES: Locale[] = [
  'en',
  'zh-CN',
  'zh-TW',
  'es-ES',
  'fr',
  'ru',
  'ar',
  'ja',
  'ko',
];

const EXPECTED_RTL: Locale[] = ['ar'];

function placeholders(value: string): string[] {
  const names: string[] = [];
  for (const match of value.matchAll(/\{(\w+)\}/g)) {
    if (match[1]) names.push(match[1]);
  }
  return names.sort();
}

async function loadDict(locale: Locale): Promise<Dict> {
  const module = await import(`./locales/${locale}.ts`);
  const dict = Object.values(module).find((value): value is Dict => {
    return Boolean(value) && typeof value === 'object';
  });
  if (!dict) throw new Error(`No dictionary export found for locale ${locale}`);
  return dict;
}

describe('i18n locales', () => {
  it('registers every supported locale with a human label', () => {
    expect(LOCALES).toEqual(EXPECTED_LOCALES);
    for (const locale of EXPECTED_LOCALES) {
      expect(LOCALE_LABEL[locale]).toBeTruthy();
    }
  });

  it('flags ar as the only RTL locale', () => {
    expect([...RTL_LOCALES].sort()).toEqual([...EXPECTED_RTL].sort());
  });

  it('keeps each locale dictionary aligned with English keys and placeholders', async () => {
    const englishKeys = Object.keys(en).sort();

    for (const locale of LOCALES) {
      const dict = await loadDict(locale);
      expect(Object.keys(dict).sort(), `${locale} key set`).toEqual(englishKeys);

      for (const key of englishKeys) {
        const dictKey = key as keyof Dict;
        expect(placeholders(dict[dictKey]), `${locale}.${key} placeholders`).toEqual(
          placeholders(en[dictKey]),
        );
      }
    }
  });
});
