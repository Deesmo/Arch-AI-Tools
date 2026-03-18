"""
Arch Tools — LangChain Integration
====================================

Ready-to-use LangChain tool wrappers for all 58+ Arch Tools.
Supports API key auth and handles x402 USDC payment errors gracefully.

Install:
    pip install httpx langchain-core

Usage (single tool):
    from langchain_arch_tools import ArchToolsWebScrape

    tool = ArchToolsWebScrape(api_key="arch_...")
    result = tool.invoke({"url": "https://example.com"})

Usage (all tools as a toolkit):
    from langchain_arch_tools import ArchToolsToolkit

    toolkit = ArchToolsToolkit(api_key="arch_...")
    tools = toolkit.get_tools()
    # Pass `tools` to your LangChain agent

Usage with LangChain Agent:
    from langchain_openai import ChatOpenAI
    from langchain.agents import create_tool_calling_agent, AgentExecutor
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_arch_tools import ArchToolsToolkit

    llm = ChatOpenAI(model="gpt-4o")
    toolkit = ArchToolsToolkit(api_key="arch_...")
    tools = toolkit.get_tools()

    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful assistant with access to Arch Tools."),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])

    agent = create_tool_calling_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=True)
    result = executor.invoke({"input": "Summarize the article at https://example.com"})
"""

from __future__ import annotations

import os
from typing import Any, Optional, Type

from langchain_core.tools import BaseTool
from langchain_core.callbacks import CallbackManagerForToolRun, AsyncCallbackManagerForToolRun
from pydantic import BaseModel, Field

# Import our SDK
import sys
import os as _os

_dir = _os.path.dirname(_os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)

from arch_tools import ArchToolsClient, ArchToolsAsyncClient, ArchToolsError


# ─── Base Tool ────────────────────────────────────────────────────────────────

class ArchToolBase(BaseTool):
    """Base class for all Arch Tools LangChain integrations."""

    api_key: str = Field(default="", description="Arch Tools API key")
    base_url: str = Field(default="https://archtools.dev", description="API base URL")
    tool_name: str = Field(default="", description="Arch Tools tool name")

    _client: ArchToolsClient | None = None

    class Config:
        arbitrary_types_allowed = True

    def _get_client(self) -> ArchToolsClient:
        if self._client is None:
            key = self.api_key or os.environ.get("ARCHTOOLS_API_KEY", "")
            self._client = ArchToolsClient(api_key=key, base_url=self.base_url)
        return self._client

    def _call_tool(self, **kwargs: Any) -> str:
        """Call the Arch Tools API and return a string result."""
        try:
            client = self._get_client()
            result = client.call_tool(self.tool_name, **kwargs)
            if isinstance(result, dict):
                if "error" in result and not result.get("ok"):
                    return f"Error: {result.get('error')} — {result.get('message', '')}"
                return str(result)
            return str(result)
        except ArchToolsError as e:
            return f"Arch Tools Error: {e}"


# ─── Tool Definitions ────────────────────────────────────────────────────────

class SummarizeInput(BaseModel):
    text: str = Field(description="The text to summarize")
    style: str = Field(default="bullets", description="Summary style: bullets, tldr, executive, paragraph, headline")

class ArchToolsSummarize(ArchToolBase):
    name: str = "arch_summarize"
    description: str = "Summarize text into bullets, TL;DR, executive summary, or other styles. Input: text and optional style."
    tool_name: str = "summarize"
    args_schema: Type[BaseModel] = SummarizeInput

    def _run(self, text: str, style: str = "bullets", run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(text=text, style=style)


class WebScrapeInput(BaseModel):
    url: str = Field(description="URL to scrape")
    format: str = Field(default="markdown", description="Output format: markdown, html, text")

class ArchToolsWebScrape(ArchToolBase):
    name: str = "arch_web_scrape"
    description: str = "Scrape a web page and extract its content as markdown, HTML, or text."
    tool_name: str = "web-scrape"
    args_schema: Type[BaseModel] = WebScrapeInput

    def _run(self, url: str, format: str = "markdown", run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(url=url, format=format)


class WebSearchInput(BaseModel):
    query: str = Field(description="Search query")
    limit: int = Field(default=5, description="Number of results")

class ArchToolsWebSearch(ArchToolBase):
    name: str = "arch_web_search"
    description: str = "Search the web with AI-synthesized answers and source citations."
    tool_name: str = "web-search"
    args_schema: Type[BaseModel] = WebSearchInput

    def _run(self, query: str, limit: int = 5, run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(query=query, limit=limit)


class AiGenerateInput(BaseModel):
    prompt: str = Field(description="The prompt or question")
    model: str = Field(default="claude", description="AI model: claude, gpt4, grok, gemini")
    system: str = Field(default="", description="Optional system prompt")

class ArchToolsAiGenerate(ArchToolBase):
    name: str = "arch_ai_generate"
    description: str = "Generate text using AI models (Claude, GPT-4, Grok, Gemini) via Arch Tools."
    tool_name: str = "ai-generate"
    args_schema: Type[BaseModel] = AiGenerateInput

    def _run(self, prompt: str, model: str = "claude", system: str = "", run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        params: dict[str, Any] = {"prompt": prompt, "model": model}
        if system:
            params["system"] = system
        return self._call_tool(**params)


class SentimentInput(BaseModel):
    text: str = Field(description="Text to analyze for sentiment")

class ArchToolsSentiment(ArchToolBase):
    name: str = "arch_sentiment_analysis"
    description: str = "Analyze the sentiment of text. Returns positive/negative/neutral with confidence scores."
    tool_name: str = "sentiment-analysis"
    args_schema: Type[BaseModel] = SentimentInput

    def _run(self, text: str, run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(text=text)


class ScreenshotInput(BaseModel):
    url: str = Field(description="URL to screenshot")
    full_page: bool = Field(default=False, description="Capture full scrollable page")

class ArchToolsScreenshot(ArchToolBase):
    name: str = "arch_screenshot"
    description: str = "Take a screenshot of any web page. Returns the image URL."
    tool_name: str = "screenshot-capture"
    args_schema: Type[BaseModel] = ScreenshotInput

    def _run(self, url: str, full_page: bool = False, run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(url=url, full_page=full_page)


class CryptoPriceInput(BaseModel):
    symbol: str = Field(description="CoinGecko coin ID, e.g. bitcoin, ethereum, solana")

class ArchToolsCryptoPrice(ArchToolBase):
    name: str = "arch_crypto_price"
    description: str = "Get the current price of a cryptocurrency by CoinGecko ID."
    tool_name: str = "crypto-price"
    args_schema: Type[BaseModel] = CryptoPriceInput

    def _run(self, symbol: str, run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(symbol=symbol)


class ImageGenerateInput(BaseModel):
    prompt: str = Field(description="Image description / prompt")
    size: str = Field(default="1024x1024", description="Image size: 1024x1024, 1792x1024, 1024x1792")

class ArchToolsImageGenerate(ArchToolBase):
    name: str = "arch_image_generate"
    description: str = "Generate an image from a text description using DALL-E."
    tool_name: str = "image-generate"
    args_schema: Type[BaseModel] = ImageGenerateInput

    def _run(self, prompt: str, size: str = "1024x1024", run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(prompt=prompt, size=size)


class ResearchInput(BaseModel):
    topic: str = Field(description="Research topic or question")
    depth: str = Field(default="standard", description="Depth: brief, standard, comprehensive")

class ArchToolsResearch(ArchToolBase):
    name: str = "arch_research_report"
    description: str = "Generate a research report on any topic with web sources."
    tool_name: str = "research-report"
    args_schema: Type[BaseModel] = ResearchInput

    def _run(self, topic: str, depth: str = "standard", run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(topic=topic, depth=depth)


class FactCheckInput(BaseModel):
    claim: str = Field(description="The claim or statement to verify")

class ArchToolsFactCheck(ArchToolBase):
    name: str = "arch_fact_check"
    description: str = "Verify a claim or statement using web evidence. Returns verdict and sources."
    tool_name: str = "fact-check"
    args_schema: Type[BaseModel] = FactCheckInput

    def _run(self, claim: str, run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        return self._call_tool(claim=claim)


class GenericToolInput(BaseModel):
    tool_name: str = Field(description="Name of the Arch Tools tool to call")
    params: str = Field(default="{}", description="JSON string of parameters to pass")

class ArchToolsGeneric(ArchToolBase):
    """
    A generic LangChain tool that can call any of the 58+ Arch Tools.
    Pass the tool name and a JSON params string.
    """
    name: str = "arch_tools"
    description: str = (
        "Call any Arch Tools API tool. Available tools include: "
        "summarize, ai-generate, web-scrape, web-search, sentiment-analysis, "
        "screenshot-capture, crypto-price, image-generate, research-report, "
        "fact-check, ocr-extract, extract-pdf, text-to-speech, email-send, "
        "and 44+ more. Pass tool_name and params (JSON string)."
    )
    args_schema: Type[BaseModel] = GenericToolInput

    def _run(self, tool_name: str, params: str = "{}", run_manager: Optional[CallbackManagerForToolRun] = None) -> str:
        import json
        try:
            parsed = json.loads(params)
        except json.JSONDecodeError:
            return f"Error: Invalid JSON params: {params}"
        self.tool_name = tool_name
        return self._call_tool(**parsed)


# ─── Toolkit ──────────────────────────────────────────────────────────────────

class ArchToolsToolkit:
    """
    LangChain toolkit that provides all Arch Tools as LangChain tools.

    Usage:
        toolkit = ArchToolsToolkit(api_key="arch_...")
        tools = toolkit.get_tools()
    """

    def __init__(self, api_key: str = "", base_url: str = "https://archtools.dev"):
        self.api_key = api_key or os.environ.get("ARCHTOOLS_API_KEY", "")
        self.base_url = base_url

    def get_tools(self) -> list[BaseTool]:
        """Get a curated list of the most useful Arch Tools as LangChain tools."""
        kwargs = {"api_key": self.api_key, "base_url": self.base_url}
        return [
            ArchToolsSummarize(**kwargs),
            ArchToolsWebScrape(**kwargs),
            ArchToolsWebSearch(**kwargs),
            ArchToolsAiGenerate(**kwargs),
            ArchToolsSentiment(**kwargs),
            ArchToolsScreenshot(**kwargs),
            ArchToolsCryptoPrice(**kwargs),
            ArchToolsImageGenerate(**kwargs),
            ArchToolsResearch(**kwargs),
            ArchToolsFactCheck(**kwargs),
            ArchToolsGeneric(**kwargs),
        ]
