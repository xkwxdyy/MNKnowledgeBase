    const INLINE_MERGE_SUPPORTED_TYPES = new Set([
      'textComment',
      'markdownComment',
      'markdownLinkComment',
      'mergedTextComment',
      'mergedMarkdownComment',
      'linkComment',
      'linkToNote',
      'summaryComment',
    ]);

    const mergeInlineState = {
      indices: [],
      materials: [],
      materialPressTimer: null,
      materialPressTarget: null,
      materialPressMaterial: null,
      materialPressConsumed: false,
      materialPressConsumeResetTimer: null,
    };

    function getCommentByNormalizedIndex(index) {
      const normalized = normalizeCommentIndex(index);
      if (!Number.isNaN(normalized) && commentLookupByIndex.has(normalized)) {
        return commentLookupByIndex.get(normalized);
      }
      return null;
    }

    function isInlineMergeSupportedComment(comment) {
      return !!comment && INLINE_MERGE_SUPPORTED_TYPES.has(comment.type);
    }

    function getInlineMergeUnsupportedComments(indices) {
      return indices
        .map((index) => ({ index, comment: getCommentByNormalizedIndex(index) }))
        .filter((item) => !isInlineMergeSupportedComment(item.comment));
    }

    function escapeMarkdownLinkText(text) {
      return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/\*/g, '&#42;')
        .replace(/\[/g, '&#91;')
        .replace(/\]/g, '&#93;');
    }

    function escapeMarkdownLinkUrl(url) {
      return String(url || '').replace(/\)/g, '%29').trim();
    }

    function splitListMarkerForInlineLink(text) {
      const rawText = String(text || '');
      const match = rawText.match(/^(\s*-\s+)(\S[\s\S]*)$/);
      if (!match) {
        return {
          prefix: '',
          text: rawText,
        };
      }

      return {
        prefix: match[1],
        text: match[2],
      };
    }

    function makeMarkdownInlineLink(text, url) {
      const material = splitListMarkerForInlineLink(text);
      const displayText = escapeMarkdownLinkText(material.text || '链接');
      const linkUrl = escapeMarkdownLinkUrl(url);
      return `${material.prefix}[${displayText}](${linkUrl})`;
    }

    function isPureMarginNoteLinkText(text) {
      return /^marginnote\d*(?:app)?:\/\/note\/[^\s]+$/i.test(String(text || '').trim());
    }

    function getLinkMaterialUrl(comment) {
      if (!comment) return '';
      const text = String(comment.text || '').trim();
      if (isPureMarginNoteLinkText(text)) return text;
      return '';
    }

    function buildInlineMergeMaterial(comment, order) {
      const type = comment.type;
      const text = String(comment.text || '');
      const isLink = type === 'linkComment' || type === 'linkToNote' || type === 'summaryComment';
      const linkUrl = isLink ? getLinkMaterialUrl(comment) : '';
      const linkedTitle = isLink ? String(comment.linkedNoteTitle || '').trim() : '';
      const label = isLink
        ? '链接'
        : (type === 'markdownComment' || type === 'markdownLinkComment' || type === 'mergedMarkdownComment'
          ? 'Markdown'
          : (type === 'mergedTextComment' ? '合并文本' : '文本'));
      const title = isLink
        ? (linkedTitle || linkUrl || text || '未命名卡片')
        : '';
      const content = isLink
        ? (linkUrl && title !== linkUrl ? linkUrl : '')
        : text;
      const defaultText = isLink
        ? (linkUrl || text)
        : text;

      return {
        index: comment.index,
        order,
        type,
        kind: isLink ? 'link' : 'text',
        label,
        text,
        linkUrl: linkUrl || text,
        title,
        content,
        defaultText,
      };
    }

    function getInlineMergeBlockOrWarn() {
      const block = getSelectedContiguousBlock();
      if (!block || !block.indices || block.indices.length < 2) {
        showToast('请连续选择至少 2 条文本/链接评论');
        return null;
      }

      if (!block.contiguous) {
        showToast('合并行内链接只支持连续选择');
        return null;
      }

      const unsupported = getInlineMergeUnsupportedComments(block.indices);
      if (unsupported.length > 0) {
        const first = unsupported[0];
        const type = first.comment ? first.comment.type : 'missing';
        showToast(`评论 #${first.index} 类型 ${type} 不能合并`);
        return null;
      }

      return block;
    }

    function renderMergeMaterialList() {
      if (!dom.mergeMaterialList) return;
      dom.mergeMaterialList.innerHTML = mergeInlineState.materials.map((material, idx) => {
        const title = String(material.title || '').trim();
        const content = String(material.content || '').trim();
        return `
          <button type="button"
                  class="merge-material"
                  data-material-index="${idx}"
                  data-kind="${material.kind}">
            <div class="merge-material-meta">
              <span>#${escapeHtml(String(material.index))}</span>
              <span>${escapeHtml(material.label)}</span>
            </div>
            ${title ? `<div class="merge-material-title">${escapeHtml(title)}</div>` : ''}
            ${content && content !== title ? `<div class="merge-material-content">${escapeHtml(content)}</div>` : ''}
          </button>
        `;
      }).join('');
    }

    function updateMergeConfirmState() {
      if (!dom.mergeInlineConfirmBtn || !dom.mergeCookingText) return;
      dom.mergeInlineConfirmBtn.disabled = dom.mergeCookingText.value.trim().length === 0
        || mergeInlineState.indices.length < 2;
    }

    function openInlineMergeModal() {
      const block = getInlineMergeBlockOrWarn();
      if (!block) return;

      const materials = block.indices
        .map((index, order) => buildInlineMergeMaterial(getCommentByNormalizedIndex(index), order));

      mergeInlineState.indices = block.indices.slice();
      mergeInlineState.materials = materials;
      renderMergeMaterialList();

      if (dom.mergeBuilderText) dom.mergeBuilderText.value = '';
      if (dom.mergeBuilderLink) dom.mergeBuilderLink.value = '';
      if (dom.mergeCookingText) {
        dom.mergeCookingText.value = '';
      }

      showManagedModal(dom.mergeInlineModal, { initialFocus: dom.mergeCookingText });
      updateMergeConfirmState();
      if (dom.mergeCookingText) setTimeout(() => dom.mergeCookingText.focus(), 0);
    }

    function closeInlineMergeModal() {
      hideManagedModal(dom.mergeInlineModal);
      mergeInlineState.indices = [];
      mergeInlineState.materials = [];
      mergeInlineState.materialPressConsumed = false;
      clearMergeMaterialLongPress();
      notifyCommentInteractionSettled();
    }

    function insertTextAtCookingCursor(text) {
      if (!dom.mergeCookingText) return;
      const textarea = dom.mergeCookingText;
      const insertText = String(text || '');
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || start;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      textarea.value = before + insertText + after;
      const nextCursor = start + insertText.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      updateMergeConfirmState();
    }

    function replaceCookingSelectionWithInlineLink(url, fallbackText) {
      if (!dom.mergeCookingText) return false;
      const textarea = dom.mergeCookingText;
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || start;
      if (end <= start) return false;

      const selectedText = textarea.value.slice(start, end);
      const inlineLink = makeMarkdownInlineLink(selectedText, url || fallbackText);
      textarea.value = textarea.value.slice(0, start) + inlineLink + textarea.value.slice(end);
      const nextCursor = start + inlineLink.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      updateMergeConfirmState();
      return true;
    }

    function getMergeMaterialFromTarget(target) {
      const button = target && target.closest ? target.closest('.merge-material') : null;
      if (!button || !dom.mergeMaterialList || !dom.mergeMaterialList.contains(button)) return null;
      const materialIndex = parseInt(button.dataset.materialIndex, 10);
      if (Number.isNaN(materialIndex)) return null;
      return {
        button,
        material: mergeInlineState.materials[materialIndex] || null,
      };
    }

    function applyMergeMaterialClick(material) {
      if (!material) return;
      if (material.kind === 'link') {
        if (replaceCookingSelectionWithInlineLink(material.linkUrl, material.linkUrl)) return;
        if (dom.mergeBuilderLink) dom.mergeBuilderLink.value = material.linkUrl || '';
        if (dom.mergeBuilderLink) dom.mergeBuilderLink.focus();
        return;
      }

      if (dom.mergeBuilderText) {
        dom.mergeBuilderText.value = material.text || '';
        dom.mergeBuilderText.focus();
      }
    }

    function applyMergeMaterialDoubleClick(material) {
      if (!material) return;
      insertTextAtCookingCursor(material.defaultText || material.text || material.linkUrl || '');
    }

    function handleMergeMaterialClick(event) {
      const resolved = getMergeMaterialFromTarget(event.target);
      if (!resolved || !resolved.material) return;
      event.preventDefault();
      event.stopPropagation();
      if (mergeInlineState.materialPressConsumed) {
        mergeInlineState.materialPressConsumed = false;
        return;
      }
      applyMergeMaterialClick(resolved.material);
    }

    function handleMergeMaterialDoubleClick(event) {
      const resolved = getMergeMaterialFromTarget(event.target);
      if (!resolved || !resolved.material) return;
      event.preventDefault();
      event.stopPropagation();
      applyMergeMaterialDoubleClick(resolved.material);
    }

    function clearMergeMaterialLongPress() {
      if (mergeInlineState.materialPressTimer !== null) {
        clearTimeout(mergeInlineState.materialPressTimer);
        mergeInlineState.materialPressTimer = null;
      }
      if (mergeInlineState.materialPressTarget) {
        mergeInlineState.materialPressTarget.classList.remove('long-press-active');
      }
      mergeInlineState.materialPressTarget = null;
      mergeInlineState.materialPressMaterial = null;
    }

    function scheduleMergeMaterialConsumedReset() {
      if (mergeInlineState.materialPressConsumeResetTimer !== null) {
        clearTimeout(mergeInlineState.materialPressConsumeResetTimer);
      }
      mergeInlineState.materialPressConsumeResetTimer = setTimeout(() => {
        mergeInlineState.materialPressConsumed = false;
        mergeInlineState.materialPressConsumeResetTimer = null;
      }, 700);
    }

    function suppressMergeMaterialPressDefaults(event) {
      if (!event) return;
      if (event.cancelable !== false) {
        event.preventDefault();
      }
      event.stopPropagation();
      const resolved = getMergeMaterialFromTarget(event.target);
      const target = resolved && resolved.button ? resolved.button : null;
      if (target && target.setPointerCapture && typeof event.pointerId === 'number') {
        try {
          target.setPointerCapture(event.pointerId);
        } catch (_) {
          // Some WebViews throw if capture is already released.
        }
      }
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function releaseMergeMaterialPressCapture(event) {
      if (!event) return;
      if (event.cancelable !== false) {
        event.preventDefault();
      }
      event.stopPropagation();
      const resolved = getMergeMaterialFromTarget(event.target);
      const target = resolved && resolved.button ? resolved.button : mergeInlineState.materialPressTarget;
      if (target && target.releasePointerCapture && typeof event.pointerId === 'number') {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch (_) {
          // Pointer capture may already be released after cancel/leave.
        }
      }
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function startMergeMaterialLongPress(event) {
      const resolved = getMergeMaterialFromTarget(event.target);
      if (!resolved || !resolved.material || resolved.material.kind !== 'link') return;
      suppressMergeMaterialPressDefaults(event);
      clearMergeMaterialLongPress();
      mergeInlineState.materialPressTarget = resolved.button;
      mergeInlineState.materialPressMaterial = resolved.material;
      resolved.button.classList.add('long-press-active');
      mergeInlineState.materialPressTimer = setTimeout(() => {
        mergeInlineState.materialPressConsumed = true;
        if (dom.mergeBuilderLink) dom.mergeBuilderLink.value = resolved.material.linkUrl || '';
        if (dom.mergeBuilderText) {
          dom.mergeBuilderText.value = '';
          dom.mergeBuilderText.focus();
        }
        scheduleMergeMaterialConsumedReset();
        clearMergeMaterialLongPress();
      }, 520);
    }

    function endMergeMaterialLongPress(event) {
      if (mergeInlineState.materialPressConsumed) {
        releaseMergeMaterialPressCapture(event);
        return;
      }
      const material = mergeInlineState.materialPressMaterial;
      const shouldApplyClick = mergeInlineState.materialPressTimer !== null && material;
      releaseMergeMaterialPressCapture(event);
      clearMergeMaterialLongPress();
      if (shouldApplyClick) {
        mergeInlineState.materialPressConsumed = true;
        scheduleMergeMaterialConsumedReset();
        applyMergeMaterialClick(material);
      }
    }

    function cancelMergeMaterialPressDefault(event) {
      const resolved = getMergeMaterialFromTarget(event && event.target);
      if (!resolved || !resolved.button) return;
      suppressMergeMaterialPressDefaults(event);
    }

    function insertMergeBuilderText() {
      const text = dom.mergeBuilderText ? dom.mergeBuilderText.value : '';
      if (!text.trim()) {
        showToast('请先输入显示文本');
        return;
      }
      insertTextAtCookingCursor(text);
    }

    function insertMergeBuilderInlineLink() {
      const text = dom.mergeBuilderText ? dom.mergeBuilderText.value.trim() : '';
      const link = dom.mergeBuilderLink ? dom.mergeBuilderLink.value.trim() : '';
      if (!text || !link) {
        showToast('行内链接需要显示文本和链接地址');
        return;
      }
      insertTextAtCookingCursor(makeMarkdownInlineLink(text, link));
    }

    function clearMergeBuilder() {
      if (dom.mergeBuilderText) dom.mergeBuilderText.value = '';
      if (dom.mergeBuilderLink) dom.mergeBuilderLink.value = '';
      if (dom.mergeBuilderText) dom.mergeBuilderText.focus();
    }

    function clearMergeCookingText() {
      if (!dom.mergeCookingText) return;
      dom.mergeCookingText.value = '';
      dom.mergeCookingText.focus();
      updateMergeConfirmState();
    }

    function confirmInlineMerge() {
      const noteId = requireNoteId();
      if (!noteId) return;
      const text = dom.mergeCookingText ? dom.mergeCookingText.value.trim() : '';
      if (!text) {
        showToast('合并内容为空');
        return;
      }
      if (mergeInlineState.indices.length < 2) {
        showToast('请至少选择 2 条待合并评论');
        return;
      }

      const indicesToMerge = mergeInlineState.indices.slice();
      const submitted = Bridge.mergeInlineLinkComments(noteId, indicesToMerge, text);
      if (!submitted) return false;
      closeInlineMergeModal();
      showToast(`正在合并 ${indicesToMerge.length} 条评论...`);
      clearSelection();
      return true;
    }

    function convertSelectedLinksToInline() {
      const noteId = requireNoteId();
      if (!noteId) return;

      const indices = requireSelectedIndices(state.selectedIndices);
      if (!indices) return;

      const unsupported = indices
        .map((index) => ({ index, comment: getCommentByNormalizedIndex(index) }))
        .filter((item) => {
          const comment = item.comment;
          if (!comment) return true;
          if (comment.type === 'linkComment' || comment.type === 'linkToNote' || comment.type === 'summaryComment') {
            return !extractMarginNoteNoteId(comment.linkedNoteUrl || comment.text || '');
          }
          return true;
        });

      if (unsupported.length > 0) {
        showToast(`请选择纯链接评论；#${unsupported[0].index} 不能转换`);
        return;
      }

      const submitted = Bridge.convertLinkCommentsToInlineLinks(noteId, indices);
      if (!submitted) return false;
      showToast(`正在转换 ${indices.length} 条链接...`);
      clearSelection();
      return true;
    }
