# Daydesk 设计系统

个人每日工作台。**方向 B · 色带分区**（2026-11 落地）

## 风格

- 高明度薄荷底 `#F6FFFB`、白卡片、**左侧 4px 语义色带**区分区块
- 字体 **Plus Jakarta Sans**，编号/周次 **JetBrains Mono**
- 主按钮青绿；筛选与泳道用语义色呼应
- 药丸按钮与圆角 14–16px；卡片少阴影，靠色带扫读
- 图标 1.75 描边，无 emoji

## 色带语义

| 类名 | 含义 | 默认色 |
|---|---|---|
| `zone--task` | 三件、待办 | 绿 `#10B981` |
| `zone--inbox` | 收集箱 | 天蓝 `#38BDF8` |
| `zone--risk` | 要看一眼、问题 | 橙 `#FB923C` |
| `zone--time` | 日程 | 靛 `#6366F1` |
| `zone--goal` | 本周结果 | 青 `#14B8A6` |
| `zone--hold/write/try/settled` | 灵感泳道 | 紫/粉/青/黄绿 |

## 三套主题

设置名不变（`paper` / `stone` / `ink`），只换 token；色带色相随主题 accent 微调。

## 布局

- 今天：bento（三件 | 收集箱）+ 风险 + 时间 | 目标
- 灵感：五泳道均带 `zone--*`
- 复盘：`steps` 每步 `zone--review` + 语义修饰

## 动效

150–200ms；`prefers-reduced-motion` 关闭位移。