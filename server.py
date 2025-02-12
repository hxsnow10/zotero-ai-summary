import os
import hashlib
import json
from pathlib import Path
from fastapi import FastAPI, UploadFile, Form, HTTPException
from paper_summary import PaperSummarizer
import sqlite3
import uvicorn

# 初始化 FastAPI 服务器
app = FastAPI()

# 配置数据库缓存
DB_PATH = "summary_cache.db"
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
try:
    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS summaries (
        title TEXT,
        link TEXT,
        pdf_hash TEXT PRIMARY KEY,
        summary TEXT,
        model_name TEXT
    )
    """
    )
    conn.commit()
except sqlite3.Error as e:
    print(f"Database error: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")


def compute_pdf_hash(file_path: Path) -> str:
    """计算 PDF 文件的哈希值"""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()


def get_cached_summary(title: str, link: str, pdf_hash: str):
    """检查是否已有缓存的论文总结，优先匹配 pdf_hash，其次匹配 link，最后匹配 title"""
    try:
        cursor.execute(
            """
            SELECT summary, model_name FROM summaries
            WHERE pdf_hash = ?
        """,
            (pdf_hash,),
        )
        result = cursor.fetchone()
        if result:
            return result

        cursor.execute(
            """
            SELECT summary, model_name FROM summaries
            WHERE link = ?
        """,
            (link,),
        )
        result = cursor.fetchone()
        if result:
            return result

        cursor.execute(
            """
            SELECT summary, model_name FROM summaries
            WHERE title = ?
        """,
            (title,),
        )
        return cursor.fetchone()
    except sqlite3.Error as e:
        print(f"Database query error: {e}")
        return None


def cache_summary(title: str, link: str, pdf_hash: str, summary: str, model_name: str):
    """缓存论文总结"""
    try:
        cursor.execute(
            """
            INSERT INTO summaries (title, link, pdf_hash, summary, model_name)
            VALUES (?, ?, ?, ?, ?)
        """,
            (title, link, pdf_hash, summary, model_name),
        )
        conn.commit()
    except sqlite3.Error as e:
        print(f"Database insert error: {e}")
    except Exception as e:
        print(f"Unexpected error while caching: {e}")


summarizer = PaperSummarizer()


@app.post("/upload")
# @limiter.limit("3/minute")  # 限制每个IP每分钟最多3次请求
async def upload_paper(
    title: str = Form(...),
    link: str = Form(...),
    secret: str = Form(...),
    pdf: UploadFile = UploadFile(...),
):
    """上传论文 PDF 并返回总结"""
    real_secret = os.getenv("SECRET_KEY")
    if secret != real_secret:
        raise HTTPException(status_code=403, detail="Invalid secret key")

    pdf_path = Path(f"uploads/{pdf.filename}")
    os.makedirs(pdf_path.parent, exist_ok=True)
    data = await pdf.read()
    print(f"New request: title={title}, link={link}, pdf.filename={pdf.filename}")
    with open(pdf_path, "wb") as buffer:
        buffer.write(data)

    # 计算 PDF 哈希值
    pdf_hash = compute_pdf_hash(pdf_path)

    # 查询缓存
    cached = get_cached_summary(title, link, pdf_hash)
    if cached:
        summary, model_name = cached
        print("Already cached!")
        return {"summary": summary, "model_name": model_name, "cached": True}

    # 生成论文总结
    try:
        print("Start summary...")
        summary = summarizer.summarize_paper(title, pdf_path)
        model_name = summarizer.model_name
        cache_summary(title, link, pdf_hash, summary, model_name)
        return {"summary": summary, "model_name": model_name, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    port = 13210  # 读取环境变量 PORT，默认 8001
    uvicorn.run(app, host="127.0.0.1", port=port)
