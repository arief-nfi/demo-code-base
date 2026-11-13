export type Locale = 'en' | 'id';

export type Dictionary = Record<string, any>;

export type Dictionaries = {
  [K in Locale]: Dictionary;
};

/**
 * Deep merge multiple dictionary objects
 */
export function mergeDictionaries(...dicts: Dictionaries[]): Dictionaries {
  const result: Dictionaries = { en: {}, id: {} };
  
  for (const dict of dicts) {
    for (const locale of Object.keys(dict) as Locale[]) {
      result[locale] = deepMerge(result[locale] || {}, dict[locale] || {});
    }
  }
  
  return result;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}
