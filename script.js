(() => {
  'use strict';

  const ROWS = 6, COLS = 7;
  const HISTORY_KEY = 'connect-four-history-v1';
  const HISTORY_MAX = 50;
  const $ = (s) => document.querySelector(s);

  const el = {
    menu: $('#menu'), game: $('#game'),
    board: $('#board'), discs: $('#discs'), grid: $('#grid'), ghost: $('#ghost'),
    turnDisc: $('#turnDisc'), turnText: $('#turnText'),
    score1: $('#score1'), score2: $('#score2'), scoreDraw: $('#scoreDraw'),
    name1: $('#name1'), name2: $('#name2'), card1: $('#card1'), card2: $('#card2'),
    overlay: $('#overlay'), resultEmoji: $('#resultEmoji'),
    resultTitle: $('#resultTitle'), resultText: $('#resultText'),
    historyList: $('#historyList'),
  };

  // ---------- estado ----------
  const settings = { mode: 1, diff: 'medium', sound: true };
  const scores = { 1: 0, 2: 0, draw: 0 };
  let board, cur, startPlayer = 1, busy, over, moves, hoverCol = 3, rid = 0, roundStart = 0;

  // ---------- janelas de 4 (para avaliação) ----------
  const WINDOWS = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      [[0, 1], [1, 0], [1, 1], [1, -1]].forEach(([dr, dc]) => {
        const er = r + dr * 3, ec = c + dc * 3;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) return;
        WINDOWS.push([0, 1, 2, 3].map((i) => [r + dr * i, c + dc * i]));
      });
    }
  }

  // ---------- lógica ----------
  const newBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const ORDER = [3, 2, 4, 1, 5, 0, 6];
  const validCols = (b) => ORDER.filter((c) => b[0][c] === 0);
  const dropRow = (b, c) => { for (let r = ROWS - 1; r >= 0; r--) if (!b[r][c]) return r; return -1; };

  function winsAt(b, r, c, p) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let n = 1;
      for (let i = 1; i < 4; i++) { const y = r + dr * i, x = c + dc * i; if (y < 0 || y >= ROWS || x < 0 || x >= COLS || b[y][x] !== p) break; n++; }
      for (let i = 1; i < 4; i++) { const y = r - dr * i, x = c - dc * i; if (y < 0 || y >= ROWS || x < 0 || x >= COLS || b[y][x] !== p) break; n++; }
      if (n >= 4) return true;
    }
    return false;
  }

  function findWin(b, p) {
    for (const w of WINDOWS) if (w.every(([r, c]) => b[r][c] === p)) return w;
    return null;
  }

  // ---------- IA (minimax + alpha-beta) ----------
  function evaluate(b, me) {
    const opp = 3 - me;
    let s = 0;
    for (let r = 0; r < ROWS; r++) if (b[r][3] === me) s += 3; else if (b[r][3] === opp) s -= 3;
    for (const w of WINDOWS) {
      let m = 0, o = 0;
      for (const [r, c] of w) { if (b[r][c] === me) m++; else if (b[r][c] === opp) o++; }
      if (m && o) continue;
      if (m === 3) s += 6; else if (m === 2) s += 2;
      if (o === 3) s -= 7; else if (o === 2) s -= 2;
    }
    return s;
  }

  function search(b, depth, alpha, beta, maxing, me) {
    const vc = validCols(b);
    if (!vc.length) return 0;
    if (depth === 0) return evaluate(b, me);
    const p = maxing ? me : 3 - me;
    let best = maxing ? -Infinity : Infinity;
    for (const c of vc) {
      const r = dropRow(b, c);
      b[r][c] = p;
      const v = winsAt(b, r, c, p) ? (maxing ? 1 : -1) * (1e6 + depth) : search(b, depth - 1, alpha, beta, !maxing, me);
      b[r][c] = 0;
      if (maxing) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }

  function aiMove(b0, me) {
    const b = b0.map((row) => row.slice());
    const vc = validCols(b);
    const depth = { easy: 2, medium: 4, hard: 7 }[settings.diff];

    // no fácil, às vezes joga aleatório
    if (settings.diff === 'easy' && Math.random() < 0.3) return vc[Math.floor(Math.random() * vc.length)];

    let bestVal = -Infinity, bestCols = [];
    for (const c of vc) {
      const r = dropRow(b, c);
      b[r][c] = me;
      const v = winsAt(b, r, c, me) ? 1e6 + depth : search(b, depth - 1, -Infinity, Infinity, false, me);
      b[r][c] = 0;
      if (v > bestVal) { bestVal = v; bestCols = [c]; }
      else if (v === bestVal) bestCols.push(c);
    }
    return bestCols[Math.floor(Math.random() * bestCols.length)];
  }

  // ---------- som ----------
  let actx;
  function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0, slideTo) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + delay;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) { /* sem áudio */ }
  }
  const sfx = {
    drop: (row) => tone(220 - row * 8, 0.12, 'triangle', 0.25, 0, 90),
    land: () => tone(140, 0.08, 'square', 0.08),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, i * 0.12)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'sawtooth', 0.1, i * 0.14)),
    draw: () => [330, 330].forEach((f, i) => tone(f, 0.2, 'sine', 0.15, i * 0.2)),
    error: () => tone(120, 0.15, 'square', 0.1),
  };

  // ---------- confete ----------
  const cv = $('#confetti'), cctx = cv.getContext('2d');
  function confetti() {
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ['#ff4d60', '#ffdc3a', '#4a7bff', '#6dff9c', '#ffffff'];
    const ps = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * 0.45,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4,
      s: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    (function frame(t) {
      const age = t - t0;
      cctx.clearRect(0, 0, innerWidth, innerHeight);
      if (age > 3200) return;
      ps.forEach((p) => {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.992;
        cctx.save();
        cctx.globalAlpha = Math.max(0, 1 - age / 3200);
        cctx.translate(p.x, p.y); cctx.rotate(p.rot);
        cctx.fillStyle = p.c; cctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6);
        cctx.restore();
      });
      requestAnimationFrame(frame);
    })(t0);
  }

  // ---------- histórico ----------
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (e) { /* sem storage */ }
  }
  function addRecord(winner) {
    const list = loadHistory();
    list.unshift({
      t: Date.now(), mode: settings.mode, diff: settings.diff, winner,
      moves: moves.length, dur: Math.round((Date.now() - roundStart) / 1000),
    });
    saveHistory(list);
  }
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const DIFF_LABEL = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

  function renderHistory() {
    const list = loadHistory();
    const vsCpu = list.filter((r) => r.mode === 1);
    $('#stTotal').textContent = list.length;
    $('#stWins').textContent = vsCpu.filter((r) => r.winner === 1).length;
    $('#stLoss').textContent = vsCpu.filter((r) => r.winner === 2).length;
    $('#stDraws').textContent = list.filter((r) => r.winner === 0).length;
    $('#clearHistoryBtn').style.display = list.length ? '' : 'none';

    el.historyList.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nenhuma partida ainda. Jogue para registrar seu histórico!';
      el.historyList.appendChild(li);
      return;
    }
    list.forEach((r) => {
      let title, disc;
      if (r.winner === 0) { title = 'Empate'; disc = 'split'; }
      else if (r.mode === 1) { title = r.winner === 1 ? 'Você venceu' : 'CPU venceu'; disc = r.winner === 1 ? 'red' : 'yellow'; }
      else { title = `Jogador ${r.winner} venceu`; disc = r.winner === 1 ? 'red' : 'yellow'; }
      const modeTxt = r.mode === 1 ? `1 Jogador · ${DIFF_LABEL[r.diff]}` : '2 Jogadores';
      const when = new Date(r.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

      const li = document.createElement('li');
      li.innerHTML = `<span class="d mini ${disc}"></span>
        <div class="h-main"><b></b><small></small></div><time></time>`;
      li.querySelector('b').textContent = title;
      li.querySelector('small').textContent = `${modeTxt} · ${r.moves} jogadas · ${fmtDur(r.dur)}`;
      li.querySelector('time').textContent = when;
      el.historyList.appendChild(li);
    });
  }

  // ---------- UI ----------
  function buildGrid() {
    el.grid.innerHTML = '';
    for (let i = 0; i < ROWS * COLS; i++) {
      const h = document.createElement('div');
      h.className = 'hole';
      el.grid.appendChild(h);
    }
  }

  function colFromEvent(e) {
    const rect = el.board.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    return Math.max(0, Math.min(COLS - 1, c));
  }

  function nameOf(p) {
    if (settings.mode === 1) return p === 1 ? 'Você' : 'CPU';
    return 'Jogador ' + p;
  }
  const colorOf = (p) => (p === 1 ? 'red' : 'yellow');
  const humanTurn = () => !(settings.mode === 1 && cur === 2);

  function updateTurn() {
    el.turnDisc.className = 'd mini ' + colorOf(cur);
    if (settings.mode === 1) el.turnText.textContent = cur === 1 ? 'Sua vez' : 'CPU pensando…';
    else el.turnText.textContent = `Vez do ${nameOf(cur)}`;
    el.card1.classList.toggle('on', cur === 1 && !over);
    el.card2.classList.toggle('on', cur === 2 && !over);
    updateGhost();
  }

  function updateGhost() {
    const show = !over && !busy && humanTurn();
    el.ghost.className = 'disc ghost ' + colorOf(cur) + (show ? '' : ' hidden');
    el.ghost.style.setProperty('--c', hoverCol);
    el.ghost.style.setProperty('--r', 0);
  }

  function updateScores() {
    el.score1.textContent = scores[1];
    el.score2.textContent = scores[2];
    el.scoreDraw.textContent = scores.draw;
    el.name1.textContent = settings.mode === 1 ? 'Você' : 'Jogador 1';
    el.name2.textContent = settings.mode === 1 ? 'CPU' : 'Jogador 2';
  }

  function startRound() {
    rid++;
    board = newBoard();
    moves = [];
    over = false;
    busy = false;
    cur = startPlayer;
    roundStart = Date.now();
    el.discs.innerHTML = '';
    el.overlay.classList.add('hidden');
    cctx.clearRect(0, 0, cv.width, cv.height);
    updateScores();
    updateTurn();
    if (settings.mode === 1 && cur === 2) cpuTurn();
  }

  function cpuTurn() {
    const id = rid;
    busy = true;
    updateTurn();
    setTimeout(() => {
      if (id !== rid || over) return;
      const c = aiMove(board, 2);
      busy = false;
      play(c);
    }, 450 + Math.random() * 250);
  }

  function play(c) {
    if (busy || over) return;
    const r = dropRow(board, c);
    if (r < 0) { sfx.error(); return; }
    const id = rid;
    busy = true;
    el.ghost.classList.add('hidden');

    board[r][c] = cur;
    const d = document.createElement('div');
    d.className = `disc ${colorOf(cur)} drop`;
    const dur = 0.22 + 0.07 * (r + 1);
    d.style.setProperty('--c', c);
    d.style.setProperty('--r', r);
    d.style.setProperty('--fall', `calc(var(--cell) * ${r + 1.2})`);
    d.style.setProperty('--dur', dur + 's');
    el.discs.appendChild(d);
    moves.push({ r, c, p: cur, el: d });
    sfx.drop(r);
    setTimeout(() => { if (id === rid) sfx.land(); }, dur * 720);

    setTimeout(() => { if (id === rid) afterMove(r, c); }, dur * 1000 + 60);
  }

  function afterMove(r, c) {
    const p = board[r][c];
    if (winsAt(board, r, c, p)) return endRound(p);
    if (!validCols(board).length) return endRound(0);
    cur = 3 - p;
    busy = false;
    updateTurn();
    if (settings.mode === 1 && cur === 2) cpuTurn();
  }

  function endRound(winner) {
    const id = rid;
    over = true;
    busy = false;
    el.ghost.classList.add('hidden');
    addRecord(winner);

    if (winner) {
      scores[winner]++;
      const w = findWin(board, winner);
      if (w) w.forEach(([r, c]) => {
        const m = moves.find((x) => x.r === r && x.c === c);
        if (m) m.el.classList.add('win');
      });
      el.turnText.textContent = `${nameOf(winner)} venceu!`;
      el.turnDisc.className = 'd mini ' + colorOf(winner);
    } else {
      scores.draw++;
      el.turnText.textContent = 'Empate!';
    }
    el.card1.classList.remove('on');
    el.card2.classList.remove('on');
    updateScores();

    let emoji, title, text = '';
    if (!winner) { emoji = '🤝'; title = 'Empate!'; text = 'O tabuleiro ficou cheio.'; sfx.draw(); }
    else if (settings.mode === 1) {
      if (winner === 1) { emoji = '🏆'; title = 'Você venceu!'; text = 'Parabéns, mandou muito bem!'; sfx.win(); confetti(); }
      else { emoji = '🤖'; title = 'A CPU venceu'; text = 'Tente de novo, você consegue!'; sfx.lose(); }
    } else { emoji = '🏆'; title = `${nameOf(winner)} venceu!`; text = 'Quatro em linha!'; sfx.win(); confetti(); }

    el.resultEmoji.textContent = emoji;
    el.resultTitle.textContent = title;
    el.resultText.textContent = text;
    startPlayer = 3 - startPlayer; // alterna quem começa

    setTimeout(() => { if (id === rid && over) el.overlay.classList.remove('hidden'); }, winner ? 1300 : 600);
  }

  function showScreen(name) {
    el.menu.classList.toggle('active', name === 'menu');
    el.game.classList.toggle('active', name === 'game');
    el.overlay.classList.add('hidden');
    if (name === 'menu') renderHistory();
  }

  function goMenu() {
    rid++; // cancela qualquer animação/jogada pendente
    over = true;
    busy = false;
    showScreen('menu');
  }

  function setSound(on) {
    settings.sound = on;
    $('#soundBtn').textContent = on ? '🔊 Som: ligado' : '🔇 Som: desligado';
    $('#soundBtn2').textContent = on ? '🔊' : '🔇';
  }

  function setTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $('#panelPlay').classList.toggle('active', name === 'play');
    $('#panelHistory').classList.toggle('active', name === 'history');
    if (name === 'history') renderHistory();
  }

  // ---------- eventos ----------
  const setHover = (e) => { hoverCol = colFromEvent(e); el.ghost.style.setProperty('--c', hoverCol); };
  el.grid.addEventListener('pointermove', setHover);
  el.grid.addEventListener('pointerdown', setHover);
  el.grid.addEventListener('click', (e) => {
    if (!humanTurn()) return;
    play(colFromEvent(e));
  });

  document.addEventListener('keydown', (e) => {
    if (!el.game.classList.contains('active') || !el.overlay.classList.contains('hidden')) return;
    if (e.key >= '1' && e.key <= '7') { if (humanTurn()) play(+e.key - 1); }
    else if (e.key === 'ArrowLeft') { hoverCol = Math.max(0, hoverCol - 1); updateGhost(); }
    else if (e.key === 'ArrowRight') { hoverCol = Math.min(COLS - 1, hoverCol + 1); updateGhost(); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); if (humanTurn()) play(hoverCol); }
  });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

  $('#modeChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    settings.mode = +b.dataset.mode;
    [...$('#modeChips').children].forEach((x) => x.classList.toggle('active', x === b));
    $('#diffBox').style.display = settings.mode === 1 ? '' : 'none';
  });
  $('#diffChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    settings.diff = b.dataset.diff;
    [...$('#diffChips').children].forEach((x) => x.classList.toggle('active', x === b));
  });

  $('#startBtn').addEventListener('click', () => {
    scores[1] = scores[2] = scores.draw = 0;
    startPlayer = 1;
    showScreen('game');
    startRound();
  });
  $('#menuBtn').addEventListener('click', goMenu);
  $('#toMenuBtn').addEventListener('click', goMenu);
  $('#againBtn').addEventListener('click', startRound);
  $('#restartBtn').addEventListener('click', startRound);
  $('#soundBtn').addEventListener('click', () => setSound(!settings.sound));
  $('#soundBtn2').addEventListener('click', () => setSound(!settings.sound));
  $('#clearHistoryBtn').addEventListener('click', () => {
    if (confirm('Apagar todo o histórico de partidas?')) { saveHistory([]); renderHistory(); }
  });

  buildGrid();
  setSound(true);
  renderHistory();
})();
