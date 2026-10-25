// 将棋の駒8種類の定義。
// 単位はすべて 1フレーム=1/60秒 あたりのピクセル。
//
// ジャンプ（1つ目のボタン）
//   jumpPower : ジャンプ初速（jumpAngle があるときは斜め方向の速さ）
//   gravity   : 重力加速度
//   jumpTop   : true なら押した長さに関係なく画面の上端まで跳ぶ
//   jumpAngle : 跳ぶ角度（度）。90が真上、90未満で前、90より大きいと後ろへ跳ぶ
//   maxJumps  : 空中ジャンプを含めた最大ジャンプ回数（2なら二段ジャンプ）
//   airJumpMul: 空中ジャンプの初速倍率
//   floatFrames: 下降中にジャンプボタンを押し続けるとふわっと浮ける時間（0で無効）
//   airDash   : 空中でジャンプを押すと、その高さのまま前へ移動する
//
// スキル（2つ目のボタン）
//   skill: null なら何も起きない。以下のどれか
//     { type: 'angleJump', angle }  地上から jumpAngle の代わりに angle の向きで跳ぶ
//     { type: 'glide', frames }     空中で押している間、ゆっくり降りる（1回の滞空で frames まで）
//     { type: 'dash', dir }         空中で、その高さのまま dir 方向（-1 で後ろ）へ移動する
//   空中ダッシュはジャンプ・スキル合わせて1回の滞空で1回まで。
window.PIECES = [
  {
    id: 'fu', kanji: '歩', name: '歩兵',
    desc: '小さなジャンプ。一歩ずつ確実に。',
    jumpPower: 8.7, gravity: 0.7, maxJumps: 1, airJumpMul: 0, floatFrames: 0,
    skill: null,
  },
  {
    id: 'kyo', kanji: '香', name: '香車',
    desc: '画面の上まで一気に跳ぶ。',
    jumpTop: true, gravity: 1.5, maxJumps: 1, airJumpMul: 0, floatFrames: 0,
    skill: null,
  },
  {
    id: 'kei', kanji: '桂', name: '桂馬',
    desc: '斜め前に跳ぶ。スキルで斜め後ろに跳ぶ。',
    jumpPower: 16, jumpAngle: 75, gravity: 0.8, maxJumps: 1, airJumpMul: 0, floatFrames: 0,
    skill: { type: 'angleJump', angle: 115, label: '後ろ跳び' },
  },
  {
    id: 'gin', kanji: '銀', name: '銀将',
    desc: 'スキルを押している間、滑空できる。',
    jumpPower: 12.5, gravity: 0.68, maxJumps: 1, airJumpMul: 0, floatFrames: 0,
    skill: { type: 'glide', frames: 90, label: '滑空' },
  },
  {
    id: 'kin', kanji: '金', name: '金将',
    desc: '堅実な二段ジャンプ。',
    jumpPower: 12, gravity: 0.72, maxJumps: 2, airJumpMul: 0.8, floatFrames: 0,
    skill: null,
  },
  {
    id: 'kaku', kanji: '角', name: '角行',
    desc: '斜めに大きく滑空する。',
    jumpPower: 12.5, gravity: 0.48, maxJumps: 1, airJumpMul: 0, floatFrames: 20,
    skill: null,
  },
  {
    id: 'hisha', kanji: '飛', name: '飛車',
    desc: '空中でジャンプすると前へ、スキルで後ろへまっすぐ移動。',
    jumpPower: 14, gravity: 0.6, maxJumps: 1, airJumpMul: 0, floatFrames: 0, airDash: true,
    skill: { type: 'dash', dir: -1, label: '後退' },
  },
  {
    id: 'ou', kanji: '王', name: '王将',
    desc: '空中で何度も跳べる三段ジャンプ。',
    jumpPower: 11.5, gravity: 0.72, maxJumps: 3, airJumpMul: 0.75, floatFrames: 0,
    skill: null,
  },
];
