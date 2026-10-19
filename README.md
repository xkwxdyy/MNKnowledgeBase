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

OCR 模型配置可通过 `ocrConfig.modelSource(source)` 提供 `url` 和 `apiKey`。订阅服务的 `apikey` 仅在请求端点与订阅端点一致时复用。缺少匹配凭证时，OCR 入口提示配置要求，不发起请求。密钥应仅保存在本机运行配置中。

## 验证范围

跨仓库回归使用显式项目路径，浏览器测试使用另外提供的本地浏览器依赖。相关入口见 [测试说明](TESTING.md)。源码测试和包体检查不代表 MarginNote、Mac 或 iPad 的实际运行验收已经通过。
