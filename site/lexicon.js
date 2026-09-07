(function (root) {
  'use strict';
  const normalize = (text) => String(text || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  let dictionary;
  function lookup(word) {
    if (!dictionary) {
      dictionary = new Map(String(root.UK_IPA_DATA || '').split('\n').map((line) => {
        const tab = line.indexOf('\t'); return [normalize(line.slice(0, tab)), line.slice(tab + 1).trim()];
      }));
    }
    const key = normalize(word), exact = dictionary.get(key);
    if (exact) return { ipaUK: exact, ipaSource: 'ipa-dict/en_UK', label: '英式词典' };
    const tokens = key.split(/\s+/).flatMap((part) => dictionary.has(part) ? [part] : part.split('-')).filter(Boolean);
    const parts = tokens.map((part) => dictionary.get(part));
    if (tokens.length > 1 && parts.every(Boolean)) {
      return { ipaUK: `/${parts.map((part) => part.match(/^\/([^/]+)\//)?.[1] || '').join(' ')}/`, ipaSource: 'composed', label: '逐词生成' };
    }
    return { ipaUK: '', ipaSource: 'unavailable', label: key ? '暂无音标，可手动填写' : '' };
  }
  function parseBatch(text) {
    const rows = [], errors = [];
    String(text).split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const cells = line.split('\t');
      if (cells.length < 2 || cells.length > 3 || !cells[0].trim() || !cells[1].trim()) {
        errors.push(`第 ${index + 1} 行：请使用“英文 + Tab + 释义”，备注可放在第三列`); return;
      }
      const word = cells[0].replace(/\s+/g, ' ').trim(), translation = cells[1].replace(/\s+/g, ' ').trim();
      const note = (cells[2] || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
      rows.push({ word, translation, note, line: index + 1, ...lookup(word) });
    });
    return { rows, errors };
  }
  root.CustomLexicon = { lookup, parseBatch };
})(globalThis);
