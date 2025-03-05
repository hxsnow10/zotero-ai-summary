// 每当打开zotero的时候，都会自动运行这个脚本
// 把最近修改时间为昨天的笔记导出到一个文件夹里

let templateName = "[item]标记自动生成的层次笔记模板";
let notewrite_dir = "/home/xiahong/文档/zotero_notes"


function getYesterday(){
    // 获取当前日期
    const today = new Date();

    // 获取昨天的日期
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1); // 将日期减去 1 天

    // 格式化日期为 YYYY-MM-DD 格式
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0'); // 月份从 0 开始，需要加 1
    const day = String(yesterday.getDate()).padStart(2, '0');

    const formattedDate = `${year}-${month}-${day}`;
    return formattedDate;
}
let all_note_dir = "/home/xiahong/文档/zotero_notes/all";
let yeryerday_note_dir = "/home/xiahong/文档/zotero_notes/"+getYesterday();

async function getAllNotes() {
    try {
        // 获取用户库所有条目
        const s = new Zotero.Search();
        s.addCondition('libraryID', 'is', Zotero.Libraries.userLibraryID);
        s.addCondition('itemType', 'is', 'note');
        
        // 执行搜索
        const noteIds = await s.search();
        
        // 获取所有笔记对象
        const notes = await Zotero.Items.getAsync(noteIds);
        
        // 调试信息
        Zotero.debug(`找到 ${notes.length} 条笔记`);
        
        return notes;
    } catch (error) {
        Zotero.debug(`获取笔记失败: ${error.message}`);
        throw error;
    }
}

function isYesterday(dateString) {
    // 将时间字符串转换为 Date 对象
    const targetDate = new Date(dateString);

    // 获取当前日期
    const now = new Date();

    // 获取昨天的日期（当前日期减去1天）
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    // 获取昨天的起始时间（昨天00:00:00）和结束时间（昨天23:59:59）的时间戳
    const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() + 1);

    // 判断目标日期是否在昨天的范围内
    return targetDate >= startOfYesterday && targetDate < endOfYesterday;
}

async function writeNoteContent(note, directory) {
    try {
        // 获取父项目标题作为文件名的一部分
        const parentTitle = note.parentItem ? note.parentItem.getField('title') : 'untitled';
        // 清理文件名，移除非法字符
        const safeTitle = parentTitle.replace(/[^\w\s-]/g, '');
        
        // 创建文件名：标题_日期_笔记ID
        const fileName = `${safeTitle}_${new Date(note.dateModified).toISOString().split('T')[0]}_${note.key}.html`;
        const filePath = `${directory}/${fileName}`;

        // 获取笔记内容
        const content = note.getNote();

        // 确保目录存在
        await IOUtils.makeDirectory(directory);

        // 写入文件
        const encoder = new TextEncoder();
        await IOUtils.write(filePath, encoder.encode(content));

        Zotero.debug(`笔记已保存到: ${filePath}`);
        return filePath;
    } catch (error) {
        Zotero.debug(`写入笔记失败: ${error.message}`);
        throw error;
    }
}

// 使用示例
async function processNotes() {
    let export_notes = [];
    try {
        const notes = await getAllNotes();
        
        for (const note of notes) {
            // 获取笔记内容
            const content = note.getNote();
            // 获取修改时间
            const dateModified = note.dateModified;
            // 获取父条目（如果有）
            const parentItem = note.parentItem;
            if (content.includes(templateName)) {
                // 笔记是昨天修改的
                export_notes.push(note);
                await writeNoteContent(note, all_note_dir);
                if (isYesterday(dateModified)){
                    await writeNoteContent(note, yesterday_note_dir);
                }
            }
        }
    } catch (error) {
        Zotero.debug(`处理笔记时出错: ${error.message}`);
    }
    return export_notes;
}

let export_notes = await processNotes();
return export_notes;