from setuptools import setup, find_packages

setup(
    name="arch_tools",
    version="0.1.0",
    description="Official Python SDK for Arch Tools — 58 AI agent API tools with x402 payments",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Brad Valdes",
    author_email="support@archtools.dev",
    url="https://archtools.dev",
    packages=find_packages(),
    install_requires=["requests>=2.25.0"],
    python_requires=">=3.8",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Internet :: WWW/HTTP",
    ],
    keywords="arch-tools ai-agents x402 crypto-payments mcp web-scraping",
)
