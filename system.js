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
  let draftParticipants = []; // [{name, mode: 'gu'|'choki'|'pa'|'karate'|'custom'|null, customText}]
  let draftWinner = null;
  let currentMode = 'edit'; // 'edit' | 'view'
  let pollTimer = null;

  const participantListEl = document.getElementById('participantList');
  const addParticipantBtn = document.getElementById('addParticipantBtn');
  const winnerChoicesEl = document.getElementById('winnerChoices');
  const memoInput = document.getElementById('memoInput');
  const submitBtn = document.getElementById('submitBtn');
  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');
  const searchInput = document.getElementById('searchInput');
  const statsList = document.getElementById('statsList');
  const toastEl = document.getElementById('toast');
  const rosterInput = document.getElementById('rosterInput');
  const rosterAddBtn = document.getElementById('rosterAddBtn');
  const rosterChipsEl = document.getElementById('rosterChips');
  const customMoveInput = document.getElementById('customMoveInput');
  const customMoveAddBtn = document.getElementById('customMoveAddBtn');
  const customMoveChipsEl = document.getElementById('customMoveChips');
  const modeEditBtn = document.getElementById('modeEditBtn');
  const modeViewBtn = document.getElementById('modeViewBtn');
  const resetMenuBtn = document.getElementById('resetMenuBtn');
  const resetMenu = document.getElementById('resetMenu');

  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(()=> toastEl.classList.remove('show'), 1600);
  }

  /* ---- モード切り替え ---- */
  function setMode(mode){
    currentMode = mode;
    document.body.classList.toggle('view-mode', mode === 'view');
    modeEditBtn.classList.toggle('active', mode === 'edit');
    modeViewBtn.classList.toggle('active', mode === 'view');
  }
  modeEditBtn.addEventListener('click', () => setMode('edit'));
  modeViewBtn.addEventListener('click', () => setMode('view'));

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
    showToast('プレイヤー以外をリセットしました');
  }

  async function resetHistoryOnly(){
    rounds = [];
    try{
      await persistAll();
    }catch(e){ return; }
    renderHistory();
    renderStats();
    showToast('メモ一覧をリセットしました');
  }

  function newParticipant(name){
    return { name: name || '', mode: null, customText: '' };
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
    memoInput.value = '';
    renderParticipantForm();
  }

  function participantItemText(p){
    if (p.mode === 'custom') return p.customText.trim();
    const std = STANDARD_MOVES.find(m => m.key === p.mode);
    return std ? std.label : '';
  }

  function renderParticipantForm(){
    participantListEl.innerHTML = '';
    draftParticipants.forEach((p, i) => {
      const block = document.createElement('div');
      block.className = 'participant-block';

      const head = document.createElement('div');
      head.className = 'participant-block-head';
      const label = document.createElement('span');
      label.className = 'participant-index-label';
      label.textContent = '参加者' + (i + 1);
      head.appendChild(label);

      if (draftParticipants.length > 2){
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'remove-btn';
        rm.textContent = '✕ 削除';
        rm.addEventListener('click', () => {
          draftParticipants.splice(i, 1);
          syncNamesFromRoster();
          if (typeof draftWinner === 'number'){
            if (draftWinner === i) draftWinner = null;
            else if (draftWinner > i) draftWinner -= 1;
          }
          renderParticipantForm();
          renderWinnerChoices();
        });
        head.appendChild(rm);
      }
      block.appendChild(head);

      const nameSection = document.createElement('div');
      nameSection.className = 'name-picker-wrap';

      if (p.name){
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
      STANDARD_MOVES.forEach(m => {
        const btn = document.createElement('div');
        btn.className = 'move-btn' + (p.mode === m.key ? ' selected' : '');
        btn.innerHTML = `<span class="emoji">${m.emoji}</span><span>${moveLabelHtml(m)}</span>`;
        btn.addEventListener('click', () => {
          draftParticipants[i].mode = (p.mode === m.key) ? null : m.key;
          renderParticipantForm();
        });
        moves.appendChild(btn);
      });
      const customBtn = document.createElement('div');
      customBtn.className = 'move-btn custom' + (p.mode === 'custom' ? ' selected' : '');
      customBtn.innerHTML = `<span class="emoji">✍️</span><span>独自手</span>`;
      customBtn.addEventListener('click', () => {
        draftParticipants[i].mode = (p.mode === 'custom') ? null : 'custom';
        if (draftParticipants[i].mode === 'custom') draftParticipants[i].customText = '';
        renderParticipantForm();
      });
      moves.appendChild(customBtn);
      block.appendChild(moves);

      if (p.mode === 'custom'){
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
          history.forEach(move => {
            const chip = document.createElement('div');
            chip.className = 'custom-history-chip' + (p.customText === move ? ' selected' : '');
            chip.textContent = move;
            chip.addEventListener('click', () => {
              draftParticipants[i].customText = move;
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
      chip.textContent = (p.name || ('参加者' + (i+1))) + ' の勝ち';
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

  addParticipantBtn.addEventListener('click', () => {
    draftParticipants.push(newParticipant(''));
    syncNamesFromRoster();
    renderParticipantForm();
    renderWinnerChoices();
  });

  async function submitRound(){
    const withItems = draftParticipants.map(p => ({
      name: p.name.trim() || '名無し',
      item: participantItemText(p)
    }));
    const cleaned = withItems.filter(p => p.item !== '');

    if (cleaned.length < 2){
      showToast('2人以上、手を選んでね');
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

  function updateCustomMoveHistory(participants){
    participants.forEach(p => {
      if (p.mode !== 'custom') return;
      const text = p.customText.trim();
      if (!text) return;
      customMoveHistory = customMoveHistory.filter(m => m !== text);
      customMoveHistory.unshift(text);
    });
    customMoveHistory = customMoveHistory.slice(0, MAX_CUSTOM_MOVES);
  }


  async function loadCustomMoves(){ /* loadRounds() が兼ねる */ }

  async function deleteRound(id){
    rounds = rounds.filter(r => r.id !== id);
    await persistRounds();
    renderHistory();
    renderStats();
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
      const hay = r.participants.map(p => p.name + ' ' + p.item).join(' ').toLowerCase() + ' ' + (r.memo||'').toLowerCase();
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
        tag.innerHTML = `<span class="p-name">${escapeHtml(p.name)}</span><span class="p-item">${moveItemHtml(p.item)}</span>`;
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

  function renderStats(){
    const counts = {};
    rounds.forEach(r => {
      r.participants.forEach(p => {
        const key = p.item.trim();
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
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
    renderParticipantForm();
    setMode('edit');
    pollTimer = setInterval(pollUpdates, POLL_INTERVAL_MS);
  }



  init();
})();
