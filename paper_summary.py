# -*- coding: utf-8 -*-
import os
import sys
import time
import json
from pathlib import Path
import json
from urllib.parse import unquote
from markdown_it import MarkdownIt
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains.summarize import load_summarize_chain
from langchain_core.prompts import PromptTemplate
from langchain_core.documents import Document
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import ChatOpenAI


class PaperSummarizer:
    def __init__(self):
        # 从配置文件读取API密钥
        api_key_path = os.path.expanduser("~/.config/deepseek.json")
        try:
            with open(api_key_path, "r", encoding="utf-8") as f:
                api_json = json.load(f)
                api_key = api_json["api_key"]
                context_len = api_json["context_length"]
                self.model_name = api_json["name"]
                self.base_url = api_json["base_url"]
                self.model = api_json["model"]
                self.llm = ChatOpenAI(
                    api_key=api_key,
                    base_url=self.base_url,
                    model=self.model,
                    temperature=0.3,
                )
        except FileNotFoundError:
            raise FileNotFoundError(
                f"找不到API密钥文件：{api_key_path}。请创建文件并添加你的API密钥。"
            )
        except Exception as e:
            raise Exception(f"读取API密钥时出错：{str(e)}")

        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=context_len, chunk_overlap=1000, length_function=len
        )

        with open(
            os.path.join(os.path.dirname(__file__), "stuff_prompt.txt"),
            "r",
            encoding="utf-8",
        ) as f:
            stuff_prompt_template = f.read()
            stuff_prompt = PromptTemplate(
                template=stuff_prompt_template, input_variables=["text", "title"]
            )

        with open(
            os.path.join(os.path.dirname(__file__), "reduce_prompt.txt"),
            "r",
            encoding="utf-8",
        ) as f:
            reduce_prompt_template = f.read()
            reduce_prompt = PromptTemplate(
                template=reduce_prompt_template, input_variables=["text", "title"]
            )

        with open(
            os.path.join(os.path.dirname(__file__), "map_prompt.txt"),
            "r",
            encoding="utf-8",
        ) as f:
            map_prompt_template = f.read()
            map_prompt = PromptTemplate(
                template=map_prompt_template, input_variables=["text", "title"]
            )

        # 创建summarize chain
        self.stuff_chain = load_summarize_chain(
            llm=self.llm,
            chain_type="stuff",
            prompt=stuff_prompt,
        )

        self.mapreduce_chain = load_summarize_chain(
            llm=self.llm,
            chain_type="map_reduce",
            map_prompt=map_prompt,
            combine_prompt=reduce_prompt,
        )

    def post_process_summary(self, summary: str) -> str:
        """对summary进行后处理"""
        if summary.startswith("```"):
            summary = "\n".join(summary.splitlines()[1:])
        if summary.endswith("```"):
            summary = "\n".join(summary.splitlines()[:-1])
        return summary

    def summarize_paper(self, title: str, pdf_path: Path) -> str:
        """使用LangChain的summarize chain总结论文

        Args:
            pdf_path: PDF文件路径
        Returns:
            str: 论文总结
        """
        if not pdf_path:
            return None
        try:
            # 加载PDF
            print(f"加载PDF: {pdf_path}")
            loader = PyPDFLoader(pdf_path)
            pages = loader.load()
            print(f"加载PDF完成: {len(pages)}页")

            # 合并所有页面的文本
            full_text = "\n".join(page.page_content for page in pages)
            doc = Document(page_content=full_text)

            splits = self.text_splitter.split_documents([doc])

            print(f"总页数: {len(pages)}")
            print(f"总字符数: {len(full_text)}")
            print(f"分割块数: {len(splits)}")
            summary_path = Path(os.path.dirname(__file__), f"summary/{title}.html")
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            # 运行chain获取总结
            if not summary_path.exists():
                start_time = time.time()
                if len(splits) > 1:
                    chain = self.mapreduce_chain
                else:
                    chain = self.stuff_chain
                summary = chain.invoke(
                    {"input_documents": splits, "title": title},
                    return_only_outputs=True,
                )
                end_time = time.time()
                print(
                    f"总结时间: {end_time - start_time}秒，输入长度：{len(full_text)}，输出长度: {len(summary['output_text'])}"
                )
                summary = self.post_process_summary(summary["output_text"])
                md = MarkdownIt()
                summary = md.render(summary)
                summary = f"<h2>AI Generated Summary ({self.model_name})</h2>" + summary
                with open(summary_path, "w", encoding="utf-8") as f:
                    f.write(summary)
            else:
                print(f"找到现有总结: {summary_path}")
                with open(summary_path, "r", encoding="utf-8") as f:
                    summary = f.read()
            return summary

        except Exception as e:
            print(f"总结论文时发生错误: {e}")
            return None


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python paper_summary.py <title> <URI-encoded pdf_path>")
        sys.exit(1)

    title = unquote(sys.argv[1])
    pdf_path = unquote(sys.argv[2])

    with open(
        os.path.join(os.path.dirname(__file__), "test.log"), "w", encoding="utf-8"
    ) as f:
        f.write(f"title: {title}, pdf_path: {pdf_path}")

    try:
        summarizer = PaperSummarizer()
        print(f"开始总结: {title}, {pdf_path}")
        summary = summarizer.summarize_paper(title, Path(pdf_path))
        print(summary)
    except Exception as e:
        with open(
            os.path.join(os.path.dirname(__file__), "summary.txt"),
            "w",
            encoding="utf-8",
        ) as f:
            f.write(str(e))
        print(f"Error: {e}")
        time.sleep(5)
