// ========================================
// Knowledge Base Web Controller
// 知识库 WebView 控制器
// ========================================

const KB_SEARCH_SCHEME = "mnknowledgebase"
const KB_COMMENT_SCHEME = "mnknowledgebase-comment"
const KB_CLOSE_TAP_GUARD_MS = 350
const KB_HANDWRITING_RETRY_INTERVAL = 1
const KB_HANDWRITING_RETRY_LIMIT = 60
const KB_PREVENT_AUTO_CLOSE_ACTIONS = new Set([
  // 首次打开页面时的初始化握手，不应该把面板自己关掉。
  "ready",
  "htmlready",
  // 刷新/日志是基础设施动作，不属于用户完成操作后的收尾。
  "refreshalldata",
  "refreshsearchcardindex",
  "locatecurrentmnselectedcard",
  "getdescendantcardids",
  "applyclassificationtitleplan",
  "activatependinglocalsearch",
  "htmllog",
  // AI 推荐和自动识别需要继续留在当前面板展示结果。
  "autonewcontent",
  "airecommendclassification",
  "aisearchgetmodels",
  "aisearchsetmodel",
  "aisearchrerank",
  "aisearchcancelrerank",
])

const KB_COMMENT_MUTATION_ACTIONS = new Set([
  "applyhtmlmdcommentupdates",
  "appendhtmlmdcomment",
  "movecommentstofield",
  "movecomments",
  "deletecomments",
  "deletebidirectionallinks",
  "extractcomments",
  "updatecommentlink",
  "replaceplaceholderlink",
  "convertlinkcommentstoinlinelinks",
  "editmarkdownlink",
  "mergeinlinelinkcomments",
  "mergetextcomments",
])

function runUndoGroupingWithoutGlobalDBRefresh(block, notebookId) {
  if (typeof block !== "function") return
  const util = typeof MNUtil !== "undefined" ? MNUtil : undefined
  const finalNotebookId = notebookId || (util ? util.currentNotebookId : undefined)
  if (util && typeof util.undoGroupingNotRefresh === "function") {
    util.undoGroupingNotRefresh(block, finalNotebookId)
    return
  }
  if (typeof UndoManager !== "undefined" &&
    UndoManager &&
    typeof UndoManager.sharedInstance === "function") {
    UndoManager.sharedInstance().undoGrouping(String(Date.now()), finalNotebookId, block)
    return
  }
  block()
}

async function refreshSearchMutationNotes(notes) {
  const noteById = new Map()
  const normalizedNotes = Array.isArray(notes) ? notes : []
  normalizedNotes.forEach((note) => {
    const noteId = note && note.noteId ? String(note.noteId) : ''
    if (noteId && !noteById.has(noteId)) {
      noteById.set(noteId, note)
    }
  })

  const noteIds = Array.from(noteById.keys())
  const startedAt = Date.now()
  const refreshedNoteIds = []
  const failedNoteIds = []

  if (typeof KnowledgeBaseUtils !== 'undefined' && KnowledgeBaseUtils &&
    typeof KnowledgeBaseUtils.log === 'function') {
    KnowledgeBaseUtils.log('双向链接局部刷新开始', 'searchPerf.bidirectionalLink', {
      noteIds,
    })
  }

  for (const [noteId, originalNote] of noteById) {
    try {
      let note = originalNote
      if (typeof MNNote !== 'undefined' && MNNote && typeof MNNote.new === 'function') {
        note = MNNote.new(noteId) || originalNote
      }
      if (!note || typeof note.refresh !== 'function') {
        throw new Error('MNNote.refresh unavailable')
      }
      await note.refresh()
      refreshedNoteIds.push(noteId)
    } catch (error) {
      failedNoteIds.push(noteId)
      if (typeof KnowledgeBaseUtils !== 'undefined' && KnowledgeBaseUtils &&
        typeof KnowledgeBaseUtils.log === 'function') {
        KnowledgeBaseUtils.log('双向链接局部刷新失败', 'searchPerf.bidirectionalLink', {
          noteId,
          durationMs: Date.now() - startedAt,
          error: error && error.message ? error.message : String(error),
        }, 'ERROR')
      }
    }
  }

  const result = {
    strategy: 'local-note-refresh',
    noteIds,
    refreshedNoteIds,
    failedNoteIds,
    durationMs: Date.now() - startedAt,
  }
  if (typeof KnowledgeBaseUtils !== 'undefined' && KnowledgeBaseUtils &&
    typeof KnowledgeBaseUtils.log === 'function') {
    KnowledgeBaseUtils.log('双向链接局部刷新完成', 'searchPerf.bidirectionalLink', result)
  }
  return result
}

function extractKnowledgeBaseNoteIdFromUrl(linkUrl) {
  if (typeof KnowledgeBaseTemplate !== "undefined" &&
    KnowledgeBaseTemplate &&
    typeof KnowledgeBaseTemplate.extractNoteIdFromLinkUrl === "function") {
    return KnowledgeBaseTemplate.extractNoteIdFromLinkUrl(linkUrl)
  }
  const match = String(linkUrl || "").match(/marginnote[34]app:\/\/note\/([A-Z0-9-]+)/i)
  return match && match[1] ? match[1] : ""
}

function isKnowledgeBaseMarginNoteLink(linkUrl) {
  if (typeof KnowledgeBaseTemplate !== "undefined" &&
    KnowledgeBaseTemplate &&
    typeof KnowledgeBaseTemplate.isMarginNoteLink === "function") {
    return KnowledgeBaseTemplate.isMarginNoteLink(linkUrl)
  }
  return /^marginnote[34]app:\/\/note\//i.test(String(linkUrl || ""))
}

function makeKnowledgeBaseMarkdownLink(displayText, linkUrl, options = {}) {
  if (typeof KnowledgeBaseTemplate !== "undefined" &&
    KnowledgeBaseTemplate &&
    typeof KnowledgeBaseTemplate.makeMarkdownInlineNoteLink === "function") {
    return KnowledgeBaseTemplate.makeMarkdownInlineNoteLink(displayText, linkUrl, options)
  }
  const safeDisplayText = String(displayText || "链接")
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "&#42;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .trim()
  const safeUrl = String(linkUrl || "").replace(/\)/g, "%29").trim()
  const linkText = `[${safeDisplayText}](${safeUrl})`
  return options.listItem === true ? `- ${linkText}` : linkText
}

function parseKnowledgeBaseStandaloneMarkdownLink(markdown) {
  const source = String(markdown || '').trim()
  if (!source || typeof KnowledgeBaseTemplate === 'undefined' ||
    typeof KnowledgeBaseTemplate.parseMarkdownLinksFromText !== 'function') {
    return null
  }
  const links = KnowledgeBaseTemplate.parseMarkdownLinksFromText(source)
  if (links.length !== 1) return null
  const link = links[0]
  const start = typeof link.start === 'number' ? link.start : link.startIndex
  const end = typeof link.end === 'number' ? link.end : link.endIndex
  const displayText = String(link.displayText || '').trim()
  const url = String(link.url || '').trim()
  if (start !== 0 || end !== source.length || !displayText || !url) return null
  return {
    markdown: source,
    displayText,
    url,
  }
}

function buildKnowledgeBaseMarkdownLinkReplacement(
  originalText,
  linkIndex,
  newDisplayText,
  newUrl,
  replacementMarkdown
) {
  const source = String(originalText || '')
  const allLinks = typeof KnowledgeBaseTemplate !== 'undefined' &&
    typeof KnowledgeBaseTemplate.parseMarkdownLinksFromText === 'function'
    ? KnowledgeBaseTemplate.parseMarkdownLinksFromText(source)
    : []
  if (linkIndex < 0 || linkIndex >= allLinks.length) {
    return { error: '链接索引无效' }
  }

  const directLink = String(replacementMarkdown || '').trim()
    ? parseKnowledgeBaseStandaloneMarkdownLink(replacementMarkdown)
    : null
  if (String(replacementMarkdown || '').trim() && !directLink) {
    return { error: '请输入一条完整的 Markdown 链接' }
  }

  const displayText = directLink
    ? directLink.displayText
    : String(newDisplayText || '').trim()
  const url = directLink ? directLink.url : String(newUrl || '').trim()
  if (!displayText || !url) {
    return { error: '显示文本和链接地址不能为空' }
  }

  const targetLink = allLinks[linkIndex]
  const linkStartIndex = typeof targetLink.start === 'number'
    ? targetLink.start
    : targetLink.startIndex
  const linkEndIndex = typeof targetLink.end === 'number'
    ? targetLink.end
    : targetLink.endIndex
  if (!Number.isFinite(linkStartIndex) || !Number.isFinite(linkEndIndex)) {
    return { error: '链接范围无效' }
  }

  const markdown = directLink
    ? directLink.markdown
    : makeKnowledgeBaseMarkdownLink(displayText, url)
  return {
    error: '',
    targetLink,
    newDisplayText: displayText,
    newUrl: url,
    newLinkMarkdown: markdown,
    newText: source.substring(0, linkStartIndex) +
      markdown +
      source.substring(linkEndIndex),
  }
}

function buildKnowledgeBasePlaceholderReplacementPlan(comment, linkIndex, newLinkUrl) {
  if (!comment) return { error: "评论不存在" }
  const commentType = String(comment.type || "")
  const originalText = String(comment.text || "")
  const hasLinkIndex = Number.isInteger(linkIndex) && linkIndex >= 0

  if (hasLinkIndex) {
    const parsedLinks = typeof KnowledgeBaseTemplate !== "undefined" &&
      KnowledgeBaseTemplate &&
      typeof KnowledgeBaseTemplate.parseMarkdownLinksFromText === "function"
      ? KnowledgeBaseTemplate.parseMarkdownLinksFromText(originalText)
      : []
    const targetLink = parsedLinks[linkIndex]
    if (!targetLink) return { error: "链接索引无效" }
    const replacement = buildKnowledgeBaseMarkdownLinkReplacement(
      originalText,
      linkIndex,
      targetLink.displayText,
      newLinkUrl,
      ""
    )
    if (replacement.error) return { error: replacement.error }
    return {
      error: "",
      originalText,
      oldUrl: String(replacement.targetLink.url || "").trim(),
      nextText: replacement.newText,
      mutationMode: "comment-text",
    }
  }

  if (["linkComment", "linkToNote", "summaryComment"].includes(commentType)) {
    return {
      error: "",
      originalText,
      oldUrl: originalText.trim(),
      nextText: newLinkUrl,
      mutationMode: "comment-text",
    }
  }

  if (commentType === "markdownComment" &&
    typeof KnowledgeBaseTemplate !== "undefined" &&
    KnowledgeBaseTemplate &&
    typeof KnowledgeBaseTemplate.getStandaloneNoteLinkInfoFromComment === "function") {
    const standaloneInfo = KnowledgeBaseTemplate.getStandaloneNoteLinkInfoFromComment(comment)
    if (standaloneInfo && standaloneInfo.url) {
      return {
        error: "",
        originalText,
        oldUrl: String(standaloneInfo.url || "").trim(),
        nextText: makeKnowledgeBaseMarkdownLink(
          standaloneInfo.displayText || "链接",
          newLinkUrl,
          { listItem: originalText.trim().startsWith("- ") }
        ),
        mutationMode: "markdown-comment",
      }
    }
  }

  return { error: "请选择链接评论或独立行内链接" }
}

function knowledgeBaseNoteHasApplicationLink(targetNote, sourceNoteId) {
  const expectedId = String(sourceNoteId || "").trim()
  if (!targetNote || !expectedId) return false
  const comments = Array.isArray(targetNote.MNComments) ? targetNote.MNComments : []
  return comments.some((comment) => {
    if (!comment || !comment.text) return false
    return extractKnowledgeBaseNoteIdFromUrl(comment.text) === expectedId
  })
}

function applyKnowledgeBasePlaceholderCommentText(note, commentIndex, plan, text) {
  if (!note || !plan) throw new Error("缺少占位替换参数")
  if (plan.mutationMode === "markdown-comment") {
    note.replaceWithMarkdownComment(text, commentIndex)
    return
  }
  const comment = note.MNComments[commentIndex]
  if (!comment) throw new Error("评论已变化，请刷新后重试")
  comment.text = text
}

function updateKnowledgeBaseLinkBackrefs(note, oldUrl, newUrl, logScope) {
  const oldNoteId = extractKnowledgeBaseNoteIdFromUrl(oldUrl)
  const newNoteId = extractKnowledgeBaseNoteIdFromUrl(newUrl)

  if (oldNoteId) {
    try {
      const oldTargetNote = MNNote.new(oldNoteId, false)
      if (oldTargetNote) {
        KnowledgeBaseTemplate.removeApplicationFieldLink(oldTargetNote, note.noteId)
        KnowledgeBaseUtils.log("成功移除旧反向链接", logScope, { oldNoteId })
      }
    } catch (error) {
      KnowledgeBaseUtils.log("移除旧反向链接失败", logScope, { error: error.message })
    }
  }

  if (newNoteId) {
    try {
      const newTargetNote = MNNote.new(newNoteId, false)
      if (newTargetNote) {
        KnowledgeBaseTemplate.addApplicationFieldLink(newTargetNote, note)
        KnowledgeBaseUtils.log("成功添加新反向链接", logScope, { newNoteId })
      } else {
        MNUtil.showHUD(`⚠️ 目标卡片不存在: ${newNoteId}`)
      }
    } catch (error) {
      KnowledgeBaseUtils.log("添加新反向链接失败", logScope, { error: error.message })
    }
  }
}

// 定义控制器类
var knowledgebaseWebController = JSB.defineClass('knowledgebaseWebController : UIViewController <UIWebViewDelegate>', {
  // ========================================
  // 生命周期方法
  // ========================================

  viewDidLoad: function() {
    try {
      // 初始化状态
      self.init()

      // 设置初始 frame - 尝试从 userDefaults 恢复上次的窗口大小
      let savedFrameStr = NSUserDefaults.standardUserDefaults().objectForKey("KB_WindowFrame")
      let initialFrame = savedFrameStr
        ? JSON.parse(savedFrameStr)
        : {x: 50, y: 30, width: 720, height: 720}

      self.view.frame = initialFrame
      self.lastFrame = self.view.frame
      self.currentFrame = self.view.frame

      // 创建 WebView（调整位置给顶部按钮留空间）
      self.webView = new UIWebView({x: 10, y: 25, width: 700, height: 685})
      self.webView.backgroundColor = UIColor.whiteColor()
      self.webView.delegate = self
      self.webView.scalesPageToFit = true
      self.view.addSubview(self.webView)
      self.webViewLoaded = false

      // 创建移动按钮
      self.createButton("moveButton", "moveButtonTapped:")
      self.moveButton.clickDate = 0
      MNButton.setColor(self.moveButton, "#3a81fb", 0.5)
      MNButton.addPanGesture(self.moveButton, self, "onMoveGesture:")

      // 创建关闭按钮
      self.createButton("closeButton", "closeButtonTapped:")
      self.closeButton.layer.cornerRadius = 10
      MNButton.setImage(self.closeButton, self.closeImage)
      MNButton.setColor(self.closeButton, "#e06c75")

      // 创建调整大小按钮
      self.createButton("resizeButton")
      self.resizeButton.layer.cornerRadius = 10
      self.resizeButton.backgroundColor = UIColor.clearColor()
      MNButton.setImage(self.resizeButton, self.resizeImage)
      MNButton.setColor(self.resizeButton, "#457bd3")
      MNButton.addPanGesture(self.resizeButton, self, "onResizeGesture:")

    } catch (error) {
      MNUtil.showHUD("初始化失败：" + error)
      MNUtil.copyJSON(error)
    }
  },

  viewWillLayoutSubviews: function() {
    try {
      // miniMode 时不重新布局
      if (self.miniMode) {
        return
      }

      // 如果按钮还未创建，跳过布局
      if (!self.moveButton || !self.closeButton || !self.resizeButton || !self.webView) {
        return
      }

      let viewFrame = self.view.bounds
      let width = viewFrame.width
      let height = viewFrame.height

      // 布局移动按钮
      self.moveButton.frame = {x: width * 0.5 - 75, y: 0, width: 150, height: 16}

      // 布局关闭按钮（右上角）
      self.closeButton.frame = {x: width - 40, y: 5, width: 30, height: 30}

      // 布局调整大小按钮（右下角）
      self.resizeButton.frame = {x: width - 30, y: height - 40, width: 30, height: 30}

      // 布局 WebView
      self.webView.frame = {x: 10, y: 25, width: width - 20, height: height - 35}

    } catch (error) {
      MNUtil.showHUD("布局失败：" + error)
    }
  },

  viewWillDisappear: function(animated) {
    self.cancelActiveAICardSearchRequest()
    // 清理定时器
    if (self.viewTimer) {
      self.viewTimer.invalidate()
      self.viewTimer = undefined
    }
  },

  // ========================================
  // UIWebViewDelegate - URL 拦截
  // ========================================

  webViewShouldStartLoadWithRequestNavigationType: function(webView, request, type) {
    try {

      let config = MNUtil.parseURL(request)
      KnowledgeBaseUtils.emitRuntimeLog('INFO', `【WebView拦截】scheme=${config.scheme} host=${config.host} params=${JSON.stringify(config.params)}`)

      // 拦截自定义 scheme（搜索/评论管理器分离）
      const scheme = config ? config.scheme : ""
      const isSearchScheme = scheme === KB_SEARCH_SCHEME
      const isCommentScheme = scheme === KB_COMMENT_SCHEME
      const shouldHandle = self.isCommentController ? isCommentScheme : isSearchScheme

      if (config && (isSearchScheme || isCommentScheme)) {
        if (!shouldHandle) {
          return false
        }
        // 特殊处理：自动关闭模式切换
        if (config.host === "setAutoCloseMode") {
          if (self.currentHTMLType !== 'search' || self.disableAutoClose) {
            return false
          }
          const raw = config.params.enabled
          const enabled = (raw === true || raw === 1 || raw === "1" || raw === "true")

          // ✅ 使用 KnowledgeBaseConfig 统一管理
          KnowledgeBaseConfig.setAutoCloseMode(enabled)
          self.autoCloseMode = enabled

          MNUtil.showHUD(enabled ? "已启用自动关闭" : "已禁用自动关闭")
          return false
        }

        // 同步自动关闭模式到 WebView
        if (config.host === "syncAutoCloseMode") {
          if (self.currentHTMLType !== 'search' || self.disableAutoClose) {
            return false
          }
          if (typeof self.syncAutoCloseModeToWebView === 'function') {
            self.syncAutoCloseModeToWebView()
          }
          return false
        }

        self.executeAction(config, true)  // 委托给集中处理方法
        return false
      }

      return true;
    } catch (error) {
      MNUtil.showHUD("URL 处理错误：" + error)
      return false
    }
  },

  // ========================================
  // WebView 加载事件
  // ========================================

  webViewDidFinishLoad: function(webView) {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== webViewDidFinishLoad 被调用 ===")
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "webView URL: " + webView.request.URL())

    // 标记 WebView 已加载完成
    self.webViewLoaded = true
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "webViewLoaded 设置为 true")

    // 🆕 同步 autoCloseMode 状态到 WebView（更稳健：支持页面尚未初始化 state 时缓存）
    MNUtil.delay(0.15).then(() => {
      try {
        if (typeof self.syncAutoCloseModeToWebView === 'function') {
          self.syncAutoCloseModeToWebView()
          KnowledgeBaseUtils.emitRuntimeLog('INFO', `【同步状态】autoCloseMode 已同步到 WebView: ${self.autoCloseMode}`)
        }
      } catch (error) {
        KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【同步状态】失败: " + error)
      }
    })

    // 仅在真实重新加载 search.html 后做一次自动刷新。
    // 用户手动关闭再打开时，直接复用页面和数据，不再重复刷新。
    if (!self.view.hidden && self.currentHTMLType === 'search') {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "搜索界面已显示，检查是否需要首次自动刷新")
      self.maybeRequestInitialSearchRefresh("webViewDidFinishLoad")
    }
  },

  webViewDidFailLoadWithError: function(webView, error) {
    MNUtil.showHUD("页面加载失败")
  },

  // ========================================
  // 按钮响应方法
  // ========================================

  /**
   * 移动按钮点击响应
   */
  moveButtonTapped: async function(button) {
    try {
      // Mini 模式下单击恢复
      if (self.miniMode) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "Mini 模式点击，准备恢复")
        self.fromMinimode()
        return
      }

      // 正常模式下显示功能菜单
      let commandTable = [
        {title: '📌 拖入屏幕边缘可收起为迷你浮窗', object: self, selector: '', param: ""},
      ]
      self.popoverController = MNUtil.getPopoverAndPresent(button, commandTable, 200, 1)
    } catch (error) {
      MNUtil.showHUD("操作失败")
      MNUtil.copyJSON(error)
    }
  },

  /**
   * 关闭按钮响应
   */
  closeButtonTapped: async function() {
    const now = Date.now()
    const showDelta = self.lastShowAt ? (now - self.lastShowAt) : Infinity
    if (showDelta >= 0 && showDelta < KB_CLOSE_TAP_GUARD_MS) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', `【closeButtonTapped】忽略刚打开后的误触关闭: ${showDelta}ms`)
      return
    }

    if (self.currentHTMLType === 'comment-manager' && self.webViewLoaded) {
      try {
        const result = await self.runJavaScript(`(
          window.Bridge && typeof window.Bridge.requestCloseCommentManager === "function"
            ? window.Bridge.requestCloseCommentManager("native")
            : null
        )`)
        if (result) return
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'closeButtonTapped.commentManager')
        MNUtil.showHUD('无法确认评论管理器状态，请重试')
        return
      }
    }

    if (self.currentHTMLType === 'question-research-workbench' && self.webViewLoaded) {
      try {
        const result = await self.runJavaScript(`(
          window.Bridge && typeof window.Bridge.requestCloseResearchWorkbench === "function"
            ? window.Bridge.requestCloseResearchWorkbench("native")
            : null
        )`)
        if (result) return
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'closeButtonTapped.questionResearchWorkbench')
        MNUtil.showHUD('无法确认问题研究工作台状态，请重试')
        return
      }
    }

    if (self.currentHTMLType === 'definition-merge-workbench' && self.webViewLoaded) {
      try {
        const result = await self.runJavaScript(`(
          window.Bridge && typeof window.Bridge.requestCloseDefinitionMergeWorkbench === "function"
            ? window.Bridge.requestCloseDefinitionMergeWorkbench("native")
            : null
        )`)
        if (result) return
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'closeButtonTapped.definitionMergeWorkbench')
        MNUtil.showHUD('无法确认定义卡合并工作台状态，请重试')
        return
      }
    }

    if (self.currentHTMLType === 'proof-structure-workbench' && self.webViewLoaded) {
      try {
        const result = await self.runJavaScript(`(
          window.Bridge && typeof window.Bridge.requestCloseProofStructureWorkbench === "function"
            ? window.Bridge.requestCloseProofStructureWorkbench("native")
            : null
        )`)
        if (result) return
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'closeButtonTapped.proofStructureWorkbench')
        MNUtil.showHUD('无法关闭证明结构图，请重试')
        return
      }
    }

    if (self.currentHTMLType === 'title-refactor-workbench' && self.webViewLoaded) {
      try {
        const result = await self.runJavaScript(`(
          window.Bridge && typeof window.Bridge.requestCloseTitleRefactorWorkbench === "function"
            ? window.Bridge.requestCloseTitleRefactorWorkbench("native")
            : null
        )`)
        if (result) return
      } catch (error) {
        KnowledgeBaseUtils.addErrorLog(error, 'closeButtonTapped.titleRefactorWorkbench')
        MNUtil.showHUD('无法确认标题重构工作台状态，请重试')
        return
      }
    }

    if (self.addonBar) {
      self.hide(self.addonBar.frame)
    } else {
      self.hide()
    }
  },

  // ========================================
  // 手势处理方法
  // ========================================

  /**
   * 拖动手势处理（带边缘吸附功能）
   */
  onMoveGesture: function(gesture) {
    // 如果正在动画中，忽略拖动操作
    if (self.onAnimate) {
      return
    }

    // 获取当前位置
    let locationToMN = gesture.locationInView(MNUtil.studyView)

    // 双击检测和位置计算初始化
    if (!self.locationToButton || !self.miniMode && (Date.now() - self.moveDate) > 100) {
      let translation = gesture.translationInView(MNUtil.studyView)
      let locationToBrowser = gesture.locationInView(self.view)
      let locationToButton = gesture.locationInView(gesture.view)
      let newY = locationToButton.y - translation.y
      let newX = locationToButton.x - translation.x

      if (gesture.state === 1) {
        self.lastFrame = self.view.frame
        self.locationToBrowser = {x: locationToBrowser.x - translation.x, y: locationToBrowser.y - translation.y}
        self.locationToButton = {x: newX, y: newY}
      }
    }
    self.moveDate = Date.now()

    // 计算新位置
    let location = {
      x: locationToMN.x - self.locationToButton.x - gesture.view.frame.x,
      y: locationToMN.y - self.locationToButton.y - gesture.view.frame.y
    }

    let frame = self.view.frame
    let studyFrame = MNUtil.studyView.bounds
    let y = MNUtil.constrain(location.y, 0, studyFrame.height - 15)
    let x = location.x

    // 边缘检测逻辑
    if (!self.miniMode) {
      // 非 mini 模式：靠近边缘 40px 内触发吸附
      if (locationToMN.x < 40) {
        self.toMinimode(MNUtil.genFrame(0, locationToMN.y, 40, 40), self.lastFrame)
        return
      }
      if (locationToMN.x > studyFrame.width - 40) {
        self.toMinimode(MNUtil.genFrame(studyFrame.width - 40, locationToMN.y, 40, 40), self.lastFrame)
        return
      }
    } else {
      // mini 模式的处理
      if (locationToMN.x < 50) {
        self.view.frame = MNUtil.genFrame(0, locationToMN.y - 20, 40, 40)
        return
      } else if (locationToMN.x > studyFrame.width - 50) {
        self.view.frame = MNUtil.genFrame(studyFrame.width - 40, locationToMN.y - 20, 40, 40)
        return
      } else if (locationToMN.x > 50) {
        // 从 mini 模式恢复
        let preOpacity = self.view.layer.opacity
        self.view.layer.opacity = 0
        self.setAllButton(true)
        self.onAnimate = true
        let color = "#9bb2d6"
        self.view.layer.backgroundColor = MNUtil.hexColorAlpha(color, 0.8)
        self.view.layer.borderColor = MNUtil.hexColorAlpha(color, 0.8)

        MNUtil.animate(() => {
          self.view.layer.opacity = preOpacity
          self.setFrame(x, y, self.lastFrame.width, self.lastFrame.height)
        }).then(() => {
          self.onAnimate = false
          let viewFrame = self.view.bounds
          self.moveButton.frame = {x: viewFrame.width * 0.5 - 75, y: 5, width: 150, height: 10}
          self.view.layer.borderWidth = 0
          self.view.layer.borderColor = MNUtil.hexColorAlpha(color, 0.0)
          self.view.layer.backgroundColor = MNUtil.hexColorAlpha(color, 0.0)
          self.view.hidden = false
          self.setAllButton(false)
          self.moveButton.setTitleForState("", 0)
        })
        self.miniMode = false
        return
      }
    }

    // 正常拖动
    self.setFrame(x, y, frame.width, frame.height)
  },

  /**
   * 调整大小手势处理
   */
  onResizeGesture: function(gesture) {
    try {
      // 如果正在动画中，忽略调整大小操作
      if (self.onAnimate) {
        return
      }

      if (gesture.state === 1) {
        self.originalLocationToMN = gesture.locationInView(MNUtil.studyView)
        self.originalFrame = self.view.frame
      }
      if (gesture.state === 2) {
        let locationToMN = gesture.locationInView(MNUtil.studyView)
        let locationDiff = {x: locationToMN.x - self.originalLocationToMN.x, y: locationToMN.y - self.originalLocationToMN.y}
        let frame = self.view.frame
        let studyFrame = MNUtil.studyView.bounds

        // 计算新的宽度和高度
        frame.width = self.originalFrame.width + locationDiff.x
        frame.height = self.originalFrame.height + locationDiff.y

        // 最小尺寸限制
        if (frame.width <= 300) {
          frame.width = 300
        }
        if (frame.height <= 200) {
          frame.height = 200
        }

        // 确保调整大小后不超出屏幕右边界
        if (frame.x + frame.width > studyFrame.width) {
          frame.width = studyFrame.width - frame.x
        }

        // 确保调整大小后不超出屏幕底部
        if (frame.y + frame.height > studyFrame.height - 20) {
          frame.height = studyFrame.height - frame.y - 20
        }

        self.setFrame(frame)
      }
      if (gesture.state === 3) {
        MNUtil.studyView.bringSubviewToFront(self.view)

        // 保存调整后的窗口大小（与 hide() 方法中的逻辑一致）
        try {
          let currentFrame = self.view.frame
          let frameToSave = {
            x: currentFrame.x,
            y: currentFrame.y,
            width: currentFrame.width,
            height: currentFrame.height
          }
          NSUserDefaults.standardUserDefaults().setObjectForKey(
            JSON.stringify(frameToSave),
            self.getFrameStorageKey()
          )
        } catch (error) {
          KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【onResizeGesture】保存窗口大小失败: " + error)
        }
      }
    } catch (error) {
      MNUtil.showHUD("调整大小失败：" + error)
      MNUtil.copyJSON(error)
    }
  }
})

knowledgebaseWebController.prototype.loadHTMLFile = function() {
  try {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== loadHTMLFile 开始 ===")

  // 如果当前已经是 search 类型且已加载，复用页面但重新拉取全量索引。
  if (this.currentHTMLType === 'search' && this.webViewLoaded) {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "【优化】search.html 已加载，跳过重复加载")
    this._searchNeedsInitialRefresh = true
    if (typeof this.syncAutoCloseModeToWebView === 'function') {
      this.syncAutoCloseModeToWebView()
    }
    if (!this.view.hidden) {
      this.maybeRequestInitialSearchRefresh("loadHTMLFile-reuse")
    }
    return
  }

    let htmlPath = KnowledgeBaseConfig.mainPath + "/search.html"
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "HTML 路径: " + htmlPath)

    // 检查文件是否存在
    if (!MNUtil.isfileExists(htmlPath)) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "错误: HTML 文件不存在!")
      MNUtil.showHUD("HTML 文件不存在：" + htmlPath)
      return
    }

    let htmlURL = NSURL.fileURLWithPath(htmlPath)
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "HTML URL: " + htmlURL)

    let request = NSURLRequest.requestWithURL(htmlURL)
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "NSURLRequest 创建成功")

    this.webView.loadRequest(request)
    this.currentHTMLType = 'search'  // 标记当前加载的 HTML 类型
    this.disableAutoClose = false
    this.webViewLoaded = false  // 重置加载标志
    this._searchNeedsInitialRefresh = true
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "loadRequest 调用成功,等待加载完成...")
  } catch (error) {
    MNUtil.showHUD("加载 HTML 失败：" + error)
    KnowledgeBaseUtils.emitRuntimeLog('ERROR', "加载 HTML 错误: " + error)
    MNUtil.copyJSON(error)
  }
}

/**
 * 加载评论管理器 HTML 文件
 */
knowledgebaseWebController.prototype.loadCommentManagerHTML = function() {
  try {
    KnowledgeBaseUtils.log("开始加载", "loadCommentManagerHTML")

    // 如果当前已经是 comment-manager 类型且已加载，直接返回
    if (this.currentHTMLType === 'comment-manager' && this.webViewLoaded) {
      KnowledgeBaseUtils.log("【优化】comment-manager.html 已加载，跳过重复加载", "loadCommentManagerHTML")
      return
    }

    let htmlPath = KnowledgeBaseConfig.mainPath + "/comment-manager.html"
    KnowledgeBaseUtils.log("HTML 路径: " + htmlPath, "loadCommentManagerHTML")

    // 检查文件是否存在
    if (!MNUtil.isfileExists(htmlPath)) {
      KnowledgeBaseUtils.log("HTML 文件不存在", "loadCommentManagerHTML")
      MNUtil.showHUD("HTML 文件不存在：" + htmlPath)
      return
    }

    let htmlURL = NSURL.fileURLWithPath(htmlPath)
    let request = NSURLRequest.requestWithURL(htmlURL)

    this.clearCommentRefreshCoordinator()
    this._commentLastRevisionByNote = {}
    this.webView.loadRequest(request)
    this.currentHTMLType = 'comment-manager'  // 标记当前加载的 HTML 类型
    this.disableAutoClose = true
    this.webViewLoaded = false  // 重置加载标志
    KnowledgeBaseUtils.log("loadRequest 调用成功，等待加载完成", "loadCommentManagerHTML")
  } catch (error) {
    MNUtil.showHUD("加载评论管理器 HTML 失败：" + error)
    KnowledgeBaseUtils.log("加载失败: " + error, "loadCommentManagerHTML")
    KnowledgeBaseUtils.addErrorLog(error, "loadCommentManagerHTML")
  }
}

knowledgebaseWebController.prototype.loadHtmlMDStudioHTML = function() {
  try {
    KnowledgeBaseUtils.log("开始加载", "loadHtmlMDStudioHTML")

    if (this.currentHTMLType === 'htmlmd-studio' && this.webViewLoaded) {
      KnowledgeBaseUtils.log("【优化】htmlmd-studio.html 已加载，跳过重复加载", "loadHtmlMDStudioHTML")
      return
    }

    let htmlPath = KnowledgeBaseConfig.mainPath + "/htmlmd-studio.html"
    KnowledgeBaseUtils.log("HTML 路径: " + htmlPath, "loadHtmlMDStudioHTML")

    if (!MNUtil.isfileExists(htmlPath)) {
      KnowledgeBaseUtils.log("HTML 文件不存在", "loadHtmlMDStudioHTML")
      MNUtil.showHUD("HTML 文件不存在：" + htmlPath)
      return
    }

    let htmlURL = NSURL.fileURLWithPath(htmlPath)
    let request = NSURLRequest.requestWithURL(htmlURL)

    this.webView.loadRequest(request)
    this.currentHTMLType = 'htmlmd-studio'
    this.disableAutoClose = true
    this.webViewLoaded = false
    KnowledgeBaseUtils.log("loadRequest 调用成功，等待加载完成", "loadHtmlMDStudioHTML")
  } catch (error) {
    MNUtil.showHUD("加载 HtmlMD Studio 失败：" + error)
    KnowledgeBaseUtils.log("加载失败: " + error, "loadHtmlMDStudioHTML")
    KnowledgeBaseUtils.addErrorLog(error, "loadHtmlMDStudioHTML")
  }
}

knowledgebaseWebController.prototype.loadTemplateWorkbenchHTML = function() {
  try {
    KnowledgeBaseUtils.log("开始加载", "loadTemplateWorkbenchHTML")

    if (this.currentHTMLType === 'template-workbench' && this.webViewLoaded) {
      KnowledgeBaseUtils.log("【优化】template-workbench.html 已加载，跳过重复加载", "loadTemplateWorkbenchHTML")
      return
    }

    let htmlPath = KnowledgeBaseConfig.mainPath + "/template-workbench.html"
    KnowledgeBaseUtils.log("HTML 路径: " + htmlPath, "loadTemplateWorkbenchHTML")

    if (!MNUtil.isfileExists(htmlPath)) {
      KnowledgeBaseUtils.log("HTML 文件不存在", "loadTemplateWorkbenchHTML")
      MNUtil.showHUD("HTML 文件不存在：" + htmlPath)
      return
    }

    let htmlURL = NSURL.fileURLWithPath(htmlPath)
    let request = NSURLRequest.requestWithURL(htmlURL)

    this.webView.loadRequest(request)
    this.currentHTMLType = 'template-workbench'
    this.disableAutoClose = true
    this.webViewLoaded = false
    KnowledgeBaseUtils.log("loadRequest 调用成功，等待加载完成", "loadTemplateWorkbenchHTML")
  } catch (error) {
    MNUtil.showHUD("加载模板工作台失败：" + error)
    KnowledgeBaseUtils.log("加载失败: " + error, "loadTemplateWorkbenchHTML")
    KnowledgeBaseUtils.addErrorLog(error, "loadTemplateWorkbenchHTML")
  }
}

knowledgebaseWebController.prototype.loadQuestionResearchWorkbenchHTML = function() {
  try {
    if (this.currentHTMLType === 'question-research-workbench' && this.webViewLoaded) return

    const htmlPath = KnowledgeBaseConfig.mainPath + '/question-research-workbench.html'
    if (!MNUtil.isfileExists(htmlPath)) {
      MNUtil.showHUD('问题研究工作台 HTML 文件不存在：' + htmlPath)
      return
    }

    const htmlURL = NSURL.fileURLWithPath(htmlPath)
    const request = NSURLRequest.requestWithURL(htmlURL)
    this.currentHTMLType = 'question-research-workbench'
    this.disableAutoClose = true
    this.webViewLoaded = false
    this.webView.loadRequest(request)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadQuestionResearchWorkbenchHTML')
    MNUtil.showHUD('加载问题研究工作台失败：' + error)
  }
}

knowledgebaseWebController.prototype.loadDefinitionMergeWorkbenchHTML = function() {
  try {
    if (this.currentHTMLType === 'definition-merge-workbench' && this.webViewLoaded) return

    const htmlPath = KnowledgeBaseConfig.mainPath + '/definition-merge-workbench.html'
    if (!MNUtil.isfileExists(htmlPath)) {
      MNUtil.showHUD('定义卡合并工作台 HTML 文件不存在：' + htmlPath)
      return
    }

    const htmlURL = NSURL.fileURLWithPath(htmlPath)
    const request = NSURLRequest.requestWithURL(htmlURL)
    this.currentHTMLType = 'definition-merge-workbench'
    this.disableAutoClose = true
    this.webViewLoaded = false
    this.webView.loadRequest(request)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadDefinitionMergeWorkbenchHTML')
    MNUtil.showHUD('加载定义卡合并工作台失败：' + error)
  }
}

knowledgebaseWebController.prototype.loadProofStructureWorkbenchHTML = function() {
  try {
    if (this.currentHTMLType === 'proof-structure-workbench' && this.webViewLoaded) return

    const htmlPath = KnowledgeBaseConfig.mainPath + '/proof-structure-workbench.html'
    if (!MNUtil.isfileExists(htmlPath)) {
      MNUtil.showHUD('证明结构工作台 HTML 文件不存在：' + htmlPath)
      return
    }

    const htmlURL = NSURL.fileURLWithPath(htmlPath)
    const request = NSURLRequest.requestWithURL(htmlURL)
    this.currentHTMLType = 'proof-structure-workbench'
    this.disableAutoClose = true
    this.webViewLoaded = false
    this.webView.loadRequest(request)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadProofStructureWorkbenchHTML')
    MNUtil.showHUD('加载证明结构工作台失败：' + error)
  }
}

knowledgebaseWebController.prototype.loadTitleRefactorWorkbenchHTML = function() {
  try {
    if (this.currentHTMLType === 'title-refactor-workbench' && this.webViewLoaded) return

    const htmlPath = KnowledgeBaseConfig.mainPath + '/title-refactor-workbench.html'
    if (!MNUtil.isfileExists(htmlPath)) {
      MNUtil.showHUD('标题重构工作台 HTML 文件不存在：' + htmlPath)
      return
    }

    const htmlURL = NSURL.fileURLWithPath(htmlPath)
    const request = NSURLRequest.requestWithURL(htmlURL)
    this.currentHTMLType = 'title-refactor-workbench'
    this.disableAutoClose = true
    this.webViewLoaded = false
    this.webView.loadRequest(request)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadTitleRefactorWorkbenchHTML')
    MNUtil.showHUD('加载标题重构工作台失败：' + error)
  }
}

knowledgebaseWebController.prototype.canReplaceCommentSurface = async function() {
  const guardedWorkbench = this.currentHTMLType === 'question-research-workbench' ||
    this.currentHTMLType === 'definition-merge-workbench' ||
    this.currentHTMLType === 'title-refactor-workbench'
  if (!guardedWorkbench || !this.webViewLoaded) return true
  try {
    return !!(await this.runJavaScript(`(
      window.Bridge && typeof window.Bridge.canReplaceContext === "function"
        ? window.Bridge.canReplaceContext()
        : false
    )`))
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'canReplaceCommentSurface')
    return false
  }
}

knowledgebaseWebController.prototype.maybeRequestInitialSearchRefresh = function(trigger = 'unknown') {
  if (this.currentHTMLType !== 'search') {
    return false
  }

  if (!this._searchNeedsInitialRefresh) {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', `【${trigger}】search.html 复用中，跳过自动刷新`)
    return false
  }

  this._searchNeedsInitialRefresh = false
  KnowledgeBaseUtils.emitRuntimeLog('INFO', `【${trigger}】执行首次自动刷新`)
  this.requestSearchAutoRefresh({ showSuccessHUD: false })
  return true
}

knowledgebaseWebController.prototype.shouldAutoCloseAfterAction = function(closedWebView, success, action) {
  if (!closedWebView || !success) return false
  if (this.disableAutoClose || !this.autoCloseMode || this.currentHTMLType !== 'search') return false

  const actionLower = String(action || '').trim().toLowerCase()
  return !KB_PREVENT_AUTO_CLOSE_ACTIONS.has(actionLower)
}

knowledgebaseWebController.prototype.autoCloseAfterAction = function() {
  MNUtil.delay(0.1).then(() => {
    if (this.view.hidden || this.currentHTMLType !== 'search') {
      return
    }

    if (this.addonBar) {
      this.hide(this.addonBar.frame)
    } else {
      this.hide()
    }
  })
}

/**
 * 规范化 noteId / noteURL，统一返回 noteId 字符串
 * @param {any} raw
 * @returns {string|null}
 */
function normalizeNoteIdValue(raw) {
  if (raw === undefined || raw === null) return null

  if (typeof raw !== "string") {
    try {
      raw = String(raw)
    } catch (_) {
      return null
    }
  }

  raw = raw.trim()
  if (!raw) return null

  // Normalize marginnote URL -> noteId if needed.
  try {
    if (typeof raw.isValidNoteURL === "function" && typeof raw.toNoteId === "function") {
      if (raw.isValidNoteURL()) {
        raw = raw.toNoteId()
      }
    }
  } catch (e) {
    // ignore and fallback to regex below
  }

  // Fallback for environments where String prototype helpers aren't available.
  if (/^marginnote\d?app:\/\//i.test(raw) || /^marginnote4app:\/\//i.test(raw)) {
    const m = raw.match(/\/note\/([^?#]+)/i)
    if (m && m[1]) {
      raw = m[1]
    }
  }

  const normalized = String(raw || "").trim()
  return normalized || null
}

/**
 * 从 URL 参数中提取 noteId，兼容 id/noteId 写法
 * @param {Object} params - URL 参数对象
 * @returns {string|null} noteId
 */
function getNoteIdFromParams(params) {
  if (!params) return null
  let raw = params.noteId || params.id || params.noteID || params.noteid || null
  if (!raw) return null
  return normalizeNoteIdValue(raw)
}

/**
 * 将 URL 传入的 indexArr 规范化为数字数组，以兼容字符串/数组两种情况
 * @param {string|Array|number} indexArrParam
 * @returns {Array<number>}
 */
function normalizeIndexArray(indexArrParam) {
  // 已经是数组的情况
  if (Array.isArray(indexArrParam)) {
    return indexArrParam
      .map(i => parseInt(i, 10))
      .filter(i => !isNaN(i))
  }

  // 单个数字
  if (typeof indexArrParam === 'number') {
    const parsed = parseInt(indexArrParam, 10)
    return isNaN(parsed) ? [] : [parsed]
  }

  // 字符串需要尝试解析 JSON 或按逗号分割
  if (typeof indexArrParam === 'string') {
    try {
      const parsed = JSON.parse(indexArrParam)
      if (Array.isArray(parsed)) {
        return parsed
          .map(i => parseInt(i, 10))
          .filter(i => !isNaN(i))
      }
    } catch (error) {
      // 忽略 JSON 解析错误，尝试按逗号拆分
    }

    const parts = indexArrParam.split(',')
    return parts
      .map(i => parseInt(i, 10))
      .filter(i => !isNaN(i))
  }

  return []
}

function isDocumentSelectionActive(selection) {
  try {
    if (!selection) return false
    const selectionSource = String(selection.source || '').trim().toLowerCase()
    if (selectionSource === 'textview') return false
    return !!selection.onSelection
  } catch (_) {
    return false
  }
}

function createNoteFromSelectionContext(selection, docController) {
  let createdNote = null

  try {
    if (typeof MNNote !== 'undefined' && MNNote && typeof MNNote.fromSelection === 'function') {
      try {
        createdNote = docController ? MNNote.fromSelection(docController) : MNNote.fromSelection()
      } catch (_) {
        createdNote = MNNote.fromSelection()
      }
    }
  } catch (_) {
    createdNote = null
  }

  if (!createdNote && docController && typeof docController.highlightFromSelection === 'function') {
    let created = null
    try {
      created = docController.highlightFromSelection()
    } catch (_) {
      created = null
    }

    if (created) {
      if (typeof MNNote !== 'undefined' && MNNote && typeof MNNote.new === 'function') {
        try {
          createdNote = MNNote.new(created, false)
        } catch (_) {
          createdNote = null
        }
        if (!createdNote) {
          try {
            createdNote = MNNote.new(created)
          } catch (_) {
            createdNote = null
          }
        }
      }
      if (!createdNote) {
        createdNote = created
      }
    }
  }

  return createdNote || null
}

function resolveRealGroupNote(candidate) {
  if (!candidate) return null

  let note = candidate
  const currentNotebookId = (() => {
    try {
      return String(MNUtil.currentNotebookId || '').trim()
    } catch (_) {
      return ''
    }
  })()

  if (typeof note.realGroupNoteForTopicId === 'function') {
    try {
      const realNote = currentNotebookId
        ? note.realGroupNoteForTopicId(currentNotebookId)
        : note.realGroupNoteForTopicId()
      if (realNote) {
        note = realNote
      }
    } catch (_) {}
  }

  const noteId = normalizeNoteIdValue(note && (note.noteId || note.id || note.noteID))
  return noteId ? note : null
}

knowledgebaseWebController.prototype.clearSearchSelectionContext = function() {
  this.searchSelectionContext = null
}

knowledgebaseWebController.prototype.captureSearchSelectionContext = function(options = {}) {
  const clearWhenMissing = options.clearWhenMissing === true
  let selection = null

  try {
    selection = MNUtil.currentSelection
  } catch (_) {
    selection = null
  }

  if (!isDocumentSelectionActive(selection)) {
    if (clearWhenMissing) {
      this.clearSearchSelectionContext()
      KnowledgeBaseUtils.log('清空搜索选区上下文', 'captureSearchSelectionContext', {
        reason: options.reason || 'missing_selection',
      })
    }
    return null
  }

  let docController = null
  try {
    docController = selection.docController || MNUtil.currentDocController || null
  } catch (_) {
    docController = null
  }

  const context = {
    selection,
    docController,
    selectionText: (() => {
      try {
        return String(selection.text || MNUtil.selectionText || '').trim()
      } catch (_) {
        return ''
      }
    })(),
    sourceNoteId: normalizeNoteIdValue(
      (selection && (selection.noteId || selection.noteID || selection.noteURL || selection.noteUrl)) || null
    ),
    sourceNoteTitle: (() => {
      try {
        return String((selection && (selection.noteTitle || selection.title)) || '').trim()
      } catch (_) {
        return ''
      }
    })(),
    isText: (() => {
      try {
        return !!selection.isText
      } catch (_) {
        return false
      }
    })(),
    capturedAt: Date.now(),
    reason: options.reason || '',
  }

  this.searchSelectionContext = context
  KnowledgeBaseUtils.log('锁定搜索选区上下文', 'captureSearchSelectionContext', {
    reason: context.reason,
    selectionText: context.selectionText ? context.selectionText.slice(0, 80) : '',
    sourceNoteId: context.sourceNoteId || '',
    isText: context.isText,
  })
  return context
}

knowledgebaseWebController.prototype.createExcerptNoteFromSearchSelection = function(options = {}) {
  const consumeOnSuccess = options.consumeOnSuccess !== false
  const contexts = []

  let activeSelection = null
  try {
    activeSelection = MNUtil.currentSelection
  } catch (_) {
    activeSelection = null
  }

  if (isDocumentSelectionActive(activeSelection)) {
    let activeDocController = null
    try {
      activeDocController = activeSelection.docController || MNUtil.currentDocController || null
    } catch (_) {
      activeDocController = null
    }
    contexts.push({
      selection: activeSelection,
      docController: activeDocController,
      selectionText: (() => {
        try {
          return String(activeSelection.text || MNUtil.selectionText || '').trim()
        } catch (_) {
          return ''
        }
      })(),
      source: 'active',
    })
  }

  if (this.searchSelectionContext && this.searchSelectionContext.docController) {
    const lockedSelection = this.searchSelectionContext.selection || null
    const duplicated = contexts.some(item => item.selection && lockedSelection && item.selection === lockedSelection)
    if (!duplicated) {
      contexts.push(Object.assign({ source: 'locked' }, this.searchSelectionContext))
    }
  }

  if (!contexts.length) {
    return { ok: false, reason: 'selection_required' }
  }

  for (const context of contexts) {
    const docController = context.docController || null
    if (!docController || typeof docController.highlightFromSelection !== 'function') {
      continue
    }

    let createdNote = createNoteFromSelectionContext(context.selection || null, docController)
    createdNote = resolveRealGroupNote(createdNote)
    if (!createdNote) {
      continue
    }

    const noteId = normalizeNoteIdValue(createdNote.noteId)
    if (!noteId) {
      continue
    }

    if (consumeOnSuccess) {
      this.clearSearchSelectionContext()
    }

    return {
      ok: true,
      note: createdNote,
      noteId,
      source: context.source || 'unknown',
      selectionText: String(context.selectionText || '').trim(),
    }
  }

  return { ok: false, reason: 'excerpt_create_failed' }
}

// ========================================
// 核心方法 - 动作执行器
// ========================================

/**
 * 集中处理所有来自 HTML 的动作请求
 * @param {Object} config - MNUtil.parseURL 解析的配置对象
 * @param {string} config.scheme - URL scheme (mnknowledgebase)
 * @param {string} config.host - 动作名称
 * @param {Object} config.params - 参数对象
 */
knowledgebaseWebController.prototype.executeAction = async function(config, closedWebView = false) {
  let trackedCommentMutation = null
  let success = false
  let sidebarFailure = '宿主未完成操作，请核对卡片状态'
  let sidebarReceipt = null
  let sidebarReceiptSent = false
  const completeSidebarReceipt = async () => {
    if (!sidebarReceipt || sidebarReceiptSent) return
    sidebarReceiptSent = true
    const payload = { ...sidebarReceipt, success: success === true, message: success ? '' : sidebarFailure }
    this._sidebarActionReceipts.set(payload.requestId, payload)
    try {
      await this.runJavaScript(`window.completeSidebarAction && window.completeSidebarAction(${JSON.stringify(payload)})`)
    } catch (receiptError) {
      KnowledgeBaseUtils.addErrorLog(receiptError, 'executeAction.sidebarReceipt')
    }
  }
  try {
    // 统一动作名称，兼容大小写差异
    const action = (config.host || "").trim()
    const actionLower = action.toLowerCase()
    const sidebarSectionByAction = {
      mergeDuplicateKnowledgeNoteToTargetNote: 'merge',
      moveFocusNoteToTargetNoteAsChild: 'move',
      moveFocusNoteToTargetNoteAsChildAndLocate: 'move',
      moveFocusNoteToTargetNoteAsChildAndMakeNote: 'move',
      moveFocusNoteToTargetNoteAsChildAndMakeNoteAndLocate: 'move',
      moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReview: 'move',
      moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReviewAndLocate: 'move',
      addTemplateToTargetNoteAndMoveFocusNoteAsChild: 'template',
      addTemplateToTargetNoteAndMoveFocusNoteAsChildAndLocate: 'template',
    }
    const sidebarParams = config.params || {}
    if (sidebarParams.sidebarRequestId && sidebarSectionByAction[action] === sidebarParams.sidebarSection) {
      const requestId = String(sidebarParams.sidebarRequestId)
      const receipts = this._sidebarActionReceipts || (this._sidebarActionReceipts = new Map())
      if (receipts.has(requestId)) {
        const previous = receipts.get(requestId)
        if (previous && previous.action === action) {
          await this.runJavaScript(`window.completeSidebarAction && window.completeSidebarAction(${JSON.stringify(previous)})`)
        }
        return
      }
      sidebarReceipt = { requestId, section: sidebarParams.sidebarSection, action }
      receipts.set(requestId, null)
      // Bound completed receipt history without removing in-flight request identities.
      if (receipts.size > 64) {
        for (const [key, value] of receipts) {
          if (value && key !== requestId) receipts.delete(key)
          if (receipts.size <= 64) break
        }
      }
    }

    const isCommentController = !!this.isCommentController
    if (isCommentController) {
      const allowedCommentActions = new Set([
        "ready",
        "htmllog",
        "focuscardinmindmap",
        "focuscardinfloatmindmap",
        "loadcommentdata",
        "applyhtmlmdcommentupdates",
        "appendhtmlmdcomment",
        "movecommentstofield",
        "movecomments",
        "deletecomments",
        "deletebidirectionallinks",
        "extractcomments",
        "autonewcontent",
        "refreshcurrentnote",
        "refreshmanagedcommentdata",
        "updatecommentlink",
        "replaceplaceholderlink",
        "convertlinkcommentstoinlinelinks",
        "editmarkdownlink",
	        "mergeinlinelinkcomments",
	        "mergetextcomments",
	        "copytext",
	        "requestclipboardtext",
	        "closecommentmanager",
	        "researchworkbenchsave",
	        "researchworkbenchcreatenode",
	        "refreshresearchworkbench",
	        "closeresearchworkbench",
	        "executedefinitionmerge",
	        "refreshdefinitionmergeworkbench",
	        "swapdefinitionmergeworkbench",
		        "closedefinitionmergeworkbench",
		        "openproofstructureworkbench",
		        "returntocommentmanager",
		        "openproofstructurehtmlmdstudio",
		        "closeproofstructureworkbench",
		        "pintextcommenttopinner",
	        "createtemplatechainfortargetnote",
	        "applyclassificationtitleplan"
	      ])
      if (!allowedCommentActions.has(actionLower)) {
        KnowledgeBaseUtils.log("忽略非评论动作", "executeAction", { action: action })
        return
      }
    }

    const shouldTrackCommentMutation = isCommentController
      && this.currentHTMLType === 'comment-manager'
      && KB_COMMENT_MUTATION_ACTIONS.has(actionLower)
      && config.params
      && config.params.requestId
    if (shouldTrackCommentMutation) {
      const mutationNoteId = getNoteIdFromParams(config.params)
      const mutationRequestId = String(config.params.requestId)
      const baseRevision = config.params.baseRevision == null ? '' : String(config.params.baseRevision)
      const mutationNote = mutationNoteId ? MNNote.new(mutationNoteId) : null
      const currentRevision = mutationNote ? this.getCommentDataRevision(mutationNote) : ''
      trackedCommentMutation = {
        action: actionLower,
        noteId: mutationNoteId || '',
        requestId: mutationRequestId,
        baseRevision,
      }

      if (!mutationNoteId || !mutationNote) {
        await this.notifyCommentMutationComplete({
          requestId: mutationRequestId,
          action: actionLower,
          success: false,
          message: '目标卡片不存在，本次操作未执行',
        })
        return
      }

      if (!baseRevision || !currentRevision || baseRevision !== currentRevision) {
        await this.loadCommentData(mutationNoteId, {
          force: true,
          silent: true,
          reason: 'mutation-stale-recovery',
        })
        await this.notifyCommentMutationComplete({
          requestId: mutationRequestId,
          action: actionLower,
          success: false,
          stale: true,
          baseRevision,
          currentRevision,
          message: '卡片版本已变化，本次操作未执行',
        })
        return
      }
    }

    let targetNoteId = getNoteIdFromParams(config.params)
    let targetNote = targetNoteId ? MNNote.new(targetNoteId) : null
    let focusNote = MNNote.getFocusNote()

    const focusActionSet = new Set([
      "mergeduplicateknowledgenotetotargetnote",
      "mergefocusnotetotargetnoteexcerptpart",
      "mergefocusnotetotargetnoteexcerptpartabove",
      "cleartitleandmergefocusnotetotargetnoteexcerptpart",
      "cleartitleandmergefocusnotetotargetnoteexcerptpartabove",
      "cleartitlemergeandlinkoldclassificationtotargetnote",
      "cleartitlemergeandlinkoldclassificationtotargetnoteabove",
      "keeponlyexcerptandmergetotargetnote",
      "keeponlyexcerptandmergetotargetnoteabove",
      "bidirectionallinkfromefocusnotetotargetnote",
      "movefocusnotetotargetnoteaschild",
      "movefocusnotetotargetnoteaschildandlocate",
      "movefocusnotetotargetnoteaschildandmakenote",
      "movefocusnotetotargetnoteaschildandmakenoteandlocate",
      "movefocusnotetotargetnoteaschildandmakenoteandaddtoreview",
      "movefocusnotetotargetnoteaschildandmakenoteandaddtoreviewandlocate",
      "addtemplatetotargetnoteandmovefocusnoteaschild",
      "addtemplatetotargetnoteandmovefocusnoteaschildandlocate",
    ])

    const currentFocusFirstActionSet = new Set([
      "bidirectionallinkfromefocusnotetotargetnote",
    ])

    const freshNoteById = (noteId) => {
      const normalizedId = normalizeNoteIdValue(noteId)
      if (!normalizedId) return null
      return MNNote.new(normalizedId)
    }

    const parseBooleanParam = (rawValue, defaultValue = false) => {
      if (rawValue === undefined || rawValue === null || rawValue === "") {
        return defaultValue === true
      }
      return (rawValue === true || rawValue === 1 || rawValue === "1" || rawValue === "true")
    }

    const parseMaybeJSONParam = (rawValue) => {
      if (rawValue === undefined || rawValue === null || rawValue === "") {
        return rawValue
      }
      if (typeof rawValue !== "string") {
        return rawValue
      }
      const trimmed = rawValue.trim()
      if (!trimmed) {
        return ""
      }
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          return JSON.parse(trimmed)
        } catch (error) {
          return rawValue
        }
      }
      return rawValue
    }

    const focusInMindMapSafely = (note, duration = 0.5) => {
      const noteId = normalizeNoteIdValue(note && note.noteId)
      if (!noteId) return
      try {
        if (typeof MNUtil.focusNoteInMindMapById === "function") {
          MNUtil.focusNoteInMindMapById(noteId, duration)
          return
        }
        if (note && typeof note.focusInMindMap === "function") {
          note.focusInMindMap(duration)
          return
        }
        KnowledgeBaseUtils.log("脑图定位缺少可用 API", "focusInMindMapSafely", {
          noteId,
          duration,
          hasFocusById: typeof MNUtil.focusNoteInMindMapById === "function",
          hasNoteFocus: !!(note && typeof note.focusInMindMap === "function")
        }, "WARN")
      } catch (error) {
        KnowledgeBaseUtils.log("脑图定位调用失败", "focusInMindMapSafely", {
          noteId,
          duration,
          errorMessage: error?.message || String(error),
          errorStack: error?.stack || ""
        }, "ERROR")
      }
    }

    const resolveFocusNoteForAction = () => {
      const params = config.params || {}
      const seen = new Set()
      const candidates = []

      const pushCandidate = (rawId, source) => {
        const normalizedId = normalizeNoteIdValue(rawId)
        if (!normalizedId || seen.has(normalizedId)) return
        seen.add(normalizedId)
        candidates.push({ id: normalizedId, source: source || "unknown" })
      }

      const paramFocusId = normalizeNoteIdValue(
        params.focusNoteId ||
        params.focusid ||
        params.sourceNoteId ||
        params.sourceid ||
        params.focusNoteURL ||
        params.sourcenoteurl
      )
      // Fixed-source mutations must not silently act on a stale source after a new selection.
      // A focused target can come from result navigation; keep the established source in that case.
      const fixedSourceId = paramFocusId || normalizeNoteIdValue(this.searchFocusNoteId)
      const currentFocusId = normalizeNoteIdValue(focusNote && focusNote.noteId)
      if (!currentFocusFirstActionSet.has(actionLower) && fixedSourceId && currentFocusId &&
        currentFocusId !== fixedSourceId && currentFocusId !== targetNoteId) {
        const fixedSourceNote = freshNoteById(fixedSourceId)
        const displayTitle = (note) => String(note && (note.noteTitle || note.title) || "未命名卡片")
          .replace(/\s+/g, " ").trim().slice(0, 100)
        return {
          note: null,
          source: "selectionChanged",
          noteId: null,
          blocked: true,
          message: `未执行操作：搜索源卡片为「${displayTitle(fixedSourceNote)}」，当前选中「${displayTitle(focusNote)}」。请关闭并重新打开搜索面板后重试。`,
        }
      }
      pushCandidate(paramFocusId, "param")
      if (currentFocusFirstActionSet.has(actionLower) && !paramFocusId) {
        const currentFocusNoteId = normalizeNoteIdValue(focusNote && focusNote.noteId)
        if (currentFocusNoteId) {
          pushCandidate(currentFocusNoteId, "current")
        } else {
          pushCandidate(this.searchFocusNoteId, "locked")
        }
      } else {
        pushCandidate(this.searchFocusNoteId, "locked")
        pushCandidate(focusNote && focusNote.noteId, "current")
      }

      for (const candidate of candidates) {
        if (targetNoteId && candidate.id === targetNoteId) {
          continue
        }
        const note = freshNoteById(candidate.id)
        if (note) {
          this.searchFocusNoteId = candidate.id
          return {
            note,
            source: candidate.source,
            noteId: candidate.id,
          }
        }
      }

      return {
        note: null,
        source: "none",
        noteId: null,
      }
    }

    if (targetNoteId) {
      targetNote = freshNoteById(targetNoteId) || targetNote
    }

    if (focusActionSet.has(actionLower)) {
      const resolvedFocus = resolveFocusNoteForAction()
      if (resolvedFocus.blocked) {
        sidebarFailure = resolvedFocus.message
        MNUtil.showHUD(resolvedFocus.message, 4)
        return
      }
      focusNote = resolvedFocus.note
      KnowledgeBaseUtils.log("focusNote 解析结果", "executeAction", {
        action: action,
        targetNoteId: targetNoteId || "",
        focusNoteId: resolvedFocus.noteId || "",
        source: resolvedFocus.source,
        lockedFocusNoteId: normalizeNoteIdValue(this.searchFocusNoteId) || "",
      })
    } else if (focusNote && focusNote.noteId) {
      this.searchFocusNoteId = normalizeNoteIdValue(focusNote.noteId)
    }

    // 清空标题合并后，补偿链接 focusNote 旧归类父卡片到目标卡片
    const appendOldClassificationParentLink = (oldClassificationParent, destinationNote, options = {}) => {
      const showHUD = options.showHUD === true

      if (!oldClassificationParent) {
        if (showHUD) {
          MNUtil.showHUD("未找到旧归类父卡片，已跳过链接步骤")
        }
        return false
      }

      if (oldClassificationParent.noteId === destinationNote.noteId) {
        if (showHUD) {
          MNUtil.showHUD("旧归类父卡片与目标卡片相同，已跳过链接步骤")
        }
        return false
      }

      if (KnowledgeBaseTemplate.getNoteType(oldClassificationParent) !== "归类") {
        if (showHUD) {
          MNUtil.showHUD("旧归类父卡片无效，已跳过链接步骤")
        }
        return false
      }

      destinationNote.appendNoteLink(oldClassificationParent, "Both")

      const targetType = KnowledgeBaseTemplate.getNoteType(destinationNote)
      if (targetType === "定义") {
        KnowledgeBaseTemplate.removeDuplicateLinksInLastField(destinationNote)
        destinationNote.refresh()
        return true
      }

      const targetComments = destinationNote.MNComments || []
      let targetLinkIndex = -1
      for (let i = targetComments.length - 1; i >= 0; i--) {
        const comment = targetComments[i]
        if (!comment || comment.type !== "linkComment" || !comment.text) continue
        if (comment.text.includes(oldClassificationParent.noteId)) {
          targetLinkIndex = i
          break
        }
      }

      if (targetLinkIndex !== -1) {
        KnowledgeBaseTemplate.moveCommentsArrToField(destinationNote, [targetLinkIndex], "相关链接", true)
      }
      KnowledgeBaseTemplate.removeDuplicateLinksInField(destinationNote, "相关链接")
      destinationNote.refresh()
      return true
    }

    const mergeAndLinkOldClassificationParent = (toBottom = true) => {
      MNUtil.undoGrouping(() => {
        if (!focusNote) {
          MNUtil.showHUD("请先选中一张卡片")
          return
        }

        if (KnowledgeBaseTemplate.classificationParentCache &&
            typeof KnowledgeBaseTemplate.classificationParentCache.delete === "function") {
          KnowledgeBaseTemplate.classificationParentCache.delete(focusNote)
        }
        const oldClassificationParent = KnowledgeBaseTemplate.getFirstClassificationParentNote(focusNote)

        focusNote.title = ""
        KnowledgeBaseTemplate.retainFieldContentByName(focusNote, "摘录区", true)
        focusNote.mergeInto(targetNote)
        KnowledgeBaseTemplate.autoMoveNewContentToField(targetNote, "摘录", toBottom)

        appendOldClassificationParentLink(oldClassificationParent, targetNote, { showHUD: true })
        success = true
      })
    }

	    // 某些动作（如 ready/htmlLog）无需 note
		    const allowActionsWithoutNote = new Set([
		      "ready",
		      "htmlLog",
		      "htmllog",
		      "searchDebugLog",
		      "searchdebuglog",
		      "refreshAllData",
		      "refreshalldata",
		      "reopenSearchView",
		      "reopensearchview",
		      "getDescendantCardIds",
		      "getdescendantcardids",
		      "activatePendingLocalSearch",
		      "activatependinglocalsearch",
		      "aiRecommendClassification",
		      "airecommendclassification",
		      "aiSearchGetModels",
		      "aisearchgetmodels",
		      "aiSearchSetModel",
		      "aisearchsetmodel",
		      "aiSearchRerank",
		      "aisearchrerank",
		      "aiSearchCancelRerank",
		      "aisearchcancelrerank",
		      "pinCard",
		      "pincard",
		      "pinToCurrentNode",
		      "pintocurrentnode",
		      "locateCurrentMNSelectedCard",
		      "locatecurrentmnselectedcard",
		      // comment-manager Bridge helpers that don't require a focused note
		      "copyText",
		      "copytext",
		      "requestClipboardText",
		      "requestclipboardtext",
		      "closeCommentManager",
		      "closecommentmanager",
		      "closeResearchWorkbench",
		      "closeresearchworkbench",
			      "closeDefinitionMergeWorkbench",
			      "closedefinitionmergeworkbench",
			      "closeProofStructureWorkbench",
			      "closeproofstructureworkbench",
		      "refreshCurrentNote",
		      "refreshcurrentnote",
		      "refreshManagedCommentData",
		      "refreshmanagedcommentdata",
		    ])

    if (!targetNote && !allowActionsWithoutNote.has(action) && !allowActionsWithoutNote.has(actionLower)) {
      await this.removeMissingSearchCardIndex(targetNoteId, `executeAction.${action || "unknown"}.targetMissing`, {
        refreshRequestId: config.params.refreshRequestId || config.params.requestId || "",
      })
      sidebarFailure = "目标卡片不存在，操作未执行"
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    switch (action) {
      case "aiSearchGetModels":
      case "aisearchgetmodels":
        {
          const refreshModels = parseBooleanParam(config.params.refresh, false)
          const requestId = String(config.params.requestId || "").trim()
          const catalog = {
            ...await KnowledgeBaseNetwork.getMNAIModelCatalog({ refresh: refreshModels }),
            requestId,
          }
          const script = `(function() {
  try {
    var payload = ${JSON.stringify(catalog)};
    return window.Bridge && typeof window.Bridge.setAICardSearchModelOptions === 'function'
      ? window.Bridge.setAICardSearchModelOptions(payload)
      : false;
  } catch (error) {
    return false;
  }
})()`
          await this.runAICardSearchJavaScript(script)
          success = true
        }
        break

      case "aiSearchSetModel":
      case "aisearchsetmodel":
        {
          const source = String(config.params.source || "").trim()
          const model = String(config.params.model || "").trim()
          const requestId = String(config.params.requestId || "").trim()
          const available = KnowledgeBaseNetwork.isMNAIModelAvailable(source, model)
          if (available) {
            KnowledgeBaseConfig.config.aiSearchModelSource = source
            KnowledgeBaseConfig.config.aiSearchModel = model
            KnowledgeBaseConfig.config.aiSearchModelExplicitlySelected = true
            KnowledgeBaseConfig.save()
          }
          const catalog = {
            ...await KnowledgeBaseNetwork.getMNAIModelCatalog(),
            requestId,
          }
          if (!available) catalog.error = "该 AI 模型当前不可用，请刷新模型列表"
          await this.runAICardSearchJavaScript(`window.Bridge && window.Bridge.setAICardSearchModelOptions(${JSON.stringify(catalog)})`)
          success = available
        }
        break

      case "aiSearchCancelRerank":
      case "aisearchcancelrerank":
        {
          const requestId = String(config.params.requestId || "").trim()
          if (requestId && this._aiSearchRerankRequest && this._aiSearchRerankRequest.requestId === requestId) {
            this._aiSearchRerankRequest.cancelled = true
          }
          success = true
        }
        break

      case "aiSearchRerank":
      case "aisearchrerank":
        {
          const requestId = String(config.params.requestId || "").trim()
          const source = String(config.params.source || "").trim()
          const model = String(config.params.model || "").trim()
          let ownsRerankLock = false
          let rerankRequest = null
          const startedAt = Date.now()
          const shouldCancel = () => !!rerankRequest && (
            rerankRequest.cancelled || this._aiSearchRerankRequest !== rerankRequest
            || this.currentHTMLType !== 'search' || !!(this.view && this.view.hidden)
          )
          const logStage = (stage, detail = {}) => {
            try {
              KnowledgeBaseUtils.log('AI 找卡片', 'executeAction.aiSearchRerank', {
                requestId, stage, durationMs: Date.now() - startedAt, ...detail,
              })
            } catch (_) {}
          }
          const sendCompletion = async (payload) => {
            if (shouldCancel()) return false
            const script = `(function() {
  try {
    var payload = ${JSON.stringify(payload)};
    return window.Bridge && typeof window.Bridge.completeAICardSearchRerank === 'function'
      ? window.Bridge.completeAICardSearchRerank(payload)
      : false;
  } catch (error) {
    return false;
  }
})()`
            return this.runAICardSearchJavaScript(script)
          }

          try {
            if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(requestId) || !source || !model
              || source.length > 120 || model.length > 240 || this.currentHTMLType !== 'search') {
              await sendCompletion({ requestId, success: false, error: "AI 精排请求参数不完整" })
              break
            }
            if (!KnowledgeBaseNetwork.isMNAIModelAvailable(source, model)) {
              await sendCompletion({ requestId, success: false, error: "所选模型当前不可用，请刷新列表" })
              break
            }
            const activeRerankRequestId = String(KnowledgeBaseNetwork.activeAISearchRerankRequestId || "")
            if (activeRerankRequestId) {
              if (this._aiSearchRerankRequest && this._aiSearchRerankRequest.requestId === requestId) break
              await sendCompletion({
                requestId,
                success: false,
                error: "已有 AI 精排正在进行，请等待完成后重试",
              })
              break
            }
            KnowledgeBaseNetwork.activeAISearchRerankRequestId = requestId
            ownsRerankLock = true
            rerankRequest = { requestId, cancelled: false }
            this._aiSearchRerankRequest = rerankRequest
            logStage('begin')

            const pullScript = `(function() {
  try {
    if (typeof window.takeAICardSearchRerankPayload !== 'function') return '';
    var payload = window.takeAICardSearchRerankPayload(${JSON.stringify(requestId)});
    return payload ? JSON.stringify(payload) : '';
  } catch (error) {
    return '';
  }
})()`
            const rawPayload = await this.runAICardSearchJavaScript(pullScript)
            if (shouldCancel()) break
            if (typeof rawPayload === "string" && rawPayload.length > 350000) {
              await sendCompletion({ requestId, success: false, error: "本地候选数据过大，已保留本地结果" })
              break
            }
            let payload = rawPayload
            if (typeof rawPayload === "string") {
              payload = rawPayload.trim() ? JSON.parse(rawPayload) : null
            }
            if (!payload || payload.requestId !== requestId || !Array.isArray(payload.candidates)) {
              await sendCompletion({ requestId, success: false, error: "未取得本地候选，已保留本地结果" })
              break
            }
            const candidateIds = []
            const seenCandidateIds = new Set()
            const validPayload = typeof payload.query === 'string' && payload.query.trim().length > 0
              && payload.query.length <= 500 && payload.candidates.length <= 48
              && payload.candidates.every((candidate) => {
                if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
                  || typeof candidate.id !== 'string' || !candidate.id.trim()
                  || candidate.id.length > 256 || candidate.id !== candidate.id.trim()
                  || /[\u0000-\u001f]/.test(candidate.id) || seenCandidateIds.has(candidate.id)) return false
                seenCandidateIds.add(candidate.id)
                candidateIds.push(candidate.id)
                return true
              })
            if (!validPayload) {
              await sendCompletion({ requestId, success: false, error: "本地候选数据无效，已保留本地结果" })
              break
            }
            payload = { ...payload, candidates: payload.candidates.slice() }
            if (candidateIds.length < 2) {
              await sendCompletion({ requestId, success: false, error: "候选不足，无需 AI 精排" })
              break
            }

            const answerPair = `${source}\u0001${model}`
            const queryModel = KnowledgeBaseNetwork.AI_SEARCH_QUERY_MODEL_PREFERENCES.find((item) => (
              `${item.source}\u0001${item.model}` !== answerPair
              && KnowledgeBaseNetwork.isMNAIModelAvailable(item.source, item.model)
            )) || KnowledgeBaseNetwork.AI_SEARCH_QUERY_MODEL_PREFERENCES.find((item) => (
              KnowledgeBaseNetwork.isMNAIModelAvailable(item.source, item.model)
            )) || { source, model }

            const queryPrompt = KnowledgeBaseNetwork.buildKnowledgeCardSearchRerankPrompt(payload)
            logStage('query', { candidateCount: candidateIds.length })
            const queryResponse = await KnowledgeBaseNetwork.callMNAIWithNotification(queryPrompt, {
              shouldCancel,
              source: queryModel.source,
              model: queryModel.model,
              timeoutSeconds: 20,
              awaitNotificationClose: true,
              suppressMNUtilsNotification: true,
              suppressFinishBroadcast: true,
              sourceAddon: "mnknowledgebase",
              requestId: `${requestId}:query`,
            })
            if (shouldCancel()) break
            if (!queryResponse) {
              await sendCompletion({ requestId, success: false, error: "AI 请求未完成，已保留本地结果" })
              break
            }
            const queryParsed = KnowledgeBaseNetwork.parseKnowledgeCardSearchRerankResponse(queryResponse, candidateIds)
            let answerCandidates = payload.candidates.slice()
            if (queryParsed.ranked.length) {
              const queryOrder = new Map(queryParsed.ranked.map((item, index) => [item.id, index]))
              answerCandidates.sort((a, b) => {
                const aOrder = queryOrder.get(String(a && a.id || ""))
                const bOrder = queryOrder.get(String(b && b.id || ""))
                if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
                if (aOrder !== undefined) return -1
                if (bOrder !== undefined) return 1
                return Number(a && a.localRank || 0) - Number(b && b.localRank || 0)
              })
              answerCandidates = answerCandidates.map((candidate, index) => ({
                ...candidate,
                localRank: index + 1,
              }))
            }

            const answerPayload = { ...payload, candidates: answerCandidates }
            const answerPrompt = KnowledgeBaseNetwork.buildKnowledgeAnswerCardRerankPrompt(answerPayload)
            logStage('answer', { candidateCount: candidateIds.length })
            const response = await KnowledgeBaseNetwork.callMNAIWithNotification(answerPrompt, {
              shouldCancel,
              source,
              model,
              timeoutSeconds: 45,
              awaitNotificationClose: true,
              suppressMNUtilsNotification: true,
              suppressFinishBroadcast: true,
              sourceAddon: "mnknowledgebase",
              requestId: `${requestId}:answer`,
            })
            if (shouldCancel()) break
            const parsed = KnowledgeBaseNetwork.parseKnowledgeAnswerCardRerankResponse(response, candidateIds)
            const modelLabel = `${source}: ${model}`
            if (!parsed.ranked.length) {
              await sendCompletion({
                requestId,
                success: false,
                modelLabel,
                error: parsed.error ? "AI 返回格式无效，已保留本地结果" : "AI 未返回有效排序，已保留本地结果",
              })
              break
            }
            const completionApplied = await sendCompletion({
              requestId,
              success: true,
              modelLabel,
              ranked: parsed.ranked,
            })
            success = completionApplied === true || Number(completionApplied) === 1
          } catch (error) {
            logStage('error', { errorType: String(error && error.name || 'Error') })
            await sendCompletion({
              requestId,
              success: false,
              modelLabel: source && model ? `${source}: ${model}` : "",
              error: "AI 精排失败，已保留本地结果",
            })
          } finally {
            if (ownsRerankLock) logStage(shouldCancel() ? 'cancelled' : 'done', { success })
            if (this._aiSearchRerankRequest === rerankRequest) this._aiSearchRerankRequest = null
            if (ownsRerankLock && KnowledgeBaseNetwork.activeAISearchRerankRequestId === requestId) {
              KnowledgeBaseNetwork.activeAISearchRerankRequestId = ""
            }
          }
        }
        break

      case "locateCurrentMNSelectedCard":
      case "locatecurrentmnselectedcard":
        {
          let selectedViews = []
          try {
            const mindmapView = MNUtil.mindmapView
            const rawSelectedViews = mindmapView && mindmapView.selViewLst
            selectedViews = rawSelectedViews && typeof rawSelectedViews.length === "number"
              ? rawSelectedViews
              : []
          } catch (_) {
            selectedViews = []
          }

          if (selectedViews.length > 1) {
            const result = {
              status: "multiple-selection",
              message: "请只选中一张卡片后再定位",
            }
            const script = `window.Bridge.notifyLocateCurrentMNSelectedCard(${JSON.stringify(result)})`
            await this.runJavaScript(script)
            MNUtil.showHUD("请只选中一张卡片后再定位")
            break
          }

          let selectedNote = null
          if (selectedViews.length === 1) {
            try {
              const selectedView = selectedViews[0]
              selectedNote = selectedView && selectedView.note
                ? MNNote.new(selectedView.note.note)
                : null
            } catch (_) {
              selectedNote = null
            }
          }
          if (!selectedNote) {
            selectedNote = MNNote.getFocusNote()
          }
          const selectedNoteId = normalizeNoteIdValue(selectedNote && selectedNote.noteId)
          if (!selectedNoteId) {
            const result = {
              status: "no-selection",
              message: "请先在 MarginNote 中选中一张卡片",
            }
            const script = `window.Bridge.notifyLocateCurrentMNSelectedCard(${JSON.stringify(result)})`
            await this.runJavaScript(script)
            MNUtil.showHUD("请先在 MarginNote 中选中一张卡片")
            break
          }

          const locatePayload = {
            noteId: selectedNoteId,
            preserveOnMissing: true,
            missingMessage: "当前选卡不在搜索索引中，请先更新索引",
          }
          const locateScript = `(function() {
  try {
    var payload = ${JSON.stringify(locatePayload)};
    if (!window.Bridge || typeof window.Bridge.locateCardById !== 'function') {
      var unavailable = { status: 'error', message: '搜索页面尚未就绪' };
      return window.Bridge && typeof window.Bridge.notifyLocateCurrentMNSelectedCard === 'function'
        ? window.Bridge.notifyLocateCurrentMNSelectedCard(unavailable)
        : unavailable;
    }
    var hasRealData = !!(window.state && window.state.hasRealData);
    var located = window.Bridge.locateCardById(payload.noteId, {
      preserveOnMissing: payload.preserveOnMissing,
      missingMessage: payload.missingMessage,
    });
    var result = {
      status: hasRealData ? (located ? 'located' : 'not-found') : 'pending',
      noteId: payload.noteId,
    };
    if (typeof window.Bridge.notifyLocateCurrentMNSelectedCard === 'function') {
      window.Bridge.notifyLocateCurrentMNSelectedCard(result);
    }
    return result;
  } catch (error) {
    var failed = { status: 'error', message: String(error && error.message || error) };
    if (window.Bridge && typeof window.Bridge.notifyLocateCurrentMNSelectedCard === 'function') {
      window.Bridge.notifyLocateCurrentMNSelectedCard(failed);
    }
    return failed;
  }
})()`
          const locateResult = await this.runJavaScript(locateScript)
          KnowledgeBaseUtils.log("定位当前选卡已回写搜索页", "executeAction", {
            noteId: selectedNoteId,
            result: locateResult,
          })
          success = true
        }
        break

      case 'getDescendantCardIds':
      case 'getdescendantcardids':
        {
          const rootId = normalizeNoteIdValue(config.params && config.params.id);
          const requestId = String((config.params && config.params.requestId) || '').trim();
          if (!rootId) {
            const errorResult = { rootId: '', descendantIds: [], requestId, error: '未提供根卡片 ID' };
            await this.runJavaScript(`window.Bridge.setDescendantCardIds(${JSON.stringify(errorResult)})`);
            MNUtil.showHUD('局部搜索：未提供根卡片 ID');
            break;
          }
          try {
            const rootNote = MNNote.new(rootId, false);
            if (!rootNote) {
              const errorResult = { rootId, descendantIds: [], requestId, error: '根卡片不存在' };
              await this.runJavaScript(`window.Bridge.setDescendantCardIds(${JSON.stringify(errorResult)})`);
              MNUtil.showHUD('局部搜索：根卡片不存在');
              break;
            }
            const descendantIds = new Set();
            const collectDescendants = (note) => {
              try {
                const children = Array.isArray(note.childNotes) ? note.childNotes : [];
                children.forEach((child) => {
                  if (!child) return;
                  const childId = normalizeNoteIdValue(child.noteId);
                  if (childId && !descendantIds.has(childId)) {
                    descendantIds.add(childId);
                    collectDescendants(child);
                  }
                });
              } catch (e) {
                KnowledgeBaseUtils.log('遍历子卡片出错', 'getDescendantCardIds', { error: String(e && e.message || e) });
              }
            };
            collectDescendants(rootNote);
            const result = {
              rootId,
              descendantIds: Array.from(descendantIds),
              requestId,
            };
            await this.runJavaScript(`window.Bridge.setDescendantCardIds(${JSON.stringify(result)})`);
            KnowledgeBaseUtils.log('子孙卡片收集完成', 'getDescendantCardIds', { rootId, count: descendantIds.size });
            success = true;
          } catch (error) {
            const errorResult = { rootId, descendantIds: [], requestId, error: String(error && error.message || error) };
            await this.runJavaScript(`window.Bridge.setDescendantCardIds(${JSON.stringify(errorResult)})`);
            KnowledgeBaseUtils.addErrorLog(error, 'getDescendantCardIds');
          }
        }
        break

      case 'mergeDuplicateKnowledgeNoteToTargetNote':
      case 'mergeduplicateknowledgenotetotargetnote':
        MNUtil.undoGrouping(() => {
          if (!targetNote) {
            MNUtil.showHUD("未找到目标卡片")
            return
          }
          const shouldExcerptFromSelection = parseBooleanParam(config.params.excerptFromSelection, false)
          let sourceNote = focusNote

          if (shouldExcerptFromSelection) {
            const excerptResult = this.createExcerptNoteFromSearchSelection({ consumeOnSuccess: true })
            if (!excerptResult || !excerptResult.ok || !excerptResult.note) {
              if (excerptResult && excerptResult.reason === 'selection_required') {
                MNUtil.showHUD("请先在文档里保留活动选区，再执行合并")
              } else {
                MNUtil.showHUD("摘录失败：没能从当前文档选区创建卡片")
              }
              return
            }
            sourceNote = excerptResult.note
            focusNote = sourceNote
            this.searchFocusNoteId = normalizeNoteIdValue(sourceNote.noteId) || this.searchFocusNoteId
            KnowledgeBaseUtils.log("合并前先摘录成功", "executeAction", {
              action,
              source: excerptResult.source || 'unknown',
              excerptNoteId: excerptResult.noteId || '',
              targetNoteId: targetNoteId || '',
              selectionText: excerptResult.selectionText ? excerptResult.selectionText.slice(0, 80) : '',
            })
          }

          if (!sourceNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          if (sourceNote.noteId === targetNote.noteId) {
            MNUtil.showHUD("源卡片和目标卡片不能是同一张")
            return
          }
          const mergePosition = String(config.params.position || "below").toLowerCase()
          let oldClassificationParent = null
          if (parseBooleanParam(config.params.linkOldClassification, false)) {
            if (KnowledgeBaseTemplate.classificationParentCache &&
                typeof KnowledgeBaseTemplate.classificationParentCache.delete === "function") {
              KnowledgeBaseTemplate.classificationParentCache.delete(sourceNote)
            }
            oldClassificationParent = KnowledgeBaseTemplate.getFirstClassificationParentNote(sourceNote)
          }
          const mergeOptions = {
            removeTitle: parseBooleanParam(config.params.removeTitle, false),
            keepOnlyExcerpt: parseBooleanParam(config.params.keepOnlyExcerpt, true),
            toBottom: mergePosition !== "above",
            focusAfterMerge: parseBooleanParam(config.params.locateAfterMerge, false),
          }
          // 归类卡片的“所属”是父级结构关系，不属于可合并的正文内容。
          // 其他字段仍按原有规则合并；仅在来源卡片确认为归类卡片时跳过该字段。
          if (KnowledgeBaseTemplate.getNoteType(sourceNote) === "归类") {
            mergeOptions.skipFields = ["所属"]
          }
          const mergeResult = KnowledgeBaseTemplate.renewKnowledgeNotes(targetNote, sourceNote, mergeOptions)
          if (!mergeResult || mergeResult.success !== true) {
            sidebarFailure = mergeResult && mergeResult.error ? String(mergeResult.error) : "合并未返回完成结果"
            return
          }
          if (oldClassificationParent) {
            appendOldClassificationParentLink(oldClassificationParent, targetNote, { showHUD: false })
          }
          success = true
        })
        break

      case "focusCardInMindMap":
      case "focuscardinmindmap":
        // 定位卡片到脑图
        success = await this.focusCardInMindMap(targetNoteId)
        break

      case "focusCardInFloatMindMap":
      case "focuscardinfloatmindmap":
        // 聚焦到文档位置
        success = await this.focusCardInFloatMindMap(targetNoteId)
        break

      case "focusFirstExcerptInDocument":
      case "focusfirstexcerptindocument":
        // 定位到第一条摘录（若存在）对应的文档位置
        success = await this.focusFirstExcerptInDocument(targetNoteId)
        break

      case "refreshSearchCardIndex":
      case "refreshsearchcardindex":
        if (!global.MNKnowledgeBaseInstance || typeof global.MNKnowledgeBaseInstance.refreshSearchCardIndex !== "function") {
          MNUtil.showHUD("更新索引失败：实例未就绪")
          break
        }
        {
          const refreshResult = await global.MNKnowledgeBaseInstance.refreshSearchCardIndex(targetNoteId, {
            refreshRequestId: config.params.refreshRequestId || config.params.requestId || "",
            indexSource: config.params.indexSource || "",
          })
          success = !!(refreshResult && refreshResult.success)
        }
        break

      case "copyMarkdownLink":  // 调用 copyMarkdownLinkWithQuickPhrases 复制卡片行内链接
      case "copymarkdownlink":
        success = await this.copyMarkdownLink(targetNoteId)
        break;

	      case "copyNoteURL":  // 复制卡片 URL
	      case "copynoteurl":
	        await this.copyNoteURL(targetNoteId)
	        success = true
	        break;

				      case "pinCard":
				      case "pincard":
				        if (!targetNoteId) {
				          MNUtil.showHUD("缺少卡片 ID")
				          break
				        }
	
			        MNUtil.postNotification("AddonBroadcast", {
			          message: `mnpinner?action=pin&id=${encodeURIComponent(targetNoteId)}&section=focus&position=top`,
			        })
				        success = true
				        break;

				      case "pinToCurrentNode":
				      case "pintocurrentnode":
				        if (!targetNoteId) {
				          MNUtil.showHUD("缺少卡片 ID")
				          break
				        }
	
			        MNUtil.postNotification("AddonBroadcast", {
			          message: `mnpinner?action=pinToCurrentNode&id=${encodeURIComponent(targetNoteId)}&position=top&targetScope=workspaceCurrent`,
			        })
				        success = true
				        break;

				      case "pinTextCommentToPinner":
				      case "pintextcommenttopinner":
					        try {
					          if (!targetNote || !targetNoteId) {
					            await this.removeMissingSearchCardIndex(targetNoteId, "pinTextCommentToPinner.noteMissing")
					            MNUtil.showHUD("未找到卡片，已从索引移除")
					            break
					          }

				          const rawIndex = config.params.commentIndex || config.params.commentindex || config.params.index || config.params.i
				          const commentIndex = rawIndex !== undefined && rawIndex !== null ? parseInt(rawIndex, 10) : NaN
				          if (isNaN(commentIndex) || commentIndex < 0) {
				            MNUtil.showHUD("缺少 commentIndex 参数")
				            break
				          }

				          const comments = targetNote.comments || []
				          const comment = comments[commentIndex]
				          if (!comment) {
				            MNUtil.showHUD("评论不存在")
				            break
				          }
				          if (comment.type !== "TextNote") {
				            MNUtil.showHUD("仅支持文本类型评论")
				            break
				          }

				          let text = String(comment.text || "")
				          if (!text.trim()) {
				            MNUtil.showHUD("评论文本为空")
				            break
				          }

				          // 防止 URL 过长导致通信失败
				          const maxTextLength = 10000
				          if (text.length > maxTextLength) {
				            text = text.substring(0, maxTextLength)
				          }

				          const section = String(config.params.section || "focus")
				          const position = String(config.params.position || "top")
				          const afterPin = String(config.params.afterPin || config.params.afterpin || "openEditor")

				          let title = ""
				          try {
				            title = String((targetNote.noteTitle || targetNote.title || "文本评论") + ` #${commentIndex}`)
				          } catch (_) {
				            title = `文本评论 #${commentIndex}`
				          }

				          MNUtil.postNotification("AddonBroadcast", {
				            message: `mnpinner?action=pinClipboard&text=${encodeURIComponent(text)}&title=${encodeURIComponent(title)}&section=${encodeURIComponent(section)}&position=${encodeURIComponent(position)}&afterPin=${encodeURIComponent(afterPin)}`,
				          })
				          success = true
				        } catch (error) {
				          MNUtil.showHUD("Pin 失败：" + error)
				          KnowledgeBaseUtils.addErrorLog(error, "pinTextCommentToPinner")
				        }
				        break;

			      case "aiRecommendClassification":
			      case "airecommendclassification":
			        if (global.MNKnowledgeBaseInstance && typeof global.MNKnowledgeBaseInstance.aiRecommendClassificationInSearchWebView === "function") {
			          await global.MNKnowledgeBaseInstance.aiRecommendClassificationInSearchWebView()
			          success = true
		        } else {
		          MNUtil.showHUD("AI 推荐功能未就绪")
		        }
		        break;

      case 'mergeFocusNoteToTargetNoteExcerptPart':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          KnowledgeBaseTemplate.mergeTitleLinkWords(targetNote, focusNote, { allowAllSourceTypes: true }); // 合并标题(去重)
          focusNote.title = ""
          focusNote.mergeInto(targetNote);
          KnowledgeBaseTemplate.autoMoveNewContentToField(targetNote, "摘录");
          success = true
        })
        break;

      case 'mergeFocusNoteToTargetNoteExcerptPartAbove':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          KnowledgeBaseTemplate.mergeTitleLinkWords(targetNote, focusNote, { allowAllSourceTypes: true }); // 合并标题(去重)
          focusNote.title = ""
          focusNote.mergeInto(targetNote);
          KnowledgeBaseTemplate.autoMoveNewContentToField(targetNote, "摘录", false);
          success = true
        })
        break;

      case 'clearTitleAndMergeFocusNoteToTargetNoteExcerptPart':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          focusNote.title = ""
          KnowledgeBaseTemplate.retainFieldContentByName(focusNote, "摘录区", true);
          focusNote.mergeInto(targetNote);
          KnowledgeBaseTemplate.autoMoveNewContentToField(targetNote, "摘录");
          success = true
        })
        break;

      case 'clearTitleAndMergeFocusNoteToTargetNoteExcerptPartAbove':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          focusNote.title = ""
          KnowledgeBaseTemplate.retainFieldContentByName(focusNote, "摘录区", true);
          focusNote.mergeInto(targetNote);
          KnowledgeBaseTemplate.autoMoveNewContentToField(targetNote, "摘录", false);
          success = true
        })
        break;

      case 'clearTitleMergeAndLinkOldClassificationToTargetNote':
      case 'cleartitlemergeandlinkoldclassificationtotargetnote':
        mergeAndLinkOldClassificationParent(true)
        break;

      case 'clearTitleMergeAndLinkOldClassificationToTargetNoteAbove':
      case 'cleartitlemergeandlinkoldclassificationtotargetnoteabove':
        mergeAndLinkOldClassificationParent(false)
        break;

      case 'keepOnlyExcerptAndMergeToTargetNote':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          // 1. 只保留摘录（删除所有文本和手写评论）
          KnowledgeBaseTemplate.keepOnlyExcerpt(focusNote);

          // 2. 合并到目标卡片
          focusNote.mergeInto(targetNote);

          // 3. 将新内容移动到摘录字段
          KnowledgeBaseTemplate.autoMoveNewContentToField(targetNote, "摘录");

          success = true
        })
        break;

      case 'keepOnlyExcerptAndMergeToTargetNoteAbove':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          // 1. 只保留摘录（删除所有文本和手写评论）
          KnowledgeBaseTemplate.keepOnlyExcerpt(focusNote);

          // 2. 合并到目标卡片
          focusNote.mergeInto(targetNote);

          // 3. 将新内容移动到摘录字段
          KnowledgeBaseTemplate.autoMoveNewContentToField(targetNote, "摘录", false);

          success = true
        })
        break;

      case 'bidirectionalLinkFromeFocusNoteToTargetNote':
        {
          const linkStartedAt = Date.now()
          const focusNoteId = focusNote && focusNote.noteId ? String(focusNote.noteId) : ''
          const targetId = targetNote && targetNote.noteId ? String(targetNote.noteId) : ''
          KnowledgeBaseUtils.log('双向链接动作开始', 'searchPerf.bidirectionalLink', {
            focusNoteId,
            targetNoteId: targetId,
          })
          runUndoGroupingWithoutGlobalDBRefresh(()=>{
            if (!focusNote) {
              MNUtil.showHUD("请先选中一张卡片")
              return
            }
            focusNote.appendNoteLink(targetNote, "Both")
            KnowledgeBaseTemplate.removeDuplicateLinksInLastField(targetNote)  // 链接去重
            success = true
          })
          if (success) {
            const mutationDurationMs = Date.now() - linkStartedAt
            KnowledgeBaseUtils.log('双向链接写入完成', 'searchPerf.bidirectionalLink', {
              focusNoteId,
              targetNoteId: targetId,
              mutationDurationMs,
            })
            const refreshResult = await refreshSearchMutationNotes([focusNote, targetNote])
            const autoCloseMode = KnowledgeBaseConfig.config.autoCloseMode === true
            const refocusDelay = autoCloseMode ? 0.4 : 0.1
            focusInMindMapSafely(focusNote, refocusDelay)
            KnowledgeBaseUtils.log('双向链接动作完成', 'searchPerf.bidirectionalLink', {
              focusNoteId,
              targetNoteId: targetId,
              mutationDurationMs,
              refreshDurationMs: refreshResult.durationMs,
              totalDurationMs: Date.now() - linkStartedAt,
              autoCloseMode,
              refocusDelay,
            })
          }
        }
        break;

      case 'moveFocusNoteToTargetNoteAsChild':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return 
          }
          targetNote.addChild(focusNote);
          KnowledgeBaseTemplate.linkParentNote(focusNote);
          success = true
        })
        break;

      case 'moveFocusNoteToTargetNoteAsChildAndLocate':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          targetNote.addChild(focusNote);
          KnowledgeBaseTemplate.linkParentNote(focusNote);
          focusInMindMapSafely(focusNote, 0.5)
          success = true
        })
        break;

      case 'moveFocusNoteToTargetNoteAsChildAndMakeNote':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          KnowledgeBaseTemplate.assertMakeCardTemplateAvailable(focusNote, { targetParent: targetNote })
          targetNote.addChild(focusNote);

          let processedNote = KnowledgeBaseTemplate.toNoExcerptVersion(focusNote)
          processedNote = KnowledgeBaseTemplate.makeNote(processedNote, false, false, false, { throwOnFailure: true })

          if (!processedNote) throw new Error("制卡未返回完成卡片")
          success = true
        })
        break;

      case 'moveFocusNoteToTargetNoteAsChildAndMakeNoteAndLocate':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          KnowledgeBaseTemplate.assertMakeCardTemplateAvailable(focusNote, { targetParent: targetNote })
          targetNote.addChild(focusNote);

          let processedNote = KnowledgeBaseTemplate.toNoExcerptVersion(focusNote)
          processedNote = KnowledgeBaseTemplate.makeNote(processedNote, false, false, false, { throwOnFailure: true })

          if (!processedNote) throw new Error("制卡未返回完成卡片")
          focusInMindMapSafely(processedNote, 0.5)
          success = true
        })
        break;

      case 'moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReview':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          KnowledgeBaseTemplate.assertMakeCardTemplateAvailable(focusNote, { targetParent: targetNote })
          targetNote.addChild(focusNote);

          let processedNote = KnowledgeBaseTemplate.toNoExcerptVersion(focusNote)
          // addToReview = true, reviewEverytime = true, focus = false
          processedNote = KnowledgeBaseTemplate.makeNote(processedNote, true, true, false, { throwOnFailure: true })

          if (!processedNote) throw new Error("制卡未返回完成卡片")
          success = true
        })
        break;

      case 'moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReviewAndLocate':
        MNUtil.undoGrouping(()=>{
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return
          }
          KnowledgeBaseTemplate.assertMakeCardTemplateAvailable(focusNote, { targetParent: targetNote })
          targetNote.addChild(focusNote);

          let processedNote = KnowledgeBaseTemplate.toNoExcerptVersion(focusNote)
          // 由本入口统一定位最终返回卡，避免转换后仍聚焦 merge 前源卡。
          processedNote = KnowledgeBaseTemplate.makeNote(processedNote, true, true, false, { throwOnFailure: true })

          if (!processedNote) throw new Error("制卡未返回完成卡片")
          focusInMindMapSafely(processedNote, 0.5)
          success = true
        })
        break;

      case 'addTemplate':
      case 'addtemplate':
        try {
          if (!targetNote) {
            MNUtil.showHUD("缺少卡片 ID")
            return
          }
          const classificationNote = await KnowledgeBaseTemplate.addTemplate(targetNote, true);
          if (classificationNote) {
            success = true
          }
        } catch (error) {
          MNLog.error("增加模板失败: " + (error.message || error));
        }
        break;

      case 'addTemplateToTargetNoteAndMoveFocusNoteAsChild':
        try {
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return 
          }
          let classificationNote = await KnowledgeBaseTemplate.addTemplate(targetNote, false);
          // await MNUtil.delay(2)
          if (classificationNote) {
            classificationNote.addChild(focusNote);
            KnowledgeBaseTemplate.linkParentNote(focusNote);
            success = true
          } else {
            KnowledgeBaseUtils.emitRuntimeLog('INFO', "未找到新卡片");
          }
        } catch (error) {
          MNLog.error("新建模板失败: " + error.message);
        }
        break;

	      case 'addTemplateToTargetNoteAndMoveFocusNoteAsChildAndLocate':
	        try {
          if (!focusNote) {
            MNUtil.showHUD("请先选中一张卡片")
            return 
          }
          let classificationNote = await KnowledgeBaseTemplate.addTemplate(targetNote, false);
          if (classificationNote) {
            classificationNote.addChild(focusNote);
            KnowledgeBaseTemplate.linkParentNote(focusNote);
            success = true
            focusInMindMapSafely(focusNote, 0.5)
          } else {
            KnowledgeBaseUtils.emitRuntimeLog('INFO', "未找到新卡片");
          }
        } catch (error) {
          MNLog.error("新建模板失败: " + error.message);
	        }
	        break;
	      case 'applyClassificationTitlePlan':
	      case 'applyclassificationtitleplan':
	        try {
	          if (!targetNote || !targetNoteId) {
	            MNUtil.showHUD("缺少归类根卡片")
	            break
	          }
	          if (KnowledgeBaseTemplate.getNoteType(targetNote) !== "归类") {
	            MNUtil.showHUD("根节点必须是归类卡片")
	            break
	          }

	          const rawChanges = parseMaybeJSONParam(config.params.changes)
	          const requestedChanges = Array.isArray(rawChanges) ? rawChanges : []

	          // 只允许修改快照根节点及其真实子孙中的归类卡片。
	          const descendantNotes = KnowledgeBaseTemplate.getAllDescendantNotes(targetNote) || []
	          const allowedNoteIds = new Set([targetNoteId])
	          descendantNotes.forEach((item) => {
	            const id = normalizeNoteIdValue(item && (item.noteId || item.id))
	            if (id) allowedNoteIds.add(id)
	          })

	          const titleChanges = []
	          requestedChanges.forEach((item) => {
	            const id = normalizeNoteIdValue(item && (item.id || item.noteId))
	            const newTitle = String(item && item.newTitle || '').trim()

	            if (!id || !newTitle || !allowedNoteIds.has(id)) return

	            const note = MNNote.new(id)
	            if (!note || KnowledgeBaseTemplate.getNoteType(note) !== "归类") return

	            titleChanges.push({
	              id,
	              note,
	              oldTitle: String(note.title || ''),
	              newTitle: KnowledgeBaseTemplate.normalizeTitleSpaces
	                ? KnowledgeBaseTemplate.normalizeTitleSpaces(newTitle)
	                : newTitle,
	            })
	          })

          if (titleChanges.length === 0) {
            MNUtil.showHUD("没有可保存的归类卡片标题")
            break
          }

          MNUtil.undoGrouping(() => {
            titleChanges.forEach(({ note, newTitle }) => {
              note.title = newTitle
              if (typeof KnowledgeBaseIndexer !== "undefined" && KnowledgeBaseIndexer && typeof KnowledgeBaseIndexer.addToIncrementalIndex === "function") {
                KnowledgeBaseIndexer.addToIncrementalIndex(note, undefined, { showErrorHUD: false })
              }
            })
          })

          const runPrefixRelink = parseBooleanParam(config.params.runPrefixRelink || config.params.runprefixrelink, false)
          let prefixUpdated = 0

          if (runPrefixRelink) {
            prefixUpdated = descendantNotes.length
            KnowledgeBaseTemplate.batchUpdateChildrenPrefixes(targetNote, true)
          }

          const resultPayload = {
            success: true,
            requestId: String(config.params.requestId || ''),
            titleUpdated: titleChanges.length,
            prefixUpdated,
            prefixRelinkRequested: runPrefixRelink,
            message: runPrefixRelink
              ? `已保存 ${titleChanges.length} 张归类卡片，并已更新子孙卡片前缀和链接`
              : `已保存 ${titleChanges.length} 张归类卡片标题`,
          }
          await this.runJavaScript(`(function(){
            var payload = ${JSON.stringify(resultPayload)};
            if (window.Bridge && typeof window.Bridge.notifyClassificationTitlePlanResult === 'function') {
              return window.Bridge.notifyClassificationTitlePlanResult(payload);
            }
            if (typeof window.notifyClassificationTitlePlanResult === 'function') {
              return window.notifyClassificationTitlePlanResult(payload);
            }
            return false;
          })()`)
          MNUtil.showHUD(resultPayload.message)
          success = true
        } catch (error) {
          const errorPayload = {
            success: false,
            requestId: String(config.params.requestId || ''),
            message: `批量修改归类卡片失败：${error.message || error}`,
          }
          await this.runJavaScript(`(function(){
            var payload = ${JSON.stringify(errorPayload)};
            if (window.Bridge && typeof window.Bridge.notifyClassificationTitlePlanResult === 'function') {
              return window.Bridge.notifyClassificationTitlePlanResult(payload);
            }
            if (typeof window.notifyClassificationTitlePlanResult === 'function') {
              return window.notifyClassificationTitlePlanResult(payload);
            }
            return false;
          })()`)
          KnowledgeBaseUtils.addErrorLog(error, "executeAction:applyClassificationTitlePlan")
          MNUtil.showHUD(errorPayload.message)
        }
        break

	      case 'createTemplateChainForTargetNote':
	      case 'createtemplatechainfortargetnote':
	        try {
	          if (!targetNote) {
	            MNUtil.showHUD("缺少卡片 ID")
	            return
	          }
	          const titleInput = config.params.titleInput || config.params.titleinput || ""
	          const mode = config.params.mode || "down-sequential"
	          const baseTitle = config.params.baseTitle || config.params.basetitle || ""
	          const closeAfterCreate = parseBooleanParam(config.params.closeAfterCreate || config.params.closeaftercreate, false)
	          const result = KnowledgeBaseTemplate.createTemplateChain(targetNote, {
	            titleInput,
	            mode,
	            baseTitle,
	            focusLastNote: true,
	          })
	          if (result && result.lastNote) {
	            success = true
	            MNUtil.showHUD(`已创建 ${result.createdNotes.length} 张模板卡`)
	            if (closeAfterCreate) {
	              this.hide()
	            } else {
	              const lastNoteId = result.lastNote.noteId || targetNote.noteId
	              if (global.MNKnowledgeBaseInstance) {
	                global.MNKnowledgeBaseInstance.currentManagedNote = result.lastNote
	              }
	              await this.loadTemplateWorkbenchData(lastNoteId)
	            }
	          } else {
	            MNUtil.showHUD("没有创建模板卡")
	          }
	        } catch (error) {
	          KnowledgeBaseUtils.addErrorLog(error, "executeAction:createTemplateChainForTargetNote")
	          MNUtil.showHUD("创建模板卡失败：" + (error.message || error))
	        }
	        break;
		      case "refreshAllData":
	      case "refreshalldata":
	        // 刷新所有数据
	        {
	          const refreshRequestId = config.params && config.params.requestId
	            ? String(config.params.requestId)
	            : ""
	          MNUtil.showHUD("正在刷新数据...")
	          const refreshResult = await this.refreshAllData({
	            showSuccessHUD: false,
	            showErrorHUD: false,
	            refreshRequestId,
	          })
	          await this.notifySearchRefreshResult(refreshResult, { requestId: refreshRequestId })

	          if (!refreshResult || refreshResult.success === false) {
	            const message = refreshResult && (refreshResult.error || refreshResult.reason)
	              ? String(refreshResult.error || refreshResult.reason)
	              : "未知错误"
	            MNUtil.showHUD("刷新数据失败：" + message)
	            break
	          }

	          MNUtil.showHUD("数据刷新完成")
	        }
	        break;
      case "reopenSearchView":
      case "reopensearchview":
        // 重新打开搜索界面（完整重载）
        // 将 currentHTMLType 设为 null，强制触发完整的 WebView 重载
        this.currentHTMLType = null;
        this.hide();
        await MNUtil.delay(0.3);
        await global.MNKnowledgeBaseInstance.openSearchWebView();
        success = true;
        break;

      case "activatePendingLocalSearch":
      case "activatependinglocalsearch":
        {
          const params = config.params || {};
          const paramRootId = normalizeNoteIdValue(params.rootId || params.id);
          const pendingLS = paramRootId
            ? { rootId: paramRootId, rootTitle: String(params.rootTitle || params.title || '') }
            : global.__MNKB_pendingLocalSearch;
          if (pendingLS && pendingLS.rootId) {
            global.__MNKB_pendingLocalSearch = null;
            await this.runJavaScript(`if (typeof activateLocalSearch === 'function') { window.__MNKB_pendingLocalSearch = null; activateLocalSearch(${JSON.stringify(pendingLS.rootId)}, ${JSON.stringify(pendingLS.rootTitle || '')}); } else { window.__MNKB_pendingLocalSearch = ${JSON.stringify(pendingLS)}; }`);
            KnowledgeBaseUtils.log('已注入局部搜索根', 'activatePendingLocalSearch', pendingLS);
          }
          success = true;
        }
        break
      case "ready":
        // HTML 初始化完成信号
        if (this.currentHTMLType === 'comment-manager' ||
          this.currentHTMLType === 'htmlmd-studio' ||
          this.currentHTMLType === 'template-workbench' ||
          this.currentHTMLType === 'question-research-workbench' ||
          this.currentHTMLType === 'definition-merge-workbench' ||
          this.currentHTMLType === 'proof-structure-workbench' ||
          this.currentHTMLType === 'title-refactor-workbench') {
          const managedNote = (global.MNKnowledgeBaseInstance && global.MNKnowledgeBaseInstance.currentManagedNote)
          const managedNoteId = managedNote && managedNote.noteId ? managedNote.noteId : null

          KnowledgeBaseUtils.log("评论型 WebView 已就绪", "executeAction", {
            managedNoteId: managedNoteId || ""
          })

          // 评论管理器首次打开时，页面脚本初始化可能慢于 Native 首次注入。
          // 在 ready 信号到达后补发一次，确保首次打开也能看到评论数据。
          if (this.currentHTMLType === 'definition-merge-workbench') {
            const context = global.MNKnowledgeBaseInstance && global.MNKnowledgeBaseInstance.currentDefinitionMergeContext
            if (context && context.sourceNoteId && context.targetNoteId) {
              await this.loadDefinitionMergeWorkbenchData(context.sourceNoteId, context.targetNoteId)
              KnowledgeBaseUtils.log("ready 后补发定义卡合并工作台数据完成", "executeAction", context)
            }
          } else if (this.currentHTMLType === 'proof-structure-workbench') {
            const context = global.MNKnowledgeBaseInstance && global.MNKnowledgeBaseInstance.currentProofStructureContext
            if (context && context.noteId && context.fieldName) {
              await this.loadProofStructureWorkbenchData(context.noteId, context.fieldName)
              KnowledgeBaseUtils.log("ready 后补发证明结构工作台数据完成", "executeAction", context)
            }
          } else if (managedNoteId && this.currentHTMLType === 'question-research-workbench') {
            await this.loadResearchWorkbenchData(managedNoteId, { reason: 'ready' })
            KnowledgeBaseUtils.log("ready 后补发问题研究工作台数据完成", "executeAction", {
              noteId: managedNoteId
            })
          } else if (managedNoteId && this.currentHTMLType === 'template-workbench') {
            await this.loadTemplateWorkbenchData(managedNoteId)
            KnowledgeBaseUtils.log("ready 后补发模板工作台数据完成", "executeAction", {
              noteId: managedNoteId
            })
          } else if (managedNoteId && this.currentHTMLType === 'title-refactor-workbench') {
            await this.loadTitleRefactorWorkbenchData(managedNoteId)
            KnowledgeBaseUtils.log("ready 后补发标题重构工作台数据完成", "executeAction", {
              noteId: managedNoteId
            })
          } else if (managedNoteId) {
            await this.loadCommentData(managedNoteId, {
              reason: "ready",
            })
            KnowledgeBaseUtils.log("ready 后补发评论数据完成", "executeAction", {
              noteId: managedNoteId
            })
          }

          if (this.currentHTMLType === 'comment-manager') {
            this.setCommentManagerAutoRefreshEnabled(!this.view.hidden)
          }
        } else {
          MNUtil.showHUD("知识库搜索已就绪")
        }
        success = true
        break

      case "htmlLog":
      case "htmllog":
        {
          const message = config.params.message || "无消息"
          const source = config.params.source || "htmlWebView"
          let level = String(config.params.level || "INFO").toUpperCase()
          if (level === 'INFO' && /^\[HTML (?:ERROR|WARN)\]/i.test(message)) {
            level = /^\[HTML ERROR\]/i.test(message) ? 'ERROR' : 'WARN'
          }
          KnowledgeBaseUtils.log(message, source, undefined, level)
          success = true
        }
        break

      case "searchDebugLog":
      case "searchdebuglog":
        {
          const message = config.params.message || "无消息"
          const source = config.params.source || "searchDebug"
          const level = config.params.level || "INFO"
          const detail = parseMaybeJSONParam(config.params.detail)
          KnowledgeBaseUtils.log(message, source, detail, level)
          success = true
        }
        break

      // ========================================
      // 评论管理器 Bridge 方法
      // ========================================

      case "loadCommentData":
      case "loadcommentdata":
        // 加载指定卡片的评论数据
        {
          const noteId = getNoteIdFromParams(config.params)
          if (!noteId) {
            MNUtil.showHUD("缺少卡片 ID")
            break
          }

          await this.loadCommentData(noteId)
          success = true
        }
        break

      case "autoNewContent":
      case "autonewcontent":
        // 自动检测新内容（返回索引到 HTML）
        try {
          const autoNoteId = getNoteIdFromParams(config.params)
          if (!autoNoteId) {
            MNUtil.showHUD("缺少卡片 ID")
            break
          }

	          const note = MNNote.new(autoNoteId)
	          if (!note) {
	            await this.removeMissingSearchCardIndex(autoNoteId, "autoNewContent.noteMissing")
	            MNUtil.showHUD("未找到卡片，已从索引移除")
	            break
	          }

          const indexArr = KnowledgeBaseTemplate.autoGetNewContentToMoveIndexArr(note) || []
          KnowledgeBaseUtils.log(`autoNewContent -> ${indexArr}`, "executeAction")

          const script = `window.Bridge.applyAutoNewSelection(${JSON.stringify(indexArr)})`
          await this.runJavaScript(script)
          success = true
        } catch (error) {
          KnowledgeBaseUtils.log("autoNewContent 失败: " + error.message, "executeAction")
          MNUtil.showHUD("自动检测失败：" + error.message)
        }
        break

      case "refreshCurrentNote":
      case "refreshcurrentnote":
        {
          const nextNote = MNNote.getFocusNote()
          if (!nextNote || !nextNote.noteId) {
            MNUtil.showHUD("请先选中一张卡片")
            break
          }

          if (global.MNKnowledgeBaseInstance) {
            global.MNKnowledgeBaseInstance.currentManagedNote = nextNote
          }
          await this.loadCommentData(nextNote.noteId, {
            force: true,
            reason: "manual-current-note",
            showLoadedFeedback: true,
          })
          MNUtil.showHUD("评论管理器已更新到当前卡片")
          success = true
        }
        break

      case "refreshManagedCommentData":
      case "refreshmanagedcommentdata":
        {
          const managedNoteId = getNoteIdFromParams(config.params)
            || (global.MNKnowledgeBaseInstance
              && global.MNKnowledgeBaseInstance.currentManagedNote
              && global.MNKnowledgeBaseInstance.currentManagedNote.noteId)
          if (!managedNoteId) {
            break
          }

          await this.loadCommentData(managedNoteId, {
            skipIfUnchanged: true,
            silent: true,
            reason: "auto-revision-check",
          })
          success = true
        }
        break

      case "closeCommentManager":
      case "closecommentmanager":
        if (this.currentHTMLType === 'comment-manager') {
          if (this.addonBar) {
            this.hide(this.addonBar.frame)
          } else {
            this.hide()
          }
          success = true
        }
        break

      case "openProofStructureWorkbench":
      case "openproofstructureworkbench":
        {
          const noteId = getNoteIdFromParams(config.params)
          const fieldName = String(config.params.fieldName || '')
          const instance = global.MNKnowledgeBaseInstance
          success = !!(instance && typeof instance.openProofStructureWorkbench === 'function'
            && await instance.openProofStructureWorkbench(noteId, fieldName))
        }
        break

      case "returnToCommentManager":
      case "returntocommentmanager":
        {
          const noteId = getNoteIdFromParams(config.params)
          const fieldName = String(config.params.fieldName || '')
          const commentIndex = Number(config.params.commentIndex)
          const instance = global.MNKnowledgeBaseInstance
          success = !!(instance && typeof instance.returnFromProofStructureWorkbench === 'function'
            && await instance.returnFromProofStructureWorkbench(noteId, fieldName, commentIndex, String(config.params.revision || '')))
        }
        break

      case "openProofStructureHtmlMDStudio":
      case "openproofstructurehtmlmdstudio":
        {
          const noteId = getNoteIdFromParams(config.params)
          const fieldName = String(config.params.fieldName || '')
          const commentIndex = Number(config.params.commentIndex)
          const instance = global.MNKnowledgeBaseInstance
          success = !!(instance && typeof instance.openProofStructureHtmlMDStudio === 'function'
            && await instance.openProofStructureHtmlMDStudio(noteId, fieldName, commentIndex, String(config.params.revision || '')))
        }
        break

      case "closeProofStructureWorkbench":
      case "closeproofstructureworkbench":
        if (this.currentHTMLType === 'proof-structure-workbench') {
          if (this.addonBar) this.hide(this.addonBar.frame)
          else this.hide()
          success = true
        }
        break

      case "researchWorkbenchSave":
      case "researchworkbenchsave":
        {
          const requestId = String(config.params.requestId || '')
          const entryNoteId = getNoteIdFromParams(config.params)
          const cache = this._researchMutationResults || (this._researchMutationResults = new Map())
          if (requestId && cache.has(requestId)) {
            const cachedResult = cache.get(requestId)
            await this.notifyResearchWorkbenchActionComplete(cachedResult)
            success = cachedResult.success === true
            break
          }
          const updates = parseMaybeJSONParam(config.params.updates)
          const instance = global.MNKnowledgeBaseInstance
          const result = instance && typeof instance.applyResearchWorkbenchUpdates === 'function'
            ? await instance.applyResearchWorkbenchUpdates({
              requestId,
              entryNoteId,
              updates: Array.isArray(updates) ? updates : [],
            })
            : { success: false, error: 'Native 保存接口不可用' }
          const response = Object.assign({
            requestId,
            action: 'researchWorkbenchSave',
            message: result && result.success ? '' : (result && result.error ? result.error : '保存失败，草稿已保留'),
          }, result || {})
          if (entryNoteId) {
            await this.loadResearchWorkbenchData(entryNoteId, {
              reason: result && result.success ? 'save-success' : 'save-conflict',
              preserveDrafts: !(result && result.success),
              forceApply: true,
            })
          }
          if (requestId) {
            cache.set(requestId, response)
            while (cache.size > 80) cache.delete(cache.keys().next().value)
          }
          await this.notifyResearchWorkbenchActionComplete(response)
          success = response.success === true
        }
        break

      case "researchWorkbenchCreateNode":
      case "researchworkbenchcreatenode":
        {
          const requestId = String(config.params.requestId || '')
          const entryNoteId = getNoteIdFromParams(config.params)
          const cache = this._researchMutationResults || (this._researchMutationResults = new Map())
          if (requestId && cache.has(requestId)) {
            const cachedResult = cache.get(requestId)
            await this.notifyResearchWorkbenchActionComplete(cachedResult)
            success = cachedResult.success === true
            break
          }
          const instance = global.MNKnowledgeBaseInstance
          const result = instance && typeof instance.createResearchWorkbenchNode === 'function'
            ? await instance.createResearchWorkbenchNode({
              requestId,
              entryNoteId,
              parentNoteId: config.params.parentNoteId,
              parentRevision: config.params.parentRevision,
              type: String(config.params.type || ''),
              title: String(config.params.title || ''),
              body: String(config.params.body || ''),
            })
            : { success: false, error: 'Native 创建接口不可用' }
          const response = Object.assign({
            requestId,
            action: 'researchWorkbenchCreateNode',
            message: result && result.success ? '' : (result && result.error ? result.error : '创建失败'),
          }, result || {})
          const nextEntryId = result && result.success && result.noteId ? String(result.noteId) : entryNoteId
          if (nextEntryId) {
            if (global.MNKnowledgeBaseInstance && result && result.success) {
              global.MNKnowledgeBaseInstance.currentManagedNote = MNNote.new(nextEntryId, false)
            }
            await this.loadResearchWorkbenchData(nextEntryId, {
              reason: result && result.success ? 'create-success' : 'create-conflict',
              preserveDrafts: !(result && result.success),
              forceApply: true,
            })
          }
          if (requestId) {
            cache.set(requestId, response)
            while (cache.size > 80) cache.delete(cache.keys().next().value)
          }
          await this.notifyResearchWorkbenchActionComplete(response)
          success = response.success === true
        }
        break

      case "refreshResearchWorkbench":
      case "refreshresearchworkbench":
        {
          const entryNoteId = getNoteIdFromParams(config.params)
          if (entryNoteId) {
            await this.loadResearchWorkbenchData(entryNoteId, {
              reason: 'manual-refresh',
              forceApply: true,
            })
            success = true
          }
        }
        break

      case "closeResearchWorkbench":
      case "closeresearchworkbench":
        if (this.currentHTMLType === 'question-research-workbench') {
          if (this.addonBar) this.hide(this.addonBar.frame)
          else this.hide()
          success = true
        }
        break

      case "executeDefinitionMerge":
      case "executedefinitionmerge":
        {
          const requestId = String(config.params.requestId || '')
          const cache = this._definitionMergeMutationResults || (this._definitionMergeMutationResults = new Map())
          if (!requestId) {
            const response = {
              requestId: '',
              action: 'executeDefinitionMerge',
              success: false,
              message: '缺少请求标识，请刷新后重试',
              error: '缺少请求标识，请刷新后重试',
            }
            await this.notifyDefinitionMergeActionComplete(response)
            break
          }
          if (requestId && cache.has(requestId)) {
            const cachedResult = await cache.get(requestId)
            await this.notifyDefinitionMergeActionComplete(cachedResult)
            success = cachedResult.success === true
            break
          }
          const plan = parseMaybeJSONParam(config.params.plan)
          const instance = global.MNKnowledgeBaseInstance
          const pending = (async () => {
            let result
            try {
              result = instance && typeof instance.applyDefinitionMergePlan === 'function'
                ? await instance.applyDefinitionMergePlan({ requestId, plan })
                : { success: false, error: 'Native 定义卡合并接口不可用' }
            } catch (error) {
              KnowledgeBaseUtils.addErrorLog(error, 'executeDefinitionMerge')
              result = { success: false, requiresUndo: true, error: '合并中断，请在 MarginNote 撤销一次并刷新' }
            }
            return Object.assign({
              requestId,
              action: 'executeDefinitionMerge',
              message: result && result.success
                ? ''
                : (result && result.error ? result.error : '合并失败，请刷新后重试'),
            }, result || {})
          })()
          cache.set(requestId, pending)
          const response = await pending
          cache.set(requestId, response)
          while (cache.size > 40) cache.delete(cache.keys().next().value)
          await this.notifyDefinitionMergeActionComplete(response)
          success = response.success === true
        }
        break

      case "refreshDefinitionMergeWorkbench":
      case "refreshdefinitionmergeworkbench":
      case "swapDefinitionMergeWorkbench":
      case "swapdefinitionmergeworkbench":
        {
          const sourceNoteId = normalizeNoteIdValue(config.params.sourceNoteId || config.params.source)
          const targetDefinitionId = normalizeNoteIdValue(config.params.targetNoteId || config.params.target)
          if (!sourceNoteId || !targetDefinitionId) {
            MNUtil.showHUD('刷新失败：缺少来源卡片或目标卡片')
            break
          }
          const instance = global.MNKnowledgeBaseInstance
          if (actionLower === 'swapdefinitionmergeworkbench') {
            const candidate = instance && instance.prepareDefinitionMergeWorkbenchData(sourceNoteId, targetDefinitionId)
            if (!candidate || candidate.canExecute !== true) {
              MNUtil.showHUD((candidate && candidate.errors && candidate.errors[0]) || '当前卡片不能交换合并方向')
              break
            }
          }
          const result = await this.loadDefinitionMergeWorkbenchData(sourceNoteId, targetDefinitionId)
          if (instance && result && result.success) {
            instance.currentDefinitionMergeContext = {
              sourceNoteId,
              targetNoteId: targetDefinitionId,
            }
            instance.currentManagedNote = MNNote.new(targetDefinitionId, false)
          }
          success = !!(result && result.success)
        }
        break

      case "closeDefinitionMergeWorkbench":
      case "closedefinitionmergeworkbench":
        if (this.currentHTMLType === 'definition-merge-workbench') {
          if (this.addonBar) this.hide(this.addonBar.frame)
          else this.hide()
          success = true
        }
        break

      case "moveCommentsToField":
      case "movecommentstofield":
        // 移动评论到字段
        {
          const noteId = getNoteIdFromParams(config.params)
          const indexArr = normalizeIndexArray(config.params.indexArr)
          const raw = config.params.toBottom
          const toBottom = (raw === true || raw === 1 || raw === "1" || raw === "true")

          if (!noteId || indexArr.length === 0) {
            MNUtil.showHUD("移动失败：缺少参数")
            break
          }

          await this.moveCommentsToField(
            noteId,
            indexArr,
            config.params.fieldName,
            toBottom
          )
          success = true
        }
        break

      case "moveComments":
      case "movecomments":
        // 移动评论到指定索引
        KnowledgeBaseUtils.log("收到 moveComments 请求", "executeAction")
        KnowledgeBaseUtils.log("原始参数", "executeAction", config.params)

        try {
          const moveNoteId = getNoteIdFromParams(config.params)
          const moveIndexArr = normalizeIndexArray(config.params.indexArr)
          const moveTargetIndex = parseInt(config.params.targetIndex)

          KnowledgeBaseUtils.log("解析后参数", "executeAction", {
            moveNoteId,
            moveIndexArr,
            moveTargetIndex
          })

          if (!moveNoteId || moveIndexArr.length === 0 || isNaN(moveTargetIndex)) {
            MNUtil.showHUD("移动失败：参数缺失或格式错误")
            break
          }

          await this.moveComments(moveNoteId, moveIndexArr, moveTargetIndex)
          success = true
        } catch (error) {
          KnowledgeBaseUtils.log("moveComments 失败: " + error.message, "executeAction")
          MNUtil.showHUD("移动失败：" + error.message)
        }
        break

      case "deleteComments":
      case "deletecomments":
        // 删除评论
        KnowledgeBaseUtils.log("收到 deleteComments 请求", "executeAction")
        KnowledgeBaseUtils.log("原始参数", "executeAction", config.params)

        try {
          const deleteNoteId = getNoteIdFromParams(config.params)
          const deleteIndexArr = normalizeIndexArray(config.params.indexArr)

          KnowledgeBaseUtils.log("解析后参数", "executeAction", {
            deleteNoteId,
            deleteIndexArr
          })

          if (!deleteNoteId || deleteIndexArr.length === 0) {
            MNUtil.showHUD("删除失败：参数缺失或格式错误")
            break
          }

          MNUtil.showHUD(`正在删除 ${deleteIndexArr.length} 条评论...`, 0.8)
          KnowledgeBaseUtils.log(`执行 deleteComments -> noteId=${deleteNoteId}, indices=${deleteIndexArr}`, "executeAction")
          await this.deleteComments(deleteNoteId, deleteIndexArr)
          success = true
        } catch (error) {
          KnowledgeBaseUtils.log("deleteComments 失败: " + error.message, "executeAction")
          MNUtil.showHUD("删除失败：" + error.message)
        }
        break

      case "deleteBidirectionalLinks":
      case "deletebidirectionallinks":
        // 双向删除链接评论
        KnowledgeBaseUtils.log("收到 deleteBidirectionalLinks 请求", "executeAction")

        try {
          const linkNoteId = getNoteIdFromParams(config.params)
          const linkIndexArr = normalizeIndexArray(config.params.indexArr)

          if (!linkNoteId || linkIndexArr.length === 0) {
            MNUtil.showHUD("双向删除失败：参数缺失")
            break
          }

          MNUtil.showHUD(`正在双向删除 ${linkIndexArr.length} 条链接...`, 0.8)
          await this.deleteBidirectionalLinks(linkNoteId, linkIndexArr)
          success = true
        } catch (error) {
          KnowledgeBaseUtils.log("deleteBidirectionalLinks 失败: " + error.message, "executeAction")
          MNUtil.showHUD("双向删除失败：" + error.message)
        }
        break

      case "copyText":
      case "copytext":
        // 复制文本到剪贴板
        {
          const text = config.params.text;
          if (text) {
            MNUtil.copy(text);
            KnowledgeBaseUtils.log("已复制文本到剪贴板", "executeAction", { textLength: text.length });
          } else {
            MNUtil.showHUD("复制失败：文本为空");
          }
        }
        break

      case "requestClipboardText":
      case "requestclipboardtext":
        // 读取剪贴板文本并回传给 comment-manager 编辑弹窗
        {
          const rawTargetField = config.params.targetField
          const targetField = rawTargetField === "url" ? "url" : "displayText"
          const clipboardText = typeof MNUtil.clipboardText === "string"
            ? MNUtil.clipboardText
            : String(MNUtil.clipboardText || "")

          const script = `window.Bridge.receiveClipboardText(${JSON.stringify(clipboardText)}, ${JSON.stringify(targetField)})`
          await this.runJavaScript(script)
          success = true
        }
        break

      case "applyHtmlMDCommentUpdates":
      case "applyhtmlmdcommentupdates":
        {
          const noteId = getNoteIdFromParams(config.params)
          let updates = config.params.updates

          if (typeof updates === "string") {
            try {
              updates = JSON.parse(updates)
            } catch (_) {
              updates = []
            }
          }

          await this.applyHtmlMDCommentUpdates(noteId, updates)
          success = true
        }
        break

      case "appendHtmlMDComment":
      case "appendhtmlmdcomment":
        {
          const noteId = getNoteIdFromParams(config.params)
          const text = config.params.text ? String(config.params.text) : ""
          await this.appendHtmlMDComment(noteId, text)
          success = true
        }
        break

      case "mergeInlineLinkComments":
      case "mergeinlinelinkcomments":
        {
          const noteId = getNoteIdFromParams(config.params)
          const indexArr = normalizeIndexArray(config.params.indexArr)
          const text = config.params.text ? String(config.params.text) : ""
          await this.mergeInlineLinkComments(noteId, indexArr, text)
          success = true
        }
        break

      case "mergeTextComments":
      case "mergetextcomments":
        {
          const noteId = getNoteIdFromParams(config.params)
          const indexArr = normalizeIndexArray(config.params.indexArr)
          const text = config.params.text ? String(config.params.text) : ""
          await this.mergeTextComments(noteId, indexArr, text)
          success = true
        }
        break

      case "extractComments":
      case "extractcomments":
        // 提取评论创建子卡片
        KnowledgeBaseUtils.log("收到 extractComments 请求", "executeAction")
        KnowledgeBaseUtils.log("原始参数", "executeAction", config.params)

        try {
          const extractNoteId = getNoteIdFromParams(config.params)
          const extractIndexArr = normalizeIndexArray(config.params.indexArr)

          KnowledgeBaseUtils.log("解析后参数", "executeAction", {
            extractNoteId,
            extractIndexArr
          })

          if (!extractNoteId || extractIndexArr.length === 0) {
            MNUtil.showHUD("提取失败：参数缺失或格式错误")
            break
          }

          MNUtil.showHUD(`正在提取 ${extractIndexArr.length} 条评论...`, 0.8)
          KnowledgeBaseUtils.log(`执行 extractComments -> noteId=${extractNoteId}, indices=${extractIndexArr}`, "executeAction")
          await this.extractComments(extractNoteId, extractIndexArr)
          success = true
        } catch (error) {
          KnowledgeBaseUtils.log("extractComments 失败: " + error.message, "executeAction")
          MNUtil.showHUD("提取失败：" + error.message)
        }
        break

      case "updateCommentLink":
      case "updatecommentlink":
        // 更新链接评论
        KnowledgeBaseUtils.log("收到 updateCommentLink 请求", "executeAction")
        KnowledgeBaseUtils.log("原始参数", "executeAction", config.params)

        try {
          const updateNoteId = getNoteIdFromParams(config.params)
          const updateIndexArr = normalizeIndexArray(config.params.indexArr)
          const rawLinkIndex = config.params.linkIndex
          const updateLinkIndex = rawLinkIndex === undefined || rawLinkIndex === null || rawLinkIndex === ''
            ? undefined
            : parseInt(rawLinkIndex, 10)

          KnowledgeBaseUtils.log("解析后参数", "executeAction", {
            updateNoteId,
            updateIndexArr,
            updateLinkIndex,
          })

          if (!updateNoteId || updateIndexArr.length === 0) {
            MNUtil.showHUD("更新失败：参数缺失或格式错误")
            break
          }

          if (updateIndexArr.length !== 1) {
            MNUtil.showHUD("一次只能更新一条链接")
            break
          }

          if (rawLinkIndex !== undefined && rawLinkIndex !== null && rawLinkIndex !== ''
            && (!Number.isInteger(updateLinkIndex) || updateLinkIndex < 0)) {
            MNUtil.showHUD("链接索引无效")
            break
          }

          MNUtil.showHUD("正在更新链接...", 0.8)
          KnowledgeBaseUtils.log(`执行 updateCommentLink -> noteId=${updateNoteId}, index=${updateIndexArr[0]}`, "executeAction")
          success = await this.updateCommentLink(updateNoteId, updateIndexArr, updateLinkIndex)
        } catch (error) {
          KnowledgeBaseUtils.log("updateCommentLink 失败: " + error.message, "executeAction")
          MNUtil.showHUD("更新失败：" + error.message)
        }
        break

      case "replacePlaceholderLink":
      case "replaceplaceholderlink":
        try {
          const replacementNoteId = getNoteIdFromParams(config.params)
          const replacementIndexArr = normalizeIndexArray(config.params.indexArr)
          const rawReplacementLinkIndex = config.params.linkIndex
          const replacementLinkIndex = rawReplacementLinkIndex === undefined ||
            rawReplacementLinkIndex === null || rawReplacementLinkIndex === ""
            ? undefined
            : parseInt(rawReplacementLinkIndex, 10)

          if (!replacementNoteId || replacementIndexArr.length !== 1) {
            MNUtil.showHUD("占位替换失败：参数缺失")
            break
          }
          if (rawReplacementLinkIndex !== undefined && rawReplacementLinkIndex !== null &&
            rawReplacementLinkIndex !== "" &&
            (!Number.isInteger(replacementLinkIndex) || replacementLinkIndex < 0)) {
            MNUtil.showHUD("链接索引无效")
            break
          }

          const replacementResult = await this.replacePlaceholderLink(
            replacementNoteId,
            replacementIndexArr[0],
            replacementLinkIndex
          )
          success = replacementResult.success === true
          if (replacementResult.cancelled === true && trackedCommentMutation) {
            await this.notifyCommentMutationComplete({
              requestId: trackedCommentMutation.requestId,
              action: trackedCommentMutation.action,
              success: true,
              cancelled: true,
            })
            trackedCommentMutation = null
          }
        } catch (error) {
          KnowledgeBaseUtils.addErrorLog(error, "executeAction: replacePlaceholderLink")
          MNUtil.showHUD("占位替换失败：" + error.message)
        }
        break

      case "convertLinkCommentsToInlineLinks":
      case "convertlinkcommentstoinlinelinks":
        {
          const noteId = getNoteIdFromParams(config.params)
          const indexArr = normalizeIndexArray(config.params.indexArr)
          await this.convertLinkCommentsToInlineLinks(noteId, indexArr)
          success = true
        }
        break

      case "editMarkdownLink":
        try {
          // 获取 noteId
          const noteId = getNoteIdFromParams(config.params);
          if (!noteId) {
            MNUtil.showHUD("缺少卡片 ID");
            break;
          }

          // 获取其他参数
          const commentIndex = parseInt(config.params.commentIndex);
          const linkIndex = parseInt(config.params.linkIndex);
          const newDisplayText = config.params.newDisplayText;
          const newUrl = config.params.newUrl;
          const replacementMarkdown = config.params.replacementMarkdown;

          // 调用编辑方法
          success = await this.editMarkdownLink(
            noteId,
            commentIndex,
            linkIndex,
            newDisplayText,
            newUrl,
            replacementMarkdown,
            config.params.targetSnapshot
          );
        } catch (error) {
          KnowledgeBaseUtils.addErrorLog(error, "executeAction: editMarkdownLink");
          MNUtil.showHUD("编辑链接失败：" + error.message);
        }
        break

      default:
        MNUtil.showHUD("未知动作：" + config.host)
    }

    if (
      success === true
      && !isCommentController
      && global.MNKnowledgeBaseInstance
      && typeof global.MNKnowledgeBaseInstance.recordSearchCardUsage === 'function'
      && config.params
      && Number(config.params.usageTier) > 0
      && config.params.usageRoundId
      && targetNoteId
    ) {
      try {
        await global.MNKnowledgeBaseInstance.recordSearchCardUsage(
          targetNoteId,
          Number(config.params.usageTier),
          String(config.params.usageRoundId),
          { indexSource: config.params.indexSource || '' },
        )
      } catch (usageError) {
        KnowledgeBaseUtils.addErrorLog(usageError, 'executeAction.recordSearchCardUsage')
      }
    }
    if (trackedCommentMutation) {
      let currentRevision = ''
      const mutationNote = trackedCommentMutation.noteId
        ? MNNote.new(trackedCommentMutation.noteId)
        : null
      if (mutationNote) {
        currentRevision = this.getCommentDataRevision(mutationNote)
      }

      if (success && currentRevision) {
        const revisionMap = this._commentLastRevisionByNote || (this._commentLastRevisionByNote = {})
        if (revisionMap[trackedCommentMutation.noteId] !== currentRevision) {
          await this.loadCommentData(trackedCommentMutation.noteId, {
            force: true,
            silent: true,
            reason: 'mutation-complete-refresh',
          })
        }
      }

      await this.notifyCommentMutationComplete({
        requestId: trackedCommentMutation.requestId,
        action: trackedCommentMutation.action,
        success,
        currentRevision,
        message: success ? '' : '操作未完成，原选择和草稿已保留',
      })
    }

    await completeSidebarReceipt()
    if (this.shouldAutoCloseAfterAction(closedWebView, success, action)) {
      this.autoCloseAfterAction()
    }
  } catch (error) {
    success = false
    sidebarFailure = error && error.message ? error.message : String(error)
    if (trackedCommentMutation) {
      await this.notifyCommentMutationComplete({
        requestId: trackedCommentMutation.requestId,
        action: trackedCommentMutation.action,
        success: false,
        message: error && error.message ? error.message : String(error),
      })
    }
    MNUtil.showHUD("执行动作失败：" + error)
    MNUtil.copyJSON(error)
  } finally {
    await completeSidebarReceipt()
  }
}

// ========================================
// Native → JS 通信
// ========================================

/**
 * 执行 JavaScript 代码
 * @param {string} script - 要执行的 JS 代码
 * @param {number} delay - 延迟执行时间(秒),可选
 * @returns {Promise} 返回执行结果
 */
knowledgebaseWebController.prototype.runJavaScript = async function(script, delay) {
  KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== runJavaScript 被调用 ===")
  KnowledgeBaseUtils.emitRuntimeLog('INFO', "脚本前100个字符: " + script.substring(0, 100))
  KnowledgeBaseUtils.emitRuntimeLog('INFO', "延迟执行: " + (delay || "否"))

  if (!this.webView || !this.webView.window) {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "错误: webView 或 webView.window 不存在!")
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "webView: " + this.webView)
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "webView.window: " + (this.webView ? this.webView.window : "N/A"))
    return undefined
  }

  KnowledgeBaseUtils.emitRuntimeLog('INFO', "webView 状态正常,准备执行 JavaScript")

  return new Promise((resolve, reject) => {
    if (delay) {
      // 使用定时器延迟执行
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "使用定时器延迟 " + delay + " 秒执行")
      this.viewTimer = NSTimer.scheduledTimerWithTimeInterval(delay, true, () => {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "定时器触发,执行 JavaScript")
        this.webView.evaluateJavaScript(script, (result) => {
          KnowledgeBaseUtils.emitRuntimeLog('INFO', "evaluateJavaScript 回调执行")
          KnowledgeBaseUtils.emitRuntimeLog('INFO', "返回结果: " + result)
          if (MNUtil.isNSNull(result)) {
            KnowledgeBaseUtils.emitRuntimeLog('INFO', "结果为 null")
            resolve(undefined)
          } else {
            KnowledgeBaseUtils.emitRuntimeLog('INFO', "结果非 null: " + JSON.stringify(result))
            resolve(result)
          }
        })
      })
    } else {
      // 立即执行
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "立即执行 JavaScript")
      try {
        this.webView.evaluateJavaScript(script, (result) => {
          KnowledgeBaseUtils.emitRuntimeLog('INFO', "evaluateJavaScript 回调执行")
          KnowledgeBaseUtils.emitRuntimeLog('INFO', "返回结果类型: " + typeof result)
          KnowledgeBaseUtils.emitRuntimeLog('INFO', "返回结果: " + result)
          if (MNUtil.isNSNull(result)) {
            KnowledgeBaseUtils.emitRuntimeLog('INFO', "结果为 null,返回 undefined")
            resolve(undefined)
          } else {
            KnowledgeBaseUtils.emitRuntimeLog('INFO', "结果非 null: " + JSON.stringify(result))
            resolve(result)
          }
        })
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "evaluateJavaScript 调用完成")
      } catch (error) {
        KnowledgeBaseUtils.emitRuntimeLog('ERROR', "evaluateJavaScript 发生错误: " + error)
        MNUtil.copyJSON(error)
        reject(error)
      }
    }
  })
}

// ========================================
// 业务逻辑方法
// ========================================

/**
 * 加载搜索数据到 HTML
 */
knowledgebaseWebController.prototype.loadSearchData = async function() {
  try {
    if (typeof SynonymManager !== 'undefined' && SynonymManager && typeof SynonymManager.reloadLibrary === 'function') {
      SynonymManager.reloadLibrary()
    }
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== loadSearchData 开始执行 ===")
    let allCards = [];
    let metadata = {};

    // 1. 尝试加载分片索引（新版模式）
    let manifestPath = MNUtil.dbFolder + "/data/kb-search-index-manifest.json"
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "检查 manifest 文件: " + manifestPath)
    let manifest = MNUtil.readJSON(manifestPath);

    if (manifest && manifest.parts) {
      // 分片模式：加载所有分片
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "发现分片索引,共 " + manifest.parts.length + " 个分片");

      for (const partInfo of manifest.parts) {
        let partPath = MNUtil.dbFolder + "/data/" + partInfo.filename;
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "加载分片: " + partInfo.filename);
        let partData = MNUtil.readJSON(partPath);

        if (partData && partData.data) {
          allCards = allCards.concat(partData.data);
          KnowledgeBaseUtils.emitRuntimeLog('INFO', "分片加载成功,当前总卡片数: " + allCards.length);
        }
      }

      metadata = manifest.metadata || {};

    } else {
      // 旧版模式：尝试加载单文件
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "未找到分片索引,尝试加载旧版单文件索引");
      let indexPath = MNUtil.dbFolder + "/data/kb-search-index.json"
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "索引文件路径: " + indexPath)

      if (!MNUtil.isfileExists(indexPath)) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "错误: 索引文件不存在!")
        MNUtil.showHUD("索引未找到，请先更新搜索索引")
        return
      }

      let indexData = MNUtil.readJSON(indexPath);
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "索引文件读取完成")

      if (!indexData || !indexData.cards) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "错误: 索引数据格式不正确!")
        MNUtil.showHUD("索引未找到，请先更新搜索索引")
        return
      }

      allCards = indexData.cards;
      metadata = indexData.metadata || {};
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "旧版索引加载成功,卡片数: " + allCards.length);
    }

    // 2. 加载增量索引（如果存在）
    let incrementalPath = MNUtil.dbFolder + "/data/kb-incremental-index.json";
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "检查增量索引: " + incrementalPath);

    if (MNUtil.isfileExists(incrementalPath)) {
      let incrementalData = MNUtil.readJSON(incrementalPath);
      if (incrementalData && incrementalData.cards) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', `发现增量索引：${incrementalData.cards.length} 张卡片`);

        // 合并并去重（基于 noteId）
        // 注意：需要在 push 后更新 Set，否则增量索引内部的重复项会被重复 push
        const removedIds = typeof KnowledgeBaseIndexer !== "undefined" && KnowledgeBaseIndexer && typeof KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex === "function"
          ? KnowledgeBaseIndexer.getRemovedIdsFromIncrementalIndex(incrementalData)
          : []
        const removedSet = new Set(removedIds.map(id => String(id)))
        if (removedSet.size > 0) {
          allCards = allCards.filter(card => !removedSet.has(String(card?.id)))
        }
        const existingIds = new Set(allCards.map(card => card?.id).filter(Boolean).map(id => String(id)));
        let addedCount = 0;
        for (const card of incrementalData.cards) {
          const id = card?.id;
          if (!id) continue;
          const key = String(id);
          if (removedSet.has(key)) continue;
          if (!existingIds.has(key)) {
            allCards.push(card);
            existingIds.add(key);
            addedCount++;
          }
        }
        KnowledgeBaseUtils.emitRuntimeLog('INFO', `增量索引合并完成,新增 ${addedCount} 张卡片`);
      }
    } else {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "未发现增量索引文件");
    }

    // 3. 构建完整的索引数据
    const indexSynonymRevision = metadata.synonymRevision || ''
    const fullIndexData = {
      cards: allCards,
      metadata: {
        totalCards: allCards.length,
        updateTime: metadata.updateTime || Date.now(),
        ...metadata,
        indexSynonymRevision,
        synonymRevision: typeof SynonymManager !== 'undefined' && SynonymManager
          ? SynonymManager.getSynonymRevision()
          : '',
      },
      // 传递排除词组配置到前端
      exclusionGroups: ExclusionManager.getExclusionGroups(),
      // 传递同义词组配置到前端
      synonymGroups: SynonymManager.getSynonymGroups()
    };

    KnowledgeBaseUtils.emitRuntimeLog('INFO', `数据准备完成：共 ${allCards.length} 张卡片`);
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "准备调用 JavaScript...");

    // 检查 webView 状态
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "webView 存在: " + (this.webView ? "是" : "否"));
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "webView.window 存在: " + (this.webView && this.webView.window ? "是" : "否"));

    // 将数据传递给 HTML

    const pendingLS = (typeof global !== 'undefined' && global.__MNKB_pendingLocalSearch) || null;
    if (pendingLS && pendingLS.rootId) {
      global.__MNKB_pendingLocalSearch = null;
      await this.runJavaScript(`window.__MNKB_pendingLocalSearch = ${JSON.stringify(pendingLS)}`);
      KnowledgeBaseUtils.log('注入待处理局部搜索根', 'loadSearchData', pendingLS);
    }
    let script = `window.Bridge.loadSearchIndex(${JSON.stringify(fullIndexData)})`
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "JavaScript 脚本长度: " + script.length + " 字符");

    let result = await this.runJavaScript(script)
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "runJavaScript 返回结果: " + result);

    MNUtil.showHUD(`已加载 ${allCards.length} 张卡片`)
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== loadSearchData 执行完成 ===")

  } catch (error) {
    KnowledgeBaseUtils.emitRuntimeLog('ERROR', "loadSearchData 发生错误: " + error)
    MNUtil.showHUD("加载数据失败：" + error)
    MNUtil.copyJSON(error)
  }
}


/**
 * 刷新搜索结果
 * @param {Array} results - 搜索结果数组
 */
knowledgebaseWebController.prototype.refreshSearchResults = async function(results) {
  try {
    let script = `window.Bridge.updateResults(${JSON.stringify(results)})`
    await this.runJavaScript(script)
  } catch (error) {
    MNUtil.showHUD("刷新结果失败：" + error)
  }
}

/**
 * 同步 autoCloseMode 到 WebView（允许页面先缓存，避免 UI 显示与实际行为不一致）
 */
knowledgebaseWebController.prototype.syncAutoCloseModeToWebView = function() {
  try {
    if (!this.webView || !this.webViewLoaded || this.currentHTMLType !== 'search' || this.disableAutoClose) {
      return
    }
    const enabled = (this.autoCloseMode === true)
    const script = `
      (function(){
        try {
          var enabled = ${enabled};
          window.__mnkbAutoCloseModeFromNative = enabled;
          if (typeof window.setAutoCloseModeFromNative === 'function') {
            window.setAutoCloseModeFromNative(enabled);
            return;
          }
          if (window.state && typeof window.state === 'object') {
            window.state.autoCloseMode = enabled;
          }
          if (typeof window.updateAutoCloseModeButton === 'function') {
            window.updateAutoCloseModeButton();
          }
          console.log('[autoCloseMode] sync from Native: ' + enabled);
        } catch (e) {
          console.log('[autoCloseMode] sync error: ' + e);
        }
      })();
    `
    this.webView.evaluateJavaScript(script)
  } catch (error) {
    KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【syncAutoCloseModeToWebView】失败: " + error)
  }
}

// ========================================
// 浮动窗口显示/隐藏
// ========================================

/**
 * 显示浮动窗口（参考 mnbrowser）
 * search.html 首次加载或隐藏后再次展示时自动刷新一次
 * @param {Object} beginFrame - 动画起始位置（可选）
 * @param {Object} endFrame - 最终位置和大小（可选）
 */
knowledgebaseWebController.prototype.requestSearchAutoRefresh = function(options = {}) {
  const mergedOptions = {
    ...(this._pendingSearchAutoRefreshOptions || {}),
    ...(options || {}),
  }
  this._pendingSearchAutoRefreshOptions = mergedOptions

  if (this._searchAutoRefreshScheduled) {
    return
  }

  this._searchAutoRefreshScheduled = true
  MNUtil.delay(0.12).then(async () => {
    this._searchAutoRefreshScheduled = false

    if (this._searchAutoRefreshRunning) {
      const pendingOptions = this._pendingSearchAutoRefreshOptions || {}
      this.requestSearchAutoRefresh(pendingOptions)
      return
    }

    if (this.view.hidden || this.currentHTMLType !== 'search') {
      this._pendingSearchAutoRefreshOptions = null
      return
    }

    const nextOptions = this._pendingSearchAutoRefreshOptions || {}
    this._pendingSearchAutoRefreshOptions = null
    this._searchAutoRefreshRunning = true

    try {
      await this.refreshAllData(nextOptions)
    } finally {
      this._searchAutoRefreshRunning = false
    }
  })
}

knowledgebaseWebController.prototype.notifySearchRefreshResult = async function(result = {}, options = {}) {
  try {
    if (!this.webView || !this.webViewLoaded || this.currentHTMLType !== 'search') {
      return false
    }

    const requestId = options && options.requestId ? String(options.requestId) : ''
    const success = !result || result.success !== false
    const errorMessage = result && (result.error || result.reason)
      ? String(result.error || result.reason)
      : ''
    const payload = {
      requestId,
      success,
      message: success ? '' : (errorMessage || '刷新失败'),
    }

    const script = `
      (function(payload) {
        try {
          if (window.Bridge && typeof window.Bridge.notifyRefreshResult === 'function') {
            return window.Bridge.notifyRefreshResult(payload)
          }
          if (typeof completeRefreshReloading === 'function') {
            return completeRefreshReloading(payload)
          }
          if (typeof setRefreshReloading === 'function') {
            setRefreshReloading(false)
            return true
          }
          return false
        } catch (error) {
          return {
            ok: false,
            error: error && error.message ? error.message : String(error),
          }
        }
      })(${JSON.stringify(payload)})
    `

    return await this.runJavaScript(script)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "notifySearchRefreshResult")
    return false
  }
}

knowledgebaseWebController.prototype.show = async function(beginFrame, endFrame) {
  KnowledgeBaseUtils.emitRuntimeLog('INFO', "【show() 开始】beginFrame=" + (beginFrame ? "有" : "无") + ", endFrame=" + (endFrame ? "有" : "无"))
  const wasHidden = !!this.view.hidden

  // 如果没有指定 endFrame，尝试加载上次保存的窗口位置
  let savedFrame = null
  if (!endFrame) {
    try {
      let savedFrameStr = NSUserDefaults.standardUserDefaults().objectForKey(this.getFrameStorageKey())
      if (savedFrameStr) {
        savedFrame = JSON.parse(savedFrameStr)
      }
    } catch (error) {
      KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【show()】加载窗口 frame 失败: " + error)
    }
  }

  let targetFrame = endFrame || savedFrame || this.getDefaultFrameForCurrentHTMLType()
  let studyFrame = MNUtil.studyView.frame

  // 约束 frame 在屏幕范围内
  targetFrame.height = MNUtil.constrain(targetFrame.height, 100, studyFrame.height)
  targetFrame.width = MNUtil.constrain(targetFrame.width, 300, studyFrame.width)
  targetFrame.x = MNUtil.constrain(targetFrame.x, 0, studyFrame.width - targetFrame.width)
  targetFrame.y = MNUtil.constrain(targetFrame.y, 0, studyFrame.height - targetFrame.height)

  // 设置起始位置和透明度
  if (beginFrame) {
    this.view.frame = beginFrame
  }
  if (wasHidden) {
    this.lastShowAt = Date.now()
    if (this.closeButton) {
      this.closeButton.enabled = false
    }
  } else if (this.closeButton) {
    this.closeButton.enabled = true
  }
  this.view.layer.opacity = 0.2
  this.view.hidden = false
  if (this.currentHTMLType === 'comment-manager') {
    this.setCommentManagerAutoRefreshEnabled(true)
  }
  KnowledgeBaseUtils.emitRuntimeLog('INFO', "【show()】设置 hidden=false，开始动画")

  // 动画显示
  MNUtil.animate(() => {
    this.view.layer.opacity = 1.0
    this.view.frame = targetFrame
  }).then(async () => {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "【show()】动画完成，触发 bringSubviewToFront")
    MNUtil.studyView.bringSubviewToFront(this.view)

    // 隐藏后再次打开时也刷新一次，避免复用页面保留旧筛选范围。
    if (this.webViewLoaded && this.currentHTMLType === 'search') {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "【show()】搜索界面已加载，检查是否需要自动刷新")
      if (typeof this.syncAutoCloseModeToWebView === 'function') {
        this.syncAutoCloseModeToWebView()
      }
      if (wasHidden) {
        this._searchNeedsInitialRefresh = true
      }
      this.maybeRequestInitialSearchRefresh("show")
    } else {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "【show()】非搜索界面或 WebView 尚未加载，跳过自动刷新")
    }
  })

  if (wasHidden && this.closeButton) {
    const showToken = this.lastShowAt
    MNUtil.delay(KB_CLOSE_TAP_GUARD_MS / 1000).then(() => {
      if (this.closeButton && this.lastShowAt === showToken) {
        this.closeButton.enabled = true
      }
    })
  }
  
  KnowledgeBaseUtils.emitRuntimeLog('INFO', "【show() 返回】异步操作已启动")
}

// AI 查询与候选属于用户内容，不能经过会记录完整返回值的通用 runJavaScript。
knowledgebaseWebController.prototype.runAICardSearchJavaScript = async function(script) {
  const webView = this.webView
  if (!webView || !webView.window) return undefined
  const result = new Promise((resolve) => {
    try {
      webView.evaluateJavaScript(script, (value) => {
        try { resolve(MNUtil.isNSNull(value) ? undefined : value) } catch (_) { resolve(undefined) }
      })
    } catch (_) { resolve(undefined) }
  })
  return Promise.race([result, MNUtil.delay(5).then(() => undefined)])
}

// Native 的 UIView 隐藏不会可靠触发 WebView pagehide；同时释放页面中的 pending/loading。
knowledgebaseWebController.prototype.cancelActiveAICardSearchRequest = function() {
  const request = this._aiSearchRerankRequest
  if (this.currentHTMLType !== 'search' && !request) return
  if (request) request.cancelled = true
  const script = `(function() {
    if (typeof state !== 'undefined' && state.aiCardSearch
      && ${request ? `state.aiCardSearch.requestId === ${JSON.stringify(request.requestId)}` : 'true'}
      && typeof window.deactivateAICardSearch === 'function') {
      window.deactivateAICardSearch();
      return true;
    }
    return false;
  })()`
  try { Promise.resolve(this.runAICardSearchJavaScript(script)).catch(() => {}) } catch (_) {}
}

/**
 * 隐藏浮动窗口（增强版）
 */
knowledgebaseWebController.prototype.hide = function(frame) {
  this.cancelActiveAICardSearchRequest()
  if (this.currentHTMLType === 'comment-manager') {
    this.setCommentManagerAutoRefreshEnabled(false)
    this.clearCommentRefreshCoordinator()
  }

  // 保存当前位置
  let preFrame = this.view.frame

  if (preFrame.width < 200) {
    preFrame.width = Math.max(preFrame.width, 300)
  }
  this.view.frame = preFrame

  // 保存窗口 frame 到 userDefaults（用于下次打开时恢复）
  try {
    let frameToSave = {
      x: preFrame.x,
      y: preFrame.y,
      width: preFrame.width,
      height: preFrame.height
    }
    NSUserDefaults.standardUserDefaults().setObjectForKey(
      JSON.stringify(frameToSave),
      this.getFrameStorageKey()
    )
  } catch (error) {
    KnowledgeBaseUtils.emitRuntimeLog('ERROR', "【hide()】保存窗口 frame 失败: " + error)
  }

  // 标记动画状态
  this.onAnimate = true

  // 保存当前透明度
  let preOpacity = this.view.layer.opacity

  MNUtil.animate(() => {
    this.view.layer.opacity = 0.2
    if (frame) {
      this.view.frame = frame
      this.currentFrame = frame
    }
  }, 0.3).then(() => {
    this.onAnimate = false
    this.view.hidden = true
    this.view.layer.opacity = preOpacity
    this.view.frame = preFrame
    this.currentFrame = preFrame
  })
}

/**
 * 初始化状态和样式
 */
knowledgebaseWebController.prototype.init = function() {
  this.isFirst = true
  this.miniMode = false
  this.onAnimate = false
  this.lastTapTime = 0
  this.lastShowAt = 0
  this.moveDate = 0
  this.currentHTMLType = null  // 'search' 或 'comment-manager'
  this._commentManagerAutoRefreshEnabled = false
  this._commentRefreshSequence = 0
  this._commentRefreshGeneration = 0
  this._commentPendingRefresh = null
  this._commentRefreshDrainPromise = null
  this._commentLastRevisionByNote = {}
  this._researchMutationResults = new Map()
  this.disableAutoClose = false
  this.searchFocusNoteId = null
  this.searchSelectionContext = null
  this._searchAutoRefreshScheduled = false
  this._searchAutoRefreshRunning = false
  this._pendingSearchAutoRefreshOptions = null
  this._searchNeedsInitialRefresh = false

  // 🆕 从 KnowledgeBaseConfig 读取自动关闭模式
  this.autoCloseMode = KnowledgeBaseConfig.getAutoCloseMode()
  KnowledgeBaseUtils.emitRuntimeLog('INFO', `【init】读取的 autoCloseMode: ${this.autoCloseMode}`)

  if (!this.lastFrame) {
    this.lastFrame = this.view.frame
  }
  if (!this.currentFrame) {
    this.currentFrame = this.view.frame
  }

  this.view.layer.shadowOffset = {width: 0, height: 0}
  this.view.layer.shadowRadius = 15
  this.view.layer.shadowOpacity = 0.5
  this.view.layer.shadowColor = UIColor.colorWithWhiteAlpha(0.5, 1)
  this.view.layer.cornerRadius = 15
  this.view.layer.opacity = 1.0
  this.view.backgroundColor = UIColor.whiteColor().colorWithAlphaComponent(0.8)
  this.view.layer.borderColor = MNUtil.hexColorAlpha("#9bb2d6", 0.8)
  this.view.layer.borderWidth = 0

  this.highlightColor = UIColor.blendedColor(
    MNUtil.hexColorAlpha("#2c4d81", 0.8),
    MNUtil.app.defaultTextColor,
    0.8
  )

  // 设置图片路径
  this.closeImage = KnowledgeBaseConfig.mainPath + "/close.png"
  this.resizeImage = KnowledgeBaseConfig.mainPath + "/resize.png"
}

knowledgebaseWebController.prototype.getFrameStorageKey = function() {
  if (this.currentHTMLType === 'proof-structure-workbench') {
    return "KB_ProofStructureWorkbenchFrame"
  }
  if (this.currentHTMLType === 'title-refactor-workbench') {
    return "KB_TitleRefactorWorkbenchFrame"
  }
  if (this.currentHTMLType === 'definition-merge-workbench') {
    return "KB_DefinitionMergeWorkbenchFrame"
  }
  if (this.currentHTMLType === 'question-research-workbench') {
    return "KB_QuestionResearchWorkbenchFrame"
  }
  if (this.currentHTMLType === 'template-workbench') {
    return "KB_TemplateWorkbenchFrame"
  }
  if (this.currentHTMLType === 'htmlmd-studio') {
    return "KB_HtmlMDStudioFrame"
  }
  if (this.currentHTMLType === 'comment-manager') {
    return "KB_CommentManagerFrame"
  }
  return "KB_WindowFrame"
}

knowledgebaseWebController.prototype.getDefaultFrameForCurrentHTMLType = function() {
  if (this.currentHTMLType === 'proof-structure-workbench') {
    return { x: 30, y: 35, width: 1120, height: 760 }
  }
  if (this.currentHTMLType === 'title-refactor-workbench') {
    return { x: 30, y: 35, width: 1240, height: 820 }
  }
  if (this.currentHTMLType === 'definition-merge-workbench') {
    return { x: 30, y: 35, width: 1120, height: 760 }
  }
  if (this.currentHTMLType === 'question-research-workbench') {
    return { x: 30, y: 35, width: 1040, height: 760 }
  }
  if (this.currentHTMLType === 'template-workbench') {
    return { x: 40, y: 40, width: 560, height: 720 }
  }
  if (this.currentHTMLType === 'htmlmd-studio') {
    return { x: 30, y: 40, width: 1040, height: 760 }
  }
  if (this.currentHTMLType === 'comment-manager') {
    return { x: 50, y: 50, width: 720, height: 720 }
  }
  return { x: 50, y: 50, width: 420, height: 600 }
}

knowledgebaseWebController.prototype.setCommentManagerAutoRefreshEnabled = function(enabled) {
  this._commentManagerAutoRefreshEnabled = enabled === true
  if (this.currentHTMLType !== 'comment-manager' || !this.webView || !this.webViewLoaded) {
    return false
  }

  const script = `
    (function(enabled) {
      if (!window.Bridge || typeof window.Bridge.setManagedCommentAutoRefreshEnabled !== 'function') {
        return false
      }
      return window.Bridge.setManagedCommentAutoRefreshEnabled(enabled)
    })(${this._commentManagerAutoRefreshEnabled ? 'true' : 'false'})
  `

  this.runJavaScript(script).catch((error) => {
    KnowledgeBaseUtils.addErrorLog(error, 'setCommentManagerAutoRefreshEnabled')
  })
  return true
}

/**
 * 设置面板位置
 */
knowledgebaseWebController.prototype.setFrame = function(frame) {
  if (typeof frame === "object") {
    this.view.frame = frame
  } else if (arguments.length === 4) {
    this.view.frame = MNUtil.genFrame(arguments[0], arguments[1], arguments[2], arguments[3])
  }
  this.currentFrame = this.view.frame
}

/**
 * 显示/隐藏所有按钮
 */
knowledgebaseWebController.prototype.setAllButton = function(hidden) {
  if (this.moveButton) {
    this.moveButton.hidden = hidden
  }
  if (this.closeButton) {
    this.closeButton.hidden = hidden
  }
  if (this.resizeButton) {
    this.resizeButton.hidden = hidden
  }
  if (this.webView) {
    this.webView.hidden = hidden
  }
}

/**
 * 创建按钮辅助方法
 */
knowledgebaseWebController.prototype.createButton = function(buttonName, targetAction, superview) {
  this[buttonName] = UIButton.buttonWithType(0)
  this[buttonName].autoresizingMask = (1 << 0 | 1 << 3)
  this[buttonName].setTitleColorForState(UIColor.whiteColor(), 0)
  this[buttonName].setTitleColorForState(this.highlightColor, 1)
  this[buttonName].backgroundColor = MNUtil.hexColorAlpha("#9bb2d6", 0.8)
  this[buttonName].layer.cornerRadius = 8
  this[buttonName].layer.masksToBounds = true
  this[buttonName].titleLabel.font = UIFont.systemFontOfSize(16)

  if (targetAction) {
    this[buttonName].addTargetActionForControlEvents(this, targetAction, 1 << 6)
  }
  if (superview) {
    this[superview].addSubview(this[buttonName])
  } else {
    this.view.addSubview(this[buttonName])
  }
}

/**
 * 转换到迷你模式
 */
knowledgebaseWebController.prototype.toMinimode = function(frame, lastFrame) {
  if (this.currentHTMLType === 'comment-manager') {
    this.setCommentManagerAutoRefreshEnabled(false)
    this.clearCommentRefreshCoordinator()
  }

  this.miniMode = true
  if (lastFrame) {
    this.lastFrame = lastFrame
  } else {
    this.lastFrame = this.view.frame
  }

  this.currentFrame = this.view.frame

  // 隐藏所有按钮和 WebView
  this.setAllButton(true)

  // 设置背景色
  this.view.layer.borderWidth = 0
  let color = "#9bb2d6"
  this.view.layer.backgroundColor = MNUtil.hexColorAlpha(color, 0.8)
  this.view.layer.borderColor = MNUtil.hexColorAlpha(color, 0.8)

  // 执行动画
  MNUtil.animate(() => {
    this.setFrame(frame)
  }).then(() => {
    // 动画完成后，重新设置 moveButton
    this.moveButton.frame = MNUtil.genFrame(0, 0, 40, 40)
    this.moveButton.hidden = false
    this.moveButton.enabled = true

    // 设置图标并居中
    this.moveButton.setTitleForState("📌", 0)
    this.moveButton.titleLabel.font = UIFont.systemFontOfSize(20)
    this.moveButton.titleLabel.textAlignment = 1

    // 确保按钮在最上层
    this.view.bringSubviewToFront(this.moveButton)
  })
}

/**
 * 从迷你模式恢复
 */
knowledgebaseWebController.prototype.fromMinimode = function() {
  try {
    if (!this.miniMode) return

    // 确保 lastFrame 在屏幕范围内
    let studyFrame = MNUtil.studyView.bounds
    if (this.lastFrame) {
      this.lastFrame.x = MNUtil.constrain(this.lastFrame.x, 0, studyFrame.width - this.lastFrame.width)
      this.lastFrame.y = MNUtil.constrain(this.lastFrame.y, 20, studyFrame.height - this.lastFrame.height - 20)
    } else {
      // 如果没有 lastFrame，使用默认位置
      this.lastFrame = {x: 50, y: 30, width: 720, height: 720}
    }

    // 完全照抄拖拽恢复的代码
    let preOpacity = this.view.layer.opacity
    this.view.layer.opacity = 0
    this.setAllButton(true)
    this.onAnimate = true
    let color = "#9bb2d6"
    this.view.layer.backgroundColor = MNUtil.hexColorAlpha(color, 0.8)
    this.view.layer.borderColor = MNUtil.hexColorAlpha(color, 0.8)

    MNUtil.animate(() => {
      this.view.layer.opacity = preOpacity
      this.setFrame(this.lastFrame.x, this.lastFrame.y, this.lastFrame.width, this.lastFrame.height)
    }).then(() => {
      this.onAnimate = false
      let viewFrame = this.view.bounds
      this.moveButton.frame = {x: viewFrame.width * 0.5 - 75, y: 5, width: 150, height: 10}
      this.view.layer.borderWidth = 0
      this.view.layer.borderColor = MNUtil.hexColorAlpha(color, 0.0)
      this.view.layer.backgroundColor = MNUtil.hexColorAlpha(color, 0.0)
      this.view.hidden = false
      this.setAllButton(false)
      this.moveButton.setTitleForState("", 0)
      if (this.currentHTMLType === 'comment-manager') {
        this.setCommentManagerAutoRefreshEnabled(true)
        const managedNote = global.MNKnowledgeBaseInstance && global.MNKnowledgeBaseInstance.currentManagedNote
        if (managedNote && managedNote.noteId) {
          this.loadCommentData(managedNote.noteId, {
            reason: 'restore-from-minimode',
          })
        }
      }
    })
    this.miniMode = false

    // 确保视图在最前面
    MNUtil.studyView.bringSubviewToFront(this.view)
  } catch (error) {
    // 确保重置状态，防止界面卡死
    this.onAnimate = false
    this.miniMode = false
    MNUtil.showHUD("恢复正常模式失败")
    MNUtil.copyJSON(error)
  }
}


// ========================================
// 对卡片进行操作
// ========================================

knowledgebaseWebController.prototype.removeMissingSearchCardIndex = async function(noteId, reason = "htmlAction.noteMissing", options = {}) {
  try {
    const normalizedId = normalizeNoteIdValue(noteId)
    if (!normalizedId) return null
    if (!global.MNKnowledgeBaseInstance || typeof global.MNKnowledgeBaseInstance.removeSearchCardIndex !== "function") {
      return null
    }
    return await global.MNKnowledgeBaseInstance.removeSearchCardIndex(normalizedId, {
      showHUD: options.showHUD === true,
      refreshRequestId: options.refreshRequestId || "",
      reason,
    })
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "removeMissingSearchCardIndex")
    return null
  }
}

/**
 * 定位卡片到脑图
 * @param {string} noteId - 卡片 ID
 */
knowledgebaseWebController.prototype.focusCardInMindMap = async function(noteId) {
  try {
    if (!noteId) {
      MNUtil.showHUD("缺少卡片 ID")
      return false
    }

    let note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "focusCardInMindMap.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return false
    }

    // 聚焦到卡片
    note.focusInMindMap()

    MNUtil.showHUD("已定位到主脑图")
    return true
  } catch (error) {
    MNUtil.showHUD("定位失败：" + error)
    MNUtil.copyJSON(error)
    return false
  }
}

/**
 * 聚焦卡片到浮窗
 * @param {string} noteId - 卡片 ID
 */
knowledgebaseWebController.prototype.focusCardInFloatMindMap = async function(noteId) {
  try {
    if (!noteId) {
      MNUtil.showHUD("缺少卡片 ID")
      return false
    }

    let note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "focusCardInFloatMindMap.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return false
    }

    // 聚焦到卡片
    note.focusInFloatMindMap()

    MNUtil.showHUD("已定位到浮窗")
    return true

  } catch (error) {
    MNUtil.showHUD("文档定位失败：" + error)
    return false
  }
}

/**
 * 定位当前卡片「第一条摘录评论」（如果有）到文档中
 * 优先从 merged* 摘录评论获取源笔记，再打开对应 PDF 页
 * @param {string} noteId - 卡片 ID
 */
knowledgebaseWebController.prototype.focusFirstExcerptInDocument = async function(noteId) {
  try {
    if (!noteId) {
      MNUtil.showHUD("缺少卡片 ID")
      return false
    }

    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "focusFirstExcerptInDocument.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return false
    }

    const excerptCommentTypes = new Set([
      "mergedImageComment",
      "mergedImageCommentWithDrawing",
      "mergedTextComment",
      "mergedMarkdownComment",
    ])

    let sourceNote = null
    let sourceCommentType = null

    const comments = note.comments || []
    for (const comment of comments) {
      if (!comment) continue

      let commentType = comment.type
      try {
        if (typeof MNComment !== "undefined" && typeof MNComment.getCommentType === "function") {
          commentType = MNComment.getCommentType(comment)
        }
      } catch (_) {
        // ignore
      }

      if (!excerptCommentTypes.has(commentType)) continue

      const sourceNoteId = comment.noteid || comment.noteId
      if (!sourceNoteId) continue

      const candidate = MNNote.new(sourceNoteId)
      if (candidate && candidate.docMd5) {
        sourceNote = candidate
        sourceCommentType = commentType
        break
      }
    }

    // 兜底：若当前卡片本身就是摘录笔记，也尝试直接定位
    if (!sourceNote && note.docMd5) {
      sourceNote = note
      sourceCommentType = "self"
    }

    if (!sourceNote || !sourceNote.docMd5) {
      MNUtil.showHUD("未找到摘录评论，无法定位到文档")
      return false
    }

    const docMd5 = sourceNote.docMd5

    // 从 excerptPic 获取页码（pageNo 为 1-based）
    let pageIndex = 0
    try {
      const excerptPic = sourceNote.excerptPic
      if (excerptPic && excerptPic.selLst && excerptPic.selLst.length > 0) {
        pageIndex = excerptPic.selLst[0].pageNo - 1
        if (pageIndex < 0) pageIndex = 0
      }
    } catch (_) {
      // ignore
    }

    // 打开文档（如果不是当前文档）
    if (docMd5 !== MNUtil.currentDocmd5) {
      MNUtil.openDoc(docMd5)
      // 如果当前是纯脑图模式，切换到分割模式
      if (MNUtil.docMapSplitMode === 0) {
        MNUtil.docMapSplitMode = 1
      }
      // 等待文档加载（经验值：过短会导致 setPageAtIndex 失败）
      await MNUtil.delay(0.5)
    }

    // 跳转到指定页面
    const docController = MNUtil.currentDocController
    if (docController) {
      // 页码范围校验/修正
      try {
        const doc = docController.document
        if (doc && Number.isFinite(doc.pageCount)) {
          const lastPageIndex = Math.max(0, doc.pageCount - 1)
          if (pageIndex > lastPageIndex) pageIndex = lastPageIndex
        }
      } catch (_) {
        // ignore
      }

      if (!Number.isFinite(pageIndex) || pageIndex < 0) pageIndex = 0
      if (docController.currPageIndex !== pageIndex) {
        docController.setPageAtIndex(pageIndex)
      }
    }

    if (sourceCommentType === "self") {
      MNUtil.showHUD(`已定位到文档：第 ${pageIndex + 1} 页`)
    } else {
      MNUtil.showHUD(`已定位到摘录：第 ${pageIndex + 1} 页`)
    }
    return true
  } catch (error) {
    MNUtil.showHUD("定位文档失败：" + error)
    MNUtil.copyJSON(error)
    return false
  }
}

/**
 * 复制行内链接
 * @param {string} noteId - 卡片 ID
 */
knowledgebaseWebController.prototype.copyMarkdownLink = async function(noteId) {
  try {
    if (!noteId) {
      MNUtil.showHUD("缺少卡片 ID")
      return false
    }

    let note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "copyMarkdownLink.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return false
    }

    KnowledgeBaseTemplate.copyMarkdownLinkWithQuickPhrases(note)
    return true
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'copyMarkdownLink')
    return false
  }
}

/**
 * 复制卡片 URL
 * @param {string} noteId - 卡片 ID
 */
knowledgebaseWebController.prototype.copyNoteURL = async function(noteId) {
  try {
    if (!noteId) {
      MNUtil.showHUD("缺少卡片 ID")
      return
    }

    let note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "copyNoteURL.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    MNUtil.copy(note.noteURL)
    MNUtil.showHUD("已复制卡片 URL", 0.5)
  } catch (error) {
    MNUtil.showHUD("复制失败：" + error)
    KnowledgeBaseUtils.addErrorLog(error, "copyNoteURL")
  }
}

// ========================================
// 数据刷新方法（供外部调用）
// ========================================

/**
 * 刷新主知识库数据
 * 调用 main.js 中的 loadSearchDataToWebView 方法
 */
knowledgebaseWebController.prototype.refreshKnowledgeData = async function(options = {}) {
  const {
    showErrorHUD = true,
  } = options || {}

  try {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== refreshKnowledgeData 开始执行 ===")

    // 调用 main.js 中的数据加载方法（注意使用 global 前缀访问）
    if (typeof global.MNKnowledgeBaseInstance !== 'undefined' && global.MNKnowledgeBaseInstance.loadSearchDataToWebView) {
      const result = await global.MNKnowledgeBaseInstance.loadSearchDataToWebView(options)
      if (!result || result.success !== false) {
        KnowledgeBaseUtils.emitRuntimeLog('INFO', "主知识库数据刷新成功")
      } else {
        KnowledgeBaseUtils.emitRuntimeLog('ERROR', "主知识库数据刷新失败: " + (result.error || result.reason || "未知错误"))
      }
      return result && typeof result === 'object'
        ? result
        : { success: true }
    } else {
      const errorMessage = "MNKnowledgeBaseInstance 或 loadSearchDataToWebView 方法不存在"
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "错误: " + errorMessage)
      if (showErrorHUD) {
        MNUtil.showHUD("刷新主知识库数据失败：" + errorMessage)
      }
      return {
        success: false,
        error: errorMessage,
      }
    }
  } catch (error) {
    KnowledgeBaseUtils.emitRuntimeLog('ERROR', "refreshKnowledgeData 发生错误: " + error)
    if (showErrorHUD) {
      MNUtil.showHUD("刷新主知识库数据失败：" + error)
    }
    KnowledgeBaseUtils.addErrorLog(error, "refreshKnowledgeData")
    return {
      success: false,
      error: error && error.message ? error.message : String(error),
    }
  }
}

/**
 * 刷新所有知识库数据（主知识库 + 中间知识库，已合并）
 * 这是推荐的统一刷新接口
 */
knowledgebaseWebController.prototype.refreshAllData = async function(options = {}) {
  const {
    showErrorHUD = true,
  } = options || {}

  try {
    KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== refreshAllData 开始执行 ===")

    // 只需刷新主知识库，其中已包含中间知识库数据
    const result = await this.refreshKnowledgeData(options)

    if (!result || result.success !== false) {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== refreshAllData 执行完成 ===")
    } else {
      KnowledgeBaseUtils.emitRuntimeLog('INFO', "=== refreshAllData 执行失败 ===")
    }
    return result && typeof result === 'object'
      ? result
      : { success: true }
  } catch (error) {
    KnowledgeBaseUtils.emitRuntimeLog('ERROR', "refreshAllData 发生错误: " + error)
    if (showErrorHUD) {
      MNUtil.showHUD("刷新数据失败：" + error)
    }
    KnowledgeBaseUtils.addErrorLog(error, "refreshAllData")
    return {
      success: false,
      error: error && error.message ? error.message : String(error),
    }
  }
}

// ========================================
// 评论管理器 Bridge 方法实现
// ========================================

/**
 * 加载指定卡片的评论数据
 * @param {string} noteId - 卡片ID
 */
knowledgebaseWebController.prototype.getCommentDataSignature = function(commentData) {
  try {
    const comments = Array.isArray(commentData && commentData.comments) ? commentData.comments : []
    return JSON.stringify({
      noteId: commentData && commentData.noteId ? String(commentData.noteId) : '',
      noteTitle: commentData && commentData.noteTitle ? String(commentData.noteTitle) : '',
      comments: comments.map((comment) => ({
        index: comment && comment.index,
        originalType: comment && comment.originalType,
        type: comment && comment.type,
        detailedType: comment && comment.detailedType,
        text: comment && comment.text ? String(comment.text) : '',
        htmlText: comment && comment.htmlText ? String(comment.htmlText) : '',
        image: comment && comment.imageBase64 ? `${String(comment.imageBase64).length}:${String(comment.imageBase64).slice(0, 32)}` : '',
        mediaHash: comment && comment.mediaHash ? String(comment.mediaHash) : '',
        drawingHash: comment && comment.drawingHash ? String(comment.drawingHash) : '',
        drawingPreview: comment && comment.drawingPreviewDataURI
          ? `${String(comment.drawingPreviewDataURI).length}:${String(comment.drawingPreviewDataURI).slice(0, 40)}`
          : '',
        drawingPreviewPending: comment && comment.drawingPreviewPending === true,
        drawingPreviewError: comment && comment.drawingPreviewError ? String(comment.drawingPreviewError) : '',
        linkedNoteId: comment && comment.linkedNoteId ? String(comment.linkedNoteId) : '',
        linkedNoteTitle: comment && comment.linkedNoteTitle ? String(comment.linkedNoteTitle) : '',
        markdownLinks: Array.isArray(comment && comment.markdownLinks)
          ? comment.markdownLinks.map((link) => [link.displayText || '', link.url || '', link.noteId || ''])
          : [],
      })),
    })
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "getCommentDataSignature")
    return `${Date.now()}`
  }
}

knowledgebaseWebController.prototype.coordinateHandwritingPreviewRefresh = function(noteId, commentData) {
  const normalizedNoteId = noteId == null ? '' : String(noteId).trim()
  const pendingCount = Number(commentData && commentData.handwritingPendingCount || 0)
  let current = this._handwritingPreviewRetry
  if (current && current.noteId !== normalizedNoteId) {
    this._handwritingPreviewRetry = null
    current = null
  }

  if (pendingCount <= 0) {
    if (current && current.noteId === normalizedNoteId) {
      this._handwritingPreviewRetry = null
      MNUtil.showHUD('手写内容转换完成，当前页面已自动刷新')
    }
    return
  }
  if (!normalizedNoteId || this.currentHTMLType !== 'comment-manager') return

  let retry = current
  if (!retry || retry.noteId !== normalizedNoteId) {
    retry = { noteId: normalizedNoteId, attempts: 0, scheduled: false }
    this._handwritingPreviewRetry = retry
    MNUtil.showHUD('手写内容正在转换，请稍候')
  }
  if (retry.scheduled) return
  if (retry.attempts >= KB_HANDWRITING_RETRY_LIMIT) {
    this._handwritingPreviewRetry = null
    MNUtil.showHUD('手写内容仍在转换，请稍后点击刷新')
    return
  }

  retry.scheduled = true
  NSTimer.scheduledTimerWithTimeInterval(KB_HANDWRITING_RETRY_INTERVAL, false, () => {
    if (this._handwritingPreviewRetry !== retry || this.currentHTMLType !== 'comment-manager') return
    retry.scheduled = false
    retry.attempts += 1
    this.loadCommentData(normalizedNoteId, {
      force: true,
      skipIfUnchanged: false,
      silent: true,
      reason: 'handwriting-preview-retry',
    })
  })
}

knowledgebaseWebController.prototype.getCommentDataRevision = function(note) {
  try {
    if (typeof global.MNKnowledgeBaseInstance !== "undefined" &&
      global.MNKnowledgeBaseInstance &&
      typeof global.MNKnowledgeBaseInstance.getCommentRevisionForManager === "function") {
      return global.MNKnowledgeBaseInstance.getCommentRevisionForManager(note)
    }

    const rawComments = note && Array.isArray(note.comments) ? note.comments : []
    return JSON.stringify({
      noteId: note && note.noteId ? String(note.noteId) : "",
      noteTitle: note && (note.noteTitle || note.title) ? String(note.noteTitle || note.title) : "",
      comments: rawComments.map((comment, index) => ({
        index,
        type: comment && comment.type,
        text: comment && (comment.text || comment.html || comment.q_htext || ""),
        paint: comment && (comment.paint || comment.drawing || ""),
        mergedPaint: comment && comment.q_hpic
          ? (comment.q_hpic.paint || comment.q_hpic.drawing || "")
          : "",
        note: comment && comment.note,
      })),
    })
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "getCommentDataRevision")
    return ""
  }
}

knowledgebaseWebController.prototype.notifyCommentMutationComplete = async function(payload = {}) {
  try {
    const script = `(
      window.Bridge && typeof window.Bridge.completeAction === "function"
        ? window.Bridge.completeAction(${JSON.stringify(payload)})
        : null
    )`
    return await this.runJavaScript(script)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'notifyCommentMutationComplete')
    return null
  }
}

knowledgebaseWebController.prototype.notifyResearchWorkbenchActionComplete = async function(payload = {}) {
  try {
    if (this.currentHTMLType !== 'question-research-workbench' || !this.webViewLoaded) return null
    const script = `(
      window.Bridge && typeof window.Bridge.completeAction === "function"
        ? window.Bridge.completeAction(${JSON.stringify(payload)})
        : null
    )`
    return await this.runJavaScript(script)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'notifyResearchWorkbenchActionComplete')
    return null
  }
}

knowledgebaseWebController.prototype.notifyDefinitionMergeActionComplete = async function(payload = {}) {
  try {
    if (this.currentHTMLType !== 'definition-merge-workbench' || !this.webViewLoaded) return null
    const script = `(
      window.Bridge && typeof window.Bridge.completeDefinitionMergeAction === "function"
        ? window.Bridge.completeDefinitionMergeAction(${JSON.stringify(payload)})
        : null
    )`
    return await this.runJavaScript(script)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'notifyDefinitionMergeActionComplete')
    return null
  }
}

knowledgebaseWebController.prototype.mergeCommentRefreshRequest = function(noteId, options = {}) {
  const normalizedNoteId = noteId === undefined || noteId === null ? "" : String(noteId).trim()
  if (!normalizedNoteId) return null

  const previous = this._commentPendingRefresh
  const sameNote = previous && previous.noteId === normalizedNoteId
  this._commentPendingRefresh = {
    noteId: normalizedNoteId,
    options: {
      ...(sameNote ? previous.options : {}),
      ...options,
      force: options.force === true || !!(sameNote && previous.options && previous.options.force),
      showLoadedFeedback: options.showLoadedFeedback === true || !!(
        sameNote && previous.options && previous.options.showLoadedFeedback
      ),
      reason: options.reason || (sameNote && previous.options && previous.options.reason) || "refresh",
    },
  }
  return this._commentPendingRefresh
}

knowledgebaseWebController.prototype.clearCommentRefreshCoordinator = function() {
  this._commentRefreshGeneration = Number(this._commentRefreshGeneration || 0) + 1
  this._commentPendingRefresh = null
  this._handwritingPreviewRetry = null
}

knowledgebaseWebController.prototype.loadCommentData = function(noteId, options = {}) {
  const request = this.mergeCommentRefreshRequest(noteId, options)
  if (!request) return Promise.resolve({ success: false, reason: "missing-note-id" })
  if (this._commentRefreshDrainPromise) return this._commentRefreshDrainPromise

  const drain = async () => {
    let lastResult = { success: false, reason: "no-refresh" }
    while (this._commentPendingRefresh) {
      const nextRequest = this._commentPendingRefresh
      this._commentPendingRefresh = null
      lastResult = await this._loadCommentDataOnce(nextRequest.noteId, nextRequest.options)
    }
    return lastResult
  }

  const currentDrain = drain()
  this._commentRefreshDrainPromise = currentDrain
  const clearDrain = () => {
    if (this._commentRefreshDrainPromise === currentDrain) {
      this._commentRefreshDrainPromise = null
    }
    if (this._commentPendingRefresh && !this._commentRefreshDrainPromise) {
      this.loadCommentData(this._commentPendingRefresh.noteId, this._commentPendingRefresh.options)
    }
  }
  currentDrain.then(clearDrain, clearDrain)
  return currentDrain
}

knowledgebaseWebController.prototype._loadCommentDataOnce = async function(noteId, options = {}) {
  try {
    KnowledgeBaseUtils.log("开始执行", "loadCommentData")
    KnowledgeBaseUtils.log("noteId: " + noteId, "loadCommentData")

    const refreshGeneration = Number(this._commentRefreshGeneration || 0)

    // 获取卡片
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "loadCommentData.noteMissing")
      if (options.silent !== true) {
        MNUtil.showHUD("未找到卡片，已从索引移除")
      }
      return
    }

    // 调用 main.js 中的数据准备方法
    if (typeof global.MNKnowledgeBaseInstance !== 'undefined' &&
        global.MNKnowledgeBaseInstance.prepareCommentDataForManager) {
      const revision = this.getCommentDataRevision(note)
      const revisionMap = this._commentLastRevisionByNote || (this._commentLastRevisionByNote = {})
      const shouldSkipIfUnchanged = options.force !== true
        && options.skipIfUnchanged !== false
        && this.currentHTMLType === "comment-manager"
      if (shouldSkipIfUnchanged && revision && revisionMap[noteId] === revision) {
        return { success: true, changed: false, revision }
      }

      const requestId = Number(this._commentRefreshSequence || 0) + 1
      this._commentRefreshSequence = requestId
      const commentData = global.MNKnowledgeBaseInstance.prepareCommentDataForManager(note, {
        revision,
        requestId,
        reason: options.reason || "refresh",
        showLoadedFeedback: options.showLoadedFeedback === true,
        forceApply: options.force === true,
      })

      if (commentData) {
        if (refreshGeneration !== Number(this._commentRefreshGeneration || 0)) {
          return { success: false, cancelled: true, revision, requestId }
        }

        const dataJson = JSON.stringify(commentData)
        const script = `(
          window.Bridge && typeof window.Bridge.loadCommentData === "function"
            ? window.Bridge.loadCommentData(${dataJson})
            : loadDataFromNative(${dataJson})
        )`
        const pushResult = await this.runJavaScript(script)
        const rejected = pushResult && typeof pushResult === "object" && pushResult.accepted === false
        if (rejected) {
          return {
            success: false,
            rejected: true,
            requestId,
            revision,
            result: pushResult,
          }
        }

        revisionMap[noteId] = revision
        this.lastCommentDataSignature = this.getCommentDataSignature(commentData)
        this.coordinateHandwritingPreviewRefresh(noteId, commentData)

        KnowledgeBaseUtils.log("评论数据已发送到 HTML 端", "loadCommentData")
        return {
          success: true,
          changed: true,
          requestId,
          revision,
          result: pushResult,
        }
      } else {
        if (options.silent !== true) {
          MNUtil.showHUD("准备评论数据失败")
        }
      }
    } else {
      KnowledgeBaseUtils.log("错误: MNKnowledgeBaseInstance 或 prepareCommentDataForManager 方法不存在", "loadCommentData")
      if (options.silent !== true) {
        MNUtil.showHUD("插件实例未就绪")
      }
    }
    return { success: false, reason: "comment-data-unavailable" }
  } catch (error) {
    KnowledgeBaseUtils.log("发生错误: " + error.message, "loadCommentData")
    if (options.silent !== true) {
      MNUtil.showHUD("加载评论数据失败：" + error)
    }
    KnowledgeBaseUtils.addErrorLog(error, "loadCommentData")
    return {
      success: false,
      error: error && error.message ? error.message : String(error),
    }
  }
}

knowledgebaseWebController.prototype.loadTemplateWorkbenchData = async function(noteId) {
  try {
    KnowledgeBaseUtils.log("开始执行", "loadTemplateWorkbenchData", { noteId })
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "loadTemplateWorkbenchData.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return false
    }

    const payload = {
      noteId: note.noteId || "",
      noteTitle: note.noteTitle || note.title || "",
      noteType: KnowledgeBaseTemplate.getNoteType(note) || "",
      baseTitle: KnowledgeBaseTemplate.getTemplateChainBaseTitle(note),
    }
    const script = `loadTemplateWorkbenchData(${JSON.stringify(payload)})`
    await this.runJavaScript(script)
    KnowledgeBaseUtils.log("模板工作台数据已发送到 HTML 端", "loadTemplateWorkbenchData", payload)
    return true
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "loadTemplateWorkbenchData")
    MNUtil.showHUD("加载模板工作台数据失败：" + (error.message || error))
    return false
  }
}

knowledgebaseWebController.prototype.loadTitleRefactorWorkbenchData = async function(noteId) {
  try {
    if (this.currentHTMLType !== 'title-refactor-workbench' || !this.webViewLoaded) {
      return { success: false, reason: 'workbench-not-ready' }
    }
    const instance = global.MNKnowledgeBaseInstance
    if (!instance || typeof instance.prepareTitleRefactorWorkbenchData !== 'function') {
      return { success: false, reason: 'data-provider-unavailable' }
    }
    const payload = instance.prepareTitleRefactorWorkbenchData(noteId)
    if (payload && payload.tooLarge) {
      return {
        success: false,
        reason: 'payload-too-large',
        limit: payload.limit,
        discovered: payload.discovered,
      }
    }
    if (!payload || !Array.isArray(payload.cards) || payload.cards.length === 0) {
      return { success: false, reason: 'empty-payload' }
    }
    const script = `(
      typeof window.loadTitleRefactorWorkbenchData === "function"
        ? window.loadTitleRefactorWorkbenchData(${JSON.stringify(payload)})
        : false
    )`
    // A wedged WebView must not keep the native action pending forever. The
    // panel can be retried after it finishes loading; the caller will close the
    // blank surface and show a recoverable HUD on timeout.
    const applied = await Promise.race([
      this.runJavaScript(script),
      MNUtil.delay(5).then(() => '__title_refactor_webview_timeout__'),
    ])
    if (applied === '__title_refactor_webview_timeout__') {
      return { success: false, reason: 'webview-timeout' }
    }
    if (applied !== true && Number(applied) !== 1) {
      return { success: false, reason: 'webview-rejected-payload', payload }
    }
    return { success: true, payload }
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadTitleRefactorWorkbenchData')
    return { success: false, error: error && error.message ? error.message : String(error) }
  }
}

knowledgebaseWebController.prototype.loadResearchWorkbenchData = async function(noteId, options = {}) {
  try {
    if (this.currentHTMLType !== 'question-research-workbench' || !this.webViewLoaded) {
      return { success: false, reason: 'workbench-not-ready' }
    }
    const note = MNNote.new(noteId, false)
    if (!note) {
      MNUtil.showHUD('问题研究工作台目标卡片不存在')
      return { success: false, reason: 'note-missing' }
    }
    const instance = global.MNKnowledgeBaseInstance
    if (!instance || typeof instance.prepareResearchWorkbenchData !== 'function') {
      return { success: false, reason: 'data-provider-unavailable' }
    }
    const payload = instance.prepareResearchWorkbenchData(note, {
      forceApply: options.forceApply === true,
    })
    if (!payload) return { success: false, reason: 'empty-payload' }
    const script = `(
      typeof window.loadResearchWorkbenchData === "function"
        ? window.loadResearchWorkbenchData(${JSON.stringify(payload)}, ${options.preserveDrafts === true ? 'true' : 'false'})
        : false
    )`
    await this.runJavaScript(script)
    return { success: true, payload }
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadResearchWorkbenchData')
    return { success: false, error: error && error.message ? error.message : String(error) }
  }
}

knowledgebaseWebController.prototype.loadDefinitionMergeWorkbenchData = async function(sourceNoteId, targetNoteId) {
  try {
    if (this.currentHTMLType !== 'definition-merge-workbench' || !this.webViewLoaded) {
      return { success: false, reason: 'workbench-not-ready' }
    }
    const instance = global.MNKnowledgeBaseInstance
    if (!instance || typeof instance.prepareDefinitionMergeWorkbenchData !== 'function') {
      return { success: false, reason: 'data-provider-unavailable' }
    }
    const payload = instance.prepareDefinitionMergeWorkbenchData(sourceNoteId, targetNoteId)
    if (!payload) return { success: false, reason: 'empty-payload' }
    const script = `(
      typeof window.loadDefinitionMergeWorkbenchData === "function"
        ? window.loadDefinitionMergeWorkbenchData(${JSON.stringify(payload)})
        : false
    )`
    const applied = await this.runJavaScript(script)
    if (applied !== true && Number(applied) !== 1) {
      return { success: false, reason: 'webview-rejected-payload', payload }
    }
    return { success: payload.canExecute === true, payload }
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadDefinitionMergeWorkbenchData')
    return { success: false, error: error && error.message ? error.message : String(error) }
  }
}

knowledgebaseWebController.prototype.loadProofStructureWorkbenchData = async function(noteId, fieldName, options = {}) {
  try {
    if (this.currentHTMLType !== 'proof-structure-workbench' || !this.webViewLoaded) {
      return { success: false, reason: 'workbench-not-ready' }
    }
    const instance = global.MNKnowledgeBaseInstance
    if (!instance || typeof instance.prepareProofStructureWorkbenchData !== 'function') {
      return { success: false, reason: 'data-provider-unavailable' }
    }
    const context = instance.currentProofStructureContext
    const isCurrent = () => this.currentHTMLType === 'proof-structure-workbench'
      && instance.currentProofStructureContext === context
      && context && context.noteId === noteId && context.fieldName === fieldName
      && !(this.view && this.view.hidden)
    if (!isCurrent()) return { success: false, reason: 'stale-proof-context' }
    const requestId = (Number(this._proofStructureLoadRequestId) || 0) + 1
    this._proofStructureLoadRequestId = requestId
    const payload = instance.prepareProofStructureWorkbenchData(noteId, fieldName)
    if (!payload) return { success: false, reason: 'invalid-proof-field' }
    payload.requestId = requestId
    const pending = payload.comments.some(comment => comment.drawingPreviewPending === true)
    let retry = this._proofHandwritingRetry
    if (!retry || retry.context !== context || options.retry !== true) {
      retry = { context, attempts: 0, scheduled: false }
      this._proofHandwritingRetry = retry
    }
    if (pending && retry.attempts >= KB_HANDWRITING_RETRY_LIMIT) {
      payload.handwritingRetryExhausted = true
      payload.comments = payload.comments.map(comment => comment.drawingPreviewPending
        ? Object.assign({}, comment, { drawingPreviewPending: false, drawingPreviewError: 'conversion-timeout' })
        : comment)
    }
    const script = `(
      typeof window.loadProofStructureWorkbenchData === "function"
        ? window.loadProofStructureWorkbenchData(${JSON.stringify(payload)})
        : false
    )`
    const applied = await this.runJavaScript(script)
    if (!isCurrent() || this._proofStructureLoadRequestId !== requestId) {
      return { success: false, reason: 'stale-proof-response' }
    }
    if (applied !== true && Number(applied) !== 1) {
      return { success: false, reason: 'webview-rejected-payload' }
    }
    if (pending && !payload.handwritingRetryExhausted && !retry.scheduled) {
      retry.scheduled = true
      NSTimer.scheduledTimerWithTimeInterval(KB_HANDWRITING_RETRY_INTERVAL, false, () => {
        if (this._proofHandwritingRetry !== retry) return
        if (!isCurrent()) { this._proofHandwritingRetry = null; return }
        retry.scheduled = false
        retry.attempts += 1
        return this.loadProofStructureWorkbenchData(noteId, fieldName, { retry: true })
      })
    } else if (!pending || payload.handwritingRetryExhausted) {
      this._proofHandwritingRetry = null
    }
    return { success: true, payload }
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, 'loadProofStructureWorkbenchData')
    return { success: false, error: error && error.message ? error.message : String(error) }
  }
}

knowledgebaseWebController.prototype.applyHtmlMDCommentUpdates = async function(noteId, updates) {
  try {
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "applyHtmlMDCommentUpdates.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    const normalizedUpdates = (Array.isArray(updates) ? updates : [])
      .map((item) => {
        const index = parseInt(item && item.index, 10)
        const text = item && item.text !== undefined && item.text !== null ? String(item.text) : ""
        return {
          index,
          text,
        }
      })
      .filter((item) => !isNaN(item.index))

    if (normalizedUpdates.length === 0) {
      MNUtil.showHUD("没有可更新的评论")
      return
    }

    const normalizeHtmlMDText = (rawText) => {
      const text = typeof rawText === "string" ? rawText : String(rawText || "")
      return text.replace(/\r?\n/g, "&#10;").trim()
    }

    const isTextLikeRawComment = (rawComment) => {
      if (!rawComment || !rawComment.type) return false
      return rawComment.type === "TextNote"
    }

    const isHtmlMDString = (text) => {
      if (!text) return false
      const normalized = String(text).trim()
      return normalized.startsWith("<span") || normalized.startsWith("- <span")
    }

    const sameHtmlMDText = (left, right) => {
      return normalizeHtmlMDText(left) === normalizeHtmlMDText(right)
    }

    const rebuildCommentAtIndex = (targetIndex, htmlText) => {
      note.removeCommentByIndex(targetIndex)
      note.appendMarkdownComment(htmlText)
      const insertedIndex = note.comments.length - 1
      if (insertedIndex !== targetIndex) {
        note.moveComment(insertedIndex, targetIndex)
      }
      const rebuilt = note.MNComments[targetIndex]
      return rebuilt && sameHtmlMDText(rebuilt.text, htmlText)
    }

    const applySingleUpdate = (item) => {
      const targetIndex = item.index
      const htmlText = normalizeHtmlMDText(item.text)
      const rawComment = note.comments[targetIndex]
      const comment = note.MNComments[targetIndex]

      if (!comment || !rawComment) {
        return { ok: false, index: targetIndex, reason: "missing" }
      }

      if (!isTextLikeRawComment(rawComment)) {
        return { ok: false, index: targetIndex, reason: "unsupported_type", rawType: rawComment.type }
      }

      if (!isHtmlMDString(htmlText)) {
        return { ok: false, index: targetIndex, reason: "invalid_htmlmd" }
      }

      try {
        comment.text = htmlText
        if (sameHtmlMDText(comment.text, htmlText)) {
          return { ok: true, index: targetIndex, mode: "direct" }
        }
      } catch (error) {
        KnowledgeBaseUtils.log("HtmlMD 直接写回失败，尝试重建", "applyHtmlMDCommentUpdates", {
          index: targetIndex,
          error: error.message || String(error),
        })
      }

      const rebuilt = rebuildCommentAtIndex(targetIndex, htmlText)
      if (rebuilt) {
        return { ok: true, index: targetIndex, mode: "rebuild" }
      }

      return { ok: false, index: targetIndex, reason: "verify_failed" }
    }

    let results = []
    MNUtil.undoGrouping(() => {
      results = normalizedUpdates.map(applySingleUpdate)
      note.refresh()
    })

    const successCount = results.filter((item) => item.ok).length
    const rebuildCount = results.filter((item) => item.ok && item.mode === "rebuild").length
    const failed = results.filter((item) => !item.ok)

    KnowledgeBaseUtils.log("HtmlMD 评论更新结果", "applyHtmlMDCommentUpdates", {
      noteId,
      total: normalizedUpdates.length,
      successCount,
      rebuildCount,
      failed,
    })

    if (successCount === 0) {
      MNUtil.showHUD("HtmlMD 更新失败")
      return
    }

    const summary = rebuildCount > 0
      ? `已更新 ${successCount} 条评论（${rebuildCount} 条走重建）`
      : `已更新 ${successCount} 条评论`
    MNUtil.showHUD(summary)

    if (failed.length > 0) {
      KnowledgeBaseUtils.log("部分 HtmlMD 评论更新失败", "applyHtmlMDCommentUpdates", failed)
    }

    await this.loadCommentData(noteId)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "applyHtmlMDCommentUpdates")
    MNUtil.showHUD("应用 HtmlMD 更新失败：" + error.message)
  }
}

knowledgebaseWebController.prototype.appendHtmlMDComment = async function(noteId, text) {
  try {
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "appendHtmlMDComment.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    const nextText = (typeof text === "string" ? text : String(text || "")).replace(/\r?\n/g, "&#10;").trim()
    if (!nextText.trim()) {
      MNUtil.showHUD("评论内容为空")
      return
    }
    if (!(nextText.startsWith("<span") || nextText.startsWith("- <span"))) {
      MNUtil.showHUD("不是有效的 HtmlMD 内容")
      return
    }

    MNUtil.undoGrouping(() => {
      note.appendMarkdownComment(nextText)
      if (global.MNKnowledgeBaseInstance) {
        global.MNKnowledgeBaseInstance.currentHtmlMDStudioFocusIndex = note.comments.length - 1
      }
      note.refresh()
    })

    KnowledgeBaseUtils.log("已新增 HtmlMD 评论", "appendHtmlMDComment", {
      noteId,
      textLength: nextText.length,
    })
    MNUtil.showHUD("已新增 HtmlMD 评论")
    await this.loadCommentData(noteId)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "appendHtmlMDComment")
    MNUtil.showHUD("新增 HtmlMD 评论失败：" + error.message)
  }
}

knowledgebaseWebController.prototype.mergeInlineLinkComments = async function(noteId, indexArr, finalText) {
  try {
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "mergeInlineLinkComments.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    const sortedIndices = Array.from(new Set(normalizeIndexArray(indexArr))).sort((a, b) => a - b)
    if (sortedIndices.length < 2) {
      MNUtil.showHUD("合并失败：请连续选择至少 2 条评论")
      return
    }

    for (let i = 1; i < sortedIndices.length; i++) {
      if (sortedIndices[i] !== sortedIndices[i - 1] + 1) {
        MNUtil.showHUD("合并失败：只支持连续选择")
        return
      }
    }

    const markdownText = typeof finalText === "string" ? finalText.trim() : ""
    if (!markdownText) {
      MNUtil.showHUD("合并失败：内容为空")
      return
    }

    const mergeableTypes = new Set([
      "textComment",
      "markdownComment",
      "mergedTextComment",
      "mergedMarkdownComment",
      "linkComment",
      "summaryComment",
    ])
    const currentComments = note.MNComments || []
    const unsupported = sortedIndices.find(index => {
      const comment = currentComments[index]
      return !comment || !mergeableTypes.has(comment.type)
    })
    if (unsupported !== undefined) {
      const comment = currentComments[unsupported]
      MNUtil.showHUD(`合并失败：#${unsupported} 类型不支持${comment ? " (" + comment.type + ")" : ""}`)
      return
    }

    const extractMarginNoteLinksFromMarkdown = (text) => {
      if (typeof KnowledgeBaseTemplate.parseMarkdownMarginNoteLinksFromText === "function") {
        return KnowledgeBaseTemplate.parseMarkdownMarginNoteLinksFromText(text).map(link => ({
          url: link.url,
          noteId: link.noteId,
        }))
      }
      const links = []
      const seen = new Set()
      const regex = /\[[^\]]+?\]\((marginnote[34]app:\/\/note\/[^)\s]+)\)/g
      let match
      while ((match = regex.exec(text)) !== null) {
        const url = match[1]
        const noteIdFromUrl = KnowledgeBaseTemplate.extractNoteIdFromLinkUrl(url)
        if (!noteIdFromUrl || seen.has(noteIdFromUrl)) continue
        seen.add(noteIdFromUrl)
        links.push({ url, noteId: noteIdFromUrl })
      }
      return links
    }

    const getBroadProofFieldForIndex = (targetIndex) => {
      const parsed = KnowledgeBaseTemplate.parseNoteComments(note)
      const fields = parsed && Array.isArray(parsed.htmlCommentsObjArr) ? parsed.htmlCommentsObjArr : []
      const noteType = KnowledgeBaseTemplate.getNoteType(note)
      const resolvedProofField = KnowledgeBaseTemplate.resolveFieldName("证明", noteType)
      const proofLikeFields = new Set(["证明", "反例", "原理", resolvedProofField]
        .filter(Boolean)
        .map(field => KnowledgeBaseTemplate.normalizeFieldName(field)))

      for (const field of fields) {
        const indices = Array.isArray(field.excludingFieldBlockIndexArr) ? field.excludingFieldBlockIndexArr : []
        if (!indices.includes(targetIndex)) continue
        const normalizedField = KnowledgeBaseTemplate.normalizeFieldName(field.text || "")
        if (!proofLikeFields.has(normalizedField)) return null
        return normalizedField
      }
      return null
    }

    const firstProofField = getBroadProofFieldForIndex(sortedIndices[0])
    const shouldMaintainApplicationLinks = !!firstProofField
      && sortedIndices.every(index => getBroadProofFieldForIndex(index) === firstProofField)

    const maintainApplicationLinks = () => {
      if (!shouldMaintainApplicationLinks) return { checked: 0, added: 0, deduped: 0, skipped: 0 }

      const links = extractMarginNoteLinksFromMarkdown(markdownText)
      const result = { checked: links.length, added: 0, deduped: 0, skipped: 0 }
      links.forEach(link => {
        try {
          if (!link.noteId || link.noteId === note.noteId) {
            result.skipped += 1
            return
          }
          const targetNote = MNNote.new(link.noteId, false)
          if (!targetNote) {
            result.skipped += 1
            return
          }

          const hasApplicationField = !!KnowledgeBaseTemplate.getHtmlFieldObjectByName(targetNote, "应用")
          if (!hasApplicationField) {
            result.skipped += 1
            return
          }

          if (KnowledgeBaseTemplate.hasNoteLinkInField(targetNote, "应用", note.noteId)) {
            KnowledgeBaseTemplate.removeDuplicateLinksInField(targetNote, "应用")
            result.deduped += 1
            return
          }

          if (KnowledgeBaseTemplate.addApplicationFieldLinkIfFieldExists(targetNote, note)) {
            result.added += 1
          } else {
            KnowledgeBaseTemplate.removeDuplicateLinksInField(targetNote, "应用")
            result.deduped += 1
          }
        } catch (error) {
          result.skipped += 1
          KnowledgeBaseUtils.addErrorLog(error, "mergeInlineLinkComments.applicationLinks", {
            noteId,
            link,
          })
        }
      })
      return result
    }

    let reverseLinkResult = { checked: 0, added: 0, deduped: 0, skipped: 0 }
    MNUtil.undoGrouping(() => {
      const firstIndex = sortedIndices[0]
      note.replaceWithMarkdownComment(markdownText, firstIndex)
      const deleteIndices = sortedIndices.slice(1).sort((a, b) => b - a)
      if (deleteIndices.length > 0) {
        note.removeCommentsByIndexArr(deleteIndices)
      }
      reverseLinkResult = maintainApplicationLinks()
      note.refresh()
    })

    const suffix = shouldMaintainApplicationLinks
      ? `；反链检查 ${reverseLinkResult.checked} 个，补 ${reverseLinkResult.added} 个，去重 ${reverseLinkResult.deduped} 个`
      : ""
    MNUtil.showHUD(`已合并 ${sortedIndices.length} 条评论${suffix}`)
    await this.loadCommentData(noteId)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "mergeInlineLinkComments")
    MNUtil.showHUD("合并行内链接失败：" + error.message)
  }
}

knowledgebaseWebController.prototype.mergeTextComments = async function(noteId, indexArr, finalText) {
  try {
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "mergeTextComments.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    const sortedIndices = Array.from(new Set(normalizeIndexArray(indexArr))).sort((a, b) => a - b)
    if (sortedIndices.length < 2) {
      MNUtil.showHUD("合并失败：请连续选择至少 2 条文本评论")
      return
    }

    for (let i = 1; i < sortedIndices.length; i++) {
      if (sortedIndices[i] !== sortedIndices[i - 1] + 1) {
        MNUtil.showHUD("合并失败：只支持连续选择")
        return
      }
    }

    const markdownText = typeof finalText === "string" ? finalText.trim() : ""
    if (!markdownText) {
      MNUtil.showHUD("合并失败：内容为空")
      return
    }

    const mergeableTypes = new Set([
      "textComment",
      "markdownComment",
      "mergedTextComment",
      "mergedMarkdownComment",
    ])
    const currentComments = note.MNComments || []
    const unsupported = sortedIndices.find(index => {
      const comment = currentComments[index]
      return !comment || !mergeableTypes.has(comment.type)
    })
    if (unsupported !== undefined) {
      const comment = currentComments[unsupported]
      MNUtil.showHUD(`合并失败：#${unsupported} 类型不支持${comment ? " (" + comment.type + ")" : ""}`)
      return
    }

    MNUtil.undoGrouping(() => {
      const firstIndex = sortedIndices[0]
      note.replaceWithMarkdownComment(markdownText, firstIndex)
      const deleteIndices = sortedIndices.slice(1).sort((a, b) => b - a)
      if (deleteIndices.length > 0) {
        note.removeCommentsByIndexArr(deleteIndices)
      }
      note.refresh()
    })

    MNUtil.showHUD(`已合并 ${sortedIndices.length} 条文本评论`)
    await this.loadCommentData(noteId)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "mergeTextComments")
    MNUtil.showHUD("合并文本评论失败：" + error.message)
  }
}

knowledgebaseWebController.prototype.convertLinkCommentsToInlineLinks = async function(noteId, indexArr) {
  try {
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "convertLinkCommentsToInlineLinks.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    const sortedIndices = Array.from(new Set(normalizeIndexArray(indexArr))).sort((a, b) => a - b)
    if (sortedIndices.length === 0) {
      MNUtil.showHUD("转换失败：请先选择链接评论")
      return
    }

    const comments = note.MNComments || []
    const rawComments = note.comments || []

    const normalizeLinkedNoteId = value => String(value || "").trim()
    const getCommentText = comment => String((comment && comment.text) || "").trim()
    const getRawNoteUrl = rawComment => {
      const rawNoteId = rawComment && rawComment.note ? normalizeLinkedNoteId(rawComment.note) : ""
      return rawNoteId ? `marginnote4app://note/${rawNoteId}` : ""
    }
    const getCommentNoteUrl = comment => {
      let text = getCommentText(comment)
      if (text.startsWith("- ")) text = text.slice(2).trim()
      if (!isKnowledgeBaseMarginNoteLink(text)) return ""
      return extractKnowledgeBaseNoteIdFromUrl(text) ? text : ""
    }
    const stripTitlePrefix = targetNote => {
      if (!targetNote) return ""
      const parts = KnowledgeBaseTemplate.parseNoteTitle(targetNote) || {}
      const content = String(parts.content || "").replace(/^;\s*/, "").trim()
      if (content) return content
      const rawTitle = String(targetNote.noteTitle || targetNote.title || "").trim()
      return rawTitle.replace(/^【[^】]*】\s*/, "").replace(/^;\s*/, "").trim() || "链接"
    }

    const conversions = []
    const unsupported = []

    sortedIndices.forEach(index => {
      const comment = comments[index]
      const rawComment = rawComments[index]
      const linkUrl = getCommentNoteUrl(comment) || getRawNoteUrl(rawComment)
      const linkedNoteId = extractKnowledgeBaseNoteIdFromUrl(linkUrl)
      if (!comment || !linkUrl || !linkedNoteId) {
        unsupported.push(index)
        return
      }

      let targetNote = null
      try {
        targetNote = MNNote.new(linkedNoteId, false)
      } catch (_) {
        targetNote = null
      }

      if (!targetNote) {
        unsupported.push(index)
        return
      }

      const displayText = stripTitlePrefix(targetNote)
      const markdownText = makeKnowledgeBaseMarkdownLink(displayText, linkUrl, { listItem: true })
      conversions.push({ index, markdownText })
    })

    if (unsupported.length > 0) {
      MNUtil.showHUD(`转换失败：#${unsupported[0]} 不是有效链接评论`)
      return
    }

    MNUtil.undoGrouping(() => {
      conversions.forEach(item => {
        note.replaceWithMarkdownComment(item.markdownText, item.index)
      })
      note.refresh()
    })

    MNUtil.showHUD(`已转换 ${conversions.length} 条链接为行内链接`)
    await this.loadCommentData(noteId)
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "convertLinkCommentsToInlineLinks")
    MNUtil.showHUD("转行内链接失败：" + error.message)
  }
}

/**
 * 移动评论到字段
 * @param {string} noteId - 卡片ID
 * @param {Array} indexArr - 要移动的评论索引数组
 * @param {string} fieldName - 目标字段名称
 * @param {boolean} toBottom - 是否移动到字段底部
 */
knowledgebaseWebController.prototype.moveCommentsToField = async function(noteId, indexArr, fieldName, toBottom) {
  try {
    KnowledgeBaseUtils.log("开始执行", "moveCommentsToField")
    KnowledgeBaseUtils.log("noteId: " + noteId, "moveCommentsToField")
    KnowledgeBaseUtils.log("indexArr: " + JSON.stringify(indexArr), "moveCommentsToField")
    KnowledgeBaseUtils.log("fieldName: " + fieldName, "moveCommentsToField")
    KnowledgeBaseUtils.log("toBottom: " + toBottom, "moveCommentsToField")

    // 获取卡片
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "moveCommentsToField.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    // 处理反向链接（参考 KnowledgeBaseTemplate.autoMoveNewContent）
    const proofLikeFields = ["证明", "反例", "原理"]
    let marginNoteLinks = []
    let shouldProcessReverseLinks = false
    try {
      const noteType = KnowledgeBaseTemplate.getNoteType(note)
      const resolvedField = KnowledgeBaseTemplate.resolveFieldName(fieldName, noteType)
      const normalizedResolvedField = KnowledgeBaseTemplate.normalizeFieldName(resolvedField || "")
      shouldProcessReverseLinks = proofLikeFields.includes(normalizedResolvedField)
      if (shouldProcessReverseLinks) {
        marginNoteLinks = KnowledgeBaseTemplate.extractMarginNoteLinksFromComments(note, indexArr) || []
      }
    } catch (error) {
      KnowledgeBaseUtils.log("提取反向链接失败: " + error.message, "moveCommentsToField")
      marginNoteLinks = []
      shouldProcessReverseLinks = false
    }

    // 调用移动方法
    MNUtil.undoGrouping(() => {
      try {
        KnowledgeBaseTemplate.moveCommentsArrToField(note, indexArr, fieldName, toBottom)
        if (shouldProcessReverseLinks && marginNoteLinks.length > 0) {
          KnowledgeBaseTemplate.processExtractedMarginNoteLinks(note, marginNoteLinks)
        }
        note.refresh()
        MNUtil.showHUD(`成功移动 ${indexArr.length} 条评论到 ${fieldName}`)
        KnowledgeBaseUtils.log("评论移动成功", "moveCommentsToField")
      } catch (error) {
        MNUtil.showHUD("移动失败：" + error.message)
        KnowledgeBaseUtils.log("移动评论失败: " + error, "moveCommentsToField")
        throw error
      }
    })

    // 刷新数据
    await this.loadCommentData(noteId)

  } catch (error) {
    KnowledgeBaseUtils.log("发生错误: " + error.message, "moveCommentsToField")
    MNUtil.showHUD("移动评论失败：" + error)
    KnowledgeBaseUtils.addErrorLog(error, "moveCommentsToField")
  }
}

/**
 * 移动评论到指定索引位置
 * @param {string} noteId - 卡片ID
 * @param {Array} indexArr - 要移动的评论索引数组
 * @param {number} targetIndex - 目标索引位置
 */
knowledgebaseWebController.prototype.moveComments = async function(noteId, indexArr, targetIndex) {
  try {
    KnowledgeBaseUtils.log("开始执行", "moveComments")
    KnowledgeBaseUtils.log("参数", "moveComments", {
      noteId,
      indexArr,
      targetIndex,
      indexArrType: typeof indexArr,
      targetIndexType: typeof targetIndex
    })

    // 获取卡片
    const note = MNNote.new(noteId)
    if (!note) {
      KnowledgeBaseUtils.log("未找到卡片", "moveComments", { noteId })
      await this.removeMissingSearchCardIndex(noteId, "moveComments.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    KnowledgeBaseUtils.log("找到卡片", "moveComments", { noteTitle: note.noteTitle })

    // 判断目标位置是否属于 证明/原理/反例 字段（用于处理反向链接）
    const proofLikeFields = ["证明", "反例", "原理"]
    let marginNoteLinks = []
    let shouldProcessReverseLinks = false
    try {
      const commentsObj = KnowledgeBaseTemplate.parseNoteComments(note)
      const htmlFields = (commentsObj && commentsObj.htmlCommentsObjArr) ? commentsObj.htmlCommentsObjArr : []
      const sortedFields = htmlFields.slice().sort((a, b) => (a.index || 0) - (b.index || 0))

      let targetFieldNormalized = "摘录"
      for (let i = 0; i < sortedFields.length; i++) {
        const f = sortedFields[i]
        if (typeof f.index !== "number") continue
        if (f.index < targetIndex) {
          targetFieldNormalized = KnowledgeBaseTemplate.normalizeFieldName(f.text || "")
        } else {
          break
        }
      }

      shouldProcessReverseLinks = proofLikeFields.includes(targetFieldNormalized)
      if (shouldProcessReverseLinks) {
        marginNoteLinks = KnowledgeBaseTemplate.extractMarginNoteLinksFromComments(note, indexArr) || []
      }
    } catch (error) {
      KnowledgeBaseUtils.log("解析目标字段失败: " + error.message, "moveComments")
      marginNoteLinks = []
      shouldProcessReverseLinks = false
    }

    // 调用真实 API（参考 utils.js:6958-6968）
    MNUtil.undoGrouping(() => {
      try {
        note.moveCommentsByIndexArr(indexArr, targetIndex)
        if (shouldProcessReverseLinks && marginNoteLinks.length > 0) {
          KnowledgeBaseTemplate.processExtractedMarginNoteLinks(note, marginNoteLinks)
        }
        note.refresh()
        MNUtil.showHUD(`成功移动 ${indexArr.length} 条评论`)
        KnowledgeBaseUtils.log("移动成功", "moveComments")
      } catch (error) {
        MNUtil.showHUD("移动失败：" + error.message)
        KnowledgeBaseUtils.log("移动失败", "moveComments", { error: error.message })
        throw error
      }
    })

    // 刷新数据
    await this.loadCommentData(noteId)

  } catch (error) {
    KnowledgeBaseUtils.log("发生错误", "moveComments", { error: error.message })
    MNUtil.showHUD("移动评论失败：" + error)
    KnowledgeBaseUtils.addErrorLog(error, "moveComments")
  }
}

/**
 * 删除评论
 * @param {string} noteId - 卡片ID
 * @param {Array} indexArr - 要删除的评论索引数组
 */
knowledgebaseWebController.prototype.deleteComments = async function(noteId, indexArr) {
  try {
    KnowledgeBaseUtils.log("开始执行", "deleteComments")
    KnowledgeBaseUtils.log("参数", "deleteComments", {
      noteId,
      indexArr,
      indexArrType: typeof indexArr
    })

    // 获取卡片
    const note = MNNote.new(noteId)
    if (!note) {
      KnowledgeBaseUtils.log("未找到卡片", "deleteComments", { noteId })
      await this.removeMissingSearchCardIndex(noteId, "deleteComments.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    KnowledgeBaseUtils.log("找到卡片", "deleteComments", { noteTitle: note.noteTitle })

    // 调用真实 API（参考 utils.js:7077-7090）
    MNUtil.undoGrouping(() => {
      try {
        note.removeCommentsByIndexArr(indexArr)
        note.refresh()
        MNUtil.showHUD(`成功删除 ${indexArr.length} 条评论`)
        KnowledgeBaseUtils.log("删除成功", "deleteComments")
      } catch (error) {
        MNUtil.showHUD("删除失败：" + error.message)
        KnowledgeBaseUtils.log("删除失败", "deleteComments", { error: error.message })
        throw error
      }
    })

    // 刷新数据
    await this.loadCommentData(noteId)

  } catch (error) {
    KnowledgeBaseUtils.log("发生错误", "deleteComments", { error: error.message })
    MNUtil.showHUD("删除评论失败：" + error)
    KnowledgeBaseUtils.addErrorLog(error, "deleteComments")
  }
}

/**
 * 双向删除链接评论（同时删除两边的链接）
 * @param {string} noteId - 卡片ID
 * @param {Array} indexArr - 要删除的链接评论索引数组
 */
knowledgebaseWebController.prototype.deleteBidirectionalLinks = async function(noteId, indexArr) {
  try {
    KnowledgeBaseUtils.log("开始执行", "deleteBidirectionalLinks")

    // 将入参规范化为数字数组，避免重复并按倒序删除，防止索引位移
    const normalizedIndices = normalizeIndexArray(indexArr)
    const sortedIndices = Array.from(new Set(normalizedIndices)).sort((a, b) => b - a)
    const selectionCount = sortedIndices.length

    if (selectionCount === 0) {
      MNUtil.showHUD("双向删除失败：缺少评论索引")
      return
    }

    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "deleteBidirectionalLinks.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    // 解析链接目标 noteId，统计需要删除的反向链接数量
    const targetReverseCountMap = new Map() // targetNoteId -> count

    const normalizeNoteId = (value) => {
      if (!value) return ""
      return String(value).trim().toUpperCase()
    }

    const extractPureLinkNoteId = (text) => {
      if (!text) return null
      let trimmed = String(text).trim()

      // 兼容 TextNote 里可能出现的列表前缀
      if (trimmed.startsWith("- ")) trimmed = trimmed.slice(2).trim()

      // 仅当整条评论“只有一个链接”时才认为是反向链接
      // ✅ 允许 URL 末尾带路径（如 /summary/0），但不允许出现其它字符（如 Markdown 的 []()）
      const patterns = [
        /^marginnote\d*(?:app)?:\/\/note\/([0-9A-Fa-f-]{36})(?:\/[^\s]*)?$/i,
        /^marginnote\d*(?:app)?:note\/([0-9A-Fa-f-]{36})(?:\/[^\s]*)?$/i,
      ]

      for (const re of patterns) {
        const match = trimmed.match(re)
        if (match && match[1]) return normalizeNoteId(match[1])
      }
      return null
    }

    const sourceNoteId = normalizeNoteId(noteId)

    for (const index of sortedIndices) {
      const comment = note.MNComments[index]
      if (!comment) continue

      // 只处理链接评论：通过检查 text 内容是否包含 marginnote URL 来判断
      // 注意：MNComment 的 type 是 textComment/markdownComment，不是 linkComment
      const targetNoteId = extractPureLinkNoteId(comment.text)
      if (targetNoteId) {
        const current = targetReverseCountMap.get(targetNoteId) || 0
        targetReverseCountMap.set(targetNoteId, current + 1)
      }
    }

    // 第一步：收集所有需要删除的反向链接信息
    const reverseLinksToDelete = [] // { targetNoteId, reverseIndices }

    for (const [targetNoteId, expectedCount] of targetReverseCountMap.entries()) {
      try {
        const targetNote = MNNote.new(targetNoteId)
        if (targetNote) {
          const targetComments = targetNote.MNComments
          const reverseIndices = []

          // 从后往前查找，先删除靠后的评论，避免索引位移
          // 注意：通过检查 text 是否包含指向当前 noteId 的 marginnote URL 来判断
          // MNComment 的 type 是 textComment/markdownComment，不是 linkComment
          for (let i = targetComments.length - 1; i >= 0 && reverseIndices.length < expectedCount; i--) {
            const tComment = targetComments[i]
            if (tComment && tComment.text) {
              const tText = tComment.text.trim()
              // 只删除“整条评论只有链接”的反向链接；Markdown 的 []() 不应该删除
              const reverseNoteId = extractPureLinkNoteId(tText)
              if (reverseNoteId && reverseNoteId === sourceNoteId) {
                reverseIndices.push(i)
              }
            }
          }

          if (reverseIndices.length > 0) {
            reverseLinksToDelete.push({
              targetNoteId,
              reverseIndices
            })
          }
        }
      } catch (error) {
        KnowledgeBaseUtils.log("查找反向链接失败", "deleteBidirectionalLinks", error.message)
      }
    }

    const totalReverseLinks = reverseLinksToDelete.reduce((sum, item) => sum + item.reverseIndices.length, 0)

    // 如果没有找到任何反向链接，仍然需要删除当前链接评论
    if (reverseLinksToDelete.length === 0) {
      KnowledgeBaseUtils.log("未找到反向链接，仍删除当前评论", "deleteBidirectionalLinks")
    } else {
      KnowledgeBaseUtils.log("准备删除反向链接", "deleteBidirectionalLinks", {
        reverseLinksToDelete
      })
    }

    // 第二步：执行删除操作
    MNUtil.undoGrouping(() => {
      // 删除当前卡片的评论
      if (sortedIndices.length > 0) {
        note.removeCommentsByIndexArr(sortedIndices)
        note.refresh()
      }

      // 删除所有反向链接
      for (const linkInfo of reverseLinksToDelete) {
        try {
          const targetNote = MNNote.new(linkInfo.targetNoteId)
          if (targetNote) {
            // 按倒序删除，避免索引位移
            linkInfo.reverseIndices.sort((a, b) => b - a)
            targetNote.removeCommentsByIndexArr(linkInfo.reverseIndices)
            targetNote.refresh()
          }
        } catch (error) {
          KnowledgeBaseUtils.log("删除反向链接失败", "deleteBidirectionalLinks", error.message)
        }
      }
    })

    MNUtil.showHUD(`成功删除 ${selectionCount} 条评论（含 ${totalReverseLinks} 条反向链接）`)

    // 刷新数据
    await this.loadCommentData(noteId)

  } catch (error) {
    KnowledgeBaseUtils.log("发生错误", "deleteBidirectionalLinks", error.message)
    MNUtil.showHUD("双向删除失败：" + error)
    KnowledgeBaseUtils.addErrorLog(error, "deleteBidirectionalLinks")
  }
}

/**
 * 提取评论创建子卡片（参考 utils.js:7096-7160）
 * @param {string} noteId - 卡片ID
 * @param {Array} indexArr - 要提取的评论索引数组
 */
knowledgebaseWebController.prototype.extractComments = async function(noteId, indexArr) {
  try {
    KnowledgeBaseUtils.log("开始执行", "extractComments")
    KnowledgeBaseUtils.log("参数", "extractComments", {
      noteId,
      indexArr,
      indexArrType: typeof indexArr
    })

    // 获取卡片
    const note = MNNote.new(noteId)
    if (!note) {
      KnowledgeBaseUtils.log("未找到卡片", "extractComments", { noteId })
      await this.removeMissingSearchCardIndex(noteId, "extractComments.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return
    }

    KnowledgeBaseUtils.log("找到卡片", "extractComments", { noteTitle: note.noteTitle })

    let extractResultNote

    // 调用真实 API（参考 utils.js:7096-7160）
    MNUtil.undoGrouping(() => {
      try {
        extractResultNote = KnowledgeBaseTemplate.extractComments(note, indexArr)
        if (!extractResultNote) {
          throw new Error("提取评论未返回新卡片")
        }

        // 刷新显示
        extractResultNote.refresh()
        note.refresh()

        MNUtil.showHUD(`成功提取 ${indexArr.length} 条评论为新卡片`)
        KnowledgeBaseUtils.log("提取成功", "extractComments")

        // 在脑图中聚焦新创建的卡片
        MNUtil.focusNoteInMindMapById(extractResultNote.noteId, 0.5)

      } catch (error) {
        MNUtil.showHUD("提取失败：" + error.message)
        KnowledgeBaseUtils.log("提取失败", "extractComments", { error: error.message })
        throw error
      }
    })

    // 询问是否删除原评论（简化版，不询问制卡）
    if (extractResultNote) {
      await MNUtil.delay(0.5)
      const rawIndexArr = KnowledgeBaseTemplate.getRawCommentIndicesForManagerIndices(note, indexArr)

      // 使用简单的确认对话框
      UIAlertView.showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
        "提取完成",
        `已成功提取 ${indexArr.length} 条评论到新卡片。\n\n是否从原卡片中删除这些评论？`,
        0,
        "保留原评论",
        ["删除原评论"],
        (alert, buttonIndex) => {
          if (buttonIndex === 1) {
            // 用户选择删除原评论
            MNUtil.undoGrouping(() => {
              try {
                // 先清理被提取内容中链接对应卡片的反向链接
                KnowledgeBaseTemplate.cleanupExtractedContentLinks(note, rawIndexArr)

                // 删除原评论
                note.removeCommentsByIndexArr(rawIndexArr)
                note.refresh()

                MNUtil.showHUD("已删除原卡片中的评论")
                KnowledgeBaseUtils.log("已删除原评论", "extractComments")
              } catch (error) {
                MNUtil.showHUD("删除原评论失败：" + error.message)
                KnowledgeBaseUtils.log("删除原评论失败", "extractComments", { error: error.message })
              }
            })
          }

          // 刷新数据（无论是否删除都需要刷新）
          this.loadCommentData(noteId)
        }
      )
    }

  } catch (error) {
    KnowledgeBaseUtils.log("发生错误", "extractComments", { error: error.message })
    MNUtil.showHUD("提取评论失败：" + error)
    KnowledgeBaseUtils.addErrorLog(error, "extractComments")
  }
}

/**
 * 更新链接评论
 * @param {string} noteId - 卡片ID
 * @param {Array} indexArr - 要更新的评论索引数组（只能包含一个索引）
 * @param {number} linkIndex - 可选；Markdown 评论中要更新的链接索引
 */
knowledgebaseWebController.prototype.updateCommentLink = async function(noteId, indexArr, linkIndex) {
  try {
    KnowledgeBaseUtils.log("开始执行", "updateCommentLink")
    KnowledgeBaseUtils.log("参数", "updateCommentLink", {
      noteId,
      indexArr,
      indexArrType: typeof indexArr
    })

    // 验证参数
    if (indexArr.length !== 1) {
      KnowledgeBaseUtils.log("只能更新一条链接", "updateCommentLink")
      MNUtil.showHUD("只能更新一条链接")
      return false
    }

    const commentIndex = indexArr[0]
    const hasLinkIndex = Number.isInteger(linkIndex) && linkIndex >= 0

    // 获取卡片
    const note = MNNote.new(noteId)
    if (!note) {
      KnowledgeBaseUtils.log("未找到卡片", "updateCommentLink", { noteId })
      await this.removeMissingSearchCardIndex(noteId, "updateCommentLink.noteMissing")
      MNUtil.showHUD("未找到卡片，已从索引移除")
      return false
    }

    KnowledgeBaseUtils.log("找到卡片", "updateCommentLink", { noteTitle: note.noteTitle })

    // 获取评论
    const comment = note.MNComments[commentIndex]
    if (!comment) {
      KnowledgeBaseUtils.log("未找到评论", "updateCommentLink", { commentIndex })
      MNUtil.showHUD("未找到评论")
      return false
    }

    // 获取剪贴板中的新链接
    let clipboardText = String(MNUtil.clipboardText || "").trim()
    if (!isKnowledgeBaseMarginNoteLink(clipboardText) ||
      !extractKnowledgeBaseNoteIdFromUrl(clipboardText)) {
      KnowledgeBaseUtils.log("剪贴板中没有有效的笔记链接", "updateCommentLink", {
        clipboardText
      })
      MNUtil.showHUD("剪贴板中没有有效的笔记链接")
      return false
    }

    let newLinkUrl = clipboardText
    const commentType = comment.type
    const commentText = String(comment.text || "")
    let oldLinkUrl = ""
    let nextCommentText = newLinkUrl
    let replacement = null

    if (hasLinkIndex) {
      const parsedLinks = typeof KnowledgeBaseTemplate.parseMarkdownLinksFromText === "function"
        ? KnowledgeBaseTemplate.parseMarkdownLinksFromText(commentText)
        : []
      const targetMarkdownLink = parsedLinks[linkIndex]
      if (!targetMarkdownLink) {
        MNUtil.showHUD("链接索引无效")
        return false
      }
      replacement = buildKnowledgeBaseMarkdownLinkReplacement(
        commentText,
        linkIndex,
        targetMarkdownLink.displayText,
        newLinkUrl,
        ""
      )
      if (replacement.error) {
        KnowledgeBaseUtils.log("目标 Markdown 链接无效", "updateCommentLink", {
          commentIndex,
          linkIndex,
          error: replacement.error,
        })
        MNUtil.showHUD(replacement.error)
        return false
      }
      oldLinkUrl = replacement.targetLink.url
      nextCommentText = replacement.newText
    } else if (commentType === "linkComment") {
      oldLinkUrl = commentText
    } else if (commentType === "markdownComment" &&
      typeof KnowledgeBaseTemplate.getStandaloneNoteLinkInfoFromComment === "function") {
      const standaloneInfo = KnowledgeBaseTemplate.getStandaloneNoteLinkInfoFromComment(comment)
      if (standaloneInfo && standaloneInfo.url) {
        oldLinkUrl = standaloneInfo.url
        nextCommentText = makeKnowledgeBaseMarkdownLink(standaloneInfo.displayText || "链接", newLinkUrl, {
          listItem: String(commentText || "").trim().startsWith("- "),
        })
      }
    }

    if (!oldLinkUrl) {
      KnowledgeBaseUtils.log("选中的不是可更新的链接评论", "updateCommentLink", {
        commentIndex,
        commentType
      })
      MNUtil.showHUD("请选择链接评论或独立行内链接")
      return false
    }

    KnowledgeBaseUtils.log("准备更新链接", "updateCommentLink", {
      oldLinkUrl,
      newLinkUrl
    })

    // 调用核心 API 更新链接
    MNUtil.undoGrouping(() => {
      try {
        // 1. 替换链接
        if (hasLinkIndex) {
          comment.text = nextCommentText
        } else if (commentType === "linkComment") {
          comment.text = newLinkUrl
        } else {
          note.replaceWithMarkdownComment(nextCommentText, commentIndex)
        }

        // 2. 处理双向链接
        updateKnowledgeBaseLinkBackrefs(note, oldLinkUrl, newLinkUrl, "updateCommentLink")

        note.refresh()
        MNUtil.showHUD("链接更新成功")
        KnowledgeBaseUtils.log("更新成功", "updateCommentLink")

      } catch (error) {
        MNUtil.showHUD("更新失败：" + error.message)
        KnowledgeBaseUtils.log("更新失败", "updateCommentLink", { error: error.message })
        throw error
      }
    })

    // 刷新数据
    await this.loadCommentData(noteId)
    return true

  } catch (error) {
    KnowledgeBaseUtils.log("发生错误", "updateCommentLink", { error: error.message })
    MNUtil.showHUD("更新链接失败：" + error)
    KnowledgeBaseUtils.addErrorLog(error, "updateCommentLink")
    return false
  }
}

/**
 * Replace a placeholder link with the clipboard target and delete the old card.
 * Deletion is non-cascading so existing child cards are preserved.
 */
knowledgebaseWebController.prototype.replacePlaceholderLink = async function(noteId, commentIndex, linkIndex) {
  const fail = (message, options = {}) => {
    if (options.showHUD !== false) MNUtil.showHUD(message, 1)
    return { success: false, cancelled: options.cancelled === true, message }
  }

  try {
    const sourceNote = MNNote.new(noteId)
    if (!sourceNote) {
      await this.removeMissingSearchCardIndex(noteId, "replacePlaceholderLink.sourceMissing")
      return fail("源卡片不存在，已从索引移除")
    }

    const normalizedCommentIndex = Number(commentIndex)
    const hasLinkIndex = linkIndex !== undefined && linkIndex !== null && linkIndex !== ""
    const normalizedLinkIndex = hasLinkIndex ? Number(linkIndex) : undefined
    if (!Number.isInteger(normalizedCommentIndex) || normalizedCommentIndex < 0 ||
      (hasLinkIndex && (!Number.isInteger(normalizedLinkIndex) || normalizedLinkIndex < 0))) {
      return fail("占位替换失败：链接索引无效")
    }

    const sourceComment = sourceNote.MNComments[normalizedCommentIndex]
    if (!sourceComment) return fail("评论不存在，请刷新后重试")

    const newLinkUrl = String(MNUtil.clipboardText || "").trim()
    const newTargetNoteId = extractKnowledgeBaseNoteIdFromUrl(newLinkUrl)
    if (!isKnowledgeBaseMarginNoteLink(newLinkUrl) || !newTargetNoteId) {
      return fail("剪贴板中没有有效的 MarginNote 卡片链接")
    }

    const initialPlan = buildKnowledgeBasePlaceholderReplacementPlan(
      sourceComment,
      normalizedLinkIndex,
      newLinkUrl,
    )
    if (initialPlan.error) return fail(initialPlan.error)

    const oldTargetNoteId = extractKnowledgeBaseNoteIdFromUrl(initialPlan.oldUrl)
    if (!isKnowledgeBaseMarginNoteLink(initialPlan.oldUrl) || !oldTargetNoteId) {
      return fail("当前链接不是可删除的 MarginNote 卡片链接")
    }
    const sourceNoteId = String(sourceNote.noteId || "")
    if (oldTargetNoteId === sourceNoteId) return fail("不能把当前源卡片作为占位卡删除")
    if (oldTargetNoteId === newTargetNoteId) return fail("剪贴板链接与当前占位链接相同")
    if (newTargetNoteId === sourceNoteId) return fail("不能把占位链接替换为当前源卡片自身")

    const oldTargetRawNote = MNUtil.getNoteById(oldTargetNoteId, false)
    const newTargetRawNote = MNUtil.getNoteById(newTargetNoteId, false)
    if (!oldTargetRawNote) return fail("旧占位卡片不存在，请刷新后重试")
    if (!newTargetRawNote) return fail("剪贴板中的目标卡片不存在")

    const oldTargetNote = MNNote.new(oldTargetRawNote)
    const newTargetNote = MNNote.new(newTargetRawNote)
    if (!oldTargetNote || !newTargetNote) return fail("无法读取旧卡片或新卡片")

    const oldTargetChildren = Array.isArray(oldTargetNote.childNotes) ? oldTargetNote.childNotes : []
    if (oldTargetChildren.length > 0 && !oldTargetNote.parentNote) {
      return fail("旧占位卡片没有父卡且包含子卡，无法安全保留子卡后删除")
    }

    const sourceRevisionBeforeConfirm = this.getCommentDataRevision(sourceNote)
    const oldTitle = String(oldTargetNote.noteTitle || oldTargetNote.title || "无标题卡片").trim()
    const newTitle = String(newTargetNote.noteTitle || newTargetNote.title || "无标题卡片").trim()
    const childNotice = oldTargetChildren.length > 0
      ? `\n\n旧卡的 ${oldTargetChildren.length} 张子卡会保留，并提升到旧卡的父级。`
      : ""
    const confirmed = await MNUtil.confirm(
      "占位替换并删除旧卡",
      `旧卡（将删除）：${oldTitle}\n${oldTargetNoteId}\n\n新卡（替换为）：${newTitle}\n${newTargetNoteId}${childNotice}`,
      ["取消", "替换并删除"],
    )
    if (!confirmed) return fail("已取消占位替换", { cancelled: true, showHUD: false })

    const currentSourceNote = MNNote.new(noteId)
    if (!currentSourceNote || this.getCommentDataRevision(currentSourceNote) !== sourceRevisionBeforeConfirm) {
      return fail("源卡片已发生变化，本次操作未执行")
    }
    const currentPlan = buildKnowledgeBasePlaceholderReplacementPlan(
      currentSourceNote.MNComments[normalizedCommentIndex],
      normalizedLinkIndex,
      newLinkUrl,
    )
    if (currentPlan.error || extractKnowledgeBaseNoteIdFromUrl(currentPlan.oldUrl) !== oldTargetNoteId) {
      return fail("当前链接已发生变化，请刷新后重试")
    }
    if (!MNUtil.getNoteById(oldTargetNoteId, false) || !MNUtil.getNoteById(newTargetNoteId, false)) {
      return fail("旧卡片或新卡片已发生变化，本次操作未执行")
    }

    const newBackrefAlreadyExisted = knowledgeBaseNoteHasApplicationLink(newTargetNote, sourceNoteId)
    let sourceChanged = false
    let newBackrefAdded = false

    try {
      MNUtil.undoGrouping(() => {
        if (!newBackrefAlreadyExisted) {
          KnowledgeBaseTemplate.addApplicationFieldLink(newTargetNote, currentSourceNote)
          if (!knowledgeBaseNoteHasApplicationLink(newTargetNote, sourceNoteId)) {
            throw new Error("无法为新目标卡片建立反向链接")
          }
          newBackrefAdded = true
        }

        applyKnowledgeBasePlaceholderCommentText(
          currentSourceNote,
          normalizedCommentIndex,
          currentPlan,
          currentPlan.nextText,
        )
        sourceChanged = true
        currentSourceNote.refresh()
        newTargetNote.refresh()
        oldTargetNote._delete(false)
        if (MNNote.noteCache && oldTargetNoteId in MNNote.noteCache) delete MNNote.noteCache[oldTargetNoteId]
      }, MNUtil.currentNotebookId, {
        feature: "replacePlaceholderLink",
        detail: { noteId, oldTargetNoteId, newTargetNoteId },
      })
    } catch (mutationError) {
      // The delete is the final operation in the group. Roll back source/new-link writes
      // when an earlier mutation fails; a delete failure leaves the old card intact.
      try {
        MNUtil.undoGrouping(() => {
          if (sourceChanged) {
            applyKnowledgeBasePlaceholderCommentText(
              currentSourceNote,
              normalizedCommentIndex,
              currentPlan,
              currentPlan.originalText,
            )
            currentSourceNote.refresh()
          }
          if (newBackrefAdded) {
            KnowledgeBaseTemplate.removeApplicationFieldLink(newTargetNote, sourceNoteId)
            newTargetNote.refresh()
          }
        }, MNUtil.currentNotebookId, {
          feature: "placeholder-replace-rollback",
          detail: { noteId, oldTargetNoteId, newTargetNoteId },
        })
      } catch (rollbackError) {
        KnowledgeBaseUtils.addErrorLog(rollbackError, "placeholder-replace-rollback")
      }
      throw mutationError
    }

    let indexCleanupSuccess = false
    const instance = global.MNKnowledgeBaseInstance
    try {
      if (instance && typeof instance.removeSearchCardIndex === "function") {
        const cleanupResult = await instance.removeSearchCardIndex(oldTargetNoteId, {
          showHUD: false,
          reason: "replacePlaceholderLink.deletedPlaceholder",
        })
        indexCleanupSuccess = !!(cleanupResult && cleanupResult.success)
      } else if (typeof KnowledgeBaseIndexer !== "undefined" && KnowledgeBaseIndexer &&
        typeof KnowledgeBaseIndexer.removeFromIncrementalIndex === "function") {
        const cleanupResult = KnowledgeBaseIndexer.removeFromIncrementalIndex(oldTargetNoteId)
        indexCleanupSuccess = !!(cleanupResult && cleanupResult.success)
      }
      if (instance && typeof instance.refreshSearchCardIndex === "function") {
        await instance.refreshSearchCardIndex(sourceNoteId, { showErrorHUD: false, showSuccessHUD: false })
        await instance.refreshSearchCardIndex(newTargetNoteId, { showErrorHUD: false, showSuccessHUD: false })
      }
      if (!indexCleanupSuccess && instance && typeof instance.loadSearchDataToWebView === "function") {
        await instance.loadSearchDataToWebView()
      }
    } catch (indexError) {
      KnowledgeBaseUtils.addErrorLog(indexError, "replacePlaceholderLink.indexRefresh")
    }

    await this.loadCommentData(noteId, { force: true, silent: true, reason: "replace-placeholder-link" })
    MNUtil.showHUD(
      indexCleanupSuccess ? "占位替换成功，旧卡片已删除" : "占位替换成功，索引将在刷新后同步",
      1,
    )
    KnowledgeBaseUtils.log("占位替换成功", "replacePlaceholderLink", {
      noteId,
      commentIndex: normalizedCommentIndex,
      linkIndex: normalizedLinkIndex,
      oldTargetNoteId,
      newTargetNoteId,
      preservedChildCount: oldTargetChildren.length,
      indexCleanupSuccess,
    })
    return { success: true, cancelled: false, oldTargetNoteId, newTargetNoteId, indexCleanupSuccess }
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "replacePlaceholderLink")
    return fail("占位替换失败: " + (error && error.message ? error.message : String(error)))
  }
}

/**
 * 编辑 Markdown 链接
 * @param {string} noteId - 卡片 ID
 * @param {number} commentIndex - 评论索引
 * @param {number} linkIndex - 链接在 markdownLinks 中的索引
 * @param {string} newDisplayText - 新的显示文本
 * @param {string} newUrl - 新的链接地址
 * @param {string} replacementMarkdown - 可选的完整 Markdown 链接，非空时优先
 */
knowledgebaseWebController.prototype.editMarkdownLink = async function(
  noteId,
  commentIndex,
  linkIndex,
  newDisplayText,
  newUrl,
  replacementMarkdown,
  targetSnapshot
) {
  try {
    // 1. 参数验证
    if (!noteId || !Number.isInteger(commentIndex) || commentIndex < 0 ||
      !Number.isInteger(linkIndex) || linkIndex < 0) {
      MNUtil.showHUD("参数错误")
      return false
    }

    // 2. 获取卡片和评论
    const note = MNNote.new(noteId)
    if (!note) {
      await this.removeMissingSearchCardIndex(noteId, "editMarkdownLink.noteMissing")
      MNUtil.showHUD("卡片不存在，已从索引移除")
      return false
    }

    const comment = note.MNComments[commentIndex]
    if (!comment) {
      MNUtil.showHUD("评论不存在")
      return false
    }

    const originalText = comment.text || ""
    if (!targetSnapshot || targetSnapshot.noteId !== noteId ||
      targetSnapshot.commentIndex !== commentIndex || targetSnapshot.linkIndex !== linkIndex ||
      typeof targetSnapshot.text !== "string" || targetSnapshot.text !== originalText ||
      targetSnapshot.type !== comment.type ||
      !["textComment", "markdownComment", "tagComment", "blankTextComment", "mergedImageComment", "mergedTextComment", "mergedMarkdownComment"].includes(comment.type)) {
      MNUtil.showHUD("评论已变化或编辑目标无效，请刷新后重新打开链接编辑")
      return false
    }
    const replacement = buildKnowledgeBaseMarkdownLinkReplacement(
      originalText,
      linkIndex,
      newDisplayText,
      newUrl,
      replacementMarkdown
    )
    if (replacement.error) {
      MNUtil.showHUD(replacement.error)
      return false
    }

    const targetLink = replacement.targetLink
    const oldUrl = targetLink.url

    MNUtil.undoGrouping(() => {
      updateKnowledgeBaseLinkBackrefs(note, oldUrl, replacement.newUrl, "editMarkdownLink")

      comment.text = replacement.newText

      note.refresh()

      KnowledgeBaseUtils.log(
        `链接编辑成功: [${targetLink.displayText}](${oldUrl}) -> ${replacement.newLinkMarkdown}`,
        "editMarkdownLink"
      )
    })

    MNUtil.showHUD("链接编辑成功")

    await this.loadCommentData(noteId)
    return true
  } catch (error) {
    KnowledgeBaseUtils.addErrorLog(error, "editMarkdownLink")
    MNUtil.showHUD("链接编辑失败：" + error.message)
    return false
  }
}
