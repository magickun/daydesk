# Daydesk

一个人的每日工作台。打开先看今天要做的三件事，而不是一堆指标。

待办、灵感、本周要交出去的结果、一周日程、日复盘和周复盘都记在这台机器的 SQLite 里。规则（超过几天提醒、顺延几次必须取舍）写在 `profile/default.json`，和内容分开。交给别人时，复制这一套程序，换他自己的服务器和域名；他的数据在他自己的 `data/` 里。

## 本地打开

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --port 8000
```

浏览器打开 http://127.0.0.1:8000/ 。

检查：

```bash
pytest
```

## 放到自己的服务器

服务器和域名由使用者自己买。这一份只交付软件。

```bash
cp .env.example .env
```

在 `.env` 里写下 `DAYDESK_TOKEN`。不设口令时，任何能访问端口的人都能改数据。

```bash
docker compose up -d --build
```

基础镜像从 DaoCloud 的公开镜像拉取，避免在国内构建时直连 Docker Hub。程序听在 8000 端口。要让 Caddy 申请证书并把域名指过来：

```bash
# .env 里的 DOMAIN 写成自己的域名，不要带 https://
docker compose --profile https up -d
```

域名的 A 记录指向这台机器。备份时复制 `data/daydesk.db` 即可。

配色、左上角的标题和备注在设置里改，会记在数据库里。天数和名额要改的话，编辑 `profile/default.json` 后重启。

## 每天怎么用

1. 今天：先看三件事，再看时间和收集箱。一句灵感回车就收下，不必马上变成待办。
2. 灵感只有四条路：转待办、写成文章、做一次、先放着。
3. 待办可以挂到本周的某个结果上。逾期的会留在「要看一眼」。同一条顺延满 5 次之后，只能做掉或删掉。
4. 晚上做日复盘：完成项是勾过的待办，你只处理没做完的、一个卡点，以及明天最多三件。
5. 周五做周复盘：完成、差距和卡点从这一周的记录里长出来，确认后写成下周的三个结果，并可以复制一份周报。
