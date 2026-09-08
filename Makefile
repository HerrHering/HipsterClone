.DEFAULT_GOAL := help

.PHONY: help install ci-install install-ytdlp dev test test-watch lint build check ci scrape scrape-debug docker-build docker-up docker-down docker-logs clean distclean

help: ## Show available commands.
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies for local development.
	npm install

ci-install: ## Install locked dependencies for CI or a clean local install.
	npm ci

install-ytdlp: ## Create the local yt-dlp virtual environment required for downloads.
	python3 -m venv .venv
	.venv/bin/pip install -U yt-dlp

dev: ## Start the web client and API development servers.
	npm run dev

test: ## Run the automated test suite.
	npm test

test-watch: ## Run tests in watch mode.
	npm run test:watch

lint: ## Lint the web workspace.
	npm run lint

build: ## Type-check and build all application workspaces.
	npm run build

check: test lint build ## Run all checks used by CI.

ci: ci-install check ## Reproduce the GitHub Actions verification locally.

scrape: ## Generate the web song manifest from the CSV catalog.
	npm run scrape

scrape-debug: ## Generate the song manifest with verbose resolver logs.
	npm run scrape:debug

docker-build: ## Build the production Docker image (run `make scrape` first).
	docker compose build

docker-up: ## Start the production Docker Compose service.
	docker compose up --build -d

docker-down: ## Stop the Docker Compose service.
	docker compose down

docker-logs: ## Follow Docker Compose service logs.
	docker compose logs -f

clean: ## Remove generated build, manifest, and audio-cache artifacts.
	rm -rf packages/shared/dist apps/api/dist apps/web/dist apps/web/public/manifest.json apps/web/public/audio apps/api/data/cache

distclean: clean ## Also remove installed dependencies and the local Python environment.
	rm -rf node_modules .venv
