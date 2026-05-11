# Natsumebook

夏目友人帐妖怪图鉴页面与本地管理后台。

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
```

## 后台功能

- 按季、按集编辑显示文字
- 单集上传图片
- 上传图片自动使用 Sharp 压缩为 WebP
- 自动生成列表缩略图

## 部署方向

- Cloudflare Pages：前台静态页面
- Koyeb：Node 后端
- Supabase：后续迁移图鉴数据与图片存储

## Supabase 初始化

在 Supabase Dashboard 打开 SQL Editor，新建查询，粘贴并运行：

```text
supabase/schema.sql
```

脚本会创建 `episodes` 表、`monster-images` Storage bucket，并初始化 7 季 86 集占位数据。
