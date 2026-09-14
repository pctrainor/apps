"""Entry point: `python -m agentscope`.

With no arguments this runs the offline end-to-end demo; with a subcommand it
dispatches through the admin CLI. See `python -m agentscope --help`.
"""

from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
