/**
 * 生成论文摘要
 * @author Qiuyang Zhang
 * @usage
 * @link https://jianyue.tech
 * @see https://jianyue.tech
 */
const project_dir = "C:\\Users\\qyzhang\\project\\zotero-ai";
const python_exe = "C:\\Users\\qyzhang\\miniconda3\\envs\\zotero-ai\\python.exe";
const pythonScript = `${project_dir}\\paper_summary.py`;

if ((!items || !items.length) && !item) {
    return;
}
if (items && !items.length) {
    items.push(item);
}
for (const item of items) {
    if (!item.isRegularItem() || !item.isTopLevelItem()) {
        continue;
    }
    try {
        // 获取PDF附件
        let pdfAttachment = await item.getBestAttachment();
        if (!pdfAttachment || pdfAttachment.getField('linkMode') !== 'linked_file') {
            let i = 0;
            while (i < 30 && (!pdfAttachment || pdfAttachment.getField('linkMode') !== 'linked_file')) {
                await new Promise(r => setTimeout(r, 1000));
                pdfAttachment = await item.getBestAttachment();
                i++;
            }
        }
        Zotero.debug(pdfAttachment);
        if (!pdfAttachment) {
            Zotero.debug("No PDF attachment found for the selected item.");
            continue;
        }

        let title = item.getField('title');
        let pdfPath = await pdfAttachment.getFilePath();

        let success = await Zotero.Utilities.Internal.exec(python_exe, [pythonScript, encodeURI(title), encodeURI(pdfPath)]);
        if (!success) {
            Zotero.logError(`Running ${pythonScript} error!`);
            continue;
        }

        // 从文件中读取出summary
        let summary_path = `${project_dir}\\summary\\${title}.html`
        let summary = await Zotero.File.getContentsAsync(summary_path);

        // 更新条目笔记
        let newNote = new Zotero.Item('note');
        newNote.setNote(summary);
        newNote.parentID = item.id;
        await newNote.saveTx();
    } catch (error) {
        Zotero.debug(`Error processing item: ${error.message}`);
    }
}
