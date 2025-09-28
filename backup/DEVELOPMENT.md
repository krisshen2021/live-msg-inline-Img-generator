# Live Inline Image Generator - Development Documentation

## 项目概述

### 扩展信息
- **名称**: [Muffin] Live Inline Image Generator
- **版本**: 2.0.0
- **作者**: kris
- **描述**: 自动化图像生成扩展，当角色消息包含特定提示词时自动生成图像，具备自定义图像容器和交互控制功能

### 核心功能
- **自动图像生成**: 根据正则表达式匹配消息中的提示词自动生成图像
- **交互式图像容器**: 提供隐藏、全屏查看、重新生成等操作
- **消息历史持久化**: 支持聊天记录保存和恢复
- **动态提示词更新**: 支持消息编辑后的提示词动态读取
- **响应式设计**: 适配移动端和桌面端

## 技术架构

### 文件结构
```
live-msg-inline-Img-generator/
├── index.js           # 主逻辑文件
├── style.css          # 样式定义
├── settings.html      # 设置界面
├── manifest.json      # 扩展元数据
├── panzoom.min.js     # 第三方缩放库
├── panzoom_readme.md  # 库说明文档
└── DEVELOPMENT.md     # 开发文档
```

### 核心依赖关系

#### SillyTavern 核心模块
```javascript
import { eventSource, event_types, appendMediaToMessage, saveSettingsDebounced } from '../../../script.js';
import { executeSlashCommandsWithOptions } from '../../slash-commands.js';
import { getContext, extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { t } from '../../i18n.js';
```

#### 第三方库
- **Panzoom v4.6.0**: 提供图像缩放和平移功能
  - Canvas 模式启用精确焦点定位
  - 硬件加速优化
  - 触摸设备支持

### 图像生成流程

#### 1. 消息处理流程
```
CHARACTER_MESSAGE_RENDERED 事件 → 
正则表达式匹配 → 
提取提示词 → 
调用图像生成 → 
创建图像容器 → 
插入DOM → 
保存数据
```

#### 2. 图像生成API集成
- **后端接口**: 通过 `/imagine` 斜杠命令调用 Stable Diffusion 扩展
- **参数处理**: 
  - 提示词样式处理 (positive/negative prompts)
  - 尺寸比例设置
  - 质量参数配置

#### 3. 数据持久化
```javascript
// 消息数据结构
message.extra.custom_images = [{
    id: generateUniqueId(),
    url: 'generated_image_url',
    prompt: 'processed_prompt',
    settings: currentSettings,
    timestamp: Date.now(),
    hidden: false
}]
```

## 核心功能实现

### 1. 自动图像生成

#### 触发条件
- 监听 `CHARACTER_MESSAGE_RENDERED` 事件
- 使用可配置正则表达式匹配: `<span\s+data-prompt="([^"]+)"[^>]*>\s*<\/span>`
- 支持多种消息类型 (不限于角色消息)

#### 处理逻辑
```javascript
async function handleCharacterMessage(messageId) {
    // 1. 获取消息数据和DOM元素
    // 2. 正则匹配提示词
    // 3. 检查重复生成
    // 4. 调用图像生成API
    // 5. 创建并插入图像容器
    // 6. 保存数据到聊天记录
}
```

### 2. 图像容器系统

#### 容器结构
```html
<div class="custom-image-container" data-image-id="unique_id">
    <div class="custom-image-wrapper aspect-1-1">
        <img class="custom-image" src="image_url" />
        <div class="image-controls">
            <button class="image-control-btn regenerate-btn">♻</button>
            <button class="image-control-btn hide-btn">👁</button>
        </div>
        <div class="image-info">
            <div class="image-prompt">
                <span class="prompt-text">提示词内容</span>
                <span class="prompt-expand-icon">⋯</span>
            </div>
        </div>
    </div>
</div>
```

#### 交互功能
- **重新生成**: 读取当前DOM中的提示词进行重新生成
- **隐藏/显示**: 切换图像可见性，保留占位符
- **全屏查看**: Panzoom集成的缩放查看器
- **提示词查看**: 悬停展开完整提示词

### 3. 消息状态恢复

#### 恢复触发点
- `MESSAGE_UPDATED` 事件 (消息编辑后)
- `MESSAGE_SWIPED` 事件 (消息切换后)
- DOM变更检测 (MutationObserver 备用)

#### 位置保持策略
```javascript
// 使用 span 标签作为位置锚点
const spanTag = `<span data-prompt="${prompt}" data-image-anchor="${imageId}"></span>`;
// 在 span 标签后插入图像容器，而不是替换
const finalHtml = originalHtml.replace(fullMatch, fullMatch + containerHtml);
```

### 4. 全屏查看系统

#### Panzoom 集成
```javascript
// 精确焦点定位配置
const panzoomInstance = Panzoom(imageElement, {
    canvas: true,      // 启用 canvas 模式提高精度
    maxScale: 10,      // 最大缩放倍数
    minScale: 0.1,     // 最小缩放倍数
    startScale: 1,     // 初始缩放
    contain: 'outside' // 包含模式
});
```

#### 控制界面
- 缩放控制 (+/- 按钮)
- 重置按钮 (恢复100%缩放)
- 关闭按钮
- 实时缩放比例显示

## 设置系统

### 配置选项
```javascript
const DEFAULT_SETTINGS = {
    enabled: true,                    // 扩展启用状态
    useCustomContainers: true,        // 使用自定义容器
    regex: '<span\\s+data-prompt="([^"]+)"[^>]*>\\s*<\\/span>', // 匹配正则
    aspectRatio: '1:1',              // 图像比例
    baseSize: 512,                   // 基础尺寸
    style: 'photo_realistic',        // 图像风格
    negativePrompt: '...'            // 负面提示词
};
```

### 风格预设
```javascript
const STYLES = {
    photo_realistic: {
        positive: 'masterpiece, highly detailed, photorealistic, 4K resolution, absurdres',
        negative: 'hentai, manga, anime, cartoon'
    },
    hentai_manga: {
        positive: 'hentai, manga',
        negative: 'masterpiece, highly detailed, photorealistic, 4K resolution, absurdres'
    }
};
```

## UI/UX 设计

### 视觉效果
- **圆角设计**: 8px 圆角提供现代感
- **悬停动画**: 微妙的变换效果增强交互性
- **加载状态**: 半透明图像 + 旋转动画指示器
- **渐变遮罩**: 图像信息区域使用渐变背景

### 响应式适配
```css
@media (max-width: 768px) {
    .fullscreen-container { width: 95vw; height: 95vh; }
    .control-btn { width: 36px; height: 36px; }
}

@media (pointer: coarse) {
    .control-btn { width: 44px; height: 44px; }
}
```

### 无障碍设计
- 键盘导航支持
- 触摸设备优化
- 高对比度模式兼容
- 屏幕阅读器支持

## 性能优化

### DOM 操作优化
- **事件委托**: 使用事件冒泡减少监听器数量
- **防抖处理**: 连续操作防抖避免重复执行
- **延迟加载**: 图像容器按需创建

### 内存管理
- **Panzoom 实例清理**: 全屏关闭时销毁实例
- **事件监听器清理**: 防止内存泄漏
- **图像缓存策略**: 合理的图像URL缓存

### 网络优化
- **图像压缩**: 支持多种图像格式和质量设置
- **并发控制**: 防止同时生成多个图像
- **错误重试**: 网络失败时的重试机制

## 调试和维护

### 日志系统
```javascript
const LOG_PREFIX = '[live-msg-inline-Img-generator]';
// 生产环境：仅重要操作日志
// 开发环境：详细调试信息 (已清理)
```

### 错误处理
- **图像生成失败**: 回滚到原始状态，显示错误提示
- **DOM操作异常**: 优雅降级，保持基本功能
- **设置加载失败**: 使用默认配置继续运行

### 兼容性考虑
- **浏览器支持**: 现代浏览器 (ES6+)
- **SillyTavern版本**: 依赖核心API稳定性
- **第三方库更新**: Panzoom 版本锁定

## 扩展开发指南

### 添加新功能
1. **新的图像操作**: 在 `image-controls` 区域添加按钮
2. **新的设置选项**: 更新 `DEFAULT_SETTINGS` 和 `settings.html`
3. **新的事件处理**: 在事件监听器部分添加处理逻辑

### 样式定制
- **CSS变量**: 使用SillyTavern主题变量保持一致性
- **动画效果**: 添加 `transition` 属性实现平滑过渡
- **响应式**: 考虑不同屏幕尺寸的适配

### 测试建议
1. **功能测试**: 消息生成、编辑、切换场景
2. **性能测试**: 大量图像容器的渲染性能
3. **兼容性测试**: 不同浏览器和设备的表现
4. **边界测试**: 异常输入和网络问题的处理

## 已知问题和限制

### 当前限制
- **图像生成依赖**: 需要配置可用的 Stable Diffusion 后端
- **正则表达式**: 仅支持特定格式的提示词标记
- **并发限制**: 同时只能生成一个图像

### 优化方向
- **提示词编辑**: 直接在容器中编辑提示词
- **批量操作**: 支持同时隐藏/显示多个图像
- **更多格式**: 支持GIF、视频等多媒体内容
- **AI增强**: 智能提示词优化和建议

## 开发环境设置

### 必要条件
- SillyTavern 主程序
- 配置好的图像生成后端 (Stable Diffusion/ComfyUI等)
- 现代浏览器开发工具

### 开发工作流
1. 修改代码文件
2. 刷新SillyTavern页面重载扩展
3. 在聊天中测试功能
4. 使用浏览器开发工具调试
5. 检查控制台日志确认行为

### 部署和分发
- 将整个扩展文件夹复制到用户的 `extensions` 目录
- 确保所有依赖文件完整
- 提供安装和配置说明文档

---

*文档版本: 2.0.0*  
*最后更新: 2025-08-10*  
*维护者: kris*
