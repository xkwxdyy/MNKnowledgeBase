    // 渲染评论列表（按字段分组）
    // ========================================
    function cancelCommentsRenderTask() {
      if (!commentsRenderTaskRaf) return;
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(commentsRenderTaskRaf);
      } else {
        clearTimeout(commentsRenderTaskRaf);
      }
      commentsRenderTaskRaf = 0;
    }

    function scheduleCommentsRenderTask(callback) {
      const run = () => {
        commentsRenderTaskRaf = 0;
        callback();
      };
      if (typeof window.requestAnimationFrame === 'function') {
        commentsRenderTaskRaf = window.requestAnimationFrame(run);
        return;
      }
      commentsRenderTaskRaf = setTimeout(run, 16);
    }

    function startCommentsRenderCycle() {
      commentsRenderVersion += 1;
      cancelCommentsRenderTask();
      return commentsRenderVersion;
    }

    function isCommentsRenderCycleActive(cycleId) {
      return cycleId === commentsRenderVersion;
    }

    function resetCommentRenderCaches() {
      commentCardNodeMap = new Map();
      commentCheckboxNodeMap = new Map();
      fieldHeaderNodeMap = new Map();
      fieldHeaderByIndexMap = new Map();
      fieldHeaderCheckboxByIndexMap = new Map();
      fieldHeaderPositionList = [];
      fieldHeaderPositionVersion += 1;
      lastFieldScrollAnchorTop = NaN;
      lastFieldScrollVersion = -1;
      fieldGroupNodeMap = new Map();
      fieldCommentsContainerMap = new Map();
      htmlMDGroupHeaderNodeMap = new Map();
      htmlMDGroupCheckboxNodeMap = new Map();
      rangeStyledIndices = new Set();
      rangeStartStyledIndex = null;
      resetSelectionTracking();
    }

    function resetFieldNavigatorState() {
      if (dom.fieldNavList) dom.fieldNavList.innerHTML = '';
      fieldNavButtonMap = new Map();
      fieldNavCountNodeMap = new Map();
      htmlMDAnchorNavButtonMap = new Map();
      fieldNavStructureKey = '';
      fieldNavCountSignature = '';
      activeFieldNavButton = null;
      activeHtmlMDAnchorButton = null;
      state.currentFieldId = null;
      if (dom.currentField) dom.currentField.textContent = '-';
    }

    function registerCommentCardNodes(comment, card) {
      const normalizedCommentIndex = normalizeCommentIndex(comment && comment.index);
      commentCardNodeMap.set(comment.index, card);
      if (!Number.isNaN(normalizedCommentIndex)) {
        commentCardNodeMap.set(normalizedCommentIndex, card);
      }

      const cardCheckbox = card.querySelector('.comment-checkbox');
      if (!cardCheckbox) return;

      commentCheckboxNodeMap.set(comment.index, cardCheckbox);
      if (!Number.isNaN(normalizedCommentIndex)) {
        commentCheckboxNodeMap.set(normalizedCommentIndex, cardCheckbox);
      }
    }

    function appendCommentCardToContainer(comment, container) {
      if (!comment || !container) return;
      const card = createCommentCard(comment);
      registerCommentCardNodes(comment, card);
      container.appendChild(card);
    }

    function createFieldGroupContainer(fieldName, fieldId) {
      const fieldGroup = document.createElement('div');
      fieldGroup.className = 'field-group';
      fieldGroup.dataset.field = fieldName;
      fieldGroup.dataset.fieldId = fieldId;
      fieldGroupNodeMap.set(fieldId, fieldGroup);
      return fieldGroup;
    }

    function createFieldHeaderNode(fieldName, fieldId) {
      const fieldHeader = document.createElement('div');
      fieldHeader.className = 'field-header';
      fieldHeader.dataset.field = fieldName;
      fieldHeader.dataset.fieldId = fieldId;
      fieldHeaderNodeMap.set(fieldId, fieldHeader);
      return fieldHeader;
    }

    function bindFieldHeaderIndex(field, fieldHeader, isCustomField) {
      let normalizedFieldIndex = NaN;
      if (isCustomField) {
        fieldHeader.dataset.index = field.index;
        normalizedFieldIndex = normalizeCommentIndex(field.index);
        if (!Number.isNaN(normalizedFieldIndex)) {
          fieldHeaderByIndexMap.set(normalizedFieldIndex, fieldHeader);
        }
      }
      return normalizedFieldIndex;
    }

    function renderFieldHeaderContent(fieldHeader, fieldName, comments, isCustomField) {
      const normalizedFieldName = String(fieldName || '').replace(/[：:]+$/g, '').trim();
      const proofStructureButton = ['证明', '反例', '原理'].includes(normalizedFieldName)
        ? `<button type="button" class="proof-structure-open-btn" data-field-name="${escapeHtml(normalizedFieldName)}" title="阅读${escapeHtml(normalizedFieldName)}全文、手写与路线图">${escapeHtml(normalizedFieldName)}阅读</button>`
        : '';
      fieldHeader.innerHTML = `
        ${isCustomField ? '<input type="checkbox" class="field-checkbox">' : ''}
        <span class="field-icon">${fieldIconMap[fieldName] || '📄'}</span>
        <span class="field-title">${escapeHtml(fieldName)}</span>
        ${proofStructureButton}
        <span class="field-count">${comments.length} 条</span>
      `;
    }

    function syncFieldHeaderSelection(fieldHeader, normalizedFieldIndex, isCustomField, field) {
      const fieldHeaderCheckbox = fieldHeader.querySelector('.field-checkbox');
      if (!Number.isNaN(normalizedFieldIndex) && fieldHeaderCheckbox) {
        fieldHeaderCheckboxByIndexMap.set(normalizedFieldIndex, fieldHeaderCheckbox);
      }
      if (isCustomField && state.selectedIndices.has(field.index)) {
        fieldHeader.classList.add('selected');
        if (fieldHeaderCheckbox) fieldHeaderCheckbox.checked = true;
      }
    }

    function createFieldCommentsContainer(fieldId) {
      const fieldCommentsContainer = document.createElement('div');
      fieldCommentsContainer.className = 'field-comments';
      fieldCommentsContainer.dataset.fieldId = fieldId;
      fieldCommentsContainerMap.set(fieldId, fieldCommentsContainer);
      return fieldCommentsContainer;
    }

    function getHtmlMDGroupDepth(group) {
      const depth = Number(group && group.depth);
      if (!Number.isFinite(depth)) return 0;
      return Math.max(0, Math.min(5, depth));
    }

    function createHtmlMDGroupHeader(group) {
      const header = document.createElement('div');
      const depth = getHtmlMDGroupDepth(group);
      header.className = 'htmlmd-group-header';
      header.dataset.groupId = group.uid;
      header.dataset.depth = String(depth);
      header.style.setProperty('--htmlmd-group-depth', String(depth));
      header.title = '单击：折叠/展开 | 长按：选择分组';

      const count = Array.isArray(group.comments) ? group.comments.length : 0;
      const title = group.title || group.type || 'HtmlMD';
      header.innerHTML = `
        <input type="checkbox" class="htmlmd-group-checkbox">
        <span class="htmlmd-group-icon">${escapeHtml(group.icon || '📌')}</span>
        <span class="htmlmd-group-title">${escapeHtml(title)}</span>
        <span class="htmlmd-group-type">${escapeHtml(group.type || '')}</span>
        <span class="htmlmd-group-count">${count} 条</span>
      `;

      htmlMDGroupHeaderNodeMap.set(group.uid, header);
      const checkbox = header.querySelector('.htmlmd-group-checkbox');
      if (checkbox) {
        htmlMDGroupCheckboxNodeMap.set(group.uid, checkbox);
      }
      return header;
    }

    function createHtmlMDGroupContainer(group) {
      const groupNode = document.createElement('div');
      const depth = getHtmlMDGroupDepth(group);
      const isCollapsed = htmlMDGroupCollapsedIds && htmlMDGroupCollapsedIds.has(group.uid);
      groupNode.className = `htmlmd-group${isCollapsed ? ' collapsed' : ''}`;
      groupNode.dataset.groupId = group.uid;
      groupNode.dataset.depth = String(depth);
      groupNode.style.setProperty('--htmlmd-group-depth', String(depth));
      groupNode.appendChild(createHtmlMDGroupHeader(group));

      const commentsContainer = document.createElement('div');
      commentsContainer.className = 'htmlmd-group-comments';
      commentsContainer.dataset.groupId = group.uid;
      groupNode.appendChild(commentsContainer);

      return { groupNode, commentsContainer };
    }

    function createUngroupedCommentsContainer(fieldId, suffix) {
      const commentsContainer = document.createElement('div');
      commentsContainer.className = 'htmlmd-ungrouped-comments';
      if (fieldId) {
        commentsContainer.dataset.fieldId = fieldId;
      }
      if (suffix) {
        commentsContainer.dataset.segment = suffix;
      }
      return commentsContainer;
    }

    function syncHtmlMDGroupCollapseVisibility() {
      if (!dom.commentsList) return;
      const fieldContainers = dom.commentsList.querySelectorAll('.field-comments');
      fieldContainers.forEach((container) => {
        const collapsedDepthStack = [];
        const groupNodes = Array.from(container.children || [])
          .filter((child) => child && child.classList && child.classList.contains('htmlmd-group'));
        groupNodes.forEach((groupNode) => {
          const depth = Number(groupNode.dataset.depth || 0);
          while (
            collapsedDepthStack.length > 0
            && collapsedDepthStack[collapsedDepthStack.length - 1] >= depth
          ) {
            collapsedDepthStack.pop();
          }

          const hiddenByParent = collapsedDepthStack.length > 0;
          groupNode.classList.toggle('hidden-by-parent', hiddenByParent);

          if (!hiddenByParent && groupNode.classList.contains('collapsed')) {
            collapsedDepthStack.push(depth);
          }
        });
      });
    }

    function getGroupStartPosition(group, comments) {
      const targetIndex = normalizeCommentIndex(group && group.index);
      if (Number.isNaN(targetIndex)) return -1;
      return (Array.isArray(comments) ? comments : []).findIndex((comment) => (
        normalizeCommentIndex(comment && comment.index) === targetIndex
      ));
    }

    function buildFieldCommentRenderSegments(field, fieldCommentsContainer) {
      const comments = Array.isArray(field && field.comments) ? field.comments : [];
      const groups = (Array.isArray(field && field.htmlMDGroups) ? field.htmlMDGroups : [])
        .map((group) => ({
          group,
          position: getGroupStartPosition(group, comments),
        }))
        .filter((item) => item.position >= 0)
        .sort((left, right) => left.position - right.position);

      if (groups.length === 0) {
        return [{ container: fieldCommentsContainer, comments }];
      }

      const segments = [];
      let cursor = 0;
      groups.forEach((item, itemIndex) => {
        const nextPosition = itemIndex < groups.length - 1 ? groups[itemIndex + 1].position : comments.length;
        if (cursor < item.position) {
          const ungroupedContainer = createUngroupedCommentsContainer(
            field && (field.uid || getFieldUID(field)),
            `before-${itemIndex}`
          );
          fieldCommentsContainer.appendChild(ungroupedContainer);
          segments.push({
            container: ungroupedContainer,
            comments: comments.slice(cursor, item.position),
          });
        }

        const { groupNode, commentsContainer } = createHtmlMDGroupContainer(item.group);
        fieldCommentsContainer.appendChild(groupNode);
        segments.push({
          container: commentsContainer,
          comments: comments.slice(item.position, nextPosition),
        });
        cursor = nextPosition;
      });

      if (cursor < comments.length) {
        const ungroupedContainer = createUngroupedCommentsContainer(
          field && (field.uid || getFieldUID(field)),
          'tail'
        );
        fieldCommentsContainer.appendChild(ungroupedContainer);
        segments.push({
          container: ungroupedContainer,
          comments: comments.slice(cursor, comments.length),
        });
      }
      return segments;
    }

    function createFieldRenderSkeleton(field) {
      const fieldName = (field && field.name) || '字段';
      const fieldId = getFieldUID(field);
      const comments = Array.isArray(field && field.comments) ? field.comments : [];
      const isCustomField = typeof field.index === 'number' && field.index >= 0;

      const fieldGroup = createFieldGroupContainer(fieldName, fieldId);
      const fieldHeader = createFieldHeaderNode(fieldName, fieldId);
      const normalizedFieldIndex = bindFieldHeaderIndex(field, fieldHeader, isCustomField);

      renderFieldHeaderContent(fieldHeader, fieldName, comments, isCustomField);
      syncFieldHeaderSelection(fieldHeader, normalizedFieldIndex, isCustomField, field);

      fieldHeader.title = isCustomField
        ? '单击：选中字段 | 双击：选中评论'
        : '单击全选该字段下的评论';
      fieldGroup.appendChild(fieldHeader);

      const fieldCommentsContainer = createFieldCommentsContainer(fieldId);
      fieldGroup.appendChild(fieldCommentsContainer);
      return {
        fieldGroup,
        fieldCommentsContainer,
        comments,
      };
    }

    function finalizeCommentRender(cycleId, fields) {
      if (!isCommentsRenderCycleActive(cycleId)) return;
      state.isCommentsRendering = false;
      rebuildFieldHeaderPositions();
      renderFieldNavigator(fields);
      syncHtmlMDGroupCollapseVisibility();
      updateUI();
      restoreCommentViewStateAfterRender();
    }

    function renderFieldCommentsSynchronously(entries) {
      entries.forEach((entry) => {
        entry.segments.forEach((segment) => {
          segment.comments.forEach((comment) => {
            appendCommentCardToContainer(comment, segment.container);
          });
        });
      });
    }

    function renderFieldCommentsInBatches(entries, fields, cycleId) {
      let entryCursor = 0;
      const processChunk = () => {
        if (!isCommentsRenderCycleActive(cycleId)) return;

        const chunkStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        let renderedCount = 0;
        const hasFrameBudget = () => {
          if (renderedCount < COMMENT_RENDER_MIN_BATCH_SIZE) return true;
          if (renderedCount >= COMMENT_RENDER_MAX_BATCH_SIZE) return false;
          const currentTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
          return currentTime - chunkStartedAt < COMMENT_RENDER_FRAME_BUDGET_MS;
        };
        while (entryCursor < entries.length && hasFrameBudget()) {
          const entry = entries[entryCursor];
          while (entry.segmentCursor < entry.segments.length && hasFrameBudget()) {
            const segment = entry.segments[entry.segmentCursor];
            while (entry.commentCursor < segment.comments.length && hasFrameBudget()) {
              appendCommentCardToContainer(segment.comments[entry.commentCursor], segment.container);
              entry.commentCursor += 1;
              renderedCount += 1;
            }
            if (entry.commentCursor >= segment.comments.length) {
              entry.segmentCursor += 1;
              entry.commentCursor = 0;
            }
          }
          if (entry.segmentCursor >= entry.segments.length) {
            entryCursor += 1;
          }
        }

        if (entryCursor >= entries.length) {
          finalizeCommentRender(cycleId, fields);
          return;
        }

        scheduleCommentsRenderTask(processChunk);
      };

      scheduleCommentsRenderTask(processChunk);
    }

    function renderEmptyCommentsState() {
      state.isCommentsRendering = false;
      const isLoading = state.loadStatus === 'loading';
      const isError = state.loadStatus === 'error';
      const icon = isLoading ? '⏳' : (isError ? '⚠️' : '💬');
      const message = isLoading
        ? '正在读取当前卡片…'
        : (isError ? (state.loadError || '评论数据加载失败') : '当前卡片暂无评论');
      const stateClass = isLoading ? 'loading-state' : (isError ? 'error-state' : 'ready-empty-state');
      dom.commentsList.innerHTML = `
        <div class="empty-state ${stateClass}">
          <div class="empty-icon">${icon}</div>
          <div>${escapeHtml(message)}</div>
        </div>
      `;
      resetFieldNavigatorState();
      updateUI();
      restoreCommentViewStateAfterRender();
    }

    function resolveRenderableFields() {
      const fields = state.fields && state.fields.length > 0
        ? state.fields
        : parseFieldsFromComments();
      state.fields = fields;
      if (typeof rebuildFieldLookup === 'function') {
        rebuildFieldLookup();
      }
      return fields;
    }

    function buildFieldRenderEntries(fields) {
      const fragment = document.createDocumentFragment();
      const entries = [];
      fields.forEach((field) => {
        const skeleton = createFieldRenderSkeleton(field);
        fragment.appendChild(skeleton.fieldGroup);
        entries.push({
          segments: buildFieldCommentRenderSegments(field, skeleton.fieldCommentsContainer),
          segmentCursor: 0,
          commentCursor: 0,
        });
      });
      return { fragment, entries };
    }

    function mountFieldRenderSkeletons(cycleId, fragment) {
      if (!isCommentsRenderCycleActive(cycleId)) return false;
      dom.commentsList.innerHTML = '';
      dom.commentsList.appendChild(fragment);
      return true;
    }

    function renderComments() {
      const cycleId = startCommentsRenderCycle();
      state.isCommentsRendering = true;
      clearInsertPoints();
      resetCommentRenderCaches();

      if (!Array.isArray(state.comments) || state.comments.length === 0) {
        renderEmptyCommentsState();
        return;
      }

      const fields = resolveRenderableFields();
      const { fragment, entries } = buildFieldRenderEntries(fields);
      if (!mountFieldRenderSkeletons(cycleId, fragment)) return;

      if (state.comments.length <= COMMENT_RENDER_CHUNK_THRESHOLD) {
        renderFieldCommentsSynchronously(entries);
        finalizeCommentRender(cycleId, fields);
        return;
      }

      renderFieldCommentsInBatches(entries, fields, cycleId);
    }

    // ========================================
