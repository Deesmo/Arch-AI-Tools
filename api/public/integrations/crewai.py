"""
Arch Tools — CrewAI Integration
=================================

Ready-to-use CrewAI tool wrappers for Arch Tools.
Handles API key auth and x402 USDC payment errors.

Install:
    pip install httpx crewai crewai-tools

Usage (individual tools):
    from crewai_arch_tools import ArchWebScrapeTool, ArchSummarizeTool

    scraper = ArchWebScrapeTool(api_key="arch_...")
    result = scraper._run(url="https://example.com")

Usage (with CrewAI Agent):
    from crewai import Agent, Task, Crew
    from crewai_arch_tools import get_arch_tools

    tools = get_arch_tools(api_key="arch_...")

    researcher = Agent(
        role="Senior Research Analyst",
        goal="Find and summarize key information on any topic",
        backstory="Expert researcher with access to Arch Tools AI platform",
        tools=tools,
        verbose=True,
    )

    task = Task(
        description="Research the latest developments in x402 protocol payments",
        expected_output="A comprehensive summary with sources",
        agent=researcher,
    )

    crew = Crew(agents=[researcher], tasks=[task], verbose=True)
    result = crew.kickoff()
"""

from __future__ import annotations

import os
import json
from typing import Any, Optional, Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

# Import our SDK
import sys
import os as _os

_dir = _os.path.dirname(_os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)

from arch_tools import ArchToolsClient, ArchToolsError


# ─── Base ─────────────────────────────────────────────────────────────────────

class _ArchBase(BaseTool):
    """Base for all Arch Tools CrewAI tools."""

    api_key: str = Field(default="", description="Arch Tools API key")
    base_url: str = Field(default="https://archtools.dev")
    _tool_name: str = ""
    _client: Optional[ArchToolsClient] = None

    class Config:
        arbitrary_types_allowed = True

    def _get_client(self) -> ArchToolsClient:
        if self._client is None:
            key = self.api_key or os.environ.get("ARCHTOOLS_API_KEY", "")
            self._client = ArchToolsClient(api_key=key, base_url=self.base_url)
        return self._client

    def _invoke(self, **kwargs: Any) -> str:
        try:
            result = self._get_client().call_tool(self._tool_name, **kwargs)
            return json.dumps(result, indent=2) if isinstance(result, dict) else str(result)
        except ArchToolsError as e:
            return f"Error: {e}"


# ─── Tool Definitions ────────────────────────────────────────────────────────

class WebScrapeInput(BaseModel):
    url: str = Field(description="URL to scrape")
    format: str = Field(default="markdown", description="Output format: markdown, html, text")

class ArchWebScrapeTool(_ArchBase):
    name: str = "Arch Web Scrape"
    description: str = "Scrape any web page and extract its content as markdown, HTML, or plain text. Useful for reading articles, documentation, or any web content."
    args_schema: Type[BaseModel] = WebScrapeInput
    _tool_name: str = "web-scrape"

    def _run(self, url: str, format: str = "markdown") -> str:
        return self._invoke(url=url, format=format)


class WebSearchInput(BaseModel):
    query: str = Field(description="Search query")
    limit: int = Field(default=5, description="Number of source results")

class ArchWebSearchTool(_ArchBase):
    name: str = "Arch Web Search"
    description: str = "Search the web and get AI-synthesized answers with source citations. Great for research and fact-finding."
    args_schema: Type[BaseModel] = WebSearchInput
    _tool_name: str = "web-search"

    def _run(self, query: str, limit: int = 5) -> str:
        return self._invoke(query=query, limit=limit)


class SummarizeInput(BaseModel):
    text: str = Field(description="Text to summarize")
    style: str = Field(default="bullets", description="Summary style: bullets, tldr, executive, paragraph, headline")

class ArchSummarizeTool(_ArchBase):
    name: str = "Arch Summarize"
    description: str = "Summarize long text into bullets, TL;DR, executive summary, or other formats."
    args_schema: Type[BaseModel] = SummarizeInput
    _tool_name: str = "summarize"

    def _run(self, text: str, style: str = "bullets") -> str:
        return self._invoke(text=text, style=style)


class AiGenerateInput(BaseModel):
    prompt: str = Field(description="The prompt or question")
    model: str = Field(default="claude", description="AI model: claude, gpt4, grok, gemini")

class ArchAiGenerateTool(_ArchBase):
    name: str = "Arch AI Generate"
    description: str = "Generate text using Claude, GPT-4, Grok, or Gemini via Arch Tools API."
    args_schema: Type[BaseModel] = AiGenerateInput
    _tool_name: str = "ai-generate"

    def _run(self, prompt: str, model: str = "claude") -> str:
        return self._invoke(prompt=prompt, model=model)


class SentimentInput(BaseModel):
    text: str = Field(description="Text to analyze")

class ArchSentimentTool(_ArchBase):
    name: str = "Arch Sentiment Analysis"
    description: str = "Analyze the sentiment of text. Returns positive/negative/neutral with confidence."
    args_schema: Type[BaseModel] = SentimentInput
    _tool_name: str = "sentiment-analysis"

    def _run(self, text: str) -> str:
        return self._invoke(text=text)


class ScreenshotInput(BaseModel):
    url: str = Field(description="URL to capture")
    full_page: bool = Field(default=False, description="Capture full page")

class ArchScreenshotTool(_ArchBase):
    name: str = "Arch Screenshot"
    description: str = "Take a screenshot of any web page and get the image URL back."
    args_schema: Type[BaseModel] = ScreenshotInput
    _tool_name: str = "screenshot-capture"

    def _run(self, url: str, full_page: bool = False) -> str:
        return self._invoke(url=url, full_page=full_page)


class CryptoPriceInput(BaseModel):
    symbol: str = Field(description="CoinGecko coin ID (e.g. bitcoin, ethereum, solana)")

class ArchCryptoPriceTool(_ArchBase):
    name: str = "Arch Crypto Price"
    description: str = "Get the current price of any cryptocurrency. Use CoinGecko IDs like 'bitcoin', 'ethereum', 'solana'."
    args_schema: Type[BaseModel] = CryptoPriceInput
    _tool_name: str = "crypto-price"

    def _run(self, symbol: str) -> str:
        return self._invoke(symbol=symbol)


class ResearchInput(BaseModel):
    topic: str = Field(description="Research topic or question")
    depth: str = Field(default="standard", description="Depth: brief, standard, comprehensive")

class ArchResearchTool(_ArchBase):
    name: str = "Arch Research Report"
    description: str = "Generate a comprehensive research report on any topic, with web sources and analysis."
    args_schema: Type[BaseModel] = ResearchInput
    _tool_name: str = "research-report"

    def _run(self, topic: str, depth: str = "standard") -> str:
        return self._invoke(topic=topic, depth=depth)


class ImageGenerateInput(BaseModel):
    prompt: str = Field(description="Image description")
    size: str = Field(default="1024x1024", description="Image size")

class ArchImageGenerateTool(_ArchBase):
    name: str = "Arch Image Generate"
    description: str = "Generate images from text descriptions using DALL-E via Arch Tools."
    args_schema: Type[BaseModel] = ImageGenerateInput
    _tool_name: str = "image-generate"

    def _run(self, prompt: str, size: str = "1024x1024") -> str:
        return self._invoke(prompt=prompt, size=size)


class FactCheckInput(BaseModel):
    claim: str = Field(description="The claim to verify")

class ArchFactCheckTool(_ArchBase):
    name: str = "Arch Fact Check"
    description: str = "Verify claims or statements using web evidence. Returns verdict, sources, and confidence."
    args_schema: Type[BaseModel] = FactCheckInput
    _tool_name: str = "fact-check"

    def _run(self, claim: str) -> str:
        return self._invoke(claim=claim)


class GenericInput(BaseModel):
    tool_name: str = Field(description="Arch tool name (e.g. 'ocr-extract', 'email-verify')")
    params_json: str = Field(default="{}", description="JSON string of parameters")

class ArchGenericTool(_ArchBase):
    name: str = "Arch Tools Generic"
    description: str = (
        "Call any of 58+ Arch Tools by name. Pass tool_name and params_json. "
        "Tools include: ocr-extract, extract-pdf, text-to-speech, email-send, "
        "domain-check, news-search, video-generate, image-remove-bg, and more."
    )
    args_schema: Type[BaseModel] = GenericInput
    _tool_name: str = ""

    def _run(self, tool_name: str, params_json: str = "{}") -> str:
        try:
            params = json.loads(params_json)
        except json.JSONDecodeError:
            return f"Error: Invalid JSON: {params_json}"
        self._tool_name = tool_name
        return self._invoke(**params)


# ─── Convenience function ────────────────────────────────────────────────────

def get_arch_tools(
    api_key: str = "",
    base_url: str = "https://archtools.dev",
) -> list[_ArchBase]:
    """
    Get all Arch Tools as CrewAI tools, ready to pass to a CrewAI Agent.

    Args:
        api_key: Your Arch Tools API key.
        base_url: API base URL.

    Returns:
        List of CrewAI tools.
    """
    kwargs = {"api_key": api_key, "base_url": base_url}
    return [
        ArchWebScrapeTool(**kwargs),
        ArchWebSearchTool(**kwargs),
        ArchSummarizeTool(**kwargs),
        ArchAiGenerateTool(**kwargs),
        ArchSentimentTool(**kwargs),
        ArchScreenshotTool(**kwargs),
        ArchCryptoPriceTool(**kwargs),
        ArchResearchTool(**kwargs),
        ArchImageGenerateTool(**kwargs),
        ArchFactCheckTool(**kwargs),
        ArchGenericTool(**kwargs),
    ]
