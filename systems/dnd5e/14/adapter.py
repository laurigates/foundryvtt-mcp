"""D&D5e API integration. Transport and credentials belong to the host."""

import json
from pathlib import Path


class Adapter:
    def __init__(self):
        # Use the installed package location, independently of the worker cwd.
        manifest = json.loads(Path(__file__).with_name("manifest.json").read_text(encoding="utf-8"))
        self.operations = frozenset(entry["id"] for entry in manifest["operations"])

    async def execute(self, operation, arguments, context):
        if not isinstance(operation, str) or operation not in self.operations:
            raise ValueError(f"Unsupported D&D5e operation: {operation}")
        if not isinstance(arguments, dict):
            raise ValueError("D&D5e arguments must be an object")
        # The host and IntegrationContext bind this token to this exact operation.
        # Shared workflows live in its fixed binding, never in arbitrary callbacks.
        return await context.invoke(operation, arguments)
