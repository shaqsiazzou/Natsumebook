# Natsumebook

夏目友人帐妖怪图鉴页面与管理后台。

## 当前线上状态

```text
临时前台 / Koyeb 根路径       https://natsume.koyeb.app/
后台管理页                   https://natsume.koyeb.app/admin
公开图鉴 API                 https://natsume.koyeb.app/api/catalog
GitHub 仓库                  https://github.com/shaqsiazzou/Natsumebook
Koyeb 服务端口               7000 / HTTP / public HTTPS / path /
Supabase Storage bucket      monster-images
```

当前架构：

```text
Cloudflare Pages / 静态前台
  -> 读取 https://natsume.koyeb.app/api/catalog
Koyeb / Node Express 后端
  -> 读写 Supabase episodes 表
  -> 上传图片到 Supabase Storage
Supabase
  -> 保存标题、名字、图片 URL、缩略图 URL、图片文件
```

Koyeb 根路径现在也能显示前台页面，但正式用途主要是 `/admin` 和 `/api/catalog`。以后如果 Cloudflare Pages 绑定了正式域名，用户入口应以 Cloudflare Pages 为准。

## 目录

```text
index.html                        前台页面入口
transparent-video-demo.html       旧链接跳转兼容页
admin.html                        管理后台页面
server.mjs                        Node/Express 后端与上传接口
data/catalog.json                 图鉴数据
assets/videos/                    前台 reveal 动画视频
assets/images/ui/                 UI、框架、角色与 logo 素材
assets/images/monsters/           每集妖怪大图
assets/images/monsters/thumbs/    每集妖怪缩略图
assets/source/                    原始素材
```

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

访问：

```text
http://127.0.0.1:7000/
http://127.0.0.1:7000/admin
```

## 环境变量

```text
ADMIN_PASSWORD=后台登录密码
HOST=0.0.0.0
PORT=7000
SUPABASE_URL=Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=Supabase service_role key
SUPABASE_STORAGE_BUCKET=monster-images
```

配置 Supabase 变量后，后端会读写 Supabase `episodes` 表，并把后台上传的图片保存到 Supabase Storage。未配置时会继续使用本地 `data/catalog.json` 和 `assets/images/monsters/`。

Koyeb 环境变量同样需要配置以上内容，尤其不要遗漏：

```text
HOST=0.0.0.0
PORT=7000
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=monster-images
```

`SUPABASE_SERVICE_ROLE_KEY` 只能放在本地 `.env` 和 Koyeb 环境变量里，不要放到 Cloudflare Pages 或前端代码。

可选变量：

```text
CATALOG_CACHE_TTL_MS=3600000
```

用于调整 `/api/catalog` 后端内存缓存时间，单位毫秒；未设置时默认 1 小时。

## 后台功能

- 按季、按集编辑显示文字
- 单集上传图片
- 上传图片自动使用 Sharp 压缩为 WebP
- 自动生成列表缩略图

## 前台 UI 记录

- 2026-05-13：图鉴季节列表改为可折叠；第一季默认展开，第二季到第七季默认折叠。
- 2026-05-13：移动端 hero 底部到第一季列表之间增加渐变衔接，减少“不可结缘”下方的硬分界线。
- 2026-05-13：修正移动端图鉴区背景衔接为全宽显示，避免出现居中的矩形色块。
- 2026-05-13：移除移动端 hero 底部遮罩与图鉴区额外渐变，消除亮色模式下“不可结缘”和第一季之间的背景分层线。
- 2026-05-13：折叠季节项改为胶囊卡片式组件，包含季数徽章、标题说明和圆形箭头按钮。
- 2026-05-13：视频播放层顶部增加低对比小字提示“点击画面可跳过动画”。
- 2026-05-13：欢迎页主视觉由静态图片替换为透明 WebM 视频，保留原位置并使用 0.5 倍速循环播放。

## 性能记录

- 2026-05-13：后端 `/api/catalog` 增加 Node 进程内存缓存，默认 1 小时；后台编辑文字、上传图片或写入本地 catalog 后会清缓存。

## 部署与数据源

- Cloudflare Pages：前台静态页面
- Koyeb：Node 后端
- Supabase：图鉴数据与图片存储

前台页面优先从 Koyeb API 读取图鉴数据：

```text
https://natsume.koyeb.app/api/catalog
```

请求失败时会回退到本地 `data/catalog.json`。

前台静态页面改动推送到 GitHub `main` 后，会触发 Cloudflare Pages 自动更新。

Koyeb 使用 Buildpack 自动识别 Node 项目即可。通常不需要自定义构建命令或运行命令；如果需要手动填写，运行命令用：

```bash
npm start
```

Koyeb 端口配置：

```text
端口：7000
协议：HTTP
公共 HTTPS 访问：开启
小路：/
代理 TCP 访问：关闭
```

## Supabase 初始化

在 Supabase Dashboard 打开 SQL Editor，新建查询，粘贴并运行：

```text
supabase/schema.sql
```

脚本会创建 `episodes` 表、`monster-images` Storage bucket，并初始化 7 季 86 集占位数据。

## 继续开发与推送

常用检查：

```bash
git status --short --branch
node --check server.mjs
```

本地启动：

```bash
./start-admin.sh
```

本地停止：

```bash
./stop-admin.sh
```

提交并推送普通改动：

```bash
git add <files>
git commit -m "描述这次改动"
git push -u "https://x-access-token:${GITHUB_TOKEN:-$GH_TOKEN}@github.com/shaqsiazzou/Natsumebook.git" main
git remote set-url origin https://github.com/shaqsiazzou/Natsumebook.git
git branch --unset-upstream || true
git fetch origin main
git branch --set-upstream-to=origin/main main
```

这里需要临时 token URL，是因为当前环境的 git credential helper 会尝试调用不存在的 `gh` 命令。推送后一定要把 remote URL 清回普通 GitHub 地址，避免 token 留在 git 配置里。

注意：本地可能存在未提交的 `data/catalog.json` 内容编辑。UI/逻辑改动通常不要顺手提交它；线上图鉴内容以后以 Supabase 为准。
