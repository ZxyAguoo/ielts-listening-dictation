(function (root) {
  'use strict';
  const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const stamp = () => new Date().toISOString();
  const makeId = () => root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const cleanText = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const safeKeys = (value) => value && typeof value === 'object' && !Array.isArray(value)
    && !Object.keys(value).some((k) => ['__proto__', 'prototype', 'constructor'].includes(k));
  const validWord = (item) => safeKeys(item) && typeof item.id === 'string'
    && typeof item.word === 'string' && typeof item.translation === 'string'
    && Array.isArray(item.aliases) && item.aliases.every((a) => typeof a === 'string');

  class Engine {
    constructor(data, saved) {
      this.data = data;
      this.state = {
        version: 3, revision: 5,
        settings: { bookId: data.books[0].id, libraryBookId: data.books[0].id,
          voiceURI: '', order: 'sequential', hideEnglish: false, hideChinese: false,
          theme: 'lavender', wrongSort: 'desc', practiceMode: 'dictation', typingSound: true },
        customBooks: [], rounds: {}, sessions: {}, wrong: {}, records: [], migrated: false,
      };
      this.reindex();
      if (saved) this.restore(saved);
    }

    reindex() {
      this.books = new Map([...this.data.books, ...(this.state.customBooks || [])].map((b) => [b.id, b]));
      this.entries = new Map();
      this.words = new Map();
      this.aliases = new Map();
      for (const book of this.books.values()) {
        for (const row of book.entries) {
          const ref = `${book.id}/${row.id}`;
          this.entries.set(ref, row);
          if (!this.words.has(row.id)) this.words.set(row.id, { row, books: [] });
          this.words.get(row.id).books.push(book.id);
          for (const text of [row.word, ...(row.aliases || [])]) {
            if (!this.aliases.has(normalize(text))) this.aliases.set(normalize(text), row.id);
          }
        }
      }
    }

    restore(saved) {
      if (!safeKeys(saved) || saved.version !== 3 || !safeKeys(saved.settings)
        || !safeKeys(saved.rounds) || !safeKeys(saved.wrong) || !Array.isArray(saved.records)) {
        throw new Error('备份格式不正确');
      }
      const state = clone(saved);
      state.revision = 5;
      state.customBooks ||= [];
      if (!Array.isArray(state.customBooks)) throw new Error('自定义词书数据不完整');
      const knownBookIds = new Set(this.data.books.map((book) => book.id));
      const knownBookNames = new Set(this.data.books.map((book) => normalize(book.name)));
      for (const book of state.customBooks) {
        if (!safeKeys(book) || typeof book.id !== 'string' || !book.id.startsWith('custom-book-')
          || knownBookIds.has(book.id) || typeof book.name !== 'string' || !cleanText(book.name)
          || knownBookNames.has(normalize(book.name)) || !Array.isArray(book.entries)
          || typeof book.createdAt !== 'string' || typeof book.updatedAt !== 'string') throw new Error('自定义词书数据不完整');
        knownBookIds.add(book.id); knownBookNames.add(normalize(book.name));
        book.custom = true;
        book.confusableGroups ||= [];
        if (!Array.isArray(book.confusableGroups)) throw new Error('易混词组数据不完整');
        const entryIds = new Set(), entryWords = new Set();
        for (const row of book.entries) {
          if (!validWord(row) || entryIds.has(row.id) || entryWords.has(normalize(row.word))
            || !cleanText(row.word) || !cleanText(row.translation) || typeof row.ipaUK !== 'string'
            || typeof row.ipaSource !== 'string' || typeof row.speechText !== 'string'
            || !Number.isSafeInteger(row.sourceOrder) || row.sourceOrder < 0
            || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string') throw new Error('自定义词条数据不完整');
          row.note ||= '';
          if (typeof row.note !== 'string' || row.note.length > 1000) throw new Error('自定义词条备注不完整');
          entryIds.add(row.id); entryWords.add(normalize(row.word));
        }
        const grouped = new Set(), groupIds = new Set();
        for (const group of book.confusableGroups) {
          if (!safeKeys(group) || typeof group.id !== 'string' || groupIds.has(group.id)
            || !Array.isArray(group.memberIds) || group.memberIds.length < 2 || group.memberIds.length > 5
            || new Set(group.memberIds).size !== group.memberIds.length
            || group.memberIds.some((id) => !entryIds.has(id) || grouped.has(id))
            || typeof group.createdAt !== 'string' || typeof group.updatedAt !== 'string') throw new Error('易混词组数据不完整');
          groupIds.add(group.id); group.memberIds.forEach((id) => grouped.add(id));
        }
      }
      this.state = state;
      this.reindex();
      state.sessions ||= {};
      if (!safeKeys(state.sessions)) throw new Error('轮次记录不完整');
      for (const [id, session] of Object.entries(state.sessions)) {
        if (!safeKeys(session) || session.id !== id || typeof session.name !== 'string'
          || typeof session.startedAt !== 'string' || !Number.isInteger(session.total)
          || session.total < 0) throw new Error('轮次记录不完整');
        session.mode = session.mode === 'spelling' ? 'spelling' : 'dictation';
      }
      if (!this.books.has(state.settings.bookId) && state.settings.bookId !== 'wrong') {
        state.settings.bookId = this.data.books[0].id;
      }
      if (!this.books.has(state.settings.libraryBookId)) state.settings.libraryBookId = this.data.books[0].id;
      state.settings.order = state.settings.order === 'random' ? 'random' : 'sequential';
      state.settings.theme = ['neutral', 'apricot', 'sage', 'blue', 'lavender', 'rose'].includes(state.settings.theme)
        ? state.settings.theme : 'lavender';
      state.settings.wrongSort = state.settings.wrongSort === 'asc' ? 'asc' : 'desc';
      state.settings.practiceMode = state.settings.practiceMode === 'spelling' ? 'spelling' : 'dictation';
      state.settings.typingSound = state.settings.typingSound !== false;
      for (const [key, item] of Object.entries(state.wrong)) {
        if (!validWord(item) || key !== item.id || !Number.isSafeInteger(item.count) || item.count < 1
          || typeof item.lastAt !== 'string' || typeof item.lastAnswer !== 'string'
          || !Array.isArray(item.bookIds) || !item.bookIds.every((id) => typeof id === 'string')) throw new Error('错题数据不完整');
        item.bookNames = safeKeys(item.bookNames) ? item.bookNames : {};
        item.note ||= '';
        item.notesByBook = safeKeys(item.notesByBook) ? item.notesByBook : {};
        if (typeof item.note !== 'string' || Object.values(item.notesByBook).some((note) => typeof note !== 'string')) throw new Error('错题备注数据不完整');
        if (item.lastGroupSnapshot != null && !this.validGroupSnapshot(item.lastGroupSnapshot)) throw new Error('错题易混词组快照不完整');
      }
      for (const item of state.records) {
        if (!safeKeys(item) || typeof item.id !== 'string' || typeof item.word !== 'string'
          || typeof item.answer !== 'string' || typeof item.at !== 'string'
          || typeof item.correctAnswer !== 'string' || typeof item.bookName !== 'string'
          || !['correct', 'wrong', 'blank', 'hint'].includes(item.result)) throw new Error('听写记录不完整');
        item.mode = item.mode === 'spelling' ? 'spelling' : 'dictation';
      }
      for (const [key, round] of Object.entries(state.rounds)) {
        if (!safeKeys(round) || !Array.isArray(round.queue) || !Array.isArray(round.results)
          || !Number.isInteger(round.index) || round.index < 0 || round.index > round.queue.length
          || !['ready', 'active', 'complete'].includes(round.status)
          || !['sequential', 'random'].includes(round.order)
          || (key !== 'wrong' && !this.books.has(key))
          || typeof round.id !== 'string' || typeof round.answer !== 'string'
          || round.source !== key || !safeKeys(round.question) || typeof round.question.counted !== 'boolean'
          || typeof round.question.hinted !== 'boolean'
          || round.results.length !== round.index) throw new Error('听写进度不完整');
        round.mode = round.mode === 'spelling' ? 'spelling' : 'dictation';
        if (round.legacyEntries && (!safeKeys(round.legacyEntries)
          || Object.values(round.legacyEntries).some((item) => !validWord(item)))) throw new Error('旧版词条快照不完整');
        round.groupSnapshots ||= [];
        if (!Array.isArray(round.groupSnapshots) || round.groupSnapshots.some((group) => !this.validGroupSnapshot(group)
          || group.refs.some((ref) => !round.queue.includes(ref)))) throw new Error('听写易混词组快照不完整');
        if (round.results.some((item, i) => !safeKeys(item) || item.ref !== round.queue[i]
          || typeof item.answer !== 'string' || typeof item.firstTry !== 'boolean')) throw new Error('听写结果不完整');
        if ((round.status === 'complete' && round.index !== round.queue.length)
          || (round.status === 'active' && round.index === round.queue.length)) throw new Error('听写状态不完整');
        if (round.queue.some((ref) => !this.entry(ref, state))) throw new Error('备份中的词库与当前版本不匹配');
        if (new Set(round.queue).size !== round.queue.length) throw new Error('听写队列存在重复项');
        round.baseQueue ||= [...round.queue];
        if (!Array.isArray(round.baseQueue) || round.baseQueue.length !== round.queue.length
          || new Set(round.baseQueue).size !== round.queue.length
          || round.baseQueue.some((ref) => !round.queue.includes(ref))) throw new Error('本轮选词不完整');
        round.name ||= this.books.get(key)?.name || '错题本';
        if (round.question.counted) round.question.countedFor ||= `${round.id}/${round.index}`;
        if (round.startedAt) state.sessions[round.id] ||= this.sessionMetadata(round);
      }
      this.state = state;
      this.reindex();
    }

    entry(ref, state = this.state) {
      if (this.entries.has(ref)) return this.entries.get(ref);
      if (typeof ref === 'string' && ref.startsWith('legacy/')) {
        const id = ref.split('/').at(-1);
        return Object.values(state.rounds).map((round) => round.legacyEntries?.[ref] || round.legacyEntries?.[id]).find(Boolean)
          || state.wrong[id] || null;
      }
      return null;
    }

    findLegacy(word) {
      const cleaned = normalize(word).replace(/\s*\($/, '').replace(/\.(?:n|v|adj|adv)\.$/, '');
      const id = this.aliases.get(cleaned);
      return id ? this.words.get(id).row : null;
    }

    customBook(id) { return this.state.customBooks.find((book) => book.id === id) || null; }

    validGroupSnapshot(group) {
      return safeKeys(group) && typeof group.id === 'string' && typeof group.bookId === 'string'
        && typeof group.bookName === 'string' && Array.isArray(group.refs)
        && group.refs.length >= 2 && group.refs.length <= 5 && new Set(group.refs).size === group.refs.length
        && group.refs.every((ref) => typeof ref === 'string') && Array.isArray(group.members)
        && group.members.length === group.refs.length && group.members.every(validWord);
    }

    confusableGroup(bookId, entryId) {
      const book = this.customBook(bookId);
      return book?.confusableGroups?.find((group) => group.memberIds.includes(entryId)) || null;
    }

    snapshotGroup(bookId, group, refs = null) {
      const book = this.customBook(bookId); if (!book || !group) return null;
      const members = group.memberIds.map((id) => book.entries.find((row) => row.id === id)).filter(Boolean);
      if (members.length < 2) return null;
      return { id: `${bookId}/${group.id}`, bookId, bookName: book.name,
        refs: refs || members.map((row) => `${bookId}/${row.id}`), members: members.map(clone) };
    }

    liveGroupSnapshots(bookId) {
      const book = this.customBook(bookId);
      return (book?.confusableGroups || []).map((group) => this.snapshotGroup(bookId, group)).filter(Boolean);
    }

    groupForRef(ref, round = this.round()) {
      return (round.groupSnapshots || []).find((group) => group.refs.includes(ref)) || null;
    }

    currentGroup() {
      const round = this.round(), ref = round.queue[round.index];
      return ref ? this.groupForRef(ref, round) : null;
    }

    assertBookName(value, currentId = null) {
      const name = cleanText(value);
      if (!name || name.length > 50) throw new Error('词书名称需为 1 至 50 个字符');
      if ([...this.books.values()].some((book) => book.id !== currentId && normalize(book.name) === normalize(name))) throw new Error('词书名称已存在');
      return name;
    }

    wordIdFor(word, ignoredRef = '') {
      const key = normalize(word);
      for (const book of this.books.values()) for (const row of book.entries) {
        if (`${book.id}/${row.id}` !== ignoredRef && [row.word, ...(row.aliases || [])].some((text) => normalize(text) === key)) return row.id;
      }
      const previous = Object.values(this.state.wrong).find((row) => [row.word, ...(row.aliases || [])].some((text) => normalize(text) === key));
      return previous?.id || `custom-word-${makeId()}`;
    }

    addCustomBook(value) {
      const now = stamp();
      const book = { id: `custom-book-${makeId()}`, name: this.assertBookName(value), category: '我的词书',
        level: '自定义', rank: 3, custom: true, entries: [], confusableGroups: [], createdAt: now, updatedAt: now };
      this.state.customBooks.push(book); this.reindex();
      return book;
    }

    renameCustomBook(id, value) {
      const book = this.customBook(id); if (!book) throw new Error('自定义词书不存在');
      book.name = this.assertBookName(value, id); book.updatedAt = stamp();
      for (const item of Object.values(this.state.wrong)) if (item.bookIds.includes(id)) {
        item.bookNames = { ...(item.bookNames || {}), [id]: book.name };
        if (item.lastGroupSnapshot?.bookId === id) item.lastGroupSnapshot.bookName = book.name;
      }
      const round = this.state.rounds[id]; if (round && !round.startedAt) round.name = book.name;
      this.reindex(); return book;
    }

    cleanEntry(input) {
      const word = cleanText(input.word), translation = cleanText(input.translation);
      if (!word || word.length > 120 || /[\u3400-\u9fff]/.test(word) || !/[A-Za-z]/.test(word) || /[\/=()（）]/.test(word)) throw new Error('请输入有效的英文单词或词组');
      if (!translation || translation.length > 500) throw new Error('释义需为 1 至 500 个字符');
      let ipaUK = cleanText(input.ipaUK || '');
      if (ipaUK) ipaUK = `/${ipaUK.replace(/^\/+|\/+$/g, '').trim()}/`;
      const note = String(input.note || '').normalize('NFKC').replace(/\r\n?/g, '\n').trim();
      if (note.length > 1000) throw new Error('备注不能超过 1000 个字符');
      return { word, translation, note, ipaUK, ipaSource: String(input.ipaSource || (ipaUK ? 'manual' : 'unavailable')) };
    }

    addConfusableMember(bookId, anchorId, memberId) {
      const book = this.customBook(bookId); if (!book) throw new Error('自定义词书不存在');
      if (anchorId === memberId || !book.entries.some((row) => row.id === anchorId) || !book.entries.some((row) => row.id === memberId)) throw new Error('易混词成员不存在');
      const anchorGroup = this.confusableGroup(bookId, anchorId), memberGroup = this.confusableGroup(bookId, memberId);
      if (memberGroup && memberGroup !== anchorGroup) throw new Error('该词已属于另一个易混词组');
      if (anchorGroup?.memberIds.includes(memberId)) throw new Error('该词已在当前易混词组中');
      if (anchorGroup && anchorGroup.memberIds.length >= 5) throw new Error('每个易混词组最多 5 个词');
      const now = stamp();
      if (anchorGroup) { anchorGroup.memberIds.push(memberId); anchorGroup.updatedAt = now; }
      else book.confusableGroups.push({ id: `confusable-${makeId()}`, memberIds: [anchorId, memberId], createdAt: now, updatedAt: now });
      book.updatedAt = now; this.stopCustomRound(bookId); this.reindex();
      return this.confusableGroup(bookId, anchorId);
    }

    removeConfusableMember(bookId, entryId) {
      const book = this.customBook(bookId); if (!book) throw new Error('自定义词书不存在');
      const index = book.confusableGroups.findIndex((group) => group.memberIds.includes(entryId));
      if (index < 0) return false;
      const group = book.confusableGroups[index]; group.memberIds = group.memberIds.filter((id) => id !== entryId);
      if (group.memberIds.length < 2) book.confusableGroups.splice(index, 1); else { group.updatedAt = stamp(); }
      book.updatedAt = stamp(); this.stopCustomRound(bookId); this.reindex(); return true;
    }

    stopCustomRound(bookId) {
      const round = this.state.rounds[bookId];
      if (round?.startedAt) this.state.sessions[round.id] = { ...this.sessionMetadata(round), status: round.status === 'complete' ? 'complete' : 'stopped' };
      delete this.state.rounds[bookId];
    }

    detachCustomRef(bookId, row) {
      const oldRef = `${bookId}/${row.id}`;
      const alternate = [...this.books.values()].find((book) => book.id !== bookId && book.entries.some((entry) => entry.id === row.id));
      for (const round of Object.values(this.state.rounds)) {
        if (!round.queue.includes(oldRef) && !(round.baseQueue || []).includes(oldRef)) continue;
        const newRef = alternate ? `${alternate.id}/${row.id}` : `legacy/${row.id}`;
        if (!alternate) round.legacyEntries = { ...(round.legacyEntries || {}), [row.id]: clone(row) };
        round.queue = round.queue.map((ref) => ref === oldRef ? newRef : ref);
        round.baseQueue = (round.baseQueue || round.queue).map((ref) => ref === oldRef ? newRef : ref);
        round.results = round.results.map((result) => result.ref === oldRef ? { ...result, ref: newRef } : result);
        for (const group of round.groupSnapshots || []) group.refs = group.refs.map((ref) => ref === oldRef ? newRef : ref);
      }
    }

    addCustomEntry(bookId, input) {
      return this.addCustomEntries(bookId, [input])[0];
    }

    addCustomEntries(bookId, inputs) {
      const book = this.customBook(bookId); if (!book) throw new Error('自定义词书不存在');
      if (!Array.isArray(inputs) || !inputs.length) throw new Error('请先添加词条');
      const keys = new Set(book.entries.map((row) => normalize(row.word))), ids = new Set(book.entries.map((row) => row.id));
      const now = stamp(), firstOrder = book.entries.reduce((max, row) => Math.max(max, row.sourceOrder), -1) + 1;
      const rows = inputs.map((input, index) => {
        const cleaned = this.cleanEntry(input), key = normalize(cleaned.word), id = this.wordIdFor(cleaned.word);
        if (keys.has(key) || ids.has(id)) throw new Error(`本词书已存在该词条或其拼写变体：${cleaned.word}`);
        keys.add(key); ids.add(id);
        const known = this.words.get(id)?.row;
        return { id, ...cleaned, aliases: known ? [...new Set([known.word, ...known.aliases].filter((text) => normalize(text) !== key))] : [],
          speechText: cleaned.word, sourceOrder: firstOrder + index, custom: true, createdAt: now, updatedAt: now };
      });
      this.stopCustomRound(bookId); book.entries.push(...rows); book.updatedAt = now; this.reindex();
      return rows;
    }

    updateCustomEntry(bookId, entryId, input) {
      const book = this.customBook(bookId); if (!book) throw new Error('自定义词书不存在');
      const index = book.entries.findIndex((row) => row.id === entryId); if (index < 0) throw new Error('自定义词条不存在');
      const previous = book.entries[index], cleaned = this.cleanEntry(input), changedWord = normalize(previous.word) !== normalize(cleaned.word);
      const newId = changedWord ? this.wordIdFor(cleaned.word, `${bookId}/${entryId}`) : previous.id;
      if (book.entries.some((row, i) => i !== index && (normalize(row.word) === normalize(cleaned.word) || row.id === newId))) throw new Error('本词书已存在该词条');
      if (changedWord) { this.stopCustomRound(bookId); this.detachCustomRef(bookId, previous); }
      const known = this.words.get(newId)?.row;
      book.entries[index] = { ...previous, ...cleaned, id: newId,
        aliases: known ? [...new Set([known.word, ...known.aliases].filter((text) => normalize(text) !== normalize(cleaned.word)))] : [], speechText: cleaned.word, updatedAt: stamp() };
      if (changedWord) for (const group of book.confusableGroups) group.memberIds = group.memberIds.map((id) => id === previous.id ? newId : id);
      book.updatedAt = stamp(); this.reindex(); return book.entries[index];
    }

    deleteCustomEntry(bookId, entryId) {
      const book = this.customBook(bookId); if (!book) throw new Error('自定义词书不存在');
      const index = book.entries.findIndex((row) => row.id === entryId); if (index < 0) throw new Error('自定义词条不存在');
      const row = book.entries[index]; this.stopCustomRound(bookId); this.detachCustomRef(bookId, row);
      const groupIndex = book.confusableGroups.findIndex((group) => group.memberIds.includes(entryId));
      if (groupIndex >= 0) {
        const group = book.confusableGroups[groupIndex]; group.memberIds = group.memberIds.filter((id) => id !== entryId);
        if (group.memberIds.length < 2) book.confusableGroups.splice(groupIndex, 1); else group.updatedAt = stamp();
      }
      book.entries.splice(index, 1); book.updatedAt = stamp(); this.reindex(); return row;
    }

    deleteCustomBook(bookId) {
      const index = this.state.customBooks.findIndex((book) => book.id === bookId); if (index < 0) throw new Error('自定义词书不存在');
      const book = this.state.customBooks[index]; this.stopCustomRound(bookId);
      for (const row of book.entries) this.detachCustomRef(bookId, row);
      for (const item of Object.values(this.state.wrong)) if (item.bookIds.includes(bookId)) item.bookNames = { ...(item.bookNames || {}), [bookId]: book.name };
      this.state.customBooks.splice(index, 1); this.reindex();
      if (this.state.settings.bookId === bookId) this.state.settings.bookId = this.data.books[0].id;
      if (this.state.settings.libraryBookId === bookId) this.state.settings.libraryBookId = this.data.books[0].id;
      return book;
    }

    migrate(legacyWrong, legacyRecords, settings = {}) {
      if (this.state.migrated) return;
      for (const old of Array.isArray(legacyWrong) ? legacyWrong : []) {
        if (!old || typeof old.word !== 'string') continue;
        const row = this.findLegacy(old.word);
        const id = row?.id || `legacy-${normalize(old.word)}`;
        const count = Math.max(1, Math.trunc(Number(old.count) || 1));
        const bookIds = row ? this.words.get(row.id).books : [];
        const existing = this.state.wrong[id];
        const updated = old.updatedAt || stamp();
        this.state.wrong[id] = {
          id, word: row?.word || old.word, translation: row?.translation || old.translation || '',
          aliases: row?.aliases || old.aliases || [], ipaUK: row?.ipaUK || '',
          speechText: row?.speechText || old.word, count: (existing?.count || 0) + count,
          bookIds, bookNames: Object.fromEntries(bookIds.map((bookId) => [bookId, this.books.get(bookId)?.name || '旧版词条'])),
          lastAnswer: existing && existing.lastAt > updated ? existing.lastAnswer : (old.lastAnswer || ''),
          lastAt: existing && existing.lastAt > updated ? existing.lastAt : updated,
          lastReason: old.blankCount ? 'hint' : 'wrong', legacy: !row,
        };
      }
      for (const [index, old] of (Array.isArray(legacyRecords) ? legacyRecords : []).entries()) {
        if (!old || typeof old.word !== 'string') continue;
        const row = this.findLegacy(old.word);
        const book = this.data.books.find((b) => b.category === old.category && b.rank === 2);
        this.state.records.push({ id: `legacy-${index}-${old.time || ''}`, roundId: 'legacy', questionId: `legacy-${index}`,
          wordId: row?.id || `legacy-${normalize(old.word)}`, word: old.word,
          bookId: book?.id || 'legacy', bookName: book?.name || old.category || '旧版记录',
          answer: String(old.answer || ''), correctAnswer: old.correctAnswer || row?.word || old.word,
          at: old.time || stamp(), result: ['correct', 'wrong', 'blank'].includes(old.result) ? old.result : 'wrong' });
      }
      if (typeof settings.voice === 'string') this.state.settings.voiceURI = settings.voice;
      this.state.migrated = true;
    }

    sortedWrong(direction = this.state.settings.wrongSort) {
      const multiplier = direction === 'asc' ? 1 : -1;
      return Object.values(this.state.wrong).sort((a, b) => multiplier * (a.count - b.count)
        || b.lastAt.localeCompare(a.lastAt) || a.word.localeCompare(b.word));
    }

    queue(source) {
      if (source === 'wrong') return this.sortedWrong().map((item) => {
        const info = this.words.get(item.id);
        return info ? `${info.books[0]}/${item.id}` : `legacy/${item.id}`;
      });
      return (this.books.get(source)?.entries || []).map((r) => `${source}/${r.id}`);
    }

    sessionMetadata(round) {
      return { id: round.id, source: round.source, name: round.name || this.books.get(round.source)?.name || '错题本',
        startedAt: round.startedAt, completedAt: round.completedAt, status: round.status,
        total: round.queue.length, parentId: round.parentId || null, reviewDepth: round.reviewDepth || 0,
        mode: round.mode === 'spelling' ? 'spelling' : 'dictation' };
    }

    prepare(source, order = this.state.settings.order, options = {}) {
      const previous = this.state.rounds[source];
      if (previous?.startedAt) this.state.sessions[previous.id] = {
        ...this.sessionMetadata(previous), status: previous.status === 'complete' ? 'complete' : 'stopped',
      };
      const requested = [...new Set(options.refs || this.queue(source))];
      const legacyEntries = clone(options.legacyEntries || {});
      const snapshots = clone(options.groupSnapshots || (this.customBook(source) ? this.liveGroupSnapshots(source) : []));
      const snapshotByRef = new Map(), requestedSet = new Set(requested);
      for (const group of snapshots) for (const ref of group.refs) if (requestedSet.has(ref)) {
        if (snapshotByRef.has(ref)) throw new Error('一个词不能同时属于多个易混词组');
        snapshotByRef.set(ref, group);
      }
      const units = [], usedGroups = new Set();
      for (const ref of requested) {
        const group = snapshotByRef.get(ref);
        if (group) {
          if (!usedGroups.has(group.id)) { units.push([...group.refs]); usedGroups.add(group.id); }
        } else units.push([ref]);
      }
      const baseQueue = units.flat();
      const resolve = (ref) => this.entry(ref) || legacyEntries[ref] || legacyEntries[ref.split('/').at(-1)];
      if (baseQueue.some((ref) => !resolve(ref))) throw new Error('选中的词条已不存在');
      const orderedUnits = units.map((unit) => [...unit]);
      if (order === 'random') {
        for (let i = orderedUnits.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [orderedUnits[i], orderedUnits[j]] = [orderedUnits[j], orderedUnits[i]];
        }
      }
      const queue = orderedUnits.flat();
      for (const ref of queue.filter((ref) => ref.startsWith('legacy/'))) legacyEntries[ref] ||= clone(resolve(ref));
      const mode = (options.mode || this.state.settings.practiceMode) === 'spelling' ? 'spelling' : 'dictation';
      this.state.rounds[source] = { id: makeId(), source, order, mode, queue, baseQueue, index: 0, legacyEntries,
        groupSnapshots: snapshots.filter((group) => group.refs.every((ref) => baseQueue.includes(ref))),
        name: options.name || this.books.get(source)?.name || '错题本',
        parentId: options.parentId || null, reviewDepth: options.reviewDepth || 0,
        selectedWrongCount: options.selectedWrongCount || 0,
        answer: '', status: 'ready', question: { counted: false, hinted: false },
        invalid: false, results: [], startedAt: null, completedAt: null };
      return this.state.rounds[source];
    }

    select(source) {
      if (!this.books.has(source) && source !== 'wrong') throw new Error('词书不存在');
      this.state.settings.bookId = source;
      const round = this.state.rounds[source] || (source === 'wrong' ? this.prepareWrong() : this.prepare(source));
      this.state.settings.order = round.order;
      this.state.settings.practiceMode = round.mode === 'spelling' ? 'spelling' : 'dictation';
      return round;
    }

    round() {
      return this.state.rounds[this.state.settings.bookId] || this.select(this.state.settings.bookId);
    }

    current() {
      const round = this.round();
      return this.entry(round.queue[round.index]);
    }

    start() {
      let round = this.round();
      if (round.status === 'complete') round = this.restart();
      if (!round.queue.length) return false;
      round.status = 'active';
      round.startedAt ||= stamp();
      this.state.sessions[round.id] = this.sessionMetadata(round);
      return true;
    }

    setOrder(order) {
      if (!['sequential', 'random'].includes(order)) return;
      this.state.settings.order = order;
      if (this.round().order !== order) this.restart(order);
    }

    setPracticeMode(mode) {
      if (!['dictation', 'spelling'].includes(mode)) return this.round();
      this.state.settings.practiceMode = mode;
      if (this.round().mode !== mode) return this.restart(this.round().order, mode);
      return this.round();
    }

    restart(order = this.round().order, mode = this.round().mode || this.state.settings.practiceMode) {
      const round = this.round();
      return this.prepare(round.source, order, { refs: round.baseQueue || round.queue,
        name: round.name, parentId: round.parentId, reviewDepth: round.reviewDepth,
        groupSnapshots: round.groupSnapshots, legacyEntries: round.legacyEntries,
        selectedWrongCount: round.selectedWrongCount, mode });
    }

    prepareWrong(ids, metadata = {}) {
      const selected = ids ? new Set(ids) : null;
      const refs = [], groupSnapshots = [], legacyEntries = {}, seenGroups = new Set(), seenWords = new Set();
      const items = this.sortedWrong().filter((item) => !selected || selected.has(item.id));
      for (const item of items) {
        const snapshot = item.lastGroupSnapshot;
        if (snapshot && this.validGroupSnapshot(snapshot) && !seenGroups.has(snapshot.id)
          && snapshot.members.every((member) => !seenWords.has(member.id))) {
          const groupRefs = snapshot.members.map((member) => {
            const liveBook = this.customBook(snapshot.bookId);
            const live = liveBook?.entries.find((row) => row.id === member.id);
            if (live) return `${snapshot.bookId}/${member.id}`;
            const ref = `legacy/${encodeURIComponent(snapshot.id)}/${member.id}`;
            legacyEntries[ref] = clone(member); return ref;
          });
          refs.push(...groupRefs); snapshot.members.forEach((member) => seenWords.add(member.id));
          groupSnapshots.push({ ...clone(snapshot), refs: groupRefs }); seenGroups.add(snapshot.id);
        } else if (!seenWords.has(item.id)) {
          const info = this.words.get(item.id), ref = info ? `${info.books[0]}/${item.id}` : `legacy/${item.id}`;
          refs.push(ref); seenWords.add(item.id); if (!info) legacyEntries[ref] = clone(item);
        }
      }
      const round = this.prepare('wrong', this.state.settings.order, { refs, groupSnapshots, legacyEntries,
        name: metadata.name || (selected ? `错题本 · 已选 ${items.length} 词` : '错题本'),
        selectedWrongCount: items.length, parentId: metadata.parentId || null, reviewDepth: metadata.reviewDepth || 0 });
      this.state.settings.bookId = 'wrong'; this.state.settings.order = round.order; return round;
    }

    reviewCurrentRound() {
      const round = this.round();
      const ids = [...new Set(round.results.filter((item) => !item.firstTry).map((item) => this.entry(item.ref)?.id).filter(Boolean))];
      if (!ids.length) return false;
      const depth = (round.reviewDepth || 0) + 1;
      this.prepareWrong(ids, { parentId: round.id, reviewDepth: depth, name: `错题本 · 复习第 ${depth} 轮` });
      this.select('wrong');
      return true;
    }

    setAnswer(answer) { this.round().answer = String(answer); this.round().invalid = false; }

    accepts(row, answer) {
      const value = normalize(answer);
      return Boolean(value) && [row.word, ...(row.aliases || [])].some((a) => normalize(a) === value);
    }

    record(result) {
      const round = this.round(), row = this.current();
      const group = this.currentGroup();
      this.state.records.unshift({ id: makeId(), roundId: round.id, questionId: `${round.id}/${round.index}`,
        wordId: row.id, word: row.word, ref: round.queue[round.index], bookId: round.source,
        bookName: round.name || this.books.get(round.source)?.name || '错题本', answer: round.answer,
        correctAnswer: row.word, result, at: stamp(), confusableGroupId: group?.id || null,
        confusableIndex: group ? group.refs.indexOf(round.queue[round.index]) : null, confusableSize: group?.refs.length || null,
        mode: round.mode === 'spelling' ? 'spelling' : 'dictation' });
    }

    markWrong(reason) {
      const round = this.round(), row = this.current();
      const existing = this.state.wrong[row.id];
      const questionId = `${round.id}/${round.index}`;
      const group = this.currentGroup();
      const sourceBookId = group?.bookId || (round.source !== 'wrong' ? round.source : null);
      const note = row.note || '';
      const groupSnapshot = group ? { ...clone(group), members: group.refs.map((ref, index) => clone(this.entry(ref) || group.members[index])) } : null;
      // The counting key belongs to this encounter, never to the word's global history.
      if (round.question.countedFor !== questionId) {
        this.state.wrong[row.id] = { id: row.id, word: row.word, translation: row.translation,
          aliases: row.aliases || [], ipaUK: row.ipaUK || '', speechText: row.speechText || row.word,
          count: (existing?.count || 0) + 1, bookIds: [...new Set([...(existing?.bookIds || []), ...(this.words.get(row.id)?.books || []), ...(sourceBookId ? [sourceBookId] : [])])],
          bookNames: { ...(existing?.bookNames || {}), ...Object.fromEntries((this.words.get(row.id)?.books || []).map((bookId) => [bookId, this.books.get(bookId)?.name || '旧版词条'])), ...(sourceBookId ? { [sourceBookId]: group?.bookName || this.books.get(sourceBookId)?.name || '旧版词条' } : {}) },
          note: note || existing?.note || '', notesByBook: { ...(existing?.notesByBook || {}), ...(sourceBookId && note ? { [sourceBookId]: note } : {}) },
          lastGroupSnapshot: groupSnapshot,
          lastAnswer: round.answer, lastAt: stamp(), lastReason: reason, legacy: !this.words.has(row.id) };
        round.question.counted = true;
        round.question.countedFor = questionId;
      } else if (existing) {
        existing.lastAt = stamp();
        existing.lastReason = reason;
        existing.notesByBook ||= {};
        if (note) { existing.note = note; if (sourceBookId) existing.notesByBook[sourceBookId] = note; }
        existing.lastGroupSnapshot = groupSnapshot;
        if (reason === 'wrong') existing.lastAnswer = round.answer;
      }
    }

    hint() {
      const round = this.round();
      if (round.status !== 'active' || !this.current()) return null;
      this.markWrong('hint');
      round.question.hinted = true;
      round.invalid = false;
      this.record('hint');
      return this.current();
    }

    submit() {
      const round = this.round(), row = this.current();
      if (round.status !== 'active' || !row || !normalize(round.answer)) return { result: 'empty' };
      if (!this.accepts(row, round.answer)) {
        round.invalid = true;
        if (round.mode === 'spelling') return { result: 'typing', row };
        this.markWrong('wrong');
        this.record('wrong');
        return { result: 'wrong', row };
      }
      this.record('correct');
      round.results.push({ ref: round.queue[round.index], answer: round.answer,
        firstTry: !round.question.counted, hinted: round.question.hinted });
      round.index++;
      round.answer = '';
      round.invalid = false;
      round.question = { counted: false, hinted: false };
      if (round.index === round.queue.length) {
        round.status = 'complete';
        round.completedAt = stamp();
      }
      this.state.sessions[round.id] = this.sessionMetadata(round);
      return { result: 'correct', row, complete: round.status === 'complete' };
    }

    history() {
      const groups = new Map();
      for (const meta of Object.values(this.state.sessions)) groups.set(meta.id, { ...meta, records: [], questionMap: new Map() });
      for (const round of Object.values(this.state.rounds)) {
        if (round.startedAt) groups.set(round.id, { ...this.sessionMetadata(round), records: [], questionMap: new Map() });
      }
      for (const record of [...this.state.records].reverse()) {
        const legacy = !record.roundId || record.roundId === 'legacy';
        const id = legacy ? `legacy/${record.bookId || 'unknown'}/${record.at.slice(0, 10)}` : record.roundId;
        if (!groups.has(id)) groups.set(id, { id, source: record.bookId, name: record.bookName,
          startedAt: record.at, completedAt: null, status: legacy ? 'legacy' : 'archived',
          total: null, inferredStart: true, mode: record.mode === 'spelling' ? 'spelling' : 'dictation', records: [], questionMap: new Map() });
        const group = groups.get(id);
        if (group.inferredStart && record.at < group.startedAt) group.startedAt = record.at;
        group.records.push(record);
        const questionId = record.questionId || record.id;
        if (!group.questionMap.has(questionId)) group.questionMap.set(questionId, {
          id: questionId, word: record.word, wordId: record.wordId, ref: record.ref,
          wrong: false, correct: false, records: [], firstAt: record.at,
        });
        const question = group.questionMap.get(questionId);
        question.records.push(record);
        question.wrong ||= record.result !== 'correct';
        question.correct ||= record.result === 'correct';
        if (record.at < question.firstAt) question.firstAt = record.at;
      }
      return [...groups.values()].map((group) => {
        const questions = [...group.questionMap.values()].map((question) => {
          question.records.sort((a, b) => a.at.localeCompare(b.at));
          return question;
        }).sort((a, b) => a.firstAt.localeCompare(b.firstAt));
        return { ...group, questionMap: undefined, questions,
          correct: questions.filter((q) => q.correct && !q.wrong).length,
          firstTry: questions.filter((q) => q.correct && !q.wrong).length,
          wrong: questions.filter((q) => q.wrong).length,
          done: questions.filter((q) => q.correct).length,
          total: group.total ?? questions.length };
      }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }

    removeWrong(id) {
      // Keep a snapshot used by an active legacy queue even after removal.
      const legacy = this.state.wrong[id];
      if (legacy?.legacy) {
        this.entries.set(`legacy/${id}`, { ...legacy });
        for (const round of Object.values(this.state.rounds)) {
          if (round.queue.includes(`legacy/${id}`)) round.legacyEntries = { ...(round.legacyEntries || {}), [id]: { ...legacy } };
        }
      }
      delete this.state.wrong[id];
    }

    roundReviewItems(roundId = this.round()?.id) {
      const round = Object.values(this.state.rounds).find((item) => item.id === roundId);
      if (!round) return [];
      return round.results.map((result, index) => {
        if (result.firstTry) return null;
        const ref = result.ref;
        const wordId = this.entry(ref)?.id || ref.split('/').at(-1);
        const records = [...this.state.records].reverse()
          .filter((record) => record.roundId === round.id && record.questionId === `${round.id}/${index}`);
        const wrong = this.state.wrong[wordId];
        const row = this.entry(ref) || round.legacyEntries?.[ref] || round.legacyEntries?.[wordId] || wrong || {};
        const seen = new Set(), wrongAnswers = [];
        for (const record of records.filter((record) => record.result === 'wrong')) {
          const key = normalize(record.answer);
          if (key && !seen.has(key)) { seen.add(key); wrongAnswers.push(record.answer); }
        }
        const grouped = records.find((record) => record.confusableGroupId);
        return {
          ref, id: row.id || wordId, word: row.word || records.at(-1)?.correctAnswer || result.answer,
          translation: row.translation || wrong?.translation || '', ipaUK: row.ipaUK || wrong?.ipaUK || '',
          note: row.note || wrong?.note || '', speechText: row.speechText || row.word || records.at(-1)?.correctAnswer || result.answer,
          wrongAnswers, hinted: Boolean(result.hinted || records.some((record) => record.result === 'hint')),
          count: wrong?.count || 0,
          group: grouped ? { id: grouped.confusableGroupId, index: Number(grouped.confusableIndex), size: Number(grouped.confusableSize) } : null,
        };
      }).filter(Boolean);
    }

    summary() {
      const round = this.round();
      const correct = round.results.filter((r) => r.firstTry).length;
      return { done: round.index, total: round.queue.length, firstTry: correct, review: round.index - correct };
    }

    export() { return clone(this.state); }
  }

  root.DictationCore = { Engine, normalize };
})(globalThis);
