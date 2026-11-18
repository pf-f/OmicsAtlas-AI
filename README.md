# OmicsAtlas-AI

Find and compare research software across 11 omics and biomedical research
domains. Explore the directory in English or Chinese.

[Open OmicsAtlas-AI](https://pf-f.github.io/OmicsAtlas-AI/)

- Search the full directory and filter by domain, research task, tool type,
  programming language, license, or environment.
- Open a tool to inspect the evidence behind its listing, source links,
  installation excerpts, and observation dates.
- Save tools in your browser, transfer your bookmarks as JSON, and compare
  up to four tools side by side.
- Browse popular tools and recent discoveries, or export the full filtered
  result set as CSV or JSON.

## Directory data

The catalog covers single-cell, spatial omics, multi-omics, protein AI, AI
pathology, genomics, transcriptomics, epigenomics, proteomics, metabolomics,
and metagenomics.

The refresh is scheduled for Sundays at **00:23 UTC / 08:23 China time**.
Listings link to public evidence of research purpose and documented software use.

Stars indicate popularity. Weekly star change uses two observations recorded
6–8 days apart. A dash indicates a missing weekly baseline.

## Local preview

Serve the checked-in snapshot with Python 3.12 or newer.

```bash
python -m http.server 8000 --directory docs
```

Open [localhost:8000](http://localhost:8000).

## Sources and license

Repository information comes from GitHub. Discovery also uses bio.tools
registry links. [bio.tools license (CC BY 4.0)](https://biotools.readthedocs.io/en/latest/license.html)

OmicsAtlas-AI code is released under the [MIT License](LICENSE).
