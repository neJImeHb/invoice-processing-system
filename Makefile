include Makefile.sdlc

.PHONY: up down verify

up:
	docker compose up -d --wait

down:
	docker compose down

verify:
	npm run verify
