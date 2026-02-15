# FoundryVTT MCP Server - Development Recipes
# Run `just` or `just help` to see available recipes.

set positional-arguments
set dotenv-load

# List available recipes
@default:
    just --list

########## Build ##########

# Compile TypeScript to JavaScript
[group: "build"]
build:
    bun run build

# Remove build artifacts and temporary files
[group: "build"]
clean:
    bun run clean
    rm -rf node_modules/.cache test-results playwright-report coverage .nyc_output

# Clean and rebuild the project
[group: "build"]
rebuild: clean build

########## Development ##########

# Start development server with hot reload
[group: "dev"]
dev:
    bun run dev

# Install dependencies
[group: "dev"]
install:
    bun install

# Full project setup: install, build, verify connection
[group: "dev"]
setup: install build test-connection

# Show project status and environment
[group: "dev"]
status:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "FoundryVTT MCP Server Status"
    echo "============================"
    echo "Bun version: $(bun --version)"
    echo "Node.js version: $(node --version)"
    echo "TypeScript version: $(bunx tsc --version)"
    echo "Project version: $(node -p "require('./package.json').version")"
    echo ""
    if [ -f .env ]; then
        echo "Environment file: .env exists"
    else
        echo "Environment file: .env missing (run 'just setup-env')"
    fi

########## Testing ##########

# Run all unit tests
[group: "test"]
test *args:
    bun run test {{ args }}

# Run tests in watch mode
[group: "test"]
test-watch:
    bun run test:watch

# Generate test coverage report
[group: "test"]
test-coverage:
    bun run test:coverage

# Test connection to FoundryVTT server
[group: "test"]
test-connection:
    bun run test-connection

# Run integration tests
[group: "test"]
test-integration *args:
    bun run test:integration {{ args }}

########## E2E Testing ##########

# Run E2E tests (headless)
[group: "e2e"]
test-e2e *args:
    bun run test:e2e {{ args }}

# Run E2E tests with interactive UI
[group: "e2e"]
test-e2e-ui:
    bun run test:e2e:ui

# Run E2E tests with visible browser
[group: "e2e"]
test-e2e-headed:
    bun run test:e2e:headed

# Run E2E tests in debug mode
[group: "e2e"]
test-e2e-debug:
    bun run test:e2e:debug

# View last E2E test report
[group: "e2e"]
test-e2e-report:
    bun run test:e2e:report

# Install Playwright browsers
[group: "e2e"]
install-playwright:
    bunx playwright install

########## Quality ##########

# Run Biome linter on source code
[group: "quality"]
lint *args:
    bun run lint {{ args }}

# Run Biome linter with auto-fix
[group: "quality"]
lint-fix:
    bun run lint:fix

# Run TypeScript type checking
[group: "quality"]
check-types:
    bunx tsc --noEmit

# Run all quality checks (lint, types, tests)
[group: "quality"]
qa: lint check-types test

########## Documentation ##########

# Generate TypeDoc documentation
[group: "docs"]
docs:
    bun run docs

# Validate documentation without generating output
[group: "docs"]
docs-check:
    bun run docs:check

# Generate and serve documentation locally
[group: "docs"]
docs-serve:
    bun run docs:serve

########## Environment ##########

# Create .env file from template
[group: "env"]
setup-env:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f .env ]; then
        echo ".env file already exists"
        exit 0
    fi
    cat > .env << 'ENVEOF'
    # FoundryVTT MCP Server Configuration
    FOUNDRY_URL=http://localhost:30000
    FOUNDRY_USERNAME=admin
    FOUNDRY_PASSWORD=admin
    # FOUNDRY_API_KEY=your-api-key-here
    # FOUNDRY_USER_ID=
    LOG_LEVEL=info
    ENVEOF
    # Remove leading whitespace from heredoc
    sed -i '' 's/^    //' .env
    echo ".env file created - update with your settings"

# Run the interactive setup wizard
[group: "env"]
setup-wizard:
    bunx tsx scripts/setup-wizard.ts

# Set up full development environment
[group: "env"]
setup-dev: install setup-env install-playwright
    @echo "Development environment setup complete"

########## Maintenance ##########

# Update all dependencies
[group: "maintenance"]
[confirm("This will update all dependencies. Continue?")]
update-deps:
    bun update
    bun pm audit || true

# Check for outdated dependencies
[group: "maintenance"]
check-deps:
    bun outdated || true

# Run security audit
[group: "maintenance"]
security-audit:
    bun pm audit

########## Anti-patterns ##########

# Scan for common TypeScript anti-patterns using ast-grep
[group: "quality"]
antipatterns:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Scanning for anti-patterns..."
    issues=0
    echo ""
    echo "=== as any ==="
    check() { ast-grep -p "$1" --lang ts --globs '!**/__tests__/**' src/; }
    echo "=== as any ==="
    if check '$EXPR as any'; then ((issues+=1)); else echo "None found"; fi
    echo ""
    echo "=== as unknown as ==="
    if check '$EXPR as unknown as $TYPE'; then ((issues+=1)); else echo "None found"; fi
    echo ""
    echo "=== empty catch blocks ==="
    if check 'try { $$$ } catch ($E) { }'; then ((issues+=1)); else echo "None found"; fi
    echo ""
    echo "=== eval usage ==="
    if check 'eval($$$)'; then ((issues+=1)); else echo "None found"; fi
    echo ""
    if [ "$issues" -eq 0 ]; then
        echo "No anti-patterns found!"
    else
        echo "$issues anti-pattern category(s) found"
        exit 1
    fi

########## Composite Workflows ##########

# Quick development check (lint + test)
[group: "workflow"]
quick-check: lint test
    @echo "Quick check complete"

# Full test suite including E2E
[group: "workflow"]
full-test: qa test-e2e
    @echo "Full test suite complete"

# Complete development cycle (clean, install, build, check)
[group: "workflow"]
dev-cycle: clean install build quick-check
    @echo "Development cycle complete"

# Pre-release verification (all checks + E2E)
[group: "workflow"]
[confirm("Run full pre-release verification?")]
verify-release: qa test-e2e
    @echo "Pre-release checks passed"
