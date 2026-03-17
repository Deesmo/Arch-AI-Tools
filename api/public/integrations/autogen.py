"""
Arch Tools — AutoGen Integration
==================================

Tool wrappers for Microsoft AutoGen (pyautogen / autogen-agentchat).
Register Arch Tools functions with AutoGen agents for tool calling.

Install:
    pip install httpx pyautogen

Usage (AG2 / AutoGen 0.2+):
    import autogen
    from autogen_arch_tools import register_arch_tools

    config_list = [{"model": "gpt-4o", "api_key": "sk-..."}]
    assistant = autogen.AssistantAgent("assistant", llm_config={"config_list": config_list})
    user = autogen.UserProxyAgent("user", human_input_mode="NEVER",
                                  code_execution_config=False)

    # Register all Arch Tools with the agents
    register_arch_tools(user, assistant, api_key="arch_...")

    user.initiate_chat(assistant, message="Summarize the article at https://example.com")

Usage (individual function):
    from autogen_arch_tools import make_arch_tool_function

    summarize_fn = make_arch_tool_function("summarize", api_key="arch_...")
    result = summarize_fn(text="Long article text...", style="bullets")
"""

from __future__ import annotations

import os
import json
from typing import Any, Callable

# Import our SDK
import sys
import os as _os

_dir = _os.path.dirname(_os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)

from arch_tools import ArchToolsClient, ArchToolsError


# ─── Tool function factory ───────────────────────────────────────────────────

def make_arch_tool_function(
    tool_name: str,
    api_key: str = "",
    base_url: str = "https://archtools.dev",
) -> Callable[..., str]:
    """
    Create a callable function for an Arch Tools tool.

    Args:
        tool_name: The Arch Tools tool name (e.g. 'summarize', 'web-scrape').
        api_key: API key. Falls back to ARCHTOOLS_API_KEY env var.
        base_url: API base URL.

    Returns:
        A function that accepts keyword arguments and returns a string result.
    """
    key = api_key or os.environ.get("ARCHTOOLS_API_KEY", "")
    client = ArchToolsClient(api_key=key, base_url=base_url)

    def tool_fn(**kwargs: Any) -> str:
        try:
            result = client.call_tool(tool_name, **kwargs)
            return json.dumps(result, indent=2) if isinstance(result, dict) else str(result)
        except ArchToolsError as e:
            return f"Error: {e}"

    tool_fn.__name__ = f"arch_{tool_name.replace('-', '_')}"
    tool_fn.__doc__ = f"Call Arch Tools '{tool_name}' endpoint."
    return tool_fn


# ─── Tool definitions for AutoGen function calling ──────────────────────────

ARCH_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "arch_web_scrape",
        "description": "Scrape a web page and extract content as markdown, HTML, or text.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to scrape"},
                "format": {"type": "string", "enum": ["markdown", "html", "text"], "description": "Output format (default: markdown)"},
            },
            "required": ["url"],
        },
    },
    {
        "name": "arch_web_search",
        "description": "Search the web and get AI-synthesized answers with source citations.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Number of results (default: 5)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "arch_summarize",
        "description": "Summarize text into bullets, TL;DR, executive summary, or other styles.",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to summarize"},
                "style": {"type": "string", "enum": ["bullets", "tldr", "executive", "paragraph", "headline"], "description": "Summary style (default: bullets)"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "arch_ai_generate",
        "description": "Generate text using AI models (Claude, GPT-4, Grok, Gemini).",
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "The prompt or question"},
                "model": {"type": "string", "enum": ["claude", "gpt4", "grok", "gemini"], "description": "AI model (default: claude)"},
                "system": {"type": "string", "description": "Optional system prompt"},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "arch_sentiment_analysis",
        "description": "Analyze the sentiment of text. Returns positive/negative/neutral with confidence.",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to analyze"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "arch_screenshot",
        "description": "Take a screenshot of any web page.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to screenshot"},
                "full_page": {"type": "boolean", "description": "Capture full page (default: false)"},
            },
            "required": ["url"],
        },
    },
    {
        "name": "arch_crypto_price",
        "description": "Get the current price of a cryptocurrency.",
        "parameters": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "CoinGecko coin ID (e.g. bitcoin, ethereum)"},
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "arch_image_generate",
        "description": "Generate an image from a text description.",
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Image description"},
                "size": {"type": "string", "enum": ["1024x1024", "1792x1024", "1024x1792"], "description": "Image size (default: 1024x1024)"},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "arch_research_report",
        "description": "Generate a research report on any topic with web sources.",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Research topic"},
                "depth": {"type": "string", "enum": ["brief", "standard", "comprehensive"], "description": "Report depth (default: standard)"},
            },
            "required": ["topic"],
        },
    },
    {
        "name": "arch_fact_check",
        "description": "Verify a claim using web evidence. Returns verdict and sources.",
        "parameters": {
            "type": "object",
            "properties": {
                "claim": {"type": "string", "description": "The claim to verify"},
            },
            "required": ["claim"],
        },
    },
    {
        "name": "arch_generic_tool",
        "description": "Call any of 58+ Arch Tools by name. Use for tools not covered by specific functions (e.g. ocr-extract, extract-pdf, email-send, text-to-speech).",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_name": {"type": "string", "description": "Arch tool name (e.g. 'ocr-extract')"},
                "params_json": {"type": "string", "description": "JSON string of parameters"},
            },
            "required": ["tool_name"],
        },
    },
]

# Map tool names to Arch Tools API tool names
_TOOL_NAME_MAP: dict[str, str] = {
    "arch_web_scrape": "web-scrape",
    "arch_web_search": "web-search",
    "arch_summarize": "summarize",
    "arch_ai_generate": "ai-generate",
    "arch_sentiment_analysis": "sentiment-analysis",
    "arch_screenshot": "screenshot-capture",
    "arch_crypto_price": "crypto-price",
    "arch_image_generate": "image-generate",
    "arch_research_report": "research-report",
    "arch_fact_check": "fact-check",
    "arch_generic_tool": "__generic__",
}


# ─── Registration function ───────────────────────────────────────────────────

def register_arch_tools(
    executor_agent: Any,
    caller_agent: Any,
    api_key: str = "",
    base_url: str = "https://archtools.dev",
    tools: list[str] | None = None,
) -> None:
    """
    Register Arch Tools functions with AutoGen agents.

    Args:
        executor_agent: The UserProxyAgent that executes tool calls.
        caller_agent: The AssistantAgent that decides which tools to call.
        api_key: Arch Tools API key.
        base_url: API base URL.
        tools: Optional list of tool names to register. Defaults to all.
    """
    key = api_key or os.environ.get("ARCHTOOLS_API_KEY", "")
    client = ArchToolsClient(api_key=key, base_url=base_url)

    # Build function map
    function_map: dict[str, Callable] = {}

    for defn in ARCH_TOOL_DEFINITIONS:
        fn_name = defn["name"]
        arch_tool_name = _TOOL_NAME_MAP.get(fn_name, "")

        if tools and fn_name not in tools and arch_tool_name not in tools:
            continue

        if arch_tool_name == "__generic__":
            def _generic(tool_name: str, params_json: str = "{}") -> str:
                try:
                    params = json.loads(params_json)
                    result = client.call_tool(tool_name, **params)
                    return json.dumps(result, indent=2) if isinstance(result, dict) else str(result)
                except Exception as e:
                    return f"Error: {e}"
            function_map[fn_name] = _generic
        else:
            # Capture arch_tool_name in closure
            def _make_fn(tn: str) -> Callable:
                def fn(**kwargs: Any) -> str:
                    try:
                        result = client.call_tool(tn, **kwargs)
                        return json.dumps(result, indent=2) if isinstance(result, dict) else str(result)
                    except Exception as e:
                        return f"Error: {e}"
                return fn
            function_map[fn_name] = _make_fn(arch_tool_name)

    # Register with AutoGen agents
    # Works with both AG2 (autogen 0.2+) and older autogen
    try:
        # AG2 style: register_for_llm + register_for_execution
        for defn in ARCH_TOOL_DEFINITIONS:
            fn_name = defn["name"]
            if fn_name not in function_map:
                continue

            fn = function_map[fn_name]
            fn.__name__ = fn_name
            fn.__doc__ = defn["description"]

            # Register the function for the caller (LLM agent)
            caller_agent.register_for_llm(
                name=fn_name,
                description=defn["description"],
            )(fn)

            # Register the function for the executor
            executor_agent.register_for_execution(name=fn_name)(fn)

    except AttributeError:
        # Fallback: older autogen with function_map style
        caller_config = caller_agent.llm_config or {}
        existing_functions = caller_config.get("functions", [])
        caller_config["functions"] = existing_functions + [
            d for d in ARCH_TOOL_DEFINITIONS if d["name"] in function_map
        ]
        caller_agent.update_llm_config(caller_config)

        existing_map = getattr(executor_agent, "_function_map", {})
        existing_map.update(function_map)
        executor_agent._function_map = existing_map
