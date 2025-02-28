const dirpath = "/home/xiahong/code/zotero-ai-summary";
const PaperSummaryGenerator = require(dirpath+'/zotero_pdf_summary.js');
// error: Module `/home/xiahong/code/zotero-ai-summary` is not found at 
// resource://zotero//home/xiahong/code/zotero-ai-summary.js

async function main() {
    try {
        const generator = new PaperSummaryGenerator();
        await generator.init();
        
        // 在Zotero插件中使用
        if (!selectedItems || selectedItems.length === 0) {
            throw new Error('请先选择要处理的文献');
        }
        
        for (const item of items) {
            await generator.generateSummary(item);
        }
    } catch (error) {
        Zotero.debug(`[AI Summary] Error: ${error.message}`);
        throw error;
    }
}

// 运行
main().catch(error => {
    console.error('[AI Summary] Failed:', error);
    // 显示错误通知
    new Zotero.ProgressWindow({ closeOnClick: true })
        .addDescription(`错误: ${error.message}`)
        .show()
        .startCloseTimer(3000);
});