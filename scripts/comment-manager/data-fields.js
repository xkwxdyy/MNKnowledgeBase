    // 字段识别功能
    // ========================================
    const HTML_MD_NAV_TYPES = new Set([
      'goal',
      'level1',
      'level2',
      'level3',
      'level4',
      'level5',
      'method',
      'question',
      'idea',
      'key',
      'alert',
      'danger',
      'case',
      'step',
    ]);

    const HTML_MD_NAV_TYPE_META = {
      danger: { icon: '❗❗❗', prefix: '' },
      level1: { icon: '🚩', prefix: '' },
      level2: { icon: '▸', prefix: '' },
      level3: { icon: '▪', prefix: '' },
      level4: { icon: '•', prefix: '' },
      level5: { icon: '·', prefix: '' },
      key: { icon: '🔑', prefix: '' },
      alert: { icon: '⚠️', prefix: '' },
      goal: { icon: '🎯', prefix: '' },
      question: { icon: '❓', prefix: '' },
      idea: { icon: '💡', prefix: '思路：' },
      method: { icon: '✨', prefix: '方法：' },
      case: { icon: '📋', prefix: '' },
      step: { icon: '👣', prefix: '' },
    };

    function buildFieldRecord(name, index, startIndex, endIndex, comments) {
      const field = {
        name,
        index,
        startIndex,
        endIndex,
        comments: Array.isArray(comments) ? comments : [],
        anchors: [],
      };
      field.uid = getFieldUID(field);
      return field;
    }

    function collectHtmlFieldMarkers(comments) {
      const markers = [];
      (Array.isArray(comments) ? comments : []).forEach((comment, position) => {
        if (!comment || comment.type !== 'HtmlComment') return;
        const fieldName = formatHtmlPreview(comment.htmlText || comment.text || '') || 'HTML字段';
        markers.push({
          index: position,
          name: fieldName,
        });
      });
      return markers;
    }

    function sliceCommentsByPosition(comments, startIndex, endIndex) {
      if (!Array.isArray(comments) || comments.length === 0) return [];
      if (startIndex > endIndex) return [];
      return comments.slice(Math.max(0, startIndex), Math.min(comments.length, endIndex + 1));
    }

    function createExcerptField(comments, endIndex) {
      if (!Array.isArray(comments) || comments.length === 0 || endIndex < 0) {
        return null;
      }
      return buildFieldRecord('摘录', -1, 0, endIndex, sliceCommentsByPosition(comments, 0, endIndex));
    }

    function createFieldFromMarker(comments, marker, nextMarker) {
      const startIndex = marker.index + 1;
      const endIndex = nextMarker ? nextMarker.index - 1 : comments.length - 1;
      return buildFieldRecord(
        marker.name,
        marker.index,
        startIndex,
        endIndex,
        sliceCommentsByPosition(comments, startIndex, endIndex)
      );
    }

    function decodeHtmlEntityText(text) {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text == null ? '' : String(text);
      return textarea.value;
    }

    function stripHtmlMDLeadingDash(text) {
      const raw = typeof text === 'string' ? text : '';
      if (raw.startsWith('- ')) {
        return {
          cleanText: raw.slice(2).trim(),
          hasLeadingDash: true,
        };
      }
      return {
        cleanText: raw.trim(),
        hasLeadingDash: false,
      };
    }

    function extractHtmlMDAttr(cleanText, attrName) {
      const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
      const match = String(cleanText || '').match(regex);
      return match && match[1] ? decodeHtmlEntityText(match[1]).trim() : '';
    }

    function normalizeHtmlMDAnchorTitle(rawContent, type) {
      const meta = HTML_MD_NAV_TYPE_META[type] || {};
      let content = decodeHtmlEntityText(rawContent || '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (meta.icon && content.startsWith(meta.icon)) {
        content = content.slice(meta.icon.length).trim();
      }
      if (meta.prefix && content.startsWith(meta.prefix)) {
        content = content.slice(meta.prefix.length).trim();
      }

      return content || type || 'HtmlMD';
    }

    function getHtmlMDAnchorDepth(type) {
      const normalizedType = String(type || '').trim().toLowerCase();
      if (normalizedType === 'goal' || normalizedType === 'level1') return 1;
      const levelMatch = normalizedType.match(/^level([2-5])$/);
      if (levelMatch) {
        return Math.max(2, Math.min(5, Number(levelMatch[1]) || 2));
      }
      return 1;
    }

    function getHtmlMDGroupRank(type) {
      const normalizedType = String(type || '').trim().toLowerCase();
      if (normalizedType === 'method') return 0;
      const levelMatch = normalizedType.match(/^level([1-5])$/);
      if (levelMatch) {
        return Number(levelMatch[1]);
      }
      return null;
    }

    function isHtmlMDGroupAnchor(anchor) {
      return anchor && getHtmlMDGroupRank(anchor.type) !== null;
    }

    function createHtmlMDAnchor(comment, position) {
      if (!comment || comment.type !== 'markdownComment') return null;

      const stripped = stripHtmlMDLeadingDash(comment.text || '');
      if (!/^<span\b/i.test(stripped.cleanText)) return null;

      const type = (comment.htmlMarkdownType || extractHtmlMDAttr(stripped.cleanText, 'id') || '').trim();
      if (!HTML_MD_NAV_TYPES.has(type)) return null;

      const contentMatch = stripped.cleanText.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
      const title = normalizeHtmlMDAnchorTitle(
        comment.htmlMarkdownContent || (contentMatch && contentMatch[1]) || '',
        type
      );
      const meta = HTML_MD_NAV_TYPE_META[type] || {};

      return {
        uid: `htmlmd-${position}`,
        index: position,
        type,
        title,
        icon: meta.icon || '📌',
        depth: getHtmlMDAnchorDepth(type),
        groupRank: getHtmlMDGroupRank(type),
        hasLeadingDash: stripped.hasLeadingDash,
      };
    }

    function cloneCommentRange(comments, startIndex, endIndex) {
      return sliceCommentsByPosition(comments, startIndex, endIndex);
    }

    function findHtmlMDGroupEndIndex(field, groupAnchors, anchorIndex) {
      const anchor = groupAnchors[anchorIndex];
      const rank = getHtmlMDGroupRank(anchor && anchor.type);
      if (!anchor || rank === null) return anchor ? anchor.index : -1;

      const fallbackEnd = typeof field.endIndex === 'number'
        ? field.endIndex
        : anchor.index;

      for (let i = anchorIndex + 1; i < groupAnchors.length; i += 1) {
        const nextAnchor = groupAnchors[i];
        const nextRank = getHtmlMDGroupRank(nextAnchor && nextAnchor.type);
        if (nextRank !== null && nextRank <= rank) {
          return Math.max(anchor.index, nextAnchor.index - 1);
        }
      }

      return Math.max(anchor.index, fallbackEnd);
    }

    function buildHtmlMDGroupsForField(field, comments) {
      const anchors = Array.isArray(field && field.anchors) ? field.anchors : [];
      const groupAnchors = anchors
        .filter(isHtmlMDGroupAnchor)
        .sort((left, right) => left.index - right.index);

      return groupAnchors.map((anchor, anchorIndex) => {
        const groupStartIndex = anchor.index;
        const groupEndIndex = findHtmlMDGroupEndIndex(field, groupAnchors, anchorIndex);
        const group = {
          uid: `htmlmd-group-${anchor.index}`,
          anchorUid: anchor.uid,
          index: anchor.index,
          fieldId: anchor.fieldId || (field && (field.uid || getFieldUID(field))) || '',
          type: anchor.type,
          title: anchor.title,
          icon: anchor.icon || '📌',
          depth: getHtmlMDGroupRank(anchor.type) === 0 ? 0 : (anchor.depth || 1),
          groupRank: getHtmlMDGroupRank(anchor.type),
          startIndex: groupStartIndex,
          endIndex: groupEndIndex,
          comments: cloneCommentRange(comments, groupStartIndex, groupEndIndex),
        };
        anchor.groupId = group.uid;
        anchor.groupStartIndex = groupStartIndex;
        anchor.groupEndIndex = groupEndIndex;
        return group;
      });
    }

    function attachHtmlMDGroupsToFields(fields, comments) {
      if (!Array.isArray(fields) || fields.length === 0) {
        return fields;
      }
      fields.forEach((field) => {
        field.htmlMDGroups = buildHtmlMDGroupsForField(field, comments);
      });
      return fields;
    }

    function collectHtmlMDAnchors(comments) {
      const anchors = [];
      (Array.isArray(comments) ? comments : []).forEach((comment, position) => {
        const anchor = createHtmlMDAnchor(comment, position);
        if (anchor) anchors.push(anchor);
      });
      return anchors;
    }

    function attachHtmlMDAnchorsToFields(fields, anchors) {
      if (!Array.isArray(fields) || !Array.isArray(anchors) || anchors.length === 0) {
        return fields;
      }

      anchors.forEach((anchor) => {
        const field = fields.find((item) => (
          item
          && anchor.index >= item.startIndex
          && anchor.index <= item.endIndex
        ));
        if (!field) return;
        const fieldId = field.uid || getFieldUID(field);
        anchor.fieldId = fieldId;
        if (!Array.isArray(field.anchors)) field.anchors = [];
        field.anchors.push(anchor);
      });

      return fields;
    }

    /**
     * 解析卡片评论，识别字段结构
     * 参考 utils.js 的 parseNoteComments() 函数实现
     *
     * @returns {Array} 字段数组，每个字段包含：
     *   - name: 字段名称
     *   - index: 字段标题的评论索引
     *   - startIndex: 字段内容起始索引（不包含字段标题）
     *   - endIndex: 字段内容结束索引
     *   - comments: 字段下的评论数组
     */
    function parseFieldsFromComments() {
      const comments = Array.isArray(state.comments) ? state.comments : [];
      const fields = [];
      const htmlFieldMarkers = collectHtmlFieldMarkers(comments);
      const htmlMDAnchors = collectHtmlMDAnchors(comments);

      if (htmlFieldMarkers.length === 0) {
        const excerptField = createExcerptField(comments, comments.length - 1);
        return excerptField
          ? attachHtmlMDGroupsToFields(attachHtmlMDAnchorsToFields([excerptField], htmlMDAnchors), comments)
          : [];
      }

      const excerptField = createExcerptField(comments, htmlFieldMarkers[0].index - 1);
      if (excerptField) {
        fields.push(excerptField);
      }

      htmlFieldMarkers.forEach((marker, markerIndex) => {
        fields.push(createFieldFromMarker(comments, marker, htmlFieldMarkers[markerIndex + 1] || null));
      });

      return attachHtmlMDGroupsToFields(attachHtmlMDAnchorsToFields(fields, htmlMDAnchors), comments);
    }

    function getFieldUID(field) {
      // 使用字段标题索引作为稳定标识，默认区用 fixed id
      if (typeof field.index === 'number' && field.index >= 0) {
        return `field-${field.index}`;
      }
      return 'field-default';
    }

    function getFieldNameByIndex(index) {
	      const fields = state.fields || [];
	      for (let field of fields) {
	        if (index >= field.startIndex && index <= field.endIndex) {
	          return field.name;
	        }
	      }
	      return '未知字段';
	    }

	    const fieldIconMap = {
	      '摘录': '📝',
	      '证明': '🔍',
	      '所属': '📦',
	      '相关思考': '💭',
	      '应用': '🎯',
	      '默认': '📄'
	    };

	    function buildFieldNavigatorStructureKey(fields) {
	      return (fields || []).map((field) => {
	        const fieldId = field.uid || getFieldUID(field);
          const fieldName = field && field.name ? String(field.name) : '';
          const anchors = Array.isArray(field && field.anchors)
            ? field.anchors.map((anchor) => `${anchor.uid}:${anchor.type}:${anchor.depth || 1}:${anchor.title}`).join(',')
            : '';
	        return `${fieldId}::${fieldName}::${anchors}`;
	      }).join('||');
	    }

	    function buildFieldNavigatorCountSignature(fields) {
	      return (fields || []).map((field) => {
	        const fieldId = field.uid || getFieldUID(field);
	        const count = Array.isArray(field && field.comments) ? field.comments.length : 0;
          const anchorCount = Array.isArray(field && field.anchors) ? field.anchors.length : 0;
	        return `${fieldId}:${count}:${anchorCount}`;
	      }).join('||');
	    }

	    function createFieldNavigatorButton(fieldId, icon, title, countText, options = {}) {
	      const button = document.createElement('button');
	      button.type = 'button';
	      button.className = options.className || 'tool-btn field-nav-btn';
        if (options.anchorId) {
          button.dataset.anchorId = options.anchorId;
        } else {
	        button.dataset.fieldId = fieldId;
        }
        if (options.depth) {
          const depth = Math.max(1, Math.min(5, Number(options.depth) || 1));
          button.dataset.depth = String(depth);
          button.style.setProperty('--htmlmd-depth', String(depth));
        }

	      const iconNode = document.createElement('span');
	      iconNode.textContent = icon;
	      button.appendChild(iconNode);

	      const titleNode = document.createElement('span');
	      titleNode.textContent = title;
	      button.appendChild(titleNode);

	      const countNode = document.createElement('span');
	      countNode.className = 'field-nav-count';
	      countNode.textContent = String(countText);
	      button.appendChild(countNode);

	      return { button, countNode };
	    }

	    function resetFieldNavigatorView() {
      dom.fieldNavList.innerHTML = '';
      fieldNavButtonMap = new Map();
      fieldNavCountNodeMap = new Map();
      htmlMDAnchorNavButtonMap = new Map();
      fieldNavStructureKey = '';
      fieldNavCountSignature = '';
      activeFieldNavButton = null;
      activeHtmlMDAnchorButton = null;
    }

    function appendFieldNavigatorBoundaryButton(fieldId, icon, title, countText) {
      const item = createFieldNavigatorButton(fieldId, icon, title, countText);
      dom.fieldNavList.appendChild(item.button);
      fieldNavButtonMap.set(fieldId, item.button);
    }

    function appendFieldNavigatorFieldButton(field) {
      const fieldId = field.uid || getFieldUID(field);
      const icon = fieldIconMap[field.name] || '📄';
      const title = field.name || '字段';
      const count = Array.isArray(field.comments) ? field.comments.length : 0;
      const item = createFieldNavigatorButton(fieldId, icon, title, count);
      dom.fieldNavList.appendChild(item.button);
      fieldNavButtonMap.set(fieldId, item.button);
      fieldNavCountNodeMap.set(fieldId, item.countNode);
    }

    function truncateHtmlMDAnchorTitle(title) {
      const text = String(title || '').replace(/\s+/g, ' ').trim();
      if (text.length <= 22) return text;
      return `${text.slice(0, 21)}…`;
    }

    function appendHtmlMDAnchorNavigatorButton(anchor) {
      if (!anchor || !anchor.uid) return;
      const title = truncateHtmlMDAnchorTitle(anchor.title || anchor.type || 'HtmlMD');
      const item = createFieldNavigatorButton(anchor.uid, anchor.icon || '📌', title, `#${anchor.index}`, {
        anchorId: anchor.uid,
        depth: anchor.depth || 1,
        className: 'tool-btn field-nav-btn htmlmd-nav-btn',
      });
      item.button.title = `${anchor.title || title} (#${anchor.index})`;
      dom.fieldNavList.appendChild(item.button);
      htmlMDAnchorNavButtonMap.set(anchor.uid, item.button);
    }

    function rebuildFieldNavigatorButtons(fields, nextStructureKey) {
      resetFieldNavigatorView();
      appendFieldNavigatorBoundaryButton('__nav_top__', '🔝', '顶端', 'Top');
      fields.forEach((field) => {
        appendFieldNavigatorFieldButton(field);
        if (Array.isArray(field && field.anchors)) {
          field.anchors.forEach((anchor) => appendHtmlMDAnchorNavigatorButton(anchor));
        }
      });
      appendFieldNavigatorBoundaryButton('__nav_bottom__', '🔚', '底部', 'End');
      fieldNavStructureKey = nextStructureKey;
      fieldNavCountSignature = '';
    }

    function updateFieldNavigatorCounts(fields, nextCountSignature) {
      fields.forEach((field) => {
        const fieldId = field.uid || getFieldUID(field);
        const countNode = fieldNavCountNodeMap.get(fieldId);
        if (!countNode) return;

        const count = Array.isArray(field.comments) ? field.comments.length : 0;
        const nextText = String(count);
        if (countNode.textContent !== nextText) {
          countNode.textContent = nextText;
        }
      });
      fieldNavCountSignature = nextCountSignature;
    }

    function syncFieldNavigatorActiveState() {
      if (state.currentFieldId && fieldNavButtonMap.has(state.currentFieldId)) {
        setActiveField(state.currentFieldId);
        return;
      }
      updateCurrentFieldFromScroll({ force: true });
    }

    function renderFieldNavigator(fields) {
      if (!dom.fieldNavList) return;
      if (!fields || fields.length === 0) {
        resetFieldNavigatorView();
        return;
      }

      const nextStructureKey = buildFieldNavigatorStructureKey(fields);
      const nextCountSignature = buildFieldNavigatorCountSignature(fields);

      if (nextStructureKey !== fieldNavStructureKey) {
        rebuildFieldNavigatorButtons(fields, nextStructureKey);
      }

      if (fieldNavCountSignature !== nextCountSignature) {
        updateFieldNavigatorCounts(fields, nextCountSignature);
      }

      syncFieldNavigatorActiveState();
    }

    function handleFieldNavClick(event) {
	      const btn = event.target.closest('.field-nav-btn');
	      if (!btn || !dom.fieldNavList || !dom.fieldNavList.contains(btn)) return;

        const anchorId = btn.dataset.anchorId;
        if (anchorId) {
          scrollToHtmlMDAnchor(anchorId);
          return;
        }

	      const fieldId = btn.dataset.fieldId;
	      if (!fieldId) return;

	      if (fieldId === '__nav_top__') {
	        scrollToTop();
	        return;
	      }

	      if (fieldId === '__nav_bottom__') {
	        scrollToBottom();
	        return;
	      }

	      scrollToField(fieldId);
	    }

	    function scrollToTop() {
	      if (!dom.commentsSection) return;
	      dom.commentsSection.scrollTo({ top: 0, behavior: 'smooth' });
	    }

	    function scrollToBottom() {
	      if (!dom.commentsSection) return;
	      dom.commentsSection.scrollTo({ top: dom.commentsSection.scrollHeight, behavior: 'smooth' });
	    }

	    function scrollToField(fieldId) {
	      if (!fieldId || !dom.commentsSection) return;

	      const header = (fieldHeaderNodeMap && fieldHeaderNodeMap.get(fieldId))
	        || dom.commentsList.querySelector(`.field-header[data-field-id="${fieldId}"]`);
	      if (!header) return;

	      const containerRect = dom.commentsSection.getBoundingClientRect();
	      const headerRect = header.getBoundingClientRect();
	      const delta = headerRect.top - containerRect.top;

	      dom.commentsSection.scrollBy({ top: delta - 8, behavior: 'smooth' });
	      setActiveField(fieldId);
	    }

    function findHtmlMDAnchorById(anchorId) {
      const fields = state.fields || [];
      for (let i = 0; i < fields.length; i += 1) {
        const anchors = Array.isArray(fields[i] && fields[i].anchors) ? fields[i].anchors : [];
        for (let j = 0; j < anchors.length; j += 1) {
          if (anchors[j] && anchors[j].uid === anchorId) {
            return anchors[j];
          }
        }
      }
      return null;
    }

    function setActiveHtmlMDAnchor(anchorId) {
      const nextActiveButton = htmlMDAnchorNavButtonMap
        ? htmlMDAnchorNavButtonMap.get(anchorId)
        : null;

      if (activeHtmlMDAnchorButton && activeHtmlMDAnchorButton !== nextActiveButton) {
        activeHtmlMDAnchorButton.classList.remove('active');
      }

      if (nextActiveButton) {
        nextActiveButton.classList.add('active');
      }

      activeHtmlMDAnchorButton = nextActiveButton || null;
    }

    function flashHtmlMDAnchorCard(card) {
      if (!card) return;
      card.classList.remove('anchor-flash');
      void card.offsetWidth;
      card.classList.add('anchor-flash');
      window.clearTimeout(card._htmlMDAnchorFlashTimer);
      card._htmlMDAnchorFlashTimer = window.setTimeout(() => {
        card.classList.remove('anchor-flash');
      }, 1200);
    }

    function scrollToHtmlMDAnchor(anchorId) {
      if (!anchorId || !dom.commentsSection) return;
      const anchor = findHtmlMDAnchorById(anchorId);
      if (!anchor) return;

      const card = commentCardNodeMap.get(anchor.index);
      if (!card) return;

      const containerRect = dom.commentsSection.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const delta = cardRect.top - containerRect.top;

      dom.commentsSection.scrollBy({ top: delta - 8, behavior: 'smooth' });
      if (anchor.fieldId) {
        setActiveField(anchor.fieldId);
      }
      setActiveHtmlMDAnchor(anchorId);
      flashHtmlMDAnchorCard(card);

      if (dom.currentField) {
        const field = anchor.fieldId && fieldLookupById ? fieldLookupById.get(anchor.fieldId) : null;
        const fieldName = field ? field.name : '';
        dom.currentField.textContent = fieldName
          ? `${fieldName} / ${truncateHtmlMDAnchorTitle(anchor.title)}`
          : truncateHtmlMDAnchorTitle(anchor.title);
      }
    }

	    function setActiveField(fieldId) {
	      if (!fieldId) return;

	      const nextActiveButton = dom.fieldNavList
	        ? ((fieldNavButtonMap && fieldNavButtonMap.get(fieldId)) || null)
	        : null;

	      if (state.currentFieldId === fieldId && activeFieldNavButton === nextActiveButton) {
	        return;
	      }

	      state.currentFieldId = fieldId;

	      if (dom.fieldNavList) {
	        if (activeFieldNavButton && activeFieldNavButton !== nextActiveButton) {
	          activeFieldNavButton.classList.remove('active');
	        }

	        if (nextActiveButton) {
	          nextActiveButton.classList.add('active');
	        }

	        activeFieldNavButton = nextActiveButton;
          if (activeHtmlMDAnchorButton) {
            activeHtmlMDAnchorButton.classList.remove('active');
            activeHtmlMDAnchorButton = null;
          }
	      }

	      if (dom.currentField) {
	        const field = (fieldLookupById && fieldLookupById.get(fieldId)) || null;
	        dom.currentField.textContent = field ? field.name : '-';
	      }
	    }
    function rebuildFieldHeaderPositions() {
      if (!dom.commentsSection || !dom.commentsList) {
        fieldHeaderPositionList = [];
        fieldHeaderPositionVersion += 1;
        lastFieldScrollAnchorTop = NaN;
        lastFieldScrollVersion = -1;
        return;
      }

      const containerRectTop = dom.commentsSection.getBoundingClientRect().top;
      const scrollTop = dom.commentsSection.scrollTop || 0;
      const positions = [];

      fieldHeaderNodeMap.forEach((header) => {
        if (!header || !header.dataset || !header.dataset.fieldId) return;
        const top = header.getBoundingClientRect().top - containerRectTop + scrollTop;
        positions.push({
          fieldId: header.dataset.fieldId,
          top,
        });
      });

      positions.sort((left, right) => left.top - right.top);
      fieldHeaderPositionList = positions;
      fieldHeaderPositionVersion += 1;
      lastFieldScrollAnchorTop = NaN;
      lastFieldScrollVersion = -1;
    }

    function scheduleFieldHeaderPositionRefresh() {
      if (fieldHeaderPositionRefreshRaf) return;
      fieldHeaderPositionRefreshRaf = requestAnimationFrame(() => {
        fieldHeaderPositionRefreshRaf = null;
        rebuildFieldHeaderPositions();
        updateCurrentFieldFromScroll({ force: true });
      });
    }

    function handleCommentMediaLoad(event) {
      const target = event && event.target;
      if (!target || target.tagName !== 'IMG') return;
      scheduleFieldHeaderPositionRefresh();
    }

    function handleCommentMediaError(event) {
      const target = event && event.target;
      if (!target || target.tagName !== 'IMG') return;

      const errorText = target.getAttribute(COMMENT_MEDIA_ERROR_ATTR) || '媒体加载失败';
      const preview = target.closest('.comment-preview');
      if (preview) {
        preview.textContent = errorText;
      }
      scheduleFieldHeaderPositionRefresh();
    }

    function ensureFieldHeaderPositionsReady() {
      if (!fieldHeaderPositionList || fieldHeaderPositionList.length === 0) {
        rebuildFieldHeaderPositions();
      }
      return !!(fieldHeaderPositionList && fieldHeaderPositionList.length > 0);
    }

    function shouldSkipFieldScrollUpdate(force, anchorTop) {
      return !force
        && lastFieldScrollVersion === fieldHeaderPositionVersion
        && lastFieldScrollAnchorTop === anchorTop;
    }

    function findCurrentFieldIdByAnchor(anchorTop) {
      let left = 0;
      let right = fieldHeaderPositionList.length - 1;
      let current = 0;

      while (left <= right) {
        const middle = (left + right) >> 1;
        if (fieldHeaderPositionList[middle].top <= anchorTop) {
          current = middle;
          left = middle + 1;
        } else {
          right = middle - 1;
        }
      }

      const currentItem = fieldHeaderPositionList[current];
      return (currentItem && currentItem.fieldId) || 'field-default';
    }

    function updateCurrentFieldFromScroll(options = {}) {
      if (!dom.commentsSection || !dom.commentsList) return;

      const force = options.force === true;
      if (!ensureFieldHeaderPositionsReady()) return;

      const anchorTop = (dom.commentsSection.scrollTop || 0) + 8;
      if (shouldSkipFieldScrollUpdate(force, anchorTop)) {
        return;
      }

      const fieldId = findCurrentFieldIdByAnchor(anchorTop);
      lastFieldScrollAnchorTop = anchorTop;
      lastFieldScrollVersion = fieldHeaderPositionVersion;

      if (!force && state.currentFieldId === fieldId) {
        return;
      }

      setActiveField(fieldId);
    }

    function resetSelectionTracking() {
      previousSelectedIndexSet = new Set();
    }

    function collectChangedSelectionIndices(nextSelectedIndexSet) {
      const changedIndices = new Set();
      nextSelectedIndexSet.forEach((index) => {
        if (!previousSelectedIndexSet.has(index)) {
          changedIndices.add(index);
        }
      });
      previousSelectedIndexSet.forEach((index) => {
        if (!nextSelectedIndexSet.has(index)) {
          changedIndices.add(index);
        }
      });
      return changedIndices;
    }

    function syncCommentCardSelectionVisual(index, isSelected) {
      const card = commentCardNodeMap.get(index);
      if (!card) return;
      let checkbox = commentCheckboxNodeMap.get(index);
      if (!checkbox) {
        checkbox = card.querySelector('.comment-checkbox');
        if (checkbox) {
          commentCheckboxNodeMap.set(index, checkbox);
        }
      }
      if (checkbox) checkbox.checked = isSelected;
      card.classList.toggle('selected', isSelected);
    }

    function syncFieldHeaderSelectionVisual(index, isSelected) {
      const header = fieldHeaderByIndexMap.get(index);
      if (!header) return;
      let checkbox = fieldHeaderCheckboxByIndexMap.get(index);
      if (!checkbox) {
        checkbox = header.querySelector('.field-checkbox');
        if (checkbox) {
          fieldHeaderCheckboxByIndexMap.set(index, checkbox);
        }
      }
      if (checkbox) checkbox.checked = isSelected;
      header.classList.toggle('selected', isSelected);
    }

    function syncHtmlMDGroupSelectionVisuals() {
      if (!htmlMDGroupHeaderNodeMap || !htmlMDGroupHeaderNodeMap.size) return;
      htmlMDGroupHeaderNodeMap.forEach((header, groupId) => {
        const group = htmlMDGroupLookupById && htmlMDGroupLookupById.get(groupId);
        if (!group) return;
        const selectionState = getHtmlMDGroupSelectionState(group);
        header.classList.toggle('selected', selectionState.selected);
        header.classList.toggle('partial', selectionState.partial);

        let checkbox = htmlMDGroupCheckboxNodeMap.get(groupId);
        if (!checkbox) {
          checkbox = header.querySelector('.htmlmd-group-checkbox');
          if (checkbox) {
            htmlMDGroupCheckboxNodeMap.set(groupId, checkbox);
          }
        }
        if (checkbox) {
          checkbox.checked = selectionState.selected;
          checkbox.indeterminate = selectionState.partial;
        }
      });
    }

    function updateSelectionVisualsIncremental() {
      const nextSelectedIndexSet = new Set(state.selectedIndices || []);
      const changedIndices = collectChangedSelectionIndices(nextSelectedIndexSet);
      if (changedIndices.size === 0) {
        syncHtmlMDGroupSelectionVisuals();
        return;
      }

      changedIndices.forEach((index) => {
        const isSelected = nextSelectedIndexSet.has(index);
        syncCommentCardSelectionVisual(index, isSelected);
        syncFieldHeaderSelectionVisual(index, isSelected);
      });

      syncHtmlMDGroupSelectionVisuals();
      previousSelectedIndexSet = nextSelectedIndexSet;
    }

    let commentsScrollRaf = null;
	    function handleCommentsScroll() {
	      if (commentsScrollRaf) return;
	      commentsScrollRaf = requestAnimationFrame(() => {
	        commentsScrollRaf = null;
	        updateCurrentFieldFromScroll();
	      });
	    }

    // ========================================
