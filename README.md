# MN KnowledgeBase

MN KnowledgeBase 为 MarginNote 提供知识卡片检索、结构化评论编辑、模板制卡和 OCR 工作流程。插件标识与版本以 `mnaddon.json` 为准。

运行入口位于 `main.js`，主要逻辑位于 `utils.js` 和 `knowledgebaseWebController.js`。网页界面使用根目录的 HTML 文件，以及 `scripts/`、`styles/` 和 `resources/` 中的本地资源。部分运行功能需要已安装的 MNUtils、MNOCR 或 MNChatAI；本地构建不读取其他插件的源码。

## 本地检查与打包

构建环境需要 Node.js 24，以及 `zip` 和 `unzip` 命令。当前构建没有需要安装的 npm 依赖。

```sh
npm test
npm run pack
```

`npm test` 仅运行 `tests/manifest.json` 中的离线测试清单。`npm run pack` 按 `build/payload.json` 打包，并验证归档完整性、文件清单和逐文件源码一致性。输出位于 `dist/`，打包过程保留现有插件版本，不上传、部署或安装插件。

单独复核已有包时，执行以下命令：

```sh
node build/build.js --verify dist/mnknowledgebase_v1_87.mnaddon
```

## 运行配置

公开源码不预设学习集、搜索看板或模板卡片。已有搜索配置继续通过 `KnowledgeBaseTemplate_SearchConfig` 读取；首次使用时，需要选择知识库根目录。

通用术语库保留数学词条、别名和检索规则，不预设笔记来源绑定。

模板和看板标识保存在现有 `KnowledgeBaseConfig.config.referenceNoteIds` 配置对象中。该对象包含 `templates`、`htmlCommentTemplates`、`keywordTemplateNoteId`、`simpleClassificationTemplateNoteId`、`relatedLinksTemplateNoteId`、`searchBoardId` 和 `roots`。`roots` 使用 `main.js` 中列出的根目录名称作为键。`circularScanRootIds` 用于单独指定循环引用扫描范围。`templates` 以卡片类型作为键，`htmlCommentTemplates` 以字段名称作为键。配置完成后，可使用现有 `KnowledgeBaseConfig.save()` 保存。缺少模板或看板配置时，相关操作提示配置要求并停止。

个人安装包可通过仓库根目录中已被 Git 忽略的 `reference-note-ids.local.json` 保留旧版模板、字段及根目录引用，文件结构与 `referenceNoteIds` 相同。`npm run pack` 在该文件存在时生成带有 `_personal` 后缀的安装包；`npm run pack -- --references /absolute/path/profile.json` 可指定配置文件，`npm run pack -- --public` 生成无个人引用的公共安装包。构建只在临时副本中注入引用，公共源码保持不变。已保存的显式配置优先于安装包引用，显式空值也保留。个人安装包及配置文件仅供本地使用。

个人包校验使用 `npm run pack -- --verify dist/安装包文件名.mnaddon`；显式配置文件需同时传入相同的 `--references` 参数。校验分别报告归档完整性、配置注入后的内容一致性和是否包含个人引用，个人包不会被报告为与公共源码逐字节一致。

OCR 模型配置可通过 `ocrConfig.modelSource(source)` 提供 `url` 和 `apiKey`。订阅服务的 `apikey` 仅在请求端点与订阅端点一致时复用。缺少匹配凭证时，OCR 入口提示配置要求，不发起请求。密钥应仅保存在本机运行配置中。

## 证明合并与 Check 折叠

MNToolbar 的证明合并入口在全部合并、字段移动和链接清理结束后，自动折叠各来源卡片的主摘录、Check 之前的评论及 Check 本身。证明要点标题和 Check 之后的内容保留原有展开状态。来源按原卡片和原评论序号跟踪，主摘录单独计入合并结果。

本次内容全部处理完成后才执行合并，插件不增加完成状态筛选。没有 Check 的来源卡片不新增折叠范围；同一张来源卡片存在多个 Check 时，合并提前停止。折叠通过宿主原生接口保存并读回核验；评论位置无法确认时停止后续操作，提示已经完成的合并和折叠数量。普通合并入口保持原有行为。

## 验证范围

跨仓库回归使用显式项目路径，浏览器测试使用另外提供的本地浏览器依赖。相关入口见 [测试说明](TESTING.md)。源码测试和包体检查不代表 MarginNote、Mac 或 iPad 的实际运行验收已经通过。

个人引用配置中的 `rootScopes` 支持 `researchProcessRootIds`、`literatureClassificationRootIds` 和 `circularScanRootIds`。首次恢复时，迁移留下的空范围会采用个人包的原范围，已有非空范围保留；恢复标记保存后，后续显式清空的范围也会保留。默认搜索根目录从 `roots.defaultKnowledgeBase` 恢复，已有搜索根目录、选择、顺序和搜索选项优先保留。本地与云端搜索配置独立校验，损坏副本不会阻止读取另一侧的有效配置。

`mathTermSourceNoteIds` 按术语义项编号保存原卡片来源编号数组；构建时仅恢复术语库资源中的来源绑定，不将该映射复制到原生运行代码。公共安装包保持无个人来源编号，个人包在术语库结构变化导致映射无法对应时停止构建。
