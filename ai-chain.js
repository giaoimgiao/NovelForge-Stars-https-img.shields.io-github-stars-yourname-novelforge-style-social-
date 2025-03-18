/**
 * AI模型链式调用处理
 * 实现DeepSeek与Gemini模型的无缝流式调用切换
 */

// 获取AI模型配置信息
function getAIModelConfig() {
  // 默认返回值
  const defaultConfig = {
    custom: null,
    gemini: null
  };
  
  // 从localStorage检查Gemini配置
  const modelConfigString = localStorage.getItem('modelConfig');
  
  if (modelConfigString) {
    try {
      const modelConfig = JSON.parse(modelConfigString);
      if (modelConfig?.gemini?.key) {
        defaultConfig.gemini = {
          // 使用name属性作为模型名称
          name: modelConfig.gemini.model || 'gemini-2.0-flash',
          key: modelConfig.gemini.key,
          // 保留model属性以兼容其他代码
          model: modelConfig.gemini.model || 'gemini-2.0-flash'
        };
        
        // 记录当前使用的模型名称
        console.log("已加载Gemini模型配置，使用模型:", defaultConfig.gemini.name);
      }
    } catch (error) {
      console.error("解析Gemini模型配置失败:", error);
    }
  }
  
  // 检查自定义模型配置
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('customModel-')) {
      try {
        const config = JSON.parse(localStorage.getItem(key));
        if (config && config.apiKey && config.endpoint) {
          defaultConfig.custom = {
            name: key.replace('customModel-', ''),
            apiKey: config.apiKey,
            endpoint: config.endpoint,
            model: config.model || 'deepseek-chat'
          };
          break; // 使用第一个找到的自定义模型
        }
      } catch (error) {
        console.error(`解析自定义模型配置失败(${key}):`, error);
      }
    }
  }
  
  return defaultConfig;
}
 
/**
 * 级联模型调用 - 使用流式输出机制实现DeepSeek和Gemini的无缝切换
 * @param {string} content - 用户输入的原始内容
 * @param {function} onUpdate - 流式更新回调函数，接收两个参数：文本内容和类型(thinking/content)
 * @param {object} options - 可选参数，包含temperature(温度)、contextLength(上下文长度)和maxTokens(最大输出长度)
 * @returns {Promise<object>} - 包含思维链和最终内容的对象
 */
async function chainModelCall(content, onUpdate, options = {}) {
  // 获取模型配置
  const modelConfig = getAIModelConfig();
  
  // 设置默认参数值
  const temperature = options.temperature !== undefined ? options.temperature : 0.8;
  const contextLength = options.contextLength !== undefined ? options.contextLength : 100;
  const maxTokens = options.maxTokens !== undefined ? options.maxTokens : 4000;
  
  console.log(`使用参数: 温度=${temperature}, 上下文长度=${contextLength}, 最大输出=${maxTokens}`);
  
  // 如果没有任何模型可用，使用本地模拟
  if (!modelConfig.custom && !modelConfig.gemini) {
    console.log("未找到可用的AI模型配置，使用本地模拟");
    const simulatedResult = await simulateAIEnhancement(content);
    if (onUpdate) {
      onUpdate(simulatedResult, 'content');
    }
    return {
      reasoningChain: null,
      content: simulatedResult
    };
  }
  
  try {
    let reasoningChain = "";
    let finalContent = "";
    let modelName = "AI";
    
    // 创建一个控制器，用于在需要时中止请求
    const abortController = new AbortController();
    
    // 第一步：从DeepSeek获取思维链（流式输出）
    if (modelConfig.custom) {
      try {
        console.log("第1步：调用DeepSeek模型获取思维链（流式输出）");
        modelName = modelConfig.custom.name || 'deepseek-reasoner';
        
        // 创建一个Promise，在DeepSeek流式输出完成时解析
        await new Promise((resolve, reject) => {
          streamDeepSeekModel(
            content, 
            modelConfig.custom,
            // 流式更新回调 - 只处理思维链部分
            (chunk, isThinking) => {
              if (isThinking) {
                reasoningChain += chunk;
                if (onUpdate) {
                  onUpdate(chunk, 'thinking');
                }
              }
            },
            // 完成回调
            (success, reason) => {
              if (success) {
                resolve();
              } else {
                reject(new Error(reason || "DeepSeek流式输出失败"));
              }
            },
            abortController.signal,
            { temperature: temperature, maxTokens: maxTokens }
          );
        });
        
        console.log("DeepSeek思维链长度:", reasoningChain.length);
        
      } catch (error) {
        console.error("DeepSeek模型调用失败:", error);
        
        // 如果DeepSeek调用失败，但Gemini可用，直接使用Gemini
        if (!modelConfig.gemini) {
          // 如果Gemini也不可用，使用本地模拟
          console.log("所有模型调用失败，使用本地模拟");
          const simulatedResult = await simulateAIEnhancement(content);
          if (onUpdate) {
            onUpdate(simulatedResult, 'content');
          }
          return {
            reasoningChain: reasoningChain,
            content: simulatedResult
          };
        }
      }
    }
    
    // 第二步：使用Gemini基于思维链继续生成内容
    if (modelConfig.gemini) {
      try {
        console.log("第2步：切换到Gemini继续生成内容");
        
        // 如果有思维链，使用它作为Gemini的上下文
        const geminiPrompt = reasoningChain 
          ? `${content}\n\n思考过程:\n${reasoningChain}\n\n基于以上思考，生成最终内容:`
          : content;
        
        // 使用Google Generative AI SDK方式调用Gemini
        await streamGeminiModel(
          geminiPrompt,
          modelConfig.gemini,
          // 流式更新回调 - 处理内容部分
          (chunk) => {
            finalContent += chunk;
            if (onUpdate) {
              onUpdate(chunk, 'content');
            }
          },
          abortController.signal,
          { temperature: temperature, maxTokens: maxTokens }
        );
        
        return {
          reasoningChain: reasoningChain,
          content: finalContent
        };
      } catch (error) {
        console.error("Gemini调用失败:", error);
        
        // 如果有思维链但Gemini失败，将思维链作为结果返回
        if (reasoningChain) {
          const errorMessage = `\n\n很抱歉，内容生成过程中断。以上是${modelName}的思考过程。`;
          if (onUpdate) {
            onUpdate(errorMessage, 'content');
          }
          return {
            reasoningChain: reasoningChain,
            content: finalContent + errorMessage
          };
        } else {
          // 没有思维链且Gemini失败，使用本地模拟
          const simulatedResult = await simulateAIEnhancement(content);
          if (onUpdate) {
            onUpdate(simulatedResult, 'content');
          }
          return {
            reasoningChain: null,
            content: simulatedResult
          };
        }
      }
    } else if (reasoningChain) {
      // 只有DeepSeek但没有Gemini时，将思维链作为结果返回
      const message = `\n\n以上是${modelName}的思考过程。`;
      if (onUpdate) {
        onUpdate(message, 'content');
      }
      return {
        reasoningChain: reasoningChain,
        content: message
      };
    }
    
    // 如果执行到这里，说明调用流程有问题，使用本地模拟
    const simulatedResult = await simulateAIEnhancement(content);
    if (onUpdate) {
      onUpdate(simulatedResult, 'content');
    }
    return {
      reasoningChain: reasoningChain || null,
      content: finalContent || simulatedResult
    };
    
  } catch (error) {
    console.error("模型链式调用失败:", error);
    const simulatedResult = await simulateAIEnhancement(content);
    if (onUpdate) {
      onUpdate(simulatedResult, 'content');
    }
    return {
      reasoningChain: null,
      content: simulatedResult
    };
  }
}

/**
 * 流式调用DeepSeek模型
 * @param {string} content - 用户输入的原始内容
 * @param {object} config - DeepSeek模型配置
 * @param {function} onChunk - 每个数据块的回调函数
 * @param {function} onComplete - 完成时的回调函数
 * @param {AbortSignal} signal - 用于中止请求的信号
 * @param {object} options - 可选参数，包含temperature和maxTokens
 */
async function streamDeepSeekModel(content, config, onChunk, onComplete, signal, options = {}) {
  try {
    console.log("流式调用DeepSeek模型:", config.model || 'deepseek-reasoner');
    
    if (!config.apiKey) {
      throw new Error("缺少API密钥");
    }
    
    // 获取参数
    const temperature = options.temperature !== undefined ? options.temperature : 0.8;
    const maxTokens = options.maxTokens !== undefined ? options.maxTokens : 4000;
    
    // 构建请求体 - 使用OpenAI兼容格式
    const requestBody = {
      model: config.model || 'deepseek-reasoner',
      messages: [
        {"role": "system", "content": "You are a creative assistant that helps users enhance their ideas with detailed reasoning."},
        {"role": "user", "content": content}
      ],
      stream: true, // 启用流式输出
      temperature: temperature,
      max_tokens: maxTokens
    };
    
    // 构建请求头
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    };
    
    // 使用DeepSeek API URL
    const apiUrl = 'https://api.deepseek.com/chat/completions';
    console.log("发送流式请求到DeepSeek API:", apiUrl);
    
    // 发送请求
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
      signal: signal // 传递中止信号
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("DeepSeek API错误:", response.status, errorText);
      onComplete(false, `API错误 ${response.status}: ${errorText}`);
      return;
    }
    
    // 获取响应的可读流
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    
    // 读取流
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // 解码二进制数据
      const chunk = decoder.decode(value, { stream: true });
      
      // 处理SSE格式的数据
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            if (json.choices && json.choices[0]) {
              const delta = json.choices[0].delta;
              
              // 处理content和reasoning_content字段
              if (delta) {
                if (delta.reasoning_content) {
                  // 发送思维链内容
                  onChunk(delta.reasoning_content, true);
                }
                // 你也可以在这里处理content字段，如果需要的话
              }
            }
          } catch (e) {
            console.error("解析SSE数据失败:", e, "原始数据:", line);
          }
        }
      }
    }
    
    // 完成回调
    onComplete(true);
  } catch (error) {
    console.error("流式调用DeepSeek失败:", error);
    onComplete(false, error.message);
  }
}


/**
 * 流式调用Gemini模型
 * @param {string} content - 输入内容
 * @param {object} config - Gemini配置
 * @param {function} onChunk - 每个数据块的回调函数
 * @param {AbortSignal} signal - 用于中止请求的信号
 * @param {object} options - 可选参数，包含temperature和maxTokens
 */
async function streamGeminiModel(content, config, onChunk, signal, options = {}) {
  try {
    console.log("流式调用Gemini模型");
    
    if (!config.key) {
      throw new Error("缺少Gemini API密钥");
    }
    
    // 获取参数
    const temperature = options.temperature !== undefined ? options.temperature : 0.8;
    const maxTokens = options.maxTokens !== undefined ? options.maxTokens : 4000;
    
    // 获取模型名称 - 使用name属性而不是model属性
    const modelName = config.name || 'Gemini';
    console.log("使用Gemini模型:", modelName);
    
    // 使用Google Generative AI SDK方式调用
    // 动态加载SDK
    try {
      // 尝试使用importmap方式加载SDK
      console.log("尝试使用import加载Google Generative AI SDK");
      const GoogleGenerativeAI = await import("@google/generative-ai").catch(() => null);
      
      if (GoogleGenerativeAI) {
        console.log("成功加载SDK，使用SDK方式调用Gemini");
        // 使用SDK方式调用
        return await streamGeminiWithSDK(content, config, onChunk, signal, GoogleGenerativeAI);
      }
    } catch (e) {
      console.log("无法使用import加载SDK，错误信息:", e);
      console.log("尝试使用REST API方式调用");
    }
    
    // 如果SDK加载失败，使用REST API方式调用
    // 构建请求体
    const requestBody = {
      contents: [{ 
        parts: [{ text: content }] 
      }],
      generation_config: {
        temperature: temperature,
        max_output_tokens: maxTokens
      },
  safety_settings: [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
]
    };
    
    // 使用配置中的模型名称构建API URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelName}:streamGenerateContent?key=${config.key}`;
    console.log("发送流式请求到Gemini API URL:", apiUrl);
    
    // 发送请求
    console.log("发送REST API请求...");
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: signal // 传递中止信号
    });
    
    console.log("Gemini API响应状态:", response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API错误响应:", errorText);
      let errorMessage = `Gemini API错误: ${response.status}`;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error && errorData.error.message) {
          errorMessage += ` - ${errorData.error.message}`;
        }
      } catch (e) {
        // 如果无法解析JSON，使用原始错误文本
        errorMessage += ` - ${errorText}`;
      }
      
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    
    // 获取响应的可读流
    console.log("开始读取Gemini响应流");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    
    // 用于存储不完整的JSON片段
    let buffer = '';
    
    // 读取流
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Gemini响应流读取完成");
        break;
      }
      
      // 解码二进制数据
      const chunk = decoder.decode(value, { stream: true });
      console.log("收到Gemini数据片段:", chunk.length, "字节");
      
      // 将新数据添加到缓冲区
      buffer += chunk;
      
      // 处理JSON数据 - 更健壮的方法
      try {
        // 尝试将缓冲区分割成行
        const lines = buffer.split('\n');
        
        // 保留最后一行，它可能不完整
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // 尝试提取文本内容
          const extractedText = extractTextFromJSON(line);
          if (extractedText) {
            onChunk(extractedText);
          }
        }
      } catch (e) {
        console.error("处理Gemini流式数据失败:", e);
      }
    }
    
    // 处理缓冲区中可能剩余的数据
    if (buffer.trim()) {
      const extractedText = extractTextFromJSON(buffer);
      if (extractedText) {
        onChunk(extractedText);
      }
    }
  } catch (error) {
    console.error("流式调用Gemini失败:", error);
    throw error;
  }
}

/**
 * 从JSON响应中提取文本内容
 * @param {string} jsonText - JSON文本
 * @returns {string|null} - 提取的文本，如果无法提取则返回null
 */
function extractTextFromJSON(jsonText) {
  // 方法1: 尝试作为完整JSON解析
  try {
    if (jsonText.trim().startsWith('{')) {
      const data = JSON.parse(jsonText);
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const parts = data.candidates[0].content.parts;
        if (parts && parts.length > 0 && parts[0].text) {
          // 替换原始文本中的\n为实际换行符
          return parts[0].text.replace(/\\n/g, '\n');
        }
      }
    }
  } catch (e) {
    // 继续尝试其他方法
  }
  
  // 方法2: 使用正则表达式提取text字段
  try {
    const textMatch = jsonText.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (textMatch && textMatch[1]) {
      // 替换转义字符
      return textMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  } catch (e) {
    // 继续尝试其他方法
  }
  
  return null;
}

/**
 * 使用Google Generative AI SDK方式调用Gemini
 * @param {string} content - 输入内容
 * @param {object} config - Gemini配置
 * @param {function} onChunk - 每个数据块的回调函数
 * @param {AbortSignal} signal - 用于中止请求的信号
 * @param {object} GoogleGenerativeAI - Google Generative AI SDK
 */
async function streamGeminiWithSDK(content, config, onChunk, signal, GoogleGenerativeAI) {
  try {
    console.log("使用SDK调用Gemini, API密钥长度:", config.key.length);
    
    // 获取模型名称 - 使用name属性而不是model属性
    const modelName = config.name || 'Gemini';
    console.log("使用Gemini模型:", modelName);
    
    // 初始化SDK
    console.log("初始化GoogleGenerativeAI SDK");
    const genAI = new GoogleGenerativeAI.GoogleGenerativeAI(config.key);
    
    // 创建模型实例 - 使用配置中的模型名称
    console.log("创建模型实例:", modelName);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4000
      },
  safety_settings: [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
]
    });
  
    
    // 创建聊天实例
    console.log("创建聊天实例");
    const chat = model.startChat();
    
    // 流式生成内容
    console.log("发送消息并获取流式响应");
    const result = await chat.sendMessageStream(content);
    
    // 处理流式响应
    console.log("开始处理流式响应");
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        console.log("收到文本片段:", chunkText.length, "字符");
        // 确保换行符正确处理
        const processedText = chunkText.replace(/\\n/g, '\n');
        onChunk(processedText);
      }
    }
    
    console.log("Gemini SDK流式响应处理完成");
    return true;
  } catch (error) {
    console.error("使用SDK调用Gemini失败:", error);
    throw error;
  }
}

/**
 * 调用自定义模型API
 * @param {string} content - 输入内容
 * @param {object} config - 自定义模型配置
 * @param {object} options - 可选参数，包含temperature(温度)和maxTokens(最大输出长度)
 * @returns {Promise<object>} - 包含思维链和内容的对象
 */
async function callCustomModel(content, config, options = {}) {
  try {
   // 获取参数，如果未提供则使用默认值
   const temperature = options.temperature !== undefined ? options.temperature : 0.9;
   const maxTokens = options.maxTokens !== undefined ? options.maxTokens : 4000;
   
   // 构建请求头
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${config.apiKey}`
};
    
    // 构建请求体
    const requestBody = {
      model: config.model || "deepseek-chat",
      messages: [
        {
          role: "user",
          content: `<｜end of thinking｜>
          
          原始内容：${content}`
        }
      ],
      temperature: temperature,
      max_tokens: maxTokens
    };
    
    // 直接使用DeepSeek API URL，类似xie.html中的实现
    console.log("发送请求到DeepSeek API...");
    try {
      console.log("开始请求...");
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });
      
      console.log("响应状态:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("自定义API错误:", response.status, errorText);
        throw new Error(`API错误 ${response.status}: ${errorText}`);
      }
      
      console.log("解析响应JSON...");
      const data = await response.json();
      console.log("自定义API响应:", data);
      
      // 尝试提取思维链和内容
      let reasoningChain = "";
      let finalContent = "";
      
      if (data.choices && data.choices.length > 0) {
        console.log("找到choices字段，处理响应数据...");
        console.log("消息内容:", data.choices[0].message);
        
        const messageContent = data.choices[0].message.content;
        
        // 尝试从响应中提取reasoning_content字段
        if (data.choices[0].message.reasoning_content) {
          // 如果API直接返回reasoning_content字段
          reasoningChain = data.choices[0].message.reasoning_content;
          finalContent = messageContent;
          console.log("直接从reasoning_content获取思维链");
        } else {
          // 尝试从文本中解析思维链和内容
          finalContent = messageContent;
          console.log("尝试从文本解析思维链和内容...");
          
          // 查找常见的思维链标记
          const reasoningMarkers = [
            "思考过程:", "思维链:", "推理过程:", "Reasoning:", 
            "Let me think:", "思路分析:", "分析思路:"
          ];
          
          for (const marker of reasoningMarkers) {
            if (messageContent.includes(marker)) {
              console.log(`找到思维链标记: "${marker}"`);
              const parts = messageContent.split(marker);
              if (parts.length > 1) {
                // 假设思维链在标记之后，内容在最后
                reasoningChain = parts[1].trim();
                console.log("成功提取思维链");
                
                // 如果有多个部分，可能最后一部分是最终内容
                if (parts.length > 2) {
                  const contentMarkers = ["最终内容:", "最终结果:", "增强内容:", "Final content:"];
                  for (const contentMarker of contentMarkers) {
                    if (reasoningChain.includes(contentMarker)) {
                      console.log(`找到内容标记: "${contentMarker}"`);
                      const contentParts = reasoningChain.split(contentMarker);
                      if (contentParts.length > 1) {
                        reasoningChain = contentParts[0].trim();
                        finalContent = contentParts[1].trim();
                        console.log("成功提取最终内容");
                        break;
                      }
                    }
                  }
                }
                break;
              }
            }
          }
        }
      } else {
        console.error("响应中无有效choices:", data);
        throw new Error("API响应中没有找到有效内容");
      }
      
      return {
        reasoningChain: reasoningChain,
        content: finalContent
      };
    } catch (fetchError) {
      console.error("Fetch错误详情:", fetchError);
      console.error("错误堆栈:", fetchError.stack);
      
      // 如果实际API调用失败，返回模拟数据作为备选
      console.log("API调用失败，使用模拟数据");
      return {
        reasoningChain: `思考过程：我需要分析用户提供的内容"${content}"。\n\n首先，这段内容的核心主题是关于...\n\n其次，我可以从以下几个角度扩展这个想法：\n1. 考虑更多场景和应用\n2. 探索潜在的细节和变化\n3. 增加具体的例子\n\n这种内容可以通过增加生动的描述和细节来丰富，使读者能够更好地理解和感受。`,
        content: `基于您提供的内容："${content}"\n\n这是一个经过深思熟虑的扩展版本，增加了更多细节和深度，使其更加生动和有吸引力。\n\n由于网络问题暂时无法访问远程API，这是一个本地生成的模拟响应。实际使用时，系统会连接到高级AI模型，提供更加个性化和专业的内容增强。`
      };
    }
  } catch (error) {
    console.error("调用自定义模型失败:", error);
    throw error;
  }
}

/**
 * 使用思维链调用Gemini模型生成最终内容
 * 
 * @param {string} originalContent - 用户输入的原始内容
 * @param {string} reasoningChain - 自定义模型生成的思维链
 * @param {Object} config - Gemini配置
 * @param {object} options - 可选参数，包含temperature(温度)和maxTokens(最大输出长度)
 * @returns {Promise<string>} - 最终生成的内容
 */
async function callGeminiWithReasoning(originalContent, reasoningChain, config, options = {}) {
  try {
    console.log("使用思维链调用Gemini");
    
    if (!config.key) {
      throw new Error("缺少Gemini API密钥");
    }
    
    // 获取参数，如果未提供则使用默认值
    const temperature = options.temperature !== undefined ? options.temperature : 0.9;
    const maxTokens = options.maxTokens !== undefined ? options.maxTokens : 4000;
    
    // 构建提示词，让Gemini以为思维链是它自己的思考过程
    const prompt = `<｜thinking｜>
    
    原始内容：
    ${originalContent}
    
    <｜end of thinking｜>
    ${reasoningChain}
    
    现在，请基于上述思考，生成一个最终版本`;
    
    // 使用name属性获取模型名称
    const modelName = config.name || 'Gemini';
    console.log("使用Gemini模型:", modelName);
    
    // 构建API URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${config.key}`;
    
    // 构建请求体
    const requestBody = {
      contents: [{ 
        parts: [{ text: prompt }] 
      }],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: maxTokens
      }
    };
    
    console.log("发送请求到Gemini API...");
    try {
      // 发送请求
      const response = await window.fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const data = await response.json();
        console.error("Gemini API错误:", data);
        throw new Error(`Gemini API错误: ${response.status}`);
      }
      
      const data = await response.json();
      
      // 验证响应结构
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error("Gemini API响应结构异常:", data);
        throw new Error("响应结构异常");
      }
      
      const text = data.candidates[0].content.parts[0].text;
      if (!text) {
        throw new Error("响应中未找到文本");
      }
      
      // 确保换行符正确处理
      return text.replace(/\\n/g, '\n');
    } catch (fetchError) {
      console.error("Gemini API调用失败:", fetchError);
      
      // 如果API调用失败，生成模拟响应
      console.log("使用模拟数据替代Gemini响应");
      
      // 生成模拟内容
      return `基于您提供的内容："${originalContent.substring(0, 50)}${originalContent.length > 50 ? '...' : ''}"

我对这个内容进行了深入分析，考虑了多个角度和可能的扩展方向。在保持原始内容核心要点的同时，我增加了更多的深度和细节，使其更加生动。

这是增强后的版本：

${originalContent}

注：由于网络问题无法连接到Gemini API，这是一个本地生成的备用响应。`;
    }
  } catch (error) {
    console.error("调用Gemini失败:", error);
    throw error;
  }
}

/**
 * 直接调用Gemini API (没有思维链的情况)
 * 
 * @param {string} content - 用户输入的原始内容
 * @param {Object} config - Gemini API配置
 * @param {object} options - 可选参数，包含temperature(温度)和maxTokens(最大输出长度)
 * @returns {Promise<string>} - Gemini生成的内容
 */
async function callGeminiAPI(content, config, options = {}) {
  try {
    console.log("直接调用Gemini API");
    
    if (!config.key) {
      throw new Error("缺少Gemini API密钥");
    }
    
    // 获取参数，如果未提供则使用默认值
    const temperature = options.temperature !== undefined ? options.temperature : 0.8;
    const maxTokens = options.maxTokens !== undefined ? options.maxTokens : 4000;
    
    // 构建提示词
    const prompt = `你是一位创意助手。请基于以下内容，提供一个更丰富、更具创意的版本，使其更有深度和吸引力：

${content}

请分析上述内容的核心要点，然后提供一个经过增强和改进的版本。你可以添加更多细节、例子或不同角度的思考来丰富它。保持原始内容的本质，但使其更具表现力和深度。`;
    
    // 使用name属性获取模型名称
    const modelName = config.name || 'Gemini';
    console.log("使用Gemini模型:", modelName);
    
    // 构建API URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${config.key}`;
    
    // 构建请求体
    const requestBody = {
      contents: [{ 
        parts: [{ text: prompt }] 
      }],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: maxTokens
      },
  safety_settings: [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
]
    };

    
    console.log("发送请求到Gemini API...");
    try {
      // 发送请求
      const response = await window.fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const data = await response.json();
        console.error("Gemini API错误:", data);
        throw new Error(`Gemini API错误: ${response.status}`);
      }
      
      const data = await response.json();
      
      // 验证响应结构
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error("Gemini API响应结构异常:", data);
        throw new Error("响应结构异常");
      }
      
      const text = data.candidates[0].content.parts[0].text;
      if (!text) {
        throw new Error("响应中未找到文本");
      }
      
      // 确保换行符正确处理
      return text.replace(/\\n/g, '\n');
    } catch (fetchError) {
      console.error("Gemini API调用失败:", fetchError);
      
      // 如果API调用失败，生成模拟响应
      console.log("使用模拟数据替代Gemini响应");
      
      // 生成模拟内容
      return `基于您提供的内容："${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"

我对这个内容进行了深入分析，考虑了多个角度和可能的扩展方向。在保持原始内容核心要点的同时，我增加了更多的深度和细节，使其更加生动。

这是增强后的版本：

${content}

注：由于网络问题无法连接到Gemini API，这是一个本地生成的备用响应。`;
    }
  } catch (error) {
    console.error("调用Gemini失败:", error);
    throw error;
  }
}

/**
 * 使用本地模拟的AI增强
 * @param {string} content - 用户输入的原始内容
 * @returns {string} - 模拟增强后的内容
 */
async function simulateAIEnhancement(content) {
  const startTime = Date.now();
  
  // 等待1秒模拟处理时间
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 选择一个随机的模板
  const enhancedContent = generateRandomEnhancement(content);
  
  // 记录总处理时间
  const processingTime = (Date.now() - startTime) / 1000;
  console.log(`模拟增强完成，处理时间: ${processingTime}秒`);
  
  return enhancedContent;
}

// 随机生成增强内容
function generateRandomEnhancement(content) {
  // 简单的模板数组
  const templates = [
    `${content}\n\n以上是原始内容。由于没有配置任何AI模型，这是一个本地模拟的增强版本，仅作为示例。实际使用时，请配置AI模型以获得真实的创意增强。`,
    
    `基于您提供的内容：\n"${content}"\n\n这是一个本地生成的模拟响应，因为没有检测到可用的AI模型。要获得真实的AI增强，请在设置中配置模型API。`,
    
    `【本地模拟模式】\n\n原始内容：${content}\n\n注意：当前使用的是本地模拟模式，没有实际调用AI模型。若要体验AI增强功能，请在后台配置相应的API密钥和模型信息。`,
    
    `您的内容已收到：\n"${content}"\n\n这是一个演示响应。系统当前处于本地模拟模式，没有连接到任何AI服务。请在设置中配置API以启用实际的AI功能。`
  ];
  
  const randomIndex = Math.floor(Math.random() * templates.length);
  return templates[randomIndex];
}

/**
 * 格式化上下文历史用于处理
 * @param {Array} history - 聊天历史数组
 * @param {string} currentContent - 当前输入内容
 * @param {number} contextLength - 要包含的上下文轮数
 * @returns {string} - 格式化后的上下文字符串
 */
function formatContextForProcessing(history, currentContent, contextLength = 3) {
  // 如果历史为空，只返回当前内容
  if (!history || history.length === 0) {
    return currentContent;
  }
  
  // 构建上下文字符串
  let contextStr = "以下是之前的对话历史:\n\n";
  
  // 只使用最近的几轮对话，根据contextLength参数决定
  const maxMessages = contextLength * 2; // 每轮包含用户和助手各一条消息
  const relevantHistory = history.slice(-maxMessages);
  
  relevantHistory.forEach(msg => {
    const role = msg.role === 'user' ? '用户' : '助手';
    contextStr += `${role}: ${msg.content}\n\n`;
  });
  
  // 添加当前内容
  contextStr += `用户的最新输入: ${currentContent}\n\n`;
  contextStr += "请基于以上完整的对话历史生成响应。";
  
  return contextStr;
}
