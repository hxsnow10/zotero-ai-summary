// 以下代码可以在 Zotero-ad hoc js 中运行，用于显示一个对话框并获取用户输入
async function showPromptDialog() {
    // 确保 Zotero 和其他组件被正确初始化
    if (typeof Zotero === 'undefined') {
        Zotero = Components.classes["@zotero.org/Zotero;1"]
            .getService(Components.interfaces.nsISupports)
            .wrappedJSObject;
    }

    // 使用 window.alert 作为备选方案
    try {
        let input = window.prompt("请输入搜索关键词：");
        return input || null;
    } catch (error) {
        console.error("对话框显示失败：", error);
        return null;
    }
}


// 执行主函数
//if (typeof window !== 'undefined') {
//    window.setTimeout(main, 1000); // 延迟执行以确保组件加载完成
//}

let re = showPromptDialog();
return re; 
