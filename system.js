(function(){
  const STORAGE_KEY = 'janken-data';
  const POLL_INTERVAL_MS = 4000;
  const penClasses = ['a','b','c','d'];
  const STANDARD_MOVES = [
    { key:'gu',    label:'グー',   emoji:'✊' },
    { key:'choki', label:'チョキ', emoji:'✌️' },
    { key:'pa',    label:'パー',   emoji:'✋' },
    { key:'kuute', label:'空手',   emoji:'🈳' }
  ];

  // 「空手」は からて(空手道) ではなく くうて(何も出さない＝空っぽの手) の意。
  // ボタン上ではふりがな付きで表示して読み間違いを防ぐ。
  function moveLabelHtml(m){
    if (m.reading){
      return `<ruby>${m.label}<rt>${m.reading}</rt></ruby>`;
    }
    return m.label;
  }
  const MAX_CUSTOM_MOVES = 20;

  let rounds = [];
  let customMoveHistory = []; // 参加者全員で共有する独自手の履歴
  let roster = []; // 事前登録した参加者名のリスト
  // draftParticipants: [{name, mode, customText, realMode, realCustomText}]
  //   mode/customText      … 表面上の手
  //   realMode/realCustomText … 実質的な手
  let draftParticipants = [];
  let draftWinner = null;
  let currentMode = 'edit'; // 'edit' | 'view'
  let formStep = 'surface'; // 'surface' | 'real'
  let pollTimer = null;

  const participantListEl = document.getElementById('participantList');
  const winnerChoicesEl = document.getElementById('winnerChoices');
  const memoInput = document.getElementById('memoInput');
  const submitBtn = document.getElementById('submitBtn');
  const nextStepBtn = document.getElementById('nextStepBtn');
  const backStepBtn = document.getElementById('backStepBtn');
  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');
  const searchInput = document.getElementById('searchInput');
  const statsList = document.getElementById('statsList');
  const scoreList = document.getElementById('scoreList');
  const toastEl = document.getElementById('toast');
  const rosterInput = document.getElementById('rosterInput');
  const rosterAddBtn = document.getElementById('rosterAddBtn');
  const rosterChipsEl = document.getElementById('rosterChips');
  const customMoveInput = document.getElementById('customMoveInput');
  const customMoveAddBtn = document.getElementById('customMoveAddBtn');
  const customMoveChipsEl = document.getElementById('customMoveChips');
  const modeEditBtn = document.getElementById('modeEditBtn');
  const modeRefereeBtn = document.getElementById('modeRefereeBtn');
  const modePlayerBtn = document.getElementById('modePlayerBtn');
  const viewModeBanner = document.getElementById('viewModeBanner');
  const resetMenuBtn = document.getElementById('resetMenuBtn');
  const resetMenu = document.getElementById('resetMenu');

  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(()=> toastEl.classList.remove('show'), 1600);
  }

  /* ---- モード切り替え：編集 / 審判（表面上の手＋実質的な手＋勝敗＋得点） / プレイヤー（表面上の手＋勝敗＋得点） ---- */
  function setMode(mode){
    currentMode = mode; // 'edit' | 'referee' | 'player'
    document.body.classList.remove('mode-edit', 'mode-referee', 'mode-player');
    document.body.classList.add('mode-' + mode);
    modeEditBtn.classList.toggle('active', mode === 'edit');
    modeRefereeBtn.classList.toggle('active', mode === 'referee');
    modePlayerBtn.classList.toggle('active', mode === 'player');

    if (mode === 'referee'){
      viewModeBanner.textContent = '🧑\u200d⚖️ 審判モード中：入力欄は非表示です。編集モードと同じく、表面上の手・実質的な手・勝敗・得点ランキングすべてを確認できます。自動的に最新の状態に更新されます。';
    } else if (mode === 'player'){
      viewModeBanner.textContent = '🎮 プレイヤーモード中：入力欄は非表示です。表面上の手・勝敗・得点ランキングのみを表示します（実質的な手は表示されません）。自動的に最新の状態に更新されます。';
    }
  }
  modeEditBtn.addEventListener('click', () => setMode('edit'));
  modeRefereeBtn.addEventListener('click', () => setMode('referee'));
  modePlayerBtn.addEventListener('click', () => setMode('player'));

  /* ---- リセットメニュー（3択） ---- */
  function closeResetMenu(){
    resetMenu.classList.remove('open');
    resetMenuBtn.classList.remove('open');
  }
  function toggleResetMenu(){
    const willOpen = !resetMenu.classList.contains('open');
    resetMenu.classList.toggle('open', willOpen);
    resetMenuBtn.classList.toggle('open', willOpen);
  }
  resetMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleResetMenu();
  });
  document.addEventListener('click', (e) => {
    if (!resetMenu.contains(e.target) && e.target !== resetMenuBtn){
      closeResetMenu();
    }
  });

  resetMenu.querySelectorAll('.reset-menu-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      closeResetMenu();
      if (action === 'all'){
        if (!confirm('すべてリセットします（参加者リスト・独自手・対戦メモぜんぶ）。よろしいですか？')) return;
        await resetAll();
      } else if (action === 'exceptRoster'){
        if (!confirm('参加者リスト以外をリセットします（独自手リスト・対戦メモが消えます）。よろしいですか？')) return;
        await resetExceptRoster();
      } else if (action === 'historyOnly'){
        if (!confirm('対戦メモ一覧だけリセットします（参加者リスト・独自手リストは残ります）。よろしいですか？')) return;
        await resetHistoryOnly();
      }
    });
  });

  async function persistAll(){
    try{
      await saveData({
        rounds,
        roster,
        customMoves: customMoveHistory
      });
    }catch(e){
      console.error('保存に失敗しました', e);
      showToast('保存に失敗しました');
      throw e;
    }
  }

  async function resetAll(){
    rounds = [];
    roster = [];
    customMoveHistory = [];
    try{
      await persistAll();
    }catch(e){ return; }
    resetDraft();
    renderRoster();
    renderCustomMoveManagement();
    renderWinnerChoices();
    renderHistory();
    renderStats();
    renderScores();
    showToast('全部リセットしました');
  }

  async function resetExceptRoster(){
    rounds = [];
    customMoveHistory = [];
    try{
      await persistAll();
    }catch(e){ return; }
    resetDraft();
    renderCustomMoveManagement();
    renderWinnerChoices();
    renderHistory();
    renderStats();
    renderScores();
    showToast('プレイヤー以外をリセットしました');
  }

  async function resetHistoryOnly(){
    rounds = [];
    try{
      await persistAll();
    }catch(e){ return; }
    renderHistory();
    renderStats();
    renderScores();
    showToast('メモ一覧をリセットしました');
  }

  function newParticipant(name){
    return { name: name || '', mode: null, customText: '', realMode: null, realCustomText: '' };
  }

  function syncNamesFromRoster(){
    draftParticipants.forEach((p, i) => {
      p.name = roster[i] || '';
    });
  }

  function resetDraft(){
    draftParticipants = [newParticipant(''), newParticipant('')];
    syncNamesFromRoster();
    draftWinner = null;
    formStep = 'surface';
    memoInput.value = '';
    renderParticipantForm();
    updateStepButtons();
  }

  // 表面上の手（グー・チョキ・パー・空手・独自手のいずれか）のテキスト
  function surfaceItemText(p){
    if (p.mode === 'custom') return (p.customText || '').trim();
    const std = STANDARD_MOVES.find(m => m.key === p.mode);
    return std ? std.label : '';
  }

  // 実質的な手のテキスト（Step②で入力。未入力なら空文字）
  function realItemText(p){
    if (p.realMode === 'custom') return (p.realCustomText || '').trim();
    const std = STANDARD_MOVES.find(m => m.key === p.realMode);
    return std ? std.label : '';
  }

  function updateStepButtons(){
    const isReal = formStep === 'real';
    backStepBtn.style.display = isReal ? 'inline-flex' : 'none';
    nextStepBtn.style.display = isReal ? 'none' : 'inline-flex';
    submitBtn.textContent = isReal ? 'この対戦を記録する（表＋実）' : 'この対戦を記録する（表面のみ）';
  }

  function renderParticipantForm(){
    participantListEl.innerHTML = '';
    const isReal = formStep === 'real';

    const stepHeading = document.createElement('div');
    stepHeading.className = 'step-heading';
    stepHeading.textContent = isReal
      ? '② 実質的な手を入力する'
      : '① 表面上の手を入力する';
    participantListEl.appendChild(stepHeading);

    draftParticipants.forEach((p, i) => {
      const block = document.createElement('div');
      block.className = 'participant-block';

      const head = document.createElement('div');
      head.className = 'participant-block-head';
      const label = document.createElement('span');
      label.className = 'participant-index-label';
      label.textContent = i === 0 ? '👤 先手' : '👤 後手';
      head.appendChild(label);
      block.appendChild(head);

      const nameSection = document.createElement('div');
      nameSection.className = 'name-picker-wrap';

      if (isReal){
        // 実質的な手のステップでは、名前は表示のみ（変更不可）。表面上の手を振り返り表示。
        const nameDisplay = document.createElement('div');
        nameDisplay.className = 'name-display';
        nameDisplay.textContent = '👤 ' + (p.name || '（名無し）');
        nameSection.appendChild(nameDisplay);

        const recap = document.createElement('div');
        recap.className = 'surface-recap';
        const surfaceText = surfaceItemText(p);
        recap.innerHTML = '表面上の手：' + (surfaceText ? moveItemHtml(surfaceText) : '（未選択）');
        nameSection.appendChild(recap);
      } else if (p.name){
        const nameDisplay = document.createElement('div');
        nameDisplay.className = 'name-display';
        nameDisplay.textContent = '👤 ' + p.name;
        nameSection.appendChild(nameDisplay);
      } else {
        const nameLabel = document.createElement('span');
        nameLabel.className = 'name-picker-label';
        nameLabel.textContent = '参加者リストに登録がありません。名前を入力：';
        nameSection.appendChild(nameLabel);

        const manualInput = document.createElement('input');
        manualInput.type = 'text';
        manualInput.className = 'manual-name-input';
        manualInput.placeholder = '名前を入力（上の「参加者リストを管理」で登録すると自動で入ります）';
        manualInput.value = p.name;
        manualInput.addEventListener('input', e => {
          draftParticipants[i].name = e.target.value;
          renderWinnerChoices();
        });
        nameSection.appendChild(manualInput);
      }

      block.appendChild(nameSection);

      const moves = document.createElement('div');
      moves.className = 'move-choices';
      const curMode = isReal ? p.realMode : p.mode;
      STANDARD_MOVES.forEach(m => {
        const btn = document.createElement('div');
        btn.className = 'move-btn' + (curMode === m.key ? ' selected' : '');
        btn.innerHTML = `<span class="emoji">${m.emoji}</span><span>${moveLabelHtml(m)}</span>`;
        btn.addEventListener('click', () => {
          if (isReal){
            draftParticipants[i].realMode = (p.realMode === m.key) ? null : m.key;
          } else {
            draftParticipants[i].mode = (p.mode === m.key) ? null : m.key;
          }
          renderParticipantForm();
        });
        moves.appendChild(btn);
      });
      const customBtn = document.createElement('div');
      customBtn.className = 'move-btn custom' + (curMode === 'custom' ? ' selected' : '');
      customBtn.innerHTML = `<span class="emoji">✍️</span><span>独自手</span>`;
      customBtn.addEventListener('click', () => {
        if (isReal){
          draftParticipants[i].realMode = (p.realMode === 'custom') ? null : 'custom';
          if (draftParticipants[i].realMode === 'custom') draftParticipants[i].realCustomText = '';
        } else {
          draftParticipants[i].mode = (p.mode === 'custom') ? null : 'custom';
          if (draftParticipants[i].mode === 'custom') draftParticipants[i].customText = '';
        }
        renderParticipantForm();
      });
      moves.appendChild(customBtn);
      block.appendChild(moves);

      if (curMode === 'custom'){
        const history = customMoveHistory.filter(Boolean);
        const historyWrap = document.createElement('div');
        historyWrap.className = 'custom-history';
        const label2 = document.createElement('span');
        label2.className = 'custom-history-label';
        label2.textContent = history.length > 0
          ? '独自手から選ぶ：'
          : 'まだ独自手が登録されていません。上の「独自手リストを管理」で登録しよう。';
        historyWrap.appendChild(label2);
        if (history.length > 0){
          const chipsWrap = document.createElement('div');
          chipsWrap.className = 'custom-history-chips';
          const curText = isReal ? p.realCustomText : p.customText;
          history.forEach(move => {
            const chip = document.createElement('div');
            chip.className = 'custom-history-chip' + (curText === move ? ' selected' : '');
            chip.textContent = move;
            chip.addEventListener('click', () => {
              if (isReal) draftParticipants[i].realCustomText = move;
              else draftParticipants[i].customText = move;
              renderParticipantForm();
            });
            chipsWrap.appendChild(chip);
          });
          historyWrap.appendChild(chipsWrap);
        }
        block.appendChild(historyWrap);
      }

      participantListEl.appendChild(block);
    });
  }

  function renderWinnerChoices(){
    winnerChoicesEl.innerHTML = '';
    draftParticipants.forEach((p, i) => {
      const chip = document.createElement('div');
      chip.className = 'winner-choice' + (draftWinner === i ? ' selected' : '');
      chip.textContent = (p.name || (i === 0 ? '先手' : '後手')) + ' の勝ち';
      chip.addEventListener('click', () => {
        draftWinner = (draftWinner === i) ? null : i;
        renderWinnerChoices();
      });
      winnerChoicesEl.appendChild(chip);
    });
    const drawChip = document.createElement('div');
    drawChip.className = 'winner-choice draw' + (draftWinner === 'draw' ? ' selected' : '');
    drawChip.textContent = 'あいこ';
    drawChip.addEventListener('click', () => {
      draftWinner = (draftWinner === 'draw') ? null : 'draw';
      renderWinnerChoices();
    });
    winnerChoicesEl.appendChild(drawChip);
  }

  /* ---- Step① →「次へ」：表面上の手が両方入っていれば Step②へ進む ---- */
  nextStepBtn.addEventListener('click', () => {
    const items = draftParticipants.map(p => surfaceItemText(p));
    if (items.some(t => t === '')){
      showToast('両方の「表面上の手」を選んでね');
      return;
    }
    formStep = 'real';
    renderParticipantForm();
    updateStepButtons();
  });

  /* ---- Step② →「戻る」：表面上の手のステップに戻る（実質的な手の入力内容は保持） ---- */
  backStepBtn.addEventListener('click', () => {
    formStep = 'surface';
    renderParticipantForm();
    updateStepButtons();
  });

  async function submitRound(){
    const withItems = draftParticipants.map(p => ({
      name: p.name.trim() || '名無し',
      item: surfaceItemText(p),
      realItem: realItemText(p)
    }));
    const cleaned = withItems.filter(p => p.item !== '');

    if (cleaned.length < 2){
      showToast('両方の「表面上の手」を選んでね');
      return;
    }

    const round = {
      id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      timestamp: Date.now(),
      participants: cleaned,
      winner: null,
      memo: memoInput.value.trim()
    };

    if (draftWinner === 'draw'){
      round.winner = 'draw';
    } else if (typeof draftWinner === 'number'){
      const target = withItems[draftWinner];
      if (target && target.item !== ''){
        const newIdx = cleaned.findIndex(p => p === target || (p.name === target.name && p.item === target.item));
        round.winner = newIdx >= 0 ? newIdx : null;
      }
    }

    // 送信直前に最新のデータを取り直してから追加する（他の人の記録を消さないため）
    await loadRounds();
    rounds.unshift(round);
    await persistRounds();
    updateCustomMoveHistory(draftParticipants);
    await persistCustomMoves();
    resetDraft();
    renderWinnerChoices();
    renderHistory();
    renderStats();
    renderScores();
    showToast('記録しました');
  }

  async function loadRoster(){ /* loadRounds() が兼ねる */ }

  async function persistRoster(){
    try{
      await saveData({
        rounds,
        roster,
        customMoves: customMoveHistory
      });
    }catch(e){
      console.error('参加者リストの保存に失敗しました', e);
      showToast('保存に失敗しました');
    }
  }


  function renderRoster(){
    rosterChipsEl.innerHTML = '';
    if (roster.length === 0){
      const empty = document.createElement('span');
      empty.style.fontSize = '12.5px';
      empty.style.color = 'var(--ink-soft)';
      empty.textContent = 'まだ誰も登録されていません';
      rosterChipsEl.appendChild(empty);
      return;
    }
    roster.forEach(name => {
      const chip = document.createElement('div');
      chip.className = 'roster-chip';
      const label = document.createElement('span');
      label.textContent = name;
      chip.appendChild(label);
      const del = document.createElement('button');
      del.className = 'roster-chip-del';
      del.type = 'button';
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        roster = roster.filter(n => n !== name);
        await persistRoster();
        renderRoster();
        syncNamesFromRoster();
        renderParticipantForm();
        renderWinnerChoices();
      });
      chip.appendChild(del);
      rosterChipsEl.appendChild(chip);
    });
  }

  async function addRosterName(){
    const name = rosterInput.value.trim();
    if (!name){ return; }
    if (roster.includes(name)){
      showToast('すでに登録されています');
      rosterInput.value = '';
      return;
    }
    roster.push(name);
    await persistRoster();
    rosterInput.value = '';
    renderRoster();
    syncNamesFromRoster();
    renderParticipantForm();
    renderWinnerChoices();
  }

  rosterAddBtn.addEventListener('click', addRosterName);
  rosterInput.addEventListener('keydown', e => {
    if (e.key === 'Enter'){
      e.preventDefault();
      addRosterName();
    }
  });

  function renderCustomMoveManagement(){
    customMoveChipsEl.innerHTML = '';
    if (customMoveHistory.length === 0){
      const empty = document.createElement('span');
      empty.style.fontSize = '12.5px';
      empty.style.color = 'var(--ink-soft)';
      empty.textContent = 'まだ独自手が登録されていません';
      customMoveChipsEl.appendChild(empty);
      return;
    }
    customMoveHistory.forEach(move => {
      const chip = document.createElement('div');
      chip.className = 'roster-chip';
      const label = document.createElement('span');
      label.textContent = move;
      chip.appendChild(label);
      const del = document.createElement('button');
      del.className = 'roster-chip-del';
      del.type = 'button';
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        customMoveHistory = customMoveHistory.filter(m => m !== move);
        await persistCustomMoves();
        renderCustomMoveManagement();
        renderParticipantForm();
      });
      chip.appendChild(del);
      customMoveChipsEl.appendChild(chip);
    });
  }

  async function addCustomMoveManually(){
    const move = customMoveInput.value.trim();
    if (!move){ return; }
    if (customMoveHistory.includes(move)){
      showToast('すでに登録されています');
      customMoveInput.value = '';
      return;
    }
    customMoveHistory.unshift(move);
    customMoveHistory = customMoveHistory.slice(0, MAX_CUSTOM_MOVES);
    await persistCustomMoves();
    customMoveInput.value = '';
    renderCustomMoveManagement();
    renderParticipantForm();
    showToast('独自手を登録しました');
  }

  customMoveAddBtn.addEventListener('click', addCustomMoveManually);
  customMoveInput.addEventListener('keydown', e => {
    if (e.key === 'Enter'){
      e.preventDefault();
      addCustomMoveManually();
    }
  });

  submitBtn.addEventListener('click', submitRound);

  async function persistRounds(){
    try{
      await saveData({
        rounds,
        roster,
        customMoves: customMoveHistory
      });
    }catch(e){
      console.error('保存に失敗しました', e);
      showToast('保存に失敗しました');
    }
  }

  async function loadRounds(){
    try{
      const data = await loadData();
      rounds = data.rounds || [];
      roster = data.roster || [];
      customMoveHistory = data.customMoves || [];
    }catch(e){
      rounds = [];
      roster = [];
      customMoveHistory = [];
    }
  }

  async function persistCustomMoves(){
    try{
      await saveData({
        rounds,
        roster,
        customMoves: customMoveHistory
      });
    }catch(e){
      console.error('独自手の保存に失敗しました', e);
    }
  }

  // 表面上の手・実質的な手のどちらで使われた独自手も履歴に登録する
  function updateCustomMoveHistory(participants){
    participants.forEach(p => {
      if (p.mode === 'custom'){
        const text = (p.customText || '').trim();
        if (text){
          customMoveHistory = customMoveHistory.filter(m => m !== text);
          customMoveHistory.unshift(text);
        }
      }
      if (p.realMode === 'custom'){
        const text = (p.realCustomText || '').trim();
        if (text){
          customMoveHistory = customMoveHistory.filter(m => m !== text);
          customMoveHistory.unshift(text);
        }
      }
    });
    customMoveHistory = customMoveHistory.slice(0, MAX_CUSTOM_MOVES);
  }


  async function loadCustomMoves(){ /* loadRounds() が兼ねる */ }

  async function deleteRound(id){
    rounds = rounds.filter(r => r.id !== id);
    await persistRounds();
    renderHistory();
    renderStats();
    renderScores();
    showToast('削除しました');
  }

  function formatTime(ts){
    const d = new Date(ts);
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function moveEmoji(item){
    const std = STANDARD_MOVES.find(m => m.label === item);
    return std ? std.emoji + ' ' : '✍️ ';
  }

  // 履歴・ランキング表示用：標準の手は空手(くうて)などふりがな付きで、
  // 独自手はそのままエスケープして表示する。
  function moveItemHtml(item){
    const std = STANDARD_MOVES.find(m => m.label === item);
    if (std){
      return `${std.emoji} ${moveLabelHtml(std)}`;
    }
    return `${moveEmoji(item)}${escapeHtml(item)}`;
  }

  function renderHistory(){
    const query = searchInput.value.trim().toLowerCase();
    const filtered = rounds.filter(r => {
      if (!query) return true;
      const hay = r.participants.map(p => p.name + ' ' + p.item + ' ' + (p.realItem || '')).join(' ').toLowerCase() + ' ' + (r.memo||'').toLowerCase();
      return hay.includes(query);
    });

    historyCount.textContent = `${filtered.length} / ${rounds.length} 件`;

    if (filtered.length === 0){
      historyList.innerHTML = `<div class="empty-state">
        <span class="big">まだメモがありません</span>
        上のフォームから最初の対戦を記録してみよう
      </div>`;
      return;
    }

    historyList.innerHTML = '';
    filtered.forEach(r => {
      const card = document.createElement('div');
      card.className = 'round-card';

      const top = document.createElement('div');
      top.className = 'round-top';
      const time = document.createElement('span');
      time.className = 'round-time';
      time.textContent = formatTime(r.timestamp);
      top.appendChild(time);
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-round-btn edit-only';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', () => deleteRound(r.id));
      top.appendChild(delBtn);
      card.appendChild(top);

      const vsLine = document.createElement('div');
      vsLine.className = 'vs-line';
      r.participants.forEach((p, i) => {
        if (i > 0){
          const sep = document.createElement('span');
          sep.className = 'vs-sep';
          sep.textContent = 'vs';
          vsLine.appendChild(sep);
        }
        const tag = document.createElement('div');
        const cls = penClasses[i % penClasses.length];
        tag.className = 'p-tag' + (r.winner === i ? ' win' : '');
        tag.style.background = `var(--pen-${cls}-bg)`;
        tag.style.color = `var(--pen-${cls})`;
        let inner = `<span class="p-name">${escapeHtml(p.name)}</span><span class="p-item">${moveItemHtml(p.item)}</span>`;
        // 実質的な手は編集モード・審判モードで表示（プレイヤーモードでは表面上の手だけを見せる）
        if (p.realItem){
          inner += `<span class="p-real real-move">実：${moveItemHtml(p.realItem)}</span>`;
        }
        tag.innerHTML = inner;
        vsLine.appendChild(tag);
      });
      if (r.winner === 'draw'){
        const badge = document.createElement('span');
        badge.className = 'draw-badge';
        badge.textContent = 'あいこ';
        vsLine.appendChild(badge);
      }
      card.appendChild(vsLine);

      if (r.memo){
        const memo = document.createElement('div');
        memo.className = 'round-memo';
        memo.textContent = r.memo;
        card.appendChild(memo);
      }

      historyList.appendChild(card);
    });
  }

  // 使われた技ランキングは「表面上の手」「実質的な手」の両方を集計対象にする
  function renderStats(){
    const counts = {};
    rounds.forEach(r => {
      r.participants.forEach(p => {
        [p.item, p.realItem].forEach(val => {
          const key = (val || '').trim();
          if (!key) return;
          counts[key] = (counts[key] || 0) + 1;
        });
      });
    });
    const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 12);

    if (sorted.length === 0){
      statsList.innerHTML = `<div class="empty-state" style="padding:16px 0;">まだ集計するデータがありません</div>`;
      return;
    }

    statsList.innerHTML = '';
    sorted.forEach(([item, count]) => {
      const chip = document.createElement('div');
      chip.className = 'stats-chip';
      chip.innerHTML = `${moveItemHtml(item)}<b>×${count}</b>`;
      statsList.appendChild(chip);
    });
  }

  /* ---- 得点（勝敗）ランキング ---- */
  function computeScores(){
    const stats = {}; // name -> {wins, losses, draws, plays}
    rounds.forEach(r => {
      r.participants.forEach((p, idx) => {
        const name = p.name || '名無し';
        if (!stats[name]) stats[name] = { wins:0, losses:0, draws:0, plays:0 };
        stats[name].plays += 1;
        if (r.winner === 'draw'){
          stats[name].draws += 1;
        } else if (typeof r.winner === 'number'){
          if (r.winner === idx) stats[name].wins += 1;
          else stats[name].losses += 1;
        }
      });
    });
    return stats;
  }

  function renderScores(){
    const stats = computeScores();
    const entries = Object.entries(stats);

    if (entries.length === 0){
      scoreList.innerHTML = `<div class="empty-state" style="padding:16px 0;">まだ得点がありません</div>`;
      return;
    }

    entries.sort((a, b) => {
      const sa = a[1], sb = b[1];
      if (sb.wins !== sa.wins) return sb.wins - sa.wins;
      if (sb.plays !== sa.plays) return sb.plays - sa.plays;
      return a[0].localeCompare(b[0], 'ja');
    });

    const maxWins = Math.max(1, ...entries.map(([, s]) => s.wins));
    const rankIcons = ['🥇', '🥈', '🥉'];

    scoreList.innerHTML = '';
    entries.forEach(([name, s], i) => {
      const row = document.createElement('div');
      row.className = 'score-row' + (i < 3 ? ' top' + (i + 1) : '');

      const rank = document.createElement('div');
      rank.className = 'score-rank';
      rank.textContent = rankIcons[i] || String(i + 1);
      row.appendChild(rank);

      const inner = document.createElement('div');
      inner.className = 'score-row-inner';

      const top = document.createElement('div');
      top.className = 'score-row-top';
      const nameEl = document.createElement('span');
      nameEl.className = 'score-name';
      nameEl.textContent = name;
      top.appendChild(nameEl);

      const record = document.createElement('span');
      record.className = 'score-record';
      record.innerHTML = `<b>${s.wins}勝</b>${s.losses}敗${s.draws}分 ・ ${s.plays}戦`;
      top.appendChild(record);

      inner.appendChild(top);

      const barWrap = document.createElement('div');
      barWrap.className = 'score-bar-wrap';
      const bar = document.createElement('div');
      bar.className = 'score-bar';
      bar.style.width = Math.round((s.wins / maxWins) * 100) + '%';
      barWrap.appendChild(bar);
      inner.appendChild(barWrap);

      row.appendChild(inner);
      scoreList.appendChild(row);
    });
  }

  function escapeHtml(str){
    return String(str)
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;');
  }

  searchInput.addEventListener('input', renderHistory);

  /* ---- 他の人の更新を定期的に取り込む（見た目の更新のみ。編集中のフォームは邪魔しない） ---- */
  async function pollUpdates(){
    try{
      await loadRounds();
      await loadRoster();
      await loadCustomMoves();
      renderHistory();
      renderStats();
      renderScores();
      renderRoster();
      renderCustomMoveManagement();
    }catch(e){
      console.error('自動更新に失敗しました', e);
    }
  }

  /* ---- 永続化：サーバーAPI経由で全員と共有 ---- */
  async function loadData(){
    const res = await fetch("/api/get");
    return await res.json();
  }

  async function saveData(data){
    await fetch("/api/set", {
      method: "POST",
      body: JSON.stringify(data)
    });
  }


  async function init(){
    await loadRounds();
    await loadCustomMoves();
    renderCustomMoveManagement();
    await loadRoster();
    renderRoster();
    resetDraft();
    renderWinnerChoices();
    renderHistory();
    renderStats();
    renderScores();
    renderParticipantForm();
    updateStepButtons();
    setMode('edit');
    pollTimer = setInterval(pollUpdates, POLL_INTERVAL_MS);
  }



  init();
})();
