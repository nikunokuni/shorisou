(() => {
  'use strict';

  // ---- 定数 ----
  const W = 960;
  const H = 540;
  const GROUND_Y = 400;       // 道の上端（プレイヤーの足元）
  const PLAYER_X = 220;       // プレイヤーの画面上のX座標
  const PIECE_W = 46;
  const PIECE_H = 54;
  const STEP = 1000 / 60;     // 物理更新は固定60fps
  const BASE_SPEED = 6;
  const MAX_SPEED = 12;
  const SPEED_UP = 0.0004;    // 1px進むごとに増える速度
  const CUT_GRAVITY = 2.4;    // 上昇中にボタンを離したときの重力倍率（小ジャンプ用）
  const FLOAT_GRAVITY = 0.2;  // 浮遊中の重力倍率
  const COYOTE_FRAMES = 6;    // 道の端から落ちた直後でもジャンプできる猶予
  const BUFFER_FRAMES = 6;    // 着地直前の先行入力の猶予
  const BOARD_CELL = 48;      // 道（将棋盤）のマス目サイズ

  const PIECES = window.PIECES;

  // ---- キャンバス ----
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- ハイスコア ----
  function loadBest(id) {
    try { return Number(localStorage.getItem('shorisou.best.' + id)) || 0; } catch (e) { return 0; }
  }
  function saveBest(id, v) {
    try { localStorage.setItem('shorisou.best.' + id, String(v)); } catch (e) { /* 保存できなくても続行 */ }
  }

  // ---- ジャンプ性能の計算 ----
  // ボタンを押しっぱなしで1回跳んだときの滞空フレーム数
  function airFrames(p) {
    let y = 0, vy = -p.jumpPower, floatLeft = p.floatFrames, t = 0;
    while (t < 600) {
      let g = p.gravity;
      if (vy > 0 && floatLeft > 0) { g *= FLOAT_GRAVITY; floatLeft--; }
      vy += g;
      y += vy;
      t++;
      if (y >= 0) break;
    }
    return t;
  }
  function jumpHeight(p) { return (p.jumpPower * p.jumpPower) / (2 * p.gravity); }

  // ---- 状態 ----
  let state = 'select';  // select | playing | over
  let piece = null;
  let reach = 0;          // 1回のジャンプの滞空フレーム数（穴の幅の上限に使う）
  let camera = 0;
  let speed = BASE_SPEED;
  let segments = [];
  let particles = [];
  let player = null;
  let best = 0;
  let overAt = 0;
  let frame = 0;

  const input = { jumpHeld: false, jumpBuffer: 0 };

  function newPlayer() {
    return {
      y: GROUND_Y, vy: 0,
      onGround: true, coyote: 0,
      jumpsUsed: 0, floatLeft: 0,
      falling: false, angle: 0,
    };
  }

  // ---- コース生成 ----
  function lastEnd() {
    const s = segments[segments.length - 1];
    return s ? s.x + s.w : 0;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function generate() {
    while (lastEnd() < camera + W + 300) {
      const x = lastEnd();
      const last = segments[segments.length - 1];
      // 進んだ距離に応じて難しくなる（0〜1）
      const diff = Math.min(1, camera / 30000);
      // 生成時点の速度で計算（実際に到達する頃は少し速いので余裕が出る）
      const s = Math.min(MAX_SPEED, BASE_SPEED + x * SPEED_UP);
      if (!last || last.type === 'hole') {
        const minRoad = Math.max(140, s * 26);
        const maxRoad = Math.max(minRoad + 40, 560 - diff * 260);
        segments.push({ type: 'road', x, w: rand(minRoad, maxRoad) });
      } else {
        const maxGap = reach * s;
        const lo = 0.3 + diff * 0.25;
        const hi = 0.5 + diff * 0.25;
        segments.push({ type: 'hole', x, w: Math.max(50, maxGap * rand(lo, hi)) });
      }
    }
    while (segments.length && segments[0].x + segments[0].w < camera - 100) segments.shift();
  }

  // プレイヤーの足元に道があるか
  function supported() {
    const left = camera + PLAYER_X - PIECE_W / 2 + 6;
    const right = camera + PLAYER_X + PIECE_W / 2 - 6;
    for (const s of segments) {
      if (s.type === 'road' && s.x < right && s.x + s.w > left) return true;
    }
    return false;
  }

  // ---- ゲーム進行 ----
  function startGame(p) {
    piece = p;
    reach = airFrames(p);
    best = loadBest(p.id);
    camera = 0;
    speed = BASE_SPEED;
    particles = [];
    player = newPlayer();
    // 最初は長い道から
    segments = [{ type: 'road', x: -200, w: PLAYER_X + 200 + 700 }];
    generate();
    input.jumpBuffer = 0;
    state = 'playing';
    selectEl.classList.add('hidden');
    overEl.classList.add('hidden');
    updateSkillButton();
  }

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    const dist = Math.floor(camera / 10);
    const isBest = dist > best;
    if (isBest) { best = dist; saveBest(piece.id, dist); }
    document.getElementById('over-score').textContent = `${piece.name}　${dist} m`;
    document.getElementById('over-best').textContent = isBest ? '★ 自己ベスト更新！' : `ベスト ${best} m`;
    overEl.classList.remove('hidden');
  }

  function showSelect() {
    state = 'select';
    overEl.classList.add('hidden');
    selectEl.classList.remove('hidden');
  }

  function tryJump() {
    const p = player;
    if (p.falling) return false;
    if (p.onGround || p.coyote > 0) {
      p.vy = -piece.jumpPower;
      p.jumpsUsed = 1;
    } else if (p.jumpsUsed < piece.maxJumps) {
      p.vy = -piece.jumpPower * piece.airJumpMul;
      p.jumpsUsed++;
      puff(PLAYER_X, p.y, 6);
    } else {
      return false;
    }
    p.onGround = false;
    p.coyote = 0;
    p.floatLeft = piece.floatFrames;
    return true;
  }

  function useSkill() {
    if (state !== 'playing' || !piece.skill) return;
    piece.skill(player);
  }

  function update() {
    frame++;
    if (state !== 'playing') { updateParticles(); return; }

    speed = Math.min(MAX_SPEED, BASE_SPEED + camera * SPEED_UP);
    camera += speed;
    generate();

    const p = player;

    if (input.jumpBuffer > 0) {
      if (tryJump()) input.jumpBuffer = 0;
      else input.jumpBuffer--;
    }

    if (!p.onGround) {
      let g = piece.gravity;
      if (p.vy < 0 && !input.jumpHeld) g *= CUT_GRAVITY;
      else if (p.vy > 0 && input.jumpHeld && p.floatLeft > 0) { g *= FLOAT_GRAVITY; p.floatLeft--; }
      p.vy += g;
      const ny = p.y + p.vy;
      const onRoad = supported();
      if (!p.falling && p.vy >= 0 && p.y <= GROUND_Y && ny >= GROUND_Y && onRoad) {
        // 着地
        p.y = GROUND_Y;
        p.vy = 0;
        p.onGround = true;
        p.jumpsUsed = 0;
        puff(PLAYER_X, GROUND_Y, 5);
      } else {
        p.y = ny;
        if (p.y > GROUND_Y + 2 && p.coyote === 0) p.falling = true;  // 道より下に落ちたらもう戻れない
      }
      if (p.coyote > 0 && --p.coyote === 0) p.jumpsUsed = Math.max(p.jumpsUsed, 1);
    } else if (!supported()) {
      // 道の端から踏み外した
      p.onGround = false;
      p.coyote = COYOTE_FRAMES;
    }

    // 見た目の傾き
    const target = p.falling ? 1.2 : p.onGround ? 0 : Math.max(-0.35, Math.min(0.35, p.vy * 0.03));
    p.angle += (target - p.angle) * 0.2;

    if (p.onGround && frame % 6 === 0) puff(PLAYER_X - PIECE_W / 2, GROUND_Y, 1);

    updateParticles();

    if (p.y > H + PIECE_H * 2) gameOver();
  }

  // ---- パーティクル ----
  function puff(x, y, n) {
    for (let i = 0; i < n; i++) {
      particles.push({ x, y, vx: rand(-2.5, 0.5) - speed * 0.3, vy: rand(-2, -0.3), life: rand(18, 30), max: 30 });
    }
  }
  function updateParticles() {
    for (const q of particles) { q.x += q.vx; q.y += q.vy; q.vy += 0.05; q.life--; }
    particles = particles.filter((q) => q.life > 0);
  }

  // ---- 描画 ----
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#f7c58a');
    sky.addColorStop(0.55, '#f9e3c0');
    sky.addColorStop(1, '#f2d3a6');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 太陽
    ctx.fillStyle = 'rgba(214, 72, 40, 0.85)';
    ctx.beginPath();
    ctx.arc(760, 130, 56, 0, Math.PI * 2);
    ctx.fill();

    // 遠くの山（視差スクロール）
    drawHills(camera * 0.1, 300, 70, 0.0045, 'rgba(120, 82, 60, 0.35)');
    drawHills(camera * 0.25, 340, 50, 0.008, 'rgba(95, 62, 42, 0.45)');

    // 穴の底（闇）
    const pit = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    pit.addColorStop(0, '#2a1a10');
    pit.addColorStop(1, '#0a0604');
    ctx.fillStyle = pit;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  }

  function drawHills(offset, baseY, amp, freq, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const t = (x + offset) * freq;
      ctx.lineTo(x, baseY - amp * (0.6 * Math.sin(t) + 0.4 * Math.sin(t * 2.3 + 1)));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawRoad() {
    for (const s of segments) {
      if (s.type !== 'road') continue;
      const x = s.x - camera;
      if (x > W || x + s.w < 0) continue;
      // 将棋盤風の道
      ctx.fillStyle = '#d9a85b';
      ctx.fillRect(x, GROUND_Y, s.w, H - GROUND_Y);
      ctx.fillStyle = '#c18f45';
      ctx.fillRect(x, GROUND_Y, s.w, 6);
      ctx.strokeStyle = 'rgba(60, 30, 5, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const start = Math.ceil(s.x / BOARD_CELL) * BOARD_CELL;
      for (let gx = start; gx < s.x + s.w; gx += BOARD_CELL) {
        const sx = gx - camera;
        ctx.moveTo(sx, GROUND_Y + 6);
        ctx.lineTo(sx, H);
      }
      for (let gy = GROUND_Y + 6 + BOARD_CELL; gy < H; gy += BOARD_CELL) {
        ctx.moveTo(x, gy);
        ctx.lineTo(x + s.w, gy);
      }
      ctx.stroke();
      // 縁取り
      ctx.strokeStyle = '#6b3d14';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, GROUND_Y + 1.5, s.w - 3, H - GROUND_Y + 10);
    }
  }

  function drawPiece(cx, bottom, angle, p) {
    ctx.save();
    ctx.translate(cx, bottom - PIECE_H / 2);
    ctx.rotate(angle);
    ctx.translate(0, PIECE_H / 2);
    const w = PIECE_W, h = PIECE_H;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(w * 0.39, -h * 0.78);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(-w / 2, 0);
    ctx.lineTo(-w * 0.39, -h * 0.78);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -h, 0, 0);
    g.addColorStop(0, '#f6dda6');
    g.addColorStop(1, '#d5a65c');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#6b3d14';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#1a0f05';
    ctx.font = 'bold 26px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.kanji, 0, -h * 0.42);
    ctx.restore();
  }

  function drawHud() {
    ctx.fillStyle = 'rgba(30, 15, 5, 0.6)';
    ctx.fillRect(16, 16, 230, 64);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`${Math.floor(camera / 10)} m`, 30, 50);
    ctx.font = '14px sans-serif';
    ctx.fillText(`${piece.name}　ベスト ${best} m`, 30, 70);

    // 残りジャンプ回数（多段ジャンプの駒のみ）
    if (piece.maxJumps > 1) {
      const left = player.onGround ? piece.maxJumps : piece.maxJumps - player.jumpsUsed;
      for (let i = 0; i < piece.maxJumps; i++) {
        ctx.fillStyle = i < left ? '#ffc35c' : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(200 + i * 14, 45, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function render() {
    drawBackground();
    if (state === 'select') {
      drawSelectBackdrop();
      return;
    }
    drawRoad();
    for (const q of particles) {
      ctx.fillStyle = `rgba(120, 80, 40, ${q.life / q.max * 0.6})`;
      ctx.fillRect(q.x, q.y - 3, 4, 4);
    }
    drawPiece(PLAYER_X, player.y, player.angle, piece);
    drawHud();
  }

  // 選択画面の背景で駒が並んで走る
  function drawSelectBackdrop() {
    ctx.fillStyle = '#d9a85b';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    PIECES.forEach((p, i) => {
      const x = ((i * 120 + frame * 2) % (W + 120)) - 60;
      const hop = Math.abs(Math.sin((frame + i * 20) * 0.06)) * 30;
      drawPiece(x, GROUND_Y - hop, 0, p);
    });
  }

  // ---- メインループ ----
  let last = performance.now();
  let acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
    requestAnimationFrame(loop);
  }

  // ---- 駒選択UI ----
  const selectEl = document.getElementById('select');
  const overEl = document.getElementById('over');
  const listEl = document.getElementById('piece-list');

  const maxH = Math.max(...PIECES.map(jumpHeight));
  const maxT = Math.max(...PIECES.map(airFrames));
  const maxJ = Math.max(...PIECES.map((p) => p.maxJumps));

  PIECES.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'piece-card';
    const bar = (label, v) =>
      `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
    btn.innerHTML =
      `<div class="koma">${p.kanji}</div>` +
      `<div class="piece-name">${i + 1}. ${p.name}</div>` +
      `<div class="piece-desc">${p.desc}</div>` +
      `<div class="stats">${bar('高さ', jumpHeight(p) / maxH)}${bar('滞空', airFrames(p) / maxT)}${bar('段数', p.maxJumps / maxJ)}</div>`;
    btn.addEventListener('click', () => startGame(p));
    listEl.appendChild(btn);
  });

  document.getElementById('btn-retry').addEventListener('click', () => startGame(piece));
  document.getElementById('btn-change').addEventListener('click', showSelect);

  // ---- 入力 ----
  function jumpDown() {
    if (state === 'playing') {
      if (!input.jumpHeld) input.jumpBuffer = BUFFER_FRAMES;
      input.jumpHeld = true;
    } else if (state === 'over' && performance.now() - overAt > 500) {
      startGame(piece);
      input.jumpHeld = true;
    }
  }
  function jumpUp() { input.jumpHeld = false; }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyZ') {
      e.preventDefault();
      if (!e.repeat) jumpDown();
    } else if (e.code === 'KeyX') {
      e.preventDefault();
      if (!e.repeat) useSkill();
    } else if (state === 'select' && /^Digit[1-8]$/.test(e.code)) {
      startGame(PIECES[Number(e.code.slice(5)) - 1]);
    } else if (state === 'over' && e.code === 'Escape') {
      showSelect();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyZ') jumpUp();
  });
  window.addEventListener('blur', jumpUp);

  function bindButton(el, down, up) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      down();
    });
    const release = () => { el.classList.remove('pressed'); if (up) up(); };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindButton(document.getElementById('btn-jump'), jumpDown, jumpUp);
  const skillBtn = document.getElementById('btn-skill');
  bindButton(skillBtn, useSkill);

  function updateSkillButton() {
    skillBtn.querySelector('small').textContent = piece && piece.skill ? '' : '準備中';
  }

  requestAnimationFrame(loop);
})();
