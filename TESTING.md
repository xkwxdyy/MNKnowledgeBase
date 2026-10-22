# 测试说明

`tests/manifest.json` 明确列出离线、跨仓库和浏览器测试。所有保留的回归脚本均须归入对应清单。

## 离线回归

```sh
npm test
```

该入口要求 Node.js 24，依次运行离线清单中的脚本。测试不读取兄弟仓库或本机凭证文件。测试辅助数据使用合成卡片标识；基准测试辅助模块仅保留离线评分与候选构造函数。

公开持续集成执行离线回归和本地打包。包体清单包括本地数学渲染资源，排除测试、审查资料和独立卡片盒项目。

`tests/proof-merge-check-fold-regression.js` 直接加载生产合并与折叠代码，覆盖多层父子、同级卡片、主摘录差异、重复内容、标题和后续评论保留、字段移动、链接清理、原生空值及来源字段变更，并检查异常中止和原生折叠读回。模拟测试不能替代宿主显示、展开和撤销验收。

归类树合并的离线回归分为运行流程、内容与通信检查。`definition-merge-runtime-regression.js` 串联真实数据建模、版本检查、前端方案和执行函数；`definition-merge-content-regression.js` 使用真实字段解析、合并、链接维护和评论提取函数，检查内容保留、缺失字段拒绝及异常传播；`definition-merge-bridge-regression.js` 检查重复请求和交换上下文。宿主卡片存取、部分字段移动及撤销注册使用隔离模拟，测试结果不代表设备验收。

## 跨仓库回归

```sh
npm run test:integration
```

运行前，需要通过 `MNKB_PROJECT_ROOTS` 环境变量提供 JSON 对象，并将各值设为对应项目的绝对路径。支持的键包括 `mntoolbar`、`mnutils`、`mnai`、`mnpinner`、`mnliterature`、`mncommentmanager` 和 `internal`。`internal` 指向包含维护脚本的目录；定制项目路径保留当前内部目录布局。

该入口仅验证已配置源码的互操作契约。缺少路径配置时，测试明确失败；公开持续集成不运行该套件，不要求访问私有源码。

`definition-merge-workbench-regression.js` 还执行真实 Toolbar 注册回调，接入知识库的真实预检与打开函数，避免仅凭入口字符串和始终通过的预检模拟判断功能可用。

## 浏览器与设备验收

浏览器脚本保留在 `tests/*.browser.mjs`。运行环境需另外提供 Playwright 或 Playwright Core，以及可用浏览器。脚本顶部记录对应环境变量。浏览器测试使用模拟原生接口，不能替代 MarginNote 的实际运行验收。

`definition-merge.browser.mjs` 通过 `DEFINITION_MERGE_PLAYWRIGHT` 指定 Playwright 模块，检查桌面与窄屏配对、预演、执行期间的操作限制、失败后刷新、回执匹配和交换限制。

Mac 和 iPad 验收应分别记录安装包、宿主版本、测试入口与观察结果。本次迁移没有自动安装或启动宿主应用。
