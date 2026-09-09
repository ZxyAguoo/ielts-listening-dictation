(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'listening-vocab-state-v3';
  const DATA = window.VOCAB_DATA;
  const RELEASE = window.APP_RELEASE || null;
  const { Engine, normalize } = window.DictationCore;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name) => `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  const wordSizeClass = (word) => String(word || '').length > 40 ? 'word-very-long' : String(word || '').length > 24 ? 'word-long' : '';
  const THEMES = ['neutral', 'apricot', 'sage', 'blue', 'lavender', 'rose'];
  const PAGE_SIZE = 50;
  const gridPageSize = () => window.innerWidth >= 1360 ? 52 : window.innerWidth >= 1101 ? 51 : 50;
  let storageError = '', toastTimer, saveTimer, voices = [], speechToken = 0, currentUtterance = null;
  let speechWatchdog, speechStartTimer, wrongReplayTimer, view = 'home', bookPage = 0, wrongPage = 0, historyPage = 0, invalidAnswer = false;
  let successTimer = 0, successState = null, historySessionId = null, historyWrongOnly = false;
  let vocabularyPageSize = gridPageSize(), layoutTimer = 0, peekTimer = 0, activePeek = null;
  let pendingReleaseVersion = '', updateNoticeShown = false;
  const wrongSelection = new Set();
  let managingBookId = null, editingEntryId = null, batchPreview = [], singleIpaSource = 'unavailable', confusableIpaSource = 'unavailable';
  const { lookup: lookupIpa, parseBatch } = window.CustomLexicon;

  function read(key, fallback = null) {
    try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
    catch { return fallback; }
  }
  function rawRead(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function toast(message, duration = 4500) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
  }
  const rawSaved = rawRead(KEY);
  let engine;
  try { engine = new Engine(DATA, rawSaved ? JSON.parse(rawSaved) : null); }
  catch { engine = new Engine(DATA); storageError = '原记录暂时无法读取，已保留原数据。请先导出备份。'; }
  try {
    if (rawSaved && !localStorage.getItem('listening-vocab-before-v3-1')) {
      localStorage.setItem('listening-vocab-before-v3-1', rawSaved);
    }
  } catch { storageError ||= '旧版记录仍保留，但无法建立额外升级备份。'; }
  if (!rawSaved) {
    const oldWrong = read('listening-vocab-wrongbook-v2', []);
    const oldRecords = read('listening-vocab-records-v2', []);
    engine.migrate(oldWrong, oldRecords, { voice: rawRead('listening-vocab-voice-uri') || '' });
    try {
      if (!localStorage.getItem('listening-vocab-legacy-backup-v3') && (oldWrong.length || oldRecords.length)) {
        localStorage.setItem('listening-vocab-legacy-backup-v3', JSON.stringify({ wrongbook: oldWrong, records: oldRecords }));
      }
    } catch { storageError = '浏览器未允许保存记录；本次记录可导出备份。'; }
  }
  function save() {
    clearTimeout(saveTimer);
    if (rawSaved && storageError.startsWith('原记录')) return;
    try { localStorage.setItem(KEY, JSON.stringify(engine.export())); }
    catch { if (!storageError) { storageError = '本地存储空间不足或未获允许，请导出备份以保留本次记录。'; toast(storageError, 9000); } }
  }
  function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 200); }
  const bookName = (id) => engine.books.get(id)?.name || (id === 'wrong' ? '错题本' : '旧版词条');
  const timeText = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };
  function applyTheme(theme, persist = false) {
    const selected = THEMES.includes(theme) ? theme : 'lavender';
    engine.state.settings.theme = selected; document.documentElement.dataset.theme = selected;
    document.querySelectorAll('[data-theme-option]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.themeOption === selected)));
    if (persist) save();
  }
  function closeThemePicker(returnFocus = false) {
    $('themePopover').hidden = true; $('themeButton').setAttribute('aria-expanded', 'false');
    if (returnFocus) $('themeButton').focus();
  }
  function resetListScroll(id) { const target = $(id); if (target) target.scrollTop = 0; }
  const isMac = () => /Macintosh|Mac OS X/i.test(navigator.userAgent || '');
  const noVoiceHelp = () => isMac()
    ? '未检测到英式声音。请在 Mac 的“系统设置 → 辅助功能 → 朗读与语音 → 系统声音”中添加 English (UK)，然后重新打开浏览器。'
    : '未检测到英式声音，请在系统或浏览器中安装 English (UK) 语音包。';

  async function checkForUpdate() {
    if (!RELEASE || location.protocol !== 'https:') return;
    try {
      const url = new URL('./version.json', location.href); url.searchParams.set('_', String(Date.now()));
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const latest = await response.json();
      if (!latest.version || latest.version === RELEASE.version) return;
      pendingReleaseVersion = latest.version; save();
      $('updateButton').hidden = false;
      $('updateButton').dataset.tooltip = `更新到 ${latest.version}`;
      $('updateButton').setAttribute('aria-label', `发现新版本 ${latest.version}，点击更新`);
      if (!updateNoticeShown) {
        updateNoticeShown = true;
        toast(engine.round().status === 'active'
          ? '发现新版本。当前输入已保存，可完成本轮后再点击侧栏更新。'
          : '发现新版本，点击侧栏的更新按钮即可刷新。', 8000);
      }
    } catch {}
  }
  function configureRelease() {
    if (!RELEASE) return;
    const hasLogout = RELEASE.auth === true || Boolean(RELEASE.logoutUrl);
    $('logoutButton').hidden = !hasLogout;
    if (hasLogout) {
      $('logoutButton').onclick = async () => {
        save(); cancelSpeech();
        try { await fetch(RELEASE.logoutUrl || './auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
        location.assign(RELEASE.loginUrl || './login.html');
      };
    }
    $('updateButton').onclick = () => {
      if (engine.round().status === 'active' && !confirm('当前听写尚未完成。已保存当前输入，确定现在刷新更新吗？')) return;
      save(); location.reload();
    };
    checkForUpdate();
    setInterval(checkForUpdate, 30 * 60 * 1000);
  }

  function populateBooks() {
    for (const target of [$('bookSelect'), $('libraryBookSelect')]) {
      target.replaceChildren();
      for (const category of [...new Set(DATA.books.map((book) => book.category))]) {
        const group = document.createElement('optgroup'); group.label = category;
        for (const book of DATA.books.filter((b) => b.category === category)) group.append(new Option(`${book.name} · ${book.entries.length} 词`, book.id));
        target.append(group);
      }
      if (engine.state.customBooks.length) {
        const group = document.createElement('optgroup'); group.label = '我的词书';
        for (const book of engine.state.customBooks) group.append(new Option(`${book.name} · ${book.entries.length} 词`, book.id));
        target.append(group);
      }
      if (target.id === 'bookSelect') target.append(new Option('错题本', 'wrong'));
    }
    $('bookSelect').value = engine.state.settings.bookId;
    $('libraryBookSelect').value = engine.state.settings.libraryBookId;
    $('hideEnglish').checked = Boolean(engine.state.settings.hideEnglish);
    $('hideChinese').checked = Boolean(engine.state.settings.hideChinese);
  }

  function cancelSpeech() {
    speechToken++; clearTimeout(speechWatchdog); clearTimeout(speechStartTimer); clearTimeout(wrongReplayTimer);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    currentUtterance = null; document.querySelectorAll('.speaking').forEach((el) => { el.classList.remove('speaking'); el.removeAttribute('aria-busy'); });
  }
  function selectedVoice() { return voices.find((v) => v.voiceURI === engine.state.settings.voiceURI) || voices[0]; }
  function speak(row, control) {
    refreshVoices(false);
    const voice = selectedVoice();
    if (!row) { toast('没有找到这个词条。'); return false; }
    if (!voice) { toast(noVoiceHelp(), 9000); return false; }
    cancelSpeech(); const token = speechToken; const target = control || $('replayButton');
    const utterance = new SpeechSynthesisUtterance(row.speechText || row.word); currentUtterance = utterance;
    utterance.lang = 'en-GB'; utterance.voice = voice; utterance.rate = 0.86; utterance.pitch = 1;
    let started = false;
    const end = () => { if (speechToken === token) { target?.classList.remove('speaking'); target?.removeAttribute('aria-busy'); currentUtterance = null; clearTimeout(speechWatchdog); clearTimeout(speechStartTimer); } };
    utterance.onstart = () => { if (token === speechToken) { started = true; target?.classList.add('speaking'); target?.setAttribute('aria-busy', 'true'); clearTimeout(speechStartTimer); } };
    utterance.onend = end;
    utterance.onerror = (event) => { end(); if (token === speechToken && !['interrupted', 'canceled'].includes(event.error)) toast('声音播放失败，请重读或更换英式声音。'); };
    window.speechSynthesis.resume?.();
    speechStartTimer = setTimeout(() => { if (!started && speechToken === token) toast('声音未开始播放，请重读或更换顶部的英式声音。'); }, 5000);
    speechWatchdog = setTimeout(end, 20000);
    // Let cancellation settle before starting the replacement utterance.
    setTimeout(() => { if (speechToken === token) window.speechSynthesis.speak(utterance); }, 35);
    return true;
  }
  function refreshVoices(render = true) {
    const available = ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window)
      ? window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().replace('_', '-') === 'en-gb') : [];
    if (available.length || !voices.length) voices = available;
    voices.sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
    const select = $('voiceSelect'); select.replaceChildren();
    if (!voices.length) {
      select.append(new Option('未检测到英式声音', '')); select.disabled = true;
      $('voiceNotice').textContent = noVoiceHelp(); $('voiceNotice').classList.add('warning');
    } else {
      for (const voice of voices) select.append(new Option(`${voice.name.replace(/ - English \(.*\)/i, '')}${voice.localService ? '' : ' · 在线'}`, voice.voiceURI));
      select.disabled = false; const voice = selectedVoice(); engine.state.settings.voiceURI = voice.voiceURI; select.value = voice.voiceURI;
      $('voiceNotice').textContent = voice.localService ? '' : '当前所选声音需要联网。'; $('voiceNotice').classList.remove('warning');
    }
    if (render) { syncVoiceButtons(); save(); }
  }
  function syncVoiceButtons() {
    $('replayButton').disabled = !voices.length; $('startButton').disabled = !voices.length || engine.round().queue.length === 0; $('againButton').disabled = !voices.length;
    document.querySelectorAll('[data-card-play]').forEach((card) => {
      card.classList.toggle('audio-unavailable', !voices.length); card.setAttribute('aria-disabled', String(!voices.length));
    });
  }

  function clearSuccess() {
    clearTimeout(successTimer); successTimer = 0; successState = null;
    $('answerInput').readOnly = false; $('answerInput').classList.remove('correct');
  }

  function setView(next) {
    if (!['home', 'books', 'wrong'].includes(next)) next = 'home';
    if (view !== next) { cancelSpeech(); clearSuccess(); } view = next;
    for (const name of ['home', 'books', 'wrong']) $(name + 'View').hidden = next !== name;
    document.querySelectorAll('[data-nav]').forEach((a) => { a.classList.toggle('active', a.dataset.nav === next); if (a.dataset.nav === next) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (next === 'home') renderRound(); else if (next === 'books') renderBooks(); else renderWrong();
    if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`); updateBadge();
  }
  function updateBadge() {
    const count = Object.keys(engine.state.wrong).length; $('wrongBadge').textContent = count ? String(count) : '';
    $('bookSelect').querySelector('option[value="wrong"]').textContent = `错题本 · ${count} 词`;
  }
  function focusAnswer() { if (view === 'home' && engine.round().status === 'active') $('answerInput').focus({ preventScroll: true }); }
  function fitAnswer() { const input = $('answerInput'); input.style.height = 'auto'; input.style.height = `${Math.max(innerWidth <= 650 ? 60 : 70, Math.min(180, input.scrollHeight))}px`; }
  function renderAnswerArea(round, showingSuccess) {
    const input = $('answerInput'), grid = $('groupAnswerGrid'), single = $('singleAnswerSlot');
    if (!single.contains(input)) single.append(input);
    grid.replaceChildren();
    const focusRef = showingSuccess ? successState.ref : round.queue[round.index];
    const group = focusRef ? engine.groupForRef(focusRef, round) : null;
    $('answerForm').classList.toggle('grouped', Boolean(group));
    single.hidden = Boolean(group); grid.hidden = !group;
    if (!group) return null;
    grid.dataset.size = String(group.refs.length);
    for (const [index, ref] of group.refs.entries()) {
      const result = round.results.find((item) => item.ref === ref), slot = document.createElement('div');
      slot.className = 'group-answer-slot'; slot.innerHTML = `<span>${index + 1}</span>`;
      if (ref === focusRef) slot.append(input);
      else {
        const line = document.createElement('textarea'); line.rows = 1; line.readOnly = true; line.tabIndex = -1;
        line.className = `group-answer-line ${result ? 'correct completed' : 'pending'}`;
        line.value = result?.answer || ''; line.setAttribute('aria-label', result ? `第 ${index + 1} 个词已完成` : `第 ${index + 1} 个词尚未开始`);
        slot.append(line);
      }
      grid.append(slot);
    }
    return group;
  }
  function renderRoundReview(round) {
    const items = round.status === 'complete' ? engine.roundReviewItems(round.id) : [];
    $('roundReviewPanel').hidden = items.length === 0; $('roundReviewCount').textContent = `${items.length} 词`;
    $('roundReviewRows').innerHTML = items.map((item) => {
      const attempts = item.wrongAnswers.length
        ? `<div class="review-errors"><span>错误输入</span><div>${item.wrongAnswers.map((answer) => `<strong>${esc(answer)}</strong>`).join('')}</div></div>`
        : `<div class="review-errors empty-attempt"><span>错误输入</span><p>使用提示，未提交错误拼写</p></div>`;
      const group = item.group ? `<span class="group-badge">易混 ${item.group.index + 1}/${item.group.size}</span>` : '';
      return `<article class="review-card" role="listitem"><div class="review-card-head"><button class="review-word ${wordSizeClass(item.word)}" data-play="${esc(item.ref)}">${esc(item.word)}</button>${playButton(item.ref)}</div><div class="ipa">${esc(item.ipaUK || '暂无音标')}</div><p class="review-meaning">${esc(item.translation || '暂无释义')}</p>${item.note ? `<div class="word-note"><span>备注</span>${esc(item.note)}</div>` : ''}${attempts}<div class="review-meta"><span>累计 ${item.count} 次错误</span>${item.hinted ? '<span class="hint-used">使用过提示</span>' : ''}${group}</div></article>`;
    }).join('');
  }
  function renderRound() {
    const round = engine.round(); invalidAnswer = Boolean(round.invalid); const summary = engine.summary(); $('bookSelect').value = engine.state.settings.bookId;
    const showingSuccess = successState?.roundId === round.id;
    const completeVisible = round.status === 'complete' && !showingSuccess;
    document.querySelectorAll('[data-order]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.order === round.order)));
    $('readyState').hidden = round.status !== 'ready'; $('activeState').hidden = round.status !== 'active' && !showingSuccess; $('completeState').hidden = round.status !== 'complete' || showingSuccess;
    $('practiceStage').classList.toggle('complete-mode', completeVisible); $('practiceCenter').classList.toggle('complete-mode', completeVisible); $('previousWord').hidden = completeVisible;
    $('readyBook').textContent = round.name || bookName(round.source); $('readyTitle').textContent = round.queue.length ? '准备听写' : round.source === 'wrong' ? '暂无错题' : '暂无词条';
    $('readyCount').textContent = round.queue.length ? (round.source === 'wrong' && round.selectedWrongCount && round.selectedWrongCount !== round.queue.length
      ? `选择了 ${round.selectedWrongCount} 个错词，扩展为 ${round.queue.length} 个听写词` : `${round.queue.length} 个单词`) : '';
    $('startButton').hidden = !round.queue.length; $('restartButton').disabled = !round.queue.length; $('previousWord').replaceChildren();
    const focusRef = showingSuccess ? successState.ref : round.queue[round.index];
    const displayGroup = focusRef ? engine.groupForRef(focusRef, round) : null;
    const groupStart = displayGroup ? Math.min(...displayGroup.refs.map((ref) => round.queue.indexOf(ref)).filter((index) => index >= 0)) : -1;
    const previousResultIndex = displayGroup ? groupStart - 1 : round.results.length - (showingSuccess ? 2 : 1);
    const previousResult = previousResultIndex >= 0 ? round.results[previousResultIndex] : null;
    const previous = previousResult ? engine.entry(previousResult.ref) : null;
    if (previous && !completeVisible) $('previousWord').innerHTML = `<button type="button" data-play="${esc(previousResult.ref)}" aria-label="重读上一词 ${esc(previous.word)}">${icon('corner-up-left')}${esc(previous.word)}</button><div class="ipa">${esc(previous.ipaUK)}</div><p>${esc(previous.translation)}</p>`;
    const row = showingSuccess ? successState.row : engine.current();
    $('hintAnswer').innerHTML = !showingSuccess && round.question.hinted && row ? `<span>${esc(row.word)}</span><span class="ipa">${esc(row.ipaUK)}</span>` : '';
    $('answerInput').value = showingSuccess ? successState.answer : round.answer;
    $('answerInput').readOnly = showingSuccess;
    $('answerInput').classList.toggle('invalid', !showingSuccess && invalidAnswer);
    $('answerInput').classList.toggle('correct', showingSuccess);
    $('answerInput').setAttribute('aria-invalid', String(!showingSuccess && invalidAnswer));
    $('answerFeedback').textContent = showingSuccess ? '拼写正确' : invalidAnswer ? '拼写不正确' : '';
    $('answerFeedback').classList.toggle('correct', showingSuccess);
    $('hintButton').disabled = showingSuccess;
    renderAnswerArea(round, showingSuccess);
    $('progressBook').textContent = round.name || bookName(round.source); $('progressBar').max = Math.max(1, summary.total); $('progressBar').value = summary.done; $('progressCount').textContent = `${summary.done} / ${summary.total}`;
    $('completeStats').innerHTML = `<div><strong>${summary.done}</strong><span>完成单词</span></div><div><strong>${summary.firstTry}</strong><span>首次正确</span></div><div><strong>${summary.review}</strong><span>需要复习</span></div>`;
    renderRoundReview(round);
    $('reviewRoundButton').disabled = summary.review === 0; fitAnswer(); syncVoiceButtons(); updateBadge();
    if (pendingReleaseVersion && round.status === 'complete' && updateNoticeShown) {
      updateNoticeShown = false; toast('本轮已完成。可点击侧栏的更新按钮加载新版本。', 8000);
    }
  }
  function start() {
    refreshVoices();
    if (!voices.length) { toast('请先选择可用的英式声音。'); return; }
    if (engine.start()) { invalidAnswer = false; renderRound(); save(); focusAnswer(); speak(engine.current()); }
  }
  function submit() {
    if (successState) return;
    const submittedRef = engine.round().queue[engine.round().index];
    engine.setAnswer($('answerInput').value); const result = engine.submit(); if (result.result === 'empty') return;
    invalidAnswer = result.result === 'wrong';
    if (result.result === 'correct') {
      successState = { roundId: engine.round().id, ref: submittedRef, row: result.row, answer: $('answerInput').value, complete: result.complete };
      renderRound(); save();
      successTimer = setTimeout(() => {
        const state = successState; clearSuccess(); renderRound(); save(); focusAnswer();
        if (!state?.complete && view === 'home') speak(engine.current()); else if (state?.complete) cancelSpeech();
      }, 500);
    } else {
      const roundId = engine.round().id;
      engine.hint();
      engine.round().invalid = true;
      invalidAnswer = true;
      renderRound(); save(); focusAnswer();
      wrongReplayTimer = setTimeout(() => {
        const round = engine.round();
        if (view === 'home' && round.status === 'active' && round.id === roundId && round.queue[round.index] === submittedRef) speak(engine.current());
      }, 180);
    }
  }

  function hint() {
    if (successState || engine.round().status !== 'active') return;
    engine.setAnswer($('answerInput').value); engine.hint(); invalidAnswer = false; renderRound(); save(); focusAnswer();
  }
  function paginate(target, total, page, onChange, pageSize = PAGE_SIZE) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    target.innerHTML = `<button class="icon-button" aria-label="上一页" ${page === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><span>${page + 1} / ${pages}</span><button class="icon-button" aria-label="下一页" ${page >= pages - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>`;
    const buttons = target.querySelectorAll('button'); buttons[0].onclick = () => onChange(page - 1); buttons[1].onclick = () => onChange(page + 1);
  }
  function playButton(ref) { return `<button class="icon-button" data-play="${esc(ref)}" aria-label="播放英式发音" data-tooltip="英式发音">${icon('volume-2')}</button>`; }
  function ipaMarkup(row) {
    if (!row.ipaUK) return '';
    return `<span class="ipa">${esc(row.ipaUK)}${row.ipaSource === 'composed' ? '<small class="ipa-source">逐词生成</small>' : ''}</span>`;
  }
  function wordMarkup(row, custom) {
    const classes = `word-button ${wordSizeClass(row.word)}`;
    return custom
      ? `<button class="${classes}" data-open-custom="${esc(row.id)}" data-open-custom-book="${esc(custom.id)}" aria-label="编辑 ${esc(row.word)}">${esc(row.word)}</button>`
      : `<strong class="${classes}">${esc(row.word)}</strong>`;
  }
  function peekMarkup(kind, label, reveal) {
    return `<div class="peek-field peek-${kind}" data-peek-field><span class="peek-mask">••••••</span><div class="peek-reveal">${reveal}</div><button type="button" class="peek-button" data-peek aria-label="长按预览${label}" aria-pressed="false" data-tooltip="长按预览">${icon('eye')}</button></div>`;
  }
  function stopPeek() {
    clearTimeout(peekTimer); peekTimer = 0;
    if (activePeek) { activePeek.field.classList.remove('is-peeking'); activePeek.button.setAttribute('aria-pressed', 'false'); }
    activePeek = null;
  }
  function startPeek(button, immediate = false) {
    stopPeek(); const field = button.closest('[data-peek-field]'); if (!field) return;
    activePeek = { button, field };
    const reveal = () => { if (activePeek?.button === button) { field.classList.add('is-peeking'); button.setAttribute('aria-pressed', 'true'); } };
    if (immediate) reveal(); else peekTimer = setTimeout(reveal, 500);
  }
  function renderBooks() {
    stopPeek(); const pageSize = vocabularyPageSize;
    const settings = engine.state.settings; const book = engine.books.get(settings.libraryBookId); const query = normalize($('bookSearch').value); const globalSearch = Boolean(query);
    const sourceBooks = globalSearch ? [...engine.books.values()] : [book];
    const rows = sourceBooks.flatMap((sourceBook) => sourceBook.entries.map((row, index) => ({ row, index, sourceBook, custom: engine.customBook(sourceBook.id) })))
      .filter(({ row }) => normalize(`${row.word} ${row.translation} ${row.note || ''} ${(row.aliases || []).join(' ')}`).includes(query));
    bookPage = Math.min(bookPage, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    $('libraryName').textContent = globalSearch ? '全词书搜索' : book.name;
    $('libraryCount').textContent = globalSearch ? `${rows.length} 个结果 · ${new Set(rows.map(({ sourceBook }) => sourceBook.id)).size} 本词书` : `${book.entries.length} 词`;
    $('manageBookButton').hidden = !engine.customBook(book.id); $('practiceBookButton').disabled = !book.entries.length;
    $('bookRows').innerHTML = rows.slice(bookPage * pageSize, (bookPage + 1) * pageSize).map(({ row, index, sourceBook, custom }, pageIndex) => {
      const ref = `${sourceBook.id}/${row.id}`; const meaning = settings.hideEnglish ? row.translation.replace(/（=[^）]*）/g, '').replace(/[A-Za-z]+(?:[ '-][A-Za-z]+)*/g, '') : row.translation;
      const group = custom ? engine.confusableGroup(sourceBook.id, row.id) : null;
      const note = row.note ? `<div class="word-note"><span>备注</span>${esc(row.note)}</div>` : '';
      const lexical = `<div class="lexical-line">${wordMarkup(row, custom)}${ipaMarkup(row)}</div>`;
      const source = globalSearch ? `<div class="book-source">所属词书：${esc(sourceBook.name)}</div>` : '';
      const translation = `<div class="meaning">${esc(meaning)}</div>${note}`;
      return `<tr class="vocab-card book-card" data-book-item data-card-play="${esc(ref)}" tabindex="0" aria-label="播放 ${esc(row.word)} 的英式发音"><td class="number-col">${globalSearch ? bookPage * pageSize + pageIndex + 1 : index + 1}</td><td class="card-lexical">${settings.hideEnglish ? peekMarkup('english', '英文和音标', lexical) : lexical}${group ? `<span class="group-badge">易混 ${group.memberIds.length}</span>` : ''}</td><td class="card-meaning">${settings.hideChinese ? peekMarkup('chinese', '中文和备注', translation) : translation}${source}</td></tr>`;
    }).join('');
    $('bookEmpty').hidden = rows.length !== 0; paginate($('bookPagination'), rows.length, bookPage, (page) => { bookPage = page; renderBooks(); resetListScroll('bookListScroll'); }, pageSize); syncVoiceButtons();
  }
  function renderWrong() {
    stopPeek(); const pageSize = vocabularyPageSize;
    const query = normalize($('wrongSearch').value); const all = engine.sortedWrong(); const rows = all.filter((row) => normalize(`${row.word} ${row.translation} ${row.note || ''} ${Object.values(row.notesByBook || {}).join(' ')} ${row.lastAnswer}`).includes(query));
    for (const id of [...wrongSelection]) if (!engine.state.wrong[id]) wrongSelection.delete(id);
    wrongPage = Math.min(wrongPage, Math.max(0, Math.ceil(rows.length / pageSize) - 1)); $('wrongTotal').textContent = `${all.length} 词`;
    $('practiceAllWrongButton').disabled = !all.length; $('practiceWrongButton').disabled = !wrongSelection.size;
    $('practiceSelectedLabel').textContent = wrongSelection.size ? `听写所选 · ${wrongSelection.size}` : '听写所选';
    $('wrongSelectionCount').textContent = `已选 ${wrongSelection.size} 词`;
    const filteredIds = rows.map((row) => row.id); const selectedFiltered = filteredIds.filter((id) => wrongSelection.has(id)).length;
    $('wrongSelectAll').checked = Boolean(filteredIds.length) && selectedFiltered === filteredIds.length;
    $('wrongSelectAll').indeterminate = selectedFiltered > 0 && selectedFiltered < filteredIds.length;
    $('wrongSelectAllLabel').textContent = query ? '全选搜索结果' : '全选';
    const ascending = engine.state.settings.wrongSort === 'asc';
    $('wrongSortButton').innerHTML = `${icon(ascending ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow')}<span>错误次数从${ascending ? '低到高' : '高到低'}</span>`;
    $('wrongSortButton').setAttribute('aria-label', `当前错误次数从${ascending ? '低到高' : '高到低'}，点击切换排序`);
    $('wrongRows').innerHTML = rows.slice(wrongPage * pageSize, (wrongPage + 1) * pageSize).map((row) => {
      const ref = engine.words.has(row.id) ? `${engine.words.get(row.id).books[0]}/${row.id}` : `legacy/${row.id}`;
      const notes = [...new Set(Object.values(row.notesByBook || {}).concat(row.note || '').map((note) => String(note || '').trim()).filter(Boolean))];
      return `<tr class="vocab-card wrong-card" data-wrong-item data-card-play="${esc(ref)}" tabindex="0" aria-label="播放 ${esc(row.word)} 的英式发音"><td class="wrong-select-cell"><input type="checkbox" data-select-wrong="${esc(row.id)}" aria-label="选择 ${esc(row.word)}" ${wrongSelection.has(row.id) ? 'checked' : ''}></td><td class="wrong-lexical"><div class="lexical-line"><strong class="word-button ${wordSizeClass(row.word)}">${esc(row.word)}</strong>${ipaMarkup(row)}</div><div class="meaning">${esc(row.translation)}</div>${notes.length ? `<div class="word-note"><span>备注</span>${notes.map(esc).join('；')}</div>` : ''}</td><td class="book-membership">${(row.bookIds.length ? row.bookIds.map((id) => engine.books.get(id)?.name || row.bookNames?.[id] || bookName(id)) : ['旧版词条']).map(esc).join('<br>')}</td><td class="frequency">${row.count}</td><td class="wrong-recent"><div class="last-answer">${row.lastAnswer ? esc(row.lastAnswer) : '未填写'}</div><div class="timestamp">${esc(timeText(row.lastAt))}${row.lastReason === 'hint' ? '<br>使用过提示' : ''}</div></td><td class="card-actions"><button class="icon-button" data-remove="${esc(row.id)}" aria-label="移除错题 ${esc(row.word)}" data-tooltip="移除">${icon('x')}</button></td></tr>`;
    }).join('');
    $('wrongEmpty').hidden = rows.length !== 0; $('wrongEmpty').querySelector('p').textContent = query ? '没有找到匹配的错题' : '暂无错题';
    paginate($('wrongPagination'), rows.length, wrongPage, (page) => { wrongPage = page; renderWrong(); resetListScroll('wrongListScroll'); }, pageSize); updateBadge(); syncVoiceButtons();
  }
  function renderHistory() {
    const sessions = engine.history(); const query = normalize($('historySearch').value);
    const session = historySessionId ? sessions.find((item) => item.id === historySessionId) : null;
    $('historyBack').hidden = !session; $('historyRoundOverview').hidden = !session;
    $('historyRoundTable').hidden = Boolean(session); $('historyDetailTable').hidden = !session;
    $('historyTitle').textContent = session ? session.name : '听写记录';
    if (!session) {
      const rows = sessions.filter((item) => normalize(`${item.name} ${item.questions.map((q) => q.word).join(' ')}`).includes(query));
      historyPage = Math.min(historyPage, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1)); $('historyCount').textContent = `${rows.length} 轮`;
      $('historyRows').innerHTML = rows.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE).map((item) => {
        const status = item.status === 'complete' ? '已完成' : item.status === 'active' ? '进行中' : item.status === 'legacy' ? '旧版导入' : '已结束';
        return `<tr><td><button class="session-link" data-history-open="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${esc(timeText(item.startedAt))}${item.inferredStart ? ' · 由首条记录恢复' : ''}</span></button></td><td class="result-correct">${item.correct}</td><td><button class="wrong-count-link" data-history-open="${esc(item.id)}" data-history-wrong="true" ${item.wrong ? '' : 'disabled'}>${item.wrong}</button></td><td><span>${item.done} / ${item.total}</span><small>${status}</small></td><td><button class="icon-button" data-history-open="${esc(item.id)}" aria-label="查看本轮"><svg><use href="#icon-chevron-right"></use></svg></button></td></tr>`;
      }).join('');
      $('historyEmpty').hidden = rows.length !== 0; $('historyEmpty').textContent = query ? '没有找到匹配的听写轮次' : '暂无听写记录';
      paginate($('historyPagination'), rows.length, historyPage, (page) => { historyPage = page; renderHistory(); });
      return;
    }
    $('historyAllWords').setAttribute('aria-pressed', String(!historyWrongOnly)); $('historyWrongWords').setAttribute('aria-pressed', String(historyWrongOnly));
    $('historyRoundMeta').textContent = `${timeText(session.startedAt)} · 完成 ${session.done}/${session.total} · 首次正确 ${session.correct} · 错题 ${session.wrong}`;
    const questions = session.questions.filter((item) => (!historyWrongOnly || item.wrong) && normalize(`${item.word} ${item.records.map((r) => r.answer).join(' ')}`).includes(query));
    historyPage = Math.min(historyPage, Math.max(0, Math.ceil(questions.length / PAGE_SIZE) - 1)); $('historyCount').textContent = `${questions.length} 词`;
    $('historyDetailRows').innerHTML = questions.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE).map((question) => {
      const correctAnswer = question.records.at(-1)?.correctAnswer || question.word;
      const grouped = question.records.find((record) => record.confusableGroupId);
      const result = question.wrong ? (question.correct ? '已改对' : '待复习') : '首次正确';
      const records = question.records.map((record) => `<div><time>${esc(timeText(record.at))}</time><span class="result-${esc(record.result)}">${({ correct: '正确', wrong: '错误', hint: '提示', blank: '未填写' })[record.result]}</span><strong>${esc(record.answer || '未填写')}</strong></div>`).join('');
      const resultClass = question.wrong ? (question.correct ? 'result-review' : 'result-wrong') : 'result-correct';
      return `<tr><td><strong>${esc(question.word)}</strong><span>${esc(correctAnswer)}</span>${grouped ? `<small class="history-group-label">易混词组 ${Number(grouped.confusableIndex) + 1}/${grouped.confusableSize}</small>` : ''}</td><td><details ${question.records.length === 1 ? 'open' : ''}><summary>${question.records.length} 次提交</summary><div class="attempt-list">${records}</div></details></td><td class="${resultClass}">${result}</td></tr>`;
    }).join('');
    $('historyEmpty').hidden = questions.length !== 0; $('historyEmpty').textContent = '本轮没有符合条件的词条';
    paginate($('historyPagination'), questions.length, historyPage, (page) => { historyPage = page; renderHistory(); });
  }
  function practice(source) { cancelSpeech(); clearSuccess(); engine.select(source); invalidAnswer = false; save(); setView('home'); window.scrollTo({ top: 0 }); }
  function practiceWrong(ids) {
    cancelSpeech(); clearSuccess(); engine.prepareWrong(ids); invalidAnswer = false; save(); setView('home'); window.scrollTo({ top: 0 });
  }
  function download(filename, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' })); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup(prefix = '听写备份') {
    save(); const content = storageError.startsWith('原记录') ? rawSaved : JSON.stringify({ app: 'ielts-dictation', exportedAt: new Date().toISOString(), state: engine.export() }, null, 2);
    download(`${prefix}_${new Date().toISOString().slice(0, 10)}.json`, content);
  }

  function customError(message = '') { $('customError').textContent = message; $('customError').hidden = !message; }
  function resetEntryForm() {
    editingEntryId = null; singleIpaSource = 'unavailable'; $('customEntryForm').reset();
    $('customIpaStatus').textContent = ''; $('customEntrySubmit').textContent = '添加词条'; $('cancelEntryEdit').hidden = true; $('confusablePanel').hidden = true;
  }
  function setEntryMode(batch) {
    $('customEntryForm').hidden = batch; $('batchEntryPanel').hidden = !batch;
    $('confusablePanel').hidden = batch || !editingEntryId;
    $('singleEntryTab').setAttribute('aria-pressed', String(!batch)); $('batchEntryTab').setAttribute('aria-pressed', String(batch)); customError();
  }
  function ipaLabel(source, hasIpa) { return source === 'composed' ? '逐词生成' : source === 'manual' ? '手动音标' : hasIpa ? '英式词典' : '暂无音标'; }
  function beginEntryEdit(row, focus = true) {
    if (!row) return;
    editingEntryId = row.id; setEntryMode(false); $('customWord').value = row.word; $('customTranslation').value = row.translation; $('customNote').value = row.note || '';
    $('customIpa').value = row.ipaUK; singleIpaSource = row.ipaSource; $('customIpaStatus').textContent = ipaLabel(row.ipaSource, row.ipaUK);
    $('customEntrySubmit').textContent = '保存词条'; $('cancelEntryEdit').hidden = false; renderConfusablePanel();
    if (focus) { $('customWord').focus(); $('customEntryForm').scrollIntoView({ block: 'nearest' }); }
  }
  function resetNewConfusableForm() {
    confusableIpaSource = 'unavailable'; $('newConfusableForm').reset(); $('confusableIpaStatus').textContent = ''; $('newConfusableDetails').open = false;
  }
  function renderConfusablePanel() {
    const book = engine.customBook(managingBookId), anchor = book?.entries.find((row) => row.id === editingEntryId);
    $('confusablePanel').hidden = !anchor; if (!anchor) return;
    const group = engine.confusableGroup(book.id, anchor.id), members = group ? group.memberIds.map((id) => book.entries.find((row) => row.id === id)).filter(Boolean) : [anchor];
    $('confusableCount').textContent = `${members.length} / 5`;
    $('confusableMembers').innerHTML = members.map((row, index) => `<div class="confusable-member"><span>${index + 1}</span><button type="button" data-edit-custom="${esc(row.id)}"><strong>${esc(row.word)}</strong><small>${esc(row.translation)}</small></button>${playButton(`${book.id}/${row.id}`)}${group ? `<button class="icon-button danger-button" type="button" data-unlink-confusable="${esc(row.id)}" aria-label="移出易混词组 ${esc(row.word)}" data-tooltip="移出词组">${icon('x')}</button>` : ''}</div>`).join('');
    const memberIds = new Set(members.map((row) => row.id));
    const candidates = book.entries.filter((row) => !memberIds.has(row.id) && !engine.confusableGroup(book.id, row.id));
    $('confusableExistingSelect').replaceChildren(new Option(candidates.length ? '选择已有词条' : '没有可加入的词条', ''));
    for (const row of candidates) $('confusableExistingSelect').append(new Option(`${row.word} · ${row.translation}`, row.id));
    const full = members.length >= 5; $('confusableExistingSelect').disabled = full || !candidates.length;
    $('addExistingConfusableButton').disabled = full || !candidates.length; $('newConfusableDetails').hidden = full;
  }
  function renderCustomEntries() {
    const book = engine.customBook(managingBookId); if (!book) return;
    $('customEntryCount').textContent = `${book.entries.length} 词`; $('customEntryEmpty').hidden = Boolean(book.entries.length);
    $('customEntryRows').innerHTML = book.entries.map((row) => { const group = engine.confusableGroup(book.id, row.id); return `<div class="custom-entry-row"><div><button class="custom-word-link" data-edit-custom="${esc(row.id)}"><strong>${esc(row.word)}</strong></button>${group ? `<span class="group-badge">易混 ${group.memberIds.length}</span>` : ''}<div class="ipa">${esc(row.ipaUK || '暂无音标')}${row.ipaSource === 'composed' ? '<small class="ipa-source">逐词生成</small>' : ''}</div><p>${esc(row.translation)}</p>${row.note ? `<div class="word-note"><span>备注</span>${esc(row.note)}</div>` : ''}</div><div class="custom-row-actions">${playButton(`${book.id}/${row.id}`)}<button class="icon-button" data-edit-custom="${esc(row.id)}" aria-label="编辑 ${esc(row.word)}" data-tooltip="编辑">${icon('pencil')}</button><button class="icon-button danger-button" data-delete-custom="${esc(row.id)}" aria-label="删除 ${esc(row.word)}" data-tooltip="删除">${icon('trash-2')}</button></div></div>`; }).join('');
    if (editingEntryId) renderConfusablePanel();
  }
  function refreshCustomBooks() {
    save(); populateBooks(); renderBooks(); updateBadge(); renderCustomEntries();
  }
  function openCustomManager(id = null, entryId = null) {
    managingBookId = id; customError(); resetEntryForm(); setEntryMode(false);
    resetNewConfusableForm();
    batchPreview = []; $('batchInput').value = ''; invalidateBatch();
    const book = engine.customBook(id);
    $('createCustomBookForm').hidden = Boolean(book); $('manageCustomPanel').hidden = !book;
    $('customDialogTitle').textContent = book ? '管理词书' : '自定义词书';
    if (book) { $('renameCustomBookInput').value = book.name; renderCustomEntries(); } else $('customBookName').value = '';
    if (!$('customBookDialog').open) $('customBookDialog').showModal();
    if (book && entryId) beginEntryEdit(book.entries.find((row) => row.id === entryId));
    else (book ? $('customWord') : $('customBookName')).focus();
  }
  function invalidateBatch() {
    batchPreview = []; $('batchPreview').hidden = true; $('batchPreviewRows').replaceChildren();
    $('batchErrors').hidden = true; $('batchSummary').textContent = ''; $('importBatchButton').disabled = true;
  }
  function previewBatch() {
    customError(); const parsed = parseBatch($('batchInput').value), book = engine.customBook(managingBookId);
    const keys = new Set(book.entries.map((row) => normalize(row.word))), ids = new Set(book.entries.map((row) => row.id));
    const errors = [...parsed.errors];
    for (const row of parsed.rows) {
      try {
        const cleaned = engine.cleanEntry(row), key = normalize(cleaned.word), id = engine.wordIdFor(cleaned.word);
        if (keys.has(key) || ids.has(id)) throw new Error('词条或拼写变体重复');
        keys.add(key); ids.add(id); Object.assign(row, cleaned);
      } catch (error) { errors.push(`第 ${row.line} 行：${error.message}`); }
    }
    batchPreview = parsed.rows; $('batchErrors').textContent = errors.join('\n'); $('batchErrors').hidden = !errors.length;
    $('batchSummary').textContent = `${parsed.rows.length} 条词条${errors.length ? ` · ${errors.length} 处待修正` : ''}`;
    $('batchPreview').hidden = !parsed.rows.length;
    $('batchPreviewRows').innerHTML = parsed.rows.map((row, index) => `<tr><td><strong>${esc(row.word)}</strong><p>${esc(row.translation)}</p>${row.note ? `<div class="word-note"><span>备注</span>${esc(row.note)}</div>` : ''}</td><td><input data-batch-ipa="${index}" aria-label="${esc(row.word)} 的英式音标" value="${esc(row.ipaUK)}" maxlength="500" spellcheck="false"><span class="ipa-source">${esc(row.label)}</span></td><td><button class="icon-button" data-preview-custom="${index}" aria-label="试听 ${esc(row.word)}">${icon('volume-2')}</button></td></tr>`).join('');
    $('importBatchButton').disabled = errors.length > 0 || !parsed.rows.length;
  }

  $('createCustomBookButton').onclick = () => openCustomManager();
  $('manageBookButton').onclick = () => openCustomManager(engine.state.settings.libraryBookId);
  $('createCustomBookForm').onsubmit = (event) => {
    event.preventDefault();
    try { const book = engine.addCustomBook($('customBookName').value); engine.state.settings.libraryBookId = book.id; bookPage = 0; $('bookSearch').value = ''; refreshCustomBooks(); openCustomManager(book.id); }
    catch (error) { customError(error.message); }
  };
  $('renameCustomBookForm').onsubmit = (event) => {
    event.preventDefault();
    try { const book = engine.renameCustomBook(managingBookId, $('renameCustomBookInput').value); $('renameCustomBookInput').value = book.name; customError(); refreshCustomBooks(); toast('词书名称已保存'); }
    catch (error) { customError(error.message); }
  };
  $('deleteCustomBookButton').onclick = () => {
    const book = engine.customBook(managingBookId);
    if (!book || !confirm(`删除词书“${book.name}”及其 ${book.entries.length} 个词条？已有听写记录和错题会保留。`)) return;
    engine.deleteCustomBook(book.id); $('customBookDialog').close(); managingBookId = null; bookPage = 0; $('bookSearch').value = ''; refreshCustomBooks(); toast('词书已删除，历史与错题已保留');
  };
  $('singleEntryTab').onclick = () => setEntryMode(false); $('batchEntryTab').onclick = () => setEntryMode(true);
  $('customWord').oninput = () => { const result = lookupIpa($('customWord').value); $('customIpa').value = result.ipaUK; singleIpaSource = result.ipaSource; $('customIpaStatus').textContent = result.label; };
  $('customIpa').oninput = () => { singleIpaSource = $('customIpa').value.trim() ? 'manual' : 'unavailable'; $('customIpaStatus').textContent = singleIpaSource === 'manual' ? '手动音标' : '暂无音标'; };
  $('customPreviewPlay').onclick = () => { const word = $('customWord').value.trim(); if (word) speak({ word }, $('customPreviewPlay')); };
  $('cancelEntryEdit').onclick = () => { resetEntryForm(); customError(); $('customWord').focus(); };
  $('customEntryForm').onsubmit = (event) => {
    event.preventDefault();
    try {
      const input = { word: $('customWord').value, translation: $('customTranslation').value, note: $('customNote').value, ipaUK: $('customIpa').value, ipaSource: singleIpaSource };
      if (editingEntryId) engine.updateCustomEntry(managingBookId, editingEntryId, input); else engine.addCustomEntry(managingBookId, input);
      resetEntryForm(); invalidateBatch(); customError(); refreshCustomBooks(); $('customWord').focus();
    } catch (error) { customError(error.message); }
  };
  $('batchInput').oninput = invalidateBatch; $('previewBatchButton').onclick = previewBatch;
  $('importBatchButton').onclick = () => {
    try { const count = batchPreview.length; engine.addCustomEntries(managingBookId, batchPreview); $('batchInput').value = ''; invalidateBatch(); refreshCustomBooks(); customError(); toast(`已导入 ${count} 个词条`); }
    catch (error) { customError(error.message); }
  };
  $('customBookDialog').addEventListener('input', (event) => {
    const input = event.target.closest('[data-batch-ipa]');
    if (input && batchPreview[Number(input.dataset.batchIpa)]) { const row = batchPreview[Number(input.dataset.batchIpa)]; row.ipaUK = input.value; row.ipaSource = input.value.trim() ? 'manual' : 'unavailable'; input.nextElementSibling.textContent = input.value.trim() ? '手动音标' : '暂无音标'; }
  });
  $('customBookDialog').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-custom]'), remove = event.target.closest('[data-delete-custom]'), preview = event.target.closest('[data-preview-custom]'), unlink = event.target.closest('[data-unlink-confusable]');
    const book = engine.customBook(managingBookId);
    if (preview) speak(batchPreview[Number(preview.dataset.previewCustom)], preview);
    if (edit && book) {
      const row = book.entries.find((item) => item.id === edit.dataset.editCustom); if (!row) return;
      beginEntryEdit(row);
    }
    if (unlink && book) {
      engine.removeConfusableMember(book.id, unlink.dataset.unlinkConfusable); refreshCustomBooks(); customError();
      toast('已移出易混词组，词条仍保留在本书中');
    }
    if (remove && book) {
      const row = book.entries.find((item) => item.id === remove.dataset.deleteCustom);
      if (row && confirm(`删除“${row.word}”？已有听写记录和错题会保留。`)) {
        engine.deleteCustomEntry(book.id, row.id); if (editingEntryId === row.id) resetEntryForm(); invalidateBatch(); refreshCustomBooks(); customError();
      }
    }
  });
  $('addExistingConfusableButton').onclick = () => {
    const memberId = $('confusableExistingSelect').value; if (!memberId) return;
    try { engine.addConfusableMember(managingBookId, editingEntryId, memberId); refreshCustomBooks(); customError(); }
    catch (error) { customError(error.message); }
  };
  $('confusableWord').oninput = () => { const result = lookupIpa($('confusableWord').value); $('confusableIpa').value = result.ipaUK; confusableIpaSource = result.ipaSource; $('confusableIpaStatus').textContent = result.label; };
  $('confusableIpa').oninput = () => { confusableIpaSource = $('confusableIpa').value.trim() ? 'manual' : 'unavailable'; $('confusableIpaStatus').textContent = confusableIpaSource === 'manual' ? '手动音标' : '暂无音标'; };
  $('confusablePreviewPlay').onclick = () => { const word = $('confusableWord').value.trim(); if (word) speak({ word }, $('confusablePreviewPlay')); };
  $('newConfusableForm').onsubmit = (event) => {
    event.preventDefault();
    try {
      const row = engine.addCustomEntry(managingBookId, { word: $('confusableWord').value, translation: $('confusableTranslation').value,
        note: $('confusableNote').value, ipaUK: $('confusableIpa').value, ipaSource: confusableIpaSource });
      engine.addConfusableMember(managingBookId, editingEntryId, row.id); resetNewConfusableForm(); refreshCustomBooks(); customError();
    } catch (error) { customError(error.message); }
  };

  document.querySelectorAll('[data-nav],.brand').forEach((a) => a.addEventListener('click', (event) => { event.preventDefault(); setView(a.hash.slice(1)); window.scrollTo({ top: 0 }); }));
  $('bookSelect').addEventListener('change', () => practice($('bookSelect').value));
  $('libraryBookSelect').addEventListener('change', () => { engine.state.settings.libraryBookId = $('libraryBookSelect').value; bookPage = 0; $('bookSearch').value = ''; save(); renderBooks(); resetListScroll('bookListScroll'); });
  $('voiceSelect').addEventListener('change', () => { cancelSpeech(); engine.state.settings.voiceURI = $('voiceSelect').value; save(); refreshVoices(); });
  document.querySelectorAll('[data-order]').forEach((button) => button.addEventListener('click', () => { if (engine.round().order === button.dataset.order) return; cancelSpeech(); clearSuccess(); engine.setOrder(button.dataset.order); invalidAnswer = false; renderRound(); save(); }));
  $('startButton').onclick = start; $('againButton').onclick = start;
  $('restartButton').onclick = () => { cancelSpeech(); clearSuccess(); engine.restart(); invalidAnswer = false; renderRound(); save(); };
  $('replayButton').onclick = () => { speak(successState?.row || engine.current(), $('replayButton')); focusAnswer(); };
  $('hintButton').onclick = hint;
  $('answerForm').addEventListener('submit', (event) => { event.preventDefault(); normalize($('answerInput').value) ? submit() : hint(); });
  $('answerInput').addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); if (!event.repeat) speak(successState?.row || engine.current(), $('replayButton')); return;
    }
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!event.repeat) normalize($('answerInput').value) ? submit() : hint(); }
  });
  $('answerInput').addEventListener('input', () => { engine.setAnswer($('answerInput').value); invalidAnswer = false; $('answerInput').classList.remove('invalid'); $('answerInput').setAttribute('aria-invalid', 'false'); $('answerFeedback').textContent = ''; fitAnswer(); autosave(); });
  $('practiceBookButton').onclick = () => practice(engine.state.settings.libraryBookId);
  $('practiceWrongButton').onclick = () => practiceWrong([...wrongSelection]);
  $('practiceAllWrongButton').onclick = () => practiceWrong();
  $('reviewRoundButton').onclick = () => { cancelSpeech(); clearSuccess(); if (engine.reviewCurrentRound()) { invalidAnswer = false; renderRound(); save(); } };
  $('bookSearch').oninput = () => { bookPage = 0; renderBooks(); resetListScroll('bookListScroll'); }; $('wrongSearch').oninput = () => { wrongPage = 0; renderWrong(); resetListScroll('wrongListScroll'); };
  $('wrongSortButton').onclick = () => {
    engine.state.settings.wrongSort = engine.state.settings.wrongSort === 'asc' ? 'desc' : 'asc'; wrongPage = 0;
    save(); renderWrong(); resetListScroll('wrongListScroll');
  };
  $('wrongSelectAll').onchange = () => {
    const query = normalize($('wrongSearch').value); const ids = engine.sortedWrong().filter((row) => normalize(`${row.word} ${row.translation} ${row.lastAnswer}`).includes(query)).map((row) => row.id);
    if ($('wrongSelectAll').checked) ids.forEach((id) => wrongSelection.add(id)); else ids.forEach((id) => wrongSelection.delete(id));
    renderWrong();
  };
  $('wrongClearSelection').onclick = () => { wrongSelection.clear(); renderWrong(); };
  for (const name of ['hideEnglish', 'hideChinese']) $(name).onchange = () => { engine.state.settings[name] = $(name).checked; save(); renderBooks(); };
  document.addEventListener('click', (event) => {
    const path = event.composedPath(); const play = path.find((el) => el?.matches?.('[data-play]'));
    if (play && !play.disabled) speak(engine.entry(play.dataset.play), play);
    const openCustom = path.find((el) => el?.matches?.('[data-open-custom]'));
    if (openCustom) openCustomManager(openCustom.dataset.openCustomBook || engine.state.settings.libraryBookId, openCustom.dataset.openCustom);
    const peek = path.find((el) => el?.matches?.('[data-peek]'));
    if (peek) { event.preventDefault(); event.stopPropagation(); stopPeek(); }
    const card = path.find((el) => el?.matches?.('[data-card-play]'));
    const blocksCard = path.some((el) => el !== card && el?.matches?.('button,input,select,textarea,a,[data-remove],[data-peek]'));
    if (card && !blocksCard) speak(engine.entry(card.dataset.cardPlay), card);
    const remove = path.find((el) => el?.matches?.('[data-remove]'));
    if (remove) { const item = engine.state.wrong[remove.dataset.remove]; wrongSelection.delete(remove.dataset.remove); engine.removeWrong(remove.dataset.remove); save(); renderWrong(); toast(`已移除 ${item?.word || '错题'}`); }
    const open = path.find((el) => el?.matches?.('[data-history-open]'));
    if (open) { historySessionId = open.dataset.historyOpen; historyWrongOnly = open.dataset.historyWrong === 'true'; historyPage = 0; $('historySearch').value = ''; renderHistory(); }
    if (!path.includes($('themePopover')) && !path.includes($('themeButton'))) closeThemePicker();
  });
  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest?.('[data-peek]');
    if (!button || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation(); button.setPointerCapture?.(event.pointerId); startPeek(button);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, (event) => {
    if (activePeek && (event.target.closest?.('[data-peek]') || type !== 'pointerup')) stopPeek();
  });
  document.addEventListener('pointerout', (event) => {
    const button = event.target.closest?.('[data-peek]'); if (button && !button.contains(event.relatedTarget)) stopPeek();
  });
  document.addEventListener('contextmenu', (event) => { if (event.target.closest?.('[data-peek]')) event.preventDefault(); });
  document.addEventListener('keydown', (event) => {
    const peek = event.target.closest?.('[data-peek]');
    if (peek && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!event.repeat) startPeek(peek, true); return; }
    const card = event.target.closest?.('[data-card-play]');
    if (card && event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!event.repeat) speak(engine.entry(card.dataset.cardPlay), card); }
  });
  document.addEventListener('keyup', (event) => { if (event.target.closest?.('[data-peek]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); stopPeek(); } });
  document.addEventListener('change', (event) => {
    const checkbox = event.composedPath().find((el) => el?.matches?.('[data-select-wrong]'));
    if (checkbox) { if (checkbox.checked) wrongSelection.add(checkbox.dataset.selectWrong); else wrongSelection.delete(checkbox.dataset.selectWrong); renderWrong(); }
  });
  $('historyButton').onclick = () => { const pending = Boolean(successState); clearSuccess(); if (pending) renderRound(); historySessionId = null; historyWrongOnly = false; historyPage = 0; $('historySearch').value = ''; renderHistory(); $('historyDialog').showModal(); };
  $('historySearch').oninput = () => { historyPage = 0; renderHistory(); };
  $('historyBack').onclick = () => { historySessionId = null; historyWrongOnly = false; historyPage = 0; $('historySearch').value = ''; renderHistory(); };
  $('historyAllWords').onclick = () => { historyWrongOnly = false; historyPage = 0; renderHistory(); };
  $('historyWrongWords').onclick = () => { historyWrongOnly = true; historyPage = 0; renderHistory(); };
  $('creditsButton').onclick = () => { $('licenseText').textContent = DATA.licenses || ''; $('creditsDialog').showModal(); };
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.onclick = () => button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  $('exportButton').onclick = () => exportBackup(); $('importButton').onclick = () => $('importFile').click();
  $('themeButton').onclick = () => {
    const opening = $('themePopover').hidden; $('themePopover').hidden = !opening; $('themeButton').setAttribute('aria-expanded', String(opening));
    if (opening) document.querySelector(`[data-theme-option="${engine.state.settings.theme}"]`)?.focus();
  };
  document.querySelectorAll('[data-theme-option]').forEach((button) => button.onclick = () => { applyTheme(button.dataset.themeOption, true); closeThemePicker(true); });
  $('themePopover').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const options = [...document.querySelectorAll('[data-theme-option]')]; const current = options.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    options[index].focus();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('themePopover').hidden) { event.preventDefault(); closeThemePicker(true); } });
  $('importFile').onchange = async () => {
    const file = $('importFile').files[0]; if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('备份文件超过 50 MB');
      const parsed = JSON.parse(await file.text()); const replacement = new Engine(DATA, parsed.state || parsed);
      if (!confirm('导入会替换当前记录。当前数据将先自动下载备份，是否继续？')) return;
      exportBackup('导入前备份'); cancelSpeech(); clearSuccess(); clearTimeout(saveTimer); engine = replacement; storageError = ''; invalidAnswer = false;
      wrongSelection.clear(); applyTheme(engine.state.settings.theme); populateBooks(); engine.select(engine.state.settings.bookId); refreshVoices(); save(); setView(view); toast('备份已导入');
    } catch (error) { toast(`导入失败：${error.message}`, 7000); }
    finally { $('importFile').value = ''; }
  };
  window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
  window.addEventListener('beforeunload', save); window.addEventListener('pagehide', () => { save(); cancelSpeech(); });
  window.addEventListener('resize', () => {
    fitAnswer(); clearTimeout(layoutTimer); layoutTimer = setTimeout(() => {
      const nextSize = gridPageSize(); if (nextSize === vocabularyPageSize) return;
      const bookOffset = bookPage * vocabularyPageSize, wrongOffset = wrongPage * vocabularyPageSize;
      vocabularyPageSize = nextSize; bookPage = Math.floor(bookOffset / nextSize); wrongPage = Math.floor(wrongOffset / nextSize);
      renderBooks(); renderWrong();
    }, 120);
  });
  window.addEventListener('focus', () => { refreshVoices(); checkForUpdate(); }); document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshVoices(); checkForUpdate(); } });
  applyTheme(engine.state.settings.theme); populateBooks(); engine.select(engine.state.settings.bookId); setView(location.hash.slice(1) || 'home'); refreshVoices(); configureRelease();
  if ('speechSynthesis' in window) { window.speechSynthesis.addEventListener('voiceschanged', refreshVoices); setTimeout(refreshVoices, 500); setTimeout(refreshVoices, 1600); }
  if (storageError) toast(storageError, 9000); else save();
})();
