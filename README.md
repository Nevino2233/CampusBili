<div align="center">

# 🎓 CampusBili

**校园哔哩哔哩 — 让内网也能愉快看 B 站**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D12-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*宿舍断网？校园网限速？实验室只能上内网？—— 没关系，CampusBili 帮你搞定 🚀*

</div>

***

## 🤔 这是什么？

你有没有经历过这些场景：

- 🏫 宿舍里只有一台机器能上外网，室友们只能干瞪眼
- 🖥️ 实验室的机器都在内网，想看个 B 站教程都看不了
- 📱 手机连着校园 WiFi，打开 B 站转圈转到天荒地老

**CampusBili** 就是为了解决这些痛点而生的！只需要一台能上外网的机器部署它，内网里的所有设备就都能愉快地刷 B 站了。

> 简单来说：**一台服务器，全宿舍看 B 站** 🎉

## ✨ 功能特性

| 功能            | 描述                           |
| ------------- | ---------------------------- |
| 🔐 **多方式登录**  | 扫码 / 密码 / 短信验证码，想怎么登就怎么登     |
| 🖥️ **多设备支持** | 不同设备登录不同账号，你的追番列表不会出现在室友的首页上 |
| 🎬 **视频代理播放** | 视频流 + 图片全部代理，内网设备直接看         |
| 🔍 **搜索与推荐**  | 关键词搜索、热门推荐、排行榜，该有的都有         |
| 💬 **评论与动态**  | 看看网友说了啥，关注 UP 主的最新动态         |
| 👤 **个人空间**   | 查看用户信息、投稿视频                  |
| 📱 **响应式设计**  | 电脑手机都能用，躺在床上也能刷              |
| 🔄 **会话恢复**   | Cookie 丢了？设备指纹帮你自动恢复登录状态     |
| 🛡️ **安全防护**  | SSRF 防护、速率限制、XSS 过滤、安全响应头    |

## 🛠️ 技术栈

```
Node.js + Express + EJS + xgplayer + GeeTest + 原生 CSS
```

没错，没有 React、没有 Vue、没有 Webpack —— 简单纯粹，拿来就能跑。

## 🚀 快速开始

### 环境要求

- Node.js >= 12.0.0
- pnpm

### 三步搞定

```bash
# 1️⃣ 克隆仓库
git clone https://github.com/YOUR_USERNAME/CampusBili.git
cd CampusBili

# 2️⃣ 安装依赖
pnpm install

# 3️⃣ 启动！
pnpm start
```

打开 `http://localhost:8001`，开始你的内网 B 站之旅 🎉

> Windows 用户也可以双击 `启动.bat` 一键启动

### 配置为 Windows 服务（可选，开机自启）

```bash
node install-service.js    # 安装服务
node uninstall-service.js  # 卸载服务
```

## 📐 部署架构

```
┌─────────────────────────────────────────────┐
│                  校园内网                      │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  室友 A   │  │  室友 B   │  │   你     │  │
│  │  手机     │  │  平板     │  │  电脑    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │              │              │         │
│       └──────────────┼──────────────┘         │
│                      │                        │
│              ┌───────┴───────┐                │
│              │  CampusBili   │                │
│              │  代理服务器    │                │
│              │  :8001        │                │
│              └───────┬───────┘                │
│                      │                        │
└──────────────────────┼────────────────────────┘
                       │
              ┌────────┴────────┐
              │   Bilibili API   │
              └─────────────────┘
```

### 部署步骤

1. 找一台能上外网的机器（你的电脑就行）
2. 安装 Node.js，克隆并启动 CampusBili
3. 告诉室友访问 `http://你的IP:8001`
4. 🎉 全宿舍一起看 B 站

### 多设备登录

CampusBili 通过 **设备指纹** 机制区分不同设备：

- 每台设备首次访问自动分配唯一 `device_id`
- Cookie + localStorage + 请求参数 **三重保障**
- Cookie 丢了？IP + User-Agent 指纹帮你自动恢复
- **你的号是你的号，室友的号是室友的号**，互不干扰

## 📁 项目结构

```
CampusBili/
├── server.js              # 主入口
├── routes/
│   ├── auth.js            # 认证（登录/登出/用户信息）
│   ├── api.js             # Bilibili API 代理
│   ├── index.js           # 页面路由
│   ├── videoStream.js     # 视频流代理（带重试 & 超时控制）
│   └── image.js           # 图片代理（流式传输）
├── lib/
│   ├── authService.js     # 认证业务逻辑
│   ├── apiService.js      # API 数据服务
│   ├── sessionStore.js    # 会话存储（文件持久化 + 指纹索引）
│   ├── wbi.js             # WBI 签名
│   ├── cache.js           # 缓存
│   └── logger.js          # 日志
├── middleware/
│   ├── rateLimit.js       # 请求频率限制
│   └── paramsValidator.js # 参数验证
├── views/                 # EJS 模板
├── public/                # 静态资源
├── data/sessions/         # 会话数据（自动创建，已 gitignore）
├── .gitignore
├── LICENSE
└── README.md
```

## ⚙️ 配置

### 修改端口

```bash
# 方法 1：环境变量
PORT=8080 pnpm start

# 方法 2：改代码
# 编辑 server.js: var PORT = process.env.PORT || 8001;
```

### 环境变量

| 变量名        | 说明   | 默认值           |
| ---------- | ---- | ------------- |
| `PORT`     | 服务端口 | `8001`        |
| `NODE_ENV` | 运行环境 | `development` |

### 会话数据

会话存储在 `data/sessions/sessions.json`，包含用户登录凭据。**请勿提交到版本控制**（已在 `.gitignore` 中排除）。

## ❓ 常见问题

<details>
<summary><b>内网设备扫码登录后仍显示未登录？</b></summary>

确保浏览器允许来自 IP 地址的 Cookie。CampusBili 已设置 `sameSite: false` 兼容 IP 访问。如果仍有问题：

1. 清除浏览器缓存后重新登录
2. 检查浏览器是否禁用了第三方 Cookie

</details>

<details>
<summary><b>视频无法播放？</b></summary>

1. 确认服务器能正常访问 Bilibili API
2. 查看服务器日志，检查视频流代理是否正常
3. 部分版权视频可能无法代理播放（这不是 bug，是版权保护）

</details>

<details>
<summary><b>如何在多台服务器上部署？</b></summary>

每台服务器独立运行 CampusBili 实例，会话数据不共享。如果需要共享会话，可以修改 `sessionStore.js` 接入 Redis 等外部存储。

</details>

<details>
<summary><b>安全吗？</b></summary>

CampusBili 内置了多层安全防护：

- ✅ SSRF 防护（白名单域名校验，拦截内网/localhost/云元数据访问）
- ✅ XSS 防护（输出转义 + 安全响应头）
- ✅ 速率限制（300 次/5 分钟）
- ✅ 安全响应头（Helmet：X-Frame-Options、CSP、HSTS 等）
- ✅ 会话凭据不暴露给前端

</details>

## 🙋 关于这个项目

这是我的 **第一个开源项目** 🎊

作为一个学生，我深知校园网的痛 —— 想看个 B 站教程都费劲。于是花了些时间写了这个工具，先解决了自己的问题，然后想着也许能帮到其他有同样困扰的同学，就开源出来了。

代码可能不够优雅，架构可能不够完美，但它是 **能用的、好用的**。如果你觉得它对你有帮助，请给个 ⭐ Star —— 这对一个第一次做开源的人来说，真的意义重大！

> 如果你有任何建议或发现了 bug，欢迎提 Issue 或 PR，我会认真对待每一条反馈 💪

## 🤝 参与贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交修改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 📄 免责声明

本项目仅供学习和研究使用，不得用于商业用途。本项目与哔哩哔哩 (bilibili) 官方无关。使用本项目所产生的一切后果由使用者自行承担。

## 📜 License

[MIT](LICENSE) — 随便用，出了事别找我 😄

***

<div align="center">

**如果这个项目帮到了你，请给个 ⭐ Star 吧！**

*Made with ❤️ by a student who just wanted to watch Bilibili in the dorm*

</div>
