(function (global) {
  'use strict';

  const tones = new Set(['light', 'medium-light', 'medium', 'medium-dark', 'dark']);
  const versionPattern = /^\d+\.\d+$/;
  let sourceUrl;
  let initialization;
  let records;

  function words(value) {
    return value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  }

  function invalid(message) {
    throw new TypeError(`Invalid emoji dataset: ${message}`);
  }

  function validateEntry(entry, nested) {
    if (!entry || typeof entry !== 'object' ||
        typeof entry.emoji !== 'string' || !entry.emoji ||
        typeof entry.name !== 'string' || !entry.name ||
        typeof entry.emojiVersion !== 'string' || !versionPattern.test(entry.emojiVersion) ||
        !Array.isArray(entry.keywords) || !entry.keywords.every(word => typeof word === 'string') ||
        !Array.isArray(entry.skinTones) || !entry.skinTones.every(tone => tones.has(tone)) ||
        !(entry.baseEmoji === null || (typeof entry.baseEmoji === 'string' && entry.baseEmoji))) {
      invalid('malformed emoji entry');
    }
    if (nested) {
      if (!entry.skinTones.length || Object.hasOwn(entry, 'variants')) invalid('malformed variant');
    } else {
      if (!Array.isArray(entry.variants)) invalid('missing variants array');
      entry.variants.forEach(variant => validateEntry(variant, true));
    }
  }

  function prepare(data) {
    if (!data || typeof data.version !== 'string' || !versionPattern.test(data.version) ||
        !Array.isArray(data.categories)) invalid('missing version or categories');
    const prepared = [];
    for (const category of data.categories) {
      if (!category || typeof category.name !== 'string' || !category.name ||
          !Array.isArray(category.subgroups)) invalid('malformed category');
      for (const subgroup of category.subgroups) {
        if (!subgroup || typeof subgroup.name !== 'string' || !subgroup.name ||
            !Array.isArray(subgroup.emojis)) invalid('malformed subgroup');
        for (const entry of subgroup.emojis) {
          validateEntry(entry, false);
          const nameWords = words(entry.name);
          const tokens = [...new Set([...nameWords, ...entry.keywords.flatMap(words)])];
          const variantsByTone = new Map();
          for (const variant of entry.variants) {
            const tone = variant.skinTones[0];
            if (variant.skinTones.every(value => value === tone) && !variantsByTone.has(tone)) {
              variantsByTone.set(tone, variant);
            }
          }
          prepared.push({ entry, category: category.name, subgroup: subgroup.name,
            fullName: nameWords.join(' '), tokens, tokenSet: new Set(tokens), variantsByTone });
        }
      }
    }
    if (!prepared.length) invalid('no emojis');
    return prepared;
  }

  function copyEntry(entry) {
    return { emoji: entry.emoji, name: entry.name, keywords: [...entry.keywords],
      emojiVersion: entry.emojiVersion, skinTones: [...entry.skinTones], baseEmoji: entry.baseEmoji };
  }

  function init(url) {
    let resolved;
    try {
      if (typeof url !== 'string' || !url.trim()) throw new TypeError('Emoji.init requires a JSON URL');
      resolved = new URL(url, global.document.baseURI).href;
      if (!/^https?:/.test(resolved)) throw new TypeError('Emoji.init requires an HTTP or HTTPS URL');
    } catch (error) {
      return Promise.reject(error);
    }
    if (initialization) {
      return resolved === sourceUrl ? initialization :
        Promise.reject(new Error('Emoji is already initializing or initialized with another URL; reload the page to change datasets'));
    }
    sourceUrl = resolved;
    initialization = Promise.resolve().then(async () => {
      const response = await global.fetch(resolved, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Emoji download failed: HTTP ${response.status}`);
      const prepared = prepare(await response.json());
      records = prepared;
    }).catch(error => {
      initialization = undefined;
      sourceUrl = undefined;
      throw error;
    });
    return initialization;
  }

  function search(query, skinTone = null, options = {}) {
    if (!records) throw new Error('Emoji is not ready; await Emoji.init(url) before searching');
    if (typeof query !== 'string') throw new TypeError('Emoji.search query must be a string');
    if (skinTone !== null && !tones.has(skinTone)) throw new TypeError('Unknown skin tone');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Search options must be an object');
    const { limit = 50, category } = options;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('Search limit must be a nonnegative safe integer');
    if (category !== undefined && typeof category !== 'string') throw new TypeError('Search category must be a string');
    if (limit === 0) return [];

    const queryWords = words(query);
    const terms = [...new Set(queryWords)];
    const fullQuery = queryWords.join(' ');
    const matches = [];
    for (const record of records) {
      if (category !== undefined && record.category !== category) continue;
      let exact = 0;
      let matched = true;
      for (const term of terms) {
        if (record.tokenSet.has(term)) exact++;
        else if (!record.tokens.some(token => token.startsWith(term))) {
          matched = false;
          break;
        }
      }
      if (matched) matches.push({ record, exact, full: fullQuery !== '' && fullQuery === record.fullName });
    }
    // Stable sorting preserves Unicode order for equal relevance, including empty queries.
    matches.sort((a, b) => Number(b.full) - Number(a.full) || b.exact - a.exact);
    return matches.slice(0, limit).map(({ record }) => {
      const selected = record.variantsByTone.get(skinTone) || record.entry;
      return { ...copyEntry(selected), category: record.category, subgroup: record.subgroup,
        variants: record.entry.variants.map(copyEntry) };
    });
  }

  global.Emoji = Object.freeze({ init, search });
})(window);
