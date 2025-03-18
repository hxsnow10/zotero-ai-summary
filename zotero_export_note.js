// 每当打开zotero的时候，都会自动运行这个脚本
// 把所有的笔记都导出来，然后保存到一个目录里，然后导入到wolai里
// 一共2个目录，一个是所有的笔记，一个是更新过的笔记
// 需要一个地方，存储与读取上一次保存的时间
// 筛选出真正看完的笔记，长度大于某个值

// key of content, value of file name suffix
let keyNames = {
    "[item]标记自动生成的层次笔记模板":"Annotation",
    "AI Generated Summary":"AI-Summary",
}
let notewrite_dir = "/home/xiahong/文档/zotero_notes"
let last_save_time_path = "/home/xiahong/文档/zotero_notes/last_save_time.txt";
let last_save_time = Zotero.File.getContents(last_save_time_path);

let ignore_last_save_time = false;
const min_length = 3000;

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
// clean this 2 directory

let all_note_dir = "/home/xiahong/文档/zotero_notes/all";
let new_note_dir = "/home/xiahong/文档/zotero_notes/new";

//IOUtils.remove(all_note_dir,{recursive: true});
//IOUtils.remove(new_note_dir);
IOUtils.makeDirectory(all_note_dir);
IOUtils.makeDirectory(new_note_dir);

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

async function writeNoteContent(note, note_type, directory) {
    try {
        IOUtils.makeDirectory(directory);
        // 获取父项目标题作为文件名的一部分
        const parentTitle = note.parentItem ? note.parentItem.getField('title') : 'untitled';
        // 清理文件名，移除非法字符
        const safeTitle = parentTitle.replace(/[\0\/]/g, '');
        
        // 创建文件名：标题_日期_笔记ID
        const fileName = `${safeTitle}_${note.parentItem.getField('date')}_${note_type}.md`;
        const filePath = `${directory}/${fileName}`;
        const filePathTmp = `${directory}/${fileName}_tmp.md`; 

        await Zotero.BetterNotes.api.$export.saveMD(filePathTmp, note.id);
        // 如果有需要修改内容 
        
        let content = Zotero.File.getContents(filePathTmp);
        content = content.replace(/<[^>]*span[^>]*>/gi, '');
        content = content.replace(/\\<[^>]*img[^>]*>/gi, '');
        content= content.replace(/<!--[\s\S]*?-->/g, "");
        content= content.replace(/🔤/g,"")

        // 写入文件
        const encoder = new TextEncoder();
        await IOUtils.write(filePath, encoder.encode(content));
        await IOUtils.remove(filePathTmp);

        Zotero.debug(`笔记已保存到: ${filePath}`);
        return filePath;
    } catch (error) {
        Zotero.debug(`写入笔记失败: ${error.message}`);
        throw error;
    }
}

// 使用示例
async function processNotes() {
    let all_export_notes = [];
    let new_export_notes = [];
    let lengths = [];

    const notes = await getAllNotes();
    
    for (const note of notes) {
        try {
            // 获取笔记内容
            const content = note.getNote();
            // 获取修改时间
            const dateModified = note.dateModified;
            // 获取父条目（如果有）
            const parentItem = note.parentItem;
            let note_type = null;
            for (const key in keyNames){
                if (content.includes(key.trim())){
                    note_type = keyNames[key];
                    break;
                }
            }
            const parentTitle = note.parentItem ? note.parentItem.getField('title') : 'untitled';
            lengths.push([parentTitle,content.length,note_type]);
            if (note_type!=null){
                
                if (content.length > min_length){
                    if (ignore_last_save_time){
                        all_export_notes.push(note);
                        await writeNoteContent(note, note_type, all_note_dir+"/"+parentTitle);
                    }
                    // await writeNoteContent(note, note_type, all_note_dir+"/"+parentTitle);
                    if (dateModified>last_save_time || ignore_last_save_time) {
                        // 保存目录的逻辑：  可以就保存到一个目录里，然后整体打包导入wolai，导入后这些都移除，
                        // 下次保存就是那些增量的，导入就少了
                        new_export_notes.push(note);
                        await writeNoteContent(note, note_type, new_note_dir+"/"+parentTitle);
                        await writeNoteContent(note, note_type, all_note_dir+"/"+parentTitle);
                    }
                }
            }
        } catch (error) {
            Zotero.debug(`处理笔记时出错: ${error.message}`);
        }
    }

    
    return [all_export_notes,new_export_notes];
}

function checkDate(){
    // 获取当前时间
    let now = new Date();

    // 将目标时间字符串转换为 Date 对象
    let targetDate = new Date(last_save_time);

    // 计算两个时间之间的差值（以毫秒为单位）
    let difference = Math.abs(targetDate - now);

    // 将差值转换为天数
    let daysDifference = difference / (1000 * 60 * 60 * 24);

    // 判断是否相差7天以上
    if (daysDifference >= 7) {
        return true;
    } else {
        return false;
    }
}


async function process(){
    // 距离上次相差7天以上才会执行
    if (!checkDate() && !ignore_last_save_time) {
        return "距离上次保存不足7天，跳过";
    }

    let [all_export_notes,new_export_notes] = await processNotes();
    // result.sort((a,b)=>b[1]-a[1]);

    // 写入文件
    const now = new Date();
    const encoder = new TextEncoder();
    await IOUtils.write(last_save_time_path, encoder.encode(now.toISOString()));
    return "一共导出 ${all_export_note}个note->all, ${new_export_notes}个note->new";
}

if (typeof item == "undefined"||  item==null){
    return await process();
} else {
    return;
}
