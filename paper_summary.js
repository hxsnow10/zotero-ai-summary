const dirpath = "/home/xiahong/code/zotero-ai-summary";
const path = require('path');
const fs = require('fs').promises;
const config = require(path.join(dirpath, 'config.js'));

class PaperSummaryGenerator {
    constructor() {
        this.progressWindow = null;
        this.itemProgress = null;
        this.prompts = {};
        this.window = require('window');
    }

    // 读取提示词文件
    async loadPrompt(name) {
        try {
            return await fs.readFile(
                path.join(dirpath, 'prompts', `${name}_prompt.txt`),
                'utf8'
            );
        } catch (error) {
            throw new Error(`无法加载提示词文件 ${name}: ${error.message}`);
        }
    }

    async init() {
        // 读取提示词文件
        this.prompts = {
            stuff: await this.loadPrompt('stuff'),
            map: await this.loadPrompt('map'),
            reduce: await this.loadPrompt('reduce')
        };
    }

    // 格式化字符串
    formatString(str, params) {
        return str.replace(/{([^{}]*)}/g, (match, key) => params[key] || match);
    }

    // 检查附件
    checkAttachment(attachment) {
        return attachment && (!config.pdf.only_link_file ||
            attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE);
    }

    // 初始化进度窗口
    initProgressWindow(title) {
        const shortTitle = title.length > 50 ? title.substring(0, 50) + "..." : title;
        this.progressWindow = new Zotero.ProgressWindow({ "closeOnClick": false });
        this.progressWindow.addDescription(shortTitle);
        this.itemProgress = new this.progressWindow.ItemProgress();
        this.itemProgress.setItemTypeAndIcon("note");
        this.progressWindow.show();
    }

    // 设置进度
    setProgress(percent, text) {
        this.itemProgress.setProgress(percent);
        if (text) this.itemProgress.setText(text);
    }

    // OpenAI API 请求
    async openaiRequest(message) {
        const response = await fetch(`${config.llm.openaiBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.llm.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.llm.modelName,
                messages: [{
                    role: 'user',
                    content: message
                }],
                temperature: config.llm.temperature
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API Error: ${response.status} ${response.statusText} ${errorData.error?.message || ''}`);
        }

        const result = await response.json();
        if (!result.choices) throw new Error("LLM API call failed!");
        return result.choices[0].message.content;
    }

    // 生成摘要文本
    async summarizeText(title, splits) {
        if (splits.length === 1) {
            return await this.openaiRequest(
                this.formatString(this.prompts.stuff, { title, text: splits[0].content })
            );
        }

        if (splits.length >= config.text.maxChunk) return null;

        const summaries = await Promise.all(splits.map(split => 
            this.openaiRequest(this.formatString(this.prompts.map, { title, text: split.content }))
        ));

        this.setProgress(60);
        return await this.openaiRequest(
            this.formatString(this.prompts.reduce, { title, text: summaries.join('\n\n') })
        );
    }

    // 主处理函数
    async generateSummary(item) {
        try {
            if (!item.isRegularItem() || !item.isTopLevelItem()) return;
            
            const title = item.getField('title');
            const link = item.getField('url') || "";
            
            this.initProgressWindow(title);
            this.setProgress(0, "Retrieving PDF...");

            // 验证文献类型
            if (!config.pdf.support_item_types.includes(item.itemType)) {
                return `Unsupported item type: ${item.itemType}`;
            }

            // 检查已存在的摘要
            const hasExistingSummary = await this.checkExistingSummary(item);
            if (hasExistingSummary) {
                this.setProgress(100, "Summary already exists.");
                this.progressWindow.startCloseTimer(5000);
                return;
            }

            // 获取PDF
            const pdfAttachment = await this.getPDFAttachment(item);
            const pdfData = await this.readPDFFile(pdfAttachment);
            
            // 解析PDF
            this.setProgress(20, "Parsing PDF...");
            const splits = await this.parsePDF(title, link, pdfData);
            
            // 生成摘要
            this.setProgress(40, "Generating summary...");
            const markdownSummary = await this.summarizeText(title, splits);
            if (!markdownSummary) {
                throw new Error("Failed to generate summary");
            }
            
            // 转换为HTML
            this.setProgress(80, "Formatting summary...");
            const html = await this.convertToHTML(title, markdownSummary);
            
            // 保存笔记
            await this.saveNote(item, html);
            
            this.setProgress(100, "Summary generated successfully!");
            this.progressWindow.startCloseTimer(5000);

        } catch (error) {
            this.itemProgress.setError();
            this.itemProgress.setText(`Error: ${error.message}`);
            this.progressWindow.startCloseTimer(5000);
            throw error;
        }
    }
    // 检查是否已存在摘要
    async checkExistingSummary(item) {
        const noteIds = item.getNotes();
        for (const id of noteIds) {
            const note = Zotero.Items.get(id);
            const content = note.getNote();
            if (content.includes("<h2>AI Generated Summary")) {
                return true;
            }
        }
        return false;
    }

    // 获取PDF附件
    async getPDFAttachment(item) {
        let pdfAttachment = await item.getBestAttachment();
        if (!this.checkAttachment(pdfAttachment)) {
            let i = 0;
            while (i < config.server.timeout && (!this.checkAttachment(pdfAttachment))) {
                await new Promise(r => setTimeout(r, 1000));
                pdfAttachment = await item.getBestAttachment();
                i++;
            }
        }
        if (!pdfAttachment) {
            throw new Error("No PDF attachment found for the selected item.");
        }
        return pdfAttachment;
    }

    // 读取PDF文件
    async readPDFFile(pdfAttachment) {
        const pdfPath = await pdfAttachment.getFilePath();
        const fileData = await IOUtils.read(pdfPath);
        return fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : fileData;
    }

    // 解析PDF
    async parsePDF(title, link, pdfData) {
        const formData = new window.FormData();
        formData.append('title', title);
        formData.append('link', link);
        formData.append('chunk_size', config.text.chunkSize);
        formData.append('chunk_overlap', config.text.chunkOverlap);
        formData.append('pdf', new Blob([pdfData], { type: 'application/pdf' }), title + '.pdf');

        const response = await fetch(`${config.server.url}/parse_pdf`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            throw await this.getAPIError(response);
        }

        const result = await response.json();
        return result.splits;
    }

    // 转换为HTML
    async convertToHTML(title, markdown) {
        const formData = new window.FormData();
        formData.append('title', title);
        formData.append('markdown', markdown);
        formData.append('model_name', config.llm.modelName);

        const response = await fetch(`${config.server.url}/md_to_html`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            throw await this.getAPIError(response);
        }

        const result = await response.json();
        return result.html;
    }

    // 保存笔记
    async saveNote(item, html) {
        const newNote = new Zotero.Item('note');
        newNote.setNote(html);
        newNote.parentID = item.id;
        await newNote.saveTx();
    }

    // 获取API错误信息
    async getAPIError(response) {
        let message;
        try {
            const data = await response.json();
            message = data.detail || data.error?.message;
        } catch (error) {
            message = response.statusText;
        }
        return new Error(`API Error: ${response.status} ${message ? ` - ${message}` : ''}`);
    }

    // 错误处理
    handleError(error) {
        this.itemProgress.setError();
        this.itemProgress.setText(`Error: ${error.message}`);
        this.progressWindow.startCloseTimer(5000);
        console.error('Error:', error);
    }
    // ... 其他必要的辅助方法实现 ...
}

// 导出模块
module.exports = PaperSummaryGenerator;