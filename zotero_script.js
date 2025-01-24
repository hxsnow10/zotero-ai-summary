/**
 * Generate paper summary using LLM
 * @author Qiuyang Zhang
 * @usage https://github.com/cs-qyzhang/zotero-ai-summary
 * @link https://github.com/windingwind/zotero-actions-tags/discussions/457
 */
const project_dir = "C:\\Users\\qyzhang\\project\\zotero-ai";
const python_exe = "C:\\Users\\qyzhang\\miniconda3\\envs\\zotero-ai\\python.exe";
const pythonScript = `${project_dir}\\paper_summary.py`;
const only_link_file = true;
const timeout = 30;

function check_attachment(attachment) {
    return attachment && (!only_link_file ||
        attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE);
}

if ((!items || !items.length) && !item) {
    return;
}
if (items && !items.length) {
    items.push(item);
}
for (const item of items) {
    try {
        if (!item.isRegularItem() || !item.isTopLevelItem()) {
            continue;
        }

        // Check if summary already exists
        let noteIds = item.getNotes();
        let summary_exist = false;
        for (const id of noteIds) {
            let note = Zotero.Items.get(id);
            let content = note.getNote();
            if (content.search("<h2>AI Generated Summary") >= 0) {
                summary_exist = true;
                break;
            }
        }
        if (summary_exist) {
            continue;
        }

        // Retrieve the PDF attachment
        let pdfAttachment = await item.getBestAttachment();
        if (!check_attachment(pdfAttachment)) {
            // Wait for the PDF attachment to be ready
            let i = 0;
            while (i < timeout && (!check_attachment(pdfAttachment))) {
                await new Promise(r => setTimeout(r, 1000));
                pdfAttachment = await item.getBestAttachment();
                i++;
            }
        }
        if (!pdfAttachment) {
            Zotero.debug("No PDF attachment found for the selected item.");
            continue;
        }

        let title = item.getField('title');
        let pdfPath = await pdfAttachment.getFilePath();

        // Run the Python script
        let success = await Zotero.Utilities.Internal.exec(python_exe,
            [pythonScript, encodeURI(title), encodeURI(pdfPath)]);
        if (!success) {
            Zotero.logError(`Running ${pythonScript} error!`);
            continue;
        }

        // Read the summary from the file
        let summary_path = `${project_dir}\\summary\\${title}.html`
        let summary = await Zotero.File.getContentsAsync(summary_path);

        // Update the item note
        let newNote = new Zotero.Item('note');
        newNote.setNote(summary);
        newNote.parentID = item.id;
        await newNote.saveTx();
    } catch (error) {
        Zotero.debug(`Error processing item: ${error.message}`);
    }
}