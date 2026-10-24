/**
 * MarginNote 4 插件入口函数
 * 
 * 这是每个 MarginNote 插件都必须实现的核心函数。
 * JSB (JavaScript Bridge) 是 MarginNote 提供的桥接系统，
 * 用于 JavaScript 与 Objective-C/Swift 之间的通信。
 * 
 * @param {String} mainPath 插件的主目录路径，用于访问插件内的资源文件
 * @returns {Class} 返回定义的插件类
 */
JSB.newAddon = function(mainPath){
  // JSB does not guarantee Node's global alias; initialize it before loading KB modules.
  if (typeof global === 'undefined') {
    const runtimeRoot = typeof globalThis !== 'undefined'
      ? globalThis
      : (function() { return this })()
    if (!runtimeRoot) throw new Error('无法获取 KnowledgeBase 运行环境')
    runtimeRoot.global = runtimeRoot
  }
  JSB.require('KnowledgeBaseHandwritingOCR');
  JSB.require('KnowledgeBaseDefinitionConcept');
  JSB.require('KnowledgeBaseOCRPostprocess');
  JSB.require('utils');
  JSB.require('KnowledgeBaseResearchCore');
  KnowledgeBaseResearchCore.trace('addon.loaded')
  JSB.require('toolbarUsageExport');
  JSB.require('knowledgebaseWebController');

  const ROOT_NOTE_IDS = {
    get preExcerpt() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'preExcerpt'); },
    get classInput() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'classInput'); },
    get readingAuto() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'readingAuto'); },
    get defaultKnowledgeBase() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'defaultKnowledgeBase'); },
    get supplementaryKnowledgeBase() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'supplementaryKnowledgeBase'); },
    get researchProcess() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'researchProcess'); },
    get historyArchive() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'historyArchive'); },
    get literaturePaperLibrary() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'literaturePaperLibrary'); },
    get literatureBookLibrary() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'literatureBookLibrary'); },
  }

  const getNativeNote = function(note) {
    if (!note) return null
    try {
      return note.note || null
    } catch (error) {
      return null
    }
  }

  const resolveAvailableNote = function(noteOrId) {
    if (!noteOrId) return null
    const candidate = typeof noteOrId === 'string' ? MNNote.new(noteOrId) : noteOrId
    if (!candidate) return null
    const nativeNote = getNativeNote(candidate)
    if (!nativeNote) return null
    let resolvedNoteId = ''
    try {
      resolvedNoteId = String(candidate.noteId || '').trim()
    } catch (_) {}
    if (!resolvedNoteId) {
      try { resolvedNoteId = String(nativeNote.noteId || '').trim() } catch (_) {}
    }
    return resolvedNoteId ? candidate : null
  }

  const readKnowledgeBaseNoteValue = function(obj, keys) {
    if (!obj) return undefined
    const candidates = Array.isArray(keys) ? keys : [keys]
    for (let i = 0; i < candidates.length; i += 1) {
      const key = candidates[i]
      try {
        if (obj[key] !== undefined && obj[key] !== null) return obj[key]
      } catch (_) {}
      try {
        if (typeof obj[key] === "function") {
          const value = obj[key]()
          if (value !== undefined && value !== null) return value
        }
      } catch (_) {}
      try {
        if (typeof obj.objectForKey === "function") {
          const value = obj.objectForKey(key)
          if (value !== undefined && value !== null) return value
        }
      } catch (_) {}
      try {
        if (typeof obj.valueForKey === "function") {
          const value = obj.valueForKey(key)
          if (value !== undefined && value !== null) return value
        }
      } catch (_) {}
    }
    return undefined
  }

  const knowledgeBaseBoolValue = function(value) {
    if (value === true || value === false) return value
    if (value === undefined || value === null) return false
    if (typeof value.boolValue === "function") return !!value.boolValue()
    if ("boolValue" in Object(value)) return !!value.boolValue
    return !!value
  }

  const knowledgeBaseNumberValue = function(value) {
    if (value === undefined || value === null) return 0
    if (typeof value === "number") return value
    if (typeof value.integerValue === "function") return Number(value.integerValue())
    if (typeof value.intValue === "function") return Number(value.intValue())
    if (typeof value.floatValue === "function") return Number(value.floatValue())
    if (typeof value.doubleValue === "function") return Number(value.doubleValue())
    if ("integerValue" in Object(value)) return Number(value.integerValue)
    if ("intValue" in Object(value)) return Number(value.intValue)
    return Number(value) || 0
  }

  const knowledgeBaseHasExtendNoteValue = function(value) {
    if (value === undefined || value === null || value === "" || value === false) return false
    try {
      if (Array.isArray(value)) return value.length > 0
      if (typeof value.count === "function") return value.count() > 0
      if ("length" in Object(value) && typeof value !== "number" && typeof value !== "boolean") return value.length > 0
    } catch (_) {}
    return true
  }

  const getKnowledgeBaseBlankHighlight = function(note) {
    if (!note) return null
    const direct = readKnowledgeBaseNoteValue(note, "blankHighlight")
    if (direct) return direct
    const options = readKnowledgeBaseNoteValue(note, "options")
    return options ? readKnowledgeBaseNoteValue(options, "blankHighlight") : null
  }

  const hasKnowledgeBaseExtendBlankHighlight = function(note) {
    const blankHighlight = getKnowledgeBaseBlankHighlight(note)
    if (!blankHighlight) return false
    return knowledgeBaseHasExtendNoteValue(readKnowledgeBaseNoteValue(blankHighlight, "blankPageNo")) ||
      knowledgeBaseHasExtendNoteValue(readKnowledgeBaseNoteValue(blankHighlight, "blankSelList"))
  }

  const isKnowledgeBaseExtendNote = function(noteOrId) {
    try {
      // MNUtils is authoritative when available. Only use the legacy field
      // inspection if this installation predates the shared API or it throws.
      if (typeof MNUtil !== "undefined" && MNUtil && typeof MNUtil.isExtendNote === "function") {
        try {
          return !!MNUtil.isExtendNote(noteOrId)
        } catch (_) {}
      }
      const note = typeof noteOrId === "string" ? MNNote.new(noteOrId, false) : noteOrId
      const nativeNote = note && note.note ? note.note : note
      if (!nativeNote) return false
      const blank = readKnowledgeBaseNoteValue(nativeNote, "blank")
      if (blank !== undefined && blank !== null && knowledgeBaseBoolValue(blank)) {
        return true
      }
      return hasKnowledgeBaseExtendBlankHighlight(nativeNote)
    } catch (_) {
      return false
    }
  }

  const safeGetChildNotes = function(note, source = 'unknown') {
    const resolvedNote = resolveAvailableNote(note)
    if (!resolvedNote) {
      return { ok: false, childNotes: [], reason: 'note_unavailable' }
    }
    try {
      const childNotes = resolvedNote.childNotes || []
      return {
        ok: true,
        childNotes: Array.isArray(childNotes) ? childNotes : [],
      }
    } catch (error) {
      KnowledgeBaseUtils.log(
        '访问 childNotes 失败，已回退为空数组',
        source,
        { error: error?.message || String(error) },
        'WARN'
      )
      return { ok: false, childNotes: [], reason: 'child_notes_unavailable' }
    }
  }

  // 使用 JSB.defineClass 定义一个继承自 JSExtension 的插件类
  // 格式：'类名 : 父类名'
  var MNKnowledgeBaseClass = JSB.defineClass('MNKnowledgeBase : JSExtension', 
  
  /*=== 实例成员（Instance members）===
   * 这些方法对应每个窗口实例的生命周期
   * MarginNote 支持多窗口，每个窗口都有独立的插件实例
   */
  {
    /**
     * 窗口初始化方法 - 每当有新窗口打开时调用
     * 
     * 这是插件最重要的初始化时机，通常在这里：
     * - 初始化插件的 UI 组件
     * - 设置插件的基本配置
     * - 显示欢迎信息
     * 
     * 注意：此时可能还没有笔记本或文档打开
     */
    sceneWillConnect: function() {
      var researchInitStage = 'observer.register'
      KnowledgeBaseResearchCore.trace('scene.connect.started')
      // Keep research communication available when unrelated saved-mode initialization fails.
      try {
        NSNotificationCenter.defaultCenter().addObserverSelectorName(self, 'onResearchCoreCommand:', 'MNKBResearchCommand')
        KnowledgeBaseResearchCore.trace('observer.registered')
        researchInitStage = 'runtime.connect'
        KnowledgeBaseResearchCore.getRuntime().connect(self)
      } catch (error) {
        KnowledgeBaseResearchCore.trace('scene.research.failed', { initStage: researchInitStage, errorCode: String(error && error.name || 'init-error') })
        KnowledgeBaseUtils.addErrorLog(error, 'sceneWillConnect.research')
      }
      researchInitStage = 'config.init'
      try {
        KnowledgeBaseConfig.init(mainPath)
        researchInitStage = 'legacy.roots'
        self.preExcerptRootNote = resolveAvailableNote(ROOT_NOTE_IDS.preExcerpt)
        self.classInputRootNote = resolveAvailableNote(ROOT_NOTE_IDS.classInput)
        self.readingAutoRootNote = resolveAvailableNote(ROOT_NOTE_IDS.readingAuto)
        self.classDateNotes = safeGetChildNotes(
          self.classInputRootNote,
          'sceneWillConnect.classInputRootNote'
        ).childNotes
        self.dateObj = MNUtil.getDateObject()
        self.todayDateStr = `${self.dateObj.year}.${self.dateObj.month}.${self.dateObj.day}`
        // MNUtil.showHUD(self.todayDateStr)

        // 保存插件实例引用，供 knowledgebaseWebController 调用
        if (typeof MNKnowledgeBaseInstance === 'undefined') {
          global.MNKnowledgeBaseInstance = self
        }

        // 注册插件通信观察者
        MNUtil.addObserver(self, 'onAddonBroadcast:', 'AddonBroadcast')
        researchInitStage = 'legacy.observers'
        // MNUtil.addObserver(self, 'onOpenKnowledgeBaseSearch:', 'openKnowledgeBaseSearch')

        // 注册文本编辑生命周期观察者（用于检测新卡片创建）
        MNUtil.addObserver(self, 'onTextDidBeginEditing:', 'UITextViewTextDidBeginEditingNotification')
        MNUtil.addObserver(self, 'onTextDidEndEditing:', 'UITextViewTextDidEndEditingNotification')

        // self.toggled = false
        self.preExcerptMode = false  // 预摘录模式
        self.classAutoMoveMode = false
        self.inboxRootMissingNotified = false
        self.inboxAutoMoveError = null
        self.readingAutoMoveError = null
        self.readingFollowPendingUntitledTarget = null
        self.readingFollowRecentExcerptIds = {}
        self._titleRefactorWorkbenchOpening = false
        self.externalReadingModeActive = false
        self.externalReadingModeSource = ''
        self.externalReadingModeBindingId = ''
        MNUtil.addObserver(self, 'onPopupMenuOnNote:', 'PopupMenuOnNote')
        MNUtil.addObserver(self, 'onProcessNewExcerpt:', 'ProcessNewExcerpt')

        MNKnowledgeBaseClass.prototype.requestLiteratureReadingModeSync.call(self)

        // 【阶段一：自动化补丁系统】
        // 自动应用循环引用防护补丁
        const autoApplyPatch = KnowledgeBaseConfig.config.autoApplyCircularPatch !== false // 默认 true
        if (autoApplyPatch) {
          const status = KnowledgeBaseUtils.getDescendantNodesPatchStatus()
          if (!status.patched || status.isNative) {
            const result = KnowledgeBaseUtils.applyDescendantNodesPatch(true)
            if (result.applied) {
            } else {
              MNLog.error({
                message: "自动应用循环引用防护补丁失败",
                source: "sceneWillConnect",
                detail: {
                  status: status,
                  result: result
                }
              })
            }
          }
        }
        KnowledgeBaseResearchCore.trace('scene.connect.ready')
      } catch (error) {
        KnowledgeBaseResearchCore.trace('scene.legacy.failed', { initStage: researchInitStage, errorCode: String(error && error.name || 'init-error') })
        KnowledgeBaseUtils.addErrorLog(error, "sceneWillConnect")
      }
    },
    
    /**
     * 窗口断开方法 - 窗口关闭时调用
     * 
     * 在这里进行清理工作：
     * - 移除添加的 UI 组件
     * - 取消定时器和事件监听
     * - 释放占用的资源
     */
    sceneDidDisconnect: function() {
      // Unregister even when Core or legacy cleanup cannot finish.
      try {
        NSNotificationCenter.defaultCenter().removeObserverName(self, 'MNKBResearchCommand')
        KnowledgeBaseResearchCore.trace('observer.removed')
      } catch (error) {
        KnowledgeBaseResearchCore.trace('observer.remove-failed', { errorCode: 'observer-remove-failed' })
      }
      try {
        if (typeof KnowledgeBaseResearchCore !== 'undefined') KnowledgeBaseResearchCore.getRuntime().disconnect(self)
      } catch (error) {
        KnowledgeBaseResearchCore.trace('scene.research.disconnect-failed', { errorCode: String(error && error.name || 'disconnect-error') })
      }
      MNUtil.undoGrouping(()=>{
        try {
          MNUtil.removeObservers(self, [
            'AddonBroadcast',
            'MNKBResearchCommand',
            'ProcessNewExcerpt',
            'UITextViewTextDidBeginEditingNotification',
            'UITextViewTextDidEndEditingNotification',
            'PopupMenuOnNote',
          ])
        } catch (error) {
          MNUtil.showHUD(error);
        }
      })
    },
    
    /**
     * 窗口失去焦点时调用
     * 
     * 适用场景：
     * - 暂停动画或定时任务
     * - 保存用户的临时操作状态
     * - 释放一些临时资源
     */
    sceneWillResignActive: function() {
      // 示例中为空实现
    },
    
    /**
     * 窗口获得焦点时调用
     * 
     * 适用场景：
     * - 恢复暂停的任务
     * - 刷新 UI 状态
     * - 重新获取最新数据
     */
    sceneDidBecomeActive: function() {
      // 示例中为空实现
    },
    
    /**
     * 笔记本即将打开时调用
     * 
     * 这是一个重要的时机，可以在这里：
     * - 初始化与笔记本相关的功能
     * - 读取笔记本的配置信息
     * - 准备插件的主要功能界面
     * 
     * @param {String} notebookid 笔记本的唯一标识符
     */
    notebookWillOpen: function(notebookid) {
      // 笔记本打开时的处理（控制器已在 queryAddonCommandStatus 中延迟初始化）
    },
    
    /**
     * 笔记本即将关闭时调用
     * 
     * 在这里进行笔记本相关的清理：
     * - 保存用户在该笔记本中的操作
     * - 清理笔记本相关的临时数据
     * - 隐藏相关的 UI 组件
     * 
     * @param {String} notebookid 笔记本的唯一标识符
     */
    notebookWillClose: function(notebookid) {
      if (typeof KnowledgeBaseResearchCore !== 'undefined') {
        KnowledgeBaseResearchCore.getRuntime().close(self, notebookid)
      }
      JSB.log('MNLOG Close Notebook: %@',notebookid);
    },
    
    /**
     * 文档打开后调用
     * 
     * 文档包括 PDF、EPUB 等格式的文件。
     * 可以在这里：
     * - 分析文档内容
     * - 准备文档相关的功能
     * - 显示文档特定的工具
     * 
     * @param {String} docmd5 文档的 MD5 哈希值，用作唯一标识
     */
    documentDidOpen: function(docmd5) {
      // 示例中为空实现
    },
    
    /**
     * 文档即将关闭时调用
     * 
     * 进行文档相关的清理工作：
     * - 保存文档的阅读进度
     * - 清理文档相关的缓存
     * - 隐藏文档工具界面
     * 
     * @param {String} docmd5 文档的 MD5 哈希值
     */
    documentWillClose: function(docmd5) {
      // 示例中为空实现
    },

    /**
     * 检测在脑图中开始编辑文本（新卡片创建检测）
     *
     * 监听文本编辑开始事件，用于检测用户在脑图中创建的新卡片
     * 利用三要素判定（无标题、无摘录、无评论）来识别新卡片
     *
     * @param {{object:UITextView}} param 通知参数，包含触发编辑的文本框引用
     */
    onTextDidBeginEditing: function(param) {
      try {
        // 1. 窗口隔离：多窗口环境下只处理当前活跃窗口
        if (self.window !== MNUtil.currentWindow) {
          return;
        }

        // 2. 学习模式过滤：复习模式(3)下不处理
        if (MNUtil.studyMode === 3) {
          return;
        }

        // 3. 获取触发编辑的文本框
        let textView = param.object;
        if (!textView) {
          return;
        }

        // 4. 检查文本框是否在脑图中
        if (!textView.isDescendantOfView(MNUtil.mindmapView)) {
          return;
        }

        // 5. 获取脑图视图
        let mindmapView = MNUtil.mindmapView;
        if (!mindmapView || mindmapView.selViewLst.length !== 1) {
          return;
        }

        // 6. 获取焦点卡片
        let focusNote = MNNote.new(mindmapView.selViewLst[0].note.note);
        if (!focusNote) {
          return;
        }

        // 7. 🔑 三要素判定：检测是否为新卡片（无标题、无摘录、无评论）
        if (!focusNote.noteTitle && !focusNote.excerptText && !focusNote.comments.length) {
          // 标记为新创建的卡片
          self.newNoteCreatedFromMindMap = focusNote;
          self.isCreatingNewNote = true;

          // KnowledgeBaseUtils.emitRuntimeLog('INFO', "【新卡片检测】noteId: " + focusNote.noteId);
        } else {
          // 清除标记（用户在编辑已有卡片）
          self.isCreatingNewNote = false;
        }

      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "onTextDidBeginEditing");
      }
    },

    /**
     * 处理文本编辑结束（新卡片处理）
     *
     * 当用户完成编辑（按回车或点击完成）时触发
     * 此时卡片已有标题，进行自动化处理
     *
     * @param {{object:UITextView}} param 通知参数
     */
    onTextDidEndEditing: function(param) {
      try {
        // 1. 窗口隔离
        if (self.window !== MNUtil.currentWindow) {
          return;
        }
        // Research keeps manually created cards in place; saved Inbox/classification flags stay intact.
        if (typeof KnowledgeBaseResearchCore !== 'undefined' &&
            KnowledgeBaseResearchCore.getRuntime().isSceneActive(self)) return

        // 2. 检查是否是新卡片编辑结束
        if (!self.isCreatingNewNote || !self.newNoteCreatedFromMindMap) {
          return;
        }

        // 3. 获取最新的卡片数据（因为用户已经输入了内容）
        let note = MNNote.new(self.newNoteCreatedFromMindMap.noteId);

        if (note && note.noteTitle) {
          if (KnowledgeBaseConfig.config.readingFollowMode) {
            self.processReadingModeNote(note, { source: "mindmap" })
            return
          }
          if (KnowledgeBaseConfig.config.classificationMode) {
            KnowledgeBaseClassUtils.createClassificationNoteAfterTextEditingInMindMap(note)
          }
          if (self.classAutoMoveMode) {
            self.processInboxAutoMoveNote(note, { source: 'mindmap' })
            return
          }
          if (KnowledgeBaseConfig.config.classAutoPinMode) {
            pinnerUtils.pinCard(note.noteId, { section: 'inbox' })
          }
        }

      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "onTextDidEndEditing");
      } finally {
        // 7. 清理标志位
        self.isCreatingNewNote = false;
      }
    },

    /**
     *
     * @param {{userInfo:{noteid:String}}} sender
     * @returns
     */
    onResearchCoreCommand: async function(sender) {
      try {
        await KnowledgeBaseResearchCore.handleNotification(self, sender)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'onResearchCoreCommand')
      }
    },

    onProcessNewExcerpt: async function (sender) {
      /**
       * 1. 自动移动到预备知识库
       * 2. 调用 MNOCR 插件进行 OCR 到标题，方便后续索引
       */
      if (typeof MNUtil === 'undefined') return
      if (self.window !== MNUtil.currentWindow) return;
      let definitionConceptTask = null
      try {
        const startTime = Date.now();
        const noteId = sender.userInfo.noteid
        const note = MNNote.new(noteId)
        if (!note) return
        if (isKnowledgeBaseExtendNote(note)) {
          return
        }

        // Research owns this event before any saved legacy mode can process it.
        if (typeof KnowledgeBaseResearchCore !== 'undefined' &&
            KnowledgeBaseResearchCore.getRuntime().isSceneActive(self)) {
          await KnowledgeBaseResearchCore.getRuntime().processExcerpt(self, note)
          return
        }

        if (self.shouldSkipReadingOCR(note) &&
            typeof KnowledgeBaseDefinitionConcept !== 'undefined') {
          definitionConceptTask = KnowledgeBaseDefinitionConcept.getRuntime().begin(note)
        }

        if (KnowledgeBaseConfig.config.readingFollowMode) {
          if (KnowledgeBaseConfig.config.readingFollowMode) {
            MNKnowledgeBaseClass.prototype.markReadingFollowSource.call(self, noteId)
          }
          await self.processReadingModeNote(note, { source: "excerpt" })
          return
        }

        // KnowledgeBaseUtils.log("开始执行 onProcessNewExcerpt", "onProcessNewExcerpt", {
        //   noteId: noteId,
        //   excerptOCRMode: KnowledgeBaseConfig.config.excerptOCRMode,
        //   classificationMode: KnowledgeBaseConfig.config.classificationMode,
        //   preExcerptMode: self.preExcerptMode,
        //   classAutoMoveMode: self.classAutoMoveMode,
        //   timestamp: startTime
        // })

        const excerptOCRMode = Number(KnowledgeBaseConfig.config.excerptOCRMode) || 0
        if (excerptOCRMode > 0 && !self.classAutoMoveMode) {
          const directOCRTagOnly = excerptOCRMode === 1 && self.hasDirectOCRTagComment(note)
          // const ocrStartTime = Date.now();
          // KnowledgeBaseUtils.log("开始 OCR 处理", "onProcessNewExcerpt", {
          //   noteId: noteId,
          //   mode: KnowledgeBaseConfig.config.excerptOCRMode,
          //   preExcerptMode: self.preExcerptMode
          // })

          let OCRResult = definitionConceptTask ? false : await KnowledgeBaseNetwork.OCRToTitle(note, excerptOCRMode, self.preExcerptMode)

          if (directOCRTagOnly) {
            const processedNote = self.processDirectOCRTaggedExcerptTitleOnly(note, {
              ocrResult: !!OCRResult,
            })
            if (processedNote) {
              return
            }
          }

          // KnowledgeBaseUtils.log("OCR 处理完成", "onProcessNewExcerpt", {
          //   noteId: noteId,
          //   success: !!OCRResult,
          //   durationMs: Date.now() - ocrStartTime
          // })

          if (OCRResult && excerptOCRMode === 1) {
            IntermediateKnowledgeIndexer.addToIncrementalIndex(note)
            // KnowledgeBaseUtils.log("已添加到增量索引", "onProcessNewExcerpt", { noteId: noteId })
          }
          if (OCRResult && excerptOCRMode === 2) {
            const processedNote = self.convertExcerptToNoExcerptIfNeeded(note) || note
            self.syncConvertedIntermediateIndexIfNeeded(note, processedNote)
            if (processedNote && typeof processedNote.focusInMindMap === 'function') {
              processedNote.focusInMindMap(0.3)
            }
            return
          }
        }

        if (KnowledgeBaseConfig.config.classificationMode) {  // 归类模式
          // KnowledgeBaseUtils.log("进入归类模式", "onProcessNewExcerpt", {
          //   noteId: noteId,
          //   elapsedMs: Date.now() - startTime
          // })

          MNUtil.undoGrouping(()=>{
            // const classificationStartTime = Date.now();
            KnowledgeBaseClassUtils.makeNoteAfterProcessNewExcerpt(note, false)
            // KnowledgeBaseUtils.log("归类模式处理完成", "onProcessNewExcerpt", {
            //   noteId: noteId,
            //   durationMs: Date.now() - classificationStartTime
            // })
          })

          // KnowledgeBaseUtils.log("归类模式执行完成", "onProcessNewExcerpt", {
          //   noteId: noteId,
          //   totalDurationMs: Date.now() - startTime
          // })
          return
        }

        if (self.preExcerptMode && self.preExcerptRootNote) {
          // 预摘录模式：自动移动到预备知识库
          // KnowledgeBaseUtils.log("进入预摘录模式", "onProcessNewExcerpt", {
          //   noteId: noteId,
          //   elapsedMs: Date.now() - startTime
          // })

          MNUtil.undoGrouping(()=>{
            // const preExcerptStartTime = Date.now();
            self.preExcerptRootNote.addChild(note)
            const processedNote = KnowledgeBaseTemplate.toNoExcerptVersion(note)
            self.syncConvertedIntermediateIndexIfNeeded(note, processedNote)
            // KnowledgeBaseUtils.log("预摘录模式处理完成", "onProcessNewExcerpt", {
            //   noteId: noteId,
            //   durationMs: Date.now() - preExcerptStartTime
            // })
          })

          // KnowledgeBaseUtils.log("预摘录模式执行完成", "onProcessNewExcerpt", {
          //   noteId: noteId,
          //   totalDurationMs: Date.now() - startTime
          // })
          return
        }

        if (self.classAutoMoveMode) {
          await self.processInboxAutoMoveNote(note, { source: 'excerpt' })
          return
        }

        if (excerptOCRMode === 1) {
          const processedNote = await self.processDirectOCRExcerptMakeCard(note)
          if (processedNote) {
            return
          }
        }
        // else {
        //   KnowledgeBaseUtils.log("未能一键制卡", "onProcessNewExcerpt",
        //     {
        //       type: KnowledgeBaseTemplate.getNoteType(note, true)||"No?" + KnowledgeBaseTemplate.getNoteType(note),
        //       excerptOCRMode: KnowledgeBaseConfig.config.excerptOCRMode,
        //       parentType: KnowledgeBaseTemplate.getNoteType(note.parentNote)
        //     }
        //   )
        // }

        // KnowledgeBaseUtils.log("onProcessNewExcerpt 执行完成", "onProcessNewExcerpt", {
        //   noteId: noteId,
        //   totalDurationMs: Date.now() - startTime
        // })
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "onProcessNewExcerpt")
      } finally {
        if (definitionConceptTask) {
          KnowledgeBaseDefinitionConcept.getRuntime().finish(definitionConceptTask)
        }
      }
    },

    queryAddonCommandStatus: function() {
      // 延迟初始化控制器（参考 mnliterature）
      KnowledgeBaseUtils.checkWebViewController()

      if (MNUtil.studyMode < 3) {
        return {
          image: "logo.png",
          object: self,
          selector: "toggleAddon:",
          checked: Number(KnowledgeBaseConfig.config.excerptOCRMode) > 0
            || !!KnowledgeBaseConfig.config.readingFollowMode
        }
      } else {
        // 复习模式下隐藏控制器
        if (KnowledgeBaseUtils.webViewController) {
          KnowledgeBaseUtils.webViewController.view.hidden = true
        }
        if (KnowledgeBaseUtils.commentWebViewController) {
          KnowledgeBaseUtils.commentWebViewController.view.hidden = true
        }
        return null
      }
    },

    // 点击插件图标执行的方法。
    toggleAddon: async function(button) {
      try {
        if (!self.addonBar) {
          self.addonBar = button.superview.superview
          KnowledgeBaseUtils.addonBar = self.addonBar
        }
        // self.toggled = !self.toggled
        MNUtil.refreshAddonCommands()
        MNKnowledgeBaseClass.prototype.openMainMenu.call(self, button)
      } catch (error) {
        MNUtil.showHUD(error);
        MNLog.error({
          message:error,
          source:"MNKnowledgeBase: toggleAddon",
        })
      }
    },

    askAIForRelevantCards: async function() {
      self.askAIForRelevantCards()
    },

    testAI: async function() {
      self.testAI()
    },

    closeOCRMode: function() {
      self.checkPopover()
      KnowledgeBaseConfig.config.excerptOCRMode = 0
      KnowledgeBaseConfig.save()
      MNKnowledgeBaseClass.prototype.refreshAddonCommandStatus.call(self)
      MNUtil.showHUD("已关闭摘录 OCR 模式", 1)
    },

    openCommentManager: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.runAfterPopoverDismiss.call(
          self,
          () => MNKnowledgeBaseClass.prototype.openCommentManager.call(self)
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "openCommentManager.selector")
      }
    },

    openHtmlMDStudio: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.runAfterPopoverDismiss.call(
          self,
          () => MNKnowledgeBaseClass.prototype.openHtmlMDStudio.call(self)
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "openHtmlMDStudio.selector")
      }
    },

    openTemplateWorkbench: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.runAfterPopoverDismiss.call(
          self,
          () => MNKnowledgeBaseClass.prototype.openTemplateWorkbench.call(self)
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "openTemplateWorkbench.selector")
      }
    },

    openQuestionResearchWorkbench: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.runAfterPopoverDismiss.call(
          self,
          () => MNKnowledgeBaseClass.prototype.openQuestionResearchWorkbench.call(self)
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "openQuestionResearchWorkbench.selector")
      }
    },

    openTitleRefactorWorkbench: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.runAfterPopoverDismiss.call(
          self,
          () => MNKnowledgeBaseClass.prototype.openTitleRefactorWorkbench.call(self)
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "openTitleRefactorWorkbench.selector")
      }
    },

    excerptOCRModelSetting: function(button) {
      try {
        self.checkPopover()
        let commandTable = []
        const sources = KnowledgeBaseConfig.getAvailableOCRSources(1)
        for (let source of sources) {
          commandTable.push(self.tableItem(source, 'setExcerptOCRModel:', source, KnowledgeBaseConfig.config.excerptOCRModelIndex === sources.indexOf(source)))
        }
        self.popoverController = MNUtil.getPopoverAndPresent(
          button,        // 触发按钮
          commandTable,  // 菜单项
          250,          // 宽度（增加到250以适应更长的菜单项）
          0             // 箭头方向（0=自动）
        );
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "excerptOCRModelSetting")
      }
    },

	    setExcerptOCRModel: function(source) {
	      try {
	        self.checkPopover()
	        MNUtil.showHUD("已设置摘录 OCR 模型为 " + source, 1)
	        KnowledgeBaseConfig.config.excerptOCRModel = source
	        KnowledgeBaseConfig.config.excerptOCRModelIndex = KnowledgeBaseConfig.getAvailableOCRSources(1).indexOf(source)
	        KnowledgeBaseConfig.save()
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, "setExcerptOCRModel")
	      }
	    },

	    excerptOCRTranslateModelSetting: function(button) {
	      try {
	        self.checkPopover()
	        let commandTable = []
	        const currentModel = (KnowledgeBaseConfig.config.excerptOCRTranslateModel || "").toString().trim()
	        commandTable.push(self.tableItem("（跟随 OCR 模型）", "setExcerptOCRTranslateModel:", "", !currentModel))
	        for (let source of KnowledgeBaseConfig.getAvailableOCRSources(1)) {
	          commandTable.push(self.tableItem(source, 'setExcerptOCRTranslateModel:', source, currentModel === source))
	        }
	        self.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 260, 0)
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, "excerptOCRTranslateModelSetting")
	      }
	    },

	    setExcerptOCRTranslateModel: function(source) {
	      try {
	        self.checkPopover()
	        const resolved = (source || "").toString().trim()
	        KnowledgeBaseConfig.config.excerptOCRTranslateModel = resolved
	        KnowledgeBaseConfig.save()
	        if (resolved) {
	          MNUtil.showHUD("已设置翻译 OCR 模型为 " + resolved, 1)
	        } else {
	          MNUtil.showHUD("翻译 OCR 模型已跟随 OCR 模型", 1)
	        }
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, "setExcerptOCRTranslateModel")
	      }
	    },

    quickReadingOCRModelSetting: function(button) {
      try {
        self.checkPopover()
        const commandTable = []
        const currentModel = (KnowledgeBaseConfig.config.quickReadingOCRModel || '').toString().trim()
        commandTable.push(self.tableItem('（跟随原有快速阅读 OCR 设置）', 'setQuickReadingOCRModel:', '', !currentModel))
        for (const source of KnowledgeBaseConfig.getAvailableOCRSources(1)) {
          commandTable.push(self.tableItem(source, 'setQuickReadingOCRModel:', source, currentModel === source))
        }
        self.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 280, 0)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'quickReadingOCRModelSetting')
      }
    },

    setQuickReadingOCRModel: function(source) {
      try {
        self.checkPopover()
        const resolved = (source || '').toString().trim()
        KnowledgeBaseConfig.config.quickReadingOCRModel = resolved
        KnowledgeBaseConfig.save()
        MNUtil.showHUD(
          resolved
            ? `已设置快速阅读 OCR 模型为 ${resolved}`
            : '快速阅读 OCR 模型已跟随原有设置',
          1,
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setQuickReadingOCRModel')
      }
    },

	    openReadingSettingsMenu: function(button) {
      try {
        MNKnowledgeBaseClass.prototype.openReadingSettingsMenuInternal.call(self, button)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'openReadingSettingsMenu')
      }
    },

    excerptOCRModeSetting: function(button) {
	      try {
	        self.checkPopover()
	        const modeNames = ['❌ 关闭', '📝 直接 OCR', '🔤 Markdown 格式']
	        let commandTable = modeNames.map((name, index) =>
	          self.tableItem(name, 'setExcerptOCRMode:', index, KnowledgeBaseConfig.config.excerptOCRMode === index)
	        )
	        self.popoverController = MNUtil.getPopoverAndPresent(
	          button,
	          commandTable,
	          250,
	          0
	        )
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, "excerptOCRModeSetting")
	      }
	    },

    setExcerptOCRMode: function(mode) {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.setExcerptOCRModeInternal.call(self, mode)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "setExcerptOCRMode")
      }
    },

    ocrProgressHUDToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.toggleOCRProgressHUDInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'ocrProgressHUDToggled')
      }
    },

    excerptOCRModelSettingForMode1: function(button) {
      try {
        self.checkPopover()
        let commandTable = []
        for (let source of KnowledgeBaseConfig.getAvailableOCRSources(1)) {
          const currentModel = KnowledgeBaseConfig.config.excerptOCRModelForMode1 || KnowledgeBaseConfig.config.excerptOCRModel
          commandTable.push(self.tableItem(source, 'setExcerptOCRModelForMode1:', source, currentModel === source))
        }
        self.popoverController = MNUtil.getPopoverAndPresent(
          button,
          commandTable,
          250,
          0
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "excerptOCRModelSettingForMode1")
      }
    },

    setExcerptOCRModelForMode1: function(source) {
      try {
        self.checkPopover()
        MNUtil.showHUD("直接 OCR 模型已设置为 " + source, 1)
        KnowledgeBaseConfig.config.excerptOCRModelForMode1 = source
        KnowledgeBaseConfig.save()
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "setExcerptOCRModelForMode1")
      }
    },

    excerptOCRModelSettingForMode2: function(button) {
      try {
        self.checkPopover()
        let commandTable = []
        for (let source of KnowledgeBaseConfig.getAvailableOCRSources(2)) {
          const currentModel = KnowledgeBaseConfig.config.excerptOCRModelForMode2 || KnowledgeBaseConfig.config.excerptOCRModel
          commandTable.push(self.tableItem(source, 'setExcerptOCRModelForMode2:', source, currentModel === source))
        }
        self.popoverController = MNUtil.getPopoverAndPresent(
          button,
          commandTable,
          250,
          0
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "excerptOCRModelSettingForMode2")
      }
    },

    setExcerptOCRModelForMode2: function(source) {
      try {
        self.checkPopover()
        MNUtil.showHUD("Markdown OCR 模型已设置为 " + source, 1)
        KnowledgeBaseConfig.config.excerptOCRModelForMode2 = source
        KnowledgeBaseConfig.save()
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "setExcerptOCRModelForMode2")
      }
    },

	    excerptOCRModelSettingForMode3: function(button) {
      try {
        self.checkPopover()
        let commandTable = []
	        for (let source of KnowledgeBaseConfig.getAvailableOCRSources(1)) {
          const currentModel = KnowledgeBaseConfig.config.excerptOCRModelForMode3 || KnowledgeBaseConfig.config.excerptOCRModel
          commandTable.push(self.tableItem(source, 'setExcerptOCRModelForMode3:', source, currentModel === source))
        }
        self.popoverController = MNUtil.getPopoverAndPresent(
          button,
          commandTable,
          250,
          0
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "excerptOCRModelSettingForMode3")
      }
    },

	    setExcerptOCRModelForMode3: function(source) {
      try {
        self.checkPopover()
        MNUtil.showHUD("概念提取 OCR 模型已设置为 " + source, 1)
        KnowledgeBaseConfig.config.excerptOCRModelForMode3 = source
        KnowledgeBaseConfig.save()
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "setExcerptOCRModelForMode3")
      }
	    },

	    mnaiModelOverrideToggled: function() {
	      try {
	        self.checkPopover()
	        const next = !KnowledgeBaseConfig.config.mnaiModelOverrideEnabled
	        KnowledgeBaseConfig.config.mnaiModelOverrideEnabled = next
	        KnowledgeBaseConfig.save()
	        const source = KnowledgeBaseConfig.config.mnaiModelOverrideSource || ''
	        const model = KnowledgeBaseConfig.config.mnaiModelOverrideModel || ''
	        const label = (source && model) ? `${source}: ${model}` : (source ? source : '未选择')
	        MNUtil.showHUD(next ? `已启用 AI 模型覆盖（${label}）` : '已关闭 AI 模型覆盖', 1)
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, 'mnaiModelOverrideToggled')
	      }
	    },

	    mnaiModelSourceSetting: function(button) {
	      try {
	        self.checkPopover()
	        if (typeof chatAIConfig === 'undefined') {
	          MNUtil.showHUD('请先打开/启用 MNAI 插件', 1)
	          return
	        }
	        const sources = (typeof chatAIConfig.allSource === 'function')
	          ? (chatAIConfig.allSource(true) || [])
	          : []
	        if (!Array.isArray(sources) || sources.length === 0) {
	          MNUtil.showHUD('未获取到 MNAI Source 列表', 1)
	          return
	        }
	        const current = KnowledgeBaseConfig.config.mnaiModelOverrideSource || chatAIConfig.config?.source || ''
	        const commandTable = sources.map((source) =>
	          self.tableItem(source, 'setMNAIModelSource:', source, source === current)
	        )
	        self.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 260, 0)
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, 'mnaiModelSourceSetting')
	      }
	    },

	    setMNAIModelSource: function(source) {
	      try {
	        self.checkPopover()
	        const s = (source || '').toString().trim()
	        if (!s) return
	        KnowledgeBaseConfig.config.mnaiModelOverrideEnabled = true
	        KnowledgeBaseConfig.config.mnaiModelOverrideSource = s
	        if (typeof chatAIConfig !== 'undefined' && typeof chatAIConfig.getDefaultModel === 'function') {
	          const defaultModel = chatAIConfig.getDefaultModel(s)
	          KnowledgeBaseConfig.config.mnaiModelOverrideModel = defaultModel || ''
	        }
	        KnowledgeBaseConfig.save()
	        const model = KnowledgeBaseConfig.config.mnaiModelOverrideModel || ''
	        MNUtil.showHUD(`AI Source 已设置为 ${s}${model ? `（${model}）` : ''}`, 1)
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, 'setMNAIModelSource')
	      }
	    },

	    mnaiModelNameSetting: function(button) {
	      try {
	        self.checkPopover()
	        if (typeof chatAIConfig === 'undefined') {
	          MNUtil.showHUD('请先打开/启用 MNAI 插件', 1)
	          return
	        }
	        const source = (KnowledgeBaseConfig.config.mnaiModelOverrideSource || chatAIConfig.config?.source || '').toString().trim()
	        if (!source) {
	          MNUtil.showHUD('请先选择 AI Source', 1)
	          return
	        }
	        const modelNames = (typeof chatAIConfig.modelNames === 'function')
	          ? (chatAIConfig.modelNames(source) || [])
	          : []
	        if (!Array.isArray(modelNames) || modelNames.length === 0) {
	          MNUtil.showHUD('该 Source 下无模型列表（或未配置 Key）', 1)
	          return
	        }
	        const current = KnowledgeBaseConfig.config.mnaiModelOverrideModel || chatAIConfig.getDefaultModel?.(source) || ''
	        const commandTable = modelNames.map((model) =>
	          self.tableItem(model, 'setMNAIModelName:', model, model === current)
	        )
	        self.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 360, 0)
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, 'mnaiModelNameSetting')
	      }
	    },

	    setMNAIModelName: function(model) {
	      try {
	        self.checkPopover()
	        const m = (model || '').toString().trim()
	        if (!m) return
	        KnowledgeBaseConfig.config.mnaiModelOverrideEnabled = true
	        KnowledgeBaseConfig.config.mnaiModelOverrideModel = m
	        KnowledgeBaseConfig.save()
	        const source = KnowledgeBaseConfig.config.mnaiModelOverrideSource || ''
	        MNUtil.showHUD(`AI 模型已设置为 ${source ? source + ': ' : ''}${m}`, 1)
	      } catch (error) {
	        KnowledgeBaseUtils.addErrorLog(error, 'setMNAIModelName')
	      }
	    },

    classificationModeToggled: function() {
      self.checkPopover()
      // KnowledgeBaseConfig.config.classificationMode = !KnowledgeBaseConfig.config.classificationMode
      KnowledgeBaseConfig.config.classificationMode = !KnowledgeBaseConfig.config.classificationMode
      KnowledgeBaseConfig.save()

      MNUtil.showHUD(KnowledgeBaseConfig.config.classificationMode ? "已开启归类模式" : "已关闭归类模式", 1)

      // KnowledgeBaseConfig.config.lastClassificationNoteId = null
      // KnowledgeBaseConfig.save()
    },

    prefixModeToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.togglePrefixModeInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'prefixModeToggled')
      }
    },

    preExcerptModeToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.togglePreExcerptModeInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'preExcerptModeToggled')
      }
    },

    preProcessModeToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.togglePreProcessModeInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'preProcessModeToggled')
      }
    },

    classAutoPinModeToggled: function() {
      self.checkPopover()
      KnowledgeBaseConfig.config.classAutoPinMode = !KnowledgeBaseConfig.config.classAutoPinMode
      KnowledgeBaseConfig.save()
      MNUtil.showHUD(KnowledgeBaseConfig.config.classAutoPinMode ? "已开启「Inbox 自动 Pin」模式" : "已关闭「Inbox 自动 Pin」模式", 1)
    },

    classAutoMoveModeToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.toggleClassAutoMoveModeInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'classAutoMoveModeToggled')
      }
    },

    readingAutoClassifyModeToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.toggleReadingAutoClassifyMode.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "readingAutoClassifyModeToggled")
      }
    },

    readingFollowModeToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.toggleReadingFollowMode.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "readingFollowModeToggled")
      }
    },

    demoModeToggled: function() {
      try {
        self.checkPopover()
        MNKnowledgeBaseClass.prototype.demoModeToggledInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "demoModeToggled")
      }
    },
    
    /**
     * 更新搜索索引（异步版本）
     */
    updateSearchIndex: async function() {
      try {
        // 关闭菜单
        if (self.popoverController) {
          self.popoverController.dismissPopoverAnimated(true);
        }

        // 🆕 显示索引模式选择对话框
        // UIAlertView.showWithTitleButtonsCallback(
          
        //   async (alert, buttonIndex) => {
            
        //   }
        // );

        let result = await MNUtil.userSelect(
          "选择索引模式",
          "",
          ["🚀 轻量索引", "💪 全量索引（含同义词）"]
        )

        if (result === 0) return; // 取消

        // 确定模式
        const mode = result === 1 ? "light" : "full";
        const modeText = mode === "light" ? "轻量" : "全量";

        const rootNotes = self.getMainKnowledgeBaseIndexRoots(MNNote.getFocusNote())

        if (rootNotes.length === 0) {
          MNUtil.showHUD("知识库不存在！");
          return;
        }

        // 显示开始提示
        MNUtil.showHUD(`开始构建${modeText}索引，请稍候...`);

        // 延迟执行以确保 UI 更新
        await MNUtil.delay(0.1);

        // 🆕 异步构建索引（传入 mode 参数）
        const manifest = await KnowledgeBaseIndexer.buildSearchIndex(rootNotes, undefined, mode, {
          shouldIndexNote(note, context) {
            return self.shouldIndexMainKnowledgeBaseNote(note, context)
          },
        });

        // 🆕 记录本次构建的模式
        KnowledgeBaseConfig.recordLastIndexMode(mode);

        // 检查结果
        if (manifest && manifest.metadata && manifest.metadata.totalCards > 0) {
          MNUtil.showHUD(`${modeText}索引构建成功！共 ${manifest.metadata.totalCards} 张卡片，${manifest.metadata.totalParts} 个分片`);
        } else {
          MNUtil.showHUD("没有找到可索引的卡片");
        }

      } catch (error) {
        MNUtil.showHUD("更新索引失败：" + error.message);
        MNLog.error(error, "MNKnowledgeBase: updateSearchIndex");
      }
    },

    supplementSelectedSubtreeIndex: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.supplementSelectedSubtreeIndexInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'supplementSelectedSubtreeIndex')
        MNUtil.showHUD('补充索引失败：' + (error?.message || String(error)), 2)
      }
    },
    
    /**
     * 搜索知识库（通用搜索，支持自定义类型）
     */
    searchInKB: async function() {
      try {
        self.checkPopover()

        // 异步加载搜索器
        const searcher = await KnowledgeBaseSearcher.loadFromFile();
        if (!searcher) {
          MNUtil.showHUD("索引未找到，请先更新搜索索引");
          return;
        }

        // 显示搜索对话框（允许类型选择）
        KnowledgeBaseSearcher.showSearchDialog(searcher, {});

      } catch (error) {
        MNUtil.showHUD("快速搜索失败：" + error.message);
        MNLog.error(error, "MNKnowledgeBase: searchInKB");
      }
    },

    /**
     * 打开可视化搜索 WebView
     *
     * 注意：数据加载由 show() 方法自动处理，无需手动加载
     */
    openSearchWebView: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.runAfterPopoverDismiss.call(
          self,
          () => MNKnowledgeBaseClass.prototype.openSearchWebView.call(self)
        )
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "openSearchWebView.selector")
      }
    },

    openModelSettingsMenu: function(button) {
      try {
        MNKnowledgeBaseClass.prototype.openModelSettingsMenu.call(self, button)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'openModelSettingsMenu')
      }
    },

    openMaintenanceMenu: function(button) {
      try {
        MNKnowledgeBaseClass.prototype.openMaintenanceMenu.call(self, button)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'openMaintenanceMenu')
      }
    },

    /**
     * 更新过程知识库索引
     */
    updateIntermediateKnowledgeIndex: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.updateIntermediateKnowledgeIndexInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'updateIntermediateKnowledgeIndex')
      }
    },

    /**
     * 更新历史卡片索引
     */
    updateHistoryCardIndex: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.updateHistoryCardIndexInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'updateHistoryCardIndex')
      }
    },

    /**
     * 更新文献归类知识库索引
     */
    updateLiteratureClassificationIndex: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.updateLiteratureClassificationIndexInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'updateLiteratureClassificationIndex')
      }
    },

    openIntermediateIndexDebugMenu: function(button) {
      try {
        MNKnowledgeBaseClass.prototype.openIntermediateIndexDebugMenu.call(self, button)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'openIntermediateIndexDebugMenu')
      }
    },

    diagnoseIntermediateIndex: async function(button) {
      try {
        await MNKnowledgeBaseClass.prototype.diagnoseIntermediateIndex.call(self, button)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'diagnoseIntermediateIndex')
      }
    },

    showDescendantNodesPatchStatus: function() {
      try {
        MNKnowledgeBaseClass.prototype.showDescendantNodesPatchStatus.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'showDescendantNodesPatchStatus')
      }
    },

    applyDescendantNodesPatch: function() {
      try {
        MNKnowledgeBaseClass.prototype.applyDescendantNodesPatch.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'applyDescendantNodesPatch')
      }
    },

    restoreDescendantNodesPatch: function() {
      try {
        MNKnowledgeBaseClass.prototype.restoreDescendantNodesPatch.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'restoreDescendantNodesPatch')
      }
    },

    /**
     * 【阶段二：主动扫描系统】
     * 扫描循环引用（生命周期绑定）
     */
    scanCircularReferences: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.scanCircularReferences.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'scanCircularReferences')
      }
    },

    /**
     * 【阶段三：可视化展示系统】
     * 显示循环引用扫描结果（生命周期绑定）
     */
    showCircularReferenceResults: function() {
      try {
        MNKnowledgeBaseClass.prototype.showCircularReferenceResults.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'showCircularReferenceResults')
      }
    },

    /**
     * 【阶段四：菜单重构】
     * 循环引用防护子菜单（生命周期绑定）
     */
    openCircularProtectionMenu: function(button) {
      try {
        MNKnowledgeBaseClass.prototype.openCircularProtectionMenu.call(self, button)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'openCircularProtectionMenu')
      }
    },

    setIntermediateIndexDebugOption: function(key) {
      try {
        MNKnowledgeBaseClass.prototype.setIntermediateIndexDebugOption.call(self, key)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setIntermediateIndexDebugOption')
      }
    },

    setIntermediateIndexDebugProfile: function(profile) {
      try {
        MNKnowledgeBaseClass.prototype.setIntermediateIndexDebugProfile.call(self, profile)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setIntermediateIndexDebugProfile')
      }
    },

    setIntermediateIndexSlowThreshold: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.setIntermediateIndexSlowThreshold.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setIntermediateIndexSlowThreshold')
      }
    },

    setIntermediateIndexSkipList: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.setIntermediateIndexSkipList.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setIntermediateIndexSkipList')
      }
    },

    addIntermediateIndexSkipFromSelection: function() {
      try {
        MNKnowledgeBaseClass.prototype.addIntermediateIndexSkipFromSelection.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'addIntermediateIndexSkipFromSelection')
      }
    },

    clearIntermediateIndexSkipList: function() {
      try {
        MNKnowledgeBaseClass.prototype.clearIntermediateIndexSkipList.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'clearIntermediateIndexSkipList')
      }
    },

    setIntermediateIndexSkipChildList: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.setIntermediateIndexSkipChildList.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setIntermediateIndexSkipChildList')
      }
    },

    addIntermediateIndexSkipChildFromSelection: function() {
      try {
        MNKnowledgeBaseClass.prototype.addIntermediateIndexSkipChildFromSelection.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'addIntermediateIndexSkipChildFromSelection')
      }
    },

    clearIntermediateIndexSkipChildList: function() {
      try {
        MNKnowledgeBaseClass.prototype.clearIntermediateIndexSkipChildList.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'clearIntermediateIndexSkipChildList')
      }
    },

    showIntermediateIndexSkipList: function() {
      try {
        MNKnowledgeBaseClass.prototype.showIntermediateIndexSkipList.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'showIntermediateIndexSkipList')
      }
    },

    testIntermediateIndexOnSelection: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.testIntermediateIndexOnSelection.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'testIntermediateIndexOnSelection')
      }
    },

    toggleIntermediateIndexTrace: function() {
      try {
        MNKnowledgeBaseClass.prototype.toggleIntermediateIndexTrace.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'toggleIntermediateIndexTrace')
      }
    },

    setIntermediateIndexTraceInterval: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.setIntermediateIndexTraceInterval.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setIntermediateIndexTraceInterval')
      }
    },

    showIntermediateIndexCheckpoint: function() {
      try {
        MNKnowledgeBaseClass.prototype.showIntermediateIndexCheckpoint.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'showIntermediateIndexCheckpoint')
      }
    },

    exportIntermediateIndexCheckpoint: function() {
      try {
        MNKnowledgeBaseClass.prototype.exportIntermediateIndexCheckpoint.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'exportIntermediateIndexCheckpoint')
      }
    },

    exportHistoryIndexCheckpoint: function() {
      try {
        MNKnowledgeBaseClass.prototype.exportHistoryIndexCheckpoint.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'exportHistoryIndexCheckpoint')
      }
    },

    exportPersistentDiagnosticLog: function() {
      try {
        MNKnowledgeBaseClass.prototype.exportPersistentDiagnosticLog.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'exportPersistentDiagnosticLog')
      }
    },

    exportToolbarUsage: async function() {
      try { await KBToolbarUsage.exportUsage() }
      catch (error) { MNUtil.showHUD('导出工具栏统计失败：' + error.message, 2) }
    },

    toggleToolbarUsage: async function() {
      try { await KBToolbarUsage.toggle() }
      catch (error) { MNUtil.showHUD('设置工具栏统计失败：' + error.message, 2) }
    },

    exportActualSearchIndex: function() {
      try {
        MNKnowledgeBaseClass.prototype.exportActualSearchIndexInternal.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'exportActualSearchIndex')
        MNUtil.showHUD('导出实际搜索索引失败：' + (error?.message || String(error)), 2)
      }
    },

    showHistoryIndexCheckpoint: function() {
      try {
        MNKnowledgeBaseClass.prototype.exportHistoryIndexCheckpoint.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'showHistoryIndexCheckpoint')
      }
    },

    skipLastIntermediateIndexCheckpointAndIndex: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.skipLastIntermediateIndexCheckpointAndIndex.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'skipLastIntermediateIndexCheckpointAndIndex')
      }
    },

    setIntermediateIndexCheckpointInterval: async function() {
      try {
        await MNKnowledgeBaseClass.prototype.setIntermediateIndexCheckpointInterval.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'setIntermediateIndexCheckpointInterval')
      }
    },

    /**
     * 搜索过程知识库
     */
    searchInIntermediateKB: async function() {
      try {
        self.checkPopover()

        // 检查缓存
        if (!self.intermediateSearchCache || !self.intermediateSearchCache.data) {
          // 加载过程知识库索引
          const manifest = IntermediateKnowledgeIndexer.loadIndexManifest();
          if (!manifest) {
            MNUtil.showHUD("过程知识库索引未找到，请先更新索引");
            return;
          }

          // 加载索引数据
          const searchData = [];
          for (const partInfo of manifest.parts) {
            const part = IntermediateKnowledgeIndexer.loadIndexPart(partInfo.filename);
            if (part && part.data) {
              searchData.push(...part.data);
            }
          }

          if (searchData.length === 0) {
            MNUtil.showHUD("过程知识库索引为空");
            return;
          }

          // 缓存数据（有效期5分钟）
          self.intermediateSearchCache = {
            data: searchData,
            timestamp: Date.now(),
            expiry: 5 * 60 * 1000 // 5分钟
          };
        } else {
          // 检查缓存是否过期
          if (Date.now() - self.intermediateSearchCache.timestamp > self.intermediateSearchCache.expiry) {
            self.intermediateSearchCache = null;
            self.searchInIntermediateKB(); // 重新加载
            return;
          }
        }

        // 显示搜索对话框（使用缓存的数据）
        self.showIntermediateSearchDialog(self.intermediateSearchCache.data);

      } catch (error) {
        MNUtil.showHUD("搜索过程知识库失败：" + error.message);
        MNLog.error(error, "MNKnowledgeBase: searchInIntermediateKB");
      }
    },
    
    /**
     * 分享索引文件（支持新版分片索引）
     */
    shareIndexFile: async function() {
      try {
        // 关闭菜单
        if (self.popoverController) {
          self.popoverController.dismissPopoverAnimated(true);
        }
        
        // 生成时间戳
        const date = new Date();
        const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, -5);

        // 优先导出“上次构建”的索引模式（full/light）
        const preferredMode = KnowledgeBaseConfig.getConfig("lastIndexMode") || "light";

        // 导出目录：优先 temp（iPad 更稳定），再降级到 Documents/dbFolder
        let exportBasePath = MNUtil.tempPath || MNUtil.tempFolder;
        if (!exportBasePath) {
          try {
            exportBasePath = NSSearchPathForDirectoriesInDomains(9, 1, true).firstObject; // NSDocumentDirectory
          } catch (_) {}
        }
        if (!exportBasePath && MNUtil.dbFolder) {
          exportBasePath = MNUtil.dbFolder + "/data";
        }
        if (!exportBasePath) {
          MNUtil.showHUD("无法获取导出目录");
          return;
        }
        
        // 首先尝试加载新版分片索引
        const manifest = KnowledgeBaseIndexer.loadIndexManifest(preferredMode, true);
        if (manifest && manifest.metadata) {
          // 新版分片索引：合并所有分片到一个文件（用于分享）
          const mergedIndex = {
            metadata: manifest.metadata,
            searchData: []
          };
          
          // 加载并合并所有分片
          for (const partInfo of manifest.parts) {
            const part = KnowledgeBaseIndexer.loadIndexPart(partInfo.filename);
            if (part && Array.isArray(part.data)) {
              for (const entry of part.data) {
                mergedIndex.searchData.push(entry);
              }
            }
          }
          
          // 导出合并后的索引
          const exportMode = (mergedIndex.metadata && mergedIndex.metadata.mode) || preferredMode;
          const filename = `kb-search-index-${exportMode}-merged-${timestamp}.json`;
          const filepath = exportBasePath + "/" + filename;
          MNUtil.writeJSON(filepath, mergedIndex);
          // 兼容：MNUtil.saveFile 在部分版本中不接受数组参数
          try {
            MNUtil.saveFile(filepath, "public.json");
          } catch (_) {
            MNUtil.saveFile(filepath, ["public.json"]);
          }
          
          MNUtil.showHUD(`索引 JSON 已导出（${mergedIndex.searchData.length} 条记录）`);
          return;
        }
        
        // 向后兼容：尝试加载旧版单文件索引
        const index = KnowledgeBaseIndexer.loadIndex();
        if (index) {
          const filename = `kb-search-index-${timestamp}.json`;
          const filepath = exportBasePath + "/" + filename;
          MNUtil.writeJSON(filepath, index);
          try {
            MNUtil.saveFile(filepath, "public.json");
          } catch (_) {
            MNUtil.saveFile(filepath, ["public.json"]);
          }
          
          MNUtil.showHUD("索引 JSON 已导出");
          return;
        }
        
        // 没有找到任何索引
        MNUtil.showHUD("未找到索引，请先更新搜索索引");
        
      } catch (error) {
        MNUtil.showHUD("分享失败：" + error.message);
        MNLog.error(error, "MNKnowledgeBase: shareIndexFile");
      }
    },







    onPopupMenuOnNote: async function (sender) {
      try {
        const selectedNoteId = sender && sender.userInfo && sender.userInfo.note && sender.userInfo.note.noteId
        if (selectedNoteId) {
          const selectedNote = MNNote.new(selectedNoteId, false)
          if (isKnowledgeBaseExtendNote(selectedNote)) {
            return
          }
          if (selectedNote) {
            await MNKnowledgeBaseClass.prototype.refreshOpenCommentManagerForNote.call(self, selectedNote, {
              force: true,
              showHUD: false,
              source: 'PopupMenuOnNote',
            })
            await MNKnowledgeBaseClass.prototype.refreshOpenTemplateWorkbenchForNote.call(self, selectedNote, {
              force: false,
              showHUD: false,
              source: 'PopupMenuOnNote',
            })
            await MNKnowledgeBaseClass.prototype.refreshOpenQuestionResearchWorkbenchForNote.call(self, selectedNote, {
              force: true,
              showHUD: true,
              source: 'PopupMenuOnNote',
            })
          }
        }
        if (selectedNoteId && KnowledgeBaseConfig.config.readingFollowMode) {
          const selectedNote = MNNote.new(selectedNoteId)
          if (selectedNote && selectedNote.noteTitle) {
            MNKnowledgeBaseClass.prototype.commitReadingFollowTarget.call(self, selectedNoteId, 'popup-titled')
          } else if (selectedNote) {
            MNKnowledgeBaseClass.prototype.scheduleUntitledReadingFollowTarget.call(self, selectedNoteId)
          }
        }
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "onPopupMenuOnNote")
      }
      if (KnowledgeBaseConfig.config.classificationMode && sender.userInfo.note.noteId) {
        let note = MNNote.new(sender.userInfo.note.noteId, false)
        if (!note) { return }
        if (KnowledgeBaseTemplate.getNoteType(note) && KnowledgeBaseTemplate.parseNoteTitle(note)) {
          // KnowledgeBaseUtils.log("复制前的类型"+ KnowledgeBaseTemplate.getNoteType(note), "onPopupMenuOnNote")
          switch (KnowledgeBaseTemplate.getNoteType(note)) {
            case "归类":
              MNUtil.copy(
                KnowledgeBaseTemplate.parseNoteTitle(note).content || ""
              )
              break;
            default:
              MNUtil.copy(
                KnowledgeBaseTemplate.parseNoteTitle(note).prefixContent + "｜" + KnowledgeBaseTemplate.parseNoteTitle(note).content || ""
              )
              break;
          }
          // KnowledgeBaseUtils.log("复制后的类型"+ KnowledgeBaseTemplate.getNoteType(note), "onPopupMenuOnNote")
        }

      }
    },
    /**
     * 处理来自其他插件的通信消息
     * @param {Object} sender - 消息发送者信息,包含 userInfo.message
     *
     * 消息协议格式:
     * marginnote4app://addon/mnknowledgebase?action=ACTION&param1=value1&param2=value2
     *
     * 支持的 actions:
     * - openSearchWebView: 打开可视化搜索界面
     * - openSearchWebViewWithText: 传入 text 参数，打开搜索界面并直接搜索
     * - openSearchWebViewWithSelectionText: 有选中文本时自动搜索，否则仅打开界面
     * - openCommentManager: 打开评论管理器
     * - openHtmlMDStudio: 打开 HtmlMD Studio
     * - openTemplateWorkbench: 打开模板工作台
     * - openQuestionResearchWorkbench: 打开问题研究工作台
     *
     * 使用示例:
     * marginnote4app://addon/mnknowledgebase?action=openSearchWebView
     * marginnote4app://addon/mnknowledgebase?action=openSearchWebViewWithText&text=keyword
     */
    onAddonBroadcast: async function (sender) {
      try {
        // 只在当前窗口响应
        if (self.window !== MNUtil.currentWindow) return;

        let message = "marginnote4app://addon/" + sender.userInfo.message
        let config = MNUtil.parseURL(message)
        let addon = config.pathComponents[0]

        if (addon === "mnknowledgebase") {
          let action = config.params.action
          switch (action) {
            case 'toolbarUsageReceipt':
              KBToolbarUsage.receive(config.params)
              break;
            case "openSearchWebView":
              await self.openSearchWebView()
              break;
            case "openSearchWebViewWithText": {
              const text = config.params.text || config.params.query || config.params.q || ""
              const didSearch = await self.openSearchWebViewWithText(text, { focus: true })
              if (!didSearch) {
                MNUtil.showHUD("未提供搜索文本")
              }
              break;
            }
            case "openSearchWebViewWithNoteId": {
              const noteId = config.params.noteId || config.params.id || ""
              const didLocate = await self.openSearchWebViewWithNoteId(noteId, { focus: true })
              if (!didLocate) {
                MNUtil.showHUD("未提供卡片 ID")
              }
              break;
            }
            case "openSearchWebViewWithSelectionText":
              await self.openSearchWebViewWithSelectionText(
                config.params.selectionText || config.params.text || config.params.query || ""
              )
              break;
            case "openSearchWebViewWithLocalRoot": {
              const rootId = config.params.rootId || config.params.id || ""
              const rootTitle = config.params.rootTitle || config.params.title || ""
              const didActivate = await self.openSearchWebViewWithLocalRoot(rootId, rootTitle)
              if (!didActivate) {
                MNUtil.showHUD("局部搜索启动失败")
              }
              break;
            }
            case "openCommentManager":
              await self.openCommentManager()
              break;
            case "exportSubtreeContext": {
              const format = config.params.format || "markdown"
              await self.exportSubtreeContext(format)
              break
            }
            case "openHtmlMDStudio":
              await self.openHtmlMDStudio()
              break;
            case "openTemplateWorkbench":
              await self.openTemplateWorkbench()
              break;
            case "openQuestionResearchWorkbench":
              await self.openQuestionResearchWorkbench()
              break;
            case "openTitleRefactorWorkbench":
              {
                const noteId = config.params.noteId || config.params.id || ""
                const targetNote = noteId ? MNNote.new(noteId, false) : null
                await self.openTitleRefactorWorkbench(targetNote || undefined)
              }
              break;
            case "openDefinitionMergeWorkbench": {
              const sourceNoteId = config.params.sourceNoteId || config.params.source || ""
              const targetNoteId = config.params.targetNoteId || config.params.target || ""
              await MNKnowledgeBaseClass.prototype.openDefinitionMergeWorkbench.call(
                self,
                sourceNoteId,
                targetNoteId
              )
              break;
            }
            case 'externalReadingModeChanged': {
              const raw = config.params.enabled
              const enabled = (raw === true || raw === 1 || raw === '1' || raw === 'true')
              const source = config.params.source || addon || 'mnliterature'
              const bindingId = config.params.bindingId || config.params.noteId || config.params.id || ''
              MNKnowledgeBaseClass.prototype.handleExternalReadingModeChanged.call(self, enabled, {
                source,
                bindingId,
              })
              break;
            }
            default:
              MNUtil.showHUD('不支持的操作：' + action)
              break;
          }
        }
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, "onAddonBroadcast")
      }
    },
  }, 
  
  /*=== 类成员（Class members）===
   * 这些方法对应整个插件的全局生命周期
   * 无论有多少个窗口，这些方法只会被调用一次
   */
  {
    /**
     * 插件连接时调用 - 插件首次加载时
     * 
     * 这是插件的全局初始化时机，适合：
     * - 注册全局事件监听器
     * - 初始化全局配置
     * - 设置插件的基础服务
     */
    addonDidConnect: function() {
      try {
        MNKnowledgeBaseClass.prototype.requestLiteratureReadingModeSync.call(self)
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'addonDidConnect.requestLiteratureReadingModeSync')
      }
    },
    
    /**
     * 插件即将断开时调用 - 插件卸载前
     * 
     * 进行全局清理工作：
     * - 取消全局事件监听
     * - 保存插件配置
     * - 释放全局资源
     */
    addonWillDisconnect: function() {
      // 示例中为空实现
    },
    
    /**
     * 应用程序即将进入前台时调用
     * 
     * 适用于 iOS/iPadOS 平台，当用户从后台切换回 MarginNote 时触发
     */
    applicationWillEnterForeground: function() {
      // 示例中为空实现
    },
    
    /**
     * 应用程序进入后台时调用
     * 
     * 适用于 iOS/iPadOS 平台，当用户切换到其他应用时触发
     */
    applicationDidEnterBackground: function() {
      // 示例中为空实现
    },
    
    /**
     * 收到本地通知时调用
     * 
     * 处理系统通知或定时提醒
     * 
     * @param {Object} notify 通知对象
     */
    applicationDidReceiveLocalNotification: function(notify) {
      // 示例中为空实现
    },
  });

  MNKnowledgeBaseClass.prototype.init = function(){
    KnowledgeBaseConfig.init(mainPath)
  }

  MNKnowledgeBaseClass.prototype.checkPopover = function(){
    // 关闭菜单
    if (this.popoverController) {
      this.popoverController.dismissPopoverAnimated(true);
      this.popoverController = null
    }
  }

  MNKnowledgeBaseClass.prototype.runAfterPopoverDismiss = async function(task, delaySeconds = 0.18){
    this.checkPopover()
    await MNUtil.delay(delaySeconds)

    if (typeof task !== "function") {
      return
    }

    return await task()
  }

  MNKnowledgeBaseClass.prototype.ensureInboxAutoMoveTargets = function() {
    try {
      this.inboxAutoMoveError = null

      this.classInputRootNote = resolveAvailableNote(this.classInputRootNote)
        || resolveAvailableNote(ROOT_NOTE_IDS.classInput)
      if (!this.classInputRootNote) {
        this.inboxAutoMoveError = '未找到 Inbox 根卡片'
        return false
      }

      const classInputChildren = safeGetChildNotes(this.classInputRootNote, 'ensureInboxAutoMoveTargets.classInputRootNote')
      if (!classInputChildren.ok) {
        this.inboxAutoMoveError = '未找到 Inbox 根卡片'
        return false
      }

      this.inboxRootMissingNotified = false
      this.classDateNotes = classInputChildren.childNotes
      this.classTodayNote = null
      this.classTodayDefClassificationNote = null
      this.classTodayThmClassificationNote = null

      return true
    } catch (error) {
      this.inboxAutoMoveError = (error && error.message) ? error.message : 'Inbox 自动移动初始化失败'
      KnowledgeBaseUtils.addErrorLog(error, 'ensureInboxAutoMoveTargets')
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.getReadingDateStr = function() {
    const dateObj = MNUtil.getDateObject()
    const month = String(dateObj.month).padStart(2, "0")
    const day = String(dateObj.day).padStart(2, "0")
    return `${dateObj.year}.${month}.${day}`
  }

  MNKnowledgeBaseClass.prototype.getReadingDateTitle = function(dateStr) {
    return `粗读 >> ${dateStr}`
  }

  MNKnowledgeBaseClass.prototype.extractReadingDateStrFromTitle = function(title) {
    const match = ((title || '').toString().trim()).match(/^粗读\s*>>\s*(\d{4}\.\d{2}\.\d{2})$/)
    return match ? match[1] : ''
  }

  MNKnowledgeBaseClass.prototype.cleanupHistoricalReadingAutoNotes = function(dateNotes = []) {
    // Historical cards are user content; empty children do not prove safe deletion.
    return { deletedClassificationCount: 0, deletedDateCount: 0 }
  }

  MNKnowledgeBaseClass.prototype.ensureReadingAutoMoveTargets = function() {
    try {
      this.readingAutoMoveError = null
      this.readingDateStr = this.getReadingDateStr()

      this.readingAutoRootNote = resolveAvailableNote(this.readingAutoRootNote)
        || resolveAvailableNote(ROOT_NOTE_IDS.readingAuto)
      if (!this.readingAutoRootNote) {
        this.readingAutoMoveError = "未找到阅读自动归类根卡片"
        return false
      }

      const readingRootChildren = safeGetChildNotes(
        this.readingAutoRootNote,
        'ensureReadingAutoMoveTargets.readingAutoRootNote'
      )
      if (!readingRootChildren.ok) {
        this.readingAutoMoveError = "未找到阅读自动归类根卡片"
        return false
      }

      const dateNotes = readingRootChildren.childNotes
      const cleanupResult = this.cleanupHistoricalReadingAutoNotes(dateNotes)

      if ((cleanupResult.deletedClassificationCount > 0 || cleanupResult.deletedDateCount > 0)
        && this.readingAutoRootNote
        && typeof this.readingAutoRootNote.refresh === 'function') {
        try {
          this.readingAutoRootNote.refresh()
        } catch (_) {}
      }

      const latestReadingRootChildren = safeGetChildNotes(
        this.readingAutoRootNote,
        'ensureReadingAutoMoveTargets.readingAutoRootNote.afterCleanup'
      )
      const finalDateNotes = latestReadingRootChildren.ok
        ? latestReadingRootChildren.childNotes
        : dateNotes
      const todayTitle = this.getReadingDateTitle(this.readingDateStr)
      this.readingDateNote = finalDateNotes.find(note => (note.noteTitle || '').trim() === todayTitle)

      if (!this.readingDateNote) {
        this.readingDateNote = this.readingAutoRootNote.createChildNote({
          title: todayTitle,
          content: "",
          markdown: true,
          color: 0,
        })
      }

      return true
    } catch (error) {
      this.readingAutoMoveError = (error && error.message) ? error.message : "阅读自动归类初始化失败"
      KnowledgeBaseUtils.addErrorLog(error, "ensureReadingAutoMoveTargets")
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.getManagedAutomationModeKeys = function() {
    return ['excerptOCR', 'preExcerpt', 'classAutoMove', 'readingFollow', 'prefixMode']
  }

  MNKnowledgeBaseClass.prototype.getManagedAutomationModeLabel = function(modeKey) {
    const labels = {
      excerptOCR: '摘录 OCR',
      preProcess: '卡片预处理',
      preExcerpt: '预摘录卡片',
      classAutoMove: 'Inbox 自动移动',
      readingAutoClassify: '阅读自动归类',
      readingFollow: '快速阅读',
      prefixMode: '前缀模式',
    }
    return labels[modeKey] || String(modeKey || '')
  }

  MNKnowledgeBaseClass.prototype.isManagedAutomationModeEnabled = function(modeKey) {
    switch (modeKey) {
      case 'excerptOCR':
        return Number(KnowledgeBaseConfig.config.excerptOCRMode) > 0
      case 'preProcess':
        return !!KnowledgeBaseConfig.config.preProcessMode
      case 'preExcerpt':
        return !!this.preExcerptMode
      case 'classAutoMove':
        return !!this.classAutoMoveMode
      case 'readingFollow':
        return !!KnowledgeBaseConfig.config.readingFollowMode
      case 'prefixMode':
        return !!KnowledgeBaseConfig.config.prefixMode
      default:
        return false
    }
  }

  MNKnowledgeBaseClass.prototype.disableManagedAutomationMode = function(modeKey, options = {}) {
    if (!this.isManagedAutomationModeEnabled(modeKey)) return ''

    switch (modeKey) {
      case 'excerptOCR':
        if (options.preserveReadingOCRMode && KnowledgeBaseConfig.config.excerptOCRMode > 0) {
          KnowledgeBaseConfig.config.readingOCRMode = KnowledgeBaseConfig.config.excerptOCRMode
        }
        KnowledgeBaseConfig.config.excerptOCRMode = 0
        this.refreshAddonCommandStatus()
        break
      case 'preProcess':
        KnowledgeBaseConfig.config.preProcessMode = false
        break
      case 'preExcerpt':
        this.preExcerptMode = false
        break
      case 'classAutoMove':
        this.classAutoMoveMode = false
        break
      case 'readingFollow':
        KnowledgeBaseConfig.config.readingFollowMode = false
        this.refreshAddonCommandStatus()
        break
      case 'prefixMode':
        KnowledgeBaseConfig.config.prefixMode = false
        break
      default:
        return ''
    }

    return this.getManagedAutomationModeLabel(modeKey)
  }

  MNKnowledgeBaseClass.prototype.disableManagedAutomationModes = function(modeKeys, options = {}) {
    const keys = Array.isArray(modeKeys) ? modeKeys : []
    const disabledLabels = []
    const seen = {}

    keys.forEach((modeKey) => {
      const label = this.disableManagedAutomationMode(modeKey, options)
      if (label && !seen[label]) {
        seen[label] = true
        disabledLabels.push(label)
      }
    })

    return disabledLabels
  }

  MNKnowledgeBaseClass.prototype.getConflictingAutomationModeKeys = function(targetModeKey) {
    switch (targetModeKey) {
      case 'excerptOCR':
        return ['preExcerpt', 'classAutoMove', 'readingFollow', 'prefixMode']
      case 'preProcess':
        return ['prefixMode']
      case 'prefixMode':
        return ['excerptOCR', 'preProcess', 'preExcerpt', 'classAutoMove', 'readingFollow']
      default:
        return this.getManagedAutomationModeKeys().filter((modeKey) => modeKey !== targetModeKey)
    }
  }

  MNKnowledgeBaseClass.prototype.showManagedAutomationModeHUD = function(baseMessage, disabledLabels, options = {}) {
    const closedLabels = Array.isArray(disabledLabels) ? disabledLabels.slice() : []
    if (options.externalReadingStopped) {
      closedLabels.push('文献库阅读中')
    }

    const dedupedClosedLabels = []
    const seen = {}
    closedLabels.forEach((label) => {
      const normalized = String(label || '').trim()
      if (normalized && !seen[normalized]) {
        seen[normalized] = true
        dedupedClosedLabels.push(normalized)
      }
    })

    const parts = [String(baseMessage || '').trim()].filter(Boolean)
    if (dedupedClosedLabels.length) {
      parts.push(`已关闭：${dedupedClosedLabels.join('、')}`)
    }
    MNUtil.showHUD(parts.join('；'), 1)
  }

  MNKnowledgeBaseClass.prototype.requestLiteratureReadingModeSync = function() {
    try {
      MNUtil.postNotification('AddonBroadcast', {
        message: 'mnliterature?action=syncReadingModeState&source=mnknowledgebase',
      })
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'requestLiteratureReadingModeSync')
    }
  }

  MNKnowledgeBaseClass.prototype.requestStopLiteratureReadingForAutomation = function(triggerLabel) {
    const wasActive = !!this.externalReadingModeActive
    try {
      const encodedTrigger = encodeURIComponent(String(triggerLabel || '').trim())
      MNUtil.postNotification('AddonBroadcast', {
        message: `mnliterature?action=stopReading&source=mnknowledgebase&trigger=${encodedTrigger}`,
      })
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'requestStopLiteratureReadingForAutomation', { triggerLabel })
    }
    return wasActive
  }

  MNKnowledgeBaseClass.prototype.handleExternalReadingModeChanged = function(enabled, options = {}) {
    this.externalReadingModeActive = !!enabled
    this.externalReadingModeSource = String(options.source || 'mnliterature')
    this.externalReadingModeBindingId = String(options.bindingId || '').trim()

    if (!enabled) {
      return
    }

    const disabledLabels = this.disableManagedAutomationModes(this.getManagedAutomationModeKeys())
    if (disabledLabels.length) {
      KnowledgeBaseConfig.save()
      this.showManagedAutomationModeHUD('文献库已开启阅读中', disabledLabels)
    }
  }

  MNKnowledgeBaseClass.prototype.applyAutomationConflictsBeforeEnable = function(targetModeKey, options = {}) {
    if (targetModeKey === 'preProcess') {
      const preserveReadingOCRMode = !!options.preserveReadingOCRMode
      return {
        disabledLabels: this.disableManagedAutomationModes(
          this.getConflictingAutomationModeKeys(targetModeKey),
          { preserveReadingOCRMode }
        ),
        externalReadingStopped: false,
      }
    }

    const preserveReadingOCRMode = !!options.preserveReadingOCRMode
    const disabledLabels = this.disableManagedAutomationModes(
      this.getConflictingAutomationModeKeys(targetModeKey),
      { preserveReadingOCRMode }
    )
    const externalReadingStopped = this.requestStopLiteratureReadingForAutomation(
      this.getManagedAutomationModeLabel(targetModeKey)
    )

    return {
      disabledLabels,
      externalReadingStopped,
    }
  }

  MNKnowledgeBaseClass.prototype.setExcerptOCRModeInternal = function(mode) {
    const parsedMode = parseInt(mode, 10)
    const normalizedMode = Number.isFinite(parsedMode)
      ? Math.max(0, Math.min(2, parsedMode))
      : 0

    if (normalizedMode < 1) {
      KnowledgeBaseConfig.config.excerptOCRMode = 0
      KnowledgeBaseConfig.save()
      this.refreshAddonCommandStatus()
      return
    }

    this.applyAutomationConflictsBeforeEnable('excerptOCR')
    KnowledgeBaseConfig.config.excerptOCRMode = normalizedMode
    KnowledgeBaseConfig.save()
    this.refreshAddonCommandStatus()

  }

  MNKnowledgeBaseClass.prototype.togglePreExcerptModeInternal = function() {
    const next = !this.preExcerptMode
    if (!next) {
      this.preExcerptMode = false
      MNUtil.showHUD('已关闭预摘录模式', 1)
      return
    }

    const result = this.applyAutomationConflictsBeforeEnable('preExcerpt')
    this.preExcerptMode = true
    KnowledgeBaseConfig.save()
    this.showManagedAutomationModeHUD('已开启预摘录模式', result.disabledLabels, {
      externalReadingStopped: result.externalReadingStopped,
    })
  }

  MNKnowledgeBaseClass.prototype.togglePrefixModeInternal = function() {
    const next = !KnowledgeBaseConfig.config.prefixMode
    if (!next) {
      KnowledgeBaseConfig.config.prefixMode = false
      KnowledgeBaseConfig.save()
      MNUtil.showHUD('已关闭前缀模式', 1)
      return
    }

    const result = this.applyAutomationConflictsBeforeEnable('prefixMode')
    KnowledgeBaseConfig.config.prefixMode = true
    KnowledgeBaseConfig.save()
    this.showManagedAutomationModeHUD('已开启前缀模式', result.disabledLabels, {
      externalReadingStopped: result.externalReadingStopped,
    })
  }

  MNKnowledgeBaseClass.prototype.togglePreProcessModeInternal = function() {
    const next = !KnowledgeBaseConfig.config.preProcessMode
    if (!next) {
      KnowledgeBaseConfig.config.preProcessMode = false
      KnowledgeBaseConfig.save()
      MNUtil.showHUD('已关闭卡片预处理模式', 1)
      return
    }

    const result = this.applyAutomationConflictsBeforeEnable('preProcess')
    KnowledgeBaseConfig.config.preProcessMode = true
    KnowledgeBaseConfig.save()
    this.showManagedAutomationModeHUD('已开启卡片预处理模式', result.disabledLabels)
  }

  MNKnowledgeBaseClass.prototype.toggleClassAutoMoveModeInternal = function() {
    const next = !this.classAutoMoveMode
    if (!next) {
      this.classAutoMoveMode = false
      MNUtil.showHUD('已关闭「Inbox 自动移动」模式', 1)
      return
    }

    if (!this.ensureInboxAutoMoveTargets()) {
      this.classAutoMoveMode = false
      const errorMessage = this.inboxAutoMoveError
        ? `❌ ${this.inboxAutoMoveError}，已关闭自动移动`
        : '❌ Inbox 自动移动初始化失败，已关闭'
      MNUtil.showHUD(errorMessage, 1)
      this.inboxRootMissingNotified = true
      return
    }

    const result = this.applyAutomationConflictsBeforeEnable('classAutoMove')
    this.classAutoMoveMode = true
    KnowledgeBaseConfig.save()
    this.showManagedAutomationModeHUD('已开启「Inbox 自动移动」模式', result.disabledLabels, {
      externalReadingStopped: result.externalReadingStopped,
    })
  }

  MNKnowledgeBaseClass.prototype.toggleReadingAutoClassifyMode = function() {
    // Retired selector remains callable without changing saved preferences.
    return false
  }

  MNKnowledgeBaseClass.prototype.toggleReadingFollowMode = function() {
    const next = !KnowledgeBaseConfig.config.readingFollowMode
    if (!next) {
      KnowledgeBaseConfig.config.readingFollowMode = false
      KnowledgeBaseConfig.save()
      this.refreshAddonCommandStatus()
      MNUtil.showHUD('已关闭快速阅读模式', 1)
      return
    }

    const result = this.applyAutomationConflictsBeforeEnable('readingFollow', {
      preserveReadingOCRMode: true,
    })
    KnowledgeBaseConfig.config.readingFollowMode = true
    KnowledgeBaseConfig.save()
    this.refreshAddonCommandStatus()
    this.showManagedAutomationModeHUD('已开启快速阅读模式', result.disabledLabels, {
      externalReadingStopped: result.externalReadingStopped,
    })
  }

  MNKnowledgeBaseClass.prototype.demoModeToggledInternal = function() {
    const next = !KnowledgeBaseConfig.config.demoMode
    KnowledgeBaseConfig.config.demoMode = next
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(next ? "已开启演示模式" : "已关闭演示模式", 1)
  }

  MNKnowledgeBaseClass.prototype.toggleOCRProgressHUDInternal = function() {
    const next = !KnowledgeBaseConfig.getConfig('ocrProgressHUDEnabled')
    KnowledgeBaseConfig.config.ocrProgressHUDEnabled = next
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(next ? '已开启 OCR 过程 HUD 提示' : '已关闭 OCR 过程 HUD 提示', 1)
  }

  MNKnowledgeBaseClass.prototype.resolveReadingOCRMode = function() {
    let mode = KnowledgeBaseConfig.config.readingOCRMode
    if (!mode || mode < 1) {
      mode = KnowledgeBaseConfig.config.excerptOCRMode > 0 ? KnowledgeBaseConfig.config.excerptOCRMode : 1
    }
    return mode
  }

  MNKnowledgeBaseClass.prototype.resolveInboxAutoMoveOCRMode = function() {
    const mode = Number(KnowledgeBaseConfig.config.excerptOCRMode) || 0
    return mode > 0 ? mode : 0
  }

  MNKnowledgeBaseClass.prototype.applyOCRToTitleWithMode = async function(note, mode, options = {}) {
    const normalizedMode = Number(mode) || 0
    if (normalizedMode < 1) return false
    const result = await KnowledgeBaseNetwork.OCRToTitle(
      note,
      normalizedMode,
      this.preExcerptMode,
      'all',
      options,
    )
    if (result && !(options && options.skipIndex === true)) {
      IntermediateKnowledgeIndexer.addToIncrementalIndex(note)
    }
    return result
  }

  MNKnowledgeBaseClass.prototype.convertExcerptToNoExcerptIfNeeded = function(note) {
    return KnowledgeBaseTemplate.toNoExcerptVersion(note, undefined, { allowTextExcerpt: true })
  }

  MNKnowledgeBaseClass.prototype.syncConvertedIntermediateIndexIfNeeded = function(originalNote, processedNote, options = {}) {
    if (typeof KnowledgeBaseDefinitionConcept !== 'undefined') {
      KnowledgeBaseDefinitionConcept.getRuntime().retarget(originalNote, processedNote)
    }
    if (!originalNote || !processedNote || !originalNote.noteId || !processedNote.noteId) return
    const originalId = String(originalNote.noteId)
    const processedId = String(processedNote.noteId)
    if (originalId === processedId) return
    const indexOptions = {
      ...options,
      staleIds: [originalId],
    }
    if (typeof KnowledgeBaseTemplate.shouldSuppressQuickReadingDefinitionIndexHUD === 'function' &&
      KnowledgeBaseTemplate.shouldSuppressQuickReadingDefinitionIndexHUD(processedNote)) {
      indexOptions.showErrorHUD = false
    }
    IntermediateKnowledgeIndexer.addToIncrementalIndex(processedNote, indexOptions)
  }

  MNKnowledgeBaseClass.prototype.getDirectOCRTagCommentIndexes = function(note) {
    const comments = (note && Array.isArray(note.MNComments) && note.MNComments.length > 0)
      ? note.MNComments
      : (note && Array.isArray(note.comments) ? note.comments : [])
    const indexes = []
    comments.forEach((comment, index) => {
      if (comment && comment.type === "tagComment") {
        indexes.push(index)
      }
    })
    return indexes
  }

  MNKnowledgeBaseClass.prototype.hasDirectOCRTagComment = function(note) {
    return this.getDirectOCRTagCommentIndexes(note).length > 0
  }

  MNKnowledgeBaseClass.prototype.removeDirectOCRTagComments = function(note) {
    const indexes = this.getDirectOCRTagCommentIndexes(note)
    if (indexes.length > 0 && note && typeof note.removeCommentsByIndexArr === "function") {
      note.removeCommentsByIndexArr(Array.from(new Set(indexes)).sort((a, b) => a - b))
      if (typeof note.refresh === "function") {
        note.refresh()
      }
    }
    return indexes.length
  }

  MNKnowledgeBaseClass.prototype.processDirectOCRTaggedExcerptTitleOnly = function(note, options = {}) {
    if (!note) return null
    const removedTagCount = this.removeDirectOCRTagComments(note)
    const processedNote = this.convertExcerptToNoExcerptIfNeeded(note) || note
    this.syncConvertedIntermediateIndexIfNeeded(note, processedNote)
    if (processedNote && processedNote.noteId === note.noteId) {
      IntermediateKnowledgeIndexer.addToIncrementalIndex(processedNote)
    }
    if (processedNote && typeof processedNote.focusInMindMap === 'function') {
      processedNote.focusInMindMap(0.3)
    }
    KnowledgeBaseUtils.log('直接 OCR 标签摘录仅转非摘录', 'processDirectOCRTaggedExcerptTitleOnly', {
      noteId: processedNote && processedNote.noteId,
      sourceNoteId: note && note.noteId,
      removedTagCount,
      ocrResult: !!options.ocrResult,
    })
    return processedNote
  }

  MNKnowledgeBaseClass.prototype.shouldSkipDirectOCRDefinitionCard = function(note) {
    if (Number(KnowledgeBaseConfig.config.excerptOCRMode) !== 1 || !note) return false
    const definitionType = KnowledgeBaseTemplate.types && KnowledgeBaseTemplate.types["定义"]
    const definitionColorIndex = definitionType ? definitionType.colorIndex : 2
    return note.colorIndex === definitionColorIndex || note.colorIndex === 2
  }

  MNKnowledgeBaseClass.prototype.resolveDirectOCRMakeCardPlan = function(note) {
    if (!note || !note.parentNote) return null
    if (this.shouldSkipDirectOCRDefinitionCard(note)) {
      return {
        action: 'skip',
        noteType: '定义',
        reason: 'directOCRDefinitionCard',
      }
    }
    const directType = KnowledgeBaseTemplate.getNoteType(note, true)
    if (!directType) return null
    if (directType === '归类') {
      return {
        action: 'convertToClassification',
        noteType: directType,
        reason: 'directOCRClassificationCard',
      }
    }

    const parentNote = note.parentNote
    const brotherIndex = note.indexInBrotherNotes
    if (brotherIndex <= 0) {
      return {
        action: 'makeInPlace',
        noteType: directType,
        reason: 'noPreviousSibling',
      }
    }

    const previousSibling = parentNote.childNotes && parentNote.childNotes[brotherIndex - 1]
    if (!previousSibling) return null
    const previousSiblingType = KnowledgeBaseTemplate.getNoteType(previousSibling)
    if (previousSiblingType && previousSiblingType !== '归类') {
      return {
        action: 'makeInPlace',
        noteType: directType,
        previousSiblingType,
        reason: 'previousSiblingIsKnowledgeCard',
      }
    }
    if (previousSiblingType !== '归类') {
      return {
        action: 'makeInPlace',
        noteType: directType,
        reason: 'previousSiblingNotClassification',
      }
    }

    const parsed = KnowledgeBaseTemplate.parseNoteTitle(previousSibling)
    if (!parsed || parsed.type !== directType) {
      return {
        action: 'makeInPlace',
        noteType: directType,
        previousSiblingType,
        reason: 'previousSiblingClassificationTypeMismatch',
      }
    }

    return {
      action: 'moveToClassification',
      noteType: directType,
      targetParentNote: previousSibling,
      reason: 'previousSiblingIsMatchingClassification',
    }
  }

  MNKnowledgeBaseClass.prototype.processDirectOCRExcerptMakeCard = async function(note) {
    const plan = this.resolveDirectOCRMakeCardPlan(note)
    if (!plan) return null
    if (plan.action === 'skip') {
      KnowledgeBaseUtils.log('直接 OCR 定义类摘录跳过制卡', 'processDirectOCRExcerptMakeCard', {
        noteId: note && note.noteId,
        noteType: plan.noteType,
        reason: plan.reason,
        colorIndex: note && note.colorIndex,
      })
      return null
    }

    let processedNote = note
    if (plan.action === 'convertToClassification') {
      processedNote = await KnowledgeBaseTemplate.convertNoteToClassificationNote(note, true, true, true, {
        usePopupDefaultTitle: true,
      })
    } else {
      MNUtil.undoGrouping(() => {
        if (plan.action === 'moveToClassification' && plan.targetParentNote) {
          note.moveTo(plan.targetParentNote)
        }
        processedNote = KnowledgeBaseTemplate.toNoExcerptVersion(note)
        this.syncConvertedIntermediateIndexIfNeeded(note, processedNote)
        KnowledgeBaseTemplate.makeCard(processedNote, false, true)
      })
    }

    if (processedNote && KnowledgeBaseConfig.config.classAutoPinMode) {
      pinnerUtils.pinCard(processedNote.noteId, { section: 'inbox' })
    }
    if (processedNote && typeof processedNote.focusInMindMap === 'function') {
      processedNote.focusInMindMap(0.3)
    }

    KnowledgeBaseUtils.log('直接 OCR 摘录制卡完成', 'processDirectOCRExcerptMakeCard', {
      noteId: processedNote && processedNote.noteId,
      noteType: plan.noteType,
      action: plan.action,
      reason: plan.reason,
      targetParentNoteId: plan.targetParentNote && plan.targetParentNote.noteId,
      previousSiblingType: plan.previousSiblingType,
    })
    return processedNote
  }

  MNKnowledgeBaseClass.prototype.shouldSkipReadingOCR = function(note, noteType) {
    if (noteType === "定义") return true
    const defType = KnowledgeBaseTemplate.types && KnowledgeBaseTemplate.types["定义"]
    if (defType && note && note.colorIndex === defType.colorIndex) return true
    return false
  }

  MNKnowledgeBaseClass.prototype.applyReadingOCRToTitle = async function(note) {
    return this.applyOCRToTitleWithMode(note, this.resolveReadingOCRMode())
  }

  MNKnowledgeBaseClass.prototype.applyQuickReadingOCRToTitle = async function(note, options = {}) {
    return this.applyOCRToTitleWithMode(note, 1, {
      ...options,
      quickReadingPlainText: true,
    })
  }

  MNKnowledgeBaseClass.prototype.refreshAfterQuickReadingOCR = function(note, stage = 'quickReadingOCR') {
    const util = typeof MNUtil !== 'undefined' && MNUtil ? MNUtil : null
    if (!util) return false
    const notebookId = util.currentNotebookId
    try {
      if (typeof util.xdyyRefreshAfterDBChangedNow === 'function') {
        util.xdyyRefreshAfterDBChangedNow(notebookId)
        return true
      }
      if (util.app && typeof util.app.refreshAfterDBChanged === 'function') {
        util.app.refreshAfterDBChanged(notebookId)
        return true
      }
      if (typeof util.refreshAfterDBChanged === 'function') {
        util.refreshAfterDBChanged(notebookId)
        return true
      }
      throw new Error('当前 MNUtils 没有可用的 DB refresh API')
    } catch (error) {
      if (typeof KnowledgeBaseUtils !== 'undefined' &&
        KnowledgeBaseUtils && typeof KnowledgeBaseUtils.addErrorLog === 'function') {
        KnowledgeBaseUtils.addErrorLog(error, `refreshAfterQuickReadingOCR:${stage}`)
      }
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.convertQuickReadingExcerptWithoutGlobalRefresh = function(note, parentNote) {
    let processedNote = note
    KnowledgeBaseTemplate.runUndoGroupingWithoutGlobalDBRefresh(() => {
      processedNote = KnowledgeBaseTemplate.toNoExcerptVersion(note, parentNote, {
        createChildUndoGrouping: false,
      })
    }, {
      feature: "mnknowledgebase.quickReadingConversion.noGlobalDBRefresh",
    })
    if (processedNote && processedNote.noteId !== (note && note.noteId)) {
      KnowledgeBaseTemplate.refreshNoteLocally(parentNote, false, {
        stage: "quickReadingConversion.parent",
      })
      KnowledgeBaseTemplate.refreshNoteLocally(processedNote, false, {
        stage: "quickReadingConversion.processed",
      })
    }
    return processedNote
  }

  MNKnowledgeBaseClass.prototype.getReadingTypeFromColor = function(note) {
    const types = KnowledgeBaseTemplate.types || {}
    const colorIndex = note ? note.colorIndex : undefined
    if (types["定义"] && colorIndex === types["定义"].colorIndex) return "定义"
    if (types["命题"] && colorIndex === types["命题"].colorIndex) return "命题"
    if (types["例子"] && colorIndex === types["例子"].colorIndex) return "例子"
    if (types["反例"] && colorIndex === types["反例"].colorIndex) return "反例"
    return ""
  }

  MNKnowledgeBaseClass.prototype.extractReadingTagTypeAndCleanup = function(note) {
    const tagTypes = [
      "约定",
      "结构脉络",
      "关键技法", 
      "文献综述", 
      "引用点", 
      "遗留问题", 
      "疏漏错误",
      "疑问"
    ]
    const comments = (note && Array.isArray(note.MNComments) && note.MNComments.length > 0)
      ? note.MNComments
      : (note && Array.isArray(note.comments) ? note.comments : [])

    let matchedType = ""
    let indicesToRemove = []

    comments.forEach((comment, index) => {
      if (!comment || comment.type !== "tagComment") return
      const raw = (comment.text || "").toString().trim()
      const normalized = raw.replace(/^#/, "").trim()
      if (tagTypes.includes(normalized)) {
        if (!matchedType) {
          matchedType = normalized
        }
        indicesToRemove.push(index)
      }
    })

    if (indicesToRemove.length > 0 && note && typeof note.removeCommentsByIndexArr === "function") {
      note.removeCommentsByIndexArr(indicesToRemove)
      if (typeof note.refresh === "function") {
        note.refresh()
      }
    }

    return matchedType
  }

  MNKnowledgeBaseClass.prototype.getReadingAutoTypeFromNote = function(note) {
    const tagType = this.extractReadingTagTypeAndCleanup(note)
    if (tagType) return tagType
    return this.getReadingTypeFromColor(note)
  }

  MNKnowledgeBaseClass.prototype.getReadingClassificationNote = function(noteType) {
    if (!this.readingDateNote) return null
    const titleContent = this.getReadingDateTitle(this.readingDateStr)
    const childrenResult = safeGetChildNotes(this.readingDateNote, 'getReadingClassificationNote.readingDateNote')
    if (!childrenResult.ok) return null
    const children = childrenResult.childNotes
    let target = children.find(note => {
      if (KnowledgeBaseTemplate.getNoteType(note) !== "归类") return false
      const parsed = KnowledgeBaseTemplate.parseNoteTitle(note)
      return parsed && parsed.content === titleContent && parsed.type === noteType
    })
    if (!target) {
      target = KnowledgeBaseTemplate.createClassificationNoteAsChildNote(
        this.readingDateNote,
        titleContent,
        noteType,
        true,
        true
      )
    }
    return target
  }

  MNKnowledgeBaseClass.prototype.logQuickReadingDiagnostic = function(message, detail = {}, level = 'info') {
    try {
      const normalizedLevel = String(level || 'info').trim().toUpperCase() || 'INFO'
      const payload = {
        message,
        source: 'MNKnowledgeBase.quickReading',
        detail,
        level: normalizedLevel,
      }
      // 快速阅读的完整状态链只在运行时诊断开关打开时输出；WARN/ERROR
      // 仍由共享策略保留，避免正常摘录路径反复序列化大段卡片状态。
      if (typeof KnowledgeBaseUtils !== 'undefined' &&
        KnowledgeBaseUtils &&
        typeof KnowledgeBaseUtils.emitRuntimeLog === 'function') {
        return KnowledgeBaseUtils.emitRuntimeLog(normalizedLevel, payload)
      }
      if (normalizedLevel !== 'WARN' && normalizedLevel !== 'ERROR') return false
      if (typeof MNLog === 'undefined' || !MNLog) return false
      const logger = typeof MNLog[normalizedLevel.toLowerCase()] === 'function'
        ? MNLog[normalizedLevel.toLowerCase()]
        : null
      if (typeof logger !== 'function') return false
      logger.call(MNLog, payload)
      return true
    } catch (_) {
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.getQuickReadingNoteDiagnostic = function(noteOrId) {
    const note = resolveAvailableNote(noteOrId)
    if (!note) {
      return {
        noteId: String(noteOrId || '').trim(),
        available: false,
      }
    }

    let parentNote = null
    let realGroupNote = null
    let parentRealGroupNote = null
    try { parentNote = note.parentNote || null } catch (_) {}
    try {
      realGroupNote = typeof note.realGroupNoteForTopicId === 'function'
        ? note.realGroupNoteForTopicId()
        : note
    } catch (_) {
      realGroupNote = note
    }
    try {
      parentRealGroupNote = parentNote && typeof parentNote.realGroupNoteForTopicId === 'function'
        ? parentNote.realGroupNoteForTopicId()
        : parentNote
    } catch (_) {
      parentRealGroupNote = parentNote
    }

    let commentCount = 0
    try { commentCount = Array.isArray(note.comments) ? note.comments.length : 0 } catch (_) {}
    return {
      available: true,
      noteId: String(note.noteId || '').trim(),
      realGroupNoteId: String(realGroupNote && realGroupNote.noteId ? realGroupNote.noteId : '').trim(),
      parentNoteId: String(parentNote && parentNote.noteId ? parentNote.noteId : '').trim(),
      parentRealGroupNoteId: String(parentRealGroupNote && parentRealGroupNote.noteId ? parentRealGroupNote.noteId : '').trim(),
      notebookId: String(note.notebookId || '').trim(),
      realGroupNotebookId: String(realGroupNote && realGroupNote.notebookId ? realGroupNote.notebookId : '').trim(),
      hasTitle: !!String(note.noteTitle || '').trim(),
      titleLength: String(note.noteTitle || '').length,
      excerptType: String(note.excerptType || ''),
      colorIndex: note.colorIndex,
      commentCount,
    }
  }

  MNKnowledgeBaseClass.prototype.getReadingFollowRecentSourceMatch = function(noteOrId, maxAgeMs = 3000) {
    const diagnostic = this.getQuickReadingNoteDiagnostic(noteOrId)
    const identityIds = [diagnostic.noteId, diagnostic.realGroupNoteId]
      .map(id => String(id || '').trim())
      .filter(id => !!id)
    const recentExcerptIds = this.readingFollowRecentExcerptIds || {}
    let match = null
    identityIds.forEach((identityId) => {
      const recentAt = Number(recentExcerptIds[identityId]) || 0
      if (!recentAt) return
      const ageMs = Date.now() - recentAt
      if (ageMs < 0 || ageMs >= maxAgeMs) return
      if (!match || ageMs < match.ageMs) {
        match = { identityId, ageMs }
      }
    })
    return { diagnostic, match }
  }

  MNKnowledgeBaseClass.prototype.getReadingFollowRecentTargetIds = function() {
    const configuredIds = Array.isArray(KnowledgeBaseConfig.config.readingFollowRecentNoteIds)
      ? KnowledgeBaseConfig.config.readingFollowRecentNoteIds
      : []
    const legacyTargetId = String(KnowledgeBaseConfig.config.readingFollowLastNoteId || '').trim()
    const result = []
    ;[legacyTargetId].concat(configuredIds).forEach((noteId) => {
      const normalizedId = String(noteId || '').trim()
      if (normalizedId && !result.includes(normalizedId)) {
        result.push(normalizedId)
      }
    })
    return result.slice(0, 3)
  }

  MNKnowledgeBaseClass.prototype.setReadingFollowRecentTargetIds = function(noteIds) {
    const normalizedIds = []
    ;(Array.isArray(noteIds) ? noteIds : []).forEach((noteId) => {
      const normalizedId = String(noteId || '').trim()
      if (normalizedId && !normalizedIds.includes(normalizedId)) {
        normalizedIds.push(normalizedId)
      }
    })
    const nextIds = normalizedIds.slice(0, 3)
    const nextTargetId = nextIds[0] || ''
    const previousTargetId = String(KnowledgeBaseConfig.config.readingFollowLastNoteId || '').trim()
    const previousIds = Array.isArray(KnowledgeBaseConfig.config.readingFollowRecentNoteIds)
      ? KnowledgeBaseConfig.config.readingFollowRecentNoteIds.map(id => String(id || '').trim()).filter(id => !!id).slice(0, 3)
      : []
    const changed = previousTargetId !== nextTargetId || JSON.stringify(previousIds) !== JSON.stringify(nextIds)
    if (changed) {
      KnowledgeBaseConfig.config.readingFollowLastNoteId = nextTargetId
      KnowledgeBaseConfig.config.readingFollowRecentNoteIds = nextIds
      KnowledgeBaseConfig.save()
    }
    return {
      changed,
      previousTargetId,
      targetId: nextTargetId,
      recentTargetIds: nextIds,
    }
  }

  MNKnowledgeBaseClass.prototype.removeReadingFollowSourceFromRecentTargets = function(sourceIdentityIds) {
    const normalizedSourceIds = (Array.isArray(sourceIdentityIds) ? sourceIdentityIds : [])
      .map(id => String(id || '').trim())
      .filter(id => !!id)
    if (normalizedSourceIds.length === 0) return []

    const removedIds = []
    const remainingIds = this.getReadingFollowRecentTargetIds().filter((candidateId) => {
      const diagnostic = this.getQuickReadingNoteDiagnostic(candidateId)
      const candidateIdentityIds = [candidateId, diagnostic.noteId, diagnostic.realGroupNoteId]
        .map(id => String(id || '').trim())
        .filter(id => !!id)
      const matchesSource = candidateIdentityIds.some(id => normalizedSourceIds.includes(id))
      if (matchesSource) removedIds.push(candidateId)
      return !matchesSource
    })
    if (removedIds.length > 0) {
      this.setReadingFollowRecentTargetIds(remainingIds)
    }
    return removedIds
  }

  MNKnowledgeBaseClass.prototype.commitReadingFollowTarget = function(noteId, reason = 'unknown') {
    const targetNoteId = String(noteId || '').trim()
    if (!targetNoteId) return false
    const recentSourceMatch = this.getReadingFollowRecentSourceMatch(targetNoteId)
    if (String(reason).startsWith('popup-') && recentSourceMatch.match) {
      this.logQuickReadingDiagnostic('target.popupIgnoredAsNewExcerpt', {
        reason,
        targetNoteId,
        recentSourceIdentityId: recentSourceMatch.match.identityId,
        recentExcerptAgeMs: recentSourceMatch.match.ageMs,
        configuredTargetId: String(KnowledgeBaseConfig.config.readingFollowLastNoteId || '').trim(),
      })
      return false
    }
    const previousTargetId = String(KnowledgeBaseConfig.config.readingFollowLastNoteId || '').trim()
    const changed = previousTargetId !== targetNoteId
    const recentTargetIds = [targetNoteId]
      .concat(this.getReadingFollowRecentTargetIds().filter(id => id !== targetNoteId))
      .slice(0, 3)
    const queueResult = this.setReadingFollowRecentTargetIds(recentTargetIds)
    if (changed || queueResult.changed) {
      this.logQuickReadingDiagnostic('target.committed', {
        reason,
        changed,
        queueChanged: queueResult.changed,
        previousTargetId,
        recentTargetIds: queueResult.recentTargetIds,
        target: this.getQuickReadingNoteDiagnostic(targetNoteId),
      })
    }
    return true
  }

  MNKnowledgeBaseClass.prototype.scheduleUntitledReadingFollowTarget = function(noteId) {
    const targetNoteId = String(noteId || '').trim()
    if (!targetNoteId) return false
    const recentSourceMatch = this.getReadingFollowRecentSourceMatch(targetNoteId)
    if (recentSourceMatch.match) {
      this.logQuickReadingDiagnostic('target.untitledIgnoredAsNewExcerpt', {
        targetNoteId,
        recentSourceIdentityId: recentSourceMatch.match.identityId,
        recentExcerptAgeMs: recentSourceMatch.match.ageMs,
      })
      return false
    }
    this.readingFollowPendingUntitledTarget = {
      noteId: targetNoteId,
      scheduledAt: Date.now(),
    }
    this.logQuickReadingDiagnostic('target.untitledScheduled', {
      target: this.getQuickReadingNoteDiagnostic(targetNoteId),
    })
    return true
  }

  MNKnowledgeBaseClass.prototype.markReadingFollowSource = function(noteId) {
    const sourceNoteId = String(noteId || '').trim()
    if (!sourceNoteId) return false
    const now = Date.now()
    const recentExcerptIds = this.readingFollowRecentExcerptIds && typeof this.readingFollowRecentExcerptIds === 'object'
      ? this.readingFollowRecentExcerptIds
      : {}
    Object.keys(recentExcerptIds).forEach((candidateId) => {
      if (now - Number(recentExcerptIds[candidateId] || 0) > 5000) {
        delete recentExcerptIds[candidateId]
      }
    })
    const sourceDiagnostic = this.getQuickReadingNoteDiagnostic(sourceNoteId)
    const sourceIdentityIds = [sourceNoteId, sourceDiagnostic.realGroupNoteId]
      .map(id => String(id || '').trim())
      .filter(id => !!id)
    sourceIdentityIds.forEach((identityId) => {
      recentExcerptIds[identityId] = now
    })
    this.readingFollowRecentExcerptIds = recentExcerptIds
    const removedRecentTargetIds = this.removeReadingFollowSourceFromRecentTargets(sourceIdentityIds)

    const pending = this.readingFollowPendingUntitledTarget
    const pendingDiagnostic = pending ? this.getQuickReadingNoteDiagnostic(pending.noteId) : null
    const pendingIdentityIds = [pending && pending.noteId, pendingDiagnostic && pendingDiagnostic.realGroupNoteId]
      .map(id => String(id || '').trim())
      .filter(id => !!id)
    const canceledPendingTarget = !!(pending && sourceIdentityIds.some(id => pendingIdentityIds.includes(id)))
    if (canceledPendingTarget) {
      this.readingFollowPendingUntitledTarget = null
    }
    this.logQuickReadingDiagnostic('source.detected', {
      source: sourceDiagnostic,
      canceledPendingTarget,
      removedRecentTargetIds,
      configuredTargetId: String(KnowledgeBaseConfig.config.readingFollowLastNoteId || '').trim(),
    })
    return true
  }

  MNKnowledgeBaseClass.prototype.isReadingFollowTargetCompatible = function(targetNote, sourceNote) {
    const targetDiagnostic = this.getQuickReadingNoteDiagnostic(targetNote)
    if (!targetDiagnostic.available) return false
    if (!sourceNote) return true
    const sourceDiagnostic = this.getQuickReadingNoteDiagnostic(sourceNote)
    const sourceNotebookId = String(sourceDiagnostic.realGroupNotebookId || sourceDiagnostic.notebookId || '').trim()
    const targetNotebookId = String(targetDiagnostic.realGroupNotebookId || targetDiagnostic.notebookId || '').trim()
    return !sourceNotebookId || !targetNotebookId || sourceNotebookId === targetNotebookId
  }

  MNKnowledgeBaseClass.prototype.getReadingFollowParentNote = function(sourceNote) {
    const pendingTargetId = String(
      this.readingFollowPendingUntitledTarget && this.readingFollowPendingUntitledTarget.noteId || '',
    ).trim()
    if (pendingTargetId) {
      const pendingTarget = resolveAvailableNote(pendingTargetId)
      if (pendingTarget && this.isReadingFollowTargetCompatible(pendingTarget, sourceNote)) {
        this.logQuickReadingDiagnostic('target.pendingUsedForFollow', {
          target: this.getQuickReadingNoteDiagnostic(pendingTarget),
        })
        return pendingTarget
      }
      this.logQuickReadingDiagnostic('target.pendingDiscarded', {
        target: this.getQuickReadingNoteDiagnostic(pendingTargetId),
        source: this.getQuickReadingNoteDiagnostic(sourceNote),
        reason: pendingTarget ? 'different-notebook' : 'unavailable',
      }, 'warn')
      this.readingFollowPendingUntitledTarget = null
    }

    const recentTargetIds = this.getReadingFollowRecentTargetIds()
    const unavailableTargetIds = []
    const incompatibleTargetIds = []
    let resolvedTarget = null
    let resolvedTargetId = ''
    recentTargetIds.forEach((candidateId) => {
      const candidate = resolveAvailableNote(candidateId)
      if (!candidate) {
        unavailableTargetIds.push(candidateId)
        return
      }
      if (!this.isReadingFollowTargetCompatible(candidate, sourceNote)) {
        incompatibleTargetIds.push(candidateId)
        return
      }
      if (!resolvedTarget) {
        resolvedTarget = candidate
        resolvedTargetId = candidateId
      }
    })
    const remainingTargetIds = recentTargetIds.filter(id => !unavailableTargetIds.includes(id))
    if (resolvedTarget) {
      const nextTargetIds = [resolvedTargetId]
        .concat(remainingTargetIds.filter(id => id !== resolvedTargetId))
        .slice(0, 3)
      const queueResult = this.setReadingFollowRecentTargetIds(nextTargetIds)
      if (queueResult.changed || unavailableTargetIds.length > 0 || incompatibleTargetIds.length > 0) {
        this.logQuickReadingDiagnostic('target.recentFallbackUsed', {
          source: this.getQuickReadingNoteDiagnostic(sourceNote),
          target: this.getQuickReadingNoteDiagnostic(resolvedTarget),
          unavailableTargetIds,
          incompatibleTargetIds,
          recentTargetIds: queueResult.recentTargetIds,
        })
      }
      return resolvedTarget
    }
    if (unavailableTargetIds.length > 0) {
      this.setReadingFollowRecentTargetIds(remainingTargetIds)
    }

    const selectedNotes = this.getSelectedNotes()
    if (selectedNotes.length > 0 && this.isReadingFollowTargetCompatible(selectedNotes[0], sourceNote)) {
      return selectedNotes[0]
    }

    return null
  }

  MNKnowledgeBaseClass.prototype.getReadingFollowMoveParent = function(targetParent) {
    if (!targetParent) return null
    try {
      if (typeof targetParent.realGroupNoteForTopicId === 'function') {
        return targetParent.realGroupNoteForTopicId() || targetParent
      }
    } catch (error) {
      this.logQuickReadingDiagnostic('target.realGroupResolveFailed', {
        target: this.getQuickReadingNoteDiagnostic(targetParent),
        error: error && error.message ? error.message : String(error),
      }, 'warn')
    }
    return targetParent
  }

  MNKnowledgeBaseClass.prototype.getReadingFollowChildContainment = function(targetParent, sourceState) {
    try {
      const childNotes = targetParent && Array.isArray(targetParent.childNotes)
        ? targetParent.childNotes
        : []
      const sourceIds = [sourceState && sourceState.noteId, sourceState && sourceState.realGroupNoteId]
        .map(id => String(id || '').trim())
        .filter(id => !!id)
      const childIds = childNotes
        .map(child => String(child && child.noteId ? child.noteId : '').trim())
        .filter(id => !!id)
      return {
        childCount: childIds.length,
        containsSource: childIds.some(id => sourceIds.includes(id)),
      }
    } catch (error) {
      return {
        childCount: -1,
        containsSource: false,
        error: error && error.message ? error.message : String(error),
      }
    }
  }

  MNKnowledgeBaseClass.prototype.processInboxAutoMoveNote = async function(note, options = {}) {
    try {
      const source = String(options.source || '').trim()
      const focusDelay = source === 'mindmap' ? 0.3 : 0.4

      if (!this.ensureInboxAutoMoveTargets()) {
        if (this.inboxAutoMoveError && !this.inboxRootMissingNotified) {
          MNUtil.showHUD(`❌ ${this.inboxAutoMoveError}，自动移动已跳过`, 1)
          this.inboxRootMissingNotified = true
        }
        if (KnowledgeBaseConfig.config.classAutoPinMode && note && note.noteId) {
          pinnerUtils.pinCard(note.noteId, { section: 'inbox' })
        }
        return note || null
      }

      const noteType = this.getReadingAutoTypeFromNote(note)

      MNUtil.undoGrouping(() => {
        this.classInputRootNote.addChild(note)
      })

      if (!this.shouldSkipReadingOCR(note, noteType)) {
        await this.applyOCRToTitleWithMode(note, this.resolveInboxAutoMoveOCRMode())
      }

      const processedNote = source === 'excerpt'
        ? (this.convertExcerptToNoExcerptIfNeeded(note) || note)
        : note
      this.syncConvertedIntermediateIndexIfNeeded(note, processedNote)

      if (KnowledgeBaseConfig.config.classAutoPinMode && processedNote && processedNote.noteId) {
        pinnerUtils.pinCard(processedNote.noteId, { section: 'inbox' })
      }

      if (processedNote && typeof processedNote.focusInMindMap === 'function') {
        processedNote.focusInMindMap(focusDelay)
      }

      return processedNote
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'processInboxAutoMoveNote')
      return note || null
    }
  }

  MNKnowledgeBaseClass.prototype.processReadingAutoClassifyNote = async function(note) {
    // Old direct callers must not restart retired date collection.
    return note || null
  }

  MNKnowledgeBaseClass.prototype.processReadingFollowNote = async function(note) {
    this.extractReadingTagTypeAndCleanup(note)

    const flowId = `${Date.now()}-${String(note && note.noteId ? note.noteId : '').slice(-8)}`
    const followStartedAt = Date.now()
    const slowThresholdMs = 1000
    let ocrDurationMs = 0
    let ocrDiagnostic = {}
    const logSlowFollowIfNeeded = (stage) => {
      const totalDurationMs = Math.max(0, Date.now() - followStartedAt)
      if (totalDurationMs < slowThresholdMs && ocrDurationMs < slowThresholdMs) return
      this.logQuickReadingDiagnostic('follow.slow', {
        flowId,
        stage: String(stage || ''),
        totalDurationMs,
        ocrDurationMs,
        ocr: ocrDiagnostic,
      }, 'warn')
    }
    const sourceBefore = this.getQuickReadingNoteDiagnostic(note)
    const targetParent = this.getReadingFollowParentNote(note)
    const pendingTargetId = String(
      this.readingFollowPendingUntitledTarget && this.readingFollowPendingUntitledTarget.noteId || '',
    ).trim()
    let targetParentForMove = this.getReadingFollowMoveParent(targetParent)
    const targetSelectedState = this.getQuickReadingNoteDiagnostic(targetParent)
    const targetMoveState = this.getQuickReadingNoteDiagnostic(targetParentForMove)
    const pendingTargetState = pendingTargetId
      ? this.getQuickReadingNoteDiagnostic(pendingTargetId)
      : null
    const sourceIds = [sourceBefore.noteId, sourceBefore.realGroupNoteId].filter(id => !!id)
    const targetIds = [targetMoveState.noteId, targetMoveState.realGroupNoteId].filter(id => !!id)
    const pendingTargetIds = [pendingTargetState && pendingTargetState.noteId, pendingTargetState && pendingTargetState.realGroupNoteId]
      .filter(id => !!id)
    const pendingTargetUsed = !!pendingTargetId && pendingTargetIds.some(id => [
      targetSelectedState.noteId,
      targetSelectedState.realGroupNoteId,
      targetMoveState.noteId,
      targetMoveState.realGroupNoteId,
    ].includes(id))
    const selfTarget = sourceIds.some(id => targetIds.includes(id))
    if (selfTarget) {
      this.logQuickReadingDiagnostic('follow.selfTargetBlocked', {
        flowId,
        source: sourceBefore,
        targetSelected: targetSelectedState,
        targetForMove: targetMoveState,
      }, 'warn')
      targetParentForMove = null
    }

    this.logQuickReadingDiagnostic('follow.start', {
      flowId,
      configuredTargetId: String(KnowledgeBaseConfig.config.readingFollowLastNoteId || '').trim(),
      source: sourceBefore,
      targetSelected: targetSelectedState,
      targetForMove: targetMoveState,
      selfTarget,
    })

    if (targetParentForMove) {
      MNUtil.undoGrouping(() => {
        targetParentForMove.addChild(note)
      })

      if (pendingTargetUsed && !selfTarget) {
        this.commitReadingFollowTarget(pendingTargetId, 'follow-pending-confirmed')
        this.readingFollowPendingUntitledTarget = null
      }

      const sourceAfterMove = this.getQuickReadingNoteDiagnostic(sourceBefore.noteId || note)
      this.logQuickReadingDiagnostic('follow.afterAddChild', {
        flowId,
        sourceBefore,
        sourceAfterMove,
        targetForMove: this.getQuickReadingNoteDiagnostic(targetParentForMove),
        containment: this.getReadingFollowChildContainment(targetParentForMove, sourceAfterMove),
      })

      let ocrSuccess = false
      if (!this.shouldSkipReadingOCR(note)) {
        const ocrStartedAt = Date.now()
        ocrSuccess = !!await this.applyQuickReadingOCRToTitle(note, {
          ocrDiagnosticTarget: ocrDiagnostic,
        })
        ocrDurationMs = Math.max(0, Date.now() - ocrStartedAt)
      }

      this.logQuickReadingDiagnostic('follow.beforeConversion', {
        flowId,
        source: this.getQuickReadingNoteDiagnostic(note),
        targetForMove: this.getQuickReadingNoteDiagnostic(targetParentForMove),
        excerptType: String(note && note.excerptType || ''),
        ocrDurationMs,
        ocr: ocrDiagnostic,
      })
      const processedNote = this.convertQuickReadingExcerptWithoutGlobalRefresh(note, targetParentForMove)
      const processedState = this.getQuickReadingNoteDiagnostic(processedNote)
      const expectedParentId = String(targetMoveState.realGroupNoteId || targetMoveState.noteId || '').trim()
      const actualParentId = String(processedState.parentRealGroupNoteId || processedState.parentNoteId || '').trim()
      this.logQuickReadingDiagnostic('follow.afterConversion', {
        flowId,
        expectedParentId,
        actualParentId,
        parentMatches: !!expectedParentId && expectedParentId === actualParentId,
        processed: processedState,
        targetForMove: this.getQuickReadingNoteDiagnostic(targetParentForMove),
        containment: this.getReadingFollowChildContainment(targetParentForMove, processedState),
        ocrDurationMs,
        ocr: ocrDiagnostic,
        totalDurationMs: Math.max(0, Date.now() - followStartedAt),
     }, expectedParentId && actualParentId && expectedParentId !== actualParentId ? 'warn' : 'info')
     this.syncConvertedIntermediateIndexIfNeeded(note, processedNote)

      // 快速阅读自动制卡：摘录颜色与目标归类卡类型匹配时自动完整制卡
      if (processedNote && targetParentForMove) {
        const autoMakeNoteType = this.getReadingTypeFromColor(processedNote)
        const autoMakeSupportedTypes = ['命题', '定义', '例子', '反例']
        if (autoMakeSupportedTypes.includes(autoMakeNoteType)) {
          if (KnowledgeBaseTemplate.isClassificationNote(targetParentForMove) &&
              !KnowledgeBaseTemplate.isReadingClassificationNote(targetParentForMove)) {
            const targetParsed = KnowledgeBaseTemplate.parseNoteTitle(targetParentForMove)
            const targetType = (targetParsed && targetParsed.type) ? String(targetParsed.type).trim() : ''
            const typeMatched = autoMakeNoteType === targetType
            this.logQuickReadingDiagnostic('follow.autoMakeCard', {
              flowId,
              noteType: autoMakeNoteType,
              targetType,
              typeMatched,
            })
            if (typeMatched) {
              try {
                KnowledgeBaseTemplate.makeCard(processedNote, false, true, {
                  noteType: autoMakeNoteType,
                })
              } catch (makeCardError) {
                this.logQuickReadingDiagnostic('follow.autoMakeCard.error', {
                  flowId,
                  noteType: autoMakeNoteType,
                  targetType,
                  error: String(makeCardError && makeCardError.message || makeCardError || ''),
                }, 'warn')
              }
            }
          }
        }
      }

     if (processedNote) {
       processedNote.focusInMindMap(0.4)
     }
     if (ocrSuccess) {
       this.refreshAfterQuickReadingOCR(processedNote || note, 'afterConversion')
     }
      logSlowFollowIfNeeded('afterConversion')
      return
    }

    let ocrSuccess = false
    if (!this.shouldSkipReadingOCR(note)) {
      const ocrStartedAt = Date.now()
      ocrSuccess = !!await this.applyQuickReadingOCRToTitle(note, {
        ocrDiagnosticTarget: ocrDiagnostic,
      })
      ocrDurationMs = Math.max(0, Date.now() - ocrStartedAt)
    }
    if (selfTarget) {
      this.logQuickReadingDiagnostic('follow.selfTargetPreservedPreviousTarget', {
        flowId,
        source: sourceBefore,
        configuredTargetId: String(KnowledgeBaseConfig.config.readingFollowLastNoteId || '').trim(),
        ocrDurationMs,
        totalDurationMs: Math.max(0, Date.now() - followStartedAt),
      }, 'warn')
      if (ocrSuccess) {
        this.refreshAfterQuickReadingOCR(note, 'selfTarget')
      }
      logSlowFollowIfNeeded('selfTarget')
      return
    }
    if (note && note.noteId) {
      this.commitReadingFollowTarget(note.noteId, 'follow-no-target')
    }
    if (ocrSuccess) {
      this.refreshAfterQuickReadingOCR(note, 'noTarget')
    }
    logSlowFollowIfNeeded('noTarget')
  }

  MNKnowledgeBaseClass.prototype.processReadingModeNote = async function(note, options = {}) {
    try {
      // 快速阅读只处理文档摘录；脑图手动输入的卡片留在用户创建的位置。
      const source = String(options.source || '').trim()
      if (source !== 'excerpt') {
        return
      }
      if (KnowledgeBaseConfig.config.readingFollowMode) {
        await this.processReadingFollowNote(note)
        return
      }
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "processReadingModeNote")
    }
  }

  MNKnowledgeBaseClass.prototype.tableItem = function (title, selector, param = "", checked = false) {
    return {
      title: title,        // 菜单项显示的文字
      object: this,        // 执行方法的对象（重要！）
      selector: selector,  // 点击后要调用的方法名
      param: param,        // 传递给方法的参数
      checked: checked     // 是否显示勾选状态
    }
  }

  MNKnowledgeBaseClass.prototype.menuSeparator = function() {
    return this.tableItem('-------------------------------', '')
  }

  MNKnowledgeBaseClass.prototype.menuGroupTitle = function(title) {
    return this.tableItem(`▸ ${title}`, '')
  }

  MNKnowledgeBaseClass.prototype.indentedTableItem = function(title, selector, param = '', checked = false) {
    return this.tableItem(`　　${title}`, selector, param, checked)
  }

  MNKnowledgeBaseClass.prototype.nestedTableItem = function(title, selector, param = '', checked = false) {
    return this.tableItem(`　　　　${title}`, selector, param, checked)
  }

  MNKnowledgeBaseClass.prototype.getAutomationModeText = function() {
    const modeNames = ['关闭', '直接 OCR', 'Markdown 格式']
    const currentMode = Number(KnowledgeBaseConfig.config.excerptOCRMode) || 0
    return modeNames[currentMode] || `未知模式(${currentMode})`
  }

  MNKnowledgeBaseClass.prototype.refreshAddonCommandStatus = function() {
    try {
      MNUtil.refreshAddonCommands()
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'refreshAddonCommandStatus')
    }
  }

  MNKnowledgeBaseClass.prototype.getSupportedExcerptOCRMode = function() {
    let currentMode = Number(KnowledgeBaseConfig.config.excerptOCRMode) || 0
    if (currentMode < 0 || currentMode > 2) {
      currentMode = 0
      KnowledgeBaseConfig.config.excerptOCRMode = 0
      KnowledgeBaseConfig.save()
      this.refreshAddonCommandStatus()
    }
    return currentMode
  }

  MNKnowledgeBaseClass.prototype.getQuickAccessMenuItems = function() {
    return [
      this.indentedTableItem('🔄 索引主知识库', 'updateSearchIndex:'),
      this.indentedTableItem('📚 索引文献归类知识库', 'updateLiteratureClassificationIndex:'),
      this.indentedTableItem('➕ 补充索引选中子脑图', 'supplementSelectedSubtreeIndex:'),
      this.menuSeparator(),
      this.indentedTableItem('🌐 可视化搜索', 'openSearchWebView:'),
      this.indentedTableItem('🧭 问题研究工作台', 'openQuestionResearchWorkbench:'),
      this.menuSeparator(),
      this.indentedTableItem('📤 导出实际搜索索引 JSON', 'exportActualSearchIndex:'),
    ]
  }

  MNKnowledgeBaseClass.prototype.getAutomationMenuItems = function(button) {
    const currentMode = this.getSupportedExcerptOCRMode()

    return [
      this.indentedTableItem('📖 快速阅读', 'readingFollowModeToggled:', undefined, !!KnowledgeBaseConfig.config.readingFollowMode),
      this.indentedTableItem('⚙️ 阅读设置', 'openReadingSettingsMenu:', button),
      this.menuSeparator(),
      this.indentedTableItem('❌ 关闭摘录 OCR', 'setExcerptOCRMode:', 0, currentMode === 0),
      this.nestedTableItem('📝 直接 OCR', 'setExcerptOCRMode:', 1, currentMode === 1),
      this.nestedTableItem('🔤 Markdown 格式', 'setExcerptOCRMode:', 2, currentMode === 2),
      this.indentedTableItem('🤖 卡片预处理', 'preProcessModeToggled:', undefined, !!KnowledgeBaseConfig.config.preProcessMode),
      this.indentedTableItem('🔤 前缀模式', 'prefixModeToggled:', undefined, !!KnowledgeBaseConfig.config.prefixMode),
      this.indentedTableItem('📥 Inbox 自动移动', 'classAutoMoveModeToggled:', undefined, !!this.classAutoMoveMode),
      this.menuSeparator(),
      this.indentedTableItem('🤖 预摘录卡片', 'preExcerptModeToggled:', undefined, !!this.preExcerptMode),
      this.indentedTableItem('📌 Inbox 自动 Pin', 'classAutoPinModeToggled:', undefined, !!KnowledgeBaseConfig.config.classAutoPinMode),
      this.indentedTableItem('🎬 演示模式', 'demoModeToggled:', undefined, !!KnowledgeBaseConfig.config.demoMode),
    ]
  }

  MNKnowledgeBaseClass.prototype.openMainMenu = function(button) {
    this.checkPopover()

    const commandTable = [
      this.menuGroupTitle('常用操作'),
      ...this.getQuickAccessMenuItems(),
      this.menuSeparator(),
      this.menuGroupTitle('自动化'),
      ...this.getAutomationMenuItems(button),
      this.menuSeparator(),
      this.menuGroupTitle('设置与维护'),
      this.indentedTableItem('🤫 OCR 过程 HUD', 'ocrProgressHUDToggled:', undefined, !!KnowledgeBaseConfig.getConfig('ocrProgressHUDEnabled')),
      this.indentedTableItem('⚙️ 模型设置', 'openModelSettingsMenu:', button),
      this.indentedTableItem('🧰 维护与调试', 'openMaintenanceMenu:', button),
    ]

    this.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 360, 0)
  }

  MNKnowledgeBaseClass.prototype.openReadingSettingsMenuInternal = function(button) {
    this.checkPopover()
    const mode = this.getSupportedExcerptOCRMode()
    const commandTable = [
      this.tableItem('🔤 Markdown 格式', 'setExcerptOCRMode:', 2, mode === 2),
      this.tableItem('📝 直接 OCR', 'setExcerptOCRMode:', 1, mode === 1),
      this.tableItem('❌ 关闭摘录 OCR', 'setExcerptOCRMode:', 0, mode === 0),
      this.menuSeparator(),
      this.tableItem('⚙️ Markdown OCR 模型', 'excerptOCRModelSettingForMode2:', button),
    ]
    this.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 360, 0)
  }

  MNKnowledgeBaseClass.prototype.getOCRTaskModelMenuText = function(task) {
    const config = KnowledgeBaseConfig.config
    const saved = key => String(config[key] || '').trim()
    const base = saved('excerptOCRModel')
    const direct = saved('excerptOCRModelForMode1') || base
    const markdown = saved('excerptOCRModelForMode2') || base
    const taskKeys = { direct: 'excerptOCRModelForMode1', markdown: 'excerptOCRModelForMode2', translate: 'excerptOCRTranslateModel', reading: 'quickReadingOCRModel' }
    if (task === 'default') return `${base || '未配置'}（默认设置）`
    const dedicated = saved(taskKeys[task])
    if (dedicated) return `${dedicated}（专用设置）`
    if (task === 'translate') return `跟随当前 OCR 任务（直接：${direct || '未配置'}；Markdown：${markdown || '未配置'}）`
    if (task === 'reading' && saved('excerptOCRTranslateModel')) return `${saved('excerptOCRTranslateModel')}（继承翻译 OCR）`
    const inherited = task === 'reading' ? direct : base
    const origin = task === 'reading' && saved('excerptOCRModelForMode1') ? '直接 OCR' : '默认 OCR'
    return `${inherited || '未配置'}（继承${origin}）`
  }

  MNKnowledgeBaseClass.prototype.openModelSettingsMenu = function(button) {
    this.checkPopover()

    const source = (KnowledgeBaseConfig.config.mnaiModelOverrideSource || '').toString().trim()
    const model = (KnowledgeBaseConfig.config.mnaiModelOverrideModel || '').toString().trim()
    const overrideEnabled = !!KnowledgeBaseConfig.config.mnaiModelOverrideEnabled
    const overrideText = overrideEnabled
      ? (source && model ? `${source}: ${model}` : (source || model || '已启用'))
      : '未启用；继承 MNAI 设置'

    const commandTable = []
    if (typeof KnowledgeBaseNetwork !== 'undefined' && KnowledgeBaseNetwork.usesResearchOCR()) {
      const activeModel = KnowledgeBaseConfig.getResearchOCRModel()
      commandTable.push(this.menuGroupTitle(`科研场景 OCR：${activeModel}（场景优先）`))
      commandTable.push(this.menuGroupTitle('以下为全局 OCR 设置'))
    }
    commandTable.push(
      this.tableItem(`⚙️ 默认 OCR 模型：${this.getOCRTaskModelMenuText('default')}`, 'excerptOCRModelSetting:', button),
      this.tableItem(`⚙️ Unicode OCR 模型：${this.getOCRTaskModelMenuText('direct')}`, 'excerptOCRModelSettingForMode1:', button),
      this.tableItem(`⚙️ Markdown OCR 模型：${this.getOCRTaskModelMenuText('markdown')}`, 'excerptOCRModelSettingForMode2:', button),
      this.tableItem(`⚙️ 翻译 OCR 模型：${this.getOCRTaskModelMenuText('translate')}`, 'excerptOCRTranslateModelSetting:', button),
      this.tableItem(`⚙️ 快速阅读 OCR 模型：${this.getOCRTaskModelMenuText('reading')}`, 'quickReadingOCRModelSetting:', button),
      this.menuSeparator(),
      this.tableItem(`⚙️ AI 模型覆盖（${overrideText}）`, 'mnaiModelOverrideToggled:', undefined, overrideEnabled),
      this.tableItem('⚙️ 选择 AI Source', 'mnaiModelSourceSetting:', button),
      this.tableItem('⚙️ 选择 AI Model', 'mnaiModelNameSetting:', button),
    )

    this.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 440, 0)
  }

  MNKnowledgeBaseClass.prototype.openMaintenanceMenu = function(button) {
    this.checkPopover()

    const commandTable = [
      this.tableItem('📝 单独索引过程知识库', 'updateIntermediateKnowledgeIndex:'),
      this.tableItem('🗂️ 索引历史卡片存档', 'updateHistoryCardIndex:'),
      this.menuSeparator(),
      this.tableItem('📤 导出主索引 JSON', 'shareIndexFile:'),
      this.tableItem('📤 导出过程索引卡点 JSON', 'exportIntermediateIndexCheckpoint:'),
      this.tableItem('📤 导出历史索引卡点 JSON', 'exportHistoryIndexCheckpoint:'),
      this.tableItem('📤 导出持久化诊断日志', 'exportPersistentDiagnosticLog:'),
      this.tableItem('📤 导出工具栏使用统计', 'exportToolbarUsage:'),
      this.tableItem('⏯ 启用或暂停工具栏使用统计', 'toggleToolbarUsage:'),
      this.menuSeparator(),
      this.tableItem('🧭 卡点定位（极简）', 'diagnoseIntermediateIndex:', button),
      this.tableItem('🧯 跳过卡点继续索引', 'skipLastIntermediateIndexCheckpointAndIndex:'),
      this.menuSeparator(),
      this.tableItem('🛡️ 循环引用防护', 'openCircularProtectionMenu:', button),
      this.tableItem('🧪 高级调试选项', 'openIntermediateIndexDebugMenu:', button),
    ]

    this.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 320, 0)
  }

  MNKnowledgeBaseClass.prototype.getSelectedNotes = function() {
    try {
      const mindmapView = MNUtil.mindmapView
      if (!mindmapView || !mindmapView.selViewLst || mindmapView.selViewLst.length === 0) {
        return []
      }
      return mindmapView.selViewLst
        .map(item => MNNote.new(item.note.note))
        .filter(note => !!note)
    } catch (error) {
      return []
    }
  }

  MNKnowledgeBaseClass.prototype.collectSupplementarySubtreeIndexNotes = async function(rootNote, options = {}) {
    const notes = []
    const visitedIds = new Set()
    const yieldEvery = Math.max(1, Number(options.yieldEvery) || 100)
    const showProgressHUD = options.showProgressHUD !== false
    let skippedTypeCount = 0
    let childReadErrorCount = 0
    let descendantResult = null

    if (rootNote) {
      const rootNoteId = KnowledgeBaseTemplate.normalizeNoteIdForCompare(rootNote.noteId)
      if (rootNoteId) {
        visitedIds.add(rootNoteId)
        if (KnowledgeBaseTemplate.isClassificationNote(rootNote) || KnowledgeBaseTemplate.isKnowledgeNote(rootNote)) {
          notes.push(rootNote)
        } else {
          skippedTypeCount += 1
        }
      }

      try {
        descendantResult = rootNote.descendantNodes
      } catch (error) {
        const errorMsg = error?.message || String(error)
        childReadErrorCount += 1
        KnowledgeBaseUtils.addErrorLog(
          new Error('descendantNodes 获取失败: ' + errorMsg),
          'collectSupplementarySubtreeIndexNotes.descendantNodes',
        )
      }
    }

    // 优先使用 descendantNodes 获取的后代列表
    // 如果 descendantNodes 不可用（如测试 mock），退回到 childNotes BFS
    let descendants
    let traversalMethod
    if (descendantResult && Array.isArray(descendantResult.descendant)) {
      descendants = descendantResult.descendant
      traversalMethod = 'descendantNodes'
    } else {
      // 退回 BFS
      descendants = []
      traversalMethod = 'childNotes-bfs-fallback'
      // 根卡片已处理，只把根卡片的直接子节点加入队列
      const queue = []
      if (rootNote) {
        try {
          const rootChildren = Array.isArray(rootNote.childNotes) ? rootNote.childNotes : []
          rootChildren.forEach(child => { if (child) queue.push(child) })
        } catch (_) {}
      }
      let cursorFallback = 0
      while (cursorFallback < queue.length) {
        const note = queue[cursorFallback]
        cursorFallback += 1
        const noteId = KnowledgeBaseTemplate.normalizeNoteIdForCompare(note && note.noteId)
        if (!noteId || visitedIds.has(noteId)) continue
        visitedIds.add(noteId)
        if (KnowledgeBaseTemplate.isClassificationNote(note) || KnowledgeBaseTemplate.isKnowledgeNote(note)) {
          notes.push(note)
        } else {
          skippedTypeCount += 1
        }
        try {
          const childNotes = note && Array.isArray(note.childNotes) ? note.childNotes : []
          childNotes.forEach(childNote => {
            if (childNote) queue.push(childNote)
          })
        } catch (error) {
          childReadErrorCount += 1
          KnowledgeBaseUtils.addErrorLog(error, 'collectSupplementarySubtreeIndexNotes.childNotes')
        }
        if (visitedIds.size % yieldEvery === 0) {
          if (showProgressHUD) {
            MNUtil.showHUD(`正在扫描选中子脑图... 已扫描 ${visitedIds.size} 张，符合 ${notes.length} 张`)
          }
          await MNUtil.delay(0.001)
        }
      }
      return {
        notes,
        visitedCount: visitedIds.size,
        skippedTypeCount,
        childReadErrorCount,
        traversalMethod,
      }
    }

    for (let i = 0; i < descendants.length; i++) {
      const note = descendants[i]
      const noteId = KnowledgeBaseTemplate.normalizeNoteIdForCompare(note && note.noteId)
      if (!noteId || visitedIds.has(noteId)) continue
      visitedIds.add(noteId)

      if (KnowledgeBaseTemplate.isClassificationNote(note) || KnowledgeBaseTemplate.isKnowledgeNote(note)) {
        notes.push(note)
      } else {
        skippedTypeCount += 1
      }

      if (visitedIds.size % yieldEvery === 0) {
        if (showProgressHUD) {
          MNUtil.showHUD(`正在扫描选中子脑图... 已扫描 ${visitedIds.size} 张，符合 ${notes.length} 张`)
        }
        await MNUtil.delay(0.001)
      }
    }

    return {
      notes,
      visitedCount: visitedIds.size,
      skippedTypeCount,
      childReadErrorCount,
      traversalMethod,
    }
  }

  MNKnowledgeBaseClass.prototype.publishSupplementarySubtreeIndexPatch = function(indexResult, options = {}) {
    if (!indexResult || indexResult.success !== true || !Array.isArray(indexResult.entries)) {
      return Promise.resolve({ success: false, error: '缺少补充索引条目' })
    }

    const patchData = {
      upserts: indexResult.entries.map(entry => ({ ...entry, indexSource: 'main' })),
      removedIds: [],
      metadata: {
        mode: indexResult.mode || options.mode || 'light',
        indexSource: 'main',
        updateTime: Math.floor(Date.now() / 1000),
        supplementaryRootId: options.rootNoteId || '',
      },
    }
    const publish = async () => {
      this.recordPersistedSearchIndexPatch(patchData)
      const controller = KnowledgeBaseUtils.webViewController
      const canPushPatch = !!(
        controller &&
        controller.webViewLoaded &&
        controller.currentHTMLType === 'search' &&
        controller.webView
      )
      if (!canPushPatch) return { success: true, source: 'persist-only' }

      let pushResult = null
      try {
        pushResult = await this.pushSearchIndexPatchToWebView(patchData, {
          refreshRequestId: `supplementary-subtree-${Date.now()}`,
        })
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'publishSupplementarySubtreeIndexPatch.push')
      }
      if (this.isWebViewPushResultSuccess(pushResult)) {
        return { success: true, source: 'patch' }
      }
      return this._loadSearchDataToWebView({
        showSuccessHUD: false,
        showErrorHUD: false,
        refreshRequestId: `supplementary-subtree-fallback-${Date.now()}`,
      })
    }

    return this.enqueueSearchDataOperation('publishSupplementarySubtreeIndexPatch', publish)
  }

  MNKnowledgeBaseClass.prototype.supplementSelectedSubtreeIndexInternal = async function() {
    const selectedNotes = this.getSelectedNotes()
    this.checkPopover()
    if (selectedNotes.length === 0) {
      MNUtil.showHUD('请先选中一张子脑图根卡片', 1.5)
      return { success: false, error: '未选中卡片' }
    }
    if (selectedNotes.length !== 1) {
      MNUtil.showHUD('补充索引一次只支持一棵子脑图，请只选中一张卡片', 2)
      return { success: false, error: '选中了多张卡片' }
    }

    const rootNote = selectedNotes[0]
    const rootNoteId = String(rootNote.noteId || '')
    const startedAt = Date.now()
    MNUtil.showHUD('开始扫描选中子脑图，请稍候...')
    await MNUtil.delay(0.1)

    const scanResult = await this.collectSupplementarySubtreeIndexNotes(rootNote)
    if (scanResult.notes.length === 0) {
      MNUtil.showHUD(`扫描完成：${scanResult.visitedCount} 张卡片中没有归类或知识点卡片`, 2)
      return {
        success: false,
        error: '没有符合条件的卡片',
        ...scanResult,
      }
    }

    const mode = KnowledgeBaseConfig.getSearchIndexMode()
    const indexResult = await KnowledgeBaseIndexer.upsertIncrementalIndexEntries(
      scanResult.notes,
      mode,
      { showErrorHUD: false },
    )
    if (!indexResult || indexResult.success !== true) {
      const errorMessage = indexResult?.error || '批量写入主知识库增量索引失败'
      MNUtil.showHUD('补充索引失败：' + errorMessage, 2)
      return {
        ...(indexResult || { success: false, error: errorMessage }),
        ...scanResult,
      }
    }

    let intermediateCleanup = null
    if (typeof IntermediateKnowledgeIndexer !== 'undefined' &&
      IntermediateKnowledgeIndexer &&
      typeof IntermediateKnowledgeIndexer.removeManyFromIncrementalIndex === 'function') {
      intermediateCleanup = IntermediateKnowledgeIndexer.removeManyFromIncrementalIndex(
        indexResult.entries.map(entry => entry.id),
      )
      if (!intermediateCleanup || intermediateCleanup.success !== true) {
        KnowledgeBaseUtils.addErrorLog(
          new Error(intermediateCleanup?.error || '批量清理过程索引失败'),
          'supplementSelectedSubtreeIndexInternal.intermediateCleanup',
        )
      }
    }

    const publishResult = await this.publishSupplementarySubtreeIndexPatch(indexResult, {
      mode,
      rootNoteId,
    })
    const failedCount = Array.isArray(indexResult.failedIds) ? indexResult.failedIds.length : 0
    const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    const failureText = failedCount > 0 ? `，失败 ${failedCount} 张` : ''
    const refreshText = publishResult && publishResult.success === false ? '；搜索面板刷新失败，请重新打开' : ''
    MNUtil.showHUD(
      `补充索引完成：扫描 ${scanResult.visitedCount} 张，写入 ${indexResult.entries.length} 张${failureText}，耗时 ${durationSeconds} 秒${refreshText}`,
      3,
    )

    return {
      success: true,
      rootNoteId,
      ...scanResult,
      ...indexResult,
      intermediateCleanup,
      publishResult,
      durationMs: Date.now() - startedAt,
    }
  }

  MNKnowledgeBaseClass.prototype.getIntermediateIndexDebugConfig = function() {
    const debug = KnowledgeBaseConfig.getIntermediateIndexDebugConfig()
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    return debug
  }

  /**
   * 【阶段四：菜单重构】
   * 循环引用防护子菜单
   */
  MNKnowledgeBaseClass.prototype.openCircularProtectionMenu = function(button) {
    this.checkPopover()
    const status = KnowledgeBaseUtils.getDescendantNodesPatchStatus()
    const patchStatusText = status.patched ? '✅ 已应用' : (status.isNative ? '⚠️ 原生状态' : '❌ 未应用')
    const scanResultCount = this.circularScanResults ? this.circularScanResults.length : 0
    const scanResultText = scanResultCount > 0 ? `⚠️ 发现 ${scanResultCount} 个` : '✅ 无结果'

    const commandTable = [
      this.tableItem('🔍 扫描循环引用', 'scanCircularReferences:'),
      this.tableItem(`📊 查看扫描结果 (${scanResultText})`, 'showCircularReferenceResults:'),
      this.menuSeparator(),
      this.tableItem(`补丁状态: ${patchStatusText}`, 'showDescendantNodesPatchStatus:'),
      this.tableItem('🔄 重新应用补丁', 'applyDescendantNodesPatch:'),
      this.tableItem('🔙 还原补丁', 'restoreDescendantNodesPatch:'),
    ]

    this.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 320, 0)
  }

  MNKnowledgeBaseClass.prototype.openIntermediateIndexDebugMenu = function(button) {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    const skipCount = Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds.length : 0
    const skipChildCount = Array.isArray(debug.skipChildNoteIds) ? debug.skipChildNoteIds.length : 0
    const slowSeconds = debug.slowThresholdMs ? (debug.slowThresholdMs / 1000) : 0
    const traceInterval = KnowledgeBaseConfig.config.intermediateIndexTraceInterval || 1
    const commandTable = [
      this.tableItem('安全遍历(childNotes)', 'setIntermediateIndexDebugOption:', 'safeTraversal', !!debug.safeTraversal),
      this.tableItem('HUD 显示 noteId', 'setIntermediateIndexDebugOption:', 'showNoteIdInHUD', !!debug.showNoteIdInHUD),
      this.tableItem('仅标题（不解析评论）', 'setIntermediateIndexDebugOption:', 'titleOnly', !!debug.titleOnly),
      this.tableItem('记录卡点阶段', 'setIntermediateIndexDebugOption:', 'checkpointStages', !!debug.checkpointStages),
      this.tableItem('跳过模板检测', 'setIntermediateIndexDebugOption:', 'skipTemplateCheck', !!debug.skipTemplateCheck),
      this.tableItem('跳过合并子脑图', 'setIntermediateIndexDebugOption:', 'skipMergedChildMap', !!debug.skipMergedChildMap),
      this.tableItem('跳过文献检测', 'setIntermediateIndexDebugOption:', 'skipLiteratureCheck', !!debug.skipLiteratureCheck),
      this.tableItem('跳过 renewLinks', 'setIntermediateIndexDebugOption:', 'skipRenewLinks', !!debug.skipRenewLinks),
      this.tableItem('跳过模板索引复用', 'setIntermediateIndexDebugOption:', 'skipTemplatedBuild', !!debug.skipTemplatedBuild),
      this.tableItem('仅用选中卡片作为根', 'setIntermediateIndexDebugOption:', 'useSelectedRoots', !!debug.useSelectedRoots),
      this.tableItem(`慢卡阈值(秒): ${slowSeconds}`, 'setIntermediateIndexSlowThreshold:'),
      this.tableItem(`跳过列表(${skipCount})`, 'setIntermediateIndexSkipList:'),
      this.tableItem('添加选中 noteId 到跳过', 'addIntermediateIndexSkipFromSelection:'),
      this.tableItem('复制跳过列表', 'showIntermediateIndexSkipList:'),
      this.tableItem('清空跳过列表', 'clearIntermediateIndexSkipList:'),
      this.tableItem(`跳过子树(${skipChildCount})`, 'setIntermediateIndexSkipChildList:'),
      this.tableItem('添加选中 noteId 到跳过子树', 'addIntermediateIndexSkipChildFromSelection:'),
      this.tableItem('清空跳过子树', 'clearIntermediateIndexSkipChildList:'),
      this.tableItem('单卡测试(选中)', 'testIntermediateIndexOnSelection:'),
      this.tableItem('复制卡点记录', 'showIntermediateIndexCheckpoint:'),
      this.tableItem(`卡点记录间隔: ${debug.checkpointInterval || 0}`, 'setIntermediateIndexCheckpointInterval:'),
      this.tableItem('-------------------------------', ''),
      this.tableItem('descendantNodes 补丁状态', 'showDescendantNodesPatchStatus:'),
      this.tableItem('强制覆盖 descendantNodes', 'applyDescendantNodesPatch:'),
      this.tableItem('还原 descendantNodes', 'restoreDescendantNodesPatch:'),
      this.tableItem('-------------------------------', ''),
      this.tableItem('Trace 日志', 'toggleIntermediateIndexTrace:', undefined, !!KnowledgeBaseConfig.config.intermediateIndexTrace),
      this.tableItem(`Trace 间隔: ${traceInterval}`, 'setIntermediateIndexTraceInterval:'),
      this.tableItem('恢复正常索引设置', 'setIntermediateIndexDebugProfile:', 'normal'),
      this.tableItem('极简调试设置', 'setIntermediateIndexDebugProfile:', 'minimal'),
    ]

    this.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 320, 0)
  }

  MNKnowledgeBaseClass.prototype.updateIntermediateKnowledgeIndexInternal = async function() {
    const self = this
    let intermediateRootIds = []
    try {
      // 关闭菜单
      if (self.popoverController) {
        self.popoverController.dismissPopoverAnimated(true);
      }

      // 【阶段一：自动化补丁系统】
      // 双重检查：确保补丁已应用
      const autoApplyPatch = KnowledgeBaseConfig.config.autoApplyCircularPatch !== false
      if (autoApplyPatch) {
        const status = KnowledgeBaseUtils.getDescendantNodesPatchStatus()
        if (!status.patched || status.isNative) {
          MNLog.warn({
            message: "检测到补丁未应用，正在自动应用",
            source: "updateIntermediateKnowledgeIndexInternal",
            detail: { status }
          })
          const result = KnowledgeBaseUtils.applyDescendantNodesPatch(true)
          if (!result.applied) {
            MNLog.error({
              message: "自动应用补丁失败，索引可能遇到循环引用问题",
              source: "updateIntermediateKnowledgeIndexInternal",
              detail: { result }
            })
          }
        }
      }

      KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== 过程知识库索引构建开始 ===");

      intermediateRootIds = this.getResearchProcessRootIds()

      KnowledgeBaseUtils.emitRuntimeLog('INFO', `配置的根卡片ID: ${intermediateRootIds.length} 个`);

      // 验证根卡片
      const rootNotes = [];
      for (const rootId of intermediateRootIds) {
        const note = resolveAvailableNote(rootId);
        if (note) {
          rootNotes.push(note);
        }
      }

      KnowledgeBaseUtils.emitRuntimeLog('INFO', `验证通过的根卡片: ${rootNotes.length} 个`);

      if (rootNotes.length === 0) {
        MNUtil.showHUD("过程知识库根卡片未配置或不存在！");
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "❌ 所有根卡片验证失败");
        return;
      }

      // 显示开始提示
      MNUtil.showHUD('开始构建过程知识库索引，请稍候...');

      // 延迟执行以确保 UI 更新
      await MNUtil.delay(0.1);

      const debug = KnowledgeBaseConfig.getIntermediateIndexDebugConfig();
      KnowledgeBaseConfig.config.intermediateIndexDebug = debug;
      KnowledgeBaseConfig.save();

      if (debug.useSelectedRoots) {
        const selectedRoots = self.getSelectedNotes();
        if (selectedRoots.length > 0) {
          rootNotes.length = 0;
          selectedRoots.forEach(note => rootNotes.push(note));
          KnowledgeBaseUtils.emitRuntimeLog('INFO', `过程知识库索引使用选中根卡片: ${rootNotes.length} 个`);
        } else {
          MNUtil.showHUD('未选中卡片，使用默认根卡片');
        }
      }

      // 异步构建索引
      const manifest = await this.buildResearchProcessIndex(rootNotes, debug);

      // 检查结果
      KnowledgeBaseUtils.emitRuntimeLog('INFO', `索引构建结果: totalCards=${manifest?.metadata?.totalCards || 0}, totalParts=${manifest?.metadata?.totalParts || 0}`);

      if (manifest && manifest.metadata && manifest.metadata.totalCards > 0) {
        MNUtil.showHUD(`过程知识库索引构建成功！共 ${manifest.metadata.totalCards} 张卡片，${manifest.metadata.totalParts} 个分片`);
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "✅ 过程知识库索引构建成功");
      } else {
        MNUtil.showHUD("没有找到可索引的卡片");
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "❌ 没有找到可索引的卡片");
      }

    } catch (error) {
      MNUtil.showHUD("更新过程知识库索引失败：" + error.message);
      MNLog.error({
        message: "更新过程知识库索引失败",
        error: error.message,
        stack: error.stack,
        detail: JSON.stringify({
          intermediateRootIds: intermediateRootIds,
          errorType: error.name || "UnknownError"
        })
      }, "MNKnowledgeBase.updateIntermediateKnowledgeIndex");
    }
  }

  MNKnowledgeBaseClass.prototype.getResearchProcessRootIds = function() {
    const configured = KnowledgeBaseConfig.config && Array.isArray(KnowledgeBaseConfig.config.researchProcessRootIds)
      ? KnowledgeBaseConfig.config.researchProcessRootIds
      : KnowledgeBaseConfig.defaultConfig.researchProcessRootIds
    return (configured || [])
      .map(rootId => String(rootId || '').trim())
      .filter(rootId => rootId.length > 0)
  }

  MNKnowledgeBaseClass.prototype.getMainKnowledgeBaseIndexRoots = function(fallbackNote = null) {
    const roots = []
    const seen = new Set()
    const addRoot = rootNoteOrId => {
      const note = resolveAvailableNote(rootNoteOrId)
      const noteId = KnowledgeBaseTemplate.normalizeNoteIdForCompare(note && note.noteId)
      if (!note || !noteId || seen.has(noteId)) return
      seen.add(noteId)
      roots.push(note)
    }

    addRoot(ROOT_NOTE_IDS.defaultKnowledgeBase)
    if (roots.length === 0) addRoot(fallbackNote)
    addRoot(ROOT_NOTE_IDS.supplementaryKnowledgeBase)
    return roots
  }

  MNKnowledgeBaseClass.prototype.shouldIndexMainKnowledgeBaseNote = function(note, context = {}) {
    const rootNote = context && context.rootNote
    const rootId = KnowledgeBaseTemplate.normalizeNoteIdForCompare(rootNote && rootNote.noteId)
    const supplementaryRootId = KnowledgeBaseTemplate.normalizeNoteIdForCompare(
      ROOT_NOTE_IDS.supplementaryKnowledgeBase,
    )
    if (rootId !== supplementaryRootId) return true
    if (context.isRoot === true) return false
    return KnowledgeBaseTemplate.isClassificationNote(note) || KnowledgeBaseTemplate.isKnowledgeNote(note)
  }

  MNKnowledgeBaseClass.prototype.getResearchProcessRootNotes = function() {
    const rootNotes = []
    const rootIds = this.getResearchProcessRootIds()
    for (const rootId of rootIds) {
      const note = resolveAvailableNote(rootId)
      if (note) rootNotes.push(note)
    }
    return rootNotes
  }

  MNKnowledgeBaseClass.prototype.getHistoryCardRootIds = function() {
    return [ROOT_NOTE_IDS.historyArchive].filter(Boolean)
  }

  MNKnowledgeBaseClass.prototype.getLiteratureClassificationRootIds = function() {
    const externalRoots = []
    try {
      let productConfig = null
      if (typeof literatureConfig !== 'undefined' && literatureConfig && typeof literatureConfig.getProductConfig === 'function') {
        productConfig = literatureConfig.getProductConfig()
      }
      const configured = productConfig?.libraryRootIds ||
        (typeof literatureUtils !== 'undefined' && literatureUtils
          ? (typeof literatureUtils.getEffectiveLibraryRootIds === 'function'
            ? literatureUtils.getEffectiveLibraryRootIds()
            : literatureUtils.libraryRootIds)
          : null)
      ;['article', 'book'].forEach(key => {
        const rootId = String(configured?.[key] || '').trim()
        if (rootId) externalRoots.push(rootId)
      })
    } catch (error) {
      KnowledgeBaseUtils.emitRuntimeLog('WARN', {
        message: '读取 MNLiterature 文献库根配置失败，回退 MNKnowledgeBase 配置',
        source: 'MNKnowledgeBase.getLiteratureClassificationRootIds',
        detail: { errorMessage: error?.message || String(error) },
      })
    }
    if (externalRoots.length > 0) return Array.from(new Set(externalRoots))
    const configured = KnowledgeBaseConfig.config && Array.isArray(KnowledgeBaseConfig.config.literatureClassificationRootIds)
      ? KnowledgeBaseConfig.config.literatureClassificationRootIds
      : KnowledgeBaseConfig.defaultConfig.literatureClassificationRootIds
    return (configured || [
      ROOT_NOTE_IDS.literaturePaperLibrary,
      ROOT_NOTE_IDS.literatureBookLibrary,
    ])
      .map(rootId => String(rootId || '').trim())
      .filter(rootId => rootId.length > 0)
  }

  MNKnowledgeBaseClass.prototype.collectLiteratureClassificationIndexRoots = function(rootNotes) {
    const stats = {
      rootCount: rootNotes.length,
      visitedCount: 0,
      literatureCount: 0,
      classificationCount: 0,
      indexRootCount: 0,
      circularCount: 0,
      skippedClassificationWithoutChildren: 0,
    }
    const literatureIds = new Set()
    const classificationIds = new Set()
    const indexRootIds = new Set()
    const indexRoots = []

    const enqueueChildren = (queue, note, path, stage) => {
      let children = []
      try {
        children = note && Array.isArray(note.childNotes) ? note.childNotes : []
      } catch (error) {
        MNLog.error({
          message: '收集文献归类子卡片失败',
          source: 'MNKnowledgeBase.collectLiteratureClassificationIndexRoots',
          detail: {
            noteId: note?.noteId || '',
            noteTitle: note?.noteTitle || note?.title || '',
            stage,
            errorMessage: error?.message || String(error),
            errorStack: error?.stack || '',
          },
        })
        return
      }

      for (const child of children) {
        const childId = child && child.noteId ? String(child.noteId) : ''
        if (!childId) continue
        if (path.includes(childId)) {
          stats.circularCount += 1
          const detail = {
            nodeId: childId,
            noteTitle: child.noteTitle || child.title || '',
            visitedPath: path.concat(childId),
            currentLevel: path.length + 1,
            source: 'MNKnowledgeBase.collectLiteratureClassificationIndexRoots',
          }
          MNLog.error({
            message: '文献归类索引扫描检测到循环引用',
            source: 'MNKnowledgeBase.collectLiteratureClassificationIndexRoots',
            detail,
          })
          KnowledgeBaseUtils.handleCircularReferenceDetected(detail)
          continue
        }
        queue.push({
          note: child,
          path: path.concat(childId),
          stage,
        })
      }
    }

    const collectClassificationChildren = (classificationNote, path) => {
      let children = []
      try {
        children = Array.isArray(classificationNote.childNotes) ? classificationNote.childNotes : []
      } catch (error) {
        MNLog.error({
          message: '读取归类卡片子卡片失败',
          source: 'MNKnowledgeBase.collectLiteratureClassificationIndexRoots',
          detail: {
            noteId: classificationNote?.noteId || '',
            noteTitle: classificationNote?.noteTitle || classificationNote?.title || '',
            errorMessage: error?.message || String(error),
            errorStack: error?.stack || '',
          },
        })
        return
      }

      if (children.length === 0) {
        stats.skippedClassificationWithoutChildren += 1
        return
      }

      for (const child of children) {
        const childId = child && child.noteId ? String(child.noteId) : ''
        if (!childId || indexRootIds.has(childId)) continue
        if (path.includes(childId)) {
          stats.circularCount += 1
          const detail = {
            nodeId: childId,
            noteTitle: child.noteTitle || child.title || '',
            visitedPath: path.concat(childId),
            currentLevel: path.length + 1,
            source: 'MNKnowledgeBase.collectLiteratureClassificationIndexRoots.classificationChildren',
          }
          MNLog.error({
            message: '归类卡片子树根检测到循环引用',
            source: 'MNKnowledgeBase.collectLiteratureClassificationIndexRoots',
            detail,
          })
          KnowledgeBaseUtils.handleCircularReferenceDetected(detail)
          continue
        }
        indexRootIds.add(childId)
        indexRoots.push(child)
      }
    }

    for (const rootNote of rootNotes) {
      if (!rootNote || !rootNote.noteId) continue
      const queue = [{
        note: rootNote,
        path: [String(rootNote.noteId)],
        stage: 'libraryRoot',
      }]
      const visitedIds = new Set()
      let queueIndex = 0

      while (queueIndex < queue.length) {
        const item = queue[queueIndex++]
        const note = item.note
        const noteId = note && note.noteId ? String(note.noteId) : ''
        if (!noteId || visitedIds.has(noteId)) continue
        visitedIds.add(noteId)
        stats.visitedCount += 1

        const isLiterature = IntermediateKnowledgeIndexer.isLiteratureNote(note)
        if (isLiterature) {
          literatureIds.add(noteId)
          const literatureQueue = []
          enqueueChildren(literatureQueue, note, item.path || [noteId], 'literatureChild')
          const literatureVisitedIds = new Set()
          let literatureIndex = 0
          while (literatureIndex < literatureQueue.length) {
            const literatureItem = literatureQueue[literatureIndex++]
            const childNote = literatureItem.note
            const childId = childNote && childNote.noteId ? String(childNote.noteId) : ''
            if (!childId || literatureVisitedIds.has(childId)) continue
            literatureVisitedIds.add(childId)

            const noteType = KnowledgeBaseTemplate.getNoteType(childNote)
            if (noteType === '归类') {
              classificationIds.add(childId)
              collectClassificationChildren(childNote, literatureItem.path || [childId])
            }

            enqueueChildren(literatureQueue, childNote, literatureItem.path || [childId], 'literatureDescendant')
          }
        } else {
          enqueueChildren(queue, note, item.path || [noteId], 'libraryDescendant')
        }

        if (stats.visitedCount % 500 === 0) {
          MNUtil.showHUD(`正在扫描文献库...\n已访问 ${stats.visitedCount} 张，找到归类 ${classificationIds.size} 张`)
        }
      }
    }

    stats.literatureCount = literatureIds.size
    stats.classificationCount = classificationIds.size
    stats.indexRootCount = indexRoots.length

    KnowledgeBaseUtils.emitRuntimeLog('INFO', {
      message: '文献归类索引根收集完成',
      source: 'MNKnowledgeBase.collectLiteratureClassificationIndexRoots',
      detail: stats,
    })

    return {
      rootNotes: indexRoots,
      stats,
    }
  }

  /**
   * 为文献阅读索引建立带语义状态的遍历计划。
   * 阅读归类 A 只作为类型边界；A 下的完整普通归类 C 则切换回常规知识库规则。
   */
  MNKnowledgeBaseClass.prototype.collectLiteratureReadingIndexPlan = function(rootNotes) {
    const stats = {
      rootCount: Array.isArray(rootNotes) ? rootNotes.length : 0,
      visitedCount: 0,
      literatureCount: 0,
      readingClassificationCount: 0,
      indexRootCount: 0,
      indexedCount: 0,
      intermediateCount: 0,
      regularClassificationCount: 0,
      skippedCount: 0,
      circularCount: 0,
      rejectedReadingTypeCount: 0,
    }
    const planById = new Map()
    const rootById = new Map()
    const literatureVisited = new Set()
    const rank = plan => plan?.mode === 'regular' ? 3 : (plan?.mode === 'reading' ? 2 : 1)
    const setPlan = (note, plan) => {
      const noteId = String(note?.noteId || '').trim()
      if (!noteId || !plan) return
      const current = planById.get(noteId)
      if (!current || rank(plan) >= rank(current)) {
        planById.set(noteId, Object.assign({ noteId }, plan))
      }
    }
    const getChildren = note => {
      try {
        return Array.isArray(note?.childNotes) ? note.childNotes : []
      } catch (error) {
        MNLog.error({
          message: '读取文献阅读索引子卡片失败',
          source: 'MNKnowledgeBase.collectLiteratureReadingIndexPlan',
          detail: { noteId: note?.noteId || '', errorMessage: error?.message || String(error) },
        })
        return []
      }
    }
    const enqueueRoot = note => {
      const noteId = String(note?.noteId || '').trim()
      if (!noteId || rootById.has(noteId)) return
      rootById.set(noteId, note)
    }
    const walkSemantic = (note, mode, inheritedType, path) => {
      const noteId = String(note?.noteId || '').trim()
      if (!noteId) return
      if (path.includes(noteId)) {
        stats.circularCount += 1
        KnowledgeBaseUtils.handleCircularReferenceDetected({
          nodeId: noteId,
          visitedPath: path.concat(noteId),
          currentLevel: path.length + 1,
          source: 'MNKnowledgeBase.collectLiteratureReadingIndexPlan',
        })
        return
      }
      const nextPath = path.concat(noteId)
      const parsedReadingTitle = KnowledgeBaseTemplate.parseReadingClassificationTitle(note)
      const readingType = KnowledgeBaseTemplate.getReadingClassificationType(note)
      const isReadingClassification = readingType && KnowledgeBaseTemplate.isReadingClassificationNote(note)
      if (parsedReadingTitle && !readingType) {
        stats.rejectedReadingTypeCount += 1
        KnowledgeBaseUtils.emitRuntimeLog('WARN', {
          message: '跳过配置外的阅读归类类型',
          source: 'MNKnowledgeBase.collectLiteratureReadingIndexPlan',
          detail: { noteId, title: note?.noteTitle || note?.title || '', type: parsedReadingTitle.type },
        })
      }
      if (isReadingClassification) {
        stats.readingClassificationCount += 1
        for (const child of getChildren(note)) {
          enqueueRoot(child)
          walkSemantic(child, 'reading', readingType, nextPath)
        }
        return
      }
      if (mode === 'outside') {
        for (const child of getChildren(note)) walkSemantic(child, 'outside', '', nextPath)
        return
      }

      const isCompleteKnowledge = KnowledgeBaseTemplate.getKnowledgePointCompletionState(note).complete
      const isCompleteClassification = KnowledgeBaseTemplate.isClassificationNote(note) &&
        KnowledgeBaseTemplate._hasClassificationTemplate(note)

      if (mode === 'reading') {
        if (isCompleteClassification) {
          stats.regularClassificationCount += 1
          stats.indexedCount += 1
          setPlan(note, { mode: 'regular', shouldIndex: true })
          for (const child of getChildren(note)) walkSemantic(child, 'regular', '', nextPath)
          return
        }
        if (isCompleteKnowledge) {
          stats.indexedCount += 1
          setPlan(note, { mode: 'reading', shouldIndex: true })
        } else if (inheritedType) {
          stats.indexedCount += 1
          stats.intermediateCount += 1
          setPlan(note, {
            mode: 'reading',
            shouldIndex: true,
            forcedType: inheritedType,
            forcedIntermediate: true,
          })
        } else {
          stats.skippedCount += 1
          setPlan(note, { mode: 'reading', shouldIndex: false })
        }
        for (const child of getChildren(note)) walkSemantic(child, 'reading', inheritedType, nextPath)
        return
      }

      if (isCompleteClassification || isCompleteKnowledge) {
        if (isCompleteClassification) stats.regularClassificationCount += 1
        stats.indexedCount += 1
        setPlan(note, { mode: 'regular', shouldIndex: true })
      } else {
        stats.skippedCount += 1
        setPlan(note, { mode: 'regular', shouldIndex: false })
      }
      for (const child of getChildren(note)) walkSemantic(child, 'regular', '', nextPath)
    }

    const libraryQueue = []
    ;(Array.isArray(rootNotes) ? rootNotes : []).forEach(root => {
      if (root?.noteId) libraryQueue.push({ note: root, path: [String(root.noteId)] })
    })
    for (let i = 0; i < libraryQueue.length; i += 1) {
      const item = libraryQueue[i]
      const note = item.note
      const noteId = String(note?.noteId || '').trim()
      if (!noteId || literatureVisited.has(noteId)) continue
      literatureVisited.add(noteId)
      stats.visitedCount += 1
      if (IntermediateKnowledgeIndexer.isLiteratureNote(note)) {
        stats.literatureCount += 1
        for (const child of getChildren(note)) walkSemantic(child, 'outside', '', item.path)
      } else {
        for (const child of getChildren(note)) {
          const childId = String(child?.noteId || '').trim()
          if (!childId || item.path.includes(childId)) {
            if (childId && item.path.includes(childId)) stats.circularCount += 1
            continue
          }
          libraryQueue.push({ note: child, path: item.path.concat(childId) })
        }
      }
    }

    const indexRoots = Array.from(rootById.values())
    stats.indexRootCount = indexRoots.length
    KnowledgeBaseUtils.emitRuntimeLog('INFO', {
      message: '文献阅读索引状态计划完成',
      source: 'MNKnowledgeBase.collectLiteratureReadingIndexPlan',
      detail: Object.assign({}, stats, { planCount: planById.size }),
    })
    return { rootNotes: indexRoots, entryPlans: planById, stats }
  }

  MNKnowledgeBaseClass.prototype.buildResearchProcessIndex = async function(rootNotes, debug = {}) {
    return await IntermediateKnowledgeIndexer.buildSearchIndex(rootNotes, {
      safeTraversal: debug.safeTraversal !== false,
      showNoteIdInHUD: !!debug.showNoteIdInHUD,
      skipRenewLinks: true,
      skipTemplatedBuild: false,
      skipLiteratureCheck: false,
      skipTemplateCheck: false,
      skipMergedChildMap: !!debug.skipMergedChildMap,
      titleOnly: false,
      skipNoteIds: Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds : [],
      skipChildNoteIds: Array.isArray(debug.skipChildNoteIds) ? debug.skipChildNoteIds : [],
      slowThresholdMs: Number(debug.slowThresholdMs) || 1000,
      checkpointInterval: Number(debug.checkpointInterval) || 0,
      checkpointStages: !!debug.checkpointStages,
      checkpointPath: MNUtil.dbFolder + '/data/intermediate-index-last.json',
      persistentCheckpointPath: MNUtil.dbFolder + '/data/intermediate-index-last.json',
      checkpointSource: 'mnknowledgebase.research-process-index',
      checkpointRootIds: rootNotes
        .map(note => note && note.noteId ? String(note.noteId) : '')
        .filter(noteId => noteId.length > 0),
      persistentCheckpointInterval: 1,
      persistentCheckpointStages: [
        'collect.beforeNoteObject',
        'collect.noteObjectMissing',
        'collect.beforeMergedChildMap',
        'collect.beforeParseMergedChildMap',
        'collect.mergedChildMapError',
        'collect.beforeChildNotes',
        'collect.childNotesError',
        'beforeLiteratureCheck',
        'beforeContentCheck',
        'beforeRenewLinks',
        'beforeTemplateCheck',
        'beforeTemplatedBuild',
        'beforeFallbackBuild',
        'completed',
        'failed',
      ],
    })
  }

  MNKnowledgeBaseClass.prototype.buildHistoryCardIndex = async function(rootNotes, debug = {}) {
    return await IntermediateKnowledgeIndexer.buildSearchIndex(rootNotes, {
      indexPrefix: 'history-card-kb-index',
      indexType: 'history-card',
      displayName: '历史卡片',
      safeTraversal: true,
      showNoteIdInHUD: !!debug.showNoteIdInHUD,
      skipRenewLinks: true,
      skipTemplatedBuild: true,
      skipLiteratureCheck: true,
      skipTemplateCheck: false,
      skipMergedChildMap: true,
      titleOnly: !!debug.historyTitleOnly,
      skipNoteIds: Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds : [],
      skipChildNoteIds: Array.isArray(debug.skipChildNoteIds) ? debug.skipChildNoteIds : [],
      slowThresholdMs: Number(debug.slowThresholdMs) || 1000,
      checkpointInterval: Number(debug.checkpointInterval) || 0,
      checkpointStages: !!debug.checkpointStages,
      checkpointPath: MNUtil.dbFolder + '/data/history-card-index-last.json',
      persistentCheckpointPath: MNUtil.dbFolder + '/data/history-card-index-last.json',
      checkpointSource: 'mnknowledgebase.history-card-index',
      checkpointRootIds: this.getHistoryCardRootIds(),
      persistentCheckpointInterval: 1,
      persistentCheckpointStages: [
        'collect.noteObjectMissing',
        'collect.beforeChildNotes',
        'collect.childNotesError',
        'beforeBuildEntry',
        'timeout.afterBuildEntry',
        'completed',
        'failed',
      ],
    })
  }

  MNKnowledgeBaseClass.prototype.buildLiteratureClassificationIndex = async function(rootNotes, debug = {}) {
    const entryPlans = debug && debug.entryPlans instanceof Map ? debug.entryPlans : new Map()
    return await IntermediateKnowledgeIndexer.buildSearchIndex(rootNotes, {
      indexPrefix: 'literature-classification-kb-index',
      indexType: 'literature-classification',
      displayName: '文献归类知识库',
      safeTraversal: true,
      showNoteIdInHUD: !!debug.showNoteIdInHUD,
      skipRenewLinks: true,
      skipTemplatedBuild: false,
      skipTemplateCheck: false,
      skipMergedChildMap: !!debug.skipMergedChildMap,
      titleOnly: false,
      skipNoteTypes: [],
      skipLiteratureCheck: true,
      progressNotification: false,
      entryPlanResolver: (note) => entryPlans.get(String(note?.noteId || '').trim()) || null,
      shouldIndexResolver: (note, context, fallback) => {
        const plan = context?.entryPlan || entryPlans.get(String(note?.noteId || '').trim())
        return plan ? plan.shouldIndex === true : false
      },
      skipNoteIds: Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds : [],
      skipChildNoteIds: Array.isArray(debug.skipChildNoteIds) ? debug.skipChildNoteIds : [],
      slowThresholdMs: Number(debug.slowThresholdMs) || 1000,
      checkpointInterval: Number(debug.checkpointInterval) || 0,
      checkpointStages: !!debug.checkpointStages,
      checkpointPath: MNUtil.dbFolder + '/data/literature-classification-index-last.json',
    })
  }

  MNKnowledgeBaseClass.prototype.updateHistoryCardIndexInternal = async function() {
    const self = this
    const rootIds = this.getHistoryCardRootIds()
    try {
      if (self.popoverController) {
        self.popoverController.dismissPopoverAnimated(true)
      }

      const rootNotes = []
      for (const rootId of rootIds) {
        const note = resolveAvailableNote(rootId)
        if (note) rootNotes.push(note)
      }

      if (rootNotes.length === 0) {
        MNUtil.showHUD('历史卡片存档根卡片不存在')
        MNLog.warn({
          message: '历史卡片索引根卡片未找到',
          source: 'MNKnowledgeBase.updateHistoryCardIndexInternal',
          detail: { rootIds },
        })
        return
      }

      MNUtil.showHUD('开始构建历史卡片索引，请稍候...')
      await MNUtil.delay(0.1)

      const debug = KnowledgeBaseConfig.getIntermediateIndexDebugConfig()
      KnowledgeBaseConfig.config.intermediateIndexDebug = debug
      KnowledgeBaseConfig.save()

      const manifest = await this.buildHistoryCardIndex(rootNotes, debug)

      if (manifest && manifest.metadata && manifest.metadata.totalCards > 0) {
        MNUtil.showHUD(`历史卡片索引构建成功！共 ${manifest.metadata.totalCards} 张卡片，${manifest.metadata.totalParts} 个分片`)
        KnowledgeBaseUtils.emitRuntimeLog('INFO', '✅ 历史卡片索引构建成功')
      } else {
        MNUtil.showHUD('没有找到可索引的历史卡片')
        KnowledgeBaseUtils.emitRuntimeLog('INFO', '❌ 没有找到可索引的历史卡片')
      }
    } catch (error) {
      MNUtil.showHUD('更新历史卡片索引失败：' + (error?.message || String(error)))
      MNLog.error({
        message: '更新历史卡片索引失败',
        source: 'MNKnowledgeBase.updateHistoryCardIndexInternal',
        detail: {
          rootIds,
          errorMessage: error?.message || String(error),
          errorStack: error?.stack || '',
        },
      })
    }
  }

  MNKnowledgeBaseClass.prototype.updateLiteratureClassificationIndexInternal = async function() {
    const self = this
    let rootIds = []
    try {
      if (self.popoverController) {
        self.popoverController.dismissPopoverAnimated(true)
      }

      rootIds = this.getLiteratureClassificationRootIds()
      const libraryRootNotes = []
      for (const rootId of rootIds) {
        const note = resolveAvailableNote(rootId)
        if (note) {
          libraryRootNotes.push(note)
        }
      }

      if (libraryRootNotes.length === 0) {
        MNUtil.showHUD('论文库/书籍库根卡片未配置或不存在')
        MNLog.warn({
          message: '文献归类索引根卡片未找到',
          source: 'MNKnowledgeBase.updateLiteratureClassificationIndexInternal',
          detail: { rootIds },
        })
        return
      }

      MNUtil.showHUD('开始扫描论文库/书籍库归类卡片...')
      await MNUtil.delay(0.1)

      const collected = this.collectLiteratureReadingIndexPlan(libraryRootNotes)
      const indexRoots = collected.rootNotes || []
      const stats = collected.stats || {}
      if (indexRoots.length === 0) {
        MNUtil.showHUD(`未找到可索引的文献归类子卡片，将清空旧索引：文献 ${stats.literatureCount || 0}，阅读归类 ${stats.readingClassificationCount || 0}`)
      }

      const debug = KnowledgeBaseConfig.getIntermediateIndexDebugConfig()
      KnowledgeBaseConfig.config.intermediateIndexDebug = debug
      KnowledgeBaseConfig.save()

      KnowledgeBaseUtils.emitRuntimeLog('INFO', {
        message: '开始构建文献归类知识库索引',
        source: 'MNKnowledgeBase.updateLiteratureClassificationIndexInternal',
        detail: {
          rootIds,
          stats,
          indexRootSample: indexRoots.slice(0, 10).map(note => ({
            noteId: note?.noteId || '',
            noteTitle: note?.noteTitle || note?.title || '',
          })),
        },
      })

      debug.entryPlans = collected.entryPlans
      const manifest = await this.buildLiteratureClassificationIndex(indexRoots, debug)

      if (manifest && manifest.metadata && manifest.metadata.totalCards > 0) {
        MNUtil.showHUD(`文献归类知识库索引构建成功！共 ${manifest.metadata.totalCards} 张卡片，${manifest.metadata.totalParts} 个分片`)
        KnowledgeBaseUtils.emitRuntimeLog('INFO', '✅ 文献归类知识库索引构建成功')
      } else {
        MNUtil.showHUD('没有找到可索引的文献归类子卡片')
        KnowledgeBaseUtils.emitRuntimeLog('INFO', '❌ 没有找到可索引的文献归类子卡片')
      }
    } catch (error) {
      MNUtil.showHUD('更新文献归类知识库索引失败：' + (error?.message || String(error)))
      MNLog.error({
        message: '更新文献归类知识库索引失败',
        source: 'MNKnowledgeBase.updateLiteratureClassificationIndexInternal',
        detail: {
          rootIds,
          errorMessage: error?.message || String(error),
          errorStack: error?.stack || '',
        },
      })
    }
  }

  MNKnowledgeBaseClass.prototype.rebuildResearchProcessIndex = async function() {
    const rootNotes = this.getResearchProcessRootNotes()
    if (rootNotes.length === 0) {
      MNLog.warn({
        message: '过程知识库根卡片未找到，跳过过程索引',
        source: 'MNKnowledgeBase.rebuildResearchProcessIndex',
        detail: { rootIds: this.getResearchProcessRootIds() },
      })
      return null
    }
    const debug = KnowledgeBaseConfig.getIntermediateIndexDebugConfig()
    return await this.buildResearchProcessIndex(rootNotes, debug)
  }

  MNKnowledgeBaseClass.prototype.diagnoseIntermediateIndex = async function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    const selectedRoots = this.getSelectedNotes()
    debug.safeTraversal = true
    debug.showNoteIdInHUD = true
    debug.skipRenewLinks = true
    debug.skipTemplatedBuild = true
    debug.skipLiteratureCheck = true
    debug.skipTemplateCheck = true
    debug.skipMergedChildMap = true
    debug.titleOnly = true
    debug.useSelectedRoots = selectedRoots.length > 0
    debug.slowThresholdMs = 3000
    debug.checkpointInterval = 1
    debug.checkpointStages = true
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.config.intermediateIndexTrace = true
    KnowledgeBaseConfig.config.intermediateIndexTraceInterval = 1
    KnowledgeBaseConfig.save()

    MNUtil.showHUD('已开启卡点定位配置，开始索引...', 1)
    await this.updateIntermediateKnowledgeIndexInternal()
  }

  MNKnowledgeBaseClass.prototype.showDescendantNodesPatchStatus = function() {
    this.checkPopover()
    const status = KnowledgeBaseUtils.getDescendantNodesPatchStatus()
    const message = `patched=${status.patched} native=${status.isNative} looksPatched=${status.looksPatched}`
    KnowledgeBaseUtils.emitRuntimeLog('INFO', `[descendantNodes] ${message}`)
    MNUtil.showHUD(message, 2)
  }

  MNKnowledgeBaseClass.prototype.applyDescendantNodesPatch = function() {
    this.checkPopover()
    const result = KnowledgeBaseUtils.applyDescendantNodesPatch(true)
    if (result.applied) {
      MNUtil.showHUD('已强制覆盖 descendantNodes', 1)
    } else {
      MNUtil.showHUD(`覆盖失败：${result.error || result.reason || '未知原因'}`, 1)
    }
  }

  MNKnowledgeBaseClass.prototype.restoreDescendantNodesPatch = function() {
    this.checkPopover()
    const result = KnowledgeBaseUtils.restoreDescendantNodesPatch()
    if (result.restored) {
      MNUtil.showHUD('已还原 descendantNodes', 1)
    } else {
      MNUtil.showHUD(`还原失败：${result.error || result.reason || '未知原因'}`, 1)
    }
  }

  /**
   * 【阶段二：主动扫描系统】
   * 扫描循环引用
   */
  MNKnowledgeBaseClass.prototype.scanCircularReferences = async function() {
    const self = this
    try {
      this.checkPopover()

      // 获取过程知识库根卡片
      const configuredRoots = KnowledgeBaseConfig.config && KnowledgeBaseConfig.config.circularScanRootIds;
      const intermediateRootIds = Array.isArray(configuredRoots) ? configuredRoots : KnowledgeBaseConfig.defaultConfig.circularScanRootIds;
      if (!intermediateRootIds.length) { MNUtil.showHUD('请先配置循环引用扫描的根目录'); return; }

      const rootNotes = []
      for (const rootId of intermediateRootIds) {
        const note = resolveAvailableNote(rootId)
        if (note) {
          rootNotes.push(note)
        }
      }

      if (rootNotes.length === 0) {
        MNUtil.showHUD("未找到根卡片，无法扫描")
        return
      }

      MNUtil.showHUD(`开始扫描循环引用...`)
      await MNUtil.delay(0.1)

      let lastProgress = 0
      const circularPaths = KnowledgeBaseUtils.scanForCircularReferences(rootNotes, (current, total) => {
        // 每处理 10% 更新一次进度
        const progress = Math.floor((current / total) * 100)
        if (progress - lastProgress >= 10) {
          MNUtil.showHUD(`扫描中... ${progress}%`)
          lastProgress = progress
        }
      })

      // 保存扫描结果
      self.circularScanResults = circularPaths

      // 显示结果
      if (circularPaths.length === 0) {
        MNUtil.showHUD("✅ 未发现循环引用", 2)
        KnowledgeBaseUtils.emitRuntimeLog('INFO', {
          message: "循环引用扫描完成，未发现问题",
          source: "scanCircularReferences",
          detail: {
            rootCount: rootNotes.length
          }
        })
      } else {
        MNUtil.showHUD(`⚠️ 发现 ${circularPaths.length} 个循环引用`, 2)
        MNLog.warn({
          message: `发现 ${circularPaths.length} 个循环引用`,
          source: "scanCircularReferences",
          detail: {
            rootCount: rootNotes.length,
            circularCount: circularPaths.length,
            paths: circularPaths.map(p => ({
              length: p.length,
              path: p.path,
              titles: p.titles
            }))
          }
        })

        // 自动显示结果
        await MNUtil.delay(0.5)
        this.showCircularReferenceResults()
      }
    } catch (error) {
      MNUtil.showHUD("扫描失败：" + error.message)
      KnowledgeBaseUtils.addErrorLog(error, "scanCircularReferences")
    }
  }

  /**
   * 【阶段三：可视化展示系统】
   * 显示循环引用扫描结果
   */
  MNKnowledgeBaseClass.prototype.showCircularReferenceResults = function() {
    const self = this
    try {
      this.checkPopover()

      if (!self.circularScanResults || self.circularScanResults.length === 0) {
        MNUtil.showHUD("没有扫描结果，请先运行扫描")
        return
      }

      const paths = self.circularScanResults

      // 构建选项列表
      const options = paths.map((p, index) => {
        const pathStr = p.titles.join(' → ')
        return `${index + 1}. [长度:${p.length}] ${pathStr}`
      })

      options.push('-------------------------------')
      options.push('📋 复制所有路径')
      options.push('🔄 重新扫描')

      MNUtil.userSelect(
        `发现 ${paths.length} 个循环引用`,
        options,
        (index) => {
          if (index === options.length - 1) {
            // 重新扫描
            self.scanCircularReferences()
          } else if (index === options.length - 2) {
            // 复制所有路径
            const allPaths = paths.map((p, i) => {
              return `${i + 1}. [长度:${p.length}]\n   路径: ${p.titles.join(' → ')}\n   ID: ${p.path.join(' → ')}`
            }).join('\n\n')
            MNUtil.copy(allPaths)
            MNUtil.showHUD("已复制所有循环路径", 1)
          } else if (index < paths.length) {
            // 显示单个循环的详细信息
            self.showCircularPathDetail(paths[index], index)
          }
        }
      )
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "showCircularReferenceResults")
    }
  }

  /**
   * 【阶段三：可视化展示系统】
   * 显示单个循环路径的详细信息
   */
  MNKnowledgeBaseClass.prototype.showCircularPathDetail = function(pathInfo, index) {
    const self = this
    try {
      const options = [
        `路径长度: ${pathInfo.length}`,
        `节点数量: ${pathInfo.path.length}`,
        '-------------------------------',
        '📍 定位到第一张卡片',
        '📋 复制路径（标题）',
        '📋 复制路径（ID）',
        '🔙 返回列表'
      ]

      MNUtil.userSelect(
        `循环引用 #${index + 1}`,
        options,
        (optIndex) => {
          if (optIndex === 3) {
            // 定位到第一个卡片
            const firstNoteId = pathInfo.path[0]
            const note = MNNote.new(firstNoteId)
            if (note) {
              MNUtil.focusNote(note)
              MNUtil.showHUD(`已定位到: ${note.noteTitle}`, 1)
            } else {
              MNUtil.showHUD("卡片不存在", 1)
            }
          } else if (optIndex === 4) {
            // 复制路径（标题）
            const pathStr = pathInfo.titles.join(' → ')
            MNUtil.copy(pathStr)
            MNUtil.showHUD("已复制路径（标题）", 1)
          } else if (optIndex === 5) {
            // 复制路径（ID）
            const pathStr = pathInfo.path.join(' → ')
            MNUtil.copy(pathStr)
            MNUtil.showHUD("已复制路径（ID）", 1)
          } else if (optIndex === 6) {
            // 返回列表
            self.showCircularReferenceResults()
          }
        }
      )
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "showCircularPathDetail")
    }
  }


  MNKnowledgeBaseClass.prototype.setIntermediateIndexDebugOption = function(key) {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    if (!key || typeof debug[key] === 'undefined') {
      MNUtil.showHUD('未知调试选项')
      return
    }
    debug[key] = !debug[key]
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`已${debug[key] ? '开启' : '关闭'}: ${key}`, 1)
  }

  MNKnowledgeBaseClass.prototype.setIntermediateIndexDebugProfile = function(profile) {
    this.checkPopover()
    const profiles = {
      normal: {
        safeTraversal: true,
        showNoteIdInHUD: false,
        skipRenewLinks: false,
        skipTemplatedBuild: false,
        skipLiteratureCheck: false,
        skipTemplateCheck: false,
        skipMergedChildMap: false,
        titleOnly: false,
        useSelectedRoots: false,
        slowThresholdMs: 1000,
        checkpointInterval: 0,
        skipNoteIds: [],
        skipChildNoteIds: [],
        checkpointStages: false,
      },
      minimal: {
        safeTraversal: true,
        showNoteIdInHUD: true,
        skipRenewLinks: true,
        skipTemplatedBuild: true,
        skipLiteratureCheck: true,
        skipTemplateCheck: true,
        skipMergedChildMap: true,
        titleOnly: true,
        useSelectedRoots: false,
        slowThresholdMs: 1000,
        checkpointInterval: 0,
        skipNoteIds: [],
        skipChildNoteIds: [],
        checkpointStages: false,
      }
    }
    const next = profiles[profile]
    if (!next) {
      MNUtil.showHUD('未知配置档')
      return
    }
    KnowledgeBaseConfig.config.intermediateIndexDebug = next
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(profile === 'normal' ? '已恢复正常索引设置' : '已启用极简调试设置', 1)
  }

  MNKnowledgeBaseClass.prototype.setIntermediateIndexSlowThreshold = async function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    const current = debug.slowThresholdMs ? (debug.slowThresholdMs / 1000) : 0
    const input = await MNUtil.input('慢卡阈值(秒，0 关闭)', String(current))
    if (!input || input.button !== 1) return
    const value = parseFloat((input.input || '').toString().trim())
    if (Number.isNaN(value) || value < 0) {
      MNUtil.showHUD('输入无效', 1)
      return
    }
    debug.slowThresholdMs = Math.round(value * 1000)
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`慢卡阈值已设置为 ${value}s`, 1)
  }

  MNKnowledgeBaseClass.prototype.setIntermediateIndexSkipList = async function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    const current = Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds.join('\n') : ''
    const input = await MNUtil.input('输入要跳过的 noteId（逗号/空格/换行分隔）', current)
    if (!input || input.button !== 1) return
    const raw = (input.input || '').toString()
    const ids = raw
      .split(/[\s,;]+/)
      .map(item => item.trim())
      .filter(item => item.length > 0)
    debug.skipNoteIds = Array.from(new Set(ids))
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`跳过列表已更新：${debug.skipNoteIds.length} 个`, 1)
  }

  MNKnowledgeBaseClass.prototype.addIntermediateIndexSkipFromSelection = function() {
    this.checkPopover()
    const selected = this.getSelectedNotes()
    if (selected.length === 0) {
      MNUtil.showHUD('未选中卡片', 1)
      return
    }
    const debug = this.getIntermediateIndexDebugConfig()
    const current = Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds : []
    const set = new Set(current)
    selected.forEach(note => {
      if (note && note.noteId) {
        set.add(note.noteId)
      }
    })
    debug.skipNoteIds = Array.from(set)
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`已添加 ${selected.length} 个 noteId`, 1)
  }

  MNKnowledgeBaseClass.prototype.clearIntermediateIndexSkipList = function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    debug.skipNoteIds = []
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD('跳过列表已清空', 1)
  }

  MNKnowledgeBaseClass.prototype.setIntermediateIndexSkipChildList = async function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    const current = Array.isArray(debug.skipChildNoteIds) ? debug.skipChildNoteIds.join('\n') : ''
    const input = await MNUtil.input('输入要跳过子树的 noteId（逗号/空格/换行分隔）', current)
    if (!input || input.button !== 1) return
    const raw = (input.input || '').toString()
    const ids = raw
      .split(/[\s,;]+/)
      .map(item => item.trim())
      .filter(item => item.length > 0)
    debug.skipChildNoteIds = Array.from(new Set(ids))
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`跳过子树列表已更新：${debug.skipChildNoteIds.length} 个`, 1)
  }

  MNKnowledgeBaseClass.prototype.addIntermediateIndexSkipChildFromSelection = function() {
    this.checkPopover()
    const selected = this.getSelectedNotes()
    if (selected.length === 0) {
      MNUtil.showHUD('未选中卡片', 1)
      return
    }
    const debug = this.getIntermediateIndexDebugConfig()
    const current = Array.isArray(debug.skipChildNoteIds) ? debug.skipChildNoteIds : []
    const set = new Set(current)
    selected.forEach(note => {
      if (note && note.noteId) {
        set.add(note.noteId)
      }
    })
    debug.skipChildNoteIds = Array.from(set)
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`已添加 ${selected.length} 个 noteId`, 1)
  }

  MNKnowledgeBaseClass.prototype.clearIntermediateIndexSkipChildList = function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    debug.skipChildNoteIds = []
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD('跳过子树列表已清空', 1)
  }

  MNKnowledgeBaseClass.prototype.showIntermediateIndexSkipList = function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    const list = Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds : []
    if (list.length === 0) {
      MNUtil.showHUD('跳过列表为空', 1)
      return
    }
    MNUtil.copy(list.join('\n'))
    MNUtil.showHUD(`已复制跳过列表（${list.length} 个）`, 1)
  }

  MNKnowledgeBaseClass.prototype.showIntermediateIndexCheckpoint = function() {
    this.checkPopover()
    const path = `${MNUtil.dbFolder}/data/intermediate-index-last.json`
    const data = MNUtil.readJSON(path)
    if (!data) {
      MNUtil.showHUD('未找到卡点记录', 1)
      return
    }
    MNUtil.copy(JSON.stringify(data))
    MNUtil.showHUD(`已复制卡点记录：${data.noteId || ''}`, 1)
  }

  MNKnowledgeBaseClass.prototype.exportIndexCheckpoint = function(options = {}) {
    const path = String(options.path || '')
    const label = String(options.label || '索引')
    const filenamePrefix = String(options.filenamePrefix || 'mnknowledgebase-index-checkpoint')
    const data = MNUtil.readJSON(path)
    if (!data || !data.noteId || !data.stage) {
      MNUtil.showHUD(`未找到有效的${label}卡点`, 1)
      return false
    }
    const exportPayload = Object.assign({}, data, {
      exportSchema: 'mnknowledgebase.index-checkpoint-export.v1',
      exportedAt: Date.now(),
      originalPath: path,
      exportNote: `${label}卡点记录，用于重启后定位卡死或超时位置`,
    })
    const date = new Date()
    const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, -5)
    let exportBasePath = MNUtil.tempPath || MNUtil.tempFolder
    if (!exportBasePath) {
      try {
        exportBasePath = NSSearchPathForDirectoriesInDomains(9, 1, true).firstObject
      } catch (_) {}
    }
    if (!exportBasePath && MNUtil.dbFolder) {
      exportBasePath = MNUtil.dbFolder + '/data'
    }
    const serialized = JSON.stringify(exportPayload, null, 2)
    MNUtil.copy(serialized)
    if (!exportBasePath) {
      MNUtil.showHUD(`无法获取导出目录，已复制${label}卡点`, 2)
      return true
    }
    const filepath = `${exportBasePath}/${filenamePrefix}-${timestamp}.json`
    const wrote = KnowledgeBaseUtils.writeTextFile(filepath, serialized)
    if (!wrote) {
      MNUtil.showHUD(`${label}卡点文件写入失败，内容已复制`, 2)
      return true
    }
    try {
      MNUtil.saveFile(filepath, 'public.json')
    } catch (_) {
      try { MNUtil.saveFile(filepath, ['public.json']) } catch (__) {}
    }
    MNUtil.showHUD(`${label}卡点 JSON 已导出：${data.noteId}`, 1)
    return true
  }

  MNKnowledgeBaseClass.prototype.exportIntermediateIndexCheckpoint = function() {
    try {
      this.checkPopover()
      return this.exportIndexCheckpoint({
        path: `${MNUtil.dbFolder}/data/intermediate-index-last.json`,
        label: '过程索引',
        filenamePrefix: 'mnknowledgebase-process-index-checkpoint',
      })
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'MNKnowledgeBase.exportIntermediateIndexCheckpoint')
      MNUtil.showHUD('导出过程索引卡点失败：' + (error?.message || String(error)), 2)
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.exportHistoryIndexCheckpoint = function() {
    try {
      this.checkPopover()
      const path = `${MNUtil.dbFolder}/data/history-card-index-last.json`
      return this.exportIndexCheckpoint({
        path,
        label: '历史索引',
        filenamePrefix: 'mnknowledgebase-history-index-checkpoint',
      })
    } catch (error) {
      MNUtil.showHUD('导出历史索引卡点失败：' + (error?.message || String(error)), 2)
      MNLog.error({
        message: '导出历史索引卡点失败',
        source: 'MNKnowledgeBase.exportHistoryIndexCheckpoint',
        detail: {
          errorMessage: error?.message || String(error),
          errorStack: error?.stack || '',
        },
      })
    }
  }

  MNKnowledgeBaseClass.prototype.showHistoryIndexCheckpoint = function() {
    return this.exportHistoryIndexCheckpoint()
  }

  MNKnowledgeBaseClass.prototype.exportPersistentDiagnosticLog = function() {
    this.checkPopover()
    return KnowledgeBaseUtils.exportPersistentDiagnosticLog()
  }

  MNKnowledgeBaseClass.prototype.skipLastIntermediateIndexCheckpointAndIndex = async function() {
    this.checkPopover()
    const path = `${MNUtil.dbFolder}/data/intermediate-index-last.json`
    const data = MNUtil.readJSON(path)
    const noteId = data && data.noteId
    if (!noteId) {
      MNUtil.showHUD('未找到卡点记录', 1)
      return
    }
    const debug = this.getIntermediateIndexDebugConfig()
    const list = Array.isArray(debug.skipNoteIds) ? debug.skipNoteIds : []
    if (!list.includes(noteId)) {
      list.push(noteId)
    }
    debug.skipNoteIds = list
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`已跳过卡点：${noteId}`, 1)
    await this.updateIntermediateKnowledgeIndexInternal()
  }

  MNKnowledgeBaseClass.prototype.setIntermediateIndexCheckpointInterval = async function() {
    this.checkPopover()
    const debug = this.getIntermediateIndexDebugConfig()
    const current = debug.checkpointInterval || 0
    const input = await MNUtil.input('卡点记录间隔（每 N 张记录一次，0 关闭）', String(current))
    if (!input || input.button !== 1) return
    const value = parseInt((input.input || '').toString().trim(), 10)
    if (!value || value < 0) {
      MNUtil.showHUD('输入无效', 1)
      return
    }
    debug.checkpointInterval = value
    KnowledgeBaseConfig.config.intermediateIndexDebug = debug
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`卡点记录间隔已设置为 ${value}`, 1)
  }

  MNKnowledgeBaseClass.prototype.testIntermediateIndexOnSelection = async function() {
    this.checkPopover()
    const selected = this.getSelectedNotes()
    if (selected.length === 0) {
      MNUtil.showHUD('未选中卡片', 1)
      return
    }
    const debug = this.getIntermediateIndexDebugConfig()
    const options = {
      skipRenewLinks: !!debug.skipRenewLinks,
      skipTemplatedBuild: !!debug.skipTemplatedBuild,
      skipTemplateCheck: !!debug.skipTemplateCheck,
      titleOnly: !!debug.titleOnly,
    }
    const note = selected[0]
    const noteId = note.noteId
    const startAt = Date.now()
    const entry = IntermediateKnowledgeIndexer.buildIndexEntry(note, 'light', options)
    const cost = Date.now() - startAt
    KnowledgeBaseUtils.emitRuntimeLog('INFO', `[过程知识库][debug] 单卡测试 noteId=${noteId} costMs=${cost} hasEntry=${!!entry}`)
    MNUtil.showHUD(`单卡测试耗时 ${cost}ms`, 1)
  }

  MNKnowledgeBaseClass.prototype.toggleIntermediateIndexTrace = function() {
    this.checkPopover()
    KnowledgeBaseConfig.config.intermediateIndexTrace = !KnowledgeBaseConfig.config.intermediateIndexTrace
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(KnowledgeBaseConfig.config.intermediateIndexTrace ? '已开启 Trace' : '已关闭 Trace', 1)
  }

  MNKnowledgeBaseClass.prototype.setIntermediateIndexTraceInterval = async function() {
    this.checkPopover()
    const current = KnowledgeBaseConfig.config.intermediateIndexTraceInterval || 1
    const input = await MNUtil.input('Trace 间隔（每 N 条记录一次）', String(current))
    if (!input || input.button !== 1) return
    const value = parseInt((input.input || '').toString().trim(), 10)
    if (!value || value < 1) {
      MNUtil.showHUD('输入无效', 1)
      return
    }
    KnowledgeBaseConfig.config.intermediateIndexTraceInterval = value
    KnowledgeBaseConfig.save()
    MNUtil.showHUD(`Trace 间隔已设置为 ${value}`, 1)
  }

  /**
   * 测试 AI 功能
   *
   * 功能流程：
   * 1. 获取用户输入的问题
   * 2. 调用 MNAI 插件进行处理
   * 3. 将结果添加到当前焦点卡片的评论中，如果没有焦点卡片则复制到剪贴板
   *
   * @requires MNAI 插件必须已安装并运行
   */
  MNKnowledgeBaseClass.prototype.testAI = async function() {
    try {
      this.checkPopover() // 关闭菜单

      // 1. 获取用户输入
      let question = await MNUtil.input("请输入问题","")

      if (!question || question.button !== 1 || !question.input || question.input.trim() === "") {
        return;
      }

      // 2. 调用 MNAI 并等待结果
      const output = await KnowledgeBaseNetwork.callMNAIWithNotification(question.input)

      // 3. 处理结果
      if (output) {
        KnowledgeBaseUtils.log("AI 结果: " + output)

        const focusNote = MNNote.getFocusNote()
        if (focusNote) {
          MNUtil.undoGrouping(() => {
            focusNote.appendMarkdownComment(output)
          })
          MNUtil.showHUD("✅ 已添加到卡片评论")
        } else {
          // 如果没有焦点卡片，复制结果到剪贴板
          MNUtil.copy(output)
          MNUtil.showHUD("✅ 已复制到剪贴板")
        }
      } else {
        MNUtil.showHUD("❌ 未获取到 AI 结果")
      }
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "testAI")
      MNUtil.showHUD("❌ 调用失败：" + error.message)
    }
  }

  /**
   * 从问题中提取关键词（简单分词 + 停用词过滤）
   * @param {string} question - 用户输入的问题
   * @returns {Array<string>} 关键词数组
   */
  MNKnowledgeBaseClass.prototype.extractKeywords = function(question) {
    // 停用词列表（中文常见停用词）
    const stopwords = new Set([
      '的', '是', '在', '了', '和', '与', '或', '有', '对', '为', '以',
      '及', '等', '中', '也', '就', '都', '而', '要', '可以', '这', '那',
      '什么', '怎么', '如何', '哪', '谁', '吗', '呢', '吧', '啊', '呀'
    ]);

    // 简单分词：按空格、标点分割
    const words = question
      .replace(/[，。！？；：、""''（）【】《》\s]+/g, ' ')
      .split(' ')
      .map(w => w.trim())
      .filter(w => w.length > 0 && !stopwords.has(w));

    return words;
  }

  /**
   * 合并两组卡片并按 noteId 去重（后出现的条目覆盖旧条目）
   * @param {Array<Object>} baseCards
   * @param {Array<Object>} extraCards
   * @returns {Array<Object>}
   */
  MNKnowledgeBaseClass.prototype.mergeCardsById = function(baseCards = [], extraCards = [], removedIds = []) {
    const removedSet = new Set((removedIds || [])
      .map(id => id === undefined || id === null ? "" : String(id).trim())
      .filter(Boolean))
    const cardMap = new Map()
    const normalizeUsageScore = (value) => {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric <= 0) return 0
      return Math.min(1000, Math.max(0, Math.round(numeric * 100) / 100))
    }
    const pushCard = (card) => {
      const id = card?.id
      if (!id) return
      const key = String(id)
      if (removedSet.has(key)) {
        cardMap.delete(key)
        return
      }
      const previous = cardMap.get(key)
      if (!previous) {
        cardMap.set(key, card)
        return
      }
      const indexSources = Array.from(new Set([
        ...(previous.indexSources || [previous.indexSource]),
        ...(card.indexSources || [card.indexSource]),
      ].filter(Boolean)))
      cardMap.set(key, {
        ...previous,
        ...card,
        ...(indexSources.length > 1 ? { indexSources } : {}),
        usageScore: Math.max(
          normalizeUsageScore(previous.usageScore),
          normalizeUsageScore(card.usageScore),
        ),
      })
    }

    if (Array.isArray(baseCards)) {
      baseCards.forEach(pushCard)
    }
    if (Array.isArray(extraCards)) {
      extraCards.forEach(pushCard)
    }

    return Array.from(cardMap.values())
  }

  MNKnowledgeBaseClass.prototype.normalizeSearchUsageScore = function(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 0
    return Math.min(1000, Math.max(0, Math.round(numeric * 100) / 100))
  }

  MNKnowledgeBaseClass.prototype.persistSearchUsageCard = function(card, indexSource = '') {
    const noteId = String(card?.id || '').trim()
    if (!noteId) return { success: false, error: '缺少卡片 ID' }

    const resolvedSource = this.resolveSearchIndexSource(noteId, indexSource)
    const sourceSpec = this.getSearchIndexSourceSpec(resolvedSource)
    const isMain = !sourceSpec || sourceSpec.source === 'main'
    const indexer = isMain ? KnowledgeBaseIndexer : IntermediateKnowledgeIndexer
    const indexPrefix = isMain ? '' : sourceSpec.indexPrefix
    let incrementalIndex = isMain
      ? indexer.loadIncrementalIndex()
      : indexer.loadIncrementalIndex(indexPrefix)

    if (!incrementalIndex || typeof incrementalIndex !== 'object') {
      incrementalIndex = {
        metadata: {
          version: isMain ? 'incremental-1.0' : 'intermediate-incremental-1.0',
        },
        cards: [],
      }
    }
    incrementalIndex.metadata = incrementalIndex.metadata || {}
    const currentCards = Array.isArray(incrementalIndex.cards) ? incrementalIndex.cards : []
    incrementalIndex.cards = currentCards
      .filter(item => String(item?.id || '').trim() !== noteId)
      .concat([{ ...card, usageScore: this.normalizeSearchUsageScore(card.usageScore) }])
    KnowledgeBaseIndexer.updateIncrementalRemovedIds(incrementalIndex, [], noteId)
    incrementalIndex.metadata.lastUpdated = new Date().toISOString()
    incrementalIndex.metadata.cardCount = incrementalIndex.cards.length

    const saved = isMain
      ? indexer.saveIncrementalIndex(incrementalIndex)
      : indexer.saveIncrementalIndex(incrementalIndex, indexPrefix)
    return saved
      ? { success: true, source: sourceSpec?.source || 'main', cardCount: incrementalIndex.cards.length }
      : { success: false, error: '保存使用权重失败' }
  }

  MNKnowledgeBaseClass.prototype.recordSearchCardUsage = function(noteId, usageTier, roundId, options = {}) {
    return this.enqueueSearchDataOperation('recordSearchCardUsage', () => {
      return this._recordSearchCardUsage(noteId, usageTier, roundId, options)
    })
  }

  MNKnowledgeBaseClass.prototype._recordSearchCardUsage = async function(noteId, usageTier, roundId, options = {}) {
    const id = String(noteId || '').trim()
    const normalizedTier = [1, 5, 10].includes(Number(usageTier)) ? Number(usageTier) : 0
    const normalizedRoundId = String(roundId || '').trim()
    if (!id || !normalizedTier || !normalizedRoundId) {
      return { success: false, credited: 0, reason: 'invalid-usage-context' }
    }

    if (!(this._searchUsageRoundLedger instanceof Map)) {
      this._searchUsageRoundLedger = new Map()
    }
    let highestTierByCard = this._searchUsageRoundLedger.get(normalizedRoundId)
    if (!(highestTierByCard instanceof Map)) {
      highestTierByCard = new Map()
      this._searchUsageRoundLedger.set(normalizedRoundId, highestTierByCard)
      while (this._searchUsageRoundLedger.size > 64) {
        const oldestRoundId = this._searchUsageRoundLedger.keys().next().value
        this._searchUsageRoundLedger.delete(oldestRoundId)
      }
    }
    const previousTier = Number(highestTierByCard.get(id) || 0)
    if (normalizedTier <= previousTier) {
      return { success: true, credited: 0, usageTier: previousTier, reason: 'already-credited' }
    }

    const cachedCards = this._webViewSearchDataCache?.fullIndexData?.cards || []
    let currentCard = cachedCards.find(card => String(card?.id || '').trim() === id)
    const resolvedSource = this.resolveSearchIndexSource(id, options.indexSource || currentCard?.indexSource || '')
    if (!currentCard) {
      const sourceSpec = this.getSearchIndexSourceSpec(resolvedSource)
      const sourceCards = sourceSpec?.source === 'main'
        ? (this.loadMainKnowledgeBaseCards()?.cards || [])
        : sourceSpec?.source === 'intermediate'
          ? this.loadIntermediateKnowledgeBaseCards()
          : sourceSpec?.source === 'literature-classification'
            ? this.loadLiteratureClassificationKnowledgeBaseCards()
            : this.loadHistoryCardKnowledgeBaseCards()
      currentCard = sourceCards.find(card => String(card?.id || '').trim() === id)
    }
    if (!currentCard) {
      return { success: false, credited: 0, reason: 'index-card-missing' }
    }

    const tierDelta = normalizedTier - previousTier
    const currentUsageScore = this.normalizeSearchUsageScore(currentCard.usageScore)
    const nextUsageScore = this.normalizeSearchUsageScore(
      currentUsageScore + tierDelta,
    )
    const credited = nextUsageScore - currentUsageScore
    if (credited <= 0) {
      highestTierByCard.set(id, normalizedTier)
      return {
        success: true,
        credited: 0,
        usageTier: normalizedTier,
        usageScore: nextUsageScore,
        indexSource: resolvedSource,
        reason: 'usage-score-capped',
      }
    }
    const updatedCard = {
      ...currentCard,
      indexSource: resolvedSource,
      usageScore: nextUsageScore,
    }
    const persistResult = this.persistSearchUsageCard(updatedCard, resolvedSource)
    if (!persistResult.success) return { ...persistResult, credited: 0 }

    highestTierByCard.set(id, normalizedTier)
    const patchData = {
      upserts: [updatedCard],
      removedIds: [],
      metadata: {
        updateTime: Math.floor(Date.now() / 1000),
        indexSource: resolvedSource,
        usageScoreUpdatedId: id,
      },
    }
    this.recordPersistedSearchIndexPatch(patchData)

    const controller = KnowledgeBaseUtils.webViewController
    if (controller?.webViewLoaded && controller.currentHTMLType === 'search' && controller.webView) {
      await this.pushSearchIndexPatchToWebView(patchData)
    }
    return {
      success: true,
      credited,
      usageTier: normalizedTier,
      usageScore: nextUsageScore,
      indexSource: resolvedSource,
    }
  }

  MNKnowledgeBaseClass.prototype.getSearchDataMutationRevision = function() {
    return Number(this._searchDataMutationRevision || 0)
  }

  MNKnowledgeBaseClass.prototype.recordPersistedSearchIndexPatch = function(patchData = {}, options = {}) {
    const revision = this.getSearchDataMutationRevision() + 1
    this._searchDataMutationRevision = revision
    this._keywordSearchCardsCache = null

    const cachedIndexData = this._webViewSearchDataCache?.fullIndexData
    if (!cachedIndexData || !Array.isArray(cachedIndexData.cards)) {
      return {
        revision,
        cacheUpdated: false,
      }
    }

    const upserts = Array.isArray(patchData.upserts) ? patchData.upserts : []
    const removedIds = Array.isArray(patchData.removedIds) ? patchData.removedIds : []
    const cards = this.mergeCardsById(cachedIndexData.cards, upserts, removedIds)
    const fullIndexData = {
      ...cachedIndexData,
      cards,
      metadata: {
        ...(cachedIndexData.metadata || {}),
        ...(patchData.metadata || {}),
        totalCards: cards.length,
      },
    }
    const cacheKey = this.buildWebViewSearchDataCacheKey()
    this._webViewSearchDataCache = {
      key: cacheKey,
      fullIndexData,
      timestamp: Date.now(),
    }

    if (options.writePersistentCache !== false) {
      this.writePersistentWebViewSearchDataCache(cacheKey, fullIndexData)
    }

    return {
      revision,
      cacheUpdated: true,
      cacheKey,
      totalCards: cards.length,
    }
  }

  MNKnowledgeBaseClass.prototype.removeSearchCardIndex = async function(noteId, options = {}) {
    const rawId = noteId === undefined || noteId === null ? '' : String(noteId).trim()
    const {
      showHUD = false,
      refreshRequestId = '',
      reason = 'unknown',
      indexSource = '',
    } = options || {}

    if (!rawId) {
      return {
        success: false,
        error: '缺少卡片 ID',
      }
    }
    const resolvedIndexSource = this.resolveSearchIndexSource(rawId, indexSource)
    const sourceSpec = this.getSearchIndexSourceSpec(resolvedIndexSource)
    const isIntermediateSource = !!(sourceSpec && sourceSpec.source !== 'main')
    const indexer = isIntermediateSource
      ? (typeof IntermediateKnowledgeIndexer !== 'undefined' ? IntermediateKnowledgeIndexer : null)
      : (typeof KnowledgeBaseIndexer !== 'undefined' ? KnowledgeBaseIndexer : null)
    if (!indexer || typeof indexer.removeFromIncrementalIndex !== 'function') {
      return {
        success: false,
        error: '索引器未就绪',
        id: rawId,
      }
    }

    const removeResult = isIntermediateSource
      ? indexer.removeFromIncrementalIndex(rawId, { indexPrefix: sourceSpec.indexPrefix })
      : indexer.removeFromIncrementalIndex(rawId)
    if (!removeResult || removeResult.success !== true) {
      return {
        success: false,
        error: removeResult?.error || '移除索引失败',
        id: rawId,
      }
    }

    const patchData = {
      upserts: [],
      removedIds: removeResult.removedIds || [rawId],
      metadata: {
        updateTime: Math.floor(Date.now() / 1000),
        removedReason: reason,
        indexSource: resolvedIndexSource,
      },
    }
    this.recordPersistedSearchIndexPatch(patchData)

    const controller = KnowledgeBaseUtils.webViewController
    const canPushPatch = !!(
      controller
      && controller.webViewLoaded
      && controller.currentHTMLType === 'search'
      && controller.webView
    )
    let source = 'persist-only'
    if (canPushPatch) {
      const pushResult = await this.pushSearchIndexPatchToWebView(patchData, {
        refreshRequestId,
      })
      source = this.isWebViewPushResultSuccess(pushResult) ? 'patch' : 'persist-only'
    }

    if (showHUD) {
      MNUtil.showHUD('已从索引移除失效卡片', 0.8)
    }

    return {
      success: true,
      id: rawId,
      removedIds: patchData.removedIds,
      removedCount: removeResult.removedCount || 0,
      cardCount: removeResult.cardCount || 0,
      source,
      reason,
    }
  }

  MNKnowledgeBaseClass.prototype.pruneUnavailableSearchCards = function(cards = [], options = {}) {
    const {
      source = 'unknown',
      maxLogItems = 10,
      validateAvailability = false,
    } = options || {}

    if (!Array.isArray(cards) || cards.length === 0) {
      return {
        cards: [],
        removedIds: [],
      }
    }

    if (validateAvailability !== true) {
      return {
        cards: cards.filter(card => card && card.id !== undefined && card.id !== null && String(card.id).trim()),
        removedIds: [],
      }
    }

    const availableCards = []
    const removedIds = []
    const seenRemovedIds = new Set()

    cards.forEach(card => {
      const id = card && card.id !== undefined && card.id !== null ? String(card.id).trim() : ''
      if (!id) {
        return
      }
      const note = resolveAvailableNote(id)
      if (note) {
        availableCards.push(card)
        return
      }
      if (!seenRemovedIds.has(id)) {
        seenRemovedIds.add(id)
        removedIds.push(id)
      }
    })

    if (removedIds.length > 0 &&
      typeof KnowledgeBaseIndexer !== 'undefined' &&
      KnowledgeBaseIndexer &&
      typeof KnowledgeBaseIndexer.removeFromIncrementalIndex === 'function') {
      removedIds.forEach(id => {
        KnowledgeBaseIndexer.removeFromIncrementalIndex(id)
      })
      KnowledgeBaseUtils.log(
        '加载索引时移除失效卡片',
        'pruneUnavailableSearchCards',
        {
          source,
          removedCount: removedIds.length,
          sampleIds: removedIds.slice(0, maxLogItems),
        },
        'WARN'
      )
    }

    return {
      cards: availableCards,
      removedIds,
    }
  }

  MNKnowledgeBaseClass.prototype.getWebViewKnownRemovedSearchIds = function(activeCards = []) {
    const removedSet = new Set()
    const activeSet = new Set()
    const appendRemovedIds = (incrementalIndex) => {
      if (!incrementalIndex ||
        typeof KnowledgeBaseIndexer === 'undefined' ||
        !KnowledgeBaseIndexer ||
        typeof KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex !== 'function') {
        return
      }
      KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex(incrementalIndex).forEach(id => {
        const key = id === undefined || id === null ? '' : String(id).trim()
        if (key) removedSet.add(key)
      })
      const cards = Array.isArray(incrementalIndex.cards) ? incrementalIndex.cards : []
      cards.forEach(card => {
        const key = card && card.id !== undefined && card.id !== null
          ? String(card.id).trim()
          : ''
        if (key) activeSet.add(key)
      })
    }

    try {
      appendRemovedIds(this.readJSONIfExists(`${MNUtil.dbFolder}/data/kb-incremental-index.json`))
      appendRemovedIds(this.readJSONIfExists(`${MNUtil.dbFolder}/data/intermediate-kb-incremental-index.json`))

      if (typeof IntermediateKnowledgeIndexer !== 'undefined' && IntermediateKnowledgeIndexer) {
        if (typeof IntermediateKnowledgeIndexer.loadIncrementalIndex === 'function') {
          appendRemovedIds(IntermediateKnowledgeIndexer.loadIncrementalIndex('literature-classification-kb-index'))
          appendRemovedIds(IntermediateKnowledgeIndexer.loadIncrementalIndex('history-card-kb-index'))
        } else {
          appendRemovedIds(this.readJSONIfExists(`${MNUtil.dbFolder}/data/literature-classification-kb-index-incremental-index.json`))
          appendRemovedIds(this.readJSONIfExists(`${MNUtil.dbFolder}/data/history-card-kb-index-incremental-index.json`))
        }
      }
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'getWebViewKnownRemovedSearchIds')
    }

    if (Array.isArray(activeCards)) {
      activeCards.forEach(card => {
        const key = card && card.id !== undefined && card.id !== null
          ? String(card.id).trim()
          : ''
        if (key) activeSet.add(key)
      })
    }

    return Array.from(removedSet).filter(id => !activeSet.has(id))
  }

  MNKnowledgeBaseClass.prototype.filterKnownRemovedSearchCards = function(cards = [], removedIds = []) {
    if (!Array.isArray(cards) || cards.length === 0) {
      return {
        cards: [],
        removedIds: [],
      }
    }

    const removedSet = new Set((removedIds || [])
      .map(id => id === undefined || id === null ? '' : String(id).trim())
      .filter(Boolean))
    if (removedSet.size === 0) {
      return {
        cards: cards.filter(card => card && card.id !== undefined && card.id !== null && String(card.id).trim()),
        removedIds: [],
      }
    }

    const filteredCards = []
    const appliedRemovedIds = []
    const seenApplied = new Set()
    cards.forEach(card => {
      const id = card && card.id !== undefined && card.id !== null ? String(card.id).trim() : ''
      if (!id) return
      if (removedSet.has(id)) {
        if (!seenApplied.has(id)) {
          seenApplied.add(id)
          appliedRemovedIds.push(id)
        }
        return
      }
      filteredCards.push(card)
    })

    return {
      cards: filteredCards,
      removedIds: appliedRemovedIds,
    }
  }

  /**
   * 加载关键词检索所需的索引数据（带缓存）
   * @returns {Array<Object>}
   */
  MNKnowledgeBaseClass.prototype.loadCardsForKeywordSearch = function() {
    const preferredMode = KnowledgeBaseConfig.config.searchIndexMode || 'light'
    const manifest = KnowledgeBaseIndexer.loadIndexManifest(preferredMode, true)
    const manifestMeta = manifest?.metadata || {}
    const manifestKey = manifest
      ? `${manifestMeta.mode || preferredMode}:${manifestMeta.updateTime || manifestMeta.lastUpdated || 0}:${manifestMeta.totalParts || (manifest.parts || []).length}`
      : 'legacy'

    const incrementalIndex = KnowledgeBaseIndexer.loadIncrementalIndex()
    const incrementalMeta = incrementalIndex?.metadata || {}
    const incrementalKey = `${incrementalMeta.lastUpdated || 0}:${incrementalMeta.cardCount || (incrementalIndex?.cards || []).length}`
    const cacheKey = `${manifestKey}|inc:${incrementalKey}`

    if (this._keywordSearchCardsCache && this._keywordSearchCardsCache.key === cacheKey) {
      return this._keywordSearchCardsCache.cards
    }

    let allCards = []

    if (manifest && Array.isArray(manifest.parts)) {
      for (const partInfo of manifest.parts) {
        const partData = KnowledgeBaseIndexer.loadIndexPart(partInfo.filename)
        if (partData && Array.isArray(partData.data)) {
          allCards = allCards.concat(partData.data)
        }
      }
    } else {
      const legacyIndex = KnowledgeBaseIndexer.loadIndex()
      if (legacyIndex) {
        if (Array.isArray(legacyIndex.searchData)) {
          allCards = legacyIndex.searchData
        } else if (Array.isArray(legacyIndex.cards)) {
          allCards = legacyIndex.cards
        }
      }
    }

    allCards = this.mergeCardsById(
      allCards,
      incrementalIndex?.cards || [],
      KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex(incrementalIndex)
    )
    const pruned = this.pruneUnavailableSearchCards(allCards, {
      source: 'loadCardsForKeywordSearch',
    })
    allCards = pruned.cards
    this._keywordSearchCardsCache = {
      key: cacheKey,
      cards: allCards,
      updatedAt: Date.now(),
    }

    return allCards
  }

  /**
   * 根据关键词搜索候选卡片（基于标题匹配）
   * 使用渐进式搜索：优先返回全部匹配的卡片，如果结果不足则降级搜索
   * @param {Array<string>} keywords - 关键词数组
   * @returns {Promise<Array>} 候选卡片数组，包含 {id, title, type, score}
   */
  MNKnowledgeBaseClass.prototype.searchCardsByKeywords = async function(keywords) {
    try {
      const normalizedKeywords = Array.isArray(keywords)
        ? keywords.map(keyword => (keyword || '').toString().trim().toLowerCase()).filter(Boolean)
        : []

      if (normalizedKeywords.length === 0) {
        return []
      }

      const allCards = this.loadCardsForKeywordSearch()

      if (allCards.length === 0) {
        return [];
      }

      // 渐进式搜索：逐步降低匹配要求直到找到足够的结果
      const minResultCount = 5;  // 每轮至少需要 5 张卡片
      const maxResultCount = 20; // 最多返回 20 张卡片

      // 定义搜索轮次（从严格到宽松）
      const searchRounds = [
        { name: "全部匹配", minMatch: normalizedKeywords.length },
        { name: "2/3 匹配", minMatch: Math.ceil(normalizedKeywords.length * 2 / 3) },
        { name: "1/2 匹配", minMatch: Math.ceil(normalizedKeywords.length * 1 / 2) },
        { name: "任意匹配", minMatch: 1 }
      ];

      // 按关键词匹配并评分
      const allResults = [];
      for (const card of allCards) {
        const title = (card.title || "").toLowerCase();
        let matchCount = 0;

        // 计算匹配的关键词数量
        for (const keyword of normalizedKeywords) {
          if (title.includes(keyword)) {
            matchCount++;
          }
        }

        // 至少匹配一个关键词才加入候选
        if (matchCount > 0) {
          allResults.push({
            id: card.id,
            title: card.title,
            type: card.type,
            matchCount: matchCount,
            score: matchCount * 10 + (card.score || 0)  // 匹配数量 × 10 + 原始评分
          });
        }
      }

      // 按评分排序（评分越高越相关）
      allResults.sort((a, b) => b.score - a.score);

      // 渐进式搜索：从严格到宽松
      for (const round of searchRounds) {
        // 过滤符合当前轮次要求的卡片
        const roundResults = allResults.filter(card => card.matchCount >= round.minMatch);

        if (roundResults.length >= minResultCount) {
          // 找到足够的结果，返回 top 20
          const finalResults = roundResults.slice(0, maxResultCount);
          KnowledgeBaseUtils.log(
            `搜索成功（${round.name}）：找到 ${roundResults.length} 张卡片，返回前 ${finalResults.length} 张`,
            "searchCardsByKeywords"
          );
          return finalResults;
        }
      }

      // 如果所有轮次都没有找到足够的结果，返回所有匹配的卡片
      const finalResults = allResults.slice(0, maxResultCount);
      KnowledgeBaseUtils.log(
        `搜索完成：共找到 ${allResults.length} 张卡片，返回前 ${finalResults.length} 张`,
        "searchCardsByKeywords"
      );
      return finalResults;

    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "searchCardsByKeywords");
      return [];
    }
  }

  /**
   * 构建 AI 提示词（包含原始问题和卡片标题）
   * @param {string} question - 用户的原始问题
   * @param {Array} candidateCards - 候选卡片数组
   * @returns {string} AI 提示词
   */
  MNKnowledgeBaseClass.prototype.buildAIPromptForCardRecommendation = function(question, candidateCards) {
    let prompt = "# 任务\n";
    prompt += "请分析以下候选卡片，找出与用户问题最相关的卡片。\n\n";

    prompt += "# 用户的原始问题\n";
    prompt += `"${question}"\n\n`;

    prompt += "# 候选卡片列表\n";
    candidateCards.forEach((card, index) => {
      prompt += `${index + 1}. [ID: ${card.id}] ${card.title}`;
      if (card.type) {
        prompt += ` (类型: ${card.type})`;
      }
      prompt += "\n";
    });

    prompt += "\n# 输出要求\n";
    prompt += "请返回最相关的 5-8 张卡片的 ID，用逗号分隔。\n";
    prompt += "分析时请重点关注卡片标题与原始问题的**语义相关性**，而不仅仅是关键词匹配。\n";
    prompt += "格式示例：card-1001, card-1005, card-1012\n\n";
    prompt += "推荐的卡片 ID：";

    return prompt;
  }

  /**
   * 从 AI 响应中解析卡片 ID 列表
   * @param {string} response - AI 响应文本
   * @returns {Array<string>} 卡片 ID 数组
   */
		  MNKnowledgeBaseClass.prototype.parseCardIdsFromAIResponse = function(response) {
		    try {
		      const text = (response || '').toString();
		      const trimmed = text.trim();
		      if (!trimmed) return [];

		      const results = [];
		      const seen = new Set();

		      const pushId = (value) => {
		        if (value === null || typeof value === 'undefined') return;
		        let token = (value || '').toString().trim();
		        if (!token) return;

		        token = token.replace(/^\d+[.)]\s*/, '');
		        token = token.replace(/^[-*•]\s*/, '');
		        token = token.replace(/^[`"'(\[{<]+/, '');
		        token = token.replace(/[`"'\])}>.,，;；:：]+$/, '');
		        token = token.trim();
		        if (!token) return;

		        // 允许返回 marginnote URL，后续 normalizeNoteId 会提取
		        if (seen.has(token)) return;
		        seen.add(token);
		        results.push(token);
		      };

		      const harvestFromParsed = (parsed) => {
		        if (!parsed) return;
		        if (Array.isArray(parsed)) {
		          parsed.forEach((item) => {
		            if (!item) return;
		            if (typeof item === 'string' || typeof item === 'number') {
		              pushId(item);
		              return;
		            }
		            if (typeof item === 'object') {
		              if (item.id) pushId(item.id);
		              if (item.noteId) pushId(item.noteId);
		              if (item.url) pushId(item.url);
		            }
		          });
		          return;
		        }
		        if (typeof parsed === 'object') {
		          const keys = ['cardIds', 'ids', 'idList', 'recommendations'];
		          keys.forEach((key) => {
		            if (!parsed[key]) return;
		            const value = parsed[key];
		            if (Array.isArray(value)) {
		              value.forEach((item) => pushId((item && item.id) ? item.id : item));
		            } else {
		              pushId(value);
		            }
		          });
		        }
		      };

		      const tryParseJson = (candidate) => {
		        if (!candidate) return null;
		        try {
		          return JSON.parse(candidate);
		        } catch (e) {
		          return null;
		        }
		      };

		      // 1) JSON 直出
		      harvestFromParsed(tryParseJson(trimmed));

		      // 2) 代码块中的 JSON
		      if (!results.length) {
		        const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
		        if (fenceMatch && fenceMatch[1]) {
		          harvestFromParsed(tryParseJson(fenceMatch[1].trim()));
		        }
		      }

		      // 3) 文本中内嵌的 JSON 数组
		      if (!results.length) {
		        const arrayMatch = trimmed.match(/(\[[\s\S]*?\])/);
		        if (arrayMatch && arrayMatch[1]) {
		          harvestFromParsed(tryParseJson(arrayMatch[1].trim()));
		        }
		      }

		      // 4) 直接用正则提取 URL / UUID / 32位 HEX
		      const urlPattern = /marginnote4app:\/\/note\/([a-z0-9-]+)/ig;
		      let m = null;
		      while ((m = urlPattern.exec(text)) !== null) {
		        if (m[0]) pushId(m[0]);
		      }

		      const uuidPattern = /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/ig;
		      const uuidMatches = text.match(uuidPattern);
		      if (uuidMatches && uuidMatches.length) {
		        uuidMatches.forEach((id) => pushId(id));
		      }

		      const hex32Pattern = /\b[a-f0-9]{32}\b/ig;
		      const hex32Matches = text.match(hex32Pattern);
		      if (hex32Matches && hex32Matches.length) {
		        hex32Matches.forEach((id) => pushId(id));
		      }

		      // 5) 最后兜底：按分隔符切分（会被后续 candidateIdSet 过滤）
		      if (!results.length) {
		        const parts = trimmed
		          .split(/[\s,，;；\n\r\t]+/)
		          .map(s => s.trim())
		          .filter(Boolean);
		        parts.forEach((part) => pushId(part));
		      }

		      return results.slice(0, 20);

	    } catch (error) {
	      KnowledgeBaseUtils.addErrorLog(error, "parseCardIdsFromAIResponse");
	      return [];
		    }
		  }

	  /**
	   * 归一化 noteId：兼容 marginnote URL / uuid
	   * @param {string} raw
	   * @returns {string|null}
	   */
		  MNKnowledgeBaseClass.prototype.normalizeNoteId = function(raw) {
		    if (!raw || typeof raw !== 'string') return null;
		    const trimmed = raw.trim();
		    if (!trimmed) return null;
	
	    // Prefer built-in helpers if available
	    try {
	      if (typeof trimmed.isValidNoteURL === 'function' && typeof trimmed.toNoteId === 'function') {
	        if (trimmed.isValidNoteURL()) {
	          return trimmed.toNoteId();
	        }
	      }
	    } catch (e) {
	      // ignore
	    }
	
	    // Fallback: extract uuid from marginnote URL
	    const m = trimmed.match(/\/note\/([^?#]+)/i);
		    if (m && m[1]) return m[1];
		    return trimmed;
		  }

		  /**
		   * 将一段文本粗分词为可用于搜索的关键词（偏中文场景，无第三方分词库）
		   * 目标：避免把整句当作一个检索项导致几乎无法命中
		   * @param {string} text
		   * @param {Object} options
		   * @param {number} options.maxTokens
		   * @returns {string[]}
		   */
		  MNKnowledgeBaseClass.prototype.extractSearchTokensFromText = function(text, options = {}) {
		    try {
		      const maxTokens = typeof options.maxTokens === 'number' ? options.maxTokens : 8;
		      const debugSource = options.debugSource || '';
		      const raw = (text || '').toString().trim();
		      if (!raw) return [];

		      const escapeRegExp = (s) => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		      let normalized = raw;
		      normalized = normalized.replace(/marginnote4app:\/\/note\/[^\s]+/ig, ' ');
		      normalized = normalized.replace(/https?:\/\/[^\s]+/ig, ' ');
		      normalized = normalized.replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, ' ');
		      normalized = normalized.replace(/[，,。.;；、|｜/\\:：!?！？·•\n\r\t]+/g, ' ');
		      normalized = normalized.replace(/[()（）【】\[\]{}<>《》“”‘’"'`]/g, ' ');

		      // 连接词/虚词：用空格打断（用于把整句拆开）
		      const connectorWords = [
		        '的', '是', '为', '与', '和', '及', '以及', '或', '或者',
		        '在', '对', '对于', '关于', '通过', '利用', '将', '把', '从',
		        '而', '且', '并', '则', '若', '如果', '当', '如何', '什么', '为什么',
		        '哪些', '这种', '这些', '那些', '是否',
		        '一个', '两个', '三个', '四个', '五个', '几个', '某个', '任意', '任一',
		        '相关', '有关',
		        '上的', '中的', '下的', '内的', '外的', '之间的',
		        '设', '令', '假设', '假定', '取',
		      ];
		      connectorWords.forEach((w) => {
		        normalized = normalized.replace(new RegExp(escapeRegExp(w), 'g'), ' ');
		      });

		      // 经验性“词缀词”：用于把复合中文概念拆出更可检索的子词（不破坏原词本身）
		      const cjkAffixWords = [
		        '赋范空间', '内积空间', '度量空间', '拓扑空间',
		        '子空间', '商空间',
		        '算子', '泛函', '矩阵', '张量',
		        '空间', '集合', '函数', '映射', '关系',
		        '性质', '定义', '判定', '判断', '条件',
		        '定理', '引理', '推论', '证明',
		        '序列', '数列',
		        '范数', '测度', '概率', '分布',
		        '代数', '结构', '模型', '算法', '方法',
		        '方程', '系统', '网络', '学习', '训练', '推断', '优化',
		      ];

		      const expandCJKToken = (token) => {
		        const out = [];
		        const t = (token || '').toString().trim();
		        if (!t) return out;
		        out.push(t);

		        // 1) 末尾词缀：X空间 -> X空间 + X + 空间
		        for (const w of cjkAffixWords) {
		          if (t.length <= w.length) continue;
		          if (!t.endsWith(w)) continue;
		          const prefix = t.slice(0, t.length - w.length);
		          if (prefix && prefix.length >= 2) out.push(prefix);
		          out.push(w);
		          break;
		        }

		        // 2) 中间出现的词缀：紧空间连续映射 -> 紧空间 + 连续映射 + 空间
		        if (t.length >= 6) {
		          for (const w of cjkAffixWords) {
		            const idx = t.indexOf(w);
		            if (idx <= 0) continue;
		            if (idx >= t.length - w.length) continue;
		            const left = t.slice(0, idx + w.length);
		            const right = t.slice(idx + w.length);
		            if (left && left.length >= 2 && left !== t) out.push(left);
		            if (right && right.length >= 2) out.push(right);
		            out.push(w);
		            break;
		          }
		        }

		        return out;
		      };

		      normalized = normalized.replace(/\s+/g, ' ').trim();
		      if (!normalized) return [];

		      const stopTokens = new Set([
		        '的', '是', '为', '与', '和', '及', '以及', '或', '或者',
		        '在', '对', '对于', '关于', '通过', '利用', '将', '把', '从',
		        '而', '且', '并', '则', '若', '如果', '当', '如何', '什么', '为什么',
		        '哪些', '这种', '这些', '那些', '是否',
		        '一个', '两个', '三个', '四个', '五个', '几个', '某个', '任意', '任一',
		        '相关', '有关',
		        '命题', '定理', '引理', '推论', '证明', '归类', '定义', '例子', '练习', '习题', '总结',
		      ]);

		      const allowedSingleCharCJK = new Set([
		        '核', '谱', '基', '环', '域', '模', '群', '范',
		      ]);

		      const candidates = [];
		      normalized.split(' ').forEach((seg) => {
		        const s = (seg || '').trim();
		        if (!s) return;

		        // 英文/数字词
		        const alnums = s.match(/[a-zA-Z][a-zA-Z0-9_.-]*/g) || [];
		        alnums.forEach((t) => candidates.push(t));

		        // 中文词块
		        const cjkParts = s.replace(/[a-zA-Z0-9_.-]+/g, ' ')
		          .match(/[\u4e00-\u9fff]{1,}/g) || [];
		        cjkParts.forEach((t) => {
		          const expanded = expandCJKToken(t);
		          expanded.forEach((item) => candidates.push(item));
		        });
		      });

		      const scored = [];
		      const seen = new Set();
		      candidates.forEach((t, idx) => {
		        const token = (t || '').toString().trim();
		        if (!token) return;
		        if (stopTokens.has(token)) return;
		        if (token.length <= 1) {
		          const hasCJK = /[\u4e00-\u9fff]/.test(token);
		          if (!(hasCJK && allowedSingleCharCJK.has(token))) return;
		        }
		        if (token.length > 14) return;
		        if (/^(\d+|\s+)$/.test(token)) return;
		        if (seen.has(token)) return;
		        seen.add(token);
		        const hasCJK = /[\u4e00-\u9fff]/.test(token);
		        const score = Math.min(12, token.length) + (hasCJK ? 1 : 0) - idx * 0.001;
		        scored.push({ token, score });
		      });

		      scored.sort((a, b) => b.score - a.score);
		      const finalTokens = scored.map((s) => s.token).slice(0, maxTokens);

		      if (debugSource) {
		        KnowledgeBaseUtils.log('分词结果', debugSource, {
		          input: raw.slice(0, 180),
		          tokenCount: finalTokens.length,
		          tokens: finalTokens,
		        });
		      }

		      return finalTokens;
		    } catch (error) {
		      KnowledgeBaseUtils.addErrorLog(error, 'extractSearchTokensFromText');
		      return [];
		    }
		  }

		  /**
		   * 用关键词生成“召回查询”组合：尽量既能扩大召回，又避免整句匹配失败
		   * @param {string[]} tokens
		   * @param {Object} options
		   * @param {number} options.maxQueries
		   * @returns {string[]}
		   */
		  MNKnowledgeBaseClass.prototype.buildRecallQueriesFromTokens = function(tokens, options = {}) {
		    try {
		      const maxQueries = typeof options.maxQueries === 'number' ? options.maxQueries : 3;
		      const debugSource = options.debugSource || '';
		      const raw = Array.isArray(tokens) ? tokens : [];
		      const base = raw.map((t) => (t || '').toString().trim()).filter(Boolean);
		      if (!base.length) return [];

		      const ranked = this.extractSearchTokensFromText(base.join(' '), { maxTokens: 8, debugSource });
		      const queries = [];

		      const andTokens = ranked.slice(0, Math.min(4, ranked.length));
		      if (andTokens.length >= 2) {
		        queries.push(andTokens.join(' '));
		      }

		      if (ranked.length) {
		        queries.push(ranked.slice(0, Math.min(6, ranked.length)).join(' ;; '));
		      }

		      if (ranked.length >= 2) {
		        queries.push(`${ranked[0]} ${ranked[1]}`);
		      }

		      const uniq = [];
		      const seen = new Set();
		      for (const q of queries) {
		        const s = (q || '').trim();
		        if (!s) continue;
		        if (seen.has(s)) continue;
		        seen.add(s);
		        uniq.push(s);
		        if (uniq.length >= maxQueries) break;
		      }

		      if (debugSource) {
		        KnowledgeBaseUtils.log('召回查询组合', debugSource, {
		          inputTokens: base.slice(0, 16),
		          rankedTokens: ranked,
		          queries: uniq,
		        });
		      }

		      return uniq;
		    } catch (error) {
		      KnowledgeBaseUtils.addErrorLog(error, 'buildRecallQueriesFromTokens');
		      return [];
		    }
		  }

		  /**
		   * 从标题中提取“研究对象(概念/对象)”与“属性/主题”
		   * 适配数学笔记常见结构：对象 -> 性质/命题/例子…（很多归类卡片只写对象，不写属性）
		   * @param {string} rawTitle
		   * @returns {{object:string, aspect:string}}
		   */
		  MNKnowledgeBaseClass.prototype.extractMathObjectAndAspectFromTitle = function(rawTitle) {
		    try {
		      let t = (rawTitle || '').toString().trim();
		      if (!t) return { object: '', aspect: '' };

		      // 去掉常见前缀装饰
		      t = t.replace(/^【[^】]+】\s*/, '');
		      t = t.replace(/^“[^”]+”[:：]\s*/, '');
		      t = t.replace(/\s+/g, ' ').trim();

		      // 先截断到“主句”部分（很多命题标题后半段是推导/公式，不适合当 object）
		      const cutMarkers = ['，', ',', '。', ';', '；', '⇒', '=>', '->', '则', '当', '若', '如果'];
		      for (const m of cutMarkers) {
		        const idx = t.indexOf(m);
		        if (idx > 0) {
		          t = t.slice(0, idx).trim();
		          break;
		        }
		      }

		      // 优先识别“...的基本性质/性质”
		      const basicMatch = t.match(/^(.+?)(?:的)?(基本性质|常见性质|性质)\s*$/);
		      if (basicMatch) {
		        return { object: basicMatch[1].trim(), aspect: basicMatch[2].trim() };
		      }

		      // 识别“X 是 Y / X 为 Y / X 称为 Y”类（常见：T 是投影算子）
		      const isLike = t.match(/^(.+?)\s*(?:是|为|稱為|称为|叫做|定义为|記為|记为)\s*(.+)$/);
		      if (isLike) {
		        const left = (isLike[1] || '').trim();
		        const right = (isLike[2] || '').trim();
		        const leftHasCJK = /[\u4e00-\u9fff]/.test(left);
		        const leftIsVar = !leftHasCJK && /^[a-zA-Z][a-zA-Z0-9_]{0,3}$/.test(left);
		        // 中文数学命题常见写法：设/令/假设 X 是 ...（left 虽含中文，但语义是“变量声明”）
		        const leftAssumeMatch = left.match(/^(设|令|假设|假定|取)\s*(.+)$/);
		        const leftVarCandidate = leftAssumeMatch ? (leftAssumeMatch[2] || '').trim() : '';
		        const leftIsVarByAssumption = !!(leftAssumeMatch && leftVarCandidate && /^[a-zA-ZΑ-Ωα-ω][a-zA-Z0-9_]*$/.test(leftVarCandidate));
		        // 若左边像变量（T,x,f），则对象是右边（投影算子）；否则对象取左边（投影算子是幂等算子）
		        if ((leftIsVar || leftIsVarByAssumption) && right) {
		          // 右边可能还带“投影算子在...”，这里再截断一次
		          const rightCut = right.split(/[，,。;；]/)[0].trim();
		          return { object: rightCut, aspect: '' };
		        }
		        if (left) {
		          const leftCut = left.split(/[，,。;；]/)[0].trim();
		          return { object: leftCut, aspect: right.split(/[，,。;；]/)[0].trim() };
		        }
		      }

		      // 常见“X 的 Y”
		      const deIdx = t.indexOf('的');
		      if (deIdx > 1 && deIdx < t.length - 1) {
		        const obj = t.slice(0, deIdx).trim();
		        const asp = t.slice(deIdx + 1).trim();
		        if (obj && asp) return { object: obj, aspect: asp };
		      }

		      // 英文 “X of Y”/“Y of X” 很难可靠判断，这里不强行拆
		      return { object: t, aspect: '' };
		    } catch (error) {
		      KnowledgeBaseUtils.addErrorLog(error, 'extractMathObjectAndAspectFromTitle');
		      return { object: '', aspect: '' };
		    }
		  }

		  /**
		   * 数学场景召回 query 生成：优先 AND（对象+属性 → 对象），避免宽泛 OR 污染候选集
		   * @param {Object} info
		   * @param {string} info.object
		   * @param {string} info.aspect
		   * @param {string} info.debugSource
		   * @returns {{queries:string[], objectTokens:string[], aspectTokens:string[]}}
		   */
		  MNKnowledgeBaseClass.prototype.buildMathRecallQueries = function(info = {}) {
		    try {
		      const debugSource = info.debugSource || '';
		      const object = (info.object || '').toString().trim();
		      const aspect = (info.aspect || '').toString().trim();
		      const rawTitle = (info.rawTitle || '').toString().trim();

		      const isLikelySymbolToken = (token) => {
		        const s = (token || '').toString().trim();
		        if (!s) return true;
		        if (/[\u4e00-\u9fff]/.test(s)) return false; // 中文优先保留
		        if (/-/.test(s)) return false; // Hilbert-Schmidt 这类保留
		        if (/\d/.test(s)) return true; // 含数字多为公式/编号
		        // 混合大小写（如 trT, dimImT）多为变量
		        if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return true;
		        // 很短的纯英文更像符号（dim,tr）
		        if (/^[a-zA-Z]{1,3}$/.test(s)) return true;
		        return false;
		      };

		      const objectTokens = object
		        ? this.extractSearchTokensFromText(object, { maxTokens: 6, debugSource })
		        : [];
		      const aspectTokens = aspect
		        ? this.extractSearchTokensFromText(aspect, { maxTokens: 4, debugSource })
		        : [];

		      const queries = [];
		      if (object) {
		        // 1) 先用对象本身召回（最符合“定义/概念 → 基本性质/归类”的结构）
		        queries.push(object);

		        // 2) 再用对象 + “更像概念”的属性词做 AND（属性词会被过滤，避免 dimImT/trT 等污染）
		        const aspectConceptTokens = (aspectTokens || []).filter((t) => !isLikelySymbolToken(t));
		        if (aspectConceptTokens.length) {
		          queries.push([object].concat(aspectConceptTokens.slice(0, 2)).join(' '));
		        }
		      }

		      // 兜底：如果对象为空，则退回到通用 tokens 组合（但仍避免 ;;）
		      if (!queries.length) {
		        const fallbackTokens = this.extractSearchTokensFromText(`${rawTitle} ${aspect}`, { maxTokens: 6, debugSource });
		        const conceptTokens = fallbackTokens.filter((t) => !isLikelySymbolToken(t));
		        if (conceptTokens.length >= 2) {
		          queries.push(conceptTokens.slice(0, 3).join(' '));
		        } else if (fallbackTokens.length === 1) {
		          queries.push(conceptTokens[0] || fallbackTokens[0]);
		        }
		      }

		      const uniq = [];
		      const seen = new Set();
		      for (const q of queries) {
		        const s = (q || '').trim();
		        if (!s) continue;
		        if (seen.has(s)) continue;
		        seen.add(s);
		        uniq.push(s);
		        if (uniq.length >= 3) break;
		      }

		      if (debugSource) {
		        KnowledgeBaseUtils.log('数学召回 query', debugSource, {
		          object,
		          aspect,
		          objectTokens,
		          aspectTokens,
		          queries: uniq,
		        });
		      }

		      return { queries: uniq, objectTokens, aspectTokens };
		    } catch (error) {
		      KnowledgeBaseUtils.addErrorLog(error, 'buildMathRecallQueries');
		      return { queries: [], objectTokens: [], aspectTokens: [] };
		    }
		  }
		
		  /**
		   * 从 focusNote 提取用于“找父卡片（归类/定义）”的查询短语
		   * @param {MNNote} focusNote
		   * @returns {string[]}
		   */
			  MNKnowledgeBaseClass.prototype.extractClassificationQueryTerms = function(focusNote, options = {}) {
			    try {
			      const debugSource = options.debugSource || '';
			      const parts = KnowledgeBaseTemplate.parseNoteTitle(focusNote) || {};
			      const terms = [];
			      const maxTerms = 6;
		
		      const sourcePhrases = [];
		      const pushPhrase = (phrase) => {
		        const t = (phrase || '').toString().trim();
		        if (!t) return;
		        if (sourcePhrases.includes(t)) return;
		        sourcePhrases.push(t);
		      };
		      // prefixContent 往往是“章节/对象”线索（例如 紧性｜…）
		      if (parts.prefixContent) pushPhrase(parts.prefixContent);
		      const linkWords = Array.isArray(parts.titleLinkWordsArr) ? parts.titleLinkWordsArr : [];
		      linkWords.forEach((w) => pushPhrase(w));

		      for (const w of sourcePhrases) {
		        const t = (w || '').trim();
		        if (!t) continue;
		        const tokens = this.extractSearchTokensFromText(t, { maxTokens: maxTerms, debugSource });
		        const picked = tokens.length ? tokens : [t];
		        for (const token of picked) {
		          const s = (token || '').trim();
		          if (!s) continue;
		          if (terms.includes(s)) continue;
		          terms.push(s);
		          if (terms.length >= maxTerms) break;
		        }
		        if (terms.length >= maxTerms) break;
		      }
		
		      if (terms.length === 0) {
		        const fallback = ((focusNote.noteTitle || focusNote.title || '') + '').trim();
		        if (fallback) {
		          const tokens = this.extractSearchTokensFromText(fallback, { maxTokens: maxTerms, debugSource });
		          const picked = tokens.length ? tokens : [fallback];
		          for (const token of picked) {
		            const s = (token || '').trim();
		            if (!s) continue;
		            if (terms.includes(s)) continue;
		            terms.push(s);
		            if (terms.length >= maxTerms) break;
		          }
		        }
		      }

			      if (debugSource) {
			        KnowledgeBaseUtils.log('提取基础检索词', debugSource, {
			          prefixContent: (parts.prefixContent || '').toString().trim(),
			          titleLinkWordsArr: linkWords.slice(0, 12),
			          sourcePhrases: sourcePhrases.slice(0, 12),
			          extractedTerms: terms,
			        });
			      }
		
			      return terms;
			    } catch (error) {
			      KnowledgeBaseUtils.addErrorLog(error, "extractClassificationQueryTerms");
		      return [];
		    }
		  }

		  /**
		   * 判断是否需要用 AI 先“生成搜索短语”再召回候选父卡片
		   * @param {MNNote} focusNote
		   * @param {string[]} terms
		   * @param {number} candidateCount
		   * @returns {boolean}
		   */
		  MNKnowledgeBaseClass.prototype.shouldTryAIQueryExpansionForClassification = function(focusNote, terms, candidateCount) {
		    try {
		      // 没有 MNAI 时直接跳过（避免重复弹错）
		      if (typeof chatAIUtils === "undefined") return false;
		      if (!terms || terms.length === 0) return true;
		      if (typeof candidateCount === "number" && candidateCount < 15) return true;

		      const title = ((focusNote.noteTitle || focusNote.title || "") + "").trim();
		      const excerpt = ((focusNote.excerptText || "") + "").trim();
		      const text = `${title}\n${excerpt}`;

		      // 公式/符号占比较高时，标题分词往往无效
		      const mathSymbolPattern = /[∀∃∈∉⊂⊆⊄⊇⊃⇒→↔∑∫√≠≤≥]/;
		      if (mathSymbolPattern.test(text)) return true;

		      // 若明显缺少可检索的自然语言词（中英文）
		      const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
		      const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
		      if (cjkCount + alphaCount < 4 && text.length > 10) return true;

		      return false;
		    } catch (error) {
		      KnowledgeBaseUtils.addErrorLog(error, "shouldTryAIQueryExpansionForClassification");
		      return false;
		    }
		  }

		  /**
		   * 从 focusNote 提取用于 AI 生成搜索短语的文本（截断 + 清理）
		   * @param {MNNote} focusNote
		   * @param {number} maxChars
		   * @returns {string}
		   */
		  MNKnowledgeBaseClass.prototype.buildFocusTextForClassificationQueryExpansion = function(focusNote, maxChars = 600) {
		    try {
		      const parts = [];
		      const title = ((focusNote.noteTitle || focusNote.title || "") + "").trim();
		      if (title) parts.push(`标题: ${title}`);

		      const excerpt = ((focusNote.excerptText || "") + "").trim();
		      if (excerpt) parts.push(`摘录: ${excerpt}`);

		      try {
		        const commentTexts = [];
		        const comments = Array.isArray(focusNote.comments) ? focusNote.comments : [];
		        for (const c of comments) {
		          if (!c || c.type !== "TextNote") continue;
		          let t = ((c.text || "") + "").trim();
		          if (!t) continue;
		          t = t.replace(/<[^>]+>/g, " ");
		          t = t.replace(/\s+/g, " ").trim();
		          if (!t) continue;
		          commentTexts.push(t);
		          if (commentTexts.join(" ").length > 400) break;
		        }
		        if (commentTexts.length) {
		          parts.push(`评论: ${commentTexts.slice(0, 3).join(" / ")}`);
		        }
		      } catch (e) {
		        // ignore
		      }

		      let text = parts.join("\n");
		      // 避免 data:image/...;base64,... 造成 token/字符串爆炸
		      text = text.replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "{{image}}");
		      text = text.replace(/\s+/g, " ").trim();
		      if (text.length > maxChars) text = text.slice(0, maxChars);
		      return text;
		    } catch (error) {
		      KnowledgeBaseUtils.addErrorLog(error, "buildFocusTextForClassificationQueryExpansion");
		      return "";
		    }
		  }

		  /**
		   * 构建“生成搜索短语”的提示词（用于扩大召回，避免只靠标题关键词）
		   * @param {Object} focusInfo
		   * @returns {string}
		   */
			  MNKnowledgeBaseClass.prototype.buildAIPromptForClassificationQueryExpansion = function(focusInfo) {
			    const lines = [];
			    lines.push("# 任务");
			    lines.push("你是 MarginNote 知识库整理助手。请阅读下方知识点卡片内容，理解其真正主题，然后生成用于搜索父卡片（归类/定义）的搜索短语。");
			    lines.push("");
			    lines.push("# 输出要求（非常重要）");
			    lines.push('- 只输出 JSON，不要输出任何多余文本');
			    lines.push('- JSON 格式: {"searchPhrases":["..."],"topic":"..."}');
			    lines.push("- searchPhrases: 6-10 个关键词/短语（尽量 2-6 字的名词性主题词），不要输出完整句子，不要包含“的/是/如何/什么/为什么”等虚词；尽量覆盖同义词与不同表述");
			    lines.push("- topic: 1 个更完整的归类标题（可用于新建归类卡片），无则给空字符串");
			    lines.push("");
			    lines.push("# 知识点卡片");
			    if (focusInfo.type) lines.push(`- 类型: ${focusInfo.type}`);
			    if (focusInfo.title) lines.push(`- 标题: ${focusInfo.title}`);
		    if (focusInfo.content) lines.push(`- 内容(截断): ${focusInfo.content}`);
		    lines.push("");
		    lines.push("JSON：");
		    return lines.join("\n");
		  }

		  /**
		   * 从 AI 响应中解析 searchPhrases（支持 JSON / 逗号 / 换行）
		   * @param {string} response
		   * @returns {string[]}
		   */
			  MNKnowledgeBaseClass.prototype.parseSearchPhrasesFromAIResponse = function(response, options = {}) {
			    try {
			      const debugSource = options.debugSource || '';
			      if (!response || typeof response !== "string") return [];
			      const text = response.trim();
			      if (!text) return [];

		      const tryParse = (raw) => {
		        try {
		          return JSON.parse(raw);
		        } catch (e) {
		          return null;
		        }
		      };

		      let data = tryParse(text);
		      if (!data) {
		        const start = text.indexOf("{");
		        const end = text.lastIndexOf("}");
		        if (start !== -1 && end !== -1 && end > start) {
		          data = tryParse(text.slice(start, end + 1));
		        }
		      }

		      let phrases = [];
		      if (data && typeof data === "object") {
		        const candidate = data.searchPhrases || data.phrases || data.keywords || data.terms;
		        if (Array.isArray(candidate)) {
		          phrases = candidate;
		        } else if (typeof candidate === "string") {
		          phrases = candidate.split(/[\n\r,，;；、|]+/);
		        }
		      }

		      if (!phrases.length) {
		        // 备用：尝试解析 [...] 数组
		        const m = text.match(/\[[\s\S]*\]/);
		        if (m) {
		          const arr = tryParse(m[0]);
		          if (Array.isArray(arr)) phrases = arr;
		        }
		      }

		      if (!phrases.length) {
		        phrases = text.split(/[\n\r,，;；、|]+/);
		      }

			      const cleaned = [];
			      const seen = new Set();
			      for (const p of phrases) {
		        const raw = (p || "").toString().trim();
		        if (!raw) continue;
		        const phrase = raw
		          .replace(/^[\s\-*•\d.、]+/, "")
		          .replace(/^["'“”]+|["'“”]+$/g, "")
		          .trim();
		        if (!phrase) continue;
		        if (phrase.length > 24) continue;
		        if (/^(\d+|\s+)$/.test(phrase)) continue;
		        if (/marginnote4app:\/\/note\//i.test(phrase)) continue;
		        if (seen.has(phrase)) continue;
		        seen.add(phrase);
			        cleaned.push(phrase);
			        if (cleaned.length >= 10) break;
			      }

			      // 二次处理：把“短句”拆成可检索的关键词，避免整句匹配失败
			      const expanded = [];
			      const expandedSeen = new Set();
			      cleaned.forEach((phrase) => {
			        const tokens = this.extractSearchTokensFromText(phrase, { maxTokens: 6, debugSource });
			        const picked = tokens.length ? tokens : [phrase];
			        picked.forEach((t) => {
			          const s = (t || '').toString().trim();
			          if (!s) return;
			          if (expandedSeen.has(s)) return;
			          expandedSeen.add(s);
			          expanded.push(s);
			        });
			      });

			      if (debugSource) {
			        KnowledgeBaseUtils.log('AI 扩展短语解析', debugSource, {
			          cleanedPhrases: cleaned,
			          expandedTokens: expanded.slice(0, 24),
			        });
			      }

			      return expanded.slice(0, 12);
			    } catch (error) {
			      KnowledgeBaseUtils.addErrorLog(error, "parseSearchPhrasesFromAIResponse");
			      return [];
			    }
			  }
	
	  /**
	   * 构建“归类/定义父卡片推荐”提示词（小上下文，不发送大 JSON）
	   * @param {Object} focusInfo
	   * @param {Array<Object>} candidateCards
	   * @returns {string}
	   */
		  MNKnowledgeBaseClass.prototype.buildAIPromptForClassificationRecommendation = function(focusInfo, candidateCards) {
		    const lines = [];
		    lines.push("# 任务");
		    lines.push("你是 MarginNote 知识库整理助手。给定一张“知识点卡片”（需要归档），请从候选父卡片中选出最合适的 5-8 张，按相关性从高到低排序。");
		    lines.push("");
		    lines.push("父卡片候选说明：");
		    lines.push("- 类型=归类：某主题相关的归档容器（优先选择）");
		    lines.push("- 类型=定义：概念入口（当缺少合适归类卡片时，可选择定义卡片，后续会在其下新建归类卡片）");
		    lines.push("");
		    lines.push("知识库组织规则（非常重要）：");
		    lines.push("- 数学知识结构通常是：定义/概念(对象) → 相关性质/命题/例子/反例 等派生内容。归档时优先按“对象/概念”归类，再细分到对象的某个性质/主题。");
		    lines.push("- 当标题形如“X 的 Y”时，很多父卡片标题只包含 X（不包含 Y）；因此相关性判断以 X 为主，Y 为辅。");
		    lines.push("- 如果找不到精确的子主题归类，优先选择“X 的基本性质/常见性质/性质”这类更包容的归类卡片（通常是最好的兜底容器）。");
		    lines.push("");
		
		    lines.push("# 需要归档的知识点卡片");
		    if (focusInfo.title) lines.push(`- 标题: ${focusInfo.title}`);
		    if (focusInfo.type) lines.push(`- 类型: ${focusInfo.type}`);
	    if (focusInfo.keyPhrases && focusInfo.keyPhrases.length) lines.push(`- 关键词: ${focusInfo.keyPhrases.join(" / ")}`);
	    if (focusInfo.excerpt) lines.push(`- 摘录(截断): ${focusInfo.excerpt}`);
	    lines.push("");
	
	    lines.push("# 候选父卡片（只基于标题/路径做语义判断）");
	    candidateCards.forEach((card, index) => {
	      const type = card.type || "未知类型";
	      const title = card.title || "(无标题)";
	      const id = card.id;
	      const subtype = (type === "归类" && card.classificationSubtype) ? `/${card.classificationSubtype}` : "";
	      const prefix = card.prefix ? ` | 路径: ${card.prefix}` : "";
	      const dataset = card.dataset ? ` | 来源: ${card.dataset}` : "";
	      lines.push(`${index + 1}. [ID: ${id}] (类型: ${type}${subtype}) ${title}${prefix}${dataset}`);
	    });
	    lines.push("");
	
	    lines.push("# 输出要求");
	    lines.push("只输出 5-8 个候选卡片 ID，按相关性从高到低，用逗号分隔。不要输出任何其它内容。");
	    lines.push("");
	    lines.push("推荐的卡片 ID：");
	
	    return lines.join("\n");
	  }
	
	  /**
	   * 本地召回：在索引中搜索候选父卡片（归类 + 定义），包含过程知识库
	   * @param {string} query
	   * @param {Object} options
	   * @returns {Promise<Array<Object>>}
	   */
		  MNKnowledgeBaseClass.prototype.collectCandidateParentCards = async function(query, options = {}) {
		    try {
		      const types = options.types || ["归类", "定义"];
		      const perSourceLimit = options.perSourceLimit || 80;
		      const mergedLimit = options.mergedLimit || 120;
		      const debugSource = options.debugSource || '';
	
		      const queries = Array.isArray(query) ? query : [query];
		      const normalizedQueries = queries
		        .map((q) => (q || '').toString().trim())
		        .filter(Boolean)
		        .slice(0, 6);
		      if (!normalizedQueries.length) return [];

		      const candidates = [];
		      const stats = [];
		      const collectFromSearcher = async (searcher, dataset) => {
		        if (!searcher) return;
		        for (const q of normalizedQueries) {
		          const res = await searcher.search(q, { types, limit: perSourceLimit });
		          if (debugSource) {
		            stats.push({
		              dataset,
		              query: q,
		              hits: Array.isArray(res) ? res.length : 0,
		              top: (Array.isArray(res) ? res : []).slice(0, 3).map((item) => ({
		                id: item.id,
		                score: item.score || 0,
		                type: item.type || '',
		                title: item.title || '',
		                prefix: item.prefix || '',
		              })),
		            });
		          }
		          res.forEach((item) => candidates.push(Object.assign({ dataset }, item)));
		        }
		      };

		      const kbSearcher = await KnowledgeBaseSearcher.loadFromFile();
		      await collectFromSearcher(kbSearcher, "knowledge");

		      const intermediateSearcher = await KnowledgeBaseSearcher.loadFromIntermediateKB();
		      await collectFromSearcher(intermediateSearcher, "intermediate");

		      const literatureClassificationSearcher = await KnowledgeBaseSearcher.loadFromIntermediateKB(
		        "literature-classification-kb-index",
		        "文献归类知识库"
		      );
		      await collectFromSearcher(literatureClassificationSearcher, "literature-classification");

		      const historyCardSearcher = await KnowledgeBaseSearcher.loadFromIntermediateKB(
		        "history-card-kb-index",
		        "历史卡片"
		      );
		      await collectFromSearcher(historyCardSearcher, "history-card");

		      if (debugSource) {
		        KnowledgeBaseUtils.log('本地召回统计', debugSource, {
		          queries: normalizedQueries,
		          perSourceLimit,
		          mergedLimit,
		          stats,
		        });
		      }

		      const bestById = new Map();
		      for (const item of candidates) {
		        const id = this.normalizeNoteId(item.id);
		        if (!id) continue;

		        const normalized = Object.assign({}, item, { id });
		        const existing = bestById.get(id);
		        if (!existing) {
		          bestById.set(id, Object.assign({ _hitCount: 1 }, normalized));
		          continue;
		        }

		        existing._hitCount = (existing._hitCount || 1) + 1;
		        if ((normalized.score || 0) > (existing.score || 0)) {
		          bestById.set(id, Object.assign(existing, normalized));
		        }
		      }

		      return Array.from(bestById.values())
		        .map((item) => {
		          const hitCount = item._hitCount || 1;
		          const bonus = Math.min(12, Math.max(0, hitCount - 1) * 2);
		          const normalized = Object.assign({}, item, {
		            score: (item.score || 0) + bonus,
		          });
		          // 额外重排：偏数学知识库结构（定义/对象 -> 基本性质/派生性质）
		          try {
		            const hints = options.rerankHints || {};
		            const object = (hints.object || '').toString().trim();
		            const aspect = (hints.aspect || '').toString().trim();
		            const title = (item.title || '').toString();
		            const titleLower = title.toLowerCase();
		            const norm = (s) => (s || '').toString().toLowerCase().replace(/\s+/g, '');
		            const includesLoose = (base, term) => {
		              if (!term) return false;
		              const b = (base || '').toString().toLowerCase();
		              if (b.includes(term.toLowerCase())) return true;
		              return norm(b).includes(norm(term));
		            };

		            const objectHit = object ? includesLoose(titleLower, object) : false;
		            const isBasic = includesLoose(titleLower, '基本性质') || includesLoose(titleLower, '常见性质');
		            const isProperty = includesLoose(titleLower, '性质');
		            const isDefinition = (item.type || '') === '定义';
		            const isClassification = (item.type || '') === '归类';

		            let extra = 0;
		            if (objectHit && isClassification && isBasic) extra += 28;
		            if (objectHit && isClassification && isProperty && !isBasic) extra += 12;
		            if (objectHit && isDefinition) extra += 10;
		            if (!objectHit && isBasic) extra -= 18; // 单独“基本性质”太宽泛

		            // 若 aspect 是“范数/谱/伴随/核”等细粒度主题，允许加一点，但不压过对象
		            if (objectHit && aspect) {
		              const aspectHit = includesLoose(titleLower, aspect);
		              if (aspectHit) extra += 6;
		            }

		            normalized.score = (normalized.score || 0) + extra;
		          } catch (e) {
		            // ignore
		          }
		          delete normalized._hitCount;
		          return normalized;
		        })
		        .sort((a, b) => (b.score || 0) - (a.score || 0))
		        .slice(0, mergedLimit);
		    } catch (error) {
		      KnowledgeBaseUtils.addErrorLog(error, "collectCandidateParentCards");
		      return [];
		    }
		  }
	
	  /**
	   * AI 推荐：为 focusNote 推荐“归类/定义”父卡片（仅推荐，不执行移动）
	   * 触发方式：search.html -> mnknowledgebase://aiRecommendClassification
	   */
		  MNKnowledgeBaseClass.prototype.aiRecommendClassificationInSearchWebView = async function() {
		    try {
		      const debugSource = 'aiRecommendClassification';
		      const dbg = (message, detail) => {
		        try {
		          KnowledgeBaseUtils.log(message, debugSource, detail);
		        } catch (e) {
		          // ignore
		        }
		      };

		      const stopLoadingInWebView = async () => {
		        try {
		          const controller = KnowledgeBaseUtils.webViewController;
		          if (!controller || !controller.webViewLoaded) return;
	          const script = `
	            (function() {
	              try {
	                if (window.Bridge && typeof window.Bridge.showAIRecommendations === 'function') {
	                  window.Bridge.showAIRecommendations([]);
	                  return true;
	                }
	                return false;
	              } catch (e) {
	                return false;
	              }
	            })();
	          `;
	          await controller.runJavaScript(script);
	        } catch (e) {
	          // ignore
	        }
	      };

		      const focusNote = MNNote.getFocusNote();
		      if (!focusNote) {
		        MNUtil.showHUD("请先在脑图中选中要归档的知识点卡片");
		        await stopLoadingInWebView();
		        return;
		      }

		      dbg('开始 AI 推荐', {
		        focusNoteId: focusNote.noteId || '',
		        title: ((focusNote.noteTitle || focusNote.title || '') + '').trim(),
		        type: KnowledgeBaseTemplate.getNoteType(focusNote) || '',
		        excerpt: (((focusNote.excerptText || '') + '').replace(/\s+/g, ' ').trim().slice(0, 160)),
		      });

		      const focusTitleRaw = ((focusNote.noteTitle || focusNote.title || '') + '').trim();
		      const mathParts = this.extractMathObjectAndAspectFromTitle(focusTitleRaw);
		      const mathRecall = this.buildMathRecallQueries({
		        object: mathParts.object,
		        aspect: mathParts.aspect,
		        rawTitle: focusTitleRaw,
		        debugSource,
		      });

			      const baseTerms = this.extractClassificationQueryTerms(focusNote, { debugSource });
			      let searchTerms = baseTerms.slice(0);
			      const uniqStrings = (arr) => {
			        const out = [];
			        const seen = new Set();
			        (arr || []).forEach((item) => {
			          const s = (item || '').toString().trim();
			          if (!s) return;
			          if (seen.has(s)) return;
			          seen.add(s);
			          out.push(s);
			        });
			        return out;
			      };

			      const sanitizeRecallQueries = (queries) => {
			        const list = Array.isArray(queries) ? queries : [];
			        const cleaned = [];
			        for (const q0 of list) {
			          let q = (q0 || '').toString().trim();
			          if (!q) continue;
			          // 清理“设/令/假设 X …”这类前缀，避免把变量声明当作主题词
			          q = q.replace(/^(设|令|假设|假定|取)\s*[a-zA-ZΑ-Ωα-ω][a-zA-Z0-9_]*\s*/g, '').trim();
			          if (!q) continue;
			          const hasCJK = /[\u4e00-\u9fff]{2,}/.test(q);
			          const hasAlpha = /[a-zA-ZΑ-Ωα-ω][a-zA-Z0-9_.-]{2,}/.test(q);
			          if (!hasCJK && !hasAlpha) continue;
			          cleaned.push(q);
			        }
			        return uniqStrings(cleaned);
			      };

			      const tokenRecallQueries = sanitizeRecallQueries(
			        this.buildRecallQueriesFromTokens(searchTerms, { maxQueries: 2, debugSource })
			      );
			      const mathRecallQueries = sanitizeRecallQueries(mathRecall.queries || []);

			      // 以“数学对象/属性”召回为主，但遇到“设 X …”这类低质量 query 时自动回退并合并关键词召回
			      const recallQueries = mathRecallQueries.length
			        ? uniqStrings([mathRecallQueries[0]].concat(tokenRecallQueries)).slice(0, 3)
			        : tokenRecallQueries;
			      let recallQueriesUsed = Array.isArray(recallQueries) ? recallQueries.slice(0) : [];
			      let expandedPhrasesUsed = [];
			      let expandedQueriesUsed = [];

			      dbg('初始召回参数', {
			        focusTitleRaw,
			        mathParts,
			        mathRecallQueries: mathRecall.queries,
			        baseTerms,
			        searchTerms,
			        recallQueries,
			      });
		
			      MNUtil.showHUD("🤖 正在检索候选父卡片...");
			      let candidates = await this.collectCandidateParentCards(recallQueries, {
			        types: ["归类", "定义"],
			        perSourceLimit: 80,
			        mergedLimit: 120,
			        debugSource,
			        rerankHints: {
			          object: mathParts.object,
			          aspect: mathParts.aspect,
			        },
			      });
			      // 若数学召回因为变量/断句导致 0 命中，则回退到纯关键词召回
			      if (candidates.length === 0 && tokenRecallQueries.length) {
			        const usedMathFirst = (mathRecallQueries.length && recallQueriesUsed.length && recallQueriesUsed[0] === mathRecallQueries[0]);
			        if (usedMathFirst) {
			          dbg('数学召回 0 命中，回退到关键词召回', { tokenRecallQueries });
			          candidates = await this.collectCandidateParentCards(tokenRecallQueries, {
			            types: ["归类", "定义"],
			            perSourceLimit: 80,
			            mergedLimit: 120,
			            debugSource,
			            rerankHints: {
			              object: mathParts.object,
			              aspect: mathParts.aspect,
			            },
			          });
			          recallQueriesUsed = tokenRecallQueries.slice(0);
			        }
			      }
			      dbg('初始候选召回结果', {
			        candidateCount: candidates.length,
			        top: candidates.slice(0, 8).map((c) => ({
			          id: c.id,
			          score: c.score || 0,
			          type: c.type || '',
			          title: c.title || '',
			          prefix: c.prefix || '',
			          dataset: c.dataset || '',
			        })),
			      });

		      // 若标题分词召回不足，则先让 AI 生成更语义化的检索短语再召回一次
		      if (this.shouldTryAIQueryExpansionForClassification(focusNote, baseTerms, candidates.length)) {
		        dbg('触发 AI 扩展检索词', { candidateCount: candidates.length, baseTerms });
		        const title = ((focusNote.noteTitle || focusNote.title || "") + "").trim();
		        const type = KnowledgeBaseTemplate.getNoteType(focusNote) || "";
		        const content = this.buildFocusTextForClassificationQueryExpansion(focusNote, 600);

	        const expandPrompt = this.buildAIPromptForClassificationQueryExpansion({
	          title,
	          type,
	          content,
	        });

		        MNUtil.showHUD("🤖 正在生成搜索短语...");
		        const expandResp = await KnowledgeBaseNetwork.callMNAIWithNotification(expandPrompt);
		        dbg('AI 扩展原始返回(截断)', { text: ((expandResp || '') + '').slice(0, 280) });
		        const aiPhrases = expandResp ? this.parseSearchPhrasesFromAIResponse(expandResp, { debugSource }) : [];
		        expandedPhrasesUsed = Array.isArray(aiPhrases) ? aiPhrases.slice(0) : [];
		        dbg('AI 扩展解析结果', { aiPhrases });

			        if (aiPhrases.length) {
				          searchTerms = aiPhrases.concat(baseTerms)
				            .map(s => (s || "").trim())
				            .filter(Boolean)
				            .slice(0, 10);
				          // 扩展后的召回：以“对象”为锚点（对象+属性 -> 对象），避免把公式/变量/过宽词堆进 AND 导致 0 命中
				          const isLikelySymbolToken = (token) => {
				            const s = (token || '').toString().trim();
				            if (!s) return true;
				            if (/[\u4e00-\u9fff]/.test(s)) return false;
				            if (/-/.test(s)) return false;
				            if (/\d/.test(s)) return true;
				            if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return true;
				            if (/^[a-zA-Z]{1,3}$/.test(s)) return true;
				            return false;
				          };

				          const objectAnchor = (mathParts && mathParts.object) ? (mathParts.object + '').trim() : '';
				          const anchor = objectAnchor || (baseTerms[0] || '');
				          const conceptTokens = (searchTerms || [])
				            .map((t) => (t || '').toString().trim())
				            .filter(Boolean)
				            .filter((t) => t !== anchor)
				            .filter((t) => !isLikelySymbolToken(t));

				          const expandedUniq = [];
				          if (anchor) expandedUniq.push(anchor);
				          conceptTokens.slice(0, 2).forEach((t) => {
				            if (anchor) expandedUniq.push(`${anchor} ${t}`);
				          });

				          // 若 anchor 为空，则退回到概念 token 的 AND（最多 3 个）
				          if (!expandedUniq.length && conceptTokens.length) {
				            expandedUniq.push(conceptTokens.slice(0, 3).join(' '));
				          }

				          const expandedFinal = Array.from(new Set(expandedUniq)).filter(Boolean).slice(0, 3);
				          expandedQueriesUsed = expandedFinal.slice(0);
				          if (expandedFinal.length) {
				            recallQueriesUsed = expandedFinal.slice(0);
				          }
				          dbg('扩展后召回参数', {
				            searchTerms,
				            anchor,
				            conceptTokens: conceptTokens.slice(0, 12),
				            expandedQueries: expandedFinal,
				          });
		
				          MNUtil.showHUD("🤖 使用 AI 关键词重新检索...");
				          const expandedCandidates = await this.collectCandidateParentCards(expandedFinal.length ? expandedFinal : recallQueries, {
				            types: ["归类", "定义"],
				            perSourceLimit: 80,
				            mergedLimit: 120,
				            debugSource,
				            rerankHints: {
				              object: mathParts.object,
				              aspect: mathParts.aspect,
				            },
				          });
			          dbg('扩展后候选召回结果', {
			            expandedCandidateCount: expandedCandidates.length,
			            top: expandedCandidates.slice(0, 5).map((c) => ({
			              id: c.id,
			              score: c.score || 0,
			              type: c.type || '',
			              title: c.title || '',
			              prefix: c.prefix || '',
			              dataset: c.dataset || '',
			            })),
			          });

			          const bestById = new Map();
			          candidates.concat(expandedCandidates).forEach(item => {
	            const id = this.normalizeNoteId(item.id);
	            if (!id) return;
	            const normalized = Object.assign({}, item, { id });
	            const existing = bestById.get(id);
	            if (!existing || (normalized.score || 0) > (existing.score || 0)) {
	              bestById.set(id, normalized);
	            }
	          });
			          candidates = Array.from(bestById.values())
			            .sort((a, b) => (b.score || 0) - (a.score || 0))
			            .slice(0, 120);
			          dbg('合并候选后', { candidateCount: candidates.length });
			        }
		      }

		      if (!candidates.length) {
	        MNUtil.showHUD("未找到候选归类/定义卡片（请先更新索引或检查类型）");
	        await stopLoadingInWebView();
	        return;
	      }
	
		      // 候选过多会增加 prompt 体积，这里硬限制
		      const candidateForAI = candidates.slice(0, 60);
		      dbg('用于 AI 排序的候选集', {
		        candidateForAICount: candidateForAI.length,
		        types: candidateForAI.reduce((acc, c) => {
		          const t = c.type || '未知';
		          acc[t] = (acc[t] || 0) + 1;
		          return acc;
		        }, {}),
		        sample: candidateForAI.slice(0, 8).map((c) => ({
		          id: c.id,
		          score: c.score || 0,
		          type: c.type || '',
		          title: c.title || '',
		          prefix: c.prefix || '',
		          dataset: c.dataset || '',
		        })),
		      });
		
		      const focusInfo = {
		        title: (focusNote.noteTitle || focusNote.title || "").trim(),
		        type: KnowledgeBaseTemplate.getNoteType(focusNote) || "",
	        keyPhrases: searchTerms.slice(0, 4),
	        excerpt: ((focusNote.excerptText || "") + "").replace(/\s+/g, " ").trim().slice(0, 180),
	      };
	
		      const prompt = this.buildAIPromptForClassificationRecommendation(focusInfo, candidateForAI);
		      MNUtil.showHUD("🤖 正在分析相关性...");
		      const aiResponse = await KnowledgeBaseNetwork.callMNAIWithNotification(prompt);
		      dbg('AI 排序原始返回(截断)', { text: ((aiResponse || '') + '').slice(0, 260) });
		
		      // 失败则回退到本地 top
		      let recommendedIds = [];
			      if (aiResponse) {
		        recommendedIds = this.parseCardIdsFromAIResponse(aiResponse)
		          .map(id => this.normalizeNoteId(id))
		          .filter(Boolean);
		      }
		
			      const normalizeId = (raw) => {
			        if (raw === null || typeof raw === 'undefined') return null;
			        return this.normalizeNoteId((raw || '').toString());
			      };
			      const candidateIdSet = new Set(candidateForAI.map(c => normalizeId(c.id)).filter(Boolean));
			      recommendedIds = recommendedIds.map(id => normalizeId(id)).filter(Boolean);
			      recommendedIds = recommendedIds.filter(id => candidateIdSet.has(id));
			      recommendedIds = Array.from(new Set(recommendedIds)).slice(0, 10);
			      dbg('AI 推荐 IDs（过滤后）', { recommendedIds });
			
			      let finalRecommendations = [];
			      if (recommendedIds.length) {
		        const map = new Map(candidateForAI.map(c => [normalizeId(c.id) || c.id, c]));
		        finalRecommendations = recommendedIds.map(id => {
		          const card = map.get(id) || { id };
		          return {
		            id: normalizeId(card.id) || id,
		            title: card.title || "(无标题)",
		            type: card.type || "",
		            classificationSubtype: card.classificationSubtype || "",
		            prefix: card.prefix || "",
		            dataset: card.dataset || "",
		            score: card.score || 0,
		          };
		        });
			      } else {
			        // 回退：本地 top 8
			        finalRecommendations = candidateForAI.slice(0, 8).map(card => ({
		          id: normalizeId(card.id) || card.id,
		          title: card.title || "(无标题)",
		          type: card.type || "",
		          classificationSubtype: card.classificationSubtype || "",
		          prefix: card.prefix || "",
		          dataset: card.dataset || "",
		          score: card.score || 0,
		        }));
		      }
	
		      const controller = KnowledgeBaseUtils.webViewController;
		      const shouldAutoShow = !!(controller && controller.view && controller.view.hidden);
		      if (shouldAutoShow) {
		        // 交互增强：若用户在 AI 分析过程中关闭了 WebView，则结果出来后自动弹出展示
		        dbg('检测到 WebView 已关闭，自动弹出展示结果', {});
		        await this.openSearchWebView();
		      } else if (!controller || !controller.webViewLoaded) {
		        // 兜底：如果 WebView 未就绪，则先打开
		        dbg('WebView 未就绪，尝试打开后展示', { webViewLoaded: controller ? !!controller.webViewLoaded : null });
		        await this.openSearchWebView();
		      }
	
	      if (!KnowledgeBaseUtils.webViewController) {
	        MNUtil.showHUD("WebView 未初始化，无法展示推荐结果");
	        return;
	      }

	      const aiDebugPayload = {
	        baseTerms: Array.isArray(baseTerms) ? baseTerms.slice(0, 12) : [],
	        searchTerms: Array.isArray(searchTerms) ? searchTerms.slice(0, 12) : [],
	        tokenRecallQueries: Array.isArray(tokenRecallQueries) ? tokenRecallQueries.slice(0, 6) : [],
	        mathRecallQueries: Array.isArray(mathRecallQueries) ? mathRecallQueries.slice(0, 6) : [],
	        recallQueries: Array.isArray(recallQueriesUsed) ? recallQueriesUsed.slice(0, 6) : [],
	        expandedPhrases: Array.isArray(expandedPhrasesUsed) ? expandedPhrasesUsed.slice(0, 12) : [],
	        expandedQueries: Array.isArray(expandedQueriesUsed) ? expandedQueriesUsed.slice(0, 6) : [],
	        mathParts: {
	          object: (mathParts && mathParts.object) ? (mathParts.object + '') : '',
	          aspect: (mathParts && mathParts.aspect) ? (mathParts.aspect + '') : '',
	        },
	      };
	      const aiPayloadForWeb = {
	        recommendations: finalRecommendations,
	        debug: aiDebugPayload,
	      };
	
	      const script = `
	        (function() {
	          try {
	            if (window.Bridge && typeof window.Bridge.showAIRecommendations === 'function') {
	              window.Bridge.showAIRecommendations(${JSON.stringify(aiPayloadForWeb)});
	              return { success: true, count: ${finalRecommendations.length} };
	            }
	            return { success: false, error: 'Bridge.showAIRecommendations not found' };
	          } catch (e) {
	            return { success: false, error: e.message };
	          }
	        })();
	      `;
	
		      const resRaw = await KnowledgeBaseUtils.webViewController.runJavaScript(script);
		      let res = resRaw;
		      if (typeof resRaw === 'string') {
		        try {
		          res = JSON.parse(resRaw);
		        } catch (e) {
		          // ignore
		        }
		      }
		      dbg('前端展示执行结果', { res: res || resRaw });
		      if (res && res.success) {
		        MNUtil.showHUD(`✅ 已推荐 ${res.count} 张卡片`);
		      } else {
	        const err = (res && res.error) ? `：${res.error}` : '';
	        MNUtil.showHUD(`⚠️ 推荐结果已生成，但前端展示失败${err}`);
	      }
	    } catch (error) {
	      KnowledgeBaseUtils.addErrorLog(error, "aiRecommendClassificationInSearchWebView");
	      MNUtil.showHUD("AI 推荐失败：" + (error.message || error));
	    }
	  }

	  /**
	   * 在 search.html 中展示 AI 推荐的卡片（简化版）
	   *
	   * 架构说明：
   * - 不再尝试在主搜索结果中高亮卡片（受分页限制）
   * - 改为使用独立的底部推荐面板展示
   * - 面板会自动查找完整卡片数据并渲染
   *
   * @param {Array<string>} cardIds - 推荐的卡片 ID 数组
   */
  MNKnowledgeBaseClass.prototype.showRecommendedCardsInWebView = async function(cardIds) {
    try {
      // 1. 打开 WebView
      await this.openSearchWebView();

      // 2. 强制刷新数据（解决数据陈旧问题）
      MNUtil.showHUD("正在刷新数据...");
      await MNUtil.delay(0.3); // 确保 WebView 完全显示

      const controller = KnowledgeBaseUtils.webViewController;
      if (controller && controller.webViewLoaded) {
        await controller.refreshAllData();
      }

      // 3. 等待数据加载完成并验证卡片存在（最多10秒）
      const maxWaitTime = 10000;
      const checkInterval = 300;
      let elapsedTime = 0;

      while (elapsedTime < maxWaitTime) {
        const checkScript = `
          (function() {
            if (!window.state || !window.state.cards || window.state.cards.length === 0) {
              return "loading";
            }

            // 检查推荐的卡片是否在当前数据集中
            const cardIds = ${JSON.stringify(cardIds)};
            const existingIds = window.state.cards.map(c => c.id);
            const foundCount = cardIds.filter(id => existingIds.includes(id)).length;

            if (foundCount === 0) {
              return "cards_not_found";
            }

            return "ready";
          })();
        `;

        try {
          const status = await controller.runJavaScript(checkScript);

          if (status === "ready") {
            break;
          } else if (status === "cards_not_found") {
            MNUtil.showHUD("⚠️ 推荐的卡片不在当前索引中");
            return;
          }
        } catch (e) {
          // 继续等待
        }

        await MNUtil.delay(checkInterval / 1000);
        elapsedTime += checkInterval;
      }

      if (elapsedTime >= maxWaitTime) {
        MNUtil.showHUD("⚠️ 数据加载超时");
        return;
      }

      // 3. 调用 Bridge 方法显示推荐卡片
      const showScript = `
        (function() {
          try {
            if (window.Bridge && typeof window.Bridge.showAIRecommendations === 'function') {
              window.Bridge.showAIRecommendations(${JSON.stringify(cardIds)});
              return { success: true };
            } else {
              return { error: '推荐面板尚未就绪，请刷新后重试' };
            }
          } catch (e) {
            return { error: e.message };
          }
        })();
      `;

      const result = await KnowledgeBaseUtils.webViewController.runJavaScript(showScript);

      if (result.error) {
        MNUtil.showHUD("❌ " + result.error);
      } else {
        MNUtil.showHUD(`✅ 已展示 ${cardIds.length} 张推荐卡片`);
      }

    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "showRecommendedCardsInWebView");
      MNUtil.showHUD("❌ 展示推荐卡片失败");
    }
  }

  /**
   * AI 推荐相关卡片（RAG 模式）
   *
   * 功能流程：
   * 1. 获取用户问题
   * 2. 提取关键词并搜索候选卡片
   * 3. 将候选卡片的标题发送给 AI 分析
   * 4. AI 返回最相关的卡片 ID
   * 5. 在 search.html 中可视化展示推荐卡片
   */
  MNKnowledgeBaseClass.prototype.askAIForRelevantCards = async function() {
    try {
      this.checkPopover();

      // 1. 获取用户问题
      let question = await MNUtil.input("请输入您的问题", "");
      if (!question || question.button !== 1 || !question.input || question.input.trim() === "") {
        return;
      }
      const userQuestion = question.input.trim();

      // 2. 提取关键词（简单分词）
      const keywords = this.extractKeywords(userQuestion);
      KnowledgeBaseUtils.log("提取的关键词: " + keywords.join(", "), "askAIForRelevantCards");

      // 3. 在知识库中搜索候选卡片（基于标题）
      MNUtil.showHUD("正在搜索知识库...");
      const candidateCards = await this.searchCardsByKeywords(keywords);

      if (candidateCards.length === 0) {
        MNUtil.showHUD("未找到相关卡片");
        return;
      }

      KnowledgeBaseUtils.log(`找到 ${candidateCards.length} 张候选卡片`, "askAIForRelevantCards");

      // 4. 构建 AI 提示词（只包含卡片ID和标题）
      const prompt = this.buildAIPromptForCardRecommendation(userQuestion, candidateCards);

      // 5. 调用 AI 获取推荐的卡片 ID
      MNUtil.showHUD("正在分析相关性...");
      const aiResponse = await KnowledgeBaseNetwork.callMNAIWithNotification(prompt);

      if (!aiResponse) {
        MNUtil.showHUD("AI 分析失败");
        return;
      }

      // 6. 解析 AI 返回的卡片 ID 列表
      const recommendedCardIds = this.parseCardIdsFromAIResponse(aiResponse);

      if (recommendedCardIds.length === 0) {
        MNUtil.showHUD("AI 未找到相关卡片");
        return;
      }

      KnowledgeBaseUtils.log("AI 推荐的卡片 ID: " + recommendedCardIds.join(", "), "askAIForRelevantCards");

      // 7. 在 search.html 中展示推荐的卡片
      await this.showRecommendedCardsInWebView(recommendedCardIds);

    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "askAIForRelevantCards");
      MNUtil.showHUD("AI 推荐失败：" + error.message);
    }
  }

  /**
   * 显示过程知识库搜索对话框
   */
  MNKnowledgeBaseClass.prototype.showIntermediateSearchDialog = async function(searchData) {
    try {
      const searchModeConfig = KnowledgeBaseTemplate.getSearchConfig();

      const userInput = await MNUtil.userInput(
        `搜索过程知识库 (共 ${searchData.length} 张卡片)`,
        "请输入搜索关键词：",
        ["取消", "搜索"]
      );

      if (userInput.button !== 1) {
        return;
      }

      const rawKeyword = userInput.input.trim();
      if (!rawKeyword) {
        return;
      }

      // 根据配置扩展查询（同义词）
      let expandedKeyword = rawKeyword;
      if (searchModeConfig.useSynonyms) {
        expandedKeyword = KnowledgeBaseIndexer.expandSearchQuery(rawKeyword, true);
      }

      const parsedQuery = KnowledgeBaseSearcher.parseSearchQuery(expandedKeyword);
      const hasConditions = parsedQuery.andGroups.length > 0 ||
        parsedQuery.orGroups.length > 0 ||
        parsedQuery.exactPhrases.length > 0;

      if (!hasConditions) {
        MNUtil.showHUD("请输入有效的搜索条件");
        return;
      }

      const results = [];
      for (const entry of searchData) {
        if (!entry.searchText) continue;

        if (KnowledgeBaseSearcher.matchesQuery(entry.searchText, parsedQuery)) {
          const score = this.calculateIntermediateSearchScore(parsedQuery, entry);

          results.push({
            id: entry.id,
            title: entry.title || "(无标题)",
            isTemplated: entry.isTemplated,
            type: entry.type,
            searchText: entry.searchText,
            score: score
          });
        }
      }

      // 应用排除词过滤
      const filteredResults = KnowledgeBaseIndexer.filterSearchResults(
        results,
        searchModeConfig.useExclusion
      );

      if (!filteredResults || filteredResults.length === 0) {
        MNUtil.showHUD("未找到匹配的卡片");
        return;
      }

      filteredResults.sort((a, b) => (b.score || 0) - (a.score || 0));

      await this.showIntermediateSearchResults(filteredResults, rawKeyword);
    } catch (error) {
      MNUtil.showHUD("搜索失败：" + error.message);
      MNLog.error(error, "MNKnowledgeBase: showIntermediateSearchDialog");
    }
  }

  MNKnowledgeBaseClass.prototype.calculateIntermediateSearchScore = function(parsedQuery, entry) {
    let score = 0;

    if (parsedQuery.exactPhrases && parsedQuery.exactPhrases.length > 0) {
      for (const phrase of parsedQuery.exactPhrases) {
        if (entry.searchText.includes(phrase)) {
          score += 80;
        }
      }
    }

    if (parsedQuery.andGroups && parsedQuery.andGroups.length > 0) {
      for (const group of parsedQuery.andGroups) {
        if (entry.searchText.includes(group)) {
          score += 30;
        }
      }
    }

    if (parsedQuery.orGroups && parsedQuery.orGroups.length > 0) {
      const matched = parsedQuery.orGroups.filter(term => entry.searchText.includes(term));
      score += matched.length * 25;
    }

    if (score === 0 && entry.searchText) {
      score = 10;
    }

    return score;
  }

  /**
   * 显示过程知识库搜索结果
   */
  MNKnowledgeBaseClass.prototype.showIntermediateSearchResults = async function(results, keyword) {
    try {
      // 构建结果选项列表
      const options = ["🔙 返回搜索"];

      // 添加搜索结果（最多显示50个）
      const displayResults = results.slice(0, 50);
      displayResults.forEach((result, index) => {
        const typeInfo = result.isTemplated ? `[${result.type || "已制卡"}]` : "[未制卡]";
        const title = result.title || "(无标题)";
        options.push(`${index + 1}. ${typeInfo} ${title}`);
      });

      if (results.length > 50) {
        options.push(`... 还有 ${results.length - 50} 个结果未显示`);
      }

      // 显示结果列表
      const choice = await MNUtil.userSelect(
        `搜索结果：${keyword} (${results.length} 个)`,
        "选择要查看的卡片：",
        options
      );

      if (choice === 0) {
        // 用户取消
        return;
      } else if (choice === 1) {
        // 返回搜索（使用缓存的数据）
        if (self.intermediateSearchCache && self.intermediateSearchCache.data) {
          this.showIntermediateSearchDialog(self.intermediateSearchCache.data);
        } else {
          // 如果缓存不存在，重新触发搜索
          self.searchInIntermediateKB();
        }
      } else if (choice > 1 && choice <= displayResults.length + 1) {
        // 查看选中的卡片
        const selectedResult = displayResults[choice - 2];
        const note = MNNote.new(selectedResult.id);
        if (note) {
          if (MNUtil.mindmapView) {
            note.focusInMindMap();
          } else {
            MNUtil.showHUD("已选择卡片：" + selectedResult.title);
          }
        }
      }
    } catch (error) {
      MNUtil.showHUD("显示结果失败：" + error.message);
      MNLog.error(error, "MNKnowledgeBase: showIntermediateSearchResults");
    }
  }





  MNKnowledgeBaseClass.prototype.selectMainManifestForWebView = function() {
    let manifest = null
    let actualMode = null

    let fullManifest = null
    let lightManifest = null

    // 读取全量索引 manifest（如果存在）
    let fullManifestPath = `${MNUtil.dbFolder}/data/kb-search-index-full-manifest.json`
    if (MNUtil.isfileExists(fullManifestPath)) {
      fullManifest = MNUtil.readJSON(fullManifestPath)
      KnowledgeBaseUtils.log(
        "📖 找到全量索引",
        "loadSearchDataToWebView",
        {
          updateTime: fullManifest?.metadata?.updateTime,
          lastUpdated: fullManifest?.metadata?.lastUpdated,
          totalCards: fullManifest?.metadata?.totalCards,
        }
      )
    }

    // 读取轻量索引 manifest（如果存在）
    let lightManifestPath = `${MNUtil.dbFolder}/data/kb-search-index-light-manifest.json`
    if (MNUtil.isfileExists(lightManifestPath)) {
      lightManifest = MNUtil.readJSON(lightManifestPath)
      KnowledgeBaseUtils.log(
        "📖 找到轻量索引",
        "loadSearchDataToWebView",
        {
          updateTime: lightManifest?.metadata?.updateTime,
          lastUpdated: lightManifest?.metadata?.lastUpdated,
          totalCards: lightManifest?.metadata?.totalCards,
        }
      )
    }

    // 🆕 智能选择：优先使用配置中的模式，再比较时间戳
    const preferredMode = KnowledgeBaseConfig.config.searchIndexMode || "light"

    // 第一优先级：使用配置中的模式
    if (preferredMode === "full" && fullManifest) {
      manifest = fullManifest
      actualMode = "full"
      KnowledgeBaseUtils.log(
        "✅ 使用全量索引（配置优先）",
        "loadSearchDataToWebView",
        { updateTime: fullManifest.metadata?.updateTime }
      )
    } else if (preferredMode === "light" && lightManifest) {
      manifest = lightManifest
      actualMode = "light"
      KnowledgeBaseUtils.log(
        "✅ 使用轻量索引（配置优先）",
        "loadSearchDataToWebView",
        { updateTime: lightManifest.metadata?.updateTime }
      )
    } else if (fullManifest && lightManifest) {
      // 第二优先级：配置模式不可用，比较时间戳
      const fullTime = fullManifest.metadata?.updateTime || 0
      const lightTime = lightManifest.metadata?.updateTime || 0

      if (fullTime >= lightTime) {
        manifest = fullManifest
        actualMode = "full"
        KnowledgeBaseUtils.log(
          "✅ 使用全量索引（时间戳较新）",
          "loadSearchDataToWebView",
          { fullTime, lightTime }
        )
      } else {
        manifest = lightManifest
        actualMode = "light"
        KnowledgeBaseUtils.log(
          "✅ 使用轻量索引（时间戳较新）",
          "loadSearchDataToWebView",
          { lightTime, fullTime }
        )
      }
    } else if (fullManifest) {
      // 只有全量索引
      manifest = fullManifest
      actualMode = "full"
      KnowledgeBaseUtils.log(
        "✅ 使用全量索引（仅此可用）",
        "loadSearchDataToWebView"
      )
    } else if (lightManifest) {
      // 只有轻量索引
      manifest = lightManifest
      actualMode = "light"
      KnowledgeBaseUtils.log(
        "✅ 使用轻量索引（仅此可用）",
        "loadSearchDataToWebView"
      )
    } else {
      // 都不存在，后续会尝试 legacy
      KnowledgeBaseUtils.log(
        "⚠️ 未找到分片索引",
        "loadSearchDataToWebView",
        { message: "将尝试旧版单文件索引" }
      )
    }

    return { manifest, actualMode }
  }

  MNKnowledgeBaseClass.prototype.getManifestPartsCacheKey = function(manifest, namespace = 'default') {
    const metadata = manifest?.metadata || {}
    const parts = Array.isArray(manifest?.parts) ? manifest.parts : []
    const firstPart = parts.length > 0 ? (parts[0]?.filename || '') : ''
    const lastPart = parts.length > 0 ? (parts[parts.length - 1]?.filename || '') : ''
    const updateTag = metadata.updateTime || metadata.lastUpdated || 0
    const modeTag = metadata.mode || metadata.type || 'unknown'
    const countTag = parts.length
    return `${namespace}:${modeTag}:${updateTag}:${countTag}:${firstPart}:${lastPart}`
  }

  MNKnowledgeBaseClass.prototype.loadCardsFromManifestParts = function(manifest, namespace = 'default') {
    let cards = []
    if (!manifest || !Array.isArray(manifest.parts)) {
      return cards
    }

    this._manifestPartsCache = this._manifestPartsCache || {}
    const cacheKey = this.getManifestPartsCacheKey(manifest, namespace)
    const cached = this._manifestPartsCache[cacheKey]
    if (cached && Array.isArray(cached.cards)) {
      return cached.cards
    }

    for (const partInfo of manifest.parts) {
      let partPath = MNUtil.dbFolder + "/data/" + partInfo.filename
      let partData = MNUtil.readJSON(partPath)
      if (partData && Array.isArray(partData.data)) {
        cards = cards.concat(partData.data)
      }
    }

    this._manifestPartsCache[cacheKey] = {
      cards,
      timestamp: Date.now(),
    }

    const cacheKeys = Object.keys(this._manifestPartsCache)
    const maxCacheEntries = 6
    if (cacheKeys.length > maxCacheEntries) {
      cacheKeys
        .sort((a, b) => {
          const left = this._manifestPartsCache[a]?.timestamp || 0
          const right = this._manifestPartsCache[b]?.timestamp || 0
          return left - right
        })
        .slice(0, cacheKeys.length - maxCacheEntries)
        .forEach(key => {
          delete this._manifestPartsCache[key]
        })
    }

    return cards
  }

  MNKnowledgeBaseClass.prototype.readJSONIfExists = function(path) {
    if (!path || !MNUtil.isfileExists(path)) {
      return null
    }
    try {
      return MNUtil.readJSON(path)
    } catch (error) {
      return null
    }
  }

  MNKnowledgeBaseClass.prototype.buildLegacyIndexSignature = function(indexData, namespace = 'legacy') {
    if (!indexData) {
      return `${namespace}:missing`
    }
    const metadata = indexData.metadata || {}
    const cardsCount = Array.isArray(indexData.cards)
      ? indexData.cards.length
      : (Array.isArray(indexData.searchData) ? indexData.searchData.length : 0)
    const updateTag = metadata.updateTime || metadata.lastUpdated || 0
    const versionTag = metadata.version || '0'
    return `${namespace}:${versionTag}:${updateTag}:${cardsCount}`
  }

  MNKnowledgeBaseClass.prototype.buildIncrementalIndexSignature = function(indexData, namespace = 'incremental') {
    if (!indexData) {
      return `${namespace}:missing`
    }
    const metadata = indexData.metadata || {}
    const cardCount = metadata.cardCount || (Array.isArray(indexData.cards) ? indexData.cards.length : 0)
    const updateTag = metadata.lastUpdated || metadata.updateTime || 0
    const versionTag = metadata.version || '0'
    return `${namespace}:${versionTag}:${updateTag}:${cardCount}`
  }

  MNKnowledgeBaseClass.prototype.buildWebViewSearchDataCacheKey = function() {
    const fullManifestPath = `${MNUtil.dbFolder}/data/kb-search-index-full-manifest.json`
    const lightManifestPath = `${MNUtil.dbFolder}/data/kb-search-index-light-manifest.json`
    const mainLegacyPath = `${MNUtil.dbFolder}/data/kb-search-index.json`
    const mainIncrementalPath = `${MNUtil.dbFolder}/data/kb-incremental-index.json`
    const intermediateManifestPath = `${MNUtil.dbFolder}/data/intermediate-kb-index-manifest.json`
    const intermediateLegacyPath = `${MNUtil.dbFolder}/data/intermediate-kb-index.json`
    const intermediateIncrementalPath = `${MNUtil.dbFolder}/data/intermediate-kb-incremental-index.json`
    const literatureClassificationManifestPath = `${MNUtil.dbFolder}/data/literature-classification-kb-index-manifest.json`
    const literatureClassificationIncrementalPath = `${MNUtil.dbFolder}/data/literature-classification-kb-index-incremental-index.json`
    const historyCardManifestPath = `${MNUtil.dbFolder}/data/history-card-kb-index-manifest.json`
    const historyCardIncrementalPath = `${MNUtil.dbFolder}/data/history-card-kb-index-incremental-index.json`

    const fullManifest = this.readJSONIfExists(fullManifestPath)
    const lightManifest = this.readJSONIfExists(lightManifestPath)
    const preferredMode = KnowledgeBaseConfig.config.searchIndexMode || "light"

    let selectedMainManifest = null
    let selectedMainMode = null

    if (preferredMode === "full" && fullManifest) {
      selectedMainManifest = fullManifest
      selectedMainMode = 'full'
    } else if (preferredMode === "light" && lightManifest) {
      selectedMainManifest = lightManifest
      selectedMainMode = 'light'
    } else if (fullManifest && lightManifest) {
      const fullTime = fullManifest.metadata?.updateTime || 0
      const lightTime = lightManifest.metadata?.updateTime || 0
      if (fullTime >= lightTime) {
        selectedMainManifest = fullManifest
        selectedMainMode = 'full'
      } else {
        selectedMainManifest = lightManifest
        selectedMainMode = 'light'
      }
    } else if (fullManifest) {
      selectedMainManifest = fullManifest
      selectedMainMode = 'full'
    } else if (lightManifest) {
      selectedMainManifest = lightManifest
      selectedMainMode = 'light'
    }

    let mainBaseSignature = 'main:missing'
    if (selectedMainManifest && Array.isArray(selectedMainManifest.parts)) {
      mainBaseSignature = this.getManifestPartsCacheKey(selectedMainManifest, `main-${selectedMainMode || 'sharded'}`)
    } else {
      const mainLegacyIndex = this.readJSONIfExists(mainLegacyPath)
      mainBaseSignature = this.buildLegacyIndexSignature(mainLegacyIndex, 'main-legacy')
      if (mainLegacyIndex && !selectedMainMode) {
        selectedMainMode = 'legacy'
      }
    }

    const mainIncrementalIndex = this.readJSONIfExists(mainIncrementalPath)
    const mainIncrementalSignature = this.buildIncrementalIndexSignature(mainIncrementalIndex, 'main-incremental')

    const intermediateManifest = this.readJSONIfExists(intermediateManifestPath)
    let intermediateBaseSignature = 'intermediate:missing'
    if (intermediateManifest && Array.isArray(intermediateManifest.parts)) {
      intermediateBaseSignature = this.getManifestPartsCacheKey(intermediateManifest, 'intermediate-sharded')
    } else {
      const intermediateLegacyIndex = this.readJSONIfExists(intermediateLegacyPath)
      intermediateBaseSignature = this.buildLegacyIndexSignature(intermediateLegacyIndex, 'intermediate-legacy')
    }

    const intermediateIncrementalIndex = this.readJSONIfExists(intermediateIncrementalPath)
    const intermediateIncrementalSignature = this.buildIncrementalIndexSignature(
      intermediateIncrementalIndex,
      'intermediate-incremental'
    )

    const literatureClassificationManifest = this.readJSONIfExists(literatureClassificationManifestPath)
    let literatureClassificationBaseSignature = 'literature-classification:missing'
    if (literatureClassificationManifest && Array.isArray(literatureClassificationManifest.parts)) {
      literatureClassificationBaseSignature = this.getManifestPartsCacheKey(
        literatureClassificationManifest,
        'literature-classification-sharded'
      )
    }

    const literatureClassificationIncrementalIndex = this.readJSONIfExists(literatureClassificationIncrementalPath)
    const literatureClassificationIncrementalSignature = this.buildIncrementalIndexSignature(
      literatureClassificationIncrementalIndex,
      'literature-classification-incremental'
    )

    const historyCardManifest = this.readJSONIfExists(historyCardManifestPath)
    let historyCardBaseSignature = 'history-card:missing'
    if (historyCardManifest && Array.isArray(historyCardManifest.parts)) {
      historyCardBaseSignature = this.getManifestPartsCacheKey(historyCardManifest, 'history-card-sharded')
    }

    const historyCardIncrementalIndex = this.readJSONIfExists(historyCardIncrementalPath)
    const historyCardIncrementalSignature = this.buildIncrementalIndexSignature(
      historyCardIncrementalIndex,
      'history-card-incremental'
    )

    return [
      `preferredMode:${preferredMode}`,
      `selectedMainMode:${selectedMainMode || 'none'}`,
      mainBaseSignature,
      mainIncrementalSignature,
      intermediateBaseSignature,
      intermediateIncrementalSignature,
      literatureClassificationBaseSignature,
      literatureClassificationIncrementalSignature,
      historyCardBaseSignature,
      historyCardIncrementalSignature,
    ].join('|')
  }

  MNKnowledgeBaseClass.prototype.getWebViewSearchDataCachePath = function() {
    return `${MNUtil.dbFolder}/data/kb-webview-search-data-cache.json`
  }

  MNKnowledgeBaseClass.prototype.readPersistentWebViewSearchDataCache = function(cacheKey) {
    try {
      if (!cacheKey) return null

      const cachePath = this.getWebViewSearchDataCachePath()
      const cacheData = this.readJSONIfExists(cachePath)
      if (
        !cacheData
        || cacheData.version !== 1
        || cacheData.key !== cacheKey
        || !cacheData.fullIndexData
        || !Array.isArray(cacheData.fullIndexData.cards)
      ) {
        return null
      }

      return cacheData.fullIndexData
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "readPersistentWebViewSearchDataCache")
      return null
    }
  }

  MNKnowledgeBaseClass.prototype.writePersistentWebViewSearchDataCache = function(cacheKey, fullIndexData) {
    try {
      if (!cacheKey || !fullIndexData || !Array.isArray(fullIndexData.cards)) {
        return false
      }

      MNUtil.writeJSON(this.getWebViewSearchDataCachePath(), {
        version: 1,
        key: cacheKey,
        timestamp: Date.now(),
        fullIndexData,
      })
      return true
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "writePersistentWebViewSearchDataCache")
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.loadMainKnowledgeBaseCards = function() {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== 开始加载主知识库 ===")

    const selected = this.selectMainManifestForWebView()
    const manifest = selected.manifest
    let actualMode = selected.actualMode
    let allCards = []
    let metadata = {}

    // 1.3 加载分片索引数据
    if (manifest && Array.isArray(manifest.parts)) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', `加载 ${actualMode} 模式分片索引数据（${manifest.parts.length} 个分片）`)
      allCards = this.loadCardsFromManifestParts(manifest, 'main')
      metadata = manifest.metadata || {}
      KnowledgeBaseUtils.log(
        "📊 主知识库 manifest 已加载",
        "loadSearchDataToWebView",
        {
          mode: actualMode,
          metadata: metadata,
        }
      )
    } else {
      // 1.4 尝试加载旧版单文件索引
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "[3/3] 分片索引不存在，尝试加载旧版单文件索引")
      let indexPath = MNUtil.dbFolder + "/data/kb-search-index.json"
      let indexData = MNUtil.readJSON(indexPath)

      if (!indexData || !indexData.cards) {
        MNUtil.showHUD("❌ 未找到任何索引文件\n请先执行「🔄 索引知识库」")
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "错误：未找到任何可用的索引文件（full/light/旧版）")
        return null
      }

      KnowledgeBaseUtils.emitRuntimeLog('INFO', "✅ 找到旧版单文件索引")
      actualMode = "legacy"
      allCards = indexData.cards
      metadata = indexData.metadata || {}
    }

    KnowledgeBaseUtils.emitRuntimeLog('INFO', `主知识库加载完成：${allCards.length} 张卡片`)

    // 1.2 加载主知识库增量索引（如果存在）
    let incrementalPath = MNUtil.dbFolder + "/data/kb-incremental-index.json"
    if (MNUtil.isfileExists(incrementalPath)) {
      let incrementalData = MNUtil.readJSON(incrementalPath)
      if (incrementalData && incrementalData.cards) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', `加载主知识库增量索引：${incrementalData.cards.length} 张卡片`)
        allCards = this.mergeCardsById(
          allCards,
          incrementalData.cards,
          KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex(incrementalData)
        )
      }
    }

    return {
      cards: this.tagSearchCardsWithIndexSource(allCards, 'main'),
      metadata,
      actualMode,
    }
  }

  MNKnowledgeBaseClass.prototype.normalizeSearchIndexSource = function(source) {
    const normalized = String(source || '').trim().toLowerCase()
    const aliases = {
      main: 'main',
      knowledge: 'main',
      'knowledge-base': 'main',
      intermediate: 'intermediate',
      'intermediate-kb': 'intermediate',
      'literature-classification': 'literature-classification',
      literature: 'literature-classification',
      'history-card': 'history-card',
      history: 'history-card',
    }
    return aliases[normalized] || ''
  }

  MNKnowledgeBaseClass.prototype.getSearchIndexSourceSpec = function(source) {
    const normalized = this.normalizeSearchIndexSource(source)
    const specs = {
      main: {
        source: 'main',
        indexPrefix: '',
      },
      intermediate: {
        source: 'intermediate',
        indexPrefix: 'intermediate-kb-index',
      },
      'literature-classification': {
        source: 'literature-classification',
        indexPrefix: 'literature-classification-kb-index',
      },
      'history-card': {
        source: 'history-card',
        indexPrefix: 'history-card-kb-index',
      },
    }
    return specs[normalized] || null
  }

  MNKnowledgeBaseClass.prototype.tagSearchCardsWithIndexSource = function(cards = [], source = '') {
    const normalized = this.normalizeSearchIndexSource(source)
    if (!normalized || !Array.isArray(cards)) return cards
    cards.forEach((card) => {
      if (card && typeof card === 'object' && card.id) {
        card.indexSource = normalized
        delete card.indexSources // Rebuild membership from the current source indexes.
      }
    })
    return cards
  }

  MNKnowledgeBaseClass.prototype.resolveSearchIndexSource = function(noteId, requestedSource = '') {
    const normalizedRequested = this.normalizeSearchIndexSource(requestedSource)
    if (normalizedRequested) return normalizedRequested

    const id = noteId === undefined || noteId === null ? '' : String(noteId).trim()
    if (!id) return 'main'

    const cachedCard = (this._webViewSearchDataCache?.fullIndexData?.cards || [])
      .find(card => String(card?.id || '').trim() === id)
    const cachedSource = this.normalizeSearchIndexSource(cachedCard?.indexSource)
    if (cachedSource) return cachedSource

    const sourceLoaders = [
      ['history-card', () => this.loadHistoryCardKnowledgeBaseCards()],
      ['literature-classification', () => this.loadLiteratureClassificationKnowledgeBaseCards()],
      ['intermediate', () => this.loadIntermediateKnowledgeBaseCards()],
      ['main', () => this.loadMainKnowledgeBaseCards()?.cards || []],
    ]
    for (const [source, loadCards] of sourceLoaders) {
      try {
        const cards = loadCards()
        if (Array.isArray(cards) && cards.some(card => String(card?.id || '').trim() === id)) {
          return source
        }
      } catch (error) {
        KnowledgeBaseUtils.log('反查卡片索引来源失败', 'resolveSearchIndexSource', {
          noteId: id,
          source,
          error: error && error.message ? error.message : String(error),
        })
      }
    }

    return 'main'
  }

  MNKnowledgeBaseClass.prototype.loadIntermediateKnowledgeBaseCards = function() {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== 开始加载过程知识库 ===")

    let intermediateCards = []

    // 2.1 尝试加载过程知识库的分片索引
    let intermediateManifestPath = MNUtil.dbFolder + "/data/intermediate-kb-index-manifest.json"
    let intermediateManifest = MNUtil.readJSON(intermediateManifestPath)

    if (intermediateManifest && Array.isArray(intermediateManifest.parts)) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "加载过程知识库分片索引数据")
      intermediateCards = this.loadCardsFromManifestParts(intermediateManifest, 'intermediate')
    } else {
      // 旧版模式：尝试加载单文件
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "尝试加载旧版过程知识库单文件索引")
      let intermediateIndexPath = MNUtil.dbFolder + "/data/intermediate-kb-index.json"
      let intermediateIndexData = MNUtil.readJSON(intermediateIndexPath)

      if (intermediateIndexData && intermediateIndexData.cards) {
        intermediateCards = intermediateIndexData.cards
      } else {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "过程知识库索引未找到（跳过）")
      }
    }

    // 2.2 加载过程知识库的增量索引（如果存在）
    let intermediateIncrementalPath = MNUtil.dbFolder + "/data/intermediate-kb-incremental-index.json"
    if (MNUtil.isfileExists(intermediateIncrementalPath)) {
      let intermediateIncrementalData = MNUtil.readJSON(intermediateIncrementalPath)
      if (intermediateIncrementalData && intermediateIncrementalData.cards) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', `加载过程知识库增量索引：${intermediateIncrementalData.cards.length} 张卡片`)
        intermediateCards = this.mergeCardsById(
          intermediateCards,
          intermediateIncrementalData.cards,
          KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex(intermediateIncrementalData)
        )
      }
    }

    return this.tagSearchCardsWithIndexSource(intermediateCards, 'intermediate')
  }

  MNKnowledgeBaseClass.prototype.loadLiteratureClassificationKnowledgeBaseCards = function() {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== 开始加载文献归类知识库 ===")

    let cards = []
    const indexPrefix = 'literature-classification-kb-index'
    const manifest = IntermediateKnowledgeIndexer.loadIndexManifest(indexPrefix)

    if (manifest && Array.isArray(manifest.parts)) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "加载文献归类知识库分片索引数据")
      cards = this.loadCardsFromManifestParts(manifest, 'literature-classification')
    } else {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "文献归类知识库索引未找到（跳过）")
    }

    const incrementalData = IntermediateKnowledgeIndexer.loadIncrementalIndex(indexPrefix)
    if (incrementalData && incrementalData.cards) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', `加载文献归类知识库增量索引：${incrementalData.cards.length} 张卡片`)
      cards = this.mergeCardsById(
        cards,
        incrementalData.cards,
        KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex(incrementalData)
      )
    }

    return this.tagSearchCardsWithIndexSource(cards, 'literature-classification')
  }

  MNKnowledgeBaseClass.prototype.loadHistoryCardKnowledgeBaseCards = function() {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== 开始加载历史卡片索引 ===")

    let cards = []
    const indexPrefix = 'history-card-kb-index'
    const manifest = IntermediateKnowledgeIndexer.loadIndexManifest(indexPrefix)

    if (manifest && Array.isArray(manifest.parts)) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "加载历史卡片分片索引数据")
      cards = this.loadCardsFromManifestParts(manifest, 'history-card')
    } else {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "历史卡片索引未找到（跳过）")
    }

    const incrementalData = IntermediateKnowledgeIndexer.loadIncrementalIndex(indexPrefix)
    if (incrementalData && incrementalData.cards) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', `加载历史卡片增量索引：${incrementalData.cards.length} 张卡片`)
      cards = this.mergeCardsById(
        cards,
        incrementalData.cards,
        KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex(incrementalData)
      )
    }

    return this.tagSearchCardsWithIndexSource(cards, 'history-card')
  }

  MNKnowledgeBaseClass.prototype.getActualSearchIndexSourceRevisions = function(mainData = {}) {
    const compactMetadata = (metadata = {}) => ({
      version: metadata.version || '',
      mode: metadata.mode || metadata.type || '',
      updateTime: metadata.updateTime || 0,
      lastUpdated: metadata.lastUpdated || '',
      totalCards: metadata.totalCards || metadata.cardCount || 0,
      totalParts: metadata.totalParts || 0,
    })
    const readSourceRevision = (indexPrefix, legacyFilename, incrementalFilename) => {
      let manifest = null
      let incremental = null
      if (typeof IntermediateKnowledgeIndexer !== 'undefined' && IntermediateKnowledgeIndexer) {
        if (typeof IntermediateKnowledgeIndexer.loadIndexManifest === 'function') {
          manifest = IntermediateKnowledgeIndexer.loadIndexManifest(indexPrefix)
        }
        if (typeof IntermediateKnowledgeIndexer.loadIncrementalIndex === 'function') {
          incremental = IntermediateKnowledgeIndexer.loadIncrementalIndex(indexPrefix)
        }
      }
      const legacy = manifest
        ? null
        : this.readJSONIfExists(`${MNUtil.dbFolder}/data/${legacyFilename}`)
      if (!incremental) {
        incremental = this.readJSONIfExists(`${MNUtil.dbFolder}/data/${incrementalFilename}`)
      }
      return {
        base: compactMetadata((manifest || legacy || {}).metadata || {}),
        incremental: compactMetadata((incremental || {}).metadata || {}),
      }
    }

    const mainIncremental = this.readJSONIfExists(`${MNUtil.dbFolder}/data/kb-incremental-index.json`)
    return {
      main: {
        base: compactMetadata(mainData.metadata || {}),
        incremental: compactMetadata((mainIncremental || {}).metadata || {}),
      },
      intermediate: readSourceRevision(
        'intermediate-kb-index',
        'intermediate-kb-index.json',
        'intermediate-kb-incremental-index.json'
      ),
      'literature-classification': readSourceRevision(
        'literature-classification-kb-index',
        'literature-classification-kb-index.json',
        'literature-classification-kb-index-incremental-index.json'
      ),
      'history-card': readSourceRevision(
        'history-card-kb-index',
        'history-card-kb-index.json',
        'history-card-kb-index-incremental-index.json'
      ),
    }
  }

  MNKnowledgeBaseClass.prototype.buildActualSearchIndexExportData = function() {
    const mainData = this.loadMainKnowledgeBaseCards()
    if (!mainData || !Array.isArray(mainData.cards)) {
      throw new Error('未找到主知识库索引，请先执行“索引主知识库”')
    }

    const sources = [
      { name: 'main', cards: mainData.cards },
      { name: 'intermediate', cards: this.loadIntermediateKnowledgeBaseCards() },
      { name: 'literature-classification', cards: this.loadLiteratureClassificationKnowledgeBaseCards() },
      { name: 'history-card', cards: this.loadHistoryCardKnowledgeBaseCards() },
    ]
    let allCards = []
    const sourceStats = {}

    sources.forEach(({ name, cards }) => {
      const sourceCards = Array.isArray(cards) ? cards : []
      const previousIds = new Set(allCards
        .map(card => card && card.id !== undefined && card.id !== null ? String(card.id).trim() : '')
        .filter(Boolean))
      const incomingIds = new Set()
      let validIdCount = 0
      sourceCards.forEach(card => {
        const id = card && card.id !== undefined && card.id !== null ? String(card.id).trim() : ''
        if (!id) return
        validIdCount += 1
        incomingIds.add(id)
      })
      let replacedExistingIds = 0
      incomingIds.forEach(id => {
        if (previousIds.has(id)) replacedExistingIds += 1
      })
      allCards = this.mergeCardsById(allCards, sourceCards)
      sourceStats[name] = {
        loadedCards: sourceCards.length,
        validIdCards: validIdCount,
        uniqueIds: incomingIds.size,
        duplicateIdsWithinSource: Math.max(0, validIdCount - incomingIds.size),
        addedIds: Math.max(0, incomingIds.size - replacedExistingIds),
        replacedExistingIds,
        finalCards: 0,
      }
    })

    const knownRemovedIds = this.getWebViewKnownRemovedSearchIds(allCards)
    const filtered = this.filterKnownRemovedSearchCards(allCards, knownRemovedIds)
    allCards = filtered.cards
    allCards.forEach(card => {
      const source = this.normalizeSearchIndexSource(card?.indexSource) || 'unknown'
      if (!sourceStats[source]) {
        sourceStats[source] = {
          loadedCards: 0,
          validIdCards: 0,
          uniqueIds: 0,
          duplicateIdsWithinSource: 0,
          addedIds: 0,
          replacedExistingIds: 0,
          finalCards: 0,
        }
      }
      sourceStats[source].finalCards += 1
    })

    return {
      metadata: {
        exportSchema: 'mnkb.actual-search-index.v1',
        generatedAt: new Date().toISOString(),
        totalCards: allCards.length,
        mode: mainData.actualMode || mainData.metadata?.mode || '',
        mergeOrder: sources.map(source => source.name),
        sourceSignature: this.buildWebViewSearchDataCacheKey(),
        sourceStats,
        sourceRevisions: this.getActualSearchIndexSourceRevisions(mainData),
        filteredKnownRemovedCount: filtered.removedIds.length,
        filteredKnownRemovedIds: filtered.removedIds.slice(0, 100),
      },
      searchData: allCards,
    }
  }

  MNKnowledgeBaseClass.prototype.exportActualSearchIndexInternal = function() {
    this.checkPopover()
    MNUtil.showHUD('正在准备实际搜索索引...')

    const exportData = this.buildActualSearchIndexExportData()
    let exportBasePath = MNUtil.tempPath || MNUtil.tempFolder
    if (!exportBasePath) {
      try {
        exportBasePath = NSSearchPathForDirectoriesInDomains(9, 1, true).firstObject
      } catch (_) {}
    }
    if (!exportBasePath && MNUtil.dbFolder) {
      exportBasePath = `${MNUtil.dbFolder}/data`
    }
    if (!exportBasePath) {
      throw new Error('无法获取导出目录')
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    const filepath = `${exportBasePath}/kb-search-index-actual-merged-${timestamp}.json`
    MNUtil.writeJSON(filepath, exportData)
    try {
      MNUtil.saveFile(filepath, 'public.json')
    } catch (_) {
      MNUtil.saveFile(filepath, ['public.json'])
    }

    const stats = exportData.metadata.sourceStats
    MNUtil.showHUD(
      `实际搜索索引已导出：${exportData.searchData.length} 张\n`
      + `主 ${stats.main.finalCards} · 过程 ${stats.intermediate.finalCards} · 文献 ${stats['literature-classification'].finalCards} · 历史 ${stats['history-card'].finalCards}`
    )
    return {
      success: true,
      filepath,
      totalCards: exportData.searchData.length,
      sourceStats: stats,
    }
  }

  MNKnowledgeBaseClass.prototype.pushSearchIndexToWebView = async function(fullIndexData, options = {}) {
    const refreshRequestId = options && options.refreshRequestId
      ? String(options.refreshRequestId)
      : ''
    const payload = JSON.stringify(fullIndexData || {})
    const pushOptions = JSON.stringify({
      refreshRequestId,
    })
    const script = `
      (function(indexData, pushOptions) {
        try {
          const expectedCount = Array.isArray(indexData && indexData.cards) ? indexData.cards.length : 0
          const getCardsCount = function() {
            if (!window.state || !Array.isArray(window.state.cards)) {
              return -1
            }
            return window.state.cards.length
          }

          const beforeCount = getCardsCount()
          let bridgeError = ''
          let bridgeResultType = 'undefined'

          try {
            if (window.Bridge && typeof window.Bridge.loadSearchIndex === 'function') {
              const bridgeResult = window.Bridge.loadSearchIndex(indexData, pushOptions || {})
              bridgeResultType = typeof bridgeResult
            } else {
              bridgeError = 'Bridge.loadSearchIndex 不存在'
            }
          } catch (error) {
            bridgeError = error && error.message ? error.message : String(error)
          }

          const afterBridgeCount = getCardsCount()
          let fallbackApplied = false
          let fallbackError = ''

          if (afterBridgeCount !== expectedCount) {
            try {
              if (typeof setCardsForDataset === 'function') {
                setCardsForDataset('knowledge', (indexData && indexData.cards) || [], { replace: true })
                if (window.state && indexData && indexData.metadata) {
                  window.state.metadata = indexData.metadata
                  window.state.indexMode = indexData.metadata.mode || window.state.indexMode
                }
                fallbackApplied = true
              } else if (window.MNKB && typeof window.MNKB.setSearchResults === 'function') {
                window.MNKB.setSearchResults((indexData && indexData.cards) || [], {
                  replace: true,
                  datasetKey: 'knowledge',
                })
                fallbackApplied = true
              } else {
                fallbackError = 'setCardsForDataset 与 MNKB.setSearchResults 均不可用'
              }
            } catch (error) {
              fallbackError = error && error.message ? error.message : String(error)
            }
          }

          const finalCount = getCardsCount()
          const ok = finalCount === expectedCount

          return {
            ok,
            expectedCount,
            beforeCount,
            afterBridgeCount,
            finalCount,
            fallbackApplied,
            bridgeError,
            fallbackError,
            bridgeResultType,
          }
        } catch (error) {
          return {
            ok: false,
            error: error && error.message ? error.message : String(error),
          }
        }
      })(${payload}, ${pushOptions})
    `
    return KnowledgeBaseUtils.webViewController.runJavaScript(script)
  }

  MNKnowledgeBaseClass.prototype.pushSearchIndexPatchToWebView = async function(patchData, options = {}) {
    await MNUtil.delay(0.2)
    const refreshRequestId = options && options.refreshRequestId
      ? String(options.refreshRequestId)
      : ''
    const payload = JSON.stringify(patchData || {})
    const pushOptions = JSON.stringify({
      refreshRequestId,
    })
    const script = `
      (function(data, pushOptions) {
        try {
          if (window.Bridge && typeof window.Bridge.applySearchIndexPatch === 'function') {
            const result = window.Bridge.applySearchIndexPatch(data, pushOptions || {})
            return {
              ok: result !== false,
              resultType: typeof result,
            }
          }
          return {
            ok: false,
            error: 'Bridge.applySearchIndexPatch 不存在',
          }
        } catch (error) {
          return {
            ok: false,
            error: error && error.message ? error.message : String(error),
          }
        }
      })(${payload}, ${pushOptions})
    `
    return KnowledgeBaseUtils.webViewController.runJavaScript(script)
  }

  MNKnowledgeBaseClass.prototype.enqueueSearchDataOperation = function(label, operation) {
    const previous = this._searchDataOperationQueue || Promise.resolve()
    const current = previous
      .catch((error) => {
        KnowledgeBaseUtils.log("上一项搜索数据操作失败，继续执行队列", "enqueueSearchDataOperation", {
          label,
          error: error && error.message ? error.message : String(error),
        })
      })
      .then(() => operation())

    this._searchDataOperationQueue = current
    const clearQueue = () => {
      if (this._searchDataOperationQueue === current) {
        this._searchDataOperationQueue = null
      }
    }
    current.then(clearQueue, clearQueue)
    return current
  }

  MNKnowledgeBaseClass.prototype.refreshSearchCardIndex = function(noteId, options = {}) {
    return this.enqueueSearchDataOperation("refreshSearchCardIndex", () => {
      return this._refreshSearchCardIndex(noteId, options)
    })
  }

  MNKnowledgeBaseClass.prototype._refreshSearchCardIndex = async function(noteId, options = {}) {
    const rawId = noteId === undefined || noteId === null ? '' : String(noteId).trim()
    const {
      showErrorHUD = true,
      showSuccessHUD = true,
      refreshRequestId = '',
      indexSource = '',
    } = options || {}

    if (!rawId) {
      if (showErrorHUD) {
        MNUtil.showHUD('❌ 缺少卡片 ID')
      }
      return {
        success: false,
        error: '缺少卡片 ID',
      }
    }

    const resolvedIndexSource = this.resolveSearchIndexSource(rawId, indexSource)
    const sourceSpec = this.getSearchIndexSourceSpec(resolvedIndexSource) || {
      source: 'main',
      indexPrefix: '',
    }
    const note = MNNote.new(rawId, false)
    if (!note) {
      const removeResult = await this.removeSearchCardIndex(rawId, {
        showHUD: false,
        refreshRequestId,
        reason: 'refreshSearchCardIndex.noteMissing',
        indexSource: resolvedIndexSource,
      })
      if (showErrorHUD) {
        MNUtil.showHUD('❌ 未找到卡片，已从索引移除')
      }
      return {
        success: !!(removeResult && removeResult.success),
        error: '未找到卡片',
        id: rawId,
        removedIds: removeResult?.removedIds || [rawId],
        source: removeResult?.source || 'persist-only',
      }
    }

    const mode = KnowledgeBaseConfig.getSearchIndexMode()
    const indexedNote = this.convertExcerptToNoExcerptIfNeeded(note) || note
    const indexedNoteId = indexedNote && indexedNote.noteId ? String(indexedNote.noteId) : rawId
    const staleIds = indexedNoteId === rawId ? [] : [rawId]
    const previousUsageScore = this.normalizeSearchUsageScore(
      (this._webViewSearchDataCache?.fullIndexData?.cards || [])
        .find(card => String(card?.id || '').trim() === indexedNoteId)?.usageScore,
    )
    let incrementalResult
    if (sourceSpec.source === 'main') {
      incrementalResult = KnowledgeBaseIndexer.upsertIncrementalIndexEntry(indexedNote, mode, {
        staleIds,
        usageScore: previousUsageScore,
      })
    } else if (typeof IntermediateKnowledgeIndexer !== 'undefined' &&
      IntermediateKnowledgeIndexer &&
      typeof IntermediateKnowledgeIndexer.upsertIncrementalIndexEntry === 'function') {
      incrementalResult = IntermediateKnowledgeIndexer.upsertIncrementalIndexEntry(indexedNote, {
        indexPrefix: sourceSpec.indexPrefix,
        staleIds,
        mode: 'light',
        showErrorHUD: false,
        usageScore: previousUsageScore,
      })
    } else {
      incrementalResult = {
        success: false,
        error: '过程知识库索引器未就绪',
      }
    }
    if (!incrementalResult || incrementalResult.success !== true || !incrementalResult.entry) {
      const errorMessage = incrementalResult?.error || '刷新索引失败'
      if (showErrorHUD) {
        MNUtil.showHUD(`❌ ${errorMessage}`)
      }
      return {
        success: false,
        error: errorMessage,
        id: indexedNoteId,
      }
    }

    const entry = {
      ...incrementalResult.entry,
      indexSource: sourceSpec.source,
    }
    const patchData = {
      upserts: [entry],
      removedIds: incrementalResult.removedIds || staleIds,
      metadata: {
        mode,
        indexSource: sourceSpec.source,
        updateTime: Math.floor(Date.now() / 1000),
      },
    }
    this.recordPersistedSearchIndexPatch(patchData)

    const controller = KnowledgeBaseUtils.webViewController
    const canPushPatch = !!(
      controller
      && controller.webViewLoaded
      && controller.currentHTMLType === 'search'
      && controller.webView
    )

    let pushResult = null
    let source = 'persist-only'

    if (canPushPatch) {
      pushResult = await this.pushSearchIndexPatchToWebView(patchData, {
        refreshRequestId,
      })
      source = this.isWebViewPushResultSuccess(pushResult) ? 'patch' : 'fallback'
    }

    if (canPushPatch && !this.isWebViewPushResultSuccess(pushResult)) {
      const fallback = await this._loadSearchDataToWebView({
        showSuccessHUD: false,
        showErrorHUD,
        refreshRequestId,
      })
      if (!fallback || fallback.success === false) {
        if (showErrorHUD) {
          MNUtil.showHUD('❌ 更新索引失败')
        }
        return {
          success: false,
          error: fallback?.error || '更新索引失败',
          id: indexedNoteId,
        }
      }
      source = 'full-refresh-fallback'
    }

    if (showSuccessHUD) {
      MNUtil.showHUD('✅ 已更新当前卡片索引')
    }

    return {
      success: true,
      id: indexedNoteId,
      originalId: rawId,
      entry,
      removedIds: patchData.removedIds,
      source,
      cardCount: incrementalResult.cardCount || 0,
      mode,
      indexSource: sourceSpec.source,
    }
  }

  MNKnowledgeBaseClass.prototype.isWebViewPushResultSuccess = function(result) {
    if (result === false) return false
    if (result && typeof result === 'object') {
      if (result.ok === false) return false
      if (result.error) return false
    }
    return true
  }

  MNKnowledgeBaseClass.prototype.isSameIndexCard = function(left, right) {
    if (left === right) return true
    if (!left || !right) return false

    const fields = [
      'id',
      'type',
      'classificationSubtype',
      'title',
      'parentId',
      'prefix',
      'content',
      'titleLinkWords',
      'keywords',
      'excerptArea',
      'searchText',
      'indexSource',
      'usageScore',
    ]

    for (const field of fields) {
      if ((left[field] || '') !== (right[field] || '')) {
        return false
      }
    }

    const leftExcluded = left.excludedGroups
    const rightExcluded = right.excludedGroups
    if (!leftExcluded && !rightExcluded) {
      return true
    }

    const leftExcludedStr = JSON.stringify(leftExcluded || [])
    const rightExcludedStr = JSON.stringify(rightExcluded || [])
    if (leftExcludedStr !== rightExcludedStr) return false

    const leftEvidenceStr = JSON.stringify(left.searchEvidence || [])
    const rightEvidenceStr = JSON.stringify(right.searchEvidence || [])
    return leftEvidenceStr === rightEvidenceStr
  }

  MNKnowledgeBaseClass.prototype.buildSearchIndexPatch = function(previousData, nextData) {
    const previousCards = Array.isArray(previousData?.cards) ? previousData.cards : []
    const nextCards = Array.isArray(nextData?.cards) ? nextData.cards : []

    const previousMap = new Map()
    for (const card of previousCards) {
      const id = card?.id
      if (!id) continue
      previousMap.set(String(id), card)
    }

    const nextMap = new Map()
    for (const card of nextCards) {
      const id = card?.id
      if (!id) continue
      nextMap.set(String(id), card)
    }

    const upserts = []
    for (const [id, nextCard] of nextMap.entries()) {
      const previousCard = previousMap.get(id)
      if (!previousCard || !this.isSameIndexCard(previousCard, nextCard)) {
        upserts.push(nextCard)
      }
    }

    const removedIds = []
    for (const id of previousMap.keys()) {
      if (!nextMap.has(id)) {
        removedIds.push(id)
      }
    }

    return {
      baseCount: previousCards.length,
      nextCount: nextCards.length,
      upserts,
      removedIds,
      metadata: nextData?.metadata || {},
    }
  }

  MNKnowledgeBaseClass.prototype.shouldUseSearchIndexPatch = function(patchData) {
    if (!patchData) return false
    const changeCount = (patchData.upserts?.length || 0) + (patchData.removedIds?.length || 0)
    const nextCount = patchData.nextCount || 0
    if (changeCount <= 0) return false
    if (nextCount <= 0) return false

    const threshold = Math.max(200, Math.floor(nextCount * 0.2))
    return changeCount <= threshold
  }

  MNKnowledgeBaseClass.prototype.ensureSearchWebViewReady = async function(options = {}) {
    const {
      showHUDWhileReload = false,
      maxWaitLoops = 10,
      waitInterval = 0.2,
      forceBringToFront = false,
      beginFrame,
      endFrame,
    } = options || {}

    // 确保控制器已初始化
    KnowledgeBaseUtils.checkWebViewController()
    const controller = KnowledgeBaseUtils.webViewController
    if (!controller) {
      return null
    }

    // 如果正在动画中,等待动画完成后继续
    if (controller.onAnimate) {
      await MNUtil.delay(0.5)
      return this.ensureSearchWebViewReady(options)
    }

    // 检查是否需要重新加载 HTML
    const needReload = controller.currentHTMLType !== 'search' || !controller.webViewLoaded

    // 锁定打开搜索时的 focusNote，避免后续 WebView 操作阶段取到错误焦点卡片
    const shouldCaptureFocusNote = controller.view.hidden || needReload || !controller.searchFocusNoteId
    if (shouldCaptureFocusNote) {
      const currentFocusNote = MNNote.getFocusNote()
      const currentFocusNoteId = currentFocusNote && currentFocusNote.noteId
        ? String(currentFocusNote.noteId).trim()
        : ''
      if (currentFocusNoteId) {
        controller.searchFocusNoteId = currentFocusNoteId
        KnowledgeBaseUtils.log("锁定搜索 focusNote", "ensureSearchWebViewReady", {
          focusNoteId: currentFocusNoteId,
          reason: controller.view.hidden ? 'viewHidden' : (needReload ? 'needReload' : 'missingLock'),
        })
      }
    }

    if (typeof controller.captureSearchSelectionContext === 'function') {
      controller.captureSearchSelectionContext({
        clearWhenMissing: true,
        reason: controller.view.hidden ? 'viewHidden' : (needReload ? 'needReload' : 'bridgeReuse'),
      })
    }

    if (needReload) {
      if (showHUDWhileReload) {
        MNUtil.showHUD("正在加载搜索界面，请稍候...")
      }
      controller.loadHTMLFile()
    }

    // show 时允许自定义 frame，不传 endFrame 则按原逻辑恢复上次大小
    if (typeof beginFrame !== 'undefined' || typeof endFrame !== 'undefined') {
      await controller.show(beginFrame, endFrame)
    } else {
      await controller.show()
    }

    if (forceBringToFront) {
      MNUtil.studyView.bringSubviewToFront(controller.view)
    }

    // 等待页面就绪
    for (let i = 0; i < maxWaitLoops; i++) {
      if (controller.webViewLoaded && controller.currentHTMLType === "search") {
        break
      }
      await MNUtil.delay(waitInterval)
    }

    return controller
  }

  MNKnowledgeBaseClass.prototype.runSearchWebViewBridge = async function(script, options = {}) {
    const controller = await this.ensureSearchWebViewReady(options)
    if (!controller) {
      return null
    }
    return controller.runJavaScript(script)
  }

  /**
   * 加载搜索数据到 WebView（合并主知识库和过程知识库）
   */
  MNKnowledgeBaseClass.prototype.loadSearchDataToWebView = function(options = {}) {
    return this.enqueueSearchDataOperation("loadSearchDataToWebView", () => {
      return this._loadSearchDataToWebView(options)
    })
  }

  MNKnowledgeBaseClass.prototype._loadSearchDataToWebView = async function(options = {}) {
    try {
      const startupPerfStart = Date.now()
      let startupPerfLast = startupPerfStart
      const logStartupPerf = (stage, detail = {}) => {
        try {
          const now = Date.now()
          const elapsed = now - startupPerfStart
          const lap = now - startupPerfLast
          startupPerfLast = now
          const detailText = detail && typeof detail === 'object'
            ? JSON.stringify(detail)
            : (detail ? String(detail) : '')
          KnowledgeBaseUtils.emitRuntimeLog('INFO', `[MNKB Startup][native] +${elapsed}ms (+${lap}ms) ${stage}${detailText ? ' | ' + detailText : ''}`)
        } catch (logError) {
          // 性能日志不能影响数据加载。
        }
      }

      const {
        showSuccessHUD = true,
        showErrorHUD = true,
        refreshRequestId = '',
        pruneUnavailableCards = false,
      } = options || {}

      logStartupPerf('loadSearchDataToWebView(start)', {
        refreshRequestId,
        showSuccessHUD,
        showErrorHUD,
        pruneUnavailableCards,
      })
      const cacheKey = this.buildWebViewSearchDataCacheKey()
      logStartupPerf('cacheKey built', {
        length: cacheKey ? cacheKey.length : 0,
      })
      if (
        this._webViewSearchDataCache &&
        this._webViewSearchDataCache.key === cacheKey &&
        this._webViewSearchDataCache.fullIndexData
      ) {
        const cachedIndexData = this._webViewSearchDataCache.fullIndexData
        KnowledgeBaseUtils.log(
          "♻️ 命中搜索数据缓存",
          "loadSearchDataToWebView",
          {
            cacheKey,
            totalCards: cachedIndexData?.metadata?.totalCards || cachedIndexData?.cards?.length || 0,
          }
        )

        logStartupPerf('memory cache hit', {
          totalCards: cachedIndexData?.metadata?.totalCards || cachedIndexData?.cards?.length || 0,
        })
        const cachedInput = await this.pushSearchIndexToWebView(cachedIndexData, {
          refreshRequestId,
        })
        logStartupPerf('memory cache pushed', cachedInput)

        const cachedSucceeded = this.isWebViewPushResultSuccess(cachedInput)
        if (cachedSucceeded) {
          const cachedCount = cachedIndexData?.metadata?.totalCards || cachedIndexData?.cards?.length || 0
          if (showSuccessHUD) {
            MNUtil.showHUD(`加载成功：${cachedCount} 张卡片`)
          }
          return {
            success: true,
            totalCards: cachedCount,
            source: 'cache',
          }
        } else {
          if (showErrorHUD) {
            MNUtil.showHUD("加载失败：前端注入异常")
          }
          return {
            success: false,
            error: "前端注入异常",
            source: 'cache',
          }
        }
      }

      const persistentIndexData = this.readPersistentWebViewSearchDataCache(cacheKey)
      logStartupPerf('persistent cache read', {
        hit: !!persistentIndexData,
        totalCards: persistentIndexData?.metadata?.totalCards || persistentIndexData?.cards?.length || 0,
      })
      if (persistentIndexData) {
        KnowledgeBaseUtils.log(
          "♻️ 命中持久搜索数据缓存",
          "loadSearchDataToWebView",
          {
            cacheKey,
            totalCards: persistentIndexData?.metadata?.totalCards || persistentIndexData?.cards?.length || 0,
          }
        )

        const persistentInput = await this.pushSearchIndexToWebView(persistentIndexData, {
          refreshRequestId,
        })
        logStartupPerf('persistent cache pushed', persistentInput)

        if (this.isWebViewPushResultSuccess(persistentInput)) {
          this._webViewSearchDataCache = {
            key: cacheKey,
            fullIndexData: persistentIndexData,
            timestamp: Date.now(),
          }
          const persistentCount = persistentIndexData?.metadata?.totalCards || persistentIndexData?.cards?.length || 0
          if (showSuccessHUD) {
            MNUtil.showHUD(`加载成功：${persistentCount} 张卡片`)
          }
          return {
            success: true,
            totalCards: persistentCount,
            source: 'persistent-cache',
          }
        }

        KnowledgeBaseUtils.log(
          "持久搜索数据缓存注入失败，回退完整加载",
          "loadSearchDataToWebView",
          persistentInput
        )
      }

      const mainData = this.loadMainKnowledgeBaseCards()
      logStartupPerf('main cards loaded', {
        totalCards: mainData?.cards?.length || 0,
        mode: mainData?.actualMode || '',
      })
      if (!mainData) {
        return {
          success: false,
          error: '未找到可用索引，请先更新搜索索引',
        }
      }

      let allCards = mainData.cards
      let metadata = mainData.metadata
      let actualMode = mainData.actualMode

      const intermediateCards = this.loadIntermediateKnowledgeBaseCards()
      logStartupPerf('intermediate cards loaded', {
        totalCards: intermediateCards.length,
      })

      if (intermediateCards.length > 0) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', `过程知识库加载完成：${intermediateCards.length} 张卡片`)

        // ========== 第3部分：合并两个知识库 ==========
        const beforeMergeCount = allCards.length
        allCards = this.mergeCardsById(allCards, intermediateCards)
        const addedCount = allCards.length - beforeMergeCount

        KnowledgeBaseUtils.emitRuntimeLog('INFO', `合并完成：主知识库 ${allCards.length - addedCount} 张，过程知识库新增 ${addedCount} 张`)
      } else {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "过程知识库为空，仅使用主知识库数据")
      }

      const literatureClassificationCards = this.loadLiteratureClassificationKnowledgeBaseCards()
      logStartupPerf('literature classification cards loaded', {
        totalCards: literatureClassificationCards.length,
      })

      if (literatureClassificationCards.length > 0) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', `文献归类知识库加载完成：${literatureClassificationCards.length} 张卡片`)

        const beforeMergeCount = allCards.length
        allCards = this.mergeCardsById(allCards, literatureClassificationCards)
        const addedCount = allCards.length - beforeMergeCount

        KnowledgeBaseUtils.emitRuntimeLog('INFO', `合并完成：已有索引 ${allCards.length - addedCount} 张，文献归类新增 ${addedCount} 张`)
      } else {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "文献归类知识库为空，跳过合并")
      }

      const historyCardCards = this.loadHistoryCardKnowledgeBaseCards()
      logStartupPerf('history cards loaded', {
        totalCards: historyCardCards.length,
      })

      if (historyCardCards.length > 0) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', `历史卡片索引加载完成：${historyCardCards.length} 张卡片`)

        const beforeMergeCount = allCards.length
        allCards = this.mergeCardsById(allCards, historyCardCards)
        const addedCount = allCards.length - beforeMergeCount

        KnowledgeBaseUtils.emitRuntimeLog('INFO', `合并完成：已有索引 ${allCards.length - addedCount} 张，历史卡片新增 ${addedCount} 张`)
      } else {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "历史卡片索引为空，跳过合并")
      }

      const knownRemovedIds = this.getWebViewKnownRemovedSearchIds(allCards)
      logStartupPerf('known removed ids loaded', {
        totalIds: knownRemovedIds.length,
      })

      const pruned = pruneUnavailableCards === true
        ? this.pruneUnavailableSearchCards(allCards, {
          source: 'loadSearchDataToWebView',
          validateAvailability: true,
        })
        : this.filterKnownRemovedSearchCards(allCards, knownRemovedIds)
      allCards = pruned.cards
      logStartupPerf(pruneUnavailableCards === true ? 'cards pruned by validation' : 'known removed cards filtered', {
        totalCards: allCards.length,
        removed: pruned.removedIds.length,
      })

      // ========== 第4部分：构建完整的索引数据并发送到前端 ==========
      const fullIndexData = {
        cards: allCards,
        metadata: {
          totalCards: allCards.length,
          updateTime: metadata.updateTime || Date.now(),
          mode: actualMode,  // 🆕 记录实际加载的索引模式（full/light/legacy）
          prunedMissingCardCount: pruned.removedIds.length,
          prunedMissingCardIds: pruned.removedIds.slice(0, 20),
          ...metadata
        }
      }

      const previousFullIndexData = this._webViewSearchDataCache?.fullIndexData
      if (previousFullIndexData) {
        const patchData = this.buildSearchIndexPatch(previousFullIndexData, fullIndexData)
        if (this.shouldUseSearchIndexPatch(patchData)) {
          KnowledgeBaseUtils.log(
            "🚀 使用差量补丁推送",
            "loadSearchDataToWebView",
            {
              baseCount: patchData.baseCount,
              nextCount: patchData.nextCount,
              upserts: patchData.upserts.length,
              removed: patchData.removedIds.length,
            }
          )

          const patchInput = await this.pushSearchIndexPatchToWebView(patchData, {
            refreshRequestId,
          })
          logStartupPerf('patch pushed', patchInput)

          const patchSucceeded = this.isWebViewPushResultSuccess(patchInput)
          if (patchSucceeded) {
            this._webViewSearchDataCache = {
              key: cacheKey,
              fullIndexData,
              timestamp: Date.now(),
            }
            MNUtil.delay(0.1).then(() => {
              this.writePersistentWebViewSearchDataCache(cacheKey, fullIndexData)
            })
            if (showSuccessHUD) {
              MNUtil.showHUD(`加载成功：${allCards.length} 张卡片`)
            }
            return {
              success: true,
              totalCards: allCards.length,
              source: 'patch',
            }
          }
        }
      }

      this._webViewSearchDataCache = {
        key: cacheKey,
        fullIndexData,
        timestamp: Date.now(),
      }

      KnowledgeBaseUtils.emitRuntimeLog('INFO', `=== 数据准备完成：共 ${allCards.length} 张卡片 ===`)
      KnowledgeBaseUtils.log(
        "📤 发送数据到前端",
        "loadSearchDataToWebView",
        {
          totalCards: fullIndexData.cards.length,
          metadata: fullIndexData.metadata
        }
      )

      const input = await this.pushSearchIndexToWebView(fullIndexData, {
        refreshRequestId,
      })
      logStartupPerf('full data pushed', input)

      if (this.isWebViewPushResultSuccess(input)) {
        MNUtil.delay(0.1).then(() => {
          this.writePersistentWebViewSearchDataCache(cacheKey, fullIndexData)
        })
        if (showSuccessHUD) {
          MNUtil.showHUD(`加载成功：${allCards.length} 张卡片`)
        }
        return {
          success: true,
          totalCards: allCards.length,
          source: 'full',
        }
      } else {
        if (showErrorHUD) {
          MNUtil.showHUD("加载失败：前端注入异常")
        }
        return {
          success: false,
          error: "前端注入异常",
          source: 'full',
        }
      }

    } catch (error) {
      if (showErrorHUD) {
        MNUtil.showHUD("加载索引失败：" + error.message)
      }
      KnowledgeBaseUtils.addErrorLog(error, "loadSearchDataToWebView")
      return {
        success: false,
        error: error && error.message ? error.message : String(error),
      }
    }
  }

  /**
   * 响应其他插件的打开请求（插件通信）
   */
  MNKnowledgeBaseClass.prototype.onOpenKnowledgeBaseSearch = function(sender) {
    if (typeof MNUtil === 'undefined') return
    if (self.window !== self.appInstance.focusWindow) return

    try {
      let userInfo = sender.userInfo || {}

      // 确保控制器已初始化（使用新的延迟初始化方法）
      KnowledgeBaseUtils.checkWebViewController()

      // 如果已显示，直接返回前台
      if (!KnowledgeBaseUtils.webViewController.view.hidden) {
        MNUtil.studyView.bringSubviewToFront(KnowledgeBaseUtils.webViewController.view)
        return
      }

      // 显示窗口（支持自定义位置）
      let beginFrame = userInfo.beginFrame
      let endFrame = userInfo.endFrame
      void this.ensureSearchWebViewReady({
        showHUDWhileReload: false,
        beginFrame,
        endFrame,
      })

      // 数据刷新交给 show()/webViewDidFinishLoad 内的自动链路，避免首次打开重复加载

    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "onOpenKnowledgeBaseSearch")
    }
  }

  // ============================================
  // Prototype 方法 - 用于插件通信
  // ============================================

  /**
   * 打开可视化搜索 WebView (Prototype 版本)
   *
   * 此方法为插件通信专用,通过 self.openSearchWebView() 调用
   * 显示可视化搜索界面
   */
  MNKnowledgeBaseClass.prototype.openSearchWebView = async function() {
    try {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "【openSearchWebView 开始】")
      this.checkPopover()

      await this.ensureSearchWebViewReady({
        showHUDWhileReload: false,
      })

      KnowledgeBaseUtils.emitRuntimeLog('INFO', "【openSearchWebView 结束】成功")

    } catch (error) {
      KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【错误】openSearchWebView 发生异常: " + error)
      MNUtil.showHUD("打开可视化搜索失败")
      KnowledgeBaseUtils.addErrorLog(error, "openSearchWebView")
    }
  }

  /**
   * 打开可视化搜索 WebView，并直接执行文本搜索
   * @param {string} text - 搜索文本
   * @param {Object} options - 选项
   */
  MNKnowledgeBaseClass.prototype.openSearchWebViewWithText = async function(text, options = {}) {
    try {
      const normalized = String(text || "").replace(/\s+/g, " ").trim()
      if (!normalized) {
        return false
      }

      const payload = {
        query: normalized,
        options: Object.assign({ focus: true }, options || {}),
      }

      const script = `(function() {
        try {
          var payload = ${JSON.stringify(payload)};
          if (window.Bridge && typeof window.Bridge.setSearchQuery === 'function') {
            return window.Bridge.setSearchQuery(payload.query, payload.options || {});
          }
          if (window.MNKB && typeof window.MNKB.setSearchQuery === 'function') {
            return window.MNKB.setSearchQuery(payload.query, payload.options || {});
          }
          window.__MNKB_pendingSearchQuery = { query: payload.query, options: payload.options || {} };
          return false;
        } catch (error) {
          return { error: String(error) };
        }
      })()`

      await this.runSearchWebViewBridge(script, {
        showHUDWhileReload: false,
      })
      return true
    } catch (error) {
      KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【错误】openSearchWebViewWithText 发生异常: " + error)
      KnowledgeBaseUtils.addErrorLog(error, "openSearchWebViewWithText")
      return false
    }
  }

  /**
   * 打开可视化搜索 WebView，并定位到指定卡片
   * @param {string} noteId - 卡片 ID 或卡片 URL
   * @param {Object} options - 选项
   */
  MNKnowledgeBaseClass.prototype.openSearchWebViewWithNoteId = async function(noteId, options = {}) {
    try {
      let normalized = String(noteId || "").trim()
      if (!normalized) return false

      if (typeof normalized.isValidNoteURL === "function" && typeof normalized.toNoteId === "function") {
        if (normalized.isValidNoteURL()) {
          normalized = normalized.toNoteId()
        }
      } else if (/^marginnote\d?app:\/\//i.test(normalized) || /^marginnote4app:\/\//i.test(normalized)) {
        const match = normalized.match(/\/note\/([^?#]+)/i)
        if (match && match[1]) {
          normalized = match[1]
        }
      }

      if (!normalized) return false

      const payload = {
        noteId: normalized,
        options: Object.assign({ focus: true }, options || {}),
      }

      const script = `(function() {
        try {
          var payload = ${JSON.stringify(payload)};
          if (window.Bridge && typeof window.Bridge.locateCardById === 'function') {
            return window.Bridge.locateCardById(payload.noteId, payload.options || {});
          }
          if (window.MNKB && typeof window.MNKB.locateCardById === 'function') {
            return window.MNKB.locateCardById(payload.noteId, payload.options || {});
          }
          window.__MNKB_pendingLocateId = payload.noteId;
          return false;
        } catch (error) {
          return { error: String(error) };
        }
      })()`

      await this.runSearchWebViewBridge(script, {
        showHUDWhileReload: false,
      })
      return true
    } catch (error) {
      KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【错误】openSearchWebViewWithNoteId 发生异常: " + error)
      KnowledgeBaseUtils.addErrorLog(error, "openSearchWebViewWithNoteId")
      return false
    }
  }

  /**
   * 打开搜索面板并以指定卡片为局部搜索根。
   * 参数由 AddonBroadcast 传入，避免依赖其他插件运行时的 global 状态。
   */
  MNKnowledgeBaseClass.prototype.openSearchWebViewWithLocalRoot = async function(rootId, rootTitle = '') {
    try {
      const normalizedRootId = String(rootId || '').trim()
      if (!normalizedRootId) return false

      const payload = {
        rootId: normalizedRootId,
        rootTitle: String(rootTitle || '').trim() || '未命名卡片',
      }
      const script = `(function() {
        try {
          var payload = ${JSON.stringify(payload)};
          if (typeof activateLocalSearch === 'function') {
            window.__MNKB_pendingLocalSearch = null;
            activateLocalSearch(payload.rootId, payload.rootTitle);
            return true;
          }
          window.__MNKB_pendingLocalSearch = payload;
          return false;
        } catch (error) {
          return { error: String(error) };
        }
      })()`

      const result = await this.runSearchWebViewBridge(script, {
        showHUDWhileReload: false,
        maxWaitLoops: 20,
        waitInterval: 0.2,
      })
      if (result === false || (result && result.error)) {
        await MNUtil.delay(0.25)
        await this.runSearchWebViewBridge(script, {
          showHUDWhileReload: false,
          maxWaitLoops: 10,
          waitInterval: 0.2,
        })
      }
      return true
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'openSearchWebViewWithLocalRoot')
      return false
    }
  }

  /**
   * 有选中文本时自动搜索，否则仅打开搜索界面
   */
  MNKnowledgeBaseClass.prototype.getSearchSelectionText = function(fallbackText = '') {
    let selection = null
    try {
      if (typeof MNUtil.getCurrentSelection === 'function') {
        selection = MNUtil.getCurrentSelection()
      }
    } catch (_) {
      selection = null
    }
    if (!selection) {
      try {
        selection = MNUtil.currentSelection
      } catch (_) {
        selection = null
      }
    }

    const normalizedFallback = String(
      fallbackText || (typeof MNUtil.selectionText === 'string' ? MNUtil.selectionText : '')
    ).trim()
    if (!selection) {
      return normalizedFallback
    }

    const source = String(selection.source || '').trim().toLowerCase()
    const rawText = typeof selection.text === 'string' ? selection.text : ''
    const normalizedText = rawText.trim()
    const hasImageSelection = !!selection.image
    const looksLikeTextSelection = source === 'textview' || selection.isText === true || selection.onSelection === true

    if (source === 'textview') {
      return normalizedText
    }
    if (normalizedText && !hasImageSelection && selection.isText !== false) {
      return normalizedText
    }
    if (looksLikeTextSelection && !hasImageSelection) {
      return normalizedText || normalizedFallback
    }
    if (!hasImageSelection && !selection.onSelection && normalizedText) {
      return normalizedText
    }
    return normalizedFallback
  }

  MNKnowledgeBaseClass.prototype.openSearchWebViewWithSelectionText = async function(fallbackText = '') {
    try {
      const text = this.getSearchSelectionText(fallbackText)

      const didSearch = await this.openSearchWebViewWithText(text, { focus: true })
      if (!didSearch) {
        await this.openSearchWebView()
      }
      return didSearch
    } catch (error) {
      KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【错误】openSearchWebViewWithSelectionText 发生异常: " + error)
      KnowledgeBaseUtils.addErrorLog(error, "openSearchWebViewWithSelectionText")
      return false
    }
  }

  // ============================================
  // AI 助手功能 - 与 MNAI 插件集成
  // ============================================

  /**
   * 基于知识库上下文向 AI 提问
   * @param {string} question - 用户的问题
   * @param {Array} contextCards - 上下文卡片数组（最多 5 张）
   * @returns {Promise<string|null>} AI 的响应文本，失败返回 null
   */
  MNKnowledgeBaseClass.prototype.askAIWithContext = async function(question, contextCards) {
    try {
      KnowledgeBaseUtils.log("========================================")
      KnowledgeBaseUtils.log("【Native】askAIWithContext 方法被调用")
      KnowledgeBaseUtils.log("【Native】📝 问题: " + question)
      KnowledgeBaseUtils.log("【Native】📚 卡片数: " + (contextCards ? contextCards.length : 0))

      if (contextCards && contextCards.length > 0) {
        KnowledgeBaseUtils.log("【Native】📋 上下文卡片列表:")
        contextCards.forEach((card, idx) => {
          KnowledgeBaseUtils.log(`【Native】  ${idx + 1}. [${card.type || '无类型'}] ${card.title}`)
        })
      }

      // 1. 检查 MNAI 插件是否可用
      KnowledgeBaseUtils.log("【Native】🔍 检查 chatAIUtils 是否存在...")
      const chatAIUtilsExists = typeof chatAIUtils !== 'undefined'
      KnowledgeBaseUtils.log("【Native】chatAIUtils 存在: " + chatAIUtilsExists)

      if (!chatAIUtilsExists) {
        KnowledgeBaseUtils.log("【Native】❌ chatAIUtils 未定义，MNAI 插件可能未安装或未启动")
        MNUtil.showHUD("❌ 请先安装并打开 MNAI 插件");
        return null;
      }

      KnowledgeBaseUtils.log("【Native】✅ chatAIUtils 可用")

      // 检查 notifyController
      const hasNotifyController = chatAIUtils.notifyController !== undefined
      KnowledgeBaseUtils.log("【Native】notifyController 存在: " + hasNotifyController)

      if (hasNotifyController) {
        const hasLastResponse = chatAIUtils.notifyController.lastResponse !== undefined
        const hasCheckAutoClose = typeof chatAIUtils.notifyController.checkAutoClose === 'function'
        KnowledgeBaseUtils.log("【Native】lastResponse 属性存在: " + hasLastResponse)
        KnowledgeBaseUtils.log("【Native】checkAutoClose 方法存在: " + hasCheckAutoClose)
      }

      // 2. 构建包含知识库上下文的完整提示词
      KnowledgeBaseUtils.log("【Native】⏳ 开始构建上下文...")
      const context = this.buildContextFromCards(contextCards || []);
      KnowledgeBaseUtils.log("【Native】上下文长度: " + context.length + " 字符")

      const fullPrompt = context
        ? `基于以下知识库内容回答问题：\n\n${context}\n\n问题：${question}`
        : question;

      KnowledgeBaseUtils.log("【Native】完整提示词长度: " + fullPrompt.length + " 字符")
      KnowledgeBaseUtils.log("【Native】提示词前100字符: " + fullPrompt.substring(0, 100))

      // 3. 发送通知到 MNAI 插件
      KnowledgeBaseUtils.log("【Native】⏳ 准备发送 postNotification...")
      KnowledgeBaseUtils.log("【Native】通知名称: customChat")

      MNUtil.postNotification("customChat", { user: fullPrompt });
      KnowledgeBaseUtils.log("【Native】✅ postNotification 执行完成")

      // 4. 等待初始延迟
      KnowledgeBaseUtils.log("【Native】⏳ 等待初始延迟 0.5 秒...")
      await MNUtil.delay(0.5);
      KnowledgeBaseUtils.log("【Native】✅ 初始延迟完成，开始轮询...")

      // 5. 轮询获取响应（最多 30 秒，60 次尝试 × 0.5 秒）
      for (let i = 0; i < 60; i++) {
        // 每 10 次打印一次进度
        if (i % 10 === 0) {
          KnowledgeBaseUtils.log(`【Native】⏳ 轮询第 ${i + 1} 次 / 60`)
        }

        // 检查 lastResponse
        const hasResponse = chatAIUtils?.notifyController?.lastResponse
        if (hasResponse) {
          KnowledgeBaseUtils.log("【Native】✅ 在第 " + (i + 1) + " 次轮询中发现 lastResponse!")
          const result = chatAIUtils.notifyController.lastResponse;
          KnowledgeBaseUtils.log("【Native】响应长度: " + result.length + " 字符")
          KnowledgeBaseUtils.log("【Native】响应前100字符: " + result.substring(0, 100))

          // 清空响应，避免下次重复读取
          chatAIUtils.notifyController.lastResponse = "";
          KnowledgeBaseUtils.log("【Native】✅ 已清空 lastResponse")

          // 触发 MNAI 的自动关闭检查
          if (chatAIUtils.notifyController.checkAutoClose) {
            KnowledgeBaseUtils.log("【Native】⏳ 调用 checkAutoClose...")
            chatAIUtils.notifyController.checkAutoClose(true, 0.5);
            KnowledgeBaseUtils.log("【Native】✅ checkAutoClose 完成")
          } else {
            KnowledgeBaseUtils.log("【Native】⚠️ checkAutoClose 方法不存在")
          }

          KnowledgeBaseUtils.log("【Native】✅ 成功返回 AI 响应")
          return result;
        }

        // 每 0.5 秒检查一次
        await MNUtil.delay(0.5);
      }

      // 6. 超时处理
      KnowledgeBaseUtils.log("【Native】❌ 轮询 60 次后超时（30 秒）")
      KnowledgeBaseUtils.log("【Native】最终 chatAIUtils 状态:")
      KnowledgeBaseUtils.log("【Native】  chatAIUtils 存在: " + (typeof chatAIUtils !== 'undefined'))
      if (typeof chatAIUtils !== 'undefined') {
        KnowledgeBaseUtils.log("【Native】  notifyController 存在: " + (chatAIUtils.notifyController !== undefined))
        if (chatAIUtils.notifyController) {
          KnowledgeBaseUtils.log("【Native】  lastResponse 值: " + (chatAIUtils.notifyController.lastResponse || "(空)"))
        }
      }

      MNUtil.showHUD("⏱️ AI 响应超时，请稍后重试");
      return null;

    } catch (error) {
      KnowledgeBaseUtils.log("【Native】❌ 发生异常: " + error.message)
      KnowledgeBaseUtils.log("【Native】❌ 错误堆栈: " + error.stack)

      MNUtil.showHUD("AI 调用失败：" + error.message);
      KnowledgeBaseUtils.addErrorLog(error, "askAIWithContext");
      return null;
    }
  }

  /**
   * 将卡片数组转换为结构化的上下文文本
   * @param {Array} cards - 卡片对象数组，每个对象包含 {id, title, type, searchText}
   * @returns {string} 格式化的 Markdown 文本
   */
  MNKnowledgeBaseClass.prototype.buildContextFromCards = function(cards) {
    if (!cards || cards.length === 0) {
      return "";
    }

    // 限制最多 5 张卡片，避免上下文过长
    const limitedCards = cards.slice(0, 5);

    let context = "【知识库相关内容】\n\n";

    limitedCards.forEach((card, index) => {
      context += `${index + 1}. **${card.title || "(无标题)"}**\n`;

      if (card.type) {
        context += `   - 类型：${card.type}\n`;
      }

      if (card.searchText) {
        // 截取搜索文本的前 300 个字符，避免过长
        const preview = card.searchText.length > 300
          ? card.searchText.substring(0, 300) + "..."
          : card.searchText;
        context += `   - 内容：${preview}\n`;
      }

      context += "\n";
    });

    return context;
  }

  const SUBTREE_EXPORT_SCHEMA = 'mnknowledgebase.subtree-export.v1'
  const SUBTREE_EXPORT_MAX_MEDIA_CHARS = 4 * 1024 * 1024
  const SUBTREE_EXPORT_MAX_TOTAL_MEDIA_CHARS = 32 * 1024 * 1024

  function subtreeExportToArray(value) {
    if (!value) return []
    if (Array.isArray(value)) return value.slice()
    try {
      if (typeof value.length === 'number') return Array.from(value)
    } catch (_) {}
    try {
      const count = typeof value.count === 'function' ? Number(value.count()) : Number(value.count)
      if (Number.isFinite(count) && count > 0) {
        const result = []
        for (let index = 0; index < count; index += 1) {
          result.push(typeof value.objectAtIndex === 'function' ? value.objectAtIndex(index) : value[index])
        }
        return result
      }
    } catch (_) {}
    return []
  }

  function subtreeExportString(value, fallback = '') {
    if (value === undefined || value === null) return fallback
    try { return String(value) } catch (_) { return fallback }
  }

  function subtreeExportNoteTitle(note) {
    return subtreeExportString(note && (note.noteTitle || note.title), '(无标题)').trim() || '(无标题)'
  }

  function subtreeExportCommentText(rawComment, mnComment) {
    const candidates = [
      mnComment && mnComment.text,
      rawComment && rawComment.text,
      rawComment && rawComment.q_htext,
      rawComment && rawComment.html,
    ]
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null && String(candidate).length > 0) {
        return String(candidate)
      }
    }
    return ''
  }

  function subtreeExportPushMedia(media, seen, kind, hash, source, index) {
    const normalizedHash = subtreeExportString(hash).trim()
    if (!normalizedHash) return
    const key = `${kind}:${normalizedHash}`
    if (seen.has(key)) return
    seen.add(key)
    media.push({
      kind,
      hash: normalizedHash,
      source: source || 'comment',
      commentIndex: Number.isInteger(index) ? index : undefined,
      mimeType: kind === 'handwriting' ? 'image/svg+xml' : 'image/jpeg',
    })
  }

  function subtreeExportExtractMedia(note, rawComments) {
    const media = []
    const seen = new Set()
    rawComments.forEach((rawComment, index) => {
      if (!rawComment) return
      subtreeExportPushMedia(media, seen, 'image', rawComment.paint, 'comment', index)
      subtreeExportPushMedia(media, seen, 'handwriting', rawComment.drawing, 'comment', index)
      const merged = rawComment.q_hpic || {}
      subtreeExportPushMedia(media, seen, 'image', merged.paint, 'merged-comment', index)
      subtreeExportPushMedia(media, seen, 'handwriting', merged.drawing, 'merged-comment', index)
    })

    const excerptPic = note && (note.excerptPic || (note.note && note.note.excerptPic))
    subtreeExportPushMedia(media, seen, 'image', excerptPic && excerptPic.paint, 'excerpt')
    const excerpt = note && note.excerpt
    subtreeExportPushMedia(media, seen, 'image', excerpt && excerpt.imageHash, 'excerpt')
    return media
  }

  function subtreeExportFallbackMarkdown(note, comments) {
    const lines = []
    const excerptText = subtreeExportString(note && (note.excerptText || note.mainExcerptText))
    if (excerptText.trim()) lines.push(excerptText.trim())
    comments.forEach((comment, index) => {
      const text = subtreeExportString(comment.text).trim()
      const mediaLabel = comment.media.length > 0
        ? `（${comment.media.map(item => item.kind === 'handwriting' ? '手写' : '图片').join('、')}）`
        : ''
      if (text || mediaLabel) lines.push(`${index + 1}. ${text || '（无文本）'}${mediaLabel}`)
    })
    return lines.join('\n\n')
  }

  function subtreeExportApplyMediaBudget(markdown, budget, warnings) {
    const source = subtreeExportString(markdown)
    if (!source) return ''
    // MNNote.getMDContent(true) currently emits bare Base64 inside Markdown links;
    // normalize both that form and data URIs so one media budget covers both.
    return source.replace(/(\]\()((?:data:image\/[^;]+;base64,)?[A-Za-z0-9+/=]{128,})(\))/gi, (match, prefix, encoded) => {
      const dataUri = /^data:image\//i.test(encoded) ? encoded : `data:image/jpeg;base64,${encoded}`
      const chars = dataUri.length
      if (chars > SUBTREE_EXPORT_MAX_MEDIA_CHARS) {
        warnings.push('图片内嵌内容超过单媒体预算，已省略')
        return `${prefix}<!-- 图片已省略：超过单媒体预算 -->)`
      }
      if (budget.usedMediaChars + chars > SUBTREE_EXPORT_MAX_TOTAL_MEDIA_CHARS) {
        warnings.push('图片内嵌内容超过整棵树预算，已省略')
        return `${prefix}<!-- 图片已省略：超过整棵树媒体预算 -->)`
      }
      budget.usedMediaChars += chars
      budget.includedMediaCount += 1
      return `${prefix}${dataUri})`
    })
  }

  function subtreeExportCommentMediaLabel(media) {
    if (!Array.isArray(media) || media.length === 0) return ''
    return media.map(item => `${item.kind === 'handwriting' ? '手写' : '图片'}:${item.hash}`).join('、')
  }

  /**
   * 收集当前卡片及其真实子孙卡片，供 Markdown/JSON 导出使用。
   * 只读访问，不打开或修改评论管理器。
   */
  MNKnowledgeBaseClass.prototype.buildSubtreeExportPayload = async function(rootNote, format = 'markdown') {
    const root = rootNote && rootNote.noteId ? rootNote : null
    if (!root) return null

    const queue = [{ note: root, parentId: '', depth: 0, order: 0, path: [] }]
    const visited = new Set()
    const entries = []
    const budget = { usedMediaChars: 0, includedMediaCount: 0 }
    const stats = {
      visitedCount: 0,
      exportedCount: 0,
      failedCount: 0,
      mediaCount: 0,
      includedMediaCount: 0,
      omittedMediaCount: 0,
      warnings: [],
    }

    while (queue.length > 0) {
      const current = queue.shift()
      const note = current && current.note
      const noteId = subtreeExportString(note && note.noteId).trim()
      if (!note || !noteId || visited.has(noteId)) continue
      visited.add(noteId)
      stats.visitedCount += 1

      const rawComments = subtreeExportToArray(note.comments || (note.note && note.note.comments))
      const mnComments = subtreeExportToArray(note.MNComments)
      const media = subtreeExportExtractMedia(note, rawComments)
      const comments = rawComments.map((rawComment, index) => {
        const mnComment = mnComments[index] || null
        const commentMedia = media.filter(item => item.commentIndex === index)
        return {
          index,
          type: subtreeExportString(mnComment && mnComment.type || rawComment && rawComment.type, 'unknown'),
          text: subtreeExportCommentText(rawComment, mnComment),
          markdown: !!(rawComment && rawComment.markdown || mnComment && mnComment.markdown),
          html: subtreeExportString(rawComment && rawComment.html),
          media: commentMedia.map(item => ({
            kind: item.kind,
            hash: item.hash,
            source: item.source,
          })),
        }
      })

      const warnings = []
      let contentMarkdown = ''
      try {
        if (typeof note.getMDContent === 'function') {
          contentMarkdown = subtreeExportString(note.getMDContent(true))
        } else if (note.note && typeof note.note.getMDContent === 'function') {
          contentMarkdown = subtreeExportString(note.note.getMDContent(true))
        }
      } catch (error) {
        warnings.push(`读取完整 Markdown 失败：${error && error.message ? error.message : String(error)}`)
      }
      if (!contentMarkdown) contentMarkdown = subtreeExportFallbackMarkdown(note, comments)
      contentMarkdown = subtreeExportApplyMediaBudget(contentMarkdown, budget, warnings)

      const mediaRecords = []
      for (const item of media) {
        const record = {
          kind: item.kind,
          hash: item.hash,
          source: item.source,
          commentIndex: item.commentIndex,
          mimeType: item.mimeType,
          included: false,
          embeddedInContent: false,
          dataURI: '',
          omittedReason: '',
        }
        try {
          if (item.kind === 'handwriting') {
            const preview = this.getCommentManagerDrawingPreview(item.hash)
            record.dataURI = preview && preview.dataURI ? String(preview.dataURI) : ''
            if (!record.dataURI && preview && preview.pending) record.omittedReason = '手写媒体仍在转换'
            if (!record.dataURI && preview && preview.error) record.omittedReason = preview.error
          } else {
            const base64 = this.getCommentManagerMediaBase64(item.hash)
            if (base64) record.dataURI = `data:${item.mimeType};base64,${base64}`
          }
        } catch (error) {
          record.omittedReason = error && error.message ? String(error.message) : String(error)
        }

        const embeddedBase64 = record.dataURI.includes(',') ? record.dataURI.split(',').slice(1).join(',') : ''
        if (record.dataURI && (
          contentMarkdown.indexOf(record.dataURI.slice(0, 64)) >= 0 ||
          (embeddedBase64 && contentMarkdown.indexOf(embeddedBase64.slice(0, 64)) >= 0)
        )) {
          record.included = true
          record.embeddedInContent = true
          record.dataURI = ''
        } else if (record.dataURI) {
          const chars = record.dataURI.length
          if (chars > SUBTREE_EXPORT_MAX_MEDIA_CHARS) {
            record.omittedReason = '超过单媒体预算'
          } else if (budget.usedMediaChars + chars > SUBTREE_EXPORT_MAX_TOTAL_MEDIA_CHARS) {
            record.omittedReason = '超过整棵树媒体预算'
          } else {
            budget.usedMediaChars += chars
            budget.includedMediaCount += 1
            record.included = true
          }
        }
        if (!record.included && !record.omittedReason && !record.dataURI) {
          record.omittedReason = '无法读取媒体数据'
        }
        if (!record.included) stats.omittedMediaCount += 1
        if (record.included) stats.includedMediaCount += 1
        mediaRecords.push(record)
      }

      const entry = {
        id: noteId,
        parentId: current.parentId || '',
        depth: current.depth,
        order: current.order,
        path: current.path.slice(),
        title: subtreeExportNoteTitle(note),
        excerptText: subtreeExportString(note.excerptText || (note.note && note.note.excerptText)),
        contentMarkdown,
        comments,
        media: mediaRecords,
        warnings,
      }
      entries.push(entry)
      stats.exportedCount += 1
      stats.mediaCount += mediaRecords.length
      stats.warnings.push(...warnings.map(message => ({ noteId, message })))

      let children = []
      try { children = subtreeExportToArray(note.childNotes || (note.note && note.note.childNotes)) } catch (error) {
        stats.failedCount += 1
        stats.warnings.push({ noteId, message: `读取子卡片失败：${error && error.message ? error.message : String(error)}` })
      }
      children.forEach((child, childIndex) => {
        const childNote = child && child.noteId ? child : (typeof MNNote !== 'undefined' && MNNote && typeof MNNote.new === 'function'
          ? MNNote.new(child, false)
          : null)
        if (!childNote || !childNote.noteId) return
        queue.push({
          note: childNote,
          parentId: noteId,
          depth: current.depth + 1,
          order: childIndex,
          path: current.path.concat(childIndex),
        })
      })

      if (stats.visitedCount % 12 === 0 && typeof MNUtil !== 'undefined' && MNUtil && typeof MNUtil.delay === 'function') {
        await MNUtil.delay(0)
      }
    }

    stats.includedMediaCount = Math.min(stats.includedMediaCount, stats.mediaCount)
    return {
      schema: SUBTREE_EXPORT_SCHEMA,
      exportedAt: new Date().toISOString(),
      format,
      rootId: root.noteId,
      rootTitle: subtreeExportNoteTitle(root),
      nodes: entries,
      stats: {
        ...stats,
        mediaChars: budget.usedMediaChars,
      },
    }
  }

  function subtreeExportMarkdown(payload) {
    const lines = [
      '# 子树内容导出',
      '',
      `- 根卡片：${payload.rootTitle}`,
      `- 根卡片 ID：${payload.rootId}`,
      `- 卡片数量：${payload.stats.exportedCount}`,
      `- 媒体：${payload.stats.includedMediaCount}/${payload.stats.mediaCount} 已包含`,
      '',
    ]
    payload.nodes.forEach((node) => {
      const headingLevel = Math.min(6, Math.max(2, node.depth + 2))
      lines.push(`${'#'.repeat(headingLevel)} ${node.title}`)
      lines.push('')
      lines.push(`- 卡片 ID：${node.id}`)
      lines.push(`- 父卡片 ID：${node.parentId || '(根卡片)'}`)
      lines.push(`- 层级：${node.depth}`)
      if (node.excerptText && !node.contentMarkdown.includes(node.excerptText)) {
        lines.push('', '### 摘录', '', node.excerptText)
      }
      if (node.contentMarkdown) lines.push('', '### 完整内容', '', node.contentMarkdown)
      lines.push('', '### 评论（原始顺序）', '')
      if (node.comments.length === 0) {
        lines.push('（无评论）')
      } else {
        node.comments.forEach((comment) => {
          const text = comment.text || '（无文本）'
          const mediaLabel = subtreeExportCommentMediaLabel(comment.media)
          lines.push(`${comment.index + 1}. [${comment.type}] ${text}${mediaLabel ? `（${mediaLabel}）` : ''}`)
        })
      }
      if (node.media.length > 0) {
        lines.push('', '### 媒体', '')
        node.media.forEach((media) => {
          const label = media.kind === 'handwriting' ? '手写' : '图片'
          const status = media.included
            ? (media.embeddedInContent ? '已嵌入完整内容' : '已附加')
            : `未嵌入：${media.omittedReason || '未知原因'}`
          lines.push(`- ${label} \`${media.hash}\`：${status}`)
          if (media.included && media.dataURI) lines.push('', `![${label}](${media.dataURI})`)
        })
      }
      if (node.warnings.length > 0) {
        lines.push('', '> ⚠️ ' + node.warnings.join('；'))
      }
      lines.push('', '---', '')
    })
    return lines.join('\n')
  }

  MNKnowledgeBaseClass.prototype.exportSubtreeContext = async function(format = 'markdown') {
    const normalizedFormat = String(format || '').toLowerCase() === 'json' ? 'json' : 'markdown'
    try {
      const focusNote = MNNote.getFocusNote()
      const rootNote = focusNote && focusNote.noteId
        ? focusNote
        : (focusNote && typeof MNNote.new === 'function' ? MNNote.new(focusNote, false) : null)
      if (!rootNote || !rootNote.noteId) {
        MNUtil.showHUD('请先选中一张卡片')
        return { success: false, reason: 'missing-focus-note' }
      }

      MNUtil.showHUD(`正在导出子树内容（${normalizedFormat.toUpperCase()}）...`, 1)
      const payload = await this.buildSubtreeExportPayload(rootNote, normalizedFormat)
      if (!payload || payload.nodes.length === 0) {
        MNUtil.showHUD('未读取到可导出的卡片内容', 2)
        return { success: false, reason: 'empty-subtree' }
      }

      const content = normalizedFormat === 'json'
        ? JSON.stringify(payload, null, 2)
        : subtreeExportMarkdown(payload)
      MNUtil.copy(content)

      let exportPath = ''
      let exportBasePath = ''
      try { exportBasePath = MNUtil.tempPath || MNUtil.tempFolder || '' } catch (_) {}
      if (!exportBasePath) {
        try { exportBasePath = MNUtil.dbFolder ? `${MNUtil.dbFolder}/data` : '' } catch (_) {}
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
      const safeTitle = subtreeExportNoteTitle(rootNote)
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .slice(0, 80) || 'root'
      if (exportBasePath && typeof KnowledgeBaseUtils.writeTextFile === 'function') {
        const extension = normalizedFormat === 'json' ? 'json' : 'md'
        exportPath = `${exportBasePath}/mnkb-subtree-${safeTitle}-${timestamp}.${extension}`
        if (!KnowledgeBaseUtils.writeTextFile(exportPath, content)) exportPath = ''
        if (exportPath) {
          const uti = normalizedFormat === 'json' ? 'public.json' : 'public.plain-text'
          try {
            MNUtil.saveFile(exportPath, uti)
          } catch (_) {
            try { MNUtil.saveFile(exportPath, [uti]) } catch (__) {}
          }
        }
      }

      const omitted = payload.stats.omittedMediaCount
      const pathMessage = exportPath ? `，文件：${exportPath}` : '，未能写入文件（内容已复制）'
      const omissionMessage = omitted > 0 ? `，省略媒体 ${omitted} 项` : ''
      MNUtil.showHUD(`已导出 ${payload.stats.exportedCount} 张卡片${omissionMessage}${pathMessage}`, 3)
      KnowledgeBaseUtils.log('子树内容导出完成', 'exportSubtreeContext', {
        format: normalizedFormat,
        rootId: payload.rootId,
        nodeCount: payload.stats.exportedCount,
        mediaCount: payload.stats.mediaCount,
        omittedMediaCount: omitted,
        outputLength: content.length,
        exportPath,
      })
      return { success: true, format: normalizedFormat, path: exportPath, payload, content }
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'exportSubtreeContext')
      MNUtil.showHUD(`导出子树内容失败：${error && error.message ? error.message : String(error)}`, 3)
      return { success: false, reason: error && error.message ? error.message : String(error) }
    }
  }

  /**
   * 为评论管理器准备数据
   *
   * @param {MNNote} note - 要处理的卡片
   * @returns {Object} 包含完整评论数据、字段信息和摘录区信息的对象
   *
   * @description
   * 此函数为可视化评论管理器准备所有必要的数据，包括：
   * 1. 所有评论的详细数据（含 Base64 图片）
   * 2. 字段结构信息（含插入索引）
   * 3. 摘录区信息
   *
   * @example
   * const data = this.prepareCommentDataForManager(note);
   * // 返回格式：
   * // {
   * //   noteId: "xxx",
   * //   noteTitle: "卡片标题",
   * //   comments: [{index, type, text, imageBase64, ...}],
   * //   fields: [{name, topInsertIndex, bottomInsertIndex, ...}],
   * //   excerptArea: {name, insertIndex}
   * // }
   */
  MNKnowledgeBaseClass.prototype.getCommentRevisionForManager = function(note) {
    if (!note) return ""

    const comments = note.comments || []
    let hash = 2166136261
    const feed = value => {
      const text = value === undefined || value === null ? "" : String(value)
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
      }
      hash ^= 31
      hash = Math.imul(hash, 16777619)
    }

    feed(note.noteId || "")
    feed(note.noteTitle || note.title || "")
    feed(comments.length)

    comments.forEach((comment, index) => {
      const rawComment = comment || {}
      feed(index)
      feed(rawComment.type || "")
      feed(rawComment.markdown ? 1 : 0)
      feed(rawComment.text || rawComment.html || rawComment.q_htext || "")
      feed(rawComment.paint || rawComment.drawing || "")
      feed(rawComment.note || "")

      const mergedImage = rawComment.q_hpic || {}
      feed(mergedImage.paint || mergedImage.drawing || "")
    })

    return `${note.noteId || ""}:${comments.length}:${(hash >>> 0).toString(16)}`
  }

  MNKnowledgeBaseClass.prototype.getCommentManagerMediaBase64 = function(mediaHash) {
    const normalizedHash = mediaHash == null ? "" : String(mediaHash).trim()
    if (!normalizedHash) return ""

    const cache = self._commentManagerMediaCache || (self._commentManagerMediaCache = new Map())
    if (cache.has(normalizedHash)) {
      const cached = cache.get(normalizedHash)
      cache.delete(normalizedHash)
      cache.set(normalizedHash, cached)
      return cached
    }

    const imageData = MNUtil.getMediaByHash(normalizedHash)
    if (!imageData) return ""
    const encoded = imageData.base64Encoding()
    const base64 = encoded == null ? "" : String(encoded)
    if (!base64) return ""

    cache.set(normalizedHash, base64)
    const maxCacheEntries = 48
    const maxCacheCharacters = 48 * 1024 * 1024
    let totalCharacters = 0
    cache.forEach((value) => {
      totalCharacters += value ? String(value).length : 0
    })
    while (cache.size > maxCacheEntries || totalCharacters > maxCacheCharacters) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      const oldestValue = cache.get(oldestKey)
      totalCharacters -= oldestValue ? String(oldestValue).length : 0
      cache.delete(oldestKey)
    }
    return base64
  }

  MNKnowledgeBaseClass.prototype.getCommentManagerDrawingPreview = function(drawingHash) {
    const normalizedHash = drawingHash == null ? "" : String(drawingHash).trim()
    if (!normalizedHash) return { dataURI: "", error: "", pending: false }

    const cache = self._commentManagerDrawingPreviewCache ||
      (self._commentManagerDrawingPreviewCache = new Map())
    if (cache.has(normalizedHash)) {
      const cached = cache.get(normalizedHash)
      cache.delete(normalizedHash)
      cache.set(normalizedHash, cached)
      return cached
    }

    let result
    try {
      if (typeof KnowledgeBaseHandwritingOCR === "undefined" ||
        !KnowledgeBaseHandwritingOCR ||
        typeof KnowledgeBaseHandwritingOCR.renderDrawingDataURI !== "function") {
        throw new Error("手写预览模块未加载")
      }
      const drawingBase64 = this.getCommentManagerMediaBase64(normalizedHash)
      if (!drawingBase64) {
        result = { dataURI: "", error: "", pending: true }
        return result
      }
      const rendered = KnowledgeBaseHandwritingOCR.renderDrawingDataURI(drawingBase64)
      result = {
        dataURI: rendered && rendered.dataURI ? String(rendered.dataURI) : "",
        error: "",
        pending: false,
      }
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error || "unknown")
      result = { dataURI: "", error: message, pending: false }
      KnowledgeBaseUtils.log("手写预览生成失败", "getCommentManagerDrawingPreview", {
        drawingHash: normalizedHash,
        code: error && error.code ? String(error.code) : "",
        error: message,
      }, "ERROR")
    }

    if (result.dataURI) {
      cache.set(normalizedHash, result)
      const maxCacheEntries = 24
      const maxCacheCharacters = 24 * 1024 * 1024
      let totalCharacters = 0
      cache.forEach(value => {
        totalCharacters += value && value.dataURI ? String(value.dataURI).length : 0
      })
      while (cache.size > maxCacheEntries || totalCharacters > maxCacheCharacters) {
        const oldestKey = cache.keys().next().value
        if (oldestKey === undefined) break
        const oldestValue = cache.get(oldestKey)
        totalCharacters -= oldestValue && oldestValue.dataURI
          ? String(oldestValue.dataURI).length
          : 0
        cache.delete(oldestKey)
      }
    }
    return result
  }

  MNKnowledgeBaseClass.prototype.prepareCommentDataForManager = function(note, options = {}) {
    try {
      KnowledgeBaseUtils.log("开始准备评论数据", "prepareCommentDataForManager", {
        noteId: note.noteId,
        noteTitle: note.noteTitle
      });

      let selection = null
      try {
        if (typeof MNUtil.getCurrentSelection === 'function') {
          selection = MNUtil.getCurrentSelection()
        }
      } catch (_) {
        selection = null
      }
      if (!selection) {
        try {
          selection = MNUtil.currentSelection
        } catch (_) {
          selection = null
        }
      }

      // 1. 解析卡片的字段结构
      const parsedComments = KnowledgeBaseTemplate.parseNoteComments(note);

      // 2. 准备评论数据（参考 mnsnipaste 的实现）
      const commentsData = [];
      const mnComments = note.MNComments || []
      note.comments.forEach((rawComment, index) => {
        const mnComment = mnComments[index] || null
        const detailedType = mnComment && mnComment.type ? String(mnComment.type) : ""
        const commentData = {
          index: index,
          originalType: rawComment.type,  // 保留原始类型（5种基础类型）
          type: detailedType,
          detailedType: detailedType,
        };

        // 根据类型添加必要字段（参考 mnsnipaste webviewController.js:1913-1959）
        try {
          switch (rawComment.type) {
            case "TextNote":
              commentData.text = (mnComment && mnComment.text !== undefined) ? mnComment.text : (rawComment.text || "");
              commentData.markdown = !!(rawComment.markdown || (mnComment && mnComment.markdown));

              // 检查是否是 HtmlMarkdown 格式（<span id="TYPE">...）
              if (commentData.text.startsWith("<span")) {
                // 调试日志
                KnowledgeBaseUtils.log("检测到 HtmlMarkdown 评论", "prepareCommentDataForManager", {
                  index: index,
                  text: commentData.text,
                  textLength: commentData.text.length,
                  first50Chars: commentData.text.substring(0, 50)
                });

                const typeRegex = /<span\s*id="([^"]*)"/;  // \s* 允许0个或多个空格
                const typeMatch = commentData.text.match(typeRegex);

                // 调试日志
                KnowledgeBaseUtils.log("正则匹配结果", "prepareCommentDataForManager", {
                  index: index,
                  matched: !!typeMatch,
                  matchResult: typeMatch ? typeMatch[0] : null,
                  capturedType: typeMatch && typeMatch[1] ? typeMatch[1] : null
                });

                if (typeMatch && typeMatch[1]) {
                  // 提取类型（如 "danger", "level1", "idea"）
                  commentData.htmlMarkdownType = typeMatch[1].trim();

                  // 提取纯文本内容（去除 HTML 标签）
                  const contentRegex = /<span[^>]*>(.*?)<\/span>/;
                  const contentMatch = commentData.text.match(contentRegex);
                  if (contentMatch && contentMatch[1]) {
                    let pureContent = contentMatch[1].trim();
                    // 去除所有 HtmlMarkdown emoji 图标（对应 HtmlMarkdownUtils.icons）
                    const emojisToRemove = [
                      '❗❗❗',  // danger (必须先匹配3个，否则会只去掉1个)
                      '🚩', '▸', '▪', '•', '·',  // level1-5
                      '🔑',  // key
                      '⚠️',  // alert
                      '📝',  // remark
                      '🎯',  // goal
                      '❓',  // question
                      '��',  // idea
                      '✨',  // method
                      '🔍',  // check
                      '✏️',  // sketch
                      '📋',  // case
                      '👣'   // step
                    ];
                    emojisToRemove.forEach(emoji => {
                      pureContent = pureContent.replace(emoji, '').trim();
                    });

                    // 去除可能的前缀文本（对应 HtmlMarkdownUtils.prefix）
                    const prefixes = [
                      "思路：",   // idea
                      "方法：",   // method
                      "CHECK: ",  // check 带冒号+空格
                      "CHECK",    // check (无冒号)
                      "SKETCH: ", // sketch 可能有冒号+空格的情况
                      "SKETCH"    // sketch (无冒号)
                    ];
                    prefixes.forEach(prefix => {
                      if (pureContent.startsWith(prefix)) {
                        pureContent = pureContent.substring(prefix.length).trim();
                      }
                    });
                    commentData.htmlMarkdownContent = pureContent;

                    // 调试日志
                    KnowledgeBaseUtils.log("HtmlMarkdown 解析成功", "prepareCommentDataForManager", {
                      index: index,
                      type: commentData.htmlMarkdownType,
                      content: commentData.htmlMarkdownContent
                    });
                  }
                } else {
                  // 调试日志：匹配失败
                  KnowledgeBaseUtils.log("HtmlMarkdown 匹配失败", "prepareCommentDataForManager", {
                    index: index,
                    charCodes: Array.from(commentData.text.substring(0, 30)).map(c => c.charCodeAt(0)).join(',')
                  });
                }
              }

              // 检查是否是链接到其他笔记的特殊情况（纯链接）
              if (/^marginnote\dapp:\/\//.test(commentData.text)) {
                const linkUrl = commentData.text.trim();
                const noteid = typeof KnowledgeBaseTemplate.extractNoteIdFromLinkUrl === "function"
                  ? KnowledgeBaseTemplate.extractNoteIdFromLinkUrl(linkUrl)
                  : ((linkUrl.match(/note\/([0-9a-f-]{36})/i) || [])[1] || "");
                if (noteid) {
                  commentData.linkedNoteId = noteid;
                  commentData.linkedNoteUrl = linkUrl;
                  try {
                    const linkedNote = MNNote.new(noteid);
                    if (linkedNote) {
                      commentData.linkedNoteTitle = linkedNote.noteTitle || "(无标题)";
                    }
                  } catch (e) {
                    KnowledgeBaseUtils.log("获取链接笔记失败", "prepareCommentDataForManager", {
                      index, noteid, error: e.message
                    });
                  }
                }
              }

              // ✅ 新增：检查是否包含 Markdown 链接 [text](url)
              // 提取链接作为子项数据，方便后续定位
              // 支持所有 Markdown 链接（MarginNote 链接和普通 URL）
              const markdownLinkRegex = /\[([^\]]+?)\]\(([^)]+?)\)/g;
              let linkMatch;
              const extractedLinks = [];

              while ((linkMatch = markdownLinkRegex.exec(commentData.text)) !== null) {
                const displayText = linkMatch[1];
                const url = linkMatch[2];  // 完整的原始 URL

                let linkedNoteTitle = "未知卡片";
                let noteId = "";

                // 判断是否是 MarginNote 链接
                if (url.startsWith("marginnote4app://note/")) {
                  noteId = url.replace("marginnote4app://note/", "");

                  // 尝试获取链接目标卡片的标题
                  try {
                    const linkedNote = MNNote.new(noteId, false);  // false = 不弹窗
                    if (linkedNote) {
                      linkedNoteTitle = linkedNote.noteTitle || "(无标题)";
                    }
                  } catch (e) {
                    // 获取失败，使用默认标题
                  }
                } else {
                  // 普通 URL
                  linkedNoteTitle = url;
                  noteId = url;
                }

                extractedLinks.push({
                  displayText: displayText,
                  url: url,              // ✅ 关键：传递完整的原始 URL
                  noteId: noteId,
                  linkedNoteTitle: linkedNoteTitle,
                  fullMatch: linkMatch[0],
                  startPos: linkMatch.index
                });
              }

              // 如果有提取到链接，添加到评论数据中
              if (extractedLinks.length > 0) {
                commentData.markdownLinks = extractedLinks;
                commentData.hasMarkdownLinks = true;

                KnowledgeBaseUtils.log("检测到 Markdown 链接", "prepareCommentDataForManager", {
                  index: index,
                  linksCount: extractedLinks.length,
                  links: extractedLinks.map(l => ({ displayText: l.displayText, noteId: l.noteId }))
                });
              }
              break;

            case "PaintNote":
              // 手写/图片评论
              if (rawComment.paint) {
                try {
                  commentData.mediaHash = String(rawComment.paint);
                  const imageBase64 = this.getCommentManagerMediaBase64(rawComment.paint);
                  if (imageBase64) {
                    commentData.imageBase64 = imageBase64;  // 纯 Base64 字符串
                  } else {
                    KnowledgeBaseUtils.log("图片数据为空", "prepareCommentDataForManager", {index});
                  }
                } catch (error) {
                  KnowledgeBaseUtils.log("获取图片失败", "prepareCommentDataForManager", {
                    index, error: error.message
                  });
                }
              }
              if (rawComment.drawing) {
                const drawingHash = String(rawComment.drawing)
                const drawingPreview = this.getCommentManagerDrawingPreview(drawingHash)
                commentData.drawingHash = drawingHash
                commentData.drawingPreviewDataURI = drawingPreview.dataURI
                commentData.drawingPreviewError = drawingPreview.error
                commentData.drawingPreviewPending = drawingPreview.pending === true
              }
              break;

            case "HtmlNote":
              commentData.text = rawComment.text || "";
              commentData.htmlText = rawComment.html || rawComment.text;
              break;

            case "LinkNote":
              // 合并评论：可能包含文本或图片
              commentData.markdown = !!rawComment.markdown;
              if (mnComment && mnComment.text) {
                commentData.text = mnComment.text;
              } else if (rawComment.q_htext) {
                commentData.text = rawComment.q_htext;
              }

              if (rawComment.q_hpic && rawComment.q_hpic.paint) {
                try {
                  commentData.mediaHash = String(rawComment.q_hpic.paint);
                  const imageBase64 = this.getCommentManagerMediaBase64(rawComment.q_hpic.paint);
                  if (imageBase64) {
                    commentData.imageBase64 = imageBase64;
                  }
                } catch (error) {
                  KnowledgeBaseUtils.log("获取合并图片失败", "prepareCommentDataForManager", {
                    index, error: error.message
                  });
                }
              }

              if (rawComment.q_hpic && rawComment.q_hpic.drawing) {
                const drawingHash = String(rawComment.q_hpic.drawing)
                const drawingPreview = this.getCommentManagerDrawingPreview(drawingHash)
                commentData.drawingHash = drawingHash
                commentData.drawingPreviewDataURI = drawingPreview.dataURI
                commentData.drawingPreviewError = drawingPreview.error
                commentData.drawingPreviewPending = drawingPreview.pending === true
              }

              // 存储 textFirst 标志（用于判断优先显示文本还是图片）
              commentData.textFirst = note.textFirst;

              // 尝试获取链接目标卡片的标题（如果是链接评论）
              if (rawComment.note) {
                commentData.linkedNoteId = String(rawComment.note);
                commentData.linkedNoteUrl = `marginnote4app://note/${rawComment.note}`;
                try {
                  const linkedNote = MNNote.new(rawComment.note);
                  if (linkedNote) {
                    commentData.linkedNoteTitle = linkedNote.noteTitle || "(无标题)";
                  }
                } catch (error) {
                  KnowledgeBaseUtils.log("获取链接卡片标题失败", "prepareCommentDataForManager", {
                    index, error: error.message
                  });
                }
              }
              break;

            case "AudioNote":
              // 音频评论（暂不处理）
              commentData.text = "(音频评论)";
              break;

            default:
              commentData.text = rawComment.text || "";
          }
        } catch (error) {
          KnowledgeBaseUtils.log("处理评论数据失败", "prepareCommentDataForManager", {
            index, type: rawComment.type, error: error.message
          });
        }

        commentsData.push(commentData);
      });

      // 3. 准备字段摘要数组
      const fieldsData = parsedComments.htmlCommentsObjArr.map(fieldObj => {
        // 提取字段名称：去除 HTML 标签和冒号
        const fieldName = fieldObj.text.replace(/<\/?[^>]+>/g, '').replace(/[：:]/g, '').trim();

        return {
          name: fieldName,  // 纯文本字段名
          text: fieldObj.text,  // 原始 HTML 文本
          index: fieldObj.index,
          topInsertIndex: fieldObj.excludingFieldBlockIndexArr.length > 0
            ? fieldObj.excludingFieldBlockIndexArr[0]
            : fieldObj.index + 1,  // 字段下方第一个位置
          bottomInsertIndex: fieldObj.excludingFieldBlockIndexArr.length > 0
            ? fieldObj.excludingFieldBlockIndexArr[fieldObj.excludingFieldBlockIndexArr.length - 1] + 1
            : fieldObj.index + 1,  // 字段下方最后一个位置的下一个位置
          includingFieldBlockIndexArr: fieldObj.includingFieldBlockIndexArr,
          excludingFieldBlockIndexArr: fieldObj.excludingFieldBlockIndexArr
        };
      });

      // 4. 准备摘录区信息
      const excerptArea = {
        name: "摘录区",
        insertIndex: parsedComments.htmlCommentsObjArr.length > 0
          ? parsedComments.htmlCommentsObjArr[0].index  // 第一个字段之前
          : note.comments.length  // 如果没有字段，则是卡片最底端
      };

      // 5. 构建完整数据
      const fullData = {
        noteId: note.noteId,
        noteTitle: note.noteTitle || "(无标题)",
        revision: options.revision || this.getCommentRevisionForManager(note),
        requestId: Number(options.requestId || 0),
        refreshReason: options.reason ? String(options.reason) : "",
        showLoadedFeedback: options.showLoadedFeedback === true,
        forceApply: options.forceApply === true,
        handwritingPendingCount: commentsData.filter(comment => comment.drawingPreviewPending === true).length,
        comments: commentsData,
        fields: fieldsData,
        excerptArea: excerptArea,
        uiContext: {
          selectionText: selection && selection.text ? String(selection.text) : "",
          selectionSource: selection && selection.source ? String(selection.source) : "",
          preferredCommentIndex: typeof self.currentHtmlMDStudioFocusIndex === 'number'
            ? self.currentHtmlMDStudioFocusIndex
            : (typeof self.currentCommentManagerFocusIndex === 'number'
              ? self.currentCommentManagerFocusIndex
              : -1),
        },
      };

      self.currentHtmlMDStudioFocusIndex = null;
      self.currentCommentManagerFocusIndex = null;

      KnowledgeBaseUtils.log("评论数据准备完成", "prepareCommentDataForManager", {
        noteId: note.noteId,
        commentsCount: commentsData.length,
        fieldsCount: fieldsData.length
      });

      return fullData;

    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "prepareCommentDataForManager");
      MNUtil.showHUD("准备评论数据失败：" + error.message);
      return null;
    }
  }

  /**
   * 打开评论管理器
   *
   * @param {MNNote} note - 要管理评论的卡片（可选，不传则使用当前焦点卡片）
   *
   * @description
   * 此函数打开可视化评论管理器界面，支持：
   * 1. 查看所有评论（含图片、手写等）
   * 2. 选择评论
   * 3. 移动评论到字段
   * 4. 提取和删除评论
   *
   * @example
   * this.openCommentManager(note);
   * this.openCommentManager();  // 使用当前焦点卡片
   */
  MNKnowledgeBaseClass.prototype.openCommentManager = async function(note) {
    try {
      KnowledgeBaseUtils.log("开始", "openCommentManager")

      // 1. 获取目标卡片（参数或当前焦点卡片）
      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote) {
        MNUtil.showHUD("请先选中一张卡片")
        KnowledgeBaseUtils.log("未找到目标卡片", "openCommentManager")
        return
      }

      KnowledgeBaseUtils.log("目标卡片: " + targetNote.noteTitle, "openCommentManager")

      // 2. 确保控制器已初始化
      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (typeof controller.canReplaceCommentSurface === 'function' &&
        !(await controller.canReplaceCommentSurface())) {
        MNUtil.showHUD('问题研究工作台有未保存草稿，已阻止切换面板')
        return
      }
      self.currentManagedNote = targetNote
      KnowledgeBaseUtils.log("已保存 currentManagedNote", "openCommentManager")

      KnowledgeBaseUtils.log("控制器状态", "openCommentManager", {
        hidden: controller.view.hidden,
        onAnimate: controller.onAnimate,
        currentHTMLType: controller.currentHTMLType
      })

      // 4. 检查是否需要重新加载 HTML
      const needReload = controller.currentHTMLType !== 'comment-manager' || !controller.webViewLoaded
      KnowledgeBaseUtils.log("HTML类型检查", "openCommentManager", {
        currentHTMLType: controller.currentHTMLType,
        webViewLoaded: controller.webViewLoaded,
        needReload: needReload
      })

      // 5. 如果正在动画中，等待动画完成后重新调用
      if (controller.onAnimate) {
        KnowledgeBaseUtils.log("正在动画中，延迟 0.5s 后重试", "openCommentManager")
        await MNUtil.delay(0.5)
        return this.openCommentManager(targetNote)
      }

      // 6. 如果 HTML 已正确加载，直接显示窗口并加载数据
      if (!needReload) {
        KnowledgeBaseUtils.log("【优化分支】comment-manager.html 已加载，直接显示窗口", "openCommentManager")
        await controller.show()
        await controller.loadCommentData(targetNote.noteId, {
          reason: "open-reuse",
        })
        KnowledgeBaseUtils.log("数据已刷新", "openCommentManager")
        return
      }

      // 7. 需要重新加载 HTML
      KnowledgeBaseUtils.log("【加载分支】需要重新加载 HTML", "openCommentManager")
      MNUtil.showHUD("正在加载评论管理器，请稍候...")
      controller.loadCommentManagerHTML()
      KnowledgeBaseUtils.log("loadCommentManagerHTML 调用完成", "openCommentManager")

      // 8. 显示窗口
      await controller.show()
      KnowledgeBaseUtils.log("窗口显示完成", "openCommentManager")

      // 9. 等待 WebView 真正加载完成后再注入数据，避免首次打开注入过早
      const maxWait = 2.5
      const step = 0.1
      let waited = 0
      while (!controller.webViewLoaded && waited < maxWait) {
        await MNUtil.delay(step)
        waited += step
      }
      await controller.loadCommentData(targetNote.noteId, {
        reason: "open-first-load",
      })
      KnowledgeBaseUtils.log("数据已发送到 HTML 端", "openCommentManager", {
        webViewLoaded: controller.webViewLoaded,
        waited: waited
      })

    } catch (error) {
      KnowledgeBaseUtils.log("发生异常: " + error.message, "openCommentManager")
      MNUtil.showHUD("打开评论管理器失败：" + error.message)
      KnowledgeBaseUtils.addErrorLog(error, "openCommentManager")
    }
  }

  const TITLE_REFACTOR_MAX_CARDS = 3000

  MNKnowledgeBaseClass.prototype.prepareTitleRefactorWorkbenchData = function(noteOrId) {
    try {
      const root = typeof noteOrId === 'string' ? MNNote.new(noteOrId, false) : noteOrId
      if (!root || !root.noteId) return null
      const seen = new Set()
      const cards = []
      const queue = [root]
      let cursor = 0
      let exceededLimit = false
      // Do not use the recursive getAllDescendantNotes helper here. A malformed
      // structural cycle or a very deep subtree would otherwise block the
      // MarginNote main thread while the HTML panel is opening.
      while (cursor < queue.length) {
        const entry = queue[cursor++]
        const note = entry && entry.note ? entry.note : entry
        const id = note && note.noteId ? String(note.noteId).trim() : ''
        if (!id || seen.has(id)) continue
        seen.add(id)

        const title = String(note.noteTitle || note.title || '').trim()
        if (title) {
          const parent = note.parentNote && note.parentNote.noteId ? note.parentNote.noteId : ''
          cards.push({
            id,
            parentId: String(parent || ''),
            title,
            type: String(KnowledgeBaseTemplate.getNoteType(note) || ''),
          })
        }

        let children = []
        try {
          // Keep traversing the MNNote wrapper: its `.note` native object is
          // useful for serialization, but childNotes is exposed on the wrapper
          // on some MarginNote versions only.
          children = Array.isArray(entry && entry.childNotes)
            ? entry.childNotes
            : (Array.isArray(note.childNotes) ? note.childNotes : [])
        } catch (_) {}
        if (seen.size >= TITLE_REFACTOR_MAX_CARDS && (cursor < queue.length || children.length > 0)) {
          exceededLimit = true
          break
        }
        for (const child of children) queue.push(child)
      }

      if (cursor < queue.length) exceededLimit = true
      if (exceededLimit) {
        KnowledgeBaseUtils.log('标题重构工作台拒绝过大子树', 'prepareTitleRefactorWorkbenchData', {
          rootId: String(root.noteId),
          limit: TITLE_REFACTOR_MAX_CARDS,
          discovered: seen.size,
        })
        return { tooLarge: true, limit: TITLE_REFACTOR_MAX_CARDS, discovered: seen.size }
      }
      if (!cards.length) return null
      const rootType = KnowledgeBaseTemplate.getNoteType(root) || ''
      return {
        rootId: String(root.noteId),
        rootTitle: String(root.noteTitle || root.title || ''),
        rootType: String(rootType),
        cards,
        sourceLabel: `当前子树 · ${cards.length} 张卡片`,
      }
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'prepareTitleRefactorWorkbenchData')
      return null
    }
  }

  MNKnowledgeBaseClass.prototype.openTitleRefactorWorkbench = async function(note) {
    if (self._titleRefactorWorkbenchOpening) {
      MNUtil.showHUD('标题重构工作台正在打开，请稍候')
      return false
    }
    self._titleRefactorWorkbenchOpening = true
    try {
      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote) {
        MNUtil.showHUD('请先选中一张卡片')
        return false
      }
      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (typeof controller.canReplaceCommentSurface === 'function') {
        const canReplace = await Promise.race([
          controller.canReplaceCommentSurface(),
          MNUtil.delay(2).then(() => '__title_refactor_guard_timeout__'),
        ])
        if (canReplace === '__title_refactor_guard_timeout__') {
          MNUtil.showHUD('标题重构工作台无法确认当前面板状态，请关闭面板后重试')
          return false
        }
        if (!canReplace) {
          MNUtil.showHUD('标题重构工作台有未保存草稿，已阻止切换')
          return false
        }
      }
      self.currentManagedNote = targetNote
      const needReload = controller.currentHTMLType !== 'title-refactor-workbench' || !controller.webViewLoaded
      if (controller.onAnimate) {
        const deadline = Date.now() + 3500
        while (controller.onAnimate && Date.now() < deadline) {
          await MNUtil.delay(0.1)
        }
        if (controller.onAnimate) {
          MNUtil.showHUD('标题重构工作台无法打开：窗口动画未完成，请重试')
          return false
        }
      }
      if (!needReload) {
        await controller.show(null, { x: 30, y: 35, width: 1240, height: 820 })
        const result = await controller.loadTitleRefactorWorkbenchData(targetNote.noteId)
        if (result && result.success) return true
        if (result && result.reason === 'payload-too-large') {
          controller.hide()
          MNUtil.showHUD(`归类子树超过 ${result.limit || TITLE_REFACTOR_MAX_CARDS} 张，已阻止加载以避免卡死`)
          return false
        }
        if (result && result.reason === 'webview-timeout') {
          controller.hide()
          MNUtil.showHUD('标题重构工作台加载超时，请重试')
          return false
        }
        controller.hide()
        MNUtil.showHUD('标题重构工作台数据加载失败')
        return false
      }
      MNUtil.showHUD('正在加载标题重构工作台，请稍候...')
      controller.loadTitleRefactorWorkbenchHTML()
      await controller.show(null, { x: 30, y: 35, width: 1240, height: 820 })
      const maxWait = 2.5
      const step = 0.1
      let waited = 0
      while (!controller.webViewLoaded && waited < maxWait) {
        await MNUtil.delay(step)
        waited += step
      }
      const result = await controller.loadTitleRefactorWorkbenchData(targetNote.noteId)
      KnowledgeBaseUtils.log('标题重构工作台数据已发送到 HTML 端', 'openTitleRefactorWorkbench', {
        noteId: targetNote.noteId,
        webViewLoaded: controller.webViewLoaded,
        waited,
      })
      if (result && result.success) return true
      if (result && result.reason === 'payload-too-large') {
        controller.hide()
        MNUtil.showHUD(`归类子树超过 ${result.limit || TITLE_REFACTOR_MAX_CARDS} 张，已阻止加载以避免卡死`)
        return false
      }
      if (result && result.reason === 'webview-timeout') {
        controller.hide()
        MNUtil.showHUD('标题重构工作台加载超时，请重试')
        return false
      }
      controller.hide()
      MNUtil.showHUD('标题重构工作台数据加载失败')
      return false
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'openTitleRefactorWorkbench')
      MNUtil.showHUD('打开标题重构工作台失败：' + (error.message || error))
      return false
    } finally {
      self._titleRefactorWorkbenchOpening = false
    }
  }

  MNKnowledgeBaseClass.prototype.prepareProofStructureWorkbenchData = function(noteOrId, fieldName) {
    try {
      const note = typeof noteOrId === "string" ? MNNote.new(noteOrId, false) : noteOrId
      if (!note || !note.noteId) return null

      const noteType = KnowledgeBaseTemplate.getNoteType(note) || ""
      const normalizeField = (value) => KnowledgeBaseTemplate.normalizeFieldName(String(value || ""))
      const aliasMap = KnowledgeBaseTemplate.fieldAliasMapping
        && KnowledgeBaseTemplate.fieldAliasMapping["证明"]
        ? KnowledgeBaseTemplate.fieldAliasMapping["证明"]
        : {}
      const resolvedFieldName = KnowledgeBaseTemplate.resolveFieldName("证明", noteType)
      const proofFieldNames = new Set(["证明", "反例", "原理", resolvedFieldName]
        .concat(Object.keys(aliasMap).map(key => aliasMap[key]))
        .filter(Boolean)
        .map(normalizeField))
      const requestedFieldName = normalizeField(fieldName)
      if (!requestedFieldName || !proofFieldNames.has(requestedFieldName)) return null

      const parsed = KnowledgeBaseTemplate.parseNoteComments(note)
      const fields = parsed && Array.isArray(parsed.htmlCommentsObjArr)
        ? parsed.htmlCommentsObjArr
        : []
      const fieldObject = fields.find(field => normalizeField(field && field.text) === requestedFieldName)
      if (!fieldObject || !proofFieldNames.has(normalizeField(fieldObject.text))) return null

      const managerData = this.prepareCommentDataForManager(note, {
        reason: "proof-structure-workbench",
        forceApply: true,
      })
      if (!managerData || !Array.isArray(managerData.comments)) return null

      const fieldIndices = Array.isArray(fieldObject.excludingFieldBlockIndexArr)
        ? fieldObject.excludingFieldBlockIndexArr.map(index => Number(index)).filter(Number.isInteger)
        : []
      const fieldIndexSet = new Set(fieldIndices)
      const comments = managerData.comments.filter(comment => fieldIndexSet.has(Number(comment && comment.index)))
      const startIndex = fieldIndices.length > 0 ? fieldIndices[0] : fieldObject.index + 1
      const endIndex = fieldIndices.length > 0 ? fieldIndices[fieldIndices.length - 1] : fieldObject.index

      return {
        noteId: String(note.noteId),
        noteTitle: String(note.noteTitle || note.title || "(无标题)"),
        noteType,
        revision: managerData.revision || "",
        field: {
          name: requestedFieldName,
          text: String(fieldObject.text || requestedFieldName),
          index: Number(fieldObject.index),
          startIndex,
          endIndex,
          commentIndices: fieldIndices,
        },
        comments,
      }
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "prepareProofStructureWorkbenchData")
      return null
    }
  }

  MNKnowledgeBaseClass.prototype.openProofStructureWorkbench = async function(noteOrId, fieldName) {
    try {
      const note = typeof noteOrId === "string" ? MNNote.new(noteOrId, false) : noteOrId
      const payload = this.prepareProofStructureWorkbenchData(note, fieldName)
      if (!payload) {
        MNUtil.showHUD("无法打开结构图：目标证明字段不存在或已变化")
        return false
      }

      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (typeof controller.canReplaceCommentSurface === "function" &&
        !(await controller.canReplaceCommentSurface())) {
        MNUtil.showHUD("当前工作台有未完成操作，暂时不能切换")
        return false
      }

      this.currentManagedNote = note
      this.currentProofStructureContext = {
        noteId: payload.noteId,
        fieldName: payload.field.name,
      }
      if (controller.onAnimate) {
        await MNUtil.delay(0.5)
        return this.openProofStructureWorkbench(note, payload.field.name)
      }

      const needReload = controller.currentHTMLType !== "proof-structure-workbench" || !controller.webViewLoaded
      if (!needReload) {
        await controller.show()
        const result = await controller.loadProofStructureWorkbenchData(payload.noteId, payload.field.name)
        return !!(result && result.success)
      }

      controller.loadProofStructureWorkbenchHTML()
      await controller.show()
      let waited = 0
      while (!controller.webViewLoaded && waited < 2.5) {
        await MNUtil.delay(0.1)
        waited += 0.1
      }
      const result = await controller.loadProofStructureWorkbenchData(payload.noteId, payload.field.name)
      KnowledgeBaseUtils.log("证明结构工作台数据已发送", "openProofStructureWorkbench", {
        noteId: payload.noteId,
        fieldName: payload.field.name,
        webViewLoaded: controller.webViewLoaded,
        waited,
      })
      if (result && result.success) return true
      MNUtil.showHUD("证明结构图数据加载失败")
      return false
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "openProofStructureWorkbench")
      MNUtil.showHUD("打开证明结构图失败：" + (error.message || error))
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.returnFromProofStructureWorkbench = async function(noteId, fieldName, commentIndex, expectedRevision) {
    const note = MNNote.new(String(noteId || ""), false)
    const payload = this.prepareProofStructureWorkbenchData(note, fieldName)
    if (!payload) {
      MNUtil.showHUD("原证明字段已变化，无法回源")
      return false
    }
    const normalizedIndex = Number(commentIndex)
    if (Number.isInteger(normalizedIndex) && normalizedIndex >= 0) {
      if (expectedRevision && expectedRevision !== payload.revision) {
        MNUtil.showHUD("原评论已变化，请刷新证明后再定位")
        return false
      }
      if (!payload.field.commentIndices.includes(normalizedIndex)) {
        MNUtil.showHUD("原评论已不在该字段中")
        return false
      }
      self.currentCommentManagerFocusIndex = normalizedIndex
    }
    return (await this.openCommentManager(note)) !== false
  }

  MNKnowledgeBaseClass.prototype.openProofStructureHtmlMDStudio = async function(noteId, fieldName, commentIndex, expectedRevision) {
    const note = MNNote.new(String(noteId || ""), false)
    const payload = this.prepareProofStructureWorkbenchData(note, fieldName)
    const normalizedIndex = Number(commentIndex)
    if (payload && expectedRevision && expectedRevision !== payload.revision) {
      MNUtil.showHUD("原评论已变化，请刷新证明后再编辑")
      return false
    }
    const comment = payload && payload.comments.find(item => Number(item && item.index) === normalizedIndex)
    const isHtmlMD = comment && (
      comment.detailedType === "markdownComment"
      || !!comment.htmlMarkdownType
    )
    if (!payload || !Number.isInteger(normalizedIndex) || !isHtmlMD) {
      MNUtil.showHUD("该评论不能在 HtmlMD Studio 中打开")
      return false
    }
    self.currentHtmlMDStudioFocusIndex = normalizedIndex
    await this.openHtmlMDStudio(note)
    return true
  }

  MNKnowledgeBaseClass.prototype.refreshOpenCommentManagerForNote = async function(note, options = {}) {
    try {
      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (!controller || !controller.view || controller.view.hidden) return false
      if (controller.currentHTMLType !== 'comment-manager' || !controller.webViewLoaded) return false

      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote || !targetNote.noteId) return false

      const force = options.force === true
      const currentNoteId = self.currentManagedNote && self.currentManagedNote.noteId
        ? String(self.currentManagedNote.noteId)
        : ''
      const targetNoteId = String(targetNote.noteId)
      if (!force && currentNoteId === targetNoteId) return false

      self.currentManagedNote = targetNote
      await controller.loadCommentData(targetNoteId, {
        force,
        reason: options.source || "refresh-open-comment-manager",
        showLoadedFeedback: options.showHUD === true,
      })

      KnowledgeBaseUtils.log("评论管理器已刷新", "refreshOpenCommentManagerForNote", {
        source: options.source || "",
        noteId: targetNoteId,
        noteTitle: targetNote.noteTitle || "",
        sameNote: currentNoteId === targetNoteId,
      })

      if (options.showHUD === true) {
        MNUtil.showHUD("评论管理器已更新到当前卡片")
      }
      return true
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "refreshOpenCommentManagerForNote")
      if (options.showHUD === true) {
        MNUtil.showHUD("更新评论管理器失败：" + error.message)
      }
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.refreshOpenTemplateWorkbenchForNote = async function(note, options = {}) {
    try {
      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (!controller || !controller.view || controller.view.hidden) return false
      if (controller.currentHTMLType !== 'template-workbench' || !controller.webViewLoaded) return false

      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote || !targetNote.noteId) return false

      const force = options.force === true
      const currentNoteId = self.currentManagedNote && self.currentManagedNote.noteId
        ? String(self.currentManagedNote.noteId)
        : ''
      const targetNoteId = String(targetNote.noteId)
      if (!force && currentNoteId === targetNoteId) return false

      self.currentManagedNote = targetNote
      await controller.loadTemplateWorkbenchData(targetNoteId)

      KnowledgeBaseUtils.log("模板工作台已切换卡片", "refreshOpenTemplateWorkbenchForNote", {
        source: options.source || "",
        noteId: targetNoteId,
        noteTitle: targetNote.noteTitle || "",
      })

      if (options.showHUD === true) {
        MNUtil.showHUD("模板工作台已更新到当前卡片")
      }
      return true
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "refreshOpenTemplateWorkbenchForNote")
      if (options.showHUD === true) {
        MNUtil.showHUD("更新模板工作台失败：" + error.message)
      }
      return false
    }
  }

  MNKnowledgeBaseClass.prototype.refreshOpenQuestionResearchWorkbenchForNote = async function(note, options = {}) {
    try {
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (!controller || !controller.view || controller.view.hidden) return false
      if (controller.currentHTMLType !== 'question-research-workbench' || !controller.webViewLoaded) return false

      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote || !targetNote.noteId) return false
      const mayReplace = await controller.runJavaScript(`(
        window.Bridge && typeof window.Bridge.canReplaceContext === "function"
          ? window.Bridge.canReplaceContext()
          : false
      )`)
      if (!mayReplace) {
        if (options.showHUD !== false) MNUtil.showHUD('问题研究工作台有未保存草稿，已阻止切换卡片')
        return false
      }

      self.currentManagedNote = targetNote
      await controller.loadResearchWorkbenchData(String(targetNote.noteId), {
        reason: options.source || 'selection-change',
        forceApply: options.force === true,
      })
      return true
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'refreshOpenQuestionResearchWorkbenchForNote')
      return false
    }
  }

  /**
   * 将问题研究工作台需要的单张卡片转换成可编辑的字段模型。
   * HtmlComment 只负责字段分隔，永远不作为可编辑评论下发。
   */
  MNKnowledgeBaseClass.prototype.prepareResearchWorkbenchNode = function(note, options = {}) {
    if (!note || !note.noteId) return null

    const rawComments = Array.isArray(note.comments) ? note.comments : []
    const mnComments = Array.isArray(note.MNComments) ? note.MNComments : []
    const parsed = KnowledgeBaseTemplate.parseNoteComments(note) || {}
    const fieldObjects = Array.isArray(parsed.htmlCommentsObjArr)
      ? parsed.htmlCommentsObjArr
      : []
    const noteType = KnowledgeBaseTemplate.getNoteType(note) || ''
    const safeText = (comment, mnComment) => {
      if (mnComment && mnComment.text !== undefined && mnComment.text !== null) {
        return String(mnComment.text)
      }
      if (comment && comment.text !== undefined && comment.text !== null) {
        return String(comment.text)
      }
      return ''
    }
    const linkInfo = (text) => {
      const match = String(text || '').match(/(?:^|\s)(?:\[([^\]]+)\]\((marginnote[34]app:\/\/note\/[^)]+)\)|((?:marginnote[34]app:\/\/note\/)[^\s)]+))/i)
      if (!match) return { linkedNoteId: '', linkedNoteTitle: '', noteURL: '' }
      const noteURL = match[2] || match[3] || ''
      const linkedNoteId = typeof KnowledgeBaseTemplate.extractNoteIdFromLinkUrl === 'function'
        ? (KnowledgeBaseTemplate.extractNoteIdFromLinkUrl(noteURL) || '')
        : ((noteURL.match(/note\/([^/?#]+)/i) || [])[1] || '')
      let linkedNoteTitle = ''
      if (linkedNoteId) {
        try {
          const linkedNote = MNNote.new(linkedNoteId, false)
          linkedNoteTitle = linkedNote ? String(linkedNote.noteTitle || linkedNote.title || '') : ''
        } catch (_) {}
      }
      return { linkedNoteId, linkedNoteTitle, noteURL }
    }
    const makeComment = (index) => {
      const rawComment = rawComments[index] || {}
      const mnComment = mnComments[index] || {}
      const rawType = String(rawComment.type || '')
      const type = String(mnComment.type || rawType || '')
      const text = safeText(rawComment, mnComment)
      const markdown = !!(rawComment.markdown || mnComment.markdown)
      const links = linkInfo(text)
      return {
        index,
        type,
        rawType,
        text,
        markdown,
        editable: type === 'TextNote' && rawType !== 'HtmlComment',
        linkedNoteId: links.linkedNoteId,
        linkedNoteTitle: links.linkedNoteTitle,
        noteURL: links.noteURL,
      }
    }

    const fields = fieldObjects.map((field) => {
      const indices = Array.isArray(field.excludingFieldBlockIndexArr)
        ? field.excludingFieldBlockIndexArr
        : []
      return {
        name: String(field.text || '').trim(),
        comments: indices
          .filter((index) => Number.isInteger(index) && index >= 0 && index < rawComments.length)
          .map(makeComment),
      }
    })

    // 未合并模板的卡片可能还没有 HtmlComment 字段；保留一个安全的“未分组”区域，
    // 让工作台仍能编辑真实 TextNote，而不会把字段当成一整段字符串。
    if (fields.length === 0 && rawComments.length > 0) {
      fields.push({
        name: '未分组内容',
        comments: rawComments.map((_, index) => makeComment(index)),
      })
    }

    return {
      noteId: String(note.noteId),
      noteURL: String(note.noteURL || `marginnote4app://note/${note.noteId}`),
      title: String(note.noteTitle || note.title || '(无标题)'),
      type: noteType,
      role: options.role || noteType.toLowerCase(),
      parentId: note.parentNote && note.parentNote.noteId ? String(note.parentNote.noteId) : '',
      depth: Number(options.depth) || 0,
      relation: options.relation || '',
      revision: this.getCommentRevisionForManager(note),
      fields,
    }
  }

  MNKnowledgeBaseClass.prototype.prepareResearchWorkbenchData = function(entryNote, options = {}) {
    const entry = typeof entryNote === 'string'
      ? MNNote.new(entryNote, false)
      : entryNote
    if (!entry || !entry.noteId) return null

    const maxDepth = Math.max(1, Math.min(Number(options.maxDepth) || 12, 20))
    const maxNodes = Math.max(10, Math.min(Number(options.maxNodes) || 200, 500))
    const entryType = KnowledgeBaseTemplate.getNoteType(entry) || ''
    let rootQuestion = null
    let cursor = entry
    const ancestorIds = new Set()
    while (cursor && cursor.noteId && !ancestorIds.has(String(cursor.noteId))) {
      const cursorId = String(cursor.noteId)
      ancestorIds.add(cursorId)
      if (KnowledgeBaseTemplate.getNoteType(cursor) === '问题') {
        rootQuestion = cursor
        break
      }
      cursor = cursor.parentNote
    }

    const ideas = []
    const summaries = []
    const seen = new Set()
    const pushNode = (note, role, depth, parentId, relation) => {
      if (!note || !note.noteId || seen.has(String(note.noteId)) || seen.size >= maxNodes) return null
      const node = this.prepareResearchWorkbenchNode(note, { role, depth, relation })
      if (!node) return null
      node.parentId = parentId || node.parentId || ''
      seen.add(node.noteId)
      if (role === 'idea') ideas.push(node)
      if (role === 'summary') summaries.push(node)
      return node
    }
    const walk = (parent, parentId, depth) => {
      if (!parent || depth >= maxDepth || seen.size >= maxNodes) return
      let children = []
      try { children = Array.isArray(parent.childNotes) ? parent.childNotes : [] } catch (_) { children = [] }
      children.forEach((child) => {
        if (!child || !child.noteId || seen.size >= maxNodes) return
        const childType = KnowledgeBaseTemplate.getNoteType(child) || ''
        if (childType === '思路' || childType === '总结') {
          pushNode(child, childType === '思路' ? 'idea' : 'summary', depth, parentId, 'child')
          walk(child, String(child.noteId), depth + 1)
        } else if (depth <= 1) {
          // 问题卡片下偶尔存在未分类的中间卡，只穿透第一层，避免把整棵脑图误收进工作台。
          walk(child, parentId, depth + 1)
        }
      })
    }

    let rootNode = null
    if (rootQuestion) {
      rootNode = this.prepareResearchWorkbenchNode(rootQuestion, {
        role: 'question',
        depth: 0,
        relation: 'root',
      })
      if (rootNode) {
        seen.add(rootNode.noteId)
        walk(rootQuestion, rootNode.noteId, 1)
      }
    }

    const entryNode = this.prepareResearchWorkbenchNode(entry, {
      role: entryType === '问题'
        ? 'question'
        : (entryType === '思路' ? 'idea' : (entryType === '总结' ? 'summary' : 'card')),
      depth: rootQuestion && entry.noteId !== rootQuestion.noteId ? 1 : 0,
      relation: rootQuestion && entry.noteId !== rootQuestion.noteId ? 'selected' : 'root',
    })
    if (entryNode && !seen.has(entryNode.noteId)) {
      seen.add(entryNode.noteId)
      if (entryNode.role === 'idea') ideas.unshift(entryNode)
      if (entryNode.role === 'summary') summaries.unshift(entryNode)
    }

    return {
      entry: entryNode,
      rootQuestion: rootNode,
      sourceCards: [],
      ideas,
      summaries,
      isOrphan: !rootQuestion,
      preferredSelectedId: String(entry.noteId),
      forceApply: options.forceApply === true,
    }
  }

  MNKnowledgeBaseClass.prototype.applyResearchWorkbenchUpdates = async function(payload = {}) {
    const updates = Array.isArray(payload.updates) ? payload.updates : []
    const grouped = new Map()
    updates.forEach((update) => {
      const noteId = update && update.noteId ? String(update.noteId) : ''
      if (!noteId) return
      if (!grouped.has(noteId)) grouped.set(noteId, [])
      grouped.get(noteId).push(update)
    })
    if (grouped.size === 0) return { success: true, changedNoteIds: [], conflicts: [] }

    const conflicts = []
    const notes = []
    for (const [noteId, noteUpdates] of grouped.entries()) {
      const note = MNNote.new(noteId, false)
      if (!note) {
        conflicts.push({ noteId, reason: 'note-missing' })
        continue
      }
      const currentRevision = this.getCommentRevisionForManager(note)
      const baseRevision = noteUpdates[0] && noteUpdates[0].baseRevision
        ? String(noteUpdates[0].baseRevision)
        : ''
      if (!baseRevision || baseRevision !== currentRevision) {
        conflicts.push({ noteId, reason: 'revision-changed', currentRevision })
        continue
      }
      const currentComments = Array.isArray(note.comments) ? note.comments : []
      const currentMNComments = Array.isArray(note.MNComments) ? note.MNComments : []
      const seenIndices = new Set()
      for (const update of noteUpdates) {
        const index = Number(update.index)
        const mnComment = Number.isInteger(index) ? currentMNComments[index] : null
        const rawComment = Number.isInteger(index) ? currentComments[index] : null
        const currentType = mnComment && mnComment.type ? String(mnComment.type) : String(rawComment && rawComment.type || '')
        const currentText = mnComment && mnComment.text !== undefined
          ? String(mnComment.text)
          : String(rawComment && rawComment.text || '')
        if (seenIndices.has(index) || !rawComment || !mnComment || currentType !== 'TextNote' || String(update.baseText || '') !== currentText) {
          conflicts.push({ noteId, index, reason: 'comment-changed' })
        }
        seenIndices.add(index)
      }
      if (!conflicts.some((item) => item.noteId === noteId)) notes.push({ note, noteUpdates })
    }

    if (conflicts.length > 0) {
      return { success: false, stale: true, changedNoteIds: [], conflicts }
    }

    const changedNoteIds = []
    const apply = () => {
      notes.forEach(({ note, noteUpdates }) => {
        noteUpdates.forEach((update) => {
          const index = Number(update.index)
          const text = update.text === undefined || update.text === null ? '' : String(update.text)
          const rawComment = note.comments[index] || {}
          if (rawComment.markdown) {
            note.appendMarkdownComment(text, index)
          } else {
            note.appendTextComment(text, index)
          }
        })
        if (typeof note.refresh === 'function') note.refresh()
        changedNoteIds.push(String(note.noteId))
      })
    }
    if (typeof MNUtil.undoGrouping === 'function') MNUtil.undoGrouping(apply)
    else apply()

    for (const noteId of changedNoteIds) {
      try {
        await this.refreshSearchCardIndex(noteId, {
          showErrorHUD: false,
          showSuccessHUD: false,
          reason: 'research-workbench-save',
        })
      } catch (error) {
        KnowledgeBaseUtils.log('问题研究工作台保存后刷新索引失败', 'applyResearchWorkbenchUpdates', {
          noteId,
          error: error && error.message ? error.message : String(error),
        })
      }
    }
    return { success: true, changedNoteIds, conflicts: [] }
  }

  MNKnowledgeBaseClass.prototype.createResearchWorkbenchNode = async function(payload = {}) {
    const parentNote = payload.parentNoteId ? MNNote.new(String(payload.parentNoteId), false) : null
    const typeKey = payload.type === 'summary' ? '总结' : (payload.type === 'idea' ? '思路' : '')
    const title = String(payload.title || '').trim()
    const body = String(payload.body || '').trim()
    if (!parentNote || !typeKey || !title) {
      return { success: false, error: '缺少父卡片、类型或标题' }
    }
    const parentRevision = String(payload.parentRevision || '')
    if (!parentRevision || parentRevision !== this.getCommentRevisionForManager(parentNote)) {
      return { success: false, stale: true, error: '父卡片版本已变化' }
    }
    const config = KnowledgeBaseTemplate.types[typeKey]
    if (!config || !config.templateNoteId) return { success: false, error: '缺少模板配置' }

    let childNote = null
    const create = () => {
      childNote = MNNote.clone(config.templateNoteId)
      if (!childNote) throw new Error('模板卡片创建失败')
      let prefixContent = KnowledgeBaseTemplate.createChildNoteTitlePrefixContent(parentNote)
      const parentQuestionChainContext = typeof KnowledgeBaseTemplate.getQuestionChainContext === 'function'
        ? KnowledgeBaseTemplate.getQuestionChainContext(parentNote)
        : null
      if (typeKey === '思路' && KnowledgeBaseTemplate.getNoteType(parentNote) === '思路' && !parentQuestionChainContext) {
        const parentTitleParts = KnowledgeBaseTemplate.parseNoteTitle(parentNote) || {}
        prefixContent = prefixContent + '｜💡 ' + String(parentTitleParts.content || '')
      }
      const childTitle = KnowledgeBaseTemplate.createTitlePrefix(config.prefixName, prefixContent) + title
      childNote.noteTitle = childTitle
      parentNote.addChild(childNote)

      const childUrl = String(childNote.noteURL || `marginnote4app://note/${childNote.noteId}`)
      const parentLink = KnowledgeBaseTemplate.makeMarkdownInlineNoteLink(title, childUrl)
      parentNote.appendMarkdownComment(HtmlMarkdownUtils.createHtmlMarkdownText(parentLink, typeKey === '思路' ? 'idea' : 'remark'))
      const targetField = typeKey === '思路'
        ? KnowledgeBaseTemplate.getIdeaLinkMoveToField(parentNote)
        : (KnowledgeBaseTemplate.getNoteType(parentNote) === '总结' ? '要点列举' : '相关思考')
      if (targetField) KnowledgeBaseTemplate.moveCommentsArrToField(parentNote, 'Z', targetField)

      if (body) {
        childNote.appendMarkdownComment(body)
        KnowledgeBaseTemplate.moveCommentsArrToField(
          childNote,
          'Z',
          typeKey === '思路' ? '思路详情' : '核心总结',
        )
      }

      if (typeof KnowledgeBaseTemplate.upsertNoteNativeLinkInField === 'function') {
        KnowledgeBaseTemplate.upsertNoteNativeLinkInField(childNote, parentNote, '相关链接')
      } else {
        childNote.appendNoteLink(parentNote, 'To')
        KnowledgeBaseTemplate.moveCommentsArrToField(childNote, 'Z', '相关链接')
      }
      if (typeof parentNote.refresh === 'function') parentNote.refresh()
      if (typeof childNote.refresh === 'function') childNote.refresh()
    }
    try {
      if (typeof MNUtil.undoGrouping === 'function') MNUtil.undoGrouping(create)
      else create()
      if (!childNote || !childNote.noteId) throw new Error('未取得新卡片 ID')
      for (const noteId of [parentNote.noteId, childNote.noteId]) {
        try {
          await this.refreshSearchCardIndex(noteId, {
            showErrorHUD: false,
            showSuccessHUD: false,
            reason: 'research-workbench-create',
          })
        } catch (_) {}
      }
      return { success: true, noteId: String(childNote.noteId), parentNoteId: String(parentNote.noteId) }
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'createResearchWorkbenchNode', { typeKey, title }, false)
      return { success: false, error: error && error.message ? error.message : String(error) }
    }
  }

  MNKnowledgeBaseClass.prototype.getDefinitionMergeWorkbenchRevision = function(sourceDefinition, targetDefinition) {
    let hash = 2166136261
    const feed = value => {
      const valueText = value === undefined || value === null ? "" : String(value)
      for (let index = 0; index < valueText.length; index += 1) {
        hash ^= valueText.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      hash ^= 31
      hash = Math.imul(hash, 16777619)
    }
    const seen = new Set()
    let exceededLimit = false
    const walk = note => {
      if (!note || !note.noteId || seen.has(String(note.noteId))) return
      if (seen.size >= 500) {
        exceededLimit = true
        return
      }
      const noteId = String(note.noteId)
      seen.add(noteId)
      feed(this.getCommentRevisionForManager(note))
      feed(note.parentNote && note.parentNote.noteId ? note.parentNote.noteId : "")
      let children = []
      try { children = Array.isArray(note.childNotes) ? note.childNotes.slice() : [] } catch (_) { children = [] }
      feed(children.map(child => child && child.noteId ? String(child.noteId) : "").join("|"))
      children.forEach(walk)
    }
    walk(sourceDefinition)
    walk(targetDefinition)
    return exceededLimit ? "" : `definition-merge:${seen.size}:${(hash >>> 0).toString(16)}`
  }

  MNKnowledgeBaseClass.prototype.getDefinitionMergeClassificationTitle = function(note) {
    const title = String(note && (note.noteTitle || note.title) || "").trim()
    let content = title
    try {
      const parts = KnowledgeBaseTemplate.parseNoteTitle(note) || {}
      content = String(parts.content || title).trim()
    } catch (_) {}
    const quoted = content.match(/[“"]([^”"]+)[”"]/);
    if (quoted && quoted[1]) content = quoted[1]
    const segments = content.split(/[｜|]/).map(item => item.trim()).filter(Boolean)
    return segments.length ? segments[segments.length - 1] : content
  }

  MNKnowledgeBaseClass.prototype.prepareDefinitionMergeClassificationNode = function(note, depth = 0) {
    if (!note || !note.noteId || KnowledgeBaseTemplate.getNoteType(note) !== "归类") return null
    let children = []
    try { children = Array.isArray(note.childNotes) ? note.childNotes.slice() : [] } catch (_) { children = [] }
    let nestedCount = 0
    let totalKnowledgeCount = 0
    const seen = new Set()
    const countDescendants = current => {
      if (!current || !current.noteId || seen.has(String(current.noteId)) || seen.size >= 500) return
      seen.add(String(current.noteId))
      let descendants = []
      try { descendants = Array.isArray(current.childNotes) ? current.childNotes.slice() : [] } catch (_) { descendants = [] }
      descendants.forEach(child => {
        if (!child || !child.noteId) return
        if (KnowledgeBaseTemplate.getNoteType(child) === "归类") {
          nestedCount += 1
          countDescendants(child)
        } else {
          totalKnowledgeCount += 1
        }
      })
    }
    countDescendants(note)
    let subtype = "归类"
    try {
      const titleParts = KnowledgeBaseTemplate.parseNoteTitle(note) || {}
      subtype = String(titleParts.type || "归类")
    } catch (_) {}
    return {
      noteId: String(note.noteId),
      title: String(note.noteTitle || note.title || "(无标题)"),
      shortTitle: this.getDefinitionMergeClassificationTitle(note),
      subtype,
      parentId: note.parentNote && note.parentNote.noteId ? String(note.parentNote.noteId) : "",
      depth: Number(depth) || 0,
      revision: this.getCommentRevisionForManager(note),
      knowledgeCount: children.filter(child => child && KnowledgeBaseTemplate.getNoteType(child) !== "归类").length,
      totalKnowledgeCount,
      nestedCount,
      children: children.slice(0, 30).map(child => ({
        noteId: child && child.noteId ? String(child.noteId) : "",
        kind: child ? (KnowledgeBaseTemplate.getNoteType(child) || "卡片") : "卡片",
        title: String(child && (child.noteTitle || child.title) || "(无标题)"),
      })),
      knowledgeChildren: children
        .filter(child => child && child.noteId && KnowledgeBaseTemplate.getNoteType(child) !== "归类")
        .map(child => ({
          noteId: String(child.noteId),
          kind: KnowledgeBaseTemplate.getNoteType(child) || "卡片",
          title: String(child.noteTitle || child.title || "(无标题)"),
        })),
    }
  }

  MNKnowledgeBaseClass.prototype.prepareDefinitionMergeWorkbenchData = function(sourceNoteOrId, targetNoteOrId) {
    const sourceDefinition = typeof sourceNoteOrId === "string"
      ? MNNote.new(sourceNoteOrId, false)
      : sourceNoteOrId
    const targetDefinition = typeof targetNoteOrId === "string"
      ? MNNote.new(targetNoteOrId, false)
      : targetNoteOrId
    const errors = []
    if (!sourceDefinition || !sourceDefinition.noteId) errors.push("来源定义卡不存在")
    if (!targetDefinition || !targetDefinition.noteId) errors.push("目标定义卡不存在")
    if (errors.length === 0 && String(sourceDefinition.noteId) === String(targetDefinition.noteId)) {
      errors.push("来源和目标不能是同一张卡")
    }
    if (sourceDefinition && KnowledgeBaseTemplate.getNoteType(sourceDefinition) !== "定义") {
      errors.push("来源 A 不是定义卡")
    }
    if (targetDefinition && KnowledgeBaseTemplate.getNoteType(targetDefinition) !== "定义") {
      errors.push("目标 B 不是定义卡")
    }
    if (errors.length === 0 && sourceDefinition.notebookId && targetDefinition.notebookId &&
      String(sourceDefinition.notebookId) !== String(targetDefinition.notebookId)) {
      errors.push("两张定义卡不在同一学习集，不能移动归类树")
    }
    const isAncestor = (ancestor, candidate) => {
      if (!ancestor || !candidate || !ancestor.noteId) return false
      const ancestorId = String(ancestor.noteId)
      const seen = new Set()
      let cursor = candidate.parentNote
      while (cursor && cursor.noteId && !seen.has(String(cursor.noteId))) {
        const cursorId = String(cursor.noteId)
        if (cursorId === ancestorId) return true
        seen.add(cursorId)
        cursor = cursor.parentNote
      }
      return false
    }
    const sourceIsDirectChild = !!(sourceDefinition && sourceDefinition.parentNote && targetDefinition &&
      String(sourceDefinition.parentNote.noteId) === String(targetDefinition.noteId))
    const targetIsAncestor = isAncestor(targetDefinition, sourceDefinition)
    if (errors.length === 0 &&
      (isAncestor(sourceDefinition, targetDefinition) || (targetIsAncestor && !sourceIsDirectChild))) {
      errors.push("两张定义卡存在祖先关系，仅支持子定义并入直接父定义")
    }
    const revision = errors.length === 0
      ? this.getDefinitionMergeWorkbenchRevision(sourceDefinition, targetDefinition)
      : ""
    if (errors.length === 0 && !revision) errors.push("合并范围超过 500 张卡片，请缩小范围后重试")

    const safeChildren = note => {
      try { return note && Array.isArray(note.childNotes) ? note.childNotes.slice() : [] } catch (_) { return [] }
    }
    const sourceRoots = errors.length === 0
      ? safeChildren(sourceDefinition).filter(note => KnowledgeBaseTemplate.getNoteType(note) === "归类")
      : []
    const targetNodes = []
    const targetSeen = new Set()
    const walkTarget = (note, depth) => {
      if (!note || !note.noteId || targetSeen.has(String(note.noteId)) || targetSeen.size >= 500) return
      if (KnowledgeBaseTemplate.getNoteType(note) !== "归类") return
      targetSeen.add(String(note.noteId))
      const model = this.prepareDefinitionMergeClassificationNode(note, depth)
      if (model) targetNodes.push(model)
      safeChildren(note).forEach(child => {
        if (KnowledgeBaseTemplate.getNoteType(child) === "归类") walkTarget(child, depth + 1)
      })
    }
    if (errors.length === 0) {
      safeChildren(targetDefinition).forEach(note => walkTarget(note, 0))
    }
    const sourceNodes = sourceRoots
      .map(note => this.prepareDefinitionMergeClassificationNode(note, 0))
      .filter(Boolean)
    const normalize = value => String(value || "").replace(/[\s，,。.;；:：'"“”‘’()[\]【】]/g, "").toLowerCase()
    sourceNodes.forEach(source => {
      const exact = targetNodes.find(target => {
        return normalize(target.shortTitle) === normalize(source.shortTitle) && target.subtype === source.subtype
      }) || targetNodes.find(target => normalize(target.shortTitle) === normalize(source.shortTitle))
      source.suggestedTarget = exact ? exact.noteId : "move"
      source.reason = exact
        ? `建议目标：${exact.shortTitle}`
        : "目标树中没有同名归类，建议整树迁移"
    })

    return {
      sourceDefinition: sourceDefinition ? {
        noteId: String(sourceDefinition.noteId || ""),
        title: String(sourceDefinition.noteTitle || sourceDefinition.title || "(无标题)"),
        revision: this.getCommentRevisionForManager(sourceDefinition),
      } : null,
      targetDefinition: targetDefinition ? {
        noteId: String(targetDefinition.noteId || ""),
        title: String(targetDefinition.noteTitle || targetDefinition.title || "(无标题)"),
        revision: this.getCommentRevisionForManager(targetDefinition),
      } : null,
      sourceNodes,
      targetNodes,
      revision,
      canSwap: errors.length === 0 && !targetIsAncestor,
      swapDisabledReason: targetIsAncestor ? "子定义只能并入直接父定义，不能交换合并方向" : "",
      canExecute: errors.length === 0,
      errors,
    }
  }

  MNKnowledgeBaseClass.prototype.applyDefinitionMergePlan = async function(payload = {}) {
    const plan = payload && payload.plan && typeof payload.plan === "object" ? payload.plan : null
    if (!plan) return { success: false, error: "缺少合并方案" }
    const sourceId = String(plan.sourceDefinitionId || "")
    const targetId = String(plan.targetDefinitionId || "")
    const sourceDefinition = sourceId ? MNNote.new(sourceId, false) : null
    const targetDefinition = targetId ? MNNote.new(targetId, false) : null
    const current = this.prepareDefinitionMergeWorkbenchData(sourceDefinition, targetDefinition)
    if (!current || current.canExecute !== true) {
      return { success: false, stale: true, error: (current && current.errors && current.errors[0]) || "合并上下文无效" }
    }
    if (!plan.baseRevision || String(plan.baseRevision) !== String(current.revision)) {
      return { success: false, stale: true, error: "卡片结构已变化，请刷新后重新确认" }
    }
    if (plan.prefixMode !== "knowledge") {
      return { success: false, error: "当前版本只支持更新换父知识点前缀" }
    }
    if (plan.titleMode !== "source" && plan.titleMode !== "target") {
      return { success: false, error: "标题策略无效" }
    }

    const sourceIds = new Set(current.sourceNodes.map(node => String(node.noteId)))
    const targetIds = new Set(current.targetNodes.map(node => String(node.noteId)))
    const mappings = Array.isArray(plan.mappings) ? plan.mappings : []
    const mappingBySource = new Map()
    for (const mapping of mappings) {
      const mappingSourceId = String(mapping && mapping.sourceId || "")
      const mappingTargetId = String(mapping && mapping.targetId || "")
      if (!sourceIds.has(mappingSourceId) || mappingBySource.has(mappingSourceId)) {
        return { success: false, stale: true, error: "来源归类映射无效，请刷新" }
      }
      if (mappingTargetId !== "move" && !targetIds.has(mappingTargetId)) {
        return { success: false, stale: true, error: "目标归类映射无效，请刷新" }
      }
      mappingBySource.set(mappingSourceId, mappingTargetId)
    }
    if (mappingBySource.size !== sourceIds.size) {
      return { success: false, error: "存在未处理的来源归类" }
    }

    const changedNoteIds = new Set([targetId])
    const deletedNoteIds = new Set([sourceId])
    let pairedCount = 0
    let movedTreeCount = 0
    let movedKnowledgeCount = 0
    let mergedKnowledgeCount = 0
    const safeChildren = note => {
      try { return note && Array.isArray(note.childNotes) ? note.childNotes.slice() : [] } catch (_) { return [] }
    }
    const parentIdOf = note => {
      try {
        return note && note.parentNote && note.parentNote.noteId ? String(note.parentNote.noteId) : ""
      } catch (_) {
        return ""
      }
    }
    const moveChildOrThrow = (parent, child) => {
      if (!parent || !parent.noteId || !child || !child.noteId) {
        throw new Error("移动失败：父卡片或子卡片不存在")
      }
      parent.addChild(child)
      const movedChild = MNNote.new(String(child.noteId), false) || child
      if (parentIdOf(movedChild) !== String(parent.noteId)) {
        throw new Error(`移动卡片失败：${child.noteId} 未进入目标父卡片，请立即撤销一次`)
      }
      return movedChild
    }
    const refreshAndRelinkMovedChild = child => {
      if (!child || !child.noteId) return
      const childType = KnowledgeBaseTemplate.getNoteType(child)
      if (childType !== "归类") {
        KnowledgeBaseTemplate.changeTitle(child, true, null, { syncContainLinks: false })
      }
      KnowledgeBaseTemplate.linkParentNote(child, true, false)
      changedNoteIds.add(String(child.noteId))
    }
    const mergeNoteOrThrow = (target, source, options) => {
      safeChildren(source).forEach(child => {
        const movedChild = moveChildOrThrow(target, child)
        refreshAndRelinkMovedChild(movedChild)
      })
      // Counterpart links would become self-links when the source is absorbed.
      KnowledgeBaseTemplate.removeLinksToNoteInField(source, "相关链接", String(target.noteId))
      KnowledgeBaseTemplate.removeLinksToNoteInField(target, "相关链接", String(source.noteId))
      const result = KnowledgeBaseTemplate.renewKnowledgeNotesInTransaction(target, source, options)
      if (result && result.success === false) throw new Error(result.error || "卡片合并失败")
      KnowledgeBaseTemplate.removeLinksToNoteInField(target, "相关链接", String(target.noteId))
    }

    const sourceOperations = []
    for (const sourceModel of current.sourceNodes) {
      const sourceClassification = MNNote.new(sourceModel.noteId, false)
      const targetMappingId = mappingBySource.get(String(sourceModel.noteId))
      if (!sourceClassification || KnowledgeBaseTemplate.getNoteType(sourceClassification) !== "归类" ||
        parentIdOf(sourceClassification) !== sourceId) {
        return { success: false, stale: true, error: "来源归类树已变化，请刷新" }
      }
      if (!targetMappingId) {
        return { success: false, stale: true, error: "来源归类映射已失效，请刷新" }
      }
      let targetClassification = null
      if (targetMappingId !== "move") {
        targetClassification = MNNote.new(targetMappingId, false)
        if (!targetClassification || KnowledgeBaseTemplate.getNoteType(targetClassification) !== "归类") {
          return { success: false, stale: true, error: "目标归类树已变化，请刷新" }
        }
      }
      sourceOperations.push({
        sourceClassification,
        sourceModel,
        targetMappingId,
        targetClassification,
      })
    }

    const knowledgeMappings = Array.isArray(plan.knowledgeMappings) ? plan.knowledgeMappings : []
    const knowledgeMappingBySource = new Map()
    for (const mapping of knowledgeMappings) {
      const sourceKnowledgeId = String(mapping && mapping.sourceId || "")
      const targetKnowledgeId = String(mapping && mapping.targetId || "")
      if (!sourceKnowledgeId || !targetKnowledgeId || knowledgeMappingBySource.has(sourceKnowledgeId) ||
        sourceKnowledgeId === targetKnowledgeId) {
        return { success: false, stale: true, error: "知识点映射无效，请刷新" }
      }
      const operation = sourceOperations.find(item => safeChildren(item.sourceClassification)
        .some(child => child && String(child.noteId) === sourceKnowledgeId && KnowledgeBaseTemplate.getNoteType(child) !== "归类"))
      if (!operation || operation.targetMappingId === "move" || !operation.targetClassification) {
        return { success: false, stale: true, error: "知识点必须先配对归类，请刷新后重试" }
      }
      const targetKnowledge = safeChildren(operation.targetClassification).find(child => child &&
        String(child.noteId) === targetKnowledgeId && KnowledgeBaseTemplate.getNoteType(child) !== "归类")
      if (!targetKnowledge) {
        return { success: false, stale: true, error: "目标知识点已变化，请刷新" }
      }
      knowledgeMappingBySource.set(sourceKnowledgeId, {
        targetKnowledgeId,
        targetKnowledge,
      })
    }

    const execute = () => {
      if (plan.titleMode === "source") {
        if (plan.keepAliases !== false) {
          KnowledgeBaseTemplate.mergeTitleLinkWords(sourceDefinition, targetDefinition)
        }
        targetDefinition.noteTitle = String(sourceDefinition.noteTitle || sourceDefinition.title || "")
      } else if (plan.keepAliases !== false) {
        KnowledgeBaseTemplate.mergeTitleLinkWords(targetDefinition, sourceDefinition)
      }

      sourceOperations.forEach(operation => {
        const { sourceClassification, sourceModel, targetMappingId, targetClassification } = operation
        if (targetMappingId === "move") {
          const movedClassification = moveChildOrThrow(targetDefinition, sourceClassification)
          KnowledgeBaseTemplate.linkParentNote(movedClassification, true, false)
          changedNoteIds.add(String(movedClassification.noteId))
          movedTreeCount += 1
          return
        }

        const children = safeChildren(sourceClassification)
        children.forEach(child => {
          const knowledgeMerge = child && child.noteId
            ? knowledgeMappingBySource.get(String(child.noteId))
            : null
          if (knowledgeMerge) {
            const targetKnowledge = MNNote.new(knowledgeMerge.targetKnowledgeId, false) || knowledgeMerge.targetKnowledge
            if (!targetKnowledge || !targetKnowledge.noteId) {
              throw new Error(`合并失败：未找到目标知识点 ${knowledgeMerge.targetKnowledgeId}`)
            }
            KnowledgeBaseTemplate.removeLinksToNoteInField(child, "相关链接", String(sourceClassification.noteId))
            mergeNoteOrThrow(targetKnowledge, child, {
              focusAfterMerge: false,
              mergeRelatedLinks: true,
              showHUD: false,
              refreshTarget: false,
            })
            KnowledgeBaseTemplate.removeDuplicateLinksInField(targetKnowledge, "相关链接", { includeMarkdown: true })
            changedNoteIds.add(String(targetKnowledge.noteId))
            deletedNoteIds.add(String(child.noteId))
            mergedKnowledgeCount += 1
            return
          }
          const movedChild = moveChildOrThrow(targetClassification, child)
          refreshAndRelinkMovedChild(movedChild)
          if (KnowledgeBaseTemplate.getNoteType(movedChild) !== "归类") movedKnowledgeCount += 1
        })
        mergeNoteOrThrow(targetClassification, sourceClassification, {
          removeTitle: true,
          focusAfterMerge: false,
          mergeRelatedLinks: true,
          skipFields: ["所属", "包含"],
          showHUD: false,
          refreshTarget: false,
        })
        KnowledgeBaseTemplate.removeDuplicateLinksInField(targetClassification, "相关链接", {
          includeMarkdown: true,
        })
        changedNoteIds.add(String(targetClassification.noteId))
        deletedNoteIds.add(String(sourceModel.noteId))
        pairedCount += 1
      })

      safeChildren(sourceDefinition).forEach(child => {
        const movedChild = moveChildOrThrow(targetDefinition, child)
        refreshAndRelinkMovedChild(movedChild)
      })
      const structuralLinkIds = new Set()
      sourceOperations.forEach(operation => {
        structuralLinkIds.add(String(operation.sourceModel.noteId))
        if (operation.targetMappingId !== "move") structuralLinkIds.add(String(operation.targetMappingId))
      })
      structuralLinkIds.forEach(noteId => {
        KnowledgeBaseTemplate.removeLinksToNoteInField(sourceDefinition, "相关链接", noteId)
      })
      mergeNoteOrThrow(targetDefinition, sourceDefinition, {
        removeTitle: true,
        focusAfterMerge: false,
        mergeRelatedLinks: true,
        showHUD: false,
        refreshTarget: false,
      })
      KnowledgeBaseTemplate.removeDuplicateLinksInField(targetDefinition, "相关链接", {
        includeMarkdown: true,
      })
      changedNoteIds.forEach(noteId => {
        const note = MNNote.new(noteId, false)
        if (note && typeof note.refresh === "function") note.refresh()
      })
    }

    try {
      if (typeof MNUtil.undoGrouping === "function") MNUtil.undoGrouping(execute)
      else execute()
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "applyDefinitionMergePlan", {
        sourceId,
        targetId,
      }, false)
      const message = error && error.message ? error.message : String(error)
      return {
        success: false,
        requiresUndo: true,
        error: /撤销一次/.test(message) ? message : `${message}；合并可能已部分执行，请立即撤销一次`,
      }
    }

    for (const noteId of Array.from(new Set([...changedNoteIds, ...deletedNoteIds]))) {
      try {
        await this.refreshSearchCardIndex(noteId, {
          showErrorHUD: false,
          showSuccessHUD: false,
          reason: "definition-merge-workbench",
        })
      } catch (_) {}
    }
    try { targetDefinition.focusInMindMap(0.3) } catch (_) {}
    return {
      success: true,
      targetDefinitionId: targetId,
      targetTitle: String(targetDefinition.noteTitle || targetDefinition.title || ""),
      pairedCount,
      movedTreeCount,
      movedKnowledgeCount,
      mergedKnowledgeCount,
      deletedCount: deletedNoteIds.size,
      changedNoteIds: Array.from(changedNoteIds),
      deletedNoteIds: Array.from(deletedNoteIds),
    }
  }

  MNKnowledgeBaseClass.prototype.openDefinitionMergeWorkbench = async function(sourceNoteOrId, targetNoteOrId) {
    try {
      const sourceNote = typeof sourceNoteOrId === "string" ? MNNote.new(sourceNoteOrId, false) : sourceNoteOrId
      const targetNote = typeof targetNoteOrId === "string" ? MNNote.new(targetNoteOrId, false) : targetNoteOrId
      const payload = this.prepareDefinitionMergeWorkbenchData(sourceNote, targetNote)
      if (!payload || payload.canExecute !== true) {
        MNUtil.showHUD((payload && payload.errors && payload.errors[0]) || "请选择两张定义卡")
        return false
      }

      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (typeof controller.canReplaceCommentSurface === "function" &&
        !(await controller.canReplaceCommentSurface())) {
        MNUtil.showHUD("当前工作台正在执行，暂时不能切换")
        return false
      }
      this.currentDefinitionMergeContext = {
        sourceNoteId: String(sourceNote.noteId),
        targetNoteId: String(targetNote.noteId),
      }
      this.currentManagedNote = targetNote
      const needReload = controller.currentHTMLType !== "definition-merge-workbench" || !controller.webViewLoaded
      if (controller.onAnimate) {
        await MNUtil.delay(0.5)
        return this.openDefinitionMergeWorkbench(sourceNote, targetNote)
      }
      if (!needReload) {
        await controller.show(null)
        const loadResult = await controller.loadDefinitionMergeWorkbenchData(sourceNote.noteId, targetNote.noteId)
        if (loadResult && loadResult.success === true) return true
        MNUtil.showHUD("定义卡合并工作台数据加载失败")
        return false
      }

      controller.loadDefinitionMergeWorkbenchHTML()
      await controller.show(null)
      const maxWait = 2.5
      const step = 0.1
      let waited = 0
      while (!controller.webViewLoaded && waited < maxWait) {
        await MNUtil.delay(step)
        waited += step
      }
      const loadResult = await controller.loadDefinitionMergeWorkbenchData(sourceNote.noteId, targetNote.noteId)
      KnowledgeBaseUtils.log("定义卡合并工作台数据已发送", "openDefinitionMergeWorkbench", {
        sourceNoteId: sourceNote.noteId,
        targetNoteId: targetNote.noteId,
        webViewLoaded: controller.webViewLoaded,
        waited,
      })
      if (loadResult && loadResult.success === true) return true
      MNUtil.showHUD("定义卡合并工作台数据加载失败")
      return false
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, "openDefinitionMergeWorkbench")
      MNUtil.showHUD("打开定义卡合并工作台失败：" + (error.message || error))
      return false
    }
  }

  /**
   * 打开 HtmlMD Studio
   * @param {MNNote} note
   */
  MNKnowledgeBaseClass.prototype.openHtmlMDStudio = async function(note) {
    try {
      KnowledgeBaseUtils.log("开始", "openHtmlMDStudio")

      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote) {
        MNUtil.showHUD("请先选中一张卡片")
        KnowledgeBaseUtils.log("未找到目标卡片", "openHtmlMDStudio")
        return
      }

      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (typeof controller.canReplaceCommentSurface === 'function' &&
        !(await controller.canReplaceCommentSurface())) {
        MNUtil.showHUD('问题研究工作台有未保存草稿，已阻止切换面板')
        return
      }
      self.currentManagedNote = targetNote
      const needReload = controller.currentHTMLType !== 'htmlmd-studio' || !controller.webViewLoaded

      if (controller.onAnimate) {
        await MNUtil.delay(0.5)
        return this.openHtmlMDStudio(targetNote)
      }

      if (!needReload) {
        await controller.show(
          null,
          { x: 30, y: 40, width: 1240, height: 760 }
        )
        await controller.loadCommentData(targetNote.noteId)
        return
      }

      MNUtil.showHUD("正在加载 HtmlMD Studio,请稍候...")
      controller.loadHtmlMDStudioHTML()
      await controller.show(
        null,
        { x: 30, y: 40, width: 1240, height: 760 }
      )

      const maxWait = 2.5
      const step = 0.1
      let waited = 0
      while (!controller.webViewLoaded && waited < maxWait) {
        await MNUtil.delay(step)
        waited += step
      }
      await controller.loadCommentData(targetNote.noteId)
      KnowledgeBaseUtils.log("数据已发送到 HtmlMD Studio", "openHtmlMDStudio", {
        webViewLoaded: controller.webViewLoaded,
        waited: waited,
      })
    } catch (error) {
      KnowledgeBaseUtils.log("发生异常: " + error.message, "openHtmlMDStudio")
      MNUtil.showHUD("打开 HtmlMD Studio 失败：" + error.message)
      KnowledgeBaseUtils.addErrorLog(error, "openHtmlMDStudio")
    }
  }

  /**
   * 打开模板工作台
   * @param {MNNote} note
   */
  MNKnowledgeBaseClass.prototype.openTemplateWorkbench = async function(note) {
    try {
      KnowledgeBaseUtils.log("开始", "openTemplateWorkbench")

      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote) {
        MNUtil.showHUD("请先选中一张卡片")
        KnowledgeBaseUtils.log("未找到目标卡片", "openTemplateWorkbench")
        return
      }

      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (typeof controller.canReplaceCommentSurface === 'function' &&
        !(await controller.canReplaceCommentSurface())) {
        MNUtil.showHUD('问题研究工作台有未保存草稿，已阻止切换面板')
        return
      }
      self.currentManagedNote = targetNote
      const needReload = controller.currentHTMLType !== 'template-workbench' || !controller.webViewLoaded

      if (controller.onAnimate) {
        await MNUtil.delay(0.5)
        return this.openTemplateWorkbench(targetNote)
      }

      if (!needReload) {
        await controller.show(null)
        await controller.loadTemplateWorkbenchData(targetNote.noteId)
        return
      }

      controller.loadTemplateWorkbenchHTML()
      await controller.show(null)

      const maxWait = 2.5
      const step = 0.1
      let waited = 0
      while (!controller.webViewLoaded && waited < maxWait) {
        await MNUtil.delay(step)
        waited += step
      }
      await controller.loadTemplateWorkbenchData(targetNote.noteId)
      KnowledgeBaseUtils.log("数据已发送到模板工作台", "openTemplateWorkbench", {
        webViewLoaded: controller.webViewLoaded,
        waited: waited,
      })
    } catch (error) {
      KnowledgeBaseUtils.log("发生异常: " + error.message, "openTemplateWorkbench")
      MNUtil.showHUD("打开模板工作台失败：" + error.message)
      KnowledgeBaseUtils.addErrorLog(error, "openTemplateWorkbench")
    }
  }

  /**
   * 打开问题研究工作台。
   * 页面只在 ready 后接收 Native 数据，避免首次打开时渲染原型/mock 内容。
   */
  MNKnowledgeBaseClass.prototype.openQuestionResearchWorkbench = async function(note) {
    try {
      const targetNote = note || MNNote.getFocusNote()
      if (!targetNote) {
        MNUtil.showHUD('请先选中一张问题、思路或总结卡片')
        return
      }

      KnowledgeBaseUtils.checkCommentWebViewController()
      const controller = KnowledgeBaseUtils.commentWebViewController
      if (typeof controller.canReplaceCommentSurface === 'function' &&
        !(await controller.canReplaceCommentSurface())) {
        const currentId = self.currentManagedNote && self.currentManagedNote.noteId
          ? String(self.currentManagedNote.noteId)
          : ''
        if (controller.currentHTMLType === 'question-research-workbench' && currentId === String(targetNote.noteId)) {
          await controller.show()
          return
        }
        MNUtil.showHUD('问题研究工作台有未保存草稿，已阻止切换卡片')
        return
      }
      self.currentManagedNote = targetNote
      const needReload = controller.currentHTMLType !== 'question-research-workbench' || !controller.webViewLoaded

      if (controller.onAnimate) {
        await MNUtil.delay(0.5)
        return this.openQuestionResearchWorkbench(targetNote)
      }

      if (!needReload) {
        await controller.show()
        await controller.loadResearchWorkbenchData(targetNote.noteId, { reason: 'open-reuse' })
        return
      }

      MNUtil.showHUD('正在加载问题研究工作台，请稍候...')
      controller.loadQuestionResearchWorkbenchHTML()
      await controller.show()

      const maxWait = 2.5
      const step = 0.1
      let waited = 0
      while (!controller.webViewLoaded && waited < maxWait) {
        await MNUtil.delay(step)
        waited += step
      }
      await controller.loadResearchWorkbenchData(targetNote.noteId, { reason: 'open-first-load' })
      KnowledgeBaseUtils.log('问题研究工作台数据已发送到 HTML 端', 'openQuestionResearchWorkbench', {
        noteId: targetNote.noteId,
        webViewLoaded: controller.webViewLoaded,
        waited,
      })
    } catch (error) {
      KnowledgeBaseUtils.addErrorLog(error, 'openQuestionResearchWorkbench')
      MNUtil.showHUD('打开问题研究工作台失败：' + error.message)
    }
  }

  // 返回定义的插件类，MarginNote 会自动实例化这个类
  return MNKnowledgeBaseClass;
};
