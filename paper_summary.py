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
        # Read the API key from the configuration file
        api_key_path = os.path.expanduser("~/.config/llm.json")
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
                f"Can't find the API key file: {api_key_path}. Please create the file and add your API key."
            )
        except Exception as e:
            raise Exception(f"Error reading API key: {str(e)}")

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

        # Create summarize chain
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
        """Post-process the summary"""
        lines = summary.strip().splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
            while lines[0] == "":
                lines = lines[1:]
            while not lines[-1].startswith("```"):
                lines = lines[:-1]
            lines = lines[:-1]
        if "summary" in lines[0].lower() or "overview" in lines[0].lower():
            lines = lines[1:]
            while lines[0] == "":
                lines = lines[1:]
        summary = "\n".join(lines[:-1]).strip()
        return summary

    def summarize_paper(self, title: str, pdf_path: Path) -> str:
        # Load PDF
        print(f"Loading PDF: {pdf_path}")
        loader = PyPDFLoader(pdf_path)
        pages = loader.load()
        print(f"PDF loaded: {len(pages)} pages")

        # Merge all page texts
        full_text = "\n".join(page.page_content for page in pages)
        doc = Document(page_content=full_text)

        splits = self.text_splitter.split_documents([doc])

        print(f"Total pages: {len(pages)}")
        print(f"Total characters: {len(full_text)}")
        print(f"Number of splits: {len(splits)}")
        summary_path = Path(os.path.dirname(__file__), f"summary/{title}.html")
        summary_path.parent.mkdir(parents=True, exist_ok=True)

        # Run chain to get summary
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
                f"Summary time: {end_time - start_time} seconds, input length: {len(full_text)}, output length: {len(summary['output_text'])}"
            )
            summary = self.post_process_summary(summary["output_text"])
            md_path = Path(os.path.dirname(__file__), f"summary/{title}.md")
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(summary)
            md = MarkdownIt()
            summary = md.render(summary)
            summary = f"<h2>AI Generated Summary ({self.model_name})</h2>" + summary
            with open(summary_path, "w", encoding="utf-8") as f:
                f.write(summary)
        else:
            print(f"Found existing summary: {summary_path}")
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = f.read()
        return summary


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "Usage: python paper_summary.py <URI-encoded title> <URI-encoded pdf_path>"
        )
        sys.exit(1)

    title = unquote(sys.argv[1])
    pdf_path = unquote(sys.argv[2])

    with open(
        os.path.join(os.path.dirname(__file__), "test.log"), "w", encoding="utf-8"
    ) as f:
        f.write(f"title: {title}, pdf_path: {pdf_path}")

    try:
        summarizer = PaperSummarizer()
        print(f"Start summarizing: {title}, {pdf_path}")
        summary = summarizer.summarize_paper(title, Path(pdf_path))
        print(summary)
    except Exception as e:
        with open(
            os.path.join(os.path.dirname(__file__), "error.log"),
            "w",
            encoding="utf-8",
        ) as f:
            f.write(str(e))
        print(f"Error: {e}")
        time.sleep(5)
