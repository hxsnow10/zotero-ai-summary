/**
 * Generate summary of multi item using LLM
 * @author xiahong xiahahaha01@gmail.com
 * @usage https://github.com/hxsnow10/zotero-ai-summary
 */

// 对于每篇文献，生成一个摘要
// 然后基于这些摘要生成一个总结
const PaperSummaryGenerator = require('./paper_summary');
const path = require('path');
const fs = require('fs').promises;

class MultiPaperSummaryGenerator {
    constructor() {
        this.generator = new PaperSummaryGenerator();
        this.progressWindow = null;
        this.itemProgress = null;
    }

    async init() {
        await this.generator.init();
        this.mergePrompt = await fs.readFile(
            path.join(__dirname, 'prompts', 'merge_prompt.txt'), 
            'utf8'
        );
    }

    // 初始化进度窗口
    initProgressWindow(itemCount) {
        this.progressWindow = new Zotero.ProgressWindow({ 
            closeOnClick: false 
        });
        this.progressWindow.addDescription(`正在处理 ${itemCount} 篇文献`);
        this.itemProgress = new this.progressWindow.ItemProgress();
        this.itemProgress.setItemTypeAndIcon("note");
        this.progressWindow.show();
    }

    // 获取文献摘要
    async getPaperSummaries(items) {
        const summaries = [];
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            this.itemProgress.setText(`处理第 ${i + 1}/${items.length} 篇文献...`);
            this.itemProgress.setProgress((i / items.length) * 50);

            // 检查现有摘要
            const summary = await this.getExistingSummary(item);
            if (summary) {
                summaries.push({
                    title: item.getField('title'),
                    authors: item.getCreators().map(c => `${c.firstName} ${c.lastName}`).join(', '),
                    year: item.getField('year'),
                    summary: summary
                });
                continue;
            }

            // 生成新摘要
            try {
                await this.generator.generateSummary(item);
                const newSummary = await this.getExistingSummary(item);
                if (newSummary) {
                    summaries.push({
                        title: item.getField('title'),
                        authors: item.getCreators().map(c => `${c.firstName} ${c.lastName}`).join(', '),
                        year: item.getField('year'),
                        summary: newSummary
                    });
                }
            } catch (error) {
                console.error(`处理文献失败: ${item.getField('title')}`, error);
            }
        }

        return summaries;
    }

    // 获取现有摘要
    async getExistingSummary(item) {
        const noteIds = item.getNotes();
        for (const id of noteIds) {
            const note = Zotero.Items.get(id);
            const content = note.getNote();
            if (content.includes("<h2>AI Generated Summary")) {
                // 提取摘要内容
                const div = document.createElement('div');
                div.innerHTML = content;
                const summaryContent = div.querySelector('.summary-content');
                return summaryContent ? summaryContent.innerHTML : null;
            }
        }
        return null;
    }

    // 生成综述
    async generateMergedSummary(summaries) {
        this.itemProgress.setText("生成综述...");
        this.itemProgress.setProgress(75);

        const context = summaries.map(s => 
            `标题: ${s.title}\n作者: ${s.authors}\n年份: ${s.year}\n摘要: ${s.summary}\n`
        ).join('\n---\n\n');

        const response = await this.generator.openaiRequest(
            this.generator.formatString(this.mergePrompt, { 
                papers_count: summaries.length,
                summaries: context 
            })
        );

        return response;
    }

    // 保存综述
    async saveMergedSummary(items, content) {
        this.itemProgress.setText("保存综述...");
        this.itemProgress.setProgress(90);

        const parentItem = items[0];
        const newNote = new Zotero.Item('note');
        
        const html = `
            <h1>多篇文献综述</h1>
            <h2>AI Generated Review</h2>
            <div class="papers-info">
                <p>包含文献数: ${items.length}</p>
                <p>生成时间: ${new Date().toLocaleString()}</p>
            </div>
            <div class="merged-summary">
                ${content}
            </div>
        `;

        newNote.setNote(html);
        newNote.parentID = parentItem.id;
        await newNote.saveTx();
    }

    // 主处理函数
    async generateMergedSummary(items) {
        if (!items || items.length === 0) {
            throw new Error("未选择文献");
        }

        try {
            this.initProgressWindow(items.length);
            
            // 获取每篇文献的摘要
            const summaries = await this.getPaperSummaries(items);
            if (summaries.length === 0) {
                throw new Error("未能获取任何文献摘要");
            }

            // 生成综述
            const mergedContent = await this.generateMergedSummary(summaries);
            
            // 保存综述
            await this.saveMergedSummary(items, mergedContent);

            this.itemProgress.setProgress(100);
            this.itemProgress.setText("综述生成完成！");
            this.progressWindow.startCloseTimer(3000);

        } catch (error) {
            this.itemProgress.setError();
            this.itemProgress.setText(`错误: ${error.message}`);
            this.progressWindow.startCloseTimer(5000);
            throw error;
        }
    }
}

// 导出模块
module.exports = MultiPaperSummaryGenerator;

const MultiPaperSummaryGenerator = require('./paper_summary_merge');

async function main() {
    const generator = new MultiPaperSummaryGenerator();
    await generator.init();
    
    const selectedItems = ZoteroPane.getSelectedItems();
    await generator.generateMergedSummary(selectedItems);
}

main().catch(console.error);