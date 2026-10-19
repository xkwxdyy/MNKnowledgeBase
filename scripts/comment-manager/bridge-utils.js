    // Toast 提示
    // ========================================
    let toastTimer = null;
    function showToast(message, duration = 2000) {
      if (!dom.toast) return;
      const text = typeof message === 'string' ? message : String(message || '');
      const timeout = Number.isFinite(duration) ? Math.max(400, duration) : 2000;

      dom.toast.textContent = text;
      dom.toast.classList.remove('show');
      void dom.toast.offsetWidth;
      dom.toast.classList.add('show');

      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        dom.toast.classList.remove('show');
      }, timeout);
    }

    // ========================================
    // 复制到剪贴板
    // ========================================

    /**
     * 复制评论文本到剪贴板
     * @param {number} index - 评论索引
     */
    function copyCommentText(index) {
      // 兼容传入的是 comment.index（稳定 id）而非数组下标
      const comment = getCommentByIndex(index);

      if (!comment) {
        showToast('评论不存在');
        return;
      }

      const text = comment.text || '';

      if (!text) {
        showToast('该评论没有文本内容');
        return;
      }

      // 优先走原生 Bridge（MN 环境），失败则走浏览器剪贴板 API
      try {
        if (window.Bridge && typeof Bridge.copyText === 'function') {
          Bridge.copyText(text);
          showToast('✅ 已复制到剪贴板');
          return;
        }
      } catch (err) {
        // ignore and fallback
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => {
            showToast('✅ 已复制到剪贴板');
          })
          .catch((error) => {
            console.error('复制失败:', error);
            copyToClipboardFallback(text);
          });
      } else {
        copyToClipboardFallback(text);
      }
    }

    /**
     * Pin 文本评论到 mnpinner（创建文本 Pin）
     * @param {number} index - 评论索引
     */
    function pinCommentText(index) {
      try {
        const noteId = requireNoteId({ message: '缺少卡片 ID' });
        if (!noteId) return;

        // 兼容传入的是 comment.index（稳定 id）而非数组下标
        const comment = getCommentByIndex(index);
        if (!comment) {
          showToast('评论不存在');
          return;
        }
        if (comment.originalType !== 'TextNote') {
          showToast('仅支持文本类型评论');
          return;
        }

        // 由 Native 端读取评论内容并转发给 mnpinner（避免 URL 过长）
        Bridge.pinTextCommentToPinner(noteId, {
          commentIndex: index,
          section: 'focus',
          position: 'top',
          afterPin: 'openEditor',
        });

        showToast('📌 已发送 Pin 请求');
      } catch (error) {
        console.error('pinCommentText 失败:', error);
        showToast('Pin 失败: ' + error.message);
      }
    }

    /**
     * 降级复制方法（兼容旧浏览器 / WebView 无 clipboard 权限）
     * @param {string} text - 要复制的文本
     */
    function copyToClipboardFallback(text) {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        const successful = document.execCommand('copy');
        if (successful) {
          showToast('✅ 已复制到剪贴板');
        } else {
          showToast('❌ 复制失败');
        }
      } catch (error) {
        console.error('复制失败:', error);
        showToast('❌ 复制失败: ' + error.message);
      } finally {
        document.body.removeChild(textArea);
      }
    }

    // ========================================
    // 关闭窗口
    // ========================================
    function hasUnsavedCommentManagerDraft() {
      if (dom.editLinkModal && dom.editLinkModal.classList.contains('show')) {
        const draft = getEditLinkDraftValues();
        return draft.displayText !== state.editingLink.originalDisplayText
          || draft.url !== state.editingLink.originalUrl
          || draft.replacementMarkdown.length > 0;
      }
      if (dom.mergeInlineModal && dom.mergeInlineModal.classList.contains('show')) {
        return !!(
          (dom.mergeBuilderText && dom.mergeBuilderText.value.trim())
          || (dom.mergeBuilderLink && dom.mergeBuilderLink.value.trim())
          || (dom.mergeCookingText && dom.mergeCookingText.value.trim())
        );
      }
      if (dom.mergeTextModal && dom.mergeTextModal.classList.contains('show')) {
        return !!(
          (dom.textMergeCookingText && dom.textMergeCookingText.value.trim())
          || (dom.textMergeCustomSeparator && dom.textMergeCustomSeparator.value.length > 0)
        );
      }
      return false;
    }

    function resetCommentManagerInteractionForClose() {
      if (dom.confirmModal && dom.confirmModal.classList.contains('show')) closeConfirmModal();
      if (dom.editLinkModal && dom.editLinkModal.classList.contains('show')) closeEditLinkModal();
      if (dom.mergeInlineModal && dom.mergeInlineModal.classList.contains('show')) closeInlineMergeModal();
      if (dom.mergeTextModal && dom.mergeTextModal.classList.contains('show')) closeTextMergeModal();
      if (dom.batchDeleteModal && dom.batchDeleteModal.classList.contains('show')) closeBatchDeleteModal();
      if (state.moveMode) exitMoveMode();
      if (state.selectionMode === 'range' && typeof cancelRangeSelect === 'function') cancelRangeSelect();
    }

    function performCommentManagerClose(source = 'html') {
      resetCommentManagerInteractionForClose();
      if (typeof window.setManagedCommentAutoRefreshEnabled === 'function') {
        window.setManagedCommentAutoRefreshEnabled(false);
      }
      if (!window.Bridge || typeof Bridge.closeCommentManager !== 'function') {
        showToast('关闭通道尚未就绪，请稍后重试');
        return { closed: false, reason: 'bridge-unavailable', source };
      }
      const submitted = Bridge.closeCommentManager(source);
      return {
        closed: submitted === true,
        reason: submitted === true ? 'submitted' : 'submit-failed',
        source,
      };
    }

    function requestCommentManagerClose(source = 'html') {
      if (state.pendingMutations && state.pendingMutations.size > 0) {
        showToast('操作正在执行，完成前不能关闭');
        return { closed: false, reason: 'mutation-pending', source };
      }

      if (!hasUnsavedCommentManagerDraft()) {
        return performCommentManagerClose(source);
      }

      openConfirmModal({
        title: '放弃未保存内容？',
        message: '编辑或合并草稿尚未提交。关闭后，这些内容会丢失。',
        confirmText: '放弃并关闭',
        cancelText: '继续编辑',
        danger: true,
        onConfirm: () => performCommentManagerClose(source),
      });
      return { closed: false, reason: 'draft-confirmation', source };
    }

    function closeWindow() {
      return requestCommentManagerClose('html');
    }

    // ========================================
    // 工具函数
    // ========================================
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function decodeHtmlEntities(text) {
      if (!text) return '';
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text;
      return textarea.value;
    }

    const BLOCKED_LINK_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'file:']);

    function extractMarginNoteNoteId(url) {
      if (!url) return null;
      const trimmed = String(url).trim();
      const match = trimmed.match(/^marginnote\d*(?:app)?:\/\/note\/([0-9a-f-]{36})(?:[/?#].*)?$/i);
      return match && match[1] ? match[1] : null;
    }

    function normalizeLinkUrl(url) {
      return typeof url === 'string' ? url.trim() : '';
    }

    function isBlockedExternalUrl(url) {
      const normalized = normalizeLinkUrl(url);
      if (!normalized) return true;
      const match = normalized.match(/^([a-z][a-z\d+.-]*:)/i);
      if (!match || !match[1]) return false;
      return BLOCKED_LINK_PROTOCOLS.has(match[1].toLowerCase());
    }

    function findBalancedTokenEnd(text, startIndex, openChar, closeChar) {
      if (typeof text !== 'string' || text[startIndex] !== openChar) return -1;

      let depth = 0;
      for (let index = startIndex; index < text.length; index++) {
        const char = text[index];
        if (char === '\\') {
          index += 1;
          continue;
        }
        if (char === openChar) {
          depth += 1;
        } else if (char === closeChar) {
          depth -= 1;
          if (depth === 0) {
            return index;
          }
        }
      }

      return -1;
    }

    function extractMarkdownLinkTokens(text) {
      if (typeof text !== 'string' || text.length === 0) return [];

      const tokens = [];
      let cursor = 0;

      while (cursor < text.length) {
        const labelStart = text.indexOf('[', cursor);
        if (labelStart < 0) break;

        const labelEnd = findBalancedTokenEnd(text, labelStart, '[', ']');
        if (labelEnd < 0 || text[labelEnd + 1] !== '(') {
          cursor = labelStart + 1;
          continue;
        }

        const urlStart = labelEnd + 1;
        const urlEnd = findBalancedTokenEnd(text, urlStart, '(', ')');
        if (urlEnd < 0) {
          cursor = labelStart + 1;
          continue;
        }

        tokens.push({
          start: labelStart,
          end: urlEnd + 1,
          displayText: text.slice(labelStart + 1, labelEnd),
          url: text.slice(urlStart + 1, urlEnd),
          raw: text.slice(labelStart, urlEnd + 1),
        });
        cursor = urlEnd + 1;
      }

      return tokens;
    }

    function renderMarkdownLinkHtml(displayText, url, originalMarkdown) {
      const noteId = extractMarginNoteNoteId(url);
      if (noteId) {
        return `<a href="#" class="mn-link" data-note-id="${escapeHtml(noteId)}">${escapeHtml(displayText)}</a>`;
      }

      const normalizedUrl = normalizeLinkUrl(url);
      if (isBlockedExternalUrl(normalizedUrl)) {
        return escapeHtml(originalMarkdown || `[${displayText}](${url})`);
      }

      return `<a href="${escapeHtml(normalizedUrl)}" target="_blank" rel="noopener noreferrer" class="external-link">${escapeHtml(displayText)}</a>`;
    }

    /**
     * 解析 Markdown 链接并转换为可点击的 HTML
     * @param {string} text - 包含 Markdown 链接的文本
     * @returns {string} 转换后的 HTML
     */
    function parseMarkdownLinks(text) {
      if (!text) return '';

      const tokens = extractMarkdownLinkTokens(text);
      if (tokens.length === 0) {
        return escapeHtml(text);
      }

      let result = '';
      let lastIndex = 0;

      tokens.forEach((token) => {
        if (token.start > lastIndex) {
          result += escapeHtml(text.substring(lastIndex, token.start));
        }
        result += renderMarkdownLinkHtml(token.displayText, token.url, token.raw);
        lastIndex = token.end;
      });

      if (lastIndex < text.length) {
        result += escapeHtml(text.substring(lastIndex));
      }

      return result;
    }

    /**
     * 检查文本是否包含 Markdown 链接
     * @param {string} text - 要检查的文本
     * @returns {boolean} 是否包含 Markdown 链接
     */
    function hasMarkdownLinks(text) {
      return extractMarkdownLinkTokens(text).length > 0;
    }

    function stashMarkdownRenderToken(tokens, html) {
      const key = `\uE000${tokens.length}\uE001`;
      tokens.push({ key, html });
      return key;
    }

    function renderMarkdownInline(text) {
      let raw = String(text || '');
      const tokens = [];

      raw = raw.replace(/`([^`\n]+)`/g, (_, code) => (
        stashMarkdownRenderToken(tokens, `<code>${escapeHtml(code)}</code>`)
      ));

      const linkTokens = extractMarkdownLinkTokens(raw);
      if (linkTokens.length > 0) {
        let nextRaw = '';
        let lastIndex = 0;
        linkTokens.forEach((token) => {
          if (token.start > lastIndex) {
            nextRaw += raw.substring(lastIndex, token.start);
          }
          nextRaw += stashMarkdownRenderToken(
            tokens,
            renderMarkdownLinkHtml(token.displayText, token.url, token.raw)
          );
          lastIndex = token.end;
        });
        if (lastIndex < raw.length) {
          nextRaw += raw.substring(lastIndex);
        }
        raw = nextRaw;
      }

      let html = escapeHtml(raw);
      html = html
        .replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/___([^_]+?)___/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>')
        .replace(/~~([^~]+?)~~/g, '<del>$1</del>')
        .replace(/\n/g, '<br>');

      tokens.forEach((token) => {
        html = html.split(token.key).join(token.html);
      });

      return html;
    }

    function renderMarkdownBlocks(text) {
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      const blocks = [];
      let index = 0;

      function readParagraph(startIndex) {
        const paragraphLines = [];
        let cursor = startIndex;
        while (cursor < lines.length && lines[cursor].trim()) {
          paragraphLines.push(lines[cursor]);
          cursor += 1;
        }
        return {
          html: `<p>${renderMarkdownInline(paragraphLines.join('\n'))}</p>`,
          nextIndex: cursor,
        };
      }

      while (index < lines.length) {
        const line = lines[index] || '';
        const trimmed = line.trim();

        if (!trimmed) {
          index += 1;
          continue;
        }

        if (/^\s*```/.test(line)) {
          const fence = line.replace(/^\s*```/, '').trim().split(/\s+/)[0] || '';
          const language = fence.replace(/[^A-Za-z0-9_-]/g, '');
          const codeLines = [];
          index += 1;
          while (index < lines.length && !/^\s*```/.test(lines[index])) {
            codeLines.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
          blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
          continue;
        }

        const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          blocks.push(`<h${level}>${renderMarkdownInline(headingMatch[2])}</h${level}>`);
          index += 1;
          continue;
        }

        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          blocks.push('<hr>');
          index += 1;
          continue;
        }

        if (/^\s*>\s?/.test(line)) {
          const quoteLines = [];
          while (index < lines.length && (/^\s*>\s?/.test(lines[index]) || !String(lines[index] || '').trim())) {
            const quoteLine = lines[index] || '';
            quoteLines.push(String(quoteLine).trim() ? String(quoteLine).replace(/^\s*>\s?/, '') : '');
            index += 1;
          }
          blocks.push(`<blockquote>${renderMarkdownBlocks(quoteLines.join('\n'))}</blockquote>`);
          continue;
        }

        if (/^\s*[-*+]\s+/.test(line)) {
          const items = [];
          while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
            items.push(`<li>${renderMarkdownInline(String(lines[index] || '').replace(/^\s*[-*+]\s+/, ''))}</li>`);
            index += 1;
          }
          blocks.push(`<ul>${items.join('')}</ul>`);
          continue;
        }

        if (/^\s*\d+\.\s+/.test(line)) {
          const items = [];
          while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
            items.push(`<li>${renderMarkdownInline(String(lines[index] || '').replace(/^\s*\d+\.\s+/, ''))}</li>`);
            index += 1;
          }
          blocks.push(`<ol>${items.join('')}</ol>`);
          continue;
        }

        const paragraph = readParagraph(index);
        blocks.push(paragraph.html);
        index = paragraph.nextIndex;
      }

      return blocks.join('') || '<p>&nbsp;</p>';
    }

    function renderMarkdownPreview(text) {
      return renderMarkdownBlocks(text);
    }

    function stripHtml(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent || div.innerText || '';
    }

    function removeCssPrefix(text) {
      if (!text) return '';
      const parts = text.split('}');
      if (parts.length === 1) return text.trim();
      for (let i = parts.length - 1; i >= 0; i--) {
        const piece = parts[i].trim();
        if (piece) return piece;
      }
      return text.trim();
    }

    function formatHtmlPreview(html) {
      if (!html) return '';
      // 移除 style/script 标签
      const cleaned = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
      const plain = stripHtml(cleaned).trim();
      return removeCssPrefix(plain);
    }

    // ========================================
