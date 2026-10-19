'use strict';

// 默认配置 - 分层级预设结构
const DEFAULT_PRESET_GROUPS = [
  {
    name: '归类关键词',
    icon: '📦',
    presets: [
      { value: '基本性质' },
      { value: '判定：充分条件' },
      { value: '判定：等价刻画/充要条件' }
      // {
      //   value: '判定',
      //   children: [
      //     { value: '判定：充分条件' },
      //     { value: '判定：等价刻画/充要条件' }
      //   ]
      // }
    ]
  },
  // {
  //   name: '空间',
  //   icon: '🌍',
  //   type: 'exclusive', 
  //   presets: [
  //     { 
  //       value: '拓扑空间',
  //       children: [
  //         { value: '开集' },
  //         { value: '闭集' },
  //         { value: '紧集' },
  //         { value: '内部' },
  //         { value: '闭包' },
  //         { value: '邻域' },
  //         { value: '开邻域' },
  //         { value: '边界' },
  //         { value: '疏朗集' },
  //         { value: '第一纲集' },
  //         { value: '第二纲集' }
  //       ]
  //     },
  //     { value: '度量空间',
  //       children: [
  //         { value: '开球' },
  //         { value: '闭球' },
  //         { value: '球面' },
  //         { value: '开单位球' },
  //         { value: '闭单位球' },
  //         { value: '单位球面' },
  //         { value: '开集' },
  //         { value: '闭集' },
  //         { value: '紧集' },
  //         { value: '列紧集' },
  //         { value: '相对列紧集' },
  //         { value: '内部' },
  //         { value: '闭包' },
  //         { value: '邻域' },
  //         { value: '开邻域' },
  //         { value: '边界' },
  //         { value: '疏朗集' },
  //         { value: '第一纲集' },
  //         { value: '第二纲集' }
  //       ]
  //     },
  //     {
  //       value: '赋范线性空间',
  //       children: [
  //         {
  //           value: '之间的',
  //           children: [
  //             { value: '线性算子' },
  //             { value: '有界线性算子' },
  //             { value: '闭算子' },
  //             { value: '开映射' },
  //             { value: '闭值域算子' },
  //           ]
  //         },
  //         {
  //           value: '到自身的算子',
  //           children: [
  //             { value: '线性算子' },
  //             { value: '有界线性算子' },
  //             { value: '闭算子' },
  //             { value: '开映射' },
  //             { value: '闭值域算子' },
  //           ]
  //         },
  //       ]
  //     },
  //     { 
  //       value: 'Banach 空间',
  //       children: [
  //         {
  //           value: '之间的',
  //           children: [
  //             { value: '线性算子' },
  //             { value: '有界线性算子' },
  //             { value: '闭算子' },
  //             { value: '开映射' },
  //             { value: '闭值域算子' },
  //           ]
  //         },
  //         {
  //           value: '到自身的算子',
  //           children: [
  //             { value: '线性算子' },
  //             { value: '有界线性算子' },
  //             { value: '闭算子' },
  //             { value: '开映射' },
  //             { value: '闭值域算子' },
  //           ]
  //         },
  //       ]
  //     },
  //     { 
  //       value: '内积空间',
  //       children: [
  //         {
  //           value: '到自身的算子',
  //           children: [
  //             { value: '线性算子'},
  //             { value: '有界线性算子'},
  //             { value: '紧算子' },
  //             { value: '伴随算子' },
  //             { value: '正规算子' }
  //           ]
  //         },
  //         {
  //           value: '之间的',
  //           children: [
  //             { value: '线性算子'},
  //             { value: '有界线性算子'},
  //             { value: '紧算子' },
  //             { value: '伴随算子' },
  //           ]
  //         },
  //       ]
  //     },
  //     { 
  //       value: 'Hilbert 空间',
  //       children: [
  //         {
  //           value: '到自身的算子',
  //           children: [
  //             { value: '线性算子'},
  //             { value: '有界线性算子'},
  //             { value: '紧算子' },
  //             { value: '伴随算子' },
  //             { value: '正规算子' }
  //           ]
  //         },
  //         {
  //           value: '之间的',
  //           children: [
  //             { value: '线性算子'},
  //             { value: '有界线性算子'},
  //             { value: '紧算子' },
  //             { value: '伴随算子' },
  //           ]
  //         },
  //       ]
  //     }
  //   ]
  // },
  // {
  //   name: '映射/函数',
  //   icon: '⚡',
  //   type: 'exclusive',  // 互斥组
  //   presets: [
  //     {
  //       value: '映射',
  //       children: [
  //         { value: '线性映射' },
  //         { value: '线性变换' },
  //       ]
  //     },
  //     {
  //       value: '函数',
  //       children: [
  //         { value: '实值函数' },
  //         { value: '复值函数' },
  //         {
  //           value: '泛函',
  //           children: [
  //             { value: '实值泛函' },
  //             { value: '复值泛函' },
  //             {
  //               value: '线性泛函',
  //               children: [
  //                 { value: '实值线性泛函' },
  //                 { value: '复值线性泛函' },
  //                 {
  //                   value: '有界线性泛函',
  //                   children: [
  //                     { value: '实值有界线性泛函' },
  //                     { value: '复值有界线性泛函' }
  //                   ]
  //                 }
  //               ]
  //             }
  //           ]
  //         }
  //       ]
  //     }
  //   ]
  // }
];

const DEFAULT_NEGATIVE_PRESETS = [
  '实', '复',
  '赋范', '单位', '交换',
  "无限维", "有限维",
  'ℝ²', 'ℝ³', 'ℝⁿ',
  "有限", "无限",
  "规范", "单位化", "广义", "ℝ̄", "ℝ̄ⁿ",
  "局部紧"
];

// 同义词统一由 native 注入的本地词库维护。
// 保留空数组是为了兼容旧版 WebView 在索引尚未加载时的初始化路径。
const DEFAULT_SEARCH_SYNONYM_GROUPS = [];

// 对齐 SearchConfig.typePresets，便于后续与 utils.js 保持一致
const RAW_TYPE_LABEL = '未分类';

const DEFAULT_TYPE_FILTERS = [
  { key: 'all', label: '全部类型', types: null },
  { key: 'classifications', label: '归类', types: ['归类'] },
  { key: 'definitions', label: '定义', types: ['定义'] },
  // { key: 'definitionsAndClassifications', label: '定义与归类', types: ['定义', '归类'] },
  // { key: 'knowledge', label: '知识点卡片', types: ['定义', '命题', '例子', '反例', '思想方法', '知识'] },
  { key: 'propositions', label: '命题', types: ['命题'] },
  { key: 'examples', label: '例子', types: ['例子'] },
  { key: 'counterexamples', label: '反例', types: ['反例'] },
  { key: 'methods', label: '思想方法', types: ['思想方法'] },
  { key: 'problems', label: '问题', types: ['问题'] },
  { key: 'literatureReviews', label: '文献综述', types: ['文献综述'] },
  { key: 'citationPoints', label: '引用点', types: ['引用点'] },
  { key: 'structureThreads', label: '结构脉络', types: ['结构脉络'] },
  { key: 'comments', label: '评注', types: ['评注'] },
  { key: 'keyTechniques', label: '关键技法', types: ['关键技法'] },
  { key: 'openProblems', label: '遗留问题', types: ['遗留问题'] },
  { key: 'questions', label: '疑问', types: ['疑问'] },
  { key: 'notation', label: '约定记号', types: ['约定记号'] },
  { key: 'errors', label: '疏漏错误', types: ['疏漏错误'] },
  // { key: 'ideas', label: '思路', types: ['思路'] },
  // { key: 'research', label: '研究进展', types: ['研究进展'] },
  // { key: 'papers', label: '论文', types: ['论文'] },
  // { key: 'untagged', label: RAW_TYPE_LABEL, types: [RAW_TYPE_LABEL] },
];

// 归类子类型的固定选项列表
const DEFAULT_CLASSIFICATION_SUBTYPES = [
  '定义',
  '命题',
  '例子',
  '反例',
  '思想方法'
];

// 颜色映射：优先类型、其次颜色索引，最后回退色
const TYPE_COLOR_MAP = {
  定义: '#7bb8ff',
  命题: '#5569ff',
  例子: '#8f7bff',
  反例: '#ff7b7b',
  归类: '#ffd07b',
  思想方法: '#5bd0a9',
  问题: '#ffa857',
  思路: '#50c4a4',
  研究进展: '#5fa3ff',
  研究: '#5fa3ff',
  论文: '#a36bff',
  书作: '#a36bff',
  作者: '#7bb8ff',
  总结: '#7d8799',
  知识: '#7bb8ff',
  文献综述: '#d47bff',
  引用点: '#4db6ac',
  结构脉络: '#6f9bf6',
  评注: '#e58b67',
  关键技法: '#65bfa0',
  遗留问题: '#d46b6b',
  疑问: '#f0a35b',
  约定记号: '#9b8de5',
  疏漏错误: '#c95d7b',
  未分类: '#b7c2d0',
};

const COLOR_INDEX_PALETTE = {
  0: '#ffd07b',
  1: '#ffb37b',
  2: '#7bb8ff',
  3: '#ff7b7b',
  4: '#ff9db5',
  5: '#5bd0a9',
  6: '#5fa3ff',
  7: '#aa7bff',
  8: '#ff9d4d',
  9: '#339972',
  10: '#5067ff',
  11: '#a36bff',
  12: '#ff914d',
  13: '#4d9dff',
  14: '#ffbf5f',
  15: '#b5bac7',
};

// 假数据：本地预览用，真实环境通过原生注入
const FAKE_CARDS = [
  { id: 'card-1001', title: '机器学习概述', type: '定义', color: '#7bb8ff', searchText: '机器学习 基本概念 监督学习 无监督学习' },
  { id: 'card-1002', title: '深度学习与神经网络', type: '命题', color: '#5569ff', searchText: '深度学习 神经网络 卷积神经网络 CNN RNN 表征 学习' },
  { id: 'card-1003', title: '支持向量机（SVM）', type: '定义', color: '#ff7b7b', searchText: '支持向量机 SVM 分类 算法' },
  { id: 'card-1004', title: '自然语言处理简介', type: '思想方法', color: '#5bd0a9', searchText: '自然语言处理 NLP 词向量 BERT' },
  { id: 'card-1005', title: '卷积 神经 网络 详解', type: '归类', classificationSubtype: '命题', color: '#ffd07b', searchText: '卷积 神经 网络 卷积 池化' },
  { id: 'card-1006', title: '优化算法对比', type: '思想方法', color: '#5bd0a9', searchText: '梯度下降 Adam RMSprop 优化 学习率 调度' },
  { id: 'card-1007', title: '检索系统概念', type: '定义', color: '#7bb8ff', searchText: '信息检索 搜索 排序 倒排索引 查询 扩展' },
  { id: 'card-1008', title: '注意力机制（Attention）', type: '命题', color: '#5569ff', searchText: '注意力 机制 Transformer 自注意力' },
  { id: 'card-1009', title: '半监督学习实例', type: '例子', color: '#8f7bff', searchText: '半监督 学习 实例 应用' },
  { id: 'card-1010', title: 'Evaluation Metrics', type: '定义', color: '#7bb8ff', searchText: 'precision recall F1 score 混淆矩阵' },
  { id: 'card-1011', title: 'Neural Network Architectures', type: '归类', classificationSubtype: '例子', color: '#ffd07b', searchText: 'MLP CNN RNN Transformer architectures' },
  { id: 'card-1012', title: 'Embedding Techniques', type: '例子', color: '#8f7bff', searchText: '词向量 embedding word2vec GloVe BERT' },
  { id: 'card-2001', title: '复 Hilbert 空间 中的性质', type: '命题', color: '#5569ff', searchText: 'Hilbert 空间 复 数 线性 代数 内积 空间' },
  { id: 'card-2002', title: '实 Hilbert 空间 示例', type: '命题', color: '#5569ff', searchText: 'Hilbert 空间 实 数 例子 正交 基' },
  { id: 'card-2003', title: '多项式 回归 的鲁棒性', type: '思想方法', color: '#5bd0a9', searchText: '回归 多项式 回归 过拟合 正则化' },
  { id: 'card-2004', title: '噪声 分析 方法', type: '思想方法', color: '#5bd0a9', searchText: '噪声 信号 过滤 去噪 谱 分析' },
  { id: 'card-2005', title: '异常 值 检测 技术', type: '思想方法', color: '#5bd0a9', searchText: '异常 值 检测 异常 数据 离群 点' },
  { id: 'card-2101', title: '统计学习理论核心问题', type: '问题', color: '#ffa857', searchText: '统计 学习 理论 泛化 能力 VC 维 经验 风险' },
  { id: 'card-2102', title: '梯度消失的排查思路', type: '思路', color: '#50c4a4', searchText: '梯度 消失 激活 函数 批量 归一化 残差 连接 排查 流程' },
  { id: 'card-2103', title: 'Transformer 研究前沿', type: '研究进展', color: '#5fa3ff', searchText: 'Transformer 研究 前沿 多模态 视觉 Transformers 参数 高效 化' },
  { id: 'card-2104', title: '注意力机制综述论文', type: '论文', color: '#a36bff', searchText: '注意力 机制 综述 论文 引用 统计 Transformer 原理' },
  { id: 'card-2105', title: '文献阅读提纲：深度概率模型', type: '归类', classificationSubtype: '定义', color: '#ffd07b', searchText: '深度 概率 模型 结构 学习 变分 推断 综述 提纲' },
  { id: 'card-2106', title: '学习曲线与早停策略', type: '思想方法', color: '#5bd0a9', searchText: '学习 曲线 早停 验证集 过拟合 模型 选择' },
  { id: 'card-2107', title: '张量分解——定义与例子', type: '定义', color: '#7bb8ff', searchText: '张量 分解 定义 Tucker CP 分解 高阶 数据' },
  { id: 'card-2108', title: '张量分解常见反例', type: '反例', color: '#ff7b7b', searchText: '张量 分解 反例 唯一性 失败 情况 反例 构造' },
  { id: 'card-2109', title: '泛函分析入门提纲', type: '归类', classificationSubtype: '命题', color: '#ffd07b', searchText: '泛函 分析 入门 提纲 线性 空间 赋范 空间 Banach' },
  { id: 'card-2110', title: 'Hilbert 空间的典型例子', type: '例子', color: '#8f7bff', searchText: 'Hilbert 空间 例子 L2 空间 Fourier 基 正交 系' },
  { id: 'card-2111', title: 'Hilbert 空间的反例', type: '反例', color: '#ff7b7b', searchText: 'Hilbert 空间 反例 非完备 内积 空间 counterexample' },
  { id: 'card-2112', title: '统计推断的关键定义', type: '定义', color: '#7bb8ff', searchText: '统计 推断 定义 参数 估计 假设 检验 置信 区间' },
  { id: 'card-2113', title: '贝叶斯推断的思想方法', type: '思想方法', color: '#5bd0a9', searchText: '贝叶斯 推断 先验 后验 共轭 分布 不确定性' },
  { id: 'card-2114', title: '模型压缩研究路线', type: '思路', color: '#50c4a4', searchText: '模型 压缩 剪枝 量化 知识 蒸馏 研究 路线' },
  { id: 'card-2115', title: '学习率调度器对比', type: '思想方法', color: '#5bd0a9', searchText: '学习率 调度 余弦 退火 热重启 循环 学习率 SEA' },
  { id: 'card-2116', title: 'ResNet 设计演化史', type: '研究进展', color: '#5fa3ff', searchText: 'ResNet 残差 网络 设计 演化 历史 多分支 架构' },
  { id: 'card-2117', title: '深度学习失败案例收集', type: '反例', color: '#ff7b7b', searchText: '深度 学习 失败 案例 模型 崩溃 对抗 样本' },
];

const FAKE_INTERMEDIATE = [
  { id: 'mid-3001', title: '待整理：测度论阅读思路', type: '思路', color: '#50c4a4', searchText: '测度论 阅读 提纲 任务 清单', isTemplated: false },
  { id: 'mid-3002', title: '待总结：泛函分析术语', type: '问题', color: '#ffa857', searchText: '泛函 分析 术语 待整理 列表', isTemplated: false },
  { id: 'mid-3003', title: '草稿：Hilbert 空间课堂笔记', searchText: 'Hilbert 空间 课堂 笔记 草稿 需要补充', isTemplated: false },
  { id: 'mid-3004', title: '待确认：注意力机制资料收集', type: '知识', color: '#5569ff', searchText: '注意力 机制 资料 收集 参考 链接 待确认', isTemplated: false },
  { id: 'mid-3005', title: '临时：梯度消失实验记录', searchText: '梯度 消失 实验 记录 待总结 结果', isTemplated: false },
  { id: 'mid-3006', title: '尚未分类：随机想法备忘', searchText: '随机 想法 备忘 临时 条目 需要 分类', isTemplated: false },
];

        // ========== 运行时常量 / 面板元数据 ==========
        // 分页相关常量
        const PAGE_SIZE = 50; // 每页显示50条数据
        const INITIAL_PAGE_SIZE = 100; // 初始加载100条，提供更好的初始体验
        const EMPTY_STARTUP_CARDS = [];
const SIDEBAR_HIDDEN_KEY = 'mnkb.sidebarHidden';
const SIDEBAR_WIDTH_KEY = 'mnkb.sidebarWidth';
const SIDEBAR_OPERATION_KEY = 'mnkb.sidebarActiveOperation';
const LOCAL_SEARCH_ROOT_KEY = 'mnkb.localSearchRoot';
        const PANEL_META = {
          merge: {
            storageKey: 'mnkb_merge_options',
            errorLabel: '合并开关',
            domKeys: {
              summary: 'mergeConfigSummary',
              subtitle: 'mergeDuplicateKnowledgeNoteToTargetNoteSubtitle',
              tags: 'mergeModeTags',
              lastAction: 'mergeLastAction',
            },
          },
          move: {
            storageKey: 'mnkb_move_options',
            errorLabel: '移动开关',
            domKeys: {
              summary: 'moveConfigSummary',
              subtitle: 'moveFocusNoteToTargetNoteAsChildSubtitle',
              tags: 'moveModeTags',
              lastAction: 'moveLastAction',
            },
          },
          template: {
            storageKey: 'mnkb_template_options',
            errorLabel: '模板开关',
            domKeys: {
              summary: 'templateConfigSummary',
              subtitle: 'addTemplateToTargetNoteAndMoveFocusNoteAsChildSubtitle',
              tags: 'templateModeTags',
              lastAction: 'templateLastAction',
            },
          },
        };
        const PANEL_STATE_KEYS = {
          merge: 'mergeOptions',
          move: 'moveOptions',
          template: 'templateOptions',
        };

const initialAutoCloseMode = (typeof window.__mnkbAutoCloseModeFromNative === 'undefined')
  ? true
  : !!window.__mnkbAutoCloseModeFromNative;

// ========== 全局状态 ==========
// 暴露到 window 以便原生层访问
window.state = {
  config: {
    presetGroups: JSON.parse(JSON.stringify(DEFAULT_PRESET_GROUPS)),
    negativePresets: DEFAULT_NEGATIVE_PRESETS.slice(),
    synonymGroups: [],
    typeFilters: DEFAULT_TYPE_FILTERS.slice(),
    typeColors: { ...TYPE_COLOR_MAP },
    colorIndexPalette: { ...COLOR_INDEX_PALETTE },
  },
  cards: EMPTY_STARTUP_CARDS.slice(),
  cardLookup: new Map(),
  filteredCards: [],
  filteredCardLookup: new Map(),
  // 局部搜索（以选中卡片为临时根目录搜索子孙卡片）
  localSearchRootId: null,
  localSearchRootTitle: '',
  localSearchDescendantIds: new Set(),
  localSearchLoading: false,
  localSearchRequestId: '',
  aiRecommendationLookup: new Map(),
  activePresets: new Set(),
  activeNegativePresets: new Set(),
  expandedPresets: new Set(),  // 记录展开的预设项
  selectedCardId: null,
  userInput: '',
  searchUsageRoundSeq: 0,
  searchUsageRoundId: '',
  searchUsageAwaitingNewRound: true,
  searchUsageHadNonEmptyInput: false,
  manualExclusionInput: '',
  currentTypeKey: 'all',
  classificationOptions: [],
  currentClassificationSubtype: 'all',
  lastQueryPayload: null,
  // 分页相关状态
  currentPage: 1,
  displayedCards: [],
  hasMore: false,
  isLoadingMore: false,
  isFilteringResults: false,
  isRenderingResults: false,
  loadMoreRevision: 0,
  loadMoreTimerId: null,
  resultWindowStart: 0,
  resultWindowEnd: 0,
  resultWindowTopSegments: [],
  resultWindowBottomSegments: [],
  resultWindowTopSpacerHeight: 0,
  resultWindowBottomSpacerHeight: 0,
  // 排除词相关状态
  exclusionGroups: [],  // 存储排除词组配置
  activeExclusions: null,  // 当前激活的排除词信息
  // 索引模式状态
  indexMode: null,  // 当前索引模式："full"（全量）、"light"（轻量）、"legacy"（旧版）
  metadata: null,  // 完整的 metadata 对象（包含 updateTime, totalCards 等）
  hasRealData: false,
  locateTargetId: null,
  locateOnlyId: null,
  suppressSearchInputFocus: false,
          // 自动关闭模式状态
          autoCloseMode: initialAutoCloseMode,  // 默认启用自动关闭（执行操作后自动关闭窗口）
          // 侧边栏显示状态（桌面端可折叠）
          sidebarHidden: false,
          // AI 推荐（归类/定义父卡片）
          aiRecommendations: [],
          aiRecommendDebug: null,
          aiRecommendLoading: false,
          aiCardSearch: {
            active: false,
            loading: false,
            requestSeq: 0,
            requestId: '',
            query: '',
            analysis: null,
            resultCount: 0,
            error: '',
            localCards: [],
            modelCatalog: null,
            selectedSource: '',
            selectedModel: '',
            modelLoading: false,
            modelReranked: false,
          },
          isRefreshReloading: false,
          refreshReloadingTimerId: null,
          refreshRequestSeq: 0,
          pendingRefreshRequestId: null,
          mergeOptions: {
            removeTitle: false,
            keepOnlyExcerpt: true,
            excerptFromSelection: false,
            position: 'below',
            locateAfterMerge: false,
            linkOldClassification: false,
          },
          moveOptions: {
            makeNote: false,
            addToReview: false,
            locateAfterMove: false,
          },
          templateOptions: {
            locateAfterCreate: false,
          },
          lastActionFeedback: {
            merge: null,
            move: null,
            template: null,
          },
          sidebarActiveOperation: 'merge',
          sidebarWidth: null,
          sidebarResizeSession: null,
        };

// ========== DOM 引用 ==========
// 暴露到 window 以便调试和原生层访问
window.dom = {
  typeSection: document.querySelector('[data-section="type"]'),
  presetSection: document.querySelector('[data-section="preset"]'),
  negativeSection: document.querySelector('[data-section="negative"]'),
  classificationSection: document.querySelector('[data-section="classification"]'),
  filtersPanel: document.getElementById('filtersPanel'),
  filtersBackdrop: document.getElementById('filtersBackdrop'),
  presetBar: document.getElementById('presetBar'),
  typeBar: document.getElementById('typeBar'),
  classificationBar: document.getElementById('classificationBar'),
  negativeBar: document.getElementById('negativeBar'),
  results: document.getElementById('results'),
  searchInput: document.getElementById('searchInput'),
  searchHistoryDropdown: document.getElementById('searchHistoryDropdown'),
  aiCardSearchBtn: document.getElementById('aiCardSearchBtn'),
  aiCardSearchPanel: document.getElementById('aiCardSearchPanel'),
  aiCardSearchConcepts: document.getElementById('aiCardSearchConcepts'),
  aiCardSearchDetails: document.getElementById('aiCardSearchDetails'),
  aiCardSearchStatus: document.getElementById('aiCardSearchStatus'),
  aiCardSearchModelSelect: document.getElementById('aiCardSearchModelSelect'),
  aiCardSearchRefreshModelsBtn: document.getElementById('aiCardSearchRefreshModelsBtn'),
  aiCardSearchCloseBtn: document.getElementById('aiCardSearchCloseBtn'),
  aiCardSearchRetryBtn: document.getElementById('aiCardSearchRetryBtn'),
  excludeInput: document.getElementById('excludeInput'),
  searchCount: document.getElementById('searchCount'),
  selectedCardInfo: document.getElementById('selectedCardInfo'),
  sidebarWorkflowHint: document.getElementById('sidebarWorkflowHint'),
  sidebarEmptyGuide: document.getElementById('sidebarEmptyGuide'),
  locateMNSelectionBtn: document.getElementById('locateMNSelectionBtn'),
          clearBtn: document.getElementById('clearBtn'),
          refreshBtn: document.getElementById('refreshBtn'),
          aiRecommendBtn: document.getElementById('aiRecommendBtn'),
          sidebarPanelBtn: document.getElementById('sidebarPanelBtn'),
          toggleFiltersBtn: document.getElementById('toggleFiltersBtn'),
          clearPresetsBtn: document.getElementById('clearPresetsBtn'),
          clearNegativesBtn: document.getElementById('clearNegativesBtn'),
  toast: document.getElementById('toast'),
  aiRecommendPanel: document.getElementById('aiRecommendPanel'),
  aiRecommendDebug: document.getElementById('aiRecommendDebug'),
  aiRecommendList: document.getElementById('aiRecommendList'),
  aiRecommendClearBtn: document.getElementById('aiRecommendClearBtn'),
  sidebar: document.getElementById('sidebar'),
  sidebarResizeHandle: document.getElementById('sidebarResizeHandle'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  mergeRemoveTitleToggle: document.getElementById('mergeRemoveTitleToggle'),
  mergeKeepOnlyExcerptToggle: document.getElementById('mergeKeepOnlyExcerptToggle'),
  mergeExcerptFromSelectionToggle: document.getElementById('mergeExcerptFromSelectionToggle'),
  mergeLocateAfterToggle: document.getElementById('mergeLocateAfterToggle'),
  mergeLinkOldClassificationToggle: document.getElementById('mergeLinkOldClassificationToggle'),
  mergePositionToggle: document.getElementById('mergePositionToggle'),
  mergeConfigSummary: document.getElementById('mergeConfigSummary'),
  mergeDuplicateKnowledgeNoteToTargetNoteSubtitle: document.getElementById('mergeDuplicateKnowledgeNoteToTargetNoteSubtitle'),
  mergeModeTags: document.getElementById('mergeModeTags'),
  mergeLastAction: document.getElementById('mergeLastAction'),
  moveMakeNoteToggle: document.getElementById('moveMakeNoteToggle'),
  moveAddToReviewToggle: document.getElementById('moveAddToReviewToggle'),
  moveAddToReviewRow: document.getElementById('moveAddToReviewRow'),
  moveLocateAfterToggle: document.getElementById('moveLocateAfterToggle'),
  moveConfigSummary: document.getElementById('moveConfigSummary'),
  moveFocusNoteToTargetNoteAsChildSubtitle: document.getElementById('moveFocusNoteToTargetNoteAsChildSubtitle'),
  moveModeTags: document.getElementById('moveModeTags'),
  moveLastAction: document.getElementById('moveLastAction'),
  templateLocateAfterToggle: document.getElementById('templateLocateAfterToggle'),
  templateConfigSummary: document.getElementById('templateConfigSummary'),
  addTemplateToTargetNoteAndMoveFocusNoteAsChildSubtitle: document.getElementById('addTemplateToTargetNoteAndMoveFocusNoteAsChildSubtitle'),
  templateModeTags: document.getElementById('templateModeTags'),
  templateLastAction: document.getElementById('templateLastAction'),
  // Sidebar 按钮（已移除 focusCardInFloatMindMapBtn 和 copyMarkdownLinkBtn）
  mergeDuplicateKnowledgeNoteToTargetNoteBtn: document.getElementById('mergeDuplicateKnowledgeNoteToTargetNoteBtn'),
  bidirectionalLinkFromeFocusNoteToTargetNoteBtn: document.getElementById('bidirectionalLinkFromeFocusNoteToTargetNoteBtn'),
  moveFocusNoteToTargetNoteAsChildBtn: document.getElementById('moveFocusNoteToTargetNoteAsChildBtn'),
  addTemplateToTargetNoteAndMoveFocusNoteAsChildBtn: document.getElementById('addTemplateToTargetNoteAndMoveFocusNoteAsChildBtn'),
  scrollToTopBtn: document.getElementById('scrollToTopBtn'),
  topbar: document.querySelector('.topbar'),
  container: document.querySelector('.container'),
  // 加载更多相关
  loadMoreContainer: document.getElementById('loadMoreContainer'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  loadingIndicator: document.getElementById('loadingIndicator'),
};

const AI_RECOMMENDATION_ENABLED = false;

let toastTimer = null;
let lastToastMessage = '';
let lastToastAt = 0;
let lastScrollY = 0;
let isToolbarHidden = false;
let isFilterPanelCollapsed = false;
let isFilterPanelManuallySet = false;
let updateMainPaddingRafId = null;
let topbarResizeObserver = null;
let presetBarStructureKey = '';
let negativeBarStructureKey = '';
let typeBarStructureKey = '';
let classificationBarStructureKey = '';
let activeFilterTaskToken = 0;
let pendingFilterTaskHandle = null;
let pendingResultRenderHandle = null;
let activeResultRenderToken = 0;
let pendingSearchDispatchHandle = null;
let pendingSearchDispatchOptions = null;
let pendingSearchPerfStart = 0;
let lastSearchDispatchAt = 0;
let searchExecutionRevision = 0;
let lastExecutedSearchFingerprint = '';
let lastNativeNotifiedFingerprint = '';
let debouncedInputHandler = null;
let debouncedExclusionInputHandler = null;
const isCompactLayout = () => window.innerWidth <= 1024;
let normalizedCardFieldCache = new WeakMap();
let selectedCardElement = null;
let renderedCardElementLookup = new Map();
let renderedCardSignatureLookup = new Map();
let filteredResultRenderSignatures = [];
let scrollSentinelNode = null;
let resultsIntersectionObserver = null;
let resultWindowTopSpacerNode = null;
let resultWindowBottomSpacerNode = null;
let resultWindowTopSentinelNode = null;
let resultsTopIntersectionObserver = null;
let cardsUpdateRevision = 0;
let searchFieldCachePrewarmRevision = 0;
let pendingSearchFieldCachePrewarmHandle = null;

function normalizeCardId(cardId) {
  if (typeof cardId === 'undefined' || cardId === null) return '';
  return String(cardId).trim();
}

function updateRenderedCardElementLookup(cardId, element) {
  const id = normalizeCardId(cardId);
  if (!id || !element) return;
  renderedCardElementLookup.set(id, element);
}

function getRenderedCardElementById(cardId) {
  const id = normalizeCardId(cardId);
  if (!id || !dom.results) return null;

  const cached = renderedCardElementLookup.get(id);
  if (cached && cached.isConnected) {
    return cached;
  }

  const cardNodes = dom.results.getElementsByClassName('card');
  for (let index = 0; index < cardNodes.length; index += 1) {
    const node = cardNodes[index];
    if (node && node.dataset && normalizeCardId(node.dataset.id) === id) {
      renderedCardElementLookup.set(id, node);
      return node;
    }
  }

  return null;
}

function setSelectedCardElement(nextElement) {
  const next = (nextElement && nextElement.isConnected) ? nextElement : null;

  if (selectedCardElement === next) {
    if (selectedCardElement && !selectedCardElement.classList.contains('selected')) {
      selectedCardElement.classList.add('selected');
    }
    if (selectedCardElement && typeof setCardActionsVisible === 'function') {
      setCardActionsVisible(selectedCardElement, true);
    }
    return;
  }

  if (selectedCardElement) {
    if (typeof setCardActionsVisible === 'function') {
      setCardActionsVisible(selectedCardElement, false);
    }
    selectedCardElement.classList.remove('selected');
  }

  selectedCardElement = next;

  if (selectedCardElement) {
    selectedCardElement.classList.add('selected');
    if (typeof setCardActionsVisible === 'function') {
      setCardActionsVisible(selectedCardElement, true);
    }
  }
}

function ensureScrollSentinel() {
  if (!scrollSentinelNode) {
    const sentinel = document.createElement('div');
    sentinel.id = 'scrollSentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.height = '1px';
    sentinel.style.pointerEvents = 'none';
    scrollSentinelNode = sentinel;
  }
  return scrollSentinelNode;
}

function getResultWindowMaxCards() {
  const customValue = Number(window.__MNKB_RESULT_WINDOW_MAX_CARDS__);
  if (Number.isFinite(customValue) && customValue >= INITIAL_PAGE_SIZE) {
    return Math.floor(customValue);
  }
  return 240;
}

function getResultWindowTargetCards() {
  const customValue = Number(window.__MNKB_RESULT_WINDOW_TARGET_CARDS__);
  if (Number.isFinite(customValue) && customValue >= INITIAL_PAGE_SIZE) {
    return Math.min(Math.floor(customValue), getResultWindowMaxCards());
  }
  return 180;
}

function shouldUseResultWindowing() {
  if (window.__MNKB_DISABLE_RESULT_WINDOWING__ === true) return false;
  return Array.isArray(state.filteredCards) && state.filteredCards.length >= 500;
}

function getCardRenderSource(card) {
  if (!card || typeof card !== 'object') return null;
  const cardId = normalizeCardId(card.id);
  if (cardId && state.cardLookup && state.cardLookup.has(cardId)) {
    return state.cardLookup.get(cardId);
  }
  return card;
}

function isUntemplatedCard(card) {
  const sourceCard = getCardRenderSource(card);
  if (!sourceCard) return false;
  if (typeof sourceCard.isTemplated === 'boolean') {
    return sourceCard.isTemplated === false;
  }

  const type = String(sourceCard.type || card?.type || '').trim();
  return type === '中间知识' || type === '历史卡片';
}

function shouldShowUntitledCardPreview(card) {
  const sourceCard = getCardRenderSource(card);
  if (!sourceCard || !isUntemplatedCard(card)) return false;
  return !String(sourceCard.title || card?.title || '').trim();
}

function getUntitledCardPreviewSource(card) {
  const sourceCard = getCardRenderSource(card);
  if (!sourceCard || !shouldShowUntitledCardPreview(card)) return '';

  return String(
    sourceCard.snippet
      || sourceCard.searchText
      || sourceCard.content
      || '',
  ).trim();
}

function buildCardRenderSignature(card) {
  if (!card || typeof card !== 'object') {
    return '';
  }

  return [
    normalizeCardId(card.id),
    card.title || '',
    card.titleHtml || '',
    card.__mnkbHighlightKey || '',
    card.type || '',
    card.classificationSubtype || '',
    card.__mnkbAISearch?.roleLabel || '',
    card.__mnkbAISearch?.reason || '',
    card.__mnkbAISearch?.score || '',
    card.color || '',
    typeof card.colorIndex === 'number' ? String(card.colorIndex) : '',
    isUntemplatedCard(card) ? 'untitled-type-hidden' : '',
    getUntitledCardPreviewSource(card),
  ].join('\u0001');
}

function areRenderSignatureListsEqual(nextList, previousList) {
  if (!Array.isArray(nextList) || !Array.isArray(previousList)) return false;
  if (nextList.length !== previousList.length) return false;
  for (let index = 0; index < nextList.length; index += 1) {
    if (nextList[index] !== previousList[index]) {
      return false;
    }
  }
  return true;
}

function rebuildCardLookup() {
  const nextMap = new Map();
  (state.cards || []).forEach((item) => {
    const id = normalizeCardId(item && item.id);
    if (!id) return;
    nextMap.set(id, item);
  });
  state.cardLookup = nextMap;
}

function rebuildAIRecommendationLookup() {
  const nextMap = new Map();
  (state.aiRecommendations || []).forEach((item) => {
    const id = normalizeCardId(item && item.id);
    if (!id) return;
    nextMap.set(id, item);
  });
  state.aiRecommendationLookup = nextMap;
}

function rebuildFilteredCardLookup(cards = state.filteredCards) {
  const nextMap = new Map();
  (cards || []).forEach((item) => {
    const id = normalizeCardId(item && item.id);
    if (!id) return;
    nextMap.set(id, item);
  });
  state.filteredCardLookup = nextMap;
}

function getCardById(cardId) {
  const id = normalizeCardId(cardId);
  if (!id) return null;

  if (state.cardLookup && state.cardLookup.has(id)) {
    return state.cardLookup.get(id);
  }

  if (state.filteredCardLookup && state.filteredCardLookup.has(id)) {
    return state.filteredCardLookup.get(id);
  }

  return (state.filteredCards || []).find((item) => item && normalizeCardId(item.id) === id) || null;
}

const SEARCH_USAGE_TIER_POINTS = Object.freeze({
  auxiliary: 1,
  locate: 5,
  link: 10,
});

function syncSearchUsageRoundFromInput(rawInput) {
  const hasInput = String(rawInput || '').trim().length > 0;
  if (!hasInput) {
    if (state.searchUsageHadNonEmptyInput) {
      state.searchUsageAwaitingNewRound = true;
      state.searchUsageRoundId = '';
    }
    state.searchUsageHadNonEmptyInput = false;
    return;
  }

  if (state.searchUsageAwaitingNewRound || !state.searchUsageRoundId) {
    state.searchUsageRoundSeq += 1;
    state.searchUsageRoundId = `search-usage-${Date.now()}-${state.searchUsageRoundSeq}`;
    state.searchUsageAwaitingNewRound = false;
  }
  state.searchUsageHadNonEmptyInput = true;
}

function buildSearchUsageParams(cardId, usageTier) {
  const id = normalizeCardId(cardId);
  const points = Number(usageTier);
  const currentInput = dom.searchInput ? dom.searchInput.value : state.userInput;
  if (!id || ![1, 5, 10].includes(points) || !String(currentInput || '').trim()) {
    return {};
  }
  syncSearchUsageRoundFromInput(currentInput);
  if (!state.searchUsageRoundId) return {};
  const card = getCardById(id);
  return {
    usageTier: points,
    usageRoundId: state.searchUsageRoundId,
    indexSource: String(card?.indexSource || ''),
  };
}

function withSearchUsageParams(params, cardId, usageTier) {
  return {
    ...(params || {}),
    ...buildSearchUsageParams(cardId, usageTier),
  };
}

function getAIRecommendationById(cardId) {
  const id = normalizeCardId(cardId);
  if (!id) return null;

  if (state.aiRecommendationLookup && state.aiRecommendationLookup.has(id)) {
    return state.aiRecommendationLookup.get(id);
  }

  return (state.aiRecommendations || []).find((item) => item && normalizeCardId(item.id) === id) || null;
}

// ========== 辅助函数 ==========

// 格式兼容：支持旧的数组格式和新的分组格式
function normalizePresetConfig(config) {
  if (!config) return [];
  if (Array.isArray(config)) {
    // 旧格式：["词1", "词2"]
    if (config.length > 0 && typeof config[0] === 'string') {
      return [{ name: '常用', presets: config }];
    }
    // 新格式：[{ name, presets }]
    return config;
  }
  return [];
}

// 获取预设分组列表
function getPresetGroupsWithRecent() {
  return state.config.presetGroups ? [...state.config.presetGroups] : [];
}

function isPerfDebugEnabled() {
  return window.__MNKB_PERF_DEBUG__ === true;
}

function isSearchDebugEnabled() {
  return window.__MNKB_SEARCH_DEBUG__ === true;
}

function emitSearchDebugLog(message, detail = '') {
  if (!isSearchDebugEnabled()) return;
  const text = `[MNKB Search][searchWebView] ${message}`;
  const detailPayload = detail ? String(detail) : '';
  const payload = detailPayload ? `${text} | ${detailPayload}` : text;

  try {
    if (console && typeof console.warn === 'function') {
      console.warn(payload);
      return;
    }
  } catch (error) {
    // 降级到后续分支
  }

  try {
    if (typeof sendURLToNative === 'function') {
      if (sendURLToNative('htmlLog', { message: payload, source: 'searchDebug', level: 'INFO' }, { priority: 'high' })) {
        return;
      }
    }
  } catch (error) {
    // 降级到后续分支
  }

  try {
    if (typeof postToAddon === 'function') {
      if (postToAddon('htmlLog', { message: payload, source: 'searchDebug', level: 'INFO' }, { priority: 'high' })) {
        return;
      }
    }
  } catch (error) {
    // 降级到后续分支
  }

  try {
    if (window.Bridge && typeof window.Bridge.logToNative === 'function') {
      window.Bridge.logToNative(payload);
      return;
    }
  } catch (error) {
    // 降级到后续分支
  }

  try {
    if (typeof postBridge === 'function') {
      if (postBridge('htmlLog', { message: payload, source: 'searchDebug', level: 'INFO' }, { forceURLScheme: true })) {
        return;
      }
    }
  } catch (error) {
    // 降级到控制台
  }

  console.log(detailPayload ? `${text} | ${detailPayload}` : text);
}
window.emitSearchDebugLog = emitSearchDebugLog;

function getPerfNow() {
  if (window.performance && typeof window.performance.now === 'function') {
    return window.performance.now();
  }
  return Date.now();
}

function isPerfNativeLogEnabled() {
  if (window.__MNKB_PERF_LOG_TO_NATIVE__ === false) {
    return false;
  }
  return isPerfDebugEnabled();
}

function emitPerfDebugLog(message) {
  if (!isPerfDebugEnabled()) return;
  const text = `[MNKB Perf] ${message}`;

  if (isPerfNativeLogEnabled()) {
    try {
      if (window.Bridge && typeof window.Bridge.log === 'function') {
        window.Bridge.log(text);
        return;
      }
    } catch (error) {
      // 降级到后续分支
    }

    try {
      if (typeof postBridge === 'function') {
        if (postBridge('htmlLog', { message: '[HTML] ' + text, source: 'searchPerf', level: 'INFO' })) {
          return;
        }
      }
    } catch (error) {
      // 降级到控制台
    }
  }

  console.log(text);
}

function logPerfMetric(label, startTime, details = '') {
  if (!isPerfDebugEnabled()) return;
  const duration = Math.max(0, getPerfNow() - startTime).toFixed(1);
  const suffix = details ? ` | ${details}` : '';
  emitPerfDebugLog(`${label}: ${duration}ms${suffix}`);
}

function bumpSearchExecutionRevision(reason = '') {
  searchExecutionRevision += 1;
  lastExecutedSearchFingerprint = '';
  if (reason !== 'aiCardSearch' && state.aiCardSearch?.active
    && typeof deactivateAICardSearch === 'function') {
    deactivateAICardSearch();
  }
  if (isPerfDebugEnabled() && reason) {
    emitPerfDebugLog(`searchRevision++ (${searchExecutionRevision}) reason=${reason}`);
  }
}
window.bumpSearchExecutionRevision = bumpSearchExecutionRevision;

function createSearchDispatchFingerprint(payload, dispatchOptions = {}) {
  const includePresets = Array.isArray(payload?.includePresets)
    ? payload.includePresets.slice().sort()
    : [];
  const excludePresets = Array.isArray(payload?.excludePresets)
    ? payload.excludePresets.slice().sort()
    : [];
  const typeList = Array.isArray(payload?.typeList)
    ? payload.typeList.slice().sort()
    : [];
  const tokensLower = Array.isArray(payload?.tokensLower)
    ? payload.tokensLower.slice().sort()
    : [];

  return JSON.stringify({
    revision: searchExecutionRevision,
    rawInput: payload?.rawInput || '',
    manualExclusionInput: payload?.manualExclusionInput || '',
    includePresets,
    excludePresets,
    typeKey: payload?.typeKey || '',
    typeList,
    classificationSubtype: payload?.classificationSubtype || 'all',
    tokensLower,
    keepLocate: dispatchOptions.keepLocate === true,
  });
}

function notifyNativeSearch(payload) {
  if (!window.MNKBBridge || typeof window.MNKBBridge.performSearch !== 'function') {
    return false;
  }
  try {
    window.MNKBBridge.performSearch(payload);
    return true;
  } catch (error) {
    console.warn('performSearch 调用失败', error);
    return false;
  }
}

function getAdaptiveCoarseFilterThreshold() {
  const customValue = Number(window.__MNKB_ADAPTIVE_FILTER_THRESHOLD__);
  if (Number.isFinite(customValue) && customValue > 0) {
    return Math.floor(customValue);
  }
  return 1200;
}

function shouldUseAdaptiveCoarseFilter(tokensLower, totalCards) {
  if (!Array.isArray(tokensLower) || tokensLower.length === 0) return false;
  if (window.__MNKB_DISABLE_ADAPTIVE_FILTER__ === true) return false;
  return totalCards >= getAdaptiveCoarseFilterThreshold();
}

function getChunkedFilterThreshold() {
  const customValue = Number(window.__MNKB_CHUNKED_FILTER_THRESHOLD__);
  if (Number.isFinite(customValue) && customValue > 0) {
    return Math.floor(customValue);
  }
  return 2200;
}

function getChunkedFilterBudgetMs() {
  const customValue = Number(window.__MNKB_FILTER_CHUNK_BUDGET_MS__);
  if (Number.isFinite(customValue) && customValue >= 2) {
    return customValue;
  }
  return 8;
}

function shouldUseChunkedFilterLoop(totalCards) {
  if (window.__MNKB_DISABLE_CHUNKED_FILTER__ === true) return false;
  return totalCards >= getChunkedFilterThreshold();
}

function getSearchDispatchMinIntervalMs() {
  const customValue = Number(window.__MNKB_SEARCH_MIN_INTERVAL_MS__);
  if (Number.isFinite(customValue) && customValue >= 0) {
    return customValue;
  }
  return 28;
}

function queueFilterFrame(callback) {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16);
}

function queueIdleFrame(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: 120 });
  }
  return queueFilterFrame(callback);
}

function getChunkedRenderThreshold() {
  const customValue = Number(window.__MNKB_CHUNKED_RENDER_THRESHOLD__);
  if (Number.isFinite(customValue) && customValue > 0) {
    return Math.floor(customValue);
  }
  return 72;
}

function getRenderChunkSize() {
  const customValue = Number(window.__MNKB_RENDER_CHUNK_SIZE__);
  if (Number.isFinite(customValue) && customValue > 0) {
    return Math.floor(customValue);
  }
  return 24;
}

function shouldUseChunkedResultRender(totalItems) {
  if (window.__MNKB_DISABLE_CHUNKED_RENDER__ === true) return false;
  return totalItems >= getChunkedRenderThreshold();
}

function cancelPendingFilterTask() {
  state.isFilteringResults = false;
  if (pendingFilterTaskHandle === null) return;
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(pendingFilterTaskHandle);
  } else {
    clearTimeout(pendingFilterTaskHandle);
  }
  pendingFilterTaskHandle = null;
}

function cancelPendingResultRenderTask() {
  if (pendingResultRenderHandle === null) return;
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(pendingResultRenderHandle);
  } else {
    clearTimeout(pendingResultRenderHandle);
  }
  pendingResultRenderHandle = null;
}

function cancelPendingSearchDispatch() {
  if (pendingSearchDispatchHandle === null) return;
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(pendingSearchDispatchHandle);
  } else {
    clearTimeout(pendingSearchDispatchHandle);
  }
  pendingSearchDispatchHandle = null;
}

function mergeScheduleOptions(baseOptions = {}, nextOptions = {}) {
  return {
    keepLocate: baseOptions.keepLocate === true || nextOptions.keepLocate === true,
    triggerNative: (baseOptions.triggerNative !== false) && (nextOptions.triggerNative !== false),
    lowPriority: nextOptions.lowPriority === true,
  };
}

function shouldDelayScheduledSearchDispatch(dispatchOptions) {
  const minInterval = dispatchOptions.lowPriority === true ? getSearchDispatchMinIntervalMs() : 0;
  const now = getPerfNow();
  const elapsedSinceLast = now - lastSearchDispatchAt;
  if (!(minInterval > 0 && lastSearchDispatchAt > 0 && elapsedSinceLast < minInterval)) {
    return false;
  }

  pendingSearchDispatchOptions = dispatchOptions;
  pendingSearchDispatchHandle = queueFilterFrame(flushScheduledSearchDispatch);
  if (isPerfDebugEnabled()) {
    emitPerfDebugLog(`scheduleSearch(wait): ${elapsedSinceLast.toFixed(1)}ms < ${minInterval}ms`);
  }
  return true;
}

function clearLocateStateBeforeScheduledDispatch(dispatchOptions) {
  if (state.locateOnlyId && dispatchOptions.keepLocate !== true) {
    state.locateOnlyId = null;
    state.locateTargetId = null;
  }
}

function buildScheduledSearchContext(dispatchOptions) {
  const payload = buildQueryPayload();
  state.lastQueryPayload = payload;
  return {
    payload,
    dispatchOptions,
    fingerprint: createSearchDispatchFingerprint(payload, dispatchOptions),
    shouldNotifyNative: dispatchOptions.triggerNative !== false,
  };
}

function finalizeScheduledSearchDispatch(context) {
  applyFilters(context.payload, context.dispatchOptions);
  lastExecutedSearchFingerprint = context.fingerprint;
  lastSearchDispatchAt = getPerfNow();

  if (pendingSearchPerfStart > 0) {
    logPerfMetric('scheduleSearch(flush)', pendingSearchPerfStart, `native=${context.shouldNotifyNative ? 'on' : 'off'} low=${context.dispatchOptions.lowPriority === true ? 'on' : 'off'}`);
  }
  pendingSearchPerfStart = 0;
}

function flushScheduledSearchDispatch() {
  pendingSearchDispatchHandle = null;

  const dispatchOptions = pendingSearchDispatchOptions || {};
  pendingSearchDispatchOptions = null;

  if (shouldDelayScheduledSearchDispatch(dispatchOptions)) {
    return;
  }

  clearLocateStateBeforeScheduledDispatch(dispatchOptions);
  const context = buildScheduledSearchContext(dispatchOptions);

  if (context.fingerprint === lastExecutedSearchFingerprint) {
    if (isPerfDebugEnabled()) {
      emitPerfDebugLog('scheduleSearch(skip duplicate payload)');
    }
    pendingSearchPerfStart = 0;
    return;
  }

  if (context.shouldNotifyNative && context.fingerprint !== lastNativeNotifiedFingerprint) {
    if (notifyNativeSearch(context.payload)) {
      lastNativeNotifiedFingerprint = context.fingerprint;
    }
  }

  finalizeScheduledSearchDispatch(context);
}

// 切换自动关闭模式
function toggleAutoCloseMode() {
  const nextMode = !state.autoCloseMode;
  state.autoCloseMode = nextMode;
  window.__mnkbAutoCloseModeFromNative = nextMode;

  // 先更新按钮，避免自定义 scheme 跳转打断当前 JS 执行导致文案不同步
  updateAutoCloseModeButton();

  // 通知原生层（原生层会保存到 NSUserDefaults）
  if (typeof postToAddon === 'function') {
    postToAddon('setAutoCloseMode', { enabled: nextMode });
    return;
  }

  const url = `mnknowledgebase://setAutoCloseMode?enabled=${nextMode}`;
  setTimeout(() => {
    window.location.href = url;
  }, 0);
}

// 更新自动关闭模式按钮的显示状态
function updateAutoCloseModeButton() {
  const btn = document.getElementById('autoCloseModeBtn');
  if (!btn) return;

  if (state.autoCloseMode) {
    btn.textContent = '↘ 操作后关闭';
    btn.title = '当前：操作后关闭窗口\n点击切换为：保持窗口打开';
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.textContent = '📌 保持窗口';
    btn.title = '当前：保持窗口打开\n点击切换为：操作后关闭窗口';
    btn.setAttribute('aria-pressed', 'false');
  }
}

function applyAutoCloseModeFromNativeIfAny() {
  if (typeof window.__mnkbAutoCloseModeFromNative === 'undefined') return;
  state.autoCloseMode = !!window.__mnkbAutoCloseModeFromNative;
}

function requestAutoCloseModeSyncIfNeeded() {
  if (typeof window.__mnkbAutoCloseModeFromNative !== 'undefined') return;
  if (typeof postToAddon === 'function') {
    postToAddon('syncAutoCloseMode', {});
    return;
  }
  window.location.href = 'mnknowledgebase://syncAutoCloseMode';
}

const DEFAULT_MERGE_OPTIONS = {
  removeTitle: false,
  keepOnlyExcerpt: true,
  excerptFromSelection: false,
  position: 'below',
  locateAfterMerge: false,
  linkOldClassification: false,
};

function sanitizeMergeOptions(rawOptions = {}) {
  return {
    removeTitle: rawOptions.removeTitle === true,
    keepOnlyExcerpt: rawOptions.keepOnlyExcerpt !== false,
    excerptFromSelection: rawOptions.excerptFromSelection === true,
    position: rawOptions.position === 'above' ? 'above' : 'below',
    locateAfterMerge: rawOptions.locateAfterMerge === true,
    linkOldClassification: rawOptions.linkOldClassification === true,
  };
}

function loadMergeOptions() {
  const meta = getPanelMeta('merge');
  setPanelOptions('merge', loadPanelOptions(
    meta.storageKey,
    DEFAULT_MERGE_OPTIONS,
    sanitizeMergeOptions,
    meta.errorLabel,
  ));
}

function saveMergeOptions() {
  const meta = getPanelMeta('merge');
  savePanelOptions(meta.storageKey, state.mergeOptions, meta.errorLabel);
}

function formatMergeOptionsSummary(options = state.mergeOptions) {
  const titleMode = options.removeTitle ? '去掉标题' : '标题去重';
  const contentMode = options.keepOnlyExcerpt ? '仅摘录' : '全部字段';
  const excerptMode = options.excerptFromSelection ? '先摘录再合并' : '不先摘录';
  const positionMode = options.position === 'above' ? '摘录上方▲' : '摘录下方▼';
  const locateMode = options.locateAfterMerge ? '完成后定位' : '完成后不定位';
  const linkMode = options.linkOldClassification ? '链接旧归类' : '不链接旧归类';
  return `${titleMode} · ${contentMode} · ${excerptMode} · ${positionMode} · ${locateMode} · ${linkMode}`;
}

function renderModeTags(container, tags = []) {
  if (!container) return;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();
  tags.forEach((item) => {
    if (!item || !item.label) return;
    const tag = document.createElement('span');
    tag.className = `sidebar-mode-tag${item.active ? ' active' : ''}`;
    tag.textContent = item.label;
    fragment.appendChild(tag);
  });
  container.appendChild(fragment);
}

function formatActionTime(timestamp) {
  const date = new Date(timestamp || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ========== 面板通用助手：存储 / DOM / 回显 ==========

function loadPanelOptions(storageKey, defaults, sanitize, errorLabel) {
  let next = { ...defaults };
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      next = sanitize({
        ...defaults,
        ...JSON.parse(stored),
      });
    }
  } catch (error) {
    console.warn(`加载${errorLabel}失败，将使用默认值`, error);
  }
  return next;
}

function savePanelOptions(storageKey, value, errorLabel) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    console.warn(`保存${errorLabel}失败`, error);
  }
}

function syncOptionSummary(summaryNode, subtitleNode, summary) {
  if (summaryNode) {
    summaryNode.textContent = `当前组合：${summary}`;
  }
  if (subtitleNode) {
    subtitleNode.textContent = summary;
  }
}

function getPanelMeta(section) {
  return PANEL_META[section] || null;
}

function getPanelStateKey(section) {
  return PANEL_STATE_KEYS[section] || null;
}

function getPanelOptions(section) {
  const stateKey = getPanelStateKey(section);
  if (!stateKey) return null;
  return state[stateKey] || null;
}

function setPanelOptions(section, value) {
  const stateKey = getPanelStateKey(section);
  if (!stateKey) return;
  state[stateKey] = value;
}

function getPanelDomNode(section, nodeType) {
  const meta = getPanelMeta(section);
  if (!meta || !meta.domKeys) return null;
  const domKey = meta.domKeys[nodeType];
  if (!domKey) return null;
  return dom[domKey] || null;
}

function getLastActionElement(section) {
  return getPanelDomNode(section, 'lastAction');
}

function renderPanelPresentation(section, summary, tags = []) {
  syncOptionSummary(
    getPanelDomNode(section, 'summary'),
    getPanelDomNode(section, 'subtitle'),
    summary,
  );
  renderModeTags(getPanelDomNode(section, 'tags'), tags);
}

function updatePanelOptionsState(section, patch, sanitize, render, save) {
  const current = getPanelOptions(section) || {};
  setPanelOptions(section, sanitize({
    ...current,
    ...patch,
  }));
  render();
  save();
}

function renderLastActionFeedback(section) {
  const container = getLastActionElement(section);
  if (!container) return;

  const payload = state.lastActionFeedback?.[section] || null;
  const textNode = container.querySelector('.sidebar-last-action-text');
  container.classList.remove('is-success', 'is-error', 'is-empty');

  if (!payload) {
    container.classList.add('is-empty');
    if (textNode) {
      textNode.textContent = '暂无记录';
    }
    return;
  }

  if (payload.status === 'success') {
    container.classList.add('is-success');
  } else if (payload.status === 'error') {
    container.classList.add('is-error');
  }

  if (textNode) {
    textNode.textContent = `${formatActionTime(payload.at)} · ${payload.text}`;
  }
}

function setLastActionFeedback(section, text, status = 'success') {
  if (!state.lastActionFeedback) {
    state.lastActionFeedback = { merge: null, move: null, template: null };
  }
  state.lastActionFeedback[section] = {
    text: String(text || '').trim() || '已执行',
    status,
    at: Date.now(),
  };
  renderLastActionFeedback(section);
}

// ========== 合并面板：状态 / 渲染 ==========

function renderMergeOptions() {
  const options = sanitizeMergeOptions(getPanelOptions('merge') || DEFAULT_MERGE_OPTIONS);
  setPanelOptions('merge', options);

  if (dom.mergeRemoveTitleToggle) {
    dom.mergeRemoveTitleToggle.checked = options.removeTitle;
  }
  if (dom.mergeKeepOnlyExcerptToggle) {
    dom.mergeKeepOnlyExcerptToggle.checked = options.keepOnlyExcerpt;
  }
  if (dom.mergeExcerptFromSelectionToggle) {
    dom.mergeExcerptFromSelectionToggle.checked = options.excerptFromSelection;
  }
  if (dom.mergeLocateAfterToggle) {
    dom.mergeLocateAfterToggle.checked = options.locateAfterMerge;
  }
  if (dom.mergeLinkOldClassificationToggle) {
    dom.mergeLinkOldClassificationToggle.checked = options.linkOldClassification;
  }

  if (dom.mergePositionToggle) {
    dom.mergePositionToggle.querySelectorAll('button[data-position]').forEach((btn) => {
      const active = btn.dataset.position === options.position;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  const summary = formatMergeOptionsSummary(options);
  renderPanelPresentation('merge', summary, [
    { label: options.removeTitle ? '去标题' : '标题去重', active: true },
    { label: options.keepOnlyExcerpt ? '仅摘录' : '全字段', active: options.keepOnlyExcerpt },
    { label: options.excerptFromSelection ? '先摘录' : '直接合并', active: options.excerptFromSelection },
    { label: options.position === 'above' ? '上方' : '下方', active: true },
    { label: options.locateAfterMerge ? '定位' : '不定位', active: options.locateAfterMerge },
    { label: options.linkOldClassification ? '链接旧归类' : '不链接旧归类', active: options.linkOldClassification },
  ]);
}

function updateMergeOptions(patch = {}) {
  updatePanelOptionsState('merge', patch, sanitizeMergeOptions, renderMergeOptions, saveMergeOptions);
}

// ========== 移动画板：状态 / 渲染 ==========

const DEFAULT_MOVE_OPTIONS = {
  makeNote: false,
  addToReview: false,
  locateAfterMove: false,
};

function sanitizeMoveOptions(rawOptions = {}) {
  const makeNote = rawOptions.makeNote === true;
  const addToReview = makeNote && rawOptions.addToReview === true;
  return {
    makeNote,
    addToReview,
    locateAfterMove: rawOptions.locateAfterMove === true,
  };
}

function loadMoveOptions() {
  const meta = getPanelMeta('move');
  setPanelOptions('move', loadPanelOptions(
    meta.storageKey,
    DEFAULT_MOVE_OPTIONS,
    sanitizeMoveOptions,
    meta.errorLabel,
  ));
}

function saveMoveOptions() {
  const meta = getPanelMeta('move');
  savePanelOptions(meta.storageKey, state.moveOptions, meta.errorLabel);
}

function formatMoveOptionsSummary(options = state.moveOptions) {
  const makeNoteMode = options.makeNote ? '制卡' : '不制卡';
  const reviewMode = options.makeNote && options.addToReview ? '加入复习' : '不加复习';
  const locateMode = options.locateAfterMove ? '完成后定位' : '完成后不定位';
  return `移动为子卡片 · ${makeNoteMode} · ${reviewMode} · ${locateMode}`;
}

function renderMoveOptions() {
  const options = sanitizeMoveOptions(getPanelOptions('move') || DEFAULT_MOVE_OPTIONS);
  setPanelOptions('move', options);

  if (dom.moveMakeNoteToggle) {
    dom.moveMakeNoteToggle.checked = options.makeNote;
  }
  if (dom.moveAddToReviewToggle) {
    dom.moveAddToReviewToggle.checked = options.addToReview;
    dom.moveAddToReviewToggle.disabled = !options.makeNote;
  }
  if (dom.moveAddToReviewRow) {
    dom.moveAddToReviewRow.classList.toggle('disabled', !options.makeNote);
  }
  if (dom.moveLocateAfterToggle) {
    dom.moveLocateAfterToggle.checked = options.locateAfterMove;
  }

  const summary = formatMoveOptionsSummary(options);
  renderPanelPresentation('move', summary, [
    { label: '移动', active: true },
    { label: options.makeNote ? '制卡' : '不制卡', active: options.makeNote },
    { label: options.addToReview ? '加入复习' : '不加复习', active: options.addToReview },
    { label: options.locateAfterMove ? '定位' : '不定位', active: options.locateAfterMove },
  ]);
}

function updateMoveOptions(patch = {}) {
  updatePanelOptionsState('move', patch, sanitizeMoveOptions, renderMoveOptions, saveMoveOptions);
}

// ========== 模板面板：状态 / 渲染 ==========

const DEFAULT_TEMPLATE_OPTIONS = {
  locateAfterCreate: false,
};

function sanitizeTemplateOptions(rawOptions = {}) {
  return {
    locateAfterCreate: rawOptions.locateAfterCreate === true,
  };
}

function loadTemplateOptions() {
  const meta = getPanelMeta('template');
  setPanelOptions('template', loadPanelOptions(
    meta.storageKey,
    DEFAULT_TEMPLATE_OPTIONS,
    sanitizeTemplateOptions,
    meta.errorLabel,
  ));
}

function saveTemplateOptions() {
  const meta = getPanelMeta('template');
  savePanelOptions(meta.storageKey, state.templateOptions, meta.errorLabel);
}

function formatTemplateOptionsSummary(options = state.templateOptions) {
  const locateMode = options.locateAfterCreate ? '完成后定位' : '完成后不定位';
  return `新建归类并移入 · ${locateMode}`;
}

function renderTemplateOptions() {
  const options = sanitizeTemplateOptions(getPanelOptions('template') || DEFAULT_TEMPLATE_OPTIONS);
  setPanelOptions('template', options);

  if (dom.templateLocateAfterToggle) {
    dom.templateLocateAfterToggle.checked = options.locateAfterCreate;
  }

  const summary = formatTemplateOptionsSummary(options);
  renderPanelPresentation('template', summary, [
    { label: '新建归类', active: true },
    { label: '移入焦点卡片', active: true },
    { label: options.locateAfterCreate ? '定位' : '不定位', active: options.locateAfterCreate },
  ]);
}

function updateTemplateOptions(patch = {}) {
  updatePanelOptionsState('template', patch, sanitizeTemplateOptions, renderTemplateOptions, saveTemplateOptions);
}

function resolveMoveActionFromOptions(options = state.moveOptions) {
  if (!options.makeNote) {
    return options.locateAfterMove
      ? 'moveFocusNoteToTargetNoteAsChildAndLocate'
      : 'moveFocusNoteToTargetNoteAsChild';
  }

  if (options.addToReview) {
    return options.locateAfterMove
      ? 'moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReviewAndLocate'
      : 'moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReview';
  }

  return options.locateAfterMove
    ? 'moveFocusNoteToTargetNoteAsChildAndMakeNoteAndLocate'
    : 'moveFocusNoteToTargetNoteAsChildAndMakeNote';
}

function resolveTemplateActionFromOptions(options = state.templateOptions) {
  return options.locateAfterCreate
    ? 'addTemplateToTargetNoteAndMoveFocusNoteAsChildAndLocate'
    : 'addTemplateToTargetNoteAndMoveFocusNoteAsChild';
}

// ========== 侧栏宽度 / 拖拽 ==========

function getSidebarWidthBounds() {
  const viewportWidth = window.innerWidth || 1280;
  const minWidth = 340;
  const maxWidth = Math.min(560, Math.max(420, Math.floor(viewportWidth * 0.46)));
  return {
    minWidth,
    maxWidth: Math.max(minWidth, maxWidth),
  };
}

function normalizeSidebarWidth(rawWidth) {
  const width = Number(rawWidth);
  if (!Number.isFinite(width)) return null;
  const bounds = getSidebarWidthBounds();
  return Math.max(bounds.minWidth, Math.min(bounds.maxWidth, Math.round(width)));
}

function applySidebarWidth(width, { save = true } = {}) {
  const normalizedWidth = normalizeSidebarWidth(width);
  state.sidebarWidth = normalizedWidth;

  if (dom.sidebar) {
    if (normalizedWidth && !isCompactLayout()) {
      dom.sidebar.style.width = `${normalizedWidth}px`;
    } else {
      dom.sidebar.style.removeProperty('width');
    }
  }

  if (save) {
    try {
      if (normalizedWidth) {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(normalizedWidth));
      } else {
        localStorage.removeItem(SIDEBAR_WIDTH_KEY);
      }
    } catch (error) {
      console.warn('保存侧边栏宽度失败', error);
    }
  }

  if (dom.sidebarResizeHandle) {
    const disabled = isCompactLayout() || isSidebarHidden();
    dom.sidebarResizeHandle.style.display = disabled ? 'none' : '';
  }
}

function loadSidebarWidth() {
  let width = null;
  try {
    width = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  } catch (error) {
    console.warn('读取侧边栏宽度失败，将使用默认宽度', error);
  }
  applySidebarWidth(width, { save: false });
}

function saveLocalSearchRoot() {
  try {
    if (state.localSearchRootId) {
      localStorage.setItem(LOCAL_SEARCH_ROOT_KEY, JSON.stringify({
        rootId: state.localSearchRootId,
        rootTitle: state.localSearchRootTitle,
      }));
    } else {
      localStorage.removeItem(LOCAL_SEARCH_ROOT_KEY);
    }
  } catch (error) {
    console.warn('保存局部搜索根卡片失败', error);
  }
}

function loadLocalSearchRoot() {
  try {
    const stored = localStorage.getItem(LOCAL_SEARCH_ROOT_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.rootId) {
        state.localSearchRootId = parsed.rootId;
        state.localSearchRootTitle = parsed.rootTitle || '';
      }
    }
  } catch (error) {
    console.warn('加载局部搜索根卡片失败', error);
  }
}

function handleSetDescendantCardIds(payload) {
  const rootId = String((payload && payload.rootId) || '').trim();
  const responseRequestId = String((payload && payload.requestId) || '').trim();
  if (!state.localSearchRootId) {
    console.warn('忽略局部搜索响应：当前没有活动根卡片');
    return false;
  }
  if (!rootId) {
    state.localSearchLoading = false;
    showToast('局部搜索失败：未收到根卡片信息');
    deactivateLocalSearch();
    return false;
  }
  if (rootId !== String(state.localSearchRootId)) {
    console.warn('忽略过期局部搜索响应：根卡片不匹配');
    return false;
  }
  if (responseRequestId && state.localSearchRequestId && responseRequestId !== state.localSearchRequestId) {
    console.warn('忽略过期局部搜索响应：请求不匹配');
    return false;
  }
  state.localSearchLoading = false;
  if (payload && payload.error) {
    showToast(`局部搜索失败：${payload.error}`);
    deactivateLocalSearch();
    return false;
  }
  const ids = Array.isArray(payload && payload.descendantIds) ? payload.descendantIds : [];
  state.localSearchDescendantIds = new Set(ids.filter(Boolean).map(String));
  if (state.localSearchDescendantIds.size === 0) {
    showToast('该卡片下没有子孙卡片');
  } else {
    showMinorSuccessToast(`已限定到 ${state.localSearchDescendantIds.size} 张子孙卡片`, 1000);
  }
  saveLocalSearchRoot();
  scheduleSearch({ triggerNative: false });
  renderLocalSearchBanner();
  return true;
}

function activateLocalSearch(rootId, rootTitle, options = {}) {
  const id = String(rootId || '').trim();
  if (!id) return;
  bumpSearchExecutionRevision('activateLocalSearch');
  const requestId = `local-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.localSearchRootId = id;
  state.localSearchRootTitle = String(rootTitle || '').trim() || '未命名卡片';
  state.localSearchLoading = true;
  state.localSearchDescendantIds = new Set();
  state.localSearchRequestId = requestId;
  showToast('正在收集子孙卡片...');
  if (window.Bridge && typeof window.Bridge.requestDescendantCardIds === 'function') {
    const dispatched = window.Bridge.requestDescendantCardIds(id, {
      requestId,
      ...buildSearchUsageParams(id, options.usageTier),
    });
    if (dispatched === false) {
      state.localSearchLoading = false;
      showToast('局部搜索请求派发失败');
      deactivateLocalSearch();
      return;
    }
  } else {
    state.localSearchLoading = false;
    showToast('局部搜索功能不可用');
    deactivateLocalSearch();
    return;
  }
  renderLocalSearchBanner();
}

function deactivateLocalSearch() {
  bumpSearchExecutionRevision('deactivateLocalSearch');
  state.localSearchRootId = null;
  state.localSearchRootTitle = '';
  state.localSearchDescendantIds = new Set();
  state.localSearchLoading = false;
  state.localSearchRequestId = '';
  saveLocalSearchRoot();
  renderLocalSearchBanner();
  scheduleSearch({ triggerNative: false });
}

function renderLocalSearchBanner() {
  const banner = document.getElementById('localSearchBanner');
  if (!banner) return;
  if (state.localSearchRootId) {
    const title = escapeHtml(state.localSearchRootTitle);
    const loadingDot = state.localSearchLoading ? ' <span class="local-search-loading">⏳</span>' : '';
    banner.innerHTML = `🔍 局部搜索：<strong>${title}</strong> 的子孙卡片${loadingDot} <button id="exitLocalSearchBtn" class="btn local-search-exit-btn" type="button" title="退出局部搜索">✕ 退出局部搜索</button>`;
    banner.hidden = false;
    const exitBtn = document.getElementById('exitLocalSearchBtn');
    if (exitBtn) {
      exitBtn.addEventListener('click', deactivateLocalSearch);
    }
  } else {
    banner.innerHTML = '';
    banner.hidden = true;
  }
}

function finishSidebarResize(save = true) {
  const session = state.sidebarResizeSession;
  if (!session) return;

  document.body.classList.remove('sidebar-resizing');
  window.removeEventListener('pointermove', session.onPointerMove);
  window.removeEventListener('pointerup', session.onPointerUp);
  window.removeEventListener('pointercancel', session.onPointerUp);

  state.sidebarResizeSession = null;
  applySidebarWidth(state.sidebarWidth, { save });
}

function beginSidebarResize(event) {
  if (!dom.sidebar || !dom.sidebarResizeHandle || isCompactLayout() || isSidebarHidden()) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  const startWidth = dom.sidebar.getBoundingClientRect().width;
  const startClientX = event.clientX;

  const onPointerMove = (moveEvent) => {
    const delta = moveEvent.clientX - startClientX;
    applySidebarWidth(startWidth + delta, { save: false });
  };

  const onPointerUp = () => {
    finishSidebarResize(true);
  };

  state.sidebarResizeSession = { onPointerMove, onPointerUp };
  document.body.classList.add('sidebar-resizing');
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  dom.sidebarResizeHandle.setPointerCapture?.(event.pointerId);
}

// 供 Native 注入脚本调用：同步状态到 Web 层（若 state 尚未就绪则先缓存）
window.setAutoCloseModeFromNative = function(enabled) {
  window.__mnkbAutoCloseModeFromNative = !!enabled;
  if (typeof window.state !== 'undefined' && window.state) {
    window.state.autoCloseMode = !!enabled;
  }
  if (typeof window.updateAutoCloseModeButton === 'function') {
    window.updateAutoCloseModeButton();
  }
};
