# FoundryVTT MCP Server - Development Makefile
# 
# This Makefile provides convenient commands for common development tasks
# including building, testing, linting, and deployment operations.

# Configuration
NODE_BIN := npx
TSX := $(NODE_BIN) tsx
PLAYWRIGHT := $(NODE_BIN) playwright
FOUNDRY_CMD := fvtt
FOUNDRY_PID_FILE := .foundry.pid

# Default target
.PHONY: help
help: ## Show this help message
	@echo "FoundryVTT MCP Server - Development Commands"
	@echo "============================================="
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Build targets
.PHONY: build clean rebuild
build: ## Compile TypeScript to JavaScript
	npm run build

clean: ## Remove build artifacts and temporary files
	npm run clean
	rm -rf node_modules/.cache
	rm -rf test-results
	rm -rf playwright-report
	rm -f .foundry.pid

rebuild: clean build ## Clean and rebuild the project

# Development targets
.PHONY: dev install setup
dev: ## Start development server with hot reload
	npm run dev

install: ## Install dependencies
	npm install

setup: install build test-connection ## Full project setup

# Testing targets
.PHONY: test test-unit test-watch test-coverage test-connection
test: ## Run all unit tests
	npm test

test-unit: test ## Alias for test

test-watch: ## Run tests in watch mode
	npm run test:watch

test-coverage: ## Generate test coverage report
	npm run test:coverage

test-connection: ## Test connection to FoundryVTT server
	npm run test-connection

# End-to-End testing targets
.PHONY: test-e2e test-e2e-ui test-e2e-headed test-e2e-debug test-e2e-report
test-e2e: ## Run E2E tests (auto-starts FoundryVTT)
	npm run test:e2e

test-e2e-ui: ## Run E2E tests with interactive UI
	npm run test:e2e:ui

test-e2e-headed: ## Run E2E tests with visible browser
	npm run test:e2e:headed

test-e2e-debug: ## Run E2E tests in debug mode
	npm run test:e2e:debug

test-e2e-report: ## View last E2E test report
	npm run test:e2e:report

# Advanced E2E testing
.PHONY: test-e2e-full test-e2e-with-server foundry-start foundry-stop foundry-status
test-e2e-full: foundry-start test-e2e foundry-stop ## Full E2E test cycle with server management

test-e2e-with-server: ## Run E2E tests with manual server checks
	$(TSX) scripts/run-e2e-tests.ts

foundry-start: ## Start FoundryVTT server in background
	@if [ -f $(FOUNDRY_PID_FILE) ] && kill -0 `cat $(FOUNDRY_PID_FILE)` 2>/dev/null; then \
		echo "FoundryVTT server already running (PID: `cat $(FOUNDRY_PID_FILE)`)"; \
	else \
		echo "Starting FoundryVTT server..."; \
		$(FOUNDRY_CMD) launch --headless --world=test-world & echo $$! > $(FOUNDRY_PID_FILE); \
		echo "FoundryVTT server started (PID: `cat $(FOUNDRY_PID_FILE)`)"; \
		echo "Waiting for server to be ready..."; \
		sleep 30; \
	fi

foundry-stop: ## Stop FoundryVTT server
	@if [ -f $(FOUNDRY_PID_FILE) ]; then \
		if kill -0 `cat $(FOUNDRY_PID_FILE)` 2>/dev/null; then \
			echo "Stopping FoundryVTT server (PID: `cat $(FOUNDRY_PID_FILE)`)"; \
			kill `cat $(FOUNDRY_PID_FILE)`; \
			rm -f $(FOUNDRY_PID_FILE); \
		else \
			echo "FoundryVTT server not running"; \
			rm -f $(FOUNDRY_PID_FILE); \
		fi; \
	else \
		echo "FoundryVTT server PID file not found"; \
	fi

foundry-status: ## Check FoundryVTT server status
	@if [ -f $(FOUNDRY_PID_FILE) ]; then \
		if kill -0 `cat $(FOUNDRY_PID_FILE)` 2>/dev/null; then \
			echo "FoundryVTT server running (PID: `cat $(FOUNDRY_PID_FILE)`)"; \
		else \
			echo "FoundryVTT server not running (stale PID file)"; \
			rm -f $(FOUNDRY_PID_FILE); \
		fi; \
	else \
		echo "FoundryVTT server not running"; \
	fi

# Quality assurance targets
.PHONY: lint lint-fix format check-types
lint: ## Run ESLint on source code
	npm run lint

lint-fix: ## Run ESLint with auto-fix
	$(NODE_BIN) eslint src --ext .ts --fix

format: ## Format code with Prettier (if configured)
	@if npm list prettier >/dev/null 2>&1; then \
		$(NODE_BIN) prettier --write "src/**/*.ts" "tests/**/*.ts"; \
	else \
		echo "Prettier not installed, skipping formatting"; \
	fi

check-types: ## Run TypeScript type checking
	$(NODE_BIN) tsc --noEmit

# All quality checks
.PHONY: qa
qa: lint check-types test ## Run all quality assurance checks

# Documentation targets
.PHONY: docs docs-serve docs-clean
docs: ## Generate TypeDoc documentation
	npm run docs

docs-serve: ## Generate and serve documentation locally
	npm run docs:serve

docs-clean: ## Remove generated documentation
	rm -rf docs

# Release targets
.PHONY: prerelease verify-ready
verify-ready: qa test-e2e ## Verify project is ready for release
	@echo "Project verification complete - ready for release"

prerelease: verify-ready ## Prepare for release (run all checks)
	@echo "Pre-release checks passed"

# Environment setup targets
.PHONY: setup-env setup-dev setup-ci
setup-env: ## Set up environment file template
	@if [ ! -f .env ]; then \
		echo "# FoundryVTT MCP Server Configuration" > .env; \
		echo "FOUNDRY_URL=http://localhost:30000" >> .env; \
		echo "FOUNDRY_API_KEY=your-api-key-here" >> .env; \
		echo "# OR use username/password:" >> .env; \
		echo "# FOUNDRY_USERNAME=admin" >> .env; \
		echo "# FOUNDRY_PASSWORD=admin" >> .env; \
		echo "USE_REST_MODULE=true" >> .env; \
		echo "LOG_LEVEL=info" >> .env; \
		echo ".env file created - please update with your settings"; \
	else \
		echo ".env file already exists"; \
	fi

setup-dev: install setup-env ## Set up development environment
	@echo "Installing Playwright browsers..."
	$(PLAYWRIGHT) install
	@echo "Development environment setup complete"

setup-ci: install ## Set up CI/CD environment
	$(PLAYWRIGHT) install --with-deps
	@echo "CI environment setup complete"

# Container targets (if Docker is used)
.PHONY: docker-build docker-test docker-clean
docker-build: ## Build Docker container
	@if [ -f Dockerfile ]; then \
		docker build -t foundry-mcp-server .; \
	else \
		echo "Dockerfile not found"; \
	fi

docker-test: docker-build ## Run tests in Docker container
	@if [ -f Dockerfile ]; then \
		docker run --rm foundry-mcp-server npm test; \
	else \
		echo "Dockerfile not found"; \
	fi

docker-clean: ## Clean Docker images and containers
	@if command -v docker >/dev/null 2>&1; then \
		docker system prune -f; \
	else \
		echo "Docker not installed"; \
	fi

# Maintenance targets
.PHONY: update-deps check-deps security-audit
update-deps: ## Update all dependencies
	npm update
	npm audit fix

check-deps: ## Check for outdated dependencies
	npm outdated

security-audit: ## Run security audit
	npm audit

# Utility targets
.PHONY: logs reset-test-data
logs: ## Show recent logs (if log files exist)
	@if [ -d logs ]; then \
		tail -f logs/*.log; \
	else \
		echo "No log files found"; \
	fi

reset-test-data: ## Reset test data and caches
	rm -rf test-results
	rm -rf playwright-report
	rm -rf coverage
	rm -rf .nyc_output

# Composite targets for common workflows
.PHONY: quick-test full-test dev-cycle
quick-test: lint test ## Quick development test cycle
	@echo "Quick test cycle complete"

full-test: qa test-e2e ## Full test suite including E2E
	@echo "Full test suite complete"

dev-cycle: clean install build quick-test ## Complete development cycle
	@echo "Development cycle complete"

# Install Playwright if needed
.PHONY: install-playwright
install-playwright: ## Install Playwright browsers
	$(PLAYWRIGHT) install

# Show project status
.PHONY: status
status: ## Show project status and environment
	@echo "FoundryVTT MCP Server Status"
	@echo "============================"
	@echo "Node.js version: $$(node --version)"
	@echo "npm version: $$(npm --version)"
	@echo "TypeScript version: $$($(NODE_BIN) tsc --version)"
	@echo "Project version: $$(node -p "require('./package.json').version")"
	@echo ""
	@if [ -f .env ]; then \
		echo "Environment file: ✓ .env exists"; \
	else \
		echo "Environment file: ✗ .env missing"; \
	fi
	@echo ""
	@make foundry-status