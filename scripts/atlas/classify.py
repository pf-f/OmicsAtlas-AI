"""One classifier for collection, storage and the public directory.

Rules are evidence grades, not calibrated probabilities. Search hits alone are
never admission evidence. README references and installation code are not
used to infer domains.
"""

import re
from pathlib import Path
import json
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
TAXONOMY = json.loads((ROOT / "config/taxonomy.json").read_text())
RULE_VERSION = TAXONOMY["version"]


def normalize(text):
    return re.sub(
        r"[\s_]+", " ", (text or "").lower().replace("–", "-").replace("‑", "-")
    ).strip()


def matches(text, phrase):
    return bool(
        re.search(
            r"(?<![\w])" + re.escape(normalize(phrase)) + r"(?![\w])", normalize(text)
        )
    )


def safe_url(url):
    parsed = urlparse(url or "")
    return (
        url
        if parsed.scheme in {"http", "https"} and parsed.netloc and not parsed.username
        else ""
    )


def readme_prose(readme):
    # References and link directories often describe other projects.
    content = re.split(
        r"(?im)^#{1,6}\s+(?:references|citations?|bibliography|acknowledg\w*|related (?:work|projects)|publications)\b",
        readme or "",
    )[0]
    content = re.sub(r"```.*?```|~~~.*?~~~", " ", content, flags=re.S)
    content = re.sub(r"!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>", " ", content, flags=re.I)
    content = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", content)
    content = re.sub(r"<[^>]+>", " ", content)
    # Bullet-only lists of external tools are weaker than project self-description.
    content = "\n".join(
        line
        for line in content.splitlines()
        if not re.match(r"\s*[-*]\s+.*https?://", line)
    )
    content = re.sub(r"(?ms)^\s*\|.*?(?=\n\s*\n|\Z)", " ", content)
    return content[:10000]


def evidence(source, text, term, url, grade="strong"):
    found = re.search(re.escape(term), text, re.I)
    offset = found.start() if found else 0
    excerpt = re.sub(
        r"\s+", " ", text[max(0, offset - 100) : offset + len(term) + 160]
    ).strip()
    return {
        "source": source,
        "term": term,
        "excerpt": excerpt,
        "url": url,
        "grade": grade,
    }


def software_evidence(repo, readme, files):
    url = repo["html_url"]
    items = []
    manifests = {
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "description",
        "cargo.toml",
        "package.json",
        "environment.yml",
        "main.nf",
        "snakefile",
        "nextflow.config",
        "cmakelists.txt",
        "makefile",
    }
    for file in files:
        if file.lower() in manifests:
            items.append(
                evidence(
                    "file",
                    file,
                    file,
                    f"{url}/blob/{repo.get('default_branch', 'HEAD')}/{file}",
                )
            )
    install = re.search(
        r"(?im)(?:^\s*(?:\$\s*)?|`)(?:pip(?:3)? install|python(?:3)? -m pip install|conda install|mamba install|BiocManager::install|remotes::install_github|devtools::install_github|nextflow run|snakemake\b|docker (?:run|pull)|cargo install|npm install|Rscript\s)\b[^\n`]*",
        readme or "",
    )
    usage = re.search(
        r"(?im)^#{1,5}\s+(?:installation|installing|getting started|quick\s?start|usage|inference|running|tutorials?)\b",
        readme or "",
    )
    documented_code = bool(
        re.search(
            r"```(?:python|r|R|bash|sh|shell|console|nextflow|julia)?\s*\n[^`]{12,}",
            readme or "",
        )
    )
    if install:
        items.append(
            evidence(
                "readme", install.group(), install.group().strip(), f"{url}#readme"
            )
        )
    elif usage and documented_code:
        items.append(
            evidence(
                "readme", usage.group().strip(), usage.group().strip(), f"{url}#readme"
            )
        )
    # A link to this very project's published package is concrete software
    # evidence even when all installation instructions live on another site.
    name = re.sub(r"[-_.]", "", repo.get("name", "").lower())
    for package in re.finditer(
        r"https?://(?:pypi\.org/project/|bioconductor\.org/packages/(?:release/bioc/html/)?)([^/\s)#?]+)",
        readme or "",
        re.I,
    ):
        target = re.sub(r"[-_.]", "", package[1].lower().removesuffix(".html"))
        if target == name:
            items.append(
                evidence(
                    "package", package.group(), package[1], package.group().rstrip("/")
                )
            )
            break
    # Desktop tools often distribute installers rather than package commands.
    releases = re.search(
        r"https://github\.com/"
        + re.escape(repo["full_name"])
        + r"/releases(?:/latest)?",
        readme or "",
        re.I,
    )
    if releases and re.search(
        r"\b(?:download|installer|installation|installing)\b", readme or "", re.I
    ):
        items.append(
            evidence(
                "release",
                "Published installer / release linked from README",
                "installer",
                releases.group(),
            )
        )
    return items


def classify(repo, readme="", files=()):
    description = repo.get("description") or ""
    topics = [str(t).lower() for t in repo.get("topics", [])]
    prose = readme_prose(readme)
    url = repo["html_url"]
    result = {
        "rule_version": RULE_VERSION,
        "decision": "review",
        "domains": [],
        "tasks": [],
        "tool_types": [],
        "evidence": [],
        "software_evidence": [],
        "reason": "insufficient-evidence",
    }
    # Explicit resource collections cannot become tools just by mentioning tools.
    resource = r"\b(?:awesome (?:list|collection)|curated (?:list|collection)|collection of (?:papers|resources|links)|list of (?:papers|resources|jobs)|job (?:board|listings)|course (?:materials|notes)|dataset (?:for|of)|agent skills|skills (?:library|collection))\b"
    identity = description + "\n" + prose[:800]
    # Literature discovery and metadata standards may have code, but their
    # research keywords describe tracked content rather than an omics method.
    if re.search(
        r"weekly digest of (?:new )?papers|science-literature radar|unified data model|linkml schema|self-hosted health record",
        identity,
        re.I,
    ):
        result.update(decision="rejected", reason="support-resource-not-analysis-tool")
        return result
    if (
        re.search(resource, identity, re.I)
        or re.search(
            r"\b(?:curriculum|skill library|skills library|skill collections?|portfolio|best practices book|version of the book|this book|paper (?:tracker|tracking)|literature (?:tracker|tracking))\b",
            identity,
            re.I,
        )
        or re.match(r"analyses for\s+[\"']", description, re.I)
        or repo.get("name", "").lower().startswith("awesome-")
        or "skills-library" in topics
        or "book" in topics
        or repo.get("name", "").lower().endswith("-skills")
    ):
        result.update(decision="rejected", reason="resource-not-tool")
        return result
    # Generic terms such as analysis, multimodal, AI, learning are never domains.
    for domain in TAXONOMY["domains"]:
        found = []
        for topic in domain["topics"]:
            if topic in topics:
                found.append(evidence("topic", topic, topic, f"{url}/topics"))
        # Introductory self-description only: features, news, benchmarks and
        # downstream examples cannot independently grant extra domain labels.
        primary = re.split(
            r"(?im)^#{1,6}\s+(?:updates?|news|installation|usage|examples?|benchmarks?|applications?|features|license|model weights)\b",
            prose,
        )[0][:1800]
        for source, text, link in [
            ("description", description, url),
            ("readme", primary, f"{url}#readme"),
        ]:
            for phrase in domain["phrases"]:
                if matches(text, phrase):
                    found.append(evidence(source, text, phrase, link))
                    break
        if found:
            result["domains"].append(domain["id"])
            result["evidence"].extend({**e, "domain": domain["id"]} for e in found[:3])
    # Named methods still require actual protein context. ESM without that
    # context, such as JavaScript modules, never supplies protein evidence.
    if (
        "protein-ai" not in result["domains"]
        and any(
            matches(description + " " + repo.get("name", ""), term)
            for term in ["alphafold", "esm", "esmfold", "rosettafold"]
        )
        and re.search(
            r"\bprotein (?:structures?|sequences?|folding|models?)\b", prose, re.I
        )
    ):
        protein = re.search(
            r"\bprotein (?:structures?|sequences?|folding|models?)\b", prose, re.I
        ).group()
        result["domains"].append("protein-ai")
        result["evidence"].append(
            {
                **evidence("readme", prose, protein, f"{url}#readme", "contextual"),
                "domain": "protein-ai",
            }
        )
    if not result["domains"]:
        result["reason"] = "no-domain-evidence"
        return result
    result["software_evidence"] = software_evidence(repo, readme, files)
    if not result["software_evidence"]:
        return result
    text = normalize(description + "\n" + prose)
    # A README installation mentioning a dependency does not by itself identify
    # the project's purpose; require self-description or an exact domain topic.
    self_domain = any(
        e["source"] != "readme" or normalize(e["term"]) in normalize(prose[:1800])
        for e in result["evidence"]
    )
    if not self_domain:
        result["reason"] = "domain-only-in-secondary-text"
        return result
    if any(
        f.lower() in {"main.nf", "snakefile", "nextflow.config"}
        or f.lower().endswith((".wdl", ".cwl"))
        for f in files
    ) or re.search(r"\b(?:nextflow run|snakemake\b|cwltool\b)", readme, re.I):
        result["tool_types"].append("pipeline")
    elif any(
        matches(text, t)
        for t in [
            "analysis pipeline",
            "bioinformatics pipeline",
            "end-to-end pipeline",
            "processing pipeline",
        ]
    ) and re.search(r"\bpipeline\b", description, re.I):
        result["tool_types"].append("pipeline")
    if any(
        matches(text, t)
        for t in [
            "python package",
            "r package",
            "python library",
            "r library",
            "software package",
            "bioconductor package",
            "python toolkit",
            "r toolkit",
            "julia package",
        ]
    ) or any(e["source"] == "package" for e in result["software_evidence"]):
        result["tool_types"].append("library")
    if any(
        matches(text, t)
        for t in [
            "foundation model",
            "language model",
            "pretrained model",
            "pre-trained model",
            "deep learning model",
            "structure prediction",
            "protein design",
            "model weights",
        ]
    ):
        result["tool_types"].append("model")
    if any(
        matches(text, t)
        for t in [
            "command-line",
            "command line",
            "web application",
            "web interface",
            "graphical user interface",
            "cli",
            "desktop application",
        ]
    ):
        result["tool_types"].append("application")
    if not result["tool_types"]:
        # A verified executable/installable tool whose API shape is not stated.
        result["tool_types"] = ["application"]
    for task in TAXONOMY["tasks"]:
        if any(matches(text, term) for term in task["phrases"]):
            result["tasks"].append(task["id"])
    result.update(decision="accepted", reason="domain-and-software-evidence")
    return result


def extract_links(repo, readme, files=()):
    """Extract links and installation excerpts; never execute them."""
    base = repo["html_url"]
    papers = []
    for match in re.finditer(
        r"https?://(?:doi\.org/[^\s)>\]]+|arxiv\.org/(?:abs|pdf)/[^\s)>\]]+|pubmed\.ncbi\.nlm\.nih\.gov/\d+/?|(?:www\.)?biorxiv\.org/content/[^\s)>\]]+)",
        readme or "",
    ):
        url = safe_url(match.group().rstrip(".,;"))
        if url and url not in [p["url"] for p in papers]:
            papers.append(
                {
                    "url": url,
                    "source_url": f"{base}#readme",
                    "relationship": "mentioned-in-readme",
                }
            )
    installs = []
    for block in re.findall(r"```[^\n]*\n(.*?)```", readme or "", re.S):
        if re.search(
            r"\b(?:pip(?:3)? install|conda install|mamba install|BiocManager::install|install_github|nextflow run|docker (?:run|pull))\b",
            block,
        ):
            installs.append(
                {"command": block.strip()[:2500], "source_url": f"{base}#readme"}
            )
    environments = []
    if "Dockerfile" in files or re.search(
        r"\bdocker (?:run|pull|build)\b", readme or "", re.I
    ):
        environments.append(
            {
                "id": "docker",
                "url": f"{base}#readme",
                "label": "Documented Docker usage",
            }
        )
    if any(f in files for f in ["environment.yml", "environment.yaml"]) or re.search(
        r"\b(?:conda|mamba) (?:install|env create)\b", readme or ""
    ):
        environments.append(
            {"id": "conda", "url": f"{base}#readme", "label": "Documented Conda usage"}
        )
    homepage = safe_url(repo.get("homepage"))
    return {
        "papers": papers[:8],
        "install": installs[:3],
        "environments": environments,
        "documentation_url": homepage or f"{base}#readme",
    }
