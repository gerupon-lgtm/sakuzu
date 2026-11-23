// 画面に出す文言（A区分: 発案者の指示ですぐ変えてよい）
import { roundHalfUp } from "../shared/round.js";
export const MSG = {
  CIRCLE_NO_INTERSECTION: (g) => `円が交わりません（あと${roundHalfUp(g * 100, 1)}cm足りません）`,
  CIRCLE_SAME_CENTER: () => "2つの点が同じ位置です",
  POLAR_BAD_DISTANCE: () => "距離は0より大きい値を入れてください",
  POLAR_BAD_ANGLE: () => "角度は0〜180°で入れてください",
  POLY_SELF_INTERSECT: () => "線が交差しているため計算できません",
  POLY_TOO_FEW: () => "3点以上が必要です",
  POLY_ZERO_AREA: () => "面積が0です",
  BLOCKED: () => "計算できない点を含みます",
  DATE_INVALID: () => "日付が正しくありません（例: 2026/11/23）",
};
export const msgOf = (p) => (MSG[p.code] ? MSG[p.code](p.gap) : p.code);
export const COMPUTED_SUFFIX = "（計算値）";
export const AREA_LABEL = "概算面積";
