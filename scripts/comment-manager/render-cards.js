    // 创建评论卡片
    // ========================================
    const HTML_MARKDOWN_TYPE_ICON_MAP = {
      danger: '❗❗❗',
      level1: '🚩',
      level2: '▸',
      level3: '▪',
      level4: '•',
      level5: '·',
      key: '🔑',
      alert: '⚠️',
      remark: '📝',
      goal: '🎯',
      question: '❓',
      idea: '💡',
      method: '✨',
      check: '🔍',
      sketch: '✏️',
      case: '📋',
      step: '👣',
    };

    function supportsCopyButton(comment) {
      return !!comment && (comment.originalType === 'TextNote' || comment.originalType === 'HtmlNote');
    }

    function supportsPinButton(comment) {
      return !!comment && comment.originalType === 'TextNote';
    }

    function createCommentHeaderHTML(comment, options = {}) {
      const {
        icon = '💬',
        label = '评论',
        includeIndex = true,
        allowCopy = false,
        allowPin = false,
      } = options;

      const actions = [];
      if (allowCopy && supportsCopyButton(comment)) {
        actions.push(`<button class="copy-comment-btn" data-index="${comment.index}" title="复制文本">📋</button>`);
      }
      if (allowPin && supportsPinButton(comment)) {
        actions.push(`<button class="pin-comment-btn" data-index="${comment.index}" title="Pin 到 MNPinner（文本）">📌</button>`);
      }

      const safeIndex = escapeHtml(String(comment.index));
      const safeLabel = escapeHtml(label);

      return `
        <div class="comment-header">
          <input type="checkbox" class="comment-checkbox">
          <span class="comment-icon">${icon}</span>
          ${includeIndex ? `<span class="comment-index">${safeIndex}</span>` : ''}
          <span class="comment-type-label">${safeLabel}</span>
          ${actions.join('')}
        </div>
      `;
    }

    function shouldCollapseCommentPreview(text) {
      return String(text || '').length > COMMENT_PREVIEW_COLLAPSE_THRESHOLD;
    }

    function createPreviewBlockHTML(contentHtml, options = {}) {
      const {
        plainText = '',
        allowHtml = false,
        extraContent = '',
        previewClass = '',
        collapsible = true,
      } = options;

      const needExpand = collapsible && shouldCollapseCommentPreview(plainText);
      const previewClassName = previewClass ? ` ${previewClass}` : '';
      return `
        <div class="comment-content">
          <div class="comment-preview${previewClassName} ${needExpand ? 'collapsed' : ''}"${allowHtml ? ' data-allow-html="true"' : ''}>
            ${contentHtml}
          </div>
          ${needExpand ? '<button class="expand-btn">展开</button>' : ''}
          ${extraContent}
        </div>
      `;
    }

    function createImagePreviewHTML(imageSrc, options = {}) {
      const {
        alt = '图片评论',
        missingText = '图片数据缺失',
        errorText = '图片加载失败',
        extraClass = '',
      } = options;

      if (!imageSrc) {
        return `
          <div class="comment-content">
            <div class="comment-preview">${escapeHtml(missingText)}</div>
          </div>
        `;
      }

      const safeAlt = escapeHtml(alt);
      const safeErrorText = escapeHtml(errorText);
      const extraClassName = extraClass ? ` ${extraClass}` : '';

      return `
        <div class="comment-content">
          <div class="comment-preview">
            <img src="${imageSrc}" class="thumbnail${extraClassName}" alt="${safeAlt}" ${COMMENT_MEDIA_ERROR_ATTR}="${safeErrorText}">
          </div>
        </div>
      `;
    }

    function createMarkdownLinkSubitemsHTML(comment) {
      const links = Array.isArray(comment && comment.markdownLinks) ? comment.markdownLinks : [];
      if (links.length === 0) return '';

      const linkItems = links.map((link, idx) => `
        <div class="link-subitem">
          <span class="link-index">${idx + 1}.</span>
          <span class="link-display-text">[${escapeHtml(link.displayText)}]</span>
          <span class="link-arrow">→</span>
          <span class="link-target-title">${escapeHtml(link.linkedNoteTitle)}</span>
          <div class="link-actions">
            <button class="link-locate-btn" data-note-id="${escapeHtml(link.noteId)}" title="单击：在主脑图显示；长按：在浮动窗口显示" aria-label="显示链接目标">📍</button>
            <button class="link-update-btn"
                    data-comment-index="${comment.index}"
                    data-link-index="${idx}"
                    title="读取剪贴板链接并更新当前链接"
                    aria-label="更新当前链接">🔄</button>
            <button class="placeholder-replace-btn"
                    data-comment-index="${comment.index}"
                    data-link-index="${idx}"
                    title="占位替换：更新链接并删除旧目标卡片"
                    aria-label="占位替换并删除旧卡片">♻️</button>
            <button class="link-edit-btn"
                    data-comment-index="${comment.index}"
                    data-link-index="${idx}"
                    data-display-text="${encodeURIComponent(link.displayText || '')}"
                    data-link-url="${encodeURIComponent(link.url || '')}"
                    title="编辑链接">✏️</button>
          </div>
        </div>
      `).join('');

      return `
        <div class="link-subitems-container">
          <div class="link-subitems-header">📎 链接子项 (${links.length})</div>
          <div class="link-subitems-list">${linkItems}</div>
        </div>
      `;
    }

    function normalizeMarkdownCommentRawText(text) {
      let cleanText = text || '';
      if (cleanText.startsWith('- ')) {
        cleanText = cleanText.slice(2);
      }
      return cleanText;
    }

    function resolveMarkdownCommentRenderer(comment) {
      const cleanText = normalizeMarkdownCommentRawText(comment && comment.text);
      if (cleanText.startsWith('<span')) {
        return createHtmlMarkdownCardContent;
      }
      return createMarkdownCardContent;
    }

    function normalizeImageSource(imageValue, fallbackMimeType = 'image/jpeg') {
      if (!imageValue) return '';
      const raw = String(imageValue).trim();
      if (!raw) return '';
      if (/^data:/i.test(raw)) return raw;
      return `data:${fallbackMimeType};base64,${raw}`;
    }

    function getCommentMediaSources(comment) {
      const sources = [];
      const imageSource = normalizeImageSource(
        comment && comment.imageBase64,
        (comment && comment.imageMimeType) || 'image/jpeg',
      );
      const drawingSource = comment && comment.drawingPreviewDataURI
        ? String(comment.drawingPreviewDataURI).trim()
        : '';
      if (imageSource) sources.push({ kind: 'image', src: imageSource });
      if (drawingSource && drawingSource !== imageSource) {
        sources.push({ kind: 'drawing', src: drawingSource });
      }
      return sources;
    }

    function createCommentMediaPreviewHTML(comment, options = {}) {
      const {
        alt = '评论媒体',
        missingText = '媒体数据缺失',
        errorText = '媒体加载失败',
        extraClass = '',
      } = options;
      const sources = getCommentMediaSources(comment);
      const drawingPending = comment && comment.drawingPreviewPending === true;
      const drawingError = comment && comment.drawingPreviewError
        ? String(comment.drawingPreviewError)
        : '';
      if (sources.length === 0) {
        const statusText = drawingPending
          ? '手写内容正在转换，完成后将自动刷新'
          : drawingError
            ? `手写内容加载失败：${drawingError}`
            : missingText;
        const statusClass = drawingPending ? ' media-converting' : (drawingError ? ' media-error' : '');
        return `
          <div class="comment-content">
            <div class="comment-preview${statusClass}">${escapeHtml(statusText)}</div>
          </div>
        `;
      }

      const safeErrorText = escapeHtml(errorText);
      const extraClassName = extraClass ? ` ${extraClass}` : '';
      const images = sources.map((media) => {
        const mediaAlt = media.kind === 'drawing' ? `${alt}手写预览` : alt;
        return `<img src="${media.src}" class="thumbnail media-preview-${media.kind}${extraClassName}" alt="${escapeHtml(mediaAlt)}" ${COMMENT_MEDIA_ERROR_ATTR}="${safeErrorText}" loading="lazy">`;
      }).join('');
      const pendingStatus = drawingPending
        ? '<div class="media-converting">手写内容正在转换，完成后将自动刷新</div>'
        : '';

      return `
        <div class="comment-content">
          <div class="comment-preview media-preview-grid media-count-${sources.length}">
            ${images}
          </div>
          ${pendingStatus}
        </div>
      `;
    }

    const commentContentRenderers = {
      textComment: createTextCardContent,
      tagComment: createTextCardContent,
      markdownLinkComment: createMarkdownLinkCardContent,
      imageComment: createImageCardContent,
      imageCommentWithDrawing: createImageWithDrawingCardContent,
      linkComment: createLinkCardContent,
      linkToNote: createLinkCardContent,
      summaryComment: createLinkCardContent,
      mergedImageComment: createMergedCardContent,
      mergedImageCommentWithDrawing: createMergedCardContent,
      mergedTextComment: createMergedTextCardContent,
      mergedMarkdownComment: createMarkdownCardContent,
      blankTextComment: createBlankCardContent,
      blankImageComment: createBlankCardContent,
      drawingComment: createDrawingCardContent,
      HtmlComment: createHtmlCardContent,
      audioComment: createAudioCardContent,
      unknownComment: createUnknownCardContent,
    };

    function resolveCommentRenderer(comment) {
      if (!comment) return createTextCardContent;
      if (comment.type === 'markdownComment' || comment.type === 'mergedMarkdownComment') {
        return resolveMarkdownCommentRenderer(comment);
      }
      return commentContentRenderers[comment.type] || createTextCardContent;
    }

    function createCommentCard(comment) {
      const card = document.createElement('div');
      card.className = 'comment-card';
      card.dataset.index = comment.index;
      card.dataset.type = comment.type;

      const renderer = resolveCommentRenderer(comment);
      card.innerHTML = renderer(comment);
      appendQuickMoveControls(card, comment);
      return card;
    }

    function appendQuickMoveControls(card, comment) {
      if (!card || !comment) return;

      const commentIndex = normalizeCommentIndex(comment.index);
      if (Number.isNaN(commentIndex)) return;

      const header = card.querySelector('.comment-header');
      if (!header) return;

      const controls = document.createElement('div');
      controls.className = 'comment-order-controls';

      const hasHeaderActionButtons = !!header.querySelector('.copy-comment-btn, .pin-comment-btn');
      if (!hasHeaderActionButtons) {
        controls.classList.add('push-right');
      }

      const position = getCommentPositionByIndex(commentIndex);
      const isFirst = position === 0;
      const isLast = position >= 0 && position === state.comments.length - 1;

      controls.innerHTML = `
        <button class="quick-move-btn${isFirst ? ' disabled' : ''}" data-index="${commentIndex}" data-direction="up" title="单击上移一位，长按置顶"${isFirst ? ' disabled aria-disabled="true"' : ''}>↑</button>
        <button class="quick-move-btn${isLast ? ' disabled' : ''}" data-index="${commentIndex}" data-direction="down" title="单击下移一位，长按置底"${isLast ? ' disabled aria-disabled="true"' : ''}>↓</button>
      `;

      header.appendChild(controls);
    }

    function getCommentPositionByIndex(commentIndex) {
      const normalized = normalizeCommentIndex(commentIndex);
      if (Number.isNaN(normalized)) return -1;

      if (commentPositionByIndex && commentPositionByIndex.has(normalized)) {
        return commentPositionByIndex.get(normalized);
      }

      const comments = Array.isArray(state.comments) ? state.comments : [];
      for (let i = 0; i < comments.length; i++) {
        const currentIndex = normalizeCommentIndex(comments[i] && comments[i].index);
        if (currentIndex === normalized) return i;
      }

      return -1;
    }

    // ========================================
    // 创建不同类型的卡片内容
    // ========================================
    function createTextCardContent(comment) {
      const typeInfo = getTypeInfo('textComment');
      const text = comment.text || '';

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
          allowCopy: true,
          allowPin: true,
        })}
        ${createPreviewBlockHTML(escapeHtml(text), {
          plainText: text,
        })}
      `;
    }

    function createHtmlMarkdownCardContent(comment) {
      const cleanText = normalizeMarkdownCommentRawText(comment.text);
      const typeMatch = cleanText.match(/<span\s*id="([^"]*)"/);
      const htmlMarkdownType = typeMatch && typeMatch[1] ? typeMatch[1].trim() : 'unknown';

      const contentMatch = cleanText.match(/<span[^>]*>([\s\S]*?)<\/span>/);
      let content = contentMatch && contentMatch[1] ? contentMatch[1].trim() : cleanText;
      if (typeof decodeHtmlEntities === 'function') {
        content = decodeHtmlEntities(content);
      }

      ['❗❗❗', '🚩', '▸', '▪', '•', '·', '🔑', '⚠️', '📝', '🎯', '❓', '💡', '✨', '🔍', '✏️', '📋', '👣']
        .forEach((emoji) => {
          content = content.replace(emoji, '').trim();
        });

      ['思路：', '方法：', 'CHECK: ', 'CHECK', 'SKETCH: ', 'SKETCH'].forEach((prefix) => {
        if (content.startsWith(prefix)) {
          content = content.slice(prefix.length).trim();
        }
      });

      const icon = HTML_MARKDOWN_TYPE_ICON_MAP[htmlMarkdownType] || '📌';
      const hasLinks = hasMarkdownLinks(content);
      const renderedContent = typeof renderMarkdownPreview === 'function'
        ? renderMarkdownPreview(content)
        : (hasLinks ? parseMarkdownLinks(content) : escapeHtml(content));

      return `
        ${createCommentHeaderHTML(comment, {
          icon,
          label: `HtmlMD: ${htmlMarkdownType}`,
          allowCopy: true,
          allowPin: true,
        })}
        ${createPreviewBlockHTML(renderedContent, {
          plainText: content,
          allowHtml: true,
          extraContent: createMarkdownLinkSubitemsHTML(comment),
          previewClass: 'markdown-rendered-content htmlmd-rendered-content',
        })}
      `;
    }

    function createMarkdownCardContent(comment) {
      const text = comment.text || '';
      const renderedContent = typeof renderMarkdownPreview === 'function'
        ? renderMarkdownPreview(text)
        : parseMarkdownLinks(text);

      return `
        ${createCommentHeaderHTML(comment, {
          icon: '📝',
          label: 'Markdown',
          allowCopy: true,
          allowPin: true,
        })}
        ${createPreviewBlockHTML(renderedContent, {
          plainText: text,
          allowHtml: true,
          extraContent: createMarkdownLinkSubitemsHTML(comment),
          previewClass: 'markdown-rendered-content markdown-link-content',
          collapsible: false,
        })}
      `;
    }

    function createMarkdownLinkCardContent(comment) {
      return createMarkdownCardContent(comment);
    }

    function createImageCardContent(comment) {
      const typeInfo = getTypeInfo('imageComment');
      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
        })}
        ${createCommentMediaPreviewHTML(comment, {
          alt: '图片评论',
          missingText: '图片数据缺失',
          errorText: '图片加载失败',
        })}
      `;
    }

    function createImageWithDrawingCardContent(comment) {
      const typeInfo = getTypeInfo('imageCommentWithDrawing');

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
        })}
        ${createCommentMediaPreviewHTML(comment, {
          alt: '图片和手写内容',
          missingText: '图片或手写数据缺失',
          errorText: '图片或手写内容加载失败',
        })}
      `;
    }

    function createLinkCardContent(comment) {
      const typeInfo = getTypeInfo(comment.type === 'summaryComment' ? 'summaryComment' : 'linkComment');
      const linkedNoteId = comment.linkedNoteId || extractMarginNoteNoteId(comment.linkedNoteUrl || comment.text || '');
      const linkTitle = linkedNoteId
        ? '单击：在主脑图显示；长按：在浮动窗口显示'
        : '未识别到目标卡片 ID';
      const linkButton = linkedNoteId
        ? `<button class="link-locate-btn" data-note-id="${escapeHtml(linkedNoteId)}" title="${linkTitle}" aria-label="显示链接目标">📍</button>`
        : '';
      const updateButton = linkedNoteId
        ? `<button class="link-update-btn" data-comment-index="${comment.index}" title="读取剪贴板链接并更新当前链接" aria-label="更新当前链接">🔄</button>`
        : '';
      const placeholderReplaceButton = linkedNoteId
        ? `<button class="placeholder-replace-btn" data-comment-index="${comment.index}" title="占位替换：更新链接并删除旧目标卡片" aria-label="占位替换并删除旧卡片">♻️</button>`
        : '';

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
        })}
        <div class="comment-content">
          <div class="comment-preview">
            <div class="link-target" title="${linkTitle}">
              <span class="link-arrow">→</span>
              <span>${escapeHtml(comment.linkedNoteTitle || '未知卡片')}</span>
              <div class="link-actions">${linkButton}${updateButton}${placeholderReplaceButton}</div>
            </div>
          </div>
        </div>
      `;
    }

    function createDrawingCardContent(comment) {
      const typeInfo = getTypeInfo('drawingComment');

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
        })}
        ${createCommentMediaPreviewHTML(comment, {
          alt: '手写内容',
          missingText: '手写数据缺失',
          errorText: '手写内容加载失败',
        })}
      `;
    }

    function createHtmlCardContent(comment) {
      const typeInfo = getTypeInfo('HtmlComment');
      const text = formatHtmlPreview(comment.htmlText || comment.text || '');

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
          allowCopy: true,
          allowPin: false,
        })}
        ${createPreviewBlockHTML(escapeHtml(text), {
          plainText: text,
        })}
      `;
    }

    function createMergedCardContent(comment) {
      const typeInfo = getTypeInfo(comment.type || 'mergedImageComment');
      const mediaSources = getCommentMediaSources(comment);
      let content = '';

      if (mediaSources.length > 0) {
        content = createCommentMediaPreviewHTML(comment, {
          alt: '合并内容',
          missingText: '图片数据缺失',
          errorText: '合并内容加载失败',
          extraClass: 'merged-thumbnail',
        });
      } else if (comment.text) {
        content = createPreviewBlockHTML(escapeHtml(comment.text), {
          plainText: comment.text,
        });
      } else {
        content = `
          <div class="comment-content">
            <div class="comment-preview">（空内容）</div>
          </div>
        `;
      }

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
          includeIndex: false,
        })}
        ${content}
      `;
    }

    function createMergedTextCardContent(comment) {
      const typeInfo = getTypeInfo('mergedTextComment');
      const text = comment.text || '';

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
        })}
        ${createPreviewBlockHTML(escapeHtml(text || '（空合并文本）'), {
          plainText: text,
        })}
      `;
    }

    function createBlankCardContent(comment) {
      const typeInfo = getTypeInfo(comment.type || 'blankTextComment');

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
        })}
        <div class="comment-content">
          <div class="comment-preview">（空内容）</div>
        </div>
      `;
    }

    function createAudioCardContent(comment) {
      const typeInfo = getTypeInfo('audioComment');

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: typeInfo.label,
        })}
        <div class="comment-content">
          <div class="comment-preview">
            ${escapeHtml(comment.text || '(音频评论)')}
          </div>
        </div>
      `;
    }

    function createUnknownCardContent(comment) {
      const typeInfo = getTypeInfo('unknownComment');
      const rawType = comment && comment.originalType ? ` / ${comment.originalType}` : '';
      const text = comment && comment.text ? comment.text : '';

      return `
        ${createCommentHeaderHTML(comment, {
          icon: typeInfo.icon,
          label: `${typeInfo.label}${rawType}`,
        })}
        ${createPreviewBlockHTML(escapeHtml(text || '无法识别的评论类型'), {
          plainText: text,
        })}
      `;
    }

    // ========================================
    // 辅助函数：获取类型信息
    // ========================================
    function getTypeInfo(type) {
      const typeMap = {
        'textComment': { icon: '📝', label: '文本' },
        'tagComment': { icon: '#', label: '标签' },
        'markdownComment': { icon: '📝', label: 'Markdown' },
        'markdownLinkComment': { icon: '📝', label: 'Markdown' },
        'mergedMarkdownComment': { icon: '📝', label: '合并 Markdown' },
        'imageComment': { icon: '🖼️', label: '图片' },
        'imageCommentWithDrawing': { icon: '🖼️', label: '图片+手写' },
        'linkComment': { icon: '🔗', label: '双向链接' },
        'linkToNote': { icon: '🔗', label: '链接笔记' },
        'summaryComment': { icon: '🔗', label: '概要链接' },
        'mergedImageComment': { icon: '🖼️', label: '摘录' },  // 新增
        'mergedImageCommentWithDrawing': { icon: '🖼️', label: '摘录+手写' },
        'mergedTextComment': { icon: '📎', label: '合并文本摘录' },
        'drawingComment': { icon: '✍️', label: '手写' },
        'HtmlComment': { icon: '📄', label: 'HTML' },
        'audioComment': { icon: '🎵', label: '音频' },  // 新增
        'blankTextComment': { icon: '⬜', label: '空文本' },  // 新增
        'blankImageComment': { icon: '⬜', label: '空图片' },
        'unknownComment': { icon: '❔', label: '未知类型' }
      };

      return typeMap[type] || { icon: '💬', label: '评论' };
    }

    // ========================================
