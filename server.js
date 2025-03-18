const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
// 使用 Node.js v18+ 内置的 fetch 或回退到 node 原生 https
const https = require('https');
const http = require('http');
// 添加mime类型支持
const mime = require('mime-types');

// 控制台颜色
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// 在 Windows 上设置命令行编码为 UTF-8
if (process.platform === 'win32') {
  try {
    // 尝试设置控制台代码页为 UTF-8 (65001)
    require('child_process').execSync('chcp 65001');
    console.log("已将控制台编码设置为 UTF-8");
  } catch (error) {
    console.log("无法设置控制台编码:", error.message);
  }
}

// 创建日志函数
function log(message, type = 'info') {
  const timestamp = new Date().toLocaleString('zh-CN');
  let prefix = '';
  
  switch(type) {
    case 'error':
      prefix = `${colors.red}${colors.bright}[错误]${colors.reset}`;
      break;
    case 'warn':
      prefix = `${colors.yellow}${colors.bright}[警告]${colors.reset}`;
      break;
    case 'success':
      prefix = `${colors.green}${colors.bright}[成功]${colors.reset}`;
      break;
    case 'info':
    default:
      prefix = `${colors.blue}${colors.bright}[信息]${colors.reset}`;
      break;
  }
  
  console.log(`${prefix} ${timestamp} - ${message}`);
}

// 创建自定义 fetch 函数 (兼容 Node.js < 18 版本)
async function customFetch(url, options = {}) {
  // 优先使用全局 fetch (Node.js 18+)
  if (typeof global.fetch === 'function') {
    return global.fetch(url, options);
  }
  
  // 回退到自定义实现
  return new Promise((resolve, reject) => {
    // 解析 URL 以获取主机名和路径
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const reqModule = isHttps ? https : http;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    
    const req = reqModule.request(reqOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        // 模拟 fetch API 的响应对象
        const response = {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          json: async () => JSON.parse(data),
          text: async () => data,
        };
        
        resolve(response);
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    // 发送请求体
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

// 创建Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 简单的HTML测试页面 - 用于验证服务器配置
const testHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>服务器测试页面</title>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
    h1 { color: #4CAF50; }
    .success { color: green; }
    .container { max-width: 800px; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="container">
    <h1>服务器配置测试</h1>
    <p class="success">✅ 如果您能看到这个页面，说明服务器已正确配置HTML渲染!</p>
    <h2>常用链接:</h2>
    <ul>
      <li><a href="/index.html">主页</a></li>
      <li><a href="/admin.html">管理页面</a></li>
      <li><a href="/xie.html">编辑页面</a></li>
    </ul>
    <p>服务器时间: ${new Date().toLocaleString('zh-CN')}</p>
  </div>
</body>
</html>
`;

// 中间件
app.use(cors());

// 静态文件处理 - 必须放在最前面
app.use(express.static('.', {
  setHeaders: function (res, path, stat) {
    // 根据文件扩展名设置适当的Content-Type
    if (path.endsWith('.html')) {
      res.set('Content-Type', 'text/html; charset=utf-8');
    } else if (path.endsWith('.css')) {
      res.set('Content-Type', 'text/css; charset=utf-8');
    } else if (path.endsWith('.js')) {
      res.set('Content-Type', 'application/javascript; charset=utf-8');
    } else if (path.endsWith('.json')) {
      res.set('Content-Type', 'application/json; charset=utf-8');
    }
    // 不要在这里设置默认Content-Type，让Express自行决定
  }
}));

// 支持大文件和中文字符
app.use(bodyParser.json({ 
  limit: '10mb'
}));
app.use(bodyParser.urlencoded({ 
  extended: true,
  limit: '10mb'
}));

// 测试路由 - 用于验证服务器正常工作
app.get('/test', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(testHtml);
});

// 明确设置根路径访问
app.get('/', (req, res) => {
  log('访问根路径，重定向到 index.html', 'info');
  res.redirect('/index.html');
});

// 明确设置 index.html 的处理，使用通用处理函数
app.get('/index.html', serveHtmlFile('index.html'));

// 通用HTML文件处理函数
function serveHtmlFile(filename) {
  return (req, res) => {
    log(`明确处理 ${filename} 请求`, 'info');
    const filePath = path.join(__dirname, filename);
    
    if (fs.existsSync(filePath)) {
      const htmlContent = fs.readFileSync(filePath, 'utf8');
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.send(htmlContent);
    } else {
      log(`${filename} 文件不存在`, 'error');
      res.status(404).send(`${filename} 文件不存在`);
    }
  };
}

// 为主要HTML文件添加明确的路由
app.get('/admin.html', serveHtmlFile('admin.html'));
app.get('/xie.html', serveHtmlFile('xie.html'));
app.get('/inspiration.html', serveHtmlFile('inspiration.html'));

// 请求日志中间件
app.use((req, res, next) => {
  // 不记录静态文件请求，避免日志过多
  if (!req.path.includes('.')) {
    log(`${colors.cyan}${req.method}${colors.reset} ${req.url}`);
  }
  next();
});

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
try {
  fs.ensureDirSync(dataDir);
  log(`数据目录已创建/确认: ${dataDir}`, 'success');
} catch (error) {
  log(`创建数据目录失败: ${error.message}`, 'error');
}

// 初始化数据文件（如果不存在）
const booksPath = path.join(dataDir, 'books.json');
const inspirationPath = path.join(dataDir, 'inspiration.json');

try {
  if (!fs.existsSync(booksPath)) {
    fs.writeJsonSync(booksPath, []);
    log(`创建书籍数据文件: ${booksPath}`, 'success');
  } else {
    log(`书籍数据文件已存在: ${booksPath}`, 'info');
  }

  if (!fs.existsSync(inspirationPath)) {
    fs.writeJsonSync(inspirationPath, []);
    log(`创建灵感数据文件: ${inspirationPath}`, 'success');
  } else {
    log(`灵感数据文件已存在: ${inspirationPath}`, 'info');
  }
} catch (error) {
  log(`初始化数据文件失败: ${error.message}`, 'error');
}

// API健康检查端点
app.get('/api/health', (req, res) => {
  log('收到健康检查请求', 'info');
  res.status(200).json({ status: 'ok', message: '服务器运行正常' });
});

// 代理请求到外部API
app.post('/api/proxy', async (req, res) => {
  try {
    const { apiUrl, apiKey, body } = req.body;
    
    if (!apiUrl) {
      log(`代理请求缺少API URL`, 'error');
      return res.status(400).json({ error: '缺少API URL参数' });
    }
    
    log(`[代理] 发送请求到: ${apiUrl}`, 'info');
    
    // 构建请求头
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // 如果提供了API密钥，添加到请求头
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      log(`[代理] 使用API密钥: ${apiKey.substring(0, 5)}...`, 'info');
    }
    
    // 使用自定义fetch发送请求
    const response = await customFetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    
    // 获取响应数据
    let responseData;
    const contentType = response.headers['content-type'];
    
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
      log(`[代理] 收到JSON响应，状态码: ${response.status}`, 'info');
    } else {
      const textResponse = await response.text();
      log(`[代理] 收到非JSON响应，状态码: ${response.status}`, 'warn');
      try {
        // 尝试将文本解析为JSON
        responseData = JSON.parse(textResponse);
      } catch (e) {
        responseData = { text: textResponse };
        log(`[代理] 响应不是有效的JSON格式，作为文本处理`, 'warn');
      }
    }
    
    // 如果API返回错误，将错误转发回客户端
    if (!response.ok) {
      log(`[代理] API返回错误状态码: ${response.status}`, 'error');
      log(`[代理] API错误详情: ${JSON.stringify(responseData)}`, 'error');
      return res.status(response.status).json({
        error: `API返回错误状态码 ${response.status}`,
        details: responseData
      });
    }
    
    // 将API响应发送回客户端
    log(`[代理] 响应成功转发到客户端`, 'success');
    res.json(responseData);
  } catch (error) {
    log(`[代理] 处理出错: ${error.message}`, 'error');
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      log(`[代理] 网络连接失败: 无法连接到API服务器`, 'error');
      return res.status(502).json({ 
        error: '网络连接失败', 
        message: '无法连接到API服务器，请检查URL是否正确或服务器是否可访问',
        details: error.message 
      });
    }
    res.status(500).json({ 
      error: '代理请求处理失败', 
      message: '服务器在处理您的请求时遇到内部错误',
      details: error.message 
    });
  }
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
  log(`未捕获的错误: ${err.message}`, 'error');
  console.error(err.stack);
  res.status(500).json({ 
    error: '服务器内部错误', 
    message: '处理请求时发生意外错误',
    details: err.message 
  });
});

// 处理404错误
app.use((req, res) => {
  // 不记录静态资源的404错误
  if (!req.path.includes('.')) {
    log(`未找到资源: ${req.url}`, 'warn');
  }
  
  // 检查是否是HTML页面请求
  if (req.accepts('html')) {
    res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>404 - 页面未找到</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          h1 { color: #e74c3c; }
          a { color: #3498db; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>404 - 未找到页面</h1>
        <p>抱歉，您请求的页面 "${req.url}" 不存在。</p>
        <p><a href="/">返回首页</a> | <a href="/test">查看测试页面</a></p>
      </body>
      </html>
    `);
  } else {
    // API请求返回JSON
    res.status(404).json({ 
      error: '未找到', 
      message: `找不到请求的资源: ${req.url}` 
    });
  }
});

// 启动服务器
const server = app.listen(PORT, () => {
  log(`${colors.green}${colors.bright}服务器启动成功!${colors.reset}`, 'success');
  
  // 检查一些常用文件是否存在
  const commonFiles = ['index.html', 'admin.html', 'xie.html'];
  let fileStatus = '';
  
  commonFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      const mimeType = mime.lookup(file) || '未知';
      fileStatus += `✅ ${file} - 已找到 (${mimeType})\n`;
    } else {
      fileStatus += `❌ ${file} - 未找到\n`;
    }
  });
  
  log(`文件检查:\n${fileStatus}`, 'info');
  log(`服务器运行在 ${colors.cyan}http://localhost:${PORT}${colors.reset}`, 'info');
  log(`访问首页: ${colors.cyan}http://localhost:${PORT}/index.html${colors.reset}`, 'info');
  log(`测试页面: ${colors.cyan}http://localhost:${PORT}/test${colors.reset}`, 'info');
  log(`管理后台: ${colors.cyan}http://localhost:${PORT}/admin.html${colors.reset}`, 'info');
  log(`AI代理接口: ${colors.cyan}http://localhost:${PORT}/api/proxy${colors.reset}`, 'info');
  log(`按 ${colors.bright}Ctrl+C${colors.reset} 停止服务器`, 'info');
});

// 监听服务器错误
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log(`端口 ${PORT} 已被占用，请尝试关闭占用该端口的程序或使用其他端口`, 'error');
  } else {
    log(`服务器错误: ${error.message}`, 'error');
  }
});
