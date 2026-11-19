"""Read-only PF2e document adapter; game rules remain in Foundry."""


class Adapter:
    async def execute(self, operation, arguments, context):
        if operation != "get_actor_data":
            raise ValueError(f"Unsupported PF2e operation: {operation}")
        return await context.invoke(operation, arguments)
