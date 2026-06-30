# DeepLX Serverless

DeepL 免费翻译 API,支持 **腾讯云 SCF / Cloudflare Workers / EdgeOne 边缘函数 / 自托管** 多种部署方式。调用 DeepL 免费 oneshot 接口,伪装 Chrome 扩展指纹,暴露干净的 REST 端点。

与[原项目 DeepLX](https://github.com/OwO-Network/DeepLX) 的区别:**利用云函数请求 IP 不固定的特性,极大程度上避免 `429` 请求太频繁报错**(SCF 部署时)。

感谢原项目 [OwO-Network/DeepLX](https://github.com/OwO-Network/DeepLX) 提供的灵感与基础。

## 部署总览

| 方式 | 入口文件 | 出口 IP | 避 429 | 鉴权 | 适合 |
|---|---|---|---|---|---|
| 腾讯云 SCF(推荐) | `server.js` | 多出口轮换 | ✅ | 免鉴权 | 扛量、主入口 |
| Cloudflare Workers | `worker.js` | 共享固定段 | ❌ | 路径 API_KEY | 备用、海外 |
| EdgeOne 边缘函数 | `edgeone.js` | 共享固定段 | ❌ | 路径 API_KEY | 备用、国内边缘 |
| 自托管 | `server.js` | 你的服务器 | 视情况 | 免鉴权 | 自有服务器 |

> 边缘平台(Workers/EdgeOne)出口 IP 是共享固定段,易被 DeepL 按 IP 限流。**扛量请优先 SCF**,边缘平台作为备用入口。

---

## 方式一:腾讯云 SCF(推荐)

### 1. 打包

```bash
npm install
npm run zip      # 生成 dist.zip(含 node_modules,scf_bootstrap 已带可执行位)
```

> `npm run zip` 使用零依赖的 `scripts/zip.js`,Windows / Mac / Linux 均可运行,自动排除 `.git` / `.claude` 等无关目录。

### 2. 部署

注册 [腾讯云](https://cloud.tencent.com/) → 进入 [云函数控制台](https://console.cloud.tencent.com/scf/list) → 【新建】→【从头开始】,按下述配置(**未提及项使用默认**):

- 函数类型:Web 函数
- 函数名称:deeplx(随意)
- 地域:任意(国内也可直连)
- 运行环境:Nodejs 16.13(或更高版本,`scf_bootstrap` 已自适应 16/18/20)
- 高级配置:
    - 内存:128M
    - 执行超时时间:60 秒
    - 请求多并发:5 并发
- 日志配置 → 日志投递:启用(可选,费用极低)
- 函数代码:本地上传 zip 包 → 选择 `dist.zip`
- 触发器配置(新建触发器):
    - 默认触发器 / 触发别名:默认流量
    - 请求方法:ANY
    - 发布环境:发布
    - 鉴权方法:免鉴权

点击【完成】,进入【函数管理】→【函数代码】,下拉找到【访问路径】并复制。

### 3. 使用

访问路径形如 `https://service-aaaaa.gz.apigw.tencentcs.com/release/`,把 `/release` 替换为 `translate`:

```bash
curl --location 'https://service-aaaaa.gz.apigw.tencentcs.com/translate' \
--header 'Content-Type: application/json' \
--data '{
    "text": "你好，世界",
    "source_lang": "zh",
    "target_lang": "en"
}'
```

响应示例:

```json
{
  "alternatives": [],
  "code": 200,
  "data": "Hello, world.",
  "id": 1234567890,
  "message": "success",
  "method": "Free",
  "source_lang": "zh",
  "target_lang": "en"
}
```

### 沉浸式翻译

1. 安装最新的 [沉浸式翻译](https://github.com/immersive-translate/immersive-translate/releases)。
2. 左下角"开发者设置" → 启用测试版实验功能。
3. 翻译服务选中 `DeepLX(beta)`。
4. URL 填入访问路径(需带 `translate`)。

![沉浸式翻译](https://github.com/LegendLeo/deeplx-serverless/assets/25115173/d3affe2b-9e99-4d5c-bc8c-cd67e70d0368)

---

## 方式二:Cloudflare Workers

```bash
npx wrangler login
npx wrangler secret put API_KEY     # 输入你的密钥(切勿写入代码)
npx wrangler deploy                 # 使用项目内 wrangler.toml
```

或在 Cloudflare 控制台 → Workers & Pages → 新建 Worker → 粘贴 `worker.js` → Settings → Variables 设置 `API_KEY` → Save and Deploy。

调用(路径鉴权):

```bash
curl -X POST https://<worker>.<sub>.workers.dev/<API_KEY>/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello","source_lang":"EN","target_lang":"ZH"}'
```

---

## 方式三:腾讯云 EdgeOne 边缘函数

1. 进入 [EdgeOne 控制台](https://console.cloud.tencent.com/edgeone) → 接入站点(自己的域名或调试域名)。
2. 站点 → 边缘函数 → 新建函数 → 粘贴 `edgeone.js`(**改顶部 `API_KEY`**)→ 部署。
3. 在规则引擎中把 `你的域名/*` 路由到该函数。

```bash
curl -X POST https://<你的域名>/<API_KEY>/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello","source_lang":"EN","target_lang":"ZH"}'
```

> EdgeOne 运行时与 Cloudflare 略有差异。`edgeone.js` 顶部 `★` 注释列出了需对照 EdgeOne 文档核对的 API 点(入口语法、密钥注入方式、第三方子请求放行、自定义请求头)。

---

## 自托管

```bash
git clone https://github.com/LegendLeo/deeplx-serverless
cd deeplx-serverless
npm install
npm start          # Express 监听 9000 端口(或 $PORT)
```

---

## API 参考

| 部署方式 | 端点 | 鉴权 |
|---|---|---|
| SCF / 自托管 | `POST /translate` | 免鉴权 |
| Workers / EdgeOne | `POST /<API_KEY>/translate` | 路径中的 API_KEY |

请求体(JSON):

| 字段 | 必填 | 说明 |
|---|---|---|
| `text` | 是 | 待翻译文本,≤ 1500 字符 |
| `source_lang` | 否 | 源语言代码,`AUTO` 或缺省 = 自动检测 |
| `target_lang` | 是 | 目标语言代码 |

语言代码不区分大小写:`ZH` / `EN` / `JA` / `DE` / `FR` / `KO` / ... 完整列表见 `translate.js` 语言映射表。

错误码:

| HTTP | code | 含义 |
|---|---|---|
| 200 | 200 | 成功 |
| 400 | 400 | 不支持的语言 / target_lang 为 auto |
| 413 | 413 | 文本超过 1500 字符 |
| 429 | 429 | 被 DeepL 限流 |
| 500 | 500 | 其他错误 |

---

## 项目结构

| 文件 | 说明 |
|---|---|
| `translate.js` | 核心翻译引擎(axios 调 DeepL oneshot 接口、语言映射、cookie 预热)。SCF / 自托管使用。 |
| `server.js` | Express HTTP 服务,暴露 `POST /translate`。SCF / 自托管使用。 |
| `worker.js` | Cloudflare Workers 版(原生 fetch、路径鉴权)。 |
| `edgeone.js` | EdgeOne 边缘函数版(ServiceWorker 风格、路径鉴权)。 |
| `scripts/zip.js` | 零依赖跨平台打包脚本,生成 SCF 部署包 `dist.zip`。 |
| `scf_bootstrap` | SCF Web 函数入口(LF 行尾,自动探测 node 路径)。 |
| `wrangler.toml` | Cloudflare Workers 部署配置。 |
| `test.js` | 翻译冒烟测试。 |

---

## Commands

```bash
npm install        # 安装依赖
npm start          # 启动 Express 服务(端口 9000 或 $PORT)
node test.js       # 翻译测试
npm run zip        # 生成 SCF 部署包 dist.zip
```

## License

MIT
