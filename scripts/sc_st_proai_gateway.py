#!/usr/bin/env python3
"""Compatibility entrypoint. The maintained collector is update_catalog.py."""

from update_catalog import main

if __name__ == "__main__":
    raise SystemExit(main())
