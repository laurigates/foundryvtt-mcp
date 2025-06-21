# Foundry Local REST API

A **purely local** REST API module for FoundryVTT that provides HTTP endpoints for external integrations without relying on third-party relay services. This module enables secure, local-only access to actors, items, scenes, dice rolling, and world data.

## 🔒 Privacy & Security

- **100% Local** - No external dependencies or third-party services
- **No Data Leaves Your Network** - All API calls stay within your local environment
- **Secure API Key Authentication** - Cryptographically secure local authentication
- **Full Control** - You own and control all your game data

## ✨ Features

### Core Endpoints
- 🎲 **Dice Rolling** - `/api/dice/roll` - Roll dice with FoundryVTT's native system
- 👥 **Actor Management** - `/api/actors` - Search and retrieve character/NPC data
- 🎒 **Item Catalog** - `/api/items` - Search equipment, spells, and consumables
- 🗺️ **Scene Information** - `/api/scenes` - Access scene data and current scene
- 🌍 **World Data** - `/api/world` - Get world info, statistics, and system details

### Advanced Features
- **Real-time Integration** - Hooks into FoundryVTT's live game state
- **Comprehensive Data** - Full access to all FoundryVTT entities
- **Flexible Search** - Query by name, type, properties, and more
- **Combat Awareness** - Access current combat state and initiative
- **Module Integration** - Works alongside existing FoundryVTT modules

## 🚀 Installation

### 1. Install Module
1. In FoundryVTT, go to **Setup** → **Add-on Modules** → **Install Module**
2. Paste this manifest URL:
   ```
   https://github.com/lgates/foundryvtt-mcp/releases/latest/download/module.json
   ```
3. Click **Install**

### 2. Enable and Configure
1. Enable the module in your world
2. Go to **Settings** → **Configure Settings** → **Module Settings**
3. Find **"Foundry Local REST API"**
4. Check **"Enable REST API"**
5. Copy the generated **API Key** (you'll need this for external applications)

### 3. Test Connection
The API will be available at: `http://your-foundry-url/api/`

Test with:
```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:30000/api/status
```

## 📖 API Documentation

### Authentication

All endpoints (except `/api/status`) require authentication via API key:

```bash
# Header method (recommended)
curl -H "x-api-key: YOUR_API_KEY" http://localhost:30000/api/actors

# Bearer token method
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:30000/api/actors
```

### Endpoints

#### 🎲 Dice Rolling

**POST** `/api/dice/roll`
```json
{
  "formula": "1d20+5",
  "reason": "Attack roll",
  "advantage": false,
  "disadvantage": false,
  "sendToChat": false
}
```

Response:
```json
{
  "success": true,
  "data": {
    "formula": "1d20+5",
    "total": 18,
    "dice": [{"faces": 20, "results": [{"result": 13, "active": true}]}],
    "critical": {"success": false, "failure": false},
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

#### 👥 Actors

**GET** `/api/actors?query=goblin&type=npc&limit=10`

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "actor123",
      "name": "Goblin Warrior",
      "type": "npc",
      "level": 1,
      "hp": {"current": 7, "max": 7},
      "ac": 15,
      "cr": "1/4"
    }
  ]
}
```

**GET** `/api/actors/:id` - Get detailed actor information

#### 🎒 Items

**GET** `/api/items?query=sword&type=weapon&rarity=rare`

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "item456",
      "name": "Longsword +1",
      "type": "weapon",
      "rarity": "uncommon",
      "cost": {"value": 15, "denomination": "gp"},
      "damage": {"parts": [["1d8+1", "slashing"]]}
    }
  ]
}
```

#### 🗺️ Scenes

**GET** `/api/scenes/current` - Get active scene
**GET** `/api/scenes/:id` - Get specific scene
**GET** `/api/scenes?query=tavern` - Search scenes

#### 🌍 World Information

**GET** `/api/world`

Response:
```json
{
  "success": true,
  "data": {
    "id": "my-world",
    "title": "My Campaign",
    "system": "dnd5e",
    "foundryVersion": "12.331",
    "statistics": {
      "actors": {"total": 45, "byType": {"character": 5, "npc": 40}},
      "scenes": {"total": 12, "active": "Tavern"}
    },
    "combat": {"active": false}
  }
}
```

### Error Handling

All endpoints return errors in a consistent format:
```json
{
  "success": false,
  "error": "Error Type",
  "message": "Detailed error description"
}
```

## 🔧 Configuration

### Module Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable REST API** | Turn the API on/off | `false` |
| **API Key** | Authentication key (auto-generated) | _(generated)_ |
| **Log API Requests** | Log all requests for debugging | `false` |

### Environment Integration

The API is designed to work seamlessly with:

- **FoundryVTT MCP Server** - Replace third-party REST module dependency
- **Custom Scripts** - Direct API access for automation
- **External Tools** - Campaign management and integration tools
- **Mobile Apps** - Build companion apps with live game data

## 🛠️ Development

### Module Structure
```
foundry-local-rest-api/
├── module.json              # Module manifest
├── scripts/
│   ├── rest-api.js          # Main API server
│   ├── auth.js              # Authentication system
│   └── routes/              # API endpoint handlers
│       ├── actors.js
│       ├── items.js
│       ├── dice.js
│       ├── scenes.js
│       └── world.js
└── lang/
    └── en.json              # Localization
```

### Key Features

**Security First**:
- Constant-time API key comparison prevents timing attacks
- No sensitive data exposure in error messages
- Request logging for security monitoring

**Performance Optimized**:
- Efficient data queries using FoundryVTT's native collections
- Minimal data transformation overhead
- Smart caching of computed values

**Extensible Design**:
- Modular route handlers for easy expansion
- Consistent response format across all endpoints
- Hook-based integration with FoundryVTT lifecycle

## 🤝 Integration Examples

### FoundryVTT MCP Server

Update your MCP server's `.env` file:
```env
FOUNDRY_URL=http://localhost:30000
FOUNDRY_API_KEY=your_local_api_key_here
USE_REST_MODULE=false  # Use local module instead
```

### Custom JavaScript

```javascript
const API_KEY = 'your_api_key_here';
const BASE_URL = 'http://localhost:30000/api';

async function rollInitiative() {
  const response = await fetch(`${BASE_URL}/dice/roll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      formula: '1d20+2',
      reason: 'Initiative'
    })
  });

  const result = await response.json();
  console.log(`Initiative: ${result.data.total}`);
}
```

### Python Example

```python
import requests

class FoundryAPI:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.headers = {'x-api-key': api_key}

    def search_actors(self, query, actor_type=None):
        params = {'query': query}
        if actor_type:
            params['type'] = actor_type

        response = requests.get(
            f"{self.base_url}/actors",
            headers=self.headers,
            params=params
        )
        return response.json()

# Usage
api = FoundryAPI('http://localhost:30000/api', 'your_api_key')
goblins = api.search_actors('goblin', 'npc')
```

## 📊 Comparison: Local vs Third-Party

| Feature | **Local Module** | Third-Party Relay |
|---------|------------------|-------------------|
| **Privacy** | ✅ 100% Local | ❌ Data sent externally |
| **Security** | ✅ Your API keys | ❌ External service keys |
| **Reliability** | ✅ No external dependencies | ❌ Relies on external service |
| **Performance** | ✅ Direct local access | ❌ Network latency |
| **Cost** | ✅ Free forever | ❓ Potential service fees |
| **Control** | ✅ Full control | ❌ Service provider dependent |

## 🐛 Troubleshooting

### Common Issues

**API returns 401 Unauthorized**
- Check your API key is correct
- Ensure the module is enabled
- Verify the `x-api-key` header is being sent

**Cannot connect to API**
- Verify FoundryVTT is running
- Check the URL format: `http://your-foundry-url/api/`
- Ensure no firewall is blocking the port

**Empty search results**
- Check your query parameters
- Verify the data exists in your world
- Try broader search terms

### Debug Mode

Enable **"Log API Requests"** in module settings to see all incoming requests in the FoundryVTT console.

## 📄 License

MIT License - see [LICENSE](../LICENSE) file for details.

## 🙋‍♂️ Support

- **Issues**: [GitHub Issues](https://github.com/lgates/foundryvtt-mcp/issues)
- **Documentation**: This README and inline code comments
- **Community**: FoundryVTT Discord #module-development

---

**Built with privacy and security in mind. Your game data stays where it belongs - with you.** 🔒
