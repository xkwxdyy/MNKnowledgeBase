    const TEXT_MERGE_SUPPORTED_TYPES = new Set([
      'textComment',
      'markdownComment',
      'markdownLinkComment',
      'mergedTextComment',
      'mergedMarkdownComment',
    ]);

    const TEXT_MERGE_SEPARATOR_MAP = {
      space: ' ',
      comma: '，',
      semicolon: '；',
      period: '。',
      newline: '\n',
    };

    const textMergeState = {
      indices: [],
      materials: [],
      separatorKind: 'space',
    };

    function getTextMergeCommentByIndex(index) {
      const normalized = normalizeCommentIndex(index);
      if (!Number.isNaN(normalized) && commentLookupByIndex.has(normalized)) {
        return commentLookupByIndex.get(normalized);
      }
      return null;
    }

    function isTextMergeSupportedComment(comment) {
      return !!comment && TEXT_MERGE_SUPPORTED_TYPES.has(comment.type);
    }

    function getTextMergeUnsupportedComments(indices) {
      return indices
        .map((index) => ({ index, comment: getTextMergeCommentByIndex(index) }))
        .filter((item) => !isTextMergeSupportedComment(item.comment));
    }

    function buildTextMergeMaterial(comment, order) {
      const type = comment.type;
      const text = String(comment.text || '');
      const label = type === 'markdownComment' || type === 'markdownLinkComment' || type === 'mergedMarkdownComment'
        ? 'Markdown'
        : type === 'mergedTextComment'
          ? '合并文本'
        : '文本';

      return {
        index: comment.index,
        order,
        type,
        label,
        text,
      };
    }

    function getTextMergeBlockOrWarn() {
      const block = getSelectedContiguousBlock();
      if (!block || !block.indices || block.indices.length < 2) {
        showToast('请连续选择至少 2 条文本/Markdown 评论');
        return null;
      }

      if (!block.contiguous) {
        showToast('合并文本评论只支持连续选择');
        return null;
      }

      const unsupported = getTextMergeUnsupportedComments(block.indices);
      if (unsupported.length > 0) {
        const first = unsupported[0];
        const type = first.comment ? first.comment.type : 'missing';
        showToast(`评论 #${first.index} 类型 ${type} 不能合并为文本`);
        return null;
      }

      return block;
    }

    function renderTextMergeMaterialList() {
      if (!dom.textMergeMaterialList) return;
      dom.textMergeMaterialList.innerHTML = textMergeState.materials.map((material, idx) => `
        <button type="button"
                class="merge-material"
                data-text-material-index="${idx}">
          <div class="merge-material-meta">
            <span>#${escapeHtml(String(material.index))}</span>
            <span>${escapeHtml(material.label)}</span>
          </div>
          <div class="merge-material-content">${escapeHtml(material.text)}</div>
        </button>
      `).join('');
    }

    function getTextMergeSeparator() {
      const custom = dom.textMergeCustomSeparator
        ? dom.textMergeCustomSeparator.value
        : '';
      if (custom.length > 0) return custom;
      return TEXT_MERGE_SEPARATOR_MAP[textMergeState.separatorKind] || ' ';
    }

    function setTextMergeSeparator(kind) {
      if (!TEXT_MERGE_SEPARATOR_MAP[kind]) return;
      textMergeState.separatorKind = kind;
      if (dom.textMergeCustomSeparator) dom.textMergeCustomSeparator.value = '';
      if (!dom.textMergeSeparatorGroup) return;
      Array.from(dom.textMergeSeparatorGroup.querySelectorAll('.text-merge-separator')).forEach((button) => {
        button.classList.toggle('active', button.dataset.separatorKind === kind);
      });
    }

    function updateTextMergeConfirmState() {
      if (!dom.mergeTextConfirmBtn || !dom.textMergeCookingText) return;
      dom.mergeTextConfirmBtn.disabled = dom.textMergeCookingText.value.trim().length === 0
        || textMergeState.indices.length < 2;
    }

    function buildTextMergeJoinedText() {
      return textMergeState.materials
        .map((material) => String(material.text || '').trim())
        .filter((text) => text.length > 0)
        .join(getTextMergeSeparator());
    }

    function insertTextMergeTextAtCursor(text) {
      if (!dom.textMergeCookingText) return;
      const textarea = dom.textMergeCookingText;
      const insertText = String(text || '');
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || start;
      textarea.value = textarea.value.slice(0, start) + insertText + textarea.value.slice(end);
      const nextCursor = start + insertText.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      updateTextMergeConfirmState();
    }

    function loadTextMergeMaterialsInOrder() {
      const joined = buildTextMergeJoinedText();
      if (!joined) {
        showToast('没有可载入的文本');
        return;
      }
      insertTextMergeTextAtCursor(joined);
    }

    function rebuildTextMergeCookingText() {
      if (!dom.textMergeCookingText) return;
      const joined = buildTextMergeJoinedText();
      dom.textMergeCookingText.value = joined;
      dom.textMergeCookingText.focus();
      const nextCursor = joined.length;
      dom.textMergeCookingText.setSelectionRange(nextCursor, nextCursor);
      updateTextMergeConfirmState();
    }

    function clearTextMergeCookingText() {
      if (!dom.textMergeCookingText) return;
      dom.textMergeCookingText.value = '';
      dom.textMergeCookingText.focus();
      updateTextMergeConfirmState();
    }

    function openTextMergeModal() {
      const block = getTextMergeBlockOrWarn();
      if (!block) return;

      const materials = block.indices
        .map((index, order) => buildTextMergeMaterial(getTextMergeCommentByIndex(index), order));

      textMergeState.indices = block.indices.slice();
      textMergeState.materials = materials;
      renderTextMergeMaterialList();
      setTextMergeSeparator('space');

      if (dom.textMergeCookingText) dom.textMergeCookingText.value = '';
      showManagedModal(dom.mergeTextModal, { initialFocus: dom.textMergeCookingText });
      updateTextMergeConfirmState();
      if (dom.textMergeCookingText) setTimeout(() => dom.textMergeCookingText.focus(), 0);
    }

    function closeTextMergeModal() {
      hideManagedModal(dom.mergeTextModal);
      textMergeState.indices = [];
      textMergeState.materials = [];
      notifyCommentInteractionSettled();
    }

    function getTextMergeMaterialFromTarget(target) {
      const button = target && target.closest ? target.closest('.merge-material') : null;
      if (!button || !dom.textMergeMaterialList || !dom.textMergeMaterialList.contains(button)) return null;
      const materialIndex = parseInt(button.dataset.textMaterialIndex, 10);
      if (Number.isNaN(materialIndex)) return null;
      return textMergeState.materials[materialIndex] || null;
    }

    function handleTextMergeMaterialClick(event) {
      const material = getTextMergeMaterialFromTarget(event.target);
      if (!material) return;
      event.preventDefault();
      event.stopPropagation();
      insertTextMergeTextAtCursor(material.text);
    }

    function handleTextMergeSeparatorClick(event) {
      const button = event.target && event.target.closest
        ? event.target.closest('.text-merge-separator')
        : null;
      if (!button || !dom.textMergeSeparatorGroup || !dom.textMergeSeparatorGroup.contains(button)) return;
      event.preventDefault();
      setTextMergeSeparator(button.dataset.separatorKind || 'space');
    }

    function handleTextMergeCustomSeparatorInput() {
      if (!dom.textMergeSeparatorGroup) return;
      const hasCustom = !!(dom.textMergeCustomSeparator && dom.textMergeCustomSeparator.value.length > 0);
      if (!hasCustom) {
        setTextMergeSeparator(textMergeState.separatorKind || 'space');
        return;
      }
      Array.from(dom.textMergeSeparatorGroup.querySelectorAll('.text-merge-separator')).forEach((button) => {
        button.classList.remove('active');
      });
    }

    function confirmTextMerge() {
      const noteId = requireNoteId();
      if (!noteId) return;
      const text = dom.textMergeCookingText ? dom.textMergeCookingText.value.trim() : '';
      if (!text) {
        showToast('合并内容为空');
        return;
      }
      if (textMergeState.indices.length < 2) {
        showToast('请至少选择 2 条待合并评论');
        return;
      }

      const indicesToMerge = textMergeState.indices.slice();
      const submitted = Bridge.mergeTextComments(noteId, indicesToMerge, text);
      if (!submitted) return false;
      closeTextMergeModal();
      showToast(`正在合并 ${indicesToMerge.length} 条文本评论...`);
      clearSelection();
      return true;
    }
