/**
 * Generate paper summary using HTTP API
 * @author Qiuyang Zhang
 * @usage https://github.com/cs-qyzhang/zotero-ai-summary
 */

const serverUrl = "https://paper.jianyue.tech/upload";  // 你的论文总结服务器地址
const secret = "xxxxx";
const only_link_file = true;
const timeout = 30;

function check_attachment(attachment) {
    return attachment && (!only_link_file ||
        attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE);
}

if (item) return;
for (const item of items) {
    try {
        if (!item.isRegularItem() || !item.isTopLevelItem()) {
            continue;
        }

        // 检查是否已经生成过总结
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

        // 获取 PDF 附件
        let pdfAttachment = await item.getBestAttachment();
        if (!check_attachment(pdfAttachment)) {
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
        let link = item.getField('url') || "";  // 获取论文的链接（如果有）
        let pdfPath = await pdfAttachment.getFilePath();
        const basePath = pdfPath.replace(/^.*[\\/]/, "");

        // 读取 PDF 文件，返回的是 Uint8Array（若返回 ArrayBuffer，请自行转换）
        let fileData = await IOUtils.read(pdfPath);
        if (fileData instanceof ArrayBuffer) {
            fileData = new Uint8Array(fileData);
        }

        // 构造 multipart/form-data 请求体
        const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
        const CRLF = "\r\n";
        const encoder = new TextEncoder();

        // 构造各个部分的文本
        const partTitle = `--${boundary}${CRLF}` +
                          `Content-Disposition: form-data; name="title"${CRLF}${CRLF}` +
                          `${title}${CRLF}`;
        const partLink = `--${boundary}${CRLF}` +
                         `Content-Disposition: form-data; name="link"${CRLF}${CRLF}` +
                         `${link}${CRLF}`;
        const partSecret = `--${boundary}${CRLF}` +
                         `Content-Disposition: form-data; name="secret"${CRLF}${CRLF}` +
                         `${secret}${CRLF}`;
        const partFileHeader = `--${boundary}${CRLF}` +
                               `Content-Disposition: form-data; name="pdf"; filename="${basePath}"${CRLF}` +
                               `Content-Type: application/pdf${CRLF}${CRLF}`;
        const partFooter = `${CRLF}--${boundary}--${CRLF}`;

        // 将文本部分转换为 Uint8Array
        const partTitleBytes = encoder.encode(partTitle);
        const partLinkBytes = encoder.encode(partLink);
        const partSecretBytes = encoder.encode(partSecret);
        const partFileHeaderBytes = encoder.encode(partFileHeader);
        const partFooterBytes = encoder.encode(partFooter);

        // 计算总长度并创建一个新的 Uint8Array 保存最终的请求体数据
        const totalLength = partTitleBytes.length + partLinkBytes.length +
                            partSecretBytes.length + partFileHeaderBytes.length +
                            fileData.length + partFooterBytes.length;
        const bodyBuffer = new Uint8Array(totalLength);
        let offset = 0;
        bodyBuffer.set(partTitleBytes, offset);
        offset += partTitleBytes.length;
        bodyBuffer.set(partLinkBytes, offset);
        offset += partLinkBytes.length;
        bodyBuffer.set(partSecretBytes, offset);
        offset += partSecretBytes.length;
        bodyBuffer.set(partFileHeaderBytes, offset);
        offset += partFileHeaderBytes.length;
        bodyBuffer.set(fileData, offset);
        offset += fileData.length;
        bodyBuffer.set(partFooterBytes, offset);

        // 发送 POST 请求
        const response = await fetch(serverUrl, {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`
            },
            body: bodyBuffer.buffer
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        let result = await response.json();
        let summary = result.summary || "";
        let modelName = result.model_name || "Unknown Model";
        let cached = result.cached ? "(Cached)" : "";

        if (!summary) {
            throw new Error("Failed to retrieve a valid summary.");
        }

        // 生成新的笔记
        let newNote = new Zotero.Item('note');
        newNote.setNote(summary);
        newNote.parentID = item.id;
        await newNote.saveTx();

    } catch (error) {
        Zotero.debug(`Error processing item: ${error.message}`);
    }
}
