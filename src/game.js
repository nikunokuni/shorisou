(() => {
  'use strict';

  // ---- 定数 ----
  const W = 960;
  const H = 540;
  const GROUND_Y = 400;       // スタート地点の道の高さ
  const Y_TOP = 230;          // 道の高さの上限（画面上の座標なので小さいほど高い）
  const Y_BOT = 450;          // 道の高さの下限。これより下に落ちたら復帰できない
  const HOME_X = 300;         // プレイヤーの基本の画面上のX座標。地上ではここへ戻っていく
  const RIGHT_LIMIT = W - 160; // これより右には進めない
  const RETURN_SPEED = 1.5;   // 地上で基本位置へ戻る速さ
  const PIECE_W = 46;
  const PIECE_H = 54;
  const TOP_APEX = PIECE_H + 8; // 「画面の上まで跳ぶ」ときの最高点（足元のY座標）
  const STEP = 1000 / 60;     // 物理更新は固定60fps
  const BASE_SPEED = 6;
  const MAX_SPEED = 12;
  const SPEED_UP = 0.0004;    // 1px進むごとに増える速度
  const CUT_GRAVITY = 2.4;    // 上昇中にボタンを離したときの重力倍率（小ジャンプ用）
  const FLOAT_GRAVITY = 0.2;  // 浮遊中の重力倍率
  const GLIDE_FALL = 1.2;     // 滑空中の落下速度の上限
  const DASH_FRAMES = 14;     // 空中ダッシュの時間
  const DASH_SPEED = 10;      // 空中ダッシュの速さ（画面に対して）
  const COYOTE_FRAMES = 6;    // 道の端から落ちた直後でもジャンプできる猶予
  const BUFFER_FRAMES = 6;    // 着地直前の先行入力の猶予
  const BOARD_CELL = 48;      // 道（将棋盤）のマス目サイズ
  const SNAP = 10;            // 接地中、これ以内の下り（坂）なら地面に吸い付く
  const LAND_TOL = 12;        // 着地判定の許容量。これより深く地面にめり込んだら壁に激突
  const WALL_TOL = 6;         // 段差の角に足がこれ以上めり込んだら壁に激突
  const MAX_SLOPE = 0.45;     // 坂の最大傾き
  const CRASH_FRAMES = 45;    // 激突してからゲームオーバー画面までの時間

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
  // 高さ y0 から地上ジャンプしたときの初速。angle を省略すると駒の通常ジャンプの向き
  function launch(p, y0, angle) {
    if (p.jumpTop) return { vx: 0, vy: -Math.sqrt(2 * p.gravity * Math.max(0, y0 - TOP_APEX)) };
    const a = ((angle !== undefined ? angle : p.jumpAngle || 90) * Math.PI) / 180;
    return { vx: p.jumpPower * Math.cos(a), vy: -p.jumpPower * Math.sin(a) };
  }
  function jumpHeight(p, y0 = GROUND_Y) {
    const vy = launch(p, y0).vy;
    return (vy * vy) / (2 * p.gravity);
  }
  // ボタンを押しっぱなしで高さ y0 から跳んだとき、踏み切りより h だけ高い位置まで落ちてくるフレーム数
  // （h が負なら低い位置。届かない高さなら 0）
  function framesToHeight(p, h, y0 = GROUND_Y) {
    let y = 0, vy = launch(p, y0).vy, floatLeft = p.floatFrames, t = 0;
    while (t < 600) {
      let g = p.gravity;
      if (vy > 0 && floatLeft > 0) { g *= FLOAT_GRAVITY; floatLeft--; }
      vy += g;
      y += vy;
      t++;
      if (vy > 0 && y >= -h) return t;
    }
    return 0;
  }
  // ボタンを押しっぱなしで1回跳んだときの滞空フレーム数
  function airFrames(p) { return framesToHeight(p, 0); }

  // ---- 状態 ----
  let state = 'select';  // select | playing | over
  let piece = null;
  let camera = 0;
  let speed = BASE_SPEED;
  let segments = [];
  let particles = [];
  let player = null;
  let best = 0;
  let overAt = 0;
  let frame = 0;

  const input = { jumpHeld: false, jumpBuffer: 0, skillHeld: false, skillBuffer: 0 };

  function newPlayer() {
    return {
      sx: HOME_X, y: GROUND_Y,  // sx は画面上のX座標、y は足元のY座標
      vx: 0, vy: 0,             // vx は画面に対する横の速さ
      onGround: true, coyote: 0,
      jumpsUsed: 0, floatLeft: 0, glideLeft: 0,
      dash: 0, dashUsed: false,
      falling: false, crashed: 0, outLeft: false, angle: 0,
    };
  }

  // ---- コース生成 ----
  function lastEnd() {
    const s = segments[segments.length - 1];
    return s ? s.x + s.w : 0;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function clampY(y) { return Math.max(Y_TOP, Math.min(Y_BOT, y)); }
  function speedAt(x) { return Math.min(MAX_SPEED, BASE_SPEED + x * SPEED_UP); }

  // 道を1本作る。進むほど坂が多く急になる
  function makeRoad(x, y0, s, diff) {
    let minRoad = Math.max(140, s * 26);
    // 跳ぶ距離を調整できない駒は、着地した道でもう一度跳べるよう道を長くする
    if (piece.jumpTop) minRoad = Math.max(minRoad, framesToHeight(piece, 0, y0) * s);
    const maxRoad = Math.max(minRoad + 40, 560 - diff * 260);
    const w = rand(minRoad, maxRoad);
    let y1 = y0;
    if (Math.random() < 0.3 + diff * 0.4) {
      const amp = Math.min(MAX_SLOPE * w, 40 + diff * 120);
      y1 = clampY(y0 + rand(-amp, amp));
    }
    return { type: 'road', x, w, y0, y1 };
  }

  function generate() {
    while (lastEnd() < camera + W + 300) {
      const x = lastEnd();
      const last = segments[segments.length - 1];
      // 進んだ距離に応じて難しくなる（0〜1）
      const diff = Math.min(1, x / 30000);
      // 生成時点の速度で計算（実際に到達する頃は少し速いので余裕が出る）
      const s = speedAt(x);
      if (last.type === 'hole') {
        segments.push(makeRoad(x, last.nextY, s, diff));
        continue;
      }
      const cur = last.y1;
      // 段差の上限は駒のジャンプ力で決まり、進むほど大きくなる
      const upMax = Math.min(jumpHeight(piece, cur) * 0.55, 20 + diff * 110);
      const downMax = 30 + diff * 120;
      let dy = clampY(cur + rand(-upMax, downMax)) - cur;
      // 上り坂の直後に上り段差があると、坂に引っかかって越えられないので下りにする
      if (last.y1 < last.y0 - 5) dy = clampY(cur + Math.abs(dy)) - cur;
      if (Math.abs(dy) < 16) dy = 0;
      const r = Math.random();
      const pHole = 0.3 + diff * 0.45;
      if (r < pHole) {
        // 穴：向こう岸の高さに合わせて、ジャンプで届く幅にする
        const f = framesToHeight(piece, -dy + WALL_TOL, cur);
        const lo = 0.35 + diff * 0.2;
        const hi = 0.55 + diff * 0.2;
        segments.push({ type: 'hole', x, w: Math.max(50, f * s * rand(lo, hi)), prevY: cur, nextY: cur + dy });
      } else if (r < pHole + 0.15 + diff * 0.2) {
        // 段差：上りなら壁になる
        segments.push(makeRoad(x, cur + dy, s, diff));
      } else {
        segments.push(makeRoad(x, cur, s, diff));
      }
    }
    while (segments.length && segments[0].x + segments[0].w < camera - 300) segments.shift();
  }

  // ワールド座標 wx の道の高さ（穴なら null）
  function groundAt(wx) {
    for (const s of segments) {
      if (s.type === 'road' && wx >= s.x && wx < s.x + s.w) return s.y0 + (s.y1 - s.y0) * (wx - s.x) / s.w;
    }
    return null;
  }

  // プレイヤーの足元で一番高い道の高さ（足元が全部穴なら null）
  function surfaceUnder() {
    const cx = camera + player.sx;
    let best = null;
    for (const wx of [cx - PIECE_W / 2 + 6, cx, cx + PIECE_W / 2 - 6]) {
      const y = groundAt(wx);
      if (y !== null && (best === null || y < best)) best = y;
    }
    return best;
  }

  // ---- ゲーム進行 ----
  function startGame(p) {
    piece = p;
    best = loadBest(p.id);
    camera = 0;
    speed = BASE_SPEED;
    particles = [];
    player = newPlayer();
    // 最初は長い道から
    segments = [{ type: 'road', x: -300, w: HOME_X + 300 + 700, y0: GROUND_Y, y1: GROUND_Y }];
    generate();
    input.jumpBuffer = 0;
    input.skillBuffer = 0;
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
    document.getElementById('over-title').textContent =
      player.outLeft ? 'はみ出した…' : player.crashed ? 'ぶつかった…' : '落ちた…';
    document.getElementById('over-score').textContent = `${piece.name}　${dist} m`;
    document.getElementById('over-best').textContent = isBest ? '★ 自己ベスト更新！' : `ベスト ${best} m`;
    overEl.classList.remove('hidden');
  }

  function showSelect() {
    state = 'select';
    overEl.classList.add('hidden');
    selectEl.classList.remove('hidden');
  }

  function crash() {
    const p = player;
    p.crashed = 1;
    p.vy = -6;
    p.onGround = false;
    puff(p.sx, p.y - PIECE_H / 2, 12);
  }

  function canGroundJump() {
    const p = player;
    return !p.falling && !p.crashed && (p.onGround || p.coyote > 0);
  }
  function canAirAction() {
    const p = player;
    return !p.falling && !p.crashed && !p.onGround && p.coyote === 0;
  }

  // 地上からのジャンプ。angle を省略すると駒の通常ジャンプ
  function groundJump(angle) {
    const p = player;
    const v = launch(piece, p.y, angle);
    p.vx = v.vx;
    p.vy = v.vy;
    p.jumpsUsed = 1;
    p.onGround = false;
    p.coyote = 0;
    p.floatLeft = piece.floatFrames;
    p.glideLeft = piece.skill && piece.skill.type === 'glide' ? piece.skill.frames : 0;
    p.dash = 0;
    p.dashUsed = false;
  }

  // その高さのまま横へまっすぐ移動する（dir: 1 で前、-1 で後ろ）
  function startDash(dir) {
    const p = player;
    p.dash = DASH_FRAMES;
    p.dashUsed = true;
    p.vx = dir * DASH_SPEED;
    p.vy = 0;
    puff(p.sx, p.y - PIECE_H / 2, 6);
  }

  function tryJump() {
    const p = player;
    if (canGroundJump()) {
      groundJump();
    } else if (!canAirAction()) {
      return false;
    } else if (piece.airDash && !p.dashUsed) {
      startDash(1);
    } else if (p.jumpsUsed < piece.maxJumps) {
      p.vy = -piece.jumpPower * piece.airJumpMul;
      p.jumpsUsed++;
      p.floatLeft = piece.floatFrames;
      puff(p.sx, p.y, 6);
    } else {
      return false;
    }
    return true;
  }

  function trySkill() {
    const sk = piece.skill;
    if (!sk) return true;
    if (sk.type === 'angleJump') {
      if (!canGroundJump()) return false;
      groundJump(sk.angle);
    } else if (sk.type === 'dash') {
      if (!canAirAction() || player.dashUsed) return false;
      startDash(sk.dir);
    }
    // glide は押している間だけ効くので、ここでは何もしない
    return true;
  }

  function update() {
    frame++;
    if (state !== 'playing') { updateParticles(); return; }

    const p = player;

    if (p.crashed) {
      // 激突：その場で跳ね返って落ちる
      p.vy += piece.gravity;
      p.y += p.vy;
      p.angle -= 0.15;
      updateParticles();
      if (++p.crashed > CRASH_FRAMES) gameOver();
      return;
    }

    speed = speedAt(camera);
    const prevFront = camera + p.sx + PIECE_W / 2 - 4;
    const prevBack = camera + p.sx - PIECE_W / 2 + 4;
    camera += speed;
    if (p.onGround) {
      p.sx += Math.max(-RETURN_SPEED, Math.min(RETURN_SPEED, (HOME_X - p.sx) * 0.05));
    } else {
      p.sx += p.vx;
    }
    p.sx = Math.min(RIGHT_LIMIT, p.sx);
    generate();

    // 画面の左からはみ出したらアウト
    if (p.sx - PIECE_W / 2 < 0) {
      p.outLeft = true;
      gameOver();
      return;
    }

    // 段差の壁・穴の向こう岸の壁にぶつかったか（後ろへ移動中は背後の壁も）
    const front = camera + p.sx + PIECE_W / 2 - 4;
    const back = camera + p.sx - PIECE_W / 2 + 4;
    for (const s of segments) {
      if (s.type !== 'road') continue;
      const hitFront = s.x > prevFront && s.x <= front && p.y > s.y0 + WALL_TOL;
      const end = s.x + s.w;
      const hitBack = end < prevBack && end >= back && p.y > s.y1 + WALL_TOL;
      if (hitFront || hitBack) {
        crash();
        return;
      }
    }

    if (input.jumpBuffer > 0) {
      if (tryJump()) input.jumpBuffer = 0;
      else input.jumpBuffer--;
    }
    if (input.skillBuffer > 0) {
      if (trySkill()) input.skillBuffer = 0;
      else input.skillBuffer--;
    }

    const surf = surfaceUnder();
    if (p.onGround) {
      if (surf !== null && surf - p.y <= SNAP) {
        p.y = surf;
      } else {
        // 道の端・下り段差から踏み外した
        p.onGround = false;
        p.coyote = COYOTE_FRAMES;
        p.vx = 0;
      }
    }
    if (!p.onGround) {
      if (p.dash > 0) {
        // 空中ダッシュ中は高さが変わらない
        p.vy = 0;
        if (--p.dash === 0) p.vx = 0;
      } else {
        let g = piece.gravity;
        if (p.vy < 0 && !input.jumpHeld && !piece.jumpTop) g *= CUT_GRAVITY;
        else if (p.vy > 0 && input.jumpHeld && p.floatLeft > 0) { g *= FLOAT_GRAVITY; p.floatLeft--; }
        p.vy += g;
        if (p.vy > GLIDE_FALL && input.skillHeld && p.glideLeft > 0) {
          p.vy = GLIDE_FALL;
          p.glideLeft--;
        }
      }
      const ny = p.y + p.vy;
      if (!p.falling && surf !== null && ny >= surf && p.y <= surf + LAND_TOL && p.vy > -2) {
        // 着地（上り坂が下から迫ってきた場合も含む）
        p.y = surf;
        p.vx = 0;
        p.vy = 0;
        p.dash = 0;
        p.onGround = true;
        p.jumpsUsed = 0;
        puff(p.sx, surf, 5);
      } else if (!p.falling && surf !== null && ny > surf + LAND_TOL) {
        // 地面にめり込んだ＝壁に激突
        crash();
        return;
      } else {
        p.y = ny;
        if (p.y > Y_BOT + 2 && p.coyote === 0) p.falling = true;  // どの道よりも下に落ちたらもう戻れない
      }
      if (p.coyote > 0 && --p.coyote === 0) p.jumpsUsed = Math.max(p.jumpsUsed, 1);
    }

    // 見た目の傾き
    const target = p.falling ? 1.2 : p.onGround || p.dash > 0 ? 0 : Math.max(-0.35, Math.min(0.35, p.vy * 0.03));
    p.angle += (target - p.angle) * 0.2;

    if (p.onGround && frame % 6 === 0) puff(p.sx - PIECE_W / 2, p.y, 1);

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
      const x = s.x - camera;
      if (x > W || x + s.w < 0) continue;
      if (s.type === 'hole') {
        // 穴（谷底の闇）
        const top = Math.min(s.prevY, s.nextY) + 20;
        const pit = ctx.createLinearGradient(0, top, 0, H);
        pit.addColorStop(0, 'rgba(42, 26, 16, 0)');
        pit.addColorStop(0.3, '#2a1a10');
        pit.addColorStop(1, '#0a0604');
        ctx.fillStyle = pit;
        ctx.fillRect(x - 1, top, s.w + 2, H - top);
        continue;
      }
      // 将棋盤風の道（坂は台形になる）
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, s.y0);
      ctx.lineTo(x + s.w, s.y1);
      ctx.lineTo(x + s.w, H + 10);
      ctx.lineTo(x, H + 10);
      ctx.closePath();
      ctx.fillStyle = '#d9a85b';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(60, 30, 5, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const start = Math.ceil(s.x / BOARD_CELL) * BOARD_CELL;
      for (let gx = start; gx < s.x + s.w; gx += BOARD_CELL) {
        const sx = gx - camera;
        ctx.moveTo(sx, Y_TOP);
        ctx.lineTo(sx, H);
      }
      for (let gy = Y_TOP + BOARD_CELL; gy < H; gy += BOARD_CELL) {
        ctx.moveTo(x, gy);
        ctx.lineTo(x + s.w, gy);
      }
      ctx.stroke();
      ctx.restore();
      // 路面と縁取り
      ctx.strokeStyle = '#c18f45';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x, s.y0 + 3);
      ctx.lineTo(x + s.w, s.y1 + 3);
      ctx.stroke();
      ctx.strokeStyle = '#6b3d14';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 1.5, H + 10);
      ctx.lineTo(x + 1.5, s.y0 + 1.5);
      ctx.lineTo(x + s.w - 1.5, s.y1 + 1.5);
      ctx.lineTo(x + s.w - 1.5, H + 10);
      ctx.stroke();
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

    // 空中ダッシュが使えるか
    if (piece.airDash) {
      ctx.fillStyle = player.onGround || !player.dashUsed ? '#ffc35c' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(228, 45, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 滑空の残り時間
    if (piece.skill && piece.skill.type === 'glide') {
      const left = player.onGround ? 1 : player.glideLeft / piece.skill.frames;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(176, 40, 56, 8);
      ctx.fillStyle = '#ffc35c';
      ctx.fillRect(176, 40, 56 * left, 8);
    }
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
    drawPiece(player.sx, player.y, player.angle, piece);
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
  function skillDown() {
    if (state !== 'playing') return;
    if (!input.skillHeld) input.skillBuffer = BUFFER_FRAMES;
    input.skillHeld = true;
  }
  function skillUp() { input.skillHeld = false; }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyZ') {
      e.preventDefault();
      if (!e.repeat) jumpDown();
    } else if (e.code === 'KeyX') {
      e.preventDefault();
      if (!e.repeat) skillDown();
    } else if (state === 'select' && /^Digit[1-8]$/.test(e.code)) {
      startGame(PIECES[Number(e.code.slice(5)) - 1]);
    } else if (state === 'over' && e.code === 'Escape') {
      showSelect();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyZ') jumpUp();
    else if (e.code === 'KeyX') skillUp();
  });
  window.addEventListener('blur', () => { jumpUp(); skillUp(); });

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
  bindButton(skillBtn, skillDown, skillUp);

  function updateSkillButton() {
    skillBtn.querySelector('small').textContent = piece && piece.skill ? piece.skill.label : 'なし';
    skillBtn.classList.toggle('none', !(piece && piece.skill));
  }

  requestAnimationFrame(loop);
})();
