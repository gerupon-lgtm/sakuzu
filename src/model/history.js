// 元に戻す・やり直す（最大50件）
export function createHistory(limit = 50) {
  let undo = [], redo = [];
  return {
    push(doc) { undo.push(JSON.stringify(doc)); if (undo.length > limit) undo.shift(); redo = []; },
    undo(cur) { if (!undo.length) return null; redo.push(JSON.stringify(cur)); return JSON.parse(undo.pop()); },
    redo(cur) { if (!redo.length) return null; undo.push(JSON.stringify(cur)); return JSON.parse(redo.pop()); },
    get canUndo() { return undo.length > 0; }, get canRedo() { return redo.length > 0; },
    get size() { return undo.length; },
    clear() { undo = []; redo = []; },
  };
}
