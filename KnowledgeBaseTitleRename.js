/* Scene-owned title editing. No dependency on OhMyMN or MNToolbar. */
var KnowledgeBaseTitleRename = (function () {
  'use strict'
  var ID = 'marginnote.extension.mnknowledgebase'
  var SELECT = 'mindmapViewOnMultipleSelection', CLOSE = 'mindmapViewBottomToolbarClosed'
  function app() { return Application.sharedInstance() }
  function value(object, key) {
    if (!object) return undefined
    try { var member = object[key]; if (member !== undefined) return typeof member === 'function' ? member.call(object) : member } catch (_) {}
    try { return object.objectForKey(key) } catch (_) {}
  }
  function bool(input) {
    if (input == null || input === false || input === 0 || input === 'false' || input === '0') return false
    var native = value(input, 'boolValue'); return native === undefined ? !!input : !!native
  }
  function permission(id) {
    var snapshot = typeof Application.immersiveTemplateForAddon === 'function' ? Application.immersiveTemplateForAddon(id) : app().immersiveTemplateForAddon(id)
    if (typeof snapshot === 'string') snapshot = JSON.parse(snapshot)
    var config = value(snapshot, 'config'); if (typeof config === 'string') config = JSON.parse(config)
    var name = String(value(config, 'scene') || '')
    return { allowed: bool(value(snapshot, 'allowed')), scene: name }
  }
  function mode() {
    var access = permission(ID)
    return access.allowed && ['broad', 'intensive', 'research', 'literature'].indexOf(access.scene) >= 0 ? access.scene : ''
  }
  function study(owner) { return app().studyController(owner.window) }
  function book(owner) { return String(value(value(study(owner), 'notebookController'), 'notebookId') || '') }
  function active(owner) { return !app().focusWindow || app().focusWindow === owner.window }
  function senderMatches(owner, sender) {
    return typeof app().checkNotifySenderInWindow === 'function' ? app().checkNotifySenderInWindow(sender, owner.window) : value(sender, 'object') === owner.window
  }
  function nativeNote(candidate) {
    for (var i = 0; candidate && i < 4; i++) {
      if (value(candidate, 'noteId')) return candidate
      candidate = value(candidate, 'note')
    }
    return null
  }
  function selected(owner) {
    var controller = value(study(owner), 'notebookController'), map = value(controller, 'mindmapView')
    if (typeof MNUtil !== 'undefined' && MNUtil.currentWindow === owner.window && MNUtil.mindmapView) map = MNUtil.mindmapView
    var list = value(map, 'selViewLst'), result = [], seen = {}
    if (!list || list.length < 2) return []
    for (var i = 0; i < list.length; i++) {
      var note = nativeNote(list[i]), id = String(value(note, 'noteId') || '')
      if (!id) return []
      if (!seen[id]) { seen[id] = true; result.push(id) }
    }
    return result.length > 1 ? result : []
  }
  function visible(owner, view) {
    var root = value(study(owner), 'view')
    for (var i = 0; view && i < 50; i++, view = value(view, 'superview')) {
      if (bool(value(view, 'hidden')) || Number(value(view, 'alpha')) === 0) return false
      if (view === root) return true
    }
    return false
  }
  function fail(owner, error) {
    try { app().showHUD(String(error && error.message || error), owner.window, 2) } catch (_) {}
  }
  function parse(input) {
    var raw = String(input), text = raw.trim(), regexp, replacement
    if (text.charAt(0) !== '(') { regexp = /^[\s\S]*$/; replacement = raw }
    else {
      var offset = 1
      while (/\s/.test(text.charAt(offset)) && offset < text.length) offset++
      if (text.charAt(offset++) !== '/') throw Error('请输入 (/正则/标志, "替换文字")')
      var start = offset, escaped = false, inClass = false, end = -1
      for (; offset < text.length; offset++) {
        var char = text.charAt(offset)
        if (escaped) { escaped = false; continue }
        if (char === '\\') { escaped = true; continue }
        if (char === '[') inClass = true
        if (char === ']') inClass = false
        if (char === '/' && !inClass) { end = offset; break }
      }
      if (end < 0) throw Error('正则表达式缺少结束分隔符')
      var tail = text.slice(end + 1).match(/^([gimsuy]*)\s*,\s*("(?:\\[\s\S]|[^"\\])*")\s*\)$/)
      if (!tail) throw Error('请输入 (/正则/标志, "替换文字")')
      try { regexp = new RegExp(text.slice(start, end), tail[1]); replacement = JSON.parse(tail[2]) }
      catch (_) { throw Error('正则表达式、标志或替换文字无效') }
    }
    if (/%\[|#\[|\{\{/.test(replacement)) throw Error('当前入口支持正则替换，尚未启用编号或模板变量')
    return { regexp: regexp, replacement: replacement }
  }
  function readTargets(owner, ids) {
    return ids.map(function (id) {
      var note = Database.sharedInstance().getNoteById(id)
      if (!note || String(value(note, 'notebookId') || '') !== book(owner)) throw Error('目标卡片已失效或不属于当前学习集')
      return { id: id, title: String(value(note, 'noteTitle') || '') }
    })
  }
  // Bounded, in-memory diagnostics contain layout/status only; no note IDs or content.
  function frame(view) {
    var rect = value(view, 'frame') || {}, result = {}
    ;['x', 'y', 'width', 'height'].forEach(function (key) {
      var number = Number(value(rect, key)); result[key] = isFinite(number) ? number : null
    })
    return result
  }
  function sample(owner) {
    var state = owner.kbTitleRename, root = value(study(owner), 'view'), views = value(root, 'subviews') || []
    var height = typeof MNUtil !== 'undefined' ? Number(MNUtil.studyHeight) : NaN
    var rows = [], total = views.length
    for (var i = 0; i < total && i < 80; i++) {
      var view = views[i], rect = frame(view), children = value(view, 'subviews') || []
      rows.push({ index: i, frame: rect, hidden: bool(value(view, 'hidden')), children: children.length,
        legacyBottom: isFinite(height) && rect.y !== null && rect.y > height - 200,
        legacyHeight: rect.height !== null && rect.height >= 58 })
    }
    var gesture = state && state.gesture, target = state && state.view, list = value(target, 'gestureRecognizers') || []
    var attached = false
    for (var j = 0; j < list.length; j++) if (list[j] === gesture) attached = true
    return { selectedCount: selected(owner).length, activeWindow: active(owner), osType: Number(value(app(), 'osType')),
      immersiveMode: value(study(owner), 'immersiveMode'), rootFrame: frame(root),
      studyHeightSource: 'MNUtil.studyHeight', studyHeight: isFinite(height) ? height : null,
      legacyMatchCount: rows.filter(function (row) { return row.legacyBottom && row.legacyHeight && row.children > 0 && !row.hidden }).length,
      rootSubviewCount: total, viewsTruncated: total > rows.length, views: rows,
      businessPermission: permission(ID), notificationPermission: permission('marginnote.extension.mnutils'),
      gestureCreated: !!gesture, gestureEnabled: gesture ? value(gesture, 'enabled') : null,
      gestureHasView: !!value(gesture, 'view'), attachmentFound: attached,
      targetVisible: !!target && visible(owner, target), targetFrame: target ? frame(target) : null }
  }
  function trace(owner, stage, reason) {
    var state = owner.kbTitleRename; if (!state) return
    try {
      if (stage === 'layout') {
        var now = Date.now(); if (state.lastLayoutAt && now - state.lastLayoutAt < 250) return
        state.lastLayoutAt = now
      }
      var data = sample(owner), signature = JSON.stringify(data)
      if (stage === 'layout' && state.lastLayout === signature) return
      if (stage === 'layout') state.lastLayout = signature
      state.history.push({ time: Date.now(), stage: stage, reason: reason || '', status: data })
      if (state.history.length > 60) state.history.shift()
    } catch (_) { state.diagnosticFailures++ }
  }
  function observe(owner, sender, stage) {
    try {
    if (stage === 'native.selection' && !senderMatches(owner, sender)) return
    if (stage === 'layout' && sender !== study(owner)) return
    if (stage === 'layout' && !selected(owner).length && !(owner.kbTitleRename && owner.kbTitleRename.gesture)) return
    trace(owner, stage)
    } catch (_) { if (owner.kbTitleRename) owner.kbTitleRename.diagnosticFailures++ }
  }
  function report(owner) {
    trace(owner, 'export')
    var state = owner.kbTitleRename
    return { schema: 1, revision: 'title-rename-diagnostic-20261026', appVersion: String(value(app(), 'appVersion') || ''),
      build: String(value(app(), 'build') || ''), diagnosticFailures: state ? state.diagnosticFailures : 0,
      events: state ? state.history.slice() : [],
      limits: 'Notification sender internals and native suppression ownership are not observable here. No note content or identifiers collected.' }
  }
  function showDiagnostic(owner) {
    var result = report(owner), last = result.events[result.events.length - 1], status = last && last.status
    var message = '诊断仅包含版本、布局、选区数量、许可和手势状态。\n' +
      '版本：' + result.appVersion + '（' + result.build + '）\n' +
      '记录：' + result.events.length + '；当前选区：' + (status ? status.selectedCount : '不可用') + '\n' +
      '业务插件许可：' + (status ? status.businessPermission.allowed : '不可用') + '\n' +
      '通知插件许可：' + (status ? status.notificationPermission.allowed : '不可用') + '\n' +
      '识别器已创建：' + !!(status && status.gestureCreated) + '\n' +
      '复制后可粘贴诊断结果。'
    UIAlertView.showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
      '左滑重命名诊断', message, 0, '关闭', ['复制诊断'], function (_, index) {
        if (Number(index) === 1) MNUtil.copy(JSON.stringify(result, null, 2))
      })
  }
  function connect(owner) {
    if (owner.kbTitleRename) return
    owner.kbTitleRename = { epoch: 0, pending: null, view: null, gesture: null, history: [], diagnosticFailures: 0 }
    var center = NSNotificationCenter.defaultCenter()
    center.addObserverSelectorName(owner, 'onKBTitleRenameSelection:', SELECT)
    center.addObserverSelectorName(owner, 'onKBTitleRenameClosed:', CLOSE)
    center.addObserverSelectorName(owner, 'onKBTitleRenameNativeSelection:', 'MNMapSelectionChanged')
    center.addObserverSelectorName(owner, 'onKBTitleRenameTemplateChanged:', 'MNImmersiveTemplateDidChange')
    trace(owner, 'connect')
  }
  function clear(owner) {
    var state = owner.kbTitleRename; if (!state) return
    trace(owner, 'clear')
    state.epoch++
    var view = state.view, gesture = state.gesture
    state.view = null; state.gesture = null
    var pending = state.pending; state.pending = null
    try { if (view && gesture) view.removeGestureRecognizer(gesture) } catch (error) { fail(owner, error) }
    try { if (pending && pending.alert) pending.alert.dismissWithClickedButtonIndexAnimated(-1, false) } catch (error) { fail(owner, error) }
  }
  function disconnect(owner) {
    clear(owner)
    var center = NSNotificationCenter.defaultCenter()
    center.removeObserverName(owner, SELECT); center.removeObserverName(owner, CLOSE)
    center.removeObserverName(owner, 'MNMapSelectionChanged'); center.removeObserverName(owner, 'MNImmersiveTemplateDidChange')
    owner.kbTitleRename = null
  }
  function bind(owner, sender) {
    if (!senderMatches(owner, sender)) return
    var state = owner.kbTitleRename; if (!state) return
    var view = value(value(sender, 'userInfo'), 'bottomToolbar')
    trace(owner, 'notification.received', view ? 'toolbar-provided' : 'toolbar-missing')
    var rejected = !mode() ? 'scene-or-permission' : !active(owner) ? 'inactive-window' : Number(app().osType) === 2 ? 'mac-touch-disabled' : !view ? 'toolbar-missing' : !visible(owner, view) ? 'toolbar-not-visible-or-foreign' : !selected(owner).length ? 'selection-unavailable' : ''
    if (rejected) { trace(owner, 'bind.rejected', rejected); clear(owner); return }
    if (state.view === view) return
    clear(owner)
    var gesture = new UISwipeGestureRecognizer(owner, 'onKBTitleRenameSwipe:')
    state.view = view; state.gesture = gesture
    trace(owner, 'gesture.created')
    gesture.direction = 2; gesture.numberOfTouchesRequired = 1; gesture.cancelsTouchesInView = false
    view.addGestureRecognizer(gesture)
    state.view = view; state.gesture = gesture
    trace(owner, 'gesture.attached')
  }
  function closed(owner, sender) { if (senderMatches(owner, sender)) clear(owner) }
  function apply(owner, pending, input) {
    var state = owner.kbTitleRename
    if (!state || state.epoch !== pending.epoch || pending.mode !== mode() || pending.book !== book(owner) || !active(owner)) throw Error('学习集、场景或窗口已切换，请重新操作')
    var rule = parse(input), before = readTargets(owner, pending.targets.map(function (row) { return row.id })), changes = []
    before.forEach(function (row, index) {
      if (row.title !== pending.targets[index].title) throw Error('目标标题已变化，请重新操作')
      rule.regexp.lastIndex = 0
      var title = row.title.replace(rule.regexp, rule.replacement)
      if (title !== row.title) changes.push({ note: Database.sharedInstance().getNoteById(row.id), before: row.title, after: title })
    })
    if (!changes.length) return
    // All parsing and stale checks finish before the native synchronous undo block.
    UndoManager.sharedInstance().undoGrouping('正则重命名标题', pending.book, function () {
      var attempted = []
      try {
        changes.forEach(function (row) { attempted.push(row); row.note.noteTitle = row.after })
      } catch (error) {
        var rollbackFailed = false
        attempted.reverse().forEach(function (row) { try { row.note.noteTitle = row.before } catch (_) { rollbackFailed = true } })
        throw Error(rollbackFailed ? '标题写入失败且未能完整恢复，请撤销本次操作' : '标题写入失败，原标题已恢复')
      }
    })
    app().refreshAfterDBChanged(pending.book)
  }
  function swipe(owner, gesture) {
    trace(owner, 'selector.received')
    var state = owner.kbTitleRename
    if (!state || state.pending || state.gesture !== gesture || !visible(owner, state.view) || !active(owner) || !mode()) return
    var ids = selected(owner); if (!ids.length) return
    var pending = { epoch: state.epoch, mode: mode(), book: book(owner), targets: readTargets(owner, ids) }
    state.pending = pending
    try {
      pending.alert = UIAlertView.showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
        '正则重命名标题', '只修改当前选中的卡片标题，可整批撤销。\n输入新标题，或 (/正则/g, "替换文字")；$& 保留匹配内容，$1 引用捕获组。', 2, '取消', ['重命名'],
        function (alert, index) {
          if (state.pending !== pending) return
          state.pending = null
          // Native UIAlertView counts its cancel button as index 0; the action is index 1.
          if (Number(index) !== 1) return
          try { apply(owner, pending, alert.textFieldAtIndex(0).text) } catch (error) { fail(owner, error) }
        }
      )
    } catch (error) { state.pending = null; throw error }
  }
  return { connect: connect, disconnect: disconnect, clear: clear, bind: bind, closed: closed, swipe: swipe, fail: fail, parse: parse, observe: observe, report: report, showDiagnostic: showDiagnostic }
})()
