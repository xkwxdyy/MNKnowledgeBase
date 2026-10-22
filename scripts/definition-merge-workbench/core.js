(function(global) {
  'use strict';

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function nodeId(node) {
    return text(node && (node.noteId || node.id)).trim();
  }

  function sourceNodes(model) {
    return Array.isArray(model && model.sourceNodes) ? model.sourceNodes : [];
  }

  function targetNodes(model) {
    return Array.isArray(model && model.targetNodes) ? model.targetNodes : [];
  }

  function isClassificationChild(child) {
    return child && (child.isClassification === true || text(child.kind || child.type) === '归类');
  }

  function knowledgeChildren(node) {
    var children = Array.isArray(node && node.knowledgeChildren)
      ? node.knowledgeChildren
      : (Array.isArray(node && node.children) ? node.children : []);
    return children.filter(function(child) {
      return nodeId(child) && !isClassificationChild(child);
    });
  }

  function knowledgeEntries(nodes) {
    var entries = [];
    nodes.forEach(function(parent) {
      var parentId = nodeId(parent);
      knowledgeChildren(parent).forEach(function(child) {
        entries.push({ note: child, noteId: nodeId(child), parentId: parentId });
      });
    });
    return entries;
  }

  function createDefaultMappings(model) {
    return new Map(sourceNodes(model).map((node) => [nodeId(node), 'move']));
  }

  function normalizeMappings(model, mappings) {
    const sourceIds = new Set(sourceNodes(model).map(nodeId).filter(Boolean));
    const targetIds = new Set(targetNodes(model).map(nodeId).filter(Boolean));
    const normalized = [];
    sourceIds.forEach((sourceId) => {
      const rawTarget = mappings && typeof mappings.get === 'function' ? mappings.get(sourceId) : null;
      normalized.push({
        sourceId,
        targetId: rawTarget && rawTarget !== 'move' && targetIds.has(text(rawTarget))
          ? text(rawTarget)
          : 'move',
      });
    });
    return normalized;
  }

  function normalizeKnowledgeMappings(model, mappings, knowledgeMappings) {
    var normalizedClassifications = Array.isArray(mappings) ? mappings : normalizeMappings(model, mappings);
    var classificationMappings = new Map(normalizedClassifications.map(function(mapping) {
      return [mapping.sourceId, mapping.targetId];
    }));
    var sourceEntries = knowledgeEntries(sourceNodes(model));
    var targetEntries = knowledgeEntries(targetNodes(model));
    var sourceById = new Map(sourceEntries.map(function(entry) { return [entry.noteId, entry]; }));
    var targetById = new Map(targetEntries.map(function(entry) { return [entry.noteId, entry]; }));
    var seen = new Set();
    var normalized = [];
    var values = knowledgeMappings && typeof knowledgeMappings.entries === 'function'
      ? Array.from(knowledgeMappings.entries()).map(function(entry) { return { sourceId: entry[0], targetId: entry[1] }; })
      : (Array.isArray(knowledgeMappings) ? knowledgeMappings : []);
    values.forEach(function(mapping) {
      var sourceId = text(mapping && mapping.sourceId !== undefined ? mapping.sourceId : mapping && mapping[0]).trim();
      var targetId = text(mapping && mapping.targetId !== undefined ? mapping.targetId : mapping && mapping[1]).trim();
      var source = sourceById.get(sourceId);
      var target = targetById.get(targetId);
      if (!source || !target || seen.has(sourceId) || sourceId === targetId) return;
      if (classificationMappings.get(source.parentId) !== target.parentId) return;
      seen.add(sourceId);
      normalized.push({ sourceId: sourceId, targetId: targetId });
    });
    return normalized;
  }

  function buildPlan(model, state) {
    const sourceDefinition = model && model.sourceDefinition ? model.sourceDefinition : {};
    const targetDefinition = model && model.targetDefinition ? model.targetDefinition : {};
    const mappings = normalizeMappings(model, state && state.mappings);
    const knowledgeMappings = normalizeKnowledgeMappings(model, mappings, state && state.knowledgeMappings);
    const sourceById = new Map(sourceNodes(model).map((node) => [nodeId(node), node]));
    const paired = mappings.filter((mapping) => mapping.targetId !== 'move');
    const moved = mappings.filter((mapping) => mapping.targetId === 'move');
    const pairedKnowledge = paired.reduce((sum, mapping) => {
      const source = sourceById.get(mapping.sourceId);
      return sum + (Number(source && source.knowledgeCount) || 0);
    }, 0);
    const movedKnowledge = Math.max(0, pairedKnowledge - knowledgeMappings.length);
    const titleMode = state && state.titleMode === 'target' ? 'target' : 'source';
    return {
      baseRevision: text(model && model.revision),
      sourceDefinitionId: nodeId(sourceDefinition),
      targetDefinitionId: nodeId(targetDefinition),
      titleMode,
      keepAliases: !(state && state.keepAliases === false),
      prefixMode: 'knowledge',
      mappings,
      knowledgeMappings,
      pairedCount: paired.length,
      movedTreeCount: moved.length,
      movedKnowledgeCount: movedKnowledge,
      mergedKnowledgeCount: knowledgeMappings.length,
      deletedCount: paired.length + knowledgeMappings.length + 1,
      finalTitle: titleMode === 'source'
        ? text(sourceDefinition.title)
        : text(targetDefinition.title),
    };
  }

  function validatePlan(model, plan) {
    const errors = [];
    if (model && model.canExecute === false) errors.push('当前卡片不能执行合并，请刷新');
    const sourceDefinitionId = nodeId(model && model.sourceDefinition);
    const targetDefinitionId = nodeId(model && model.targetDefinition);
    if (!sourceDefinitionId || !targetDefinitionId) errors.push('缺少来源或目标定义卡');
    if (sourceDefinitionId && sourceDefinitionId === targetDefinitionId) errors.push('来源和目标不能相同');
    if (!plan || text(plan.baseRevision) !== text(model && model.revision)) errors.push('工作台数据已变化');
    if (!plan || plan.sourceDefinitionId !== sourceDefinitionId || plan.targetDefinitionId !== targetDefinitionId) {
      errors.push('合并上下文不一致');
    }
    const sourceIds = new Set(sourceNodes(model).map(nodeId).filter(Boolean));
    const targetIds = new Set(targetNodes(model).map(nodeId).filter(Boolean));
    const mappingBySource = new Map();
    const seen = new Set();
    const mappings = Array.isArray(plan && plan.mappings) ? plan.mappings : [];
    mappings.forEach((mapping) => {
      const sourceId = text(mapping && mapping.sourceId);
      const targetId = text(mapping && mapping.targetId);
      if (!sourceIds.has(sourceId)) errors.push(`来源归类不存在：${sourceId || '空'}`);
      if (seen.has(sourceId)) errors.push(`来源归类重复：${sourceId}`);
      if (targetId !== 'move' && !targetIds.has(targetId)) errors.push(`目标归类不存在：${targetId || '空'}`);
      mappingBySource.set(sourceId, targetId);
      seen.add(sourceId);
    });
    sourceIds.forEach((sourceId) => {
      if (!seen.has(sourceId)) errors.push(`来源归类未处理：${sourceId}`);
    });
    const sourceKnowledge = new Map(knowledgeEntries(sourceNodes(model)).map(function(entry) { return [entry.noteId, entry]; }));
    const targetKnowledge = new Map(knowledgeEntries(targetNodes(model)).map(function(entry) { return [entry.noteId, entry]; }));
    const knowledgeSeen = new Set();
    const knowledgeMappings = Array.isArray(plan && plan.knowledgeMappings) ? plan.knowledgeMappings : [];
    knowledgeMappings.forEach(function(mapping) {
      const sourceId = text(mapping && mapping.sourceId).trim();
      const targetId = text(mapping && mapping.targetId).trim();
      const source = sourceKnowledge.get(sourceId);
      const target = targetKnowledge.get(targetId);
      if (!source || !target) errors.push(`知识点映射不存在：${sourceId || targetId || '空'}`);
      if (knowledgeSeen.has(sourceId)) errors.push(`来源知识点重复：${sourceId}`);
      if (sourceId && sourceId === targetId) errors.push(`知识点不能合并到自身：${sourceId}`);
      if (source && target && mappingBySource.get(source.parentId) !== target.parentId) {
        errors.push(`知识点目标不属于已配对归类：${sourceId}`);
      }
      knowledgeSeen.add(sourceId);
    });
    if (plan && plan.prefixMode !== 'knowledge') errors.push('当前版本只支持更新换父知识点前缀');
    return { valid: errors.length === 0, errors };
  }

  function makeRequestId(prefix) {
    return `${prefix || 'definition-merge'}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  global.DefinitionMergeCore = {
    buildPlan,
    createDefaultMappings,
    makeRequestId,
    normalizeMappings,
    validatePlan,
  };
})(window);
