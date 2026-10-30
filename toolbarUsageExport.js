// Native maintenance export for the Toolbar-owned local usage store.
var KBToolbarUsage = (() => {
  const pending = new Map();
  const validRequest = value => /^usage-[A-Za-z0-9-]{1,100}$/.test(String(value || ''));
  const rootPath = () => MNUtil.dbFolder + '/data/mntoolbar-usage';
  function windowToken(window) {
    if (!window) return '';
    const value = typeof window === 'string' ? window : (typeof window.hash === 'function' ? window.hash() : window.hash);
    return /^[A-Za-z0-9-]{1,80}$/.test(String(value ?? '')) ? 'w' + value : '';
  }
  function read(path) {
    const text = KnowledgeBaseUtils.readTextFile(path);
    if (!text) throw new Error('统计文件缺失或无法读取');
    return JSON.parse(text);
  }
  function list(path) {
    const fm = NSFileManager.defaultManager();
    return fm.fileExistsAtPath(path) ? Array.from(fm.contentsOfDirectoryAtPath(path) || []) : [];
  }
  function receive(params) {
    if (params.source !== 'mntoolbar' || !validRequest(params.requestId)) return false;
    const request = pending.get(params.requestId);
    if (!request || request.window !== MNUtil.currentWindow || request.windowToken !== params.windowToken) return false;
    pending.delete(params.requestId);
    clearTimeout(request.timer);
    request.resolve(params.ok === 1 || params.ok === '1', String(params.errorMessage || '').slice(0, 240));
    return true;
  }
  function request(action, enabled) {
    const token = windowToken(MNUtil.currentWindow);
    if (!token) return Promise.reject(new Error('无法确认统计请求所属窗口'));
    const requestId = 'usage-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ requestId, windowToken: token, ready: false, timedOut: true }); }, 2000);
      pending.set(requestId, { timer, window: MNUtil.currentWindow, windowToken: token, resolve: (ok, errorMessage) => resolve({ requestId, windowToken: token, ready: ok, timedOut: false, errorMessage }) });
      try {
        MNUtil.postNotification('AddonBroadcast', { message: 'mntoolbar?action=' + action + '&source=mnknowledgebase&requestId=' + requestId + '&windowToken=' + token + (enabled === undefined ? '' : '&enabled=' + !!enabled) });
      } catch (_) { clearTimeout(timer); pending.delete(requestId); resolve({ requestId, windowToken: token, ready: false, timedOut: true }); }
    });
  }
  function collectFiles(requestResult) {
    if (requestResult.ready) {
      const manifest = read(rootPath() + '/snapshots/' + requestResult.requestId + '.json');
      if (manifest.requestId !== requestResult.requestId || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('统计快照校验失败');
      const files = manifest.files.map(name => {
        if (!new RegExp('^' + requestResult.requestId + '-\\d{4}-\\d{2}-\\d{2}(?:-\\d{6})?\\.json$').test(name)) throw new Error('统计快照路径无效');
        return rootPath() + '/snapshots/' + name;
      });
      return { files, cutoff: manifest.cutoff, fresh: true, sourceId: manifest.sourceId, writeFailureObserved: manifest.writeFailureObserved === true };
    }
    if (!requestResult.timedOut) throw new Error('工具栏统计快照生成失败，未导出不完整数据' + (requestResult.errorMessage ? '：' + requestResult.errorMessage : ''));
    const files = list(rootPath()).filter(name => /^\d{4}-\d{2}-\d{2}(?:-\d{6})?\.json$/.test(name)).sort().map(name => rootPath() + '/' + name);
    return { files, cutoff: null, fresh: false };
  }
  function aggregate(events, summary, seen) {
    const accepted = [];
    const update = (map, key, event) => {
      const row = map[key] || (map[key] = { count: 0, daily: Object.create(null), firstUsedAt: event.timestamp, lastUsedAt: event.timestamp });
      row.count++;
      row.daily[event.localDate] = (row.daily[event.localDate] || 0) + 1;
      if (Date.parse(event.timestamp) < Date.parse(row.firstUsedAt)) row.firstUsedAt = event.timestamp;
      if (Date.parse(event.timestamp) > Date.parse(row.lastUsedAt)) row.lastUsedAt = event.timestamp;
    };
    for (const event of events) {
      if (!event || !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.eventId || '') ||
        !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.sourceId || '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(event.localDate || '') || !Number.isFinite(Date.parse(event.timestamp)) ||
        !['action', 'navigation'].includes(event.eventKind) || !['click', 'doubleClick', 'longPress', 'menuSelect', 'back'].includes(event.gesture)) {
        throw new Error('统计事件格式无效，未导出');
      }
      const key = event.sourceId + ':' + event.eventId;
      if (seen.has(key)) continue;
      seen.add(key);
      // Only the declared telemetry fields can reach the export.
      const clean = {};
      for (const field of ['eventId', 'sourceId', 'timestamp', 'localDate', 'offsetMinutes', 'actionId', 'variantId', 'buttonId', 'menuId', 'entryId', 'gesture', 'eventKind', 'toolbarVersion', 'layoutVersion', 'label']) clean[field] = event[field];
      accepted.push(clean);
      summary.totalEvents++;
      if (event.eventKind === 'action') {
        summary.totalActions++;
        summary.daily[event.localDate] = (summary.daily[event.localDate] || 0) + 1;
        update(summary.actions, event.actionId, event);
        update(summary.variants, event.actionId + ':' + event.variantId, event);
        update(summary.entries, event.buttonId + ':' + event.menuId + ':' + event.entryId + ':' + event.gesture, event);
      } else update(summary.navigation, event.menuId + ':' + event.entryId, event);
    }
    return accepted;
  }
  function exportFiles(snapshot, writer, readFile = read) {
    const summary = { totalEvents: 0, totalActions: 0, daily: Object.create(null), actions: Object.create(null), variants: Object.create(null), entries: Object.create(null), navigation: Object.create(null) };
    const seen = new Set();
    let writeFailureObserved = snapshot.writeFailureObserved === true;
    writer.append('{"events":[');
    let first = true;
    for (const path of snapshot.files) {
      const part = readFile(path);
      if (part.schemaVersion !== 1 || !Array.isArray(part.events)) throw new Error('统计明细格式无效');
      if (part.recoveredFromBackup || part.writeFailureObserved) writeFailureObserved = true;
      for (const event of aggregate(part.events, summary, seen)) {
        writer.append((first ? '' : ',') + JSON.stringify(event));
        first = false;
      }
    }
    for (const map of [summary.actions, summary.variants, summary.entries, summary.navigation]) {
      for (const row of Object.values(map)) row.activeDays = Object.keys(row.daily).length;
    }
    const metadata = { schemaVersion: 1, exportedAt: new Date().toISOString(), freshSnapshot: snapshot.fresh, writeFailureObserved, cutoff: snapshot.cutoff, countMeaning: 'user-triggered; not completion or success' };
    writer.append('],"metadata":' + JSON.stringify(metadata) + ',"summary":' + JSON.stringify(summary) + '}');
    return summary;
  }
  async function exportUsage() {
    const result = await request('usageSnapshot');
    try {
      if (result.windowToken !== windowToken(MNUtil.currentWindow)) throw new Error('窗口已切换，统计导出已取消');
      const snapshot = collectFiles(result);
      if (!snapshot.files.length) { MNUtil.showHUD('尚无工具栏使用统计'); return false; }
      const base = MNUtil.tempPath || MNUtil.tempFolder;
      if (!base) throw new Error('无法获取导出目录');
      const path = base + '/mntoolbar-usage-' + Date.now() + '.json';
      if (!KnowledgeBaseUtils.writeTextFile(path, '')) throw new Error('无法创建统计导出文件');
      let handle = null;
      if (typeof NSFileHandle !== 'undefined' && typeof NSFileHandle.fileHandleForWritingAtPath === 'function') {
        handle = NSFileHandle.fileHandleForWritingAtPath(path);
        if (!handle) throw new Error('无法打开统计导出文件');
      }
      // Older JSBridge hosts expose NSMutableData but do not export NSFileHandle.
      const buffer = handle ? null : NSMutableData.new();
      try {
        exportFiles(snapshot, { append(text) {
          const data = MNUtil.string2data(text);
          if (handle) handle.writeData(data);
          else buffer.appendData(data);
        } });
        if (handle) handle.synchronizeFile();
        else if (!buffer.writeToFileAtomically(path, true)) throw new Error('统计导出文件写入失败');
      } finally { if (handle) handle.closeFile(); }
      try { MNUtil.saveFile(path, 'public.json'); } catch (_) { MNUtil.saveFile(path, ['public.json']); }
      return true;
    } finally {
      if (result.ready) {
        try { MNUtil.postNotification('AddonBroadcast', { message: 'mntoolbar?action=releaseUsageSnapshot&source=mnknowledgebase&requestId=' + result.requestId + '&windowToken=' + result.windowToken }); } catch (_) {}
      }
    }
  }
  function isEnabled() {
    const path = rootPath() + '/settings.json';
    return NSFileManager.defaultManager().fileExistsAtPath(path) ? read(path).enabled === true : true;
  }
  function toggleTitle() {
    try { return isEnabled() ? '⏸ 统计已启用 · 点击暂停' : '▶️ 统计已暂停 · 点击启用'; }
    catch (_) { return '⚠️ 统计状态读取失败 · 点击重试'; }
  }
  async function toggle() {
    const enabled = isEnabled();
    const result = await request('setUsageEnabled', !enabled);
    if (!result.ready || result.windowToken !== windowToken(MNUtil.currentWindow)) throw new Error('未收到当前窗口确认，请检查统计开关状态' + (result.errorMessage ? '：' + result.errorMessage : ''));
    if (isEnabled() !== !enabled) throw new Error('统计开关状态未保存，请重试');
    return !enabled;
  }
  function logFailure(action, error) {
    const detail = { action, errorMessage: String(error && error.message || error), stack: String(error && error.stack || '') };
    try { KnowledgeBaseUtils.emitRuntimeLog('ERROR', detail.errorMessage, 'toolbarUsage.' + action, detail); } catch (_) {}
    try { KnowledgeBaseUtils.appendPersistentDiagnosticLog('mnknowledgebase.toolbarUsage', 'operation.failed', detail, 'ERROR'); } catch (_) {}
  }
  return { receive, request, collectFiles, aggregate, exportFiles, exportUsage, isEnabled, toggleTitle, toggle, windowToken, logFailure };
})();
if (typeof module !== 'undefined') module.exports = KBToolbarUsage;
