# ProofForge — developer entrypoints.
# Run `make help` to list available targets.

SHELL := /bin/sh
.DEFAULT_GOAL := help

.PHONY: help setup dev build test test-coverage lint typecheck format \
        docker-up docker-down docker-logs clean db-migrate db-reset

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install all JS and Python dependencies
	pnpm install
	@command -v uv >/dev/null 2>&1 && uv sync || echo "uv not found — skipping Python deps"

dev: ## Run all apps/packages in dev mode
	pnpm dev

build: ## Build all packages
	pnpm build

test: ## Run all tests
	pnpm test

test-coverage: ## Run tests with coverage
	pnpm test:coverage

lint: ## Lint all packages
	pnpm lint

typecheck: ## Typecheck all packages
	pnpm typecheck

format: ## Format the repository
	pnpm format

docker-up: ## Start local infra (Postgres, Redis, MinIO)
	docker compose up -d

docker-down: ## Stop local infra
	docker compose down

docker-logs: ## Tail infra logs
	docker compose logs -f

db-migrate: ## Run database migrations (Phase 4)
	@echo "Migrations land in Phase 4 (packages/database)."

db-reset: ## Reset the database (Phase 4)
	@echo "DB reset lands in Phase 4 (packages/database)."

clean: ## Remove build output and caches
	pnpm clean

github-app: ## Register the GitHub App (one click, writes .env)
	node scripts/register-github-app.mjs
