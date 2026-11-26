# Daydesk

一个人的每日工作台。打开先看今天要做的三件事，而不是一堆指标。

待办、灵感、本周要交出去的结果、一周日程、日复盘和周复盘都记在这台机器的 SQLite 里。规则（超过几天提醒、顺延几次必须取舍）写在 `profile/default.json`，和内容分开。交给别人时，复制这一套程序，换他自己的服务器和域名；他的数据在他自己的 `data/` 里。设计原型不进仓库，见 [`docs/design-demos.md`](docs/design-demos.md)。

## 本地打开

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --port 8000
```

浏览器打开 http://127.0.0.1:8000/ 。

抓取框可用**输入法语音**（文字进框后点「收下」），无需服务端语音识别。

检查：

```bash
pytest
```

## 放到自己的服务器（ECS）

两种做法，**选一个惯用的即可**；数据都在 ECS 上的 `./data/daydesk.db`，换方式也不丢库。

### 怎么选

| | 方案 A · ECS 上构建 | 方案 B · 本机构镜像 + ACR |
|--|---------------------|-----------------------------------------------|
| 适合 | **默认推荐**，镜像小 | 想 ECS 更新更快、少在服务器 build |
| ECS 上 | `git pull` + `docker compose build`（几分钟） | `git pull` + `docker pull`（几十秒） |
| 本机 | 不用 Docker | 改代码后跑 `./scripts/push-image.sh` |
| 复杂度 | 最少，和你以前一样 | 多一次 ACR 命名空间 + `docker login` |

---

### 方案 A：ECS 拉代码再构建（和以前一样）

```bash
git clone <仓库> ~/daydesk && cd ~/daydesk
cp .env.example .env          # DAYDESK_TOKEN、DOMAIN（要 HTTPS 时）
docker compose up -d --build
docker compose --profile https up -d   # 可选
```

更新：`git pull && docker compose up -d --build`

---

### 方案 B：本机打一版，ECS 只拉镜像（简单省事）

**一次性：**

1. 阿里云控制台开一个 **容器镜像服务 ACR** 个人版实例，创建命名空间，记下地址，例如  
   `registry.cn-hangzhou.aliyuncs.com/daydesk/daydesk:latest`
2. 本机 `docker login --username=... registry.cn-hangzhou.aliyuncs.com`
3. 本机 `.env`：`DAYDESK_TOKEN`、`DAYDESK_IMAGE=上面地址`
4. ECS 同样 `git clone`，`.env` 与镜像地址一致；**不必在 ECS 安装构建环境**

**平时改代码：**

```bash
# 本机
./scripts/push-image.sh

# ECS
./scripts/ecs-update.sh
```

`push-image.sh` 用根目录 `Dockerfile` 构建；`ecs-update.sh` 会 `git pull`、`pull` 镜像、`compose.prod.yml up`。

首次在 ECS 若无脚本，等价于：

```bash
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml --profile https up -d
```

---

### 共通

- **HTTPS**：`.env` 里 `DOMAIN=你的域名`，`--profile https` 起 Caddy（80/443 → daydesk:8000）
- **备份**：复制 `data/daydesk.db`
- **构建镜像源**：`Dockerfile` 使用 DaoCloud Python 基础镜像 + 阿里云 pip，国内友好

配色、左上角的标题和备注在设置里改，会记在数据库里。天数和名额要改的话，编辑 `profile/default.json` 后重启。

## 每天怎么用

1. 今天：先看三件事，再看时间和收集箱。一句灵感回车就收下，不必马上变成待办。
2. 灵感只有四条路：转待办、写成文章、做一次、先放着。
3. 待办可以挂到本周的某个结果上。逾期的会留在「要看一眼」。同一条顺延满 5 次之后，只能做掉或删掉。
4. 晚上做日复盘：完成项是勾过的待办，你只处理没做完的、一个卡点，以及明天最多三件。
5. 周五做周复盘：完成、差距和卡点从这一周的记录里长出来，确认后写成下周的三个结果，并可以复制一份周报。
