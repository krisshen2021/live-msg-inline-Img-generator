import { eventSource, event_types, appendMediaToMessage, saveSettingsDebounced } from '../../../../script.js';
import { executeSlashCommandsWithOptions } from '../../../slash-commands.js';
import { getContext, extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { t } from '../../../i18n.js';
// import { update } from 'lodash';

const MODULE_NAME = 'live-msg-inline-Img-generator';
const LOG_PREFIX = `[${MODULE_NAME}]`;
const SETTINGS_KEY = 'live-msg-inline-Img-generator';

// Load Panzoom library if not already loaded
if (typeof window !== 'undefined' && !window.Panzoom) {
    const script = document.createElement('script');
    script.src = '/scripts/extensions/third-party/live-msg-inline-Img-generator/panzoom.min.js';
    script.onload = function () {
        console.log(`${LOG_PREFIX} Panzoom library loaded successfully`);
    };
    script.onerror = function () {
        console.error(`${LOG_PREFIX} Failed to load Panzoom library`);
    };
    document.head.appendChild(script);
}

// 定义各种风格及其关键词
const STYLES = {
    photo_realistic: {
        positive: 'masterpiece, highly detailed, photorealistic, 4K resolution, absurdres',
        negative: 'hentai, manga, anime, cartoon',
    },
    hentai_manga: {
        positive: 'hentai, manga',
        negative: 'masterpiece, highly detailed, photorealistic, 4K resolution, absurdres',
    },
};

const DEFAULT_SETTINGS = {
    enabled: true,
    useCustomContainers: true,
    // Legacy settings
    regex: '<span\s+data-prompt="([^"]+)"[^>]*>.*?</span>',
    aspectRatio: '1:1',
    baseSize: 512,
    style: 'photo_realistic',
    negativePrompt: STYLES.photo_realistic.negative,

    // ECG Integration Settings
    useEcg: false,
    ecgRegex: '<span\s+data-prompt="([^"]+)"\s+data-img-gen="([^"]+)"[^>]*>(.*?)</span>',
    ecgStaticWorkflow: '',
    ecgStaticWidth: 512,
    ecgStaticHeight: 768,
    ecgDynamicWorkflow: '',
    ecgDynamicWidth: 512,
    ecgDynamicHeight: 512,
};

function getSettings() {
    return extension_settings[SETTINGS_KEY];
}

/**
 * 发送插件间通信事件 - 用于与cyberpunk2027-hubs等扩展协作
 * @param {string} eventType - 事件类型 ('EventImgGenerated' 或 'EventImgRestored')
 * @param {number} messageId - 消息ID
 * @param {HTMLElement} imageContainer - 图像容器DOM元素
 */
function dispatchImageEvent(eventType, messageId, imageContainer) {
    if (!imageContainer) {
        console.warn(`${LOG_PREFIX} Cannot dispatch ${eventType}: imageContainer is null`);
        return;
    }

    const event = new CustomEvent(eventType, {
        detail: {
            msgId: messageId,
            imageContainer: imageContainer,
            source: 'live-msg-inline-img-generator',
            timestamp: Date.now()
        }
    });

    document.dispatchEvent(event);
    console.log(`${LOG_PREFIX} ${eventType} event dispatched for message: ${messageId}`);
}

// Global variable to store panzoom instance
let globalPanzoomInstance = null;

// Function to initialize Panzoom for the overlay
function initializePanzoomForOverlay(overlay) {
    const imageElement = overlay.find('.fullscreen-image')[0];
    if (!imageElement) {
        console.error(`${LOG_PREFIX} No image element found in overlay`);
        return;
    }

    // Wait for Panzoom library to be available
    function initializePanzoom() {
        if (typeof window.Panzoom !== 'undefined') {
            try {
                // Destroy existing instance if any
                if (globalPanzoomInstance) {
                    globalPanzoomInstance.destroy();
                    globalPanzoomInstance = null;
                }

                globalPanzoomInstance = window.Panzoom(imageElement, {
                    maxScale: 5,
                    minScale: 0.1,
                    step: 0.3,
                    cursor: 'grab',
                    animate: true,
                    duration: 200,
                    easing: 'ease-in-out',
                    touchAction: 'none',
                    overflow: 'hidden',
                    canvas: true  // Treats parent as canvas for better event handling and focal point zooming
                });

                // Listen for panzoom events
                imageElement.addEventListener('panzoomchange', function (event) {
                    // Update zoom level display
                    const scale = event.detail.scale;
                    const percentage = Math.round(scale * 100);
                    const percentage_text = `${percentage}%`;
                    overlay.find('.zoom-indicator').text(percentage_text);
                });

                // Follow official Panzoom example for wheel zooming with canvas option
                // The canvas option + zoomWithWheel provides proper focal point zooming
                const container = overlay.find('.fullscreen-container')[0];
                if (container) {
                    // Direct binding as shown in official example - no function bind needed
                    container.addEventListener('wheel', globalPanzoomInstance.zoomWithWheel);
                }

                // Reset zoom initially
                setTimeout(() => {
                    if (globalPanzoomInstance) {
                        globalPanzoomInstance.reset();
                        overlay.find('.zoom-indicator').text('100%');
                    }
                }, 100);

                console.log(`${LOG_PREFIX} Panzoom initialized successfully`);
            } catch (error) {
                console.error(`${LOG_PREFIX} Failed to initialize Panzoom:`, error);
            }
        } else {
            // Retry after 100ms if Panzoom not loaded yet
            setTimeout(initializePanzoom, 100);
        }
    }

    // Start initialization immediately if image is already loaded, otherwise wait a bit
    if (imageElement.complete && imageElement.src) {
        initializePanzoom();
    } else {
        setTimeout(initializePanzoom, 200);
    }
}

// ================== 工具函数 ==================

/**
 * 从容器中获取图像ID
 * @param {jQuery} container - 图像容器
 * @returns {string|null} 图像ID
 */
function getImageId(container) {
    return container.data('image-id') || container.attr('data-image-id');
}

/**
 * 获取消息相关数据
 * @param {jQuery} container - 图像容器元素
 * @returns {{messageElement: jQuery, messageId: string, context: object, message: object} | null}
 */
function getMessageData(container) {
    const messageElement = container.closest('[mesid]');
    if (!messageElement.length) return null;

    const messageId = messageElement.attr('mesid');
    const context = getContext();
    const message = context.chat[messageId];

    return { messageElement, messageId, context, message };
}

/**
 * 查找图像数据
 * @param {object} message - 消息对象
 * @param {string} imageId - 图像ID
 * @returns {object | null} 图像数据对象
 */
function findImageData(message, imageId) {
    if (!message?.extra?.custom_images) return null;
    return message.extra.custom_images.find(img => img.id === imageId);
}

/**
 * Fallback text copy function for older browsers
 * @param {string} text - Text to copy
 * @param {jQuery} iconElement - The icon element to update on success
 */
function fallbackCopyText(text, iconElement = null) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            toastr.info('Prompt copied to clipboard');

            // Update icon if provided
            if (iconElement && iconElement.length) {
                const originalIcon = iconElement.html();
                const checkmarkSVG = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 6L9 17l-5-5" stroke="#28a745" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
                iconElement.html(checkmarkSVG);

                setTimeout(() => {
                    iconElement.html(originalIcon);
                }, 1500);
            }
        } else {
            throw new Error('Copy command failed');
        }
    } catch (err) {
        console.error(`${LOG_PREFIX} Failed to copy text: `, err);
        toastr.error('Failed to copy prompt');
    } finally {
        document.body.removeChild(textArea);
    }
}

/**
 * Calculates the width and height based on aspect ratio and a base size.
 * Snaps dimensions to the nearest multiple of 64.
 * @param {string} aspectRatio - The aspect ratio string, e.g., "1:1", "16:9".
 * @param {number} baseSize - The size of the shorter dimension.
 * @returns {{width: number, height: number}}
 */
function calculateDimensions(aspectRatio, baseSize) {
    const [w, h] = aspectRatio.split(':').map(Number);
    let width, height;

    if (w > h) { // Landscape
        height = baseSize;
        width = Math.round(baseSize * (w / h));
    } else { // Portrait or square
        width = baseSize;
        height = Math.round(baseSize * (h / w));
    }

    // Snap to nearest multiple of 64 for better SD compatibility
    return {
        width: Math.round(width / 64) * 64,
        height: Math.round(height / 64) * 64,
    };
}

/**
 * 根据所选风格处理用户提示词，添加风格关键词并移除负面关键词。
 * @param {string} userPrompt - 从消息中提取的原始提示词。
 * @returns {string} - 处理后可用于生成的最终提示词。
 */
function processPromptWithStyle(userPrompt) {
    const settings = getSettings();
    const styleConfig = STYLES[settings.style];

    if (!styleConfig) {
        console.warn(`${LOG_PREFIX} Style "${settings.style}" not found. Using raw prompt.`);
        return userPrompt;
    }

    // 将逗号分隔的字符串转换为小写的、经过修剪的关键词数组
    const toKeywords = (str) => (str || '').split(/[,，]/).map(k => k.trim().toLowerCase()).filter(Boolean);

    const negativeKeywords = toKeywords(settings.negativePrompt);
    let stylePositiveKeywords = toKeywords(styleConfig.positive);
    const userPromptKeywords = toKeywords(userPrompt);

    // 1. 从用户提示词中移除负面关键词
    const cleanedUserPromptKeywords = userPromptKeywords.filter(
        userKeyword => !negativeKeywords.includes(userKeyword),
    );

    // 2. 从风格的正面关键词列表中，移除那些已经存在于用户提示词中的关键词
    const remainingStylePositiveKeywords = stylePositiveKeywords.filter(
        styleKeyword => !cleanedUserPromptKeywords.includes(styleKeyword),
    );

    // 3. 将剩余的风格关键词与清理后的用户提示词合并
    return [...remainingStylePositiveKeywords, ...cleanedUserPromptKeywords].join(', ');
}

/**
 * Extracts an image generation prompt from the message text.
 * This is the core logic you can customize.
 * @param {string} text - The full text of the AI character's message.
 * @returns {{genType: string, prompt: string, fullMatch: string, charDialogue: string}|null} - An object with the prompt and the full matched string, or null.
 */
function extractImagePromptFromText(text) {
    const settings = getSettings();
    const useEcg = settings.useEcg;
    const regexPattern = useEcg ? settings.ecgRegex : settings.regex;
    try {
        const regex = new RegExp(regexPattern, 'is');
        const match = text.match(regex);
        if (!useEcg && match && match[1]) {
            return {
                genType: 'txt2img', // Default type when not using ECG
                prompt: match[1].trim(),
                fullMatch: match[0],
                charDialogue: '' // No dialogue extraction in legacy mode
            };
        } else if (useEcg && match && match[1] && match[2] && match[3]) {
            return {
                prompt: match[1].trim(),
                genType: match[2].trim(),
                fullMatch: match[0],
                charDialogue: match[3].trim()
            };
        }
    } catch (error) {
        console.error(`${LOG_PREFIX} Invalid Regex:`, error);
        toastr.error('The Regex in Live Inline Image Generator is invalid. Please check the settings.');
    }
    return null;
}

/**
 * Creates a custom image container with interactive controls
 * @param {string} imageUrl - URL of the generated image
 * @param {string} prompt - The prompt used to generate the image
 * @param {Object} settings - Extension settings
 * @returns {jQuery} - The created image container element
 */
function createCustomImageContainer(imageUrl, prompt, settings) {
    const { aspectRatio, baseSize } = settings;
    const aspectClass = `aspect-${aspectRatio.replace(':', '-')}`;
    const containerId = `custom-img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const isVideo = imageUrl.toLowerCase().endsWith('.mp4') || imageUrl.toLowerCase().endsWith('.webm');
    let mediaElementHtml;

    if (isVideo) {
        mediaElementHtml = `<video class="custom-image" src="${imageUrl}" autoplay loop muted playsinline alt="Generated video"></video>`;
    } else {
        mediaElementHtml = `<img class="custom-image" src="${imageUrl}" alt="Generated image" />`;
    }

    const container = $(`
        <div class="custom-image-container" data-image-id="${containerId}">
            <div class="custom-image-wrapper ${aspectClass}">
                ${mediaElementHtml}
                <div class="image-controls">
                    <button class="image-control-btn regenerate-btn" title="Regenerate image" data-action="regenerate">
                        ↻
                    </button>
                    <button class="image-control-btn fullscreen-btn" title="View fullscreen" data-action="fullscreen">
                        ⛶
                    </button>
                    <button class="image-control-btn hide-btn" title="Hide image" data-action="hide">
                        ✕
                    </button>
                </div>
                <div class="image-info">
                    <div class="image-prompt" title="Click to copy prompt">
                        <span class="prompt-text">${prompt}</span>
                        <span class="prompt-expand-icon">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/>
                            </svg>
                        </span>
                    </div>
                    <div class="image-meta">${aspectRatio} • ${baseSize}px</div>
                </div>
            </div>
            <div class="image-placeholder">
                <div class="image-placeholder-content">
                    <div class="image-placeholder-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                            <polyline points="21,15 16,10 5,21" stroke="currentColor" stroke-width="2"/>
                        </svg>
                    </div>
                    <div class="image-placeholder-text">Hidden Image</div>
                </div>
            </div>
        </div>
    `);

    // Store prompt and image URL for later use
    container.data('prompt', prompt);
    container.data('image-url', imageUrl);

    return container;
}

/**
 * Fit image to screen function - Global scope for accessibility
 */
/**
 * Creates and manages the fullscreen overlay
 */
function createFullscreenOverlay() {
    if ($('.fullscreen-overlay').length > 0) {
        return $('.fullscreen-overlay');
    }

    const overlay = $(`
        <div class="fullscreen-overlay">
            <div class="fullscreen-container">
                <!-- Media element will be dynamically inserted here -->
            </div>

            <!-- Zoom Controls -->
            <div class="fullscreen-controls">
                <div class="zoom-controls">
                    <button class="control-btn zoom-out-btn" title="Zoom Out">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                            <path d="m21 21-4.35-4.35M8 11h6" stroke="currentColor" stroke-width="2"/>
                        </svg>
                    </button>

                    <span class="zoom-indicator">100%</span>

                    <button class="control-btn zoom-in-btn" title="Zoom In">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                            <path d="m21 21-4.35-4.35M11 8v6M8 11h6" stroke="currentColor" stroke-width="2"/>
                        </svg>
                    </button>

                    <button class="control-btn reset-btn" title="Reset Zoom">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" stroke="currentColor" stroke-width="2"/>
                            <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" stroke="currentColor" stroke-width="2"/>
                            <path d="M8 16H3v5" stroke="currentColor" stroke-width="2"/>
                        </svg>
                    </button>
                </div>

                <button class="control-btn fullscreen-close" title="Close">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/>
                        <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/>
                    </svg>
                </button>
            </div>
        </div>
    `);

    $('body').append(overlay);

    // Event handlers remain the same
    overlay.on('click', function (e) {
        if (e.target === this || $(e.target).closest('.fullscreen-close').length) {
            hideFullscreen();
        }
    });
    overlay.on('click', '.zoom-in-btn', e => { e.stopPropagation(); globalPanzoomInstance?.zoomIn(); });
    overlay.on('click', '.zoom-out-btn', e => { e.stopPropagation(); globalPanzoomInstance?.zoomOut(); });
    overlay.on('click', '.reset-btn', e => { e.stopPropagation(); globalPanzoomInstance?.reset(); });

    return overlay;
}

/**
 * Shows a media element in fullscreen mode
 * @param {string} mediaUrl - URL of the image or video to display
 */
function showFullscreen(mediaUrl) {
    const overlay = createFullscreenOverlay();
    const container = overlay.find('.fullscreen-container');

    const isVideo = mediaUrl.toLowerCase().endsWith('.mp4') || mediaUrl.toLowerCase().endsWith('.webm');
    let mediaElement;

    if (isVideo) {
        mediaElement = $(`<video class="fullscreen-image" src="${mediaUrl}" controls autoplay loop muted playsinline alt="Fullscreen video"></video>`);
    } else {
        mediaElement = $(`<img class="fullscreen-image" src="${mediaUrl}" alt="Fullscreen image" />`);
    }

    container.empty().append(mediaElement);

    overlay.addClass('active');
    $('body').addClass('fullscreen-active');

    // Initialize Panzoom for the new element
    setTimeout(() => {
        initializePanzoomForOverlay(overlay);
    }, 100);
}

/**
 * Hides the fullscreen overlay and cleans up Panzoom instance
 */
function hideFullscreen() {
    const overlay = $('.fullscreen-overlay');

    // Clean up global Panzoom instance
    if (globalPanzoomInstance && typeof globalPanzoomInstance.destroy === 'function') {
        try {
            globalPanzoomInstance.destroy();
            globalPanzoomInstance = null;
        } catch (error) {
            console.warn(`${LOG_PREFIX} Error destroying Panzoom instance:`, error);
            globalPanzoomInstance = null;
        }
    }

    // Remove fullscreen classes and unbind events
    overlay.removeClass('active');
    $('body').removeClass('fullscreen-active');
    $(document).off('keydown.fullscreen');

    console.log(`${LOG_PREFIX} Fullscreen cleanup completed`);
}

/**
 * Handles clicks on image control buttons and placeholders
 * @param {Event} event - The click event
 */
async function handleImageControlClick(event) {
    event.stopPropagation();

    const button = $(event.currentTarget);
    const action = button.data('action');
    const container = button.closest('.custom-image-container');
    const imageId = getImageId(container);

    // Prevent actions when loading
    if (container.hasClass('loading')) {
        console.log(`${LOG_PREFIX} Action blocked - image is currently loading`);
        return;
    }

    switch (action) {
        case 'hide':
            container.addClass('hidden');
            // Save hidden state to message data
            await updateImageHiddenState(container, imageId, true);
            break;

        case 'show':
            container.removeClass('hidden');
            // Save shown state to message data
            await updateImageHiddenState(container, imageId, false);
            break;

        case 'fullscreen':
            const imageUrl = container.find('.custom-image').attr('src');
            showFullscreen(imageUrl);
            break;

        case 'regenerate':
            // Double-check loading state before regenerating
            if (container.hasClass('loading')) {
                console.log(`${LOG_PREFIX} Regeneration blocked - already in progress`);
                return;
            }
            await regenerateImage(container);
            break;
    }
}

/**
 * Handles clicks on image placeholders to show hidden images
 * @param {Event} event - The click event
 */
async function handlePlaceholderClick(event) {
    event.stopPropagation();

    const placeholder = $(event.currentTarget);
    const container = placeholder.closest('.custom-image-container');
    const imageId = getImageId(container);

    container.removeClass('hidden');
    await updateImageHiddenState(container, imageId, false);
}/**
 * Updates the hidden state of an image in message data
 * @param {jQuery} container - The image container element
 * @param {string} imageId - The image ID
 * @param {boolean} hidden - Whether the image should be hidden
 */
async function updateImageHiddenState(container, imageId, hidden) {
    const messageData = getMessageData(container);
    if (!messageData) return;

    const { context, message } = messageData;
    const imageData = findImageData(message, imageId);

    if (imageData) {
        imageData.hidden = hidden;
        await context.saveChat();
    }
}

/**
 * Regenerates an image
 * @param {jQuery} container - The image container element
 */
async function regenerateImage(container) {
    // Prevent concurrent regeneration
    if (container.hasClass('loading')) {
        console.log(`${LOG_PREFIX} Regeneration already in progress`);
        return;
    }

    const messageData = getMessageData(container);
    if (!messageData) return;

    const { context, message, messageId } = messageData;
    const imageId = getImageId(container);
    const imageData = findImageData(message, imageId);

    if (!imageData) return;

    // Show loading state
    container.addClass('loading');

    // Try to get the current prompt from the DOM (in case user edited it)
    let currentPrompt = imageData.prompt; // fallback to stored prompt
    let currentgenType = imageData.genType || 'txt2img';
    // Look for the span tag in the message to get the latest prompt
    const messageElement = container.closest('[mesid]');
    const messageTextElement = messageElement.find('.mes_text');
    const ch_name = messageElement.attr('ch_name') || 'Unknown';
    const settings = getSettings();
    const extractionResult = extractImagePromptFromText(messageTextElement.html());
    const charDialogue = extractionResult ? extractionResult.charDialogue : '';

    if (extractionResult && extractionResult.prompt) {
        currentPrompt = processPromptWithStyle(extractionResult.prompt);
        currentgenType = extractionResult.genType || 'txt2img';
        console.log(`${LOG_PREFIX} Using updated prompt from DOM: ${currentPrompt}`);

        // Update the stored data with the new prompt
        imageData.prompt = currentPrompt;
        imageData.originalPrompt = extractionResult.prompt;
        imageData.genType = currentgenType;
    } else {
        console.log(`${LOG_PREFIX} No valid prompt found in DOM, using stored prompt: ${currentPrompt}`);
    }

    console.log(`${LOG_PREFIX} Starting image regeneration for: ${currentPrompt}`);

    if (settings.useEcg) {
        const onComplete = (finalUrl, error, returnedMessageId) => {
            if (error) {
                console.error(`${LOG_PREFIX} [ECG Mode] Regeneration failed for message ${returnedMessageId}:`, error);
                // Optionally, revert UI changes or show an error message on the container
                container.removeClass('loading');
                return;
            }
            console.log(`${LOG_PREFIX} [ECG Mode] Regeneration successful for message ${returnedMessageId}. Final URL: ${finalUrl}`);
            updateImageUrl(finalUrl);
        };

        await generateWithECG(currentgenType, currentPrompt, ch_name, charDialogue, messageId, onComplete);

    } else {
        const { width, height } = calculateDimensions(settings.aspectRatio, settings.baseSize);
        const command = `/imagine quiet=true width=${width} height=${height} "${currentPrompt}"`;
        const comfyui_workflow_name = "pony_full.json";
        const change_icw_command = `/icw ${comfyui_workflow_name}`;
        const command_result = await executeSlashCommandsWithOptions(change_icw_command);
        console.log(`${LOG_PREFIX} Change ICW command result:`, command_result);
        const result = await executeSlashCommandsWithOptions(command);
        const finalUrl = result?.pipe;
        updateImageUrl(finalUrl);

    }
    async function updateImageUrl(newImageUrl) {
        try {
            if (newImageUrl) {
                const isVideo = newImageUrl.toLowerCase().endsWith('.mp4') || newImageUrl.toLowerCase().endsWith('.webm');
                const mediaElement = container.find('.custom-image');

                if (isVideo && mediaElement.is('img')) {
                    // Replace img with video
                    const video = $('<video class="custom-image" src="${newImageUrl}" autoplay loop muted playsinline alt="Generated video"></video>');
                    mediaElement.replaceWith(video);
                } else if (!isVideo && mediaElement.is('video')) {
                    // Replace video with img
                    const img = $('<img class="custom-image" src="${newImageUrl}" alt="Generated image" />');
                    mediaElement.replaceWith(img);
                } else {
                    // Just update src
                    mediaElement.attr('src', newImageUrl);
                }

                container.find('.prompt-text').text(currentPrompt);
                imageData.url = newImageUrl;
                imageData.timestamp = Date.now();
                await context.saveChat();
                console.log(`${LOG_PREFIX} Image regenerated successfully: ${newImageUrl}`);
            } else {
                console.warn(`${LOG_PREFIX} Image regeneration failed - no URL returned`);
                toastr.error(t`Image regeneration failed`);
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to regenerate image:`, error);
            toastr.error(t`Image regeneration failed: ${error.message}`);
        } finally {
            container.removeClass('loading');
            console.log(`${LOG_PREFIX} Image regeneration completed`);
        }
    }

}

/**
 * Restores custom images when loading chat history with inline positioning
 * @param {number} messageId - The message ID to check for custom images
 */
function restoreCustomImages(messageId) {
    const settings = getSettings();

    if (!settings.useCustomContainers) {
        return; // Don't restore custom containers if disabled
    }

    const context = getContext();
    const message = context.chat[messageId];

    if (!message || !message.extra || !message.extra.custom_images) {
        return;
    }

    console.log(`${LOG_PREFIX} Restoring ${message.extra.custom_images.length} custom images for message ${messageId}`);

    const messageElement = $(`#chat [mesid="${messageId}"]`);
    const messageTextElement = messageElement.find('.mes_text');

    // Remove any existing custom image containers to prevent duplicates
    const existingContainers = messageTextElement.find('.custom-image-container');
    existingContainers.remove();

    // Process each custom image
    message.extra.custom_images.forEach((imageData, index) => {
        // Check if this specific image container already exists
        const existingContainer = messageTextElement.find(`[data-image-id="${imageData.id}"]`);
        if (existingContainer.length > 0) {
            return;
        }

        const container = createCustomImageContainer(
            imageData.url,
            imageData.prompt,
            imageData.settings || getSettings()
        );

        container.attr('data-image-id', imageData.id);

        if (imageData.hidden) {
            container.addClass('hidden');
        }

        // Use the same logic as first-time generation: replace regex match with container
        const regex = new RegExp(settings.regex, 'is');
        let currentHtml = messageTextElement.html();
        const match = currentHtml.match(regex);

        if (match && match[0]) {
            // Insert container AFTER the span tag, don't replace it
            const containerHtml = container[0].outerHTML;

            // Insert container right before the span tag
            const updatedHtml = currentHtml.replace(match[0], containerHtml + match[0]);

            messageTextElement.html(updatedHtml);

            // 发送图像恢复完成事件，用于与其他扩展协作
            setTimeout(() => {
                const restoredContainer = messageTextElement.find(`[data-image-id="${imageData.id}"]`);
                if (restoredContainer.length > 0) {
                    dispatchImageEvent('EventImgRestored', messageId, restoredContainer[0]);
                }
            }, 10); // 短暂延迟确保DOM更新完成
        } else {
            // Fallback: append at the end if no pattern found
            messageTextElement.append(container);
        }
    });
}/**
 * Handles the event when a character message has finished rendering.
 * @param {number} messageId - The ID of the message that just finished rendering.
 */
async function handleCharacterMessage(messageId) {
    const settings = getSettings();
    // 诊断日志 1: 检查当前运行模式
    console.log(`${LOG_PREFIX} handleCharacterMessage triggered. ECG Mode Enabled: ${settings.useEcg}`);

    if (!settings.enabled) {
        return;
    }

    const context = getContext();
    const message = context.chat[messageId];
    if (!message || message.is_user || message.is_system) {
        return;
    }

    if (message.extra?.custom_images && settings.useCustomContainers) {
        restoreCustomImages(messageId);
        return;
    }

    // Top-level dispatcher based on ECG usage
    if (settings.useEcg) {
        await handleEcgGeneration(messageId, message);
    } else {
        await handleLegacyGeneration(messageId, message);
    }
}

/**
 * Handles the new generation process using Enhanced ComfyUI Generator.
 * @param {number} messageId
 * @param {object} message
 */
async function handleEcgGeneration(messageId, message) {
    const messageElement = $(`#chat [mesid="${messageId}"]`);
    const messageTextElement = messageElement.find('.mes_text');
    const ch_name = messageElement.attr('ch_name') || 'Unknown';
    console.log(`${LOG_PREFIX} [ECG Mode] Processing message from character: ${ch_name}`);
    const originalHtml = messageTextElement.html();

    console.log(`${LOG_PREFIX} [ECG Mode] Attempting to match regex.`);
    const extractionResult = extractImagePromptFromText(originalHtml);
    if (!extractionResult) {
        console.log(`${LOG_PREFIX} [ECG Mode] No regex match found.`);
        return;
    }

    const { genType, prompt, charDialogue } = extractionResult;
    const finalPrompt = processPromptWithStyle(prompt);
    console.log(`${LOG_PREFIX} [ECG Mode] Regex matched. Type: ${genType}, Prompt: ${finalPrompt}`);

    try {
        const generating_status = `/echo timeout=10000 ${t`Generating image with ECG...`}`;
        await executeSlashCommandsWithOptions(generating_status);
        await generateWithECG(genType, finalPrompt, ch_name, charDialogue, messageId, (finalUrl, error, returnedMessageId) => {
            if (error) {
                console.error(`${LOG_PREFIX} [ECG Mode] Generation failed for message ${returnedMessageId}:`, error);
                return;
            }
            console.log(`${LOG_PREFIX} [ECG Mode] Generation successful for message ${returnedMessageId}. Final URL: ${finalUrl}`);
            processAndDisplayResult(finalUrl, prompt, finalPrompt, returnedMessageId, genType);
        });

    } catch (error) {
        console.error(`${LOG_PREFIX} Invalid ECG Regex:`, error);
    }
}

/**
 * Core ECG generation logic with chain-calling.
 * @param {string} genType - 'txt2img' or 'img2img'
 * @param {string} prompt
 * @param {string} characterName
 * @param {string} charDialogue
 * @param {function} onComplete - Callback with (finalUrl, error)
 */
async function generateWithECG(genType, prompt, characterName, charDialogue, messageId, onComplete) {
    const settings = getSettings();

    if (genType === 'txt2img') {
        console.log(`${LOG_PREFIX} [ECG] Starting txt2img process...`);
        document.dispatchEvent(new CustomEvent('st:comfyui:generate', {
            detail: {
                messageId: messageId,
                workflowName: settings.ecgStaticWorkflow,
                prompt: prompt,
                width: settings.ecgStaticWidth,
                height: settings.ecgStaticHeight,
                characterName: characterName,
                onComplete: onComplete, // Directly pass the final callback
            }
        }));
    }
    else if (genType === 'img2img') {
        console.log(`${LOG_PREFIX} [ECG] Starting img2img chain...`);

        // Step 1: Generate the initial static image
        console.log(`${LOG_PREFIX} [ECG] Step 1: Generating base image...`);
        const promptForImg2Img = `Base on the character(the character in the image)'s dialogue:
 "${charDialogue}".
 And consider the description of the input image:
 "${prompt}",
 Generate a detailed prompt for 5s video, the prompt needs to focus on the movement of the character(include face expressions but without any other description of the character's looks) while make the camera movement fits the scene. Make sure the prompt is follow the image to video prompt generation guides in system prompt, output only the prompt without any additional explanation.`;
        document.dispatchEvent(new CustomEvent('st:comfyui:generate', {
            detail: {
                messageId: messageId,
                workflowName: settings.ecgStaticWorkflow,
                prompt: prompt,
                width: settings.ecgStaticWidth,  // Use STATIC dimensions for the base image
                height: settings.ecgStaticHeight, // Use STATIC dimensions for the base image
                characterName: characterName,
                onComplete: async (staticImageUrl, error) => {
                    if (error) {
                        console.error(`${LOG_PREFIX} [ECG] Step 1 failed.`, error);
                        onComplete(null, error);
                        return;
                    }
                    console.log(`${LOG_PREFIX} [ECG] Step 1 successful. Base image URL: ${staticImageUrl}`);

                    // Wait for 1 second to ensure the file system has caught up.
                    console.log(`${LOG_PREFIX} [ECG] Waiting 1s before starting video generation...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Step 2: Use the generated image to create a video
                    console.log(`${LOG_PREFIX} [ECG] Step 2: Generating dynamic image (video)...`);
                    console.log(`${LOG_PREFIX} [ECG] Prompt for img2img video generation: ${promptForImg2Img}`);
                    document.dispatchEvent(new CustomEvent('st:comfyui:generate', {
                        detail: {
                            messageId: messageId,
                            genType: 'img2img', // Add genType to trigger the rerouting
                            workflowName: settings.ecgDynamicWorkflow,
                            prompt: promptForImg2Img,
                            inputImageUrl: staticImageUrl,
                            width: settings.ecgDynamicWidth,
                            height: settings.ecgDynamicHeight,
                            characterName: characterName,
                            onComplete: onComplete, // The final callback
                        }
                    }));
                },
            }
        }));
    }
    else {
        onComplete(null, new Error(`Unknown generation type: ${genType}`));
    }
}

/**
 * Final step after a successful generation: creates the container, updates the DOM, and saves the chat.
 * This is the unified result processor for both ECG and Legacy modes.
 * @param {string} finalUrl - The URL of the generated image or video.
 * @param {string} originalPrompt - The original prompt extracted from the message.
 * @param {string} finalPrompt - The prompt after style processing, used for generation.
 * @param {number} messageId - The ID of the message.
 * @param {string} genType - The generation type (e.g., 'img2img', 'txt2img').
 */
async function processAndDisplayResult(finalUrl, originalPrompt, finalPrompt, messageId, genType) {
    const settings = getSettings();
    const context = getContext();
    const message = context.chat[messageId];
    const messageElement = $(`#chat [mesid="${messageId}"]`);
    const messageTextElement = messageElement.find('.mes_text');

    message.extra = message.extra || {};

    if (settings.useCustomContainers) {
        const imageData = {
            id: `custom-img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url: finalUrl,
            prompt: finalPrompt,
            originalPrompt: originalPrompt,
            genType: genType,
            timestamp: Date.now(),
            settings: {
                // aspectRatio: `${settings.ecgStaticWidth}:${settings.ecgStaticHeight}`,
                aspectRatio: settings.aspectRatio,
                baseSize: Math.min(settings.ecgStaticWidth, settings.ecgStaticHeight),
                source: settings.useEcg ? 'ECG' : 'Legacy',
                style: settings.style
            },
            hidden: false
        };
        message.extra.custom_images = message.extra.custom_images || [];
        message.extra.custom_images.push(imageData);

        const container = createCustomImageContainer(finalUrl, finalPrompt, settings);
        container.attr('data-image-id', imageData.id);

        const currentHtml = messageTextElement.html();
        const currentExtraction = extractImagePromptFromText(currentHtml);
        if (currentExtraction) {
            const finalHtml = currentHtml.replace(currentExtraction.fullMatch, container[0].outerHTML + currentExtraction.fullMatch);
            messageTextElement.html(finalHtml);
            setTimeout(() => {
                const insertedContainer = messageElement.find('.custom-image-container').last();
                if (insertedContainer.length > 0) {
                    dispatchImageEvent('EventImgGenerated', messageId, insertedContainer[0]);
                }
            }, 10);
        }
    } else {
        message.extra.image = finalUrl;
        message.extra.inline_image = true;
        if (messageElement.length) {
            appendMediaToMessage(message, messageElement);
        }
    }
    await context.saveChat();
}

/**
 * Handles the original generation process using the /imagine command.
 * @param {number} messageId
 * @param {object} message
 */
async function handleLegacyGeneration(messageId, message) {
    const messageElement = $(`#chat [mesid="${messageId}"]`);
    const messageTextElement = messageElement.find('.mes_text');
    const originalHtml = messageTextElement.html();
    const extractionResult = extractImagePromptFromText(originalHtml);

    if (extractionResult) {
        const { prompt: originalImagePrompt, genType } = extractionResult;
        const finalPrompt = processPromptWithStyle(originalImagePrompt);

        console.log(`${LOG_PREFIX} [Legacy Mode] Original prompt: "${originalImagePrompt}"`);
        console.log(`${LOG_PREFIX} [Legacy Mode] Final prompt: "${finalPrompt}"`);

        const settings = getSettings();
        const { width, height } = calculateDimensions(settings.aspectRatio, settings.baseSize);
        const command = `/imagine quiet=true width=${width} height=${height} "${finalPrompt}"`;

        const generating_status = `/echo timeout=10000 ${t`Generating image...`}`;
        await executeSlashCommandsWithOptions(generating_status);
        try {
            const result = await executeSlashCommandsWithOptions(command);
            const imageUrl = result?.pipe;

            if (imageUrl) {
                console.log(`${LOG_PREFIX} [Legacy Mode] Image generated successfully: ${imageUrl}`);
                await processAndDisplayResult(imageUrl, originalImagePrompt, finalPrompt, messageId, genType);
            } else {
                const failed_status = `/echo timeout=10000 ${t`Generating image failed`}`;
                await executeSlashCommandsWithOptions(failed_status);
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} [Legacy Mode] Failed to execute /imagine command:`, error);
            const error_status = `/echo timeout=10000 ${t`Generating image failed: ${error.message}`}`;
            await executeSlashCommandsWithOptions(error_status);
        }
    }
}

/**
 * Entry point for the extension.
 * Registers the event listener when the extension is loaded.
 */
jQuery(async () => {
    // 1. Load settings and merge with defaults to ensure all keys exist.
    extension_settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, ...(extension_settings[SETTINGS_KEY] || {}) };

    // 2. Create and inject the settings UI
    const settingsHtml = await renderExtensionTemplateAsync(`third-party/${MODULE_NAME}`, 'settings');
    const $settings = $(settingsHtml);
    $('#extensions_settings').append($settings);

    // 3. Connect UI to settings
    const enabledCheckbox = $settings.find('#live-img-enabled');
    enabledCheckbox.prop('checked', getSettings().enabled);
    enabledCheckbox.on('input', function () {
        getSettings().enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    const useCustomContainersCheckbox = $settings.find('#live-img-use-custom-containers');
    useCustomContainersCheckbox.prop('checked', getSettings().useCustomContainers);
    useCustomContainersCheckbox.on('input', function () {
        getSettings().useCustomContainers = $(this).prop('checked');
        saveSettingsDebounced();
    });

    const regexTextarea = $settings.find('#live-img-regex');
    regexTextarea.val(getSettings().regex);
    regexTextarea.on('input', function () {
        getSettings().regex = $(this).val();
        saveSettingsDebounced();
    });

    // --- Legacy Style Settings ---
    const styleSelect = $settings.find('#live-img-style');
    const negativePromptTextarea = $settings.find('#live-img-negative-prompt');
    styleSelect.val(getSettings().style);
    negativePromptTextarea.val(getSettings().negativePrompt);
    styleSelect.on('change', function () {
        const selectedStyle = $(this).val();
        getSettings().style = selectedStyle;
        const defaultNegative = STYLES[selectedStyle]?.negative || '';
        negativePromptTextarea.val(defaultNegative);
        getSettings().negativePrompt = defaultNegative;
        saveSettingsDebounced();
    });
    negativePromptTextarea.on('input', function () {
        getSettings().negativePrompt = $(this).val();
        saveSettingsDebounced();
    });

    const aspectRatioSelect = $settings.find('#live-img-aspect-ratio');
    aspectRatioSelect.val(getSettings().aspectRatio);
    aspectRatioSelect.on('change', function () {
        getSettings().aspectRatio = $(this).val();
        saveSettingsDebounced();
    });

    const baseSizeInput = $settings.find('#live-img-base-size');
    baseSizeInput.val(getSettings().baseSize);
    baseSizeInput.on('input', function () {
        getSettings().baseSize = Number($(this).val());
        saveSettingsDebounced();
    });

    // --- ECG Integration Settings ---
    const useEcgCheckbox = $settings.find('#lmiig-use-ecg');
    const ecgSettingsPanel = $settings.find('#lmiig-ecg-settings-panel');
    const ecgRegexTextarea = $settings.find('#lmiig-ecg-regex');
    const ecgStaticWorkflowSelect = $settings.find('#lmiig-ecg-static-workflow');
    const ecgStaticWidthInput = $settings.find('#lmiig-ecg-static-width');
    const ecgStaticHeightInput = $settings.find('#lmiig-ecg-static-height');
    const ecgEnableDynamicCheckbox = $settings.find('#lmiig-ecg-enable-dynamic');
    const ecgDynamicWorkflowSelect = $settings.find('#lmiig-ecg-dynamic-workflow');
    const ecgDynamicWidthInput = $settings.find('#lmiig-ecg-dynamic-width');
    const ecgDynamicHeightInput = $settings.find('#lmiig-ecg-dynamic-height');

    // Function to populate workflow selects
    function populateWorkflowSelects() {
        const workflows = window.SillyTavern?.plugins?.comfyui?.workflows || [];
        const staticSelected = getSettings().ecgStaticWorkflow;
        const dynamicSelected = getSettings().ecgDynamicWorkflow;

        ecgStaticWorkflowSelect.empty().append('<option value="">(Select a workflow)</option>');
        ecgDynamicWorkflowSelect.empty().append('<option value="">(Select a workflow)</option>');

        workflows.forEach(name => {
            ecgStaticWorkflowSelect.append(`<option value="${name}">${name}</option>`);
            ecgDynamicWorkflowSelect.append(`<option value="${name}">${name}</option>`);
        });

        ecgStaticWorkflowSelect.val(staticSelected);
        ecgDynamicWorkflowSelect.val(dynamicSelected);
    }

    // Toggle ECG panel visibility
    function toggleEcgPanel() {
        if (useEcgCheckbox.prop('checked')) {
            ecgSettingsPanel.slideDown();
        } else {
            ecgSettingsPanel.slideUp();
        }
    }

    // Initial state
    useEcgCheckbox.prop('checked', getSettings().useEcg);
    ecgRegexTextarea.val(getSettings().ecgRegex);
    ecgStaticWidthInput.val(getSettings().ecgStaticWidth);
    ecgStaticHeightInput.val(getSettings().ecgStaticHeight);
    ecgEnableDynamicCheckbox.prop('checked', getSettings().ecgEnableDynamic);
    ecgDynamicWidthInput.val(getSettings().ecgDynamicWidth);
    ecgDynamicHeightInput.val(getSettings().ecgDynamicHeight);

    populateWorkflowSelects();
    toggleEcgPanel();

    // Event Listeners
    useEcgCheckbox.on('input', function () {
        getSettings().useEcg = $(this).prop('checked');
        saveSettingsDebounced();
        toggleEcgPanel();
    });

    ecgRegexTextarea.on('input', () => { getSettings().ecgRegex = ecgRegexTextarea.val(); saveSettingsDebounced(); });
    ecgStaticWorkflowSelect.on('change', () => { getSettings().ecgStaticWorkflow = ecgStaticWorkflowSelect.val(); saveSettingsDebounced(); });
    ecgStaticWidthInput.on('input', () => { getSettings().ecgStaticWidth = Number(ecgStaticWidthInput.val()); saveSettingsDebounced(); });
    ecgStaticHeightInput.on('input', () => { getSettings().ecgStaticHeight = Number(ecgStaticHeightInput.val()); saveSettingsDebounced(); });
    ecgEnableDynamicCheckbox.on('input', function () {
        getSettings().ecgEnableDynamic = $(this).prop('checked');
        saveSettingsDebounced();
    });
    ecgDynamicWorkflowSelect.on('change', () => { getSettings().ecgDynamicWorkflow = ecgDynamicWorkflowSelect.val(); saveSettingsDebounced(); });
    ecgDynamicWidthInput.on('input', () => { getSettings().ecgDynamicWidth = Number(ecgDynamicWidthInput.val()); saveSettingsDebounced(); });
    ecgDynamicHeightInput.on('input', () => { getSettings().ecgDynamicHeight = Number(ecgDynamicHeightInput.val()); saveSettingsDebounced(); });

    // Listen for workflow updates from ECG
    document.addEventListener('st:comfyui:workflows_updated', populateWorkflowSelects);


    // 4. Set up event handlers for custom image controls (using event delegation)
    $(document).on('click', '.image-control-btn', handleImageControlClick);

    // 5. Set up event handler for placeholder clicks (show hidden images)
    $(document).on('click', '.image-placeholder', handlePlaceholderClick);

    // 6. Set up event handler for prompt copy functionality
    $(document).on('click', '.image-prompt', function (e) {
        e.stopPropagation();
        const promptText = $(this).find('.prompt-text').text();
        const icon = $(this).find('.prompt-expand-icon');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(promptText).then(() => {
                const originalIcon = icon.html();
                const checkmarkSVG = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 6L9 17l-5-5" stroke="#28a745" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
                icon.html(checkmarkSVG);
                setTimeout(() => icon.html(originalIcon), 1500);
            }).catch((error) => {
                fallbackCopyText(promptText, icon);
            });
        } else {
            fallbackCopyText(promptText, icon);
        }
    });

    // 7. Handle fullscreen image clicks
    $(document).on('click', '.custom-image', function (e) {
        e.preventDefault();
        const imageUrl = $(this).attr('src');
        showFullscreen(imageUrl);
    });

    // 8. Listen for chat loading to restore custom images
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            const context = getContext();
            if (context.chat) {
                context.chat.forEach((message, index) => {
                    if (message.extra && message.extra.custom_images) {
                        restoreCustomImages(index);
                    }
                });
            }
        }, 1500);
    });

    // 9. Listen for the character message rendered event
    setTimeout(() => {
        eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, handleCharacterMessage);
        console.log(`${LOG_PREFIX} Image processing listener registered as LAST`);
    }, 2000);

    // 10. Listen for message updates (including after editing) to restore custom images
    eventSource.on(event_types.MESSAGE_UPDATED, (messageId) => {
        setTimeout(() => {
            const numericMessageId = typeof messageId === 'string' ? parseInt(messageId) : messageId;
            if (typeof numericMessageId === 'number' && !isNaN(numericMessageId)) {
                const message = getContext().chat[numericMessageId];
                if (message?.extra?.custom_images) {
                    restoreCustomImages(numericMessageId);
                }
            }
        }, 100);
    });

    // 11. Listen for message swiped events to restore custom images
    eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        setTimeout(() => {
            const numericMessageId = typeof messageId === 'string' ? parseInt(messageId) : messageId;
            if (typeof numericMessageId === 'number' && !isNaN(numericMessageId)) {
                const message = getContext().chat[numericMessageId];
                if (message?.extra?.custom_images) {
                    restoreCustomImages(numericMessageId);
                }
            }
        }, 100);
    });

    console.log(`${LOG_PREFIX} Extension loaded.`);
});
