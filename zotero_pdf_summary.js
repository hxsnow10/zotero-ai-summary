/**
 * Generate paper summary using LLM
 * @author Qiuyang Zhang  xiahong
 * @usage https://github.com/cs-qyzhang/zotero-ai-summary
 */

/************* Configurations Start *************/

let dirname = "/home/xiahong/code/zotero-ai-summary";

async function load_file(pname) {
    try {
        let path = dirname + "/" + pname;
        // 使用 IOUtils 读取文件内容
        let content = await IOUtils.read(path);
        
        // 使用 TextDecoder 处理 Unicode 字符
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(content);
    } catch (error) {
        throw new Error(`读取文件失败 ${pname}: ${error.message}`);
    }
}

let fileContent = await load_file("config.json");

const config = JSON.parse(fileContent);

// load prompt 
function load_prompt(pname){
    pname = "prompt/"+pname+"_prompt.txt";
    return load_file(pname);
}

// Prompt for "stuff" method, which is used when there is only one split
let stuff_prompt = await load_prompt("stuff");

// Prompt for "map-reduce" method, which is used when there are multiple splits
let map_prompt = await load_prompt("map");

// Prompt for "reduce" in "map-reduce" method
let reduce_prompt = await load_prompt("reduce");

/************* Configurations End *************/

let console = require("console");

function formatString(str, params) {
    return str.replace(/{([^{}]*)}/g, (match, key) => {
        return params[key] || match;
    });
}

function check_attachment(attachment) {
    return attachment && (!config.summary.only_link_file ||
        attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE);
}

if (!item) return;

async function generateSummary(item){

    let progressWindow = undefined;
    let itemProgress = undefined;
    const window = require('window');
    
    if (config.llm.openaiBaseUrl.endsWith('/')) {
        config.llm.openaiBaseUrl = config.llm.openaiBaseUrl.slice(0, -1);
    }
    
    try {
        if (!item.isRegularItem() || !item.isTopLevelItem()) {
            return;
        }
    
        let title = item.getField('title');
        let link = item.getField('url') || "";
    
        const shortTitle = title.length > 50 ? title.substring(0, 50) + "..." : title;
        progressWindow = new Zotero.ProgressWindow({
            "closeOnClick": false,
        });
        progressWindow.addDescription(shortTitle);
        itemProgress = new progressWindow.ItemProgress();
        itemProgress.setItemTypeAndIcon("note");
        itemProgress.setText("Retrieving PDF...");
        progressWindow.show();
    
        let itemType = item.itemType;
        if (!config.summary.support_item_types.includes(itemType)){
            return `No support itemType=${itemType}.`;
        }
    
        // Check if the summary already exists
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
            itemProgress.setProgress(100);
            itemProgress.setText("Summary already exists.");
            progressWindow.startCloseTimer(5000);
            return;
        }
    
        // Get PDF attachment
        let pdfAttachment = await item.getBestAttachment();
        if (!check_attachment(pdfAttachment)) {
            let i = 0;
            while (i < config.server.timeout && (!check_attachment(pdfAttachment))) {
                await new Promise(r => setTimeout(r, 1000));
                pdfAttachment = await item.getBestAttachment();
                i++;
            }
        }
        if (!pdfAttachment) {
            return "No PDF attachment found for the selected item.";
        }
    
        let pdfPath = await pdfAttachment.getFilePath();
        const basePath = pdfPath.replace(/^.*[\\/]/, "");
    
        // Read PDF
        let fileData = await IOUtils.read(pdfPath);
        if (fileData instanceof ArrayBuffer) {
            fileData = new Uint8Array(fileData);
        }
    
        itemProgress.setProgress(20);
        itemProgress.setText("Parsing PDF...");
    
        // Step 1: Parse PDF
        const formData = new window.FormData();
        formData.append('title', title);
        formData.append('link', link);
        formData.append('chunk_size', config.summary.chunkSize);
        formData.append('chunk_overlap', config.summary.chunkOverlap);
        formData.append('pdf', new Blob([fileData], { type: 'application/pdf' }), basePath);
    
        const parseResponse = await fetch(`${config.server.url}/parse_pdf`, {
            method: "POST",
            body: formData
        });
        if (!parseResponse.ok) {
            let message = undefined;
            try {
                const data = await parseResponse.json();
                message = data.detail || data.error?.message;
            } catch (error) {}
            throw new Error(`${config.server.url} HTTP Error: ${parseResponse.status} ${parseResponse.statusText}${message ? ` - ${message}` : ''}`);
        }
        let parseResult, splits;
        try {
            parseResult = await parseResponse.json();
            splits = parseResult.splits;
        } catch (error) {
            throw new Error(`Error when parsing json of ${config.server.url}/parse_pdf: ${error.message}`);
        }
    
        // Step 2: Generate summary
        itemProgress.setProgress(40);
        itemProgress.setText("Generating summary...");
        const markdownSummary = await summarizeText(title, splits);
        if (!markdownSummary){
            itemProgress.setText(`summary error`);
            return false;
        }
    
        // Step 3: Convert to HTML
        itemProgress.setProgress(80);
        itemProgress.setText("Formatting summary To html...");
        const htmlFormData = new window.FormData();
        htmlFormData.append('title', title);
        htmlFormData.append('markdown', markdownSummary);
        htmlFormData.append('model_name', config.llm.modelName);
    
        const htmlResponse = await fetch(`${config.server.url}/md_to_html`, {
            method: "POST",
            body: htmlFormData
        });
        if (!htmlResponse.ok) {
            let message = undefined;
            try {
                const data = await htmlResponse.json();
                message = data.detail || data.error?.message;
            } catch (error) {}
            throw new Error(`${config.server.url} HTTP Error: ${htmlResponse.status} ${htmlResponse.statusText}${message ? ` - ${message}` : ''}`);
        }
        let htmlResult;
        try {
            htmlResult = await htmlResponse.json();
        } catch (error) {
            throw new Error(`Error when parsing json of ${config.server.url}/md_to_html: ${error.message}`);
        }
    
        // Create note with HTML content
        let newNote = new Zotero.Item('note');
        newNote.setNote(htmlResult.html);
        newNote.parentID = item.id;
        await newNote.saveTx();
    
        itemProgress.setProgress(100);
        itemProgress.setText("Summary generated successfully!");
        progressWindow.startCloseTimer(5000);
        return true;
    } catch (error) {
        itemProgress.setError();
        itemProgress.setText(`Error processing item: ${error.message}`);
        progressWindow.addDescription("");
        progressWindow.startCloseTimer(5000);
        return error.message;
    }

}



async function openaiRequest(message) {
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
        let message = undefined;
        try {
            const data = await response.json();
            message = data.detail || data.error?.message;
        } catch (error) {}
        throw new Error(`${config.llm.openaiBaseUrl} HTTP Error: ${response.status} ${response.statusText}${message ? ` - ${message}` : ''}`);
    }

    let result;
    try {
        result = await response.json();
    } catch (error) {
        throw new Error(`Error when parsing json of ${config.llm.openaiBaseUrl}/chat/completions: ${error.message}`);
    }
    if (!result.choices) {
        throw new Error("LLM API call failed!");
    }
    return result.choices[0].message.content;
}

async function summarizeText(title, splits) {
    // If only one split, use "stuff" method
    if (splits.length === 1) {
        const response = await openaiRequest(formatString(stuff_prompt, { title: title, text: splits[0].content }));
        return response;
    }
    // 如果split太多就停止
	if (splits.length >=config.summary.maxChunk) {
		return null;
	}
    // For multiple splits, use map-reduce method
    const summaries = await Promise.all(splits.map(async split => {
        const response = await openaiRequest(formatString(map_prompt, { title: title, text: split.content }));
        return response;
    }));
    itemProgress.setProgress(60);
    const combinedSummary = summaries.join('\n\n');
    const response = await openaiRequest(formatString(reduce_prompt, { title: title, text: combinedSummary }));
    return response;
}

// 添加并发处理多个选中项的函数
async function processSelectedItems() {
    // 获取所有选中的项目
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    items = [item];
    if (!items || items.length === 0) {
        // window.alert("请先选择要处理的文献");
        return "items size = 0";
    }

    // 使用 Promise.all 并发处理所有选中的项目
    let processNum = 0;
    try {
        await Promise.all(items.map(async (item) => {
            try {
                let stats= await generateSummary(item);
                if (stats == true){
                    processNum++;
                } else {
                    console.error(`处理文献 "${item.getField('title')}" 时出错:`, stats.message);
                }
            } catch (error) {
                console.error(`处理文献 "${item.getField('title')}" 时出错:`, error);
            }
        }));
    } catch (error) {
        console.error("批量处理文献时出错:", error);
    }

    return  "finsh process: sucess_num = " + processNum + " / total_num = " + items.length;
}

// 执行处理
return await processSelectedItems();