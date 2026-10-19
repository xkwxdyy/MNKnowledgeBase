    // 链接编辑功能
    // ========================================

    function getCurrentSelectionSnapshot() {
      try {
        if (!window.MNUtil) return null;
        if (typeof MNUtil.getCurrentSelection === 'function') {
          return MNUtil.getCurrentSelection() || null;
        }
        if (MNUtil.currentSelection) {
          return MNUtil.currentSelection;
        }
      } catch (error) {
        console.error('读取当前选区失败:', error);
      }
      return null;
    }

    function applyCurrentSelectionToEditDisplayText() {
      const selection = getCurrentSelectionSnapshot();
      if (!selection || typeof selection.text !== 'string') {
        showToast('未检测到当前选区文本');
        return;
      }

      const selectedText = selection.text.trim();
      if (!selectedText) {
        showToast('当前选区为空');
        return;
      }

      if (selection.source && selection.source !== 'textview') {
        showToast('当前选区不在评论文本编辑区');
        return;
      }

      if (!dom.editDisplayText) return;
      dom.editDisplayText.value = selectedText;
      updateEditLinkModalState();
      dom.editDisplayText.focus();
      if (typeof dom.editDisplayText.setSelectionRange === 'function') {
        const cursorPos = selectedText.length;
        dom.editDisplayText.setSelectionRange(cursorPos, cursorPos);
      }
      showToast('已填入当前选区文本');
    }

    function getEditLinkFieldMeta(targetField) {
      if (targetField === 'displayText') {
        return {
          key: 'displayText',
          input: dom.editDisplayText,
          label: '显示文本',
        };
      }
      if (targetField === 'url') {
        return {
          key: 'url',
          input: dom.editLinkUrl,
          label: '链接地址',
        };
      }
      if (targetField === 'replacementMarkdown') {
        return {
          key: 'replacementMarkdown',
          input: dom.editReplacementMarkdown,
          label: '完整 Markdown 链接',
        };
      }
      return null;
    }

    function focusEditFieldInput(input) {
      if (!input) return;
      input.focus();
      if (typeof input.setSelectionRange === 'function') {
        const cursorPos = input.value ? input.value.length : 0;
        input.setSelectionRange(cursorPos, cursorPos);
      }
    }

    function replaceEditLinkFieldValue(targetField, nextValue) {
      const fieldMeta = getEditLinkFieldMeta(targetField);
      if (!fieldMeta || !fieldMeta.input) return false;

      fieldMeta.input.value = typeof nextValue === 'string'
        ? nextValue
        : String(nextValue == null ? '' : nextValue);
      updateEditLinkModalState();
      focusEditFieldInput(fieldMeta.input);
      return true;
    }

    function receiveClipboardTextForEditLink(text, targetField) {
      const fieldMeta = getEditLinkFieldMeta(targetField);
      if (!fieldMeta) {
        debugLog(`[HTML] receiveClipboardTextForEditLink 忽略未知字段: ${targetField}`);
        return false;
      }

      const clipboardText = typeof text === 'string'
        ? text
        : String(text == null ? '' : text);
      if (!clipboardText.length) {
        showToast('剪贴板为空');
        focusEditFieldInput(fieldMeta.input);
        return false;
      }

      replaceEditLinkFieldValue(fieldMeta.key, clipboardText);
      showToast(`已用剪贴板替换${fieldMeta.label}`);
      return true;
    }

    function copyEditLinkFieldValue(targetField) {
      const fieldMeta = getEditLinkFieldMeta(targetField);
      if (!fieldMeta || !fieldMeta.input) return;

      const text = fieldMeta.input.value || '';
      if (!text.length) {
        showToast(`${fieldMeta.label}为空`);
        focusEditFieldInput(fieldMeta.input);
        return;
      }

      try {
        if (window.Bridge && typeof Bridge.copyText === 'function') {
          Bridge.copyText(text);
          showToast(`已复制${fieldMeta.label}`);
          return;
        }
      } catch (error) {
        console.error(`复制${fieldMeta.label}失败:`, error);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => {
            showToast(`已复制${fieldMeta.label}`);
          })
          .catch((error) => {
            console.error(`复制${fieldMeta.label}失败:`, error);
            if (typeof copyToClipboardFallback === 'function') {
              copyToClipboardFallback(text);
              return;
            }
            showToast(`复制失败: ${error.message}`);
          });
        return;
      }

      if (typeof copyToClipboardFallback === 'function') {
        copyToClipboardFallback(text);
        return;
      }

      showToast('当前环境不支持复制');
    }

    async function pasteClipboardToEditLinkField(targetField) {
      const fieldMeta = getEditLinkFieldMeta(targetField);
      if (!fieldMeta || !fieldMeta.input) return;

      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          const text = await navigator.clipboard.readText();
          receiveClipboardTextForEditLink(text, fieldMeta.key);
          return;
        } catch (error) {
          debugLog(`[HTML] navigator.clipboard.readText 失败: ${error.message || error}`);
        }
      }

      if (window.Bridge && typeof Bridge.requestClipboardText === 'function') {
        const success = Bridge.requestClipboardText(fieldMeta.key);
        if (!success) {
          showToast('读取剪贴板失败');
        }
        return;
      }

      showToast('当前环境不支持读取剪贴板');
    }

    function getEditLinkDraftValues() {
      return {
        displayText: (dom.editDisplayText && dom.editDisplayText.value ? dom.editDisplayText.value.trim() : ''),
        url: (dom.editLinkUrl && dom.editLinkUrl.value ? dom.editLinkUrl.value.trim() : ''),
        replacementMarkdown: getEditReplacementMarkdownValue(),
      };
    }

    function getEditReplacementMarkdownValue() {
      return dom.editReplacementMarkdown && dom.editReplacementMarkdown.value
        ? dom.editReplacementMarkdown.value.trim()
        : '';
    }

    function parseStandaloneMarkdownLinkInput(markdown) {
      const source = String(markdown || '').trim();
      if (!source || source[0] !== '[') return null;

      const findUnescapedCharacter = (character, startIndex) => {
        for (let index = startIndex; index < source.length; index += 1) {
          if (source[index] === '\\') {
            index += 1;
            continue;
          }
          if (source[index] === character) return index;
        }
        return -1;
      };
      const labelEnd = findUnescapedCharacter(']', 1);
      if (labelEnd < 0 || source[labelEnd + 1] !== '(') return null;
      const urlEnd = findUnescapedCharacter(')', labelEnd + 2);
      if (urlEnd < 0 || urlEnd !== source.length - 1) return null;

      const displayText = source.slice(1, labelEnd).trim();
      const url = source.slice(labelEnd + 2, urlEnd).trim();
      if (!displayText || !url) return null;
      return {
        markdown: source,
        displayText,
        url,
      };
    }

    function setEditReplacementMarkdownError(message) {
      const errorMessage = String(message || '');
      if (dom.editReplacementMarkdownError) {
        dom.editReplacementMarkdownError.textContent = errorMessage;
      }
      if (dom.editReplacementMarkdown) {
        dom.editReplacementMarkdown.classList.toggle('input-error', !!errorMessage);
        dom.editReplacementMarkdown.setAttribute('aria-invalid', errorMessage ? 'true' : 'false');
      }
    }

    function updateEditLinkModalState() {
      const draft = getEditLinkDraftValues();
      const hasEditingTarget = typeof state.editingLink.commentIndex === 'number'
        && typeof state.editingLink.linkIndex === 'number';
      const hasRequiredFields = draft.displayText.length > 0 && draft.url.length > 0;
      const hasChanges = draft.displayText !== state.editingLink.originalDisplayText
        || draft.url !== state.editingLink.originalUrl;
      const directLink = draft.replacementMarkdown
        ? parseStandaloneMarkdownLinkInput(draft.replacementMarkdown)
        : null;
      const directLinkError = draft.replacementMarkdown && !directLink
        ? '请输入一条完整的 Markdown 链接'
        : '';
      const canSubmit = hasEditingTarget && (
        directLink
          ? true
          : (!draft.replacementMarkdown && hasRequiredFields && hasChanges)
      );

      if (dom.editLinkConfirmBtn) {
        dom.editLinkConfirmBtn.disabled = !canSubmit;
      }
      setEditReplacementMarkdownError(directLinkError);
      if (dom.editLinkPreview && hasEditingTarget) {
        if (directLink) {
          dom.editLinkPreview.textContent = directLink.markdown;
        } else {
          const previewDisplayText = draft.displayText || state.editingLink.originalDisplayText || '...';
          const previewUrl = draft.url || state.editingLink.originalUrl || '...';
          dom.editLinkPreview.textContent = `[${previewDisplayText}](${previewUrl})`;
        }
      }
    }

    /**
     * 显示链接编辑模态框
     * @param {number} commentIndex - 评论索引
     * @param {number} linkIndex - 链接在 markdownLinks 中的索引
     * @param {string} displayText - 当前显示文本
     * @param {string} linkUrl - 当前链接地址
     */
    function showEditLinkModal(commentIndex, linkIndex, displayText, linkUrl) {
      const noteId = requireNoteId({ message: '缺少卡片 ID' });
      const comment = getCommentByIndex(commentIndex);
      if (!noteId || !comment || typeof comment.text !== 'string') {
        showToast('评论已变化，请刷新后重新打开编辑');
        return;
      }
      const decodedDisplayText = decodeHtmlEntities(displayText || '');
      const decodedLinkUrl = decodeHtmlEntities(linkUrl || '');

      // 保存编辑状态
      state.editingLink = {
        targetSnapshot: { noteId, commentIndex, linkIndex, type: comment.type, text: comment.text },
        commentIndex: commentIndex,
        linkIndex: linkIndex,
        originalDisplayText: decodedDisplayText,
        originalUrl: decodedLinkUrl
      };

      // 更新预览
      dom.editLinkPreview.textContent = `[${decodedDisplayText}](${decodedLinkUrl})`;

      // 预填充输入框
      dom.editDisplayText.value = decodedDisplayText;
      dom.editLinkUrl.value = decodedLinkUrl;
      if (dom.editReplacementMarkdown) dom.editReplacementMarkdown.value = '';
      updateEditLinkModalState();

      // 显示模态框
      showManagedModal(dom.editLinkModal, { initialFocus: dom.editDisplayText, selectText: true });
    }

    /**
     * 关闭链接编辑模态框
     */
    function closeEditLinkModal() {
      hideManagedModal(dom.editLinkModal);

      // 清空状态
      state.editingLink = {
        commentIndex: null,
        linkIndex: null,
        originalDisplayText: '',
        originalUrl: ''
      };

      // 清空输入框
      dom.editDisplayText.value = '';
      dom.editLinkUrl.value = '';
      if (dom.editReplacementMarkdown) dom.editReplacementMarkdown.value = '';
      setEditReplacementMarkdownError('');
      if (dom.editLinkConfirmBtn) {
        dom.editLinkConfirmBtn.disabled = true;
      }
      notifyCommentInteractionSettled();
    }

    /**
     * 确认编辑链接
     */
    function focusEditLinkValidationTarget(message) {
      if (message === '请输入一条完整的 Markdown 链接') {
        dom.editReplacementMarkdown.focus();
        return;
      }
      if (message === '请输入显示文本') {
        dom.editDisplayText.focus();
        return;
      }
      if (message === '请输入链接地址') {
        dom.editLinkUrl.focus();
      }
    }

    function validateEditLinkDraft(newDisplayText, newUrl, replacementMarkdown) {
      if (replacementMarkdown) {
        return parseStandaloneMarkdownLinkInput(replacementMarkdown)
          ? ''
          : '请输入一条完整的 Markdown 链接';
      }
      if (!newDisplayText) {
        return '请输入显示文本';
      }
      if (!newUrl) {
        return '请输入链接地址';
      }
      if (newDisplayText === state.editingLink.originalDisplayText && newUrl === state.editingLink.originalUrl) {
        return '链接未修改';
      }
      return '';
    }

    function submitEditLink(noteId, newDisplayText, newUrl, replacementMarkdown) {
      debugLog(`[HTML] editMarkdownLink -> commentIndex=${state.editingLink.commentIndex}, linkIndex=${state.editingLink.linkIndex}`);
      const submitted = Bridge.editMarkdownLink(
        noteId,
        state.editingLink.commentIndex,
        state.editingLink.linkIndex,
        newDisplayText,
        newUrl,
        replacementMarkdown,
        state.editingLink.targetSnapshot,
      );
      if (!submitted) return false;
      closeEditLinkModal();
      showToast('正在更新链接...');
      return true;
    }

    function confirmEditLink() {
      const noteId = requireNoteId({ message: '缺少卡片 ID' });
      if (!noteId) return;
      const target = state.editingLink.targetSnapshot;
      if (!target || noteId !== target.noteId) {
        showToast('当前卡片已变化，请重新打开链接编辑');
        return;
      }

      const {
        displayText: newDisplayText,
        url: newUrl,
        replacementMarkdown,
      } = getEditLinkDraftValues();
      const validationMessage = validateEditLinkDraft(
        newDisplayText,
        newUrl,
        replacementMarkdown,
      );
      if (validationMessage) {
        showToast(validationMessage);
        if (validationMessage === '链接未修改') {
          updateEditLinkModalState();
        } else {
          focusEditLinkValidationTarget(validationMessage);
        }
        return;
      }

      submitEditLink(noteId, newDisplayText, newUrl, replacementMarkdown);
    }

    /**
     * 键盘快捷键处理
     */
    function handleEditLinkKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return;
      const isConfirmKey = e.key === 'Enter' && !e.shiftKey;
      if (isConfirmKey) {
        e.preventDefault();
        if (dom.editLinkConfirmBtn && dom.editLinkConfirmBtn.disabled) return;
        confirmEditLink();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeEditLinkModal();
      }
    }

    // ========================================
