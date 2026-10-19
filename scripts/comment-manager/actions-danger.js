    function openConfirmModal(options = {}) {
      if (!dom.confirmModal) return;

      const {
        title = '确认操作',
        message = '确认继续？',
        confirmText = '确认',
        cancelText = '取消',
        danger = false,
        onConfirm = null,
        onCancel = null,
      } = options;

      confirmDialogState.onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
      confirmDialogState.onCancel = typeof onCancel === 'function' ? onCancel : null;

      if (dom.confirmModalTitle) dom.confirmModalTitle.textContent = title;
      if (dom.confirmModalMessage) dom.confirmModalMessage.textContent = message;
      if (dom.confirmModalCancelBtn) dom.confirmModalCancelBtn.textContent = cancelText;
      if (dom.confirmModalConfirmBtn) {
        dom.confirmModalConfirmBtn.textContent = confirmText;
        dom.confirmModalConfirmBtn.classList.toggle('danger', !!danger);
      }

      showManagedModal(dom.confirmModal, { initialFocus: dom.confirmModalConfirmBtn });
    }

    function closeConfirmModal(options = {}) {
      const { invokeCancel = false } = options;
      if (!dom.confirmModal) return;

      hideManagedModal(dom.confirmModal);

      const cancelHandler = confirmDialogState.onCancel;
      confirmDialogState.onConfirm = null;
      confirmDialogState.onCancel = null;

      if (invokeCancel && typeof cancelHandler === 'function') {
        try {
          cancelHandler();
        } catch (error) {
          console.error('confirm cancel 回调失败:', error);
        }
      }
      notifyCommentInteractionSettled();
    }

    function handleConfirmModalConfirm() {
      const confirmHandler = confirmDialogState.onConfirm;
      closeConfirmModal();
      if (typeof confirmHandler === 'function') {
        try {
          confirmHandler();
        } catch (error) {
          console.error('confirm 回调失败:', error);
        }
      }
    }

    // ========================================
    // 确认提取
    // ========================================
    function confirmExtract(indices) {
      const sorted = getUniqueSortedIndices(indices);
      if (sorted.length === 0) {
        showToast('请先选择评论');
        return;
      }
      const noteId = requireNoteId();
      if (!noteId) return;

      // 取消弹窗，直接执行，保证请求发出
      debugLog(`[HTML] extractConfirmed -> indices=${sorted}`);

      // 调用 Bridge 方法
      const submitted = Bridge.extractComments(noteId, sorted);
      if (!submitted) return false;

      // 显示操作提示
      showToast(`正在提取 ${sorted.length} 条评论...`);

      // 清空选择
      clearSelection();
      return true;
    }

    // ========================================
    // 确认删除
    // ========================================
    function getCommentByIndex(index) {
      const parsed = normalizeCommentIndex(index);
      if (!Number.isNaN(parsed) && commentLookupByIndex.has(parsed)) {
        return commentLookupByIndex.get(parsed);
      }
      return state.comments[index];
    }

    function classifyDeleteIndices(sortedIndices) {
      const linkIndices = [];
      const normalIndices = [];

      sortedIndices.forEach((index) => {
        const comment = getCommentByIndex(index);
        if (comment && (comment.type === 'linkComment' || comment.type === 'linkToNote')) {
          linkIndices.push(index);
        } else {
          normalIndices.push(index);
        }
      });

      return { linkIndices, normalIndices };
    }

    function logDeleteClassification(linkIndices, normalIndices) {
      if (linkIndices.length > 0) {
        debugLog(`[HTML] 双向删除链接评论 -> indices=${linkIndices}`);
      }
      if (normalIndices.length > 0) {
        debugLog(`[HTML] 普通删除评论 -> indices=${normalIndices}`);
      }
    }

    function performDeleteByClassification(noteId, sortedIndices, linkIndices, normalIndices) {
      const deleteIndices = getUniqueSortedIndices(sortedIndices, { descending: true });
      if (linkIndices.length > 0) {
        return Bridge.deleteBidirectionalLinks(noteId, deleteIndices);
      } else if (normalIndices.length > 0) {
        return Bridge.deleteComments(noteId, deleteIndices);
      }
      return false;
    }

    function showDeleteProgressToast(totalCount, linkIndices, normalIndices) {
      if (linkIndices.length > 0 && normalIndices.length > 0) {
        showToast(`正在删除 ${totalCount} 条评论（${linkIndices.length} 条双向删除，${normalIndices.length} 条普通删除）...`);
      } else if (linkIndices.length > 0) {
        showToast(`正在双向删除 ${linkIndices.length} 条链接评论...`);
      } else {
        showToast(`正在删除 ${normalIndices.length} 条评论...`);
      }
    }

    function confirmDelete(indices) {
      const sorted = getUniqueSortedIndices(indices);
      if (sorted.length === 0) {
        showToast('请先选择评论');
        return;
      }

      debugLog(`[HTML] deleteConfirmed -> indices=${sorted}`);
      const noteId = requireNoteId();
      if (!noteId) return;

      const { linkIndices, normalIndices } = classifyDeleteIndices(sorted);
      logDeleteClassification(linkIndices, normalIndices);
      const submitted = performDeleteByClassification(noteId, sorted, linkIndices, normalIndices);
      if (!submitted) return false;
      showDeleteProgressToast(sorted.length, linkIndices, normalIndices);
      clearSelection();
      return true;
    }

    // ========================================
	    // 普通删除（不删除反向链接）
	    // ========================================
    function handleNormalDelete() {
      const sorted = requireSelectedIndices(state.selectedIndices, { descending: true });
      if (!sorted) return;

      debugLog(`[HTML] handleNormalDelete -> indices=${sorted}`);

      // 执行删除操作（调用 Native Bridge）
      const noteId = requireNoteId();
      if (!noteId) return;

	      // 单击：不区分类型，全部用普通删除
		      const submitted = Bridge.deleteComments(noteId, sorted);
		      if (!submitted) return false;

	      // 显示操作提示
	      showToast(`正在删除 ${sorted.length} 条评论（普通删除，不删除反向链接）...`);

      // 清空选择
	      clearSelection();
	      return true;

	      // 注意：Native 端会在操作完成后自动调用 Bridge.loadCommentData() 刷新数据
	    }

	    // ========================================
	    // 双向删除（删除反向链接）
	    // ========================================
	    function handleBidirectionalDelete() {
	      const indices = requireSelectedIndices(state.selectedIndices);
	      if (!indices) return;

	      // 复用原有 delete 逻辑：链接评论走双向删除，其它评论走普通删除
	      confirmDelete(indices);
	    }

    // ========================================
    // 更新链接
    // ========================================
    function handleUpdateLink() {
      const indices = getUniqueSortedIndices(state.selectedIndices);

      // 检查是否有选中项
      if (indices.length === 0) {
        showToast('请先选择一条链接评论');
        return;
      }

      // 只能更新一条链接
      if (indices.length !== 1) {
        showToast('一次只能更新一条链接');
        return;
      }

      const index = indices[0];
      const sorted = [index];
      const noteId = requireNoteId();
      if (!noteId) return;

      debugLog(`[HTML] updateLink -> index=${index}`);

      // 调用 Bridge 方法
      const submitted = Bridge.updateCommentLink(noteId, sorted);
      if (!submitted) return false;

      // 显示操作提示
      showToast('正在更新链接...');

      // 清空选择
      clearSelection();
      return true;
    }

    function handleUpdateSingleLink(commentIndex, linkIndex) {
      const normalizedCommentIndex = Number(commentIndex);
      const hasLinkIndex = linkIndex !== undefined && linkIndex !== null && linkIndex !== '';
      const normalizedLinkIndex = hasLinkIndex ? Number(linkIndex) : undefined;
      if (!Number.isInteger(normalizedCommentIndex) || normalizedCommentIndex < 0
        || (hasLinkIndex && (!Number.isInteger(normalizedLinkIndex) || normalizedLinkIndex < 0))) {
        showToast('链接索引无效');
        return false;
      }

      const noteId = requireNoteId();
      if (!noteId) return false;

      debugLog(`[HTML] updateCommentLink -> commentIndex=${normalizedCommentIndex}, linkIndex=${normalizedLinkIndex ?? 'comment'}`);
      const submitted = Bridge.updateCommentLink(noteId, [normalizedCommentIndex], normalizedLinkIndex);
      if (!submitted) return false;

      showToast('正在更新链接...');
      return true;
    }

    function handlePlaceholderReplaceSingleLink(commentIndex, linkIndex) {
      const normalizedCommentIndex = Number(commentIndex);
      const hasLinkIndex = linkIndex !== undefined && linkIndex !== null && linkIndex !== '';
      const normalizedLinkIndex = hasLinkIndex ? Number(linkIndex) : undefined;
      if (!Number.isInteger(normalizedCommentIndex) || normalizedCommentIndex < 0
        || (hasLinkIndex && (!Number.isInteger(normalizedLinkIndex) || normalizedLinkIndex < 0))) {
        showToast('链接索引无效');
        return false;
      }

      const noteId = requireNoteId();
      if (!noteId) return false;

      debugLog(`[HTML] replacePlaceholderLink -> commentIndex=${normalizedCommentIndex}, linkIndex=${normalizedLinkIndex ?? 'comment'}`);
      const submitted = Bridge.replacePlaceholderLink(noteId, [normalizedCommentIndex], normalizedLinkIndex);
      if (!submitted) return false;

      showToast('正在核对占位卡片...');
      return true;
    }

    // ========================================
    // 批量删除
    // ========================================
    const batchDeleteFilters = {
      links: {
        label: '所有链接',
        match(comment) {
          if (!comment) return false;
          const type = String(comment.type || '');
          if (type === 'linkComment' || type === 'linkToNote' || type === 'summaryComment' || type === 'markdownLinkComment') {
            return true;
          }
          if (Array.isArray(comment.markdownLinks) && comment.markdownLinks.length > 0) return true;
          return typeof comment.text === 'string' && hasMarkdownLinks(comment.text);
        },
      },
      drawings: {
        label: '所有手写内容',
        match(comment) {
          if (!comment) return false;
          const type = String(comment.type || '');
          return type === 'drawingComment' || type === 'imageCommentWithDrawing';
        },
      },
      excerpts: {
        label: '所有摘录',
        match(comment) {
          if (!comment) return false;
          const type = String(comment.type || '');
          return comment.originalType === 'LinkNote'
            || type === 'mergedTextComment'
            || type === 'mergedImageComment'
            || type === 'mergedImageCommentWithDrawing';
        },
      },
      markdown: {
        label: '所有 Markdown 评论',
        match(comment) {
          if (!comment) return false;
          const type = String(comment.type || '');
          if (type !== 'markdownComment' && type !== 'markdownLinkComment') return false;
          return !isHtmlLikeComment(comment);
        },
      },
      html: {
        label: '所有 HTML/HtmlMD 评论',
        match(comment) {
          return isHtmlLikeComment(comment);
        },
      },
    };

    function isHtmlLikeComment(comment) {
      if (!comment) return false;
      const type = String(comment.type || '');
      if (type === 'HtmlComment') return true;
      if (comment.htmlMarkdownType) return true;
      return typeof comment.text === 'string' && comment.text.trim().startsWith('<span');
    }

    function getBatchDeleteCheckboxes() {
      if (!dom.batchDeleteTypeList) return [];
      return Array.from(dom.batchDeleteTypeList.querySelectorAll('input[type="checkbox"]'));
    }

    function getBatchDeleteSelectedKeys() {
      return getBatchDeleteCheckboxes()
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value)
        .filter((key) => !!batchDeleteFilters[key]);
    }

    function getBatchDeleteIndicesForKeys(keys) {
      const selectedKeys = Array.isArray(keys) ? keys : [];
      const matched = [];
      (state.comments || []).forEach((comment, arrayIndex) => {
        const matchedByFilter = selectedKeys.some((key) => {
          const filter = batchDeleteFilters[key];
          return filter && filter.match(comment);
        });
        if (!matchedByFilter) return;

        const commentIndex = normalizeCommentIndex(comment && comment.index);
        matched.push(Number.isNaN(commentIndex) ? arrayIndex : commentIndex);
      });
      return getUniqueSortedIndices(matched);
    }

    function getBatchDeleteCounts() {
      const counts = {};
      Object.keys(batchDeleteFilters).forEach((key) => {
        counts[key] = getBatchDeleteIndicesForKeys([key]).length;
      });
      return counts;
    }

    function updateBatchDeleteModalState() {
      const counts = getBatchDeleteCounts();
      getBatchDeleteCheckboxes().forEach((checkbox) => {
        const key = checkbox.value;
        const count = counts[key] || 0;
        const option = checkbox.closest('.batch-delete-option');
        const countNode = dom.batchDeleteTypeList
          ? dom.batchDeleteTypeList.querySelector(`[data-count-key="${key}"]`)
          : null;
        if (countNode) countNode.textContent = String(count);
        if (option) option.classList.toggle('empty', count === 0);
      });

      const selectedKeys = getBatchDeleteSelectedKeys();
      const matchedIndices = getBatchDeleteIndicesForKeys(selectedKeys);
      if (dom.batchDeleteConfirmBtn) {
        dom.batchDeleteConfirmBtn.disabled = matchedIndices.length === 0;
      }
      if (dom.batchDeleteSummary) {
        if (selectedKeys.length === 0) {
          dom.batchDeleteSummary.textContent = '请选择要删除的评论类型';
        } else {
          const labels = selectedKeys.map((key) => batchDeleteFilters[key].label).join('、');
          dom.batchDeleteSummary.textContent = `将删除 ${matchedIndices.length} 条评论：${labels}`;
        }
      }
    }

    function openBatchDeleteModal() {
      if (!dom.batchDeleteModal) return;
      const noteId = requireNoteId();
      if (!noteId) return;
      if (!Array.isArray(state.comments) || state.comments.length === 0) {
        showToast('当前卡片没有可删除的评论');
        return;
      }

      getBatchDeleteCheckboxes().forEach((checkbox) => {
        checkbox.checked = false;
      });
      updateBatchDeleteModalState();
      const firstCheckbox = getBatchDeleteCheckboxes()[0] || null;
      showManagedModal(dom.batchDeleteModal, { initialFocus: firstCheckbox });
    }

    function closeBatchDeleteModal() {
      if (!dom.batchDeleteModal) return;
      hideManagedModal(dom.batchDeleteModal);
      notifyCommentInteractionSettled();
    }

    function confirmBatchDelete() {
      const selectedKeys = getBatchDeleteSelectedKeys();
      const indices = getBatchDeleteIndicesForKeys(selectedKeys);
      if (indices.length === 0) {
        updateBatchDeleteModalState();
        return;
      }

      debugLog(`[HTML] batchDelete -> keys=${selectedKeys.join(',')}, indices=${indices}`);
      const submitted = confirmDelete(indices);
      if (submitted) closeBatchDeleteModal();
    }

    // ========================================
