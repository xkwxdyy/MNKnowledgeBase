/* Session-local Pin reconciliation after native undo/redo. No global undo is invoked. */
var KnowledgeBaseMergeHistory = (() => {
  let pending = false;
  let running = false;
  let lastCheck = 0;
  const directions = new WeakMap();
  const reported = new WeakMap();

  function report(receipt, error) {
    const message = String(error && error.message || error);
    if (reported.get(receipt) === message) return;
    reported.set(receipt, message);
    if (typeof KnowledgeBaseUtils !== "undefined") KnowledgeBaseUtils.addErrorLog(error, "merge-history.pin-reconciliation", {}, false);
    if (typeof MNUtil !== "undefined" && typeof MNUtil.showHUD === "function") MNUtil.showHUD("合并撤销后的 Pin 同步失败：" + message);
  }

  function reconcile() {
    if ((typeof MNUtil !== "undefined" && MNUtil._undoGroupingDepth > 0) || running || typeof KnowledgeBaseMergeTransaction === "undefined" ||
        typeof KnowledgeBaseMergeTransaction.getUndoReceipts !== "function") return;
    if (typeof MNUtil === "undefined" || typeof MNUtil.getNoteById !== "function") return;
    running = true;
    lastCheck = Date.now();
    try {
      const receipts = KnowledgeBaseMergeTransaction.getUndoReceipts().filter(receipt => receipt.pinMigration || receipt.onStateReconciled);
      const states = receipts.map(receipt => {
        try {
        // Read the database, not MNNote's cache: native undo can revive the old ID.
        const source = MNUtil.getNoteById(receipt.sourceNoteId, false);
        const target = MNUtil.getNoteById(receipt.targetNoteId, false);
        return { receipt, source: typeof receipt.isSourceActive === "function" ? (receipt.isSourceActive(source) ? source || true : null) : source, target, direction: directions.get(receipt) || "merged" };
        } catch (error) { report(receipt, error); return null; }
      }).filter(Boolean);
      // Reverse order handles a single native undo group containing A→B→C.
      states.slice().reverse().forEach(({ receipt, source, direction }) => {
        if (!source || direction === "restored") return;
        try {
          const result = receipt.pinMigration ? receipt.pinMigration.rollback() : { success: true };
          if (!result || result.success !== true) throw new Error("Pin 回退结果无法核验");
          if (typeof receipt.onStateReconciled === "function") receipt.onStateReconciled("restored");
          directions.set(receipt, "restored");
          reported.delete(receipt);
        } catch (error) { report(receipt, error); }
      });
      states.forEach(({ receipt, source, target }) => {
        if (source || directions.get(receipt) !== "restored") return;
        try {
          let destination = receipt.targetNoteId;
          const visited = new Set();
          while (!MNUtil.getNoteById(destination, false) && !visited.has(destination)) {
            visited.add(destination);
            const next = states.find(item => item.receipt.sourceNoteId === destination && !item.source);
            if (!next) break;
            destination = next.receipt.targetNoteId;
          }
          if (!target && !MNUtil.getNoteById(destination, false)) throw new Error("重做后的目标卡片不存在");
          const result = receipt.pinMigration ? receipt.pinMigration.apply() : { success: true };
          if (!result || result.success !== true) throw new Error("Pin 重做结果无法核验");
          if (receipt.pinMigration) { receipt.pinMigration.verify(); receipt.pinMigration.commit(); }
          if (typeof receipt.onStateReconciled === "function") receipt.onStateReconciled("merged");
          directions.set(receipt, "merged");
          reported.delete(receipt);
        } catch (error) { report(receipt, error); }
      });
    } finally { running = false; }
  }

  function schedule() {
    if ((typeof MNUtil !== "undefined" && MNUtil._undoGroupingDepth > 0) || pending || running || typeof MNUtil === "undefined" ||
        typeof MNUtil.delay !== "function" || typeof KnowledgeBaseMergeTransaction === "undefined" ||
        !KnowledgeBaseMergeTransaction.getUndoReceipts().length) return;
    pending = true;
    // Config persistence/rendering must run outside the native layout callback.
    const delay = Math.max(0.05, (150 - (Date.now() - lastCheck)) / 1000);
    MNUtil.delay(delay).then(() => { pending = false; reconcile(); }).catch(error => {
      pending = false;
      if (typeof KnowledgeBaseUtils !== "undefined") KnowledgeBaseUtils.addErrorLog(error, "merge-history.schedule", {}, false);
    });
  }
  return { reconcile, schedule };
})();
if (typeof module !== "undefined" && module.exports) module.exports = KnowledgeBaseMergeHistory;
