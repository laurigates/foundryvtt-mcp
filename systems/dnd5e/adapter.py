"""Read-only D&D 5e document adapter; game rules remain in Foundry."""


class Adapter:
    async def execute(self, operation, arguments, context):
        if operation != "get_actor_data":
            raise ValueError(f"Unsupported D&D 5e operation: {operation}")
        return await context.invoke(operation, arguments)
