/* Shared research routing. The scene addon owns UI; MNKB remains the sole excerpt listener. */
var KnowledgeBaseResearchCore = (function () {
  'use strict'
  var ADDON_ID = 'marginnote.extension.mnresearchscene'
  var COMMAND = 'MNKBResearchCommand', RESULT = 'MNKBResearchResult'
  var STORE_KEY = 'MNKB_ResearchCore_v1'
  var REVISION = '1.87.8', DIAGNOSTICS_KEY = 'MNKB_ResearchDiagnostics_v1'
  var commands = ['ping', 'getState', 'registerProject', 'startProject', 'stopProject', 'setReceiver', 'stopReceiver', 'setInbox', 'makeCard', 'addTemplate', 'createRequiredKnowledge']
  function text(value) { return value == null ? '' : String(value).trim() }
  function value(object, key) {
    if (!object) return undefined
    try {
      var member = object[key], result = typeof member === 'function' ? member.call(object) : member
      if (result !== undefined && result !== null) return result
    } catch (_) {}
    try { if (typeof object.objectForKey === 'function') return object.objectForKey(key) } catch (_) {}
    return undefined
  }
  function token(input, fallback) {
    var result = text(input)
    return /^[A-Za-z0-9_.:-]{1,160}$/.test(result) ? result : (fallback || '')
  }
  function errorCode(error) {
    var code = text(value(error, 'code') || value(error, 'message'))
    return /^(?:invalid-(?:id|request|json|template-mode)|note-unavailable|different-notebook|receiver-must-be-classification|receiver-must-be-classification-or-proposition|receiver-type-missing|inbox-unavailable|research-scene-inactive|notebook-unavailable|project-unavailable|template-cancelled|context-changed|unknown-command|self-target|project-title-missing|classification-create-failed|KB_TEMPLATE_MISSING)$/.test(code) ? code : 'exception'
  }
  // A bounded metadata-only record also works before MNUtil and the window observers exist.
  function trace(stage, details) {
    try {
      details = details || {}
      var entry = { at: new Date().toISOString(), side: 'core', version: REVISION, build: REVISION, coreRevision: REVISION, stage: token(stage, 'trace.invalid-stage') }
      if (details.requestId !== undefined) entry.requestId = token(details.requestId, 'invalid')
      if (details.command !== undefined) entry.command = commands.indexOf(details.command) >= 0 ? details.command : 'unknown-command'
      for (var key of ['reason', 'errorCode', 'errorName', 'notification', 'inputType', 'userInfoType', 'clientVersion', 'initStage']) {
        if (details[key] !== undefined && text(details[key])) entry[key] = token(details[key], 'invalid')
      }
      for (var flag of ['hasInfo', 'hasJson', 'hasWindow', 'hasInstanceWindow', 'windowMatched', 'currentWindowMatched', 'sceneActive', 'ok', 'hasMNUtil', 'hasDefaults', 'observerRegistered']) {
        if (typeof details[flag] === 'boolean') entry[flag] = details[flag]
      }
      if (typeof details.durationMs === 'number' && Number.isFinite(details.durationMs)) entry.durationMs = Math.max(0, Math.round(details.durationMs))
      try {
        if (typeof NSUserDefaults !== 'undefined') {
          var defaults = NSUserDefaults.standardUserDefaults(), saved = defaults.objectForKey(DIAGNOSTICS_KEY), entries = []
          try { entries = Array.isArray(saved) ? saved : JSON.parse(String(saved || '[]')) } catch (_) {}
          if (!Array.isArray(entries)) entries = []
          defaults.setObjectForKey(JSON.stringify(entries.slice(-79).concat([entry])), DIAGNOSTICS_KEY)
        }
      } catch (_) {}
      var line = '[MNKB ResearchCore] ' + JSON.stringify(entry)
      try {
        if (typeof MNUtil !== 'undefined' && typeof MNUtil.log === 'function') { MNUtil.log({ source: 'MN KnowledgeBase:researchCore', level: /failed|error|rejected/.test(entry.stage) ? 'ERROR' : 'INFO', message: entry.stage, detail: entry }); return entry }
      } catch (_) {}
      try { if (typeof console !== 'undefined' && typeof console.log === 'function') console.log(line) } catch (_) {}
      return entry
    } catch (_) { return null }
  }
  // Pipeline timings go directly through MNUtils to MNLog, without synchronous diagnostic-file writes.
  function pipeline(stage, details) {
    try {
      var entry = { coreRevision: REVISION, stage: token(stage, 'trace.invalid-stage') }
      for (var key of ['traceId', 'route', 'phase', 'reason']) if (details && details[key] !== undefined) entry[key] = token(details[key], 'invalid')
      for (var key of ['durationMs', 'queueWaitMs']) if (details && Number.isFinite(details[key])) entry[key] = Math.max(0, Math.round(details[key]))
      for (var key of ['ok', 'pending', 'indexed', 'skipped', 'hasTitle']) if (details && typeof details[key] === 'boolean') entry[key] = details[key]
      if (typeof MNUtil !== 'undefined' && typeof MNUtil.log === 'function') MNUtil.log({ source: 'MN KnowledgeBase:researchPipeline', level: entry.ok === false ? 'ERROR' : 'INFO', message: entry.stage, detail: entry })
      return entry
    } catch (_) { return null }
  }
  function protocolVersion(input) {
    if (typeof input === 'number' || input == null) return input
    for (var key of ['integerValue', 'intValue', 'doubleValue']) {
      var nativeNumber = value(input, key)
      if (typeof nativeNumber === 'number') return nativeNumber
    }
    return input
  }
  function decodeRequest(raw) {
    var source = raw
    // NSString is not always exposed as a JavaScript string. A dictionary has explicit protocol fields.
    if (typeof source === 'string' || (source && value(source, 'version') === undefined)) {
      try { source = JSON.parse(String(source)) } catch (_) { throw new Error('invalid-json') }
    }
    if (!source || (typeof source !== 'object' && typeof source !== 'function')) throw new Error('invalid-request')
    var payload = value(source, 'payload'), normalizedPayload = {}
    for (var key of ['anchorNoteId', 'title', 'projectId', 'noteId', 'mode', 'titleInput']) {
      var item = value(payload, key)
      if (item !== undefined && item !== null) normalizedPayload[key] = typeof item === 'string' ? item : String(item)
    }
    var receive = value(payload, 'receive')
    if (receive !== undefined && receive !== null) normalizedPayload.receive = typeof receive === 'object' && value(receive, 'boolValue') !== undefined ? bool(receive) : receive
    return { version: protocolVersion(value(source, 'version')), requestId: text(value(source, 'requestId')), command: text(value(source, 'command')), notebookId: text(value(source, 'notebookId')), clientVersion: text(value(source, 'clientVersion')), payload: normalizedPayload }
  }
  function bool(input) {
    if (input == null || input === false || input === 0 || input === 'false' || input === '0') return false
    try { if (typeof input.boolValue === 'function') return !!input.boolValue() } catch (_) {}
    try { if (input.boolValue !== undefined) return !!input.boolValue } catch (_) {}
    return !!input
  }
  function identifier(input) {
    var result = text(input)
    if (!result || result.length > 250 || /[\u0000-\u001f]/.test(result) || ['__proto__', 'constructor', 'prototype'].indexOf(result) >= 0) throw new Error('invalid-id')
    return result
  }
  function clone(input) { return JSON.parse(JSON.stringify(input)) }
  function sceneSnapshot(input) {
    if (typeof input === 'string') { try { input = JSON.parse(input) } catch (_) { return false } }
    var config = value(input, 'config')
    if (typeof config === 'string') { try { config = JSON.parse(config) } catch (_) { return false } }
    return bool(value(input, 'allowed')) && text(value(config, 'scene')) === 'research'
  }
  function create(deps) {
    var stored = { version: 1, notebooks: {}, receiver: null }
    try {
      var saved = deps.load()
      if (typeof saved === 'string') saved = JSON.parse(saved)
      if (saved && saved.version === 1 && saved.notebooks && typeof saved.notebooks === 'object' && !Array.isArray(saved.notebooks)) stored = saved
    } catch (_) {}
    var sessions = [], receiverActive = false, receiverMode = '', receiverRevision = 0, excerptSequence = 0
    function persist() { deps.save(clone(stored)) }
    function session(instance) {
      var found = sessions.find(function (item) { return item.window === instance.window })
      if (!found) { found = { window: instance.window, notebookId: '', activeId: '', lifecycle: 0, projectRevision: 0, queue: Promise.resolve(), seen: new Set(), closed: false }; sessions.push(found) }
      return found
    }
    function context(instance) {
      var s = session(instance), notebookId = text(deps.notebookId(instance)), mode = collectionMode(instance)
      if (s.mode !== mode) {
        if (s.mode !== undefined) { receiverActive = false; receiverRevision += 1; s.lifecycle += 1; s.projectRevision += 1; s.seen.clear() }
        s.mode = mode
      }
      if (s.notebookId !== notebookId) {
        if (s.notebookId && stored.receiver && stored.receiver.notebookId === s.notebookId) { receiverActive = false; receiverRevision += 1 }
        s.notebookId = notebookId; s.activeId = ''; s.lifecycle += 1; s.projectRevision += 1; s.seen.clear()
      }
      return s
    }
    function notebook(id) {
      if (!Object.prototype.hasOwnProperty.call(stored.notebooks, id)) stored.notebooks[id] = { projects: [] }
      var item = stored.notebooks[id]
      if (!item || !Array.isArray(item.projects)) { item = { projects: [] }; stored.notebooks[id] = item }
      return item
    }
    function collectionMode(instance) {
      try { return deps.collectionMode ? text(deps.collectionMode(instance)) : deps.sceneActive(instance) ? 'research' : '' } catch (_) { return '' }
    }
    function isSceneActive(instance) {
      var s = context(instance)
      return !!deps.isCurrentWindow(instance) && !s.closed && (s.mode === 'research' || s.mode === 'broad' || s.mode === 'intensive')
    }
    function note(id, notebookId) {
      var result = deps.getNote(identifier(id))
      if (!result || !text(result.noteId)) throw new Error('note-unavailable')
      if (text(deps.noteNotebookId(result)) !== notebookId) throw new Error('different-notebook')
      return result
    }
    function activeProject(s) {
      return notebook(s.notebookId).projects.find(function (project) { return project.id === s.activeId }) || null
    }
    function receiverPolicy(target) {
      if (deps.isClassification(target)) {
        var type = text(deps.classificationType(target))
        return type && type !== '归类' ? { kind: 'classification', type: type } : null
      }
      return deps.cardType(target) === '命题' ? { kind: 'proposition', type: '命题' } : null
    }
    function receiverInfo(s) {
      var saved = stored.receiver
      if (!saved || saved.notebookId !== s.notebookId) return null
      var current, policy
      try { current = note(saved.noteId, s.notebookId); policy = receiverPolicy(current) } catch (_) {}
      if (s.mode === 'intensive' && policy && policy.kind !== 'classification') policy = null
      return { noteId: saved.noteId, notebookId: saved.notebookId, title: current ? deps.title(current) : saved.title, type: policy ? policy.type : saved.type, kind: policy ? policy.kind : saved.kind, active: receiverActive && receiverMode === s.mode && !!policy, available: !!policy }
    }
    function state(instance) {
      var s = context(instance)
      return { projects: s.notebookId ? clone(notebook(s.notebookId).projects) : [], activeProject: s.notebookId ? clone(activeProject(s)) : null, receiver: receiverInfo(s), sceneActive: isSceneActive(instance), collectionMode: s.mode, notebookId: s.notebookId }
    }
    function guard(instance, notebookId, lifecycle, explicitCardAction) {
      var s = context(instance)
      return (isSceneActive(instance) || (explicitCardAction && s.mode === 'intensive' && deps.isCurrentWindow(instance) && !s.closed)) && s.notebookId === notebookId && s.lifecycle === lifecycle
    }
    function retarget(oldNote, newNote) {
      if (stored.receiver && oldNote && newNote && stored.receiver.noteId === text(oldNote.noteId) && text(newNote.noteId) !== text(oldNote.noteId)) {
        stored.receiver.noteId = text(newNote.noteId); stored.receiver.title = deps.title(newNote); persist()
      }
    }
    function setReceiver(s, target) {
      if (s.mode === 'intensive' && !deps.isClassification(target)) throw new Error('receiver-must-be-classification')
      var policy = receiverPolicy(target)
      if (!policy) throw new Error(deps.isClassification(target) ? 'receiver-type-missing' : 'receiver-must-be-classification-or-proposition')
      stored.receiver = { noteId: text(target.noteId), notebookId: s.notebookId, title: deps.title(target), type: policy.type, kind: policy.kind }
      receiverActive = true; receiverMode = s.mode; receiverRevision += 1; persist()
      return target
    }
    async function dispatch(instance, request) {
      if (!request || request.version !== 1 || !text(request.requestId)) throw new Error('invalid-request')
      var s = context(instance), requestedNotebook = text(request.notebookId), command = text(request.command), payload = request.payload || {}
      if (requestedNotebook && requestedNotebook !== s.notebookId) throw new Error('different-notebook')
      if (command === 'ping' || command === 'getState') return state(instance)
      if (s.mode === 'intensive' && ['setReceiver', 'stopReceiver', 'makeCard', 'addTemplate', 'createRequiredKnowledge'].indexOf(command) < 0) throw new Error('research-scene-inactive')
      var explicitCardAction = s.mode === 'intensive' && (command === 'makeCard' || command === 'addTemplate' || command === 'createRequiredKnowledge')
      if (!isSceneActive(instance) && !guard(instance, s.notebookId, s.lifecycle, explicitCardAction)) throw new Error('research-scene-inactive')
      if (!s.notebookId) throw new Error('notebook-unavailable')
      var original, processed, result, type, lifecycle = s.lifecycle
      if (command === 'registerProject') {
        original = note(payload.anchorNoteId, s.notebookId)
        var project = { id: text(original.noteId), projectId: text(original.noteId), anchorNoteId: text(original.noteId), title: text(payload.title || deps.title(original)).slice(0, 500) || '科研课题' }
        var items = notebook(s.notebookId).projects, index = items.findIndex(function (item) { return item.id === project.id })
        if (index >= 0) items[index] = project; else items.push(project)
        persist(); result = { noteId: project.anchorNoteId, project: clone(project) }
      } else if (command === 'startProject') {
        var id = identifier(payload.projectId), selected = notebook(s.notebookId).projects.find(function (item) { return item.id === id })
        if (!selected) throw new Error('project-unavailable')
        original = note(selected.anchorNoteId, s.notebookId)
        s.activeId = selected.id; s.projectRevision += 1; result = { noteId: text(original.noteId) }
      } else if (command === 'stopProject') {
        s.activeId = ''; s.projectRevision += 1; result = { noteId: '' }
      } else if (command === 'setReceiver') {
        original = setReceiver(s, note(payload.noteId, s.notebookId)); result = { noteId: text(original.noteId) }
      } else if (command === 'stopReceiver') {
        receiverActive = false; receiverRevision += 1; result = { noteId: stored.receiver ? stored.receiver.noteId : '' }
      } else if (command === 'setInbox') {
        if (s.mode !== 'broad' || !deps.setInbox) throw new Error('research-scene-inactive')
        original = note(payload.noteId, s.notebookId)
        deps.setInbox(instance, original); result = { noteId: text(original.noteId) }
      } else if (command === 'makeCard') {
        original = note(payload.noteId, s.notebookId)
        type = deps.cardType(original)
        if (deps.assertCard) deps.assertCard(original, type)
        processed = deps.convert(original) || original
        deps.syncIndex(original, processed); retarget(original, processed)
        result = deps.makeCard(processed, type, function () { return guard(instance, s.notebookId, lifecycle, explicitCardAction) }, { present: true, addToReview: s.mode === 'intensive' }) || { note: processed }
        processed = result.note || processed
        retarget(original, processed)
        result = { noteId: text(processed.noteId), cardPending: !!result.pending, addedToReview: result.addedToReview === true, reviewAllowed: s.mode === 'intensive' }
      } else if (command === 'createRequiredKnowledge') {
        original = note(payload.noteId, s.notebookId)
        if (!guard(instance, s.notebookId, lifecycle, explicitCardAction)) throw new Error('context-changed')
        processed = deps.createRequiredKnowledge(original)
        if (!processed) throw new Error('classification-create-failed')
        processed = note(processed.noteId, s.notebookId)
        result = { noteId: text(processed.noteId) }
      } else if (command === 'addTemplate') {
        original = note(payload.noteId, s.notebookId)
        processed = await deps.addTemplate(original, payload)
        if (!processed) return Object.assign({ cancelled: true }, state(instance))
        if (!guard(instance, s.notebookId, lifecycle, explicitCardAction)) throw new Error('context-changed')
        processed = note(processed.noteId, s.notebookId)
        result = { noteId: text(processed.noteId) }
      } else { throw new Error('unknown-command') }
      return Object.assign(result, state(instance))
    }
    function remember(s, id) {
      if (id) s.seen.add(id)
      if (s.seen.size > 500) s.seen.delete(s.seen.values().next().value)
    }
    function processExcerpt(instance, inputNote) {
      if (!isSceneActive(instance)) return Promise.resolve({ handled: false })
      var s = context(instance), sourceId = text(inputNote && inputNote.noteId)
      if (!s.notebookId || !sourceId) return Promise.resolve({ handled: true, skipped: 'missing-context' })
      try { note(sourceId, s.notebookId) } catch (error) { return Promise.resolve({ handled: true, skipped: error.message }) }
      if (s.seen.has(sourceId)) return Promise.resolve({ handled: true, noteId: sourceId, duplicate: true })
      remember(s, sourceId)
      var receiver = receiverInfo(s)
      if (s.mode === 'intensive' && !(receiver && receiver.active && receiver.kind === 'classification')) return Promise.resolve({ handled: true, noteId: sourceId, skipped: 'no-active-receiver' })
      // Type resolution consumes recognized tag comments. Read exactly once at event time.
      var type = deps.excerptType(instance, inputNote), project = s.mode === 'research' ? activeProject(s) : null
      var manual = !!(receiver && receiver.active && (receiver.kind === 'proposition' || (type && receiver.type === type)))
      if (s.mode === 'intensive' && !manual) return Promise.resolve({ handled: true, noteId: sourceId, skipped: 'receiver-type-mismatch' })
      var fullCard = manual && receiver.kind === 'classification'
      var inbox = !manual && s.mode === 'broad' && deps.defaultAnchor ? deps.defaultAnchor(instance) : null
      if (inbox) inbox = note(inbox.noteId, s.notebookId)
      var job = { sourceId: sourceId, type: type, notebookId: s.notebookId, lifecycle: s.lifecycle, receiverRevision: receiverRevision, projectRevision: s.projectRevision, targetId: manual ? receiver.noteId : '', anchorId: project ? project.anchorNoteId : inbox ? text(inbox.noteId) : '', mode: s.mode, manual: manual, fullCard: fullCard, receiverKind: manual ? receiver.kind : '' }
      var queuedAt = Date.now(), traceId = 'excerpt-' + (++excerptSequence), route = manual ? 'receiver' : job.anchorId ? (job.mode === 'broad' ? 'inbox' : 'project') : 'in-place'
      function log(stage, details) { return pipeline(stage, Object.assign({ traceId: traceId, route: route }, details || {})) }
      log('excerpt.queued')
      function valid() {
        if (!guard(instance, job.notebookId, job.lifecycle)) return false
        if (!job.manual) return s.projectRevision === job.projectRevision
        var currentReceiver = receiverInfo(s)
        return receiverRevision === job.receiverRevision && !!(currentReceiver && currentReceiver.active && currentReceiver.noteId === job.targetId && currentReceiver.kind === job.receiverKind && (!job.fullCard || currentReceiver.type === job.type))
      }
      var task = s.queue.then(async function () {
        var startedAt = Date.now(), phase = 'route', phaseStartedAt = startedAt, completed = false
        log('excerpt.started', { queueWaitMs: startedAt - queuedAt })
        if (!valid()) { log('excerpt.finished', { skipped: true, reason: 'context-changed', durationMs: Date.now() - startedAt }); return { handled: true, noteId: sourceId, skipped: 'context-changed' } }
        var original = note(sourceId, job.notebookId), processed = original, target = null, definitionJob = null, made = null
        var groupId = text(deps.groupId ? deps.groupId(original) : '')
        if (groupId && groupId !== sourceId) { log('excerpt.finished', { skipped: true, reason: 'merged-source', durationMs: Date.now() - startedAt }); return { handled: true, noteId: groupId, skipped: 'merged-source' } }
        try {
          // All destinations are explicit IDs. Ordinary selection never changes the receiver.
          if (job.manual) target = note(job.targetId, job.notebookId)
          else if (job.anchorId) {
            var anchor = note(job.anchorId, job.notebookId)
            target = job.type ? deps.classification(anchor, job.type) : anchor
          }
          if (job.fullCard && deps.assertCard) deps.assertCard(original, job.type)
          if (target) {
            if (text(target.noteId) === sourceId) throw new Error('self-target')
            deps.move(original, target)
          }
          log('route.finished', { durationMs: Date.now() - phaseStartedAt })
          phase = 'ocr'; phaseStartedAt = Date.now()
          if (!(job.manual && !job.fullCard) && job.type === '定义' && deps.beginDefinition) definitionJob = deps.beginDefinition(original, { researchScene: job.mode === 'research', valid: valid })
          if (!definitionJob) { log('ocr.started'); var ocrResult = await deps.ocr(instance, original, { researchScene: job.mode === 'research', valid: valid }); log('ocr.finished', { ok: !!ocrResult, hasTitle: !!text(deps.title(original)), durationMs: Date.now() - phaseStartedAt }) }
          else log('definition.accepted', { pending: true, durationMs: Date.now() - phaseStartedAt })
          if (!valid()) { log('excerpt.finished', { skipped: true, reason: 'context-changed', durationMs: Date.now() - startedAt }); completed = true; return { handled: true, noteId: text(original.noteId), skipped: 'context-changed' } }
          // No anchor is a supported state: OCR/conversion keeps the original parent.
          phase = 'convert'; phaseStartedAt = Date.now()
          processed = deps.convert(original) || original
          log('convert.finished', { durationMs: Date.now() - phaseStartedAt })
          phase = 'index'; phaseStartedAt = Date.now()
          var indexed = deps.syncIndex(original, processed)
          log('index.finished', { indexed: !!(indexed && indexed.success && !indexed.skipped), skipped: !!(indexed && indexed.skipped), ok: !!(indexed && (indexed.skipped || indexed.success)), durationMs: Date.now() - phaseStartedAt })
          remember(s, text(processed.noteId))
          phase = 'make-card'; phaseStartedAt = Date.now()
          if (job.fullCard) made = deps.makeCard(processed, job.type, valid) || { note: processed }
          if (job.fullCard) log('make-card.finished', { pending: !!(made && made.pending), durationMs: Date.now() - phaseStartedAt })
          if (made && made.note) processed = made.note
          remember(s, text(processed.noteId))
          phase = 'refresh'; phaseStartedAt = Date.now()
          var presented = await deps.refresh(processed, { focus: !definitionJob, notebookId: job.notebookId, window: instance.window, valid: valid })
          log('refresh.finished', { ok: presented !== false, durationMs: Date.now() - phaseStartedAt })
          log('excerpt.finished', { ok: true, pending: !!definitionJob || !!(made && made.pending), durationMs: Date.now() - startedAt }); completed = true
          return { handled: true, noteId: text(processed.noteId), noteType: job.type, route: route, targetNoteId: target ? text(target.noteId) : '', madeCard: !!made && !made.pending, cardPending: !!(made && made.pending), addedToReview: false }
        } catch (error) {
          log('excerpt.failed', { ok: false, phase: phase, reason: errorCode(error), durationMs: Date.now() - phaseStartedAt })
          throw error
        } finally {
          if (!completed) log('excerpt.finished', { ok: false, phase: phase, durationMs: Date.now() - startedAt })
          if (definitionJob) deps.finishDefinition(definitionJob)
        }
      })
      // A failed OCR/template must not poison the next excerpt's queue.
      s.queue = task.catch(function (error) { deps.log(error, 'research.processExcerpt') })
      return task
    }
    function close(instance, notebookId) {
      var s = session(instance), closedNotebook = text(notebookId || s.notebookId)
      if (stored.receiver && stored.receiver.notebookId === closedNotebook) { receiverActive = false; receiverRevision += 1 }
      s.activeId = ''; s.lifecycle += 1; s.projectRevision += 1; s.seen.clear(); s.closed = true
    }
    function disconnect(instance) { close(instance); session(instance).closed = true }
    return { dispatch: dispatch, state: state, processExcerpt: processExcerpt, isSceneActive: isSceneActive, close: close, disconnect: disconnect, connect: function (instance) { session(instance).closed = false } }
  }
  var runtime
  function getRuntime() {
    if (runtime) return runtime
    function template() { return KnowledgeBaseTemplate }
    function getNotebookId(instance) {
      try {
        var controller = Application.sharedInstance().studyController(instance.window).notebookController
        var id = text(value(controller, 'notebookId'))
        if (id) return id
      } catch (_) { return instance.window === MNUtil.currentWindow ? text(MNUtil.currentNotebookId) : '' }
      return instance.window === MNUtil.currentWindow ? text(MNUtil.currentNotebookId) : ''
    }
    function cardFacade(note, type) {
      // Keep saved legacy reading flags intact. The per-call facade only selects full card processing.
      var maker = Object.create(template())
      maker.getQuickReadingMakeCardPolicy = function () { return { mode: 'normal', noteType: type || null, colorIndex: note.colorIndex } }
      return maker
    }
    function makeSceneCard(note, type, valid, options) {
      var maker = cardFacade(note, type)
      // A scene command owns an explicit card; native selection commands can be disabled or target another card.
      maker.addToReview = function (current, reviewEverytime) {
        if (['定义', '命题', '例子', '反例', '思想方法', '问题', '思路'].indexOf(type || maker.getNoteType(current, true)) < 0) return
        if (valid && !valid()) throw new Error('context-changed')
        var controller = Application.sharedInstance().studyController(MNUtil.currentWindow)
        var nativeNote = Database.sharedInstance().getNoteById(current.noteId)
        if (!controller || !nativeNote) throw new Error('note-unavailable')
        if (!reviewEverytime && controller.isNoteInReview(current.noteId)) return
        NSNotificationCenter.defaultCenter().postNotificationNameObjectUserInfo('AddToReview', controller, { note: nativeNote })
      }
      var make = function (current) {
        if (valid && !valid()) throw new Error('context-changed')
        return maker.makeCard(current, !!(options && options.addToReview), true, { noteType: type || null, silent: true, throwOnFailure: true }) || current
      }
      // DefinitionConcept already presents deferred cards after its outer undo group.
      if (typeof KnowledgeBaseDefinitionConcept !== 'undefined' && KnowledgeBaseDefinitionConcept.getRuntime().deferMakeCard(note, make)) return { note: note, pending: true }
      if (!options || !options.present) return { note: make(note), pending: false }
      // Port Toolbar makeNote's final DB refresh, result/parent refresh and focus; keep the shared card maker.
      var processed
      maker.runUndoGroupingWithoutGlobalDBRefresh(function () { processed = make(note) }, { feature: 'mnknowledgebase.research.makeCard', finalRefreshAfterDBChanged: true })
      if (!valid || valid()) {
        maker.refreshNoteLocally(processed, true)
        var parent
        try { parent = processed.parentNote } catch (_) {}
        if (parent && text(parent.noteId) !== text(processed.noteId)) maker.refreshNoteLocally(parent, false)
        processed.focusInMindMap(0.3)
      }
      var addedToReview = false
      try { addedToReview = !!(options && options.addToReview && MNUtil.isNoteInReview(processed.noteId)) } catch (_) {}
      return { note: processed, pending: false, addedToReview: addedToReview }
    }

    runtime = create({
      load: function () { return NSUserDefaults.standardUserDefaults().objectForKey(STORE_KEY) },
      save: function (data) { NSUserDefaults.standardUserDefaults().setObjectForKey(JSON.stringify(data), STORE_KEY) },
      notebookId: getNotebookId,
      isCurrentWindow: function (instance) { return instance.window === MNUtil.currentWindow },
      collectionMode: function (instance) {
        var scene = typeof KnowledgeBaseTemplate !== 'undefined' && typeof template().getReadingScene === 'function' ? template().getReadingScene() : ''
        if (scene) return scene
        var app = Application.sharedInstance(), snapshot
        if (typeof Application.immersiveTemplateForAddon === 'function') snapshot = Application.immersiveTemplateForAddon(ADDON_ID)
        else if (app && typeof app.immersiveTemplateForAddon === 'function') snapshot = app.immersiveTemplateForAddon(ADDON_ID)
        if (sceneSnapshot(snapshot)) return 'research'
        return typeof KnowledgeBaseConfig !== 'undefined' && KnowledgeBaseConfig.config.readingFollowMode && !instance.readingCollectionStopped ? 'broad' : ''
      },
      defaultAnchor: function (instance) {
        if (!instance.ensureInboxAutoMoveTargets()) throw new Error('inbox-unavailable')
        return instance.classInputRootNote
      },
      getNote: function (id) { var n = MNNote.new(id); return n && n.note ? n : null },
      noteNotebookId: function (n) { return n.notebookId },
      title: function (n) { return text(n && (n.noteTitle || n.title)) },
      groupId: function (n) { return n.groupNoteId },
      isClassification: function (n) { return template().isClassificationNote(n) },
      classificationType: function (n) { return (template().parseNoteTitle(n) || {}).type || '' },
      cardType: function (n) { return template().getNoteType(n, true) },
      excerptType: function (instance, n) { return instance.getReadingAutoTypeFromNote(n) },
      classification: function (anchor, type) {
        var target = (anchor.childNotes || []).find(function (n) { return template().isClassificationNote(n) && (template().parseNoteTitle(n) || {}).type === type })
        if (target) return target
        var parsed = template().parseNoteTitle(anchor) || {}
        var title = text(parsed.content || anchor.noteTitle || anchor.title)
        if (!title) throw new Error('project-title-missing')
        template().runUndoGroupingWithoutGlobalDBRefresh(function () { target = template().createClassificationNoteAsChildNote(anchor, title, type, true, false) }, { feature: 'mnknowledgebase.research.createClassification' })
        if (!target) throw new Error('classification-create-failed')
        if (typeof KnowledgeBaseIndexer !== 'undefined') KnowledgeBaseIndexer.addToIncrementalIndex(target)
        template().refreshNoteLocally(target, false, { stage: 'research.classification' })
        return target
      },
      move: function (n, parent) {
        if (n.parentNote && text(n.parentNote.noteId) === text(parent.noteId)) return
        template().runUndoGroupingWithoutGlobalDBRefresh(function () { parent.addChild(n) }, { feature: 'mnknowledgebase.research.route' })
      },
      ocr: function (instance, n, options) {
        var settings = Object.assign({ ignoreDefinitionSkip: true, skipIndex: true, deferPresentation: true }, options)
        return Number(KnowledgeBaseConfig.config.excerptOCRMode) === 2
          ? instance.applyOCRToTitleWithMode(n, 2, settings)
          : instance.applyQuickReadingOCRToTitle(n, settings)
      },
      convert: function (n) {
        var processed = n
        template().runUndoGroupingWithoutGlobalDBRefresh(function () { processed = template().toNoExcerptVersion(n, undefined, { allowTextExcerpt: true, allowTopLevel: true, createChildUndoGrouping: false }) || n }, { feature: 'mnknowledgebase.research.convert' })
        return processed
      },
      syncIndex: function (original, processed) {
        if (typeof KnowledgeBaseDefinitionConcept !== 'undefined') KnowledgeBaseDefinitionConcept.getRuntime().retarget(original, processed)
        var stale = text(original.noteId) !== text(processed.noteId) ? [text(original.noteId)] : []
        if (typeof IntermediateKnowledgeIndexer !== 'undefined') return IntermediateKnowledgeIndexer.upsertIncrementalIndexEntry(processed, { staleIds: stale, showErrorHUD: false, buildOptions: { skipRenewLinks: true } })
      },
      refresh: function (n, options) { return template().presentOCRResult(n, Object.assign({ stage: 'research.excerpt' }, options)) },
      beginDefinition: function (n, options) { return typeof KnowledgeBaseDefinitionConcept !== 'undefined' ? KnowledgeBaseDefinitionConcept.getRuntime().begin(n, false, options) : null },
      finishDefinition: function (job) { KnowledgeBaseDefinitionConcept.getRuntime().finish(job) },
      setInbox: function (instance, n) {
        var references = clone(KnowledgeBaseConfig.config.referenceNoteIds || {})
        references.roots = Object.assign({}, references.roots || {}, { classInput: n.noteURL || ('marginnote4app://note/' + n.noteId) })
        KnowledgeBaseConfig.config.referenceNoteIds = references
        KnowledgeBaseConfig.save()
        instance.classInputRootNote = n
      },
      makeCard: makeSceneCard,
      assertCard: function (n, type) { cardFacade(n, type).assertMakeCardTemplateAvailable(n, { noteType: type || null, directMakeCard: true }) },
      createRequiredKnowledge: function (n) { return template().createRequiredKnowledgeClassification(n) },
      addTemplate: async function (n, payload) {
        // OCR-only cards have colors/types but no makeCard title prefix yet.
        // Adapt only this invocation; retain every parsed title field and any explicit type.
        var base = template(), creator = Object.create(base)
        creator.parseNoteTitle = function (note) {
          var parsed = base.parseNoteTitle.apply(base, arguments) || {}
          if (text(parsed.type)) return parsed
          var fallback = base.getNoteType(note, true) || base.getNoteTypeByColor(note && note.colorIndex)
          return fallback ? Object.assign({}, parsed, { type: fallback }) : parsed
        }
        if (payload.titleInput != null) {
          var allowedModes = ['sibling', 'down-sequential', 'down-reverse', 'up'], mode = payload.mode || 'sibling'
          if (allowedModes.indexOf(mode) < 0) throw new Error('invalid-template-mode')
          return creator.createTemplateChain(n, { mode: mode, titleInput: String(payload.titleInput), focusLastNote: true }).lastNote
        }
        return creator.addTemplate(n, true)
      },
      log: function (error, source) { KnowledgeBaseUtils.addErrorLog(error, source) },
    })
    trace('runtime.ready')
    return runtime
  }
  async function handleNotification(instance, sender) {
    var startedAt = Date.now(), info = value(sender, 'userInfo'), envelopeWindow = value(info, 'window')
    var request, response, decodeError, raw = value(info, 'json')
    try { request = decodeRequest(raw) } catch (error) { decodeError = error }
    var meta = { requestId: request && request.requestId, command: request && request.command, clientVersion: request && request.clientVersion, hasInfo: !!info, hasJson: raw !== undefined && raw !== null, hasWindow: !!envelopeWindow, hasInstanceWindow: !!(instance && instance.window), windowMatched: !!(instance && envelopeWindow && envelopeWindow === instance.window), userInfoType: typeof info, inputType: typeof raw }
    trace('command.received', meta)
    // Match the actual window carried by the scene addon. Never use the first global KB instance.
    if (!instance || !instance.window || !envelopeWindow || envelopeWindow !== instance.window) {
      trace('command.rejected', Object.assign({}, meta, { reason: !instance || !instance.window ? 'instance-window-missing' : !envelopeWindow ? 'envelope-window-missing' : 'window-mismatch' }))
      return
    }
    try {
      if (decodeError) throw decodeError
      trace('dispatch.started', meta)
      response = { version: 1, build: REVISION, coreRevision: REVISION, requestId: text(request && request.requestId), ok: true, result: await getRuntime().dispatch(instance, request) }
      trace('dispatch.succeeded', Object.assign({}, meta, { durationMs: Date.now() - startedAt }))
    } catch (error) {
      trace(decodeError ? 'command.rejected' : 'dispatch.failed', Object.assign({}, meta, { reason: decodeError ? 'request-decode-failed' : 'dispatch-error', errorCode: errorCode(error), errorName: text(error && error.name), durationMs: Date.now() - startedAt }))
      response = { version: 1, build: REVISION, coreRevision: REVISION, requestId: text(request && request.requestId), ok: false, error: { code: text(error && (error.code || error.message)) || 'exception', message: text(error && error.message) || '科研操作失败' } }
    }
    try {
      MNUtil.postNotification(RESULT, { window: instance.window, json: JSON.stringify(response) })
      trace('result.sent', Object.assign({}, meta, { ok: response.ok, notification: RESULT, durationMs: Date.now() - startedAt }))
    } catch (error) {
      trace('result.send-failed', Object.assign({}, meta, { errorCode: 'result-send-failed', errorName: text(error && error.name), durationMs: Date.now() - startedAt }))
    }
  }
  trace('module.loaded', { hasMNUtil: typeof MNUtil !== 'undefined', hasDefaults: typeof NSUserDefaults !== 'undefined' })
  return { create: create, getRuntime: getRuntime, handleNotification: handleNotification, sceneSnapshot: sceneSnapshot, trace: trace, pipeline: pipeline, diagnosticsKey: DIAGNOSTICS_KEY, coreRevision: REVISION, commandNotification: COMMAND, resultNotification: RESULT, addonId: ADDON_ID }
})()
if (typeof module !== 'undefined' && module.exports) module.exports = KnowledgeBaseResearchCore
