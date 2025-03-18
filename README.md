## 功能特性

- 创建和管理多部作品
- 章节管理和编辑功能
- 支持多种 AI 模型 (Gemini、OpenAI 兼容格式)
- 灵感管理功能
- -双模型合体提升输出质量
- 去除AI味
- 完美符合网文标准
- 本地存储，无需服务器

## 如何使用

1. 打开 index.html 开始使用应用
2. 创建新作品或选择现有作品
3. 使用编辑界面编写内容
4. 使用 AI 辅助功能润色或扩展文本

## 关于 AI 模型配置

### 支持的模型类型

- **Google Gemini**: 可直接从浏览器调用
- **OpenAI 兼容格式**: 包括 DeepSeek 等使用 OpenAI 兼容 API 的模型

### 解决 DeepSeek API 的 CORS 问题

由于浏览器的安全限制（CORS），DeepSeek API 不能直接从浏览器调用。您会看到 `Failed to fetch` 错误。以下是几种解决方案：

#### 方案一：使用简单的代理服务器（推荐）

您可以创建一个简单的代理服务器来转发 API 请求。以下是使用 Node.js 创建代理服务器的步骤：

1. 安装 Node.js（https://nodejs.org/）
2. 创建一个新文件夹，例如 `api-proxy`
3. 在该文件夹中创建一个文件 `proxy.js`，内容如下：

```javascript
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3001;

// 启用 CORS
app.use(cors());

// 代理 DeepSeek API 请求
app.use('/api/deepseek', createProxyMiddleware({
  target: 'https://api.deepseek.com',
  changeOrigin: true,
  pathRewrite: {
    '^/api/deepseek': ''
  },
  onProxyReq: (proxyReq, req, res) => {
    // 保留原始 Authorization 头
    if (req.headers.authorization) {
      proxyReq.setHeader('Authorization', req.headers.authorization);
    }
  }
}));

app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});
```

4. 在文件夹中运行以下命令安装依赖项：
```
npm init -y
npm install express cors http-proxy-middleware
```

5. 启动代理服务器：
```
node proxy.js
```

6. 在应用的后台管理界面中，将 DeepSeek API 端点设置为：
```
http://localhost:3001/api/deepseek/chat/completions
```

#### 方案二：使用浏览器扩展禁用 CORS （仅开发测试使用）

您可以安装浏览器扩展来临时禁用 CORS 限制，但这种方法只推荐在开发环境使用，不适合生产环境：

- Chrome: [CORS Unblock](https://chrome.google.com/webstore/detail/cors-unblock/lfhmikememgdcahcdlaciloancbhjino)
- Firefox: [CORS Everywhere](https://addons.mozilla.org/en-US/firefox/addon/cors-everywhere/)

#### 方案三：使用 Gemini API

如果不想设置代理服务器，您可以使用 Google Gemini API，它允许直接从浏览器调用。

## 隐私说明

所有数据都存储在浏览器的本地存储中，不会上传到任何服务器（除了 AI API 请求）。 
