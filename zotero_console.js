const item = Zotero.getActiveZoteroPane().getSelectedItems()[0];
const attachments = item.getAttachments();
let dateModified = null;
for (let attachmentId of attachments) {
    const attachment = await Zotero.Items.getAsync(attachmentId);
    const annotations = attachment.getAnnotations();
    for (let annot of annotations){
        if (!dateModified || annot.dateModified > dateModified){
            dateModified = annot.dateModified;
        }
    }
}

