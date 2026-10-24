/* Definition excerpts use private, serial requests so reading and ChatAI sessions stay independent. */
var KnowledgeBaseDefinitionConcept = (function () {
  'use strict'
  var OCR_PROMPT = '忠实识别图片中的数学摘录。保留原文语言、定义名称及数学公式，不翻译、不总结、不解释，只返回识别正文。无法辨认的符号保留为 □，不要猜测。'
  var CONCEPT_PROMPT = '从中英文数学摘录中，仅提取实际被定义的新概念，不提取背景术语，不改写定义或总结定理。只收录摘录明确命名的术语，不根据公理、公式或结论另造词条。单纯以符号指代已有集合、空间、算子或测度的约定不是新概念定义，不收录该约定中的现成名称；只收录摘录通过条件、构造或等价刻画实际定义的术语。若摘录只有定理、命题、引理、推论、性质或证明而没有新概念定义，即使能够认出定理名称也必须返回空数组。名称必须为简短的数学术语或名词短语；英文使用标准词条形态，不能输出主谓判断句，不把定义中的变量或附加说明加入名称。每个概念及明确别名都必须提供中文名称 zh，以及标准英文名称 en。即使原文只有英文，zh 也必须采用中文数学文献中的常用写法：描述性部分译成中文，人名不强制音译；Bergman、Hardy 等惯常保留原文的人名应保留，例如 zh 为“Bergman 空间”、en 为“Bergman space”，或 zh 为“Hardy 空间”、en 为“Hardy space”。其他已有固定中文名称的术语沿用惯用名称，不为音译形式额外生成别名。C*、L^p 等数学符号及 GNS 等大写缩写可保留。只输出 JSON：{"titles":[{"zh":"中文名称","en":"English name"}]}。没有定义时输出 {"titles":[]}。'
  function text(value) { return value == null ? '' : String(value) }
  function titleOf(note) { return text(note && (note.noteTitle != null ? note.noteTitle : note.title)) }
  function snapshot(note) {
    if (!note) return ''
    var comments = note.MNComments || note.comments || []
    return JSON.stringify({
      title: titleOf(note), color: note.colorIndex,
      parent: text(note.parentNote && note.parentNote.noteId),
      excerptText: text(note.excerptText), text: text(note.text),
      paint: text(note.excerptPic && note.excerptPic.paint),
      comments: Array.from(comments).map(function (c) {
        return { type: text(c.type), text: text(c.text), paint: text(c.paint), linkPaint: text(c.q_hpic && c.q_hpic.paint) }
      }),
    })
  }
  function formatTitles(value) {
    var data = typeof value === 'string' ? JSON.parse(value.trim()) : value
    if (!data || !Array.isArray(data.titles) || data.titles.length > 8) throw new Error('invalid-format')
    var parts = [], seen = {}
    data.titles.forEach(function (item) {
      if (!item || typeof item.zh !== 'string' || typeof item.en !== 'string') throw new Error('invalid-format')
      var zh = item.zh.trim(), en = item.en.trim()
      if (!zh || !en || zh.length > 80 || en.length > 120 ||
          !/[\u3400-\u9fff]/.test(zh) || !/[A-Za-z]/.test(en) || /[\u3400-\u9fff]/.test(en) ||
          /[;；\r\n]/.test(zh + en) || /[。！？]/.test(zh + en) || /\b(?:is|are|was|were|then|therefore|iff)\b/i.test(en)) throw new Error('invalid-format')
      var pair = zh + '; ' + en
      if (!seen[pair.toLowerCase()]) { parts.push(zh, en); seen[pair.toLowerCase()] = true }
    })
    var result = parts.join('; ')
    if (result.length > 800) throw new Error('invalid-format')
    return result
  }
  function isNonDefinitionBlock(value) {
    var input = text(value).replace(/\*\*/g, '')
    return /^\s*(?:定理|命题|引理|推论|Theorem|Proposition|Lemma|Corollary)(?=\s|\d|[.:：])/i.test(input) &&
      !/(?:^|\n)\s*(?:定义|Definition)(?=\s|\d|[.:：])/i.test(input)
  }
  function requestBody(stage, input, thinking, textOnly) {
    if (stage === 'concept' && !textOnly && typeof KnowledgeBaseOCRPostprocess !== 'undefined' && KnowledgeBaseOCRPostprocess.enabled()) {
      return KnowledgeBaseOCRPostprocess.requestBody(input, CONCEPT_PROMPT, { concepts: true })
    }
    var body = {
      model: 'deepseek-flash', stream: false, temperature: 0,
      thinking: { type: thinking ? 'enabled' : 'disabled' },
      max_tokens: thinking ? 4096 : (stage === 'ocr' ? 2048 : 512),
      messages: [
        { role: 'system', content: stage === 'ocr'
          ? (typeof KnowledgeBaseOCRPostprocess !== 'undefined' && KnowledgeBaseOCRPostprocess.enabled() ? KnowledgeBaseOCRPostprocess.visionPrompt : OCR_PROMPT)
          : CONCEPT_PROMPT },
        { role: 'user', content: input },
      ],
    }
    if (thinking) body.reasoning_effort = thinking
    if (stage !== 'ocr') body.response_format = { type: 'json_object' }
    return body
  }
  function log(stage, details) {
    try {
      if (typeof MNUtil === 'undefined' || typeof MNUtil.log !== 'function') return
      var data = {}, input = details || {}
      for (var key of ['status', 'errorCode', 'titleKind']) {
        if (/^[a-z][a-z0-9-]{0,60}$/.test(text(input[key]))) data[key] = text(input[key])
      }
      for (var key of ['queueLength', 'durationMs', 'timeoutMs']) {
        if (Number.isFinite(input[key])) data[key] = Math.max(0, Math.round(input[key]))
      }
      for (var key of ['hasImage', 'hasText', 'success']) {
        if (typeof input[key] === 'boolean') data[key] = input[key]
      }
      MNUtil.log({ source: 'definitionConcept', level: data.errorCode ? 'WARN' : 'INFO', message: stage, detail: data })
    } catch (_) {}
  }
  function officialConfig() {
    if (typeof chatAIConfig === 'undefined' || !chatAIConfig || typeof chatAIConfig.getConfigFromSource !== 'function' ||
        typeof MNConnection === 'undefined' || !MNConnection || typeof MNConnection.initRequest !== 'function') throw new Error('unavailable')
    var config = chatAIConfig.getConfigFromSource('Deepseek') || {}
    if (!/^https:\/\/api\.deepseek\.com\/(?:v1\/)?chat\/completions\/?$/i.test(text(config.url).trim()) || !text(config.key).trim()) throw new Error('missing-config')
    return config
  }
  function providerAvailable() {
    try { officialConfig(); return true }
    catch (error) { log('provider.unavailable', { errorCode: error && error.message === 'missing-config' ? 'missing-config' : 'unavailable' }); return false }
  }
  function create(deps) {
    var jobs = {}, queue = [], running = false, stopped = false, sequence = 0
    function save(job, status) {
      log('job.' + status, { status: status, errorCode: job.errorCode || '', titleKind: job.titleKind || '', durationMs: Date.now() - job.startedAt })
      try { deps.save({ noteId: job.noteId, status: status, errorCode: job.errorCode || '', text: job.ocrText || '', candidate: job.candidate || '', startedAt: job.startedAt, finishedAt: Date.now() }) } catch (_) {}
    }
    function release(job) {
      Object.keys(jobs).forEach(function (id) { if (jobs[id] === job) delete jobs[id] })
      job.image = null
    }
    function begin(note, manual, options) {
      if (stopped || !note || !note.noteId || jobs[text(note.noteId)] || (!manual && queue.length >= 12)) return null
      try {
        if (!manual && deps.enabled && !deps.enabled()) return null
        var research = options && typeof options.researchScene === 'boolean' ? options.researchScene : !!(deps.researchActive && deps.researchActive())
        if (deps.available && !deps.available(research)) return null
        // Capture the excerpt before the existing collection flow converts its card.
        // Manual batches retain guarded note IDs and capture one image at a time.
        var input = manual ? {} : deps.capture(note)
        if (!input || (!manual && !input.image && !input.text)) return null
        var job = { research: research, token: ++sequence, noteId: text(note.noteId), context: deps.context ? deps.context() : '', window: deps.window ? deps.window() : null, deferredInput: !!manual, image: input.image || '', inputText: input.text || '', startedAt: Date.now() }
        job.collectionValid = options && options.valid
        jobs[job.noteId] = job
        log('job.accepted', { hasImage: !!job.image, hasText: !!job.inputText, queueLength: queue.length })
        return job
      } catch (_) { return null }
    }
    function retarget(original, processed) {
      var job = original && jobs[text(original.noteId)]
      if (job && processed && processed.noteId) {
        job.noteId = text(processed.noteId)
        jobs[job.noteId] = job
      }
    }
    function valid(job) {
      if (stopped || jobs[job.noteId] !== job || (job.collectionValid && !job.collectionValid())) return null
      if (deps.context && job.context !== deps.context()) return null
      if (deps.window && job.window !== deps.window()) return null
      var note = deps.getNote(job.noteId)
      return note && snapshot(note) === job.guard ? note : null
    }
    async function request(job, stage, input) {
      var remaining = job.deadline - Date.now()
      if (remaining <= 0) throw new Error('timeout')
      var started = Date.now()
      log(stage + '.started', { timeoutMs: remaining })
      var result = await Promise.race([
        Promise.resolve().then(function () {
          return job.research && stage === 'ocr'
            ? deps.researchOCR(job.image, remaining)
            : deps.request(requestBody(stage, input, null, job.research), remaining)
        }),
        deps.delay(remaining).then(function () { throw new Error('timeout') }),
      ])
      log(stage + '.finished', { success: !!result, durationMs: Date.now() - started })
      return result
    }
    async function applyTitle(job, candidate, titleKind) {
      var applied = false, presentedNote = null
      await deps.apply(function () {
        // Undo grouping can be asynchronous; check ownership again inside its callback.
        var current = valid(job)
        if (!current) return
        var prefix = titleOf(current).match(/^【[^】]*】(?:[;；]\s*|\s*)/)
        candidate = String(candidate).replace(/\{{2,}[\s\S]*?\}{2,}/g, segment => segment.replace(/\{{2,}|\}{2,}/g, braces => braces.split('').join(' ')))
        deps.setTitle(current, (prefix ? prefix[0] : '') + candidate)
        job.titleApplied = true
        job.titleKind = titleKind
        // A fallback draft is still a visible OCR result, never a fabricated concept name.
        job.applying = true
        if (job.makeCard) job.makeCard(current)
        presentedNote = current
        applied = true
      })
      if (applied && job.research && deps.present) await deps.present(presentedNote, job.context, job.window)
      return applied
    }
    async function run(job) {
      try {
        var source = valid(job)
        if (!source) { save(job, 'stale'); return }
        if (job.deferredInput) {
          var input = deps.capture(source) || {}
          job.image = input.image || ''
          job.inputText = input.text || ''
        }
        job.deadline = Date.now() + Math.max(1000, deps.timeoutMs ? deps.timeoutMs() : 8000)
        job.ocrText = job.inputText
        if (job.image) {
          job.ocrText = await request(job, 'ocr', [{ type: 'image_url', image_url: { url: job.image } }])
        }
        var fixedCorrection = !job.research && typeof KnowledgeBaseOCRPostprocess !== 'undefined' && KnowledgeBaseOCRPostprocess.enabled()
        if (typeof job.ocrText !== 'string' || !job.ocrText.trim() || job.ocrText.length > 24000 || (!fixedCorrection && /[□�]/.test(job.ocrText))) {
          save(job, 'unreadable'); return
        }
        save(job, 'recognized')
        if (isNonDefinitionBlock(job.ocrText)) { save(job, 'no-definition'); return }
        if (!valid(job)) { save(job, 'stale'); return }
        var conceptInput = fixedCorrection
          ? (job.image ? [{ type: 'image_url', image_url: { url: job.image } }] : []).concat([{ type: 'text', text: '识别稿（可能有错）：\n' + job.ocrText }])
          : job.ocrText
        var response = await request(job, 'concept', conceptInput)
        if (fixedCorrection) {
          response = KnowledgeBaseOCRPostprocess.parse(response)
          job.ocrText = response.text
        }
        job.candidate = formatTitles(response)
        if (!job.candidate) { save(job, 'no-definition'); return }
        if (!valid(job)) { save(job, 'stale'); return }
        var applied = await applyTitle(job, job.candidate, 'concept')
        save(job, applied ? 'applied' : 'stale')
      } catch (error) {
        var code = error && error.message
        job.errorCode = /^(?:unreadable|missing-config|request-failed|unavailable|timeout|invalid-format|http-[0-9]{3}|completion-[a-z_-]+)$/.test(code) ? code : (error && error.name === 'SyntaxError' ? 'invalid-json' : 'exception')
        if (!job.titleApplied && job.ocrText && deps.formatDraft) {
          try {
            var current = valid(job), draft = current && deps.formatDraft(current, job.ocrText)
            if (draft) {
              var fallbackApplied = await applyTitle(job, draft, 'ocr-draft')
              save(job, fallbackApplied ? 'recognized-fallback' : 'stale')
              return
            }
          } catch (_) { /* Preserve the original error and never repeat a failed card-making callback. */ }
        }
        save(job, job.titleApplied ? 'card-failed' : error && error.message === 'invalid-format' ? 'invalid-format' : error && error.message === 'timeout' ? 'timeout' : 'failed')
      } finally { release(job) }
    }
    async function drain() {
      if (running || stopped) return
      running = true
      try { while (queue.length && !stopped) await run(queue.shift()) }
      finally { running = false }
    }
    function finish(job) {
      if (!job || job.enqueued || stopped) return
      var note
      try {
        note = deps.getNote(job.noteId)
        if (!note) { release(job); return }
        job.guard = snapshot(note)
      } catch (_) { release(job); return }
      job.enqueued = true
      queue.push(job)
      log('job.queued', { queueLength: queue.length })
      // Start after the excerpt event and its existing collection actions have returned.
      deps.delay(0).then(drain).catch(function () { release(job) })
    }
    function deferMakeCard(note, block) {
      var job = note && jobs[text(note.noteId)]
      if (!job || job.applying || stopped) return false
      job.makeCard = block
      return true
    }
    function enqueue(note) {
      if (note && jobs[text(note.noteId)]) return true
      var job = begin(note, true)
      finish(job)
      return !!job
    }
    return { begin: begin, retarget: retarget, finish: finish, enqueue: enqueue, deferMakeCard: deferMakeCard, stop: function () { stopped = true; queue.forEach(release); queue = [] }, pending: function () { return Object.keys(jobs).length } }
  }
  var runtime
  function sendSilently(request) {
    return new Promise(function (resolve, reject) {
      NSURLConnection.sendAsynchronousRequestQueueCompletionHandler(request, NSOperationQueue.mainQueue(), function (response, data, error) {
        try {
          // The shared sender displays network errors in a HUD, which interrupts reading.
          if (!response || MNUtil.isNSNull(response) || (error && error.localizedDescription)) throw new Error('request-failed')
          if (response.statusCode() >= 400) throw new Error('http-' + response.statusCode())
          resolve(NSJSONSerialization.JSONObjectWithDataOptions(data, 0))
        } catch (error) { reject(error) }
      })
    })
  }
  function getRuntime() {
    if (runtime) return runtime
    runtime = create({
      enabled: function () { return KnowledgeBaseConfig.getConfig('definitionConceptBackgroundEnabled') !== false },
      researchActive: function () { return typeof KnowledgeBaseNetwork !== 'undefined' && KnowledgeBaseNetwork.usesResearchOCR() },
      available: function (research) { return research ? KnowledgeBaseNetwork.researchOCRAvailable() : providerAvailable() },
      researchOCR: function (image, remaining) {
        return KnowledgeBaseNetwork.OCR(image.replace(/^data:image\/[^;]+;base64,/, ''), KnowledgeBaseConfig.getResearchOCRModel(), OCR_PROMPT, {
          researchScene: true, mode: 1, timeoutSeconds: Math.max(0.001, remaining / 1000),
        })
      },
      timeoutMs: function () { return (Number(KnowledgeBaseConfig.getConfig('definitionConceptTimeoutSeconds')) || 8) * 1000 },
      capture: function (note) {
        var data = null
        try { if (typeof ocrUtils !== 'undefined') data = ocrUtils.getImageFromNote(note) } catch (_) {}
        if (data) {
          try { data = UIImage.imageWithData(data).jpegData(0.8) } catch (_) {}
          var b64 = typeof data === 'string' ? data : data.base64Encoding()
          if (!b64 || b64.length > 12 * 1024 * 1024) return null
          return { image: 'data:image/jpeg;base64,' + b64 }
        }
        return { text: text(note.excerptText || note.text).trim() }
      },
      getNote: function (id) { return MNNote.new(id) },
      context: function () { return text(MNUtil.currentNotebookId) },
      window: function () { return MNUtil.currentWindow },
      delay: function (ms) { return MNUtil.delay(Math.max(0.001, ms / 1000)) },
      request: requestOfficial,
      formatDraft: function (note, draft) {
        if (typeof KnowledgeBaseNetwork === 'undefined') return ''
        var result = KnowledgeBaseNetwork.postProcessOCRResult(draft, Object.assign(
          KnowledgeBaseNetwork.buildOCRPostProcessOptions(note, { forceTheoremHeadingCleanup: true }),
          { quickReadingPlainText: true, normalizeTitlePunctuation: true }
        ))
        if (!result || KnowledgeBaseNetwork.getOCRResultFormatViolation(result, 1)) {
          log('draft.rejected', { errorCode: 'format-rejected' })
          return ''
        }
        return result
      },
      apply: function (block) { return KnowledgeBaseTemplate.runUndoGroupingWithoutGlobalDBRefreshAsync(block, { feature: 'mnknowledgebase.definitionConcept' }) },
      setTitle: function (note, title) {
        note.title = title
        try { note.noteTitle = title } catch (_) {}
        KnowledgeBaseTemplate.refreshNoteLocally(note, false, { stage: 'definitionConcept' })
        IntermediateKnowledgeIndexer.addToIncrementalIndex(note, { showErrorHUD: false })
      },
      present: function (note, context, window) { return KnowledgeBaseTemplate.presentOCRResult(note, { notebookId: context, window: window, stage: 'research.definition' }) },
      save: function (result) {
        var key = 'MNKB_definitionConceptResults'
        var entries = MNUtil.getLocalDataByKey(key) || []
        if (!Array.isArray(entries)) entries = []
        entries = entries.filter(function (entry) { return entry.noteId !== result.noteId })
        entries.push(result)
        MNUtil.setLocalDataByKey(entries.slice(-30), key)
      },
    })
    return runtime
  }
  async function requestOfficial(body, remaining) {
    // Credentials are never borrowed from the subscription/OCR provider.
    var config = officialConfig(), url = text(config.url).trim()
    var request = MNConnection.initRequest(url, {
      method: 'POST', timeout: Math.max(1, remaining / 1000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.key }, json: body,
    })
    var res = await sendSilently(request)
    var choice = res && res.choices && res.choices[0]
    if (!choice || !choice.message || typeof choice.message.content !== 'string') throw new Error('request-failed')
    if (choice.finish_reason !== 'stop') throw new Error('completion-' + String(choice.finish_reason || 'missing'))
    return choice.message.content
  }
  return { create: create, formatTitles: formatTitles, requestBody: requestBody, isNonDefinitionBlock: isNonDefinitionBlock, getRuntime: getRuntime, requestOfficial: requestOfficial, providerAvailable: providerAvailable, snapshot: snapshot }
})()
if (typeof module !== 'undefined' && module.exports) module.exports = KnowledgeBaseDefinitionConcept
