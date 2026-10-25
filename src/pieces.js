// 将棋の駒8種類の定義。
// ジャンプの性能は駒ごとに異なる（単位はすべて 1フレーム=1/60秒 あたりのピクセル）。
//   jumpPower : ジャンプ初速
//   gravity   : 重力加速度
//   maxJumps  : 空中ジャンプを含めた最大ジャンプ回数（2なら二段ジャンプ）
//   airJumpMul: 空中ジャンプの初速倍率
//   floatFrames: 下降中にジャンプボタンを押し続けるとふわっと浮ける時間（0で無効）
//   skill     : 2つ目のボタンの効果（後ほど実装予定。null の間は何も起きない）
window.PIECES = [
  {
    id: 'fu', kanji: '歩', name: '歩兵',
    desc: '素直なジャンプ。基本の一歩。',
    jumpPower: 13, gravity: 0.7, maxJumps: 1, airJumpMul: 0, floatFrames: 0,
    skill: null,
  },
  {
    id: 'kyo', kanji: '香', name: '香車',
    desc: '低く長く、まっすぐ跳ぶ。',
    jumpPower: 10.5, gravity: 0.42, maxJumps: 1, airJumpMul: 0, floatFrames: 0,
    skill: null,
  },
  {
    id: 'kei', kanji: '桂', name: '桂馬',
    desc: '駒を飛び越える大跳躍。',
    jumpPower: 17, gravity: 0.85, maxJumps: 1, airJumpMul: 0, floatFrames: 0,
    skill: null,
  },
  {
    id: 'gin', kanji: '銀', name: '銀将',
    desc: '下降中に押し続けるとふわっと浮く。',
    jumpPower: 12.5, gravity: 0.68, maxJumps: 1, airJumpMul: 0, floatFrames: 40,
    skill: null,
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
    desc: '力強い二段ジャンプ。',
    jumpPower: 14, gravity: 0.6, maxJumps: 2, airJumpMul: 0.85, floatFrames: 0,
    skill: null,
  },
  {
    id: 'ou', kanji: '王', name: '王将',
    desc: '空中で何度も跳べる三段ジャンプ。',
    jumpPower: 11.5, gravity: 0.72, maxJumps: 3, airJumpMul: 0.75, floatFrames: 0,
    skill: null,
  },
];
