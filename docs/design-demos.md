# 设计原型（design-demos）

正式产品只在 `app/static/` 与 `design-system/MASTER.md`。**`design-demos/` 不进 git**（见根目录 `.gitignore`），避免仓库膨胀；线上部署也不依赖该目录。

## 已定稿

当前 UI：**B 色带分区**（曾对照 `youth/demo-b-rail.html`）。决策见仓库根目录 `direction-approved.md`。

早期 huashu 三方向（刻印 / 脊线 / 静室）过程说明见 `directions.md`。

## 若本地还要留原型

可在本机项目根下自建 `design-demos/`，仅自用，例如：

| 用途 | 建议子目录 |
|------|------------|
| 色带 + 处理仪式示意 | `industry-flow/demo-gtd-flow.html` |
| 青年版三方向 | `youth/` |
| taste 技能稿（体积大） | `taste-daydesk/`（勿提交） |

需要从历史提交恢复：`git show 668ad2f:design-demos/` 或浏览该 commit 的文件树。