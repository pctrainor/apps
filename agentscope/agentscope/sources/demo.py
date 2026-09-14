"""Offline demo source.

A hand-built fixture corpus that runs the whole funnel with zero network and
zero setup. It deliberately mixes strong prospects, weak/adjacent noise, and
totally-unrelated documents so the ~95% prefilter cull is visible. All text is
synthetic and stands in for the kind of *public* signal we'd really ingest.
"""

from __future__ import annotations

from typing import Iterator

from ..models import RawDoc
from .base import Source


# (company, source, url, title, text)
_FIXTURES = [
    ("Nimbus Robotics", "jobboard", "https://example.com/jobs/nimbus-agent-eng",
     "Senior AI Agent Engineer",
     "We run autonomous agents in production handling millions of requests for "
     "enterprise customers. You will own our multi-agent orchestration built on "
     "LangGraph, tackle hallucinations and prompt injection, and build our "
     "evaluation harness. Reliability and guardrails are mission critical."),

    ("Nimbus Robotics", "github", "https://example.com/nimbus/agent-core",
     "nimbus/agent-core",
     "Production agent framework with tool calling and RAG pipeline. Includes "
     "red-teaming scripts and an evals suite for regression testing of our "
     "customer-facing copilot."),

    ("Helios Health", "companypage", "https://example.com/helios/ai",
     "Helios AI Platform",
     "Our clinical copilot uses an LLM agent with retrieval augmented answers. "
     "We are investing heavily in observability, human-in-the-loop review, and "
     "monitoring to keep the system reliable and safe for patients."),

    ("Helios Health", "jobboard", "https://example.com/jobs/helios-ml",
     "Machine Learning Engineer, Safety",
     "We're hiring an applied AI engineer to work on model evaluation, red team "
     "exercises, and guardrails for our agentic clinical assistant in production."),

    ("Quill Finance", "jobboard", "https://example.com/jobs/quill-llm",
     "LLM Engineer",
     "Join our team building an ai copilot for analysts. Function calling over "
     "internal tools, at scale, 24/7. Comfortable with non-deterministic systems "
     "and flaky agent behaviour a plus."),

    ("Drift Logistics", "companypage", "https://example.com/drift/product",
     "Drift Autonomous Dispatch",
     "AI agents automate dispatch across our fleet. Deployed in production with "
     "low latency SLAs. We use LangChain and Kubernetes."),

    ("Marlowe Legal", "companypage", "https://example.com/marlowe/about",
     "Marlowe: AI for law firms",
     "We are exploring how an ai copilot could help paralegals draft documents. "
     "Early prototype, not yet in production."),

    ("Acme Widgets", "companypage", "https://example.com/acme/home",
     "Acme Widgets - Industrial Fasteners",
     "Acme has supplied stainless steel bolts and washers since 1957. Request a "
     "quote for bulk orders. No minimums on standard SKUs."),

    ("Bluebird Bakery", "companypage", "https://example.com/bluebird/menu",
     "Bluebird Bakery Menu",
     "Fresh sourdough daily. Our cinnamon rolls sell out by 10am. Order a "
     "birthday cake online for weekend pickup."),

    ("Cobalt Consulting", "jobboard", "https://example.com/jobs/cobalt-pm",
     "Project Manager",
     "Seeking an experienced project manager to coordinate client engagements. "
     "PMP certification preferred. No engineering background required."),

    ("Meridian Travel", "companypage", "https://example.com/meridian/tours",
     "Meridian Guided Tours",
     "Explore Patagonia with expert guides. Small groups, all-inclusive lodges, "
     "unforgettable hikes. Book your 2026 departure today."),

    ("Orchard Data", "github", "https://example.com/orchard/etl",
     "orchard/etl",
     "Batch ETL jobs in Python for our data warehouse. Airflow DAGs, dbt models, "
     "nightly loads. No machine learning here, just pipelines."),

    ("Sable Security", "jobboard", "https://example.com/jobs/sable-ai",
     "AI Safety Engineer",
     "We build agentic security tooling. You will red team our own autonomous "
     "agents, harden guardrails against prompt injection and jailbreaks, and "
     "run evals. Everything tested against our own systems only."),

    ("Vesper Media", "companypage", "https://example.com/vesper/news",
     "Vesper Media Newsroom",
     "Breaking news, culture, and opinion. Subscribe for unlimited articles and "
     "our weekly newsletter."),

    # Owner login form on purpose: entity resolution merges this GitHub-style
    # name with "Tessellate AI" from the job post below into one candidate.
    ("tessellate-ai", "github", "https://example.com/tessellate/agents",
     "tessellate-ai/agents",
     "Multi-agent framework with autogen-style orchestration. Function calling, "
     "tool use, and a growing evals harness. Used in production by enterprise "
     "customers; observability and monitoring built in."),

    ("Tessellate AI", "jobboard", "https://example.com/jobs/tessellate-eng",
     "Applied AI Engineer",
     "We're hiring to scale our multi-agent platform. Own reliability, guardrails, "
     "and the evaluation harness for our customer-facing ai agents in production."),

    ("Fig Analytics", "companypage", "https://example.com/fig/dashboard",
     "Fig Analytics Dashboards",
     "Beautiful BI dashboards for your team. Connect your database and visualise "
     "revenue, churn, and cohorts. No code required."),

    ("Harbor Payments", "companypage", "https://example.com/harbor/platform",
     "Harbor Payments",
     "Process payments globally with one API. PCI compliant, low latency, 24/7 "
     "uptime. Trusted by thousands of merchants."),

    ("Lumen Robotics", "jobboard", "https://example.com/jobs/lumen-agent",
     "Autonomous Systems Engineer",
     "Build autonomous agents for warehouse robots. Some RAG, mostly classical "
     "planning. Production deployment across three facilities."),

    ("Pinecrest Realty", "companypage", "https://example.com/pinecrest/listings",
     "Pinecrest Realty Listings",
     "Find your dream home. Browse listings, schedule tours, and connect with a "
     "local agent today. (Real-estate agent, that is.)"),
]


class DemoSource(Source):
    name = "demo"

    def fetch(self) -> Iterator[RawDoc]:
        for company, source, url, title, text in _FIXTURES:
            yield RawDoc(source=self.name, url=url, title=title, text=text,
                         company=company, meta={"origin": source})
