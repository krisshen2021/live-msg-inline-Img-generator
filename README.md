# Live Message Inline Image Generator

[![](https://img.shields.io/badge/language-简体中文-blue.svg)](./README_zh-CN.md)

## Overview

The **Live Message Inline Image Generator** is a powerful extension for SillyTavern that brings dynamic, content-driven image generation directly into your chat experience. It intelligently parses character messages for specific trigger patterns and generates images in real-time, displaying them in beautifully integrated, interactive containers.

This extension supports two primary modes of operation: a legacy mode using the built-in `/imagine` command, and an advanced integration with the **Enhanced ComfyUI Generator (ECG)** extension for unparalleled performance, stability, and features like video generation.

## Features

- **Content-Driven Generation**: Images and videos are generated based on triggers and prompts embedded directly within the character's dialogue.
- **Dual Generation Modes**:
    - **Legacy Mode**: Utilizes the standard `/imagine` slash command for simple image generation.
    - **ECG Integration Mode**: Offloads generation tasks to the `enhanced-comfyui-generator` extension, enabling advanced features.
- **Advanced ECG Features**:
    - **Video Generation**: Supports `img2vid` workflows by chain-calling `txt2img` and then `img2vid` tasks.
    - **Multi-Instance Support**: Works with ECG's dual ComfyUI instance routing to prevent model-loading delays between image and video tasks.
    - **Stable & Concurrent**: Leverages ECG's central task scheduler to handle multiple generation requests without conflicts.
- **Interactive Image Containers**:
    - Replaces plain images with a custom UI featuring controls for **Regeneration**, **Fullscreen View**, and **Hiding**.
    - Displays the generation prompt and metadata.
    - Automatically renders `<video>` or `<img>` tags based on the output file.
- **Customizable Triggers**: Both legacy and ECG modes use fully customizable Regex patterns to detect generation prompts in messages.
- **Style Management**: Apply predefined artistic styles (e.g., Photorealistic, Anime) and custom negative prompts to fine-tune your images.

## Installation

This extension is designed to be installed directly from its Git repository using the SillyTavern extension manager.

1.  **Navigate to the Downloads Tab**: Open SillyTavern and go to the "Downloads" tab (cloud icon).
2.  **Install Extension**: Under the "Install Extensions" section, paste the following repository URL into the text field:
    ```
    https://github.com/krisshen2021/live-msg-inline-Img-generator
    ```
3.  **Click "Install"**: The extension will be downloaded and installed automatically.
4.  **Enable the Extension**: Go to the "Extensions" tab (puzzle piece icon), find "Live Message Inline Image Generator" in the list, and check the "Enabled" box.
5.  **Reload the UI**: A UI reload is required for the extension to become active.

## Configuration

1.  **Dependencies**: For the best experience and advanced features (like video), the **Enhanced ComfyUI Generator (ECG)** extension is required. Please ensure it is also installed and configured.
2.  **Settings**:
    - Navigate to the `Extensions` panel (the puzzle piece icon) in SillyTavern.
    - Find "Live Message Inline Image Generator" in the settings list.
    - **Choose your mode**:
        - **Legacy Mode**: Keep `Use Enhanced ComfyUI Generator` unchecked. Configure the trigger Regex and `/imagine` settings as needed.
        - **ECG Mode**:
            - Check `Use Enhanced ComfyUI Generator`.
            - A new panel will appear. Configure your trigger Regex (it's different from the legacy one!).
            - Select the ECG workflows you've configured for static images (`txt2img`) and dynamic videos (`img2vid`).
            - Set the default dimensions for each workflow.

## Usage

The core of this extension is its ability to trigger image generation from within a character's message. This is done by formatting the message to include a special `<span>` tag.

### ECG Mode (Recommended)

In your character's message, include a `<span>` with two key attributes:
- `data-prompt`: The positive prompt for the image/video.
- `data-img-gen`: The generation type. Use `txt2img` for static images and `img2img` for videos.

**Example for a static image:**
```html
I am walking through a sun-drenched forest. <span data-prompt="A beautiful forest, cinematic lighting, 4K, masterpiece" data-img-gen="txt2img"></span>
```

**Example for a video:**
```html
Watch as I draw my sword with a flourish! <span data-prompt="A close-up shot of a knight drawing a glowing sword from its sheath, epic fantasy, sparks flying" data-img-gen="img2img">The knight unsheathes their blade.</span>
```
*Note: In the `img2img` example, the text inside the span (`The knight...`) can be used as additional context for chained generation prompts.*

### Legacy Mode

In legacy mode, the `<span>` only needs a `data-prompt` attribute.

**Example:**
```html
Here's what I look like: <span data-prompt="A portrait of a beautiful elf with silver hair and glowing blue eyes"></span>
```

The extension will automatically detect these spans, hide them from the final message, and replace them with the interactive image container upon successful generation.
